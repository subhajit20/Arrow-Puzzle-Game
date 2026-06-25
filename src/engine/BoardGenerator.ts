// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
import { DIRS, DK, OPP, CW, CCW } from './constants';
import { cr, rnd, pick, occNbrs, lane } from './utils';
// Reverse-construction board generator for Arrow Escape.
// Builds the board backwards (placing pieces whose head ray is currently clear), then fills any
// leftover empty cells so the board is ~fully covered, solvable by construction, and free of lone dots.
// Depends on constants.js (DIRS, DK, OPP, CW, CCW) and utils.js (cr, rnd, pick, occNbrs).

// How strongly the deep-head bias avoids re-using an over-used exit direction. The deep-head pick
// scores each candidate as laneLength − BALANCE × (how far that direction is ahead of the least-used
// one). 0 = pure longest-lane (collapses tall boards into same-direction striping); higher = the
// generator spreads long lanes across N/S/E/W for an organic, non-biased look. Difficulty is
// unaffected (depth comes from long buried lanes, not from them pointing the same way; the
// generateForTier calibration absorbs any small openness drift).
export const DEEP_HEAD_BALANCE = 8;

export class BoardGenerator {
    // Generate a board of C columns x R rows. Optional `mask` (Uint8Array, 1=in-board, 0=outside)
    // shapes the board. `difficulty` (0..1) controls head placement only (not piece length/shape):
    // 0 = random heads (easy, high branching), 1 = deepest-lane heads (hard, low branching).
    // Returns { arrows }.
    generate(C, R, mask = null, difficulty = 0, motifs = null) {
        return this.#build(C, R, mask, difficulty, motifs);
    }

    // Calibrated generation: build a board, MEASURE how open it is, and keep one whose openness
    // lands in the tier's band. Too open (easy) → raise the deep-head bias and rebuild; too tight
    // (hard) → lower it. Because openness is a size-independent fraction, the SAME bands work for
    // any grid size — calibration just finds the right per-board knob. Returns the closest board.
    generateForTier(C, R, mask, tier, motifs = null) {
        let knob = tier.knob, best = null, bestDist = Infinity;
        for (let attempt = 0; attempt < 8; attempt++) {
            const board = this.#build(C, R, mask, knob, motifs);
            const openness = this.measureOpenness(board.arrows, C, R);
            const dist = openness < tier.min ? tier.min - openness
                : (openness > tier.max ? openness - tier.max : 0);
            if (dist === 0) return { arrows: board.arrows, motifCount: board.motifCount, openness, tier: tier.name, attempts: attempt + 1 };
            if (dist < bestDist) { bestDist = dist; best = { arrows: board.arrows, motifCount: board.motifCount, openness, tier: tier.name, attempts: attempt + 1 }; }
            // Step the knob toward the band — proportional to how far out we are, so narrow bands
            // converge without overshooting.
            const step = Math.max(0.03, Math.min(0.2, dist * 3.5));
            knob = openness > tier.max ? Math.min(1, knob + step) : Math.max(0, knob - step);
        }
        return best;
    }

    // Size-independent difficulty signal: fraction of pieces clearable on the OPENING board
    // (clearable-at-start / total pieces). High = open/easy, low = tight/hard. Being a ratio, it
    // stays consistent across grid sizes, so one set of tier bands fits every board.
    measureOpenness(arrows, C, R) {
        const N = C * R;
        const owner = new Int32Array(N).fill(-1);
        for (const a of arrows) for (const c of a.body) owner[c] = a.id;
        let clear = 0;
        for (const a of arrows) {
            let c = a.body[a.body.length - 1] % C, r = Math.floor(a.body[a.body.length - 1] / C);
            const [dc, dr] = DIRS[a.dir]; let ok = true;
            while (true) {
                c += dc; r += dr;
                if (c < 0 || c >= C || r < 0 || r >= R) break;
                const o = owner[r * C + c]; if (o !== -1 && o !== a.id) { ok = false; break; }
            }
            if (ok) clear++;
        }
        return arrows.length ? clear / arrows.length : 0;
    }

