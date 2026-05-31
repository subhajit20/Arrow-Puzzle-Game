// =============================================================================
// edge-gen.js — Node-Hamiltonian puzzle generation engine
// =============================================================================
//
// Model: Each intersection node (r,c) in the (rows+1)×(cols+1) lattice is
// owned by exactly one path. Edges are derived from path node sequences —
// not all grid edges are used. Grid lines are background; path lines are the
// subset drawn on top.
//
// Steps implemented here:
//   1. Graph Construction  (buildEdgeGraph with nodeOwner)
//   2. Node-Warnsdorff     (walkWarnsdorff, generateTrails)
//   4. Fragmentation       (fragmentTrail, fragmentAllTrails)
//   RC. Reverse Construction (reverseConstruct + helpers — solvability by design)
// =============================================================================

// -----------------------------------------------------------------------------
// buildEdgeGraph
// Allocates hEdge, vEdge, degree, and nodeOwner for a ROWS×COLS cell grid.
//
// hEdge[r][c]              — horizontal edge between node(r,c) and node(r,c+1)
//                            dims: (ROWS+1) × COLS  |  -1=unused, ≥0=path id
// vEdge[r][c]              — vertical edge between node(r,c) and node(r+1,c)
//                            dims: ROWS × (COLS+1)  |  -1=unused, ≥0=path id
// nodeOwner[r*(cols+1)+c]  — owning path id for node(r,c)
//                            -1=free, ≥0=path id
// degree[r][c]             — edge count incident to node(r,c) (informational)
// -----------------------------------------------------------------------------
function buildEdgeGraph(rows, cols) {
    const hEdge = Array.from({ length: rows + 1 },
        () => new Int32Array(cols).fill(-1));

    const vEdge = Array.from({ length: rows },
        () => new Int32Array(cols + 1).fill(-1));

    const degree = Array.from({ length: rows + 1 }, (_, r) =>
        Array.from({ length: cols + 1 }, (_, c) => {
            let d = 0;
            if (c > 0)    d++;
            if (c < cols) d++;
            if (r > 0)    d++;
            if (r < rows) d++;
            return d;
        })
    );

    const nodeOwner = new Int32Array((rows + 1) * (cols + 1)).fill(-1);

    return { hEdge, vEdge, degree, nodeOwner, rows, cols };
}

// -----------------------------------------------------------------------------
// getFreeNeighborNodes
// Returns orthogonal neighbors of (r,c) that are within grid bounds AND
// unclaimed (nodeOwner === -1).
// -----------------------------------------------------------------------------
function getFreeNeighborNodes(graph, r, c) {
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;
    const nbrs = [];
    if (r > 0    && nodeOwner[(r - 1) * W + c    ] === -1) nbrs.push({ r: r - 1, c     });
    if (r < rows && nodeOwner[(r + 1) * W + c    ] === -1) nbrs.push({ r: r + 1, c     });
    if (c > 0    && nodeOwner[ r      * W + (c-1)] === -1) nbrs.push({ r,         c: c-1 });
    if (c < cols && nodeOwner[ r      * W + (c+1)] === -1) nbrs.push({ r,         c: c+1 });
    return nbrs;
}

// -----------------------------------------------------------------------------
// reserveEdge
// Marks the edge between two orthogonally adjacent nodes as owned by pathId.
// Used after trail generation to derive hEdge/vEdge from path node sequences.
// -----------------------------------------------------------------------------
function reserveEdge(graph, r1, c1, r2, c2, pathId) {
    if (r1 === r2) graph.hEdge[r1][Math.min(c1, c2)] = pathId;
    else           graph.vEdge[Math.min(r1, r2)][c1] = pathId;
}

// -----------------------------------------------------------------------------
// countFreeNodes
// Returns how many nodes have nodeOwner === -1.  Should be 0 after generation.
// -----------------------------------------------------------------------------
function countFreeNodes(graph) {
    let n = 0;
    const { nodeOwner } = graph;
    for (let i = 0; i < nodeOwner.length; i++)
        if (nodeOwner[i] === -1) n++;
    return n;
}

// =============================================================================
// Step 2: Node-Warnsdorff Trail Generation
// =============================================================================

// -----------------------------------------------------------------------------
// findConstrainedStart
// Picks the unclaimed node that is most "hemmed in" — surrounded by the most
// boundary edges and already-claimed neighbours. Starting trails here prevents
// isolated pockets from forming later and naturally scatters trail origins
// across the board, breaking the corner-spiral dominance.
// -----------------------------------------------------------------------------
function findConstrainedStart(graph) {
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;
    let bestNode = null, bestScore = -1;

    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
            if (nodeOwner[r * W + c] !== -1) continue;

            // Count constraints: board edges + claimed neighbours
            let score = 0;
            if (r === 0 || r === rows) score++;
            if (c === 0 || c === cols) score++;
            if (r > 0    && nodeOwner[(r-1)*W+c  ] !== -1) score++;
            if (r < rows && nodeOwner[(r+1)*W+c  ] !== -1) score++;
            if (c > 0    && nodeOwner[r*W+(c-1)  ] !== -1) score++;
            if (c < cols && nodeOwner[r*W+(c+1)  ] !== -1) score++;
            // Large jitter so interior nodes can be chosen as origins too,
            // scattering trail starts across the board not just at corners.
            score += Math.random() * 1.5;

            if (score > bestScore) { bestScore = score; bestNode = { r, c }; }
        }
    }
    return bestNode; // null when all nodes claimed
}

// =============================================================================
// Phase-Aware Traversal System (OA-3)
//
// Replaces the single fixed maxStraight/turnBonus per trail with a phase
// schedule that changes traversal character over the trail's lifetime.
// =============================================================================

// Phase definitions — base parameters for each traversal character type.
// maxStraightBase/Var: f-scaled; turnBonus: bias magnitude (positive = prefers turns).
const PHASE_DEFS = {
    SWEEP:    { maxStraightBase: 8, maxStraightVar: 2, turnBonus: 0.30 },
    COIL:     { maxStraightBase: 1, maxStraightVar: 1, turnBonus: 2.00 },
    FLOW:     { maxStraightBase: 99,maxStraightVar: 0, turnBonus: 0.10 },
    COMPRESS: { maxStraightBase: 4, maxStraightVar: 1, turnBonus: 1.00 },
};

// Rhythm profiles — ordered phase sequences defining each trail's traversal arc.
const RHYTHM_PROFILES = {
    'flow':            ['FLOW'],
    'staccato':        ['COMPRESS'],
    'sweep-hook':      ['SWEEP', 'COIL'],
    'breath':          ['FLOW', 'COIL', 'FLOW'],
    'coil':            ['COIL', 'COIL'],
    'arm-cluster-arm': ['SWEEP', 'COIL', 'SWEEP'],
};

