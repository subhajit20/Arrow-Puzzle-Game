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

function getStraightLineReach(r, c, dr, dc, gridOwnership) {
    let reach = 0;
    let cr = r + dr;
    let cc = c + dc;
    while (cr >= 0 && cr < State.gridRows && cc >= 0 && cc < State.gridCols) {
        if (gridOwnership[cr][cc] !== -1) break;
        reach++;
        cr += dr;
        cc += dc;
    }
    return reach;
}

function getHeadingFromDiff(dr, dc) {
    if (dr === -1 && dc === 0) return "UP";
    if (dr === 1 && dc === 0) return "DOWN";
    if (dr === 0 && dc === -1) return "LEFT";
    if (dr === 0 && dc === 1) return "RIGHT";
    return "RIGHT";
}

// Projects a ray forward from the endpoint to check if it collides with its own body (Chevron Self-Collision Guard)
function evaluateEndpoint(headCell, dir, bodyPoints, rows, cols) {
    let dr = dir.r;
    let dc = dir.c;
    let cr = headCell.r + dr;
    let cc = headCell.c + dc;
    let selfIntersect = false;
    let selfIntersectDist = Infinity;
    let boardBlocks = 0;
    let adjacentBodyCount = 0;
    let perpR = dc;
    let perpC = dr;

    while (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
        boardBlocks++;
        if (bodyPoints.some(pt => pt.r === cr && pt.c === cc)) {
            if (!selfIntersect) selfIntersectDist = boardBlocks;
            selfIntersect = true;
        }
        if (bodyPoints.some(pt => pt.r === cr + perpR && pt.c === cc + perpC)) adjacentBodyCount++;
        if (bodyPoints.some(pt => pt.r === cr - perpR && pt.c === cc - perpC)) adjacentBodyCount++;
        cr += dr;
        cc += dc;
    }

    return { selfIntersect, selfIntersectDist, boardBlocks, adjacentBodyCount };
}

// Applies the No-Self-Collision Arrowhead Selection Rules
function assignSmartHeadings(paths, rows, cols) {
    paths.forEach(p => {
        let len = p.points.length;
        if (len < 2) return;

        let ptA = p.points[0];
        let ptA_next = p.points[1];
        let dirA = { r: ptA.r - ptA_next.r, c: ptA.c - ptA_next.c };
        let bodyA = p.points.slice(1);

        let ptB = p.points[len - 1];
        let ptB_prev = p.points[len - 2];
        let dirB = { r: ptB.r - ptB_prev.r, c: ptB.c - ptB_prev.c };
        let bodyB = p.points.slice(0, len - 1);

        let evalA = evaluateEndpoint(ptA, dirA, bodyA, rows, cols);
        let evalB = evaluateEndpoint(ptB, dirB, bodyB, rows, cols);

        let straightA = len >= 3 &&
            (p.points[0].r - p.points[1].r) === (p.points[1].r - p.points[2].r) &&
            (p.points[0].c - p.points[1].c) === (p.points[1].c - p.points[2].c);
        let straightB = len >= 3 &&
            (p.points[len - 1].r - p.points[len - 2].r) === (p.points[len - 2].r - p.points[len - 3].r) &&
            (p.points[len - 1].c - p.points[len - 2].c) === (p.points[len - 2].c - p.points[len - 3].c);

        // Count full straight run-in length from each endpoint
        let runInA = 1;
        for (let i = 2; i < len; i++) {
            if (p.points[i - 1].r - p.points[i].r === dirA.r &&
                p.points[i - 1].c - p.points[i].c === dirA.c) runInA++;
            else break;
        }
        let runInB = 1;
        for (let i = len - 3; i >= 0; i--) {
            if (p.points[i + 1].r - p.points[i].r === dirB.r &&
                p.points[i + 1].c - p.points[i].c === dirB.c) runInB++;
            else break;
        }

        // Near-closed-loop: heading pointing toward opposite endpoint is confusing
        let aHeadsTowardTail = (dirA.r * (ptB.r - ptA.r) + dirA.c * (ptB.c - ptA.c)) > 0;
        let bHeadsTowardTail = (dirB.r * (ptA.r - ptB.r) + dirB.c * (ptA.c - ptB.c)) > 0;

        let chooseA = false;
        if (evalA.selfIntersect && !evalB.selfIntersect) {
            chooseA = false;
        } else if (!evalA.selfIntersect && evalB.selfIntersect) {
            chooseA = true;
        } else if (evalA.selfIntersect && evalB.selfIntersect) {
            // Both trapped — prefer the endpoint with the farther body collision
            if (evalA.selfIntersectDist !== evalB.selfIntersectDist) {
                chooseA = evalA.selfIntersectDist > evalB.selfIntersectDist;
            } else if (!aHeadsTowardTail && bHeadsTowardTail) {
                chooseA = true;
            } else if (aHeadsTowardTail && !bHeadsTowardTail) {
                chooseA = false;
            } else if (straightA !== straightB) {
                chooseA = straightA;
            } else if (runInA !== runInB) {
                chooseA = runInA > runInB;
            } else {
                chooseA = evalA.adjacentBodyCount < evalB.adjacentBodyCount;
            }
        } else {
            // Both safe — break ties by visual clarity
            if (!aHeadsTowardTail && bHeadsTowardTail) {
                chooseA = true;
            } else if (aHeadsTowardTail && !bHeadsTowardTail) {
                chooseA = false;
            } else if (straightA !== straightB) {
                chooseA = straightA;
            } else if (runInA !== runInB) {
                chooseA = runInA > runInB;
            } else if (evalA.adjacentBodyCount !== evalB.adjacentBodyCount) {
                chooseA = evalA.adjacentBodyCount < evalB.adjacentBodyCount;
            } else {
                chooseA = evalA.boardBlocks < evalB.boardBlocks;
            }
        }

        if (chooseA) {
            p.points.reverse();
            let newLast = p.points[len - 1];
            let newPrev = p.points[len - 2];
            p.heading = getHeadingFromDiff(newLast.r - newPrev.r, newLast.c - newPrev.c);
        } else {
            p.heading = getHeadingFromDiff(ptB.r - ptB_prev.r, ptB.c - ptB_prev.c);
        }
        p.originalPoints = JSON.parse(JSON.stringify(p.points));
    });
}

function getOccupiedNeighborsCount(r, c, gridOwnership) {
    let count = 0;
    const dMoves = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let d of dMoves) {
        let nr = r + d[0];
        let nc = c + d[1];
        if (nr < 0 || nr >= State.gridRows || nc < 0 || nc >= State.gridCols) {
            count += 2;
        } else if (gridOwnership[nr][nc] !== -1) {
            count += 1;
        }
    }
    return count;
}