    #build(C, R, mask, difficulty = 0, motifs = null) {
        const N = C * R;
        const occ = new Uint8Array(N).fill(1);
        const ahead = { N: new Int16Array(N), S: new Int16Array(N), E: new Int16Array(N), W: new Int16Array(N) };
        for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
            const id = y * C + x;
            ahead.E[id] = C - 1 - x;
            ahead.W[id] = x;
            ahead.S[id] = R - 1 - y;
            ahead.N[id] = y;
        }
        const cand = new Set();
        for (let id = 0; id < N; id++) for (const d of DK) if (ahead[d][id] === 0) { cand.add(id); break; }

        function removeCell(id) {
            occ[id] = 0; cand.delete(id);
            const x = id % C, y = Math.floor(id / C);
            for (let xx = x - 1; xx >= 0; xx--) { const j = y * C + xx; if (--ahead.E[j] === 0 && occ[j]) cand.add(j); }
            for (let xx = x + 1; xx < C; xx++) { const j = y * C + xx; if (--ahead.W[j] === 0 && occ[j]) cand.add(j); }
            for (let yy = y - 1; yy >= 0; yy--) { const j = yy * C + x; if (--ahead.S[j] === 0 && occ[j]) cand.add(j); }
            for (let yy = y + 1; yy < R; yy++) { const j = yy * C + x; if (--ahead.N[j] === 0 && occ[j]) cand.add(j); }
        }

        // Mask: "remove" every outside cell up front. removeCell clears it and decrements the
        // ahead-counts of in-board cells behind it, so the heart's boundary cells become the
        // initial candidates and arrows can exit straight through the outside.
        if (mask) for (let id = 0; id < N; id++) if (!mask[id] && occ[id]) removeCell(id);

        const arrows = []; let idc = 0; const dirCount = { N: 0, S: 0, E: 0, W: 0 };
        const motifCount = {};   // which motifs this board actually used (and how many of each)

        // Motif palette. Normally each board uses a RANDOM SUBSET of these (2–3), so boards differ.
        // If `motifs` is given (shape-mask levels), the board uses ONLY those motifs — so each shape
        // is filled with motifs that suit its geometry.
        // comb + meander are always present (the signature motifs); snake/bend/spiral
        // round out each board as varied extras.
        const MOTIFS = [
            { name: 'comb', weight: 26, target: () => 14 + rnd(14) },
            { name: 'meander', weight: 26, target: () => 14 + rnd(16) },   // Greek-key fret
            { name: 'snake', weight: 22, target: () => 14 + rnd(20) },
            { name: 'wander', weight: 20, target: () => 12 + rnd(16) },    // drunk-walk: organic one-off squiggle
            { name: 'bend', weight: 12, target: () => 6 + rnd(8) },
            { name: 'spiral', weight: 10, target: () => 16 + rnd(16) },
        ];
        let palette;
        if (motifs && motifs.length) {
            palette = MOTIFS.filter(m => motifs.includes(m.name));   // shape's allowed motifs only
        }
        if (!palette || !palette.length) {
            // Always include ONE of meander / wander (chosen at random), plus at least 3 of the
            // remaining 5 motifs (3–5) for variety.
            const sig = pick(['meander', 'wander']);
            const always = MOTIFS.filter(m => m.name === sig);
            const others = MOTIFS.filter(m => m.name !== sig).sort(() => Math.random() - 0.5).slice(0, 1 + rnd(1));
            palette = [...always, ...others];
        }
        const paletteWeight = palette.reduce((s, m) => s + m.weight, 0);
        const pickMotif = () => {
            let r = Math.random() * paletteWeight;
            for (const m of palette) { if ((r -= m.weight) < 0) return m; }
            return palette[palette.length - 1];
        };

        // Corridor accents (long straight separators), independent of the palette. On shape levels
        // only allowed if the shape's motif list includes "corridor".
        const corridorBudget = motifs ? (motifs.includes("corridor") ? 1 + rnd(2) : 0) : (1 + rnd(2));
        let corridorUsed = 0;

        // Exit-lane length for a head h leaving in direction d (= cells it travels to the edge).
        const laneLenOf = (h, d) => {
            const x = h % C, y = Math.floor(h / C);
            return d === 'E' ? C - 1 - x : d === 'W' ? x : d === 'S' ? R - 1 - y : y;
        };

        while (cand.size) {
            // Head selection. With probability `difficulty`, use the DEEP-HEAD bias: prefer
            // candidate heads with LONG clear exit lanes (buried interior heads, far from their
            // edge). Long lanes get crossed by later pieces → deep dependency chains → low branching
            // → a real puzzle. This also kills "freebies" (head-at-edge, lane 0).
            // BUT picking the single globally-longest lane every time collapses non-square boards
            // into a monoculture of same-direction pieces (vertical striping on tall boards). So we
            // score each candidate by laneLength penalised by how OVER-USED its direction already is
            // (relative to the least-used direction): long lanes still win, but once a direction gets
            // ahead it's discouraged, spreading the long lanes across N/S/E/W for an organic look.
            // Otherwise fall back to the original random pick + direction balancing (easy).
            // Either way the motif and its length are chosen separately, so board variety is intact.
            let H = null, D = null;
            if (Math.random() < difficulty) {
                const minDir = Math.min(dirCount.N, dirCount.S, dirCount.E, dirCount.W);
                let bestScore = -Infinity;
                for (const h of cand) {
                    const x = h % C, y = Math.floor(h / C);
                    const hv = DK.filter(d => ahead[d][h] === 0);
                    const hg = hv.filter(d => {
                        const bx = x - DIRS[d][0], by = y - DIRS[d][1];
                        return bx >= 0 && bx < C && by >= 0 && by < R && occ[by * C + bx];
                    });
                    for (const d of (hg.length ? hg : hv)) {
                        const score = laneLenOf(h, d) - DEEP_HEAD_BALANCE * (dirCount[d] - minDir) + Math.random() * 0.5;
                        if (score > bestScore) { bestScore = score; H = h; D = d; }
                    }
                }
            }
            if (H === null) {                       // easy path (or bias found nothing): random head
                H = pick([...cand]);
                const valid = DK.filter(d => ahead[d][H] === 0);
                const [hx, hy] = cr(H, C);
                const growable = valid.filter(d => {
                    const bx = hx - DIRS[d][0], by = hy - DIRS[d][1];
                    return bx >= 0 && bx < C && by >= 0 && by < R && occ[by * C + bx];
                });
                const opts = growable.length ? growable : valid;
                D = opts[0]; let best = 1e9;
                for (const d of opts) if (dirCount[d] < best) { best = dirCount[d]; D = d; }
            }
            dirCount[D]++;

            let mode, target;
            if (corridorUsed < corridorBudget && Math.random() < 0.18) {
                mode = 'corridor'; target = 999; corridorUsed++;   // runs straight until it can't
            } else {
                const motif = pickMotif();        // chosen from this board's palette only
                mode = motif.name; target = motif.target();
            }

            // Per-piece FLOW + SCALE variation. A uniform board of similar-size tightly-coiling pieces
            // reads as a monotonous "weave". To get the target's organic mix, vary how much each piece
            // runs straight vs winds, and let a chunk of pieces run LONG and flowing across the board.
            //   - flowing runner (~30%): long, mostly-straight snake → big sweeping pieces
            //   - tight (~25%): short straight runs, winds a lot → compact pieces
            //   - medium (rest): the default
            let straightCap = 4 + rnd(3), turnProb = 0.35;        // medium (default)
            if (mode !== 'corridor') {
                const flow = Math.random();
                if (flow < 0.30) { mode = 'snake'; target = 16 + rnd(22); straightCap = 9 + rnd(9); turnProb = 0.12; }
                else if (flow < 0.55) { straightCap = 2 + rnd(2); turnProb = 0.6; }
            }

            const spin = Math.random() < 0.5 ? CW : CCW;
            const body = [H]; const used = new Set([H]); let cur = H, lastDir = null, run = 0;

            // Per-motif walk state.
            const back = OPP[D];                 // first backward step direction (the head's reverse)
            const armLen = 4 + rnd(3);           // comb tooth length
            let combDir = back;                  // current comb tooth direction
            const combSpine = spin[back];        // comb connector (consistent turn) direction
            let combCount = 0, combNeedSpine = false;
            let corridorBendsLeft = mode === 'corridor' ? (Math.random() < 0.3 ? 1 : 0) : 0;  // ~30% get one bend
            // Greek-key meander: a fixed self-avoiding "hook" sequence repeated. A=advance (back),
            // P=perpendicular hook (consistent turn). Starts with an A run to satisfy the forced first step.
            const meP = spin[back];
            const meScript = [
                { d: back, n: 2 }, { d: OPP[meP], n: 2 }, { d: OPP[back], n: 1 },
                { d: OPP[meP], n: 1 }, { d: back, n: 3 }, { d: meP, n: 3 },
            ];
            let meIdx = 0, meCount = 0;

            while (body.length < target) {
                const [cx, cy] = cr(cur, C); let cs = [];
                for (const d of DK) {
                    const [dc, dr] = DIRS[d];
                    const nx = cx + dc, ny = cy + dr;
                    if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
                    const nid = ny * C + nx;
                    if (!occ[nid] || used.has(nid)) continue;
                    cs.push({ id: nid, d, w: occNbrs(occ, nid, C, R) });
                }
                if (body.length === 1) cs = cs.filter(c => c.d === OPP[D]);
                if (!cs.length) break;

                let minW = 99; for (const c of cs) if (c.w < minW) minW = c.w;
                const kept = cs.filter(c => c.w <= minW + 1);

                let ch = null;
                if (mode === 'snake') {
                    // Run straight up to this piece's straightCap, then turn with turnProb. A high cap
                    // + low prob = a long flowing runner; a low cap + high prob = a tight winder. The
                    // per-piece variation (set above) is what gives the board its mixed-scale, organic look.
                    const straightAll = lastDir ? cs.filter(c => c.d === lastDir) : [];
                    const turns = cs.filter(c => c.d !== lastDir);
                    const forceTurn = lastDir && run >= straightCap && turns.length && Math.random() < turnProb;
                    if (straightAll.length && !forceTurn) ch = straightAll[0];
                    else if (turns.length) ch = pick(turns);
                    else { const s = kept.filter(c => !lastDir || c.d === lastDir); ch = pick(s.length ? s : kept); }
                } else if (mode === 'wander') {
                    // Drunk walk: a unique, organic one-off squiggle. Mostly turns at random, with a
                    // small chance to keep going straight so it isn't pure noise. Self-avoidance is
                    // already guaranteed by `cs` (excludes used/occupied cells).
                    const straightAll = lastDir ? cs.filter(c => c.d === lastDir) : [];
                    const turns = lastDir ? cs.filter(c => c.d !== lastDir) : cs;
                    if (straightAll.length && Math.random() < 0.3) ch = straightAll[0];
                    else if (turns.length) ch = pick(turns);
                    else ch = pick(kept);
                } else if (mode === 'spiral') {
                    // Let each arm run its full length before turning, for clean rectangular spirals.
                    if (lastDir && run < 5) {
                        const st = cs.filter(c => c.d === lastDir);
                        if (st.length) ch = st[0];
                    }
                    if (!ch) {
                        const want = lastDir ? spin[lastDir] : null;
                        const sp = kept.filter(c => c.d === want);
                        ch = pick(sp.length ? sp : kept);
                    }
                } else if (mode === 'comb') {
                    // Serpentine (boustrophedon): run a tooth of armLen cells, take one spine step,
                    // then run the next tooth in the OPPOSITE direction — produces a comb / E shape.
                    const want = combNeedSpine ? combSpine : combDir;
                    const m = cs.filter(c => c.d === want);
                    if (m.length) {
                        ch = m[0];
                        if (combNeedSpine) { combNeedSpine = false; combDir = OPP[combDir]; combCount = 0; }
                        else if (++combCount >= armLen) { combNeedSpine = true; }
                    } else {
                        ch = pick(kept);                 // blocked: take what we can, resync the teeth
                        combNeedSpine = false; combCount = 0; combDir = ch.d;
                    }
                } else if (mode === 'meander') {
                    // Follow the Greek-key script segment by segment; end cleanly when blocked.
                    if (meCount >= meScript[meIdx].n) { meIdx = (meIdx + 1) % meScript.length; meCount = 0; }
                    const m = cs.filter(c => c.d === meScript[meIdx].d);
                    if (m.length) { ch = m[0]; meCount++; }
                    if (!ch) break;                              // scripted turn blocked → key ends here
                } else if (mode === 'corridor') {
                    // Long straight run. Keep going straight; allow at most one bend, then end the
                    // piece cleanly when it can no longer continue (rather than winding).
                    if (!lastDir) {
                        ch = cs[0];                              // forced first backward step (OPP[D])
                    } else {
                        const straightAll = cs.filter(c => c.d === lastDir);
                        if (straightAll.length) ch = straightAll[0];
                        else if (corridorBendsLeft > 0) {
                            const turns = cs.filter(c => c.d !== lastDir);
                            if (turns.length) { ch = pick(turns); corridorBendsLeft--; }
                        }
                    }
                    if (!ch) break;                              // straight blocked & no bend left → corridor ends
                } else {
                    ch = pick(kept);
                }

                run = (ch.d === lastDir) ? run + 1 : 0;
                body.push(ch.id); used.add(ch.id); lastDir = ch.d; cur = ch.id;
            }

            for (const cell of body) removeCell(cell);
            // Never emit a lone arrowhead-dot. A length-1 body just becomes an empty cell that
            // fillGaps re-covers (by tail-extend, or by pairing it into a proper 2-cell arrow).
            if (body.length >= 2) {
                arrows.push({ id: idc++, body: body.slice().reverse(), dir: D });
                motifCount[mode] = (motifCount[mode] || 0) + 1;
            }
        }
        this.#fillGaps(arrows, C, R, mask);   // absorb leftover empty cells into adjacent arrows for full coverage
        return { arrows, motifCount };
    }

    // Can the whole board be cleared? Greedily remove any arrow whose head ray is clear
    // (empty or its own cells), repeat until stuck. Solvable iff every arrow gets removed.
    #rcBoardSolvable(arrows, C, R) {
        const N = C * R;
        const owner = new Int32Array(N).fill(-1);
        for (const a of arrows) for (const c of a.body) owner[c] = a.id;
        const byId = new Map(arrows.map(a => [a.id, a]));
        const remaining = new Set(arrows.map(a => a.id));
        let progress = true;
        while (remaining.size && progress) {
            progress = false;
            for (const id of [...remaining]) {
                const a = byId.get(id);
                let [c, r] = cr(a.body[a.body.length - 1], C);
                const [dc, dr] = DIRS[a.dir];
                let clear = true;
                while (true) {
                    c += dc; r += dr;
                    if (c < 0 || c >= C || r < 0 || r >= R) break;
                    const o = owner[r * C + c];
                    if (o !== -1 && o !== id) { clear = false; break; }
                }
                if (clear) {
                    for (const cc of a.body) owner[cc] = -1;
                    remaining.delete(id); progress = true;
                }
            }
        }
        return remaining.size === 0;
    }

    // Coverage pass: reclaim empty cells (including those left by dropped length-1 bodies) with
    // two solvability-verified strategies, alternated until nothing more fits. Both add occupancy
    // that can block another arrow's exit, so every change is checked with rcBoardSolvable and
    // reverted on failure.
    //   1) Tail-extend: absorb an empty cell into an adjacent arrow's TAIL end.
    //   2) Pocket-fill: grow ONE varied self-avoiding walk through an empty pocket and emit it as a
    //      single winding arrow. (Pairing pockets into minimal 2-cell arrows produced ugly combs of
    //      identical parallel arrows, so we grow a real piece instead.)
    // They feed each other — a new arrow's tail can be extended next pass, and vice versa.
    #fillGaps(arrows, C, R, mask = null) {
        const N = C * R;
        const owner = new Int32Array(N).fill(-1);
        for (const a of arrows) for (const c of a.body) owner[c] = a.id;
        const byId = new Map(arrows.map(a => [a.id, a]));
        let nextId = arrows.reduce((m, a) => Math.max(m, a.id), -1) + 1;
        const inBoard = id => !mask || mask[id];   // outside-mask cells are never filled

        const tryTailExtend = () => {
            let did = false;
            for (let id = 0; id < N; id++) {
                if (owner[id] !== -1 || !inBoard(id)) continue;
                const x = id % C, y = Math.floor(id / C);
                for (const d of DK) {
                    const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
                    if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
                    const nid = ny * C + nx;
                    const oid = owner[nid];
                    if (oid === -1) continue;
                    const a = byId.get(oid);
                    if (a.body[0] !== nid) continue;            // tail end only
                    a.body.unshift(id); owner[id] = oid;
                    if (this.#rcBoardSolvable(arrows, C, R)) { did = true; break; }
                    a.body.shift(); owner[id] = -1;
                }
            }
            return did;
        };

        const tryPocketFill = () => {
            let did = false;
            for (let start = 0; start < N; start++) {
                if (owner[start] !== -1 || !inBoard(start)) continue;
                // Random self-avoiding walk through connected empty cells (capped length).
                const walk = [start]; const used = new Set([start]); let cur = start;
                while (walk.length < 14) {
                    const x = cur % C, y = Math.floor(cur / C); const opts = [];
                    for (const d of DK) {
                        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
                        if (nx < 0 || nx >= C || ny < 0 || ny >= R) continue;
                        const nid = ny * C + nx;
                        if (owner[nid] === -1 && !used.has(nid) && inBoard(nid)) opts.push(nid);
                    }
                    if (!opts.length) break;
                    const nid = pick(opts); walk.push(nid); used.add(nid); cur = nid;
                }
                if (walk.length < 2) continue;                  // lone empty cell: leave as a dot
                // Try the walk with either end as the head (heading = its terminal segment dir).
                for (const w of [walk, walk.slice().reverse()]) {
                    const px = w[w.length - 2] % C, py = Math.floor(w[w.length - 2] / C);
                    const hx = w[w.length - 1] % C, hy = Math.floor(w[w.length - 1] / C);
                    let dir = null; for (const d of DK) if (DIRS[d][0] === hx - px && DIRS[d][1] === hy - py) { dir = d; break; }
                    const a = { id: nextId, body: w.slice(), dir };
                    arrows.push(a); byId.set(a.id, a); for (const c of w) owner[c] = a.id;
                    if (this.#rcBoardSolvable(arrows, C, R)) { nextId++; did = true; break; }
                    arrows.pop(); byId.delete(a.id); for (const c of w) owner[c] = -1;
                }
            }
            return did;
        };

        let changed = true;
        while (changed) {
            changed = false;
            if (tryTailExtend()) changed = true;
            if (tryPocketFill()) changed = true;
        }
    }
}
