// =============================================================================
// PathInteractionDetector.js — Stage 10: classify relationships between paths
//
// Runs after PathRouter. Operates purely on the routed path geometry and grid
// bounds — no grid ownership state required (paths are not yet placed).
//
// Pipeline:
//   10.1 _detectIntersections     — O(n²) node-set scan; should be zero after routing
//   10.2 _detectContainment       — path B bounding box inside path A bounding box
//   10.3 _detectNesting           — hierarchical containment chains A→B→C
//   10.4 _detectBlocking          — A's head ray passes through B's nodes → A blocked by B
//   10.5 _detectHiddenDependencies— transitive blocking (A blocked by B, B blocked by C → A dep on C)
//   10.6 _buildMetadata           — annotate each path: { blockedBy, blocks, containedIn, contains }
//
// Result: { blocking, containment, nesting, hiddenDeps, metadata }
// =============================================================================

class PathInteractionDetector {

    detect(routedPaths, grid) {
        if (!routedPaths?.length) return this._empty();

        const nodeMap = this._buildNodeMap(routedPaths);

        const blocking     = this._detectBlocking(routedPaths, nodeMap, grid);
        const containment  = this._detectContainment(routedPaths);
        const nesting      = this._detectNesting(containment);
        const hiddenDeps   = this._detectHiddenDependencies(routedPaths, blocking);
        const metadata     = this._buildMetadata(routedPaths, blocking, containment, nesting, hiddenDeps);
        const intersections = this._detectIntersections(routedPaths, nodeMap);

        if (intersections.length) {
            console.warn(`[PathInteractionDetector] ${intersections.length} intersection(s) found — routing produced overlapping paths`);
        }

        return { blocking, containment, nesting, hiddenDeps, metadata };
    }

    // ── Stage 10.1 — intersections ────────────────────────────────────────────

    _detectIntersections(paths, nodeMap) {
        const pairs = [];
        for (const [key, ownerIdx] of nodeMap) {
            // Recheck: count how many paths claim this node
            const claimants = paths.filter(p => p.nodes.some(n => `${n.r},${n.c}` === key));
            if (claimants.length > 1) pairs.push(claimants.map(p => p.regionId));
        }
        return pairs;
    }

    // ── Stage 10.2 — containment ─────────────────────────────────────────────

    // Path B is considered contained by A when B's bounding box is fully inside
    // A's bounding box AND A has more nodes (acts as an outer structure).
    _detectContainment(paths) {
        const bboxes = paths.map(p => this._bbox(p.nodes));
        const containment = {}; // pathIndex → index of outer path (or -1)

        for (let i = 0; i < paths.length; i++) {
            containment[i] = -1;
            const bi = bboxes[i];
            let bestArea = Infinity;

            for (let j = 0; j < paths.length; j++) {
                if (i === j) continue;
                const bj = bboxes[j];
                if (bj.minR <= bi.minR && bj.maxR >= bi.maxR &&
                    bj.minC <= bi.minC && bj.maxC >= bi.maxC &&
                    (bj.maxR - bj.minR) * (bj.maxC - bj.minC) < bestArea &&
                    paths[j].nodes.length > paths[i].nodes.length) {
                    const area = (bj.maxR - bj.minR) * (bj.maxC - bj.minC);
                    if (area < bestArea) { bestArea = area; containment[i] = j; }
                }
            }
        }

        return containment;
    }

    // ── Stage 10.3 — nesting ─────────────────────────────────────────────────

    // Builds chains: containment[i] → containment[containment[i]] → …
    _detectNesting(containment) {
        const nesting = {}; // pathIndex → depth in nesting hierarchy
        const keys    = Object.keys(containment).map(Number);

        for (const i of keys) {
            let depth = 0, curr = i;
            while (containment[curr] !== -1 && depth < 20) { depth++; curr = containment[curr]; }
            nesting[i] = depth;
        }

        return nesting;
    }

    // ── Stage 10.4 — blocking ─────────────────────────────────────────────────

    // A is blocked by B if A's head ray (in heading direction) hits any of B's
    // nodes before reaching the board edge. The first blocker found per path is
    // recorded; transitive dependencies are built in Stage 10.5.
    _detectBlocking(paths, nodeMap, grid) {
        const DR = { UP: -1, DOWN: 1, LEFT: 0, RIGHT: 0 };
        const DC = { UP: 0,  DOWN: 0, LEFT: -1, RIGHT: 1 };
        const blocking = {}; // pathIndex → Set<pathIndex> of direct blockers

        for (let i = 0; i < paths.length; i++) {
            blocking[i] = new Set();
            const p  = paths[i];
            if (!p.nodes.length || !p.heading) continue;

            const head = p.nodes[p.nodes.length - 1];
            const dr   = DR[p.heading];
            const dc   = DC[p.heading];
            let r = head.r + dr, c = head.c + dc;

            while (grid.inBounds(r, c)) {
                const ownerIdx = nodeMap.get(`${r},${c}`);
                if (ownerIdx !== undefined && ownerIdx !== i) {
                    blocking[i].add(ownerIdx);
                    break; // record only the immediate blocker
                }
                r += dr; c += dc;
            }
        }

        return blocking;
    }

    // ── Stage 10.5 — hidden dependencies ─────────────────────────────────────

    // Transitive closure: if A is blocked by B, and B is blocked by C,
    // then A also (transitively) depends on C being cleared.
    _detectHiddenDependencies(paths, blocking) {
        const hidden = {}; // pathIndex → Set of all transitive blockers
        const N = paths.length;

        for (let i = 0; i < N; i++) {
            const reachable = new Set();
            const queue = [...blocking[i]];
            let head = 0;
            while (head < queue.length) {
                const curr = queue[head++];
                if (reachable.has(curr)) continue;
                reachable.add(curr);
                for (const dep of blocking[curr] || []) {
                    if (!reachable.has(dep)) queue.push(dep);
                }
            }
            hidden[i] = reachable;
        }

        return hidden;
    }

    // ── Stage 10.6 — metadata ────────────────────────────────────────────────

    _buildMetadata(paths, blocking, containment, nesting, hiddenDeps) {
        const meta = {};
        const N = paths.length;

        for (let i = 0; i < N; i++) {
            const blocksSet = new Set();
            for (let j = 0; j < N; j++) {
                if (blocking[j].has(i)) blocksSet.add(j);
            }

            meta[i] = {
                regionId:     paths[i].regionId,
                blockedBy:    new Set(blocking[i]),
                blocks:       blocksSet,
                containedIn:  containment[i],
                contains:     Object.keys(containment).map(Number).filter(j => containment[j] === i),
                nestingDepth: nesting[i] || 0,
                transitiveDeps: hiddenDeps[i],
            };
        }

        return meta;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _buildNodeMap(paths) {
        const map = new Map();
        for (let i = 0; i < paths.length; i++)
            for (const n of paths[i].nodes)
                map.set(`${n.r},${n.c}`, i);
        return map;
    }

    _bbox(nodes) {
        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        for (const { r, c } of nodes) {
            if (r < minR) minR = r; if (r > maxR) maxR = r;
            if (c < minC) minC = c; if (c > maxC) maxC = c;
        }
        return { minR, maxR, minC, maxC };
    }

    _empty() {
        return { blocking: {}, containment: {}, nesting: {}, hiddenDeps: {}, metadata: {} };
    }
}
