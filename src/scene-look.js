const looks = {
  wickfall: {
    sky: 0x192a34, horizon: 0x687a80, fog: 0x63767b, cover: 0x777e7e,
    accent: 0xf6a550, fill: 0xbbced8, sun: 0xc6deec, sunStrength: 1.5,
    sunPosition: [-24, 32, -40], panorama: "wasteland_clouds_puresky",
    soldiers: [0x66715c, 0x6a6c58, 0x596a62], equipment: [0x2d3e35, 0x3e4337, 0x31493e]
  },
  range: {
    sky: 0x9abacd, horizon: 0xe2e9d8, fog: 0xbccabc, cover: 0x7e8c72,
    accent: 0xb5c88c, fill: 0xe4ecd9, sun: 0xffeed5, sunStrength: 2.6,
    sunPosition: [-26, 38, -30], panorama: "snow_field_puresky",
    soldiers: [0x596354, 0x626052, 0x4d5b56], equipment: [0x252b29, 0x35302a, 0x283230]
  },
  spillway: {
    sky: 0x819b9d, horizon: 0xc6d9d6, fog: 0x9eb5b3, cover: 0x6f8581,
    accent: 0x73bab0, fill: 0xd4e6e1, sun: 0xdfefe9, sunStrength: 1.9,
    sunPosition: [24, 38, -32], panorama: "wasteland_clouds_puresky",
    soldiers: [0x587168, 0x68796f, 0x53736e], equipment: [0x293d36, 0x354940, 0x2a4240]
  },
  depot: {
    sky: 0x8d8794, horizon: 0xe9c5a5, fog: 0xb3a19a, cover: 0x8b7969,
    accent: 0xe4a26c, fill: 0xe4d9cc, sun: 0xffcf9c, sunStrength: 2.3,
    sunPosition: [-32, 22, -36], panorama: "industrial_sunset_02_puresky",
    soldiers: [0x766b5c, 0x6b6e59, 0x806b56], equipment: [0x40382e, 0x434636, 0x4b3b2d]
  },
  foundry: {
    sky: 0x92b3c4, horizon: 0xe3eaed, fog: 0xb1c2c9, cover: 0x708087,
    accent: 0xb8764e, fill: 0xd4e5eb, sun: 0xffead1, sunStrength: 2.8,
    sunPosition: [-28, 35, -30], panorama: "industrial_sunset_02_puresky",
    soldiers: [0x596354, 0x626052, 0x4d5b56], equipment: [0x252b29, 0x35302a, 0x283230]
  },
  tundra: {
    sky: 0x91b9cb, horizon: 0xe4f3f5, fog: 0xc1d6dc, cover: 0x8ca9ae,
    accent: 0x70b4c5, fill: 0xe0ecee, sun: 0xf2f8ff, sunStrength: 2.5,
    sunPosition: [26, 42, -26], panorama: "snow_field_puresky",
    soldiers: [0x77898d, 0x6c8288, 0x889291], equipment: [0x35464b, 0x435257, 0x30444b]
  },
  void: {
    sky: 0x7f879d, horizon: 0xc2bfcc, fog: 0x9293a6, cover: 0x737784,
    accent: 0x977fa5, fill: 0xd1d3dc, sun: 0xe0e5ee, sunStrength: 2.2,
    sunPosition: [-20, 28, -35], panorama: "wasteland_clouds_puresky",
    soldiers: [0x625d69, 0x6b5b6d, 0x555363], equipment: [0x302d38, 0x3d3542, 0x2b303b]
  },
  harbor: {
    sky: 0x637e8c, horizon: 0xb6c6c8, fog: 0x8ea9b2, cover: 0x647b80,
    accent: 0xb8a574, fill: 0xd0e0e3, sun: 0xdfeaf1, sunStrength: 1.8,
    sunPosition: [-24, 32, -32], panorama: "wasteland_clouds_puresky",
    soldiers: [0x526c6d, 0x65746a, 0x5a666f], equipment: [0x273e40, 0x34463d, 0x313c46]
  },
  airfield: {
    sky: 0x95adbd, horizon: 0xdce6e9, fog: 0xb5c6cf, cover: 0x85959a,
    accent: 0x91adbe, fill: 0xd9e6ea, sun: 0xeceff3, sunStrength: 2.4,
    sunPosition: [32, 26, -34], panorama: "snow_field_puresky",
    soldiers: [0x657279, 0x677c80, 0x72838a], equipment: [0x37434a, 0x414c50, 0x334649]
  },
  citadel: {
    sky: 0x9a9fa8, horizon: 0xe7c7af, fog: 0xb9aaa1, cover: 0x95918b,
    accent: 0xcf9977, fill: 0xe4d9cd, sun: 0xffd0a0, sunStrength: 2.7,
    sunPosition: [-36, 24, -28], panorama: "industrial_sunset_02_puresky",
    soldiers: [0x737262, 0x6b725f, 0x817a66], equipment: [0x3e4238, 0x4d493d, 0x3a4038]
  },
  outpost: {
    sky: 0x9ab1b8, horizon: 0xf3d6a0, fog: 0xcfb58c, cover: 0xb8a783,
    accent: 0xc4a168, fill: 0xf2dbb3, sun: 0xffe2b8, sunStrength: 3,
    sunPosition: [-32, 28, -35], panorama: "industrial_sunset_02_puresky",
    soldiers: [0x9c906f, 0x8b846c, 0xab9a79], equipment: [0x655d47, 0x756c50, 0x5c5b48]
  }
};

for (const look of Object.values(looks)) {
  Object.freeze(look.sunPosition);
  Object.freeze(look.soldiers);
  Object.freeze(look.equipment);
  Object.freeze(look);
}

export function sceneLook(mapId) {
  const look = looks[mapId];
  if (!Object.hasOwn(looks, mapId)) throw new RangeError(`Unknown arena look: ${mapId}`);
  return look;
}
