// =============================================================================
// GlobalNodeGraphBuilder.js — Stage 8: stitch region graphs into one global graph
//
// Merges all per-region node graphs (Stage 7) into a single graph, then adds
// cross-region edges at connectivity crossing points, ensures intra-region
// skeleton connectivity from entry nodes, inserts bridge nodes where regions
// have no overlapping skeleton node at a crossing, marks transition edges at
// topology hierarchy changes, and validates that all nodes are reachable.
//
// Pipeline:
//   8.1 _connectRegionGraphs — edges across region boundaries at crossing nodes
//   8.2 _connectMotifGraphs  — ensure all skeleton nodes reachable from entry
//   8.3 _insertBridgeNodes   — synthetic node at boundary midpoint when no overlap
//   8.4 _insertTransitionNodes — mark edges at topology depth transitions
//   8.5 _validateConnectivity — BFS from node 0; log disconnected pairs
//
// Result: { nodes: [{ id, r, c, regionId, role }], edges: [{ from, to, type }] }
// =============================================================================

class GlobalNodeGraphBuilder {

    // ── Entry point ───────────────────────────────────────────────────────────

    build(regionGraphs, connectivity, topology) {
        if (!regionGraphs?.length) return { nodes: [], edges: [] };

        let nextId = 0;
        const nodes  = [];
        const edges  = [];
        const posMap = new Map();   // "r,c" → globalId
        const l2g    = new Map();   // "regionId:localId" → globalId

        // Merge all region nodes and edges into global arrays
        for (const rg of regionGraphs) {
            for (const n of rg.nodes) {
                const gid = nextId++;
                l2g.set(`${rg.regionId}:${n.id}`, gid);
                nodes.push({ id: gid, r: n.r, c: n.c, regionId: rg.regionId, role: n.role });
                posMap.set(`${n.r},${n.c}`, gid);
            }
            for (const e of rg.edges) {
                const f = l2g.get(`${rg.regionId}:${e.from}`);
                const t = l2g.get(`${rg.regionId}:${e.to}`);
                if (f !== undefined && t !== undefined)
                    edges.push({ from: f, to: t, type: 'INTERNAL' });
            }
        }

        const graph = { nodes, edges, posMap };

        // Stage 8.1 — cross-region edges
        this._connectRegionGraphs(graph, connectivity);

        // Stage 8.2 — intra-region connectivity from entry nodes
        this._connectMotifGraphs(graph, regionGraphs, l2g);

        // Stage 8.3 — bridge nodes for gaps at crossing points
        this._insertBridgeNodes(graph, connectivity, () => nextId++);

        // Stage 8.4 — mark transition edges
        if (topology) this._insertTransitionNodes(graph, topology, l2g);

        // Stage 8.5 — validate
        this._validateConnectivity(graph);

        // Return clean result (strip internal build maps)
        return { nodes: graph.nodes, edges: graph.edges };
    }

    // ── Stage 8.1 — connect region graphs ────────────────────────────────────

    // For each connectivity link, find the nearest skeleton node in each region
    // and add a BRIDGE edge between them.
    _connectRegionGraphs(graph, connectivity) {
        for (const link of connectivity.links) {
            const { regionA, regionB, crossingNodes } = link;

            for (const cn of crossingNodes) {
                // Prefer an exact position match; fall back to nearest node in region
                const idA = this._resolveNode(graph, cn, regionA);
                const idB = this._resolveNode(graph, cn, regionB);

                if (idA !== -1 && idB !== -1 && idA !== idB)
                    graph.edges.push({ from: idA, to: idB, type: 'BRIDGE' });
            }
        }
    }

    // ── Stage 8.2 — intra-region connectivity ────────────────────────────────

    // For each region, BFS from entry nodes within the region subgraph.
    // Any skeleton node not reached gets a direct edge to the nearest visited node.
    _connectMotifGraphs(graph, regionGraphs, l2g) {
        for (const rg of regionGraphs) {
            // Collect global IDs for this region's nodes
            const regionGids = new Set(
                rg.nodes.map(n => l2g.get(`${rg.regionId}:${n.id}`)).filter(id => id !== undefined)
            );

            // Entry node global IDs
            const entryGids = rg.nodes
                .filter(n => n.role === 'ENTRY' || n.role === 'EXIT')
                .map(n => l2g.get(`${rg.regionId}:${n.id}`))
                .filter(id => id !== undefined);

            if (!entryGids.length && regionGids.size) {
                // No entry nodes — use the first node as the anchor
                entryGids.push([...regionGids][0]);
            }
            if (!entryGids.length) continue;

            // Build subgraph adjacency for this region
            const adj = new Map();
            for (const id of regionGids) adj.set(id, []);
            for (const e of graph.edges) {
                if (regionGids.has(e.from) && regionGids.has(e.to)) {
                    adj.get(e.from).push(e.to);
                    adj.get(e.to).push(e.from);
                }
            }

            // BFS from entry nodes
            const visited = new Set(entryGids);
            const q = [...entryGids]; let head = 0;
            while (head < q.length) {
                for (const n of adj.get(q[head++]) || [])
                    if (!visited.has(n)) { visited.add(n); q.push(n); }
            }

            // Connect unvisited skeleton nodes to their nearest visited neighbour
            for (const id of regionGids) {
                if (visited.has(id)) continue;
                const curr = graph.nodes[id];
                let bestId = -1, bestD = Infinity;
                for (const vid of visited) {
                    const vn = graph.nodes[vid];
                    const d  = (vn.r - curr.r) ** 2 + (vn.c - curr.c) ** 2;
                    if (d < bestD) { bestD = d; bestId = vid; }
                }
                if (bestId !== -1) {
                    graph.edges.push({ from: id, to: bestId, type: 'INTERNAL' });
                    visited.add(id);
                }
            }
        }
    }

