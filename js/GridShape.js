// =============================================================================
// GridShape.js — Board shape masks for milestone and daily puzzle levels
//
// All methods are static — no instance needed.
// Each shape function takes (rows, cols) and returns a Uint8Array mask where
// 1 = active node (path can be placed here), 0 = inactive node.
//
// Usage:
//   const { mask, activeCount } = GridShape.selectMask(level, rows, cols, context);
// =============================================================================

class GridShape {

    // ── Shape functions ───────────────────────────────────────────────────────

    static circle(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.48);
            const y = (r - R * 0.5) / (R * 0.48);
            mask[r * W + c] = (x * x + y * y <= 1.0) ? 1 : 0;
        }
        return mask;
    }

    static heart(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.45);
            const y = -(r - R * 0.5) / (R * 0.375);
            const a = x * x + y * y - 1;
            mask[r * W + c] = (a * a * a - x * x * y * y * y <= 0.01) ? 1 : 0;
        }
        return mask;
    }

    static star(R, C) {
        const W     = C + 1;
        const mask  = new Uint8Array((R + 1) * W);
        const n     = 5;
        const outer = 0.92;
        const inner = 0.38;
        const PI    = Math.PI;

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x    = (c - C * 0.5) / (C * 0.50);
            const y    = (r - R * 0.5) / (R * 0.50);
            const dist = Math.sqrt(x * x + y * y);
            if (dist > outer) { mask[r * W + c] = 0; continue; }

            // Angle from top (tip at 0°)
            const angle  = Math.atan2(x, -y);
            const sector = ((angle % (2 * PI / n)) + 2 * PI / n) % (2 * PI / n);
            const t      = Math.abs(sector / (PI / n) - 1); // 0=tip, 1=valley
            const bound  = inner + (outer - inner) * (1 - t);

            mask[r * W + c] = dist <= bound ? 1 : 0;
        }
        return mask;
    }

    static donut(R, C) {
        const W     = C + 1;
        const mask  = new Uint8Array((R + 1) * W);
        const outer = 1.0;
        const inner = 0.38;

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.48);
            const y = (r - R * 0.5) / (R * 0.48);
            const d = x * x + y * y;
            mask[r * W + c] = (d >= inner * inner && d <= outer) ? 1 : 0;
        }
        return mask;
    }

    static octagon(R, C) {
        const W    = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.48);
            const y = (r - R * 0.5) / (R * 0.48);
            const inside = Math.abs(x) + Math.abs(y) <= 1.35 &&
                           Math.max(Math.abs(x), Math.abs(y)) <= 0.96;
            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    static skull(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.44);
            const y = (r - R * 0.5) / (R * 0.44);  // y+ = down

            let inside = false;

            // Cranium: large dome in upper portion
            const cy = y + 0.18;
            if (x * x / 0.82 + cy * cy / 0.60 <= 1.0) inside = true;

            // Jaw: narrower lower block tapering downward
            if (!inside && y > 0.35 && y < 0.85) {
                const jw = 0.52 - (y - 0.35) * 0.15;
                if (Math.abs(x) <= jw) inside = true;
            }

            // Punch out eye sockets
            if (inside) {
                const lx = x + 0.27, ly = y + 0.10;
                if (lx * lx / 0.050 + ly * ly / 0.060 <= 1.0) inside = false;
                const rx = x - 0.27, ry = y + 0.10;
                if (rx * rx / 0.050 + ry * ry / 0.060 <= 1.0) inside = false;
                // Nasal cavity
                if (Math.abs(x) < 0.13 && y > 0.22 && y < 0.38) inside = false;
            }

            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    static shield(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.46);
            const y = (r - R * 0.5) / (R * 0.46);  // y+ = down
            let inside = false;
            // Upper rounded rectangle
            if (y < 0.30 && Math.abs(x) <= 0.90) inside = true;
            if (y >= -0.85 && y < 0.30 && Math.abs(x) <= 0.90 - Math.max(0, y + 0.85) * 0) inside = true;
            // Rounded top corners
            if (y < -0.55) {
                const cx = 0.70, cy = -0.55;
                if ((Math.abs(x) - cx) ** 2 + (y - cy) ** 2 <= 0.20 ** 2) inside = true;
                if (Math.abs(x) <= cx && y >= -0.85) inside = true;
            }
            // Lower triangular point
            if (y >= 0.30 && y <= 0.90) {
                const w = 0.90 * (1 - (y - 0.30) / 0.60);
                if (Math.abs(x) <= w) inside = true;
            }
            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    static leaf(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.46);
            const y = (r - R * 0.5) / (R * 0.46);  // y+ = down
            // Leaf: oval body + pointed tip at bottom
            const body = x * x / 0.70 + (y + 0.10) * (y + 0.10) / 0.88 <= 1.0;
            // Taper to a point at the bottom
            const tip  = Math.abs(x) <= 0.18 * (0.95 - y) && y > 0.55 && y <= 0.95;
            const inside = body || tip;
            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    static trophy(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.46);
            const y = (r - R * 0.5) / (R * 0.46);  // y+ = down
            let inside = false;
            // Cup: upper wide oval
            if (x * x / 0.82 + (y + 0.30) * (y + 0.30) / 0.55 <= 1.0 && y <= 0.10) inside = true;
            // Stem: narrow rectangle
            if (Math.abs(x) <= 0.14 && y > 0.10 && y <= 0.55) inside = true;
            // Base: wide flat rectangle
            if (Math.abs(x) <= 0.60 && y > 0.55 && y <= 0.78) inside = true;
            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    static crown(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.46);
            const y = (r - R * 0.5) / (R * 0.46);  // y+ = down
            let inside = false;
            // Base band
            if (Math.abs(x) <= 0.90 && y > 0.20 && y <= 0.75) inside = true;
            // Three pointed tips: centre + two sides
            // Centre tip
            if (Math.abs(x) <= 0.14 && y > -0.75 && y <= 0.20) inside = true;
            // Left tip
            if (Math.abs(x + 0.60) <= 0.14 && y > -0.35 && y <= 0.20) inside = true;
            // Right tip
            if (Math.abs(x - 0.60) <= 0.14 && y > -0.35 && y <= 0.20) inside = true;
            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    static badge(R, C) {
        const W    = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const n    = 12;  // scallop points around edge

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x     = (c - C * 0.5) / (C * 0.46);
            const y     = (r - R * 0.5) / (R * 0.46);
            const dist  = Math.sqrt(x * x + y * y);
            const angle = Math.atan2(y, x);
            // Scalloped edge: base circle + small bumps
            const bound = 0.82 + 0.12 * Math.cos(n * angle);
            mask[r * W + c] = dist <= bound ? 1 : 0;
        }
        return mask;
    }

    // ── Shape selection ───────────────────────────────────────────────────────

    // Returns the shape function for a given milestone level.
    // Cycles: circle → heart → star → donut → octagon → skull → shield → leaf → trophy → crown → badge → circle…
    static forLevel(level) {
        const shapes = [
            GridShape.circle,
            GridShape.heart,
            GridShape.star,
            GridShape.donut,
            GridShape.octagon,
            GridShape.skull,
            GridShape.shield,
            GridShape.leaf,
            GridShape.trophy,
            GridShape.crown,
            GridShape.badge,
        ];
        return shapes[(Math.floor(level / 10) - 1) % shapes.length];
    }

    // Returns the shape function for today's daily puzzle.
    // Cycles through all shapes based on day of year.
    static forDay() {
        const jan1    = new Date(new Date().getFullYear(), 0, 1);
        const dayOfYr = Math.floor((Date.now() - jan1.getTime()) / 86400000);
        const shapes  = [
            GridShape.circle,
            GridShape.heart,
            GridShape.star,
            GridShape.donut,
            GridShape.octagon,
            GridShape.skull,
            GridShape.shield,
            GridShape.leaf,
            GridShape.trophy,
            GridShape.crown,
            GridShape.badge,
        ];
        return shapes[dayOfYr % shapes.length];
    }

    // ── Validation ────────────────────────────────────────────────────────────

    // Checks that all active nodes in the mask form a single connected region.
    static validate(mask, rows, cols) {
        const W     = cols + 1;
        const total = (rows + 1) * W;
        let activeCount = 0, firstActive = -1;

        for (let i = 0; i < total; i++) {
            if (mask[i]) { activeCount++; if (firstActive < 0) firstActive = i; }
        }
        if (activeCount === 0) return { connected: false, activeCount: 0 };

        const visited = new Uint8Array(total);
        const queue   = [firstActive];
        visited[firstActive] = 1;
        let visitedCount = 1, qi = 0;

        while (qi < queue.length) {
            const k = queue[qi++];
            const r = (k / W) | 0, c = k % W;
            const nbrs = [k - W, k + W, k - 1, k + 1];
            const ok   = [r > 0, r < rows, c > 0, c < cols];
            for (let n = 0; n < 4; n++) {
                if (ok[n] && mask[nbrs[n]] && !visited[nbrs[n]]) {
                    visited[nbrs[n]] = 1; visitedCount++; queue.push(nbrs[n]);
                }
            }
        }
        return { connected: visitedCount === activeCount, activeCount };
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    // Returns { mask: Uint8Array | null, activeCount: number }
    // mask = null means full rectangle (no shape applied).
    static selectMask(level, rows, cols, context = 'normal') {
        const totalCells = (rows + 1) * (cols + 1);
        const nullResult = { mask: null, activeCount: totalCells };

        const isMilestone = (level % 10 === 0) || context === 'milestone';
        const isDaily     = context === 'daily';
        if (!isMilestone && !isDaily) return nullResult;

        // Minimum board size for shapes to look meaningful
        if (rows < 12 || cols < 10) return nullResult;

        const shapeFn = isDaily ? GridShape.forDay() : GridShape.forLevel(level);
        const mask    = shapeFn(rows, cols);
        const { connected, activeCount } = GridShape.validate(mask, rows, cols);

        if (!connected || activeCount < totalCells * 0.3) {
            console.warn(`[GridShape] L${level} mask invalid — using rectangle`);
            return nullResult;
        }

        return { mask, activeCount };
    }
}
