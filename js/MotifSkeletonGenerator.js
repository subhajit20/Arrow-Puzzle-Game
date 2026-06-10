// =============================================================================
// MotifSkeletonGenerator.js — Stage 6: generate spatial skeletons for each motif
//
// For each region × motif assignment, generates the node coordinates that form
// the structural skeleton of that motif type. All nodes are clipped to the
// region's active node set (non-convex masks are fully respected).
//
// Motif shapes:
//   CORRIDOR    — spine along longer axis + parallel width tracks
//   SPIRAL      — concentric rectangular rings from center
//   NESTED_RECT — inset rectangles connected by a radial spoke
//   LOOP        — single rectangular perimeter cycle
//   SNAKE       — alternating horizontal/vertical segments with transitions
//   ZIGZAG      — alternating-amplitude path along axis
//   RING        — single rectangular ring around the region center
//   CHAMBER     — 2–3 rectangular rooms connected by 1-wide corridors
//
// Entry nodes (Stage 6): anchor nodes on the bounding-box boundary.
// Entry nodes (Stage 7): overridden with actual connectivity crossing points.
//
// Result per region:
//   { regionId, anchorNodes, entryNodes, exitNodes, internalNodes, nodeSet }
// =============================================================================

class MotifSkeletonGenerator {

    // ── Entry point ───────────────────────────────────────────────────────────

    generate(motifAssignments, regionLayout, grid) {
        const skeletons = [];

        for (const { regionId, type, parameters } of motifAssignments) {
            const region = regionLayout.regions[regionId];

            if (!region?.nodes.length) {
                skeletons.push(this._empty(regionId));
                continue;
            }

            const regionSet = new Set(region.nodes.map(n => `${n.r},${n.c}`));
            const bb = this._bbox(region);

            let raw;
            switch (type) {
                case 'CORRIDOR': raw = this._corridorSkeleton(parameters, bb, regionSet); break;
                case 'SPIRAL': raw = this._spiralSkeleton(parameters, bb, regionSet); break;
                case 'NESTED_RECT': raw = this._nestedRectSkeleton(parameters, bb, regionSet); break;
                case 'LOOP': raw = this._loopSkeleton(parameters, bb, regionSet); break;
                case 'SNAKE': raw = this._snakeSkeleton(parameters, bb, regionSet); break;
                case 'ZIGZAG': raw = this._zigzagSkeleton(parameters, bb, regionSet); break;
                case 'RING': raw = this._ringSkeleton(parameters, bb, regionSet); break;
                case 'CHAMBER': raw = this._chamberSkeleton(parameters, bb, regionSet); break;
                default: raw = this._loopSkeleton({ cycleLength: 8 }, bb, regionSet);
            }

            // Deduplicate: anchors win over internals for the same position
            const seen = new Set();
            const anchors = [];
            const internal = [];

            for (const n of raw.anchors) {
                const k = `${n.r},${n.c}`;
                if (!seen.has(k)) { seen.add(k); anchors.push(n); }
            }
            for (const n of raw.internal) {
                const k = `${n.r},${n.c}`;
                if (!seen.has(k)) { seen.add(k); internal.push(n); }
            }

            // Entry nodes: anchors that sit on the bounding-box boundary
            const entry = anchors.filter(n =>
                n.r === bb.minR || n.r === bb.maxR ||
                n.c === bb.minC || n.c === bb.maxC
            );

            // Fallback if nothing touches boundary
            if (!entry.length && anchors.length) {
                entry.push(anchors[0]);
                if (anchors.length > 1) entry.push(anchors[anchors.length - 1]);
            }

            // Ordered traversal: the sequence of nodes that traces the motif shape.
            // PathRouter uses this directly instead of BFS, so the shape is visible.
            const orderedPath = this._buildOrderedPath(type, parameters, bb, regionSet, grid);

            skeletons.push({
                regionId,
                motifType: type,
                anchorNodes: anchors,
                entryNodes: entry,
                exitNodes: [...entry],   // refined in Stage 7
                internalNodes: internal,
                nodeSet: seen,
                orderedPath,
            });
        }

        return skeletons;
    }

