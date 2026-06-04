// =============================================================================
// RCBuilder.js — Reverse Construction board generator
//
// Builds boards backwards: every path is placed only when its head's straight
// ray to the board edge is currently clear. Solve order = reverse of placement.
// Solvability is guaranteed by construction — no search needed.
//
// Pipeline:
//   buildChain → fillA → fillB → fillC → [score] → fillD
//
// Dependencies: Grid, Path, SolvabilityOracle, ZoneMap
// =============================================================================

class RCBuilder {
    constructor(oracle) {
        this.oracle = oracle; // SolvabilityOracle instance
    }

    // ── Path length sampling ──────────────────────────────────────────────────

    // Returns a random target path length (in nodes).
    // Path length range: min 2 (Phase D last resort), max 15 (Phase A/B cap).
    // Phase A/B enforce minimum 3 via growWalk; Phase D Option 4 allows 2.
    sampleLen() {
        const r = Math.random();
        if (r < 0.25) return Math.min(15, Math.round(3  + Math.random() * 2));  // SHORT  3–5
        if (r < 0.75) return Math.min(15, Math.round(5  + Math.random() * 5));  // MEDIUM 5–10
        return             Math.min(15, Math.round(10 + Math.random() * 5));     // LONG   10–15
    }

    // ── Head ray check ────────────────────────────────────────────────────────

    // Returns true if the straight ray from head in (dr,dc) is clear of all
    // placed pieces (nodeOwner ≠ -1).
    headRayClear(grid, head, dr, dc) {
        let r = head.r + dr, c = head.c + dc;
        while (grid.inBounds(r, c)) {
            if (!grid.isFree(r, c)) return false;
            r += dr; c += dc;
        }
        return true;
    }

    // ── Ray length to edge ────────────────────────────────────────────────────

    _rayLenToEdge(h, dr, dc, rows, cols) {
        if (dr > 0) return rows - h.r;
        if (dr < 0) return h.r;
        if (dc > 0) return cols - h.c;
        return h.c;
    }

    // ── Pocket check ──────────────────────────────────────────────────────────

