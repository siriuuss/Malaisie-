import * as THREE from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { makeTrack, mulberry32, smootherstep, clamp, lerp, invLerp, easeOutCubic } from "./util.js";
import { buildPetronas, TOWER_W, SPIRE_TOP } from "./petronas.js";
import { buildLandmarks, LANDMARKS } from "./landmarks.js";
import { buildCity, BLOCK, ROAD, AVENUE, AVENUE_EVERY, GRID_ROT } from "./city.js";
import { createFoliageMaterial, scatterTrees } from "./forest.js";
import { createSkyMaterial, createSkyMesh, bakeEnvironment } from "./sky.js";
import { buildWings, headYawOffset } from "./bird.js";

// World units are metres; +X = east, +Z = north. The bird flies south from the jungle
// north of KL (Batu Caves side) toward KLCC; the sun sets in the west-south-west.
export const JUNGLE_END_Z = -430;
export const CITY_CENTER = new THREE.Vector3(0, 0, -1300);
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

const HILL = { x: CITY_CENTER.x + LANDMARKS.menaraKL.x, z: CITY_CENTER.z + LANDMARKS.menaraKL.z };
export function terrainHeight(x, z) {
  const hills = 75 * (fbm(x, z) + 0.35) + 40 * Math.max(0, fbm(x + 900, z - 300, 3));
  const d = Math.abs(x - riverX(z));
  const valley = 1 - Math.exp(-((d / 95) ** 2));
  let h = -6 + hills * valley + 8 * (1 - valley);
  const city = smootherstep(JUNGLE_END_Z + 60, JUNGLE_END_Z - 260, z);
  h = lerp(h, 4 + 3 * fbm(x * 2, z * 2, 2), city);
  // Bukit Nanas, the forested hill under Menara KL
  h += 48 * Math.exp(-((Math.hypot(x - HILL.x, z - HILL.z) / 210) ** 2));
  return h;
}

export function sunDirAt(t) {
  const el = THREE.MathUtils.degToRad(lerp(9, 2.3, smootherstep(10, 21, t)));
  const az = new THREE.Vector3(-0.75, 0, -0.66).normalize();
  return new THREE.Vector3(az.x * Math.cos(el), Math.sin(el), az.z * Math.cos(el)).normalize();
}

function setSky(u, t) {
  const k = smootherstep(13, 21, t);
  u.uSun.value.copy(sunDirAt(t));
  u.uHorizon.value.set("#F4B56E").lerp(new THREE.Color("#F27A30"), k);
  u.uZenith.value.set("#4A6A9C").lerp(new THREE.Color("#33477C"), k);
  u.uAnti.value.set("#9AA7C2").lerp(new THREE.Color("#7C6A92"), k);
  u.uSunCol.value.set("#FFE1A8").lerp(new THREE.Color("#FFB070"), k);
  u.uCloud.value = 0.7;
}

