import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/page.css";
import { mountChrome } from "../lib/layout";
import { el } from "../lib/util";

mountChrome("");

// Demo, client-side only account. Clearly labeled — no server, no real credentials.
// Stores a display name locally so saved views/bookmarks can attach to it later.
const KEY = "metabolian-account";
const root = document.getElementById("auth-root")!;

interface Account { name: string; email: string; since: string; }

function current(): Account | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}

function render() {
  const acct = current();
  root.replaceChildren(acct ? signedIn(acct) : signIn());
}

function signedIn(acct: Account): HTMLElement {
  return el("div.auth-card.stack", {}, [
    el("p.eyebrow", {}, ["Signed in"]),
    el("h1", { style: "font-size:var(--step-2)" }, [`Welcome, ${acct.name}`]),
    el("p.muted", {}, [`${acct.email} · member since ${acct.since}`]),
    el("p.muted", { style: "font-size:var(--step--1)" }, ["Your saved pathways and bookmarks live in this browser. This is a local demo account — no data leaves your device."]),
    el("a.btn", { href: "explore.html" }, ["Go to the chart →"]),
    el("button.btn.btn--ghost", { type: "button", onclick: () => { localStorage.removeItem(KEY); render(); } }, ["Sign out"]),
  ]);
}

function signIn(): HTMLElement {
  const form = el("form.auth-card", {}, [
    el("p.eyebrow", {}, ["Account"]),
    el("h1", { style: "font-size:var(--step-2);margin-block:.3rem .8rem" }, ["Sign in to Metabolian"]),
    field("name", "Display name", "text", "Ada Lovelace"),
    field("email", "Email", "email", "you@example.com"),
    el("button.btn", { type: "submit", style: "width:100%;margin-top:.5rem" }, ["Continue"]),
    el("p.muted", { style: "font-size:var(--step--1);margin-top:1rem" }, [
      "Demo account — stored locally in your browser so you can save views and bookmarks. No password, no server, nothing transmitted. Real authentication is a documented next step.",
    ]),
  ]) as HTMLFormElement;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (form.querySelector("#name") as HTMLInputElement).value.trim() || "Guest";
    const email = (form.querySelector("#email") as HTMLInputElement).value.trim() || "guest@local";
    const acct: Account = { name, email, since: new Date().toISOString().slice(0, 10) };
    localStorage.setItem(KEY, JSON.stringify(acct));
    render();
  });
  return form;
}

function field(id: string, label: string, type: string, placeholder: string): HTMLElement {
  return el("div.field", {}, [
    el("label", { for: id }, [label]),
    el("input", { id, name: id, type, placeholder, ...(id === "email" ? { required: "true" } : {}) }),
  ]);
}

render();