    // ── CORRIDOR ──────────────────────────────────────────────────────────────

    _corridorSkeleton({ axis, width }, bb, regionSet) {
        const { minR, maxR, minC, maxC } = bb;
        const anchors  = [];
        const internal = [];

        if (axis === 'H') {
            const rCenter = ((minR + maxR) / 2) | 0;
            const r0 = Math.max(minR, rCenter - Math.floor((width - 1) / 2));
            const r1 = Math.min(maxR, rCenter + Math.floor(width / 2));
            for (let r = r0; r <= r1; r++) {
                for (let c = minC; c <= maxC; c++) {
                    if (!regionSet.has(`${r},${c}`)) continue;
                    (c === minC || c === maxC ? anchors : internal).push({ r, c });
                }
            }
        } else {
            const cCenter = ((minC + maxC) / 2) | 0;
            const c0 = Math.max(minC, cCenter - Math.floor((width - 1) / 2));
            const c1 = Math.min(maxC, cCenter + Math.floor(width / 2));
            for (let c = c0; c <= c1; c++) {
                for (let r = minR; r <= maxR; r++) {
                    if (!regionSet.has(`${r},${c}`)) continue;
                    (r === minR || r === maxR ? anchors : internal).push({ r, c });
                }
            }
        }

        return { anchors, internal };
    }

    // ── SPIRAL ────────────────────────────────────────────────────────────────

    _spiralSkeleton({ center, rings }, bb, regionSet) {
        const anchors = [{ r: center.r, c: center.c }].filter(n => regionSet.has(`${n.r},${n.c}`));
        const internal = [];

        for (let k = 1; k <= rings; k++) {
            const r0 = center.r - k, r1 = center.r + k;
            const c0 = center.c - k, c1 = center.c + k;
            const corners = [[r0, c0], [r0, c1], [r1, c0], [r1, c1]];

            for (const [r, c] of corners)
                if (regionSet.has(`${r},${c}`)) anchors.push({ r, c });

            for (let c = c0 + 1; c < c1; c++) {
                if (regionSet.has(`${r0},${c}`)) internal.push({ r: r0, c });
                if (regionSet.has(`${r1},${c}`)) internal.push({ r: r1, c });
            }
            for (let r = r0 + 1; r < r1; r++) {
                if (regionSet.has(`${r},${c0}`)) internal.push({ r, c: c0 });
                if (regionSet.has(`${r},${c1}`)) internal.push({ r, c: c1 });
            }
        }

        return { anchors, internal };
    }

    // ── NESTED_RECT ───────────────────────────────────────────────────────────

    _nestedRectSkeleton({ depth, marginStep }, bb, regionSet) {
        const { minR, maxR, minC, maxC } = bb;
        const anchors = [];
        const internal = [];

        for (let k = 0; k < depth; k++) {
            const r0 = minR + k * marginStep, r1 = maxR - k * marginStep;
            const c0 = minC + k * marginStep, c1 = maxC - k * marginStep;
            if (r0 >= r1 || c0 >= c1) break;

            for (const [r, c] of [[r0, c0], [r0, c1], [r1, c0], [r1, c1]])
                if (regionSet.has(`${r},${c}`)) anchors.push({ r, c });

            for (let c = c0 + 1; c < c1; c++) {
                if (regionSet.has(`${r0},${c}`)) internal.push({ r: r0, c });
                if (regionSet.has(`${r1},${c}`)) internal.push({ r: r1, c });
            }
            for (let r = r0 + 1; r < r1; r++) {
                if (regionSet.has(`${r},${c0}`)) internal.push({ r, c: c0 });
                if (regionSet.has(`${r},${c1}`)) internal.push({ r, c: c1 });
            }
        }

        // Radial spoke connecting all nested rects through the center column
        const midC = ((minC + maxC) / 2) | 0;
        for (let r = minR; r <= maxR; r++)
            if (regionSet.has(`${r},${midC}`)) internal.push({ r, c: midC });

        return { anchors, internal };
    }

    // ── LOOP ──────────────────────────────────────────────────────────────────

