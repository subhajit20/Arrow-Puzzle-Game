// =============================================================================
// DependencyGraphBuilder.js — Stage 11: build the solve-order DAG
//
// Combines physical blocking relationships (from PathInteractionDetector) with
// logical topology relationships (from TopologyGenerator) into a directed DAG.
//
// Edge semantics: A → B  means "B must be cleared before A can escape".
// Equivalently: B is a prerequisite for clearing A.
//
// Pipeline:
//   11.1 _generateCandidates — merge blocking edges + topology region edges
//   11.2 _addPrerequisiteEdges — B must clear before A (B blocks A → B→A edge)
//   11.3 _addUnlockEdges      — topology unlock edges (parent region clears first)
//   11.4 _buildDAG            — adjacency list { from: [to, …] }
//   11.5 _removeCycles        — DFS; break lowest-weight edge in each cycle
//   11.6 _validate            — warn on orphan paths and unreachable sinks
//
// Result: { nodes, edges, roots, leaves, inDegree, outDegree }
// =============================================================================

class DependencyGraphBuilder {

    build(routedPaths, interactions, topology) {
        if (!routedPaths?.length) return null;

        const N = routedPaths.length;

        // Stage 11.1 — collect all candidate edges
        const candidates = this._generateCandidates(routedPaths, interactions, topology);

        // Stages 11.2 & 11.3 — classify into prerequisite and unlock edges
        const prereqEdges  = this._addPrerequisiteEdges(candidates.blocking);
        const unlockEdges  = this._addUnlockEdges(candidates.topology, routedPaths);

        const rawEdges = [...prereqEdges, ...unlockEdges];

        // Stage 11.4 — build adjacency list
        const dag = this._buildDAG(rawEdges, N);

        // Stage 11.5 — remove cycles
        this._removeCycles(dag);

        // Compute in/out degrees
        const inDegree  = new Int32Array(N);
        const outDegree = new Int32Array(N);
        for (const e of dag.edges) { outDegree[e.from]++; inDegree[e.to]++; }

        const roots  = Array.from({ length: N }, (_, i) => i).filter(i => inDegree[i] === 0);
        const leaves = Array.from({ length: N }, (_, i) => i).filter(i => outDegree[i] === 0);

        // Stage 11.6 — validate
        this._validate(dag, routedPaths, roots);

        return { nodes: N, edges: dag.edges, roots, leaves, inDegree, outDegree };
    }

    // ── Stage 11.1 — candidate collection ────────────────────────────────────

    _generateCandidates(routedPaths, interactions, topology) {
        // Blocking: path i is blocked by path j → j must clear before i
        const blocking = [];
        for (let i = 0; i < routedPaths.length; i++) {
            for (const j of interactions?.blocking?.[i] || []) {
                blocking.push({ from: j, to: i, weight: 2 }); // physical, high weight
            }
        }

        // Topology: topology region A must clear before region B
        // Map region → first routed path in that region
        const regionToPath = new Map();
        for (let i = 0; i < routedPaths.length; i++) {
            const rid = routedPaths[i].regionId;
            if (!regionToPath.has(rid)) regionToPath.set(rid, i);
        }

        const topology_edges = [];
        for (const e of topology?.graph?.edges || []) {
            const fromIdx = regionToPath.get(e.from);
            const toIdx   = regionToPath.get(e.to);
            if (fromIdx !== undefined && toIdx !== undefined && fromIdx !== toIdx) {
                topology_edges.push({ from: fromIdx, to: toIdx, weight: 1 });
            }
        }

        return { blocking, topology: topology_edges };
    }

    // ── Stage 11.2 — prerequisite edges ──────────────────────────────────────

    _addPrerequisiteEdges(blockingCandidates) {
        return blockingCandidates.map(e => ({ ...e, type: 'PREREQUISITE' }));
    }

    // ── Stage 11.3 — unlock edges ─────────────────────────────────────────────

    _addUnlockEdges(topologyCandidates) {
        return topologyCandidates.map(e => ({ ...e, type: 'UNLOCK' }));
    }

    // ── Stage 11.4 — build DAG adjacency ──────────────────────────────────────

    _buildDAG(edges, N) {
        // Deduplicate edges
        const seen = new Set();
        const unique = [];
        for (const e of edges) {
            if (e.from === e.to) continue; // no self-loops
            const key = `${e.from}:${e.to}`;
            if (!seen.has(key)) { seen.add(key); unique.push(e); }
        }
        return { nodes: N, edges: unique };
    }

    // ── Stage 11.5 — cycle removal ────────────────────────────────────────────

    // DFS cycle detection; when a back-edge is found, remove the back-edge
    // (lowest-weight edge in the cycle). Iterates until no cycles remain.
    _removeCycles(dag) {
        const MAX_ITER = 20;
        for (let iter = 0; iter < MAX_ITER; iter++) {
            const backEdge = this._findCycle(dag);
            if (!backEdge) break;
            dag.edges = dag.edges.filter(e => e !== backEdge);
        }
    }

    _findCycle(dag) {
        const N    = dag.nodes;
        const adj  = Array.from({ length: N }, () => []);
        for (const e of dag.edges) adj[e.from].push({ to: e.to, edge: e });

        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Uint8Array(N);
        let backEdge = null;

        const dfs = (u) => {
            color[u] = GRAY;
            for (const { to, edge } of adj[u]) {
                if (color[to] === GRAY) {
                    // Back edge found — record the lowest-weight edge in the path
                    if (!backEdge || edge.weight < backEdge.weight) backEdge = edge;
                    return;
                }
                if (color[to] === WHITE) dfs(to);
                if (backEdge) return;
            }
            color[u] = BLACK;
        };

        for (let i = 0; i < N; i++) if (color[i] === WHITE) { dfs(i); if (backEdge) break; }
        return backEdge;
    }

    // ── Stage 11.6 — validation ───────────────────────────────────────────────

    _validate(dag, routedPaths, roots) {
        if (!roots.length) {
            console.warn('[DependencyGraphBuilder] No root paths — DAG may have cycles');
            return;
        }

        // BFS from all roots to find reachable paths
        const adj     = Array.from({ length: dag.nodes }, () => []);
        for (const e of dag.edges) adj[e.from].push(e.to);

        const visited = new Set(roots);
        const queue   = [...roots]; let head = 0;
        while (head < queue.length) {
            for (const n of adj[queue[head++]])
                if (!visited.has(n)) { visited.add(n); queue.push(n); }
        }

        for (let i = 0; i < dag.nodes; i++) {
            if (!visited.has(i))
                console.warn(`[DependencyGraphBuilder] Path ${i} (region ${routedPaths[i]?.regionId}) is unreachable in DAG`);
        }
    }
}
