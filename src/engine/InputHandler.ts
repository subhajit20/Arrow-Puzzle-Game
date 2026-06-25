// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
// (no shared-symbol imports needed)
// Pointer input: tap = select an arrow, 1-finger drag = pan, 2-finger = pinch-zoom, wheel = zoom.
// Drives the Camera and forwards taps to the controller.
export class InputHandler {
    constructor(renderer, controller) {
        this.renderer = renderer;
        this.controller = controller;
        this.camera = renderer.camera;
        this.pointers = new Map();   // pointerId -> {x, y}
        this.mode = "none";          // 'none' | 'tap' | 'pan' | 'pinch'
        this.startX = 0; this.startY = 0; this.moved = false;
        this.pinchDist = 0;
        this.DRAG = 8;               // px of movement before a tap becomes a pan
    }

    attach() {
        const cv = this.renderer.cv;
        cv.style.touchAction = "none";
        this._cv = cv;
        // Store bound handlers so detach() can remove exactly these on teardown.
        this._onDown = e => this.#down(e);
        this._onMove = e => this.#move(e);
        this._onUp = e => this.#up(e);
        this._onWheel = e => this.#wheel(e);
        cv.addEventListener("pointerdown", this._onDown);
        cv.addEventListener("pointermove", this._onMove);
        cv.addEventListener("pointerup", this._onUp);
        cv.addEventListener("pointercancel", this._onUp);
        cv.addEventListener("wheel", this._onWheel, { passive: false });
    }

    // Remove all listeners (called on teardown when leaving the game screen).
    detach() {
        const cv = this._cv;
        if (!cv) return;
        cv.removeEventListener("pointerdown", this._onDown);
        cv.removeEventListener("pointermove", this._onMove);
        cv.removeEventListener("pointerup", this._onUp);
        cv.removeEventListener("pointercancel", this._onUp);
        cv.removeEventListener("wheel", this._onWheel);
    }

    #down(e) {
        // Set gesture state FIRST so a failed pointer-capture can never abort it.
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 1) {
            this.mode = "tap"; this.moved = false;
            this.startX = e.clientX; this.startY = e.clientY;
        } else if (this.pointers.size === 2) {
            this.mode = "pinch";
            const [a, b] = [...this.pointers.values()];
            this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
        try { this.renderer.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }

    #move(e) {
        const prev = this.pointers.get(e.pointerId);
        if (!prev) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (this.mode === "pinch" && this.pointers.size >= 2) {
            const [a, b] = [...this.pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const rect = this.renderer.cv.getBoundingClientRect();
            const midX = (a.x + b.x) / 2 - rect.left, midY = (a.y + b.y) / 2 - rect.top;
            if (this.pinchDist > 0) {
                const ratio = dist / this.pinchDist;
                const gain = 1 + (ratio - 1) * 1.5;   // just above 1:1 with the fingers (calm pinch)
                this.camera.zoomTo(this.camera.targetZoom * gain, midX, midY);
            }
            this.pinchDist = dist;
        } else if (this.pointers.size === 1 && (this.mode === "tap" || this.mode === "pan")) {
            const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
            if (!this.moved && Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > this.DRAG) {
                this.moved = true; this.mode = "pan";
            }
            if (this.mode === "pan") this.camera.panBy(dx, dy);
        }
    }

    #up(e) {
        const wasTap = this.mode === "tap" && !this.moved && this.pointers.size === 1;
        this.pointers.delete(e.pointerId);
        if (wasTap) this.controller.tap(this.renderer.cellFromPoint(e.clientX, e.clientY));
        // Lifting one finger of a pinch leaves a single pointer — treat it as panning so it
        // doesn't register as a tap.
        if (this.pointers.size === 0) this.mode = "none";
        else { this.mode = "pan"; this.moved = true; }
    }

    #wheel(e) {
        e.preventDefault();
        const rect = this.renderer.cv.getBoundingClientRect();
        // Continuous, magnitude-aware zoom (smooth like a map). Trackpad pinch fires wheel+ctrlKey
        // with SMALL deltas, so it needs a bigger coefficient than a mouse wheel's large deltaY
        // notches — otherwise the trackpad feels sluggish while the mouse wheel feels right.
        const coeff = e.ctrlKey ? 0.015 : 0.0015;
        const factor = Math.exp(-e.deltaY * coeff);
        this.camera.zoomTo(this.camera.targetZoom * factor, e.clientX - rect.left, e.clientY - rect.top);
    }
}
