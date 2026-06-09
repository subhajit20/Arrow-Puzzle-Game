// =============================================================================
// RegionConnectivity.js — Stage 3: build a region adjacency graph
//
// Scans boundary nodes to detect which regions share a border, selects a
// representative crossing point per adjacent pair, builds an adjacency graph,
// prunes redundant links (keeping the MST + strong extras), guarantees full
// connectivity, and assigns a strength score 0–1 per link.
//
// Pipeline:
//   3.1 _detectNeighbors       — scan boundary nodes for region-pair adjacencies
//   3.2 _generateCandidateLinks — best crossing point per adjacent pair
//   3.3 _buildGraph             — adjacency list (Map<regionId, Set<regionId>>)
//   3.4 _removeRedundant        — MST + keep strong extras (sharedCount ≥ 3)
//   3.5 _ensureConnectivity     — re-add pruned edges if any region is isolated
//   3.6 _assignStrengths        — strength = sharedCount / maxSharedCount
//
// Result shape:
//   { adjacency: Map<regionId, Set<regionId>>,
//     links: [{ regionA, regionB, crossingNodes, sharedCount, strength }] }
// =============================================================================

class RegionConnectivity {

    // ── Entry point ───────────────────────────────────────────────────────────

    generate(regionLayout, grid) {
        if (!regionLayout || regionLayout.regionCount < 2) {
            return { adjacency: new Map(), links: [] };
        }

        const neighborMap = this._detectNeighbors(regionLayout, grid);
        const rawLinks    = this._generateCandidateLinks(neighborMap, regionLayout);
        const adjacency   = this._buildGraph(rawLinks, regionLayout.regionCount);

        const { links, pruned } = this._removeRedundant(
            rawLinks, adjacency, regionLayout
        );

        this._ensureConnectivity(links, adjacency, pruned, regionLayout.regionCount);
        this._assignStrengths(links, rawLinks);

        return { adjacency, links };
    }

    // ── Stage 3.1 — detect neighboring regions ────────────────────────────────

    // Scans every active node; for each pair (right-neighbour, down-neighbour)
    // where the two nodes belong to different regions, records the boundary.
    // Only scans right and down to avoid double-counting each boundary edge.
    _detectNeighbors(regionLayout, grid) {
        const { assignment } = regionLayout;
        const W   = grid.W;
        const map = new Map();

        for (let r = 0; r <= grid.rows; r++) {
            for (let c = 0; c <= grid.cols; c++) {
                if (!this._isActive(grid, r, c)) continue;
                const idA = assignment[r * W + c];
                if (idA < 0) continue;

                // Check right neighbour and down neighbour
                const checks = [[r, c + 1], [r + 1, c]];
                for (const [nr, nc] of checks) {
                    if (!this._isActive(grid, nr, nc)) continue;
                    const idB = assignment[nr * W + nc];
                    if (idB < 0 || idB === idA) continue;

                    const a   = Math.min(idA, idB);
                    const b   = Math.max(idA, idB);
                    const key = a * 10000 + b;

                    if (!map.has(key)) {
                        map.set(key, { regionA: a, regionB: b, nodes: [], count: 0 });
                    }
                    const e = map.get(key);
                    e.nodes.push({ r, c });
                    e.count++;
                }
            }
        }

        return map;
    }

    // ── Stage 3.2 — generate candidate links ──────────────────────────────────

    // For each adjacent pair, selects the boundary node closest to the midpoint
    // between the two region centres — this is the "narrowest crossing" used as
    // the canonical connection point.
    _generateCandidateLinks(neighborMap, regionLayout) {
        const { regions } = regionLayout;
        const links = [];

        for (const entry of neighborMap.values()) {
            const { regionA, regionB, nodes, count } = entry;
            const cA = regions[regionA]?.center;
            const cB = regions[regionB]?.center;
            if (!cA || !cB || !nodes.length) continue;

            const midR = (cA.r + cB.r) / 2;
            const midC = (cA.c + cB.c) / 2;

            let best = nodes[0], bestD = Infinity;
            for (const n of nodes) {
                const d = (n.r - midR) ** 2 + (n.c - midC) ** 2;
                if (d < bestD) { bestD = d; best = n; }
            }

            links.push({
                regionA,
                regionB,
                crossingNodes: [{ r: best.r, c: best.c }],
                sharedCount:   count,
                strength:      0, // assigned in Stage 3.6
            });
        }

        return links;
    }

