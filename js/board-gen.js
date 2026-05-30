// -----------------------------------------------------------------------------
// getSizesForLevel
// Returns the pool of {rows, cols} sizes valid for the given level.
// Notation: cols×rows (width × height) — all portrait/vertical boards.
// -----------------------------------------------------------------------------
function getSizesForLevel(level) {
    // Levels 1–5: fixed tutorial grids — one specific size per level
    if (level === 1) return [{ rows:  1, cols:  2 }];  // 2×1  →  8 subcells
    if (level === 2) return [{ rows:  2, cols:  3 }];  // 3×2  → 24 subcells
    if (level === 3) return [{ rows:  3, cols:  4 }];  // 4×3  → 48 subcells
    if (level === 4) return [{ rows:  4, cols:  4 }];  // 4×4  → 64 subcells
    if (level === 5) return [{ rows:  4, cols:  6 }];  // 6×4  → 96 subcells

    if (level <= 10) return [
        { rows:  8, cols:  6 },   // 6×8
        { rows: 10, cols:  8 },   // 8×10
        { rows: 12, cols:  8 },   // 8×12
        { rows: 12, cols: 10 },   // 10×12
    ];
    if (level <= 20) return [
        { rows: 12, cols: 10 },   // 10×12
        { rows: 14, cols: 10 },   // 10×14
        { rows: 14, cols: 12 },   // 12×14
        { rows: 16, cols: 12 },   // 12×16
    ];
    if (level <= 45) return [
        { rows: 18, cols: 12 },   // 12×18
        { rows: 20, cols: 14 },   // 14×20
        { rows: 22, cols: 16 },   // 16×22
        { rows: 24, cols: 18 },   // 18×24
    ];
    if (level <= 70) return [
        { rows: 24, cols: 18 },   // 18×24
        { rows: 26, cols: 18 },   // 18×26
        { rows: 26, cols: 20 },   // 20×26
        { rows: 28, cols: 20 },   // 20×28
    ];
    if (level <= 99) return [
        { rows: 28, cols: 20 },   // 20×28
        { rows: 28, cols: 22 },   // 22×28
        { rows: 30, cols: 22 },   // 22×30
        { rows: 30, cols: 24 },   // 24×30
    ];
    if (level === 100) return [
        { rows: 32, cols: 24 },   // 24×32 — boss level
    ];
    return [
        { rows: 30, cols: 22 },   // 22×30
        { rows: 30, cols: 24 },   // 24×30
        { rows: 32, cols: 24 },   // 24×32
    ];
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

    const sizes   = getSizesForLevel(State.level);
    const size    = sizes[Math.floor(Math.random() * sizes.length)];
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

    const targetTier       = selectTargetDifficulty(level, State.recentDifficulties || []);
    const candidatesByTier = {};
    let validResult = null;
    let chosenTier  = 'NORMAL';

    // Aesthetic filter: track the best-scoring board for the target tier so we
    // can fall back to it if no board clears the threshold within 20 attempts.
    const AESTHETIC_THRESHOLD = 0.45;
    let bestAestheticScore  = -1;
    let bestAestheticResult = null;

    // Target length is in root-cell units; multiply by subdivFactor for micro-node count.
    // Floor of 20×subdivFactor guarantees trails can be long enough for LONG-tier paths
    // (10–16 root cells) without capping them at the MEDIUM default.
    const maxTrailLen = Math.max(
        20 * State.subdivFactor,
        getTargetLength(level, State.rootRows, State.rootCols) * State.subdivFactor * 2
    );

    for (let attempt = 0; attempt < 20; attempt++) {
        const graph = buildEdgeGraph(rows, cols);
        const { trails } = generateTrails(graph, maxTrailLen, State.subdivFactor);
        const paths = fragmentAllTrails(trails, level, graph);
        assignHeadings(paths, graph);
        // DAG heading optimization creates dependency chains → raises complexity score.
        // Skip it when targeting EASY/NORMAL so small boards don't score HARD artificially.
        if (targetTier !== 'EASY' && targetTier !== 'NORMAL') {
            buildDAGHeadings(paths, graph);
        }
        runUnjammingPass(paths, graph);

        if (!isBoardFullySolvable(paths, graph)) continue;

        const cx     = evaluateBoardComplexity(paths, graph);
        const tier   = getDifficultyTier(cx.score);
        const aScore = computeAestheticScore(paths, graph);

        if (!candidatesByTier[tier]) candidatesByTier[tier] = { paths, graph };

        if (tier === targetTier) {
            // Always track the aesthetically best board for this tier
            if (aScore > bestAestheticScore) {
                bestAestheticScore  = aScore;
                bestAestheticResult = { paths, graph };
            }
            // Accept immediately if aesthetic threshold is met
            if (aScore >= AESTHETIC_THRESHOLD) {
                validResult = { paths, graph };
                chosenTier  = tier;
                break;
            }
        }
    }

    // If no board hit the threshold, accept the best aesthetic result we found
    if (!validResult && bestAestheticResult) {
        validResult = bestAestheticResult;
        chosenTier  = targetTier;
    }

    if (!validResult) {
        // Only pick from tiers allowed at this level — never promote a forbidden difficulty
        const allowedAtLevel = getAllowedTiersForLevel(level);
        const fallbackOrder  = [targetTier, ...allowedAtLevel.filter(t => t !== targetTier)];
        for (const t of fallbackOrder) {
            if (candidatesByTier[t]) {
                validResult = candidatesByTier[t];
                chosenTier  = t;
                break;
            }
        }
    }

    // Hard fallback: level-appropriate grid guaranteed to converge
    if (!validResult) {
        // For tutorial levels use a slightly larger version of the intended size.
        // For all other levels use 10×12 which reliably converges.
        let FB_ROOT_R, FB_ROOT_C;
        if      (level === 1) { FB_ROOT_R = 2; FB_ROOT_C = 3; }
        else if (level === 2) { FB_ROOT_R = 3; FB_ROOT_C = 4; }
        else if (level <= 5)  { FB_ROOT_R = 4; FB_ROOT_C = 6; }
        else                  { FB_ROOT_R = 10; FB_ROOT_C = 12; }

        const FB_R = FB_ROOT_R * State.subdivFactor;
        const FB_C = FB_ROOT_C * State.subdivFactor;
        State.rootRows = FB_ROOT_R; State.rootCols = FB_ROOT_C;
        State.gridRows = FB_R; State.gridCols = FB_C; State.gridSize = FB_ROOT_R;
        resetCamera(); resizeCanvas();
        const fbMaxTrailLen = Math.max(
            20 * State.subdivFactor,
            getTargetLength(level, FB_ROOT_R, FB_ROOT_C) * State.subdivFactor * 2
        );

        for (let attempt = 0; attempt < 10; attempt++) {
            const graph = buildEdgeGraph(FB_R, FB_C);
            const { trails: fbTrails } = generateTrails(graph, fbMaxTrailLen, State.subdivFactor);
            const paths = fragmentAllTrails(fbTrails, level, graph);
            assignHeadings(paths, graph);
            if (level > 5) buildDAGHeadings(paths, graph);
            runUnjammingPass(paths, graph);
            if (!isBoardFullySolvable(paths, graph)) continue;
            const cx = evaluateBoardComplexity(paths, graph);
            validResult = { paths, graph };
            chosenTier  = getDifficultyTier(cx.score);
            break;
        }
    }

    if (validResult) {
        State.paths = validResult.paths;
        State.hEdge = validResult.graph.hEdge;
        State.vEdge = validResult.graph.vEdge;
        State.boardDifficulty = chosenTier;

        // Safety cap: badge must never show a tier forbidden at this level
        const _tierOrder   = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'TITAN'];
        const _allowedTiers = getAllowedTiersForLevel(level);
        if (!_allowedTiers.includes(State.boardDifficulty)) {
            State.boardDifficulty = [..._allowedTiers]
                .sort((a, b) => _tierOrder.indexOf(b) - _tierOrder.indexOf(a))[0] || 'NORMAL';
        }

        console.log(`[Board] L${State.level} → difficulty: ${State.boardDifficulty} | paths: ${State.paths.length}`);

        // Build nodeOwner from final paths for runtime collision detection
        const _W = validResult.graph.cols + 1;
        State.nodeOwner = new Int32Array((validResult.graph.rows + 1) * _W).fill(-1);
        for (const p of State.paths)
            for (const { r, c } of p.nodes)
                State.nodeOwner[r * _W + c] = p.id;
    } else {
        return false;
    }

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
