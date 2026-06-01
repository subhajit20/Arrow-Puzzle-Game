// -----------------------------------------------------------------------------
// validateBoardAsserts
// Post-build defensive checks. Logs errors but never throws — the board was
// already committed. Should never fire for boards built by the RC constructor.
//
// Invariants checked:
//   1. Orthogonal-only steps — consecutive nodes must differ by exactly 1 in r
//      or c, never diagonally.
//   2. Single-owner — every node in nodeOwner must be owned by exactly the path
//      whose node list contains it (no double-ownership, consistent encoding).
//   3. Coverage floor ≥ 95% — warn if below threshold.
//   4. Rule 8 — every path must have at least 3 nodes (2 segments).
// -----------------------------------------------------------------------------
// hasAtLeastOneTurn(p) — returns true if the path has ≥1 direction change.
// A path with zero turns is a pure straight line with no shape identity (SP-1).
function hasAtLeastOneTurn(p) {
    for (let i = 1; i < p.nodes.length - 1; i++) {
        const dr1 = p.nodes[i].r - p.nodes[i-1].r, dc1 = p.nodes[i].c - p.nodes[i-1].c;
        const dr2 = p.nodes[i+1].r - p.nodes[i].r, dc2 = p.nodes[i+1].c - p.nodes[i].c;
        if (dr1 !== dr2 || dc1 !== dc2) return true;
    }
    return false;
}

function validateBoardAsserts(paths, graph) {
    const { nodeOwner, rows, cols } = graph; const W = cols + 1;
    let errors = 0;

    // 4. Rule 8 — minimum path length
    for (const p of paths) {
        if (p.nodes.length < 3) {
            console.error(`[Assert] Rule 8 violated: path ${p.id} has only ${p.nodes.length} node(s) — minimum is 3`);
            errors++;
        }
    }

    // SP-1 — minimum 1 turn per path (shape identity).
    // rcBuildChain backbone pieces are deliberately straight — excluded (heading RIGHT,
    // all nodes in same row, exactly 3 nodes). All other zero-turn paths are reported.
    for (const p of paths) {
        if (p.nodes.length >= 3 && !hasAtLeastOneTurn(p)) {
            const isBackbone = p.nodes.length === 3 && p.heading === 'RIGHT' &&
                               p.nodes[0].r === p.nodes[2].r;
            if (!isBackbone) {
                console.warn(`[Assert] SP-1: path ${p.id} has zero turns — straight line with no shape identity`);
            }
        }
    }

    // 1. Orthogonal-only steps
    for (const p of paths) {
        for (let i = 0; i < p.nodes.length - 1; i++) {
            const a = p.nodes[i], b = p.nodes[i + 1];
            const dr = Math.abs(b.r - a.r), dc = Math.abs(b.c - a.c);
            if (dr + dc !== 1) {
                console.error(`[Assert] path ${p.id} has diagonal step at node ${i}: (${a.r},${a.c})→(${b.r},${b.c})`);
                errors++;
            }
        }
    }

    // 2. Single-owner consistency (nodeOwner matches path node lists)
    const seen = new Map();
    for (const p of paths) {
        for (const { r, c } of p.nodes) {
            const key = r * W + c;
            if (seen.has(key)) {
                console.error(`[Assert] node (${r},${c}) owned by both path ${seen.get(key)} and path ${p.id}`);
                errors++;
            } else {
                seen.set(key, p.id);
                if (nodeOwner[key] !== p.id) {
                    console.error(`[Assert] nodeOwner[${r},${c}]=${nodeOwner[key]} but path ${p.id} claims it`);
                    errors++;
                }
            }
        }
    }

    // 3. Coverage floor — Phase D achieves ~96-100% on large boards, 90%+ on
    //    small boards (3-node minimum limits options). Warn below 90%.
    const totalNodes = (rows + 1) * (cols + 1);
    const usedNodes = paths.reduce((s, p) => s + p.nodes.length, 0);
    const coverage = usedNodes / totalNodes;
    if (coverage < 0.90) {
        console.warn(`[Assert] coverage ${Math.round(coverage * 100)}% is below the 90% floor`);
    }

    // 5. Rule 13 — exit-point uniqueness (informational only).
    //    Note: at large board sizes (24×18) the path count (~200) exceeds the
    //    available exit slots (172), so collisions are structurally unavoidable.
    //    Shared exits are safe when one path blocks the other — Rule 14 (solvability)
    //    already enforces the correct removal order. This check reports the rate.
    const exitSeen = new Set(); let exitCollisions = 0;
    for (const p of paths) {
        const key = rcExitKey(p, graph);
        if (exitSeen.has(key)) exitCollisions++;
        exitSeen.add(key);
    }
    if (exitCollisions > 0) {
        console.warn(`[Assert] Rule 13: ${exitCollisions} exit-slot collision(s) on this board (structural at large sizes — covered by Rule 14)`);
    }

    if (errors > 0) console.error(`[Assert] ${errors} invariant violation(s) on this board`);
}

