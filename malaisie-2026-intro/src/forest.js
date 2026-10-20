import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "./util.js";

// Tropical tree crowns: lumpy "cauliflower" canopies (dipterocarp-like) with a leafy
// procedural surface, per-vertex ambient occlusion and sun translucency.

const NOISE = /* glsl */ `
  float h31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 p){
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

export function makeCrownGeometry(seed, { lumps = 6, flat = 0.75, simple = false } = {}) {
  const rand = mulberry32(seed);
  const parts = [];
  if (simple) lumps = 1;
  for (let i = 0; i < lumps; i++) {
    const r = simple ? 0.95 : 0.38 + rand() * 0.32;
    const a = rand() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.35 + rand() * 0.45;
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.translate(Math.cos(a) * d, (rand() - 0.2) * 0.35 + (i === 0 ? 0.25 : 0), Math.sin(a) * d);
    parts.push(g);
  }
  let g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  g.scale(1, flat, 1);
  // displace for leafy clumps; AO = how deep / low the vertex sits in the crown
  const p = g.attributes.position;
  const ao = new Float32Array(p.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 9.1 + seed) * Math.sin(v.y * 7.3) * Math.sin(v.z * 8.7 + seed * 0.3);
    v.multiplyScalar(1 + n * 0.08);
    p.setXYZ(i, v.x, v.y, v.z);
    const radial = Math.min(1, Math.hypot(v.x, v.z) / 1.1);
    ao[i] = Math.min(1, 0.35 + 0.65 * (0.55 * (v.y / flat + 0.35) + 0.45 * radial));
  }
  g.setAttribute("aAO", new THREE.BufferAttribute(ao, 1));
  g.computeVertexNormals();
  g.deleteAttribute("uv");
  return g;
}

export function createFoliageMaterial(sunDir) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, envMapIntensity: 0.6 });
  const uniforms = { uSunDir: { value: sunDir }, uSunCol: { value: new THREE.Color(1, 0.75, 0.45) } };
  mat.userData.uniforms = uniforms;
  mat.customProgramCacheKey = () => "foliage";
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aAO; varying float vAO; varying vec3 vWPos;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
         vAO = aAO;
         vec4 wp4 = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           wp4 = instanceMatrix * wp4;
         #endif
         vWPos = (modelMatrix * wp4).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying float vAO; varying vec3 vWPos; uniform vec3 uSunDir; uniform vec3 uSunCol;\n${NOISE}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         float leaf = vnoise(vWPos * 0.9) * 0.6 + vnoise(vWPos * 2.7) * 0.4;
         float leafH = leaf;
         float clump = vnoise(vWPos * 0.18);
         diffuseColor.rgb *= mix(0.68, 1.12, leaf) * mix(0.85, 1.1, clump);
         diffuseColor.rgb *= mix(0.25, 1.0, vAO);
         diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 1.1, 0.75), smoothstep(0.6, 0.9, leaf) * 0.5);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
           float dhx = dFdx(leafH); float dhy = dFdy(leafH);
           vec3 r1 = cross(dpdy, normal); vec3 r2 = cross(normal, dpdx);
           float det = dot(dpdx, r1);
           vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
           normal = normalize(abs(det) * normal - grad * 2.2);
         }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         {
           vec3 V = normalize(cameraPosition - vWPos);
           float back = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 6.0);   // sun shining through leaves
           totalEmissiveRadiance += uSunCol * diffuseColor.rgb * back * vAO * 0.7;
         }`,
      );
  };
  return mat;
}

const SHADES = ["#16361f", "#1d4527", "#24512c", "#2f5f31", "#3f6e34", "#51793a", "#2b4a2a"].map((h) => new THREE.Color(h));

/**
 * Scatter trees as InstancedMeshes (3 crown variants).
 * place(i, rand) -> { x, y, z, r, hScale } | null
 */
export function scatterTrees({ count, seed, place, material, castShadow = true, simple = false, cell = 220 }) {
  const rand = mulberry32(seed);
  const variants = simple
    ? [makeCrownGeometry(seed + 1, { simple: true, flat: 0.8 }), makeCrownGeometry(seed + 2, { simple: true, flat: 0.65 })]
    : [makeCrownGeometry(seed + 1), makeCrownGeometry(seed + 2, { lumps: 7, flat: 0.62 }), makeCrownGeometry(seed + 3, { lumps: 5, flat: 0.9 })];
  const spots = [];
  let tries = 0;
  while (spots.length < count && tries < count * 6) {
    tries++;
    const spot = place(spots.length, rand);
    if (!spot) continue;
    spot.rot = rand() * Math.PI * 2;
    spot.shade = Math.floor(rand() * SHADES.length);
    spot.bright = 0.85 + rand() * 0.3;
    spot.variant = spots.length % variants.length;
    spots.push(spot);
  }
  // bucket by spatial cell and variant
  const buckets = new Map();
  for (const sp of spots) {
    const key = `${Math.floor(sp.x / cell)}:${Math.floor(sp.z / cell)}:${sp.variant}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(sp);
  }
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const meshes = [];
  for (const list of buckets.values()) {
    const mesh = new THREE.InstancedMesh(variants[list[0].variant], material, list.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    list.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.rot);
      s.set(sp.r, sp.r * (sp.hScale ?? 1), sp.r);
      pv.set(sp.x, sp.y, sp.z);
      mtx.compose(pv, q, s);
      mesh.setMatrixAt(i, mtx);
      mesh.setColorAt(i, c.copy(SHADES[sp.shade]).multiplyScalar(sp.bright));
    });
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return meshes;
}
