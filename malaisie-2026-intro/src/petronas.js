import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createFacadeMaterial } from "./facade.js";

// Petronas Twin Towers, modelled from the real architecture:
// - floor plate: two interlocking squares (8-pointed star) with eight semicircles set into
//   the inner angles -> 16-sided outline; 16 perimeter columns on the inner corners
// - 88 floors (~4.16 m), six setbacks with inward-sloping upper walls, roof ~378 m
// - 73.5 m pinnacle (ring ball, mast ball, needle) to 451.9 m
// - double-deck skybridge on floors 41-42 (170 m), 58.4 m long, propped from floor 29
// - a round 44-storey "bustle" annex beside each tower, Suria KLCC podium at the base
export const TOWER_R = 24.0; // circumradius of the star points (m)
export const SKYBRIDGE_LEN = 58.4;
export const TOWER_W = SKYBRIDGE_LEN / 2 + TOWER_R * 0.86; // half distance between tower centres
export const SPIRE_TOP = 451.9;
const FLOOR = 4.16;

// Outline radius of the 16-sided plate at angle theta, for unit circumradius.
function plateRadius(theta) {
  const q = Math.PI / 2;
  const phiA = (((theta % q) + q) % q) - Math.PI / 4;
  const phiB = ((((theta + Math.PI / 4) % q) + q) % q) - Math.PI / 4;
  const star = Math.max(Math.SQRT1_2 / Math.cos(phiA), Math.SQRT1_2 / Math.cos(phiB));
  // semicircle set into each inner angle (centred on the bisector)
  const sector = Math.PI / 4;
  const d = ((((theta - sector / 2) % sector) + sector) % sector) - sector / 2;
  const c = 0.5;
  const rho = 0.355;
  const s = c * Math.sin(d);
  const lobe = s * s < rho * rho ? c * Math.cos(d) + Math.sqrt(rho * rho - s * s) : 0;
  return Math.max(star, lobe);
}

// Closed 2D outline with crisp corners: dense sampling + exact star tips.
function plateOutline(samples = 640) {
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * Math.PI * 2;
    const r = plateRadius(th);
    pts.push(new THREE.Vector2(Math.cos(th) * r, Math.sin(th) * r));
  }
  return pts;
}
const OUTLINE = plateOutline();
const PERIM = OUTLINE.reduce((acc, p, i) => acc + p.distanceTo(OUTLINE[(i + 1) % OUTLINE.length]), 0);

// Wall band between y0 (scale s0) and y1 (scale s1), with hard normals at sharp corners.
function wallBand(y0, y1, s0, s1, R = TOWER_R) {
  const n = OUTLINE.length;
  const pos = [];
  const nor = [];
  const fac = [];
  const edgeN = OUTLINE.map((p, i) => {
    const q = OUTLINE[(i + 1) % n];
    return new THREE.Vector2(q.y - p.y, -(q.x - p.x)).normalize();
  });
  const slope = ((s0 - s1) * R) / (y1 - y0); // inward lean -> normal tilts up
  const vNormal = (i, edge) => {
    const a = edgeN[(i - 1 + n) % n];
    const b = edgeN[i % n];
    const nn = a.dot(b) > 0.86 ? a.clone().add(b).normalize() : (edge === "start" ? b : a).clone();
    return new THREE.Vector3(nn.x, slope, nn.y).normalize();
  };
  let u = 0;
  const sAvg = (s0 + s1) / 2;
  for (let i = 0; i < n; i++) {
    const p = OUTLINE[i];
    const q = OUTLINE[(i + 1) % n];
    const len = p.distanceTo(q) * R * sAvg;
    const nA = vNormal(i, "start");
    const nB = vNormal(i + 1, "end");
    const v = [
      [p.x * R * s0, y0, p.y * R * s0, nA, u, y0],
      [q.x * R * s0, y0, q.y * R * s0, nB, u + len, y0],
      [q.x * R * s1, y1, q.y * R * s1, nB, u + len, y1],
      [p.x * R * s1, y1, p.y * R * s1, nA, u, y1],
    ];
    for (const k of [0, 2, 1, 0, 3, 2]) {
      const [x, y, z, nn, fu, fv] = v[k];
      pos.push(x, y, z);
      nor.push(nn.x, nn.y, nn.z);
      fac.push(fu, fv);
    }
    u += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aFacade", new THREE.Float32BufferAttribute(fac, 2));
  return g;
}

// Horizontal ring (setback ledge / roof) between scales sIn and sOut at height y.
function ledge(y, sIn, sOut, R = TOWER_R) {
  const n = OUTLINE.length;
  const pos = [];
  for (let i = 0; i < n; i++) {
    const p = OUTLINE[i];
    const q = OUTLINE[(i + 1) % n];
    const a = [p.x * R * sOut, y, p.y * R * sOut];
    const b = [q.x * R * sOut, y, q.y * R * sOut];
    const c = [q.x * R * sIn, y, q.y * R * sIn];
    const d = [p.x * R * sIn, y, p.y * R * sIn];
    pos.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute("aFacade", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

function cylinderFacade(r0, r1, y0, y1, seg = 64) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, true);
  g.translate(0, (y0 + y1) / 2, 0);
  const p = g.attributes.position;
  const fac = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    fac[i * 2] = (a + Math.PI) * ((r0 + r1) / 2);
    fac[i * 2 + 1] = p.getY(i);
  }
  g.setAttribute("aFacade", new THREE.BufferAttribute(fac, 2));
  return g;
}

function steelParts(parts) {
  return mergeGeometries(
    parts.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(ng.attributes)) if (!["position", "normal"].includes(k)) ng.deleteAttribute(k);
      return ng;
    }),
  );
}

