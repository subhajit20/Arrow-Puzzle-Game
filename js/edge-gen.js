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
//   5. Heading Assignment  (assignHeadings + forwardRayClearSteps)
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

// -----------------------------------------------------------------------------
// forwardRayClearSteps
// Counts how many node-steps the arrowhead can travel from startNode before
// hitting the grid boundary or a node owned by this same path (self-collision).
//
// Uses nodeOwner (node model) instead of hEdge/vEdge (old edge model).
// -----------------------------------------------------------------------------
function forwardRayClearSteps(pathId, startNode, heading, graph) {
    const { dr, dc }              = headingToDelta(heading);
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;
    let r = startNode.r, c = startNode.c;
    let steps = 0;

    for (let i = 0; i < rows + cols + 4; i++) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr > rows || nc < 0 || nc > cols) break;
        if (nodeOwner[nr * W + nc] === pathId) break; // self-collision
        steps++;
        r = nr; c = nc;
    }

    return steps;
}

// -----------------------------------------------------------------------------
// assignHeadings
// Evaluates both endpoints of each path as candidate arrowhead positions.
//
// Chevron Self-Collision Guard:
//   Cast a forward ray from each endpoint in its natural outward direction.
//   Count clear node-steps before hitting the boundary or a self-owned node.
//   Pick the endpoint with MORE clear steps (safer launch corridor).
//   Ties default to keeping the last node as head (no reversal).
//
// Mutates path.nodes (may reverse) and sets path.heading + path.originalNodes.
// -----------------------------------------------------------------------------
function assignHeadings(paths, graph) {
    for (const p of paths) {
        const n = p.nodes.length;

        if (n < 2) {
            p.heading       = 'RIGHT';
            p.originalNodes = p.nodes.slice();
            continue;
        }

        // Candidate A — arrowhead at last node
        const last  = p.nodes[n - 1];
        const prev  = p.nodes[n - 2];
        const hA    = deltaToHeading(last.r - prev.r, last.c - prev.c);
        const safeA = forwardRayClearSteps(p.id, last, hA, graph);

        // Candidate B — arrowhead at first node (heading away from body)
        const first = p.nodes[0];
        const secnd = p.nodes[1];
        const hB    = deltaToHeading(first.r - secnd.r, first.c - secnd.c);
        const safeB = forwardRayClearSteps(p.id, first, hB, graph);

        if (safeB > safeA) {
            p.nodes.reverse();
            p.heading = hB;
        } else {
            p.heading = hA;
        }

        p.originalNodes = p.nodes.slice();
    }
}
