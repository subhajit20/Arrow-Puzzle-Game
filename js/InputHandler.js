// =============================================================================
// InputHandler.js — Touch, mouse, and scroll input → Camera + GameController
//
// Handles:
//   Touch: single-finger pan, two-finger pinch-zoom, tap-to-fire
//   Mouse: drag-to-pan, click-to-fire, wheel-to-zoom
//   Hover: edge-based path highlight on desktop
//
// All coordinate math happens in canvas space (adjusted for camera transform).
// Dependencies: Camera, GameController
// =============================================================================

class InputHandler {
    constructor(canvas, camera, gameController) {
        this.canvas         = canvas;
        this.camera         = camera;
        this.gc             = gameController;
        this.containerEl    = null; // set in attach()

        // Touch state
        this._touchMode      = 'none'; // 'none' | 'pan' | 'pinch'
        this._lastTX         = 0;
        this._lastTY         = 0;
        this._startDist      = 0;
        this._startZoom      = 1;
        this._pinchAnchorX   = 0;
        this._pinchAnchorY   = 0;
        this._tapStartX      = 0;
        this._tapStartY      = 0;
        this._tapClientX     = 0;
        this._tapClientY     = 0;
        this._tapTime        = 0;
        this._ignoreTap      = false;

        // Tap cooldown — prevents rapid double-tap from firing two paths
        this._lastTapFiredAt = 0;

        // Mouse state
        this._mouseDown      = false;
        this._lastMX         = 0;
        this._lastMY         = 0;
        this._clickStartX    = 0;
        this._clickStartY    = 0;
        this._clickTime      = 0;

        // Bound handlers (kept so detach() can remove the exact same reference)
        this._onTouchStart   = this._handleTouchStart.bind(this);
        this._onTouchMove    = this._handleTouchMove.bind(this);
        this._onTouchEnd     = this._handleTouchEnd.bind(this);
        this._onMouseDown    = this._handleMouseDown.bind(this);
        this._onMouseMove    = this._handleMouseMove.bind(this);
        this._onMouseUp      = this._handleMouseUp.bind(this);
        this._onWheel        = this._handleWheel.bind(this);
    }

    // ── Attach / Detach ───────────────────────────────────────────────────────

    attach(containerEl) {
        this.containerEl = containerEl;
        this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove',  this._onTouchMove,  { passive: false });
        this.canvas.addEventListener('touchend',   this._onTouchEnd,   { passive: false });
        this.canvas.addEventListener('mousedown',  this._onMouseDown);
        this.canvas.addEventListener('mousemove',  this._onMouseMove);
        this.canvas.addEventListener('wheel',      this._onWheel,      { passive: false });
        window.addEventListener('mouseup',         this._onMouseUp);
    }

    detach() {
        this.canvas.removeEventListener('touchstart', this._onTouchStart);
        this.canvas.removeEventListener('touchmove',  this._onTouchMove);
        this.canvas.removeEventListener('touchend',   this._onTouchEnd);
        this.canvas.removeEventListener('mousedown',  this._onMouseDown);
        this.canvas.removeEventListener('mousemove',  this._onMouseMove);
        this.canvas.removeEventListener('wheel',      this._onWheel);
        window.removeEventListener('mouseup',         this._onMouseUp);
    }

    // ── Coordinate helpers ────────────────────────────────────────────────────

    _canvasCoords(clientX, clientY) {
        const bcr = this.containerEl.getBoundingClientRect();
        return {
            x: (clientX - bcr.left  - this.camera.matE) / this.camera.cssZoom,
            y: (clientY - bcr.top   - this.camera.matF) / this.camera.cssZoom,
        };
    }

    _containerOffset(clientX, clientY) {
        const bcr = this.containerEl.getBoundingClientRect();
        return { x: clientX - bcr.left, y: clientY - bcr.top };
    }

    // ── Hit test ──────────────────────────────────────────────────────────────