    _loopSkeleton({ cycleLength }, bb, regionSet) {
        const { minR, maxR, minC, maxC } = bb;
        const cr = ((minR + maxR) / 2) | 0, cc = ((minC + maxC) / 2) | 0;

        // Target a rectangle whose perimeter ≈ cycleLength
        const half = Math.max(2, (cycleLength / 4) | 0);
        const r0 = Math.max(minR, cr - half);
        const r1 = Math.min(maxR, cr + half);
        const c0 = Math.max(minC, cc - half);
        const c1 = Math.min(maxC, cc + half);

        const anchors = [];
        const internal = [];

        for (const [r, c] of [[r0, c0], [r0, c1], [r1, c0], [r1, c1]])
            if (regionSet.has(`${r},${c}`)) anchors.push({ r, c });

        for (let c = c0 + 1; c < c1; c++) {
            if (regionSet.has(`${r0},${c}`)) internal.push({ r: r0, c });
            if (regionSet.has(`${r1},${c}`)) internal.push({ r: r1, c });
        }
        for (let r = r0 + 1; r < r1; r++) {
            if (regionSet.has(`${r},${c0}`)) internal.push({ r, c: c0 });
            if (regionSet.has(`${r},${c1}`)) internal.push({ r, c: c1 });
        }

        return { anchors, internal };
    }

    // ── SNAKE ─────────────────────────────────────────────────────────────────

    _snakeSkeleton({ axis, segmentCount, segmentLength }, bb, regionSet) {
        const { minR, maxR, minC, maxC } = bb;
        const anchors = [];
        const internal = [];

        if (axis === 'H') {
            const rowStep = Math.max(1, ((maxR - minR) / Math.max(1, segmentCount - 1)) | 0);

            for (let s = 0; s < segmentCount; s++) {
                const r = Math.min(maxR, minR + s * rowStep);
                const goR = (s % 2 === 0);   // even segments go right, odd go left
                const cEnd = Math.min(maxC, minC + segmentLength - 1);

                for (let c = minC; c <= cEnd; c++) {
                    const rc = goR ? c : (cEnd - (c - minC));
                    if (!regionSet.has(`${r},${rc}`)) continue;
                    (c === minC || c === cEnd ? anchors : internal).push({ r, c: rc });
                }

                // Vertical transition to next segment row
                if (s < segmentCount - 1) {
                    const nextR = Math.min(maxR, minR + (s + 1) * rowStep);
                    const transC = goR ? cEnd : minC;
                    for (let tr = r + 1; tr < nextR; tr++)
                        if (regionSet.has(`${tr},${transC}`)) internal.push({ r: tr, c: transC });
                }
            }
        } else {
            const colStep = Math.max(1, ((maxC - minC) / Math.max(1, segmentCount - 1)) | 0);

            for (let s = 0; s < segmentCount; s++) {
                const c = Math.min(maxC, minC + s * colStep);
                const goD = (s % 2 === 0);
                const rEnd = Math.min(maxR, minR + segmentLength - 1);

                for (let r = minR; r <= rEnd; r++) {
                    const rc = goD ? r : (rEnd - (r - minR));
                    if (!regionSet.has(`${rc},${c}`)) continue;
                    (r === minR || r === rEnd ? anchors : internal).push({ r: rc, c });
                }

                if (s < segmentCount - 1) {
                    const nextC = Math.min(maxC, minC + (s + 1) * colStep);
                    const transR = goD ? rEnd : minR;
                    for (let tc = c + 1; tc < nextC; tc++)
                        if (regionSet.has(`${transR},${tc}`)) internal.push({ r: transR, c: tc });
                }
            }
        }

        return { anchors, internal };
    }

    // ── ZIGZAG ────────────────────────────────────────────────────────────────

