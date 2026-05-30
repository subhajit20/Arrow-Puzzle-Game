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
//   3. Coverage floor ≥ 80% — warn if below threshold.
// -----------------------------------------------------------------------------
function validateBoardAsserts(paths, graph) {
    const { nodeOwner, rows, cols } = graph; const W = cols + 1;
    let errors = 0;

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

    // 3. Coverage floor — large boards (36x16) average ~78%; warn below 65% (genuinely degenerate).
    const totalNodes = (rows + 1) * (cols + 1);
    const usedNodes  = paths.reduce((s, p) => s + p.nodes.length, 0);
    const coverage   = usedNodes / totalNodes;
    if (coverage < 0.65) {
        console.warn(`[Assert] coverage ${Math.round(coverage * 100)}% is below the 65% floor`);
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
    if (level <=  5) return [{ rows:  4, cols:  3 }];
    if (level <= 15) return [{ rows:  8, cols:  6 }];
    if (level <= 30) return [{ rows: 12, cols:  9 }];
    if (level <= 50) return [{ rows: 16, cols: 12 }];
    if (level <= 75) return [{ rows: 20, cols: 15 }];
    return                  [{ rows: 24, cols: 18 }];
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
    const size  = sizes[Math.floor(Math.random() * sizes.length)];
    State.rootRows  = size.rows;
    State.rootCols  = size.cols;
    State.gridRows  = size.rows * State.subdivFactor;
    State.gridCols  = size.cols * State.subdivFactor;
    State.gridSize  = size.rows;
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

    const rows  = State.gridRows;
    const cols  = State.gridCols;
    const level = State.level;

    const targetTier = selectTargetDifficulty(level, State.recentDifficulties || []);

    // ── Reverse-construction loop (solvability guaranteed by construction) ──
    // Each attempt builds a fresh board via rcConstructForTier and keeps the best
    // by: (1) tier match, (2) aesthetic score, (3) coverage.
    // BATCH and MAX_ROUNDS scale down for large boards — a single construction at
    // 24×18 takes ~200-400ms, so cap total attempts to stay under ~1s.
    const totalNodes = (rows + 1) * (cols + 1);
    const BATCH      = totalNodes > 1000 ? 2 : 4;  // inner tier-bracket attempts
    const MAX_ROUNDS = totalNodes > 1000 ? 3 : 5;  // outer retry rounds

    let validResult = null;
    let chosenTier  = 'NORMAL';
    let bestAesthetic = -1;
    const candidatesByTier = {};

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const graph = buildEdgeGraph(rows, cols);
        const { paths, cx } = rcConstructForTier(graph, targetTier, BATCH);

        // Post-build solvability assert (should always pass; logs if not).
        if (!isBoardFullySolvable(paths, graph)) {
            console.warn('[Board] RC post-build solvability assert FAILED — skipping this board');
            continue;
        }

        const tier   = cx.tier;
        const aScore = computeAestheticScore(paths, graph);

        // Derive hEdge/vEdge from final node sequences (same as forward pipeline).
        for (const p of paths) {
            for (let i = 0; i < p.nodes.length - 1; i++) {
                const a = p.nodes[i], b = p.nodes[i + 1];
                reserveEdge(graph, a.r, a.c, b.r, b.c, p.id);
            }
            p.originalNodes = p.nodes.slice();
        }

        if (!candidatesByTier[tier] || aScore > candidatesByTier[tier].aScore) {
            candidatesByTier[tier] = { paths, graph, aScore };
        }

        if (tier === targetTier && aScore > bestAesthetic) {
            bestAesthetic = aScore;
            validResult   = { paths, graph };
            chosenTier    = tier;
        }

        // Accept immediately once we have a good-enough tier+aesthetic match.
        if (tier === targetTier && aScore >= 0.40) break;
    }

    // Fall back to any board of an allowed tier.
    if (!validResult) {
        const allowedAtLevel = getAllowedTiersForLevel(level);
        const fallbackOrder  = [targetTier, ...allowedAtLevel.filter(t => t !== targetTier)];
        for (const t of fallbackOrder) {
            if (candidatesByTier[t]) {
                validResult = { paths: candidatesByTier[t].paths, graph: candidatesByTier[t].graph };
                chosenTier  = t;
                break;
            }
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
    const _tierOrder    = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'TITAN'];
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

    validateBoardAsserts(State.paths, validResult.graph);

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





// ---------------------------------------------------------------------------
// computeAestheticScore
// Scores a board on three aesthetic dimensions and returns a composite 0–1.
//
//   1. lengthVarScore  — stddev of path node counts normalised by mean.
//                        Low variance = all paths same size = bad.
//   2. turnDistScore   — evenness of turn counts across 4 grid quadrants.
//                        Clustered turns = bad.
//   3. balanceScore    — evenness of path centroids across 4 grid quadrants.
//                        Bunched paths = bad.
//
// Threshold 0.45 targets ~30–40% pass rate (aggressive but not exhausting).
// ---------------------------------------------------------------------------
function computeAestheticScore(paths, graph) {
    if (!paths || paths.length < 3) return 0;
    const rows = graph.rows, cols = graph.cols;

    // 1. Length variance
    const lengths = paths.map(p => p.nodes.length);
    const meanLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const stddev  = Math.sqrt(
        lengths.reduce((s, l) => s + (l - meanLen) ** 2, 0) / lengths.length
    );
    const lengthVarScore = Math.min(1.0, stddev / Math.max(1, meanLen * 0.5));

    // 2. Turn distribution  3. Visual balance — both use quadrant analysis
    const midR = rows / 2, midC = cols / 2;
    const turnsByQuad = [0, 0, 0, 0];
    const pathsByQuad = [0, 0, 0, 0];

    for (const p of paths) {
        const nodes = p.nodes;
        if (nodes.length < 2) continue;

        let turns = 0;
        for (let i = 1; i < nodes.length - 1; i++) {
            const dr1 = nodes[i].r - nodes[i-1].r, dc1 = nodes[i].c - nodes[i-1].c;
            const dr2 = nodes[i+1].r - nodes[i].r, dc2 = nodes[i+1].c - nodes[i].c;
            if (dr1 !== dr2 || dc1 !== dc2) turns++;
        }
        const centR = nodes.reduce((s, n) => s + n.r, 0) / nodes.length;
        const centC = nodes.reduce((s, n) => s + n.c, 0) / nodes.length;
        const qi    = (centR >= midR ? 2 : 0) + (centC >= midC ? 1 : 0);
        turnsByQuad[qi] += turns;
        pathsByQuad[qi]++;
    }

    // Evenness score: 1 = perfectly even across quadrants, 0 = all in one quadrant
    function evenness(counts) {
        const total = counts.reduce((a, b) => a + b, 0);
        if (total === 0) return 0.5;
        const fracs = counts.map(c => c / total);
        const sd = Math.sqrt(fracs.reduce((s, f) => s + (f - 0.25) ** 2, 0) / 4);
        return Math.max(0, 1 - sd / 0.25);
    }

    const turnDistScore = evenness(turnsByQuad);
    const balanceScore  = evenness(pathsByQuad);

    return lengthVarScore * 0.50 + turnDistScore * 0.25 + balanceScore * 0.25;
}

// ---------------------------------------------------------------------------
// getAllowedTiersForLevel
// Returns the tiers that have non-zero probability at a given level.
// Used by the fallback selector to avoid promoting forbidden tiers.
// ---------------------------------------------------------------------------
function getAllowedTiersForLevel(level) {
    if (level === 100)  return ['TITAN'];
    if (level <= 10)    return ['EASY', 'NORMAL'];
    if (level <= 20)    return ['EASY', 'NORMAL', 'HARD'];
    if (level <= 45)    return ['NORMAL', 'HARD'];
    if (level <= 70)    return ['NORMAL', 'HARD', 'EXPERT'];
    if (level <= 99)    return ['NORMAL', 'HARD', 'EXPERT'];
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
        probs.TITAN  = 0.0;
        if (allowed.has('HARD')) probs.HARD = Math.min(probs.HARD, 0.3);
        const relief = allowed.has('EASY') ? 'EASY' : 'NORMAL';
        if (allowed.has(relief))    probs[relief]    = Math.max(probs[relief],    0.5);
        if (allowed.has('NORMAL'))  probs['NORMAL']  = Math.max(probs['NORMAL'],  0.4);
    }

    const roll = Math.random();
    let sum = 0;
    for (const tier in probs) {
        sum += probs[tier];
        if (roll <= sum) return tier;
    }
    return [...allowed][0] || 'NORMAL';
}
