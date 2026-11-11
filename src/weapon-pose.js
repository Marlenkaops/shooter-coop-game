const mix = (a, b, t) => a + (b - a) * t;

export function weaponViewPose(layout, pose, {
  aspect = 16 / 9, ads = 0, moving = false, bob = 0, bobTime = 0,
  swayX = 0, swayY = 0, recoil = 0, lowered = 0, reloading = false, progress = 0, weight = 1
} = {}) {
  const handling = reloading ? Math.sin(Math.PI * progress) : 0;
  return {
    position: {
      x: mix(Math.min(.18, aspect * .12) - pose.tilt * .22 +
        (moving ? Math.cos(bobTime * .5) * .008 : 0) + swayX * .5 * weight, -layout.optic.x + swayX * .08, ads),
      y: mix(-.18 + bob * .35 - lowered * .08 + pose.tilt * .32 +
        handling * .13 + swayY * .5 * weight, -layout.optic.y + bob * .03, ads),
      z: mix((layout.sidearm ? -.43 : -.34) + recoil * .025 + lowered * .03 - pose.tilt * .1 -
        handling * .05, -.23 + recoil * .02, ads)
    },
    rotation: {
      x: -recoil * (.22 - ads * .07) + pose.tilt,
      y: mix(.15 - swayX * .8, -swayX * .08, ads),
      z: lowered * -.16 + pose.roll
    }
  };
}