// Instantiate one phase with sampled parameters (f = subdivFactor).
function samplePhase(phaseName, f) {
    const def = PHASE_DEFS[phaseName];
    const ms  = phaseName === 'FLOW' ? 99
        : Math.round((def.maxStraightBase + Math.random() * def.maxStraightVar) * f);
    return { maxStraight: ms, turnBonus: def.turnBonus, nodeCount: 0 };
}

// Build a concrete phase schedule for one trail:
//   profileName → phase list → instantiate each → distribute maxLen proportionally
//   with ±20% jitter at each boundary so phase lengths aren't perfectly uniform.
function buildPhaseSchedule(profileName, maxLen, f) {
    const phaseNames = RHYTHM_PROFILES[profileName] || ['COMPRESS'];
    const n      = phaseNames.length;
    const phases = phaseNames.map(name => samplePhase(name, f));

    let remaining = maxLen || 9999;
    for (let i = 0; i < n - 1; i++) {
        const base   = Math.max(3 * f, Math.floor(remaining / (n - i)));
        const jitter = Math.floor(base * 0.20);
        const count  = Math.max(3 * f, base + Math.floor(Math.random() * jitter * 2) - jitter);
        phases[i].nodeCount = count;
        remaining -= count;
    }
    phases[n - 1].nodeCount = Math.max(3 * f, remaining);
    return phases;
}

// Pick a rhythm profile for one trail — flat distribution ensuring board variety.
function pickRhythmProfile() {
    const r = Math.random();
    if (r < 0.12) return 'flow';
    if (r < 0.28) return 'staccato';
    if (r < 0.50) return 'sweep-hook';
    if (r < 0.68) return 'breath';
    if (r < 0.83) return 'arm-cluster-arm';
    return 'coil';
}

// -----------------------------------------------------------------------------
// buildDiversityQueues
// Pre-plans personality assignments for all trails on a board so the
// distribution is guaranteed by design rather than left to chance.
//
//   axisQueue    — 40% H / 40% V / 20% neutral  (shuffled)
//   handQueue    — 45% CW / 45% CCW / 10% neutral (shuffled)
//   profileQueue — equal share of each rhythm profile, capped at 40% each
//
// estimatedCount is a generous upper bound on trail count. Queues fall back to
// random assignment via buildTrailPersonality() when exhausted.
// -----------------------------------------------------------------------------
function buildDiversityQueues(estimatedCount) {
    const n = Math.max(6, estimatedCount);

    // Axis queue: 40/40/20
    const nH = Math.round(n * 0.40), nV = Math.round(n * 0.40);
    const axisQueue = [];
    for (let i = 0; i < nH; i++) axisQueue.push('H');
    for (let i = 0; i < nV; i++) axisQueue.push('V');
    for (let i = 0; i < n - nH - nV; i++) axisQueue.push('neutral');

    // Handedness queue: 45/45/10
    const nCW = Math.round(n * 0.45), nCCW = Math.round(n * 0.45);
    const handQueue = [];
    for (let i = 0; i < nCW; i++) handQueue.push(1);
    for (let i = 0; i < nCCW; i++) handQueue.push(-1);
    for (let i = 0; i < n - nCW - nCCW; i++) handQueue.push(0);

    // Rhythm profile queue: equal slots per profile (no profile > 40%)
    const PROFILES = ['flow', 'staccato', 'sweep-hook', 'breath', 'arm-cluster-arm', 'coil'];
    const perProfile = Math.max(1, Math.ceil(n / PROFILES.length));
    const profileQueue = [];
    for (const p of PROFILES)
        for (let i = 0; i < perProfile; i++) profileQueue.push(p);

    // Fisher-Yates shuffle each queue
    for (const q of [axisQueue, handQueue, profileQueue]) {
        for (let i = q.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [q[i], q[j]] = [q[j], q[i]];
        }
    }

    return { axisQueue, handQueue, profileQueue };
}

// -----------------------------------------------------------------------------
// buildTrailPersonality
// Creates the per-trail identity + zero-initialised state object before routing.
// Consumes from diversity queues when provided (OA-8 board-level enforcement);
// falls back to per-trail random assignment when queues are exhausted or absent.
// -----------------------------------------------------------------------------
function buildTrailPersonality(maxTrailLen, f, queues) {
    const rhythmProfile = (queues && queues.profileQueue.length > 0)
        ? queues.profileQueue.shift()
        : pickRhythmProfile();
    const handedness = (queues && queues.handQueue.length > 0)
        ? queues.handQueue.shift()
        : (Math.random() < 0.45 ? 1 : Math.random() < 0.90 ? -1 : 0);
    const axisBias = (queues && queues.axisQueue.length > 0)
        ? queues.axisQueue.shift()
        : (Math.random() < 0.40 ? 'H' : Math.random() < 0.80 ? 'V' : 'neutral');

    return {
        // Identity — assigned once, never changed during walk
        axisBias,
        handedness,
        rhythmProfile,
        phaseSchedule: buildPhaseSchedule(rhythmProfile, maxTrailLen, f),
        // State — zero-initialised; documents what walkWarnsdorff tracks internally
        currentPhase:   0,
        straightStreak: 0,
        turnStreak:     0,
        momentum:       0,
    };
}

