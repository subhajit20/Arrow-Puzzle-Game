// =============================================================================
// TopologyGenerator.js — Stage 4: build a directed dependency topology
//
// Converts the region connectivity graph into a directed DAG whose edges encode
// which regions must be cleared before others can fire.
//
// Edge semantics: A → B means "clearing A unlocks B" (B depends on A).
//   - ROOT nodes have inDegree = 0 → cleared first, no prerequisites.
//   - LEAF nodes have outDegree = 0 → cleared last, unlock nothing further.
//
// Styles:
//   LINEAR — chain  R0→R1→R2→…→Rn   (simplest)
//   STAR   — hub node unlocks all others  Hub→all
//   TREE   — BFS spanning tree of the connectivity adjacency
//   MESH   — spanning tree + all additional adjacency edges
//
// Pipeline:
//   4.1 _selectStyle     — weighted random from config.topologyWeights
//   4.2 _buildGraph      — directed edges per style
//   4.3 _assignHierarchy — BFS depth from roots
//   4.4 _assignBranches  — mark outDegree > 1 nodes
//   4.5 _assignHubs      — mark top-quartile degree nodes
//   4.6 _validate        — warn on orphan regions
//   4.7 _storeMetadata   — set role: ROOT / LEAF / BRANCH / HUB / INTERNAL
//
// Result: { style, graph: { nodes: [{ regionId, role, depth, inDegree,
//   outDegree }], edges: [{ from, to, type }] } }
// =============================================================================

class TopologyGenerator {

    // ── Entry point ───────────────────────────────────────────────────────────

    generate(connectivity, config) {
        const regionCount = connectivity?.adjacency?.size ?? 0;
        if (regionCount < 1) return null;

        const rng  = TopologyGenerator._lcg(config.seed ?? 0);

        // Stage 4.1 — style selection
        const style = this._selectStyle(config.topologyWeights, regionCount, rng);

        // Stage 4.2 — directed edges
        const rawEdges = this._buildGraph(style, connectivity, regionCount, rng);

        // Compute in / out degree from raw edges
        const inDeg  = new Int32Array(regionCount);
        const outDeg = new Int32Array(regionCount);
        for (const e of rawEdges) { outDeg[e.from]++; inDeg[e.to]++; }

        const nodes = Array.from({ length: regionCount }, (_, i) => ({
            regionId:  i,
            role:      'INTERNAL',
            depth:     0,
            inDegree:  inDeg[i],
            outDegree: outDeg[i],
        }));

        const graph = { nodes, edges: rawEdges };

        // Stage 4.3 — hierarchy (BFS depth from roots)
        this._assignHierarchy(graph);

        // Stage 4.4 & 4.5 — branch / hub flags (read by _storeMetadata)
        this._assignBranches(graph);
        this._assignHubs(graph);

        // Stage 4.7 — roles (after branch / hub flags are set)
        this._storeMetadata(graph);

        // Stage 4.6 — validation
        this._validate(graph, connectivity);

        return { style, graph };
    }

    // ── Stage 4.1 — style selection ───────────────────────────────────────────

    _selectStyle(topologyWeights, regionCount, rng) {
        const w = Object.assign({}, topologyWeights);
        // Clamp style complexity to available region count
        if (regionCount < 3) { w.TREE = 0; w.STAR = 0; w.MESH = 0; }
        else if (regionCount < 4) { w.MESH = 0; }
        return PipelineConfig.weightedPick(w, rng) || 'LINEAR';
    }

    // ── Stage 4.2 — build directed edges ─────────────────────────────────────

    _buildGraph(style, connectivity, regionCount, rng) {
        const { adjacency } = connectivity;

        switch (style) {
            case 'LINEAR': {
                // BFS traversal order starting from the least-connected region
                const order = this._bfsOrder(adjacency, regionCount);
                const edges = [];
                for (let i = 0; i < order.length - 1; i++)
                    edges.push({ from: order[i], to: order[i + 1], type: 'DEPENDENCY' });
                return edges;
            }

            case 'STAR': {
                // Highest-degree region in adjacency = hub; hub unlocks all others
                const hub   = this._mostConnected(adjacency, regionCount);
                const edges = [];
                for (let i = 0; i < regionCount; i++)
                    if (i !== hub) edges.push({ from: hub, to: i, type: 'UNLOCK' });
                return edges;
            }

            case 'TREE': {
                return this._spanningTree(adjacency, regionCount, rng);
            }

            case 'MESH': {
                // Spanning tree + every additional adjacency edge not already in tree
                const tree   = this._spanningTree(adjacency, regionCount, rng);
                const inTree = new Set(tree.map(e => e.from * 10000 + e.to));
                for (const [a, neighbors] of adjacency) {
                    for (const b of neighbors) {
                        if (a >= b) continue; // deduplicate
                        if (!inTree.has(a * 10000 + b) && !inTree.has(b * 10000 + a))
                            tree.push({ from: a, to: b, type: 'UNLOCK' });
                    }
                }
                return tree;
            }

            default:
                return [];
        }
    }

    // ── Stage 4.3 — hierarchy depth ───────────────────────────────────────────

