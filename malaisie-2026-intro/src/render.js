import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// Cinematic post pipeline, stateless per frame (no history buffers) so any frame
// can be rendered in isolation:
//   scene (HDR + depth) → depth of field → sun shafts → bloom → grade/tonemap/vignette/grain.

const QUAD_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function hdrTarget(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, ...opts });
}

export function createPipeline(renderer, width, height, { msaa = 4, post = true } = {}) {
  const sceneRT = hdrTarget(width, height, { samples: msaa, depthTexture: new THREE.DepthTexture(width, height) });
  const dofRT = hdrTarget(width, height);
  const hw = Math.round(width / 2);
  const hh = Math.round(height / 2);
  const maskRT = hdrTarget(hw, hh);
  const raysA = hdrTarget(hw, hh);
  const raysB = hdrTarget(hw, hh);

  // ---- Depth of field: gather blur weighted by circle of confusion -------------
  const dofQuad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uFocus: { value: 100 },
        uAperture: { value: 0 },
        uMaxBlur: { value: 10 },
        uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uAperture; uniform float uMaxBlur;
        uniform vec2 uTexel;
        varying vec2 vUv;
        float linDepth(vec2 uv){
          float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        }
        float coc(float d){ return clamp(abs(d - uFocus) / max(d, 1e-3) * uAperture, 0.0, uMaxBlur); }
        void main(){
          vec4 base = texture2D(tColor, vUv);
          float c0 = coc(linDepth(vUv));
          if (uAperture <= 0.0 || c0 < 0.35) { gl_FragColor = base; return; }
          vec3 acc = base.rgb; float wsum = 1.0;
          const int N = 24;
          for (int i = 0; i < N; i++) {
            float a = float(i) * 2.39996323;            // golden-angle spiral
            float r = sqrt((float(i) + 0.5) / float(N));
            vec2 o = vec2(cos(a), sin(a)) * r * c0 * uTexel;
            vec2 uv = vUv + o;
            float cs = coc(linDepth(uv));
            float w = smoothstep(0.0, 1.0, cs / max(c0 * r, 0.5)); // reject sharp foreground bleeding
            acc += texture2D(tColor, uv).rgb * w; wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, base.a);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );

  // ---- Sun shafts: bright sky mask + radial blur toward the sun -----------------
  const maskQuad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: width / height }, uThreshold: { value: 1.2 } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect; uniform float uThreshold;
        varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tColor, vUv).rgb;
          float sky = step(0.99999, texture2D(tDepth, vUv).x);          // only unoccluded sky emits shafts
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
          float fall = exp(-dot(d, d) * 6.0);
          gl_FragColor = vec4(c * smoothstep(uThreshold * 0.5, uThreshold * 2.5, l) * sky * fall, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const raysQuad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tInput: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uStep: { value: 1.0 } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tInput; uniform vec2 uSun; uniform float uStep;
        varying vec2 vUv;
        void main(){
          const int TAPS = 32;
          vec2 delta = (uSun - vUv) * uStep / float(TAPS);
          vec2 uv = vUv; vec3 acc = vec3(0.0); float decay = 1.0;
          for (int i = 0; i < TAPS; i++) { acc += texture2D(tInput, uv).rgb * decay; decay *= 0.965; uv += delta; }
          gl_FragColor = vec4(acc / float(TAPS) * 1.6, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );

  // ---- Bloom (three's Unreal bloom, blended additively into its read buffer) ---
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.55, 0.92);

  // ---- Final grade ---------------------------------------------------------------
  const finalQuad = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tRays: { value: null },
        uRays: { value: 0 },
        uRayTint: { value: new THREE.Color(1.0, 0.82, 0.6) },
        uExposure: { value: 1 },
        uVignette: { value: 0.35 },
        uWarmth: { value: 0.12 },
        uSaturation: { value: 1.0 },
        uContrast: { value: 1.05 },
        uShadowTint: { value: new THREE.Color("#0f3a3a") },
        uHighlightTint: { value: new THREE.Color("#ffb066") },
        uGrain: { value: 0.025 },
        uFrame: { value: 0 },
        uAspect: { value: width / height },
        uFade: { value: 0 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tRays;
        uniform float uRays; uniform vec3 uRayTint; uniform float uExposure; uniform float uVignette;
        uniform float uWarmth; uniform float uSaturation; uniform float uContrast;
        uniform vec3 uShadowTint; uniform vec3 uHighlightTint; uniform float uGrain; uniform float uFrame; uniform float uAspect; uniform float uFade;
        varying vec2 vUv;
        vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
        float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
        void main(){
          // subtle lateral chromatic aberration toward the edges
          vec2 cc = vUv - 0.5;
          float ca = dot(cc, cc) * 0.0035;
          vec3 col;
          col.r = texture2D(tColor, vUv - cc * ca).r;
          col.g = texture2D(tColor, vUv).g;
          col.b = texture2D(tColor, vUv + cc * ca).b;
          col += texture2D(tRays, vUv).rgb * uRays * uRayTint;
          col *= uExposure;
          // warm white balance
          col *= vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.25, 1.0 - uWarmth * 0.7);
          vec3 m = aces(col);
          // split toning: teal-tinted shadows, warm highlights
          float l = dot(m, vec3(0.2126, 0.7152, 0.0722));
          m = mix(m, m * (0.6 + uShadowTint * 1.4), (1.0 - smoothstep(0.0, 0.45, l)) * 0.35);
          m = mix(m, m * (0.6 + uHighlightTint * 0.6), smoothstep(0.45, 1.0, l) * 0.3);
          m = mix(vec3(l), m, uSaturation);
          m = clamp((m - 0.5) * uContrast + 0.5, 0.0, 1.0);
          // warm vignette (never pure black)
          vec2 v = cc * vec2(uAspect, 1.0) * 0.92;
          float vig = smoothstep(0.35, 1.05, length(v));
          m *= mix(vec3(1.0), vec3(0.42, 0.32, 0.26), vig * uVignette * 1.6);
          vec3 outc = toSRGB(m);
          // seeded film grain, deterministic per frame
          float g = hash(vec3(gl_FragCoord.xy, uFrame)) - 0.5;
          outc += g * uGrain * (1.0 - l * 0.6);
          outc = mix(outc, vec3(0.0), uFade);
          gl_FragColor = vec4(outc, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );

  const sunNdc = new THREE.Vector3();

  return {
    sceneRT,
    /**
     * Render one frame.
     * draw(target): renders the scene(s) into `target` (HDR).
     * fx: { camera, focus, aperture, sunDir, rays, bloom, bloomRadius, bloomThreshold, exposure, vignette, warmth, saturation, contrast, grain, frame }
     */
    render(draw, fx) {
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      draw();

      // DOF
      let src = sceneRT;
      if (!post) fx = { ...fx, aperture: 0, rays: 0, bloom: 0 };
      if (fx.aperture > 0) {
        const u = dofQuad.material.uniforms;
        u.tColor.value = sceneRT.texture;
        u.tDepth.value = sceneRT.depthTexture;
        u.uNear.value = fx.camera.near;
        u.uFar.value = fx.camera.far;
        u.uFocus.value = fx.focus;
        u.uAperture.value = fx.aperture;
        renderer.setRenderTarget(dofRT);
        dofQuad.render(renderer);
        src = dofRT;
      }

      // Sun shafts
      let raysOn = false;
      if (fx.rays > 0 && fx.sunDir) {
        sunNdc.copy(fx.camera.position).add(fx.sunDir).project(fx.camera);
        const behind = fx.sunDir.dot(fx.camera.getWorldDirection(new THREE.Vector3())) < 0;
        if (!behind) {
          const sun = new THREE.Vector2((sunNdc.x + 1) / 2, (sunNdc.y + 1) / 2);
          const mu = maskQuad.material.uniforms;
          mu.tColor.value = src.texture;
          mu.tDepth.value = sceneRT.depthTexture;
          mu.uSun.value.copy(sun);
          mu.uThreshold.value = fx.raysThreshold ?? 1.2;
          renderer.setRenderTarget(maskRT);
          maskQuad.render(renderer);
          const ru = raysQuad.material.uniforms;
          ru.uSun.value.copy(sun);
          ru.tInput.value = maskRT.texture;
          ru.uStep.value = 1.0;
          renderer.setRenderTarget(raysA);
          raysQuad.render(renderer);
          ru.tInput.value = raysA.texture;
          ru.uStep.value = 0.5;
          renderer.setRenderTarget(raysB);
          raysQuad.render(renderer);
          raysOn = true;
        }
      }

      // Bloom (in place on src)
      if (fx.bloom > 0) {
        bloom.strength = fx.bloom;
        bloom.radius = fx.bloomRadius ?? 0.55;
        bloom.threshold = fx.bloomThreshold ?? 0.92;
        bloom.render(renderer, null, src, 0, false);
      }

      const fu = finalQuad.material.uniforms;
      fu.tColor.value = src.texture;
      fu.tRays.value = raysB.texture;
      fu.uRays.value = raysOn ? fx.rays : 0;
      fu.uExposure.value = fx.exposure ?? 1;
      fu.uVignette.value = fx.vignette ?? 0.35;
      fu.uWarmth.value = fx.warmth ?? 0.12;
      fu.uSaturation.value = fx.saturation ?? 1;
      fu.uContrast.value = fx.contrast ?? 1.05;
      fu.uGrain.value = fx.grain ?? 0.02;
      fu.uFrame.value = fx.frame ?? 0;
      fu.uFade.value = fx.fade ?? 0;
      renderer.setRenderTarget(null);
      finalQuad.render(renderer);
    },
  };
}
