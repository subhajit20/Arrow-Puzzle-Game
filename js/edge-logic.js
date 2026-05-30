// =============================================================================
// edge-logic.js — DAG complexity scoring, solvability assertion, collision
// Depends on: edge-gen.js (headingToDelta, deltaToHeading)
// =============================================================================
// RC-5: hasForwardSelfEdge, buildDAGHeadings, runUnjammingPass removed.
// Headings are final at placement (reverse constructor); solvability is
// guaranteed by construction. isBoardFullySolvable is a post-build assertion.
// =============================================================================

// =============================================================================
// DAG Dependency (used by evaluateBoardComplexity for difficulty scoring)
// =============================================================================

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

// buildDAGHeadings and runUnjammingPass removed (RC-5).
// hasForwardSelfEdge removed (only used by the two functions above).
// countStuckPaths removed (only used by isBoardFullySolvable below).

// -----------------------------------------------------------------------------
// canEscapeEdge
// Simulates whether path p can fire and exit the board given a set of already-
// cleared paths. Kept for runtime collision detection (getLeadingEdgeOwner).
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
            r = nr; c = nc; continue;
        }
        return false; // blocked by active foreign path
    }
    return true;
}

// -----------------------------------------------------------------------------
// isBoardFullySolvable — POST-BUILD ASSERTION ONLY (RC-5)
// Should always return true for boards built by the reverse constructor.
// Logs an error if it ever fires; board-gen.js skips and retries on failure.
// -----------------------------------------------------------------------------
function isBoardFullySolvable(paths, graph) {
    return rcBoardSolvable(paths, graph);
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

// =============================================================================
// Edge-Based Collision Detection
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
