export function opticReticle(reticle) {
  const shapes = {
    chevron: '<path d="m181 207 19-17 19 17m-19 14v52m-12-24h24m-8 13h16"/>',
    mildot: '<path d="M44 200h130m52 0h130M200 44v130m0 52v130"/><circle cx="200" cy="250" r="2"/><circle cx="200" cy="280" r="2"/><circle cx="150" cy="200" r="2"/><circle cx="250" cy="200" r="2"/>',
    cross: '<path d="M90 200h92m36 0h92M200 90v92m0 36v92m-7 25h14m-11 18h8"/>',
    ring: '<circle cx="200" cy="200" r="36"/><path d="M200 146v14m0 80v14M146 200h14m80 0h14"/>',
    holo: '<circle cx="200" cy="200" r="26"/><path d="M200 166v9m0 50v9M166 200h9m50 0h9"/>',
    dot: ""
  };
  if (!Object.hasOwn(shapes, reticle)) throw new RangeError(`Unknown optic reticle: ${reticle}`);
  return `<g fill="none" stroke="#17231d" stroke-width="1.5">${shapes[reticle]}</g>
    <circle cx="200" cy="200" r="${reticle === "mildot" ? 1.5 : 2.2}" fill="#cf5940" stroke="#f4ecd1" stroke-width=".7"/>`;
}
