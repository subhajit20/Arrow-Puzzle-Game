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

    const cSize = State.cellSize;
    const ox = State.offsetX;
    const oy = State.offsetY;

    const rows = State.gridRows;
    const cols = State.gridCols;

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(ox, oy, cols * cSize, rows * cSize);

    ctx.fillStyle = "#ffffff";
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (State.gridMask[r]?.[c] === 1) {
                ctx.fillRect(ox + c * cSize, oy + r * cSize, cSize, cSize);
            }
        }
    }

    ctx.fillStyle = "#f1f5f9";
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (State.gridMask[r]?.[c] === -1) {
                ctx.fillRect(ox + c * cSize + 1, oy + r * cSize + 1, cSize - 2, cSize - 2);
            }
        }
    }

    ctx.strokeStyle = State.gridSize > 30 ? "rgba(241, 245, 249, 0.4)" : "#f1f5f9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (State.gridMask[r]?.[c] === 1) {
                if (c === 0 || State.gridMask[r]?.[c - 1] !== 1) {
                    ctx.moveTo(ox + c * cSize, oy + r * cSize);
                    ctx.lineTo(ox + c * cSize, oy + (r + 1) * cSize);
                }
                ctx.moveTo(ox + (c + 1) * cSize, oy + r * cSize);
                ctx.lineTo(ox + (c + 1) * cSize, oy + (r + 1) * cSize);

                if (r === 0 || State.gridMask[r - 1]?.[c] !== 1) {
                    ctx.moveTo(ox + c * cSize, oy + r * cSize);
                    ctx.lineTo(ox + (c + 1) * cSize, oy + r * cSize);
                }
                ctx.moveTo(ox + c * cSize, oy + (r + 1) * cSize);
                ctx.lineTo(ox + (c + 1) * cSize, oy + (r + 1) * cSize);
            }
        }
    }
    ctx.stroke();

    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (State.gridMask[r]?.[c] === -1) {
                ctx.rect(ox + c * cSize + 1, oy + r * cSize + 1, cSize - 2, cSize - 2);
            }
        }
    }
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, cols * cSize, rows * cSize);
    ctx.clip();

    State.paths.forEach(p => {
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
                    ctx.fillRect(ox + pt.c * cSize, oy + pt.r * cSize, cSize, cSize);
                }
            });
        }

        ctx.lineWidth = Math.max(1, cSize * 0.08);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        let fullTrack = [];
        p.points.forEach(pt => {
            fullTrack.push({
                x: ox + pt.c * cSize + cSize / 2,
                y: oy + pt.r * cSize + cSize / 2
            });
        });

        let len = p.points.length;
        let lastPt = p.points[len - 1];
        let dr = 0, dc = 0;
        if (p.heading === "UP") dr = -1;
        if (p.heading === "DOWN") dr = 1;
        if (p.heading === "LEFT") dc = -1;
        if (p.heading === "RIGHT") dc = 1;

        for (let j = 1; j <= Math.max(State.gridRows, State.gridCols) + 2; j++) {
            fullTrack.push({
                x: ox + (lastPt.c + dc * j) * cSize + cSize / 2,
                y: oy + (lastPt.r + dr * j) * cSize + cSize / 2
            });
        }

        let drawPoints = [];
        let totalSegLen = len - 1;

        if (p.state === "IDLE") {
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

            if (p.state === "IDLE") {
                const headCell = p.points[p.points.length - 1];
                let steps = 0;
                let cr = headCell.r + dr;
                let cc = headCell.c + dc;
                while (cr >= 0 && cr < State.gridRows && cc >= 0 && cc < State.gridCols && State.gridMask[cr]?.[cc] !== -1) {
                    steps++;
                    cr += dr;
                    cc += dc;
                }
                if (steps > 0) {
                    const hx = ox + headCell.c * cSize + cSize / 2;
                    const hy = oy + headCell.r * cSize + cSize / 2;
                    ctx.save();
                    ctx.setLineDash([Math.max(2, cSize * 0.18), Math.max(2, cSize * 0.14)]);
                    ctx.lineWidth = Math.max(0.75, cSize * 0.045);
                    ctx.lineCap = "round";
                    ctx.strokeStyle = isSelected
                        ? "rgba(59, 130, 246, 0.55)"
                        : "rgba(17, 37, 64, 0.22)";
                    ctx.beginPath();
                    ctx.moveTo(hx, hy);
                    ctx.lineTo(hx + dc * steps * cSize, hy + dr * steps * cSize);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
            }

            let headPos = drawPoints[drawPoints.length - 1];
            let pyramidSize = Math.max(3.0, cSize * 0.32);
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
            p.animProgress += 0.26;

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
                p.animProgress -= 0.16;
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

window.addEventListener('resize', () => {
    resizeCanvas();
    drawEngine();
});
