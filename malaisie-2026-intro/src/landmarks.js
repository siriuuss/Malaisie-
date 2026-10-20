import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createFacadeMaterial } from "./facade.js";

// Real Kuala Lumpur landmarks, placed by their true offsets from the Petronas Towers
// (x = east, z = north, metres; from lat/lon: 1° lat ≈ 110.6 km, 1° lon ≈ 111.1 km at 3°N).
export const LANDMARKS = {
  menaraKL: { x: -866, z: -566 }, // 3.1528N 101.7038E, on Bukit Nanas
  merdeka118: { x: -1243, z: -1787 }, // 3.1418N 101.7004E
  exchange106: { x: 777, z: -1720 }, // 3.1424N 101.7186E
  fourSeasons: { x: -344, z: 222 }, // 3.1599N 101.7085E
};

// Lofted prism from a list of rings: [{ y, r, sides, rot }], flat-shaded facets.
function loft(rings) {
  const pos = [];
  const fac = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const n = a.sides;
    for (let k = 0; k < n; k++) {
      const p = (ring, j) => {
        const ang = ring.rot + (j / n) * Math.PI * 2;
        const rr = typeof ring.r === "function" ? ring.r(ang) : ring.r;
        return [Math.cos(ang) * rr, ring.y, Math.sin(ang) * rr];
      };
      const a0 = p(a, k);
      const a1 = p(a, k + 1);
      const b0 = p(b, k);
      const b1 = p(b, k + 1);
      const u0 = (k / n) * Math.PI * 2 * (typeof a.r === "number" ? a.r : 20);
      const u1 = ((k + 1) / n) * Math.PI * 2 * (typeof a.r === "number" ? a.r : 20);
      pos.push(...a0, ...b1, ...a1, ...a0, ...b0, ...b1);
      fac.push(u0, a.y, u1, b.y, u1, a.y, u0, a.y, u0, b.y, u1, b.y);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aFacade", new THREE.Float32BufferAttribute(fac, 2));
  g.computeVertexNormals();
  return g;
}

// Merdeka 118: faceted "songket" diamond skin, tapering to a long crowned spire (678.9 m).
function merdeka118() {
  const rings = [];
  const n = 8;
  for (let i = 0; i <= 26; i++) {
    const y = i * 19.5; // body to ~507 m
    const t = y / 507;
    const r = 34 * (1 - 0.42 * Math.pow(t, 1.4));
    rings.push({ y, r: i % 2 ? r * 0.93 : r, sides: n, rot: i % 2 ? Math.PI / n : 0 });
  }
  // faceted crown narrowing into the spire base
  const crown = [
    { y: 507, r: 19.5, sides: n, rot: 0 },
    { y: 528, r: 15, sides: n, rot: Math.PI / n },
    { y: 548, r: 10.5, sides: n, rot: 0 },
    { y: 566, r: 6.5, sides: n, rot: Math.PI / n },
    { y: 582, r: 3.6, sides: n, rot: 0 },
  ];
  const body = loft([...rings, ...crown]);
  const spire = new THREE.CylinderGeometry(0.25, 2.6, 678.9 - 582, 12).translate(0, 582 + (678.9 - 582) / 2, 0);
  return { body, spire };
}

// Exchange 106: rounded square plan, gentle taper, sloped crown (453 m).
function exchange106() {
  const rings = [];
  const sq = (half, corner) => (ang) => {
    // superellipse-ish rounded square
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const p = 6 + corner;
    return half / Math.pow(Math.pow(Math.abs(c), p) + Math.pow(Math.abs(s), p), 1 / p);
  };
  for (let i = 0; i <= 12; i++) {
    const y = i * 33;
    const half = 30 * (1 - 0.18 * (y / 396));
    rings.push({ y, r: sq(half, 0), sides: 64, rot: Math.PI / 4 });
  }
  rings.push({ y: 420, r: sq(21, 0), sides: 64, rot: Math.PI / 4 });
  rings.push({ y: 445, r: sq(12, 0), sides: 64, rot: Math.PI / 4 });
  const body = loft(rings);
  body.computeVertexNormals();
  const mast = new THREE.CylinderGeometry(0.4, 1.2, 12, 8).translate(0, 451, 0);
  return { body, mast };
}

// Four Seasons Place: slender curved slab (343 m).
function fourSeasons() {
  const rings = [];
  const ell = (a, b) => (ang) => 1 / Math.sqrt((Math.cos(ang) / a) ** 2 + (Math.sin(ang) / b) ** 2);
  for (let i = 0; i <= 10; i++) {
    const y = i * 31;
    rings.push({ y, r: ell(34, 17), sides: 48, rot: 0.6 });
  }
  rings.push({ y: 330, r: ell(28, 12), sides: 48, rot: 0.6 });
  rings.push({ y: 343, r: ell(14, 6), sides: 48, rot: 0.6 });
  return loft(rings);
}

// Menara Kuala Lumpur: tapering concrete shaft, onion-shaped pod (~276 m), antenna to 421 m.
function menaraKL() {
  const concrete = [];
  const glass = [];
  concrete.push(new THREE.CylinderGeometry(4.6, 6.8, 238, 32).translate(0, 119, 0));
  // pod profile (lathe), bulb inspired by Islamic onion domes
  const prof = [
    [0, 230],
    [7, 232],
    [13, 238],
    [19, 247],
    [22.5, 256],
    [23.5, 262],
    [22.8, 268],
    [24.5, 274],
    [24.5, 279],
    [21.5, 285],
    [16.5, 291],
    [11, 297],
    [6, 302],
    [4.5, 306],
    [0, 307],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  concrete.push(new THREE.LatheGeometry(prof, 64));
  // glazed observation bands
  glass.push(new THREE.CylinderGeometry(23.6, 23.0, 6.5, 64, 1, true).translate(0, 265, 0));
  glass.push(new THREE.CylinderGeometry(24.6, 24.6, 4.0, 64, 1, true).translate(0, 276.5, 0));
  // antenna: stepped mast
  const steps = [
    [306, 330, 3.2, 2.6],
    [330, 360, 2.2, 1.6],
    [360, 392, 1.3, 0.9],
    [392, 421, 0.6, 0.15],
  ];
  for (const [a, b, r0, r1] of steps) concrete.push(new THREE.CylinderGeometry(r1, r0, b - a, 16).translate(0, (a + b) / 2, 0));
  // entrance podium at the foot
  concrete.push(new THREE.CylinderGeometry(26, 28, 9, 48).translate(0, 4.5, 0));
  const clean = (arr) =>
    mergeGeometries(
      arr.map((g) => {
        const ng = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(ng.attributes)) if (!["position", "normal"].includes(k)) ng.deleteAttribute(k);
        return ng;
      }),
    );
  return { concrete: clean(concrete), glass: clean(glass) };
}

export function buildLandmarks(groundHeight) {
  const group = new THREE.Group();
  const shadow = (m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const glassMat = (style) => createFacadeMaterial("glass", { style });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc3c6cc, metalness: 1, roughness: 0.25 });
  const mats = [];

  {
    const { body, spire } = merdeka118();
    const m = glassMat([0, 0.62, 0.1, 1.5]);
    mats.push(m);
    const o = new THREE.Group();
    o.add(shadow(new THREE.Mesh(body, m)), shadow(new THREE.Mesh(spire, steel)));
    o.position.set(LANDMARKS.merdeka118.x, groundHeight(LANDMARKS.merdeka118.x, LANDMARKS.merdeka118.z), LANDMARKS.merdeka118.z);
    o.rotation.y = 0.3;
    group.add(o);
  }
  {
    const { body, mast } = exchange106();
    const m = glassMat([0, 0.15, 0.12, 1.4]);
    mats.push(m);
    const o = new THREE.Group();
    o.add(shadow(new THREE.Mesh(body, m)), shadow(new THREE.Mesh(mast, steel)));
    o.position.set(LANDMARKS.exchange106.x, groundHeight(LANDMARKS.exchange106.x, LANDMARKS.exchange106.z), LANDMARKS.exchange106.z);
    o.rotation.y = -0.2;
    group.add(o);
  }
  {
    const m = glassMat([0, 0.4, 0.15, 1.5]);
    mats.push(m);
    const o = shadow(new THREE.Mesh(fourSeasons(), m));
    o.position.set(LANDMARKS.fourSeasons.x, groundHeight(LANDMARKS.fourSeasons.x, LANDMARKS.fourSeasons.z), LANDMARKS.fourSeasons.z);
    group.add(o);
  }
  {
    const { concrete, glass } = menaraKL();
    const cm = new THREE.MeshStandardMaterial({ color: 0xcfc9c0, roughness: 0.75, metalness: 0.0, envMapIntensity: 0.45 });
    const gm = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.06, metalness: 0.6 });
    const o = new THREE.Group();
    o.add(shadow(new THREE.Mesh(concrete, cm)), shadow(new THREE.Mesh(glass, gm)));
    o.position.set(LANDMARKS.menaraKL.x, groundHeight(LANDMARKS.menaraKL.x, LANDMARKS.menaraKL.z) - 1, LANDMARKS.menaraKL.z);
    group.add(o);
  }
  group.userData.facadeMats = mats;
  return group;
}