// -----------------------------------------------------------------------------
// walkWarnsdorff
// Phase-aware self-avoiding Warnsdorff walk from startNode.
//
// personality — trailPersonality object from buildTrailPersonality().
//   Identity fields read: phaseSchedule, handedness, axisBias.
//   State fields (currentPhase, straightStreak, turnStreak, momentum) are
//   tracked as local variables inside the walk — personality documents the
//   interface but internal state stays local for performance.
//
// Scoring (lower = preferred):
//   freeAfter      — Warnsdorff: visit most-constrained neighbour first
//   bias           — phase-driven turn/straight preference
//   momentumMod    — smooth sigmoid pressure from straightStreak/turnStreak
//   handBonus      — -0.6 for turns matching handedness preference
//   axisBiasBonus  — -0.4 for moves along preferred axis
//   jitter         — 0–0.8 for board variety
// -----------------------------------------------------------------------------
function walkWarnsdorff(graph, startNode, pathId, maxLen, personality) {
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;

    // Destructure identity fields from personality object
    const { phaseSchedule, handedness, axisBias } = personality || {};

    nodeOwner[startNode.r * W + startNode.c] = pathId;
    const nodes = [{ r: startNode.r, c: startNode.c }];
    let cur      = startNode;
    let prevDr   = 0, prevDc = 0;
    let straightStreak = 0;  // consecutive straight steps
    let turnStreak     = 0;  // consecutive turn steps

    const hand = handedness || 0;  // +1=CW, -1=CCW, 0=neutral

    // Phase tracking state
    let phaseIdx    = 0;
    let nodeInPhase = 0;
    const BLEND     = 2;  // nodes over which adjacent phases blend at boundary

    const cap = (maxLen != null) ? maxLen - 1 : (rows + 1) * (cols + 1);

    for (let step = 0; step < cap; step++) {
        const candidates = getFreeNeighborNodes(graph, cur.r, cur.c);
        if (candidates.length === 0) break;

        // Advance to next phase once this phase's node budget is spent
        while (phaseSchedule && phaseIdx < phaseSchedule.length - 1 &&
               nodeInPhase >= phaseSchedule[phaseIdx].nodeCount) {
            phaseIdx++;
            nodeInPhase = 0;
        }

        // Read current parameters, blending into the next phase near its boundary
        let curMaxStraight, curTurnBonus;
        if (phaseSchedule && phaseSchedule.length > 0) {
            const phase = phaseSchedule[phaseIdx];
            curMaxStraight = phase.maxStraight;
            curTurnBonus   = phase.turnBonus;

            if (phaseIdx + 1 < phaseSchedule.length) {
                const stepsLeft = phase.nodeCount - nodeInPhase;
                if (stepsLeft <= BLEND) {
                    const t    = 1 - stepsLeft / BLEND;
                    const next = phaseSchedule[phaseIdx + 1];
                    curMaxStraight = Math.round(
                        curMaxStraight + (next.maxStraight - curMaxStraight) * t
                    );
                    curTurnBonus = curTurnBonus + (next.turnBonus - curTurnBonus) * t;
                }
            }
        } else {
            curMaxStraight = 2;
            curTurnBonus   = 1.5;
        }

        const isStraightStyle = curMaxStraight >= 20;

        let best = null, bestScore = Infinity;
        for (const nb of candidates) {
            const freeAfter     = getFreeNeighborNodes(graph, nb.r, nb.c).length;
            const dr = nb.r - cur.r, dc = nb.c - cur.c;
            const goingStraight = (dr === prevDr && dc === prevDc);

            // Phase bias: FLOW/STRAIGHT style rewards straight; all others drive turns.
            const bias = isStraightStyle
                ? (goingStraight ? -curTurnBonus :  curTurnBonus)
                : (goingStraight ?  curTurnBonus : -curTurnBonus);

            // Momentum: smooth sigmoid turn pressure from straightStreak,
            // plus a pullback toward straight after 3+ consecutive turns.
            // Replaces the old binary +5.0 hard cutoff with a gradual curve.
            const ratio        = isStraightStyle ? 0
                : Math.min(1.0, straightStreak / Math.max(1, curMaxStraight));
            const turnPressure = ratio * ratio * 4.0;        // 0 → 4.0 quadratic rise
            const turnPullback = turnStreak >= 3 ? 1.5 : 0; // strong pull back to straight
            const momentumMod  = goingStraight
                ? (turnPressure - turnPullback)
                : (-turnPressure + turnPullback);

            // Handedness bonus: reward turns matching the trail's preferred rotation.
            // Cross product of current heading × candidate move:
            //   negative = clockwise, positive = counterclockwise, 0 = straight.
            const cross = prevDr * dc - prevDc * dr;
            const handBonus = (hand !== 0 && cross !== 0)
                ? (((hand === 1 && cross < 0) || (hand === -1 && cross > 0)) ? -0.6 : 0)
                : 0;

            // Axis bias: reward moves along the trail's preferred directional axis.
            // dc !== 0 = horizontal move; dr !== 0 = vertical move.
            const isHoriz      = dc !== 0;
            const axisBiasBonus =
                (axisBias === 'H' &&  isHoriz) ? -0.4 :
                (axisBias === 'V' && !isHoriz) ? -0.4 : 0;

            const score = freeAfter + bias + momentumMod + handBonus + axisBiasBonus + Math.random() * 0.8;
            if (score < bestScore) { bestScore = score; best = nb; }
        }

        const dr = best.r - cur.r, dc = best.c - cur.c;
        const wentStraight = (dr === prevDr && dc === prevDc);
        straightStreak = wentStraight ? straightStreak + 1 : 0;
        turnStreak     = wentStraight ? 0 : turnStreak + 1;
        prevDr = dr; prevDc = dc;
        nodeOwner[best.r * W + best.c] = pathId;
        nodes.push({ r: best.r, c: best.c });
        cur = best;
        nodeInPhase++;
    }

    return nodes;
}

// -----------------------------------------------------------------------------
// generateTrails
// Repeatedly picks the most-constrained unclaimed node (findConstrainedStart)
// and starts a capped Warnsdorff walk from it. Continues until every node is
// claimed. This produces many shorter trails from scattered starting positions
// rather than one corner-anchored spiral.
//
// maxTrailLen  — walk length cap per trail (e.g. 2 × target path length).
//   Smaller → more trails, more shape variety.
//   Pass null/undefined for uncapped (original behaviour).
//
// Single-node stubs are merged into adjacent trail endpoints where possible.
// After all walks, derives hEdge/vEdge from trail node sequences.
//
// Returns { trails, nextId }.
// -----------------------------------------------------------------------------
// subdivFactor scales maxStraight so turn frequency is the same in root-cell
// terms regardless of micro-grid resolution.  Default 1 = no subdivision.
function generateTrails(graph, maxTrailLen, subdivFactor) {
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;
    const trails = [];
    let nextId = 0;
    const f = subdivFactor || 1;

    // Pre-plan personality diversity for the whole board before any trail starts.
    // Upper-bound estimate: (rows+1)*(cols+1) total nodes / 4 min nodes per trail.
    const totalNodes      = (rows + 1) * (cols + 1);
    const estimatedTrails = Math.ceil(totalNodes / 4);
    const queues          = buildDiversityQueues(estimatedTrails);

    while (true) {
        const start = findConstrainedStart(graph);
        if (!start) break;

        // Build personality — consumes from pre-planned diversity queues.
        const personality = buildTrailPersonality(maxTrailLen, f, queues);

        const nodes = walkWarnsdorff(graph, start, nextId, maxTrailLen, personality);
        trails.push({ id: nextId, nodes, personality });
        nextId++;
    }

    // Merge single-node stubs into adjacent trail endpoints
    for (let i = trails.length - 1; i >= 0; i--) {
        if (trails[i].nodes.length !== 1) continue;
        const { r, c } = trails[i].nodes[0];

        const nbCoords = [
            { r: r - 1, c }, { r: r + 1, c },
            { r, c: c - 1 }, { r, c: c + 1 }
        ].filter(n => n.r >= 0 && n.r <= rows && n.c >= 0 && n.c <= cols);

        for (const nb of nbCoords) {
            const nbOwner = nodeOwner[nb.r * W + nb.c];
            if (nbOwner < 0) continue;
            const tgt = trails.find(t => t.id === nbOwner && t.nodes.length >= 1);
            if (!tgt) continue;

            const head = tgt.nodes[tgt.nodes.length - 1];
            const tail = tgt.nodes[0];
            if (head.r === nb.r && head.c === nb.c) {
                tgt.nodes.push({ r, c });
                nodeOwner[r * W + c] = nbOwner;
                trails.splice(i, 1);
                break;
            } else if (tail.r === nb.r && tail.c === nb.c) {
                tgt.nodes.unshift({ r, c });
                nodeOwner[r * W + c] = nbOwner;
                trails.splice(i, 1);
                break;
            }
        }
    }

    // Derive hEdge/vEdge from node sequences
    for (const trail of trails) {
        for (let i = 0; i < trail.nodes.length - 1; i++) {
            const a = trail.nodes[i], b = trail.nodes[i + 1];
            reserveEdge(graph, a.r, a.c, b.r, b.c, trail.id);
        }
    }

    return { trails, nextId };
}

