export function createMovementPackets() {
  let previous = null, sentAt = -Infinity, moving = false;
  return {
    next(now, position, yaw, pitch, crouching) {
      if (now - sentAt <= 45) return null;
      const positionChanged = !previous ||
        ["x", "y", "z"].some((axis) => Math.abs(previous.position[axis] - position[axis]) >= .0001);
      if (previous && now - sentAt < 250 && previous.yaw === yaw && previous.pitch === pitch &&
        previous.crouching === crouching && !positionChanged && !moving) return null;
      sentAt = now;
      moving = Boolean(previous && positionChanged);
      previous = { position: { x: position.x, y: position.y, z: position.z }, yaw, pitch, crouching };
      return previous;
    },
    reset() {
      previous = null;
      sentAt = -Infinity;
      moving = false;
    }
  };
}
