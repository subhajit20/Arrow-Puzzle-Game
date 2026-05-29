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

// -----------------------------------------------------------------------------
// walkWarnsdorff
// Self-avoiding Warnsdorff walk from startNode, claiming each visited node.
//
// graph.nodeOwner is the GLOBAL ownership tracker shared across all trails —
// enforces cross-trail node exclusivity.
//
// Scoring (lower = preferred):
//   freeAfter      — Warnsdorff: visit most-constrained neighbour first
//   straightPenalty — +5.0 after `maxStraight` consecutive straight steps;
//                     dwarfs freeAfter (0–4) → guaranteed turn
//   turnBonus      — direction bias tuned per style (see below)
//   jitter         — 0–0.8 for board variety
//
// maxLen    — walk length cap (shorter = more trail variety from scattered starts)
// maxStraight — turns behaviour:
//   99  = STRAIGHT style  : mild straight preference, no forced turns
//    4  = L/U style       : forced turn every 4 steps → one turn per fragment
//    2  = COMPLEX style   : forced turn every 2 steps → 2+ turns per fragment
// -----------------------------------------------------------------------------
function walkWarnsdorff(graph, startNode, pathId, maxLen, maxStraight) {
    const { nodeOwner, rows, cols } = graph;
    const W = cols + 1;

    nodeOwner[startNode.r * W + startNode.c] = pathId;
    const nodes = [{ r: startNode.r, c: startNode.c }];
    let cur      = startNode;
    let prevDr   = 0, prevDc = 0;
    let straightCount = 0;

    const forceTurnAt   = maxStraight ?? 2;
    const isStraightStyle = forceTurnAt >= 20;

    const cap = (maxLen != null) ? maxLen - 1 : (rows + 1) * (cols + 1);
    for (let step = 0; step < cap; step++) {
        const candidates = getFreeNeighborNodes(graph, cur.r, cur.c);
        if (candidates.length === 0) break;

        let best = null, bestScore = Infinity;
        for (const nb of candidates) {
            const freeAfter  = getFreeNeighborNodes(graph, nb.r, nb.c).length;
            const dr = nb.r - cur.r, dc = nb.c - cur.c;
            const goingStraight = (dr === prevDr && dc === prevDc);

            // Force turn when consecutive straight count hits the style cap
            const straightPenalty = (!isStraightStyle && goingStraight && straightCount >= forceTurnAt)
                ? 5.0 : 0;

            // STRAIGHT style: prefer straight, COMPLEX/LU: prefer turns
            const turnBonus = isStraightStyle
                ? (goingStraight ? -0.3 :  0.3)
                : (goingStraight ?  0.5 : -0.5);

            const score = freeAfter + turnBonus + straightPenalty + Math.random() * 0.8;
            if (score < bestScore) { bestScore = score; best = nb; }
        }

        const dr = best.r - cur.r, dc = best.c - cur.c;
        straightCount = (dr === prevDr && dc === prevDc) ? straightCount + 1 : 0;
        prevDr = dr; prevDc = dc;
        nodeOwner[best.r * W + best.c] = pathId;
        nodes.push({ r: best.r, c: best.c });
        cur = best;
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

    while (true) {
        const start = findConstrainedStart(graph);
        if (!start) break;

        // Per-trail style assignment — produces the target shape distribution:
        //   10% STRAIGHT (maxStraight=99*f): mild straight bias, no forced turns
        //   20% L/U      (maxStraight=4*f) : forced turn every 4 root cells
        //   70% COMPLEX  (maxStraight=2*f) : forced turn every 2 root cells
        const rnd = Math.random();
        const maxStraight = rnd < 0.10 ? 99       // STRAIGHT: effectively no cap
                          : rnd < 0.30 ?  4 * f   // L / U
                          :               2 * f;  // COMPLEX

        const nodes = walkWarnsdorff(graph, start, nextId, maxTrailLen, maxStraight);
        trails.push({ id: nextId, nodes });
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
// fragmentTrail
// Splits one trail's node sequence into puzzle-length segments.
//
// Cut-point scoring:
//   turnScore : 0t=-0.5  1t=+0.5  2t=+2.0  3+t=+2.8
//   lenScore  : proximity to targetLen (complex shapes tolerate longer)
//   jitter    : ±0.2 for variety
//
// Returns array of node-arrays (each ≥ 3 nodes).
// -----------------------------------------------------------------------------
function fragmentTrail(nodes, level, rows, cols) {
    const n  = nodes.length;
    const f  = State.subdivFactor || 1;
    // rows/cols are micro-grid; getTargetLength expects root-cell dimensions.
    // Divide by f to recover root dims, then multiply result back to micro-nodes.
    const targetLen = getTargetLength(level, Math.ceil(rows / f), Math.ceil(cols / f)) * f;
    const minLen    = Math.max(3, 3 * f);
    const segments  = [];
    let pos         = 0;

    while (pos < n) {
        const remaining = n - pos;

        if (remaining < minLen * 2) {
            if (remaining >= 2) segments.push(nodes.slice(pos));
            break;
        }

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

    for (const trail of trails) {
        if (trail.nodes.length < 2) continue;

        // Short-trail threshold scales with subdivFactor — a 6-root-cell trail
        // is the minimum worth fragmenting; below that, keep it as one path.
        const segs = trail.nodes.length < 6 * f
            ? [trail.nodes]
            : fragmentTrail(trail.nodes, level, graph.rows, graph.cols);

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
