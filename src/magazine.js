import { disposeSceneResources } from "./scene-resources.js";

export function acquireDroppedMagazine(pool, source, weaponId, limit = 8) {
  let dropped = pool.find((item) => !item.visible && item.userData.weaponId === weaponId);
  if (dropped) return dropped;
  const previous = pool.find((item) => !item.visible) ?? (pool.length >= limit
    ? pool.reduce((oldest, item) => item.userData.spawnedAt < oldest.userData.spawnedAt ? item : oldest) : null);
  dropped = source.clone();
  const textures = new Map();
  const copyMaterial = (sourceMaterial) => {
    const material = sourceMaterial.clone();
    for (const [key, value] of Object.entries(material)) {
      if (!value?.isTexture) continue;
      if (!textures.has(value)) textures.set(value, value.clone());
      material[key] = textures.get(value);
    }
    return material;
  };
  dropped.traverse((object) => {
    if (object.geometry) object.geometry = object.geometry.clone();
    if (object.material) object.material = Array.isArray(object.material)
      ? object.material.map(copyMaterial) : copyMaterial(object.material);
  });
  dropped.userData.weaponId = weaponId;
  if (previous) {
    pool[pool.indexOf(previous)] = dropped;
    previous.removeFromParent();
    disposeSceneResources(previous);
  } else pool.push(dropped);
  return dropped;
}