    _zigzagSkeleton({ axis, amplitude, period }, bb, regionSet) {
        const { minR, maxR, minC, maxC } = bb;
        const anchors = [];
        const internal = [];

        if (axis === 'H') {
            const mid = ((minR + maxR) / 2) | 0;
            for (let c = minC; c <= maxC; c++) {
                const phase = (Math.floor((c - minC) / period) % 2);
                const r = Math.max(minR, Math.min(maxR, mid + (phase ? amplitude : -amplitude)));
                if (!regionSet.has(`${r},${c}`)) continue;
                ((c - minC) % period === 0 ? anchors : internal).push({ r, c });
            }
        } else {
            const mid = ((minC + maxC) / 2) | 0;
            for (let r = minR; r <= maxR; r++) {
                const phase = (Math.floor((r - minR) / period) % 2);
                const c = Math.max(minC, Math.min(maxC, mid + (phase ? amplitude : -amplitude)));
                if (!regionSet.has(`${r},${c}`)) continue;
                ((r - minR) % period === 0 ? anchors : internal).push({ r, c });
            }
        }

        return { anchors, internal };
    }

    // ── RING ──────────────────────────────────────────────────────────────────

    _ringSkeleton({ center, radius }, bb, regionSet) {
        const r0 = Math.max(bb.minR, center.r - radius);
        const r1 = Math.min(bb.maxR, center.r + radius);
        const c0 = Math.max(bb.minC, center.c - radius);
        const c1 = Math.min(bb.maxC, center.c + radius);

        const anchors = [];
        const internal = [];

        for (const [r, c] of [[r0, c0], [r0, c1], [r1, c0], [r1, c1]])
            if (regionSet.has(`${r},${c}`)) anchors.push({ r, c });

        for (let c = c0 + 1; c < c1; c++) {
            if (regionSet.has(`${r0},${c}`)) internal.push({ r: r0, c });
            if (regionSet.has(`${r1},${c}`)) internal.push({ r: r1, c });
        }
        for (let r = r0 + 1; r < r1; r++) {
            if (regionSet.has(`${r},${c0}`)) internal.push({ r, c: c0 });
            if (regionSet.has(`${r},${c1}`)) internal.push({ r, c: c1 });
        }

        return { anchors, internal };
    }

    // ── CHAMBER ───────────────────────────────────────────────────────────────

    _chamberSkeleton({ roomCount, connectorWidth }, bb, regionSet) {
        const { minR, maxR, minC, maxC } = bb;
        const anchors = [];
        const internal = [];

        const totalCols = maxC - minC + 1;
        const roomW = Math.max(3, (totalCols / roomCount) | 0);
        const connR = ((minR + maxR) / 2) | 0;

        for (let k = 0; k < roomCount; k++) {
            const c0 = minC + k * roomW;
            const c1 = Math.min(maxC, c0 + roomW - 2);
            if (c0 >= maxC) break;

            for (const [r, c] of [[minR, c0], [minR, c1], [maxR, c0], [maxR, c1]])
                if (regionSet.has(`${r},${c}`)) anchors.push({ r, c });

            for (let c = c0 + 1; c < c1; c++) {
                if (regionSet.has(`${minR},${c}`)) internal.push({ r: minR, c });
                if (regionSet.has(`${maxR},${c}`)) internal.push({ r: maxR, c });
            }
            for (let r = minR + 1; r < maxR; r++) {
                if (regionSet.has(`${r},${c0}`)) internal.push({ r, c: c0 });
                if (c1 !== c0 && regionSet.has(`${r},${c1}`)) internal.push({ r, c: c1 });
            }

            // 1-wide connector to the next room
            if (k < roomCount - 1) {
                const connC = c1 + 1;
                if (connC <= maxC && regionSet.has(`${connR},${connC}`))
                    internal.push({ r: connR, c: connC });
            }
        }

        return { anchors, internal };
    }

    // ── Ordered traversal paths ───────────────────────────────────────────────
    //
    // Every method generates a SPACE-FILLING traversal of the full bounding box
    // so the orderedPath covers 70-90% of the region's nodes. RC fill then only
    // needs to cover the small remainder — motif shapes become visually dominant.

