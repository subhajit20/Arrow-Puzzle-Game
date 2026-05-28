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

    // Board background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ox, oy, cols * cSize, rows * cSize);

    // Dot grid — one dot per playable cell
    const dotR = Math.max(1, cSize * 0.07);
    ctx.fillStyle = "#c0c4cc";
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (State.gridMask[r]?.[c] === 1) {
                ctx.beginPath();
                ctx.arc(ox + c * cSize + cSize / 2, oy + r * cSize + cSize / 2, dotR, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, cols * cSize, rows * cSize);
    ctx.clip();

    State.paths.forEach((p, idx) => {
        if (p.state === "CLEARED") return;

        const isSelected = (State.selectedPath && State.selectedPath.id === p.id) || (State.hintPathId === p.id);

        let strokeColor = "#112540";
        if (p.state === "CRASHING") {
            strokeColor = "#ef4444";
        } else if (isSelected) {
            strokeColor = "#3b82f6";
        }

        if (p.state === "CRASHING" && (p.crashFlashFrames || 0) > 0) {
            ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
            p.points.forEach(pt => {
                if (pt.r >= 0 && pt.r < rows && pt.c >= 0 && pt.c < cols) {
                    ctx.fillRect(ox + pt.c * cSize, oy + pt.r * cSize, cSize, cSize);
                }
            });
        }

        ctx.lineWidth = Math.max(1, cSize * 0.08);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        const len = p.points.length;
        let dr = 0, dc = 0;
        if (p.heading === "UP")    dr = -1;
        if (p.heading === "DOWN")  dr =  1;
        if (p.heading === "LEFT")  dc = -1;
        if (p.heading === "RIGHT") dc =  1;

        let fullTrack = p.points.map(pt => ({
            x: ox + pt.c * cSize + cSize / 2,
            y: oy + pt.r * cSize + cSize / 2
        }));

        let drawPoints;
        if (State.revealActive) {
            const N = State.paths.length;
            const staggerFactor = 0.4;
            const startRatio = N > 1 ? (idx / (N - 1)) * staggerFactor : 0.0;
            const durationRatio = 1.0 - staggerFactor;
            let pProgress = 0.0;
            if (State.revealProgress > startRatio) {
                pProgress = Math.min(1.0, (State.revealProgress - startRatio) / durationRatio);
            }
            drawPoints = pProgress > 0.0
                ? getSubTrackPoints(fullTrack, 0, pProgress * (len - 1))
                : [];
        } else {
            drawPoints = fullTrack;
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

            if (p.state === "IDLE" && !State.revealActive) {
                const headCell = p.points[len - 1];
                let steps = 0;
                let cr = headCell.r + dr;
                let cc = headCell.c + dc;
                while (cr >= 0 && cr < rows && cc >= 0 && cc < cols && State.gridMask[cr]?.[cc] === 1) {
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

            const headPos = drawPoints[drawPoints.length - 1];
            drawChevronArrowHead(headPos.x, headPos.y, p.heading, Math.max(3.0, cSize * 0.32), isSelected, p.state);
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
        if (p.state === "CRASHING") {
            State.animatingCount++;
            if ((p.crashFlashFrames || 0) > 0) {
                p.crashFlashFrames--;
            } else {
                p.animProgress = 0;
                p.state = "IDLE";
            }
        }
    });

    drawEngine();
    requestAnimationFrame(animationUpdateTick);
}

// resize listener lives in camera.js
