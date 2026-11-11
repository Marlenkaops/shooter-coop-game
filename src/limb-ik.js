import * as THREE from "three";

const direction = new THREE.Vector3(), normal = new THREE.Vector3(), middle = new THREE.Vector3();
const upperRest = new THREE.Vector3(), lowerRest = new THREE.Vector3(), current = new THREE.Vector3();
const upperRotation = new THREE.Quaternion(), lowerRotation = new THREE.Quaternion();
const gripSide = new THREE.Vector3(), desiredSide = new THREE.Vector3(), gripCross = new THREE.Vector3();
const gripTwist = new THREE.Quaternion();

export function handGripOrientation(forward, side, targetForward, targetSide, result) {
  result.setFromUnitVectors(forward, targetForward);
  gripSide.copy(side).applyQuaternion(result);
  gripSide.addScaledVector(targetForward, -gripSide.dot(targetForward)).normalize();
  desiredSide.copy(targetSide).addScaledVector(targetForward, -targetSide.dot(targetForward)).normalize();
  const angle = Math.atan2(targetForward.dot(gripCross.crossVectors(gripSide, desiredSide)),
    gripSide.dot(desiredSide));
  return result.premultiply(gripTwist.setFromAxisAngle(targetForward, angle));
}

export function poseLimb(bones, definitions, upper, lower, end, target, pole) {
  upperRest.copy(definitions[lower].position).sub(definitions[upper].position);
  lowerRest.copy(definitions[end].position).sub(definitions[lower].position);
  const origin = bones[upper].position;
  const upperLength = upperRest.length(), lowerLength = lowerRest.length();
  direction.copy(target).sub(origin);
  const distance = THREE.MathUtils.clamp(direction.length(), .001, upperLength + lowerLength - .000001);
  direction.normalize();
  const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  normal.copy(pole).addScaledVector(direction, -pole.dot(direction)).normalize();
  middle.copy(origin).addScaledVector(direction, along).addScaledVector(normal, bend);
  upperRotation.setFromUnitVectors(upperRest.normalize(), current.copy(middle).sub(origin).normalize());
  lowerRotation.setFromUnitVectors(lowerRest.normalize(), current.copy(target).sub(middle).normalize());
  bones[upper].quaternion.copy(upperRotation);
  bones[lower].quaternion.copy(upperRotation).invert().multiply(lowerRotation);
  bones[end].quaternion.copy(lowerRotation).invert();
}
