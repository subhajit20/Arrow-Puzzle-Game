// =============================================================================
// Renderer.js — Canvas 2D draw engine
//
// Owns the canvas context and all drawing logic.
// Reads view state from Camera; reads board data from the board object passed
// into drawFrame — no dependency on global State.
//
// Dependencies: Camera
// =============================================================================

class Renderer {
    static DIFFICULTY_COLORS = {
        EASY: '#10b981',
        NORMAL: '#3b82f6',
        HARD: '#f97316',
        EXPERT: '#a855f7',
        TITAN: '#ec4899',
    };

    constructor(canvas, camera) {
        this.canvas = canvas;
        this.camera = camera;
        this.ctx = canvas.getContext('2d');
        this._dpr = window.devicePixelRatio || 1;
    }

    // ── DOM utility ───────────────────────────────────────────────────────────

    static getDifficultyLabel(difficulty) {
        const diff = difficulty || 'NORMAL';
        const color = Renderer.DIFFICULTY_COLORS[diff] || '#3b82f6';
        return { label: diff, color };
    }

    // Updates level, score, lives and tier badge DOM elements.
    updateDomUI(gameState) {
        const lvl = document.getElementById('level-display');
        if (lvl) {
            lvl.innerText = gameState.dailyMode ? 'Daily Puzzle' : `Level ${gameState.level}`;
        }

        // Left-side counter: arrow clicks (paths) still needed to clear the board.
        const remaining = document.getElementById('paths-remaining');
        if (remaining) remaining.innerText = gameState.pathsRemaining ?? 0;

        const badge = document.getElementById('tier-badge');
        if (badge) {
            if (gameState.dailyMode) {
                const options = { month: 'short', day: 'numeric', year: 'numeric' };
                badge.innerText = new Date().toLocaleDateString('en-US', options).toUpperCase();
                badge.style.color = '#d97706';
            } else {
                const d = Renderer.getDifficultyLabel(gameState.difficulty);
                badge.innerText = d.label;
                badge.style.color = d.color;
            }
        }

        for (let i = 1; i <= 3; i++) {
            const el = document.getElementById(`heart-${i}`);
            if (!el) continue;
            if (i <= gameState.lives) {
                el.style.opacity = '1';
                el.style.transform = 'scale(1)';
            } else {
                el.style.opacity = '0.15';
                el.style.transform = 'scale(0.85)';
            }
        }
    }

    // ── Canvas resize ─────────────────────────────────────────────────────────

    resize(containerEl, gridRows, gridCols) {
        const bcr = containerEl.getBoundingClientRect();
        this.camera.calculateMetrics(bcr.width, bcr.height, gridRows, gridCols);
        this._dpr = window.devicePixelRatio || 1;

        this.canvas.width = Math.round(this.camera.canvasW * this._dpr);
        this.canvas.height = Math.round(this.camera.canvasH * this._dpr);
        this.canvas.style.width = this.camera.canvasW + 'px';
        this.canvas.style.height = this.camera.canvasH + 'px';
        this.canvas.style.alignSelf = 'flex-start';

        this.ctx.scale(this._dpr, this._dpr);
        this.camera.clampPan(containerEl);
    }

    // ── Track interpolation ───────────────────────────────────────────────────

    _getTrackPoint(track, d) {
        if (d <= 0) return track[0];
        if (d >= track.length - 1) return track[track.length - 1];
        const idx = Math.floor(d);
        const frac = d - idx;
        const p1 = track[idx], p2 = track[idx + 1];
        return { x: p1.x + (p2.x - p1.x) * frac, y: p1.y + (p2.y - p1.y) * frac };
    }

    _getSubTrackPoints(track, dStart, dEnd) {
        const pts = [];
        if (dStart < 0) dStart = 0;
        if (dEnd > track.length - 1) dEnd = track.length - 1;
        if (dStart >= dEnd) return pts;

        pts.push(this._getTrackPoint(track, dStart));
        for (let i = Math.ceil(dStart); i <= Math.floor(dEnd); i++) pts.push(track[i]);
        pts.push(this._getTrackPoint(track, dEnd));
        return pts;
    }

