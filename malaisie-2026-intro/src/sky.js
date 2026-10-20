import * as THREE from "three";

// Golden-hour / sunset sky dome: graded atmosphere, sun disc + aureole, lit cirrus.
// The same material is reused in a separate scene to bake the environment map.
export function createSkyMaterial() {
  const uniforms = {
    uSun: { value: new THREE.Vector3(0, 0.1, -1).normalize() },
    uHorizon: { value: new THREE.Color("#F2B06A") },
    uZenith: { value: new THREE.Color("#3D5A8A") },
    uAnti: { value: new THREE.Color("#8C7A9A") },
    uSunCol: { value: new THREE.Color("#FFD9A0") },
    uCloud: { value: 0.65 },
    uDisc: { value: 22 },
    uFog: { value: new THREE.Color("#E9B97C") },
    uFogAmt: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uAnti; uniform vec3 uSunCol;
      uniform float uCloud; uniform float uDisc; uniform vec3 uFog; uniform float uFogAmt;
      varying vec3 vDir;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.3, 1.0);
        float mu = dot(d, uSun);
        float muc = clamp(mu, 0.0, 1.0);
        // base gradient, warmer toward the sun, cooler/violet away from it
        vec3 horizon = mix(uAnti, uHorizon, smoothstep(-0.6, 0.7, mu));
        vec3 col = mix(horizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
        // horizon glow band
        col += uSunCol * 0.35 * exp(-abs(h) * 14.0) * smoothstep(-0.2, 1.0, mu);
        // Mie aureole
        col += uSunCol * (pow(muc, 12.0) * 0.6 + pow(muc, 180.0) * 2.0);
        // sun disc (HDR), slightly flattened near the horizon
        float disc = smoothstep(0.99962, 0.99972, mu);
        col += uSunCol * disc * uDisc;
        // cirrus layer
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.06) * 0.9;
          float c = fbm(uv * vec2(1.0, 3.2) + vec2(3.1, 0.0));
          c = smoothstep(0.5, 0.85, c) * uCloud * smoothstep(0.0, 0.08, d.y) * (1.0 - smoothstep(0.5, 0.9, d.y));
          vec3 lit = mix(uHorizon * 1.15, uSunCol * 1.6, pow(muc, 3.0));
          vec3 shade = mix(uAnti * 0.8, uHorizon * 0.7, 0.5);
          col = mix(col, mix(shade, lit, 0.55 + 0.45 * muc), c * 0.85);
        }
        // below the horizon: hazy ground glow
        col = mix(col, horizon * 0.75, smoothstep(0.0, -0.12, d.y));
        // aerial haze: the sky's lowest band takes the scene fog colour so distant ground melts in
        col = mix(col, uFog, uFogAmt * exp(-max(d.y, 0.0) * 22.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return { material, uniforms };
}

export function createSkyMesh(material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  // always centred on whichever camera renders it
  mesh.onBeforeRender = (r, sc, cam) => {
    mesh.position.copy(cam.position);
    mesh.updateMatrixWorld();
  };
  return mesh;
}

// Bake a prefiltered environment from the sky at a given state.
export function bakeEnvironment(renderer, material) {
  const scene = new THREE.Scene();
  scene.add(createSkyMesh(material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 5000);
  pmrem.dispose();
  return rt.texture;
}
