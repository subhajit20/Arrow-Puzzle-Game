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

    // Dynamic cap scales with board size so large boards get visually prominent
    // paths instead of uniformly tiny ones.
    static lenCap(totalNodes) {
        if (totalNodes <= 200) return 12;
        if (totalNodes <= 600) return 18;
        if (totalNodes <= 1500) return 25;
        return 32;
    }

    sampleLen(totalNodes = 0) {
        const cap = RCBuilder.lenCap(totalNodes);
        const medRange = Math.max(6, (cap * 0.45) | 0);
        const longBase = Math.max(12, (cap * 0.7) | 0);
        const longRange = Math.max(2, cap - longBase);
        const r = Math.random();
        // Fewer short paths, longer medium and long paths for a logically packed feel
        if (r < 0.10) return Math.min(cap, 3 + Math.round(Math.random() * 2));                         // SHORT
        if (r < 0.65) return Math.min(cap, 6 + Math.round(Math.random() * medRange));                  // MEDIUM
        return Math.min(cap, longBase + Math.round(Math.random() * longRange));             // LONG
    }

    // ── Head ray check ────────────────────────────────────────────────────────

    // Returns true if the straight ray from head in (dr,dc) is clear of all
    // placed pieces (nodeOwner ≠ -1).
    headRayClear(grid, head, dr, dc) {
        let r = head.r + dr, c = head.c + dc;
        while (grid.inBounds(r, c)) {
            if (!grid.isFree(r, c)) return false; // only owned nodes block the ray
            r += dr; c += dc;
        }
        return true;
    }

    // ── Lock bonus ────────────────────────────────────────────────────────────

    // Counts currently-free placed pieces whose head ray passes through any
    // node of the candidate sequence. Placing the candidate "locks" those
    // pieces — they can no longer fire until the candidate clears, which pulls
    // them into the forced solve order and drives the branching factor down.
    _lockBonus(grid, paths, seq) {
        let bonus = 0;
        const nodeSet = new Set(seq.map(n => n.r + ',' + n.c));
        for (const p of paths) {
            const { dr, dc } = Path.headingToDelta(p.heading);
            const head = p.head();
            let r = head.r + dr, c = head.c + dc;
            let crosses = false, blocked = false;
            while (grid.inBounds(r, c)) {
                const o = grid.owner(r, c);
                if (o >= 0 && o !== p.id) { blocked = true; break; }
                if (nodeSet.has(r + ',' + c)) crosses = true;
                r += dr; c += dc;
            }
            if (!blocked && crosses) bonus++;
        }
        return bonus;
    }

    // Distance (in cells) from head to the first foreign blocker on the ray.
    // Returns 0 when the ray is clear to the board edge.
    _blockerDist(grid, head, dr, dc) {
        let r = head.r + dr, c = head.c + dc, dist = 1;
        while (grid.inBounds(r, c)) {
            if (!grid.isFree(r, c)) return dist;
            r += dr; c += dc; dist++;
        }
        return 0;
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
            if (!grid.isAvailable(r, c)) continue;

            let empty = 0, tot = 0;
            for (let dr = -2; dr <= 2; dr++) {
                for (let dc = -2; dc <= 2; dc++) {
                    const rr = r + dr, cc = c + dc;
                    if (!grid.inBounds(rr, cc)) continue;
                    tot++;
                    if (grid.isAvailable(rr, cc)) empty++;
                }
            }
            const interior = Math.min(r, R - 1 - r, c, C - 1 - c) /
                Math.max(1, Math.min(R, C) / 2);
            const score = (empty / tot) + interior * 0.5 + Math.random() * 0.1;
            if (score > bestScore) { bestScore = score; best = { r, c }; }
        }
        return best;
    }

    // ── Style-aware anchor pickers ────────────────────────────────────────────

    // EDGE — prefers nodes near the board boundary (inverse of interior bias).
    _pickAnchorEdge(grid) {
        const R = grid.rows + 1, C = grid.cols + 1;
        let best = null, bestScore = -Infinity;
        for (let k = 0; k < 18; k++) {
            const r = (Math.random() * R) | 0;
            const c = (Math.random() * C) | 0;
            if (!grid.isAvailable(r, c)) continue;
            let empty = 0, tot = 0;
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                const rr = r + dr, cc = c + dc;
                if (!grid.inBounds(rr, cc)) continue;
                tot++; if (grid.isAvailable(rr, cc)) empty++;
            }
            const edgeDist = Math.min(r, R - 1 - r, c, C - 1 - c);
            const edgeScore = 1.0 - edgeDist / Math.max(1, Math.min(R, C) / 2);
            const score = (empty / Math.max(1, tot)) * 0.4 + edgeScore * 0.6 + Math.random() * 0.1;
            if (score > bestScore) { bestScore = score; best = { r, c }; }
        }
        return best;
    }

    // CLUSTER — picks within clusterRadius of a randomly chosen cluster center.
    _pickAnchorClustered(grid, centers, radius) {
        if (!centers || !centers.length) return this.pickAnchor(grid);
        const R = grid.rows + 1, C = grid.cols + 1;
        const center = centers[(Math.random() * centers.length) | 0];
        let best = null, bestScore = -Infinity;
        for (let k = 0; k < 22; k++) {
            const dr = Math.round((Math.random() * 2 - 1) * radius);
            const dc = Math.round((Math.random() * 2 - 1) * radius);
            const r = Math.max(0, Math.min(R - 1, center.r + dr));
            const c = Math.max(0, Math.min(C - 1, center.c + dc));
            if (!grid.isAvailable(r, c)) continue;
            let empty = 0, tot = 0;
            for (let ddr = -1; ddr <= 1; ddr++) for (let ddc = -1; ddc <= 1; ddc++) {
                const rr = r + ddr, cc = c + ddc;
                if (!grid.inBounds(rr, cc)) continue;
                tot++; if (grid.isAvailable(rr, cc)) empty++;
            }
            const dist = Math.sqrt(dr * dr + dc * dc) / Math.max(1, radius);
            const score = (empty / Math.max(1, tot)) - dist * 0.3 + Math.random() * 0.1;
            if (score > bestScore) { bestScore = score; best = { r, c }; }
        }
        return best || this.pickAnchor(grid);
    }

    // INNER — 75% of candidates sampled from inside the landmark bounding box.
    _pickAnchorInner(grid, bbox) {
        if (!bbox) return this.pickAnchor(grid);
        const R = grid.rows + 1, C = grid.cols + 1;
        let best = null, bestScore = -Infinity;
        for (let k = 0; k < 20; k++) {
            let r, c;
            if (Math.random() < 0.75) {
                r = bbox.minR + Math.round(Math.random() * (bbox.maxR - bbox.minR));
                c = bbox.minC + Math.round(Math.random() * (bbox.maxC - bbox.minC));
            } else {
                r = (Math.random() * R) | 0;
                c = (Math.random() * C) | 0;
            }
            r = Math.max(0, Math.min(R - 1, r));
            c = Math.max(0, Math.min(C - 1, c));
            if (!grid.isAvailable(r, c)) continue;
            let empty = 0, tot = 0;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                const rr = r + dr, cc = c + dc;
                if (!grid.inBounds(rr, cc)) continue;
                tot++; if (grid.isAvailable(rr, cc)) empty++;
            }
            const score = (empty / Math.max(1, tot)) + Math.random() * 0.1;
            if (score > bestScore) { bestScore = score; best = { r, c }; }
        }
        return best || this.pickAnchor(grid);
    }

    // Dispatches to the correct anchor picker based on anchorMode.
    _pickAnchorForMode(grid, mode, clusterCenters, innerBbox, clusterRadius) {
        if (mode === 'EDGE') return this._pickAnchorEdge(grid);
        if (mode === 'CLUSTER') return this._pickAnchorClustered(grid, clusterCenters, clusterRadius || 5);
        if (mode === 'INNER') return this._pickAnchorInner(grid, innerBbox);
        return this.pickAnchor(grid); // UNIFORM (default)
    }

    // Bounding box of all nodes across a set of paths.
    _landmarkBbox(paths) {
        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        for (const p of paths) for (const { r, c } of p.nodes) {
            if (r < minR) minR = r; if (r > maxR) maxR = r;
            if (c < minC) minC = c; if (c > maxC) maxC = c;
        }
        return (minR === Infinity) ? null : { minR, maxR, minC, maxC };
    }

    // Farthest-point sampling: picks `count` well-spread cluster centers.
    _generateClusterCenters(grid, count) {
        const R = grid.rows + 1, C = grid.cols + 1;
        const centers = [];
        // Seed: random available node
        for (let tries = 0; tries < 40 && !centers.length; tries++) {
            const r = (Math.random() * R) | 0, c = (Math.random() * C) | 0;
            if (grid.inBounds(r, c)) centers.push({ r, c });
        }
        if (!centers.length) return centers;

        for (let i = 1; i < count; i++) {
            let bestDist = -1, best = null;
            // Sample ~30% of nodes for performance on large grids
            for (let k = 0; k < Math.max(40, ((R * C * 0.3) | 0)); k++) {
                const r = (Math.random() * R) | 0, c = (Math.random() * C) | 0;
                if (!grid.inBounds(r, c)) continue;
                const minDist = Math.min(...centers.map(ct =>
                    (r - ct.r) ** 2 + (c - ct.c) ** 2
                ));
                if (minDist > bestDist) { bestDist = minDist; best = { r, c }; }
            }
            if (best) centers.push(best);
        }
        return centers;
    }

    // ── Self-avoiding walk ────────────────────────────────────────────────────

    // Winding self-avoiding walk from anchor.
    // zoneMap (ZoneMap instance, optional): zone-aware scoring and length scaling.
    // colBound / rowBound (optional): hard inclusive upper limits on node coords —
    // used by fillASymmetric to constrain the walk to one half of the board.
    growWalk(grid, anchor, targetLen, zoneMap, colBound = Infinity, rowBound = Infinity) {
        const R = grid.rows + 1, C = grid.cols + 1;
        const nodes = [{ r: anchor.r, c: anchor.c }];
        const local = new Set([anchor.r + ',' + anchor.c]);
        let cur = anchor, pdr = 0, pdc = 0, ppdr = 0, ppdc = 0, streak = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        for (let i = 1; i < targetLen; i++) {
            const opts = dirs
                .map(([dr, dc]) => ({ r: cur.r + dr, c: cur.c + dc, dr, dc }))
                .filter(o =>
                    o.r >= 0 && o.r < R && o.c >= 0 && o.c < C &&
                    o.c <= colBound && o.r <= rowBound &&
                    grid.isAvailable(o.r, o.c) &&
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
                let score = straight
                    ? (forceTurn ? -10 : knobs.straightScore)
                    : knobs.turnScore;

                // U-turn penalty: discourage going opposite to the direction 2 steps ago (random squiggles)
                const isUTurn = (ppdr !== 0 || ppdc !== 0) && (o.dr === -ppdr && o.dc === -ppdc);
                if (isUTurn) {
                    score -= 2.5; // Apply significant penalty to favor going straight or making Z-turns
                }

                o.score = score + Math.random();
            }
            opts.sort((a, b) => b.score - a.score);
            const pick = opts[0];

            nodes.push({ r: pick.r, c: pick.c });
            local.add(pick.r + ',' + pick.c);
            const isStraight = (pick.dr === pdr && pick.dc === pdc);
            streak = isStraight ? streak + 1 : 0;
            ppdr = pdr; ppdc = pdc;
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
            const c0 = 3 * j;
            const nodes = [
                { r: row, c: c0 },
                { r: row, c: c0 + 1 },
                { r: row, c: c0 + 2 },
            ];
            if (!nodes.every(n => grid.isAvailable(n.r, n.c))) break;
            if (!this.headRayClear(grid, nodes[2], 0, 1)) break;

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
        const d = knobs?.d != null ? knobs.d : 0.5;
        const lockWeight = knobs?.lockWeight ?? 0;
        const lenScale = knobs?.lenScale != null ? knobs.lenScale : 1;
        const zoneMap = knobs?.zoneMap || null;
        const anchorMode = knobs?.anchorMode || 'UNIFORM';
        const clusterRadius = knobs?.clusterRadius || 5;
        const { rows, cols } = grid;

        // Pre-compute anchor strategy data once before the fill loop.
        const clusterCenters = anchorMode === 'CLUSTER'
            ? this._generateClusterCenters(grid, knobs?.clusterCount || 4)
            : null;
        const innerBbox = anchorMode === 'INNER' && paths.length > 0
            ? this._landmarkBbox(paths)
            : null;

        // Topology weight: how aggressively to create intentional blockers.
        // d=0 (EASY) → 0% blocked-ray attempts (all paths free)
        // d=0.5 (HARD) → 35% blocked-ray attempts
        // d=1.0 (TITAN) → 70% blocked-ray attempts
        // Blocked-ray paths point through existing paths → create dependencies →
        // player must discover the correct solve order.
        const topoWeight = d * 0.85;

        let fails = 0;

        while (fails < maxFails) {
            const anchor = this._pickAnchorForMode(grid, anchorMode, clusterCenters, innerBbox, clusterRadius);
            if (!anchor) { fails++; continue; }

            const effLen = zoneMap
                ? lenScale * zoneMap.lenScale(anchor.r, anchor.c)
                : lenScale;
            const totalNodes = (grid.rows + 1) * (grid.cols + 1);
            const lenCap = RCBuilder.lenCap(totalNodes);
            const baseLenFn = knobs?.sampleLenFn
                ? () => knobs.sampleLenFn(lenCap)
                : () => this.sampleLen(totalNodes);
            const targetLen = Math.max(3, Math.min(lenCap, Math.round(baseLenFn() * effLen)));
            const nodes = this.growWalk(grid, anchor, targetLen, zoneMap);

            if (nodes.length < 3) { fails++; continue; }

            // Walk own-body check (pre-placement, local nodeSet)
            const nodeSet = new Set(nodes.map(n => n.r + ',' + n.c));
            const facesSelf = (h, dr, dc) => {
                let r = h.r + dr, c = h.c + dc;
                while (grid.inBounds(r, c)) {
                    if (nodeSet.has(r + ',' + c)) return true;
                    if (!grid.isFree(r, c)) return false;
                    r += dr; c += dc;
                }
                return false;
            };

            // Separate candidates into clear-ray and blocked-ray lists.
            const clearCands = [];
            const blockedCands = [];

            for (const [rev] of [[false], [true]]) {
                const seq = rev ? nodes.slice().reverse() : nodes;
                const h = seq[seq.length - 1], pv = seq[seq.length - 2];
                const dr = h.r - pv.r, dc = h.c - pv.c;
                if (facesSelf(h, dr, dc)) continue; // own body in ray → skip
                if (this.headRayClear(grid, h, dr, dc)) {
                    const rl = this._rayLenToEdge(h, dr, dc, rows, cols) / Math.max(rows, cols);
                    let score = (2 * d - 1) * rl + Math.random() * 0.25;

                    // Discourage board boundary paths from pointing outward on higher difficulties
                    const isOutwardEdgeHead = (h.r === 0 && dr === -1) || (h.r === rows && dr === 1) ||
                                              (h.c === 0 && dc === -1) || (h.c === cols && dc === 1);
                    if (isOutwardEdgeHead) {
                        score -= 3.0 * d; // Higher difficulty = stronger penalty for outward boundary heads
                    }

                    clearCands.push({ seq, h, dr, dc, score });
                } else {
                    blockedCands.push({ seq, h, dr, dc });
                }
            }

            // Attempt topology placement: with probability topoWeight, try a
            // blocked-ray candidate first. Gate with isBoardSolvable + headSelfClear.
            // This creates intentional dependencies — path is blocked until its
            // blocker is cleared, forcing the player to discover the solve order.
            let placed = false;

            if (blockedCands.length > 0 && Math.random() < topoWeight) {
                // Decoy bias: prefer the candidate whose blocker sits farther
                // down the ray — pieces that LOOK free but aren't force the
                // player to trace rays instead of eyeballing.
                if (d > 0 && blockedCands.length > 1) {
                    for (const cn of blockedCands)
                        cn.blockDist = this._blockerDist(grid, cn.h, cn.dr, cn.dc);
                    blockedCands.sort((a, b) => b.blockDist - a.blockDist);
                }
                for (const cn of blockedCands) {
                    for (const n of cn.seq) grid.setOwner(n.r, n.c, ctr.n);
                    const p = new Path(ctr.n, cn.seq, Path.deltaToHeading(cn.dr, cn.dc));
                    p.placeOrder = ctr.n;
                    paths.push(p);

                    if (this.oracle.headSelfClear(p, grid) &&
                        this.oracle.isBoardSolvable(paths, grid)) {
                        ctr.n++; fails = 0; placed = true; break;
                    }
                    // Revert — this blocked candidate would break solvability
                    paths.pop();
                    for (const n of cn.seq) grid.setOwner(n.r, n.c, -1);
                }
            }

            // Fall back to best clear-ray candidate if topology placement skipped or failed.
            if (!placed && clearCands.length > 0) {
                // Lock-aware gate: a clear-ray piece that locks no currently-
                // free piece stays free for the whole solve and inflates the
                // branching factor. At high lockWeight most such placements
                // are rejected once the board has enough pieces to lock.
                if (lockWeight > 0) {
                    const rejectP = Math.min(0.92, lockWeight * 0.42) *
                        Math.min(1, paths.length / 12);
                    if (rejectP > 0 && Math.random() < rejectP &&
                        this._lockBonus(grid, paths, nodes) === 0) {
                        fails++; continue;
                    }
                }
                clearCands.sort((a, b) => b.score - a.score);
                const best = clearCands[0];
                for (const n of best.seq) grid.setOwner(n.r, n.c, ctr.n);
                const p = new Path(ctr.n, best.seq, Path.deltaToHeading(best.dr, best.dc));
                p.placeOrder = ctr.n;

                if (!this.oracle.headSelfClear(p, grid)) {
                    for (const n of best.seq) grid.setOwner(n.r, n.c, -1);
                    fails++; continue;
                }
                paths.push(p);
                ctr.n++; fails = 0; placed = true;
            }

            if (!placed) { fails++; }
        }
    }

    // ── Phase B: Gap fill ─────────────────────────────────────────────────────

    // Places pieces (4–9 nodes) in remaining empty pockets.
    // Longer walks reduce the number of 3-node L-shapes created by Phase D.
    fillB(grid, paths, ctr, lockWeight = 0) {
        const R = grid.rows + 1, C = grid.cols + 1;
        let progress = true;

        while (progress) {
            progress = false;
            for (let r = 0; r < R; r++) {
                for (let c = 0; c < C; c++) {
                    if (!grid.isAvailable(r, c)) continue;

                    for (let attempt = 0; attempt < 8 && grid.isAvailable(r, c); attempt++) {
                        const nodes = this.growWalk(grid, { r, c }, 4 + (Math.random() * 5 | 0));
                        if (nodes.length < 3) continue;

                        // PX-1: prefer endpoint that doesn't immediately face own walk body.
                        // Lock-aware (lockWeight ≥ 1): prefer blocked-ray ends so the gap
                        // piece joins the dependency order instead of being a free snack.
                        const ends = [
                            [nodes[nodes.length - 1], nodes[nodes.length - 2], false],
                            [nodes[0], nodes[1], true],
                        ].map(([h, pv, rev]) => {
                            const dr = h.r - pv.r, dc = h.c - pv.c;
                            return {
                                h, pv, rev, dr, dc,
                                faces: nodes.some(n => n.r === h.r + dr && n.c === h.c + dc) ? 1 : 0,
                                rayClear: this.headRayClear(grid, h, dr, dc) ? 1 : 0,
                            };
                        });
                        ends.sort((a, b) =>
                            (a.faces - b.faces) ||
                            (lockWeight >= 1 ? a.rayClear - b.rayClear : b.rayClear - a.rayClear)
                        );

                        for (const { h, pv, rev, dr, dc, rayClear } of ends) {
                            // Blocked ends only attempted in lock-aware mode —
                            // they need the full oracle gate below.
                            if (!rayClear && lockWeight < 1) continue;
                            const seq = rev ? nodes.slice().reverse() : nodes;
                            const id = ctr.n;
                            for (const n of seq) grid.setOwner(n.r, n.c, id);
                            const p = new Path(id, seq, Path.deltaToHeading(dr, dc));
                            p.placeOrder = id;

                            // Full-ray check after placement.
                            if (!this.oracle.headSelfClear(p, grid)) {
                                for (const n of seq) grid.setOwner(n.r, n.c, -1);
                                continue;
                            }

                            // A blocked piece starts locked (good for branching)
                            // but must not deadlock the board.
                            if (!rayClear) {
                                paths.push(p);
                                if (!this.oracle.isBoardSolvable(paths, grid)) {
                                    paths.pop();
                                    for (const n of seq) grid.setOwner(n.r, n.c, -1);
                                    continue;
                                }
                                ctr.n++;
                                progress = true; break;
                            }

                            ctr.n++;
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
        const byId = new Map(paths.map(p => [p.id, p]));
        const appends = [];
        let progress = true;

        while (progress) {
            progress = false;
            for (let r = 0; r < R; r++) {
                for (let c = 0; c < C; c++) {
                    if (!grid.isAvailable(r, c)) continue;
                    const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];

                    for (const [ar, ac] of nb) {
                        if (!grid.inBounds(ar, ac)) continue;
                        const oid = grid.owner(ar, ac); if (oid < 0) continue;
                        const p = byId.get(oid); if (!p) continue;
                        const tail = p.tail();
                        if (tail.r !== ar || tail.c !== ac) continue;

                        p.nodes.unshift({ r, c });
                        grid.setOwner(r, c, oid);

                        // Reject immediately if the new tail lands in the head's ray.
                        if (!this.oracle.headSelfClear(p, grid)) {
                            p.nodes.shift();
                            grid.setOwner(r, c, -1);
                            continue;
                        }

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
    // skipReversal: when true, skips the reversal pass and the reversal sub-step
    // inside force-fill. Used when blueprint fixed paths are present — reversing
    // their headings breaks the solvability established by the blueprint pipeline.
    fillD(grid, paths, ctr, skipReversal = false, lockWeight = 0) {
        const R = grid.rows + 1, C = grid.cols + 1;
        const byId = new Map(paths.map(p => [p.id, p]));
        const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        // Lock-aware mode: try blocked-head orientations first so even the
        // last gap pieces join the dependency order (oracle still gates all
        // fillD placements, so solvability is unaffected).
        const orderTries = (tries) => {
            if (lockWeight < 1) return tries;
            for (const t of tries) {
                const hd = t.ns[t.ns.length - 1];
                t._clear = this.headRayClear(grid, hd, t.hdr, t.hdc) ? 1 : 0;
            }
            tries.sort((a, b) => a._clear - b._clear);
            return tries;
        };

        const emptyNbCount = (r, c) => {
            let n = 0;
            for (const [dr, dc] of DIRS) {
                const nr = r + dr, nc = c + dc;
                if (grid.inBounds(nr, nc) && grid.isAvailable(nr, nc)) n++;
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
                    if (grid.isAvailable(r, c))
                        empty.push({ r, c, ec: emptyNbCount(r, c) });
            empty.sort((a, b) => a.ec - b.ec);

            for (const { r, c } of empty) {
                if (!grid.isAvailable(r, c)) continue;
                let placed = false;

                // Option 1: 3-node L-shaped new piece
                for (let d1 = 0; d1 < DIRS.length && !placed; d1++) {
                    const [dr1, dc1] = DIRS[d1];
                    const r2 = r + dr1, c2 = c + dc1;
                    if (!grid.inBounds(r2, c2) || !grid.isAvailable(r2, c2)) continue;

                    for (let d2 = 0; d2 < DIRS.length && !placed; d2++) {
                        const [dr2, dc2] = DIRS[d2];
                        if (dr2 === -dr1 && dc2 === -dc1) continue; // no backtrack
                        if (dr2 === dr1 && dc2 === dc1) continue; // no straight — must be L
                        const r3 = r2 + dr2, c3 = c2 + dc2;
                        if (!grid.inBounds(r3, c3) || !grid.isAvailable(r3, c3)) continue;
                        if (r3 === r && c3 === c) continue; // no self-loop

                        const seq = [{ r, c }, { r: r2, c: c2 }, { r: r3, c: c3 }];
                        const tries = orderTries([
                            { ns: seq, hdr: dr2, hdc: dc2 },
                            { ns: seq.slice().reverse(), hdr: -dr1, hdc: -dc1 },
                        ]);
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
                    const p = byId.get(oid); if (!p) continue;
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
                    const p = byId.get(oid); if (!p) continue;
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
                    if (!grid.inBounds(r2, c2) || !grid.isAvailable(r2, c2)) continue;

                    const seq = [{ r, c }, { r: r2, c: c2 }];
                    const tries = orderTries([
                        { ns: seq, hdr: dr, hdc: dc },
                        { ns: seq.slice().reverse(), hdr: -dr, hdc: -dc },
                    ]);
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
        // Skipped when blueprint fixed paths are present (skipReversal=true).
        let revProgress = !skipReversal;
        while (revProgress) {
            revProgress = false;
            for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
                if (!grid.isAvailable(r, c)) continue;
                let placed = false;

                for (const [dr, dc] of DIRS) {
                    if (placed) break;
                    const ar = r + dr, ac = c + dc;
                    if (!grid.inBounds(ar, ac)) continue;
                    const oid = grid.owner(ar, ac); if (oid < 0) continue;
                    const p = byId.get(oid); if (!p || p.nodes.length < 2) continue;
                    if (p.head().r !== ar || p.head().c !== ac) continue;

                    const savedNodes = p.nodes.slice();
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
                        p.nodes = savedNodes;
                        p.heading = savedHeading;
                    }
                }
            }
        }

        // ── Force-fill: isolated nodes ────────────────────────────────────────
        // An isolated empty node is TRANSPARENT to head rays; attaching it to
        // a path makes it opaque and can block a ray that crossed it — so the
        // full oracle gate is required here too. (Skipping it caused RC
        // invariant violations on dense blocked-ray boards.)
        for (let r = 0; r < R; r++) {
            for (let c = 0; c < C; c++) {
                if (!grid.isAvailable(r, c)) continue;
                if (emptyNbCount(r, c) > 0) continue; // only truly isolated

                // Try adjacent tails — gated by self-clear + solvability.
                let placed = false;
                for (const [dr, dc] of DIRS) {
                    if (placed) break;
                    const ar = r + dr, ac = c + dc;
                    if (!grid.inBounds(ar, ac)) continue;
                    const oid = grid.owner(ar, ac); if (oid < 0) continue;
                    const p = byId.get(oid); if (!p) continue;
                    if (p.tail().r !== ar || p.tail().c !== ac) continue;
                    p.nodes.unshift({ r, c });
                    grid.setOwner(r, c, oid);
                    if (this.oracle.headSelfClear(p, grid) &&
                        this.oracle.isBoardSolvable(paths, grid)) {
                        placed = true;
                    } else {
                        p.nodes.shift();
                        grid.setOwner(r, c, -1);
                    }
                }

                // Last resort: reverse adjacent head, prepend, verify
                // Skipped when blueprint fixed paths are present.
                if (!placed && !skipReversal) {
                    for (const [dr, dc] of DIRS) {
                        if (placed) break;
                        const ar = r + dr, ac = c + dc;
                        if (!grid.inBounds(ar, ac)) continue;
                        const oid = grid.owner(ar, ac); if (oid < 0) continue;
                        const p = byId.get(oid); if (!p || p.nodes.length < 2) continue;
                        if (p.head().r !== ar || p.head().c !== ac) continue;

                        const savedNodes = p.nodes.slice();
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
                            p.nodes = savedNodes;
                            p.heading = savedHeading;
                        }
                    }
                }
            }
        }

        this.oracle.recomputePlaceOrder(paths, grid);
    }

    // ── Branch reduction pass ─────────────────────────────────────────────────

    // Walks the solve simulation; whenever more than `budget` pieces are free
    // at a step, tries to reverse the excess ones (head becomes tail) so their
    // new ray is blocked at that point. Every reversal is gated by
    // headSelfClear + isBoardSolvable, so solvability is preserved while the
    // branching factor is squeezed toward the tier target. Shapes are
    // unchanged — only the arrow end flips.
    reduceBranching(grid, paths, targetAvg, maxPasses = 5) {
        const budget = Math.max(1, Math.round(targetAvg));

        for (let pass = 0; pass < maxPasses; pass++) {
            const m = this.oracle.measureBranching(paths, grid);
            if (m.avg <= targetAvg) break;

            const removed = new Set();
            let changed = 0;

            while (removed.size < paths.length) {
                const free = paths.filter(p =>
                    !removed.has(p.id) && this.oracle.canEscape(p, removed, grid));
                if (!free.length) break;

                // Lock the free pieces beyond `budget` at this step. If some
                // resist (self-pointing reversal / would deadlock), also try
                // the "kept" ones — the isBoardSolvable gate inside guarantees
                // at least one escapable piece always survives.
                let excess = free.length - budget;
                for (let i = free.length - 1; i >= 0 && excess > 0; i--) {
                    if (this._tryReverseToBlocked(grid, paths, free[i], removed)) {
                        changed++; excess--;
                    }
                }

                // Clear one piece that still escapes and move to the next step.
                const next = free.find(p => this.oracle.canEscape(p, removed, grid));
                if (!next) break;
                removed.add(next.id);
            }

            if (!changed) break; // converged — nothing more can be reversed
        }

        this.oracle.recomputePlaceOrder(paths, grid);
    }

    // Reverses a path in place so its head ray is blocked under the current
    // removed-set. Reverts and returns false if the reversal would self-point,
    // stay free, or deadlock the board.
    _tryReverseToBlocked(grid, paths, p, removed) {
        if (p.nodes.length < 2) return false;
        const savedNodes = p.nodes.slice();
        const savedHeading = p.heading;

        p.nodes.reverse();
        const nh = p.nodes[p.nodes.length - 1], np = p.nodes[p.nodes.length - 2];
        p.heading = Path.deltaToHeading(nh.r - np.r, nh.c - np.c);

        if (this.oracle.headSelfClear(p, grid) &&
            !this.oracle.canEscape(p, removed, grid) &&
            this.oracle.isBoardSolvable(paths, grid)) {
            return true;
        }

        p.nodes = savedNodes;
        p.heading = savedHeading;
        return false;
    }

    // ── Blueprint integration — Stage 13 entry point ──────────────────────────

    // Places all fixed paths from the blueprint constraints, then runs the
    // standard chain + fillA to fill remaining empty nodes. fillB/C/D are
    // called by Generator._constructAttempt after this returns, unchanged.
    fillWithBlueprint(grid, paths, ctr, constraints) {
        const { fixedPaths, chainDepth, topoWeight, zoneOverride } = constraints;

        // Place fixed paths in ascending placeOrder (placed-first = cleared-last)
        const sorted = [...(fixedPaths || [])].sort((a, b) =>
            (a.placeOrder ?? 0) - (b.placeOrder ?? 0)
        );

        let placed = 0;
        for (const rp of sorted) {
            if (this._placeFixedPath(grid, paths, ctr, rp)) placed++;
        }

        console.log(`[RCBuilder] fillWithBlueprint: ${placed}/${sorted.length} fixed paths placed`);

        // Chain backbone on top of fixed paths (shorter depth to avoid overriding structure)
        const effectiveDepth = Math.max(0, (chainDepth || 0) - 1);
        if (effectiveDepth > 0) {
            const chainRow = 1 + ((Math.random() * grid.rows) | 0);
            this.buildChain(grid, paths, ctr, effectiveDepth, chainRow);
        }

        // Main fill — use topology weight and zone override from blueprint
        const totalNodes = (grid.rows + 1) * (grid.cols + 1);
        const maxFails = Math.max(400, Math.floor(totalNodes * 0.55));
        const zm = zoneOverride || new ZoneMap().generate(grid.rows, grid.cols);

        this.fillA(grid, paths, ctr, maxFails, {
            d: topoWeight ?? 0.5,
            lockWeight: constraints.lockWeight ?? 1.0,
            lenScale: 1.0,
            zoneMap: zm,
            anchorMode: 'UNIFORM',
            clusterCount: 0,
        });
    }

    // Places one routed path onto the grid. Returns true on success.
    // Gates: all nodes free + orthogonal + headRayClear + isBoardSolvable.
    // Reverts cleanly if any gate fails.
    _placeFixedPath(grid, paths, ctr, routedPath) {
        const { nodes, heading } = routedPath;
        if (!nodes?.length || nodes.length < 2 || !heading) return false;

        // All nodes must be in-bounds and free
        for (const n of nodes) {
            if (!grid.inBounds(n.r, n.c) || !grid.isFree(n.r, n.c)) return false;
        }

        // Must be strictly orthogonal
        for (let i = 0; i < nodes.length - 1; i++) {
            if (Math.abs(nodes[i].r - nodes[i + 1].r) + Math.abs(nodes[i].c - nodes[i + 1].c) !== 1)
                return false;
        }

        // Assign id and mark ownership
        const id = ctr.n++;
        const path = new Path(id, nodes.map(n => ({ r: n.r, c: n.c })), heading);
        path.originalNodes = nodes.map(n => ({ r: n.r, c: n.c }));
        path.placeOrder = routedPath.placeOrder ?? 0;

        for (const n of nodes) grid.setOwner(n.r, n.c, id);
        for (let i = 0; i < nodes.length - 1; i++)
            grid.reserveEdge(nodes[i].r, nodes[i].c, nodes[i + 1].r, nodes[i + 1].c, id);

        paths.push(path);

        // Gate: headRayClear
        const { dr, dc } = Path.headingToDelta(heading);
        if (!this.headRayClear(grid, path.head(), dr, dc)) {
            this._revertPath(grid, paths, ctr, path, nodes);
            return false;
        }

        // Gate: isBoardSolvable
        if (!this.oracle.isBoardSolvable(paths, grid)) {
            this._revertPath(grid, paths, ctr, path, nodes);
            return false;
        }

        return true;
    }

    _revertPath(grid, paths, ctr, path, nodes) {
        for (const n of nodes) grid.setOwner(n.r, n.c, -1);
        for (let i = 0; i < nodes.length - 1; i++)
            grid.reserveEdge(nodes[i].r, nodes[i].c, nodes[i + 1].r, nodes[i + 1].c, -1);
        paths.pop();
        ctr.n--;
    }
}