    _buildOrderedPath(type, parameters, bb, regionSet, grid) {
        let candidates;
        switch (type) {
            case 'CORRIDOR':    candidates = this._corridorOrdered(parameters, bb, grid);    break;
            case 'RING': candidates = this._ringOrdered(parameters, bb); break;
            case 'LOOP': candidates = this._loopOrdered(parameters, bb); break;
            case 'SNAKE': candidates = this._snakeOrdered(parameters, bb); break;
            case 'ZIGZAG': candidates = this._zigzagOrdered(parameters, bb); break;
            case 'SPIRAL': candidates = this._spiralOrdered(parameters, bb); break;
            case 'NESTED_RECT': candidates = this._nestedRectOrdered(parameters, bb); break;
            case 'CHAMBER': candidates = this._chamberOrdered(parameters, bb); break;
            default: candidates = this._boustrophedon(bb, 'H');
        }
        return this._collectAdjacent(candidates, regionSet);
    }

    // ── Shared space-filling helpers ─────────────────────────────────────────

    // Full boustrophedon (back-and-forth) scan of every node in the bbox.
    // axis='H': row by row left↔right.  axis='V': col by col up↔down.
    // Covers ~100% of the bounding box — the primary space-filler for all motifs.
    _boustrophedon(bb, axis = 'H') {
        const { minR, maxR, minC, maxC } = bb;
        const seq = [];
        if (axis === 'H') {
            for (let r = minR; r <= maxR; r++) {
                const even = (r - minR) % 2 === 0;
                if (even) { for (let c = minC; c <= maxC; c++) seq.push({ r, c }); }
                else { for (let c = maxC; c >= minC; c--) seq.push({ r, c }); }
                // Single-step bridge to the next row
                if (r < maxR) seq.push({ r: r + 1, c: even ? maxC : minC });
            }
        } else {
            for (let c = minC; c <= maxC; c++) {
                const even = (c - minC) % 2 === 0;
                if (even) { for (let r = minR; r <= maxR; r++) seq.push({ r, c }); }
                else { for (let r = maxR; r >= minR; r--) seq.push({ r, c }); }
                if (c < maxC) seq.push({ r: even ? maxR : minR, c: c + 1 });
            }
        }
        return seq;
    }

    // ── Shared multi-level helpers ────────────────────────────────────────────

    // Returns bounding-box levels, each inset from the previous by `margin`.
    _nestLevels(bb, margin = 2) {
        const levels = [];
        let { minR, maxR, minC, maxC } = bb;
        while (maxR - minR >= 3 && maxC - minC >= 3) {
            levels.push({ minR, maxR, minC, maxC });
            minR += margin; maxR -= margin;
            minC += margin; maxC -= margin;
        }
        return levels;
    }

    // Multi-level INWARD + OUTWARD rectangle traversal.
    // Even levels: clockwise (top→right→bottom→partial-left) — inward energy.
    // Odd  levels: counter-clockwise (left→bottom→right→partial-top) — outward energy.
    // Levels alternate so the path visually spirals in then fans back out.
    _rectNestedInOut(bb, margin = 2) {
        const levels = this._nestLevels(bb, margin);
        const seq = [];

        for (let i = 0; i < levels.length; i++) {
            const { minR: r0, maxR: r1, minC: c0, maxC: c1 } = levels[i];
            const last = i === levels.length - 1;

            if (i % 2 === 0) {
                // CLOCKWISE — inward energy
                for (let c = c0; c <= c1; c++) seq.push({ r: r0, c });        // top L→R
                for (let r = r0 + 1; r <= r1; r++) seq.push({ r, c: c1 });     // right T→B
                for (let c = c1 - 1; c >= c0; c--) seq.push({ r: r1, c });     // bottom R→L
                if (last) {
                    for (let r = r1 - 1; r > r0; r--) seq.push({ r, c: c0 }); // left close
                } else {
                    for (let r = r1 - 1; r >= r0 + 2; r--) seq.push({ r, c: c0 }); // left partial
                    // Transition inward: step right 2 into next-level top-left
                    seq.push({ r: r0 + 1, c: c0 });
                    seq.push({ r: r0 + 1, c: c0 + 1 });
                    seq.push({ r: r0 + 1, c: c0 + 2 });
                }
            } else {
                // COUNTER-CLOCKWISE — outward energy
                for (let r = r0; r <= r1; r++) seq.push({ r, c: c0 });        // left T→B
                for (let c = c0 + 1; c <= c1; c++) seq.push({ r: r1, c });     // bottom L→R
                for (let r = r1 - 1; r >= r0 + 1; r--) seq.push({ r, c: c1 });  // right B→T
                if (last) {
                    for (let c = c1 - 1; c > c0; c--) seq.push({ r: r0, c }); // top close
                } else {
                    for (let c = c1 - 1; c >= c0 + 2; c--) seq.push({ r: r0, c }); // top partial
                    // Transition inward: step down 2 into next-level top-left
                    seq.push({ r: r0, c: c0 + 1 });
                    seq.push({ r: r0 + 1, c: c0 + 1 });
                    seq.push({ r: r0 + 2, c: c0 + 1 });
                }
            }
        }

        // Center point
        const cr = (bb.minR + bb.maxR) >> 1, cc = (bb.minC + bb.maxC) >> 1;
        seq.push({ r: cr, c: cc });
        return seq;
    }

