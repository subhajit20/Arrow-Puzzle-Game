// =============================================================================
// RegionNodeGraphBuilder.js — Stage 7: build per-region node graphs
//
// Takes the raw skeleton node sets from Stage 6 and builds proper graph
// structures: assigns node roles, refines entry/exit nodes using actual
// connectivity crossing points, and adds edges between adjacent skeleton nodes.
//
// Pipeline:
//   7.1 _buildAnchorNodes  — skeleton's fixed structural points (from skeleton)
//   7.2 _buildEntryNodes   — nodes at region boundary crossings (via connectivity)
//   7.3 _buildExitNodes    — directed exits (topology direction; deferred to Phase 5)
//   7.4 _buildInternalNodes— skeleton nodes that are not anchor/entry/exit
//   7.5 _buildMotifGraph   — edges between orthogonally adjacent skeleton nodes
//   7.6 _mergeGraphs       — package per-region arrays into the result structure
//
// Result: [{ regionId, nodes: [{ id, r, c, regionId, role }], edges: [{ from, to }] }]
// =============================================================================

class RegionNodeGraphBuilder {

    // ── Entry point ───────────────────────────────────────────────────────────

    build(skeletons, regionLayout, connectivity) {
        const perRegion = skeletons.map(skeleton =>
            this._buildRegionGraph(skeleton, connectivity)
        );
        return this._mergeGraphs(perRegion);
    }

    // ── Per-region graph construction ─────────────────────────────────────────

    _buildRegionGraph(skeleton, connectivity) {
        const { regionId, anchorNodes, internalNodes, nodeSet } = skeleton;

        // Stage 7.2 — refine entry nodes using actual crossing points
        const entryNodes = this._buildEntryNodes(skeleton, connectivity);

        // Stage 7.3 — exit nodes (same as entry in Phase 4; topology refines in Phase 5)
        const exitNodes = this._buildExitNodes(skeleton, connectivity, entryNodes);

        // Stage 7.4 — internal: skeleton nodes not classified as anchor/entry/exit
        const specialKeys = new Set([
            ...entryNodes.map(n => `${n.r},${n.c}`),
            ...exitNodes.map(n => `${n.r},${n.c}`),
            ...anchorNodes.map(n => `${n.r},${n.c}`),
        ]);
        const refinedInternal = internalNodes.filter(n => !specialKeys.has(`${n.r},${n.c}`));

        // Assign sequential IDs and roles
        let nextId = 0;
        const nodeById = new Map(); // "r,c" → id
        const nodes    = [];

        const add = (n, role) => {
            const key = `${n.r},${n.c}`;
            if (nodeById.has(key)) return;
            const id = nextId++;
            nodeById.set(key, id);
            nodes.push({ id, r: n.r, c: n.c, regionId, role });
        };

        for (const n of anchorNodes)       add(n, 'ANCHOR');
        for (const n of entryNodes)        add(n, 'ENTRY');
        for (const n of exitNodes)         add(n, 'EXIT');
        for (const n of refinedInternal)   add(n, 'INTERNAL');

        // Stage 7.5 — edges between orthogonally adjacent skeleton nodes
        const edges = this._buildMotifGraph(nodes, nodeById);

        return { regionId, nodes, edges };
    }

    // ── Stage 7.2 — entry nodes ───────────────────────────────────────────────

    // Finds crossing nodes from connectivity links that land inside the skeleton.
    // Falls back to skeleton's pre-computed boundary anchors if no crossing found.
    _buildEntryNodes(skeleton, connectivity) {
        const { regionId, nodeSet, entryNodes: fallback } = skeleton;
        const crossings = [];

        for (const link of connectivity.links) {
            if (link.regionA !== regionId && link.regionB !== regionId) continue;
            for (const cn of link.crossingNodes) {
                if (nodeSet.has(`${cn.r},${cn.c}`))
                    crossings.push({ r: cn.r, c: cn.c });
            }
        }

        return crossings.length ? crossings : fallback;
    }

    // ── Stage 7.3 — exit nodes ────────────────────────────────────────────────

    // In Phase 4 exit = entry; topology direction is applied in Phase 5.
    _buildExitNodes(skeleton, connectivity, entryNodes) {
        return [...entryNodes];
    }

    // ── Stage 7.5 — motif graph edges ─────────────────────────────────────────

    // For each skeleton node, check its 4 orthogonal neighbours.
    // If a neighbour is also a skeleton node, add an undirected edge (once per pair).
    _buildMotifGraph(nodes, nodeById) {
        const DR = [-1, 1,  0, 0];
        const DC = [ 0, 0, -1, 1];
        const edges = [];

        for (const n of nodes) {
            for (let d = 0; d < 4; d++) {
                const nid = nodeById.get(`${n.r + DR[d]},${n.c + DC[d]}`);
                if (nid !== undefined && nid > n.id)
                    edges.push({ from: n.id, to: nid });
            }
        }

        return edges;
    }

    // ── Stage 7.6 — merge ─────────────────────────────────────────────────────

    _mergeGraphs(perRegionGraphs) {
        return perRegionGraphs;
    }
}
