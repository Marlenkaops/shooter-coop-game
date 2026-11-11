import { AI_DIFFICULTIES, DEFAULT_DIFFICULTY } from "../shared/enemy-ai.js";

export function createEnemyDirector(now) {
  return { phase: "buildup", phaseAt: now, until: now + 9000, health: null };
}

export function updateEnemyDirector(room, players, now) {
  const tuning = AI_DIFFICULTIES[room.difficulty || DEFAULT_DIFFICULTY];
  const director = room.director ||= createEnemyDirector(now);
  const health = players.reduce((sum, player) => sum + player.health, 0);
  const heavyLoss = director.health !== null && director.health - health >= 35;
  director.health = health;
  if (now >= director.until || director.phase === "peak" && now - director.phaseAt >= 3000 &&
    (heavyLoss || players.length > 0 && health / players.length < 35)) {
    director.phase = director.phase === "buildup" ? "peak" : director.phase === "peak" ? "recovery" : "buildup";
    director.phaseAt = now;
    director.until = now + (director.phase === "buildup" ? 9000 : director.phase === "peak" ? 14000 : tuning.recoveryMs);
  }
  const perPlayer = director.phase === "recovery" ? 0 :
    director.phase === "peak" ? tuning.peakAttackers : tuning.buildAttackers;
  return { phase: director.phase, attackLimit: perPlayer * Math.max(1, players.length),
    perTargetLimit: director.phase === "peak" ? tuning.peakAttackers : tuning.buildAttackers };
}

export function canStartEnemyAttack(enemy, enemies, targetId, budget) {
  if (!enemy.role) return true;
  const active = enemies.filter((ally) => ally.attackWindup);
  return active.length < budget.attackLimit &&
    active.filter((ally) => ally.attackWindup.targetId === targetId).length < budget.perTargetLimit;
}