    // ── Per-motif ordered traversals (space-filling) ─────────────────────────

    // CORRIDOR — nested parallel bands: outer inward, step, inner outward, …
    _corridorOrdered({ axis }, bb) {
        const { minR, maxR, minC, maxC } = bb;
        const seq = [];
        const margin = 2;
        if (axis === 'H') {
            let rTop = minR, band = 0;
            while (rTop <= maxR) {
                const goRight = band % 2 === 0;
                if (goRight) { for (let c = minC; c <= maxC; c++) seq.push({ r: rTop, c }); }
                else { for (let c = maxC; c >= minC; c--) seq.push({ r: rTop, c }); }
                if (rTop + margin <= maxR) {
                    const bc = goRight ? maxC : minC;
                    for (let r = rTop + 1; r <= rTop + margin; r++) seq.push({ r, c: bc });
                }
                rTop += margin; band++;
            }
        } else {
            let cLeft = minC, band = 0;
            while (cLeft <= maxC) {
                const goDown = band % 2 === 0;
                if (goDown) { for (let r = minR; r <= maxR; r++) seq.push({ r, c: cLeft }); }
                else { for (let r = maxR; r >= minR; r--) seq.push({ r, c: cLeft }); }
                if (cLeft + margin <= maxC) {
                    const br = goDown ? maxR : minR;
                    for (let c = cLeft + 1; c <= cLeft + margin; c++) seq.push({ r: br, c });
                }
                cLeft += margin; band++;
            }
        }
        return seq;
    }

    // RING — concentric rectangular rings, CW outer / CCW inner / CW inner…
    _ringOrdered({ center, radius }, bb) {
        const outerBb = {
            minR: Math.max(bb.minR, center.r - radius),
            maxR: Math.min(bb.maxR, center.r + radius),
            minC: Math.max(bb.minC, center.c - radius),
            maxC: Math.min(bb.maxC, center.c + radius),
        };
        return this._rectNestedInOut(outerBb, 2);
    }

    // LOOP — concentric rectangles sized to cycleLength
    _loopOrdered({ cycleLength }, bb) {
        const cr = (bb.minR + bb.maxR) >> 1, cc = (bb.minC + bb.maxC) >> 1;
        const half = Math.max(2, (cycleLength / 4) | 0);
        const rad = Math.min(half, Math.min((bb.maxR - bb.minR) >> 1, (bb.maxC - bb.minC) >> 1));
        return this._rectNestedInOut({
            minR: Math.max(bb.minR, cr - rad), maxR: Math.min(bb.maxR, cr + rad),
            minC: Math.max(bb.minC, cc - rad), maxC: Math.min(bb.maxC, cc + rad),
        }, 2);
    }

    // SNAKE — nested boxes: concentric rectangles, CW outer / CCW inner / CW…
    // Same visual pattern as NESTED_RECT but applied to SNAKE-assigned regions.
    _snakeOrdered(params, bb) {
        return this._rectNestedInOut(bb, 2);
    }

