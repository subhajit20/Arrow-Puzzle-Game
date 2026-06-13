// Prototype: windmill mask — hub circle (island), 5 radiating blades
// (islands), trapezoid tower with arched door notch + base bar (one body).
// Run: node scratch/windmill-design.js
'use strict';

function windmill(R, C) {
  const W = C + 1;
  const mask = new Uint8Array((R + 1) * W);

  const HUB_Y = -0.50, HUB_R = 0.18;
  const BLADE_IN = 0.28, BLADE_OUT = 0.70;       // radial extent from hub
  const BLADE_W = 0.13;                          // half-width, widens outward
  const ANGLES = [0, 60, -60, 120, -120].map(a => a * Math.PI / 180);

  for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
    const x = ((c / C) * 2 - 1) / 0.95;
    const y = ((r / R) * 2 - 1) / 0.97;

    let inside = false;
    const dx = x, dy = y - HUB_Y;

    // Hub — separate island (blades start at BLADE_IN > HUB_R)
    if (dx * dx + dy * dy <= HUB_R * HUB_R) inside = true;

    // Blades — rotated radial bands around the hub
    if (!inside) {
      for (const phi of ANGLES) {
        const u = dx * Math.sin(phi) - dy * Math.cos(phi);   // along blade
        const v = dx * Math.cos(phi) + dy * Math.sin(phi);   // across blade
        if (u >= BLADE_IN && u <= BLADE_OUT &&
            Math.abs(v) <= BLADE_W + u * 0.06) { inside = true; break; }
      }
    }

    // Tower — trapezoid with arched door notch carved from the bottom
    if (!inside && y >= -0.06 && y <= 0.80) {
      const hw = 0.24 + (y + 0.06) / 0.86 * 0.21;
      if (Math.abs(x) <= hw) {
        const DOOR_W = 0.12, DOOR_TOP = 0.50;
        const inDoor = (y >= DOOR_TOP && Math.abs(x) <= DOOR_W) ||
          (x * x + (y - DOOR_TOP) * (y - DOOR_TOP) <= DOOR_W * DOOR_W);
        inside = !inDoor;
      }
    }

    // Base bar — attached below the tower (door arch becomes enclosed)
    if (!inside && y > 0.80 && y <= 0.98 && Math.abs(x) <= 0.78) inside = true;

    mask[r * W + c] = inside ? 1 : 0;
  }
  return mask;
}

function report(R, C, render) {
  const W = C + 1, total = (R + 1) * W;
  const mask = windmill(R, C);
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
  console.log(`${R}x${C}: ${comps.length} islands ${JSON.stringify(comps.sort((a, b) => b - a))}` +
    ` active ${Math.round(active / total * 100)}%`);
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

report(50, 38, true);
report(54, 40, false);
report(46, 34, false);