// =============================================================================
// Step 4: Path Fragmentation
// =============================================================================

// -----------------------------------------------------------------------------
// countSegmentTurns
// Counts direction changes inside nodes[from .. from+len-1].
// -----------------------------------------------------------------------------
function countSegmentTurns(nodes, from, len) {
    let turns = 0;
    for (let i = 1; i < len - 1; i++) {
        const dr1 = nodes[from + i].r     - nodes[from + i - 1].r;
        const dc1 = nodes[from + i].c     - nodes[from + i - 1].c;
        const dr2 = nodes[from + i + 1].r - nodes[from + i].r;
        const dc2 = nodes[from + i + 1].c - nodes[from + i].c;
        if (dr1 !== dr2 || dc1 !== dc2) turns++;
    }
    return turns;
}

// -----------------------------------------------------------------------------
// getTargetLength
// Level- and grid-size-aware target path length in nodes.
// Higher levels → shorter paths → more paths → denser, harder board.
//
// rows/cols are ROOT-CELL dimensions (from getSizesForLevel), NOT micro-grid.
// The caller multiplies the return value by subdivFactor to get the micro-node
// target count.
// -----------------------------------------------------------------------------
function getTargetLength(level, rows, cols) {
    const maxDim = Math.max(rows, cols);
    let base;
    // Reduced targets for large grids so paths stay visually compact
    if      (maxDim >= 25) base = 6;
    else if (maxDim >= 19) base = 6;
    else if (maxDim >= 15) base = 6;
    else if (maxDim >= 13) base = 5;
    else                   base = 5;

    if (level > 25) return Math.max(3, Math.floor(base * 0.75));
    if (level > 10) return Math.max(3, Math.floor(base * 0.88));
    return base;
}

// -----------------------------------------------------------------------------
// buildTierQueue
// Pre-plans a shuffled list of target lengths for all fragments on this board.
//
// Three tiers:
//   SHORT  — 3–5 root cells  → fills gaps, connectors
//   MEDIUM — 5–9 root cells  → primary expressive unit (current default)
//   LONG   — 10–16 root cells → anchor paths, visual hierarchy
//
// Distribution by level:
//   L1–5 : 50% SHORT, 50% MEDIUM, 0% LONG  (tiny boards can't support LONG)
//   L6–15: 30% SHORT, 55% MEDIUM, 15% LONG
//   L16+ : 25% SHORT, 50% MEDIUM, 25% LONG
//
// Returns a flat shuffled array of integer target lengths (in subcells).
// fragmentTrail consumes one value per fragment via shift().
// -----------------------------------------------------------------------------
function buildTierQueue(totalNodes, f, level) {
    const rootRows  = State.rootRows || 10;
    const rootCols  = State.rootCols || 12;
    const medTarget = getTargetLength(level, rootRows, rootCols) * f;
    const estimated = Math.max(4, Math.ceil(totalNodes / Math.max(1, medTarget)));

    let pShort, pMedium, pLong;
    if (level <= 5)       { pShort = 0.50; pMedium = 0.50; pLong = 0.00; }
    else if (level <= 15) { pShort = 0.30; pMedium = 0.55; pLong = 0.15; }
    else                  { pShort = 0.25; pMedium = 0.50; pLong = 0.25; }

    const nLong   = level <= 5 ? 0 : Math.max(1, Math.round(estimated * pLong));
    const nShort  = Math.max(1, Math.round(estimated * pShort));
    const nMedium = Math.max(2, estimated - nShort - nLong);

    const minLen = Math.max(3, 3 * f);
    const queue  = [];

    for (let i = 0; i < nShort; i++) {
        const t = Math.round((3 + Math.random() * 2) * f);   // 3–5 root cells
        queue.push(Math.max(minLen, t));
    }
    for (let i = 0; i < nMedium; i++) {
        const t = Math.round((5 + Math.random() * 4) * f);   // 5–9 root cells
        queue.push(t);
    }
    for (let i = 0; i < nLong; i++) {
        const t = Math.round((10 + Math.random() * 6) * f);  // 10–16 root cells
        queue.push(t);
    }

    // Fisher-Yates shuffle — spread tiers evenly across the board
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    return queue;
}

