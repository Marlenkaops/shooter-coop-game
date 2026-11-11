export function needsDetailedEnemy(distanceSquared, alreadyDetailed, lowQuality) {
  const enterDistance = lowQuality ? 15 : 24;
  const exitDistance = lowQuality ? 22 : 34;
  const threshold = alreadyDetailed ? exitDistance : enterDistance;
  return distanceSquared < threshold * threshold;
}
