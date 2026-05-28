// =============================================================================
// edge-logic.js — Dependency construction, unjamming, solvability, complexity
// Depends on: edge-gen.js (headingToDelta, deltaToHeading, forwardRayClearSteps)
// =============================================================================

// =============================================================================
// Step 6: DAG Dependency Construction
// =============================================================================

// -----------------------------------------------------------------------------
// hasForwardSelfEdge
// Returns true if ANY node along the forward ray from startNode in `heading`
// direction is owned by pathId (self-collision guard).
// Continues through foreign-owned nodes until hitting the grid boundary.
// Uses nodeOwner so perpendicular self-intersections are correctly detected.
// -----------------------------------------------------------------------------
function hasForwardSelfEdge(pathId, startNode, heading, graph) {
    const { dr, dc }              = headingToDelta(heading);
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;
    let r = startNode.r, c = startNode.c;

    for (let i = 0; i < rows + cols + 4; i++) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr > rows || nc < 0 || nc > cols) break;
        if (nodeOwner[nr * W + nc] === pathId) return true;
        r = nr; c = nc;
    }
    return false;
}

// -----------------------------------------------------------------------------
// buildDAGDep
// Builds the dependency map for the current heading assignment.
//   dep[B] = Set of path IDs whose nodes lie in B's escape corridor.
// "A blocks B" means A must be cleared before B can fire.
//
// Own nodes are transparent; scan stops at the first foreign-owned node.
// Uses nodeOwner so perpendicular blockers are correctly detected.
// -----------------------------------------------------------------------------
function buildDAGDep(paths, graph) {
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;
    const dep = {};
    paths.forEach(p => { dep[p.id] = new Set(); });

    paths.forEach(p => {
        const head       = p.nodes[p.nodes.length - 1];
        const { dr, dc } = headingToDelta(p.heading);
        let r = head.r, c = head.c;

        for (let i = 0; i < rows + cols + 4; i++) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr > rows || nc < 0 || nc > cols) break;

            const owner = nodeOwner[nr * W + nc];
            if (owner >= 0 && owner !== p.id) {
                dep[p.id].add(owner);
                break; // first blocker found — stop scanning
            }
            r = nr; c = nc;
        }
    });

    return dep;
}

// -----------------------------------------------------------------------------
// computeDAGStats
// Computes dependency depth for every path and returns aggregate stats.
//   dep       — raw blocker sets per path
//   maxDepth  — longest chain (depth 0 = free, depth N = N levels of blockers)
//   free      — count of paths with no blockers (depth 0)
//   blockerRatio — avg number of direct blockers per path
// -----------------------------------------------------------------------------
function computeDAGStats(paths, graph) {
    const dep    = buildDAGDep(paths, graph);
    const depths = {};
    const inStack = new Set();

    function getDepth(id) {
        if (depths[id] !== undefined) return depths[id];
        if (inStack.has(id)) return 0; // cycle guard (should not occur post-unjam)
        inStack.add(id);

        const blockers = dep[id];
        if (!blockers || blockers.size === 0) {
            depths[id] = 0;
        } else {
            let maxB = 0;
            blockers.forEach(bid => {
                maxB = Math.max(maxB, getDepth(bid));
            });
            depths[id] = 1 + maxB;
        }

        inStack.delete(id);
        return depths[id];
    }

    paths.forEach(p => getDepth(p.id));

    let maxDepth     = 0;
    let free         = 0;
    let totalBlockers = 0;

    paths.forEach(p => {
        const d = depths[p.id] || 0;
        if (d > maxDepth) maxDepth = d;
        if (d === 0) free++;
        totalBlockers += (dep[p.id]?.size || 0);
    });

    return {
        dep,
        depths,
        maxDepth,
        free,
        blockerRatio: totalBlockers / (paths.length || 1)
    };
}