// -----------------------------------------------------------------------------
// fragmentTrail
// Splits one trail's node sequence into puzzle-length segments.
//
// tierQueue — shuffled array of target lengths from buildTierQueue.
//   Each fragment consumes one value via shift().
//   Falls back to level-default targetLen when queue is exhausted.
//
// Cut-point scoring:
//   turnScore : 0t=-0.5  1t=+0.5  2t=+2.0  3+t=+2.8
//   lenScore  : proximity to targetLen (complex shapes tolerate longer)
//   jitter    : ±0.2 for variety
//
// Returns array of node-arrays (each ≥ 3 nodes).
// -----------------------------------------------------------------------------
function fragmentTrail(nodes, level, rows, cols, tierQueue) {
    const n  = nodes.length;
    const f  = State.subdivFactor || 1;
    const defaultTargetLen = getTargetLength(level, Math.ceil(rows / f), Math.ceil(cols / f)) * f;
    const minLen    = Math.max(3, 3 * f);
    const segments  = [];
    let pos         = 0;

    while (pos < n) {
        const remaining = n - pos;

        if (remaining < minLen * 2) {
            if (remaining >= 2) segments.push(nodes.slice(pos));
            break;
        }

        // Pull next tier target, or fall back to level default
        const targetLen = (tierQueue && tierQueue.length > 0)
            ? tierQueue.shift()
            : defaultTargetLen;

        const maxLen   = Math.min(targetLen * 2 + 1, remaining - minLen);
        const clampMax = Math.max(minLen, maxLen);

        let bestLen   = minLen;
        let bestScore = -Infinity;

        for (let len = minLen; len <= clampMax; len++) {
            const turns = countSegmentTurns(nodes, pos, len);

            const tScore = turns >= 3 ? 2.8
                         : turns === 2 ? 2.0
                         : turns === 1 ? 0.5
                         : -0.5;

            let lScore;
            if (turns >= 3) {
                lScore = Math.min(1.2, len / targetLen);
            } else if (turns === 2) {
                lScore = 1.0 - Math.max(0, len - targetLen) / (targetLen * 2);
            } else {
                lScore = 1.0 - Math.abs(len - targetLen) / (targetLen + 2);
            }

            const score = tScore + lScore * 1.5 + (Math.random() * 0.4 - 0.2);
            if (score > bestScore) { bestScore = score; bestLen = len; }
        }

        segments.push(nodes.slice(pos, pos + bestLen));
        pos += bestLen;
    }

    return segments;
}

// -----------------------------------------------------------------------------
// fragmentAllTrails
// Applies fragmentation to every trail, assigns new sequential path IDs,
// and updates both nodeOwner and hEdge/vEdge to stay consistent.
//
// Returns array of path objects:
//   { id, nodes:[{r,c}…], heading:'RIGHT', state:'IDLE',
//     animProgress:0, originalNodes:[] }
// -----------------------------------------------------------------------------
function fragmentAllTrails(trails, level, graph) {
    const paths = [];
    const W     = graph.cols + 1;
    const f     = State.subdivFactor || 1;
    let id      = 0;

    // Count total nodes to estimate fragment count, then build the pre-planned
    // tier distribution (SHORT/MEDIUM/LONG) before any fragmentation begins.
    const totalNodes = trails.reduce((sum, t) => sum + t.nodes.length, 0);
    const tierQueue  = buildTierQueue(totalNodes, f, level);

    for (const trail of trails) {
        if (trail.nodes.length < 2) continue;

        // Short-trail threshold scales with subdivFactor — a 6-root-cell trail
        // is the minimum worth fragmenting; below that, keep it as one path.
        const segs = trail.nodes.length < 6 * f
            ? [trail.nodes]
            : fragmentTrail(trail.nodes, level, graph.rows, graph.cols, tierQueue);

        for (const seg of segs) {
            if (seg.length < 2) continue;

            // Stamp new path id into nodeOwner and hEdge/vEdge
            for (let i = 0; i < seg.length; i++) {
                graph.nodeOwner[seg[i].r * W + seg[i].c] = id;
            }
            for (let i = 0; i < seg.length - 1; i++) {
                reserveEdge(graph, seg[i].r, seg[i].c, seg[i + 1].r, seg[i + 1].c, id);
            }

            paths.push({
                id,
                nodes:         seg,
                heading:       'RIGHT',
                state:         'IDLE',
                animProgress:  0,
                originalNodes: []
            });
            id++;
        }
    }

    return paths;
}

// =============================================================================
// Step 5: Heading Assignment
// =============================================================================

// -----------------------------------------------------------------------------
// headingToDelta / deltaToHeading — heading ↔ (dr,dc) conversion helpers
// -----------------------------------------------------------------------------
function headingToDelta(heading) {
    if (heading === 'UP')   return { dr: -1, dc:  0 };
    if (heading === 'DOWN') return { dr:  1, dc:  0 };
    if (heading === 'LEFT') return { dr:  0, dc: -1 };
    return                         { dr:  0, dc:  1 };
}

function deltaToHeading(dr, dc) {
    if (dr === -1) return 'UP';
    if (dr ===  1) return 'DOWN';
    if (dc === -1) return 'LEFT';
    return 'RIGHT';
}

// forwardRayClearSteps and assignHeadings removed (RC-5):
// headings are set at placement time by the reverse constructor and never reassigned.

// =============================================================================
// RC — Reverse Construction
// Build the board backwards: place pieces only when their head's forward ray is
// currently clear. The solve order = placement order reversed.  Solvability is
// a property of construction, never a search.
//
// Public entry point:  reverseConstruct(graph, knobs)
//   knobs.chainDepth — number of forced dependency links (drives difficulty)
//   knobs.d          — [0,1] head-ray bias (0 = short/easy, 1 = long/hard)
//   knobs.lenScale   — piece-length multiplier (default 1)
//
// Tier selector:  rcChainDepthForTier(tier) → chainDepth
//                 rcConstructForTier(graph, tier, batch) → { paths, graph, coverage, cx }
// =============================================================================

// Solvability oracle for RC (uses recorded headings, NOT the forward-model).
// Own nodes + cleared nodes are transparent (snake escape model).
function rcCanEscape(p, removed, graph) {
    const { dr, dc } = headingToDelta(p.heading);
    const { nodeOwner, rows, cols } = graph; const W = cols + 1;
    const head = p.nodes[p.nodes.length - 1];
    let r = head.r, c = head.c;
    for (;;) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr > rows || nc < 0 || nc > cols) return true;
        const o = nodeOwner[nr * W + nc];
        if (o === -1 || o === p.id || removed.has(o)) { r = nr; c = nc; continue; }
        return false;
    }
}
function rcBoardSolvable(paths, graph) {
    const removed = new Set(); let prog = true;
    while (prog) { prog = false;
        for (const p of paths) { if (removed.has(p.id)) continue;
            if (rcCanEscape(p, removed, graph)) { removed.add(p.id); prog = true; }
        }
    }
    return removed.size === paths.length;
}
// After Phase C tail-appends, recompute placeOrder from a fresh greedy clear.
function rcRecomputePlaceOrder(paths, graph) {
    const removed = new Set(), clearOrder = []; let prog = true;
    while (prog) { prog = false;
        for (const p of paths) { if (removed.has(p.id)) continue;
            if (rcCanEscape(p, removed, graph)) { removed.add(p.id); clearOrder.push(p); prog = true; }
        }
    }
    if (removed.size !== paths.length) return false;
    const N = clearOrder.length;
    clearOrder.forEach((p, i) => { p.placeOrder = N - 1 - i; }); // first cleared = highest placeOrder
    return true;
}

