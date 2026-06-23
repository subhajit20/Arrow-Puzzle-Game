// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
import { DIRS, DK, COLORS, CELL_SIZE } from './constants';
import { cr } from './utils';
// Canvas 2D rendering under a Camera (zoom/pan). Draws in fixed world units (CELL_SIZE);
// the camera maps the world onto the full-screen canvas. Depends on constants.js
// (DIRS, COLORS, CELL_SIZE) and utils.js (cr).
export class Renderer {
    constructor(canvas, camera) {
        this.cv = canvas;
        this.ctx = canvas.getContext("2d");
        this.camera = camera;
        this.dpr = 1;
        this.G = null;
        this._loop = this.draw.bind(this);
        this.running = false;
    }

    setGame(G) { this.G = G; }

    startLoop() { this.running = true; requestAnimationFrame(this._loop); }

    // Stop the render loop (called on teardown so a navigated-away game stops drawing).
    stop() { this.running = false; }

    // Resize the canvas backing store to its on-screen size and refresh the camera viewport.
    layout() {
        const cv = this.cv, G = this.G;
        const w = cv.clientWidth, h = cv.clientHeight;
        this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        cv.width = Math.round(w * this.dpr);
        cv.height = Math.round(h * this.dpr);
        if (G) this.camera.setViewport(w, h, G.COLS * CELL_SIZE, G.ROWS * CELL_SIZE);
    }

    // Initial fit-to-screen view (called on a fresh board): size the canvas, then centre+fit.
    resetView() {
        this.layout();        // sizes the canvas backing store + camera viewport
        this.camera.reset();  // fit the whole board to the screen, centred
    }

    // Cell id -> world-pixel centre.
    ccx(id) {
        const [c, r] = cr(id, this.G.COLS);
        return [(c + 0.5) * CELL_SIZE, (r + 0.5) * CELL_SIZE];
    }

    // Pointer client coords -> cell id (or null if outside the grid).
    cellFromPoint(clientX, clientY) {
        const G = this.G;
        const rect = this.cv.getBoundingClientRect();
        const [wx, wy] = this.camera.screenToWorld(clientX - rect.left, clientY - rect.top);
        const c = Math.floor(wx / CELL_SIZE), r = Math.floor(wy / CELL_SIZE);
        if (c < 0 || c >= G.COLS || r < 0 || r >= G.ROWS) return null;
        return r * G.COLS + c;
    }

