import { hasLineOfSight } from "../shared/gameplay.js";
import { REVIVE_REACH } from "../shared/teamwork.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const visible = (state, from, to) => hasLineOfSight(state.mapId, from, { ...to, y: to.y + .2 });

export function teamInteractionTarget(state, myId, position) {
  const me = state?.players.find((player) => player.socketId === myId);
  if (!me || me.deadUntil || me.downedUntil || !["playing", "between"].includes(state.phase)) return null;
  const victim = state.players.find((player) => player.socketId !== myId && player.connected &&
    player.downedUntil > state.serverNow && distance(position, player.position) <= REVIVE_REACH &&
    visible(state, position, player.position));
  if (victim) return { id: victim.socketId, label: `REVIVE ${victim.name}`, progressMs: victim.reviveProgressMs };
  const terminal = state.teamObjective?.terminals.find((item) => distance(position, item.position) <= 2.5 &&
    visible(state, position, item.position));
  return terminal ? { id: terminal.id, label: "HACK TERMINAL", progressMs: state.teamObjective.progressMs } : null;
}

export function teamPingPayload(kind, state, position, yaw, pitch) {
  if (kind === "route") return { kind, position: {
    x: position.x - Math.sin(yaw) * 10, y: position.y, z: position.z - Math.cos(yaw) * 10
  } };
  const candidates = kind === "enemy" ? state.enemies : [...state.supplies, ...state.loot.filter((item) => item.kind === "ammo")];
  const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  const target = candidates.filter((item) => distance(position, item.position) <= 26 &&
    (kind !== "enemy" || item.health > 0) && visible(state, position, item.position))
    .map((item) => {
      const length = Math.max(.01, distance(position, item.position));
      const alignment = ((item.position.x - position.x) * direction.x +
        (item.position.y - position.y) * direction.y + (item.position.z - position.z) * direction.z) / length;
      return { item, alignment };
    }).filter((item) => kind !== "enemy" || item.alignment > .92)
    .sort((a, b) => b.alignment - a.alignment)[0]?.item;
  return target ? { kind, targetId: target.id } : null;
}

export function markerPlacement(projected, width, height) {
  if (![projected.x, projected.y, projected.z, width, height].every(Number.isFinite)) return null;
  const behind = projected.z > 1;
  return {
    x: Math.max(75, Math.min(width - 75, (projected.x * (behind ? -1 : 1) + 1) * width / 2)),
    y: behind ? height - 150 : Math.max(145, Math.min(height - 150, (1 - projected.y) * height / 2)),
    behind
  };
}
