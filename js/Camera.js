// =============================================================================
// Camera.js — Zoom, pan, and pixel metric management
//
// Owns all view-state:  cssZoom, matE, matF, cellSize, offsetX/Y, canvasW/H.
// The Renderer reads these values to position the board in canvas space.
// InputHandler calls onPinch/onScroll/onPan to update them.
//
// No dependency on global State — all grid dimensions are passed in.
// =============================================================================

class Camera {
    // Scale applied on top of the fit-to-screen cell size.
    // 1.0 = board fills viewport exactly; >1 = larger cells, board is pannable.
    static CELL_SCALE = 0.2;
    static MAX_ZOOM = 6.0;

    constructor(canvas) {
        this.canvas = canvas;

        // View state
        this.cssZoom = 1.0;
        this.matE = 0;      // horizontal pan offset (px)
        this.matF = 0;      // vertical pan offset (px)
        this.minZoom = 0.15;

        // Pixel metrics (set by calculateMetrics)
        this.cellSize = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.canvasW = 0;
        this.canvasH = 0;

        // Grid dimensions (set alongside calculateMetrics)
        this.gridRows = 0;
        this.gridCols = 0;

        // In-flight entrance animation request id
        this._animReq = null;
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    // Derives cellSize, canvasW/H, offsetX/Y from container size + grid dims.
    // Mobile: uses TRUE visible area (viewport − bars) to avoid overflow.
    // Desktop: uses container BCR directly.
    // Dynamic cell scale: small grids → small scale (0.2), large grids → full scale (1.0).
    // Interpolates linearly between the smallest and largest known grid sizes.
    static dynamicScale(gridRows, gridCols) {
        const nodes    = (gridRows + 1) * (gridCols + 1);
        const minNodes = 63;    // 8×6  (level 1 smallest grid)
        const maxNodes = 2806;  // 60×45 (level 76+ largest grid)
        const t = Math.max(0, Math.min(1, (nodes - minNodes) / (maxNodes - minNodes)));
        return 0.15 + t * 0.85;  // 0.15 → 1.0
    }

    calculateMetrics(containerW, containerH, gridRows, gridCols) {
        this.gridRows = gridRows;
        this.gridCols = gridCols;

        const scale    = Camera.dynamicScale(gridRows, gridCols);
        const isMobile = containerW < 768 && containerW < containerH;

        if (isMobile) {
            const header  = document.getElementById('game-header');
            const ctrls   = document.getElementById('game-controls');
            const topBarH = header ? header.getBoundingClientRect().height : 0;
            const botBarH = ctrls  ? ctrls.getBoundingClientRect().height  : 0;
            const PAD     = 4;

            const availW = containerW - PAD * 2;
            const availH = Math.max(20, window.innerHeight - topBarH - botBarH - PAD * 2);

            const cellByW = availW / gridCols;
            const cellByH = availH / gridRows;
            this.cellSize = Math.max(1, Math.min(cellByW, cellByH)) * scale;

            const boardW  = gridCols * this.cellSize;
            const boardH  = gridRows * this.cellSize;
            this.canvasW  = containerW;
            this.canvasH  = containerH;
            this.offsetX  = (containerW - boardW) / 2;

            const visibleH = Math.min(containerH, window.innerHeight - topBarH);
            this.offsetY   = Math.max(PAD, (visibleH - boardH) / 2);
        } else {
            this.cellSize = Math.min(
                containerW / gridCols,
                containerH / gridRows
            ) * scale;

            const boardW  = gridCols * this.cellSize;
            const boardH  = gridRows * this.cellSize;
            this.canvasW  = containerW;
            this.canvasH  = containerH;
            this.offsetX  = (containerW - boardW) / 2;
            this.offsetY  = (containerH - boardH) / 2;
        }
    }

    // ── Pan clamping ──────────────────────────────────────────────────────────

    // Clamps matE/matF so the board stays on screen with 1-cell overscroll.
    clampPan(containerEl) {
        if (!containerEl || !this.cellSize) return;

        this.cssZoom = Math.min(Camera.MAX_ZOOM, Math.max(this.minZoom, this.cssZoom));

        const bcr = containerEl.getBoundingClientRect();
        const isMobile = bcr.width < 768 && bcr.width < bcr.height;

        const boardW = this.gridCols * this.cellSize;
        const boardH = this.gridRows * this.cellSize;
        const os = this.cellSize * this.cssZoom; // overscroll = 1 cell

        // Horizontal
        const scaledW = boardW * this.cssZoom;
        if (scaledW <= bcr.width) {
            // Board narrower than container — centre it
            this.matE = (bcr.width - this.canvasW * this.cssZoom) / 2;
        } else {
            const maxE = -this.offsetX * this.cssZoom + os;
            const minE = bcr.width - (this.offsetX + boardW) * this.cssZoom - os;
            this.matE = Math.min(maxE, Math.max(minE, this.matE));
        }

        // Vertical
        const header = document.getElementById('game-header');
        const topBarH = header ? header.getBoundingClientRect().height : 0;
        const visibleH = isMobile
            ? Math.min(bcr.height, window.innerHeight - topBarH)
            : bcr.height;

        const scaledH = boardH * this.cssZoom;
        if (scaledH <= visibleH) {
            // Board shorter than visible area — centre it
            this.matF = visibleH / 2 - (this.offsetY + boardH / 2) * this.cssZoom;
        } else {
            const maxF = -this.offsetY * this.cssZoom + os;
            const minF = visibleH - (this.offsetY + boardH) * this.cssZoom - os;
            this.matF = Math.min(maxF, Math.max(minF, this.matF));
        }
    }

    // ── Transform ─────────────────────────────────────────────────────────────

    // Call before each draw frame to set ctx.translate + ctx.scale.
    // Returns { zoom, dx, dy } for the Renderer to use.
    getTransform() {
        return { zoom: this.cssZoom, dx: this.matE, dy: this.matF };
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    reset() {
        if (this._animReq) {
            cancelAnimationFrame(this._animReq);
            this._animReq = null;
        }
        this.cssZoom = 1.0;
        this.matE = 0;
        this.matF = 0;
    }

    // ── Entrance animation ────────────────────────────────────────────────────

    // Zooms from fitZoom → 1.65 over ~1100ms (cubic ease-in-out).
    // onComplete (optional) — called when the animation finishes.
    startEntranceAnimation(containerEl, onComplete) {
        if (this._animReq) { cancelAnimationFrame(this._animReq); this._animReq = null; }
        if (!containerEl || !this.cellSize) { this.reset(); if (onComplete) onComplete(); return; }

        const bcr = containerEl.getBoundingClientRect();
        const isMobile = bcr.width < 768 && bcr.width < bcr.height;
        const isLargeBoard = this.gridRows >= 36 || this.gridCols >= 22;
        if (!isMobile || !isLargeBoard) { this.reset(); if (onComplete) onComplete(); return; }

        const header = document.getElementById('game-header');
        const ctrls = document.getElementById('game-controls');
        const topBarH = header ? header.getBoundingClientRect().height : 0;
        const botBarH = ctrls ? ctrls.getBoundingClientRect().height : 0;
        const PAD = 4;
        const visibleH = Math.min(bcr.height, window.innerHeight - topBarH);
        const usableW = bcr.width - PAD * 2;
        const usableH = Math.max(20, visibleH - botBarH - PAD * 2);

        const boardW = this.gridCols * this.cellSize;
        const boardH = this.gridRows * this.cellSize;

        this.minZoom = 0.15;

        // Board centre in canvas space — fixed regardless of zoom level.
        const boardCX = this.offsetX + boardW / 2;
        const boardCY = this.offsetY + boardH / 2;

        // Screen centre
        const screenCX = bcr.width / 2;
        const screenCY = visibleH / 2;

        // matE/matF that keeps the board centre on the screen centre at zoom z.
        const centredMat = z => ({
            e: screenCX - boardCX * z,
            f: screenCY - boardCY * z,
        });

        // Start: zoomed out overview (board fully visible)
        const startZ = Math.min(
            (usableW * 0.85) / boardW,
            (usableH * 0.85) / boardH,
            0.45
        );
        const { e: startE, f: startF } = centredMat(startZ);

        // Target: zoomed in deep to centre
        const targetZ = 1.3;
        const { e: targetE, f: targetF } = centredMat(targetZ);

        // Snap to start position immediately
        this.cssZoom = startZ; this.matE = startE; this.matF = startF;

        const ANIM_MS = 1400;
        const t0 = performance.now();
        const self = this;

        const step = now => {
            const p = Math.min(1.0, (now - t0) / ANIM_MS);
            const t = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            self.cssZoom = startZ + (targetZ - startZ) * t;
            self.matE = startE + (targetE - startE) * t;
            self.matF = startF + (targetF - startF) * t;
            if (p < 1.0) { self._animReq = requestAnimationFrame(step); }
            else {
                self.cssZoom = targetZ;
                self.matE = targetE;
                self.matF = targetF;
                self._animReq = null;
                if (onComplete) onComplete();
            }
        };
        this._animReq = requestAnimationFrame(step);
    }

    // ── Input events ──────────────────────────────────────────────────────────

    onPinch(newZoom, originX, originY, containerEl) {
        const before = this.cssZoom;
        this.cssZoom = Math.min(Camera.MAX_ZOOM, Math.max(this.minZoom, newZoom));
        const ratio = this.cssZoom / before;
        this.matE = originX - (originX - this.matE) * ratio;
        this.matF = originY - (originY - this.matF) * ratio;
        this.clampPan(containerEl);
    }

    onScroll(delta, x, y, containerEl) {
        const factor = delta > 0 ? 0.92 : 1.08;
        const before = this.cssZoom;
        this.cssZoom = Math.min(Camera.MAX_ZOOM, Math.max(this.minZoom, this.cssZoom * factor));
        const ratio = this.cssZoom / before;
        this.matE = x - (x - this.matE) * ratio;
        this.matF = y - (y - this.matF) * ratio;
        this.clampPan(containerEl);
    }

    onPan(dx, dy, containerEl) {
        this.matE += dx;
        this.matF += dy;
        this.clampPan(containerEl);
    }
}