    // Returns false if placing a node at (candidate.r, candidate.c) would leave
    // any currently-free neighbour with zero free neighbours — creating an
    // isolated pocket that Phase D cannot fill.
    // This is the key invariant for guaranteed 100% coverage.
    pocketCheck(grid, candidate) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
            const nr = candidate.r + dr, nc = candidate.c + dc;
            if (!grid.inBounds(nr, nc)) continue;
            if (!grid.isFree(nr, nc)) continue;
            // This free neighbour would lose one free neighbour (the candidate).
            // If it currently has only 1 free neighbour (the candidate itself),
            // placing candidate would isolate it.
            if (grid.freeNeighborCount(nr, nc) === 1) return false;
        }
        return true;
    }

    // ── Anchor picker ─────────────────────────────────────────────────────────

    // Samples 14 random candidates, picks the least-occupied interior-biased one.
    pickAnchor(grid) {
        const R = grid.rows + 1, C = grid.cols + 1;
        let best = null, bestScore = -Infinity;

        for (let k = 0; k < 14; k++) {
            const r = (Math.random() * R) | 0;
            const c = (Math.random() * C) | 0;
            if (!grid.isFree(r, c)) continue;

            let empty = 0, tot = 0;
            for (let dr = -2; dr <= 2; dr++) {
                for (let dc = -2; dc <= 2; dc++) {
                    const rr = r + dr, cc = c + dc;
                    if (!grid.inBounds(rr, cc)) continue;
                    tot++;
                    if (grid.isFree(rr, cc)) empty++;
                }
            }
            const interior = Math.min(r, R - 1 - r, c, C - 1 - c) /
                             Math.max(1, Math.min(R, C) / 2);
            const score = (empty / tot) + interior * 0.5 + Math.random() * 0.1;
            if (score > bestScore) { bestScore = score; best = { r, c }; }
        }
        return best;
    }

    // ── Self-avoiding walk ────────────────────────────────────────────────────

    // Winding self-avoiding walk from anchor.
    // zoneMap (ZoneMap instance, optional): zone-aware scoring and length scaling.
    growWalk(grid, anchor, targetLen, zoneMap) {
        const R = grid.rows + 1, C = grid.cols + 1;
        const nodes = [{ r: anchor.r, c: anchor.c }];
        const local = new Set([anchor.r + ',' + anchor.c]);
        let cur = anchor, pdr = 0, pdc = 0, streak = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        for (let i = 1; i < targetLen; i++) {
            const opts = dirs
                .map(([dr, dc]) => ({ r: cur.r + dr, c: cur.c + dc, dr, dc }))
                .filter(o =>
                    o.r >= 0 && o.r < R && o.c >= 0 && o.c < C &&
                    grid.isFree(o.r, o.c) &&
                    !local.has(o.r + ',' + o.c)
                );

            if (!opts.length) break;

            // Zone-aware scoring
            const knobs = zoneMap
                ? zoneMap.walkKnobs(cur.r, cur.c)
                : ZoneMap.WALK_KNOBS[ZoneMap.NEUTRAL];

            // SP-1: force a turn on the 3rd node to guarantee ≥1 direction change
            const forceTurn = streak >= knobs.maxStraight || i === 2;

            for (const o of opts) {
                const straight = (o.dr === pdr && o.dc === pdc);
                o.score = (straight
                    ? (forceTurn ? -10 : knobs.straightScore)
                    : knobs.turnScore)
                    + Math.random();
            }
            opts.sort((a, b) => b.score - a.score);
            const pick = opts[0];

            nodes.push({ r: pick.r, c: pick.c });
            local.add(pick.r + ',' + pick.c);
            const isStraight = (pick.dr === pdr && pick.dc === pdc);
            streak = isStraight ? streak + 1 : 0;
            pdr = pick.dr; pdc = pick.dc; cur = pick;
        }

        return nodes;
    }

    // ── Phase: Chain backbone ─────────────────────────────────────────────────

    // Places (depth+1) right-pointing 3-node pieces in a row.
    // Each is blocked by its right neighbour → dependency chain of depth = count−1.
    buildChain(grid, paths, ctr, depth, row) {
        const count = depth + 1;
        if (3 * count - 1 > grid.cols) return 0;
        let placed = 0;

        for (let j = 0; j < count; j++) {
            const c0    = 3 * j;
            const nodes = [
                { r: row, c: c0 },
                { r: row, c: c0 + 1 },
                { r: row, c: c0 + 2 },
            ];
            if (!nodes.every(n => grid.isFree(n.r, n.c))) break;
            if (!this.headRayClear(grid, nodes[2], 0, 1))  break;

            for (const n of nodes) grid.setOwner(n.r, n.c, ctr.n);
            const p = new Path(ctr.n, nodes, 'RIGHT');
            p.placeOrder = ctr.n;
            paths.push(p);
            ctr.n++; placed++;
        }
        return placed;
    }

    // ── Phase A: Main fill ────────────────────────────────────────────────────

    // Places winding pieces, respecting the head-ray-clear rule.
    // knobs.d [0,1]: high → prefers long inward rays (harder).
    // knobs.zoneMap (ZoneMap): enables zone-aware length + scoring.
    fillA(grid, paths, ctr, maxFails, knobs) {
        const d        = knobs?.d        != null ? knobs.d        : 0.5;
        const lenScale = knobs?.lenScale != null ? knobs.lenScale : 1;
        const zoneMap  = knobs?.zoneMap  || null;
        const { rows, cols } = grid;
        let fails = 0;

        while (fails < maxFails) {
            const anchor = this.pickAnchor(grid);
            if (!anchor) { fails++; continue; }

            const effLen = zoneMap
                ? lenScale * zoneMap.lenScale(anchor.r, anchor.c)
                : lenScale;
            const targetLen = Math.max(3, Math.round(this.sampleLen() * effLen));
            const nodes     = this.growWalk(grid, anchor, targetLen, zoneMap);

            if (nodes.length < 3) { fails++; continue; }

            // Try both endpoints as head; hard-reject if head faces own walk body.
            const nodeSet = new Set(nodes.map(n => n.r + ',' + n.c));
            const facesSelf = (h, dr, dc) => {
                // Walk the ray through the walk's own nodes (not yet in grid).
                let r = h.r + dr, c = h.c + dc;
                while (grid.inBounds(r, c)) {
                    if (nodeSet.has(r + ',' + c)) return true;
                    if (!grid.isFree(r, c)) return false;
                    r += dr; c += dc;
                }
                return false;
            };

            const cands = [];
            { const h = nodes[nodes.length - 1], pv = nodes[nodes.length - 2];
              const dr = h.r - pv.r, dc = h.c - pv.c;
              if (!facesSelf(h, dr, dc) && this.headRayClear(grid, h, dr, dc))
                  cands.push({ seq: nodes, h, dr, dc }); }
            { const h = nodes[0], pv = nodes[1];
              const dr = h.r - pv.r, dc = h.c - pv.c;
              if (!facesSelf(h, dr, dc) && this.headRayClear(grid, h, dr, dc))
                  cands.push({ seq: nodes.slice().reverse(), h, dr, dc }); }

            if (!cands.length) { fails++; continue; }

            let best = null, bestScore = -Infinity;
            for (const cn of cands) {
                const rl = this._rayLenToEdge(cn.h, cn.dr, cn.dc, rows, cols) /
                           Math.max(rows, cols);
                const sc = (2 * d - 1) * rl + Math.random() * 0.25;
                if (sc > bestScore) { bestScore = sc; best = cn; }
            }

            for (const n of best.seq) grid.setOwner(n.r, n.c, ctr.n);
            const p = new Path(ctr.n, best.seq, Path.deltaToHeading(best.dr, best.dc));
            p.placeOrder = ctr.n;
            paths.push(p);
            ctr.n++; fails = 0;
        }
    }

    // ── Phase B: Gap fill ─────────────────────────────────────────────────────

    // Places small new pieces (3–6 nodes) in remaining empty pockets.
    fillB(grid, paths, ctr) {
        const R = grid.rows + 1, C = grid.cols + 1;
        let progress = true;

        while (progress) {
            progress = false;
            for (let r = 0; r < R; r++) {
                for (let c = 0; c < C; c++) {
                    if (!grid.isFree(r, c)) continue;

                    for (let attempt = 0; attempt < 6 && grid.isFree(r, c); attempt++) {
                        const nodes = this.growWalk(grid, { r, c }, 3 + (Math.random() * 3 | 0));
                        if (nodes.length < 3) continue;

                        // PX-1: prefer endpoint that doesn't immediately face own walk body.
                        const ends = [
                            [nodes[nodes.length - 1], nodes[nodes.length - 2], false],
                            [nodes[0],                 nodes[1],                 true],
                        ];
                        ends.sort(([h1, pv1], [h2, pv2]) => {
                            const faces = (h, pv) => {
                                const dr = h.r - pv.r, dc = h.c - pv.c;
                                return nodes.some(n => n.r === h.r + dr && n.c === h.c + dc) ? 1 : 0;
                            };
                            return faces(h1, pv1) - faces(h2, pv2);
                        });

                        for (const [h, pv, rev] of ends) {
                            const dr = h.r - pv.r, dc = h.c - pv.c;
                            if (!this.headRayClear(grid, h, dr, dc)) continue;
                            const seq = rev ? nodes.slice().reverse() : nodes;
                            const id  = ctr.n++;
                            for (const n of seq) grid.setOwner(n.r, n.c, id);
                            const p = new Path(id, seq, Path.deltaToHeading(dr, dc));
                            p.placeOrder = id;
                            paths.push(p);
                            progress = true; break;
                        }
                    }
                }
            }
        }
    }

    // ── Phase C: Tail-append ──────────────────────────────────────────────────

    // Appends isolated empty nodes to adjacent path tails.
    // Validates with full oracle after each append; reverts LIFO if broken.
    fillC(grid, paths) {
        const R = grid.rows + 1, C = grid.cols + 1;
        const byId   = new Map(paths.map(p => [p.id, p]));
        const appends = [];
        let progress  = true;

        while (progress) {
            progress = false;
            for (let r = 0; r < R; r++) {
                for (let c = 0; c < C; c++) {
                    if (!grid.isFree(r, c)) continue;
                    const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];

                    for (const [ar, ac] of nb) {
                        if (!grid.inBounds(ar, ac)) continue;
                        const oid = grid.owner(ar, ac); if (oid < 0) continue;
                        const p   = byId.get(oid);      if (!p) continue;
                        const tail = p.tail();
                        if (tail.r !== ar || tail.c !== ac) continue;

                        p.nodes.unshift({ r, c });
                        grid.setOwner(r, c, oid);
                        appends.push({ r, c, p });
                        progress = true; break;
                    }
                }
            }
        }

        // Revert LIFO until the board is solvable, then recompute place order.
        while (appends.length && !this.oracle.isBoardSolvable(paths, grid)) {
            const a = appends.pop();
            a.p.nodes.shift();
            grid.setOwner(a.r, a.c, -1);
        }
        this.oracle.recomputePlaceOrder(paths, grid);
    }

    // ── Phase D: Oracle gap fill ──────────────────────────────────────────────

    // Fills remaining empty nodes using oracle as the sole validity gate.
    // Unlike A/B (head-ray-clear) and C (tail-append + LIFO), Phase D allows
    // placements that fail the ray check if they still produce a solvable board.
    fillD(grid, paths, ctr) {
        const R    = grid.rows + 1, C = grid.cols + 1;
        const byId = new Map(paths.map(p => [p.id, p]));
        const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        const emptyNbCount = (r, c) => {
            let n = 0;
            for (const [dr, dc] of DIRS) {
                const nr = r + dr, nc = c + dc;
                if (grid.inBounds(nr, nc) && grid.isFree(nr, nc)) n++;
            }
            return n;
        };

        // ── Convergence loop ──────────────────────────────────────────────────
        let progress = true;
        while (progress) {
            progress = false;

            // Most-constrained-first: fewest empty neighbours processed first
            const empty = [];
            for (let r = 0; r < R; r++)
                for (let c = 0; c < C; c++)
                    if (grid.isFree(r, c))
                        empty.push({ r, c, ec: emptyNbCount(r, c) });
            empty.sort((a, b) => a.ec - b.ec);

            for (const { r, c } of empty) {
                if (!grid.isFree(r, c)) continue;
                let placed = false;

                // Option 1: 3-node L-shaped new piece
                for (let d1 = 0; d1 < DIRS.length && !placed; d1++) {
                    const [dr1, dc1] = DIRS[d1];
                    const r2 = r + dr1, c2 = c + dc1;
                    if (!grid.inBounds(r2, c2) || !grid.isFree(r2, c2)) continue;

                    for (let d2 = 0; d2 < DIRS.length && !placed; d2++) {
                        const [dr2, dc2] = DIRS[d2];
                        if (dr2 === -dr1 && dc2 === -dc1) continue; // no backtrack
                        if (dr2 ===  dr1 && dc2 ===  dc1) continue; // no straight — must be L
                        const r3 = r2 + dr2, c3 = c2 + dc2;
                        if (!grid.inBounds(r3, c3) || !grid.isFree(r3, c3)) continue;
                        if (r3 === r && c3 === c) continue; // no self-loop

                        const seq  = [{ r, c }, { r: r2, c: c2 }, { r: r3, c: c3 }];
                        const tries = [
                            { ns: seq,                   hdr:  dr2, hdc:  dc2 },
                            { ns: seq.slice().reverse(), hdr: -dr1, hdc: -dc1 },
                        ];
                        for (const { ns, hdr, hdc } of tries) {
                            const id = ctr.n;
                            for (const n of ns) grid.setOwner(n.r, n.c, id);
                            const p = new Path(id, ns, Path.deltaToHeading(hdr, hdc));
                            p.placeOrder = id;
                            paths.push(p); byId.set(id, p);

                            if (this.oracle.isBoardSolvable(paths, grid)) {
                                ctr.n++; placed = true; progress = true; break;
                            }
                            for (const n of ns) grid.setOwner(n.r, n.c, -1);
                            paths.pop(); byId.delete(id);
                        }
                    }
                }

                if (placed) continue;

                // Option 2: prepend to adjacent tail
                for (const [dr, dc] of DIRS) {
                    if (placed) break;
                    const ar = r + dr, ac = c + dc;
                    if (!grid.inBounds(ar, ac)) continue;
                    const oid = grid.owner(ar, ac); if (oid < 0) continue;
                    const p   = byId.get(oid);      if (!p) continue;
                    if (p.tail().r !== ar || p.tail().c !== ac) continue;

                    p.nodes.unshift({ r, c });
                    grid.setOwner(r, c, oid);
                    // headSelfClear fast gate: tail-prepend doesn't change the head
                    // but verify the head wasn't already self-pointing.
                    if (this.oracle.headSelfClear(p, grid) &&
                        this.oracle.isBoardSolvable(paths, grid)) {
                        placed = true; progress = true;
                    } else {
                        p.nodes.shift();
                        grid.setOwner(r, c, -1);
                    }
                }

                if (placed) continue;

                // Option 3: extend adjacent path head — (r,c) becomes the new head
                for (const [dr, dc] of DIRS) {
                    if (placed) break;
                    const ar = r + dr, ac = c + dc;
                    if (!grid.inBounds(ar, ac)) continue;
                    const oid = grid.owner(ar, ac); if (oid < 0) continue;
                    const p   = byId.get(oid);      if (!p) continue;
                    if (p.head().r !== ar || p.head().c !== ac) continue;

                    const savedHeading = p.heading;
                    p.nodes.push({ r, c });
                    grid.setOwner(r, c, oid);
                    p.heading = Path.deltaToHeading(r - ar, c - ac);

                    // headSelfClear fast gate: new head must not point into own body.
                    if (this.oracle.headSelfClear(p, grid) &&
                        this.oracle.isBoardSolvable(paths, grid)) {
                        placed = true; progress = true;
                    } else {
                        p.nodes.pop();
                        grid.setOwner(r, c, -1);
                        p.heading = savedHeading;
                    }
                }

                if (placed) continue;

                // Option 4: 2-node piece (last resort)
                for (let d = 0; d < DIRS.length && !placed; d++) {
                    const [dr, dc] = DIRS[d];
                    const r2 = r + dr, c2 = c + dc;
                    if (!grid.inBounds(r2, c2) || !grid.isFree(r2, c2)) continue;

                    const seq  = [{ r, c }, { r: r2, c: c2 }];
                    const tries = [
                        { ns: seq,                   hdr:  dr, hdc:  dc },
                        { ns: seq.slice().reverse(), hdr: -dr, hdc: -dc },
                    ];
                    for (const { ns, hdr, hdc } of tries) {
                        const id = ctr.n;
                        for (const n of ns) grid.setOwner(n.r, n.c, id);
                        const p = new Path(id, ns, Path.deltaToHeading(hdr, hdc));
                        p.placeOrder = id;
                        paths.push(p); byId.set(id, p);

                        if (this.oracle.isBoardSolvable(paths, grid)) {
                            ctr.n++; placed = true; progress = true; break;
                        }
                        for (const n of ns) grid.setOwner(n.r, n.c, -1);
                        paths.pop(); byId.delete(id);
                    }
                }
            }
        }

        // ── Reversal pass ─────────────────────────────────────────────────────
        // For remaining empties: reverse adjacent path so its head becomes tail,
        // then prepend the empty node to the new tail.
        let revProgress = true;
        while (revProgress) {
            revProgress = false;
            for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
                if (!grid.isFree(r, c)) continue;
                let placed = false;

                for (const [dr, dc] of DIRS) {
                    if (placed) break;
                    const ar = r + dr, ac = c + dc;
                    if (!grid.inBounds(ar, ac)) continue;
                    const oid = grid.owner(ar, ac); if (oid < 0) continue;
                    const p   = byId.get(oid); if (!p || p.nodes.length < 2) continue;
                    if (p.head().r !== ar || p.head().c !== ac) continue;

                    const savedNodes   = p.nodes.slice();
                    const savedHeading = p.heading;
                    p.nodes.reverse();
                    const nh = p.nodes[p.nodes.length - 1], np = p.nodes[p.nodes.length - 2];
                    p.heading = Path.deltaToHeading(nh.r - np.r, nh.c - np.c);
                    p.nodes.unshift({ r, c });
                    grid.setOwner(r, c, oid);

                    // headSelfClear gate: reversed head must not aim into own body.
                    if (this.oracle.headSelfClear(p, grid) &&
                        this.oracle.isBoardSolvable(paths, grid)) {
                        placed = true; revProgress = true;
                    } else {
                        p.nodes.shift();
                        grid.setOwner(r, c, -1);
                        p.nodes    = savedNodes;
                        p.heading  = savedHeading;
                    }
                }
            }
        }

        // ── Force-fill: isolated nodes ────────────────────────────────────────
        // Nodes with all 4 neighbours occupied cannot affect any head ray.
        // Safe to attach to an adjacent tail without the oracle check.
        for (let r = 0; r < R; r++) {
            for (let c = 0; c < C; c++) {
                if (!grid.isFree(r, c)) continue;
                if (emptyNbCount(r, c) > 0) continue; // only truly isolated

                // Try adjacent tails — only safe if head is already self-clear.
                let placed = false;
                for (const [dr, dc] of DIRS) {
                    if (placed) break;
                    const ar = r + dr, ac = c + dc;
                    if (!grid.inBounds(ar, ac)) continue;
                    const oid = grid.owner(ar, ac); if (oid < 0) continue;
                    const p   = byId.get(oid);      if (!p) continue;
                    if (p.tail().r !== ar || p.tail().c !== ac) continue;
                    p.nodes.unshift({ r, c });
                    grid.setOwner(r, c, oid);
                    if (this.oracle.headSelfClear(p, grid)) {
                        placed = true;
                    } else {
                        p.nodes.shift();
                        grid.setOwner(r, c, -1);
                    }
                }

                // Last resort: reverse adjacent head, prepend, verify
                if (!placed) {
                    for (const [dr, dc] of DIRS) {
                        if (placed) break;
                        const ar = r + dr, ac = c + dc;
                        if (!grid.inBounds(ar, ac)) continue;
                        const oid = grid.owner(ar, ac); if (oid < 0) continue;
                        const p   = byId.get(oid); if (!p || p.nodes.length < 2) continue;
                        if (p.head().r !== ar || p.head().c !== ac) continue;

                        const savedNodes   = p.nodes.slice();
                        const savedHeading = p.heading;
                        p.nodes.reverse();
                        const nh = p.nodes[p.nodes.length - 1], np = p.nodes[p.nodes.length - 2];
                        p.heading = Path.deltaToHeading(nh.r - np.r, nh.c - np.c);
                        p.nodes.unshift({ r, c });
                        grid.setOwner(r, c, oid);

                        if (this.oracle.isBoardSolvable(paths, grid)) {
                            placed = true;
                        } else {
                            p.nodes.shift();
                            grid.setOwner(r, c, -1);
                            p.nodes   = savedNodes;
                            p.heading = savedHeading;
                        }
                    }
                }
            }
        }

        this.oracle.recomputePlaceOrder(paths, grid);
    }
}
