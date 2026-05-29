function updateDomUI() {
    document.getElementById('level-display').innerText = `Level ${State.level}`;
    document.getElementById('score-display').innerText = State.dailyPuzzleMode ? State.dailyScore : State.score;

    const badge = document.getElementById('tier-badge');
    if (State.dailyPuzzleMode) {
        badge.innerText = 'DAILY';
        badge.style.color = '#d97706';
    } else {
        const diff = getDifficultyLabel(State.level);
        badge.innerText = diff.label;
        badge.style.color = diff.color;
    }

    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById(`heart-${i}`);
        if (i <= State.lives) {
            el.style.opacity = "1";
            el.style.transform = "scale(1)";
        } else {
            el.style.opacity = "0.15";
            el.style.transform = "scale(0.85)";
        }
    }
}

function drawChevronArrowHead(x, y, heading, size, isSelected, pState) {
    ctx.save();
    ctx.translate(x, y);

    let angle = 0;
    if (heading === "UP") angle = -Math.PI / 2;
    if (heading === "DOWN") angle = Math.PI / 2;
    if (heading === "LEFT") angle = Math.PI;
    ctx.rotate(angle);

    let fillTop, fillBottom, strokeColor;

    if (pState === "CRASHING") {
        fillTop = "#f87171";
        fillBottom = "#b91c1c";
        strokeColor = "#7f1d1d";
    } else if (isSelected) {
        fillTop = "#60a5fa";
        fillBottom = "#1d4ed8";
        strokeColor = "#1e3a8a";
    } else {
        fillTop = "#000000";
        fillBottom = "#000000";
        strokeColor = "#000000";
    }

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -size * 0.58);
    ctx.lineTo(size, 0);
    ctx.closePath();
    ctx.fillStyle = fillTop;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1.0, size * 0.08);
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, size * 0.58);
    ctx.lineTo(size, 0);
    ctx.closePath();
    ctx.fillStyle = fillBottom;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1.0, size * 0.08);
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.restore();
}

function drawEngine() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // Apply zoom and pan via context transforms so the canvas re-renders at full
    // resolution — CSS transform on canvas upsamples the bitmap and causes blur.
    ctx.translate(State.matE  || 0, State.matF   || 0);
    ctx.scale    (State.cssZoom || 1, State.cssZoom || 1);

    const cSize = State.cellSize;
    const ox = State.offsetX;
    const oy = State.offsetY;

    const rows = State.gridRows;
    const cols = State.gridCols;

    // subCellSize is the micro-grid pixel pitch; fall back to cellSize before SD-3 wires it
    const sCS = State.subCellSize || State.cellSize;

    // Board background fill — root-cell dimensions keep the visual board the same size
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ox, oy, (State.rootCols || cols) * State.cellSize, (State.rootRows || rows) * State.cellSize);

    // Dot at every micro-node intersection (replaces grid lines)
    const dotR = Math.max(0.8, sCS * 0.07);
    ctx.fillStyle = "#cbd5e1";
    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
            ctx.beginPath();
            ctx.arc(ox + c * sCS, oy + r * sCS, dotR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Expand clip by enough to show full arrowheads and line widths on the
    // boundary nodes — without padding, edge paths are half-clipped.
    const clipPad = Math.ceil(sCS * 0.6);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox - clipPad, oy - clipPad,
             cols * sCS + clipPad * 2,
             rows * sCS + clipPad * 2);
    ctx.clip();

    State.paths.forEach((p, idx) => {
        if (p.state === "CLEARED") return;

        let isSelected = (State.selectedPath && State.selectedPath.id === p.id) || (State.hintPathId === p.id);

        let strokeColor = "#112540";
        let activeColor = "#3b82f6";

        if (p.state === "CRASHING") {
            strokeColor = "#ef4444";
        } else if (isSelected) {
            strokeColor = activeColor;
        }

        if (p.state === "CRASHING" && (p.crashFlashFrames || 0) > 0) {
            ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
            getPathOccupiedCells(p).forEach(pt => {
                if (pt.r >= 0 && pt.r < State.gridRows && pt.c >= 0 && pt.c < State.gridCols) {
                    ctx.fillRect(ox + pt.c * sCS, oy + pt.r * sCS, sCS, sCS);
                }
            });
        }

        ctx.lineWidth = Math.max(2, sCS * 0.40);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        // Edge paths: micro-grid nodes at sCS pitch, no center offset.
        // Cell paths (legacy): root-grid cells at cSize pitch, +cSize/2 center offset.
        const pts      = p.nodes ?? p.points;
        const pixScale = p.nodes ? sCS : cSize;
        const pxOff    = p.nodes ? 0 : cSize / 2;

        const fullTrack = pts.map(pt => ({
            x: ox + pt.c * pixScale + pxOff,
            y: oy + pt.r * pixScale + pxOff
        }));

        let len = pts.length;
        let lastPt = pts[len - 1];
        let dr = 0, dc = 0;
        if (p.heading === "UP") dr = -1;
        if (p.heading === "DOWN") dr = 1;
        if (p.heading === "LEFT") dc = -1;
        if (p.heading === "RIGHT") dc = 1;

        for (let j = 1; j <= Math.max(State.gridRows, State.gridCols) + 2; j++) {
            fullTrack.push({
                x: ox + (lastPt.c + dc * j) * pixScale + pxOff,
                y: oy + (lastPt.r + dr * j) * pixScale + pxOff
            });
        }

        let drawPoints = [];
        let totalSegLen = len - 1;

        if (State.revealActive) {
            const N = State.paths.length;
            const staggerFactor = 0.4; // 40% of duration for delay stagger
            const startRatio = N > 1 ? (idx / (N - 1)) * staggerFactor : 0.0;
            const durationRatio = 1.0 - staggerFactor;
            
            let pProgress = 0.0;
            if (State.revealProgress > startRatio) {
                pProgress = Math.min(1.0, (State.revealProgress - startRatio) / durationRatio);
            }
            
            if (pProgress > 0.0) {
                drawPoints = getSubTrackPoints(fullTrack, 0, pProgress * totalSegLen);
            }
        } else if (p.state === "IDLE") {
            drawPoints = fullTrack.slice(0, len);
        } else {
            let dStart = p.animProgress;
            let dEnd = totalSegLen + p.animProgress;
            drawPoints = getSubTrackPoints(fullTrack, dStart, dEnd);
        }

        if (drawPoints.length >= 2) {
            ctx.save();
            if (isSelected && p.state !== "CRASHING") {
                ctx.shadowBlur = 8;
                ctx.shadowColor = "rgba(59, 130, 246, 0.4)";
            }

            ctx.beginPath();
            ctx.moveTo(drawPoints[0].x, drawPoints[0].y);
            for (let i = 1; i < drawPoints.length; i++) {
                ctx.lineTo(drawPoints[i].x, drawPoints[i].y);
            }
            ctx.strokeStyle = strokeColor;
            ctx.stroke();
            ctx.restore();


            let headPos = drawPoints[drawPoints.length - 1];
            let pyramidSize = Math.max(3.0, sCS * 0.32);
            drawChevronArrowHead(headPos.x, headPos.y, p.heading, pyramidSize, isSelected, p.state);
        }
    });

    ctx.restore(); // end board clip

    State.particles = State.particles.filter(pt => {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.alpha -= pt.decay;
        if (pt.alpha <= 0) return false;
        ctx.save();
        ctx.globalAlpha = pt.alpha;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return true;
    });

    ctx.restore();
}