    // ── Stage 8.3 — bridge nodes ──────────────────────────────────────────────

    // When a connectivity crossing point has no skeleton node on either side,
    // insert a synthetic BRIDGE node at that position and connect it.
    _insertBridgeNodes(graph, connectivity, newId) {
        for (const link of connectivity.links) {
            const { regionA, regionB, crossingNodes } = link;

            for (const cn of crossingNodes) {
                const key = `${cn.r},${cn.c}`;
                if (graph.posMap.has(key)) continue; // already covered

                const id = newId();
                const bn = { id, r: cn.r, c: cn.c, regionId: -1, role: 'BRIDGE' };
                graph.nodes.push(bn);
                graph.posMap.set(key, id);

                // Connect to nearest node in each adjacent region
                const nearA = this._nearestInRegion(graph, cn, regionA);
                const nearB = this._nearestInRegion(graph, cn, regionB);
                if (nearA !== -1) graph.edges.push({ from: nearA, to: id,    type: 'BRIDGE' });
                if (nearB !== -1) graph.edges.push({ from: id,    to: nearB, type: 'BRIDGE' });
            }
        }
    }

    // ── Stage 8.4 — transition nodes ─────────────────────────────────────────

    // Mark BRIDGE edges that cross a topology depth boundary as TRANSITION.
    // No new nodes are inserted in Phase 4 — this is a metadata step.
    _insertTransitionNodes(graph, topology) {
        const { nodes: topoNodes } = topology.graph;
        const depthByRegion = new Map(topoNodes.map(n => [n.regionId, n.depth]));

        for (const e of graph.edges) {
            if (e.type !== 'BRIDGE') continue;
            const na = graph.nodes[e.from];
            const nb = graph.nodes[e.to];
            if (!na || !nb) continue;
            const da = depthByRegion.get(na.regionId) ?? -1;
            const db = depthByRegion.get(nb.regionId) ?? -1;
            if (da !== -1 && db !== -1 && da !== db) e.type = 'TRANSITION';
        }
    }

    // ── Stage 8.5 — validate connectivity ────────────────────────────────────

    _validateConnectivity(graph) {
        if (!graph.nodes.length) return;

        // Build adjacency for BFS
        const adj = new Map(graph.nodes.map(n => [n.id, []]));
        for (const e of graph.edges) {
            adj.get(e.from)?.push(e.to);
            adj.get(e.to)?.push(e.from);
        }

        const visited = new Set([graph.nodes[0].id]);
        const q = [graph.nodes[0].id]; let head = 0;
        while (head < q.length) {
            for (const n of adj.get(q[head++]) || [])
                if (!visited.has(n)) { visited.add(n); q.push(n); }
        }

        if (visited.size < graph.nodes.length) {
            const isolated = graph.nodes
                .filter(n => !visited.has(n.id))
                .map(n => `region${n.regionId}@(${n.r},${n.c})`);
            console.warn(`[GlobalNodeGraph] ${isolated.length} unreachable node(s): ${isolated.slice(0, 5).join(', ')}`);
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    // Returns the global ID of the node at position (cn.r, cn.c) in the given
    // region, or the nearest node in that region if none is at that exact position.
    _resolveNode(graph, cn, regionId) {
        const exactKey = `${cn.r},${cn.c}`;
        const exactId  = graph.posMap.get(exactKey);
        if (exactId !== undefined && graph.nodes[exactId]?.regionId === regionId)
            return exactId;
        return this._nearestInRegion(graph, cn, regionId);
    }

    _nearestInRegion(graph, target, regionId) {
        let bestId = -1, bestD = Infinity;
        for (const n of graph.nodes) {
            if (n.regionId !== regionId) continue;
            const d = (n.r - target.r) ** 2 + (n.c - target.c) ** 2;
            if (d < bestD) { bestD = d; bestId = n.id; }
        }
        return bestId;
    }
}
