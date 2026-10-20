import * as THREE from "three";

// Seeded PRNG — the only source of randomness in the film.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => clamp((x - a) / (b - a));
export const smooth = (x) => x * x * (3 - 2 * x);
export const smootherstep = (a, b, x) => {
  const t = invLerp(a, b, x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
export const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;

// lat/lon (degrees) -> point on a sphere, matching THREE.SphereGeometry's UV layout
// (u = (lon + 180) / 360, v = (90 - lat) / 180) so markers land exactly on the texture.
export function latLonToVec3(lat, lon, radius = 1, target = new THREE.Vector3()) {
  const phi = ((lon + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  return target.set(
    -radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

// Time-keyed cubic Hermite track (non-uniform Catmull-Rom tangents), C1-smooth in time.
// keys: [{ t, v }] where v is a number or [x, y, z]. Holds the end values outside the range.
export function makeTrack(keys) {
  const n = keys.length;
  const dim = Array.isArray(keys[0].v) ? keys[0].v.length : 1;
  const vals = keys.map((k) => (dim === 1 ? [k.v] : k.v));
  const ts = keys.map((k) => k.t);
  const tangents = vals.map((_, i) => {
    if (keys[i].hold) return new Array(dim).fill(0);
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const dt = ts[i1] - ts[i0];
    return vals[i].map((_, d) => (dt > 0 ? (vals[i1][d] - vals[i0][d]) / dt : 0));
  });
  return function sample(t) {
    if (t <= ts[0]) return dim === 1 ? vals[0][0] : vals[0].slice();
    if (t >= ts[n - 1]) return dim === 1 ? vals[n - 1][0] : vals[n - 1].slice();
    let i = 0;
    while (i < n - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const s = (t - ts[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const out = vals[i].map(
      (_, d) =>
        h00 * vals[i][d] + h10 * h * tangents[i][d] + h01 * vals[i + 1][d] + h11 * h * tangents[i + 1][d],
    );
    return dim === 1 ? out[0] : out;
  };
}

// Seeded value-noise fbm painted into a canvas — used for cloud and mist sprites.
export function makeNoiseCanvas(size, seed, { octaves = 5, falloff = 0.55, radial = true, contrast = 1.6 } = {}) {
  const rand = mulberry32(seed);
  const grid = 256;
  const lattice = new Float32Array(grid * grid).map(() => rand());
  // Lattice wraps with the octave's period so the texture tiles seamlessly.
  const sample = (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const g = (a, b) => lattice[(((b % period) + period) % period) * grid + (((a % period) + period) % period)];
    return lerp(lerp(g(xi, yi), g(xi + 1, yi), xf), lerp(g(xi, yi + 1), g(xi + 1, yi + 1), xf), yf);
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let f = 4;
      let amp = 1;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += amp * sample((x / size) * f, (y / size) * f, f);
        norm += amp;
        f *= 2;
        amp *= falloff;
      }
      let v = sum / norm;
      v = clamp((v - 0.5) * contrast + 0.5);
      if (radial) {
        const dx = x / size - 0.5;
        const dy = y / size - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        v *= clamp(1 - smooth(clamp(r)));
        v = clamp(v * 1.8);
      }
      const p = (y * size + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = 255;
      img.data[p + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