function buildTowerGeometry() {
  // [y0, y1, s0, s1] — six setbacks, upper walls leaning inward.
  const tiers = [
    [0, 241, 1.0, 1.0],
    [241, 287, 0.93, 0.9],
    [287, 320, 0.84, 0.8],
    [320, 341, 0.74, 0.69],
    [341, 356, 0.62, 0.57],
    [356, 370, 0.5, 0.44],
  ];
  const facade = [];
  const steel = [];
  for (let i = 0; i < tiers.length; i++) {
    const [y0, y1, s0, s1] = tiers[i];
    facade.push(wallBand(y0, y1, s0, s1));
    const next = tiers[i + 1];
    // stainless ledge at each setback, slightly proud of the wall
    steel.push(ledge(y1, next ? next[2] : 0.0, s1 + 0.015));
    steel.push(wallBand(y1 - 0.9, y1, s1 + 0.015, s1 + 0.015));
  }
  // Crown: fluted drum, stepped cone of rings, then the 73.5 m pinnacle.
  const R = TOWER_R;
  steel.push(new THREE.CylinderGeometry(R * 0.34, R * 0.4, 8, 48).translate(0, 374, 0));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    steel.push(new THREE.BoxGeometry(0.7, 9, 1.6).rotateY(-a).translate(Math.cos(a) * R * 0.4, 374.5, Math.sin(a) * R * 0.4));
  }
  const cone = [
    [378, 8.0],
    [381, 7.0],
    [384, 6.0],
    [387, 5.0],
    [390, 4.1],
    [393, 3.3],
  ];
  for (const [y, r] of cone) {
    steel.push(new THREE.CylinderGeometry(r * 0.88, r, 2.2, 40).translate(0, y + 1.1, 0));
    steel.push(new THREE.TorusGeometry(r * 1.02, 0.28, 8, 40).rotateX(Math.PI / 2).translate(0, y + 2.3, 0));
  }
  // ring ball
  steel.push(new THREE.SphereGeometry(3.4, 32, 20).translate(0, 400.5, 0));
  for (let k = -2; k <= 2; k++) {
    const y = 400.5 + k * 1.3;
    const rr = Math.sqrt(Math.max(0, 3.4 * 3.4 - (k * 1.3) ** 2)) + 0.35;
    steel.push(new THREE.TorusGeometry(rr, 0.16, 6, 36).rotateX(Math.PI / 2).translate(0, y, 0));
  }
  steel.push(new THREE.CylinderGeometry(1.25, 2.4, 6, 24).translate(0, 395.5, 0));
  // mast with rings
  steel.push(new THREE.CylinderGeometry(0.95, 1.35, 28, 20).translate(0, 418, 0));
  for (let y = 406; y < 431; y += 3.2) steel.push(new THREE.TorusGeometry(1.35 - (y - 404) * 0.014, 0.12, 6, 24).rotateX(Math.PI / 2).translate(0, y, 0));
  // mast ball + needle
  steel.push(new THREE.SphereGeometry(1.9, 24, 16).translate(0, 433.5, 0));
  steel.push(new THREE.CylinderGeometry(0.06, 0.75, SPIRE_TOP - 435, 16).translate(0, 435 + (SPIRE_TOP - 435) / 2, 0));
  steel.push(new THREE.SphereGeometry(0.12, 12, 8).translate(0, SPIRE_TOP, 0));

  // 16 perimeter columns visible at the colonnaded base
  for (let k = 0; k < 16; k++) {
    const a = ((k + 0.5) / 16) * Math.PI * 2;
    const r = plateRadius(a) * R * 0.97;
    steel.push(new THREE.CylinderGeometry(1.2, 1.2, 9, 16).translate(Math.cos(a) * r, 4.5, Math.sin(a) * r));
  }
  return { facade: mergeGeometries(facade), steel: steelParts(steel) };
}

