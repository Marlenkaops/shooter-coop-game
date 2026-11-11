export function joystickVector(dx, dy, radius, deadZone = .12) {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError("Joystick radius must be positive.");
  const distance = Math.hypot(dx, dy);
  const magnitude = Math.min(1, distance / radius);
  if (magnitude <= deadZone) return { strafe: 0, forward: 0 };
  const strength = (magnitude - deadZone) / (1 - deadZone);
  return { strafe: dx / distance * strength, forward: -dy / distance * strength };
}

export function triggerCanFire(weapon, held, previouslyHeld) {
  return Boolean(held && (weapon.fireMode !== "semi" || !previouslyHeld));
}

export class TouchInput {
  constructor() {
    this.pointers = new Map();
    this.state = { strafe: 0, forward: 0, firing: false, aiming: false, sprinting: false, crouching: false, ascending: false, descending: false, interacting: false };
  }

  begin(id, action, point) {
    if (this.pointers.has(id) ||
      (action === "move" && [...this.pointers.values()].some((pointer) => pointer.action === "move"))) return false;
    this.pointers.set(id, { action, ...point });
    if (action === "fire") this.state.firing = true;
    if (action === "aim") this.state.aiming = !this.state.aiming;
    if (action === "sprint") this.state.sprinting = !this.state.sprinting;
    if (action === "crouch") this.state.crouching = !this.state.crouching;
    if (action === "jump") this.state.ascending = true;
    if (action === "descend") this.state.descending = true;
    if (action === "interact") this.state.interacting = true;
    return true;
  }

  move(id, x, y) {
    const pointer = this.pointers.get(id);
    if (!pointer) return null;
    if (pointer.action === "move") {
      Object.assign(this.state, joystickVector(x - pointer.centerX, y - pointer.centerY, pointer.radius));
    }
    const look = pointer.action === "look" || pointer.action === "fire"
      ? { x: x - pointer.x, y: y - pointer.y } : null;
    pointer.x = x;
    pointer.y = y;
    return look;
  }

  end(id) {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    this.pointers.delete(id);
    if (pointer.action === "move") this.state.strafe = this.state.forward = 0;
    if (pointer.action === "fire") {
      this.state.firing = [...this.pointers.values()].some((active) => active.action === "fire");
    }
    if (pointer.action === "jump") this.state.ascending = [...this.pointers.values()].some((active) => active.action === "jump");
    if (pointer.action === "descend") this.state.descending = [...this.pointers.values()].some((active) => active.action === "descend");
    if (pointer.action === "interact") this.state.interacting = [...this.pointers.values()].some((active) => active.action === "interact");
  }

  reset() {
    this.pointers.clear();
    Object.assign(this.state, { strafe: 0, forward: 0, firing: false, aiming: false, sprinting: false, crouching: false, ascending: false, descending: false, interacting: false });
  }
}

export function createTouchControls(root, { enabled, onLook, onAction, onInteract }) {
  const input = new TouchInput();
  const captured = new Map();
  const stick = root.querySelector("[data-touch='move']");
  const nub = stick.querySelector("i");
  let active = false;

  const paint = () => {
    const radius = Math.max(1, stick.getBoundingClientRect().width / 2 - 22);
    nub.style.transform = `translate(${input.state.strafe * radius}px, ${-input.state.forward * radius}px)`;
    for (const action of ["fire", "aim", "sprint", "crouch", "interact"]) {
      const held = input.state[{ fire: "firing", aim: "aiming", sprint: "sprinting", crouch: "crouching", interact: "interacting" }[action]];
      const button = root.querySelector(`[data-touch='${action}']`);
      if (!button) continue;
      button.classList.toggle("pressed", held);
      button.setAttribute("aria-pressed", String(held));
    }
  };
  const reset = () => {
    input.reset();
    for (const [id, node] of captured) {
      if (node.hasPointerCapture(id)) node.releasePointerCapture(id);
    }
    captured.clear();
    paint();
  };
  const finish = (event) => {
    input.end(event.pointerId);
    captured.delete(event.pointerId);
    paint();
  };
  for (const node of root.querySelectorAll("[data-touch]")) {
    const action = node.dataset.touch;
    node.addEventListener("pointerdown", (event) => {
      if (!enabled || !active || node.disabled || event.pointerType === "mouse") return;
      event.preventDefault();
      const bounds = stick.getBoundingClientRect();
      if (!input.begin(event.pointerId, action, {
        x: event.clientX, y: event.clientY,
        centerX: bounds.left + bounds.width / 2, centerY: bounds.top + bounds.height / 2,
        radius: Math.max(1, bounds.width / 2 - 22)
      })) return;
      node.setPointerCapture(event.pointerId);
      captured.set(event.pointerId, node);
      onInteract();
      if (action === "move") input.move(event.pointerId, event.clientX, event.clientY);
      if (["jump", "reload", "supply", "heal", "ability", "pingEnemy", "pingAmmo", "pingRoute"].includes(action)) onAction(action);
      paint();
    });
    node.addEventListener("pointermove", (event) => {
      if (!captured.has(event.pointerId)) return;
      event.preventDefault();
      const look = input.move(event.pointerId, event.clientX, event.clientY);
      if (look) onLook(look.x, look.y);
      paint();
    });
    node.addEventListener("pointerup", finish);
    node.addEventListener("pointercancel", finish);
    node.addEventListener("lostpointercapture", finish);
    node.addEventListener("click", (event) => {
      if (event.detail !== 0 || !enabled || !active || node.disabled) return;
      if (["aim", "sprint", "crouch", "interact"].includes(action)) {
        const key = { aim: "aiming", sprint: "sprinting", crouch: "crouching", interact: "interacting" }[action];
        input.state[key] = !input.state[key];
        paint();
      } else if (["jump", "reload", "supply", "heal", "ability", "pingEnemy", "pingAmmo", "pingRoute"].includes(action)) {
        onInteract();
        onAction(action);
      }
    });
  }
  return {
    state: input.state,
    get enabled() { return enabled; },
    reset,
    setEnabled(next) {
      enabled = Boolean(next);
      document.body.classList.toggle("touch-mode", enabled);
      root.classList.toggle("hidden", !enabled || !active);
      reset();
    },
    setActive(next) {
      const changed = active !== Boolean(next);
      active = Boolean(next);
      root.classList.toggle("hidden", !enabled || !active);
      if (changed || !active) reset();
    }
  };
}
