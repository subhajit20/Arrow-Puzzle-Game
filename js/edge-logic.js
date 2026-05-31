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

// =============================================================================
// validateRulebook — formal validation of all 14 RULEBOOK rules.
//
// Returns true only when all HARD rules pass. Hard failures log
//   [Rulebook] Rule N FAIL: <detail>
// via console.error and cause board-gen.js to discard and retry the board.
//
// Rules 12 and 13 are SOFT (informational):
//   Rule 12 — 100% node coverage is the goal; ~4% dead-ends are structural.
//              Hard-fails only below the 90% floor (genuinely degenerate).
//   Rule 13 — exit-slot uniqueness is impossible at large board sizes (path
//              count > available slots). Sequential exits are handled by Rule 14.
//
// Depends on: rcExitPoint, rcExitKey (edge-gen.js), rcBoardSolvable (edge-gen.js),
//             deltaToHeading (edge-gen.js).
// =============================================================================
function validateRulebook(paths, graph) {
    const { rows, cols } = graph;
    let ok = true;

    // ── Pass 1: Rules 4 + 5 — cheapest geometric checks ─────────────────────
    for (const p of paths) {
        for (let i = 0; i < p.nodes.length - 1; i++) {
            const a = p.nodes[i], b = p.nodes[i + 1];
            const dr = b.r - a.r, dc = b.c - a.c;
            if (Math.abs(dr) + Math.abs(dc) !== 1) {
                console.error(`[Rulebook] Rule 4 FAIL: path ${p.id} node ${i}→${i+1} skips (|dr|+|dc|=${Math.abs(dr)+Math.abs(dc)})`);
                ok = false;
            }
            if (dr !== 0 && dc !== 0) {
                console.error(`[Rulebook] Rule 5 FAIL: path ${p.id} node ${i}→${i+1} is diagonal (dr=${dr},dc=${dc})`);
                ok = false;
            }
        }
    }

    // ── Pass 2: Rules 1, 2, 3 — path self-consistency ───────────────────────
    for (const p of paths) {
        // Rule 1: no duplicate segments within a path
        const segSet = new Set();
        for (let i = 0; i < p.nodes.length - 1; i++) {
            const a = p.nodes[i], b = p.nodes[i + 1];
            const key = (a.r === b.r)
                ? ('h:' + a.r + ':' + Math.min(a.c, b.c))
                : ('v:' + Math.min(a.r, b.r) + ':' + a.c);
            if (segSet.has(key)) {
                console.error(`[Rulebook] Rule 1 FAIL: path ${p.id} reuses segment ${key}`);
                ok = false;
            }
            segSet.add(key);
        }

        // Rule 2: no closed loop (start ≠ end)
        const head = p.nodes[p.nodes.length - 1], tail = p.nodes[0];
        if (head.r === tail.r && head.c === tail.c) {
            console.error(`[Rulebook] Rule 2 FAIL: path ${p.id} forms a closed loop`);
            ok = false;
        }

        // Rule 3: no dot visited twice within a path
        const nodeSet = new Set();
        for (const n of p.nodes) {
            const key = n.r + ',' + n.c;
            if (nodeSet.has(key)) {
                console.error(`[Rulebook] Rule 3 FAIL: path ${p.id} revisits node (${n.r},${n.c})`);
                ok = false;
            }
            nodeSet.add(key);
        }
    }

    // ── Pass 3: Rules 6, 7, 8 — path structure ───────────────────────────────
    for (const p of paths) {
        // Rule 6: consecutive segment connectivity.
        // In our node-sequence model this is equivalent to Rule 4 (orthogonal steps
        // guarantee connectivity); verify explicitly for completeness.
        for (let i = 0; i < p.nodes.length - 1; i++) {
            const a = p.nodes[i], b = p.nodes[i + 1];
            if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) {
                console.error(`[Rulebook] Rule 6 FAIL: path ${p.id} chain broken at node ${i}`);
                ok = false;
            }
        }

        // Rule 7: stored heading must match the terminal-segment direction.
        if (p.nodes.length >= 2) {
            const hd = p.nodes[p.nodes.length - 1], pv = p.nodes[p.nodes.length - 2];
            const derived = deltaToHeading(hd.r - pv.r, hd.c - pv.c);
            if (derived !== p.heading) {
                console.error(`[Rulebook] Rule 7 FAIL: path ${p.id} heading=${p.heading} but terminal segment direction=${derived}`);
                ok = false;
            }
        }

        // Rule 8: minimum 3 nodes (2 segments)
        if (p.nodes.length < 3) {
            console.error(`[Rulebook] Rule 8 FAIL: path ${p.id} has ${p.nodes.length} node(s) — minimum is 3`);
            ok = false;
        }
    }

    // ── Pass 4: Rules 9, 10 — exit point and chain ───────────────────────────
    for (const p of paths) {
        // Rule 9: exit point must lie on the board boundary.
        // rcExitPoint always returns a boundary node by construction; this
        // verifies the helper is consistent with the actual heading.
        const ep = rcExitPoint(p, graph);
        if (ep.r !== 0 && ep.r !== rows && ep.c !== 0 && ep.c !== cols) {
            console.error(`[Rulebook] Rule 9 FAIL: path ${p.id} exit (${ep.r},${ep.c}) is not on boundary`);
            ok = false;
        }

        // Rule 10: path is one continuous chain — same as Rule 6, reconfirmed here
        // to satisfy the RULEBOOK ordering. Violations already caught in Pass 3.
    }

    // ── Pass 5: Rules 11, 12, 13 — grid-wide consistency ─────────────────────

    // Rule 11: no segment shared by two different paths.
    const allSegs = new Map();
    for (const p of paths) {
        for (let i = 0; i < p.nodes.length - 1; i++) {
            const a = p.nodes[i], b = p.nodes[i + 1];
            const key = (a.r === b.r)
                ? ('h:' + a.r + ':' + Math.min(a.c, b.c))
                : ('v:' + Math.min(a.r, b.r) + ':' + a.c);
            if (allSegs.has(key)) {
                console.error(`[Rulebook] Rule 11 FAIL: segment ${key} shared by path ${allSegs.get(key)} and path ${p.id}`);
                ok = false;
            } else {
                allSegs.set(key, p.id);
            }
        }
    }

    // Rule 12: node coverage — hard-fail below 90%; info-log below 100%.
    const totalNodes = (rows + 1) * (cols + 1);
    const usedNodes  = paths.reduce((s, p) => s + p.nodes.length, 0);
    const coverage   = usedNodes / totalNodes;
    if (coverage < 0.90) {
        console.error(`[Rulebook] Rule 12 FAIL: coverage ${Math.round(coverage * 100)}% is below the 90% floor`);
        ok = false;
    } else if (coverage < 1.0) {
        console.log(`[Rulebook] Rule 12 INFO: coverage ${Math.round(coverage * 100)}% — ${totalNodes - usedNodes} node(s) are structural dead-ends`);
    }

    // Rule 13: exit-point uniqueness — informational only.
    // Strict uniqueness is impossible when paths > available exit slots at large
    // board sizes. Sequential exits are handled correctly by Rule 14 (solvability).
    const exitSeen = new Set(); let exitColl = 0;
    for (const p of paths) {
        const key = rcExitKey(p, graph);
        if (exitSeen.has(key)) exitColl++;
        else exitSeen.add(key);
    }
    if (exitColl > 0) {
        console.log(`[Rulebook] Rule 13 INFO: ${exitColl} exit-slot collision(s) — sequential ordering handled by Rule 14`);
    }

    // ── Pass 6: Rule 14 — solvability (most expensive) ───────────────────────
    if (!rcBoardSolvable(paths, graph)) {
        console.error('[Rulebook] Rule 14 FAIL: board is not solvable');
        ok = false;
    }

    return ok;
}