    // ZIGZAG — outer full-amplitude pass, pivot, inner half-amplitude reversed
    _zigzagOrdered({ axis, amplitude, period }, bb) {
        const { minR, maxR, minC, maxC } = bb;
        const seq = [];
        const pass = (amp, reverse) => {
            if (axis === 'H') {
                const mid = (minR + maxR) >> 1;
                let prevR = Math.max(minR, Math.min(maxR, mid - amp));
                for (let ci = 0; ci <= maxC - minC; ci++) {
                    const c = reverse ? maxC - ci : minC + ci;
                    const phase = Math.floor(ci / period) % 2;
                    const target = Math.max(minR, Math.min(maxR, mid + (phase ? amp : -amp)));
                    if (target !== prevR && ci > 0) {
                        const step = Math.sign(target - prevR);
                        for (let r = prevR + step; r !== target; r += step)
                            seq.push({ r, c: reverse ? c + 1 : c - 1 });
                    }
                    seq.push({ r: target, c });
                    prevR = target;
                }
            } else {
                const mid = (minC + maxC) >> 1;
                let prevC = Math.max(minC, Math.min(maxC, mid - amp));
                for (let ri = 0; ri <= maxR - minR; ri++) {
                    const r = reverse ? maxR - ri : minR + ri;
                    const phase = Math.floor(ri / period) % 2;
                    const target = Math.max(minC, Math.min(maxC, mid + (phase ? amp : -amp)));
                    if (target !== prevC && ri > 0) {
                        const step = Math.sign(target - prevC);
                        for (let c = prevC + step; c !== target; c += step)
                            seq.push({ r: reverse ? r + 1 : r - 1, c });
                    }
                    seq.push({ r, c: target });
                    prevC = target;
                }
            }
        };
        pass(amplitude, false);
        seq.push({ r: (minR + maxR) >> 1, c: (minC + maxC) >> 1 });
        pass(Math.max(1, (amplitude * 0.5) | 0), true);
        return seq;
    }

    // SPIRAL — inward CW to center, outward CCW back out.
    // Rings computed from bbox so spiral fills the whole region.
    _spiralOrdered({ center }, bb) {
        const cr = ((bb.minR + bb.maxR) / 2 + 0.5) | 0;
        const cc = ((bb.minC + bb.maxC) / 2 + 0.5) | 0;
        const maxRings = Math.max(1, Math.min(
            cr - bb.minR, bb.maxR - cr, cc - bb.minC, bb.maxC - cc
        ));
        const seq = [];
        for (let k = maxRings; k >= 1; k--) {
            const r0 = cr - k, r1 = cr + k, c0 = cc - k, c1 = cc + k;
            for (let c = c0; c <= c1; c++) seq.push({ r: r0, c });
            for (let r = r0 + 1; r <= r1; r++) seq.push({ r, c: c1 });
            for (let c = c1 - 1; c >= c0; c--) seq.push({ r: r1, c });
            for (let r = r1 - 1; r > r0 + 1; r--) seq.push({ r, c: c0 });
            seq.push({ r: r0 + 1, c: c0 });
            seq.push({ r: r0 + 1, c: c0 + 1 });
        }
        seq.push({ r: cr, c: cc });
        for (let k = 1; k <= maxRings; k++) {
            const r0 = cr - k, r1 = cr + k, c0 = cc - k, c1 = cc + k;
            seq.push({ r: r0 + 1, c: c1 });
            seq.push({ r: r0, c: c1 });
            for (let c = c1 - 1; c >= c0; c--) seq.push({ r: r0, c });
            for (let r = r0 + 1; r <= r1; r++) seq.push({ r, c: c0 });
            for (let c = c0 + 1; c <= c1; c++) seq.push({ r: r1, c });
            for (let r = r1 - 1; r > r0 + 1; r--) seq.push({ r, c: c1 });
        }
        return seq;
    }

