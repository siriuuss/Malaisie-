import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createFacadeMaterial } from "./facade.js";
import { mulberry32 } from "./util.js";
import { scatterTrees } from "./forest.js";
import { LANDMARKS } from "./landmarks.js";

// Procedural Kuala Lumpur around KLCC: a rotated street grid with blocks split into lots,
// towers on podiums near the business hubs, mid-rise and low-rise further out, terraced
// houses with terracotta roofs on the northern fringe, rooftop plant, street trees,
// and traffic with headlights / tail-lights.

export const GRID_ROT = 0.21;
export const BLOCK = 132; // block pitch (m)
export const ROAD = 20; // road width (m)
export const AVENUE_EVERY = 4; // every 4th street is a wide avenue
export const AVENUE = 34;

export function cityZones(C) {
  // world-space exclusion zones / hubs, C = Petronas position
  const P = (o) => ({ x: C.x + o.x, z: C.z + o.z });
  return {
    petronas: { ...P({ x: 0, z: 0 }), r: 205 },
    park: { x0: C.x + 60, x1: C.x + 470, z0: C.z - 470, z1: C.z - 40 }, // KLCC Park, south-east of the towers
    hill: { ...P(LANDMARKS.menaraKL), r: 270 }, // Bukit Nanas forest reserve
    landmarks: Object.values(LANDMARKS).map((o) => ({ ...P(o), r: 75 })),
    hubs: [
      { ...P({ x: 0, z: 0 }), r: 950, w: 1 },
      { ...P({ x: -1000, z: -1600 }), r: 900, w: 0.9 }, // Bukit Bintang / Merdeka
      { ...P(LANDMARKS.exchange106), r: 650, w: 0.8 }, // TRX
      { ...P({ x: -1900, z: 300 }), r: 700, w: 0.45 }, // Chow Kit / Titiwangsa side
    ],
  };
}

export function toGrid(x, z) {
  const c = Math.cos(GRID_ROT);
  const s = Math.sin(GRID_ROT);
  return [x * c - z * s, x * s + z * c];
}
export function fromGrid(gx, gz) {
  const c = Math.cos(GRID_ROT);
  const s = Math.sin(GRID_ROT);
  return [gx * c + gz * s, -gx * s + gz * c];
}
const roadHalf = (i) => (i % AVENUE_EVERY === 0 ? AVENUE : ROAD) / 2;

function excluded(zones, x, z, pad = 0) {
  if (Math.hypot(x - zones.petronas.x, z - zones.petronas.z) < zones.petronas.r + pad) return true;
  const p = zones.park;
  if (x > p.x0 - pad && x < p.x1 + pad && z > p.z0 - pad && z < p.z1 + pad) return true;
  if (Math.hypot(x - zones.hill.x, z - zones.hill.z) < zones.hill.r + pad) return true;
  for (const l of zones.landmarks) if (Math.hypot(x - l.x, z - l.z) < l.r + pad) return true;
  return false;
}

function hubWeight(zones, x, z) {
  let w = 0;
  for (const h of zones.hubs) w = Math.max(w, h.w * Math.exp(-((Math.hypot(x - h.x, z - h.z) / h.r) ** 2)));
  return w;
}

// Unit building prototypes (base at y = 0, height 1, footprint 1x1).
function protoBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}
function protoStepped() {
  const a = new THREE.BoxGeometry(1, 0.86, 1).translate(0, 0.43, 0);
  const b = new THREE.BoxGeometry(0.78, 0.1, 0.78).translate(0, 0.91, 0);
  const c = new THREE.BoxGeometry(0.5, 0.04, 0.5).translate(0, 0.98, 0);
  return mergeGeometries([a, b, c]);
}
function protoCylinder() {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
  g.translate(0, 0.5, 0);
  return g;
}
function protoOctagon() {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  g.rotateY(Math.PI / 8);
  g.translate(0, 0.5, 0);
  return g;
}