// -----------------------------------------------------------------------------
// getSizesForLevel
// Returns the size for the given level — pure 4:3 staircase (Option A).
// Every board is exactly rows:cols = 4:3 (ratio 1.33), growing in 6 steps
// from 4×3 at L1 up to 24×18 at L76+.
//
//   L1–5   →  4× 3  (micro  8× 6,   ~55 dots)
//   L6–15  →  8× 6  (micro 16×12,  ~221 dots)
//   L16–30 → 12× 9  (micro 24×18,  ~475 dots)
//   L31–50 → 16×12  (micro 32×24,  ~825 dots)
//   L51–75 → 20×15  (micro 40×30, ~1271 dots)
//   L76+   → 24×18  (micro 48×36, ~1813 dots)
// -----------------------------------------------------------------------------
function getSizesForLevel(level) {
    if (level <= 5) return [{ rows: 4, cols: 3 }];
    if (level <= 15) return [{ rows: 8, cols: 6 }];
    if (level <= 30) return [{ rows: 12, cols: 9 }];
    if (level <= 50) return [{ rows: 16, cols: 12 }];
    if (level <= 75) return [{ rows: 20, cols: 15 }];
    return [{ rows: 24, cols: 18 }];
}

// =============================================================================
// Edge-based board generation pipeline (wired in Step 14)
// =============================================================================
function _build100PackedLevelEdge(forceNewGeneration) {
    if (!forceNewGeneration && Persistence.loadState()) {
        State.levelStartScore = State.score;
        resizeCanvas();
        updateDomUI();
        startPathRevealAnimation();
        return;
    }

    const sizes = getSizesForLevel(State.level);
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    State.rootRows = size.rows;
    State.rootCols = size.cols;
    State.gridRows = size.rows * State.subdivFactor;
    State.gridCols = size.cols * State.subdivFactor;
    State.gridSize = size.rows;
    State.shapeName = 'Lattice';

    resetCamera();
    resizeCanvas();

    const dots = (State.gridRows + 1) * (State.gridCols + 1);
    console.log(
        `[Board] L${State.level} | root ${State.rootRows}×${State.rootCols}` +
        ` → micro ${State.gridRows}×${State.gridCols}` +
        ` | dots: ${dots}` +
        ` | cellSize: ${State.cellSize.toFixed(1)}px` +
        ` | subCellSize: ${State.subCellSize.toFixed(1)}px`
    );

    const rows = State.gridRows;
    const cols = State.gridCols;
    const level = State.level;

    const targetTier = selectTargetDifficulty(level, State.recentDifficulties || []);

    // ── Reverse-construction loop (solvability guaranteed by construction) ──
    // Each attempt builds a fresh board via rcConstructForTier and keeps the best
    // by: (1) tier match, (2) aesthetic score, (3) coverage.
    // BATCH and MAX_ROUNDS scale down for large boards — a single construction at
    // 24×18 takes ~200-400ms, so cap total attempts to stay under ~1s.
    const totalNodes = (rows + 1) * (cols + 1);
    const BATCH = totalNodes > 1000 ? 2 : 4;  // inner tier-bracket attempts
    const MAX_ROUNDS = totalNodes > 1000 ? 3 : 5;  // outer retry rounds

    let validResult = null;
    let chosenTier = 'NORMAL';
    let bestAesthetic = -1;
    const candidatesByTier = {};

    for (let round = 0; round < MAX_ROUNDS; round++) {
        // VT-6: generate zone map once per round so VT-5 (corridor fragmentation) and
        // VT-6 (topological compression) operate on the same spatial layout used during RC.
        const zoneMap = generateZoneMap(rows, cols);
        const graph = buildEdgeGraph(rows, cols);
        const { paths, cx } = rcConstructForTier(graph, targetTier, BATCH, zoneMap);

        // Post-build solvability assert (should always pass; logs if not).
        if (!isBoardFullySolvable(paths, graph)) {
            console.warn('[Board] RC post-build solvability assert FAILED — skipping this board');
            continue;
        }

        // VT-5: Corridor Fragmentation — break long straight runs before hEdge/vEdge derivation.
        // Difficulty tier (cx) was already scored pre-fragmentation.
        const fragIter = totalNodes > 1000 ? 5 : 10;
        runCorridorFragmentation(paths, graph, fragIter);

        // VT-6: Topological Compression — compress underperforming DENSE zones.
        // Runs after corridor fragmentation; reuses the same zoneMap as RC generation.
        const compIter = totalNodes > 1000 ? 3 : 6;
        runTopologicalCompression(paths, graph, zoneMap, compIter);

        // VT-7: Pseudo-loop completion — route the missing side of proto-loops.
        // Only on large boards (≥ 20×15 root, ~1271+ nodes) where loops are meaningful.
        if (totalNodes > 1200) {
            const protos = protoPseudoLoops(paths, graph);
            for (const proto of protos.slice(0, 3)) completePseudoLoop(paths, graph, proto);
        }

        // Visual self-collision fix: flip any path whose arrowhead immediately faces
        // its own body. Players see the arrow pointing at the path's own segment and
        // assume it will crash — but own nodes are transparent in this game's physics.
        // This pass ensures the arrowhead always points toward open space.
        rcFixVisualSelfCollision(paths, graph);

        const tier = cx.tier;

        // Derive hEdge/vEdge from post-fix node sequences.
        for (const p of paths) {
            for (let i = 0; i < p.nodes.length - 1; i++) {
                const a = p.nodes[i], b = p.nodes[i + 1];
                reserveEdge(graph, a.r, a.c, b.r, b.c, p.id);
            }
            p.originalNodes = p.nodes.slice();
        }

        // Rulebook validation gate — hard rules must pass before this board
        // is accepted as a candidate. Soft rules (12, 13) log but do not reject.
        if (!validateRulebook(paths, graph)) {
            console.warn('[Board] Rulebook validation FAILED — skipping this board');
            continue;
        }

        // VT-9: full multi-dimensional visual filter (replaces old computeAestheticScore).
        // Boards that fail are kept in candidatesByTier as fallback but cannot become
        // validResult for the player.  vScore ranks candidates that pass the filter.
        const vf = boardPassesVisualFilter(paths, graph, tier);
        const vScore = vf.pass ? computeVisualScore(vf.ve) : 0;

        // Always store rulebook-valid boards for fallback; tag visual-filter result.
        if (!candidatesByTier[tier] || vScore > (candidatesByTier[tier].vScore || 0)) {
            candidatesByTier[tier] = { paths, graph, vScore, passesVisual: vf.pass };
        }

        // Only set validResult when the board passes the visual filter.
        if (vf.pass && tier === targetTier && vScore > bestAesthetic) {
            bestAesthetic = vScore;
            validResult = { paths, graph };
            chosenTier = tier;
        }

        // Accept immediately once the first visual-filter-passing board matches the tier.
        if (vf.pass && tier === targetTier) break;
    }

    // Fall back to any board of an allowed tier.
    if (!validResult) {
        const allowedAtLevel = getAllowedTiersForLevel(level);
        const fallbackOrder = [targetTier, ...allowedAtLevel.filter(t => t !== targetTier)];
        // Pass 1: prefer visual-filter-passing boards in any allowed tier.
        for (const t of fallbackOrder) {
            if (candidatesByTier[t] && candidatesByTier[t].passesVisual) {
                validResult = { paths: candidatesByTier[t].paths, graph: candidatesByTier[t].graph };
                chosenTier = t; break;
            }
        }
        // Pass 2: fall back to any rulebook-valid board (visual filter bypassed).
        if (!validResult) {
            for (const t of fallbackOrder) {
                if (candidatesByTier[t]) {
                    validResult = { paths: candidatesByTier[t].paths, graph: candidatesByTier[t].graph };
                    chosenTier = t; break;
                }
            }
        }
    }

    // Last resort: use any generated board regardless of tier (all rounds produced boards
    // that scored below the allowed range — extremely rare but prevents hard failure).
    if (!validResult) {
        const anyKey = Object.keys(candidatesByTier)[0];
        if (anyKey) {
            validResult = { paths: candidatesByTier[anyKey].paths, graph: candidatesByTier[anyKey].graph };
            chosenTier = anyKey;
        }
    }

    // ── Commit ──────────────────────────────────────────────────────────────
    if (!validResult) {
        console.error('[Board] RC failed to produce any board — this should not happen');
        return false;
    }

    State.paths = validResult.paths;
    State.hEdge = validResult.graph.hEdge;
    State.vEdge = validResult.graph.vEdge;
    State.boardDifficulty = chosenTier;

    // Safety cap: badge must never show a tier forbidden at this level.
    const _tierOrder = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'TITAN'];
    const _allowedTiers = getAllowedTiersForLevel(level);
    if (!_allowedTiers.includes(State.boardDifficulty)) {
        State.boardDifficulty = [..._allowedTiers]
            .sort((a, b) => _tierOrder.indexOf(b) - _tierOrder.indexOf(a))[0] || 'NORMAL';
    }

    // Build nodeOwner from final paths for runtime collision detection.
    const _W = validResult.graph.cols + 1;
    State.nodeOwner = new Int32Array((validResult.graph.rows + 1) * _W).fill(-1);
    for (const p of State.paths)
        for (const { r, c } of p.nodes)
            State.nodeOwner[r * _W + c] = p.id;

    const cov = Math.round(
        State.paths.reduce((s, p) => s + p.nodes.length, 0) /
        ((rows + 1) * (cols + 1)) * 100
    );
    console.log(`[Board] L${State.level} → ${State.boardDifficulty} | paths: ${State.paths.length} | coverage: ${cov}%`);

    validateRulebook(State.paths, validResult.graph);

    if (!State.recentDifficulties) State.recentDifficulties = [];
    State.recentDifficulties.push(State.boardDifficulty);
    if (State.recentDifficulties.length > 5) State.recentDifficulties.shift();

    State.levelStartScore = State.score;
    State.lives = 3;
    Persistence.saveState();
    updateDomUI();
    startPathRevealAnimation();
    return true;
}

