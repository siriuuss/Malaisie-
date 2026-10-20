import * as THREE from "three";
import { clamp, smootherstep } from "./util.js";

// Brahminy kite wings seen from the bird's own eyes: they sweep into the edges of the
// frame during the landing flare, beat twice to brake, then fold away.

function wingGeometry() {
  // planform in wing space: x = span (root 0 → tip), y = chord
  const s = new THREE.Shape();
  s.moveTo(0, 0.12);
  s.bezierCurveTo(0.35, 0.2, 0.75, 0.2, 1.05, 0.1);
  // primaries ("fingers")
  const tips = [
    [1.18, 0.02],
    [1.22, -0.08],
    [1.2, -0.18],
    [1.13, -0.27],
    [1.02, -0.33],
  ];
  let prev = [1.05, 0.1];
  for (const [x, y] of tips) {
    s.quadraticCurveTo(prev[0] + 0.05, (prev[1] + y) / 2, x, y);
    s.lineTo(x - 0.1, y - 0.02);
    prev = [x - 0.1, y - 0.02];
  }
  // trailing edge with secondary feather scallops
  for (let i = 0; i < 7; i++) {
    const x = 0.9 - i * 0.13;
    s.quadraticCurveTo(x + 0.06, -0.36, x, -0.3);
  }
  s.lineTo(0, -0.18);
  s.lineTo(0, 0.12);
  const g = new THREE.ShapeGeometry(s, 24);
  // gentle camber
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setZ(i, -0.08 * Math.sin(Math.PI * clamp(x / 1.2)) - 0.05 * y * y);
  }
  // lay the wing flat: span +x, leading edge forward (-z), upper surface facing +y
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function buildWings() {
  const geo = wingGeometry();
  // chestnut feathers; emissive stands in for light scattering through backlit feathers
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a3c1a, emissive: 0x4a1e08, emissiveIntensity: 0.9, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  // feather striations + translucent rim when backlit
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vW;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvW = position.xy;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vW;").replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       float barbs = 0.5 + 0.5 * sin(vW.x * 160.0 + vW.y * 40.0);
       float shafts = smoothstep(0.92, 1.0, sin(vW.x * 26.0));
       diffuseColor.rgb *= 0.8 + 0.25 * barbs - 0.25 * shafts;
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.05, 0.04), smoothstep(0.9, 1.2, vW.x));`,
    );
  };
  mat.customProgramCacheKey = () => "wing";
  const left = new THREE.Mesh(geo, mat);
  const right = new THREE.Mesh(geo, mat);
  left.scale.x = -1; // span toward -x
  const pivotL = new THREE.Group();
  const pivotR = new THREE.Group();
  pivotL.add(left);
  pivotR.add(right);
  const rig = new THREE.Group();
  rig.add(pivotL, pivotR);
  rig.visible = false;

  const cam = new THREE.Matrix4();
  // flare(t): 0 = folded out of view, 1 = wings thrown forward
  function flare(t) {
    const open = smootherstep(19.95, 20.18, t) * (1 - smootherstep(20.36, 20.58, t));
    const beat = t > 20.12 && t < 20.4 ? Math.sin((t - 20.12) * Math.PI * 2 * 7) * 0.35 : 0;
    return { open, beat };
  }
  function update(t, camera) {
    const { open, beat } = flare(t);
    rig.visible = open > 0.01;
    if (!rig.visible) return;
    cam.copy(camera.matrixWorld);
    rig.matrix.copy(cam);
    rig.matrixAutoUpdate = false;
    rig.matrixWorldNeedsUpdate = true;
    // wing roots just behind/below the eye; open = swept forward + raised into the frame edges
    for (const [pivot, side] of [
      [pivotL, -1],
      [pivotR, 1],
    ]) {
      pivot.position.set(side * 0.32, -0.12, 0.4); // shoulders sit behind and outside the eyes
      pivot.rotation.set(0, 0, 0);
      // open pose keeps only the primaries in the upper corners of the frame
      const sweep = THREE.MathUtils.lerp(-0.6, 1.2, open) + beat * 0.12;
      const dihedral = THREE.MathUtils.lerp(-0.5, 0.36, open) + beat * 0.7;
      pivot.rotateY(side * sweep);
      pivot.rotateZ(side * dihedral);
      pivot.rotateX(0.3 * open); // pitch the leading edge up: braking
      pivot.scale.setScalar(1.9);
    }
  }
  return { rig, update };
}

// Head motion after touchdown: fast saccade-like turns with tiny stabilised drift.
export function headYawOffset(t, total) {
  const a = smootherstep(20.5, 20.66, t) * 0.74;
  const b = smootherstep(20.78, 20.94, t) * 0.26;
  const overshoot = Math.sin(clamp((t - 20.58) / 0.16) * Math.PI) * 0.035;
  return (a + b) * total + overshoot * Math.sign(total);
}