    drawGridDots() {
        const G = this.G, ctx = this.ctx;
        ctx.fillStyle = COLORS.DOT;
        for (let y = 0; y < G.ROWS; y++) {
            for (let x = 0; x < G.COLS; x++) {
                const id = y * G.COLS + x;
                if (G.mask && !G.mask[id]) continue;       // outside the board shape: no dot
                if (!G.initialOccupied.has(id)) continue;  // start-empty coverage gap: never dot
                if (!G.board.has(id)) {                    // vacated by a cleared arrow: show dot
                    const [px, py] = this.ccx(id);
                    ctx.beginPath();
                    ctx.arc(px, py, CELL_SIZE * 0.08, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }

    // Render the given board (arrows) to an offscreen canvas, fit-to-width, and return a PNG data URL.
    // Used for the win-screen "here's the board you solved" thumbnail. Independent of the live camera.
    renderThumbnail(arrows, C, R, cssW = 260) {
        const U = CELL_SIZE, worldW = C * U, worldH = R * U;
        const scale = cssW / worldW;
        const cssH = Math.max(1, Math.round(worldH * scale));
        const cv = document.createElement("canvas");
        const dpr = 2;
        cv.width = Math.round(cssW * dpr);
        cv.height = Math.round(cssH * dpr);
        const ctx = cv.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.scale(scale, scale);                 // world units -> css px
        const saved = this.ctx;
        this.ctx = ctx;                          // borrow drawArrowPts (which uses this.ctx + this.ccx)
        for (const a of arrows) {
            const pts = a.body.map(id => this.ccx(id));
            this.drawArrowPts(pts, a.dir, a.blocked ? { color: COLORS.RED } : {});
        }
        this.ctx = saved;
        return cv.toDataURL("image/png");
    }

    // Draw an arrow from explicit world points (tail -> head). Arrowhead points in `dir`.
    drawArrowPts(pts, dir, opt = {}) {
        if (!pts.length) return;
        const ctx = this.ctx, U = CELL_SIZE;
        const alpha = opt.alpha != null ? opt.alpha : 1;
        const color = opt.color || COLORS.NAVY;
        const w = U * 0.20;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = w;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        if (pts.length === 1) {
            const [x, y] = pts[0];
            ctx.beginPath();
            ctx.arc(x, y, w * 0.5, 0, 7);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.stroke();
        }

        const [hx, hy] = pts[pts.length - 1];
        const [dc, dr] = DIRS[dir];
        // Keep the whole arrowhead inside the head's own cell (which spans ±0.5 from its centre)
        // so heads of tightly-packed neighbouring paths don't poke into / collide with each other.
        // Filled triangle with ROUNDED corners: the slightly-shrunk triangle is both filled and
        // stroked with a round line-join, so the round stroke softens all three corners.
        const round = U * 0.13;                                  // corner radius (≈ stroke half-width)
        const tip = [hx + dc * U * 0.40, hy + dr * U * 0.50];   // smaller head, symmetric tip reach
        const back = [hx - dc * U * 0.02, hy - dr * U * 0.02];   // base just behind the head → flush with the shaft
        const px = -dr, py = dc;
        const L = [back[0] + px * U * 0.26, back[1] + py * U * 0.26];
        const Rr = [back[0] - px * U * 0.26, back[1] - py * U * 0.26];

        ctx.lineWidth = round;
        ctx.beginPath();
        ctx.moveTo(tip[0], tip[1]);
        ctx.lineTo(L[0], L[1]);
        ctx.lineTo(Rr[0], Rr[1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();        // round line-join rounds the corners
        ctx.restore();
    }

    drawArrow(a, opt = {}) {
        const ox = opt.ox || 0, oy = opt.oy || 0;
        const pts = a.body.map(id => this.ccx(id)).map(p => [p[0] + ox, p[1] + oy]);
        this.drawArrowPts(pts, a.dir, opt);
    }

    // Reveal animation: draw the path growing in from its tail up to `frac` (0..1) of its length.
    // The arrowhead leads the growing front (pointing along the last revealed segment), so it
    // looks like the arrow is drawing itself. At frac=1 the front is the real head pointing in `dir`.
    drawArrowReveal(a, frac) {
        const base = a.body.map(id => this.ccx(id));        // tail -> head
        if (base.length < 2) { this.drawArrowPts(base, a.dir); return; }
        const cum = [0];
        for (let i = 1; i < base.length; i++) cum.push(cum[i - 1] + Math.hypot(base[i][0] - base[i - 1][0], base[i][1] - base[i - 1][1]));
        const target = frac * cum[cum.length - 1];
        const out = [base[0]];
        for (let i = 1; i < base.length; i++) {
            if (cum[i] <= target) { out.push(base[i]); }
            else {
                const f = (target - cum[i - 1]) / (cum[i] - cum[i - 1]);
                out.push([base[i - 1][0] + (base[i][0] - base[i - 1][0]) * f, base[i - 1][1] + (base[i][1] - base[i - 1][1]) * f]);
                break;
            }
        }
        // Direction of the growing front (axis-aligned), so the leading arrowhead points correctly.
        let fdir = a.dir;
        if (out.length >= 2) {
            const p2 = out[out.length - 2], p1 = out[out.length - 1];
            const sx = Math.sign(p1[0] - p2[0]), sy = Math.sign(p1[1] - p2[1]);
            for (const d of DK) if (DIRS[d][0] === sx && DIRS[d][1] === sy) { fdir = d; break; }
        }
        this.drawArrowPts(out, fdir);
    }

    // Core snake slide: the body window slides forward by `offsetPx` (pixels) along the arrow's own
    // polyline, extended straight off the board past the head. Used by both the clear fly-out (full
    // slide off-board) and the blocked collision lunge (partial slide up to the blocker, then back).
    drawArrowSlide(a, offsetPx, alpha, color) {
        const G = this.G, U = CELL_SIZE;
        const base = a.body.map(id => this.ccx(id));        // tail -> head, world coords
        const [dc, dr] = DIRS[a.dir];
        const head = base[base.length - 1];
        const span = (a.dir === "E" || a.dir === "W") ? G.COLS : G.ROWS;
        const extCount = span + a.body.length + 3;          // straight runway off the board
        const poly = base.slice();
        for (let i = 1; i <= extCount; i++) poly.push([head[0] + dc * i * U, head[1] + dr * i * U]);

        const cum = [0];
        for (let i = 1; i < poly.length; i++) {
            cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
        }
        const total = cum[cum.length - 1];
        const bodyLen = cum[base.length - 1];
        const offset = Math.max(0, Math.min(offsetPx, total - bodyLen));

        const sample = s => {
            if (s <= 0) return poly[0];
            if (s >= total) return poly[poly.length - 1];
            let i = 1; while (i < cum.length && cum[i] < s) i++;
            const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
            return [poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * f,
            poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * f];
        };

        const winStart = offset, winEnd = offset + bodyLen;
        const pts = [sample(winStart)];
        for (let i = 0; i < poly.length; i++) if (cum[i] > winStart && cum[i] < winEnd) pts.push(poly[i]);
        pts.push(sample(winEnd));
        this.drawArrowPts(pts, a.dir, { alpha, color });
    }

    // Full snake exit (clears off the board). `e` is eased 0..1.
    drawArrowSnakeOut(a, e, alpha) {
        const U = CELL_SIZE;
        const span = (a.dir === "E" || a.dir === "W") ? this.G.COLS : this.G.ROWS;
        const maxOff = (span + a.body.length + 3) * U;       // full off-board travel
        this.drawArrowSlide(a, e * maxOff, alpha, COLORS.BLUE);   // turns blue as it clears/flies
    }

    draw() {
        if (!this.running) return;   // stopped (teardown): don't draw or re-schedule
        const ctx = this.ctx, cv = this.cv, G = this.G;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (!G) { requestAnimationFrame(this._loop); return; }

        this.camera.update();               // ease zoom toward its target
        this.camera.apply(ctx, this.dpr);   // world space from here on

        this.drawGridDots();

        // Entrance reveal: paths "draw in" from tail->head, staggered across the board (a wave).
        const now = performance.now();
        let revealGP = 1;
        if (G.revealing) {
            revealGP = (now - G.revealT0) / G.revealDur;
            if (revealGP >= 1) { G.revealing = false; revealGP = 1; }
        }
        const REVEAL_SPREAD = 0.55;   // fraction of the timeline spent staggering path start times

        const animating = new Set(G.anims.map(an => an.arrow.id));
        for (let i = 0; i < G.arrows.length; i++) {
            const a = G.arrows[i];
            if (animating.has(a.id)) continue;
            if (G.revealing) {
                const startFrac = G.arrows.length > 1 ? (i / (G.arrows.length - 1)) * REVEAL_SPREAD : 0;
                let p = (revealGP - startFrac) / (1 - REVEAL_SPREAD);
                p = Math.max(0, Math.min(1, p));
                if (p <= 0) continue;                 // not started yet → invisible
                if (p < 1) { this.drawArrowReveal(a, 1 - (1 - p) * (1 - p)); continue; }  // ease-out grow
            }
            const flashing = a.flashT0 != null && now >= a.flashT0 && now < a.flashT0 + a.flashDur;
            if (a.blocked || flashing) this.drawArrow(a, { color: COLORS.RED });   // blocked (persists) or collided-with (brief flash)
            else if (G.hintId === a.id) {
                const k = (Math.sin(now / 160) + 1) / 2;
                this.drawArrow(a, { color: COLORS.GREEN, alpha: 0.7 + 0.3 * k });
            } else this.drawArrow(a);
        }

        const keep = [];
        for (const an of G.anims) {
            const t = (performance.now() - an.t0) / an.dur;
            if (t >= 1) continue;
            if (an.kind === "out") {
                const e = t * t;                                  // accelerate as it launches
                const alpha = t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15; // hold solid, fade only at the tail end
                this.drawArrowSnakeOut(an.arrow, e, alpha);
            } else {
                // "bump": red snake slide forward into the blocker (head leads, body follows its
                // route), HOLD at the collision, then return. f: ease-out to 1, hold, ease back to 0.
                const t2 = Math.min(t, 1);
                let f;
                if (t2 < 0.40) { const u = t2 / 0.40; f = u * (2 - u); }   // reach the blocker (decelerating)
                else if (t2 < 0.55) { f = 1; }                            // hold at the collision
                else { f = 1 - (t2 - 0.55) / 0.45; }                      // return to place
                const offset = (an.reach || 0.5) * CELL_SIZE * Math.max(0, f);
                this.drawArrowSlide(an.arrow, offset, 1, COLORS.RED);
            }
            keep.push(an);
        }
        G.anims = keep;
        requestAnimationFrame(this._loop);
    }
}