// =============================================================================
// VT-1: Visual Entropy Analyzer
// Four independent metrics that measure how visually interesting a board looks.
// None of these affect generation — they are measurement-only.
// =============================================================================

// computeStraightnessIndex
// Average number of nodes per straight run across all paths.
// High = long boring straight lines. Low = frequent turns.
// Formula: per path, runs = direction-change count + 1; avg_run = nodes / runs.
// Global = mean of per-path averages.
function computeStraightnessIndex(paths) {
    if (!paths || paths.length === 0) return 0;
    let sum = 0, count = 0;
    for (const p of paths) {
        if (p.nodes.length < 2) continue;
        let runs = 1;
        let pdr = p.nodes[1].r - p.nodes[0].r, pdc = p.nodes[1].c - p.nodes[0].c;
        for (let i = 2; i < p.nodes.length; i++) {
            const dr = p.nodes[i].r - p.nodes[i-1].r, dc = p.nodes[i].c - p.nodes[i-1].c;
            if (dr !== pdr || dc !== pdc) { runs++; pdr = dr; pdc = dc; }
        }
        sum += p.nodes.length / runs;
        count++;
    }
    return count > 0 ? sum / count : 0;
}

// computeDirectionalEntropy
// Shannon entropy of segment direction distribution across all path segments.
// Measures: is the board direction-balanced?
// Max = 2.0 bits (equal UP/DOWN/LEFT/RIGHT). Low = axis-dominated board.
function computeDirectionalEntropy(paths) {
    const counts = [0, 0, 0, 0]; // UP, DOWN, LEFT, RIGHT by (dr,dc) key
    let total = 0;
    for (const p of paths) {
        for (let i = 0; i < p.nodes.length - 1; i++) {
            const dr = p.nodes[i+1].r - p.nodes[i].r;
            const dc = p.nodes[i+1].c - p.nodes[i].c;
            // Map (dr,dc) → index: UP=0 DOWN=1 LEFT=2 RIGHT=3
            const idx = dr < 0 ? 0 : dr > 0 ? 1 : dc < 0 ? 2 : 3;
            counts[idx]++; total++;
        }
    }
    if (total === 0) return 0;
    let H = 0;
    for (const c of counts) {
        const p = c / total;
        if (p > 0) H -= p * Math.log2(p);
    }
    return H;
}

