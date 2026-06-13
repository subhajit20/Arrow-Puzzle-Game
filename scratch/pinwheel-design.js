// Prototype: paper pinwheel mask — 4 big petal blades + 4 inner triangles,
// 4-fold rotational symmetry, per-piece shrink for white seams. 8 islands.
// Run: node scratch/pinwheel-design.js
'use strict';

// Convex polygon test (vertices in order, sign-consistent cross products)
function inPoly(px, py, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const cr = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
    if (cr !== 0) {
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

function centroid(poly) {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

function pinwheel(R, C, SHRINK) {
  const W = C + 1;
  const mask = new Uint8Array((R + 1) * W);

  // Fundamental pieces (top sector, y down). Eyeballed from the icon:
  // big petal leans left (counterclockwise swirl), triangle tucks lower-left.
  const BIG = [
    [0.04, -0.14],   // near centre (chamfered)
    [0.11, -0.12],
    [0.24, -0.56],   // right edge
    [0.04, -0.98],   // outer tip
    [-0.50, -0.70],  // rounded outer corner
    [-0.30, -0.30],  // back toward centre
  ];
  // Inner blade: sits in the free wedge between this petal's lower-left
  // edge and the next petal's upper edge, with explicit margins to both.
  const TRI = [
    [-0.26, -0.20],
    [-0.52, -0.62],
    [-0.62, -0.45],
    [-0.60, -0.28],
  ];

  // Pre-rotate the two pieces into all 4 quadrants, shrink each about its
  // own centroid (carves the white seams).
  const pieces = [];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, cos = Math.cos(a), sin = Math.sin(a);
    for (const polyRaw of [BIG, TRI]) {
      const [pcx, pcy] = centroid(polyRaw);
      const poly = [...polyRaw].sort((a, b) =>
        Math.atan2(a[1] - pcy, a[0] - pcx) - Math.atan2(b[1] - pcy, b[0] - pcx));
      const rot = poly.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
      const [cx, cy] = centroid(rot);
      pieces.push({
        poly: rot.map(([x, y]) => [cx + (x - cx) * SHRINK, cy + (y - cy) * SHRINK]),
      });
    }
  }

  for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
    const x = ((c / C) * 2 - 1) / 0.98;
    const y = ((r / R) * 2 - 1) / 0.98;
    let inside = false;
    for (const p of pieces) {
      if (inPoly(x, y, p.poly)) { inside = true; break; }
    }
    mask[r * W + c] = inside ? 1 : 0;
  }
  return mask;
}

function report(R, C, SHRINK, render) {
  const W = C + 1, total = (R + 1) * W;
  const mask = pinwheel(R, C, SHRINK);
  const visited = new Uint8Array(total);
  const comps = [];
  for (let s = 0; s < total; s++) {
    if (!mask[s] || visited[s]) continue;
    let size = 0; const q = [s]; visited[s] = 1;
    while (q.length) {
      const k = q.pop(); size++;
      const r = (k / W) | 0, c = k % W;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr > R || nc < 0 || nc > C) continue;
        const j = nr * W + nc;
        if (mask[j] && !visited[j]) { visited[j] = 1; q.push(j); }
      }
    }
    comps.push(size);
  }
  const active = comps.reduce((a, b) => a + b, 0);
  console.log(`${R}x${C} shrink=${SHRINK}: ${comps.length} islands ` +
    `${JSON.stringify(comps.sort((a, b) => b - a))} active ${Math.round(active / total * 100)}%`);
  if (render) {
    let out = '';
    for (let r = 0; r <= R; r++) {
      let line = '';
      for (let c = 0; c <= C; c++) line += mask[r * W + c] ? '#' : '.';
      out += line + '\n';
    }
    console.log(out);
  }
}

const SHRINK = parseFloat(process.argv[2] || '0.93');
report(46, 46, SHRINK, true);
report(48, 48, SHRINK, false);
report(50, 50, SHRINK, false);