// Piece-length sampling: SHORT/MEDIUM/LONG distribution (root-cell units × f).
function rcSampleLen(f) {
    const r = Math.random();
    if (r < 0.25) return Math.round((3  + Math.random() * 2) * f); // SHORT  3-5
    if (r < 0.75) return Math.round((5  + Math.random() * 4) * f); // MEDIUM 5-9
    return            Math.round((10 + Math.random() * 6) * f);    // LONG  10-16
}

// Anchor sampling: least-occupied / interior-biased (14 candidates, keep best).
function rcPickAnchor(graph) {
    const { nodeOwner, rows, cols } = graph; const W = cols + 1, R = rows + 1, C = cols + 1;
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 14; k++) {
        const r = (Math.random() * R) | 0, c = (Math.random() * C) | 0;
        if (nodeOwner[r * W + c] !== -1) continue;
        let empty = 0, tot = 0;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= R || cc < 0 || cc >= C) continue;
            tot++; if (nodeOwner[rr * W + cc] === -1) empty++;
        }
        const interior = Math.min(r, R - 1 - r, c, C - 1 - c) / Math.max(1, Math.min(R, C) / 2);
        const score = (empty / tot) + interior * 0.5 + Math.random() * 0.1;
        if (score > bestScore) { bestScore = score; best = { r, c }; }
    }
    return best;
}

// Occupancy-aware winding self-avoiding walk from anchor.
// Prefers turns over straights (turn score 1.0 vs straight 0.4) for variety.
function rcGrowWalk(graph, anchor, targetLen) {
    const { nodeOwner, rows, cols } = graph; const W = cols + 1, R = rows + 1, C = cols + 1;
    const nodes = [{ r: anchor.r, c: anchor.c }];
    const local = new Set([anchor.r + ',' + anchor.c]);
    let cur = anchor, pdr = 0, pdc = 0;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let i = 1; i < targetLen; i++) {
        const opts = dirs.map(([dr, dc]) => ({ r: cur.r + dr, c: cur.c + dc, dr, dc }))
            .filter(o => o.r >= 0 && o.r < R && o.c >= 0 && o.c < C &&
                         nodeOwner[o.r * W + o.c] === -1 && !local.has(o.r + ',' + o.c));
        if (!opts.length) break;
        for (const o of opts) {
            const straight = (o.dr === pdr && o.dc === pdc);
            o.score = (straight ? 0.4 : 1.0) + Math.random();
        }
        opts.sort((a, b) => b.score - a.score);
        const pick = opts[0];
        nodes.push({ r: pick.r, c: pick.c }); local.add(pick.r + ',' + pick.c);
        pdr = pick.dr; pdc = pick.dc; cur = pick;
    }
    return nodes;
}

// Returns true if the straight ray from head in (dr,dc) is clear of all placed pieces.
function rcHeadRayClear(graph, head, dr, dc) {
    const { nodeOwner, rows, cols } = graph; const W = cols + 1;
    let r = head.r + dr, c = head.c + dc;
    while (r >= 0 && r <= rows && c >= 0 && c <= cols) {
        if (nodeOwner[r * W + c] !== -1) return false;
        r += dr; c += dc;
    }
    return true;
}

// Ray length from head to board edge in heading direction (difficulty bias measure).
function rcRayLenToEdge(h, dr, dc, rows, cols) {
    if (dr > 0) return rows - h.r;
    if (dr < 0) return h.r;
    if (dc > 0) return cols - h.c;
    return h.c;
}

// Exit point for a path: the boundary node the head's ray terminates at.
//   RIGHT → (hr, cols)   LEFT → (hr, 0)
//   DOWN  → (rows, hc)   UP   → (0,  hc)
function rcExitPoint(path, graph) {
    const head = path.nodes[path.nodes.length - 1];
    const { rows, cols } = graph;
    if (path.heading === 'RIGHT') return { r: head.r,  c: cols  };
    if (path.heading === 'LEFT')  return { r: head.r,  c: 0     };
    if (path.heading === 'DOWN')  return { r: rows,    c: head.c };
    return                               { r: 0,       c: head.c };  // UP
}

// Stable string key for an exit point: "<heading>:<boundary_coord>".
// Two paths with the same key share the same exit slot.
function rcExitKey(path, graph) {
    const head = path.nodes[path.nodes.length - 1];
    const { rows, cols } = graph;
    if (path.heading === 'RIGHT') return 'R:' + head.r;
    if (path.heading === 'LEFT')  return 'L:' + head.r;
    if (path.heading === 'DOWN')  return 'D:' + head.c;
    return                               'U:' + head.c;
}

// Chain pre-pass: place (depth+1) right-pointing length-3 pieces in a row, left
// to right.  Each is placed while its right-ray is clear — guarantee preserved.
// Afterwards each is blocked by its right neighbour → dependency chain of depth = count−1.
function rcBuildChain(graph, paths, ctr, depth, row) {
    const { nodeOwner, cols } = graph; const W = cols + 1;
    const count = depth + 1;
    if (3 * count - 1 > cols) return 0;
    let placed = 0;
    for (let j = 0; j < count; j++) {
        const c0 = 3 * j;
        const nodes = [{ r: row, c: c0 }, { r: row, c: c0 + 1 }, { r: row, c: c0 + 2 }];
        if (!nodes.every(n => nodeOwner[n.r * W + n.c] === -1)) break;
        if (!rcHeadRayClear(graph, nodes[2], 0, 1)) break;
        for (const n of nodes) nodeOwner[n.r * W + n.c] = ctr.n;
        paths.push({ id: ctr.n, nodes, heading: 'RIGHT', placeOrder: ctr.n, state: 'IDLE', animProgress: 0, originalNodes: [] });
        ctr.n++; placed++;
    }
    return placed;
}