export function buildCity({ C, terrainHeight, sunDir, foliageMat, extent }) {
  const group = new THREE.Group();
  const zones = cityZones(C);
  const rand = mulberry32(4242);

  const protos = [
    { geo: protoBox(), radial: false, list: [] },
    { geo: protoStepped(), radial: false, list: [] },
    { geo: protoCylinder(), radial: true, list: [] },
    { geo: protoOctagon(), radial: true, list: [] },
  ];
  const roofBits = [];
  const podiums = [];
  const houses = [];

  // Iterate blocks over the city extent in grid space.
  const [gx0, gz0] = [-6200, -7600];
  for (let bi = Math.floor(gx0 / BLOCK); bi < 6200 / BLOCK; bi++) {
    for (let bj = Math.floor(gz0 / BLOCK); bj < 3000 / BLOCK; bj++) {
      const bxa = bi * BLOCK + roadHalf(bi);
      const bxb = (bi + 1) * BLOCK - roadHalf(bi + 1);
      const bza = bj * BLOCK + roadHalf(bj);
      const bzb = (bj + 1) * BLOCK - roadHalf(bj + 1);
      const [cx, cz] = fromGrid((bxa + bxb) / 2, (bza + bzb) / 2);
      if (!extent(cx, cz)) continue;
      const fringe = extent(cx, cz) === "fringe";
      // lot subdivision
      const split = fringe ? 3 : rand() < 0.35 ? 1 : 2;
      const lw = (bxb - bxa) / split;
      const ld = (bzb - bza) / split;
      for (let li = 0; li < split; li++) {
        for (let lj = 0; lj < split; lj++) {
          const lx0 = bxa + li * lw;
          const lz0 = bza + lj * ld;
          const [x, z] = fromGrid(lx0 + lw / 2, lz0 + ld / 2);
          if (excluded(zones, x, z, Math.max(lw, ld) * 0.5)) continue;
          const y = terrainHeight(x, z) - 0.5;
          if (fringe) {
            // terraced houses: rows along the lot
            const rows = 2;
            for (let r = 0; r < rows; r++) {
              for (let k = 0; k < 6; k++) {
                const hx = lx0 + 6 + k * ((lw - 12) / 6) + 3;
                const hz = lz0 + 10 + r * (ld - 20) * 0.9;
                const [wx, wz] = fromGrid(hx, hz);
                houses.push({ x: wx, z: wz, y: terrainHeight(wx, wz), w: (lw - 12) / 6 - 0.4, d: 15, h: 7 + rand() * 1.5, c: rand() });
              }
            }
            continue;
          }
          const hub = hubWeight(zones, x, z);
          const r1 = rand();
          let floors = Math.round(3 + rand() * 7 + hub * Math.pow(r1, 0.8) * 62 * (rand() < 0.75 ? 1 : 0.35));
          if (hub < 0.12) floors = Math.round(2 + rand() * 6 + (rand() < 0.08 ? rand() * 18 : 0));
          const h = Math.max(8, floors * 3.7);
          const tall = h > 110;
          const set = 5 + rand() * 6;
          let w = lw - set * 2;
          let d = ld - set * 2;
          if (tall) {
            // tower on a podium
            const pw = lw - 4;
            const pd = ld - 4;
            const ph = 14 + rand() * 16;
            podiums.push({ x, z, y, w: pw, d: pd, h: ph, style: rand() < 0.5 ? 1 : 2, seed: rand() });
            const t = Math.min(w, d, 34 + rand() * 22);
            w = t * (0.85 + rand() * 0.35);
            d = t;
          }
          const style = tall ? (rand() < 0.62 ? 0 : 3) : rand() < 0.45 ? 1 : rand() < 0.7 ? 2 : rand() < 0.5 ? 3 : 0;
          const pick = tall ? (rand() < 0.42 ? 1 : rand() < 0.4 ? 2 : rand() < 0.3 ? 3 : 0) : rand() < 0.9 ? 0 : 1;
          const p = protos[pick];
          const rot = (rand() < 0.85 ? 0 : (rand() - 0.5) * 0.6) - GRID_ROT;
          p.list.push({ x, z, y, w, d: p.radial ? w : d, h, rot, style, seed: rand(), lit: 0.03 + rand() * 0.08, mod: style === 0 ? 1.4 + rand() * 0.4 : 1.6 + rand() * 1.4 });
          // rooftop plant
          const bits = tall ? 2 + Math.floor(rand() * 3) : rand() < 0.6 ? 1 + Math.floor(rand() * 2) : 0;
          for (let k = 0; k < bits; k++) {
            const bw = 3 + rand() * (tall ? 9 : 6);
            const ox = (rand() - 0.5) * (w * 0.5);
            const oz = (rand() - 0.5) * (d * 0.5);
            const [ex, ez] = [ox * Math.cos(-rot) - oz * Math.sin(-rot), ox * Math.sin(-rot) + oz * Math.cos(-rot)];
            roofBits.push({ x: x + ex, z: z + ez, y: y + h * (pick === 1 ? 1.0 : 1.0), w: bw, d: bw * (0.6 + rand() * 0.8), h: 2 + rand() * 4, rot });
          }
          if (tall && rand() < 0.35) roofBits.push({ x, z, y: y + h, w: 0.8, d: 0.8, h: 12 + rand() * 22, rot });
        }
      }
    }
  }

  // ---- instanced buildings ------------------------------------------------------
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const facadeMats = [];
  const makeInstanced = (geo, mat, list, styleOf) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const style = new Float32Array(list.length * 4);
    list.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot ?? -GRID_ROT);
      mtx.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, mtx);
      style.set(styleOf(b), i * 4);
    });
    mesh.count = list.length;
    mesh.geometry = geo.clone();
    mesh.geometry.setAttribute("aStyle", new THREE.InstancedBufferAttribute(style, 4));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  };
  for (const p of protos) {
    if (!p.list.length) continue;
    const mat = createFacadeMaterial("city", { radial: p.radial });
    facadeMats.push(mat);
    makeInstanced(p.geo, mat, p.list, (b) => [b.style, b.seed, b.lit, b.mod]);
  }
  {
    const mat = createFacadeMaterial("city", { radial: false });
    facadeMats.push(mat);
    makeInstanced(protoBox(), mat, podiums, (b) => [b.style, b.seed, 0.1, 2.2]);
  }
  // rooftop plant: plain concrete/metal boxes
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8a85, roughness: 0.75, metalness: 0.2 });
    const mesh = new THREE.InstancedMesh(protoBox(), mat, Math.max(1, roofBits.length));
    roofBits.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      mtx.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, mtx);
    });
    mesh.count = roofBits.length;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  // terraced houses: walls + terracotta gable roofs
  {
    const wallMat = createFacadeMaterial("city", { radial: false });
    facadeMats.push(wallMat);
    makeInstanced(protoBox(), wallMat, houses.map((b) => ({ ...b, rot: -GRID_ROT })), (b) => [3, b.c, 0.08, 2.5]);
    const roofGeo = new THREE.CylinderGeometry(0.62, 0.62, 1, 3, 1);
    roofGeo.rotateZ(Math.PI / 2);
    roofGeo.rotateY(Math.PI / 2);
    roofGeo.scale(1.1, 0.55, 1.05);
    roofGeo.translate(0, 0.15, 0);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, Math.max(1, houses.length));
    const c = new THREE.Color();
    houses.forEach((b, i) => {
      q.setFromAxisAngle(up, -GRID_ROT);
      mtx.compose(new THREE.Vector3(b.x, b.y + b.h, b.z), q, new THREE.Vector3(b.w, 4.5, b.d));
      roofs.setMatrixAt(i, mtx);
      c.setHSL(0.03 + b.c * 0.03, 0.55, 0.32 + b.c * 0.1);
      roofs.setColorAt(i, c);
    });
    roofs.count = houses.length;
    roofs.castShadow = true;
    roofs.receiveShadow = true;
    roofs.computeBoundingSphere();
    group.add(roofs);
  }

  // ---- street trees, KLCC park and Bukit Nanas forest ----------------------------
  {
    const park = zones.park;
    const hill = zones.hill;
    const trees = scatterTrees({
      count: 9000,
      seed: 77,
      material: foliageMat,
      simple: true,
      cell: 500,
      place: (i, r) => {
        const kind = r();
        let x;
        let z;
        if (kind < 0.25) {
          x = park.x0 + r() * (park.x1 - park.x0);
          z = park.z0 + r() * (park.z1 - park.z0);
          if (Math.hypot(x - (park.x0 + park.x1) / 2, z - (park.z0 + park.z1) / 2) < 120) return null; // lake
        } else if (kind < 0.55) {
          const a = r() * Math.PI * 2;
          const d = Math.sqrt(r()) * hill.r;
          x = hill.x + Math.cos(a) * d;
          z = hill.z + Math.sin(a) * d;
          if (d < 35) return null;
        } else {
          // street trees along road edges
          const gi = Math.floor((r() - 0.5) * 70);
          const along = (r() - 0.5) * 9000;
          const side = r() < 0.5 ? -1 : 1;
          const [gx, gz] = r() < 0.5 ? [gi * BLOCK + side * (roadHalf(gi) - 2), along] : [along, gi * BLOCK + side * (roadHalf(gi) - 2)];
          [x, z] = fromGrid(gx, gz);
          if (!extent(x, z) || extent(x, z) === "fringe") return null;
          if (excluded(zones, x, z)) return null;
        }
        const rr = 4 + r() * 4;
        return { x, y: terrainHeight(x, z) + rr * 0.55 + 4, z, r: rr };
      },
    });
    trees.forEach((t) => group.add(t));
  }

  // ---- KLCC park lake ----------------------------------------------------------------
  {
    const p = zones.park;
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshStandardMaterial({ color: 0x1b2a2c, roughness: 0.04, metalness: 0.9 }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(130, 85, 1);
    lake.position.set((p.x0 + p.x1) / 2, terrainHeight((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2) + 0.4, (p.z0 + p.z1) / 2);
    lake.receiveShadow = true;
    group.add(lake);
  }

  // ---- traffic ------------------------------------------------------------------------
  const cars = buildTraffic({ extent, zones, terrainHeight });
  group.add(cars.mesh);

  group.userData.facadeMats = facadeMats;
  return { group, zones, updateTraffic: cars.update, carMaterial: cars.material };
}

function buildTraffic({ extent, zones, terrainHeight }) {
  const rand = mulberry32(99);
  const lanes = [];
  for (let k = 0; k < 44; k++) {
    const horiz = rand() < 0.5;
    const gi = Math.floor((rand() - 0.5) * 80);
    const avenue = gi % AVENUE_EVERY === 0;
    const nLanes = avenue ? 3 : 1;
    for (const dir of [-1, 1]) {
      for (let l = 0; l < nLanes; l++) {
        const off = dir * (2.2 + l * 3.4);
        lanes.push({ horiz, line: gi * BLOCK + off, dir, speed: 9 + rand() * 8, phase: rand() * 1000, density: avenue ? 1 / 30 : 1 / 70 });
      }
    }
  }
  const cars = [];
  for (const ln of lanes) {
    const n = Math.floor(9000 * ln.density);
    for (let i = 0; i < n; i++) cars.push({ ln, s0: i / ln.density + rand() * 8, color: rand() });
  }
  const geo = new THREE.BoxGeometry(1.9, 1.45, 4.5);
  geo.translate(0, 0.75, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.6 });
  const uniforms = { uLights: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLocal;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal; uniform float uLights;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         float front = step(2.2, vLocal.z) * step(vLocal.y, 0.95);
         float rear = step(vLocal.z, -2.2) * step(vLocal.y, 1.0);
         totalEmissiveRadiance += (vec3(1.0, 0.92, 0.75) * front * 9.0 + vec3(1.0, 0.06, 0.03) * rear * 5.0) * uLights;`,
      );
  };
  mat.customProgramCacheKey = () => "cars";
  mat.userData.uniforms = uniforms;
  const mesh = new THREE.InstancedMesh(geo, mat, cars.length);
  const c = new THREE.Color();
  const palette = ["#e8e8e8", "#1b1b1d", "#8a8d92", "#5c0f12", "#1f3550", "#c9c3b5", "#f2f2f2"].map((h) => new THREE.Color(h));
  cars.forEach((car, i) => mesh.setColorAt(i, c.copy(palette[Math.floor(car.color * palette.length)])));
  mesh.count = cars.length;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zero = new THREE.Vector3(0, 0, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const L = 9000;
  function update(t) {
    cars.forEach((car, i) => {
      const ln = car.ln;
      let s = (car.s0 + ln.phase + ln.speed * t * ln.dir) % L;
      if (s < 0) s += L;
      s -= L / 2;
      const [gx, gz] = ln.horiz ? [s, ln.line] : [ln.line, s];
      const [x, z] = fromGrid(gx, gz);
      const ok = extent(x, z) && extent(x, z) !== "fringe" && !excluded(zones, x, z, 2);
      const heading = (ln.horiz ? Math.PI / 2 : 0) + (ln.dir < 0 ? Math.PI : 0) - GRID_ROT;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      mtx.compose(new THREE.Vector3(x, terrainHeight(x, z) + 0.1, z), q, ok ? one : zero);
      mesh.setMatrixAt(i, mtx);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update, material: mat };
}
