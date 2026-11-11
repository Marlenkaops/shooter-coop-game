export const DEFAULT_SKIN_ID = "standard";
export const SKINS = Object.freeze({
  standard: Object.freeze({ id: "standard", name: "Field Standard", cost: 0,
    description: "Your original arena-adapted tactical outfit.", accent: "#92a88d", palette: null }),
  nightwatch: Object.freeze({ id: "nightwatch", name: "Nightwatch", cost: 120,
    description: "Midnight-blue camouflage with charcoal tactical gear.", accent: "#799aaa",
    palette: Object.freeze({ uniform: 0x314751, gear: 0x26373d, yoke: 0x263f49, trim: 0x657c83,
      mask: 0x52646a, dark: 0x18272c, rubber: 0x263032, glove: 0x52606a, lens: 0x3d9bad }) }),
  copperline: Object.freeze({ id: "copperline", name: "Copperline", cost: 240,
    description: "Burnished-earth camouflage with olive field equipment.", accent: "#bf9372",
    palette: Object.freeze({ uniform: 0x78513d, gear: 0x444b35, yoke: 0x5d432f, trim: 0x997c56,
      mask: 0x817462, dark: 0x302a20, rubber: 0x34382b, glove: 0x8c7050, lens: 0x537c70 }) }),
  glacier: Object.freeze({ id: "glacier", name: "Glacier", cost: 360,
    description: "Frost-grey camouflage with blue-slate equipment.", accent: "#a9b9c1",
    palette: Object.freeze({ uniform: 0x879ba0, gear: 0x405964, yoke: 0x526c76, trim: 0xa4b5b8,
      mask: 0x96a9ac, dark: 0x273c45, rubber: 0x40565b, glove: 0x839498, lens: 0x378fa1 }) })
});

export function skinFor(id = DEFAULT_SKIN_ID) {
  if (!Object.hasOwn(SKINS, id)) throw new RangeError("Unknown outfit.");
  return SKINS[id];
}
