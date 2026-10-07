import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { routerFuture } from "../routerFuture";
import AppShell from "./AppShell";

function renderShell() {
  return render(
    <MemoryRouter future={routerFuture}>
      <AppShell>
        <p>page</p>
      </AppShell>
    </MemoryRouter>
  );
}

function setSystemDark(matches) {
  window.matchMedia = (query) => ({
    matches: query === "(prefers-color-scheme: dark)" && matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  delete window.matchMedia;
});

afterEach(() => {
  delete window.matchMedia;
});

test("starts light when nothing is stored and the system has no preference", () => {
  renderShell();
  expect(screen.getByRole("button", { name: "Dark mode" })).toHaveAttribute("aria-pressed", "false");
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
});

test("follows a dark system preference until a mode is picked", () => {
  setSystemDark(true);
  renderShell();
  expect(screen.getByRole("button", { name: "Dark mode" })).toHaveAttribute("aria-pressed", "true");
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  // Following the system writes nothing, so a later system change still lands.
  expect(JSON.parse(localStorage.getItem("theme"))).toBeNull();
});

test("the switch flips the mode, pins it, and survives a remount", () => {
  const { unmount } = renderShell();
  fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));

  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(screen.getByRole("button", { name: "Dark mode" })).toHaveAttribute("aria-pressed", "true");
  expect(JSON.parse(localStorage.getItem("theme"))).toBe("dark");

  unmount();
  renderShell();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");

  fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(JSON.parse(localStorage.getItem("theme"))).toBe("light");
});

test("a picked mode wins over the system preference", () => {
  localStorage.setItem("theme", JSON.stringify("light"));
  setSystemDark(true);
  renderShell();
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
});

test("an unreadable stored mode falls back to the system", () => {
  localStorage.setItem("theme", JSON.stringify("sepia"));
  setSystemDark(true);
  renderShell();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});

test("adding a transaction and a transfer are a click away from every page", () => {
  renderShell();
  // Closed, nothing is mounted: the header renders above suites with no stores.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add transaction" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Transfer" })).toBeInTheDocument();
});