function animationUpdateTick() {
    State.animatingCount = 0;

    State.paths.forEach(p => {
        if (p.state === "MOVING") {
            State.animatingCount++;
            p.animProgress += 0.26 * (State.subdivFactor || 1);

            if (p.nodes && State.nodeOwner) {
                // ── Node-based collision (node-Hamiltonian model) ─────────────
                const head = p.nodes[p.nodes.length - 1];
                let dr = 0, dc = 0;
                if (p.heading === "UP")    dr = -1;
                if (p.heading === "DOWN")  dr =  1;
                if (p.heading === "LEFT")  dc = -1;
                if (p.heading === "RIGHT") dc =  1;

                const steps = Math.round(p.animProgress);
                const leadR = head.r + dr * (steps + 1);
                const leadC = head.c + dc * (steps + 1);
                const _W    = State.gridCols + 1;

                if (leadR >= 0 && leadR <= State.gridRows &&
                    leadC >= 0 && leadC <= State.gridCols) {
                    const ownerId = State.nodeOwner[leadR * _W + leadC];
                    if (ownerId >= 0 && ownerId !== p.id) {
                        const ownerPath = State.paths.find(o => o.id === ownerId);
                        if (ownerPath &&
                            ownerPath.state !== "CLEARED" &&
                            ownerPath.state !== "MOVING") {
                            p.state = "CRASHING";
                            p.crashFlashFrames = 8;
                            AudioEngine.crash();
                            triggerCameraShake();
                            processFailurePenalty();
                        }
                    }
                }
            } else {
                // ── Cell-based collision (legacy / fallback) ──────────────────
                let head = p.points[p.points.length - 1];
                let dr = 0, dc = 0;
                if (p.heading === "UP") dr = -1;
                if (p.heading === "DOWN") dr = 1;
                if (p.heading === "LEFT") dc = -1;
                if (p.heading === "RIGHT") dc = 1;

                let leadingGridR = Math.round(head.r + dr * p.animProgress);
                let leadingGridC = Math.round(head.c + dc * p.animProgress);

                if (leadingGridR >= 0 && leadingGridR < State.gridRows && leadingGridC >= 0 && leadingGridC < State.gridCols) {
                    let hit = State.paths.some(other => {
                        if (other.id === p.id || other.state === "CLEARED" || other.state === "MOVING") return false;
                        let occupied = getPathOccupiedCells(other);
                        return occupied.some(opt => opt.r === leadingGridR && opt.c === leadingGridC);
                    });

                    let hitWall = (State.gridMask[leadingGridR]?.[leadingGridC] === -1);

                    if (hit || hitWall) {
                        p.state = "CRASHING";
                        p.crashFlashFrames = 8;
                        AudioEngine.crash();
                        triggerCameraShake();
                        processFailurePenalty();
                    }
                }
            }

            if (p.animProgress > Math.max(State.gridRows, State.gridCols) * 1.5) {
                p.state = "CLEARED";
                AudioEngine.clear();

                if (State.dailyPuzzleMode) {
                    State.dailyScore += 10;
                } else {
                    State.score += 10;
                    Persistence.saveState();
                }

                updateDomUI();
                checkVictoryConditionStates();
            }
        } else if (p.state === "CRASHING") {
            State.animatingCount++;
            if ((p.crashFlashFrames || 0) > 0) {
                p.crashFlashFrames--;
            } else {
                p.animProgress -= 0.16 * (State.subdivFactor || 1);
                if (p.animProgress <= 0) {
                    p.animProgress = 0;
                    p.state = "IDLE";
                }
            }
        }
    });

    drawEngine();
    requestAnimationFrame(animationUpdateTick);
}

// resize listener lives in camera.js