// computeTurnClusteringCoefficient
// For each turn node, fraction of its 5×5 neighbourhood that also contains turn nodes.
// High = turns cluster together (looks deliberate). Low = turns scatter uniformly.
function computeTurnClusteringCoefficient(paths, graph) {
    const { rows, cols } = graph; const W = cols + 1;
    const R = rows + 1, C = cols + 1;
    const turnSet = new Set();

    for (const p of paths) {
        for (let i = 1; i < p.nodes.length - 1; i++) {
            const dr1 = p.nodes[i].r - p.nodes[i-1].r, dc1 = p.nodes[i].c - p.nodes[i-1].c;
            const dr2 = p.nodes[i+1].r - p.nodes[i].r, dc2 = p.nodes[i+1].c - p.nodes[i].c;
            if (dr1 !== dr2 || dc1 !== dc2)
                turnSet.add(p.nodes[i].r * W + p.nodes[i].c);
        }
    }

    if (turnSet.size === 0) return 0;

    let totalFrac = 0;
    for (const key of turnSet) {
        const tr = (key / W) | 0, tc = key % W;
        let turnNb = 0, validNb = 0;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = tr + dr, nc = tc + dc;
            if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
            validNb++;
            if (turnSet.has(nr * W + nc)) turnNb++;
        }
        totalFrac += validNb > 0 ? turnNb / validNb : 0;
    }
    return totalFrac / turnSet.size;
}

// computeSpatialDensityVariance
// Divides the board into a 4×4 grid of zones, measures TURN-NODE density per zone
// (turn count / total nodes in zone), returns variance across zones.
// Near-zero = turns uniformly scattered (boring). High = some zones are tight and
// turning, others are straight and open — exactly the rhythm VT-3 creates.
// Node-ownership density was the original definition but it is nearly constant at
// ~96% everywhere regardless of zone type — turn density is the correct proxy.
function computeSpatialDensityVariance(paths, graph) {
    const { rows, cols } = graph;
    const R = rows + 1, C = cols + 1;
    const Z = 4;
    const zTurns = new Array(Z * Z).fill(0);
    const zTotal = new Array(Z * Z).fill(0);

    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const zi = Math.min(Z - 1, (r * Z / R) | 0) * Z +
                   Math.min(Z - 1, (c * Z / C) | 0);
        zTotal[zi]++;
    }

    for (const p of paths) {
        for (let i = 1; i < p.nodes.length - 1; i++) {
            const dr1 = p.nodes[i].r - p.nodes[i-1].r, dc1 = p.nodes[i].c - p.nodes[i-1].c;
            const dr2 = p.nodes[i+1].r - p.nodes[i].r, dc2 = p.nodes[i+1].c - p.nodes[i].c;
            if (dr1 !== dr2 || dc1 !== dc2) {
                const r = p.nodes[i].r, c = p.nodes[i].c;
                const zi = Math.min(Z - 1, (r * Z / R) | 0) * Z +
                           Math.min(Z - 1, (c * Z / C) | 0);
                zTurns[zi]++;
            }
        }
    }

    const densities = zTotal.map((t, i) => t > 0 ? zTurns[i] / t : 0);
    const mean = densities.reduce((a, b) => a + b, 0) / densities.length;
    return densities.reduce((s, d) => s + (d - mean) ** 2, 0) / densities.length;
}

// computeVisualEntropy
// Wrapper — runs all four metrics and returns them as a single object.
//   straightness    : avg nodes per straight run  (lower = more turns = better)
//   dirEntropy      : heading distribution entropy (higher = more balanced = better, max 2.0)
//   turnClustering  : fraction of turn-node neighbours that are also turns (higher = clusters)
//   densityVariance : variance of zone densities   (higher = more spatial rhythm = better)
function computeVisualEntropy(paths, graph) {
    return {
        straightness:    computeStraightnessIndex(paths),
        dirEntropy:      computeDirectionalEntropy(paths),
        turnClustering:  computeTurnClusteringCoefficient(paths, graph),
        densityVariance: computeSpatialDensityVariance(paths, graph),
    };
}
