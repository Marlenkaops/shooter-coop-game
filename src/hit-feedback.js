import * as THREE from "three";

export function createHitMarker(node, timer = globalThis) {
  const kinds = ["hit", "headshot", "kill", "dry"];
  let pending = null;
  const clear = () => {
    if (pending !== null) timer.clearTimeout(pending);
    pending = null;
    for (const kind of kinds) node.classList.remove(kind);
  };
  return {
    clear,
    show(kind, duration) {
      if (!kinds.includes(kind)) throw new RangeError("Unknown hit marker.");
      clear();
      node.classList.add(kind);
      pending = timer.setTimeout(clear, duration);
    }
  };
}

export function damageFeedback(hits) {
  return hits.filter((hit) => Number.isFinite(hit.damage) && hit.damage > 0 &&
    hit.position && ["x", "y", "z"].every((axis) => Number.isFinite(hit.position[axis])))
    .map((hit) => ({ damage: Math.round(hit.damage), position: { ...hit.position },
      kind: hit.killed ? "kill" : hit.hitZone === "head" ? "headshot" : "hit",
      headshot: hit.hitZone === "head" }));
}

export function createDamageNumbers(parent, { count = 12 } = {}) {
  const projected = new THREE.Vector3();
  const pool = Array.from({ length: count }, () => {
    const node = parent.ownerDocument.createElement("span");
    node.className = "damage-number hidden";
    parent.append(node);
    return { node, position: new THREE.Vector3(), started: -Infinity };
  });
  let next = 0;
  const clear = () => {
    for (const item of pool) { item.started = -Infinity; item.node.classList.add("hidden"); }
  };
  return {
    clear,
    add(hits, now) {
      for (const hit of damageFeedback(hits).slice(0, count)) {
        const item = pool[next++ % count];
        item.started = now;
        item.position.copy(hit.position);
        item.node.textContent = `${hit.damage}${hit.headshot ? " HEAD" : ""}`;
        item.node.className = `damage-number ${hit.kind} hidden`;
      }
    },
    update(camera, now, reducedMotion = false) {
      if (pool.some((item) => now - item.started < 800)) camera.updateWorldMatrix(true, false);
      for (const item of pool) {
        const age = (now - item.started) / 800;
        if (age >= 1) { item.node.classList.add("hidden"); continue; }
        projected.copy(item.position).project(camera);
        const hidden = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
        item.node.classList.toggle("hidden", hidden);
        if (hidden) continue;
        item.node.style.left = `${(projected.x + 1) * 50}%`;
        item.node.style.top = `${(1 - projected.y) * 50}%`;
        item.node.style.transform = `translate(-50%, calc(-100% - ${12 + (reducedMotion ? 0 : age * 28)}px))`;
        item.node.style.opacity = String(Math.min(1, (1 - age) * 4));
      }
    }
  };
}