function tryGenerateBoard() {
    let gridOwnership = Array(State.gridRows).fill().map(() => Array(State.gridCols).fill(-1));

    for (let r = 0; r < State.gridRows; r++) {
        for (let c = 0; c < State.gridCols; c++) {
            if (State.gridMask[r][c] === 0 || State.gridMask[r][c] === -1) {
                gridOwnership[r][c] = -2;
            }
        }
    }

    let paths = [];
    let pathIdCounter = 1;
    const dMoves = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (true) {
        let bestCell = null;
        let maxScore = -1;

        for (let r = 0; r < State.gridRows; r++) {
            for (let c = 0; c < State.gridCols; c++) {
                if (gridOwnership[r][c] === -1) {
                    let score = getOccupiedNeighborsCount(r, c, gridOwnership) + Math.random() * 0.5;
                    if (score > maxScore) {
                        maxScore = score;
                        bestCell = { r, c };
                    }
                }
            }
        }

        if (!bestCell) break;

        let cell = bestCell;
        let currentPath = [{ r: cell.r, c: cell.c }];
        gridOwnership[cell.r][cell.c] = pathIdCounter;

        let cr = cell.r;
        let cc = cell.c;

        const styleRoll = Math.random();
        let isSpiral = styleRoll < 0.35;
        let isSerpentine = !isSpiral && styleRoll < 0.65;
        let isStairWinder = !isSpiral && !isSerpentine && styleRoll < 0.85;

        let bestDir = dMoves[Math.floor(Math.random() * dMoves.length)];
        let maxReach = -1;
        for (let m of dMoves) {
            let reach = getStraightLineReach(cr, cc, m[0], m[1], gridOwnership);
            if (reach > maxReach) {
                maxReach = reach;
                bestDir = m;
            }
        }

        let lastMove = bestDir;
        let maxDim = Math.max(State.gridRows, State.gridCols);
        // Denser boards get shorter paths so MORE paths pack the grid.
        // Phase 1 density: tightened crawler caps so the optimizer has fewer
        // fat paths to split and more even packing from the start.
        // maxDim 40-50 → 4–7 cells each  → ~137–240 paths on a 960-cell board
        // maxDim 20-39 → 5–9 cells each  → ~33–60 paths
        // maxDim  <20  → 6–11 cells each → ~8–20 paths
        let maxLen;
        if (maxDim >= 40) maxLen = 4 + Math.floor(Math.random() * 4);    // 4–7
        else if (maxDim >= 20) maxLen = 5 + Math.floor(Math.random() * 5); // 5–9
        else maxLen = 6 + Math.floor(Math.random() * 6);                    // 6–11

        // Level-aware density scaling: tighten caps as the player progresses
        {
            const _lvl = State.level || 1;
            if (_lvl > 25) maxLen = Math.max(3, Math.round(maxLen * 0.70));
            else if (_lvl > 10) maxLen = Math.max(3, Math.round(maxLen * 0.85));
        }
        // Adaptive soft cap: scales with the smaller board dimension so compact
        // boards get naturally tight paths while larger boards allow occasional
        // longer ones. Replaces the previous rigid 8-cell hard cap to preserve
        // procedural variety as the user requested.
        {
            const _minDim = Math.min(State.gridRows, State.gridCols);
            maxLen = Math.min(maxLen, Math.max(5, Math.floor(_minDim * 0.70)));
        }

        let consecutiveStraight = 0;
        let spiralDir = Math.random() < 0.5 ? 1 : -1;

        for (let step = 0; step < maxLen; step++) {
            let nextR = cr + lastMove[0];
            let nextC = cc + lastMove[1];
            let canGoStraight = (nextR >= 0 && nextR < State.gridRows && nextC >= 0 && nextC < State.gridCols && gridOwnership[nextR][nextC] === -1);

            let chosenMove = null;

            if (isSpiral) {
                let orderedMoves = [];
                if (lastMove[0] === 0) {
                    orderedMoves = [[lastMove[1] * spiralDir, 0], [0, lastMove[1]]];
                } else {
                    orderedMoves = [[0, -lastMove[0] * spiralDir], [lastMove[0], 0]];
                }

                if (canGoStraight && consecutiveStraight < 2) {
                    chosenMove = lastMove;
                    consecutiveStraight++;
                } else {
                    let turnMove = orderedMoves[0];
                    let tr = cr + turnMove[0];
                    let tc = cc + turnMove[1];
                    if (tr >= 0 && tr < State.gridRows && tc >= 0 && tc < State.gridCols && gridOwnership[tr][tc] === -1) {
                        chosenMove = turnMove;
                        consecutiveStraight = 0;
                    } else if (canGoStraight) {
                        chosenMove = lastMove;
                        consecutiveStraight++;
                    } else {
                        break;
                    }
                }
            } else if (isSerpentine) {
                if (canGoStraight && consecutiveStraight < 3) {
                    chosenMove = lastMove;
                    consecutiveStraight++;
                } else {
                    let turnOptions = [];
                    for (let m of dMoves) {
                        if (m[0] === -lastMove[0] && m[1] === -lastMove[1]) continue;
                        if (m[0] === lastMove[0] && m[1] === lastMove[1]) continue;
                        let tr = cr + m[0];
                        let tc = cc + m[1];
                        if (tr >= 0 && tr < State.gridRows && tc >= 0 && tc < State.gridCols && gridOwnership[tr][tc] === -1) {
                            turnOptions.push(m);
                        }
                    }
                    if (turnOptions.length > 0) {
                        turnOptions.sort((a, b) => {
                            let nA = getOccupiedNeighborsCount(cr + a[0], cc + a[1], gridOwnership);
                            let nB = getOccupiedNeighborsCount(cr + b[0], cc + b[1], gridOwnership);
                            let rA = getStraightLineReach(cr, cc, a[0], a[1], gridOwnership);
                            let rB = getStraightLineReach(cr, cc, b[0], b[1], gridOwnership);
                            return (nB * 3 + rB) - (nA * 3 + rA);
                        });
                        chosenMove = turnOptions[0];
                        consecutiveStraight = 0;
                    } else if (canGoStraight) {
                        chosenMove = lastMove;
                        consecutiveStraight++;
                    } else {
                        break;
                    }
                }
            } else if (isStairWinder) {
                let turnOptions = [];
                for (let m of dMoves) {
                    if (m[0] === -lastMove[0] && m[1] === -lastMove[1]) continue;
                    if (m[0] === lastMove[0] && m[1] === lastMove[1]) continue;
                    let tr = cr + m[0];
                    let tc = cc + m[1];
                    if (tr >= 0 && tr < State.gridRows && tc >= 0 && tc < State.gridCols && gridOwnership[tr][tc] === -1) {
                        turnOptions.push(m);
                    }
                }
                if (consecutiveStraight === 0 && turnOptions.length > 0) {
                    chosenMove = turnOptions[Math.floor(Math.random() * turnOptions.length)];
                    consecutiveStraight = 1;
                } else if (canGoStraight) {
                    chosenMove = lastMove;
                    consecutiveStraight = 0;
                } else if (turnOptions.length > 0) {
                    chosenMove = turnOptions[Math.floor(Math.random() * turnOptions.length)];
                    consecutiveStraight = 1;
                } else {
                    break;
                }
            } else {
                if (canGoStraight && (consecutiveStraight < 3 || Math.random() < 0.95)) {
                    chosenMove = lastMove;
                    consecutiveStraight++;
                } else {
                    let turnOptions = [];
                    for (let m of dMoves) {
                        if (m[0] === -lastMove[0] && m[1] === -lastMove[1]) continue;
                        if (m[0] === lastMove[0] && m[1] === lastMove[1]) continue;
                        let tr = cr + m[0];
                        let tc = cc + m[1];
                        if (tr >= 0 && tr < State.gridRows && tc >= 0 && tc < State.gridCols && gridOwnership[tr][tc] === -1) {
                            let straightReach = getStraightLineReach(cr, cc, m[0], m[1], gridOwnership);
                            let neighbors = getOccupiedNeighborsCount(tr, tc, gridOwnership);
                            turnOptions.push({ move: m, score: neighbors * 3 + straightReach });
                        }
                    }
                    if (turnOptions.length > 0) {
                        turnOptions.sort((a, b) => b.score - a.score);
                        chosenMove = turnOptions[0].move;
                        consecutiveStraight = 1;
                    } else if (canGoStraight) {
                        chosenMove = lastMove;
                        consecutiveStraight++;
                    } else {
                        break;
                    }
                }
            }

            cr += chosenMove[0];
            cc += chosenMove[1];
            currentPath.push({ r: cr, c: cc });
            gridOwnership[cr][cc] = pathIdCounter;
            lastMove = chosenMove;
        }

        if (currentPath.length >= 2) {
            let len = currentPath.length;
            let ptA = currentPath[0];
            let ptA_next = currentPath[1];
            let dirA = { r: ptA.r - ptA_next.r, c: ptA.c - ptA_next.c };
            let bodyA = currentPath.slice(1);

            let ptB = currentPath[len - 1];
            let ptB_prev = currentPath[len - 2];
            let dirB = { r: ptB.r - ptB_prev.r, c: ptB.c - ptB_prev.c };
            let bodyB = currentPath.slice(0, len - 1);

            let evalA = evaluateEndpoint(ptA, dirA, bodyA, State.gridRows, State.gridCols);
            let evalB = evaluateEndpoint(ptB, dirB, bodyB, State.gridRows, State.gridCols);

            if (evalA.selfIntersect && evalB.selfIntersect) {
                currentPath.forEach(pt => {
                    gridOwnership[pt.r][pt.c] = -3;
                });
            } else {
                paths.push({
                    id: pathIdCounter,
                    points: currentPath,
                    heading: "RIGHT",
                    state: "IDLE",
                    animProgress: 0,
                    crashFlashFrames: 0,
                    originalPoints: []
                });
                pathIdCounter++;
            }
        } else {
            gridOwnership[cell.r][cell.c] = -3;
        }
    }

    for (let r = 0; r < State.gridRows; r++) {
        for (let c = 0; c < State.gridCols; c++) {
            if (gridOwnership[r][c] === -3) gridOwnership[r][c] = -1;
        }
    }

    let unassigned = [];
    for (let r = 0; r < State.gridRows; r++) {
        for (let c = 0; c < State.gridCols; c++) {
            if (gridOwnership[r][c] === -1) unassigned.push({ r, c });
        }
    }

    // Gap-fill length cap: any path that has already reached this length stops
    // accepting new cells via extension. Remaining unassigned cells fall through
    // to the steal-fallback below, which creates new short paths instead of
    // ballooning existing ones into fat region-dominating monsters.
    // Ceiling: slightly looser than the crawler soft cap to allow a few extra
    // gap-fill cells, but still prevents any single path from dominating a region.
    const gapFillMaxLen = Math.min(10, getAdaptiveTargetLen(State.level || 1) + 3);

    // Prefer attaching to endpoints whose new escape ray stays self-intersection-free
    let progress = true;
    while (progress && unassigned.length > 0) {
        progress = false;
        for (let i = unassigned.length - 1; i >= 0; i--) {
            let { r, c } = unassigned[i];
            let cleanOption = null;
            let dirtyOption = null;
            let seenPaths = new Set();

            for (let d of dMoves) {
                let nr = r + d[0];
                let nc = c + d[1];
                if (nr >= 0 && nr < State.gridRows && nc >= 0 && nc < State.gridCols) {
                    let neighborId = gridOwnership[nr][nc];
                    if (neighborId >= 1 && !seenPaths.has(neighborId)) {
                        seenPaths.add(neighborId);
                        let path = paths[neighborId - 1];
                        // Only extend paths that haven't reached the density cap.
                        // Capped paths stop absorbing cells; unassigned cells that
                        // can't find an uncapped neighbour become new short paths.
                        if (path && path.points.length < gapFillMaxLen) {
                            let head = path.points[path.points.length - 1];
                            let tail = path.points[0];

                            if (Math.abs(head.r - r) + Math.abs(head.c - c) === 1) {
                                let newDir = { r: r - head.r, c: c - head.c };
                                let ev = evaluateEndpoint({ r, c }, newDir, path.points, State.gridRows, State.gridCols);
                                if (!ev.selfIntersect && !cleanOption) cleanOption = { type: 'head', path, neighborId };
                                else if (ev.selfIntersect && !dirtyOption) dirtyOption = { type: 'head', path, neighborId };
                            } else if (Math.abs(tail.r - r) + Math.abs(tail.c - c) === 1) {
                                let newDir = { r: r - tail.r, c: c - tail.c };
                                let ev = evaluateEndpoint({ r, c }, newDir, path.points, State.gridRows, State.gridCols);
                                if (!ev.selfIntersect && !cleanOption) cleanOption = { type: 'tail', path, neighborId };
                                else if (ev.selfIntersect && !dirtyOption) dirtyOption = { type: 'tail', path, neighborId };
                            }
                        }
                    }
                }
            }

            let chosen = cleanOption || dirtyOption;
            if (chosen) {
                if (chosen.type === 'head') chosen.path.points.push({ r, c });
                else chosen.path.points.unshift({ r, c });
                gridOwnership[r][c] = chosen.neighborId;
                unassigned.splice(i, 1);
                progress = true;
            }
        }
    }

    // Strictly orthogonal fallback: steal 2 cells when possible for readable 3-point paths
    if (unassigned.length > 0) {
        for (let i = unassigned.length - 1; i >= 0; i--) {
            let { r, c } = unassigned[i];
            for (let d of dMoves) {
                let nr = r + d[0];
                let nc = c + d[1];
                if (nr >= 0 && nr < State.gridRows && nc >= 0 && nc < State.gridCols) {
                    let neighborId = gridOwnership[nr][nc];
                    if (neighborId >= 1) {
                        let neighborPath = paths[neighborId - 1];
                        if (neighborPath && neighborPath.points.length > 2) {
                            let head = neighborPath.points[neighborPath.points.length - 1];
                            let tail = neighborPath.points[0];
                            if (head.r === nr && head.c === nc) {
                                let newId = ++pathIdCounter;
                                let newPoints;
                                if (neighborPath.points.length > 3) {
                                    let prevHead = neighborPath.points[neighborPath.points.length - 2];
                                    neighborPath.points.pop();
                                    neighborPath.points.pop();
                                    gridOwnership[prevHead.r][prevHead.c] = newId;
                                    newPoints = [{ r: prevHead.r, c: prevHead.c }, { r: nr, c: nc }, { r, c }];
                                } else {
                                    neighborPath.points.pop();
                                    newPoints = [{ r: nr, c: nc }, { r, c }];
                                }
                                gridOwnership[nr][nc] = newId;
                                gridOwnership[r][c] = newId;
                                paths.push({
                                    id: newId,
                                    points: newPoints,
                                    heading: getHeadingFromDiff(r - nr, c - nc),
                                    state: "IDLE",
                                    animProgress: 0,
                                    originalPoints: []
                                });
                                unassigned.splice(i, 1);
                                break;
                            } else if (tail.r === nr && tail.c === nc) {
                                let newId = ++pathIdCounter;
                                let newPoints;
                                if (neighborPath.points.length > 3) {
                                    let nextTail = neighborPath.points[1];
                                    neighborPath.points.shift();
                                    neighborPath.points.shift();
                                    gridOwnership[nextTail.r][nextTail.c] = newId;
                                    newPoints = [{ r, c }, { r: nr, c: nc }, { r: nextTail.r, c: nextTail.c }];
                                } else {
                                    neighborPath.points.shift();
                                    newPoints = [{ r, c }, { r: nr, c: nc }];
                                }
                                gridOwnership[nr][nc] = newId;
                                gridOwnership[r][c] = newId;
                                paths.push({
                                    id: newId,
                                    points: newPoints,
                                    heading: getHeadingFromDiff(nr - r, nc - c),
                                    state: "IDLE",
                                    animProgress: 0,
                                    originalPoints: []
                                });
                                unassigned.splice(i, 1);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    assignSmartHeadings(paths, State.gridRows, State.gridCols);
    return { paths, gridOwnership };
}

function validatePaths(paths, mask, rows, cols) {
    let expectedCount = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (mask[r]?.[c] === 1) expectedCount++;
        }
    }

    let visited = new Set();
    for (let p of paths) {
        if (p.points.length < 2) return false;
        for (let i = 0; i < p.points.length; i++) {
            let pt = p.points[i];
            if (pt.r < 0 || pt.r >= rows || pt.c < 0 || pt.c >= cols) return false;
            if (mask[pt.r]?.[pt.c] !== 1) return false;
            if (i > 0) {
                let prev = p.points[i - 1];
                let dist = Math.abs(pt.r - prev.r) + Math.abs(pt.c - prev.c);
                if (dist !== 1) return false;
            }
            let key = `${pt.r},${pt.c}`;
            if (visited.has(key)) return false;
            visited.add(key);
        }
    }
    return visited.size === expectedCount;
}

function canPathEscapeVirtual(p, activePaths, rows, cols) {
    let head = p.points[p.points.length - 1];
    let dr = 0, dc = 0;
    if (p.heading === "UP") dr = -1;
    if (p.heading === "DOWN") dr = 1;
    if (p.heading === "LEFT") dc = -1;
    if (p.heading === "RIGHT") dc = 1;

    let checkR = head.r + dr;
    let checkC = head.c + dc;

    while (checkR >= 0 && checkR < rows && checkC >= 0 && checkC < cols) {
        if (State.gridMask[checkR]?.[checkC] === -1) return false;
        let hit = activePaths.some(other => {
            if (other.id === p.id) return false;
            return other.points.some(pt => pt.r === checkR && pt.c === checkC);
        });
        if (hit) return false;
        checkR += dr;
        checkC += dc;
    }
    return true;
}

function isBoardFullySolvable(paths, rows, cols) {
    let occupancy = Array(rows).fill().map(() => Array(cols).fill(-1));
    paths.forEach(p => {
        p.points.forEach(pt => { occupancy[pt.r][pt.c] = p.id; });
    });

    let activeSet = new Set(paths.map(p => p.id));
    let clearedCount = 0;
    let resolvedSomething = true;

    while (resolvedSomething) {
        resolvedSomething = false;
        for (let p of paths) {
            if (!activeSet.has(p.id)) continue;

            let head = p.points[p.points.length - 1];
            let dr = 0, dc = 0;
            if (p.heading === "UP") dr = -1;
            if (p.heading === "DOWN") dr = 1;
            if (p.heading === "LEFT") dc = -1;
            if (p.heading === "RIGHT") dc = 1;

            let checkR = head.r + dr;
            let checkC = head.c + dc;
            let canEscape = true;

            while (checkR >= 0 && checkR < rows && checkC >= 0 && checkC < cols) {
                if (State.gridMask[checkR]?.[checkC] === -1) { canEscape = false; break; }
                let occupiedId = occupancy[checkR][checkC];
                if (occupiedId !== -1 && occupiedId !== p.id) { canEscape = false; break; }
                checkR += dr;
                checkC += dc;
            }

            if (canEscape) {
                p.points.forEach(pt => { occupancy[pt.r][pt.c] = -1; });
                activeSet.delete(p.id);
                clearedCount++;
                resolvedSomething = true;
                break;
            }
        }
    }

    return clearedCount === paths.length;
}

function canEscapeOccupancy(p, occupancy, rows, cols) {
    let head = p.points[p.points.length - 1];
    let dr = 0, dc = 0;
    if (p.heading === "UP") dr = -1;
    if (p.heading === "DOWN") dr = 1;
    if (p.heading === "LEFT") dc = -1;
    if (p.heading === "RIGHT") dc = 1;

    let checkR = head.r + dr;
    let checkC = head.c + dc;

    while (checkR >= 0 && checkR < rows && checkC >= 0 && checkC < cols) {
        if (State.gridMask[checkR]?.[checkC] === -1) return false;
        let occupiedId = occupancy[checkR][checkC];
        if (occupiedId !== -1 && occupiedId !== p.id) return false;
        checkR += dr;
        checkC += dc;
    }
    return true;
}

function runUnjammingSolvabilityTweak(paths, rows, cols, gridOwnership) {
    for (let pass = 0; pass < 5; pass++) {
        let occupancy = Array(rows).fill().map(() => Array(cols).fill(-1));
        let activeIds = new Set();
        paths.forEach(p => {
            p.points.forEach(pt => { occupancy[pt.r][pt.c] = p.id; });
            activeIds.add(p.id);
        });

        let resolvedSomething = true;
        while (resolvedSomething) {
            resolvedSomething = false;
            for (let p of paths) {
                if (!activeIds.has(p.id)) continue;
                if (canEscapeOccupancy(p, occupancy, rows, cols)) {
                    p.points.forEach(pt => { occupancy[pt.r][pt.c] = -1; });
                    activeIds.delete(p.id);
                    resolvedSomething = true;
                    break;
                }
            }
        }

        if (activeIds.size === 0) return;

        let anyFlipped = false;
        for (let p of paths) {
            if (!activeIds.has(p.id)) continue;
            let origHeading = p.heading;

            // Temporarily reverse points and compute the true new heading
            p.points.reverse();
            let newLast = p.points[p.points.length - 1];
            let newPrev = p.points[p.points.length - 2];
            let newHeading = getHeadingFromDiff(newLast.r - newPrev.r, newLast.c - newPrev.c);
            p.heading = newHeading;

            // Evaluate endpoint self-intersection after reverse
            let dir = { r: newLast.r - newPrev.r, c: newLast.c - newPrev.c };
            let body = p.points.slice(0, p.points.length - 1);
            let evalResult = evaluateEndpoint(newLast, dir, body, rows, cols);

            // Check if this path can now escape and does NOT point towards its own body
            if (!evalResult.selfIntersect && canEscapeOccupancy(p, occupancy, rows, cols)) {
                // Free its cells and mark cleared
                p.originalPoints = JSON.parse(JSON.stringify(p.points));
                p.points.forEach(pt => { occupancy[pt.r][pt.c] = -1; });
                activeIds.delete(p.id);
                anyFlipped = true;
            } else {
                // Revert the flip
                p.heading = origHeading;
                p.points.reverse();
            }
        }

        if (activeIds.size === 0) return;
        if (!anyFlipped) return;
    }
}

function hasAnyDoubleSelfCollidingPath(paths, rows, cols) {
    return paths.some(p => {
        let len = p.points.length;
        if (len < 2) return false;

        let ptA = p.points[0];
        let dirA = { r: ptA.r - p.points[1].r, c: ptA.c - p.points[1].c };
        let ptB = p.points[len - 1];
        let dirB = { r: ptB.r - p.points[len - 2].r, c: ptB.c - p.points[len - 2].c };

        let evalA = evaluateEndpoint(ptA, dirA, p.points.slice(1), rows, cols);
        let evalB = evaluateEndpoint(ptB, dirB, p.points.slice(0, len - 1), rows, cols);
        return evalA.selfIntersect && evalB.selfIntersect;
    });
}

// After the unjammer may have flipped headings for solvability, restore visual clarity:
// if the arrowhead immediately faces its own body (dist=1), try flipping to the other
// endpoint — but only if that direction can still escape other paths.
function fixVisualSelfIntersections(paths, rows, cols) {
    let occupancy = Array(rows).fill().map(() => Array(cols).fill(-1));
    paths.forEach(p => {
        p.points.forEach(pt => { occupancy[pt.r][pt.c] = p.id; });
    });

    for (let p of paths) {
        let len = p.points.length;
        if (len < 2) continue;

        let head = p.points[len - 1];
        let prev = p.points[len - 2];
        let fwdR = head.r + (head.r - prev.r);
        let fwdC = head.c + (head.c - prev.c);
        let bodyPoints = p.points.slice(0, len - 1);
        let bodyImmediatelyAhead = bodyPoints.some(pt => pt.r === fwdR && pt.c === fwdC);
        if (!bodyImmediatelyAhead) continue;

        // Arrowhead points directly into own body — try flipping
        let origHeading = p.heading;
        let oppHeading = origHeading === "UP" ? "DOWN" : origHeading === "DOWN" ? "UP"
            : origHeading === "LEFT" ? "RIGHT" : "LEFT";
        p.heading = oppHeading;
        p.points.reverse();

        let newHead = p.points[p.points.length - 1];
        let newPrev = p.points[p.points.length - 2];
        let newFwdR = newHead.r + (newHead.r - newPrev.r);
        let newFwdC = newHead.c + (newHead.c - newPrev.c);
        let newBodyPoints = p.points.slice(0, p.points.length - 1);
        let newBodyAhead = newBodyPoints.some(pt => pt.r === newFwdR && pt.c === newFwdC);

        if (!newBodyAhead && canEscapeOccupancy(p, occupancy, rows, cols)) {
            // Flipped heading is visually clean and solvable — keep it
            p.originalPoints = JSON.parse(JSON.stringify(p.points));
        } else {
            // Revert — both directions are bad or flip is blocked by other paths
            p.heading = origHeading;
            p.points.reverse();
            p.originalPoints = JSON.parse(JSON.stringify(p.points));
        }
    }
}

// ---------------------------------------------------------------------------
// buildGridOwnership
// Rebuilds a full gridOwnership map from paths + current mask state.
// Values: -2 = masked/void, -1 = unassigned playable cell, >=1 = path id.
// ---------------------------------------------------------------------------
function buildGridOwnership(paths) {
    const rows = State.gridRows;
    const cols = State.gridCols;
    const go = Array(rows).fill().map(() => Array(cols).fill(-2));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (State.gridMask[r][c] === 1) go[r][c] = -1;
        }
    }
    paths.forEach(p => {
        p.points.forEach(pt => { go[pt.r][pt.c] = p.id; });
    });
    return go;
}

// ---------------------------------------------------------------------------
// getAdaptiveTargetLen
// Returns the target maximum path length used by the density optimizer.
// Lower = denser board. Scales with board dimensions and level progression.
// ---------------------------------------------------------------------------
function getAdaptiveTargetLen(level) {
    const maxDim = Math.max(State.gridRows, State.gridCols);
    // Base target average path length. Larger boards get shorter path targets
    // so hundreds of paths pack the grid tightly. At high levels, the level
    // scaling below drives every board toward ~3–5 cells per path.
    //
    //  maxDim 40–50 (e.g. 20×50) → base 6  → level 22: ~4 cells/path → ~250 paths
    //  maxDim 30–39 (e.g. 20×36) → base 7  → level 22: ~4 cells/path → ~175 paths
    //  maxDim 18–29 (e.g. 20×24) → base 8  → level 22: ~5 cells/path → ~100 paths
    //  maxDim 14–17               → base 8  → level 22: ~5 cells/path
    //  maxDim 10–13               → base 7  → level 22: ~5 cells/path
    //  maxDim  <10                → base 6
    let base;
    if (maxDim >= 40) base = 6;
    else if (maxDim >= 30) base = 7;
    else if (maxDim >= 18) base = 8;
    else if (maxDim >= 14) base = 8;
    else if (maxDim >= 10) base = 7;
    else base = 6;
    if (level > 25) return Math.max(3, Math.floor(base * 0.55));
    if (level > 10) return Math.max(3, Math.floor(base * 0.68));
    return base;
}

// ---------------------------------------------------------------------------
// densityOptimizerPass
//
// Phase 2 of the density system. After the board generator produces a valid
// solvable board, this pass identifies "fat" paths (paths substantially
// longer than the adaptive target length) and splits them at strategically
// chosen points to:
//
//   • Create dependency chains: new endpoint aimed at another path's body
//   • Create crossing corridors: high adjacency to neighbouring paths
//   • Create choke points: split boundary in a region shared by many paths
//
// Each split is validated (full validatePaths + isBoardFullySolvable check)
// before being committed. Failed splits are rolled back via snapshot.
// The board always exits this function in a fully valid solvable state.
// ---------------------------------------------------------------------------
function densityOptimizerPass(paths, level) {
    // Count active (playable) cells
    let activeCells = 0;
    for (let r = 0; r < State.gridRows; r++)
        for (let c = 0; c < State.gridCols; c++)
            if (State.gridMask[r][c] === 1) activeCells++;
    if (activeCells === 0 || paths.length === 0) return;

    const rows = State.gridRows;
    const cols = State.gridCols;
    const dMoves = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    const targetAvgLen = getAdaptiveTargetLen(level);
    // Fat threshold = exactly the target average. Any path longer than the
    // target is a split candidate — no 1.75× buffer. This is the key change
    // that makes the optimizer actually split most paths on the board.
    const fatThreshold = targetAvgLen;
    // How many extra paths we want to reach target density
    const targetPathCount = Math.ceil(activeCells / targetAvgLen);
    const desiredSplits = Math.max(0, targetPathCount - paths.length);

    // Split caps scale with level and board size so large high-level boards
    // (e.g. 20×50 = 1000 cells) get enough splits to hit target density.
    // maxAttempts is capped at 4× rather than 6× for performance on large boards.
    let maxSplits;
    if (level <= 10) maxSplits = Math.min(8,  desiredSplits);
    else if (level <= 20) maxSplits = Math.min(30, desiredSplits);
    else maxSplits = Math.min(60, desiredSplits);  // up from 28 — needed for 20×50+

    if (maxSplits === 0) return;

    let pathIdCounter = Math.max(...paths.map(p => p.id));
    let splitsApplied = 0;
    const maxAttempts = maxSplits * 4; // 4 tries per desired split (was 6)

    for (let attempt = 0; attempt < maxAttempts && splitsApplied < maxSplits; attempt++) {

        // ── 1. Snapshot all paths for rollback ─────────────────────────────
        const snapshot = paths.map(p => ({
            id: p.id,
            points: JSON.parse(JSON.stringify(p.points)),
            heading: p.heading,
            originalPoints: JSON.parse(JSON.stringify(p.originalPoints))
        }));
        const snapshotLen = paths.length;

        // ── 2. Find fat paths ───────────────────────────────────────────────
        const fatPaths = paths
            .filter(p => p.points.length > fatThreshold)
            .sort((a, b) => b.points.length - a.points.length);
        if (fatPaths.length === 0) break;

        // Pick from the top 3 longest with a random skew for board variety
        const target = fatPaths[Math.floor(Math.random() * Math.min(3, fatPaths.length))];
        const pts = target.points;
        const n = pts.length;

        // ── 3. Build current gridOwnership ──────────────────────────────────
        const go = buildGridOwnership(paths);

        // ── 4. Score every candidate split index ────────────────────────────
        // Hard floor: every sub-path must be at least 3 cells (minimum for a
        // readable path with a body and a head). No 2-cell stubs from splitting.
        const minHalf = 3;

        let bestIdx = -1;
        let bestScore = -Infinity;

        for (let i = minHalf - 1; i <= n - minHalf - 1; i++) {
            const halfA = i + 1;       // pts[0 .. i]
            const halfB = n - i - 1;   // pts[i+1 .. n-1]
            if (halfA < 2 || halfB < 2) continue;

            const cellA = pts[i];      // new endpoint of path A
            const cellB = pts[i + 1];  // new endpoint of path B

            // a) Adjacency — other-path cells touching the split boundary
            let adjScore = 0;
            for (const d of dMoves) {
                const r1 = cellA.r + d[0], c1 = cellA.c + d[1];
                if (r1 >= 0 && r1 < rows && c1 >= 0 && c1 < cols) {
                    const id = go[r1][c1];
                    if (id >= 1 && id !== target.id) adjScore++;
                }
                const r2 = cellB.r + d[0], c2 = cellB.c + d[1];
                if (r2 >= 0 && r2 < rows && c2 >= 0 && c2 < cols) {
                    const id = go[r2][c2];
                    if (id >= 1 && id !== target.id) adjScore++;
                }
            }

            // b) Dependency blocking — does the natural outbound heading of
            //    the new endpoint aim straight at another path's body?
            //    This creates explicit dependency chains between paths.
            let blockScore = 0;
            if (i >= 1) {
                const drA = cellA.r - pts[i - 1].r;
                const dcA = cellA.c - pts[i - 1].c;
                let cr = cellA.r + drA, cc = cellA.c + dcA;
                while (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
                    const id = go[cr][cc];
                    if (id >= 1 && id !== target.id) { blockScore += 5; break; }
                    cr += drA; cc += dcA;
                }
            }
            if (i + 2 < n) {
                const drB = cellB.r - pts[i + 2].r;
                const dcB = cellB.c - pts[i + 2].c;
                let cr = cellB.r + drB, cc = cellB.c + dcB;
                while (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
                    const id = go[cr][cc];
                    if (id >= 1 && id !== target.id) { blockScore += 5; break; }
                    cr += drB; cc += dcB;
                }
            }

            // c) Balance — prefer splits near the middle of the fat path
            const balance = 1.0 - Math.abs(halfA - halfB) / n;

            // d) Small jitter to avoid deterministic index selection
            const jitter = Math.random() * 0.4;

            const score = adjScore * 2.5 + blockScore + balance * 1.5 + jitter;

            if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }

        if (bestIdx === -1) continue;

        // ── 5. Perform the split ─────────────────────────────────────────────
        const newId = ++pathIdCounter;
        const ptsA = pts.slice(0, bestIdx + 1);
        const ptsB = pts.slice(bestIdx + 1);

        // Modify original path → becomes path A
        target.points = ptsA;
        target.originalPoints = [];

        // Create path B
        const pathB = {
            id: newId,
            points: ptsB,
            heading: "RIGHT",
            state: "IDLE",
            animProgress: 0,
            crashFlashFrames: 0,
            originalPoints: []
        };
        paths.push(pathB);

        // ── 6. Re-assign headings for the two new sub-paths ─────────────────
        // assignSmartHeadings is path-independent (uses only board dims),
        // so calling it on just the two new paths is correct and efficient.
        assignSmartHeadings([target, pathB], rows, cols);

        // ── 7. Re-run unjammer + visual fix on the full board ────────────────
        runUnjammingSolvabilityTweak(paths, rows, cols, null);
        fixVisualSelfIntersections(paths, rows, cols);

        // ── 8. Full validation ───────────────────────────────────────────────
        const valid =
            !hasAnyDoubleSelfCollidingPath(paths, rows, cols) &&
            validatePaths(paths, State.gridMask, rows, cols) &&
            isBoardFullySolvable(paths, rows, cols);

        if (valid) {
            splitsApplied++;
        } else {
            // ── 9. Rollback ──────────────────────────────────────────────────
            // Remove any paths added during this attempt
            while (paths.length > snapshotLen) paths.pop();
            // Restore all original path state from snapshot
            for (let si = 0; si < snapshotLen; si++) {
                paths[si].points        = snapshot[si].points;
                paths[si].heading       = snapshot[si].heading;
                paths[si].originalPoints = snapshot[si].originalPoints;
            }
        }
    }
}

function build100PackedLevel(forceNewGeneration = false) {
    if (!forceNewGeneration && Persistence.loadState()) {
        State.levelStartScore = State.score;
        resizeCanvas();
        updateDomUI();
        startPathRevealAnimation();
        return;
    }

    const bounds = generateRandomGridDimensions(State.gridSizePreset, State.level);
    State.gridRows = bounds.rows;
    State.gridCols = bounds.cols;
    State.gridSize = Math.max(State.gridRows, State.gridCols);

    const topo = getTopologyForLevel(State.level, State.gridRows, State.gridCols);
    // Portrait topologies need more rows than cols — swap dimensions if the
    // random generator produced a landscape or square board.
    if (topo.enforcePortrait && State.gridCols > State.gridRows) {
        let tmp = State.gridRows;
        State.gridRows = State.gridCols;
        State.gridCols = tmp;
        // gridSize (the max) is unchanged by a swap, so no need to recalculate.
    }
    State.shapeName = topo.name;
    State.gridMask = topo.makeMask(State.gridRows, State.gridCols);

    // Safety check: if the topology produces too few playable cells for these
    // dimensions (e.g. a Circle on a 6×2 board yields ~4 cells), substitute a
    // full-rectangle mask so the generation pipeline always has enough cells to
    // build real paths and the solvability validator has something to work with.
    let _playableCount = 0;
    for (let _r = 0; _r < State.gridRows; _r++)
        for (let _c = 0; _c < State.gridCols; _c++)
            if (State.gridMask[_r][_c] === 1) _playableCount++;
    if (_playableCount < 6) {
        State.shapeName = TOPOLOGIES.VERTICAL_RECT.name;
        State.gridMask = TOPOLOGIES.VERTICAL_RECT.makeMask(State.gridRows, State.gridCols);
    }

    resetCamera();
    resizeCanvas();

    // Determine target difficulty based on level and sliding pacing history
    const targetTier = selectTargetDifficulty(State.level, State.recentDifficulties || []);
    
    let validResult = null;
    let chosenDifficulty = "NORMAL";
    const candidatesByTier = {};

    for (let attempt = 0; attempt < 20; attempt++) {
        let candidate = tryGenerateBoard();
        if (candidate && candidate.paths && candidate.paths.length > 0) {
            runUnjammingSolvabilityTweak(candidate.paths, State.gridRows, State.gridCols, candidate.gridOwnership);
            fixVisualSelfIntersections(candidate.paths, State.gridRows, State.gridCols);
            if (!hasAnyDoubleSelfCollidingPath(candidate.paths, State.gridRows, State.gridCols) &&
                isBoardFullySolvable(candidate.paths, State.gridRows, State.gridCols)) {

                // Phase 2 density optimization: split fat paths to create
                // interaction density, dependency chains, and choke points.
                densityOptimizerPass(candidate.paths, State.level);

                // Evaluate puzzle complexity (reflects the optimized board)
                const complexity = evaluateBoardComplexity(candidate.paths, State.gridRows, State.gridCols);
                let tier = "NORMAL";
                if (complexity.score < 6) tier = "EASY";
                else if (complexity.score < 13) tier = "NORMAL";
                else if (complexity.score < 22) tier = "HARD";
                else if (complexity.score < 29) tier = "EXPERT";
                else tier = "TITAN";

                candidatesByTier[tier] = candidate;

                if (tier === targetTier) {
                    validResult = candidate;
                    chosenDifficulty = tier;
                    break;
                }
            }
        }
    }

    // Fallback tier selection if exact match was not found
    if (!validResult) {
        const preferenceOrder = [targetTier, "HARD", "EXPERT", "TITAN", "NORMAL", "EASY"];
        for (let t of preferenceOrder) {
            if (candidatesByTier[t]) {
                validResult = candidatesByTier[t];
                chosenDifficulty = t;
                break;
            }
        }
    }

    if (validResult) {
        State.paths = validResult.paths;
        State.boardDifficulty = chosenDifficulty;
    } else {
        // All 20 attempts failed — fall back to a compact square board.
        // 12×12 matches the new premium-density philosophy while being
        // simple enough to generate reliably in a few attempts.
        const FB_ROWS = 12, FB_COLS = 12;
        State.gridRows = FB_ROWS;
        State.gridCols = FB_COLS;
        State.gridSize = FB_ROWS;
        State.gridMask = TOPOLOGIES.VERTICAL_RECT.makeMask(FB_ROWS, FB_COLS);
        State.shapeName = TOPOLOGIES.VERTICAL_RECT.name;
        resetCamera();
        resizeCanvas();
        let fallback = null;
        let fbDifficulty = "NORMAL";

        for (let attempt = 0; attempt < 10; attempt++) {
            let fb = tryGenerateBoard();
            if (fb && fb.paths && fb.paths.length > 0) {
                runUnjammingSolvabilityTweak(fb.paths, FB_ROWS, FB_COLS, fb.gridOwnership);
                fixVisualSelfIntersections(fb.paths, FB_ROWS, FB_COLS);
                if (!hasAnyDoubleSelfCollidingPath(fb.paths, FB_ROWS, FB_COLS) &&
                    isBoardFullySolvable(fb.paths, FB_ROWS, FB_COLS)) {

                    // Apply density optimizer on fallback board too
                    densityOptimizerPass(fb.paths, State.level);

                    const complexity = evaluateBoardComplexity(fb.paths, FB_ROWS, FB_COLS);
                    if (complexity.score < 6) fbDifficulty = "EASY";
                    else if (complexity.score < 13) fbDifficulty = "NORMAL";
                    else if (complexity.score < 22) fbDifficulty = "HARD";
                    else if (complexity.score < 29) fbDifficulty = "EXPERT";
                    else fbDifficulty = "TITAN";

                    fallback = fb;
                    break;
                }
            }
        }
        State.paths = fallback ? fallback.paths : [];
        State.boardDifficulty = fallback ? fbDifficulty : "NORMAL";
    }

    // Record selected difficulty in pacing sliding history
    if (!State.recentDifficulties) State.recentDifficulties = [];
    State.recentDifficulties.push(State.boardDifficulty);
    if (State.recentDifficulties.length > 5) {
        State.recentDifficulties.shift();
    }

    State.levelStartScore = State.score;
    State.lives = 3;
    Persistence.saveState();
    updateDomUI();
    startPathRevealAnimation();
}

// ---------------------------------------------------------------------------
// evaluateBoardComplexity
//
// Build the directed dependency graph (DAG) of direct path blockers, recursively
// compute the maximum dependency depth, and return a comprehensive complexity score.
// ---------------------------------------------------------------------------
function evaluateBoardComplexity(paths, rows, cols) {
    let occupancy = Array(rows).fill().map(() => Array(cols).fill(-1));
    paths.forEach(p => {
        p.points.forEach(pt => { occupancy[pt.r][pt.c] = p.id; });
    });

    // 1. Build directed blocker graph
    let G = {};
    paths.forEach(p => {
        G[p.id] = { id: p.id, blockers: new Set() };
    });

    const dMoves = {
        "UP": [-1, 0],
        "DOWN": [1, 0],
        "LEFT": [0, -1],
        "RIGHT": [0, 1]
    };

    paths.forEach(p => {
        let head = p.points[p.points.length - 1];
        let move = dMoves[p.heading];
        if (!move) return;

        let cr = head.r + move[0];
        let cc = head.c + move[1];

        while (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
            if (State.gridMask[cr]?.[cc] === -1) break;
            let occupiedId = occupancy[cr][cc];
            if (occupiedId !== -1 && occupiedId !== p.id) {
                G[p.id].blockers.add(occupiedId);
            }
            cr += move[0];
            cc += move[1];
        }
    });

    // 2. Compute recursion depths
    let depths = {};
    let visited = new Set();

    function getDepth(id) {
        if (depths[id] !== undefined) return depths[id];
        if (visited.has(id)) return 0;
        visited.add(id);

        let node = G[id];
        if (!node || node.blockers.size === 0) {
            depths[id] = 0;
        } else {
            let maxB = 0;
            node.blockers.forEach(bid => {
                maxB = Math.max(maxB, getDepth(bid));
            });
            depths[id] = 1 + maxB;
        }
        visited.delete(id);
        return depths[id];
    }

    paths.forEach(p => getDepth(p.id));

    let maxDepth = 0;
    let totalBlockers = 0;
    let initialEscapes = 0;

    paths.forEach(p => {
        let d = depths[p.id] || 0;
        maxDepth = Math.max(maxDepth, d);
        if (d === 0) initialEscapes++;
        let node = G[p.id];
        if (node) totalBlockers += node.blockers.size;
    });

    let numPaths = paths.length || 1;
    let blockerRatio = totalBlockers / numPaths;

    // Only penalise boards where too many paths can escape freely (too easy).
    // Removed the <2 penalty: a board with few initial escapes is HARDER
    // (deep dependency lock), not easier — penalising it was counter-productive
    // and prevented dense boards from scoring HARD/EXPERT as intended.
    let initialEscapePen = 0;
    if (initialEscapes > 6) {
        initialEscapePen = (initialEscapes - 6) * 1.5;
    }

    let score = maxDepth * 3 + blockerRatio * 5.5 - initialEscapePen;
    return {
        score: Math.max(0, score),
        maxDepth,
        blockerRatio,
        initialEscapes
    };
}

// ---------------------------------------------------------------------------
// selectTargetDifficulty
//
// Resolve weighted probabilities based on level ranges, overriding targets
// using history pacing rules (prevent streaks, inject Easy/Normal relief).
// ---------------------------------------------------------------------------
function selectTargetDifficulty(level, history) {
    let probs = { EASY: 0.60, NORMAL: 0.30, HARD: 0.09, EXPERT: 0.01 };
    
    if (level > 40) {
        probs = { EASY: 0.05, NORMAL: 0.15, HARD: 0.50, EXPERT: 0.30 };
    } else if (level > 20) {
        probs = { EASY: 0.10, NORMAL: 0.20, HARD: 0.50, EXPERT: 0.20 };
    } else if (level > 10) {
        probs = { EASY: 0.20, NORMAL: 0.45, HARD: 0.30, EXPERT: 0.05 };
    }

    const last1 = history[history.length - 1];
    const last2 = history[history.length - 2];

    // Pacing Override Rules
    if (last1 === "EXPERT" && last2 === "EXPERT") {
        probs.EXPERT = 0.0;
        probs.NORMAL = 0.8;
    }
    if (last1 === "EASY" && last2 === "EASY") {
        probs.EASY = 0.0;
        probs.HARD = 0.6;
    }
    if ((last1 === "EXPERT" || last1 === "HARD") && (last2 === "EXPERT" || last2 === "HARD")) {
        probs.EASY = 0.4;
        probs.NORMAL = 0.6;
        probs.HARD = 0.0;
        probs.EXPERT = 0.0;
    }

    const roll = Math.random();
    let sum = 0;
    for (let tier in probs) {
        sum += probs[tier];
        if (roll <= sum) return tier;
    }
    return "NORMAL";
}
