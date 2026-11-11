const elevations = { wickfall: 2.8, foundry: 2.2, tundra: 1.8, void: 2.6, harbor: 1.6, outpost: 2, airfield: 1.8, citadel: 2.4, spillway: 2.2, depot: 1.6 };
const terraceDepths = { wickfall: 10, foundry: 12, tundra: 8, void: 14, harbor: 8, outpost: 12, airfield: 10, citadel: 14, spillway: 12, depot: 8 };
const terrainCache = new Map();

export function getMapTerrain(mapId) {
  if (typeof mapId === "object") mapId = mapId.mapId;
  if (terrainCache.has(mapId)) return terrainCache.get(mapId);
  if (mapId === "range") return Object.freeze([]);
  const elevation = elevations[mapId] ?? elevations.foundry;
  const depth = terraceDepths[mapId] ?? terraceDepths.foundry;
  const surfaces = [];
  for (const side of [-1, 1]) {
    const x = side * 34;
    const height = elevation + (side === 1 ? .35 : 0);
    surfaces.push({ id: `${mapId}-terrace-${side}`, x, z: 0, width: 10, depth, height, slope: 0 });
    for (const end of [-1, 1]) {
      surfaces.push({ id: `${mapId}-ramp-${side}-${end}`, x, z: end * (depth + 10) / 2, width: 10, depth: 10,
        height: height / 2, slope: -end * height / 10 });
    }
  }
  const result = Object.freeze(surfaces.map(Object.freeze));
  terrainCache.set(mapId, result);
  return result;
}

export function terrainHeightAt(surface, x, z) {
  if (Math.abs(x - surface.x) > surface.width / 2 + 1e-6 ||
    Math.abs(z - surface.z) > surface.depth / 2 + 1e-6) return null;
  return Math.max(0, surface.height + (z - surface.z) * surface.slope);
}

export function getTerrainHeight(mapId, x, z) {
  let height = 0;
  for (const surface of getMapTerrain(mapId)) height = Math.max(height, terrainHeightAt(surface, x, z) ?? 0);
  return height;
}

export function getTerraceBuildings(mapId) {
  if (mapId === "range") return [];
  return [-1, 1].map((side) => ({
    id: `${mapId}-field-house-${side}`, x: side * 34, z: 0,
    width: 6.4, depth: 7, height: 3.6, base: getTerrainHeight(mapId, side * 34, 0), rotation: 0, kind: "building"
  }));
}

export function buildingWalls(building) {
  const { id, width, depth, height, rotation, base = 0 } = building;
  const walls = [], thickness = .3, doorWidth = Math.min(3.2, width * .5), doorHeight = 2.65;
  const part = (name, x, z, w, d, h, bottom = 0, kind = "building") => {
    walls.push({
      id: `${id}-${name}`, buildingId: id, kind, rotation,
      x: building.x + Math.cos(rotation) * x + Math.sin(rotation) * z,
      z: building.z - Math.sin(rotation) * x + Math.cos(rotation) * z,
      width: w, depth: d, height: h, base: base + bottom
    });
  };
  for (const side of [-1, 1]) {
    part(`side-${side}`, side * (width - thickness) / 2, 0, thickness, depth, height);
    for (const end of [-1, 1]) {
      part(`door-${end}-${side}`, side * (width + doorWidth) / 4, end * (depth - thickness) / 2,
        (width - doorWidth) / 2, thickness, height);
    }
    part(`lintel-${side}`, 0, side * (depth - thickness) / 2, doorWidth, thickness, height - doorHeight, doorHeight);
  }
  part("roof", 0, 0, width, depth, .22, height, "roof");
  part("cabinet", -width / 2 + .6, 0, .65, Math.min(2.2, depth / 3), 1.05, 0, "furniture");
  return walls;
}

// Clip a ray against the raised ground's convex footprint and sloped top.
export function rayTerrainHit(origin, direction, surface, maxDistance = 100) {
  let near = 0, far = maxDistance;
  const planes = [
    [1, 0, 0, surface.x + surface.width / 2], [-1, 0, 0, -surface.x + surface.width / 2],
    [0, 0, 1, surface.z + surface.depth / 2], [0, 0, -1, -surface.z + surface.depth / 2],
    [0, -1, 0, 0], [0, 1, -surface.slope, surface.height - surface.slope * surface.z]
  ];
  for (const [x, y, z, limit] of planes) {
    const distance = limit - (x * origin.x + y * origin.y + z * origin.z);
    const rate = x * direction.x + y * direction.y + z * direction.z;
    if (Math.abs(rate) < 1e-8) { if (distance < 0) return null; continue; }
    const t = distance / rate;
    if (rate < 0) near = Math.max(near, t);
    else far = Math.min(far, t);
    if (near > far) return null;
  }
  return near <= maxDistance ? near : null;
}