// Phase A: main fill — place winding pieces respecting the clear-ray rule.
// knobs.d  [0,1]: high → prefers long inward rays (harder); low → short exits (easier).
function rcFillA(graph, paths, ctr, maxFails, knobs) {
    const d         = (knobs && knobs.d         != null) ? knobs.d         : 0.5;
    const lenScale  = (knobs && knobs.lenScale  != null) ? knobs.lenScale  : 1;
    const { nodeOwner, rows, cols } = graph; const W = cols + 1;
    const f = (typeof State !== 'undefined' && State.subdivFactor) ? State.subdivFactor : 1;
    let fails = 0;
    while (fails < maxFails) {
        const anchor = rcPickAnchor(graph);
        if (!anchor) { fails++; continue; }
        const nodes = rcGrowWalk(graph, anchor, Math.max(3, Math.round(rcSampleLen(f) * lenScale)));
        if (nodes.length < 3) { fails++; continue; }
        // Try both endpoints as head; pick best by difficulty bias.
        const cands = [];
        { const h = nodes[nodes.length - 1], pv = nodes[nodes.length - 2];
          const dr = h.r - pv.r, dc = h.c - pv.c;
          if (rcHeadRayClear(graph, h, dr, dc)) cands.push({ seq: nodes, h, dr, dc }); }
        { const h = nodes[0], pv = nodes[1];
          const dr = h.r - pv.r, dc = h.c - pv.c;
          if (rcHeadRayClear(graph, h, dr, dc)) cands.push({ seq: nodes.slice().reverse(), h, dr, dc }); }
        if (!cands.length) { fails++; continue; }
        let best = null, bestScore = -Infinity;
        for (const cn of cands) {
            const rl = rcRayLenToEdge(cn.h, cn.dr, cn.dc, rows, cols) / Math.max(rows, cols);
            const sc = (2 * d - 1) * rl + Math.random() * 0.25;
            if (sc > bestScore) { bestScore = sc; best = cn; }
        }
        for (const n of best.seq) nodeOwner[n.r * W + n.c] = ctr.n;
        paths.push({ id: ctr.n, nodes: best.seq, heading: deltaToHeading(best.dr, best.dc),
                     placeOrder: ctr.n, state: 'IDLE', animProgress: 0, originalNodes: [] });
        ctr.n++; fails = 0;
    }
}

// Phase B: gap fill — place small new pieces in empty pockets.
function rcFillB(graph, paths, ctr) {
    const { nodeOwner, rows, cols } = graph; const W = cols + 1, R = rows + 1, C = cols + 1;
    let progress = true;
    while (progress) {
        progress = false;
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            if (nodeOwner[r * W + c] !== -1) continue;
            for (let attempt = 0; attempt < 6 && nodeOwner[r * W + c] === -1; attempt++) {
                const nodes = rcGrowWalk(graph, { r, c }, 3 + (Math.random() * 3 | 0));
                if (nodes.length < 3) continue;
                const ends = [[nodes[nodes.length - 1], nodes[nodes.length - 2], false],
                              [nodes[0],                 nodes[1],                 true]];
                for (const [h, pv, rev] of ends) {
                    const dr = h.r - pv.r, dc = h.c - pv.c;
                    if (!rcHeadRayClear(graph, h, dr, dc)) continue;
                    const seq = rev ? nodes.slice().reverse() : nodes;
                    const id = ctr.n++;
                    for (const n of seq) nodeOwner[n.r * W + n.c] = id;
                    paths.push({ id, nodes: seq, heading: deltaToHeading(dr, dc),
                                 placeOrder: id, state: 'IDLE', animProgress: 0, originalNodes: [] });
                    progress = true; break;
                }
            }
        }
    }
}

// Phase C: tail-append isolated empty nodes; validate with complete oracle; revert LIFO if needed.
function rcFillC(graph, paths) {
    const { nodeOwner, rows, cols } = graph; const W = cols + 1, R = rows + 1, C = cols + 1;
    const byId = new Map(paths.map(p => [p.id, p]));
    const appends = []; let progress = true;
    while (progress) {
        progress = false;
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            if (nodeOwner[r * W + c] !== -1) continue;
            const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
            for (const [ar, ac] of nb) {
                if (ar < 0 || ar >= R || ac < 0 || ac >= C) continue;
                const oid = nodeOwner[ar * W + ac]; if (oid < 0) continue;
                const p = byId.get(oid); if (!p) continue;
                const tail = p.nodes[0];
                if (tail.r !== ar || tail.c !== ac) continue;
                p.nodes.unshift({ r, c }); nodeOwner[r * W + c] = oid;
                appends.push({ r, c, p }); progress = true; break;
            }
        }
    }
    // Validate with complete oracle; revert LIFO until solvable; recompute placeOrder.
    while (appends.length && !rcBoardSolvable(paths, graph)) {
        const a = appends.pop();
        a.p.nodes.shift();
        nodeOwner[a.r * W + a.c] = -1;
    }
    rcRecomputePlaceOrder(paths, graph);
}

