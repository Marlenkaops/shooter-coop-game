export function enemyFacingYaw(dx, dz, animated) {
  return Math.atan2(dx, dz) + (animated ? Math.PI : 0);
}
