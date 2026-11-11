import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applyKeyboardLook, isGameplayTypingTarget } from "../src/input.js";

function target({ formControl = true, hidden = false, editable = false } = {}) {
  return {
    isContentEditable: editable,
    matches: () => formControl,
    closest: (selector) => selector === ".hidden" && hidden ? {} : null
  };
}

test("hidden lobby inputs do not block mission keyboard movement", () => {
  assert.equal(isGameplayTypingTarget(target({ hidden: true })), false);
  assert.equal(isGameplayTypingTarget(target()), true);
  assert.equal(isGameplayTypingTarget(target({ formControl: false })), false);
});

test("arrow keys look in the indicated camera direction, not inverted vertically", () => {
  for (const [key, axis, sign] of [
    ["ArrowUp", "y", 1], ["ArrowDown", "y", -1],
    ["ArrowLeft", "x", -1], ["ArrowRight", "x", 1]
  ]) {
    const pose = { yaw: 0, pitch: 0 };
    applyKeyboardLook(pose, { [key]: true }, .1);
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pose.pitch, pose.yaw, 0, "YXZ"));
    assert.ok(forward[axis] * sign > 0, key);
  }
});

test("keyboard aiming is cadence independent, bounded and cancels opposite inputs", () => {
  for (const hz of [30, 60, 120]) {
    const pose = { yaw: 0, pitch: 0 };
    for (let frame = 0; frame < hz; frame++) applyKeyboardLook(pose, { ArrowUp: true, ArrowLeft: true }, 1 / hz);
    assert.ok(Math.abs(pose.pitch - 1.4) < 1e-8);
    assert.ok(Math.abs(pose.yaw - 1.75) < 1e-8);
    applyKeyboardLook(pose, { ArrowUp: true }, 1);
    assert.equal(pose.pitch, 1.45);
    applyKeyboardLook(pose, { ArrowDown: true }, 5);
    assert.equal(pose.pitch, -1.45);
    const before = { ...pose };
    applyKeyboardLook(pose, { ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true }, 1);
    assert.deepEqual(pose, before);
  }
});