function getTrackPoint(trackList, d) {
    if (d <= 0) return trackList[0];
    if (d >= trackList.length - 1) return trackList[trackList.length - 1];
    let idx = Math.floor(d);
    let frac = d - idx;
    let p1 = trackList[idx];
    let p2 = trackList[idx + 1];
    return {
        x: p1.x + (p2.x - p1.x) * frac,
        y: p1.y + (p2.y - p1.y) * frac
    };
}

function getSubTrackPoints(trackList, dStart, dEnd) {
    let pts = [];
    if (dStart < 0) dStart = 0;
    if (dEnd > trackList.length - 1) dEnd = trackList.length - 1;
    if (dStart >= dEnd) return pts;

    pts.push(getTrackPoint(trackList, dStart));

    let firstInt = Math.ceil(dStart);
    let lastInt = Math.floor(dEnd);
    for (let i = firstInt; i <= lastInt; i++) {
        pts.push(trackList[i]);
    }

    pts.push(getTrackPoint(trackList, dEnd));
    return pts;
}



function build100PackedLevel(forceNewGeneration = false) {
    return _build100PackedLevelEdge(forceNewGeneration);
}





// =============================================================================
// VT-9: Aesthetic Quality Filter (complete)
// Full multi-dimensional gate consolidating all VT-1 through VT-8 signals.
//
// VISUAL_FILTER_CONFIG — single source of truth for all thresholds.
//   sizeThresholds     : per micro-grid-node-count geometry/spatial floors
//   tierDifficulty     : per-tier solver difficulty min/max bounds
//   pseudoLoopMinScore : minimum loop score for large boards
//   pseudoLoopNodeThreshold : node count above which loop score is required
//
// boardPassesVisualFilter(paths, graph, tier) → { pass, failedMetric, ve }
//   pass         — true only when ALL gates are met
//   failedMetric — name of the first failing criterion, or null on pass
//   ve           — the full computeVisualEntropy result (for logging / harness)
//
// computeVisualScore(ve) → 0–1 composite ranking score (higher = better board).
//   Used to prefer among multiple filter-passing candidates.
//   Replaces the old computeAestheticScore scalar.
// =============================================================================

