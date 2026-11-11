import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WEAPONS } from "../shared/weapons.js";
import { WEAPON_FINISHES } from "../shared/career.js";
import { matteMaterial, weaponFinishMaps } from "./surface-finish.js";

const designs = {
  rifle: { muzzle: .49, guard: .22, stock: .22, color: 0x718077 },
  smg: { muzzle: .35, guard: .13, stock: .15, color: 0x687880 },
  marksman: { muzzle: .61, guard: .30, stock: .24, color: 0x7f8879 },
  sniper: { muzzle: .72, guard: .32, stock: .27, color: 0x827d6f },
  shotgun: { muzzle: .52, guard: .25, stock: .24, color: 0x797e73 },
  lmg: { muzzle: .63, guard: .29, stock: .25, color: 0x85846d },
  carbine: { muzzle: .48, guard: .18, stock: .19, color: 0x748682 },
  pdw: { muzzle: .32, guard: .13, stock: .16, color: 0x728083 },
  battle: { muzzle: .51, guard: .21, stock: .24, color: 0x797f71 },
  autoshotgun: { muzzle: .46, guard: .21, stock: .23, color: 0x807768 },
  pistol: { muzzle: .18, guard: .055, stock: 0, color: 0x637986, sidearm: true },
  heavyPistol: { muzzle: .29, guard: .11, stock: 0, color: 0x9c7861, sidearm: true },
  jackolantern: { muzzle: .55, guard: .24, stock: .23, color: 0xc48142 },
  graveglass: { muzzle: .62, guard: .27, stock: .21, color: 0x597d76 }
};

export function weaponLayout(id) {
  if (!Object.hasOwn(designs, id)) throw new RangeError("Unknown weapon model");
  const design = designs[id], top = id === "pdw", rear = id === "battle";
  const boxFed = id === "lmg", drum = id === "autoshotgun", wideMagazine = boxFed || drum;
  const magazine = { x: 0, y: top ? .038 : design.sidearm ? -.13 : -.102,
    z: design.sidearm ? .067 : rear ? .145 : top ? -.11 : -.085, pitch: top ? 0 : .08 };
  const support = { x: design.sidearm ? -.068 : -.072, y: design.sidearm ? -.133 : -.061,
    z: design.sidearm ? .17 : id === "sniper" || id === "lmg" ? -.19 : -.16 };
  const supportDirection = design.sidearm ? { x: .2, y: .1, z: -.97 } : { x: .95, y: .15, z: -.25 };
  const grasp = { x: boxFed ? -.080 : drum ? -.056 : -.075,
    y: magazine.y + (boxFed ? -.055 : drum ? -.072 : top ? .012 : -.015),
    z: magazine.z + (boxFed ? .005 : drum ? -.005 : .018) };
  const removal = { x: -.025, y: top ? .09 : -.14, z: .055 };
  return {
    ...design, weaponId: id, wideMagazine, mount: top ? "top" : rear ? "rear" : "under",
    right: { x: .059, y: -.113, z: .15 },
    rightDirection: { x: -.16, y: .12, z: -.98 },
    supportDirection,
    magazineDirection: wideMagazine ? { x: 0, y: 1, z: 0 } : supportDirection,
    rightCurlAxis: { x: 0, y: 1, z: 0 },
    supportCurlAxis: design.sidearm ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: -1 },
    magazineCurlAxis: top || wideMagazine ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 },
    support, magazine,
    grasp,
    lowered: { x: grasp.x + removal.x, y: grasp.y + removal.y, z: grasp.z + removal.z },
    seating: { x: -.045, y: magazine.y - (top ? -.035 : .12), z: magazine.z },
    charging: { x: -.063, y: .050, z: .015 },
    optic: { x: 0, y: .096, z: .008 },
    removal,
    boltTravel: .045
  };
}

