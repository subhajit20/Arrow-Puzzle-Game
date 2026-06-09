// =============================================================================
// RegionLayout.js — Stage 2: partition the active board area into regions
//
// Uses Voronoi-style multi-source BFS from farthest-point-sampled seeds.
// All region operations work on the micro-grid node lattice (rows+1 × cols+1).
//
// Pipeline:
//   2.1 _determineRegionCount — heuristic count from activeCount + level gate
//   2.2 _generateSeeds        — farthest-point sampling for well-spread seeds
//   2.3 _growRegions          — multi-source BFS flood fill
//   2.4 _resolveOverlaps      — assign any BFS-unreachable active nodes
//   2.5 _smoothBoundaries     — 2-pass majority-vote cellular automaton
//   2.6 _computeCenters       — centroid of each region's active nodes
//   2.7 _computeStats         — area, aspectRatio, perimeter, compactness
//
// Result shape:
//   { regionCount, assignment: Int32Array, regions: [{ id, seed, center,
//     nodes, area, aspectRatio, perimeter, compactness }] }
// =============================================================================

class RegionLayout {

    // ── Entry point ───────────────────────────────────────────────────────────

    generate(grid, regionCount, seed) {
        const total = (grid.rows + 1) * grid.W;
        const rng   = RegionLayout._lcg(seed);

        const active = this._collectActive(grid);
        if (!active.length || regionCount < 1) return null;

        regionCount = Math.min(regionCount, active.length);

        // Stage 2.2 — farthest-point seed selection
        const seeds = this._generateSeeds(active, regionCount, rng);

        // Stage 2.3 — multi-source BFS flood fill
        const assignment = new Int32Array(total).fill(-1);
        this._growRegions(grid, seeds, assignment);

        // Stage 2.4 — assign any active nodes not reached by BFS
        this._resolveOverlaps(grid, assignment);

        // Stage 2.5 — smooth jagged region boundaries
        this._smoothBoundaries(grid, assignment, 2);

        // Build region objects and fill node lists
        const regions = this._buildRegionObjects(seeds, regionCount);
        this._populateNodes(grid, assignment, regions, regionCount);

        // Stage 2.6 — centroids
        this._computeCenters(regions);

        // Stage 2.7 — geometric statistics
        this._computeStats(regions, grid, assignment);

        return { regionCount, assignment, regions };
    }

    // ── Stage 2.1 — region count heuristic ───────────────────────────────────

    // Targets ~80 nodes per region; caps maximum by level so early boards
    // stay visually simple.
    static _determineRegionCount(activeCount, level) {
        const base = Math.max(2, Math.floor(activeCount / 80));
        const cap  = level <= 10 ? 3
                   : level <= 30 ? 5
                   : level <= 60 ? 8
                   : 12;
        return Math.min(base, cap);
    }

    // ── Stage 2.2 — farthest-point sampling ──────────────────────────────────

    _generateSeeds(active, count, rng) {
        const seeds = [active[(rng() * active.length) | 0]];
        if (count <= 1) return seeds;

        // minDist[i] = squared distance from active[i] to the nearest seed so far
        const minDist = new Float32Array(active.length).fill(Infinity);

        for (let k = 1; k < count; k++) {
            const last = seeds[seeds.length - 1];
            let maxD = -1, maxIdx = 0;

            for (let i = 0; i < active.length; i++) {
                const dr = active[i].r - last.r;
                const dc = active[i].c - last.c;
                const d  = dr * dr + dc * dc;
                if (d < minDist[i]) minDist[i] = d;
                if (minDist[i] > maxD) { maxD = minDist[i]; maxIdx = i; }
            }

            seeds.push(active[maxIdx]);
        }

        return seeds;
    }

    // ── Stage 2.3 — multi-source BFS ─────────────────────────────────────────

    _growRegions(grid, seeds, assignment) {
        const W  = grid.W;
        const DR = [-1, 1,  0, 0];
        const DC = [ 0, 0, -1, 1];
        const queue = [];

        for (let i = 0; i < seeds.length; i++) {
            const { r, c } = seeds[i];
            if (!this._isActive(grid, r, c)) continue;
            const idx = r * W + c;
            if (assignment[idx] !== -1) continue;
            assignment[idx] = i;
            queue.push(idx);
        }

        let head = 0;
        while (head < queue.length) {
            const idx = queue[head++];
            const rid = assignment[idx];
            const r   = (idx / W) | 0;
            const c   = idx % W;

            for (let d = 0; d < 4; d++) {
                const nr = r + DR[d], nc = c + DC[d];
                if (!this._isActive(grid, nr, nc)) continue;
                const nidx = nr * W + nc;
                if (assignment[nidx] !== -1) continue;
                assignment[nidx] = rid;
                queue.push(nidx);
            }
        }
    }

    // ── Stage 2.4 — resolve unassigned active nodes ───────────────────────────

