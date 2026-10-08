const http = require("http");

/**
 * The assistant: a local model, asked to read a sentence.
 *
 * **The model never touches the books.** What it is asked for is a reading — a
 * sentence turned into a small JSON object the renderer checks against the
 * household's own lists — and what happens next is one of the app's ordinary
 * forms, opened already filled in, with the ordinary store behind it. So the
 * worst a wrong reading can do is put the wrong figure in a field somebody is
 * looking at.
 *
 * **Ollama, on this machine, and nowhere else.** The desktop build is the one
 * whose promise is that the ledger does not leave the computer, and a model on
 * somebody else's server would break it in the first sentence anyone typed. So
 * the host is not configurable: it is loopback, written out below, and an
 * `OLLAMA_HOST` pointing elsewhere is deliberately not read.
 *
 * **Asked from main, not from the page, and that is a policy decision.** The
 * renderer's egress is an allow-list (`guardEgress` and the CSP in `main.js`,
 * with `vercel.json` the same policy for the web); letting the page open
 * `127.0.0.1` would mean a fourth origin in all three, for every page load,
 * whether or not anybody uses this. A request made by Node in this process is
 * outside Chromium's network stack altogether — so it is made only here, only
 * to loopback, and only when the person has typed something and asked.
 *
 * Every function returns `{ ok, … }` rather than throwing, like every store:
 * "Ollama is not running" is an ordinary answer that the page words, not an
 * error to surface from an IPC handler.
 */

const HOST = "127.0.0.1";
const DEFAULT_PORT = 11434;

/** Long enough for a cold model to load from disk; short enough to give up on a hang. */
const ASK_TIMEOUT_MS = 120000;
const STATUS_TIMEOUT_MS = 1500;

/**
 * Limits on what the page may send across. The page is ours, but the bridge is
 * the one door out of the sandbox, and a verb that would carry anything of any
 * size is a general verb with a narrow name.
 */
const MAX_MESSAGES = 8;
const MAX_CONTENT = 40000;
const MAX_SCHEMA = 40000;
const MODEL_NAME = /^[\w.:/-]{1,200}$/;

function request({ method, path, body, port = DEFAULT_PORT, timeout }) {
  return new Promise((resolve) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: HOST,
        port,
        method,
        path,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // Left null; the caller words it.
          }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json });
        });
      }
    );

    req.setTimeout(timeout, () => req.destroy(new Error("timeout")));
    req.on("error", (error) =>
      resolve({
        ok: false,
        status: 0,
        reason: error.message === "timeout" ? "timeout" : "unreachable",
      })
    );

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Whether Ollama is there, and which models it has.
 *
 * `{ ok: true, models: ["qwen2.5:7b", …] }`, or `{ ok: false, reason }` where
 * the reason is `"unreachable"` (not installed, or not running — the same
 * thing from here) or `"bad-response"`.
 */
async function status({ port } = {}) {
  const res = await request({ method: "GET", path: "/api/tags", port, timeout: STATUS_TIMEOUT_MS });
  if (!res.ok) return { ok: false, reason: res.reason ?? "bad-response" };

  const models = Array.isArray(res.json?.models)
    ? res.json.models.map((model) => model?.name).filter((name) => typeof name === "string")
    : null;
  if (!models) return { ok: false, reason: "bad-response" };
  return { ok: true, models };
}

/** The request the page sent, or why it was refused. */
function checkAsk(input) {
  const { model, messages, schema } = input ?? {};
  if (typeof model !== "string" || !MODEL_NAME.test(model)) return "No model was named.";
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return "Nothing was asked.";
  }
  for (const message of messages) {
    if (!message || !["system", "user", "assistant"].includes(message.role)) return "Nothing was asked.";
    if (typeof message.content !== "string" || message.content.length > MAX_CONTENT) {
      return "That is too long to ask.";
    }
  }
  if (!schema || typeof schema !== "object" || JSON.stringify(schema).length > MAX_SCHEMA) {
    return "Nothing was asked.";
  }
  return null;
}

/**
 * Ask the model to read a sentence, and hand back what it wrote.
 *
 * **`format` is the JSON schema, so the reply is constrained to its shape** —
 * Ollama turns the schema into a grammar and the model cannot produce anything
 * else. That is what makes a small model usable here at all: it is choosing
 * values, not composing JSON. Temperature zero, because the same sentence
 * should be read the same way twice.
 *
 * Returns `{ ok: true, content }` with the parsed object, or `{ ok: false,
 * reason, error }`. The content is *not* trusted here or anywhere — the page
 * resolves every name in it against its own lists.
 */
async function ask(input, { port } = {}) {
  const refused = checkAsk(input);
  if (refused) return { ok: false, reason: "refused", error: refused };

  const res = await request({
    method: "POST",
    path: "/api/chat",
    port,
    timeout: ASK_TIMEOUT_MS,
    body: {
      model: input.model,
      messages: input.messages.map(({ role, content }) => ({ role, content })),
      format: input.schema,
      stream: false,
      options: { temperature: 0 },
    },
  });

  if (!res.ok) {
    if (res.reason) return { ok: false, reason: res.reason };
    // Ollama's own words, where it gave some — "model 'x' not found" is the
    // common one and is exactly what the person needs to read.
    const error = typeof res.json?.error === "string" ? res.json.error : null;
    return { ok: false, reason: "bad-response", error };
  }

  const text = res.json?.message?.content;
  if (typeof text !== "string") return { ok: false, reason: "bad-response" };
  try {
    return { ok: true, content: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "bad-response" };
  }
}

module.exports = { status, ask, DEFAULT_PORT };