export function createWeaponModel(id, { compact = false, distant = false, attachmentId = "none", finishId = "standard" } = {}) {
  const layout = weaponLayout(id), specification = WEAPONS[id];
  const root = new THREE.Group(), magazine = new THREE.Group(), bolt = new THREE.Group();
  const segments = compact ? 8 : 12, pieces = new Map();
  const metalFinish = weaponFinishMaps(), polymerFinish = weaponFinishMaps(true);
  const material = (color, roughness, metalness, surface = "hardware") => {
    const value = new THREE.MeshStandardMaterial({
      color, roughness, metalness,
      ...(surface === "optical" ? {} : metalness < .1 ? polymerFinish : metalFinish),
      normalScale: new THREE.Vector2(.12, .12)
    });
    value.userData.weaponSurface = surface;
    return matteMaterial(value);
  };
  const paint = material(new THREE.Color(WEAPON_FINISHES[finishId]?.color ?? layout.color).multiplyScalar(.78), .72, .25);
  const steel = material(0x788180, .38, .88);
  const polymer = material(0x2c3830, .91, .02);
  const rubber = material(0x161e19, .97, 0);
  const recess = material(0x0e1611, .86, .08);
  const glass = material(0x3c8890, .2, .3, "optical");
  glass.transparent = true;
  glass.opacity = .14;
  glass.depthWrite = false;
  const magazineMaterial = material(id === "lmg" ? 0x69715b : 0x56645c, .76, .12);
  const add = (geometry, mat, position, rotation = [0, 0, 0], group = root) => {
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    let groups = pieces.get(group);
    if (!groups) pieces.set(group, groups = new Map());
    if (!groups.has(mat)) groups.set(mat, []);
    const unindexed = geometry.index ? geometry.toNonIndexed() : geometry;
    groups.get(mat).push(unindexed);
    if (unindexed !== geometry) geometry.dispose();
  };
  const box = (size, mat, position, rotation, group) => add(
    compact || Math.min(...size) < .025 ? new THREE.BoxGeometry(...size) :
      new RoundedBoxGeometry(...size, 1, Math.min(.006, Math.min(...size) * .2)), mat, position, rotation, group
  );
  const tube = (radius, length, mat, position, group = root, open = false) =>
    add(new THREE.CylinderGeometry(radius, radius, length, segments, 1, open), mat, position, [Math.PI / 2, 0, 0], group);
  const sideDisc = (radius, mat, side, y, z, x = .034, group = root) =>
    add(new THREE.CircleGeometry(radius, compact ? 6 : 8), mat, [side * x, y, z], [0, side * Math.PI / 2, 0], group);
  const fastener = (side, y, z, x = .034) => {
    sideDisc(.004, steel, side, y, z, x);
    box([.001, .0011, .0045], recess, [side * (x + .0005), y, z], [side * .3, 0, 0]);
  };
  const vent = (side, y, z, length) => {
    const shape = new THREE.Shape([[-length / 2 + .003, -.005], [length / 2 - .003, -.005],
      [length / 2, -.002], [length / 2, .002], [length / 2 - .003, .005],
      [-length / 2 + .003, .005], [-length / 2, .002], [-length / 2, -.002]]
      .map(([x, y]) => new THREE.Vector2(x, y)));
    add(new THREE.ShapeGeometry(shape), recess, [side * .0317, y, z], [0, side * Math.PI / 2, 0]);
  };
  const profile = (points, width, mat, position) => {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: width, bevelEnabled: true, bevelSize: .002, bevelThickness: .002,
      bevelSegments: 1, steps: 1, curveSegments: 1
    });
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(width / 2, 0, 0);
    add(geometry, mat, position);
  };
  if (attachmentId === "grip") box([.028, .075, .035], polymer, [0, -.085, -layout.guard * .65], [.12, 0, 0]);
  if (attachmentId === "quick") box([.056, .013, .04], steel, [0, -.09, .055]);
  if (attachmentId === "reserve") box([.065, .018, .06], polymer, [0, -.16, .055]);
  profile([[-.105, -.030], [-.105, .014], [-.078, .037], [.050, .037],
    [.080, .017], [.080, -.030], [.017, -.035]], .058, paint, [0, 0, 0]);
  box([.049, .038, .155], polymer, [0, -.039, .004]);
  box([.043, .135, .058], rubber, [0, -.095, .067], [-.24, 0, 0]);
  if (!layout.sidearm) {
    const stockRatio = (layout.stock + .045 - .09) / .19;
    profile([[-.03, .01], [.085, .013], [.145, -.022], [.185, -.016], [.19, -.062], [.05, -.065]]
      .map(([z, y]) => [z * stockRatio, y]),
      .048, polymer, [0, 0, .09]);
    box([.052, .095, .020], rubber, [0, -.035, layout.stock + .055]);
    tube(.015, layout.stock * .65, steel, [0, .005, layout.stock * .45]);
    if (!distant) {
      profile([[.030, .016], [.086, .018], [.139, -.010], [.139, -.019], [.081, .008], [.030, .006]]
        .map(([z, y]) => [z * stockRatio, y]), .045, paint, [0, 0, .09]);
      for (let rib = 0; rib < (compact ? 2 : 5); rib++) {
        box([.046, .003, .0015], polymer, [0, -.065 + rib * .015, layout.stock + .0655]);
      }
      for (const side of [-1, 1]) {
        box([.002, .022, layout.stock * .32], recess, [side * .025, -.030, .095 + layout.stock * .45], [-.08, 0, 0]);
        if (!compact) fastener(side, -.026, layout.stock + .018, .027);
      }
    }
  } else {
    box([.065, .020, .19], steel, [0, .036, -.018]);
    for (const side of [-1, 1]) {
      box([.004, .079, .044], polymer, [side * .024, -.102, .067], [-.24, 0, 0]);
      if (!distant) {
        for (let rib = 0; rib < (compact ? 3 : 6); rib++) {
          box([.001, .015, .002], recess, [side * .033, .035, .048 - rib * .007], [.22, 0, 0]);
        }
        box([.001, .008, .041], recess, [side * .034, .032, -.064]);
        fastener(side, -.087, .069, .027);
      }
    }
  }
  box([.062, .063, layout.guard], paint, [0, .002, -.105 - layout.guard / 2]);
  box([.046, .009, layout.guard + .10], steel, [0, .040, -.075 - layout.guard / 2]);
  const barrelStart = .105 + layout.guard;
  tube(specification.pellets ? .020 : .011, layout.muzzle - barrelStart,
    steel, [0, .009, -(barrelStart + layout.muzzle) / 2]);
  tube(specification.pellets ? .024 : .016, .040, recess, [0, .009, -layout.muzzle + .02], root, true);
  add(new THREE.CircleGeometry(specification.pellets ? .015 : .008, segments), recess, [0, .009, -layout.muzzle + .005], [0, Math.PI, 0]);
  for (const side of [-1, 1]) {
    for (let index = 0; index < (layout.sidearm ? 3 : compact ? 4 : 7); index++) {
      vent(side, .009, -.14 - index * layout.guard / 8, .022);
    }
    if (distant) {
      box([.002, .025, .066], recess, [side * .030, .006, -.026]);
    } else {
      box([.002, .026, .068], steel, [side * .030, .006, -.026]);
      box([.001, .019, .060], recess, [side * .0315, .007, -.026]);
      if (side > 0) {
        box([.001, .006, .054], steel, [side * .0325, .002, -.026]);
        box([.002, .003, .047], paint, [side * .033, -.008, -.026]);
      } else {
        sideDisc(.009, steel, side, -.020, .047);
        box([.003, .005, .020], polymer, [side * .035, -.020, .055], [.35, 0, 0]);
      }
    }
    for (const z of [-.071, .033]) {
      add(new THREE.CylinderGeometry(.005, .005, .004, 6), steel, [side * .031, -.015, z], [0, 0, Math.PI / 2]);
    }
    if (!compact && !distant) {
      for (const z of [-.081, .055]) fastener(side, .023, z);
      box([.001, .0015, .116], steel, [side * .031, -.026, -.010]);
      box([.001, .007, .027], polymer, [side * .031, -.016, -.039]);
      const code = String(Object.keys(designs).indexOf(id) + 1).padStart(2, "0");
      for (const [place, digit] of [...code].entries()) {
        const segments = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"][Number(digit)];
        for (const segment of segments) {
          const [dy, dz, h, width] = {
            a: [.003, 0, .001, .004], b: [.0015, .002, .003, .001],
            c: [-.0015, .002, .003, .001], d: [-.003, 0, .001, .004],
            e: [-.0015, -.002, .003, .001], f: [.0015, -.002, .003, .001], g: [0, 0, .001, .004]
          }[segment];
          add(new THREE.PlaneGeometry(width, h), steel,
            [side * .032, -.016 + dy, -.040 + side * ((place - .5) * .006 + dz)], [0, side * Math.PI / 2, 0]);
        }
      }
    }
  }
  box([.006, .009, .03], steel, [.033, -.015, .018], [0, -.2, -.3]);
  box([.048, .008, .079], polymer, [0, -.060, -.020]);
  for (const side of [-1, 1]) box([.008, .037, .008], polymer, [side * .020, -.077, -.050]);
  box([.044, .009, .009], polymer, [0, -.095, -.027]);
  box([.006, .027, .006], steel, [0, -.078, -.020], [.2, 0, 0]);
  for (let index = 0; index < (layout.sidearm ? 3 : compact ? 6 : 10); index++) {
    box([.054, .006, .010], steel, [0, .047, -.09 - index * .021]);
  }
  const top = layout.mount === "top", drum = id === "autoshotgun", boxFed = id === "lmg";
  if (drum) {
    add(new THREE.CylinderGeometry(.064, .064, .078, segments), magazineMaterial, [0, -.028, 0], [0, 0, Math.PI / 2], magazine);
    box([.036, .049, .037], magazineMaterial, [0, .040, 0], undefined, magazine);
    if (!distant) {
      sideDisc(.049, recess, -1, -.028, 0, .040, magazine);
      sideDisc(.016, steel, -1, -.028, 0, .041, magazine);
      for (let spoke = 0; spoke < (compact ? 3 : 6); spoke++) {
        const angle = spoke * Math.PI * 2 / (compact ? 3 : 6);
        box([.002, .005, .031], magazineMaterial,
          [-.041, -.028 + Math.sin(angle) * .032, Math.cos(angle) * .032], [-angle, 0, 0], magazine);
      }
    }
  } else {
    box(top ? [.060, .026, .28] : boxFed ? [.13, .105, .11] : [.038, layout.sidearm ? .095 : .140, .055],
      magazineMaterial, [0, 0, 0], undefined, magazine);
    box(top ? [.064, .006, .28] : boxFed ? [.134, .009, .114] : [.042, .009, .060],
      rubber, [0, top ? .016 : boxFed ? -.054 : layout.sidearm ? -.049 : -.071, 0], undefined, magazine);
    if (!top && !boxFed) for (const side of [-1, 1]) for (const z of [-.017, .017]) {
      box([.002, layout.sidearm ? .079 : .108, .004], recess, [side * .020, -.001, z], undefined, magazine);
    }
    if (top && !distant) {
      for (let index = 0; index < (compact ? 3 : 6); index++) {
        box([.052, .001, .003], recess, [0, .0195, -.11 + index * (compact ? .10 : .044)], undefined, magazine);
      }
    } else if (boxFed && !distant) {
      for (const side of [-1, 1]) {
        box([.002, .070, .075], polymer, [side * .066, -.004, 0], undefined, magazine);
        box([.004, .026, .012], steel, [side * .068, .024, -.035], undefined, magazine);
      }
    } else if (!compact && !distant) for (const side of [-1, 1]) {
      for (const y of [-.04, .025]) {
        box([.0015, .003, .044], steel, [side * .021, y, 0], undefined, magazine);
      }
    }
  }
  if (!top) box([.058, .028, .066], paint, [0, -.060, layout.magazine.z]);
  if (id === "battle") box([.072, .074, .18], paint, [0, .001, .125]);
  if (id === "pdw") {
    box([.083, .070, .13], paint, [0, -.015, .100]);
    box([.054, .012, .10], polymer, [0, .069, .028]);
  }
  if (id === "carbine") tube(.022, .16, paint, [0, .009, -layout.muzzle + .09]);
  if (id === "heavyPistol") tube(.022, .095, paint, [0, .009, -layout.muzzle + .06]);
  if (id === "jackolantern") {
    for (const side of [-1, 1]) {
      tube(.013, .24, paint, [side * .025, -.027, -.40]);
      for (let rib = 0; rib < 4; rib++) {
        box([.007, .063, .007], steel, [side * .038, .006, -.13 - rib * .045]);
      }
    }
    box([.078, .008, .22], paint, [0, .044, -.20]);
  }
  if (id === "graveglass") {
    tube(.024, .17, recess, [0, .009, -layout.muzzle + .09]);
    for (const side of [-1, 1]) for (let index = 0; index < 3; index++) {
      box([.004, .022, .026], steel, [side * .033, .002, -.14 - index * .045], [0, 0, side * .35]);
    }
  }
  if (id === "shotgun" || id === "autoshotgun") {
    tube(.016, layout.guard, polymer, [0, -.032, -.13 - layout.guard / 2]);
    if (!distant) for (const side of [-1, 1]) for (let rib = 0; rib < (compact ? 2 : 5); rib++) {
      box([.004, .047, .004], polymer, [side * .033, -.002, -.17 - rib * .018]);
    }
  }
  if (id === "sniper" || id === "lmg") for (const side of [-1, 1]) {
    tube(.005, .20, steel, [side * .041, -.040, -.36]);
  }
  if (id === "lmg") {
    box([.082, .016, .15], steel, [0, .057, -.015]);
    box([.069, .018, .08], rubber, [0, .099, -.23]);
    for (const side of [-1, 1]) box([.009, .050, .012], steel, [side * .03, .076, -.23]);
    if (!distant) {
      box([.066, .007, .094], paint, [0, .069, .008]);
      for (let hinge = 0; hinge < (compact ? 2 : 4); hinge++) {
        box([.008, .011, .012], steel, [-.041, .058, -.055 + hinge * .020]);
      }
    }
  }
  if (!distant && (id === "sniper" || id === "marksman")) {
    const ribs = compact ? 2 : 4;
    for (const side of [-1, 1]) for (let rib = 0; rib < ribs; rib++) {
      box([.001, .013, .018], polymer, [side * .032, -.017, -.15 - rib * .032]);
    }
  }
  if (!distant && (id === "smg" || id === "carbine" || id === "pdw")) {
    box([.045, .008, layout.guard * .65], polymer, [0, -.034, -.13 - layout.guard * .35]);
  }
  // Fine hardware: grip stippling, sights, muzzle device, sling points and lights.
  const gripUp = [0, Math.cos(-.24), Math.sin(-.24)], gripFront = [0, Math.sin(-.24), -Math.cos(-.24)];
  for (let index = 0; index < (compact ? 3 : 6); index++) {
    const along = -.05 + index * (.1 / ((compact ? 3 : 6) - 1));
    box([.045, .004, .004], recess, [0, -.095 + gripUp[1] * along + gripFront[1] * .0295,
      .067 + gripUp[2] * along + gripFront[2] * .0295], [-.24, 0, 0]);
  }
  if (layout.sidearm) {
    box([.008, .010, .008], steel, [0, .051, -.103]);
    for (const side of [-1, 1]) box([.007, .010, .008], steel, [side * .012, .051, .062]);
  } else {
    const frontSight = -.105 - layout.guard - .012;
    if (layout.muzzle + frontSight > .03) {
      box([.008, .024, .008], steel, [0, .056, frontSight]);
      box([.026, .008, .014], steel, [0, .047, frontSight]);
    }
    if (!specification.pellets) for (let index = 0; index < 4; index++) {
      const angle = index * Math.PI / 2 + Math.PI / 4;
      box([.006, .006, .036], steel, [Math.cos(angle) * .0145, .009 + Math.sin(angle) * .0145, -layout.muzzle + .024]);
    }
    if (!compact) {
      tube(.016, .028, steel, [0, .009, -barrelStart - .02]);
      for (const z of [layout.stock + .02, -.105 - layout.guard + .025]) {
        add(new THREE.TorusGeometry(.008, .0018, 4, 8), steel, [0, z > 0 ? -.07 : -.038, z], [0, Math.PI / 2, 0]);
      }
      if (["rifle", "carbine", "smg", "pdw", "battle", "marksman"].includes(id)) {
        const lightZ = -.105 - layout.guard * .62;
        box([.012, .016, .03], steel, [.036, .010, lightZ]);
        tube(.011, .06, polymer, [.046, .010, lightZ]);
        add(new THREE.CircleGeometry(.008, segments), recess, [.046, .010, lightZ - .0305], [0, Math.PI, 0]);
      }
    }
  }
  bolt.position.set(-.036, .037, .015);
  box([.013, .010, .030], steel, [0, 0, 0], undefined, bolt);
  box([.020, .012, .013], rubber, [-.014, 0, .004], undefined, bolt);
  if (id === "sniper" && !distant) {
    box([.035, .008, .008], steel, [-.016, -.008, .002], [0, 0, .45], bolt);
    add(new THREE.SphereGeometry(.010, compact ? 6 : 8, 4), polymer, [-.035, -.016, .002], undefined, bolt);
  }
  box([.030, .018, .06], polymer, [0, .061, .008]);
  const magnified = specification.optic.zoom > 1, radius = magnified ? .024 : .023;
  if (magnified) {
    tube(radius, id === "sniper" ? .235 : .160, recess, [0, layout.optic.y, -.024], root, true);
    for (const z of [-.11, .056]) add(new THREE.TorusGeometry(radius, .003, 4, segments), steel, [0, layout.optic.y, z]);
    add(new THREE.CylinderGeometry(.012, .012, .026, 8), steel, [0, .125, -.012]);
    add(new THREE.CylinderGeometry(.011, .011, .022, 8), steel, [.029, .096, -.012], [0, 0, Math.PI / 2]);
    add(new THREE.CircleGeometry(radius * .89, segments), glass, [0, layout.optic.y, -.114], [0, Math.PI, 0]);
    if (!distant) for (const z of [-.064, .029]) {
      box([.040, .018, .012], steel, [0, .061, z]);
      if (!compact) for (const side of [-1, 1]) fastener(side, .064, z, .022);
    }
    if (!compact && !distant) for (let tick = 0; tick < 8; tick++) {
      const angle = tick * Math.PI / 4;
      box([.002, .009, .002], recess, [Math.cos(angle) * .012, .130, -.012 + Math.sin(angle) * .012]);
    }
  } else {
    const frame = new THREE.Shape();
    frame.moveTo(-.029, -.023);
    frame.lineTo(-.029, .012);
    frame.quadraticCurveTo(-.029, .025, -.017, .025);
    frame.lineTo(.017, .025);
    frame.quadraticCurveTo(.029, .025, .029, .012);
    frame.lineTo(.029, -.023);
    frame.closePath();
    const opening = new THREE.Path();
    opening.moveTo(-.022, -.017);
    opening.lineTo(.022, -.017);
    opening.lineTo(.022, .012);
    opening.quadraticCurveTo(.022, .018, .016, .018);
    opening.lineTo(-.016, .018);
    opening.quadraticCurveTo(-.022, .018, -.022, .012);
    opening.closePath();
    frame.holes.push(opening);
    add(new THREE.ExtrudeGeometry(frame, { depth: .036, bevelEnabled: !compact,
      bevelSize: .001, bevelThickness: .001, bevelSegments: 1, curveSegments: compact ? 2 : 4 }),
    recess, [0, layout.optic.y, -.010]);
    add(new THREE.PlaneGeometry(.043, .034), glass, [0, layout.optic.y, .024]);
    if (!distant) for (const side of [-1, 1]) {
      sideDisc(.008, steel, side, layout.optic.y - .008, .007, .030);
      if (!compact) fastener(side, layout.optic.y + .008, .007, .030);
    }
  }
  for (const [group, batches] of pieces) for (const [mat, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((part) => part.dispose());
    if (!geometry) throw new Error("Could not merge firearm geometry");
    const mesh = new THREE.Mesh(geometry, mat);
    group.add(mesh);
  }
  magazine.position.set(layout.magazine.x, layout.magazine.y, layout.magazine.z);
  magazine.rotation.x = layout.magazine.pitch;
  root.add(magazine, bolt);
  const reticleMaterial = new THREE.MeshBasicMaterial({
    color: id === "graveglass" ? 0x8cf5cb : id === "pdw" ? 0x80dce9 : 0xf28d66, transparent: true, opacity: .9, depthWrite: false
  });
  const reticle = new THREE.Mesh(new THREE.CircleGeometry(.00085, 8), reticleMaterial);
  reticle.position.set(0, layout.optic.y, .029);
  reticle.visible = !magnified;
  if (!magnified && ["holo", "ring"].includes(specification.optic.reticle)) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.007, .00025, 4, 24), reticleMaterial);
    reticle.add(ring);
  }
  root.add(reticle);
  return { root, magazine, magazineMaterial, bolt, layout, reticle };
}
