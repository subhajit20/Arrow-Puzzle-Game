// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
import { DIRS, DK } from './constants';
// Pure grid/random helpers shared across the game. Depends on constants.js (DIRS, DK).

// Cell id -> [col, row].
export const cr = (id, C) => [id % C, Math.floor(id / C)];

// Random integer in [0, n).
export const rnd = n => Math.floor(Math.random() * n);

// Random element of an array.
export const pick = a => a[rnd(a.length)];

// Seeded PRNG (mulberry32): returns a () => [0, 1) function. Same seed → same sequence, so a board
// generated from a seed can be rebuilt exactly.
export function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Fresh random 32-bit seed for a new board.
export const makeSeed = () => Math.floor(Math.random() * 4294967296);

// Every cell id from `head` (exclusive) straight in `dir` to the board edge.
export function lane(head, dir, C, R) {
    let [c, r] = cr(head, C);
    const [dc, dr] = DIRS[dir];
    const o = [];
    while (true) {
        c += dc; r += dr;
        if (c < 0 || c >= C || r < 0 || r >= R) break;
        o.push(r * C + c);
    }
    return o;
}

// (Board shape masks live in GridShape.js.)

// Number of occupied orthogonal neighbours of `id` (occ is a Uint8Array mask).
export function occNbrs(occ, id, C, R) {
    const x = id % C, y = Math.floor(id / C); let n = 0;
    for (const d of DK) {
        const [dc, dr] = DIRS[d];
        const nx = x + dc, ny = y + dr;
        if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
        if (occ[ny * C + nx]) n++;
    }
    return n;
}
