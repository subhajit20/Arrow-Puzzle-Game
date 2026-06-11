// Iterates on an improved heart: two circles (lobes) + power-curve taper
// (body). Prints ASCII at the real board sizes to judge quality.
// Run: node scratch/heart-design.js
'use strict';

// y: -1 (top) .. +1 (bottom), x: -1 .. +1
function heartFn(x, y, P) {
  // Lobes: two circles touching at the centre — the gap above forms the notch
  const dxL = x + P.cx, dxR = x - P.cx, dy = y - P.cy;
  const inLobe = (dxL * dxL + dy * dy <= P.r * P.r) ||
                 (dxR * dxR + dy * dy <= P.r * P.r);
  // Body: below the lobe centres, width tapers to the bottom point with an
  // outward bulge (exponent < 1 keeps it plump near the top)
  let inBody = false;
  if (y >= P.cy && y <= P.tip) {
    const t = (y - P.cy) / (P.tip - P.cy);
    const w = P.wTop * Math.pow(1 - t, P.bulge);
    inBody = Math.abs(x) <= w;
  }
  return inLobe || inBody;
}

function render(nodes, P) {
  const N = nodes - 1;
  let out = '', active = 0;
  for (let r = 0; r < nodes; r++) {
    let line = '';
    for (let c = 0; c < nodes; c++) {
      const x = (c / N) * 2 - 1;
      const y = (r / N) * 2 - 1;
      const v = heartFn(x / P.scaleX, y / P.scaleY, P);
      line += v ? '#' : '.';
      if (v) active++;
    }
    out += line + '\n';
  }
  return { out, active, pct: Math.round(active / (nodes * nodes) * 100) };
}

const P = {
  cx: 0.50,   // lobe centre offset
  cy: -0.42,  // lobe centre height
  r: 0.52,    // lobe radius
  wTop: 1.0,  // body half-width at lobe centre height
  tip: 0.98,  // bottom point
  bulge: 0.72,// taper exponent (<1 = plump sides)
  scaleX: 0.96, scaleY: 0.92, // fit margins
};

for (const n of [25, 28, 46]) {
  const { out, pct } = render(n, P);
  console.log(`--- ${n}x${n} nodes (${pct}% active) ---`);
  console.log(out);
}