    _assignHierarchy(graph) {
        const { nodes, edges } = graph;
        const n = nodes.length;

        const children = Array.from({ length: n }, () => []);
        for (const e of edges) children[e.from].push(e.to);

        const depth = new Int32Array(n).fill(-1);
        const queue = [];
        for (const nd of nodes) {
            if (nd.inDegree === 0) { depth[nd.regionId] = 0; queue.push(nd.regionId); }
        }
        // Cycle guard — if no roots exist, start from region 0
        if (!queue.length) { depth[0] = 0; queue.push(0); }

        let head = 0;
        while (head < queue.length) {
            const curr = queue[head++];
            for (const child of children[curr]) {
                if (depth[child] === -1) {
                    depth[child] = depth[curr] + 1;
                    queue.push(child);
                }
            }
        }

        const maxD = Math.max(0, ...depth.filter(d => d >= 0));
        for (const nd of nodes)
            nd.depth = depth[nd.regionId] >= 0 ? depth[nd.regionId] : maxD + 1;
    }

    // ── Stage 4.4 & 4.5 — branch + hub flags ─────────────────────────────────

    _assignBranches(graph) {
        for (const nd of graph.nodes) nd._branch = nd.outDegree > 1;
    }

    _assignHubs(graph) {
        const degrees = graph.nodes.map(nd => nd.inDegree + nd.outDegree);
        const sorted  = [...degrees].sort((a, b) => b - a);
        // Hub threshold = top 25% degree, minimum 3
        const thresh  = Math.max(3, sorted[Math.floor(sorted.length * 0.25)] ?? 3);
        for (const nd of graph.nodes)
            nd._hub = (nd.inDegree + nd.outDegree) >= thresh;
    }

    // ── Stage 4.7 — role assignment ───────────────────────────────────────────

    // Priority: HUB > BRANCH > ROOT > LEAF > INTERNAL
    _storeMetadata(graph) {
        for (const nd of graph.nodes) {
            if      (nd._hub)            nd.role = 'HUB';
            else if (nd._branch)         nd.role = 'BRANCH';
            else if (nd.inDegree  === 0) nd.role = 'ROOT';
            else if (nd.outDegree === 0) nd.role = 'LEAF';
            else                         nd.role = 'INTERNAL';
            delete nd._hub;
            delete nd._branch;
        }
    }

    // ── Stage 4.6 — validation ────────────────────────────────────────────────

    _validate(graph, connectivity) {
        const regionIds = new Set(graph.nodes.map(nd => nd.regionId));

        // All regions in connectivity must appear in the topology
        for (const id of connectivity.adjacency.keys()) {
            if (!regionIds.has(id))
                console.warn(`[TopologyGenerator] Region ${id} missing from graph`);
        }

        // All nodes must be reachable from at least one root
        const children = Array.from({ length: graph.nodes.length }, () => []);
        for (const e of graph.edges) children[e.from].push(e.to);

        const visited = new Set();
        for (const nd of graph.nodes) {
            if (nd.inDegree !== 0) continue;
            const q = [nd.regionId]; let h = 0;
            while (h < q.length) {
                const c = q[h++];
                if (!visited.has(c)) { visited.add(c); for (const ch of children[c]) q.push(ch); }
            }
        }

        for (const nd of graph.nodes) {
            if (!visited.has(nd.regionId))
                console.warn(`[TopologyGenerator] Region ${nd.regionId} unreachable in topology`);
        }
    }

    // ── Private traversal helpers ─────────────────────────────────────────────

    // BFS traversal order starting from the least-connected region.
    _bfsOrder(adjacency, regionCount) {
        let start = 0, minDeg = Infinity;
        for (const [id, neighbors] of adjacency) {
            if (neighbors.size < minDeg) { minDeg = neighbors.size; start = id; }
        }

        const visited = new Set([start]);
        const order   = [start];
        const queue   = [start];
        let head = 0;

        while (head < queue.length) {
            const curr = queue[head++];
            for (const n of [...(adjacency.get(curr) || [])].sort((a, b) => a - b)) {
                if (!visited.has(n)) { visited.add(n); order.push(n); queue.push(n); }
            }
        }

        // Append any unvisited (disconnected) regions at the end
        for (let i = 0; i < regionCount; i++)
            if (!visited.has(i)) order.push(i);

        return order;
    }

    // Find the region with the most adjacency connections.
    _mostConnected(adjacency, regionCount) {
        let best = 0, bestDeg = -1;
        for (const [id, neighbors] of adjacency) {
            if (neighbors.size > bestDeg) { bestDeg = neighbors.size; best = id; }
        }
        return best;
    }

    // BFS spanning tree; edges follow parent → child (DEPENDENCY).
    _spanningTree(adjacency, regionCount, rng) {
        const edges   = [];
        const visited = new Set([0]);
        const queue   = [0];
        let head = 0;

        while (head < queue.length) {
            const curr      = queue[head++];
            const neighbors = [...(adjacency.get(curr) || [])];
            // Shuffle for variety within deterministic seed
            for (let i = neighbors.length - 1; i > 0; i--) {
                const j = (rng() * (i + 1)) | 0;
                [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
            }
            for (const n of neighbors) {
                if (!visited.has(n)) {
                    visited.add(n);
                    edges.push({ from: curr, to: n, type: 'DEPENDENCY' });
                    queue.push(n);
                }
            }
        }

        // Connect any isolated regions directly to root
        for (let i = 1; i < regionCount; i++) {
            if (!visited.has(i)) {
                edges.push({ from: 0, to: i, type: 'DEPENDENCY' });
                visited.add(i);
            }
        }

        return edges;
    }

    // ── PRNG ──────────────────────────────────────────────────────────────────

    static _lcg(seed) {
        let s = ((seed | 0) ^ 0xbeef1234) >>> 0;
        return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
    }
}
