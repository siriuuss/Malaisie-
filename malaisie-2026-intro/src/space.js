import * as THREE from "three";
import { latLonToVec3, makeTrack, mulberry32, smootherstep, invLerp, clamp, easeOutCubic } from "./util.js";

// ---- Itinerary (exact coordinates from the brief) --------------------------------
export const STOPS = [
  { id: "kl", name: "Kuala Lumpur", sub: "départ", lat: 3.15, lon: 101.7 },
  { id: "batu", name: "Batu Caves", sub: "quad dans la jungle", lat: 3.24, lon: 101.68 },
  { id: "perhentian", name: "Îles Perhentian", sub: "", lat: 5.9, lon: 102.75 },
  { id: "singapour", name: "Singapour", sub: "", lat: 1.35, lon: 103.82 },
];
// Route legs, drawn one after another; each leg's end lights up its marker.
export const LEGS = [
  { from: "kl", to: "batu", start: 3.85, end: 4.25 },
  { from: "batu", to: "perhentian", start: 4.4, end: 5.35 },
  { from: "perhentian", to: "singapour", start: 5.5, end: 6.55 },
  { from: "singapour", to: "kl", start: 6.7, end: 7.45 },
];
export const MARKER_TIMES = { kl: 3.5, batu: 4.25, perhentian: 5.35, singapour: 6.55 };
export const RETURN_TIME = 7.45;

// Sun: sub-solar point far east of Malaysia -> raking morning light on the peninsula,
// while the camera starts on the night side and watches the sun rise over the limb.
export const SUN_DIR = latLonToVec3(-8, 168, 1).normalize();

const R = 1; // Earth radius in scene units
const PEN = latLonToVec3(3.6, 102.4, R); // peninsula focus