function buildBustle() {
  const facade = [cylinderFacade(12, 12, 0, 150), cylinderFacade(12, 10.5, 150, 168), cylinderFacade(9.5, 8, 168, 181)];
  const steel = [
    new THREE.CylinderGeometry(12.2, 12.2, 0.8, 64).translate(0, 150.4, 0),
    new THREE.CylinderGeometry(10.7, 10.7, 0.8, 64).translate(0, 168.4, 0),
    new THREE.SphereGeometry(8, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, 181, 0),
  ];
  return { facade: mergeGeometries(facade), steel: steelParts(steel) };
}

function buildSkybridge(innerX) {
  const len = innerX * 2 + 2;
  const deck = new THREE.BoxGeometry(len, 9.4, 6.2).toNonIndexed();
  deck.translate(0, 172, 0);
  const p = deck.attributes.position;
  const fac = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    fac[i * 2] = p.getX(i) + p.getZ(i);
    fac[i * 2 + 1] = p.getY(i) - 167.3;
  }
  deck.setAttribute("aFacade", new THREE.BufferAttribute(fac, 2));
  const steel = [];
  // propping legs from floor 29 bearings to the bridge centre underside (two-hinged arch)
  for (const side of [-1, 1]) {
    for (const z of [-2.2, 2.2]) {
      const a = new THREE.Vector3(side * innerX, 29 * FLOOR, z);
      const b = new THREE.Vector3(0, 166.6, z * 0.6);
      const len2 = a.distanceTo(b);
      const leg = new THREE.CylinderGeometry(0.75, 0.75, len2, 12);
      const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
      leg.rotateX(Math.PI / 2).applyMatrix4(m).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      steel.push(leg);
      steel.push(new THREE.SphereGeometry(1.4, 16, 12).translate(a.x, a.y, a.z));
    }
  }
  steel.push(new THREE.BoxGeometry(len, 0.8, 6.8).translate(0, 167.1, 0));
  steel.push(new THREE.BoxGeometry(len, 0.6, 6.6).translate(0, 176.9, 0));
  return { facade: deck, steel: steelParts(steel) };
}

// Suria KLCC podium: low curved mall linking the tower bases.
function buildPodium() {
  const shape = new THREE.Shape();
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI * (0.08 + 0.84 * (i / 48));
    pts.push(new THREE.Vector2(Math.cos(a) * 165, Math.sin(a) * 105 - 20));
  }
  for (let i = 48; i >= 0; i--) {
    const a = Math.PI * (0.08 + 0.84 * (i / 48));
    pts.push(new THREE.Vector2(Math.cos(a) * 95, Math.sin(a) * 55 - 20));
  }
  shape.setFromPoints(pts);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 32, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  const gg = g.toNonIndexed();
  const p = gg.attributes.position;
  const fac = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    fac[i * 2] = p.getX(i) * 0.7 + p.getZ(i) * 0.7;
    fac[i * 2 + 1] = p.getY(i);
  }
  gg.setAttribute("aFacade", new THREE.BufferAttribute(fac, 2));
  gg.computeVertexNormals();
  return gg;
}

export function buildPetronas() {
  const group = new THREE.Group();
  const facadeMat = createFacadeMaterial("petronas");
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xe1e3e7, metalness: 1, roughness: 0.2, envMapIntensity: 1.6 });
  const tower = buildTowerGeometry();
  const bustle = buildBustle();
  const innerX = TOWER_W - TOWER_R * 0.86;
  const bridge = buildSkybridge(innerX);

  const add = (geo, mat, x = 0, z = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  for (const side of [-1, 1]) {
    const x = side * TOWER_W;
    add(tower.facade, facadeMat, x, 0, Math.PI / 16);
    add(tower.steel, steelMat, x, 0, Math.PI / 16);
    // bustle on the outer, slightly northern flank
    const a = side < 0 ? Math.PI * 0.86 : Math.PI * 0.14;
    const bx = x + Math.cos(a) * (TOWER_R + 9);
    const bz = 0 - Math.sin(a) * (TOWER_R + 9) * -1;
    add(bustle.facade, facadeMat, bx, bz);
    add(bustle.steel, steelMat, bx, bz);
  }
  add(bridge.facade, facadeMat);
  add(bridge.steel, steelMat);
  add(buildPodium(), createFacadeMaterial("petronas"), 0, 0);
  group.userData.facadeMats = [facadeMat];
  return group;
}

export { plateRadius, PERIM };
