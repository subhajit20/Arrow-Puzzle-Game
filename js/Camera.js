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
    static CELL_SCALE = 0.8;
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
    calculateMetrics(containerW, containerH, gridRows, gridCols) {
        this.gridRows = gridRows;
        this.gridCols = gridCols;

        const isMobile = containerW < 768 && containerW < containerH;

        if (isMobile) {
            const header = document.getElementById('game-header');
            const ctrls = document.getElementById('game-controls');
            const topBarH = header ? header.getBoundingClientRect().height : 0;
            const botBarH = ctrls ? ctrls.getBoundingClientRect().height : 0;
            const PAD = 4;

            const availW = containerW - PAD * 2;
            const availH = Math.max(20, window.innerHeight - topBarH - botBarH - PAD * 2);

            const cellByW = availW / gridCols;
            const cellByH = availH / gridRows;
            this.cellSize = Math.max(1, Math.min(cellByW, cellByH)) * Camera.CELL_SCALE;

            const boardW = gridCols * this.cellSize;
            const boardH = gridRows * this.cellSize;
            this.canvasW = containerW;
            this.canvasH = containerH;
            this.offsetX = (containerW - boardW) / 2;

            const visibleH = Math.min(containerH, window.innerHeight - topBarH);
            this.offsetY = Math.max(PAD, (visibleH - boardH) / 2);
        } else {
            this.cellSize = Math.min(
                containerW / gridCols,
                containerH / gridRows
            ) * Camera.CELL_SCALE;

            const boardW = gridCols * this.cellSize;
            const boardH = gridRows * this.cellSize;
            this.canvasW = containerW;
            this.canvasH = containerH;
            this.offsetX = (containerW - boardW) / 2;
            this.offsetY = (containerH - boardH) / 2;
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
    startEntranceAnimation(containerEl) {
        if (this._animReq) { cancelAnimationFrame(this._animReq); this._animReq = null; }
        if (!containerEl || !this.cellSize) { this.reset(); return; }

        const bcr = containerEl.getBoundingClientRect();
        const isMobile = bcr.width < 768 && bcr.width < bcr.height;
        if (!isMobile) { this.reset(); return; }

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

        const fitZoom = Math.min(
            (usableW * 0.88) / boardW,
            (usableH * 0.88) / boardH,
            1.0
        );
        this.minZoom = Math.max(fitZoom * 0.40, 0.08);

        if (fitZoom >= 0.96) { this.minZoom = 0.25; this.reset(); return; }

        // Snap to fit
        this.cssZoom = fitZoom; this.matE = 0; this.matF = 0;
        this.clampPan(containerEl);
        const startZ = this.cssZoom, startE = this.matE, startF = this.matF;

        // Compute target position (centred at targetZ)
        const targetZ = 1.65;
        this.cssZoom = targetZ;
        this.matE = bcr.width / 2 - (this.offsetX + boardW / 2) * targetZ;
        this.matF = visibleH / 2 - (this.offsetY + boardH / 2) * targetZ;
        this.clampPan(containerEl);
        const targetE = this.matE, targetF = this.matF;

        // Restore start and animate
        this.cssZoom = startZ; this.matE = startE; this.matF = startF;

        const ANIM_MS = 1100;
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
                self.cssZoom = targetZ; self.matE = targetE; self.matF = targetF;
                self.clampPan(containerEl); self._animReq = null;
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
