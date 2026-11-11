import * as THREE from "three";

const types = { Float32Array, Uint16Array };
export function decodeTacticalBody(manifest, buffer) {
  const vector = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (!manifest || manifest.version !== 1 || !(buffer instanceof ArrayBuffer) ||
    !Array.isArray(manifest.bones) || !manifest.bones.length || !Array.isArray(manifest.meshes) ||
    !manifest.meshes.length || !Array.isArray(manifest.distantMeshes) || !manifest.distantMeshes.length ||
    !vector(manifest.headCenter)) {
    throw new Error("Invalid tactical body manifest");
  }
  const names = new Set();
  manifest.bones.forEach((bone, index) => {
    if (!bone || typeof bone.name !== "string" || !bone.name || names.has(bone.name) ||
      !Number.isInteger(bone.parent) || bone.parent < -1 || bone.parent >= index || !vector(bone.position)) {
      throw new Error("Invalid tactical body skeleton");
    }
    names.add(bone.name);
  });
  if (!names.has("Head")) throw new Error("Missing tactical head joint");
  const attribute = (record, size, expected) => {
    if (!record || record.type !== expected) throw new Error("Invalid tactical body attribute type");
    const Type = types[record.type];
    if (!Type || !Number.isSafeInteger(record.offset) || !Number.isSafeInteger(record.length) ||
      record.offset < 0 || record.offset % Type.BYTES_PER_ELEMENT || record.length <= 0 || record.length % size ||
      record.offset + record.length * Type.BYTES_PER_ELEMENT > buffer.byteLength) {
      throw new Error("Invalid tactical body buffer range");
    }
    return new THREE.BufferAttribute(new Type(buffer, record.offset, record.length), size);
  };
  const meshes = (records) => records.map(({ name, fields }) => {
    if (typeof name !== "string" || !fields) throw new Error("Invalid tactical body mesh");
    const attributes = {};
    for (const [field, size] of Object.entries({ position: 3, normal: 3, uv: 2, skinIndex: 4, skinWeight: 4 })) {
      attributes[field] = attribute(fields[field], size, field === "skinIndex" ? "Uint16Array" : "Float32Array");
      if (![...attributes[field].array].every(Number.isFinite)) throw new Error("Non-finite tactical body attribute");
    }
    const count = attributes.position.count;
    if (Object.values(attributes).some((value) => value.count !== count)) throw new Error("Tactical attribute counts differ");
    const index = attribute(fields.index, 1, "Uint16Array");
    if (index.count % 3 || [...index.array].some((value) => value >= count) ||
      [...attributes.skinIndex.array].some((value) => value >= manifest.bones.length)) {
      throw new Error("Invalid tactical body mesh indices");
    }
    for (let vertex = 0; vertex < count; vertex++) {
      const weights = attributes.skinWeight.array.subarray(vertex * 4, vertex * 4 + 4);
      if ([...weights].some((weight) => weight < 0 || weight > 1) ||
        Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > .001) {
        throw new Error("Invalid tactical body skin weights");
      }
    }
    const geometry = new THREE.BufferGeometry();
    for (const [field, value] of Object.entries(attributes)) geometry.setAttribute(field, value);
    geometry.setIndex(index);
    return { name, geometry };
  });
  return {
    definitions: manifest.bones.map((bone) => ({
      name: bone.name, parent: bone.parent, position: new THREE.Vector3(...bone.position)
    })),
    headCenter: new THREE.Vector3(...manifest.headCenter),
    meshes: meshes(manifest.meshes), distantMeshes: meshes(manifest.distantMeshes)
  };
}

export async function fetchTacticalBody() {
  const [manifestResponse, bufferResponse] = await Promise.all([
    fetch("/models/tactical-body.json"), fetch("/models/tactical-body.bin")
  ]);
  if (!manifestResponse.ok || !bufferResponse.ok) throw new Error("Tactical character download failed");
  const [manifest, buffer] = await Promise.all([manifestResponse.json(), bufferResponse.arrayBuffer()]);
  const body = decodeTacticalBody(manifest, buffer);
  try {
    body.skinTexture = await new THREE.TextureLoader().loadAsync("/models/tactical-skin.jpg");
    body.skinTexture.colorSpace = THREE.SRGBColorSpace;
    return body;
  } catch (error) {
    for (const mesh of [...body.meshes, ...body.distantMeshes]) mesh.geometry.dispose();
    throw new Error("Tactical skin texture download failed", { cause: error });
  }
}
