import * as THREE from "three";

// Procedural skyscraper facades for MeshStandardMaterial (via onBeforeCompile).
// Geometry provides facade coordinates in metres: u around/along the facade, v up.
// Patterns are filtered with fwidth so distant floors don't shimmer.

const COMMON = /* glsl */ `
  varying vec2 vFacade;
  varying float vRoof;
  varying vec4 vStyle;
  uniform float uLights;
  float fhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // anti-aliased band: 1 inside [a,b] of a repeating cell coordinate x (period 1)
  float band(float x, float a, float b){
    float w = fwidth(x) * 0.75 + 1e-4;
    float f = fract(x);
    return clamp((smoothstep(a - w, a + w, f) - smoothstep(b - w, b + w, f)), 0.0, 1.0);
  }
  float aaFade(float x){ return 1.0 - smoothstep(0.25, 0.6, fwidth(x)); }
`;

/**
 * kind: "petronas" | "city"
 * city instances carry aStyle (vec4): x = style id 0..3, y = tint seed, z = lit ratio, w = window module (m)
 */
export function createFacadeMaterial(kind, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, envMapIntensity: opts.envMapIntensity ?? (kind === "petronas" ? 1.6 : 1.2) });
  const uniforms = { uLights: { value: 0 }, uStyle: { value: new THREE.Vector4(...(opts.style ?? [0, 0.3, 0.12, 1.5])) } };
  const instanced = kind === "city";
  const radial = opts.radial === true;
  mat.userData.uniforms = uniforms;
  mat.customProgramCacheKey = () => `facade-${kind}-${radial ? "r" : "p"}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute vec2 aFacade;
         ${instanced ? "attribute vec4 aStyle;" : "uniform vec4 uStyle;"}
         varying vec2 vFacade; varying float vRoof; varying vec4 vStyle;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         ${
           instanced
             ? `vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
                vec3 lp = position * sc;
                ${radial ? "vFacade = vec2(atan(lp.z, lp.x) * length(lp.xz), lp.y);" : "vFacade = vec2(abs(normal.z) > 0.5 ? lp.x : lp.z, lp.y);"}
                vRoof = step(0.5, normal.y);
                vStyle = aStyle;`
             : `vFacade = aFacade; vRoof = step(0.7, normal.y); vStyle = ${kind === "petronas" ? "vec4(0.0)" : "uStyle"};`
         }`,
      );

    const petronas = /* glsl */ `
      {
        float FH = 4.16;                                   // floor height
        float fy = vFacade.y / FH;
        float mx = vFacade.x / 1.6;                        // mullion module
        float fade = aaFade(fy);
        float spandrel = band(fy, 0.0, 0.25) * fade + (1.0 - fade) * 0.3;
        float fin = band(fy, 0.25, 0.29) * fade;
        float mull = band(mx, 0.0, 0.05) * aaFade(mx);
        float glassMask = clamp(1.0 - spandrel - fin - mull * 0.8, 0.0, 1.0);
        float panel = fhash(vec2(floor(fy), floor(mx * 0.5)));
        vec3 steel = vec3(0.86, 0.87, 0.89) * (0.92 + 0.1 * panel);
        vec3 glass = vec3(0.16, 0.18, 0.19);
        diffuseColor.rgb = mix(steel, glass, glassMask);
        metalnessFactor = mix(1.0, 0.45, glassMask);
        roughnessFactor = mix(0.24 + 0.12 * panel, 0.035, glassMask);
        if (vRoof > 0.5) { diffuseColor.rgb = vec3(0.55); metalnessFactor = 0.8; roughnessFactor = 0.4; glassMask = 0.0; }
        facadeFin = fin;
        facadeLit = glassMask * step(0.94, fhash(vec2(floor(fy), floor(mx)))) * smoothstep(0.35, 0.9, fract(fy));
      }`;

    const city = /* glsl */ `
      {
        float style = vStyle.x;
        float seed = vStyle.y;
        float FH = style < 0.5 ? 3.9 : (style < 1.5 ? 3.3 : (style < 2.5 ? 3.6 : 3.1));
        float W = vStyle.w;
        float fy = vFacade.y / FH;
        float mx = vFacade.x / W;
        float fadeY = aaFade(fy);
        float fadeX = aaFade(mx);
        vec3 tint = 0.5 + 0.5 * cos(6.2831 * (seed + vec3(0.0, 0.33, 0.67)));
        vec3 wall; vec3 glass; float glassMask; float wallRough; float wallMetal;
        if (style < 0.5) {            // glass curtain wall
          glass = mix(vec3(0.10, 0.16, 0.18), vec3(0.14, 0.17, 0.20), tint.x) * (0.8 + 0.4 * tint.y);
          wall = vec3(0.45, 0.47, 0.5);
          float mull = band(mx, 0.0, 0.04) * fadeX;
          float sp = band(fy, 0.0, 0.12) * fadeY;
          glassMask = clamp(1.0 - mull - sp, 0.0, 1.0) * (fadeY * 0.9 + 0.1);
          glassMask = mix(0.85, glassMask, fadeX);
          wallRough = 0.35; wallMetal = 0.7;
        } else if (style < 1.5) {     // concrete with punched windows
          wall = mix(vec3(0.78, 0.74, 0.66), vec3(0.86, 0.85, 0.82), tint.z) * (0.75 + 0.25 * tint.x);
          glass = vec3(0.07, 0.08, 0.09);
          glassMask = band(fy, 0.3, 0.85) * band(mx, 0.15, 0.85);
          glassMask = mix(0.32, glassMask, fadeX * fadeY);
          wallRough = 0.85; wallMetal = 0.0;
        } else if (style < 2.5) {     // ribbon windows
          wall = mix(vec3(0.84, 0.83, 0.8), vec3(0.62, 0.64, 0.66), tint.y);
          glass = vec3(0.08, 0.1, 0.12);
          glassMask = band(fy, 0.38, 0.92);
          glassMask = mix(0.5, glassMask, fadeY);
          wallRough = 0.7; wallMetal = 0.05;
        } else {                      // residential: balconies + sliding doors
          wall = mix(vec3(0.88, 0.86, 0.8), vec3(0.8, 0.72, 0.6), tint.x);
          glass = vec3(0.1, 0.11, 0.12);
          float slab = band(fy, 0.0, 0.18);
          glassMask = (1.0 - slab) * band(mx, 0.1, 0.7);
          glassMask = mix(0.35, glassMask, fadeX * fadeY);
          wallRough = 0.8; wallMetal = 0.0;
        }
        float cell = fhash(vec2(floor(fy), floor(mx)) + seed * 91.0);
        diffuseColor.rgb = mix(wall, glass, glassMask);
        metalnessFactor = mix(wallMetal, 0.3, glassMask);
        roughnessFactor = mix(wallRough, 0.06 + 0.1 * cell, glassMask);
        if (vRoof > 0.5) { diffuseColor.rgb = vec3(0.42, 0.41, 0.4) * (0.8 + 0.4 * tint.z); metalnessFactor = 0.0; roughnessFactor = 0.9; glassMask = 0.0; }
        facadeFin = 0.0;
        facadeLit = glassMask * step(1.0 - vStyle.z, cell);
      }`;

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}`)
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
         float facadeFin = 0.0; float facadeLit = 0.0;
         ${kind === "petronas" ? petronas : city}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
           normal = normalize(mix(normal, upV, facadeFin * 0.75));
         }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * facadeLit * uLights;`,
      );
  };
  return mat;
}
