// =============================================================================
// SolveOrderPlanner.js — Stage 12: derive the intended solve sequence
//
// Places all routed fixed paths on a temporary grid, verifies solvability via
// SolvabilityOracle, and uses oracle.recomputePlaceOrder to derive placeOrder
// values (first cleared = highest placeOrder, matching RC construction semantics).
//
// If solvability fails with all paths, attempts subsets by dropping the path
// most responsible for conflicts. This degrades gracefully: fewer fixed paths
// rather than no fixed paths.
//
// Pipeline:
//   12.1 _topologicalSort           — Kahn's algorithm on the dependency DAG
//   12.2 _generateIntendedSolution  — pick max-depth (hard) or min-depth (easy)
//   12.3 _measureDepth              — longest path in DAG
//   12.4 _removeAlternateSolutions  — deferred; only when alternateCount ≤ 3
//   12.5 _storeSolution             — place on tmpGrid, oracle.recomputePlaceOrder
//
// Result: { intendedSequence, solvableDepth, fixedPaths, blockerRatio } | null
// =============================================================================

class SolveOrderPlanner {

    plan(dag, routedPaths, config, tmpGrid, oracle) {
        if (!dag || !routedPaths?.length) return null;

        // Stage 12.1 — topological sort
        const allOrders = this._topologicalSort(dag);
        if (!allOrders.length) return null;

        // Stage 12.2 — pick intended solution based on difficulty
        const intended = this._generateIntendedSolution(allOrders, dag, config);

        // Stage 12.3 — measure solve depth
        const solvableDepth = this._measureDepth(dag);

        // Stage 12.4 — alternate solution removal (only when few alternates)
        if (allOrders.length > 1 && allOrders.length <= 3) {
            this._removeAlternateSolutions(dag, routedPaths, tmpGrid, oracle, allOrders, intended);
        }

        // Stage 12.5 — place on temp grid, validate solvability, assign placeOrder
        const fixedPaths = this._storeSolution(routedPaths, tmpGrid, oracle);

        if (!fixedPaths) return null;

        // Compute blocker ratio for fillA d-parameter
        const blockers = routedPaths.filter((_, i) =>
            dag.edges.some(e => e.to === i)
        ).length;
        const blockerRatio = routedPaths.length > 0 ? blockers / routedPaths.length : 0;

        return { intendedSequence: intended, solvableDepth, fixedPaths, blockerRatio };
    }

    // ── Stage 12.1 — topological sort (Kahn's) ───────────────────────────────

    _topologicalSort(dag) {
        const N = dag.nodes;
        const adj    = Array.from({ length: N }, () => []);
        const inDeg  = new Int32Array(N);

        for (const e of dag.edges) { adj[e.from].push(e.to); inDeg[e.to]++; }

        const starts = [];
        for (let i = 0; i < N; i++) if (inDeg[i] === 0) starts.push(i);
        if (!starts.length) return [[...Array(N).keys()]]; // cycle guard

        // Generate all valid orderings (capped at 4 to avoid combinatorial explosion)
        const results = [];
        const current = [];
        const degCopy = new Int32Array(inDeg);
        const queue   = [...starts];

        const dfs = (availQueue) => {
            if (current.length === N) { results.push([...current]); return; }
            if (results.length >= 4) return; // cap
            for (let i = 0; i < availQueue.length; i++) {
                const node = availQueue[i];
                current.push(node);
                const next = [...availQueue.slice(0, i), ...availQueue.slice(i + 1)];
                for (const child of adj[node]) {
                    degCopy[child]--;
                    if (degCopy[child] === 0) next.push(child);
                }
                dfs(next);
                current.pop();
                for (const child of adj[node]) degCopy[child]++;
            }
        };

        dfs(queue);
        return results.length ? results : [[...Array(N).keys()]];
    }

    // ── Stage 12.2 — pick intended solution ──────────────────────────────────

    _generateIntendedSolution(allOrders, dag, config) {
        if (allOrders.length === 1) return allOrders[0];

        const diffTarget = config?.difficultyTarget;
        const isHard     = diffTarget === 'HARD' || diffTarget === 'EXPERT' || diffTarget === 'TITAN';

        // Hard: pick the ordering that maximises critical-path length
        // Easy: pick the ordering that minimises it
        const scored = allOrders.map(order => ({
            order,
            score: this._criticalPathScore(order, dag),
        }));

        scored.sort((a, b) => isHard ? b.score - a.score : a.score - b.score);
        return scored[0].order;
    }

    _criticalPathScore(order, dag) {
        // How many "dependency jumps" are required when following this order?
        const pos = new Map(order.map((id, i) => [id, i]));
        let score = 0;
        for (const e of dag.edges) {
            const fromPos = pos.get(e.from) ?? 0;
            const toPos   = pos.get(e.to)   ?? 0;
            if (toPos < fromPos) score++; // blocker cleared before blocked path ✓
        }
        return score;
    }

