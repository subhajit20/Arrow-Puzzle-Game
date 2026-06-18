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

    // Heart = two circle lobes + power-curve taper body.
    // The circles touch near the centre, so the gap above their meeting point
    // forms a deep, clean V-notch; the body tapers with an outward bulge
    // (exponent < 1) for plump sides, ending in a sharp bottom point.
    static heart(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);

        const LOBE_X = 0.50;   // lobe centre offset from middle
        const LOBE_Y = -0.42;  // lobe centre height (-1 = top)
        const LOBE_R = 0.52;   // lobe radius
        const TIP_Y = 1.0;     // bottom point
        const BODY_W = 1.02;   // body half-width — matches the lobes' outer edge
        const SHARP_T = 0.62;  // below this, straight V-edges → sharp point
        const SCALE_X = 0.96, SCALE_Y = 0.92; // margins inside the grid

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = ((c / C) * 2 - 1) / SCALE_X;
            const y = ((r / R) * 2 - 1) / SCALE_Y;

            let inside = false;

            // Lobes
            const dy = y - LOBE_Y;
            const dl = x + LOBE_X, dr = x - LOBE_X;
            if (dl * dl + dy * dy <= LOBE_R * LOBE_R ||
                dr * dr + dy * dy <= LOBE_R * LOBE_R) {
                inside = true;
            }
            // Body: elliptical side profile — vertical tangent where it meets
            // the lobes' widest point, so the left/right sides continue the
            // circles as one smooth oval curve (no corner). Below SHARP_T the
            // sides switch to straight V-edges converging on a sharp point.
            else if (y >= LOBE_Y && y <= TIP_Y) {
                const tt = (y - LOBE_Y) / (TIP_Y - LOBE_Y);
                let w;
                if (tt <= SHARP_T) {
                    w = BODY_W * Math.sqrt(Math.max(0, 1 - tt * tt));
                } else {
                    const w0 = BODY_W * Math.sqrt(1 - SHARP_T * SHARP_T);
                    w = w0 * (1 - (tt - SHARP_T) / (1 - SHARP_T));
                }
                inside = Math.abs(x) <= w;
            }

            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    // Coffee cup pictogram: body + handle ring (enclosed hole) + saucer below
    // as a separate island. Converted from artwork via scratch/png_to_grid.py.
    static CUP_TEMPLATE = [
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
        '01111111111111111111111100000000',
        '01111111111111111111111111100000',
        '01111111111111111111111111110000',
        '01111111111111111111111111111000',
        '01111111111111111111111100111100',
        '01111111111111111111111100001100',
        '01111111111111111111111100001100',
        '01111111111111111111111100001100',
        '01111111111111111111111100001100',
        '01111111111111111111111100111100',
        '01111111111111111111111111111000',
        '01111111111111111111111111110000',
        '01111111111111111111111111000000',
        '00111111111111111111111100000000',
        '00011111111111111111110000000000',
        '00001111111111111111100000000000',
        '00000011111111111110000000000000',
        '00000000000000000000000000000000',
        '00001111111111111111100000000000',
        '01111111111111111111111100000000',
        '00011111111111111111110000000000',
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
        '00000000000000000000000000000000',
    ];

    static cup(R, C) {
        return GridShape._fromTemplate(R, C, GridShape.CUP_TEMPLATE);
    }

    // Apple pictogram: round body with top dimple + bottom notch, 2-wide
    // curved stem, tilted leaf attached to the stem. Single connected shape.
    // Traced from artwork via scratch/png_to_grid.py, stem hand-thickened.
    static APPLE_TEMPLATE = [
        '00000011110000000001111000000000',
        '00000111111100000011111000000000',
        '00000111111110000111110000000000',
        '00000111111110001111100000000000',
        '00000011111111011110000000000000',
        '00000001111111111100000000000000',
        '00000000011111111000000000000000',
        '00000000000011111000000000000000',
        '00000000000001111000000000000000',
        '00000000000001111000000000000000',
        '00000011111101111001111110000000',
        '00000111111111111111111111100000',
        '00011111111111111111111111110000',
        '00111111111111111111111111111000',
        '01111111111111111111111111111100',
        '01111111111111111111111111111100',
        '01111111111111111111111111111110',
        '01111111111111111111111111111110',
        '01111111111111111111111111111110',
        '01111111111111111111111111111110',
        '01111111111111111111111111111110',
        '01111111111111111111111111111110',
        '01111111111111111111111111111110',
        '01111111111111111111111111111110',
        '00111111111111111111111111111100',
        '00111111111111111111111111111100',
        '00011111111111111111111111111000',
        '00001111111111111111111111110000',
        '00000111111111111111111111100000',
        '00000011111111111111111111000000',
        '00000001111111111111111110000000',
        '00000000111111100111111100000000',
    ];

    static apple(R, C) {
        return GridShape._fromTemplate(R, C, GridShape.APPLE_TEMPLATE);
    }

    // Swan — single swan facing left: S-curved neck descending from a beaked
    // head into the chest, deep white bay between neck and body (open at the
    // top, so no enclosed hole), and a notched wing tip at the right edge.
    // One connected island; the neck is a 3-4 cell corridor. Traced from
    // artwork, hand-cleaned.
    static SWANS_TEMPLATE = [
        '000000000011111000000000000000000000',
        '000000000111111110000000000000000000',
        '000000001111111110000000000000000000',
        '000000001111111111000000000000000000',
        '000000001111111111000000000000000000',
        '000000011100001111000000000000000000',
        '000000011000001111000000000000000000',
        '000000000000001110000000000000000000',
        '000000000000011110000000000000000000',
        '000000000000111100000000000000000000',
        '000000000001111000000000000000000000',
        '000000000011110000000011111111110000',
        '000000001111100000001111111111110000',
        '000000011111000000011111111111110000',
        '000000111100000000111111111111100000',
        '000001111000000000111111111111100000',
        '000011110000000001111111111111000000',
        '000111110000000001111111111111011111',
        '001111100000000011111111111111111111',
        '011111100000000011111111111111111110',
        '011111100000000111111111111111111110',
        '111111100000000111111111111111111100',
        '111111100000001111111111111111111100',
        '111111110000011111111111111111111000',
        '111111111111111111111111111111111000',
        '111111111111111111111111111111111000',
        '111111111111111111111111111111111000',
        '011111111111111111111111111111111000',
        '011111111111111111111111111111111000',
        '001111111111111111111111111111110000',
        '000111111111111111111111111111100000',
        '000001111111111111111111111111000000',
    ];

    static swans(R, C) {
        return GridShape._fromTemplate(R, C, GridShape.SWANS_TEMPLATE);
    }

    // Dolphin — jumping pose facing right: dorsal fin top-left with a dip
    // behind the head, rounded snout at the right, body arcing down-left into
    // a twin-fluke V tail, pectoral flipper attached at its base with a white
    // slit under the belly. One connected island; water waves from the
    // artwork dropped (too thin to play). Traced and hand-cleaned.
    static DOLPHIN_TEMPLATE = [
        '000000011111100000000000000000000000',
        '000000011111111001111111100000000000',
        '000000011111111111111111111100000000',
        '000000001111111111111111111111000000',
        '000000001111111111111111111111100000',
        '000000000111111111111111111111110000',
        '000000001111111111111111111111110000',
        '000000011111111111111111111111111100',
        '000000111111111111111111111111111110',
        '000000111111111111111111111111111110',
        '000001111111111111111111111111111100',
        '000011111111111111111111111100000000',
        '000011111111111111111000000000000000',
        '000111111111111111110000000000000000',
        '000111111111001111110000000000000000',
        '000111111110011111100000000000000000',
        '001111111100011110000000000000000000',
        '001111111100000000000000000000000000',
        '001111111000000000000000000000000000',
        '000111111000000000000000000000000000',
        '000111111000000000000000000000000000',
        '000111111000000000000000000000000000',
        '001111111100000000000000000000000000',
        '011111111110000000000000000000000000',
        '111111111111000000000000000000000000',
        '111110011111000000000000000000000000',
        '111100001111000000000000000000000000',
        '111000000111000000000000000000000000',
        '110000000011000000000000000000000000',
    ];

    static dolphin(R, C) {
        return GridShape._fromTemplate(R, C, GridShape.DOLPHIN_TEMPLATE);
    }

    // Isometric cube pictogram — three faces (top rhombus + two mirrored side
    // parallelograms) as three separate islands. Each face is tested in
    // normalized coords and shrunk toward its own centroid, which carves the
    // white edge-gaps between faces at a width proportional to the board.
    static cube(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const SHRINK = 0.90; // per-face shrink → gap width between faces

        const inTop = (x, y) => Math.abs(x) / 0.95 + Math.abs(y + 0.52) / 0.45 <= 1;
        const inLeft = (x, y) => {
            if (x < -0.95 || x > 0) return false;
            const u = (x + 0.95) / 0.95;
            return y >= -0.52 + 0.45 * u && y <= 0.55 + 0.45 * u;
        };
        const faces = [
            { test: inTop, cx: 0, cy: -0.52 },
            { test: inLeft, cx: -0.475, cy: 0.24 },
            { test: (x, y) => inLeft(-x, y), cx: 0.475, cy: 0.24 },
        ];

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = ((c / C) * 2 - 1) / 0.97;
            const y = ((r / R) * 2 - 1) / 0.99;
            let inside = false;
            for (const f of faces) {
                // Expanding the point away from the centroid = shrinking the
                // face around it — same trick at every board size.
                const px = f.cx + (x - f.cx) / SHRINK;
                const py = f.cy + (y - f.cy) / SHRINK;
                if (f.test(px, py)) { inside = true; break; }
            }
            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    // Stacked cubes pictogram — three isometric cubes (one resting in the
    // notch between two below), nine faces as nine islands. Reuses the
    // single-cube face geometry per cube; the front (top) cube occludes the
    // bottom two with a white outline (MARGIN). Milestone rotation only —
    // too detailed for the small daily board.
    static cubesStack(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const SHRINK = 0.87; // per-face shrink → gaps between faces
        const MARGIN = 0.08; // white outline around the front cube

        const inTop = (x, y) => Math.abs(x) / 0.95 + Math.abs(y + 0.52) / 0.45 <= 1;
        const inLeft = (x, y) => {
            if (x < -0.95 || x > 0) return false;
            const u = (x + 0.95) / 0.95;
            return y >= -0.52 + 0.45 * u && y <= 0.55 + 0.45 * u;
        };
        const inRight = (x, y) => inLeft(-x, y);
        const silhouette = (x, y) => inTop(x, y) || inLeft(x, y) || inRight(x, y);

        const FACES = [
            { test: inTop, cx: 0, cy: -0.52 },
            { test: inLeft, cx: -0.475, cy: 0.24 },
            { test: inRight, cx: 0.475, cy: 0.24 },
        ];
        // Depth order: front cube first — first silhouette hit owns the point.
        const CUBES = [
            { ox: 0, oy: -0.45, s: 0.52 },
            { ox: -0.50, oy: 0.42, s: 0.52 },
            { ox: 0.50, oy: 0.42, s: 0.52 },
        ];

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = ((c / C) * 2 - 1) / 0.99;
            const y = ((r / R) * 2 - 1) / 0.99;

            let inside = false;
            for (const cube of CUBES) {
                const lx = (x - cube.ox) / cube.s;
                const ly = (y - cube.oy) / cube.s;
                if (!silhouette(lx / (1 + MARGIN), (ly - 0.015) / (1 + MARGIN) + 0.015)) continue;
                for (const f of FACES) {
                    const px = f.cx + (lx - f.cx) / SHRINK;
                    const py = f.cy + (ly - f.cy) / SHRINK;
                    if (f.test(px, py)) { inside = true; break; }
                }
                break;
            }
            mask[r * W + c] = inside ? 1 : 0;
        }
        return mask;
    }

    // Builds a node mask by sampling a bitmap template (array of '0'/'1'
    // strings) with nearest-neighbour scaling onto the (R+1)×(C+1) lattice.
    static _fromTemplate(R, C, tpl) {
        const W = C + 1;
        const TH = tpl.length, TW = tpl[0].length;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) {
            const tr = Math.min(TH - 1, Math.round(r / R * (TH - 1)));
            for (let c = 0; c <= C; c++) {
                const tc = Math.min(TW - 1, Math.round(c / C * (TW - 1)));
                mask[r * W + c] = tpl[tr][tc] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static star(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const n = 5;
        const outer = 0.92;
        const inner = 0.38;
        const PI = Math.PI;

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.50);
            const y = (r - R * 0.5) / (R * 0.50);
            const dist = Math.sqrt(x * x + y * y);
            if (dist > outer) { mask[r * W + c] = 0; continue; }

            // Angle from top (tip at 0°)
            const angle = Math.atan2(x, -y);
            const sector = ((angle % (2 * PI / n)) + 2 * PI / n) % (2 * PI / n);
            const t = Math.abs(sector / (PI / n) - 1); // 0=tip, 1=valley
            const bound = inner + (outer - inner) * (1 - t);

            mask[r * W + c] = dist <= bound ? 1 : 0;
        }
        return mask;
    }

    static donut(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
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
        const W = C + 1;
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
            const tip = Math.abs(x) <= 0.18 * (0.95 - y) && y > 0.55 && y <= 0.95;
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
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const n = 12;  // scallop points around edge

        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.46);
            const y = (r - R * 0.5) / (R * 0.46);
            const dist = Math.sqrt(x * x + y * y);
            const angle = Math.atan2(y, x);
            // Scalloped edge: base circle + small bumps
            const bound = 0.82 + 0.12 * Math.cos(n * angle);
            mask[r * W + c] = dist <= bound ? 1 : 0;
        }
        return mask;
    }

    // ── Shape selection ───────────────────────────────────────────────────────

    // Returns the shape function for a given milestone level.
    static dinosaur(R, C) {
        // Brontosaurus — pixel-art pattern encoded directly and scaled to grid.
        // Nearest-neighbour sampling guarantees the shape matches exactly.
        const ART = [
            '00000000000000000000000000',
            '00001111100000000000000000',
            '00011111110000000000000000',
            '00111111111000000000000000',
            '00111011111000000000000000',
            '01111111110000000000000000',
            '01111111000000000000000000',
            '01111100000000000000000000',
            '01111000000000000000000000',
            '01111000000000000000000000',
            '01110000000000000000000000',
            '01110000000000000000000000',
            '01110000000000000000000000',
            '01111000000000000000000000',
            '01111100000000000000000000',
            '01111100000000000000000000',
            '01111000000000000000000000',
            '01111010001111100000000000',
            '01111111111111110000000100',
            '01111111111111111000001100',
            '00111111011101111000001100',
            '00111111111111111110111000',
            '00111111111111111110111100',
            '00011111111111111111111100',
            '00011111111111111111111100',
            '00001111111111111111111000',
            '00000011111111111110100000',
            '00000011110111111111000000',
            '00000011111000011111000000',
            '00000001110000001110000000',
            '00000001110000001110000000',
            '00000000000000000000000000',
        ];

        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length;
        const aC = ART[0].length;

        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static chromeDino(R, C) {
        // T-Rex style dinosaur — pixel-art pattern, cropped to active region
        // and scaled to grid via nearest-neighbour sampling.
        const ART = [
            '0000000000000111111111000000',
            '0000000000001111111111110000',
            '0000000000001100111111110000',
            '0000000000001111111111110000',
            '0000000000001111111111110000',
            '0000000000001111111111110000',
            '0000000000001111111111110000',
            '0000000000001111110000000000',
            '0000000000011111111110000000',
            '0000000000111111100000000000',
            '0000000000111111110000000000',
            '0000000111111111111100000000',
            '0001111111111111111100000000',
            '0001111111111111101000000000',
            '0001111111111111100000000000',
            '0001111111111111100000000000',
            '0000111111111111000000000000',
            '0000111111111111000000000000',
            '0000011111111110000000000000',
            '0000001111111100000000000000',
            '0000000111111000000000000000',
            '0000000011111110000000000000',
            '0000000001100110000000000000',
            '0000000001000010000000000000',
            '0000000001000010000000000000',
            '0000000001100011000000000000',
        ].map(r => r.padEnd(28, '0'));

        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;

        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static metamaskFox(R, C) {
        // Clean fox face silhouette: two pointed ears, wide rounded face,
        // narrowing to a chin point. Fully connected single component.
        const ART = [
            '00000000000000000000000000000000',
            '0001000000000000000000000000100',
            '00010000000000000000000000001000',
            '00011000000000000000000000011000',
            '00011110000000000000000001111000',
            '00011111000000000000000011111000',
            '00011111100000000000000111111000',
            '00011111110000000000001111111000',
            '00011111111000000000011111111000',
            '00111111111111111111111111111100',
            '00111111111111111111111111111100',
            '00111111111111111111111111111100',
            '00111111111111111111111111111100',
            '00111111111111111111111111111100',
            '00111111111111111111111111111100',
            '00111111001111111111110011111100',
            '00111111000111111111100011111100',
            '00111110011011111111011001111100',
            '00111111000101111110100011111100',
            '00111111100001111110000111111100',
            '00111111110001111110001111111100',
            '00011111111001111110011111111000',
            '00011111111101111110111111111000',
            '00001111111101111110111111110000',
            '00000111111001111110011111100000',
            '00000011110000111110001111000000',
            '00000001100000000000000110000000',
            '00000000111001111110011100000000',
            '00000000011101111110111000000000',
            '00000000001111111111110000000000',
            '00000000000110000001100000000000',
            '00000000000011111111000000000000',
            '00000000000001111110000000000000',
        ];

        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;

        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static camel(R, C) {
        const ART = [
            '00000000000011100000000011111110',
            '00000000001111110000000111111111',
            '00000000011111111000000011111111',
            '00000011111111111100000111111101',
            '00000111111111111110000111110000',
            '00001111111111111111001111110000',
            '00001111111111111111111111100000',
            '00011111111111111111111111100000',
            '00011111111111111111111111000000',
            '00011111111111111111111100000000',
            '00011111111111111111110000000000',
            '00111111111111111111100000000000',
            '01111011110001111111000000000000',
            '11101111110000110111000000000000',
            '11101011100000110011000000000000',
            '11000011000001110011100000000000',
            '11000111000001110011100000000000',
            '11000111000001100001100000000000',
            '11000011000001100000100000000000',
            '11000011000001000000110000000000',
            '01100001100011000000110000000000',
            '01110001100011100000011100000000',
            '00010001110001100000011110000000',
            '00000000111100000000000000000000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static scorpion(R, C) {
        // Dilated version — thin legs/claws expanded for a solid look
        const ART = [
            '000111111111000000111111111000',
            '001111111110000000011111111100',
            '011111111111000000111111111110',
            '011111111110000000011111111110',
            '111111111000000000000111111111',
            '111111110000000000000011111111',
            '111111100000000000000001111111',
            '111111100000000000000000111111',
            '111111000001000000100000011111',
            '011110000011111111110000011110',
            '111110000011111111110000011111',
            '011111000001111111100000111110',
            '001111101111111111111101111100',
            '001111111111111111111111111100',
            '010111111111111111111111111010',
            '111101011111111111110110101111',
            '011110111111111111111111011110',
            '001111111111111111111111111100',
            '000010110111111111111011010000',
            '000000111111111111111111000000',
            '111101111111111111111111101111',
            '111111111111111111111111111111',
            '111101111111111111111111101111',
            '000001111111111111111111100000',
            '000011111111111111111111110000',
            '000011111111111111111111110000',
            '001111111111111111111111111100',
            '011110111111111111111111011110',
            '111100111101111111101111001111',
            '010000111001111111100111000010',
            '000000111000111111000111000000',
            '000001110000011110000011100000',
            '000001110000111110000011100000',
            '000000100001111100000001000000',
            '000000000001111000001000000000',
            '000000000011111000011111000000',
            '000000000011111000111111100000',
            '000000000011111000111111000000',
            '000000000011111101111111000000',
            '000000000001111111111110000000',
            '000000000001111111111100000000',
            '000000000000111111101000000000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static seahorse(R, C) {
        const ART = [
            '0000000000000000100111010000000000000',
            '0000000000000000111111111000000000000',
            '0000000000000001111111111111000000000',
            '0000000000001111111111111111100000000',
            '0000000000000111111111111111100000000',
            '0000000000001111111111111111100000000',
            '0000000000011111111111111111110000000',
            '0000000000011111111111111111110000000',
            '0000000000000111111111111111111000000',
            '0000000000000111111111111111111100000',
            '0000000000000111111111111111111110000',
            '0000000000001111111111011111111111000',
            '0000000000011111111110011111111111100',
            '0000000000111111111110001111111111110',
            '0000000000111111111110000000001111111',
            '0000000000111111111111000000000000111',
            '0000000001111111111111100000000000000',
            '0000000001111111111111111000000000000',
            '0000000001111111111111111110000000000',
            '0000000001111111111111111111100000000',
            '0000000000111111111111111111110000000',
            '0000000000111111111111111111111000000',
            '0000000000011111111111111111111100000',
            '0000000000001111111111111111111110000',
            '0000000110000111111111111111111110000',
            '0011111110000111111111111111111110000',
            '0001111111000111111111111111111110000',
            '0001111111111111111111111111111110000',
            '0111111111111111111111111111111110000',
            '0111111111111111111111111111111110000',
            '0011111111111111111111111111111100000',
            '0011111111111111111111111111111000000',
            '1111111111111111111111111111110000000',
            '0011111111111111111111111111000000000',
            '0001111111111111111111111000000000000',
            '0011000111111111111111100000000000000',
            '0000000011111111111110000000000000000',
            '0000000111111111111000000000000000000',
            '0000000111111111110000000000000000000',
            '0000001111111111100000000000000000000',
            '0000001111111111000000000000000000000',
            '0000001111111111000000000000000000000',
            '0000001111111110000000011111110000000',
            '0000001111111110000000110001111000000',
            '0000001111111110000001000000111100000',
            '0000001111111110000000000000011100000',
            '0000000111111111000000000000011100000',
            '0000000111111111000000000000011100000',
            '0000000011111111100000000000111100000',
            '0000000011111111100000000000111100000',
            '0000000001111111110000000001111000000',
            '0000000000111111111100000011111000000',
            '0000000000011111111111111111110000000',
            '0000000000000111111111111111100000000',
            '0000000000000011111111111110000000000',
            '0000000000000000011111111000000000000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static unicornHead(R, C) {
        // Horn diagonal gap bridged at row 2 (c=1 added); isolated pixels at
        // r=13,c=33 and r=21,c=37 removed for 100% orthogonal connectivity.
        const ART = [
            '10000000000000000000000000000000000000',
            '11000000000000000000000000000000000000',
            '01110000000000000000000000000000000000',
            '00011100000010000000000000000000000000',
            '00001111000011000000000000000000000000',
            '00000111100111100001100000000000000000',
            '00000011110111101111111100000000000000',
            '00000000111111111111111111100000000000',
            '00000000111111111111111111110000000000',
            '00000000011111111111111111111100000000',
            '00000000011111111111111111111100000000',
            '00000000011111111111111111111110000000',
            '00000000111111111111111111111100000000',
            '00000000111111111111111111111111000000',
            '00000001111111111111111111111111100000',
            '00000011111111111111111111111111000000',
            '00000011111111111111111111111111100000',
            '00000111111111111111111111111111111000',
            '00001111111111111111111111111111111100',
            '00011111111111111111111111111111111000',
            '00111111111111111111111111111111000000',
            '01111111111111111111111111111111111000',
            '01111111111111101111111111111111111110',
            '01111111111110001111111111111111111100',
            '01111111100000000111111111111111111000',
            '00111110000000000111111111111111110000',
            '00001000000000000111111111111111100000',
            '00000000000000000111111111111111100000',
            '00000000000000000111111111000000000000',
            '00000000000000000111111100000000000000',
            '00000000000000000111111000000000000000',
            '00000000000000000111000000000000000000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static petals(R, C) {
        const ART = [
            '0000000000000001111000000000000000',
            '0000000000000001111000000000000000',
            '0000000000000011111100000000000000',
            '0000000100000011111100000010000000',
            '0000011111000011111100001111100000',
            '0000011111100011111100011111100000',
            '0000011111110011111100111111100000',
            '0000011111111011111101111111100000',
            '0000011111111011111101111111100000',
            '0000001111111111111111111111000000',
            '0000000111111111111111111110000000',
            '0000000011111111111111111100000000',
            '0111111001111111111111111001111110',
            '1111111111111110000111111111111111',
            '1111111111111100000011111111111111',
            '1111111111111000000001111111111111',
            '1111111111111000000001111111111111',
            '0111111111111000000001111111111110',
            '0001111111111000000001111111111000',
            '0000000111111100000011111110000000',
            '0000011111111110000111111111100000',
            '0001111111111111111111111111111000',
            '0011111111111111111111111111111100',
            '0011111111111111111111111111111100',
            '0011111111111111111111111111111100',
            '0011111111011111111111101111111100',
            '0011111100111111111111110011111100',
            '0000110000111111111111110000110000',
            '0000000001111111111111111000000000',
            '0000000001111111001111111000000000',
            '0000000001111111001111111000000000',
            '0000000001111110000111111000000000',
            '0000000001111110000111111000000000',
            '0000000000111100000011110000000000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static elephant(R, C) {
        // Row 6 col 12 bridged (0→1) to connect trunk to body for full orthogonal connectivity.
        const ART = [
            '0000000000000011111110000000000000000000',
            '0000000000010111111111000000000000000000',
            '0000000000110111111111110000000000000000',
            '0000000001110111111111111111111110000000',
            '0000000011110111111111111111111111100000',
            '0000000111110111111111111111111111110000',
            '0000001111111111111111111111111111111000',
            '0000111111100111111111111111111111111100',
            '0000111111000111111111111111111111111100',
            '0000000000000111111111111111111111111110',
            '0011111111111111111111111111111111111110',
            '0111111111111111111111111111111111111110',
            '1111111111111111111111111111111111111110',
            '1111111111111111111111111111111111111111',
            '1111111111111111111111111111111111111111',
            '1111111111111111111111111111111111111111',
            '1111111111111111111111111111001111111111',
            '1111111111111111111111111110000111111111',
            '1111111111111111111111111111111111111111',
            '1111111111111111111111111111111111111111',
            '0111111111111111111111111111111111111111',
            '0111111111111111111111111111111111111111',
            '0111111111111111111111111111111111111111',
            '0011111111111111111011111111111111111111',
            '0011111111111111111001111111111111111111',
            '0011111111111111111000111111111111111111',
            '0001111111111111111000011111111111111111',
            '0000111111111111111000000000011111111111',
            '0000011111111111110000000000001111111111',
            '0000000111111111100001111100000111111111',
            '0000000000000000000011111100000111111110',
            '0000000000000000000111111100000111111110',
            '0000000000000000000111110000000011111110',
            '0000000000000000000111100000000011111100',
            '0000000000000000000111100000000111111100',
            '0000000000000000000111100000000111111000',
            '0000000000000000000111110000001111111000',
            '0000000000000000000011111111111111110000',
            '0000000000000000000011111111111111100000',
            '0000000000000000000001111111111110000000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static pawPrint(R, C) {
        const ART = [
            '00000000001111110000000000001111110000000000',
            '00000000111111111100000000111111111100000000',
            '00000001111111111110000001111111111110000000',
            '00000011111111111111000011111111111111000000',
            '00000111111111111111000011111111111111100000',
            '00000111111111111111000011111111111111100000',
            '00001111111111111111000011111111111111110000',
            '00001111111111111111000011111111111111110000',
            '00001111111111111111000011111111111111110000',
            '00000111111111111110000001111111111111100000',
            '00000111111111111110000001111111111111100000',
            '01111001111111111100000000111111111100001100',
            '11111110011111111000000000001111111001111111',
            '11111111100111100000000000000011110011111111',
            '11111111110000000000111100000000000111111111',
            '11111111111000000011111111000000011111111111',
            '11111111111000001111111111110000011111111111',
            '01111111110000011111111111111100001111111110',
            '00111111100000111111111111111110000011111100',
            '00001111000001111111111111111111000001111000',
            '00000000000011111111111111111111100000000000',
            '00000000000111111111111111111111110000000000',
            '00000000001111111111111111111111111000000000',
            '00000000011111111111111111111111111100000000',
            '00000000111111111111111111111111111110000000',
            '00000001111111111111111111111111111111000000',
            '00000011111111111111111111111111111111100000',
            '00000111111111111111111111111111111111110000',
            '00001111111111111111111111111111111111111000',
            '00011111111111111111111111111111111111111100',
            '00111111111111111111111111111111111111111110',
            '00111111111111111111000011111111111111111110',
            '01111111111111111000000000011111111111111111',
            '01111111111111100000000000000111111111111111',
            '01111111111110000000000000000001111111111111',
            '00111111111100000000000000000000011111111110',
            '00011111110000000000000000000000000111111100',
            '00000111000000000000000000000000000001111000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    // Whale pictogram — body swimming up-right with two-fluke tail
    // (connected via a narrow neck), white eye hole, and a detached lower
    // flipper as a separate island. Traced from artwork, hand-cleaned.
    static WHALE_TEMPLATE = [
        '0000000000000000000011000000000000',
        '0000000000000000000011111000000000',
        '0000000000000000000001111100111100',
        '0000000000000000000001111111111111',
        '0000000000000000000000111111111110',
        '0000000000000000000000001111111100',
        '0000000000000000000000000111000000',
        '0000000000000000000000001110000000',
        '0000001110000000000000001110000000',
        '0011111111111110000000011110000000',
        '0111111111111111111111111110000000',
        '1111100111111111111111111110000000',
        '1111111111111111111111111100000000',
        '1111111111111111111111111100000000',
        '0111111111111111111111111000000000',
        '0011111111111111111111110000000000',
        '0001111111111111111111000000000000',
        '0000011111111111111111000000000000',
        '0000001111111111111100000000000000',
        '0000000000000000000000000000000000',
        '0000000000111111000000000000000000',
        '0000000000011111110000000000000000',
        '0000000000000111110000000000000000',
    ];

    static whale(R, C) {
        return GridShape._fromTemplate(R, C, GridShape.WHALE_TEMPLATE);
    }

    static brain(R, C) {
        const ART = [
            '00000000000000000000000000000000',
            '00000000000000000000000000000000',
            '00000000000000111100000000000000',
            '00000000111111111110000000000000',
            '00000001111111111111111100000000',
            '00000011111111111100011110000000',
            '00011111110001111011110111100000',
            '00111111101111111111111011111000',
            '00111110011111111111111101111100',
            '00111101111111001100111111111100',
            '01111111111110111110111111111100',
            '11111101101110111111111101111110',
            '11111011011111111111110011111111',
            '01111111011111111011110111111111',
            '00111111011111111000001111101111',
            '00111010111101110111111111011110',
            '00111101111110001111111110111110',
            '00011101111111111111111110111110',
            '00000001111111111111111110111100',
            '00000001111111111101111101000000',
            '00000000011011111011000111111000',
            '00000000000000110111111111110000',
            '00000000000000011011111111110000',
            '00000000000000001100111111100000',
            '00000000000000000111000000000000',
            '00000000000000000011100000000000',
            '00000000000000000011100000000000',
            '00000000000000000001100000000000',
            '00000000000000000001100000000000',
            '00000000000000000000000000000000',
            '00000000000000000000000000000000',
            '00000000000000000000000000000000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    static burger(R, C) {
        const ART = [
            '00000000000011111110000000000000',
            '00000000011111111111110000000000',
            '00000001111111111111111100000000',
            '00000111111111111111111110000000',
            '00001111111111111111111111000000',
            '00011111111111111111111111100000',
            '00011111111111111111111111110000',
            '00111111111111111111111111111000',
            '01111111111111111111111111111000',
            '01111111111111111111111111111100',
            '11111111111111111111111111111100',
            '11111111111111111111111111111100',
            '11111111111111111111111111111100',
            '01111111111111111111111111111100',
            '00111111111111111111111111110000',
            '00000000000000000000000000000000',
            '00000000000000000000000000000000',
            '00000001111100000001111100000000',
            '00000011111110000011111110000000',
            '00000111111111000111111111100000',
            '11111111111111111111111111111110',
            '11111111000111111111000111111110',
            '01111110000011111110000011111110',
            '00111000000000111000000000111000',
            '00000000000000000000000000000000',
            '00000000000000000000000000000000',
            '01111111111111111111111111111000',
            '01111111111111111111111111111100',
            '11111111111111111111111111111100',
            '11111111111111111111111111111100',
            '01111111111111111111111111111100',
            '00111111111111111111111111111000',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    // Chess knight (horse head) facing left: pointed ears, muzzle with a
    // nostril hole, eye hole, flowing mane down the right with its signature
    // gap line, on a two-tier base (two separate island bars below the head).
    // Traced from artwork. Tall silhouette (~2:3 aspect).
    static chessKnight(R, C) {
        const ART = [
            '00000000011000000000000000000000',
            '00000000011100000000000000000000',
            '00000000011110000000000000000000',
            '00000000001111001111000000000000',
            '00000000001111101111111000000000',
            '00000000001111110111111110000000',
            '00000000011111111001111111000000',
            '00000000111111111110011111100000',
            '00000001111111111111101111110000',
            '00000011111111111111110111110000',
            '00000011100111111111111011111000',
            '00000011000111111111111001111100',
            '00000111111111111111111101111100',
            '00001111111111111111111110111110',
            '00001111111111111111111110111110',
            '00011111111111111111111111011110',
            '00111111111111111111111111011111',
            '01111111111111111111111111011111',
            '11111111111111111111111111001111',
            '11011111111111011111111111101111',
            '11011111111000011111111111101111',
            '11111111100000111111111111101111',
            '01111110000000111111111111101111',
            '00111110000001111111111111101111',
            '00001000000011111111111111101111',
            '00000000000111111111111111101111',
            '00000000001111111111111111101111',
            '00000000011111111111111111011110',
            '00000000011111111111111111011110',
            '00000000111111111111111111011110',
            '00000000111111111111111111011100',
            '00000000111111111111111111000000',
            '00000001111111111111111111000000',
            '00000001111111111111111111000000',
            '00000001111111111111111111000000',
            '00000001111111111111111111100000',
            '00000001111111111111111111100000',
            '00000000000000000000000000000000',
            '00000011111111111111111111111000',
            '00000111111111111111111111111000',
            '00000011111111111111111111110000',
            '00000000000000000000000000000000',
            '00001111111111111111111111111100',
            '00001111111111111111111111111110',
            '00011111111111111111111111111110',
            '00011111111111111111111111111110',
            '00001111111111111111111111111110',
        ];
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        const aR = ART.length, aC = ART[0].length;
        for (let r = 0; r <= R; r++) {
            const ar = Math.min(aR - 1, Math.floor(r * aR / (R + 1)));
            for (let c = 0; c <= C; c++) {
                const ac = Math.min(aC - 1, Math.floor(c * aC / (C + 1)));
                mask[r * W + c] = ART[ar][ac] === '1' ? 1 : 0;
            }
        }
        return mask;
    }

    // Cycles: circle → heart → star → donut → octagon → skull → shield → leaf → trophy → crown → badge → dinosaur → chromeDino → metamaskFox → camel → scorpion → seahorse → unicornHead → petals → elephant → pawPrint → whale → brain → burger → cup → cube → cubesStack → apple → swans → dolphin → chessKnight → …
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
            GridShape.dinosaur,
            GridShape.chromeDino,
            GridShape.metamaskFox,
            GridShape.camel,
            GridShape.scorpion,
            GridShape.seahorse,
            GridShape.unicornHead,
            GridShape.petals,
            GridShape.elephant,
            GridShape.pawPrint,
            GridShape.whale,
            GridShape.brain,
            GridShape.burger,
            GridShape.cup,
            GridShape.cube,
            GridShape.cubesStack,
            GridShape.apple,
            GridShape.swans,
            GridShape.dolphin,
            GridShape.chessKnight,
        ];
        return shapes[(Math.floor(level / 10) - 1) % shapes.length];
    }

    // ── Per-shape milestone grid sizes ────────────────────────────────────────
    // Every shape plays on one of 3 large grids tailored to its aspect ratio
    // (wide shapes get wide boards, tall shapes tall boards) and detail level
    // (thin features / island gaps need more resolution). All sizes keep the
    // lattice (rows+1)×(cols+1) ≤ 3500 so the blueprint pipeline (regions,
    // motifs, solve-order planning) stays active.
    static SHAPE_SIZES = {
        circle: [{ rows: 40, cols: 40 }, { rows: 42, cols: 42 }, { rows: 44, cols: 44 }],
        heart: [{ rows: 44, cols: 42 }, { rows: 46, cols: 44 }, { rows: 48, cols: 46 }],
        star: [{ rows: 46, cols: 46 }, { rows: 48, cols: 48 }, { rows: 50, cols: 50 }],
        donut: [{ rows: 42, cols: 42 }, { rows: 44, cols: 44 }, { rows: 46, cols: 46 }],
        octagon: [{ rows: 40, cols: 40 }, { rows: 42, cols: 42 }, { rows: 44, cols: 44 }],
        skull: [{ rows: 46, cols: 42 }, { rows: 48, cols: 44 }, { rows: 50, cols: 46 }],
        shield: [{ rows: 46, cols: 40 }, { rows: 48, cols: 42 }, { rows: 50, cols: 44 }],
        leaf: [{ rows: 46, cols: 40 }, { rows: 48, cols: 42 }, { rows: 50, cols: 44 }],
        trophy: [{ rows: 48, cols: 42 }, { rows: 50, cols: 44 }, { rows: 52, cols: 46 }],
        crown: [{ rows: 38, cols: 48 }, { rows: 40, cols: 50 }, { rows: 42, cols: 52 }],
        badge: [{ rows: 42, cols: 42 }, { rows: 44, cols: 44 }, { rows: 46, cols: 46 }],
        dinosaur: [{ rows: 44, cols: 52 }, { rows: 46, cols: 54 }, { rows: 48, cols: 56 }],
        chromeDino: [{ rows: 44, cols: 46 }, { rows: 46, cols: 48 }, { rows: 48, cols: 50 }],
        metamaskFox: [{ rows: 46, cols: 46 }, { rows: 48, cols: 48 }, { rows: 50, cols: 50 }],
        camel: [{ rows: 42, cols: 50 }, { rows: 44, cols: 52 }, { rows: 46, cols: 54 }],
        scorpion: [{ rows: 50, cols: 52 }, { rows: 52, cols: 54 }, { rows: 54, cols: 56 }],
        seahorse: [{ rows: 52, cols: 38 }, { rows: 54, cols: 40 }, { rows: 56, cols: 42 }],
        unicornHead: [{ rows: 48, cols: 42 }, { rows: 50, cols: 44 }, { rows: 52, cols: 46 }],
        petals: [{ rows: 44, cols: 44 }, { rows: 46, cols: 46 }, { rows: 48, cols: 48 }],
        elephant: [{ rows: 44, cols: 50 }, { rows: 46, cols: 52 }, { rows: 48, cols: 54 }],
        pawPrint: [{ rows: 42, cols: 44 }, { rows: 44, cols: 46 }, { rows: 46, cols: 48 }],
        whale: [{ rows: 40, cols: 52 }, { rows: 42, cols: 54 }, { rows: 44, cols: 56 }],
        brain: [{ rows: 42, cols: 48 }, { rows: 44, cols: 50 }, { rows: 46, cols: 52 }],
        burger: [{ rows: 40, cols: 48 }, { rows: 42, cols: 50 }, { rows: 44, cols: 52 }],
        cup: [{ rows: 44, cols: 50 }, { rows: 46, cols: 52 }, { rows: 48, cols: 54 }],
        cube: [{ rows: 46, cols: 46 }, { rows: 48, cols: 48 }, { rows: 50, cols: 50 }],
        cubesStack: [{ rows: 52, cols: 52 }, { rows: 54, cols: 54 }, { rows: 55, cols: 55 }],
        apple: [{ rows: 46, cols: 44 }, { rows: 48, cols: 46 }, { rows: 50, cols: 48 }],
        swans: [{ rows: 44, cols: 48 }, { rows: 46, cols: 50 }, { rows: 48, cols: 52 }],
        dolphin: [{ rows: 42, cols: 50 }, { rows: 44, cols: 52 }, { rows: 46, cols: 54 }],
        chessKnight: [{ rows: 50, cols: 34 }, { rows: 52, cols: 36 }, { rows: 54, cols: 38 }],
    };

    // Returns the 3 candidate grid sizes for the milestone shape at this level.
    static milestoneSizes(level) {
        const fn = GridShape.forLevel(level);
        return GridShape.SHAPE_SIZES[fn?.name] ||
            [{ rows: 44, cols: 44 }, { rows: 46, cols: 46 }, { rows: 48, cols: 48 }];
    }

    // Returns the shape function for today's daily puzzle.
    // Cycles through all shapes based on day of year.
    static forDay() {
        const jan1 = new Date(new Date().getFullYear(), 0, 1);
        const dayOfYr = Math.floor((Date.now() - jan1.getTime()) / 86400000);
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
            GridShape.dinosaur,
            GridShape.chromeDino,
            GridShape.metamaskFox,
            GridShape.camel,
            GridShape.scorpion,
            GridShape.seahorse,
            GridShape.unicornHead,
            GridShape.petals,
            GridShape.elephant,
            GridShape.pawPrint,
            GridShape.whale,
            GridShape.brain,
            GridShape.burger,
            GridShape.cup,
            GridShape.cube,
            GridShape.apple,
            GridShape.chessKnight,
        ];
        return shapes[dayOfYr % shapes.length];
    }

    // ── Validation ────────────────────────────────────────────────────────────

    // Checks that all active nodes in the mask form a single connected region.
    static validate(mask, rows, cols) {
        const W = cols + 1;
        const total = (rows + 1) * W;
        let activeCount = 0, firstActive = -1;

        for (let i = 0; i < total; i++) {
            if (mask[i]) { activeCount++; if (firstActive < 0) firstActive = i; }
        }
        if (activeCount === 0) return { connected: false, activeCount: 0 };

        // Find the LARGEST connected component.
        // BFS from the first active pixel would fail for shapes with decorative
        // island clusters (bulb sparkles, scorpion legs, etc.) if the first pixel
        // belongs to a small island rather than the main body.
        const visited = new Uint8Array(total);
        let largestComponent = 0;

        for (let start = 0; start < total; start++) {
            if (!mask[start] || visited[start]) continue;
            const queue = [start];
            visited[start] = 1;
            let size = 1, qi = 0;
            while (qi < queue.length) {
                const k = queue[qi++];
                const r = (k / W) | 0, c = k % W;
                const nbrs = [k - W, k + W, k - 1, k + 1];
                const ok = [r > 0, r < rows, c > 0, c < cols];
                for (let n = 0; n < 4; n++) {
                    if (ok[n] && mask[nbrs[n]] && !visited[nbrs[n]]) {
                        visited[nbrs[n]] = 1; size++; queue.push(nbrs[n]);
                    }
                }
            }
            if (size > largestComponent) largestComponent = size;
        }

        // Accept if the largest single component covers ≥10% of all active nodes.
        return { connected: largestComponent >= activeCount * 0.10, activeCount };
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    // Returns { mask: Uint8Array | null, activeCount: number }
    // mask = null means full rectangle (no shape applied).
    static selectMask(level, rows, cols, context = 'normal') {
        const totalCells = (rows + 1) * (cols + 1);
        const nullResult = { mask: null, activeCount: totalCells };

        const isMilestone = (level % 10 === 0) || context === 'milestone';
        const isDaily = context === 'daily';
        if (!isMilestone && !isDaily) return nullResult;

        // Minimum board size for shapes to look meaningful
        if (rows < 12 || cols < 10) return nullResult;

        const shapeFn = isDaily ? GridShape.forDay() : GridShape.forLevel(level);
        const mask = shapeFn(rows, cols);
        const { connected, activeCount } = GridShape.validate(mask, rows, cols);

        if (!connected || activeCount < totalCells * 0.3) {
            console.warn(`[GridShape] L${level} mask invalid — using rectangle`);
            return nullResult;
        }

        return { mask, activeCount };
    }
}
