// =============================================================================
// PathRouter.js — Stage 9: route orthogonal game paths through the global graph
//
// For each region in the global graph, routes one path from a start node
// (entry/boundary) to an end node (farthest entry or anchor). Routes are BFS
// paths through the global node graph; since all graph edges connect
// orthogonally adjacent nodes, the resulting node sequences are valid
// orthogonal game paths by construction.
//
// Pipeline:
//   9.1 _selectEndpoints  — head at boundary/entry node per region
//   9.2 _generateRoutes   — BFS from start to end through global graph
//   9.3 _avoidCollisions  — drop lower-priority route when node conflict found
//   9.4 _routeAroundObstacles — no-op placeholder (full routing deferred to Phase 9)
//   9.5 _optimizeRoutes   — drop routes with < 3 nodes
//   9.6 _finaliseGeometry — compute heading from terminal segment
//   Post-filter: headRayClear check; try reverse; mark unroutable if both fail
//
// Result: RoutedPath[] — { regionId, motifType, nodes, heading, role, placeOrder }
// =============================================================================

class PathRouter {

    // skeletons: optional array of MotifSkeletonGenerator results; when present,
    // orderedPath from each skeleton is used instead of BFS so motif shapes are visible.
    route(globalGraph, regionGraphs, topology, grid, skeletons = null) {
        if (!globalGraph?.nodes?.length) return [];

        const adj        = this._buildAdjacency(globalGraph);
        const nodeById   = new Map(globalGraph.nodes.map(n => [n.id, n]));
        const skelByReg  = skeletons
            ? new Map(skeletons.map(s => [s.regionId, s]))
            : new Map();

        // Stage 9.1 — endpoint pairs per region
        const pairs = this._selectEndpoints(globalGraph, regionGraphs, topology);

        // Stage 9.2 — routes: use orderedPath when available, BFS as fallback
        let routes = this._generateRoutes(pairs, adj, nodeById, skelByReg);

        // Stage 9.3 — collision avoidance
        routes = this._avoidCollisions(routes, topology);

        // Stage 9.4 — obstacle routing (placeholder)
        routes = this._routeAroundObstacles(routes, globalGraph);

        // Stage 9.5 — drop too-short routes
        routes = this._optimizeRoutes(routes);

        // Stage 9.6 — heading assignment
        routes = this._finaliseGeometry(routes);

        // Post-filter: headRayClear check
        return this._filterByHeadRayClear(routes, grid);
    }

    // ── Stage 9.1 — endpoint selection ───────────────────────────────────────

    _selectEndpoints(globalGraph, regionGraphs, topology) {
        const pairs = [];

        for (const rg of regionGraphs) {
            const regionNodes = globalGraph.nodes.filter(n => n.regionId === rg.regionId);
            if (regionNodes.length < 2) continue;

            const entries = regionNodes.filter(n => n.role === 'ENTRY' || n.role === 'EXIT');
            const anchors = regionNodes.filter(n => n.role === 'ANCHOR');
            const pool    = entries.length >= 2 ? entries : [...entries, ...anchors];
            if (pool.length < 2) continue;

            const start = pool[0];
            const end   = this._farthest(start, pool.slice(1));

            const depth = topology?.graph?.nodes
                ?.find(n => n.regionId === rg.regionId)?.depth ?? 0;

            // Try to get motifType from the skeleton data (via regionId match in regionGraphs)
            const motifType = rg.nodes.find(n => n.role === 'ANCHOR')
                ? 'UNKNOWN' : 'LOOP';

            pairs.push({ regionId: rg.regionId, startId: start.id, endId: end.id, depth, motifType });
        }

        return pairs;
    }

    _farthest(from, candidates) {
        let best = candidates[0], bestD = -1;
        for (const n of candidates) {
            const d = (n.r - from.r) ** 2 + (n.c - from.c) ** 2;
            if (d > bestD) { bestD = d; best = n; }
        }
        return best;
    }

    // ── Stage 9.2 — routing: orderedPath first, BFS fallback ─────────────────

    _generateRoutes(pairs, adj, nodeById, skelByReg) {
        return pairs.map(pair => {
            const skel = skelByReg.get(pair.regionId);

            // Use the skeleton's ordered traversal when available and long enough.
            // Minimum 3 nodes so tiny clips from irregular regions don't produce
            // visually insignificant paths.
            if (skel?.orderedPath?.length >= 3) {
                return { ...pair, nodes: skel.orderedPath, motifType: skel.motifType };
            }

            // BFS fallback
            const nodeIds = this._bfs(pair.startId, pair.endId, adj);
            if (!nodeIds) return null;
            const nodes = nodeIds.map(id => nodeById.get(id))
                                 .filter(Boolean)
                                 .map(n => ({ r: n.r, c: n.c }));
            return { ...pair, nodes };
        }).filter(Boolean);
    }

