import * as THREE from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { makeTrack, mulberry32, smootherstep, clamp, lerp, invLerp, easeOutCubic } from "./util.js";
import { buildPetronas, TOWER_W, SPIRE_TOP } from "./petronas.js";

// World units are metres. The flight heads roughly -Z; KL lies beyond the jungle.
export const JUNGLE_END_Z = -430;
export const CITY_CENTER = new THREE.Vector3(0, 0, -1300);
// Title stands over the river, in a clearing so the letters read cleanly.
export const TITLE_Z = -60;
export const TITLE_POS = new THREE.Vector3(0, 0, TITLE_Z);

const noise = new ImprovedNoise();
export const riverX = (z) => 70 * Math.sin(z / 190 + 0.6) + 28 * Math.sin(z / 73 + 2.1) - 40;
TITLE_POS.x = riverX(TITLE_Z) - 25;

function fbm(x, z, oct = 5) {
  let s = 0;
  let a = 1;
  let f = 1 / 420;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise.noise(x * f, 0.37 * i, z * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// Hilly jungle that carves a river valley and flattens into the KL plain.
export function terrainHeight(x, z) {
  const hills = 75 * (fbm(x, z) + 0.35) + 40 * Math.max(0, fbm(x + 900, z - 300, 3));
  const d = Math.abs(x - riverX(z));
  const valley = 1 - Math.exp(-((d / 95) ** 2));
  let h = -6 + hills * valley + 8 * (1 - valley);
  const city = smootherstep(JUNGLE_END_Z + 60, JUNGLE_END_Z - 260, z);
  h = lerp(h, 4 + 6 * fbm(x * 3, z * 3, 2), city);
  return h;
}

// Sunset sun: low over the front-left of the flight, sinking through the shot.
export function sunDirAt(t) {
  const el = THREE.MathUtils.degToRad(lerp(9, 2.2, smootherstep(10, 21, t)));
  const az = new THREE.Vector3(-0.75, 0, -0.66).normalize();
  return new THREE.Vector3(az.x * Math.cos(el), Math.sin(el), az.z * Math.cos(el)).normalize();
}

export function buildGround(tex, font) {
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color("#E9B97C");
  scene.fog = new THREE.FogExp2(fogColor, 0.0018);

  // ---- Sky dome ---------------------------------------------------------------
  const skyUniforms = {
    uSun: { value: sunDirAt(10) },
    uHorizon: { value: new THREE.Color("#F2B06A") },
    uZenith: { value: new THREE.Color("#3D5A8A") },
    uSunCol: { value: new THREE.Color("#FFD9A0") },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(9000, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSunCol;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
          float mu = clamp(dot(d, uSun), 0.0, 1.0);
          col += uSunCol * (pow(mu, 8.0) * 0.55 + pow(mu, 64.0) * 1.2);
          col += uSunCol * smoothstep(0.99955, 0.9997, mu) * 18.0; // sun disc (HDR for bloom)
          col = mix(col, uHorizon * 0.9, smoothstep(0.02, -0.15, d.y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- Lights -----------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffc98a, 3.0);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffc690, 0x1c3a24, 0.9);
  scene.add(hemi);

  // ---- Terrain ----------------------------------------------------------------
  const size = 4200;
  const seg = 280;
  const tGeo = new THREE.PlaneGeometry(size, size, seg, seg);
  tGeo.rotateX(-Math.PI / 2);
  tGeo.translate(0, 0, -700);
  {
    const p = tGeo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const jungle = new THREE.Color("#143826");
    const moss = new THREE.Color("#2A5A33");
    const plain = new THREE.Color("#5B5A48");
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const h = terrainHeight(x, z);
      p.setY(i, h);
      c.copy(jungle).lerp(moss, clamp(h / 90));
      c.lerp(plain, smootherstep(JUNGLE_END_Z, JUNGLE_END_Z - 200, z));
      col.set([c.r, c.g, c.b], i * 3);
    }
    tGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    tGeo.computeVertexNormals();
  }
  const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  scene.add(terrain);
  const farGround = new THREE.Mesh(new THREE.CircleGeometry(30000, 64), new THREE.MeshStandardMaterial({ color: 0x4a4a3a, roughness: 1 }));
  farGround.rotation.x = -Math.PI / 2;
  farGround.position.set(0, -8, -700);
  scene.add(farGround);

  // ---- River ribbon -----------------------------------------------------------
  {
    const pts = [];
    for (let z = 700; z >= JUNGLE_END_Z - 120; z -= 10) pts.push([riverX(z), z]);
    const pos = [];
    const idx = [];
    pts.forEach(([x, z], i) => {
      const w = 16 + 5 * Math.sin(z / 40);
      pos.push(x - w, -1.2, z, x + w, -1.2, z);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2e6b6a, roughness: 0.08, metalness: 0.6, emissive: 0x6b4a22, emissiveIntensity: 0.6 }));
    scene.add(water);
  }

  // ---- Jungle trees (InstancedMesh) ------------------------------------------
  {
    const rand = mulberry32(101);
    const crown = new THREE.IcosahedronGeometry(1, 1);
    crown.scale(1, 0.75, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const max = 60000;
    const mesh = new THREE.InstancedMesh(crown, mat, max);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const c = new THREE.Color();
    const shades = ["#143826", "#1F4A2E", "#2A5A33", "#3B6A35", "#5C7F3A"].map((h) => new THREE.Color(h));
    let n = 0;
    for (let i = 0; i < max * 3 && n < max; i++) {
      const x = (rand() - 0.5) * 2600 + riverX(0) * 0;
      const z = 650 - rand() * (650 - (JUNGLE_END_Z - 60));
      const edge = JUNGLE_END_Z + 40 * fbm(x * 4, 0, 2);
      if (z < edge) continue;
      if (Math.abs(x - riverX(z)) < 24) continue;
      if (Math.hypot(x - TITLE_POS.x, (z - TITLE_POS.z) * 1.6) < 95) continue;
      const h = terrainHeight(x, z);
      const r = 4.5 + rand() * 6;
      pv.set(x, h + r * 0.8 + 8 + rand() * 10, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      s.set(r, r * (0.8 + rand() * 0.5), r);
      m.compose(pv, q, s);
      mesh.setMatrixAt(n, m);
      c.copy(shades[Math.floor(rand() * shades.length)]);
      mesh.setColorAt(n, c);
      n++;
    }
    mesh.count = n;
    scene.add(mesh);
  }

  // ---- KL skyline (procedural) ------------------------------------------------
  {
    const rand = mulberry32(303);
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2 });
    const max = 1600;
    const mesh = new THREE.InstancedMesh(box, mat, max);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let n = 0;
    for (let i = 0; i < max * 4 && n < max; i++) {
      const x = (rand() - 0.5) * 2400;
      const z = JUNGLE_END_Z - 140 - rand() * 2000;
      const d = Math.hypot(x - CITY_CENTER.x, z - CITY_CENTER.z);
      if (d < 170) continue; // KLCC park around the towers
      const core = Math.exp(-((d / 650) ** 2));
      const h = 15 + rand() * 50 + core * rand() * 230;
      const w = 18 + rand() * 30;
      const dd = 18 + rand() * 30;
      m.compose(new THREE.Vector3(x, terrainHeight(x, z) - 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, dd));
      mesh.setMatrixAt(n, m);
      c.setHSL(0.07 + rand() * 0.05, 0.12, 0.45 + rand() * 0.25);
      mesh.setColorAt(n, c);
      n++;
    }
    mesh.count = n;
    scene.add(mesh);
  }

  // ---- Petronas Towers --------------------------------------------------------
  const petronas = buildPetronas();
  petronas.position.copy(CITY_CENTER);
  scene.add(petronas);

  // ---- Bird silhouette on the west tower's spire ------------------------------
  const bird = buildBird();
  bird.position.set(CITY_CENTER.x - TOWER_W, SPIRE_TOP + 0.05, CITY_CENTER.z);
  {
    // Face the beak across the frame (profile) relative to the final camera.
    const sd = sunDirAt(21.5);
    const side = new THREE.Vector3().crossVectors(sd, new THREE.Vector3(0, 1, 0)).normalize();
    bird.rotation.y = Math.atan2(-side.z, side.x) + Math.PI;
  }
  scene.add(bird);

  // ---- Title: MALAISIE 2026, one mesh per glyph so letters can rise from the mist
  const title = new THREE.Group();
  const letters = [];
  {
    const text = "MALAISIE 2026";
    const size = 15;
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe3a947, metalness: 0.85, roughness: 0.28, emissive: 0x3a2205, emissiveIntensity: 0.4 });
    let x = 0;
    const glyphs = font.data.glyphs;
    const scale = size / font.data.resolution;
    for (const ch of text) {
      const adv = (glyphs[ch]?.ha ?? 300) * scale;
      if (ch !== " ") {
        const g = new TextGeometry(ch, { font, size, depth: 3.5, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.4, bevelSegments: 3 });
        const mesh = new THREE.Mesh(g, goldMat);
        mesh.position.x = x;
        title.add(mesh);
        letters.push(mesh);
      }
      x += adv + size * 0.1;
    }
    title.children.forEach((c) => (c.position.x -= x / 2));
  }
  // Stands over the river's left bank, angled toward the approaching camera.
  title.position.copy(TITLE_POS);
  title.rotation.y = 0.55;
  scene.add(title);

  // ---- Mist banks (soft noise sprites) ----------------------------------------
  const mist = [];
  {
    const rand = mulberry32(77);
    const mat = new THREE.SpriteMaterial({ map: tex.mist, color: 0xf1ddbb, transparent: true, depthWrite: false, opacity: 0.32, fog: true });
    for (let i = 0; i < 140; i++) {
      const z = 500 - rand() * 1000;
      const x = riverX(z) + (rand() - 0.5) * 700;
      const sp = new THREE.Sprite(mat);
      const w = 140 + rand() * 220;
      sp.scale.set(w, w * 0.28, 1);
      sp.position.set(x, terrainHeight(x, z) + 22 + rand() * 18, z);
      sp.material.rotation = 0;
      scene.add(sp);
      mist.push(sp);
    }
  }

  // ---- Cloud deck the camera descends through (9 → 10 s) ----------------------
  const deck = new THREE.Group();
  scene.add(deck);
  {
    const rand = mulberry32(55);
    for (let i = 0; i < 70; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.cloud, color: 0xfff1dc, transparent: true, depthWrite: false, opacity: 0.9, fog: false }));
      const w = 300 + rand() * 500;
      sp.scale.set(w, w * 0.55, 1);
      sp.position.set((rand() - 0.5) * 1400, 420 + rand() * 360, 520 - rand() * 600);
      deck.add(sp);
    }
  }

  // ---- Camera (bird flight) ---------------------------------------------------
  const rp = (z, alt, dx = 0) => [riverX(z) + dx, alt, z];
  const T = new THREE.Vector3(CITY_CENTER.x - TOWER_W, SPIRE_TOP, CITY_CENTER.z); // landing spire tip
  // Reveal: camera sits on the bird→sun line so the bird is silhouetted on the disc,
  // nudged so the pair lands slightly right of centre.
  const BIRD_EYE = T.clone().add(new THREE.Vector3(0, 0.32, 0));
  const revealAt = (t, dist) => BIRD_EYE.clone().addScaledVector(sunDirAt(t), -dist).add(new THREE.Vector3(0, -0.12, 0)).toArray();
  const revealTarget = (t) => {
    const s = sunDirAt(t);
    const side = new THREE.Vector3().crossVectors(s, new THREE.Vector3(0, 1, 0)).normalize();
    return BIRD_EYE.clone().addScaledVector(s, 12).addScaledVector(side, -2.2).add(new THREE.Vector3(0, 0.6, 0)).toArray();
  };
  const camPos = makeTrack([
    { t: 9.0, v: rp(560, 900) },
    { t: 10.1, v: rp(380, 140) },
    { t: 11.0, v: rp(300, 48) },
    { t: 12.5, v: rp(185, 44, 20) },
    { t: 13.4, v: rp(80, 42, 40) },
    { t: 14.3, v: rp(-100, 44, 55) },
    { t: 15.2, v: rp(-200, 52, 20) },
    { t: 16.2, v: rp(-300, 72) },
    { t: 17.2, v: [-150, 185, -650] },
    { t: 18.0, v: [-280, 300, -1000] },
    { t: 18.7, v: [-60, 375, -950] },
    { t: 19.3, v: [150, 420, -1080] },
    { t: 19.85, v: [T.x + 94, T.y - 3, T.z + 83] },
    { t: 20.35, v: [T.x + 0.45, T.y + 0.85, T.z + 0.4], hold: true },
    { t: 20.55, v: [T.x + 0.45, T.y + 0.72, T.z + 0.4], hold: true },
    { t: 21.0, v: revealAt(21.0, 15.5), hold: true },
    { t: 22.0, v: revealAt(22.0, 16.3) },
  ]);
  const camTgt = makeTrack([
    { t: 9.0, v: rp(250, 0) },
    { t: 10.1, v: rp(200, 20) },
    { t: 11.0, v: rp(120, 40) },
    { t: 12.5, v: [TITLE_POS.x, 30, TITLE_Z] },
    { t: 13.4, v: [TITLE_POS.x + 10, 30, TITLE_Z - 10] },
    { t: 14.3, v: rp(-260, 40) },
    { t: 15.2, v: rp(-360, 70) },
    { t: 16.2, v: [0, 200, -1300] },
    { t: 17.2, v: [0, 260, -1300] },
    { t: 18.0, v: [0, 300, -1300] },
    { t: 18.7, v: [0, 340, -1300] },
    { t: 19.3, v: [-20, 400, -1300] },
    { t: 19.85, v: [T.x, T.y, T.z] },
    { t: 20.35, v: [T.x - 45, T.y - 5, T.z - 40], hold: true },
    { t: 20.55, v: [T.x - 45, T.y - 7, T.z - 40], hold: true },
    { t: 21.0, v: revealTarget(21.0), hold: true },
    { t: 22.0, v: revealTarget(22.0) },
  ]);
  const camFov = makeTrack([
    { t: 9.0, v: 50 },
    { t: 11, v: 48 },
    { t: 16, v: 50 },
    { t: 18.7, v: 56 },
    { t: 20.35, v: 50 },
    { t: 20.55, v: 50 },
    { t: 21.0, v: 22 },
    { t: 22.0, v: 21 },
  ]);
  // Bank (roll) into the turns, in radians.
  const camRoll = makeTrack([
    { t: 9.0, v: 0 },
    { t: 11.0, v: 0.06 },
    { t: 12.5, v: -0.07 },
    { t: 13.4, v: 0.05 },
    { t: 14.3, v: 0.1 },
    { t: 15.2, v: -0.05 },
    { t: 16.2, v: 0 },
    { t: 17.2, v: 0.08 },
    { t: 18.0, v: 0.14 },
    { t: 18.7, v: -0.1 },
    { t: 19.3, v: -0.16 },
    { t: 19.85, v: -0.05 },
    { t: 20.35, v: 0 },
    { t: 22.0, v: 0 },
  ]);

  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  function update(t, camera) {
    const s = sunDirAt(t);
    skyUniforms.uSun.value.copy(s);
    const k = smootherstep(14, 21, t);
    skyUniforms.uHorizon.value.set("#F2B06A").lerp(new THREE.Color("#F2792B"), k);
    skyUniforms.uZenith.value.set("#3D5A8A").lerp(new THREE.Color("#2A2F5E"), k);
    scene.fog.color.copy(skyUniforms.uHorizon.value).lerp(new THREE.Color("#F1DDBB"), 0.25 * (1 - k));
    scene.fog.density = lerp(0.0018, 0.00055, smootherstep(15.2, 17.6, t));
    sun.position.copy(s).multiplyScalar(2000).add(camera.position);
    sun.target.position.copy(camera.position);
    sun.color.set("#FFC98A").lerp(new THREE.Color("#FF8E4A"), k);

    deck.visible = t < 10.6;
    bird.visible = t >= 20.5;
    // Title letters rise out of the mist, staggered.
    letters.forEach((l, i) => {
      const r = easeOutCubic(clamp(invLerp(11.4 + i * 0.09, 12.9 + i * 0.09, t)));
      l.position.y = lerp(-22, 24, r);
    });

    camera.position.fromArray(camPos(t));
    // Landing jolt: a damped dip right after touchdown.
    const jt = t - 20.35;
    if (jt > 0 && jt < 0.4) camera.position.y -= 0.18 * Math.sin(jt * 26) * Math.exp(-jt * 9);
    tmp.fromArray(camTgt(t));
    camera.up.set(0, 1, 0);
    camera.lookAt(tmp);
    fwd.subVectors(tmp, camera.position).normalize();
    camera.rotateZ(camRoll(t));
    camera.fov = camFov(t);
    camera.near = t > 20.2 ? 0.05 : 0.5;
    camera.far = 12000;
    camera.updateProjectionMatrix();
    sky.position.copy(camera.position);
  }

  return { scene, update };
}

