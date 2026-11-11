import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BINDINGS, actionHeld, keyLabel, normalizeBindings, rebindAction,
  shouldOfferTutorial, tutorialProgress, tutorialStep, validBinding } from "../src/ui-preferences.js";

test("key rebinding swaps conflicts and preserves every action across persistence", () => {
  const changed = rebindAction(DEFAULT_BINDINGS, "reload", "KeyW");
  assert.equal(changed.reload, "KeyW");
  assert.equal(changed.forward, "KeyR");
  assert.deepEqual(normalizeBindings(JSON.parse(JSON.stringify(changed))), changed);
  assert.deepEqual(normalizeBindings({}), DEFAULT_BINDINGS);
  assert.equal(DEFAULT_BINDINGS.reload, "KeyR");
});

test("bindings reject reserved, malformed, duplicate and unknown actions", () => {
  for (const code of ["Escape", "Enter", "Tab", "ArrowUp", "<script>", null]) assert.equal(validBinding(code), false);
  for (const value of [null, [], { reload: "Escape" }, { reload: "KeyW" }, { unknown: "KeyK" }]) {
    assert.throws(() => normalizeBindings(value), TypeError);
  }
  assert.throws(() => rebindAction(DEFAULT_BINDINGS, "unknown", "KeyK"), TypeError);
});

test("all gameplay actions follow their bindings and legacy aliases only apply to defaults", () => {
  for (const [action, code] of Object.entries(DEFAULT_BINDINGS)) {
    assert.equal(actionHeld({ [code]: true }, DEFAULT_BINDINGS, action), true);
    assert.equal(actionHeld({}, DEFAULT_BINDINGS, action), false);
  }
  assert.equal(actionHeld({ ControlRight: true }, DEFAULT_BINDINGS, "fire"), true);
  const changed = rebindAction(DEFAULT_BINDINGS, "fire", "KeyK");
  assert.equal(actionHeld({ ControlRight: true }, changed, "fire"), false);
  assert.equal(actionHeld({ KeyK: true }, changed, "fire"), true);
  assert.equal(keyLabel("KeyR"), "R");
  assert.equal(keyLabel("ShiftLeft"), "Shift L");
});

test("training requires real movement, accepted fire, reload and a confirmed kill, in any order", () => {
  let progress = {};
  assert.equal(tutorialStep(progress), "move");
  progress = tutorialProgress(progress, "kill");
  assert.equal(tutorialStep(progress), "move");
  for (const action of ["move", "fire", "reload"]) progress = tutorialProgress(progress, action);
  assert.equal(tutorialStep(progress), "complete");
  assert.equal(tutorialStep({ move: true, fire: true }), "reload");
  assert.throws(() => tutorialProgress(progress, "revive"), TypeError);
});

test("first-time operators are offered training before they have played or earned progress", () => {
  assert.equal(shouldOfferTutorial({ xp: 0, matches: 0 }), true);
  for (const profile of [null, undefined, {}, { xp: 20, matches: 0 }, { xp: 0, matches: 1 }]) {
    assert.equal(shouldOfferTutorial(profile), false);
  }
});

test("starting, skipping or previously completing training suppresses repeat invitations", () => {
  const profile = { xp: 0, matches: 0 };
  for (const choice of ["started", "skipped"]) assert.equal(shouldOfferTutorial(profile, choice), false);
  assert.equal(shouldOfferTutorial(profile, null, "true"), false);
  assert.equal(shouldOfferTutorial(profile, null, null), true);
});