    _bfs(startId, endId, adj) {
        if (startId === endId) return [startId];
        const parent = new Map([[startId, -1]]);
        const queue  = [startId];
        let head = 0;

        while (head < queue.length) {
            const curr = queue[head++];
            if (curr === endId) {
                const path = [];
                let node = endId;
                while (node !== -1) { path.unshift(node); node = parent.get(node); }
                return path;
            }
            for (const next of adj.get(curr) || []) {
                if (!parent.has(next)) { parent.set(next, curr); queue.push(next); }
            }
        }
        return null;
    }

    // ── Stage 9.3 — collision avoidance ──────────────────────────────────────

    // Higher topology depth = higher priority. Conflicting lower-priority routes
    // are dropped (no re-routing in Phase 5; re-routing is a Phase 9 concern).
    _avoidCollisions(routes, topology) {
        const sorted   = [...routes].sort((a, b) => (b.depth || 0) - (a.depth || 0));
        const occupied = new Set();
        const kept     = [];

        for (const r of sorted) {
            if (r.nodes.some(n => occupied.has(`${n.r},${n.c}`))) continue;
            for (const n of r.nodes) occupied.add(`${n.r},${n.c}`);
            kept.push(r);
        }

        return kept;
    }

    // ── Stage 9.4 — obstacle routing (placeholder) ───────────────────────────

    _routeAroundObstacles(routes, globalGraph) { return routes; }

    // ── Stage 9.5 — optimise ─────────────────────────────────────────────────

    _optimizeRoutes(routes) {
        return routes.filter(r => r.nodes.length >= 3);
    }

    // ── Stage 9.6 — finalise geometry ────────────────────────────────────────

    _finaliseGeometry(routes) {
        return routes.map(r => {
            const { nodes } = r;
            const last = nodes[nodes.length - 1];
            const prev = nodes[nodes.length - 2];
            const dr = last.r - prev.r, dc = last.c - prev.c;
            const heading = dr === -1 ? 'UP' : dr === 1 ? 'DOWN'
                          : dc === -1 ? 'LEFT' : 'RIGHT';
            return { ...r, heading, role: 'SPINE', placeOrder: 0 };
        });
    }

    // ── Post-filter: headRayClear ─────────────────────────────────────────────

    _filterByHeadRayClear(routes, grid) {
        // Build combined node set from all routes for mutual occlusion checking
        const allNodes = new Set();
        for (const r of routes)
            for (const n of r.nodes) allNodes.add(`${n.r},${n.c}`);

        const DR = { UP: -1, DOWN: 1, LEFT: 0, RIGHT: 0 };
        const DC = { UP: 0,  DOWN: 0, LEFT: -1, RIGHT: 1 };

        const result = [];
        for (const route of routes) {
            const { nodes, heading } = route;
            const ownSet = new Set(nodes.map(n => `${n.r},${n.c}`));

            const head = nodes[nodes.length - 1];
            const isOutward = this._isOutward(head, heading, grid);
            const isBlocked = this._headBlocked(head, DR[heading], DC[heading], ownSet, allNodes, grid);

            if (isBlocked || isOutward) {
                // Try reversing the path
                const rev   = [...nodes].reverse();
                const last2 = rev[rev.length - 1], prev2 = rev[rev.length - 2];
                const rdr = last2.r - prev2.r, rdc = last2.c - prev2.c;
                const rh  = rdr === -1 ? 'UP' : rdr === 1 ? 'DOWN' : rdc === -1 ? 'LEFT' : 'RIGHT';

                const revOutward = this._isOutward(last2, rh, grid);
                const revBlocked = this._headBlocked(last2, DR[rh], DC[rh], ownSet, allNodes, grid);

                // We prefer the reversed path if it is NOT blocked, and either:
                // (a) the original was blocked (so anything is better), OR
                // (b) the original pointed outward and the reversed does not point outward.
                if (!revBlocked && (!revOutward || (isBlocked && revOutward))) {
                    result.push({ ...route, nodes: rev, heading: rh });
                    continue;
                }
            }

            if (!isBlocked) {
                result.push(route);
            }
        }

        return result;
    }

    _isOutward(head, heading, grid) {
        const { r, c } = head;
        if (r === 0 && heading === 'UP') return true;
        if (r === grid.rows && heading === 'DOWN') return true;
        if (c === 0 && heading === 'LEFT') return true;
        if (c === grid.cols && heading === 'RIGHT') return true;
        return false;
    }

    _headBlocked(head, dr, dc, ownSet, allNodes, grid) {
        let r = head.r + dr, c = head.c + dc;
        while (grid.inBounds(r, c)) {
            // Only consider blocked if it hits an inactive mask cell (permanent obstacle).
            // Blocking by other paths (allNodes) is a valid dependency and should not force path reversal.
            if (!grid.isActive(r, c)) return true;
            r += dr; c += dc;
        }
        return false;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _buildAdjacency(graph) {
        const adj = new Map(graph.nodes.map(n => [n.id, []]));
        for (const e of graph.edges) {
            adj.get(e.from)?.push(e.to);
            adj.get(e.to)?.push(e.from);
        }
        return adj;
    }
}