// Perched raptor (Brahminy kite) built for a clean profile silhouette; local +X = beak.
function buildBird() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x120c0a, fog: false });
  const add = (geo, pos, rotZ = 0, scale = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.z = rotZ;
    m.scale.set(...scale);
    g.add(m);
    return m;
  };
  // Body: leaning forward ~30°, broad chest.
  add(new THREE.SphereGeometry(0.1, 20, 14), [0.0, 0.2, 0], -0.5, [1.0, 1.75, 0.9]);
  // Head + neck
  add(new THREE.SphereGeometry(0.062, 18, 12), [0.085, 0.385, 0], 0, [1.15, 1, 0.95]);
  add(new THREE.CylinderGeometry(0.045, 0.07, 0.1, 12), [0.06, 0.33, 0], -0.45);
  // Hooked beak
  add(new THREE.ConeGeometry(0.022, 0.075, 10), [0.155, 0.37, 0], -Math.PI / 2 - 0.55);
  // Folded wing riding the back, tips crossing past the tail
  add(new THREE.SphereGeometry(0.1, 16, 10), [-0.04, 0.17, 0.02], -0.62, [0.62, 2.05, 0.55]);
  // Tail
  add(new THREE.BoxGeometry(0.045, 0.2, 0.08), [-0.135, -0.02, 0], -0.55);
  // Legs gripping the finial
  add(new THREE.CylinderGeometry(0.009, 0.009, 0.09, 6), [0.02, 0.03, 0.025]);
  add(new THREE.CylinderGeometry(0.009, 0.009, 0.09, 6), [0.02, 0.03, -0.025]);
  return g;
}