    // ── Stage 12.3 — measure depth ───────────────────────────────────────────

    _measureDepth(dag) {
        const N   = dag.nodes;
        const adj = Array.from({ length: N }, () => []);
        for (const e of dag.edges) adj[e.from].push(e.to);

        const memo = new Int32Array(N).fill(-1);
        const dfs  = (u) => {
            if (memo[u] >= 0) return memo[u];
            memo[u] = 0;
            for (const v of adj[u]) memo[u] = Math.max(memo[u], 1 + dfs(v));
            return memo[u];
        };

        let max = 0;
        for (let i = 0; i < N; i++) max = Math.max(max, dfs(i));
        return max;
    }

    // ── Stage 12.4 — alternate solution removal ───────────────────────────────

    // Adds extra dependency edges to eliminate the N-1 non-intended orderings.
    // Only runs when alternateCount ≤ 3 (safe budget).
    _removeAlternateSolutions(dag, routedPaths, tmpGrid, oracle, allOrders, intended) {
        const intendedSet = new Set(intended.map((id, i) => `${id}:${i}`));

        for (const alt of allOrders) {
            if (alt === intended) continue;
            // Find the first position where this ordering diverges from intended
            for (let i = 0; i < alt.length; i++) {
                if (alt[i] !== intended[i]) {
                    // Add a dependency: intended[i] must clear before alt[i]
                    const fromIdx = intended[i];
                    const toIdx   = alt[i];
                    if (fromIdx !== toIdx) {
                        const key = `${fromIdx}:${toIdx}`;
                        if (!dag.edges.some(e => `${e.from}:${e.to}` === key)) {
                            dag.edges.push({ from: fromIdx, to: toIdx, type: 'UNLOCK', weight: 1 });
                        }
                    }
                    break;
                }
            }
        }
    }

    // ── Stage 12.5 — place on temp grid and assign placeOrder ─────────────────

    // Places fixed paths INCREMENTALLY — each path is placed only if it keeps
    // the board solvable; paths that would break solvability are reverted and
    // skipped. This guarantees at least some motif structure is always present
    // (never all-or-nothing rejection that falls back to pure RC).
    _storeSolution(routedPaths, tmpGrid, oracle) {
        const tmpPaths = [];
        const placed   = [];

        for (let i = 0; i < routedPaths.length; i++) {
            const rp = routedPaths[i];
            if (!rp.nodes?.length || rp.nodes.length < 2 || !rp.heading) continue;

            // All nodes must be in-bounds and currently free
            if (!rp.nodes.every(n => tmpGrid.inBounds(n.r, n.c) && tmpGrid.isFree(n.r, n.c))) continue;

            // Must be strictly orthogonal
            const orth = rp.nodes.every((n, j) => {
                if (j === 0) return true;
                const p = rp.nodes[j - 1];
                return Math.abs(n.r - p.r) + Math.abs(n.c - p.c) === 1;
            });
            if (!orth) continue;

            // Place on temp grid
            const id   = tmpPaths.length;
            const path = new Path(id, rp.nodes.map(n => ({ r: n.r, c: n.c })), rp.heading);
            path.originalNodes = rp.nodes.map(n => ({ r: n.r, c: n.c }));

            for (const n of rp.nodes) tmpGrid.setOwner(n.r, n.c, id);
            for (let j = 0; j < rp.nodes.length - 1; j++) {
                const a = rp.nodes[j], b = rp.nodes[j + 1];
                tmpGrid.reserveEdge(a.r, a.c, b.r, b.c, id);
            }
            tmpPaths.push(path);

            // If this path breaks solvability, revert it and move on to the next
            if (!oracle.isBoardSolvable(tmpPaths, tmpGrid)) {
                for (const n of rp.nodes) tmpGrid.setOwner(n.r, n.c, -1);
                for (let j = 0; j < rp.nodes.length - 1; j++) {
                    const a = rp.nodes[j], b = rp.nodes[j + 1];
                    tmpGrid.reserveEdge(a.r, a.c, b.r, b.c, -1);
                }
                tmpPaths.pop();
                continue; // skip — try the next path
            }

            placed.push(i); // this path is good, keep it
        }

        if (!tmpPaths.length) return null;

        // Assign placeOrder via oracle
        oracle.recomputePlaceOrder(tmpPaths, tmpGrid);

        // Map placeOrder back to routedPaths
        for (let k = 0; k < placed.length; k++) {
            routedPaths[placed[k]].placeOrder = tmpPaths[k].placeOrder;
        }

        console.log(`[SolveOrderPlanner] ${placed.length}/${routedPaths.length} fixed paths accepted`);
        return placed.map(i => routedPaths[i]);
    }
}