    // Finds the nearest IDLE path within hitRadius canvas px.
    // Checks both edge midpoints AND the head node (arrowhead position) so
    // tapping the arrowhead tip — the most natural target — is always precise.
    // Only IDLE paths participate; MOVING/CRASHING edges are ignored entirely
    // so they cannot shadow a valid tap on a nearby IDLE path.
    hitTest(canvasX, canvasY) {
        const board = this.gc.board;
        if (!board || !board.grid) return null;

        const grid  = board.grid;
        const cSize = this.camera.cellSize;
        const ox    = this.camera.offsetX;
        const oy    = this.camera.offsetY;
        const hitR  = cSize * 0.7;
        const paths = board.paths || [];

        const byId     = new Map(paths.map(p => [p.id, p]));
        const idleSet  = new Set(paths.filter(p => p.state === 'IDLE').map(p => p.id));

        let bestDist = hitR, bestId = -1;

        // Horizontal edge midpoints — IDLE owners only
        for (let r = 0; r <= grid.rows; r++) {
            for (let c = 0; c < grid.cols; c++) {
                const owner = grid.hEdge[r][c];
                if (!idleSet.has(owner)) continue;
                const d = Math.hypot(
                    canvasX - (ox + (c + 0.5) * cSize),
                    canvasY - (oy + r * cSize)
                );
                if (d < bestDist) { bestDist = d; bestId = owner; }
            }
        }

        // Vertical edge midpoints — IDLE owners only
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c <= grid.cols; c++) {
                const owner = grid.vEdge[r][c];
                if (!idleSet.has(owner)) continue;
                const d = Math.hypot(
                    canvasX - (ox + c * cSize),
                    canvasY - (oy + (r + 0.5) * cSize)
                );
                if (d < bestDist) { bestDist = d; bestId = owner; }
            }
        }

        // Head node (arrowhead tip) — the primary visual tap target
        for (const p of paths) {
            if (p.state !== 'IDLE') continue;
            const head = p.nodes[p.nodes.length - 1];
            const d = Math.hypot(
                canvasX - (ox + head.c * cSize),
                canvasY - (oy + head.r * cSize)
            );
            if (d < bestDist) { bestDist = d; bestId = p.id; }
        }

        if (bestId < 0) return null;
        return byId.get(bestId) || null;
    }

    // ── Tap / Click ───────────────────────────────────────────────────────────

    onTap(canvasX, canvasY) {
        if (this.gc.isWinState || this.gc.isFailState) return;

        // Ignore taps within 150ms of the last fired tap — prevents rapid
        // double-tap from queuing two setTimeout callbacks and firing two paths.
        const now = Date.now();
        if (now - this._lastTapFiredAt < 150) return;

        const path = this.hitTest(canvasX, canvasY);
        if (!path) return;

        this._lastTapFiredAt = now;
        this.gc.audio.playTap();
        this.gc.selectedPathId = path.id;

        // Brief visual flash before firing (120ms)
        setTimeout(() => {
            if (path.state === 'IDLE') {
                path.state              = 'MOVING';
                this.gc.selectedPathId  = null;
            }
        }, 120);
    }

    // ── Touch handlers ────────────────────────────────────────────────────────

    _handleTouchStart(e) {
        if (this.gc.revealActive) { e.preventDefault(); return; }
        this.gc.audio.init();
        if (this.camera._animReq) {
            cancelAnimationFrame(this.camera._animReq);
            this.camera._animReq = null;
        }
        if (this.gc.isWinState || this.gc.isFailState) return;

        if (e.touches.length === 1) {
            this._ignoreTap   = false;
            this._touchMode   = 'pan';
            this._lastTX      = e.touches[0].clientX;
            this._lastTY      = e.touches[0].clientY;
            const coords      = this._canvasCoords(this._lastTX, this._lastTY);
            this._tapStartX   = coords.x;
            this._tapStartY   = coords.y;
            this._tapClientX  = this._lastTX;
            this._tapClientY  = this._lastTY;
            this._tapTime     = Date.now();

        } else if (e.touches.length === 2) {
            this._touchMode   = 'pinch';
            const o1 = this._containerOffset(e.touches[0].clientX, e.touches[0].clientY);
            const o2 = this._containerOffset(e.touches[1].clientX, e.touches[1].clientY);
            this._startDist   = Math.hypot(o1.x - o2.x, o1.y - o2.y);
            this._startZoom   = this.camera.cssZoom;
            const midX        = (o1.x + o2.x) / 2;
            const midY        = (o1.y + o2.y) / 2;
            this._pinchAnchorX = (midX - this.camera.matE) / this.camera.cssZoom;
            this._pinchAnchorY = (midY - this.camera.matF) / this.camera.cssZoom;
        }
        e.preventDefault();
    }

    _handleTouchMove(e) {
        if (this.gc.isWinState || this.gc.isFailState) return;

        if (e.touches.length === 1 && this._touchMode === 'pan') {
            const dx = e.touches[0].clientX - this._lastTX;
            const dy = e.touches[0].clientY - this._lastTY;
            this._lastTX = e.touches[0].clientX;
            this._lastTY = e.touches[0].clientY;
            this.camera.onPan(dx, dy, this.containerEl);

        } else if (e.touches.length === 2 && this._touchMode === 'pinch') {
            const o1 = this._containerOffset(e.touches[0].clientX, e.touches[0].clientY);
            const o2 = this._containerOffset(e.touches[1].clientX, e.touches[1].clientY);
            const cur = Math.hypot(o1.x - o2.x, o1.y - o2.y);
            if (this._startDist > 0 && cur > 0) {
                const newZoom = this._startZoom * cur / this._startDist;
                const midX    = (o1.x + o2.x) / 2;
                const midY    = (o1.y + o2.y) / 2;
                this.camera.cssZoom = newZoom;
                this.camera.matE    = midX - newZoom * this._pinchAnchorX;
                this.camera.matF    = midY - newZoom * this._pinchAnchorY;
                this.camera.clampPan(this.containerEl);
            }
        }
        e.preventDefault();
    }

    _handleTouchEnd(e) {
        if (this.gc.isWinState || this.gc.isFailState) return;

        if (this._touchMode === 'pan') {
            const released  = e.changedTouches[0];
            const duration  = Date.now() - this._tapTime;
            const distMoved = Math.hypot(
                released.clientX - this._tapClientX,
                released.clientY - this._tapClientY
            );
            if (!this._ignoreTap && duration < 250 && distMoved < 15)
                this.onTap(this._tapStartX, this._tapStartY);
        }

        this._touchMode = e.touches.length === 0 ? 'none' : 'pan';
        if (e.touches.length === 1) {
            this._lastTX = e.touches[0].clientX;
            this._lastTY = e.touches[0].clientY;
        }
        e.preventDefault();
    }

    // ── Mouse handlers ────────────────────────────────────────────────────────

    _handleMouseDown(e) {
        if (this.gc.revealActive) { e.preventDefault(); return; }
        this.gc.audio.init();
        if (this.camera._animReq) {
            cancelAnimationFrame(this.camera._animReq);
            this.camera._animReq = null;
        }
        if (this.gc.isWinState || this.gc.isFailState) return;

        this._mouseDown   = true;
        this._lastMX      = e.clientX;
        this._lastMY      = e.clientY;
        const coords      = this._canvasCoords(e.clientX, e.clientY);
        this._clickStartX = coords.x;
        this._clickStartY = coords.y;
        this._clickTime   = Date.now();
    }

    _handleMouseMove(e) {
        if (this.gc.isWinState || this.gc.isFailState) return;

        // Hover highlight
        const coords = this._canvasCoords(e.clientX, e.clientY);
        const hovered = this.hitTest(coords.x, coords.y);
        this.gc.selectedPathId = hovered ? hovered.id : null;

        // Drag pan
        if (this._mouseDown) {
            this.camera.onPan(e.clientX - this._lastMX, e.clientY - this._lastMY, this.containerEl);
            this._lastMX = e.clientX;
            this._lastMY = e.clientY;
        }
    }

    _handleMouseUp(e) {
        if (!this._mouseDown) return;
        this._mouseDown = false;
        if (Date.now() - this._clickTime < 250)
            this.onTap(this._clickStartX, this._clickStartY);
    }

    _handleWheel(e) {
        e.preventDefault();
        if (this.gc.revealActive || this.gc.isWinState || this.gc.isFailState) return;
        const rel = this._containerOffset(e.clientX, e.clientY);
        this.camera.onScroll(e.deltaY, rel.x, rel.y, this.containerEl);
    }
}