    // Isolated active pockets (caused by non-convex masks) that BFS never
    // reached are assigned to the nearest already-assigned neighbour.
    _resolveOverlaps(grid, assignment) {
        const W  = grid.W;
        const DR = [-1, 1,  0, 0];
        const DC = [ 0, 0, -1, 1];
        let changed = true;

        while (changed) {
            changed = false;
            for (let r = 0; r <= grid.rows; r++) {
                for (let c = 0; c <= grid.cols; c++) {
                    if (!this._isActive(grid, r, c)) continue;
                    if (assignment[r * W + c] !== -1) continue;

                    for (let d = 0; d < 4; d++) {
                        const nr = r + DR[d], nc = c + DC[d];
                        if (!this._isActive(grid, nr, nc)) continue;
                        const nid = assignment[nr * W + nc];
                        if (nid !== -1) {
                            assignment[r * W + c] = nid;
                            changed = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    // ── Stage 2.5 — boundary smoothing ───────────────────────────────────────

    // Majority-vote cellular automaton. Only reassigns when ≥ 3 of 4
    // orthogonal neighbours belong to a single other region — conservative
    // enough to never disconnect a region entirely.
    _smoothBoundaries(grid, assignment, passes) {
        const W    = grid.W;
        const DR   = [-1, 1,  0, 0];
        const DC   = [ 0, 0, -1, 1];
        const snap = new Int32Array(assignment);

        for (let pass = 0; pass < passes; pass++) {
            for (let r = 0; r <= grid.rows; r++) {
                for (let c = 0; c <= grid.cols; c++) {
                    if (!this._isActive(grid, r, c)) continue;

                    const votes = {};
                    for (let d = 0; d < 4; d++) {
                        const nr = r + DR[d], nc = c + DC[d];
                        if (!this._isActive(grid, nr, nc)) continue;
                        const nid = snap[nr * W + nc];
                        if (nid >= 0) votes[nid] = (votes[nid] || 0) + 1;
                    }

                    let topId = -1, topCount = 0;
                    for (const id in votes) {
                        if (votes[id] > topCount) { topCount = votes[id]; topId = +id; }
                    }

                    if (topCount >= 3 && topId >= 0) assignment[r * W + c] = topId;
                }
            }
            snap.set(assignment);
        }
    }

    // ── Internal builders ─────────────────────────────────────────────────────

    _collectActive(grid) {
        const active = [];
        for (let r = 0; r <= grid.rows; r++)
            for (let c = 0; c <= grid.cols; c++)
                if (this._isActive(grid, r, c))
                    active.push({ r, c });
        return active;
    }

    _isActive(grid, r, c) {
        return grid.inBounds(r, c) && grid.isActive(r, c);
    }

    _buildRegionObjects(seeds, count) {
        return seeds.slice(0, count).map((seed, i) => ({
            id:          i,
            seed:        { r: seed.r, c: seed.c },
            center:      null,
            nodes:       [],
            area:        0,
            aspectRatio: 1,
            perimeter:   0,
            compactness: 1,
        }));
    }

    _populateNodes(grid, assignment, regions, regionCount) {
        const W = grid.W;
        for (let r = 0; r <= grid.rows; r++) {
            for (let c = 0; c <= grid.cols; c++) {
                if (!this._isActive(grid, r, c)) continue;
                const id = assignment[r * W + c];
                if (id >= 0 && id < regionCount) regions[id].nodes.push({ r, c });
            }
        }
    }

    // ── Stage 2.6 — centroids ─────────────────────────────────────────────────

    _computeCenters(regions) {
        for (const reg of regions) {
            if (!reg.nodes.length) { reg.center = { ...reg.seed }; continue; }
            let sr = 0, sc = 0;
            for (const { r, c } of reg.nodes) { sr += r; sc += c; }
            reg.center = {
                r: (sr / reg.nodes.length + 0.5) | 0,
                c: (sc / reg.nodes.length + 0.5) | 0,
            };
        }
    }

    // ── Stage 2.7 — geometric statistics ─────────────────────────────────────

    _computeStats(regions, grid, assignment) {
        const W  = grid.W;
        const DR = [-1, 1,  0, 0];
        const DC = [ 0, 0, -1, 1];

        for (const reg of regions) {
            if (!reg.nodes.length) continue;

            let minR = Infinity, maxR = -Infinity;
            let minC = Infinity, maxC = -Infinity;
            let perim = 0;

            for (const { r, c } of reg.nodes) {
                if (r < minR) minR = r; if (r > maxR) maxR = r;
                if (c < minC) minC = c; if (c > maxC) maxC = c;

                // Boundary node: any orthogonal neighbour is inactive or different region
                for (let d = 0; d < 4; d++) {
                    const nr = r + DR[d], nc = c + DC[d];
                    if (!this._isActive(grid, nr, nc) || assignment[nr * W + nc] !== reg.id) {
                        perim++;
                        break;
                    }
                }
            }

            const rSpan = maxR - minR + 1;
            const cSpan = maxC - minC + 1;

            reg.area        = reg.nodes.length;
            reg.aspectRatio = rSpan >= cSpan
                ? rSpan / Math.max(1, cSpan)
                : cSpan / Math.max(1, rSpan);
            reg.perimeter   = perim;
            reg.compactness = perim > 0
                ? (4 * Math.PI * reg.area) / (perim * perim)
                : 1;
        }
    }

    // ── PRNG — deterministic LCG ──────────────────────────────────────────────

    static _lcg(seed) {
        let s = ((seed | 0) ^ 0xdeadbeef) >>> 0;
        return () => {
            s = (Math.imul(1664525, s) + 1013904223) >>> 0;
            return s / 0x100000000;
        };
    }
}