export function buildGround(tex, font, renderer) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color("#E9B97C"), 0.0018);

  // ---- Sky + baked environments ----------------------------------------------------
  const sky = createSkyMaterial();
  const skyMesh = createSkyMesh(sky.material);
  scene.add(skyMesh);
  setSky(sky.uniforms, 12);
  const envJungle = bakeEnvironment(renderer, sky.material);
  setSky(sky.uniforms, 19.5);
  const envCity = bakeEnvironment(renderer, sky.material);

  // ---- Lights -----------------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffc98a, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffc690, 0x1c2a1c, 0.35);
  scene.add(hemi);

  // ---- Terrain: detailed jungle tile + city plain ------------------------------------
  const makeTerrain = (x0, x1, z0, z1, step, material) => {
    const w = x1 - x0;
    const d = z0 - z1;
    const g = new THREE.PlaneGeometry(w, d, Math.round(w / step), Math.round(d / step));
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, terrainHeight(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  };
  const jungleGround = new THREE.MeshStandardMaterial({ color: 0x1a2a17, roughness: 1 });
  scene.add(makeTerrain(-2300, 2300, 950, -660, 14, jungleGround));
  const cityGround = createCityGroundMaterial(CITY_CENTER);
  scene.add(makeTerrain(-6400, 4400, -640, -8200, 24, cityGround));
  const farGround = new THREE.Mesh(new THREE.CircleGeometry(40000, 64), new THREE.MeshStandardMaterial({ color: 0x5a554a, roughness: 1 }));
  farGround.rotation.x = -Math.PI / 2;
  farGround.position.set(0, -2, -2000);
  scene.add(farGround);

  // ---- River ----------------------------------------------------------------------------
  const water = createWaterMaterial();
  {
    const pos = [];
    const idx = [];
    let i = 0;
    for (let z = 950; z >= JUNGLE_END_Z - 160; z -= 6, i++) {
      const x = riverX(z);
      const w = 16 + 5 * Math.sin(z / 40);
      pos.push(x - w, -1.2, z, x + w, -1.2, z);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const river = new THREE.Mesh(g, water);
    river.receiveShadow = true;
    scene.add(river);
  }

  // ---- Jungle --------------------------------------------------------------------------
  const sunDir0 = sunDirAt(12);
  const foliage = createFoliageMaterial(sunDir0.clone());
  const jungle = new THREE.Group();
  scene.add(jungle);
  {
    const near = scatterTrees({
      count: 14000,
      seed: 101,
      material: foliage,
      place: (i, r) => {
        const z = 950 - r() * (950 - (JUNGLE_END_Z - 90));
        const x = riverX(z) + (r() - 0.5) * 900;
        const edge = JUNGLE_END_Z + 50 * fbm(x * 4, 0, 2);
        if (z < edge) return null;
        if (Math.abs(x - riverX(z)) < 22 + r() * 6) return null;
        if (Math.hypot(x - TITLE_POS.x, (z - TITLE_POS.z) * 1.6) < 95) return null;
        const emergent = r() < 0.08;
        const rr = emergent ? 11 + r() * 6 : 5 + r() * 4.5;
        const lift = emergent ? 30 + r() * 10 : 14 + r() * 12;
        return { x, y: terrainHeight(x, z) + lift, z, r: rr, hScale: emergent ? 0.75 : 1 };
      },
    });
    near.forEach((m) => jungle.add(m));
    const far = scatterTrees({
      count: 14000,
      seed: 202,
      material: foliage,
      castShadow: false,
      simple: true,
      cell: 600,
      place: (i, r) => {
        const z = 950 - r() * (950 - (JUNGLE_END_Z - 60));
        const off = (r() < 0.5 ? -1 : 1) * (450 + r() * 1400);
        const x = riverX(z) + off;
        if (z < JUNGLE_END_Z + 50 * fbm(x * 4, 0, 2)) return null;
        const rr = 7 + r() * 6;
        return { x, y: terrainHeight(x, z) + 18 + r() * 12, z, r: rr };
      },
    });
    far.forEach((m) => jungle.add(m));
  }

  // ---- Kuala Lumpur ----------------------------------------------------------------------
  const extent = (x, z) => {
    if (z > JUNGLE_END_Z - 40) return false;
    if (z < -8000 || x < -6200 || x > 4200) return false;
    if (z > -760) return "fringe";
    return true;
  };
  const city = buildCity({ C: CITY_CENTER, terrainHeight, sunDir: sunDir0, foliageMat: foliage, extent });
  scene.add(city.group);
  const petronas = buildPetronas();
  petronas.position.copy(CITY_CENTER);
  petronas.position.y = terrainHeight(CITY_CENTER.x, CITY_CENTER.z) - 0.5;
  scene.add(petronas);
  const landmarks = buildLandmarks((x, z) => terrainHeight(x + CITY_CENTER.x, z + CITY_CENTER.z));
  landmarks.position.set(CITY_CENTER.x, 0, CITY_CENTER.z);
  scene.add(landmarks);
  const facadeMats = [...city.group.userData.facadeMats, ...petronas.userData.facadeMats, ...landmarks.userData.facadeMats];

  // ---- Title: MALAISIE 2026 ----------------------------------------------------------------
  const title = new THREE.Group();
  const letters = [];
  {
    const text = "MALAISIE 2026";
    const size = 15;
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8b04f, metalness: 1, roughness: 0.2, envMapIntensity: 1.3 });
    let x = 0;
    const glyphs = font.data.glyphs;
    const scale = size / font.data.resolution;
    for (const ch of text) {
      const adv = (glyphs[ch]?.ha ?? 300) * scale;
      if (ch !== " ") {
        const g = new TextGeometry(ch, { font, size, depth: 3.5, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.42, bevelSegments: 4 });
        const mesh = new THREE.Mesh(g, gold);
        mesh.position.x = x;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        title.add(mesh);
        letters.push(mesh);
      }
      x += adv + size * 0.1;
    }
    title.children.forEach((c) => (c.position.x -= x / 2));
  }
  title.position.copy(TITLE_POS);
  title.rotation.y = 0.55;
  scene.add(title);

  // ---- Mist banks + cloud deck -----------------------------------------------------------
  const mistGroup = new THREE.Group();
  scene.add(mistGroup);
  {
    const rand = mulberry32(77);
    const mat = new THREE.SpriteMaterial({ map: tex.mist, color: 0xf3e2c6, transparent: true, depthWrite: false, opacity: 0.3, fog: true });
    for (let i = 0; i < 160; i++) {
      const z = 600 - rand() * 1050;
      const x = riverX(z) + (rand() - 0.5) * 800;
      const sp = new THREE.Sprite(mat);
      const w = 140 + rand() * 240;
      sp.scale.set(w, w * 0.22, 1);
      sp.position.set(x, terrainHeight(x, z) + 20 + rand() * 16, z);
      mistGroup.add(sp);
    }
    // the title's own mist bank
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(mat);
      const w = 70 + rand() * 90;
      sp.scale.set(w, w * 0.3, 1);
      sp.position.set(TITLE_POS.x + (rand() - 0.5) * 170, 2 + rand() * 9, TITLE_POS.z + (rand() - 0.5) * 70);
      mistGroup.add(sp);
    }
  }
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

  // ---- The bird's wings (seen from its eyes) --------------------------------------------
  const wings = buildWings();
  scene.add(wings.rig);

  // ---- Camera = the bird's eyes --------------------------------------------------------------
  const rp = (z, alt, dx = 0) => [riverX(z) + dx, alt, z];
  const T = new THREE.Vector3(CITY_CENTER.x - TOWER_W, SPIRE_TOP + petronas.position.y, CITY_CENTER.z); // west tower needle tip
  const EYE = T.clone().add(new THREE.Vector3(0, 0.34, 0));
  const HEADING = new THREE.Vector3(-0.7, 0, 0.7).normalize(); // lands facing north-west
  // Gaze after the head turn: toward the sunset between Merdeka 118 and Menara KL.
  const azimuth = (v) => Math.atan2(-v.z, v.x); // grows with a +Y rotation
  let GAZE_YAW = azimuth(new THREE.Vector3(-0.7, 0, -0.71)) - azimuth(HEADING);
  GAZE_YAW = Math.atan2(Math.sin(GAZE_YAW), Math.cos(GAZE_YAW)); // shortest turn (~ -90°)
  const approach = (k, dy = 0) => EYE.clone().addScaledVector(HEADING, -k).add(new THREE.Vector3(0, dy, 0)).toArray();
  const look = (k, dy = 0) => EYE.clone().addScaledVector(HEADING, k).add(new THREE.Vector3(0, dy, 0)).toArray();

  const camPos = makeTrack([
    { t: 9.0, v: rp(560, 900) },
    { t: 10.1, v: rp(380, 140) },
    { t: 11.0, v: rp(300, 48) },
    { t: 12.5, v: rp(185, 44, 20) },
    { t: 13.4, v: rp(80, 42, 40) },
    { t: 14.3, v: rp(-100, 44, 55) },
    { t: 15.2, v: rp(-200, 52, 20) },
    { t: 16.2, v: rp(-300, 72) },
    { t: 17.1, v: [120, 170, -700] },
    { t: 17.9, v: [300, 280, -1080] },
    { t: 18.6, v: [290, 350, -1470] },
    { t: 19.25, v: [110, 405, -1560] },
    { t: 19.8, v: approach(85, -4) },
    { t: 20.15, v: approach(9, 0.8) },
    { t: 20.33, v: EYE.toArray(), hold: true },
    { t: 22.0, v: EYE.toArray() },
  ]);
  const camTgt = makeTrack([
    { t: 9.0, v: rp(250, 0) },
    { t: 10.1, v: rp(200, 20) },
    { t: 11.0, v: rp(120, 40) },
    { t: 12.5, v: [TITLE_POS.x, 30, TITLE_Z] },
    { t: 13.4, v: [TITLE_POS.x + 10, 30, TITLE_Z - 10] },
    { t: 14.3, v: rp(-260, 40) },
    { t: 15.2, v: rp(-360, 70) },
    { t: 16.2, v: [0, 220, -1300] },
    { t: 17.1, v: [0, 260, -1300] },
    { t: 17.9, v: [0, 300, -1300] },
    { t: 18.6, v: [-20, 340, -1300] },
    { t: 19.25, v: [T.x, 420, T.z] },
    { t: 19.8, v: [T.x, T.y, T.z] },
    { t: 20.15, v: look(60, -9) },
    { t: 20.33, v: look(60, -7), hold: true },
    { t: 22.0, v: look(60, -6) },
  ]);
  const camFov = makeTrack([
    { t: 9.0, v: 52 },
    { t: 11, v: 50 },
    { t: 16, v: 52 },
    { t: 18.6, v: 58 },
    { t: 20.33, v: 62 },
    { t: 20.95, v: 60 },
    { t: 21.75, v: 44 },
    { t: 22.0, v: 43.5 },
  ]);
  const camRoll = makeTrack([
    { t: 9.0, v: 0 },
    { t: 11.0, v: 0.06 },
    { t: 12.5, v: -0.07 },
    { t: 13.4, v: 0.05 },
    { t: 14.3, v: 0.1 },
    { t: 15.2, v: -0.05 },
    { t: 16.2, v: 0 },
    { t: 17.1, v: -0.12 },
    { t: 17.9, v: -0.16 },
    { t: 18.6, v: -0.2 },
    { t: 19.25, v: -0.12 },
    { t: 19.8, v: 0.02 },
    { t: 20.33, v: 0 },
    { t: 22.0, v: 0 },
  ]);

  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const sunFocus = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  function update(t, camera) {
    const s = sunDirAt(t);
    setSky(sky.uniforms, t);
    const k = smootherstep(13, 21, t);
    scene.environment = t < 15.6 ? envJungle : envCity;
    scene.environmentIntensity = lerp(0.9, 0.75, k);
    // fog takes the sky's own horizon colour in the viewing direction so the haze melts into it
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const mu = fwd.dot(new THREE.Vector3(s.x, 0, s.z).normalize());
    const hz = sky.uniforms.uAnti.value.clone().lerp(sky.uniforms.uHorizon.value, smootherstep(-0.6, 0.7, mu));
    hz.add(sky.uniforms.uSunCol.value.clone().multiplyScalar(0.3 * smootherstep(-0.2, 1.0, mu)));
    scene.fog.color.copy(hz).lerp(new THREE.Color("#F1DDBB"), 0.25 * (1 - k));
    sky.uniforms.uFog.value.copy(scene.fog.color);
    sky.uniforms.uFogAmt.value = 0.92;
    scene.fog.density = lerp(lerp(0.0016, 0.00034, smootherstep(15.2, 17.6, t)), 0.00026, smootherstep(19.6, 20.6, t));
    sun.color.set("#FFD29A").lerp(new THREE.Color("#FF9A55"), k);
    sun.intensity = lerp(3.3, 2.4, k);
    hemi.intensity = lerp(0.35, 0.25, k);
    foliage.userData.uniforms.uSunDir.value.copy(s);
    for (const m of facadeMats) m.userData.uniforms.uLights.value = lerp(0.0, 0.32, smootherstep(18.5, 21.8, t));
    city.carMaterial.userData.uniforms.uLights.value = lerp(0.2, 1.0, smootherstep(16, 21, t));
    water.userData.uniforms.uTime.value = t;
    deck.visible = t < 10.6;
    mistGroup.visible = t < 16.6;
    jungle.visible = t < 19.0 || (t > 19.9 && t < 20.9); // the NW hills seen just after touchdown
    city.group.visible = t > 14.6;
    petronas.visible = landmarks.visible = t > 14.6;
    title.visible = t < 16;
    city.updateTraffic(t);

    // Title letters rise out of the mist, staggered.
    letters.forEach((l, i) => {
      const r = easeOutCubic(clamp(invLerp(11.4 + i * 0.09, 12.9 + i * 0.09, t)));
      l.position.y = lerp(-22, 24, r);
    });

    // ---- the bird's eyes
    camera.position.fromArray(camPos(t));
    // wingbeat bob while gliding over the jungle (short bursts of flaps)
    const flap = smootherstep(10.6, 11.0, t) * (1 - smootherstep(11.8, 12.1, t)) + smootherstep(15.0, 15.3, t) * (1 - smootherstep(16.0, 16.4, t));
    camera.position.y += Math.sin(t * Math.PI * 2 * 3.2) * 0.35 * flap;
    // touchdown jolt
    const jt = t - 20.33;
    if (jt > 0 && jt < 0.45) camera.position.y -= 0.16 * Math.sin(jt * 24) * Math.exp(-jt * 8);
    tmp.fromArray(camTgt(t));
    camera.up.set(0, 1, 0);
    camera.lookAt(tmp);
    camera.rotateZ(camRoll(t));
    // head turn after landing: fast yaw about the vertical, slight inquisitive tilt
    if (t > 20.45) {
      camera.rotateOnWorldAxis(yAxis, headYawOffset(t, GAZE_YAW));
      const settle = smootherstep(20.6, 21.1, t);
      camera.rotateX(-0.02 * settle + Math.sin(t * 1.7) * 0.0015);
      camera.rotateZ(0.035 * Math.sin(Math.PI * clamp((t - 20.5) / 0.5)) + Math.sin(t * 2.3) * 0.0012);
    }
    camera.fov = camFov(t);
    camera.near = t > 19.9 ? 0.04 : 0.5;
    camera.far = 30000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    wings.update(t, camera);

    // Shadow frustum follows the action.
    camera.getWorldDirection(fwd);
    const inCity = t > 16.0;
    const half = inCity ? 1700 : 380;
    sunFocus.copy(inCity ? CITY_CENTER : camera.position).addScaledVector(fwd, inCity ? 0 : 220);
    sunFocus.y = inCity ? 150 : terrainHeight(sunFocus.x, sunFocus.z);
    sun.position.copy(sunFocus).addScaledVector(s, 4000);
    sun.target.position.copy(sunFocus);
    const sc = sun.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 10;
    sc.far = 9000;
    sc.updateProjectionMatrix();

    // Post FX for this moment
    const focus = t > 20.4 ? 1500 : t > 15.5 ? camera.position.distanceTo(CITY_CENTER) : Math.max(60, camera.position.distanceTo(tmp));
    return {
      sunDir: s,
      focus,
      aperture: t > 19.9 && t < 20.6 ? 6 : t > 20.6 ? 1.2 : t > 11.8 && t < 14.6 ? 4 : t > 15.5 ? 1.0 : 2.0,
      rays: lerp(0.55, 0.32, k),
      raysThreshold: 1.4,
      bloom: lerp(0.5, 0.38, k),
      bloomThreshold: 1.1,
      exposure: lerp(1.0, 0.66, smootherstep(19, 21.2, t)),
      vignette: 0.38,
      warmth: lerp(0.08, 0.14, k) - 0.1 * smootherstep(19.5, 21.2, t),
      saturation: lerp(1.04, 0.96, smootherstep(19, 21, t)),
      contrast: lerp(1.06, 1.16, smootherstep(19, 21, t)),
    };
  }

  return { scene, update };
}