// -----------------------------------------------------------------------------
// buildDAGHeadings
// DAG-first dependency construction pass (ported from board-gen.js).
//
// After generation + fragmentation, many paths have a clear escape corridor —
// the player can tap them in any order.  This function iteratively flips the
// heading of "free" paths (no current blockers) to point them at another
// path's body, creating an explicit dependency chain.
//
// Each flip is safety-checked:
//   1. Self-collision guard — the entire new forward ray must not cross any
//      self-owned edge (hasForwardSelfEdge).
//   2. Target check — after flip, there must actually be a foreign blocker in
//      the new corridor; skip if the path remains freely escapable.
//   3. Cycle guard — DFS confirms the target path cannot already reach this
//      path through the current dep graph (prevents deadlock cycles).
//
// 6 passes; exits early when no more flips can be made.
// Mutates path.nodes (reversal) and path.heading in-place.
// -----------------------------------------------------------------------------
function buildDAGHeadings(paths, graph) {
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;

    for (let pass = 0; pass < 6; pass++) {
        const dep = buildDAGDep(paths, graph);

        // DFS reachability — returns true if toId is reachable from fromId
        function canReach(fromId, toId) {
            const seen = new Set();
            const stk  = [fromId];
            while (stk.length > 0) {
                const cur = stk.pop();
                if (cur === toId) return true;
                if (seen.has(cur)) continue;
                seen.add(cur);
                dep[cur]?.forEach(nxt => stk.push(nxt));
            }
            return false;
        }

        const freePaths = paths.filter(p => dep[p.id].size === 0);
        let flippedAny  = false;

        for (const p of freePaths) {
            const n = p.nodes.length;
            if (n < 2) continue;

            // Reversed endpoint: first node becomes new head
            const newHead = p.nodes[0];
            const newPrev = p.nodes[1];
            const newHdg  = deltaToHeading(
                newHead.r - newPrev.r,
                newHead.c - newPrev.c
            );

            // 1. Self-collision guard — entire ray must be self-free
            if (hasForwardSelfEdge(p.id, newHead, newHdg, graph)) continue;

            // 2. Scan new corridor for the first foreign blocker (node-based)
            const { dr, dc } = headingToDelta(newHdg);
            let blockId = -1;
            let r = newHead.r, c = newHead.c;

            for (let i = 0; i < rows + cols + 4; i++) {
                const nr = r + dr, nc = c + dc;
                if (nr < 0 || nr > rows || nc < 0 || nc > cols) break;

                const owner = nodeOwner[nr * W + nc];
                if (owner >= 0 && owner !== p.id) { blockId = owner; break; }
                r = nr; c = nc;
            }

            if (blockId < 0) continue; // still freely escapes after flip — skip

            // 3. Cycle guard
            if (canReach(blockId, p.id)) continue;

            // ── Safe to flip ────────────────────────────────────────────────
            p.nodes.reverse();
            p.heading       = newHdg;
            p.originalNodes = p.nodes.slice();
            dep[p.id].add(blockId); // keep local dep consistent for this pass
            flippedAny = true;
        }

        if (!flippedAny) break; // converged
    }
}

// =============================================================================
// Step 7: Unjamming Pass
// =============================================================================

// -----------------------------------------------------------------------------
// canEscapeEdge
// Simulates whether path p can fire and exit the board given a set of already-
// cleared paths.  The escape ray travels node-by-node in p.heading direction.
//
// Transparent nodes (pass through):
//   - unowned nodes (-1, shouldn't exist on a complete board)
//   - nodes owned by p itself
//   - nodes owned by any path in clearedSet (virtually removed)
//
// Blocked if: any node owned by a still-active foreign path is encountered.
// Escaped if: ray exits grid boundary without hitting a blocker.
// -----------------------------------------------------------------------------
function canEscapeEdge(p, clearedSet, graph) {
    const { nodeOwner, rows, cols } = graph;
    const W                         = cols + 1;
    const { dr, dc }                = headingToDelta(p.heading);
    const head = p.nodes[p.nodes.length - 1];
    let r = head.r, c = head.c;

    for (let i = 0; i < rows + cols + 4; i++) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr > rows || nc < 0 || nc > cols) return true; // escaped

        const owner = nodeOwner[nr * W + nc];
        if (owner === -1 || owner === p.id || clearedSet.has(owner)) {
            r = nr; c = nc; // transparent — keep going
            continue;
        }

        return false; // blocked by active foreign path
    }
    return true;
}

