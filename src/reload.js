import { weaponFeedback } from "./weapon-feedback.js";

const grip = { x: .14, y: -.37, z: -.67 };
const grasp = { x: -.11, y: -.38, z: -.4 };
const lowered = { x: -.16, y: -.68, z: -.3 };
const seating = { x: -.09, y: -.29, z: -.4 };
const charging = { x: -.16, y: .12, z: -.3 };

function ease(value, start, end) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function between(a, b, t) {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t
  };
}

export function reloadProgress(reloading, endsAt, duration, serverNow, elapsedMs) {
  if (!reloading) return 0;
  if (![endsAt, duration, serverNow, elapsedMs].every(Number.isFinite) || duration <= 0) {
    throw new RangeError("Invalid server reload timing");
  }
  return Math.max(0, Math.min(1, 1 - (endsAt - serverNow - elapsedMs) / duration));
}

export function reloadPose(progress, active, type = "empty", mount = "under", layout = null) {
  const p = active ? Math.max(0, Math.min(1, progress)) : 0;
  if (!Number.isFinite(p)) throw new RangeError("Reload progress must be finite");
  if (active && type !== "empty" && type !== "tactical") {
    throw new RangeError("Unknown reload type");
  }
  if (!["under", "top", "rear"].includes(mount)) throw new RangeError("Unknown magazine mount");
  const resting = layout?.support ?? grip;
  const grabbing = layout?.grasp ?? grasp;
  const dropping = layout?.lowered ?? lowered;
  const tapping = layout?.seating ?? seating;
  const chambering = layout?.charging ?? charging;
  const travel = layout?.boltTravel ?? .16;
  const feedback = layout?.weaponId ? weaponFeedback(layout.weaponId) : null;
  const tactical = type === "tactical";
  const removal = ease(p, .24, .43);
  const insertion = ease(p, .52, .76);
  const seatingTap = ease(p, .76, .8) - ease(p, .81, .85);
  const boltPull = tactical ? 0 : ease(p, .88, .91) - ease(p, .92, .96);
  const hand = !active ? { ...resting } :
    p < .24 ? between(resting, grabbing, ease(p, .04, .24)) :
      p < .43 ? between(grabbing, dropping, removal) :
        p < .52 ? { ...dropping } :
          p < .76 ? between(dropping, grabbing, insertion) :
            p < .84 ? between(grabbing, tapping, ease(p, .76, .8)) :
              tactical ? between(tapping, resting, ease(p, .84, 1)) :
                p < .96 ? between(tapping, chambering, ease(p, .84, .87)) :
                  between(chambering, resting, ease(p, .96, 1));
  if (active && !tactical && p >= .87 && p < .96) hand.z += boltPull * travel;
  if (active && p >= .76 && p < .85) hand.y += seatingTap * .025;
  const magazine = layout ? {
    x: layout.magazine.x + layout.removal.x * (p < .44 ? removal : 1 - insertion),
    y: layout.magazine.y + layout.removal.y * (p < .44 ? removal : 1 - insertion),
    z: layout.magazine.z + layout.removal.z * (p < .44 ? removal : 1 - insertion),
    pitch: layout.magazine.pitch + .12 * (p < .44 ? removal : 1 - insertion),
    visible: !active || p < .44 || p >= .51
  } : !active || p < .44
    ? { x: -.08 * removal, y: -.2 - .37 * removal, z: -.4 + .11 * removal,
      pitch: .12 + .2 * removal, visible: true }
    : { x: -.08 + .08 * insertion, y: -.57 + .37 * insertion,
      z: -.29 - .11 * insertion, pitch: .32 - .2 * insertion,
      visible: p >= .51 };
  const handling = active ? ease(p, .04, .24) * (1 - ease(p, .84, tactical ? 1 : .87)) : 0;
  if (!layout && mount === "top") {
    magazine.y = -.4 - magazine.y + .34;
    magazine.z += .12;
    hand.y += handling * (-2 * (hand.y + .2) + .34);
    hand.z += handling * .12;
  } else if (!layout && mount === "rear") {
    magazine.z += .6;
    hand.z += handling * .6;
  }
  return {
    hand, magazine, grip: handling,
    fingerGrip: active ? 1 - (ease(p, .43, .49) - ease(p, .51, .60)) : 1,
    boltZ: active ? travel * boltPull : 0,
    handRoll: active ? -ease(p, .15, .28) * .34 + ease(p, .76, .84) * .34 : 0,
    tilt: active ? Math.sin(Math.PI * p) * (feedback?.reloadTilt ?? .23) : 0,
    roll: active ? Math.sin(Math.PI * p) * (feedback?.reloadRoll ?? .17) : 0,
    stage: !active ? "" : p < .44 ? "Magazine out" :
      p < .52 ? tactical ? "Stow magazine" : "Fresh magazine" :
        p < .76 ? "Fresh magazine" : p < .84 ? "Seat magazine" :
          tactical ? "Weapon ready" : "Chambering"
  };
}
