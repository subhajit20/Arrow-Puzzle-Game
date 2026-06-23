// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
import { CELL_SIZE, ZOOM_MAX } from './constants';
// Camera — Google-Maps-style zoom & pan over the fixed board "world".
// Holds zoom + translation (tx, ty in CSS px). The Renderer applies it before drawing;
// InputHandler drives it via panBy / zoomAt. Depends on constants.js (ZOOM_MAX).
export class Camera {
    constructor() {
        this.zoom = 1;
        this.tx = 0;            // translation in CSS pixels
        this.ty = 0;
        this.viewW = 0;         // viewport (canvas CSS) size
        this.viewH = 0;
        this.worldW = 0;        // board world size (COLS*CELL_SIZE x ROWS*CELL_SIZE)
        this.worldH = 0;
        this.minZoom = 0.1;
        this.maxZoom = ZOOM_MAX;
        // Smooth-zoom target + the focal point it's anchored to (world point kept under fx/fy).
        this.targetZoom = 1;
        this._fx = 0; this._fy = 0; this._fwx = 0; this._fwy = 0;
        this.entrance = null;   // active entrance zoom-in animation, or null
    }

    // Smallest zoom that still shows the whole board (contain-fit).
    fitZoom() {
        if (!this.worldW || !this.worldH) return 1;
        return Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
    }

    // Update viewport/world sizes and zoom limits; keep the current view in bounds.
    setViewport(viewW, viewH, worldW, worldH) {
        this.viewW = viewW; this.viewH = viewH;
        this.worldW = worldW; this.worldH = worldH;
        // Allow zooming OUT well past the fit point (puzzle shrinks with empty space around it),
        // like a map. Min is a fraction of fit; max is a generous zoom-in.
        this.minZoom = this.fitZoom() * 0.4;
        this.maxZoom = Math.max(this.fitZoom() * 8, ZOOM_MAX);
        if (this.zoom < this.minZoom) this.zoom = this.minZoom;
        this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
        this.clamp();
    }

    // Initial view: whole board visible (fit) and centred.
    reset() {
        this.zoom = this.targetZoom = this.fitZoom();
        this._centerAt(this.zoom);
        this.entrance = null;
    }

    // Centre the board on screen at zoom z.
    _centerAt(z) {
        this.tx = (this.viewW - this.worldW * z) / 2;
        this.ty = (this.viewH - this.worldH * z) / 2;
    }

    // Entrance: the board starts zoomed-out (overview) and dives in to the fit view, centred,
    // over `dur` ms with a cubic ease-in-out. Driven by update().
    startEntrance(dur = 1900) {
        const fit = this.fitZoom();
        this.entrance = { t0: performance.now(), dur, from: fit * 0.5, to: fit * 1.50 };
        this.zoom = this.targetZoom = this.entrance.from;
        this._centerAt(this.zoom);
    }

    // Set the canvas transform for a frame (dpr base + pan + zoom). World coords thereafter.
    apply(ctx, dpr) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(this.tx, this.ty);
        ctx.scale(this.zoom, this.zoom);
    }

    // Canvas CSS point -> world coordinates.
    screenToWorld(sx, sy) {
        return [(sx - this.tx) / this.zoom, (sy - this.ty) / this.zoom];
    }

    panBy(dx, dy) {
        this.tx += dx; this.ty += dy;
        this.clamp();
    }

    // Request a smooth zoom toward `target`, anchored at focal screen point (fx, fy).
    // The actual zoom eases toward this target in update() each frame.
    zoomTo(target, fx, fy) {
        this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, target));
        this._fx = fx; this._fy = fy;
        const [wx, wy] = this.screenToWorld(fx, fy);   // world point currently under the focal
        this._fwx = wx; this._fwy = wy;
    }

    // Per-frame easing toward targetZoom — keeps the focal world point under the focal screen
    // point so the zoom glides smoothly (low effort, no jumpiness). Called once per draw frame.
    update() {
        // Entrance zoom-in takes over while active (timed, centred, cubic ease-in-out).
        if (this.entrance) {
            const e = this.entrance;
            const p = Math.min(1, (performance.now() - e.t0) / e.dur);
            const t = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            this.zoom = e.from + (e.to - e.from) * t;
            this._centerAt(this.zoom);
            if (p >= 1) { this.entrance = null; this.targetZoom = this.zoom; }
            return;
        }
        const diff = this.targetZoom - this.zoom;
        if (Math.abs(diff) < this.zoom * 0.0008) {
            if (this.zoom !== this.targetZoom) { this.zoom = this.targetZoom; this._anchor(); this.clamp(); }
            return;
        }
        this.zoom += diff * 0.35;
        this._anchor();
        this.clamp();
    }

    _anchor() {
        this.tx = this._fx - this._fwx * this.zoom;
        this.ty = this._fy - this._fwy * this.zoom;
    }

    // Map-style free panning: the board can be placed anywhere, as long as at least `margin`
    // pixels of it stay on screen (so it can't be lost or dragged fully into the void).
    clamp() {
        const sw = this.worldW * this.zoom, sh = this.worldH * this.zoom;
        const margin = Math.max(60, Math.min(this.viewW, this.viewH) * 0.18);
        this.tx = Math.min(this.viewW - margin, Math.max(margin - sw, this.tx));
        this.ty = Math.min(this.viewH - margin, Math.max(margin - sh, this.ty));
    }
}