// -----------------------------------------------------------------------------
// countStuckPaths
// Returns how many paths remain stuck after a full greedy-clear simulation.
// Does NOT mutate paths or graph — pure read.
// -----------------------------------------------------------------------------
function countStuckPaths(paths, graph) {
    const clearedSet = new Set();
    const activeIds  = new Set(paths.map(p => p.id));

    let resolved = true;
    while (resolved) {
        resolved = false;
        for (const p of paths) {
            if (!activeIds.has(p.id)) continue;
            if (canEscapeEdge(p, clearedSet, graph)) {
                clearedSet.add(p.id);
                activeIds.delete(p.id);
                resolved = true;
                break;
            }
        }
    }
    return activeIds.size;
}

// -----------------------------------------------------------------------------
// runUnjammingPass
// Ported from runUnjammingSolvabilityTweak (board-gen.js) to the edge model.
//
// Algorithm (up to 5 passes):
//   1. Greedy-clear simulation: iteratively mark any path that can currently
//      escape (its corridor is free of active foreign edges) as "cleared."
//   2. If all paths cleared → done (board already solvable).
//   3. For each remaining stuck path: try reversing its nodes.
//      - Self-collision guard: reversed heading must not cross any self-owned edge.
//      - Escape check: reversed path must be able to escape given current cleared set.
//      - If both pass → commit the flip, mark as cleared.
//   4. Repeat.  Stop early when no flip was made (converged deadlock — unjammer
//      cannot resolve; board will be rejected in Step 8 solvability check).
//
// Mutates path.nodes (may reverse) and path.heading/originalNodes in-place.
// -----------------------------------------------------------------------------
function runUnjammingPass(paths, graph) {
    for (let pass = 0; pass < 5; pass++) {
        const clearedSet = new Set();
        const activeIds  = new Set(paths.map(p => p.id));

        // ── Phase A: greedy-clear paths that can currently escape ─────────────
        let resolved = true;
        while (resolved) {
            resolved = false;
            for (const p of paths) {
                if (!activeIds.has(p.id)) continue;
                if (canEscapeEdge(p, clearedSet, graph)) {
                    clearedSet.add(p.id);
                    activeIds.delete(p.id);
                    resolved = true;
                    break;
                }
            }
        }

        if (activeIds.size === 0) return; // fully solvable — nothing to unjam

        // ── Phase B: try flipping each stuck path ─────────────────────────────
        let anyFlipped = false;

        for (const p of paths) {
            if (!activeIds.has(p.id)) continue;

            const origHeading = p.heading;

            p.nodes.reverse();
            const newHead = p.nodes[p.nodes.length - 1];
            const newPrev = p.nodes[p.nodes.length - 2];
            const newHdg  = deltaToHeading(newHead.r - newPrev.r, newHead.c - newPrev.c);
            p.heading = newHdg;

            const selfHit = hasForwardSelfEdge(p.id, newHead, newHdg, graph);

            if (!selfHit && canEscapeEdge(p, clearedSet, graph)) {
                // Commit flip — path can now escape
                p.originalNodes = p.nodes.slice();
                clearedSet.add(p.id);
                activeIds.delete(p.id);
                anyFlipped = true;
            } else {
                // Revert
                p.heading = origHeading;
                p.nodes.reverse();
            }
        }

        if (activeIds.size === 0) return;
        if (!anyFlipped) return; // converged — no more flips possible
    }
}

// =============================================================================
// Step 8: Solvability Validation
// =============================================================================

// -----------------------------------------------------------------------------
// isBoardFullySolvable
// Returns true if every path can eventually escape via greedy simulation.
//
// Uses the same canEscapeEdge logic as the unjammer:
//   - own edges transparent
//   - cleared-path edges transparent
//   - free edges transparent
//   - active foreign edges = blocker
//
// A board is solvable if the greedy simulation clears all N paths.
// Boards that fail this check are rejected and regenerated in Step 14.
// -----------------------------------------------------------------------------
function isBoardFullySolvable(paths, graph) {
    return countStuckPaths(paths, graph) === 0;
}