const VISUAL_FILTER_CONFIG = {
    // Size-based geometry/spatial floors (micro-grid node count ≤ N).
    // Recalibrated after SP-1 + SP-2. Both reduce DENSE/OPEN zone contrast:
    // SP-1 forces turns even in OPEN zones; SP-2 moderates OPEN knobs directly.
    // DensityVariance dropped ~40% vs pre-SP baseline. Thresholds set at ~1.2×
    // post-SP-2 averages for ~35-40% pass rate per size.
    sizeThresholds: [
        [100,      { densityVariance: 0.090, turnClustering: 0.36, dirEntropy: 1.88, straightnessMax: 5.0 }],
        [300,      { densityVariance: 0.028, turnClustering: 0.40, dirEntropy: 1.91, straightnessMax: 5.0 }],
        [600,      { densityVariance: 0.010, turnClustering: 0.40, dirEntropy: 1.94, straightnessMax: 5.0 }],
        [1000,     { densityVariance: 0.009, turnClustering: 0.39, dirEntropy: 1.96, straightnessMax: 5.5 }],
        [1400,     { densityVariance: 0.0050, turnClustering: 0.39, dirEntropy: 1.97, straightnessMax: 6.0 }],
        [Infinity, { densityVariance: 0.0040, turnClustering: 0.38, dirEntropy: 1.97, straightnessMax: 6.5 }],
    ],
    // Tier-specific solver difficulty bounds (VT-8 signal).
    //   min: floor for challenging tiers — ensures cognitive complexity
    //   max: cap for easy tiers — ensures accessibility for new players
    // null = no constraint in that direction.
    tierDifficulty: {
        EASY: { min: null, max: 3.0 },
        NORMAL: { min: 3.0, max: null },
        HARD:   { min: null, max: null },
        EXPERT: { min: null, max: null },
        TITAN: { min: null, max: null },
    },
    // Large boards (VT-7): must contain ≥1 recognisable loop shape.
    pseudoLoopMinScore: 0.5,
    pseudoLoopNodeThreshold: 1200,
};

