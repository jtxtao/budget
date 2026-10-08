/**
 * @jest-environment node
 */

/**
 * `electron/assist.js` — the main process asking the local model.
 *
 * In `src/` for `electronBooks.test.js`'s reason: CRA pins Jest's roots there,
 * and a suite under `electron/` would silently not exist. A real HTTP server on
 * a real loopback port stands in for Ollama, because what is worth pinning
 * down is the wire — what is sent, what a refusal or a dead port comes back
 * as — and a mocked `http` would only assert that the module calls it.
 */

const http = require("http");
const assist = require("../electron/assist");

let server;
let port;
let received;
let reply;

beforeEach(async () => {
  received = [];
  reply = () => ({ status: 200, body: {} });
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      received.push({ method: req.method, url: req.url, body: text ? JSON.parse(text) : null });
      const { status, body, raw } = reply(req);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(raw ?? JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const question = {
  model: "qwen2.5:7b",
  messages: [
    { role: "system", content: "read it" },
    { role: "user", content: "coffee 4" },
  ],
  schema: { type: "object", properties: { action: { enum: ["unknown"] } } },
};

describe("status", () => {
  test("lists the models Ollama has", async () => {
    reply = () => ({ status: 200, body: { models: [{ name: "qwen2.5:7b" }, { name: "llama3.2:3b" }] } });
    expect(await assist.status({ port })).toEqual({ ok: true, models: ["qwen2.5:7b", "llama3.2:3b"] });
    expect(received[0]).toMatchObject({ method: "GET", url: "/api/tags" });
  });

  test("nothing listening is an answer, not a throw", async () => {
    await new Promise((resolve) => server.close(resolve));
    server = http.createServer();
    expect(await assist.status({ port })).toEqual({ ok: false, reason: "unreachable" });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
});

describe("ask", () => {
  test("sends the schema as the format, at temperature zero, and parses the reply", async () => {
    reply = () => ({
      status: 200,
      body: { message: { role: "assistant", content: '{"action":"unknown"}' }, done: true },
    });

    expect(await assist.ask(question, { port })).toEqual({ ok: true, content: { action: "unknown" } });
    expect(received[0]).toEqual({
      method: "POST",
      url: "/api/chat",
      body: {
        model: "qwen2.5:7b",
        messages: question.messages,
        format: question.schema,
        stream: false,
        options: { temperature: 0 },
      },
    });
  });

  test("Ollama's own words come back where it gave some", async () => {
    reply = () => ({ status: 404, body: { error: "model 'qwen2.5:7b' not found" } });
    expect(await assist.ask(question, { port })).toEqual({
      ok: false,
      reason: "bad-response",
      error: "model 'qwen2.5:7b' not found",
    });
  });

  test("a reply that is not JSON is not passed on", async () => {
    reply = () => ({ status: 200, body: { message: { content: "Sure! Here you go:" } } });
    expect(await assist.ask(question, { port })).toEqual({ ok: false, reason: "bad-response" });
  });

  test.each([
    ["no model", { ...question, model: "" }],
    ["a model name with a space", { ...question, model: "qwen 2.5; rm" }],
    ["no messages", { ...question, messages: [] }],
    ["a role it does not know", { ...question, messages: [{ role: "tool", content: "x" }] }],
    ["an enormous message", { ...question, messages: [{ role: "user", content: "x".repeat(50000) }] }],
    ["no schema", { ...question, schema: null }],
  ])("refuses %s before anything is sent", async (_label, input) => {
    const result = await assist.ask(input, { port });
    expect(result).toMatchObject({ ok: false, reason: "refused" });
    expect(received).toEqual([]);
  });
});
