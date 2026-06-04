// =============================================================================
// ZoneMap.js — Spatial zone layout for board generation
//
// Divides the board into a coarse zone grid of DENSE / OPEN / NEUTRAL cells.
// Each zone influences how rcGrowWalk scores moves and scales path lengths:
//
//   DENSE   — tight turns, short pieces  (high local path density)
//   OPEN    — long straight runs          (visual breathing space)
//   NEUTRAL — balanced default
//
// One guaranteed full-span OPEN corridor (horizontal or vertical) ensures
// at least one breathing band connecting opposite board edges.
// =============================================================================

class ZoneMap {
    static DENSE   = 0;
    static OPEN    = 1;
    static NEUTRAL = 2;

    // Per-zone walk-scoring knobs used by RCBuilder.growWalk.
    // straightScore / turnScore weight move preference.
    // maxStraight caps consecutive straight steps before a forced turn.
    static WALK_KNOBS = [
        { straightScore: 0.05, turnScore: 3.0, maxStraight: 1   }, // DENSE
        { straightScore: 1.5,  turnScore: 0.5, maxStraight: 4   }, // OPEN
        { straightScore: 0.4,  turnScore: 1.0, maxStraight: 999 }, // NEUTRAL
    ];

    // Per-zone length multiplier applied on top of the base lenScale in fillA.
    static LEN_SCALE = [0.6, 1.2, 1.0]; // DENSE, OPEN, NEUTRAL

    constructor() {
        this.zRows = 0;
        this.zCols = 0;
        this.tags  = null;
        this.rows  = 0;
        this.cols  = 0;
    }

    // ── Generation ────────────────────────────────────────────────────────────

    // Builds a ceil((rows+1)/4) × ceil((cols+1)/4) zone tag grid.
    // Base pattern: checkerboard DENSE (even zr+zc) / OPEN (odd).
    // Overlays one random full-span OPEN corridor through the middle half.
    generate(rows, cols) {
        this.rows  = rows;
        this.cols  = cols;

        const R = rows + 1, C = cols + 1;
        this.zRows = Math.max(2, Math.ceil(R / 4));
        this.zCols = Math.max(2, Math.ceil(C / 4));
        this.tags  = new Uint8Array(this.zRows * this.zCols);

        // Checkerboard base
        for (let zr = 0; zr < this.zRows; zr++)
            for (let zc = 0; zc < this.zCols; zc++)
                this.tags[zr * this.zCols + zc] =
                    (zr + zc) % 2 === 0 ? ZoneMap.DENSE : ZoneMap.OPEN;

        // Guaranteed OPEN corridor through the middle half
        if (Math.random() < 0.5) {
            const zr = Math.floor(this.zRows / 4) +
                       ((Math.random() * Math.ceil(this.zRows / 2)) | 0);
            for (let zc = 0; zc < this.zCols; zc++)
                this.tags[zr * this.zCols + zc] = ZoneMap.OPEN;
        } else {
            const zc = Math.floor(this.zCols / 4) +
                       ((Math.random() * Math.ceil(this.zCols / 2)) | 0);
            for (let zr = 0; zr < this.zRows; zr++)
                this.tags[zr * this.zCols + zc] = ZoneMap.OPEN;
        }

        return this;
    }

    // ── Node lookup ───────────────────────────────────────────────────────────

    // Maps a micro-grid node (r, c) to its zone tag.
    zoneFor(r, c) {
        const R = this.rows + 1, C = this.cols + 1;
        const zr = Math.min(this.zRows - 1, Math.floor(r * this.zRows / R));
        const zc = Math.min(this.zCols - 1, Math.floor(c * this.zCols / C));
        return this.tags[zr * this.zCols + zc];
    }

    // Returns walk-scoring knobs for the zone at node (r, c).
    walkKnobs(r, c) {
        return ZoneMap.WALK_KNOBS[this.zoneFor(r, c)];
    }

    // Returns the length multiplier for the zone at node (r, c).
    lenScale(r, c) {
        return ZoneMap.LEN_SCALE[this.zoneFor(r, c)];
    }
}
