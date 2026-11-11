export function isGameplayTypingTarget(target) {
  if (!target || typeof target.matches !== "function") return false;
  const acceptsText = target.matches("input, textarea, select") || target.isContentEditable;
  return Boolean(acceptsText && !target.closest?.(".hidden"));
}

export function applyKeyboardLook(pose, keys, dt) {
  const turn = 1.75 * dt;
  pose.yaw += ((keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0)) * turn;
  pose.pitch = Math.max(-1.45, Math.min(1.45,
    pose.pitch + ((keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0)) * turn * .8));
}