    // NESTED_RECT — concentric rectangles connected by a vertical radial spoke
    _nestedRectOrdered({ depth, marginStep }, bb) {
        const { minR, maxR, minC, maxC } = bb;
        const seq = [];
        const midC = ((minC + maxC) / 2) | 0;

        const levels = [];
        for (let k = 0; k < depth; k++) {
            const r0 = minR + k * marginStep, r1 = maxR - k * marginStep;
            const c0 = minC + k * marginStep, c1 = maxC - k * marginStep;
            if (r0 >= r1 || c0 >= c1 || midC <= c0 || midC >= c1) break;
            levels.push({ r0, r1, c0, c1 });
        }

        if (!levels.length) {
            const cr = (minR + maxR) >> 1, cc = (minC + maxC) >> 1;
            return [{ r: cr, c: cc }];
        }

        for (let i = 0; i < levels.length; i++) {
            const { r0, r1, c0, c1 } = levels[i];

            for (let c = midC; c <= c1; c++) seq.push({ r: r0, c });
            for (let r = r0 + 1; r <= r1; r++) seq.push({ r, c: c1 });
            for (let c = c1 - 1; c >= c0; c--) seq.push({ r: r1, c });
            for (let r = r1 - 1; r >= r0; r--) seq.push({ r, c: c0 });
            for (let c = c0 + 1; c <= midC; c++) seq.push({ r: r0, c });

            const nextR0 = (i < levels.length - 1) ? levels[i + 1].r0 : ((minR + maxR) >> 1);
            for (let r = r0 + 1; r <= nextR0; r++) {
                seq.push({ r, c: midC });
            }
        }

        return seq;
    }

    // CHAMBER — CW/CCW room traversal with shrinking height per room
    _chamberOrdered({ roomCount }, bb) {
        const { minR, maxR, minC, maxC } = bb;
        const seq = [];
        let r0 = minR, r1 = maxR, c0 = minC;
        let roomW = Math.max(4, ((maxC - minC + 1) / roomCount) | 0);
        for (let k = 0; k < roomCount; k++) {
            const c1 = Math.min(maxC, c0 + roomW - 2);
            if (c0 >= maxC) break;
            if (k % 2 === 0) {
                for (let c = c0; c <= c1; c++) seq.push({ r: r0, c });
                for (let r = r0 + 1; r <= r1; r++) seq.push({ r, c: c1 });
                for (let c = c1 - 1; c >= c0; c--) seq.push({ r: r1, c });
                for (let r = r1 - 1; r > r0; r--) seq.push({ r, c: c0 });
            } else {
                for (let r = r0; r <= r1; r++) seq.push({ r, c: c0 });
                for (let c = c0 + 1; c <= c1; c++) seq.push({ r: r1, c });
                for (let r = r1 - 1; r >= r0 + 1; r--) seq.push({ r, c: c1 });
                for (let c = c1 - 1; c > c0; c--) seq.push({ r: r0, c });
            }
            if (k < roomCount - 1) {
                seq.push({ r: (r0 + r1) >> 1, c: c1 + 1 });
                r0 += 1; r1 -= 1;
                c0 = c1 + 2;
                roomW = Math.max(3, roomW - 1);
            }
        }
        return seq;
    }

    // Filters a candidate sequence to only include nodes that are:
    //   (a) in the region's active node set, AND
    //   (b) orthogonally adjacent to the previous kept node.
    // Duplicates are also removed.
    _collectAdjacent(candidates, regionSet) {
        const path = [];
        const seen = new Set();
        for (const { r, c } of candidates) {
            if (!regionSet.has(`${r},${c}`)) continue;
            const key = `${r},${c}`;
            if (seen.has(key)) continue;
            if (!path.length) { seen.add(key); path.push({ r, c }); continue; }
            const prev = path[path.length - 1];
            if (Math.abs(r - prev.r) + Math.abs(c - prev.c) === 1) {
                seen.add(key); path.push({ r, c });
            }
        }
        return path;
    }

    _defaultRingParams(bb) {
        const cr = (bb.minR + bb.maxR) >> 1, cc = (bb.minC + bb.maxC) >> 1;
        return { center: { r: cr, c: cc }, radius: Math.min(3, (bb.maxR - bb.minR) >> 1, (bb.maxC - bb.minC) >> 1) };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _bbox(region) {
        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        for (const { r, c } of region.nodes) {
            if (r < minR) minR = r; if (r > maxR) maxR = r;
            if (c < minC) minC = c; if (c > maxC) maxC = c;
        }
        return { minR, maxR, minC, maxC };
    }

    _empty(regionId) {
        return {
            regionId,
            anchorNodes: [],
            entryNodes: [],
            exitNodes: [],
            internalNodes: [],
            nodeSet: new Set(),
        };
    }
}