// Phase D: oracle-only gap fill — convergence loop then brute-force reversal pass.
// Unlike Phases A/B (head-ray-clear gate) and Phase C (LIFO tail-append), Phase D
// uses rcBoardSolvable as the sole validity gate, allowing placements that fail the
// ray check but still produce a solvable board.
function rcFillD(graph, paths, ctr) {
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1, R = rows + 1, C = cols + 1;
    const byId = new Map(paths.map(p => [p.id, p]));
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    function emptyNbCount(r, c) {
        let n = 0;
        for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < R && nc >= 0 && nc < C && nodeOwner[nr * W + nc] === -1) n++;
        }
        return n;
    }

    // ── Convergence loop ────────────────────────────────────────────────────────
    let progress = true;
    while (progress) {
        progress = false;

        // Collect empty nodes sorted most-constrained first (fewest empty neighbours)
        const empty = [];
        for (let r = 0; r < R; r++)
            for (let c = 0; c < C; c++)
                if (nodeOwner[r * W + c] === -1)
                    empty.push({ r, c, ec: emptyNbCount(r, c) });
        empty.sort((a, b) => a.ec - b.ec);

        for (const { r, c } of empty) {
            if (nodeOwner[r * W + c] !== -1) continue; // already claimed earlier this sweep
            let placed = false;

            // Option 1: grow a 3-node walk from (r,c) → new piece (Rule 8: min 3 nodes).
            // Try every L-shaped or straight triplet reachable from (r,c).
            for (let d1 = 0; d1 < DIRS.length && !placed; d1++) {
                const [dr1, dc1] = DIRS[d1];
                const r2 = r + dr1, c2 = c + dc1;
                if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue;
                if (nodeOwner[r2 * W + c2] !== -1) continue;

                for (let d2 = 0; d2 < DIRS.length && !placed; d2++) {
                    const [dr2, dc2] = DIRS[d2];
                    if (dr2 === -dr1 && dc2 === -dc1) continue; // no backtrack
                    const r3 = r2 + dr2, c3 = c2 + dc2;
                    if (r3 < 0 || r3 >= R || c3 < 0 || c3 >= C) continue;
                    if (nodeOwner[r3 * W + c3] !== -1) continue;
                    if (r3 === r && c3 === c) continue; // no self-loop

                    // 3-node walk: (r,c)→(r2,c2)→(r3,c3). Try head at each end.
                    const seq = [{ r, c }, { r: r2, c: c2 }, { r: r3, c: c3 }];
                    const tries = [
                        { ns: seq,                   hdr:  dr2, hdc:  dc2 },
                        { ns: seq.slice().reverse(), hdr: -dr1, hdc: -dc1 },
                    ];
                    for (const { ns, hdr, hdc } of tries) {
                        const id = ctr.n;
                        for (const n of ns) nodeOwner[n.r * W + n.c] = id;
                        const p = { id, nodes: ns, heading: deltaToHeading(hdr, hdc),
                                    placeOrder: id, state: 'IDLE', animProgress: 0, originalNodes: [] };
                        paths.push(p); byId.set(id, p);

                        if (rcBoardSolvable(paths, graph)) {
                            ctr.n++; placed = true; progress = true;
                            break;
                        }
                        for (const n of ns) nodeOwner[n.r * W + n.c] = -1;
                        paths.pop(); byId.delete(id);
                    }
                }
            }

            if (placed) continue;

            // Option 2: append to adjacent piece tail (nodes[0])
            for (const [dr, dc] of DIRS) {
                if (placed) break;
                const ar = r + dr, ac = c + dc;
                if (ar < 0 || ar >= R || ac < 0 || ac >= C) continue;
                const oid = nodeOwner[ar * W + ac]; if (oid < 0) continue;
                const p = byId.get(oid); if (!p) continue;
                if (p.nodes[0].r !== ar || p.nodes[0].c !== ac) continue;

                p.nodes.unshift({ r, c });
                nodeOwner[r * W + c] = oid;
                if (rcBoardSolvable(paths, graph)) {
                    placed = true; progress = true;
                } else {
                    p.nodes.shift();
                    nodeOwner[r * W + c] = -1;
                }
            }
        }
    }

    // ── Brute-force reversal pass ────────────────────────────────────────────────
    // For nodes still empty after convergence: try reversing an adjacent piece so its
    // head becomes the tail, then append the empty node to that new tail.
    let revProgress = true;
    while (revProgress) {
        revProgress = false;
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            if (nodeOwner[r * W + c] !== -1) continue;
            let placed = false;
            for (const [dr, dc] of DIRS) {
                if (placed) break;
                const ar = r + dr, ac = c + dc;
                if (ar < 0 || ar >= R || ac < 0 || ac >= C) continue;
                const oid = nodeOwner[ar * W + ac]; if (oid < 0) continue;
                const p = byId.get(oid); if (!p || p.nodes.length < 2) continue;

                // Only try if (ar,ac) is the head — reversing exposes it as the new tail
                const head = p.nodes[p.nodes.length - 1];
                if (head.r !== ar || head.c !== ac) continue;

                const savedNodes   = p.nodes.slice();
                const savedHeading = p.heading;

                // Reverse: old head becomes new tail, old tail becomes new head
                p.nodes.reverse();
                const nh = p.nodes[p.nodes.length - 1], np = p.nodes[p.nodes.length - 2];
                p.heading = deltaToHeading(nh.r - np.r, nh.c - np.c);
                p.nodes.unshift({ r, c });
                nodeOwner[r * W + c] = oid;

                if (rcBoardSolvable(paths, graph)) {
                    placed = true; revProgress = true;
                } else {
                    p.nodes.shift();
                    nodeOwner[r * W + c] = -1;
                    p.nodes = savedNodes;
                    p.heading = savedHeading;
                }
            }
        }
    }

    rcRecomputePlaceOrder(paths, graph);
}

// Core reverse constructor: chain backbone → Phase A → two rounds of B+C.
// Phase D (oracle gap-fill) is intentionally NOT called here — it runs after
// complexity scoring in rcConstructForTier so tiny gap-fill pieces don't dilute
// the difficulty measurement.
function reverseConstruct(graph, knobs) {
    const chainDepth = (knobs && knobs.chainDepth) || 0;
    const paths = []; const ctr = { n: 0 };
    if (chainDepth > 0) {
        const row = 1 + ((Math.random() * graph.rows) | 0);
        rcBuildChain(graph, paths, ctr, chainDepth, row);
    }
    // maxFails proportional to board size: caps the fail-countdown once the board
    // is near-full, avoiding hundreds of ms burning through guaranteed-empty attempts.
    const totalNodes = (graph.rows + 1) * (graph.cols + 1);
    const maxFails   = Math.max(400, Math.floor(totalNodes * 0.55));
    rcFillA(graph, paths, ctr, maxFails, knobs);
    for (let round = 0; round < 2; round++) {
        rcFillB(graph, paths, ctr);
        rcFillC(graph, paths);
    }
    return paths;
}

// Map difficulty tier → chainDepth knob.
function rcChainDepthForTier(tier) {
    return { EASY: 0, NORMAL: 0, HARD: 4, EXPERT: 7, TITAN: 11 }[tier] || 0;
}

// Generate up to `batch` boards, return the one whose measured tier matches target
// (or the closest-scoring one if no exact match within the batch).
// After returning, graph.nodeOwner is always consistent with the returned paths.
function rcConstructForTier(graph, tier, batch) {
    const TIER_CENTER = { EASY: 3, NORMAL: 9.5, HARD: 17.5, EXPERT: 25.5, TITAN: 33 };
    const cd = rcChainDepthForTier(tier);
    const d  = (tier === 'EASY') ? 0 : 0.5;
    let best = null, bestDelta = Infinity;
    for (let i = 0; i < batch; i++) {
        const cdi = Math.max(0, cd + ((i % 3) - 1));   // bracket cd-1 .. cd+1
        const paths = reverseConstruct(graph, { d, chainDepth: cdi });

        // Score complexity BEFORE Phase D — gap-fill pieces are cosmetic and must
        // not dilute the difficulty measurement from the Phase A/B/C structure.
        const cx = evaluateBoardComplexity(paths, graph);

        // Phase D: oracle-only gap fill to reach 100% node coverage. Runs after
        // scoring so tiny 2-node pieces don't affect the difficulty tier.
        const ctr = { n: paths.length };
        rcFillD(graph, paths, ctr);

        if (cx.tier === tier) return { paths, cx };             // graph is in correct state
        const delta = Math.abs(cx.score - TIER_CENTER[tier]);
        if (delta < bestDelta) { bestDelta = delta; best = { paths, cx }; }
        // Reset graph for next attempt — only if another attempt follows
        if (i < batch - 1) {
            graph.nodeOwner.fill(-1);
            graph.hEdge.forEach(row => row.fill(-1));
            graph.vEdge.forEach(row => row.fill(-1));
        }
    }
    // After the loop, graph.nodeOwner may be stale (from a reset after a non-best
    // iteration). Rebuild it from the best paths so callers always get a consistent pair.
    if (best) {
        const W = graph.cols + 1;
        graph.nodeOwner.fill(-1);
        for (const p of best.paths)
            for (const { r, c } of p.nodes)
                graph.nodeOwner[r * W + c] = p.id;
    }
    return best;
}