// City ground: asphalt grid with avenues, lane markings, pavements, lots and lawns.
function createCityGroundMaterial(C) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const f = (v) => v.toFixed(1);
  mat.customProgramCacheKey = () => "city-ground";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRot = { value: GRID_ROT };
    // KLCC plaza, KLCC Park and the Bukit Nanas forest floor interrupt the street grid
    shader.uniforms.uPlaza = { value: new THREE.Vector3(C.x, C.z, 215) };
    shader.uniforms.uPark = { value: new THREE.Vector4(C.x + 60, C.x + 470, C.z - 470, C.z - 40) };
    shader.uniforms.uHill = { value: new THREE.Vector3(HILL.x, HILL.z, 280) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vW; uniform float uRot; uniform vec3 uPlaza; uniform vec4 uPark; uniform vec3 uHill;
         float gh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         {
           float c = cos(uRot), s = sin(uRot);
           vec2 g = vec2(vW.x * c - vW.z * s, vW.x * s + vW.z * c);
           vec2 cell = floor(g / ${f(BLOCK)} + 0.5);
           vec2 d = abs(g - cell * ${f(BLOCK)});
           vec2 halfW = vec2(abs(mod(cell.x, ${f(AVENUE_EVERY)})) < 0.5 ? ${f(AVENUE / 2)} : ${f(ROAD / 2)},
                             abs(mod(cell.y, ${f(AVENUE_EVERY)})) < 0.5 ? ${f(AVENUE / 2)} : ${f(ROAD / 2)});
           float roadX = 1.0 - step(halfW.x, d.x);
           float roadZ = 1.0 - step(halfW.y, d.y);
           float road = max(roadX, roadZ);
           float pave = max(1.0 - step(halfW.x + 4.0, d.x), 1.0 - step(halfW.y + 4.0, d.y)) * (1.0 - road);
           float dash = step(0.5, fract((roadX > 0.5 ? g.y : g.x) / 9.0));
           float line = (roadX * (1.0 - step(0.2, d.x)) + roadZ * (1.0 - step(0.2, d.y))) * dash * (1.0 - roadX * roadZ);
           vec2 blk = floor(g / ${f(BLOCK)});
           float lawn = step(0.72, gh(blk));
           vec3 lot = mix(vec3(0.42, 0.40, 0.37), vec3(0.20, 0.30, 0.15), lawn);
           lot *= 0.85 + 0.3 * gh(floor(g / 9.0));
           vec3 col = lot;
           col = mix(col, vec3(0.55, 0.53, 0.5), pave);
           col = mix(col, vec3(0.09, 0.09, 0.1) * (0.9 + 0.2 * gh(floor(g / 3.0))), road);
           col = mix(col, vec3(0.8, 0.78, 0.7), line);
           float plaza = 1.0 - smoothstep(uPlaza.z - 6.0, uPlaza.z, length(vW.xz - uPlaza.xy));
           float park = step(uPark.x, vW.x) * step(vW.x, uPark.y) * step(uPark.z, vW.z) * step(vW.z, uPark.w);
           float hill = 1.0 - smoothstep(uHill.z - 20.0, uHill.z, length(vW.xz - uHill.xy));
           vec3 stone = vec3(0.62, 0.6, 0.56) * (0.9 + 0.1 * gh(floor(vW.xz / 4.0)));
           vec3 grass = vec3(0.17, 0.27, 0.12) * (0.85 + 0.3 * gh(floor(vW.xz / 7.0)));
           col = mix(col, stone, plaza);
           col = mix(col, grass, max(park, hill) * (1.0 - plaza));
           diffuseColor.rgb = col;
         }`,
      );
  };
  return mat;
}

// River / lake water: sky reflections with drifting ripples.
function createWaterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x23332c, roughness: 0.05, metalness: 0.85, envMapIntensity: 1.1 });
  const uniforms = { uTime: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.customProgramCacheKey = () => "water";
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW; uniform float uTime;")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec2 p = vW.xz;
           float a = sin(p.x * 0.35 + uTime * 1.3) * cos(p.y * 0.21 - uTime * 0.9);
           float b = sin(p.x * 1.1 - p.y * 0.8 + uTime * 2.1);
           vec3 n = normalize(vec3(a * 0.06 + b * 0.025, 1.0, b * 0.05 - a * 0.03));
           normal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
         }`,
      );
  };
  return mat;
}