    // ── Arrow head ────────────────────────────────────────────────────────────

    drawArrowHead(x, y, heading, size, isSelected, pathState) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y);

        let angle = 0;
        if (heading === 'UP') angle = -Math.PI / 2;
        if (heading === 'DOWN') angle = Math.PI / 2;
        if (heading === 'LEFT') angle = Math.PI;
        ctx.rotate(angle);

        let fillTop, fillBot, stroke;
        if (pathState === 'CRASHING') {
            fillTop = '#f87171'; fillBot = '#b91c1c'; stroke = '#7f1d1d';
        } else if (isSelected || pathState === 'MOVING') {
            fillTop = '#60a5fa'; fillBot = '#1d4ed8'; stroke = '#1e3a8a';
        } else {
            fillTop = '#112540'; fillBot = '#112540'; stroke = '#112540';
        }

        const lw = Math.max(1.0, size * 0.08);
        ctx.lineJoin = 'round';

        // Top half
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, -size * 0.58); ctx.lineTo(size, 0);
        ctx.closePath();
        ctx.fillStyle = fillTop; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();

        // Bottom half
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, size * 0.58); ctx.lineTo(size, 0);
        ctx.closePath();
        ctx.fillStyle = fillBot; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();

        ctx.restore();
    }

    // ── Grid dots ─────────────────────────────────────────────────────────────

    drawGrid(grid, mask) {
        const ctx = this.ctx;
        const cSize = this.camera.cellSize;
        const ox = this.camera.offsetX;
        const oy = this.camera.offsetY;
        const rows = grid.rows;
        const cols = grid.cols;
        const bmW = cols + 1;
        const dotR = Math.max(0.8, cSize * 0.07);

        ctx.fillStyle = '#cbd5e1';
        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                if (mask && !mask[r * bmW + c]) continue;
                ctx.beginPath();
                ctx.arc(ox + c * cSize, oy + r * cSize, dotR, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ── Single path ───────────────────────────────────────────────────────────

    drawPath(path, revealState, selectedId, hintId) {
        const ctx = this.ctx;
        const cSize = this.camera.cellSize;
        const ox = this.camera.offsetX;
        const oy = this.camera.offsetY;
        if (path.state === 'CLEARED') return;

        const isSelected = selectedId === path.id || hintId === path.id;

        // Blue from tap through the whole flight; red only on collision.
        // Color follows state (not selectedPathId) so it survives the
        // selection being cleared when the path fires.
        let strokeColor = '#112540';
        if (path.state === 'CRASHING') strokeColor = '#ef4444';
        else if (isSelected || path.state === 'MOVING') strokeColor = '#3b82f6';

        // Crash flash cell overlay
        if (path.state === 'CRASHING' && (path.crashFlashFrames || 0) > 0) {
            ctx.fillStyle = 'rgba(239,68,68,0.35)';
            const seen = new Set();
            for (const { r, c } of path.nodes) {
                const key = r + ',' + c;
                if (!seen.has(key)) {
                    seen.add(key);
                    ctx.fillRect(ox + c * cSize, oy + r * cSize, cSize, cSize);
                }
            }
        }

        const len = path.nodes.length;
        const headPt = path.nodes[len - 1];
        const { dr, dc } = Path.headingToDelta(path.heading);

        // Build full track (nodes + extension beyond head for animation).
        // ext must be large enough to cover the full off-screen exit journey —
        // 4× the larger grid dimension ensures the track reaches the screen edge.
        const fullTrack = path.nodes.map(pt => ({
            x: ox + pt.c * cSize,
            y: oy + pt.r * cSize,
        }));
        const gridMax = Math.max(this.camera.gridRows, this.camera.gridCols);
        const ext = Math.max(gridMax * 4, len * 2);
        for (let j = 1; j <= ext; j++) {
            fullTrack.push({
                x: ox + (headPt.c + dc * j) * cSize,
                y: oy + (headPt.r + dr * j) * cSize,
            });
        }

        // Compute draw window
        let drawPoints = [];
        const totalSeg = len - 1;

        if (revealState && revealState.active) {
            const { progress, pathCount, pathIndex } = revealState;
            const sf = 0.4;
            const startR = pathCount > 1 ? (pathIndex / (pathCount - 1)) * sf : 0;
            const durR = 1 - sf;
            const p = progress > startR
                ? Math.min(1, (progress - startR) / durR) : 0;
            if (p > 0) drawPoints = this._getSubTrackPoints(fullTrack, 0, p * totalSeg);
        } else if (path.state === 'IDLE') {
            drawPoints = fullTrack.slice(0, len);
        } else if (path.state === 'MOVING') {
            // Elastic rope: head races ahead, tail follows with spring lag.
            // spring = 0 when head just started, → 1 as head travels far.
            // This creates a stretch-then-settle feel — body pulled behind the head.
            const head = path.animProgress;
            const spring = 1.0 - Math.exp(-head * 1.6);  // exponential spring
            const tail = head * spring;                  // tail lags behind
            drawPoints = this._getSubTrackPoints(fullTrack, tail, totalSeg + head);
        } else {
            // CRASHING — uniform retract
            const dStart = path.animProgress;
            const dEnd = totalSeg + path.animProgress;
            drawPoints = this._getSubTrackPoints(fullTrack, dStart, dEnd);
        }

        if (drawPoints.length < 2) return;

        ctx.save();
        // Dynamic line width: thicker on small grids, thicker floor on large grids.
        const _nodes = (this.camera.gridRows + 1) * (this.camera.gridCols + 1);
        const _t = Math.max(0, Math.min(1, (_nodes - 63) / (2806 - 63)));
        const _lwMult = 0.16 - _t * 0.04;  // 0.16 (small) → 0.12 (large)
        const _lwMin = 1.6 + _t * 0.4;   // 1.6  (small) → 2.0  (large)
        ctx.lineWidth = Math.max(_lwMin, cSize * _lwMult);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        if ((isSelected || path.state === 'MOVING') && path.state !== 'CRASHING') {
            ctx.shadowBlur = 8;
            ctx.shadowColor = 'rgba(59,130,246,0.4)';
        }

        // Draw with rounded corners: at each turn, use a quadratic bezier
        // that approaches the corner, curves around it, and exits cleanly.
        const pts = drawPoints;
        const radius = cSize * 0.02; // rounding radius — fraction of one cell (lower = sharper bends)

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);

        for (let i = 1; i < pts.length - 1; i++) {
            const prev = pts[i - 1], curr = pts[i], next = pts[i + 1];

            const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
            const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

            // Only round genuine turns (cross product ≠ 0 → direction changed)
            const cross = dx1 * dy2 - dy1 * dx2;
            if (Math.abs(cross) > 0.01 && len1 > 0 && len2 > 0) {
                const rr = Math.min(radius, len1 / 2, len2 / 2);
                const inX = curr.x - (dx1 / len1) * rr;
                const inY = curr.y - (dy1 / len1) * rr;
                const outX = curr.x + (dx2 / len2) * rr;
                const outY = curr.y + (dy2 / len2) * rr;
                ctx.lineTo(inX, inY);
                ctx.quadraticCurveTo(curr.x, curr.y, outX, outY);
            } else {
                ctx.lineTo(curr.x, curr.y);
            }
        }

        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
        ctx.restore();

        // Arrowhead position rules:
        //   IDLE (no reveal)  → fixed end node (stable, centred on node)
        //   REVEAL active     → front of growing reveal path (tracks drawPoints)
        //   MOVING            → front of elastic rope (tracks drawPoints)
        //   CRASHING          → front of retracting path (tracks drawPoints)
        // Arrowhead size: larger multiplier on bigger grids so heads stay visible.
        const _nodes2 = (this.camera.gridRows + 1) * (this.camera.gridCols + 1);
        const _t2 = Math.max(0, Math.min(1, (_nodes2 - 63) / (2806 - 63)));
        const _aMult = 0.37 + _t2 * 0.13;  // 0.37 (small) → 0.50 (large)
        const aSize = Math.max(3.2, cSize * _aMult);
        let hx, hy;
        if (path.state === 'IDLE' && !(revealState && revealState.active)) {
            const headNode = path.nodes[path.nodes.length - 1];
            hx = ox + headNode.c * cSize;
            hy = oy + headNode.r * cSize;
        } else {
            // Reveal, MOVING, CRASHING — follow the front of drawPoints
            const front = drawPoints[drawPoints.length - 1];
            hx = front.x; hy = front.y;
        }
        this.drawArrowHead(hx, hy, path.heading, aSize, isSelected, path.state);
    }

    // ── Confetti ──────────────────────────────────────────────────────────────

    drawConfetti(particles) {
        const ctx = this.ctx;
        const remaining = [];
        for (const pt of particles) {
            pt.x += pt.vx; pt.y += pt.vy; pt.alpha -= pt.decay;
            if (pt.alpha <= 0) continue;
            ctx.save();
            ctx.globalAlpha = pt.alpha;
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            remaining.push(pt);
        }
        // Mutate in place so AnimationEngine's reference stays valid
        particles.length = 0;
        for (const pt of remaining) particles.push(pt);
    }

    // ── Full frame ────────────────────────────────────────────────────────────

    // board: { grid, paths, mask }
    // gameState: { selectedPathId, hintPathId, revealState, particles }
    drawFrame(board, gameState = {}) {
        const ctx = this.ctx;
        const cam = this.camera;
        const cSize = cam.cellSize;
        const ox = cam.offsetX;
        const oy = cam.offsetY;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.save();
        ctx.translate(cam.matE, cam.matF);
        ctx.scale(cam.cssZoom, cam.cssZoom);

        // Resolve mask — board.mask is canonical; fall back to grid.mask so
        // persistence-loaded boards (which set mask:null on the board object
        // but keep grid.mask intact) still render the correct shape.
        const mask = board.mask ?? board.grid?.mask ?? null;

        // White board background — respects mask shape.
        // With no mask: single fillRect for the full rectangle.
        // With a mask: fill only active node areas so the shape is visible.
        ctx.fillStyle = '#ffffff';
        if (!mask) {
            ctx.fillRect(ox, oy, board.grid.cols * cSize, board.grid.rows * cSize);
        } else {
            const rows = board.grid.rows, cols = board.grid.cols;
            const W = cols + 1;
            const half = cSize * 0.5;
            for (let r = 0; r <= rows; r++) {
                for (let c = 0; c <= cols; c++) {
                    if (!mask[r * W + c]) continue;
                    ctx.fillRect(
                        ox + c * cSize - half,
                        oy + r * cSize - half,
                        cSize, cSize
                    );
                }
            }
        }

        // Grid dots — only active nodes drawn when mask is present
        this.drawGrid(board.grid, mask);

        // Draw each path — no clip so MOVING paths fly off screen during exit.
        // The canvas boundary acts as the natural outer clip.
        const paths = board.paths || [];
        paths.forEach((p, idx) => {
            this.drawPath(p, gameState.revealState
                ? { ...gameState.revealState, pathIndex: idx, pathCount: paths.length }
                : null,
                gameState.selectedPathId,
                gameState.hintPathId
            );
        });

        // Confetti (no clip — can extend outside board area)
        if (gameState.particles && gameState.particles.length > 0)
            this.drawConfetti(gameState.particles);

        ctx.restore(); // end camera transform
    }
}
