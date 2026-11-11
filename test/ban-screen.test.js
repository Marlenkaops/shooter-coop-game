import test from "node:test";
import assert from "node:assert/strict";
import { banRemaining, banTitle, showBanScreen } from "../src/ban-screen.js";
import { describeBanLength, parseBanDuration } from "../shared/bans.js";
import { executeAdminCommand } from "../server/admin-commands.js";

test("ban lengths parse and describe like the ban screen title", () => {
  assert.equal(parseBanDuration("perm"), null);
  assert.equal(parseBanDuration("30m"), 1_800_000);
  assert.equal(parseBanDuration("1D"), 86_400_000);
  for (const invalid of ["", "0d", "1y", "400d", "cheating", undefined]) assert.equal(parseBanDuration(invalid), undefined);
  assert.equal(describeBanLength(86_400_000), "for 1 Day");
  assert.equal(describeBanLength(2 * 604_800_000), "for 2 Weeks");
  assert.equal(describeBanLength(null), "Permanently");
  assert.equal(banTitle({ kind: "player", at: 0, until: 86_400_000 }), "Banned for 1 Day");
  assert.equal(banTitle({ kind: "ip", at: 0, until: null }), "IP Banned Permanently");
  assert.equal(banRemaining(3_725_000, 0), "1h 2m 5s");
  assert.equal(banRemaining(0, 5), "0m 0s");
});

test("?ban and ?ipban accept an optional length before the reason", () => {
  const calls = [];
  const operations = { owner: false, resolve: () => ({ ok: true, profile: { id: "p" } }),
    ban: (profile, reason, options) => { calls.push([reason, options]); return { ok: true }; } };
  executeAdminCommand("?ban p 7d Aimbot in Raid", operations);
  executeAdminCommand("?ban p Teaming with enemies", operations);
  executeAdminCommand("?ipban p perm", operations);
  assert.deepEqual(calls, [
    ["Aimbot in Raid", { kind: "player", duration: "7d" }],
    ["Teaming with enemies", { kind: "player", duration: "perm" }],
    ["Banned by an administrator.", { kind: "ip", duration: "perm" }]
  ]);
});

function screenFixture(t, submitAppeal) {
  class Element {
    children = [];
    value = "";
    className = "";
    classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, force) => {
        const classes = new Set(this.className.split(" "));
        if (force) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      },
      remove: (name) => this.classList.toggle(name, false)
    };
    constructor(tag) { this.tagName = tag.toUpperCase(); }
    setAttribute(name, value) { this[name] = String(value); }
    append(...children) { this.children.push(...children); }
    querySelector(selector) { return this.children.flatMap((child) => [child, ...child.descendants()]).find((child) => `#${child.id}` === selector); }
    descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
    focus() { this.focused = true; }
  }
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: (tag) => new Element(tag) };
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "document", saved); else delete globalThis.document;
  });
  const root = new Element("div");
  const screen = showBanScreen({ kind: "player", at: 1000, until: null, reason: "<script>not HTML</script>" }, { root, submitAppeal });
  const form = root.querySelector("#banAppealForm");
  const reason = root.querySelector("#banAppealReason");
  const status = root.querySelector("#banAppealStatus");
  const send = form.children.find((child) => child.type === "submit");
  const contact = screen.element.descendants().find((child) => child.textContent === "Contact / Appeal ban");
  return { root, screen, form, reason, status, send, contact };
}

test("the Contact button opens a private appeal form, prevents double submits and confirms receipt", async (t) => {
  let resolve, calls = 0;
  const { form, reason, status, send, contact } = screenFixture(t, () => {
    calls++;
    return new Promise((finish) => { resolve = finish; });
  });
  assert.equal(form.classList.contains("hidden"), true);
  contact.onclick();
  assert.equal(form.classList.contains("hidden"), false);
  assert.equal(contact["aria-expanded"], "true");
  assert.equal(reason.focused, true);
  assert.equal(reason.maxLength, 1000);
  reason.value = "short";
  await form.onsubmit({ preventDefault() {} });
  assert.equal(calls, 0);
  assert.match(status.textContent, /10-1000/);
  reason.value = "I believe the administrator banned the wrong player.";
  const pending = form.onsubmit({ preventDefault() {} });
  assert.equal(send.disabled, true);
  await form.onsubmit({ preventDefault() {} });
  assert.equal(calls, 1);
  resolve({ ok: true, status: "open" });
  await pending;
  assert.equal(reason.disabled, true);
  assert.match(status.textContent, /Appeal sent/);
  assert.equal(send.disabled, true);
  assert.equal(form.children.find((child) => child.textContent === "Check ban status").classList.contains("hidden"), false);
});

test("appeal save errors retain the explanation and allow retry without a fake success", async (t) => {
  let calls = 0;
  const { form, reason, status, send } = screenFixture(t, async () => {
    if (++calls === 1) throw new Error("Your appeal could not be saved.");
    return { ok: true, status: "rejected", alreadySubmitted: true };
  });
  reason.value = "Please review the reason for this ban.";
  await form.onsubmit({ preventDefault() {} });
  assert.match(status.textContent, /could not be saved/);
  assert.equal(send.disabled, false);
  assert.equal(reason.value, "Please review the reason for this ban.");
  await form.onsubmit({ preventDefault() {} });
  assert.match(status.textContent, /declined/);
  assert.equal(send.textContent, "Appeal already received");
});
