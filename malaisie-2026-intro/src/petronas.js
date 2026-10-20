import * as THREE from "three";

// Simplified but recognisable Petronas Twin Towers, in metres.
export const TOWER_W = 53; // half distance between tower centres
export const TOWER_R = 23; // footprint radius
export const SPIRE_TOP = 452;

// 8-pointed star (two squares at 45°) with rounded lobes in the inner corners.
function starShape(r) {
  const shape = new THREE.Shape();
  const pts = [];
  const inner = r * 0.8;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (k % 2 === 0) {
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    } else {
      // rounded lobe between two star points
      for (let j = -2; j <= 2; j++) {
        const aj = a + (j / 2) * (Math.PI / 16) * 0.9;
        const rr = inner * (1 - 0.06 * (j * j) / 4);
        pts.push([Math.cos(aj) * rr, Math.sin(aj) * rr]);
      }
    }
  }
  pts.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

function tier(r, y0, y1, mat) {
  const g = new THREE.ExtrudeGeometry(starShape(r), { depth: y1 - y0, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return new THREE.Mesh(g, mat);
}

function buildTower(mat, accent) {
  const t = new THREE.Group();
  const R = TOWER_R;
  const tiers = [
    [1.0, 0, 240],
    [0.9, 240, 282],
    [0.8, 282, 316],
    [0.68, 316, 340],
    [0.55, 340, 360],
  ];
  for (const [s, a, b] of tiers) {
    t.add(tier(R * s, a, b, mat));
    // thin setback ledge
    const ledge = new THREE.Mesh(new THREE.CylinderGeometry(R * s * 0.82, R * s * 0.82, 1.5, 32), accent);
    ledge.position.y = b + 0.75;
    t.add(ledge);
  }
  // crown + pinnacle
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.3, R * 0.42, 20, 32), mat);
  crown.position.y = 370;
  t.add(crown);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.12, R * 0.2, 18, 24), accent);
  pin.position.y = 389;
  t.add(pin);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R * 0.16, 24, 16), accent);
  ball.position.y = 399;
  t.add(ball);
  // spire with rings
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 1.4, SPIRE_TOP - 400, 16), accent);
  spire.position.y = 400 + (SPIRE_TOP - 400) / 2;
  t.add(spire);
  for (let i = 0; i < 6; i++) {
    const y = 406 + i * 7;
    const rr = 1.4 * (1 - (y - 400) / (SPIRE_TOP - 400)) + 0.35;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.12, 8, 24), accent);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    t.add(ring);
  }
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), accent);
  tip.position.y = SPIRE_TOP - 0.1;
  t.add(tip);
  return t;
}

export function buildPetronas() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.55, roughness: 0.32 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xdfe2e8, metalness: 0.7, roughness: 0.25 });
  for (const side of [-1, 1]) {
    const tower = buildTower(mat, accent);
    tower.position.x = side * TOWER_W;
    group.add(tower);
    // round annex ("bustle") on the outer side
    const annex = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 170, 32), mat);
    annex.position.set(side * (TOWER_W + TOWER_R + 4), 85, 8);
    group.add(annex);
  }
  // Skybridge (double-deck, ~170 m) with its V support legs
  const inner = TOWER_W - TOWER_R * 0.8;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(inner * 2 + 4, 9, 7), accent);
  bridge.position.y = 172;
  group.add(bridge);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 62, 8), accent);
    const a = new THREE.Vector3(side * inner, 118, 0);
    const b = new THREE.Vector3(0, 168, 0);
    leg.position.copy(a).lerp(b, 0.5);
    leg.lookAt(b);
    leg.rotateX(Math.PI / 2);
    leg.scale.y = a.distanceTo(b) / 62;
    group.add(leg);
  }
  return group;
}