export function buildSpace(tex) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#05070F");

  // ---- Earth -------------------------------------------------------------------
  const earthGeo = new THREE.SphereGeometry(R, 192, 128);
  const earthMat = new THREE.MeshStandardMaterial({
    map: tex.day,
    bumpMap: tex.bump,
    bumpScale: 2.5,
    roughness: 0.9,
    metalness: 0,
    emissiveMap: tex.lights,
    emissive: new THREE.Color("#FFB45A"),
    emissiveIntensity: 0,
  });
  // City lights only on the night side.
  earthMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = { value: SUN_DIR };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSunDir;\nvarying vec3 vWorldNormal;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         float night = smoothstep(0.05, -0.25, dot(normalize(vWorldNormal), uSunDir));
         totalEmissiveRadiance = texture2D(emissiveMap, vEmissiveMapUv).rgb * vec3(1.0, 0.72, 0.38) * 1.6 * night;`,
      );
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldNormal;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorldNormal = normalize(mat3(modelMatrix) * normal);");
  };
  const earth = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earth);

  // Clouds — alpha-only texture on a slightly larger shell, drifting slowly.
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.006, 160, 110),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      alphaMap: tex.clouds,
      transparent: true,
      depthWrite: false,
      roughness: 1,
    }),
  );
  scene.add(clouds);

  // Atmosphere halo — back-face fresnel shell, brighter on the sunlit limb.
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.12, 128, 96),
    new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: SUN_DIR } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vView; varying vec3 vWorldN;
        void main(){
          vec4 wp = modelMatrix * vec4(position,1.0);
          vWorldN = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        varying vec3 vView; varying vec3 vWorldN;
        void main(){
          float rim = clamp(dot(-vWorldN, vView), 0.0, 1.0);
          float glow = pow(rim, 3.0) * 1.6;
          float sun = clamp(dot(vWorldN, uSunDir) * 0.8 + 0.35, 0.0, 1.0);
          vec3 day = vec3(0.45, 0.70, 1.0);
          vec3 dawn = vec3(1.0, 0.62, 0.30);
          float dawnBand = smoothstep(0.55, 0.0, abs(dot(vWorldN, uSunDir) - 0.05));
          vec3 col = mix(day, dawn, dawnBand * 0.85);
          gl_FragColor = vec4(col * glow * (0.15 + 1.4 * sun), glow * sun);
        }`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  scene.add(atmo);

  // Low cloud puffs over Kuala Lumpur that the dive plunges into (8 → 9 s).
  const puffs = new THREE.Group();
  {
    const rand = mulberry32(909);
    for (let i = 0; i < 90; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex.cloud, color: 0xfff3e0, transparent: true, depthWrite: false, opacity: 0.95 }),
      );
      const lat = 2.6 + rand() * 1.4;
      const lon = 101.35 + rand() * 0.9;
      sp.position.copy(latLonToVec3(lat, lon, R + 0.0012 + rand() * 0.0032));
      sp.scale.setScalar(0.0035 + rand() * 0.006);
      puffs.add(sp);
    }
  }
  scene.add(puffs);

  // Lights
  const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sunLight.position.copy(SUN_DIR).multiplyScalar(10);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x1b2f66, 0.08));

  // Sun disc + glow sprite, far along SUN_DIR.
  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex.glow, color: 0xfff0d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  sunSprite.position.copy(SUN_DIR).multiplyScalar(60);
  sunSprite.scale.setScalar(9);
  scene.add(sunSprite);

  // Stars — seeded, fixed.
  {
    const rand = mulberry32(2026);
    const n = 6000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 80;
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const b = 0.25 + Math.pow(rand(), 6) * 1.2;
      const warm = rand();
      col.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1.05 - warm * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
  }

  // ---- Route ---------------------------------------------------------------------
  const stopPos = Object.fromEntries(STOPS.map((s) => [s.id, latLonToVec3(s.lat, s.lon, R * 1.0004)]));
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  const routeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#FFC86A").multiplyScalar(2.2), toneMapped: false, transparent: true });
  const legs = LEGS.map((leg) => {
    const a = stopPos[leg.from];
    const b = stopPos[leg.to];
    const ang = a.angleTo(b);
    const pts = [];
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const p = new THREE.Vector3().copy(a).lerp(b, s).normalize(); // fine at these small angles
      const lift = Math.sin(Math.PI * s) * Math.max(0.0012, ang * 0.18);
      pts.push(p.multiplyScalar(R * 1.0006 + lift));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 200, 0.00055, 8, false);
    const mesh = new THREE.Mesh(geo, routeMat);
    mesh.geometry.setDrawRange(0, 0);
    routeGroup.add(mesh);
    return { ...leg, curve, mesh, indexCount: geo.index.count };
  });
  // Bright comet head riding the leading point of the leg being drawn.
  const head = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color("#FFD27A").multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  head.scale.setScalar(0.012);
  routeGroup.add(head);

  // Markers: core dot + expanding ring pulse on arrival.
  const markers = STOPS.map((s) => {
    const g = new THREE.Group();
    g.position.copy(stopPos[s.id]);
    g.lookAt(stopPos[s.id].clone().multiplyScalar(2));
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.0016, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color("#FFE2A6").multiplyScalar(2.5), toneMapped: false, transparent: true, depthWrite: false }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color("#FFC861").multiplyScalar(2), toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.scale.setScalar(0.002);
    g.add(dot, ring);
    scene.add(g);
    return { ...s, group: g, dot, ring, pos: stopPos[s.id] };
  });

  // ---- Camera (planet scale) ----------------------------------------------------
  const v = (lat, lon, alt) => latLonToVec3(lat, lon, R + alt).toArray();
  // Point on the Earth's silhouette (seen from P) in the direction of the sun, for the sunrise.
  const limbToward = (P) => {
    const p = new THREE.Vector3().fromArray(P);
    const d2 = p.lengthSq();
    const u = SUN_DIR.clone().addScaledVector(p, -SUN_DIR.dot(p) / d2).normalize();
    return p.clone().multiplyScalar((R * R) / d2).addScaledVector(u, R * Math.sqrt(1 - (R * R) / d2));
  };
  const sunUp = (P) => {
    const p = new THREE.Vector3().fromArray(P).normalize();
    return SUN_DIR.clone().addScaledVector(p, -SUN_DIR.dot(p)).normalize();
  };
  const P0 = v(10, 0, 2.0);
  const P1 = v(9.5, 7, 1.92);
  const P2 = v(9, 15, 1.8);
  const aim = (P, lift) => limbToward(P).addScaledVector(sunUp(P), lift).toArray();
  const camPos = makeTrack([
    { t: 0.0, v: P0 },
    { t: 1.0, v: P1 },
    { t: 1.7, v: P2 },
    { t: 3.0, v: v(5.5, 88, 0.62) },
    { t: 4.6, v: v(-0.6, 101.0, 0.24) },
    { t: 7.4, v: v(0.3, 102.0, 0.17) },
    { t: 8.5, v: v(2.2, 101.85, 0.05) },
    { t: 9.1, v: v(3.0, 101.75, 0.006) },
  ]);
  const camTgt = makeTrack([
    { t: 0.0, v: aim(P0, 0.32) },
    { t: 1.0, v: aim(P1, 0.3) },
    { t: 1.7, v: aim(P2, 0.22) },
    { t: 3.0, v: v(4, 102.5, 0) },
    { t: 4.6, v: v(3.55, 102.6, 0) },
    { t: 7.4, v: v(3.6, 102.55, 0) },
    { t: 8.5, v: v(3.3, 101.8, 0) },
    { t: 9.1, v: v(3.4, 101.72, 0) },
  ]);
  const north = [0, 1, 0];
  const camUp = makeTrack([
    { t: 0.0, v: sunUp(P0).toArray() },
    { t: 1.7, v: sunUp(P2).toArray() },
    { t: 3.0, v: north },
    { t: 9.1, v: north },
  ]);
  const camFov = makeTrack([
    { t: 0, v: 30 },
    { t: 1.7, v: 32 },
    { t: 3, v: 34 },
    { t: 7.4, v: 34 },
    { t: 9.1, v: 44 },
  ]);

  const tmp = new THREE.Vector3();
  function update(t, camera) {
    camera.position.fromArray(camPos(t));
    camera.up.fromArray(camUp(t)).normalize();
    camera.lookAt(tmp.fromArray(camTgt(t)));
    camera.fov = camFov(t);
    camera.near = Math.max(0.0002, (camera.position.length() - R) * 0.3);
    camera.far = 200;
    camera.updateProjectionMatrix();

    puffs.visible = t > 7.6;
    clouds.rotation.y = t * 0.004;
    // Clouds thin out over the itinerary so the map stays readable, then thicken for the dive.
    clouds.material.opacity = 1 - 0.6 * smootherstep(2.6, 3.6, t) * (1 - smootherstep(7.6, 8.6, t));

    // Route legs
    let headPos = null;
    for (const leg of legs) {
      const p = clamp(invLerp(leg.start, leg.end, t));
      const ep = easeOutCubic(p) * 0.15 + p * 0.85;
      const count = Math.floor((leg.indexCount / 6) * ep) * 6;
      leg.mesh.geometry.setDrawRange(0, count);
      if (p > 0 && p < 1) headPos = leg.curve.getPointAt(ep);
    }
    head.visible = !!headPos;
    if (headPos) head.position.copy(headPos);
    const routeFade = 1 - smootherstep(7.85, 8.35, t);
    routeMat.opacity = routeFade;
    head.material.opacity = routeFade;

    for (const m of markers) {
      const appear = MARKER_TIMES[m.id];
      const k = smootherstep(appear, appear + 0.25, t) * routeFade;
      m.dot.material.opacity = k;
      m.dot.scale.setScalar(0.4 + 0.6 * easeOutCubic(clamp(invLerp(appear, appear + 0.3, t))));
      const pulseT = m.id === "kl" && t >= RETURN_TIME ? t - RETURN_TIME : t - appear;
      const pr = clamp(pulseT / 0.9);
      m.ring.visible = pulseT > 0 && pr < 1;
      m.ring.scale.setScalar(0.002 + 0.012 * easeOutCubic(pr));
      m.ring.material.opacity = (1 - pr) * routeFade;
    }
    return { markers };
  }

  return { scene, update, markers, PEN };
}
