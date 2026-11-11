export function disposeSceneResources(root, retainedTextures = new Set()) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((object) => {
    if (object.isInstancedMesh) object.dispose();
    if (object.geometry) geometries.add(object.geometry);
    for (const material of object.material ?
      Array.isArray(object.material) ? object.material : [object.material] : []) materials.add(material);
    object.shadow?.dispose();
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  }
  for (const value of [root.background, root.environment]) if (value?.isTexture) textures.add(value);
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => { if (!retainedTextures.has(texture)) texture.dispose(); });
}
