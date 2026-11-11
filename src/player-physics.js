import * as CANNON from "cannon-es";
import { canTraverse, FLIGHT_CEILING, PLAYER_RADIUS, playerStance } from "../shared/gameplay.js";
import { movementVelocity } from "../shared/movement.js";

export const PLAYER_PHYSICS_STEP = 1 / 60;
const capsules = new WeakMap();

export function setPlayerCrouching(body, crouching) {
  const previous = capsules.get(body);
  if (previous?.crouching === crouching) return;
  const stance = playerStance(crouching);
  const cylinderHeight = stance.height - PLAYER_RADIUS * 2;
  for (const shape of [...body.shapes]) body.removeShape(shape);
  body.addShape(new CANNON.Cylinder(PLAYER_RADIUS, PLAYER_RADIUS, cylinderHeight, 12));
  body.addShape(new CANNON.Sphere(PLAYER_RADIUS), new CANNON.Vec3(0, cylinderHeight / 2, 0));
  body.addShape(new CANNON.Sphere(PLAYER_RADIUS), new CANNON.Vec3(0, -cylinderHeight / 2, 0));
  if (previous) body.position.y += (stance.height - playerStance(previous.crouching).height) / 2;
  body.updateMassProperties();
  body.updateBoundingRadius();
  body.aabbNeedsUpdate = true;
  body.wakeUp();
  capsules.set(body, { crouching });
}

export function stepPlayerPhysics(world, body, previousPosition, direction, dt, accumulator, options = {}) {
  if (![dt, accumulator].every(Number.isFinite) || dt < 0 || accumulator < 0) {
    throw new RangeError("Invalid physics time.");
  }
  accumulator = Math.min(.1, accumulator + dt);
  if (options.flying || (options.enabled !== false && (direction.x || direction.z))) body.wakeUp();
  while (accumulator + 1e-10 >= PLAYER_PHYSICS_STEP) {
    previousPosition.copy(body.position);
    const velocity = movementVelocity(body.velocity, direction, PLAYER_PHYSICS_STEP, options);
    body.velocity.x = velocity.x;
    body.velocity.z = velocity.z;
    world.step(PLAYER_PHYSICS_STEP);
    if (options.geometry) constrainGeometryStep(body, previousPosition, options);
    if (options.flying) body.position.y = Math.min(FLIGHT_CEILING - playerStance(false).eyeOffset, body.position.y);
    accumulator = Math.max(0, accumulator - PLAYER_PHYSICS_STEP);
  }
  return accumulator;
}

function constrainGeometryStep(body, previous, { geometry, crouching = false }) {
  const offset = playerStance(crouching).eyeOffset;
  const from = { x: previous.x, y: previous.y + offset, z: previous.z };
  const to = { x: body.position.x, y: body.position.y + offset, z: body.position.z };
  if (canTraverse(geometry, from, to, undefined, crouching)) return;
  const slides = [{ ...to, z: from.z }, { ...to, x: from.x }]
    .filter((point) => canTraverse(geometry, from, point, undefined, crouching))
    .sort((a, b) => Math.hypot(b.x - from.x, b.z - from.z) - Math.hypot(a.x - from.x, a.z - from.z));
  let resolved = slides[0];
  if (!resolved) {
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 12; iteration++) {
      const t = (low + high) / 2;
      const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
      if (canTraverse(geometry, from, point, undefined, crouching)) low = t;
      else high = t;
    }
    resolved = { x: from.x + (to.x - from.x) * low, y: from.y + (to.y - from.y) * low, z: from.z + (to.z - from.z) * low };
  }
  // Cannon allows contact penetration; prediction must obey the server's exact swept bounds.
  body.position.set(resolved.x, resolved.y - offset, resolved.z);
  for (const axis of ["x", "y", "z"]) if (Math.abs(resolved[axis] - to[axis]) > .0001) body.velocity[axis] = 0;
  body.aabbNeedsUpdate = true;
}

export function createPlayerBody(world, position, worldMaterial) {
  const material = new CANNON.Material("player");
  world.addContactMaterial(new CANNON.ContactMaterial(material, worldMaterial, {
    // The movement controller owns braking; contact friction must not cancel its velocity.
    friction: 0, restitution: 0,
    contactEquationStiffness: 1e8, contactEquationRelaxation: 4,
    frictionEquationStiffness: 1e7, frictionEquationRelaxation: 4
  }));
  const body = new CANNON.Body({
    mass: 72,
    position: new CANNON.Vec3(position.x, position.y - .7, position.z),
    fixedRotation: true, linearDamping: .02,
    collisionFilterGroup: 2, collisionFilterMask: 1, material
  });
  body.allowSleep = true;
  setPlayerCrouching(body, false);
  world.addBody(body);
  return body;
}
