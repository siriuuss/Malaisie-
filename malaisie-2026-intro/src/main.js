import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { buildSpace, STOPS, MARKER_TIMES, RETURN_TIME } from "./space.js";
import { buildGround } from "./ground.js";
import { makeNoiseCanvas, smootherstep, clamp, invLerp, easeOutCubic } from "./util.js";

const W = 1920;
const H = 1080;
// Space (planet scale) until the cloud wall fully covers the frame, then ground scale.
const CUT_GROUND = 9.0;

const vars = window.__hyperframes?.getVariables?.() ?? {};
const renderScale = Number(vars.renderScale ?? 1);

const canvas = document.getElementById("three-layer");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(Math.round(W * renderScale), Math.round(H * renderScale), false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

const camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 1000);

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.08, "rgba(255,245,220,0.95)");
  grd.addColorStop(0.25, "rgba(255,200,120,0.35)");
  grd.addColorStop(1, "rgba(255,160,80,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function loadAssets() {
  const tl = new THREE.TextureLoader();
  const load = (url, srgb = false) =>
    new Promise((res, rej) =>
      tl.load(url, (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        res(t);
      }, undefined, rej),
    );
  const [day, clouds, bump, water, lights, font] = await Promise.all([
    load("assets/textures/earth_day_4k.jpg", true),
    load("assets/textures/earth_clouds_4k.jpg"),
    load("assets/textures/earth_bump_4k.jpg"),
    load("assets/textures/earth_water_4k.png"),
    load("assets/textures/earth_lights_2k.png", true),
    new Promise((res, rej) => new FontLoader().load("assets/fonts/cinzel-black.typeface.json", res, undefined, rej)),
  ]);
  const cloud = new THREE.CanvasTexture(makeNoiseCanvas(256, 11, { octaves: 5, contrast: 1.7 }));
  const mist = new THREE.CanvasTexture(makeNoiseCanvas(256, 23, { octaves: 4, contrast: 1.3 }));
  const cloudWall = new THREE.CanvasTexture(makeNoiseCanvas(512, 5, { octaves: 6, contrast: 1.4, radial: false }));
  cloudWall.wrapS = cloudWall.wrapT = THREE.RepeatWrapping;
  return { tex: { day, clouds, bump, water, lights, glow: glowTexture(), cloud, mist, cloudWall }, font };
}

// Full-frame cloud wall that carries the scale change at CUT_GROUND.
function buildCloudWall(tex) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = { uTex: { value: tex.cloudWall }, uAmount: { value: 0 }, uTime: { value: 0 } };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uAmount; uniform float uTime;
        varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5;
          float zoom = 1.0 / (1.0 + uTime * 0.9);
          float n1 = texture2D(uTex, c * vec2(1.6, 0.9) * zoom + 0.5).a;
          float n2 = texture2D(uTex, c * vec2(0.8, 0.45) * zoom * 1.7 + vec2(0.31, 0.17)).a;
          float n = n1 * 0.6 + n2 * 0.6;
          float a = smoothstep(1.0 - uAmount * 1.25, 1.18 - uAmount * 1.1, n + uAmount * 0.6);
          a = max(a, smoothstep(0.82, 1.0, uAmount));
          vec3 lit = mix(vec3(1.0, 0.86, 0.68), vec3(1.0, 0.97, 0.92), n);
          gl_FragColor = vec4(lit, clamp(a, 0.0, 1.0));
        }`,
    }),
  );
  scene.add(quad);
  return {
    scene,
    cam,
    update(t) {
      const up = smootherstep(8.35, 9.0, t);
      const down = 1 - smootherstep(9.0, 9.9, t);
      uniforms.uAmount.value = Math.min(up, down);
      uniforms.uTime.value = t - 8.3;
      return uniforms.uAmount.value > 0.001;
    },
  };
}

// ---- Map labels (DOM, positioned from the projected 3D markers) ----------------
const labelEls = Object.fromEntries(STOPS.map((s) => [s.id, document.getElementById(`lbl-${s.id}`)]));
const proj = new THREE.Vector3();
function updateLabels(t, space) {
  const fadeOut = 1 - smootherstep(7.85, 8.3, t);
  for (const m of space.markers) {
    const el = labelEls[m.id];
    if (!el) continue;
    const appear = MARKER_TIMES[m.id] + 0.05;
    const k = clamp(invLerp(appear, appear + 0.45, t));
    const o = (t < CUT_GROUND ? easeOutCubic(k) : 0) * fadeOut;
    el.style.opacity = o.toFixed(3);
    if (o <= 0) continue;
    proj.copy(m.pos).project(camera);
    el.style.left = `${((proj.x + 1) / 2) * W}px`;
    el.style.top = `${((1 - proj.y) / 2) * H + (1 - easeOutCubic(k)) * 10}px`;
    if (m.id === "kl") el.querySelector(".sub").textContent = t >= RETURN_TIME ? "départ · retour" : "départ";
  }
}

async function init() {
  const { tex, font } = await loadAssets();
  const space = buildSpace(tex);
  const ground = buildGround(tex, font);
  const wall = buildCloudWall(tex);

  function renderAt(time) {
    const t = Math.max(0, time);
    renderer.clear();
    if (t < CUT_GROUND) {
      space.update(t, camera);
      renderer.render(space.scene, camera);
    } else {
      ground.update(t, camera);
      renderer.render(ground.scene, camera);
    }
    if (wall.update(t)) renderer.render(wall.scene, wall.cam);
    updateLabels(t, space);
  }

  window.addEventListener("hf-seek", (e) => renderAt(e.detail.time));
  // Compile everything once so the first captured frame is not a cold start.
  renderer.compile(space.scene, camera);
  renderer.compile(ground.scene, camera);
  renderAt(window.__hfThreeTime || 0);
}

window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady["malaisie-scene"] = init();
