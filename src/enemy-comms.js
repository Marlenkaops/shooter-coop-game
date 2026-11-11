import { ENEMY_CALLOUTS, ENEMY_ROLES } from "../shared/enemy-ai.js";

export function audibleEnemyCallout(callouts, position, now) {
  for (let index = callouts.length - 1; index >= 0; index--) {
    const callout = callouts[index];
    if (!Object.hasOwn(ENEMY_CALLOUTS, callout.kind) || !Object.hasOwn(ENEMY_ROLES, callout.role) ||
      callout.at > now || callout.expiresAt <= now ||
      Math.hypot(callout.position.x - position.x, callout.position.y - position.y, callout.position.z - position.z) > 26) continue;
    return { id: callout.id, speaker: ENEMY_ROLES[callout.role].name, text: ENEMY_CALLOUTS[callout.kind] };
  }
  return null;
}