// =============================================================================
// Step 9: Complexity Scoring
// =============================================================================

// -----------------------------------------------------------------------------
// evaluateBoardComplexity
// Computes a scalar difficulty score from the DAG dependency structure.
//
// Formula: score = maxDepth × 3 + blockerRatio × 5.5 - freeRatio × 8
//
//   maxDepth    — longest dependency chain (depth 3 = must clear 3 paths first)
//   blockerRatio — avg number of direct blockers per path (higher = more tangled)
//   freeRatio   — fraction of paths with no blockers (higher = easier board)
//
// Difficulty tiers (same thresholds as original evaluateBoardComplexity):
//   score < 6  → EASY
//   score < 13 → NORMAL
//   score < 22 → HARD
//   score < 29 → EXPERT
//   score ≥ 29 → TITAN
//
// Uses computeDAGStats (already built in Step 6) — no duplicate graph walk.
// -----------------------------------------------------------------------------
function evaluateBoardComplexity(paths, graph) {
    const { maxDepth, free, blockerRatio } = computeDAGStats(paths, graph);

    const freeRatio = free / (paths.length || 1);
    const score     = maxDepth * 3 + blockerRatio * 5.5 - freeRatio * 8;

    return {
        score:          Math.max(0, score),
        maxDepth,
        blockerRatio,
        freeRatio,
        initialEscapes: free,
        tier:           getDifficultyTier(Math.max(0, score))
    };
}

// -----------------------------------------------------------------------------
// getDifficultyTier
// Maps a raw complexity score to a named difficulty tier string.
// -----------------------------------------------------------------------------
function getDifficultyTier(score) {
    if (score < 6)  return 'EASY';
    if (score < 13) return 'NORMAL';
    if (score < 22) return 'HARD';
    if (score < 29) return 'EXPERT';
    return 'TITAN';
}

// -----------------------------------------------------------------------------
// getMinScoreForLevel
// Returns the minimum complexity score required to accept a board at a given
// level.  Boards scoring below this are rejected and regenerated (Step 14).
// -----------------------------------------------------------------------------
function getMinScoreForLevel(level) {
    if (level > 40) return 22; // EXPERT+ at high levels
    if (level > 25) return 13; // HARD+
    if (level > 10) return 6;  // NORMAL+
    return 0;                  // any score accepted early
}

// =============================================================================
// Step 11: Edge-Based Collision Detection
// =============================================================================

// -----------------------------------------------------------------------------
// getLeadingEdgeOwner
// Returns the path ID that owns the edge immediately ahead of a MOVING path's
// current leading position, or -1 if the edge is free / out of bounds.
//
// The leading node is computed from p.nodes head + heading direction × animProgress
// (rounded to nearest integer step).  The edge checked is between the leading
// node and the next node one step further in the heading direction.
//
// Used by animationUpdateTick to detect when a moving path enters foreign territory.
// -----------------------------------------------------------------------------
function getLeadingEdgeOwner(p, hEdge, vEdge, rows, cols) {
    const head       = p.nodes[p.nodes.length - 1];
    const { dr, dc } = headingToDelta(p.heading);

    // Advance by rounded animProgress steps from the head node
    const steps = Math.round(p.animProgress);
    const lr    = head.r + dr * steps;
    const lc    = head.c + dc * steps;

    if (lr < 0 || lr > rows || lc < 0 || lc > cols) return -1; // off-grid

    // Edge between leading node and the next node ahead
    const nr = lr + dr;
    const nc = lc + dc;

    if (nr < 0 || nr > rows || nc < 0 || nc > cols) return -1; // next step exits board

    return (dr === 0)
        ? hEdge[lr][Math.min(lc, nc)]
        : vEdge[Math.min(lr, nr)][lc];
}
