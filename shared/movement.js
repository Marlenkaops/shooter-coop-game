import { PLAYER_CROUCH_SPEED, PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "./gameplay.js";
import { DOWNED_SPEED } from "./teamwork.js";

export function movementSpeed({ sprinting = false, crouching = false, downed = false, forward = 1, strafe = 0 } = {}) {
  if (![forward, strafe].every(Number.isFinite)) throw new RangeError("Invalid movement input.");
  const speed = downed ? DOWNED_SPEED : crouching ? PLAYER_CROUCH_SPEED : sprinting && forward > .001 ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
  const length = Math.hypot(forward, strafe);
  return speed * (length > .001 ? Math.hypot(forward * (forward < 0 ? .8 : 1), strafe * .85) / length : 1);
}

export function movementVelocity(velocity, direction, dt, {
  grounded = true, sprinting = false, crouching = false, downed = false, enabled = true, forward = 1, strafe = 0
} = {}) {
  if (![velocity.x, velocity.z, direction.x, direction.z, dt].every(Number.isFinite) || dt < 0) {
    throw new RangeError("Invalid movement step.");
  }
  const step = Math.min(.1, dt);
  const magnitude = Math.max(1, Math.hypot(direction.x, direction.z));
  const speed = movementSpeed({ sprinting, crouching, downed, forward, strafe });
  const moving = enabled && Math.hypot(direction.x, direction.z) > .001;
  const desiredX = moving ? direction.x / magnitude * speed : grounded || !enabled ? 0 : velocity.x * Math.exp(-.8 * step);
  const desiredZ = moving ? direction.z / magnitude * speed : grounded || !enabled ? 0 : velocity.z * Math.exp(-.8 * step);
  const reversing = velocity.x * desiredX + velocity.z * desiredZ < 0;
  const acceleration = !enabled || grounded || crouching ? !moving ? 36 : reversing ? 34 : 24 : 7.5;
  const dx = desiredX - velocity.x, dz = desiredZ - velocity.z;
  const fraction = Math.min(1, acceleration * step / (Math.hypot(dx, dz) || 1));
  return { x: velocity.x + dx * fraction, z: velocity.z + dz * fraction };
}