// computeVisualScore(ve) — 0–1 composite visual quality score for board ranking.
// Higher = more spatially interesting board. Used to prefer the best candidate
// among multiple visual-filter-passing boards.
function computeVisualScore(ve) {
    if (!ve) return 0;
    const d = Math.min(1, (ve.densityVariance || 0) / 0.12);
    const l = Math.min(1, (ve.pseudoLoopScore || 0) / 30);
    const s = Math.min(1, (ve.solverDifficulty || 0) / 6);
    const t = Math.min(1, (ve.turnClustering || 0) / 0.5);
    const e = Math.min(1, (ve.dirEntropy || 0) / 2.0);
    return d * 0.30 + l * 0.25 + s * 0.20 + t * 0.15 + e * 0.10;
}

function boardPassesVisualFilter(paths, graph, tier) {
    const ve = computeVisualEntropy(paths, graph);
    const n = (graph.rows + 1) * (graph.cols + 1);

    // Size-based gates
    let sz = VISUAL_FILTER_CONFIG.sizeThresholds[VISUAL_FILTER_CONFIG.sizeThresholds.length - 1][1];
    for (const [max, t] of VISUAL_FILTER_CONFIG.sizeThresholds) { if (n <= max) { sz = t; break; } }

    if (ve.densityVariance < sz.densityVariance)
        return { pass: false, failedMetric: 'densityVariance', ve };
    if (ve.turnClustering < sz.turnClustering)
        return { pass: false, failedMetric: 'turnClustering', ve };
    if (ve.dirEntropy < sz.dirEntropy)
        return { pass: false, failedMetric: 'dirEntropy', ve };
    if (ve.straightness > sz.straightnessMax)
        return { pass: false, failedMetric: 'straightness', ve };

    // Pseudo-loop gate (VT-7): large boards must have ≥1 loop structure.
    if (n > VISUAL_FILTER_CONFIG.pseudoLoopNodeThreshold &&
        ve.pseudoLoopScore < VISUAL_FILTER_CONFIG.pseudoLoopMinScore)
        return { pass: false, failedMetric: 'pseudoLoopScore', ve };

    // Tier-specific solver difficulty gate (VT-9).
    const td = tier && VISUAL_FILTER_CONFIG.tierDifficulty[tier];
    if (td) {
        if (td.min !== null && ve.solverDifficulty < td.min)
            return { pass: false, failedMetric: 'solverDifficulty_min', ve };
        if (td.max !== null && ve.solverDifficulty > td.max)
            return { pass: false, failedMetric: 'solverDifficulty_max', ve };
    }

    return { pass: true, failedMetric: null, ve };
}