    // ── Stage 3.3 — build adjacency graph ────────────────────────────────────

    _buildGraph(links, regionCount) {
        const adj = new Map();
        for (let i = 0; i < regionCount; i++) adj.set(i, new Set());
        for (const l of links) {
            adj.get(l.regionA).add(l.regionB);
            adj.get(l.regionB).add(l.regionA);
        }
        return adj;
    }

    // ── Stage 3.4 — remove redundant links ───────────────────────────────────

    // Builds an MST (Kruskal's, sorted by sharedCount descending so the
    // strongest connections are kept first).  Non-MST edges with sharedCount ≥ 3
    // are also kept for topological variety.  Weak non-MST edges are pruned.
    _removeRedundant(rawLinks, adjacency, regionLayout) {
        const n = regionLayout.regionCount;

        // Union-Find helpers
        const parent = Array.from({ length: n }, (_, i) => i);
        const rank   = new Uint8Array(n);
        const find   = x => {
            while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
            return x;
        };
        const union  = (x, y) => {
            const [px, py] = [find(x), find(y)];
            if (px === py) return false;
            if (rank[px] < rank[py]) parent[px] = py;
            else if (rank[px] > rank[py]) parent[py] = px;
            else { parent[py] = px; rank[px]++; }
            return true;
        };

        // Build MST — sort descending so strongest edges are in the MST
        const sorted = [...rawLinks].sort((a, b) => b.sharedCount - a.sharedCount);
        const mstSet = new Set();
        for (const l of sorted) if (union(l.regionA, l.regionB)) mstSet.add(l);

        const kept   = [];
        const pruned = [];
        for (const l of rawLinks) {
            (mstSet.has(l) || l.sharedCount >= 3 ? kept : pruned).push(l);
        }

        // Rebuild adjacency from kept links only
        for (const set of adjacency.values()) set.clear();
        for (const l of kept) {
            adjacency.get(l.regionA).add(l.regionB);
            adjacency.get(l.regionB).add(l.regionA);
        }

        return { links: kept, pruned };
    }

    // ── Stage 3.5 — ensure full connectivity ──────────────────────────────────

    // BFS from region 0; any region not reached gets a pruned link re-added.
    _ensureConnectivity(links, adjacency, pruned, regionCount) {
        const visited = new Set([0]);
        const q = [0]; let head = 0;
        while (head < q.length) {
            for (const n of adjacency.get(q[head++]) || [])
                if (!visited.has(n)) { visited.add(n); q.push(n); }
        }
        if (visited.size >= regionCount) return;

        const keptKeys = new Set(
            links.map(l => l.regionA * 10000 + l.regionB)
        );

        for (const link of pruned) {
            if (visited.size >= regionCount) break;

            const hasA = visited.has(link.regionA);
            const hasB = visited.has(link.regionB);
            if (hasA === hasB) continue; // both in visited or both isolated

            links.push(link);
            keptKeys.add(link.regionA * 10000 + link.regionB);
            adjacency.get(link.regionA).add(link.regionB);
            adjacency.get(link.regionB).add(link.regionA);

            // Flood-fill the newly connected component into visited
            const start = hasA ? link.regionB : link.regionA;
            const front = [start]; let h2 = 0;
            while (h2 < front.length) {
                const curr = front[h2++];
                if (visited.has(curr)) continue;
                visited.add(curr);
                for (const n of adjacency.get(curr) || [])
                    if (!visited.has(n)) front.push(n);
            }
        }
    }

    // ── Stage 3.6 — assign strengths ─────────────────────────────────────────

    // strength = sharedCount / maxSharedCount across all raw links (0–1).
    _assignStrengths(links, rawLinks) {
        const maxCount = rawLinks.reduce((m, l) => Math.max(m, l.sharedCount), 1);
        for (const l of links) l.strength = l.sharedCount / maxCount;
    }

    // ── Shared helper ─────────────────────────────────────────────────────────

    _isActive(grid, r, c) {
        return grid.inBounds(r, c) && grid.isActive(r, c);
    }
}
