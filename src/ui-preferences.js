export const DEFAULT_BINDINGS = Object.freeze({
  forward: "KeyW", backward: "KeyS", left: "KeyA", right: "KeyD",
  fire: "KeyF", aim: "KeyQ", sprint: "ShiftLeft", crouch: "KeyC",
  jump: "Space", reload: "KeyR", interact: "KeyE", heal: "KeyH", mute: "KeyM",
  ability: "KeyV", pingEnemy: "KeyG", pingAmmo: "KeyZ", pingRoute: "KeyX"
});

export const ACTION_LABELS = Object.freeze({
  forward: "Move forward", backward: "Move backward", left: "Strafe left", right: "Strafe right",
  fire: "Fire", aim: "Focus / ADS", sprint: "Sprint", crouch: "Crouch / flight descend",
  jump: "Jump / flight ascend", reload: "Reload", interact: "Hold revive / hack; interact / ammo", heal: "Use medkit", mute: "Toggle sound",
  ability: "Class ability", pingEnemy: "Mark aimed enemy", pingAmmo: "Mark ammo", pingRoute: "Mark route"
});

export function validBinding(code) {
  return typeof code === "string" && /^(Key[A-Z]|Digit[0-9]|Space|ShiftLeft|ShiftRight|AltLeft|AltRight|ControlLeft|ControlRight)$/.test(code);
}

export function normalizeBindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid key bindings.");
  const bindings = { ...DEFAULT_BINDINGS, ...value };
  for (const action of ["ability", "pingEnemy", "pingAmmo", "pingRoute"]) if (!Object.hasOwn(value, action)) {
    if (Object.entries(bindings).some(([key, code]) => key !== action && code === bindings[action])) {
      bindings[action] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `Key${letter}`)
        .find((candidate) => !Object.values(bindings).includes(candidate));
    }
  }
  if (Object.keys(value).some((key) => !Object.hasOwn(DEFAULT_BINDINGS, key)) ||
    Object.values(bindings).some((code) => !validBinding(code)) ||
    new Set(Object.values(bindings)).size !== Object.keys(bindings).length) {
    throw new TypeError("Bindings must use unique supported keys.");
  }
  return bindings;
}

export function rebindAction(bindings, action, code) {
  if (!Object.hasOwn(DEFAULT_BINDINGS, action) || !validBinding(code)) {
    throw new TypeError("Use a letter, number, Space or modifier key. Escape cancels.");
  }
  const previous = bindings[action];
  const next = { ...bindings, [action]: code };
  const conflict = Object.keys(bindings).find((key) => key !== action && bindings[key] === code);
  if (conflict) next[conflict] = previous;
  return normalizeBindings(next);
}

export function actionHeld(keys, bindings, action) {
  const primary = bindings[action];
  if (keys[primary]) return true;
  if (action === "sprint" && primary === "ShiftLeft") return Boolean(keys.ShiftRight);
  if (action === "fire" && primary === "KeyF") return Boolean(keys.ControlLeft || keys.ControlRight);
  return false;
}

export function keyLabel(code) {
  return code.replace(/^Key|^Digit/, "").replace(/Left$/, " L").replace(/Right$/, " R");
}

export function tutorialProgress(progress, action) {
  if (!["move", "fire", "reload", "kill"].includes(action)) throw new TypeError("Unknown training action.");
  return { ...progress, [action]: true };
}

export function tutorialStep(progress) {
  return ["move", "fire", "reload", "kill"].find((action) => !progress[action]) || "complete";
}

export function shouldOfferTutorial(profile, choice = null, completed = null) {
  return profile?.xp === 0 && profile.matches === 0 && choice === null && completed !== "true";
}