// computeAestheticScore — REMOVED in VT-9.
// Replaced by computeVisualScore(ve) which derives the board ranking signal
// from the full VE metrics (densityVariance, pseudoLoopScore, solverDifficulty,
// turnClustering, dirEntropy) already computed inside boardPassesVisualFilter.
// The function is kept as a no-op stub to avoid breaking any external callers.

// ---------------------------------------------------------------------------
// getAllowedTiersForLevel
// Returns the tiers that have non-zero probability at a given level.
// Used by the fallback selector to avoid promoting forbidden tiers.
// ---------------------------------------------------------------------------
function getAllowedTiersForLevel(level) {
    if (level === 100) return ['TITAN'];
    if (level <= 10) return ['EASY', 'NORMAL'];
    if (level <= 20) return ['EASY', 'NORMAL', 'HARD'];
    if (level <= 45) return ['NORMAL', 'HARD'];
    if (level <= 70) return ['NORMAL', 'HARD', 'EXPERT'];
    if (level <= 99) return ['NORMAL', 'HARD', 'EXPERT'];
    return ['NORMAL', 'HARD', 'EXPERT', 'TITAN'];
}

// selectTargetDifficulty
//
// Resolve weighted probabilities based on level ranges, overriding targets
// using history pacing rules (prevent streaks, inject Easy/Normal relief).
// ---------------------------------------------------------------------------
function selectTargetDifficulty(level, history) {
    // Level 100 is always a guaranteed Titan board
    if (level === 100) return 'TITAN';

    let probs;
    if (level <= 10) {
        probs = { EASY: 0.60, NORMAL: 0.40, HARD: 0.00, EXPERT: 0.00, TITAN: 0.00 };
    } else if (level <= 20) {
        probs = { EASY: 0.15, NORMAL: 0.75, HARD: 0.10, EXPERT: 0.00, TITAN: 0.00 };
    } else if (level <= 45) {
        probs = { EASY: 0.00, NORMAL: 0.35, HARD: 0.65, EXPERT: 0.00, TITAN: 0.00 };
    } else if (level <= 70) {
        probs = { EASY: 0.00, NORMAL: 0.20, HARD: 0.60, EXPERT: 0.20, TITAN: 0.00 };
    } else if (level <= 99) {
        probs = { EASY: 0.00, NORMAL: 0.05, HARD: 0.50, EXPERT: 0.45, TITAN: 0.00 };
    } else {
        probs = { EASY: 0.00, NORMAL: 0.10, HARD: 0.40, EXPERT: 0.35, TITAN: 0.15 };
    }

    // Allowed tiers at this level — pacing rules must not promote a tier with 0% base weight
    const allowed = new Set(Object.keys(probs).filter(t => probs[t] > 0));

    const last1 = history[history.length - 1];
    const last2 = history[history.length - 2];

    // Two easy in a row → push to HARD if available, else NORMAL
    if (last1 === 'EASY' && last2 === 'EASY') {
        probs.EASY = 0.0;
        const boost = allowed.has('HARD') ? 'HARD' : 'NORMAL';
        if (allowed.has(boost)) probs[boost] = Math.min(1.0, probs[boost] + 0.5);
    }

    // Two hard+ in a row → relief: drop EXPERT/TITAN, boost softest available tier
    if ((last1 === 'HARD' || last1 === 'EXPERT' || last1 === 'TITAN') &&
        (last2 === 'HARD' || last2 === 'EXPERT' || last2 === 'TITAN')) {
        probs.EXPERT = 0.0;
        probs.TITAN = 0.0;
        if (allowed.has('HARD')) probs.HARD = Math.min(probs.HARD, 0.3);
        const relief = allowed.has('EASY') ? 'EASY' : 'NORMAL';
        if (allowed.has(relief)) probs[relief] = Math.max(probs[relief], 0.5);
        if (allowed.has('NORMAL')) probs['NORMAL'] = Math.max(probs['NORMAL'], 0.4);
    }

    const roll = Math.random();
    let sum = 0;
    for (const tier in probs) {
        sum += probs[tier];
        if (roll <= sum) return tier;
    }
    return [...allowed][0] || 'NORMAL';
}
