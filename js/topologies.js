function generateRandomGridDimensions(preset, level) {
    let rows, cols;

    if (preset === "Auto") {
        // Auto mode: boards scale with level and become tall portrait puzzles at
        // high levels. Density (short paths) creates difficulty — NOT board size
        // alone. But larger boards give more room for complex dependency chains.
        //
        // Column range stays 18-20 from level 16+ so the board is always
        // comfortably wide. Row count grows to create tall scrollable puzzles.
        //
        // Level  1–3  :  8–12 rows × 8–10 cols   (intro)
        // Level  4–6  : 10–16 rows × 10–12 cols   (easy)
        // Level  7–10 : 12–20 rows × 10–14 cols   (normal)
        // Level 11–15 : 14–26 rows × 12–18 cols   (hard)
        // Level 16–20 : 18–32 rows × 16–20 cols   (hard+)
        // Level 21–30 : 24–42 rows × 18–20 cols   (expert)
        // Level 31+   : 32–50 rows × 18–20 cols   (titan)
        let minRows, maxRows, minCols, maxCols;

        if (level <= 3)       { minRows = 8;  maxRows = 12; minCols = 8;  maxCols = 10; }
        else if (level <= 6)  { minRows = 10; maxRows = 16; minCols = 10; maxCols = 12; }
        else if (level <= 10) { minRows = 12; maxRows = 20; minCols = 10; maxCols = 14; }
        else if (level <= 15) { minRows = 14; maxRows = 26; minCols = 12; maxCols = 18; }
        else if (level <= 20) { minRows = 18; maxRows = 32; minCols = 16; maxCols = 20; }
        else if (level <= 30) { minRows = 24; maxRows = 42; minCols = 18; maxCols = 20; }
        else                  { minRows = 32; maxRows = 50; minCols = 18; maxCols = 20; }

        rows = minRows + Math.floor(Math.random() * (maxRows - minRows + 1));
        cols = minCols + Math.floor(Math.random() * (maxCols - minCols + 1));

        // Mobile portrait: shrink columns slightly to fit small screens
        if (typeof window !== 'undefined' && window.innerWidth) {
            const screenW = window.innerWidth;
            if (screenW < 768 && screenW < (window.innerHeight || 800)) {
                const optimalCols = Math.ceil((screenW - 4) / 34);
                cols = Math.max(minCols, Math.min(optimalCols, maxCols));
            }
        }

        // Always portrait (rows >= cols)
        if (cols > rows) { let tmp = rows; rows = cols; cols = tmp; }

        // Safety clamps
        rows = Math.max(8, Math.min(50, rows));
        cols = Math.max(6, Math.min(20, cols));

    } else {
        // Preset modes: compact near-square boards (fixed manual selections).
        // Difficulty here is controlled purely by density inside the fixed canvas.
        let minSide, maxSide;
        if (preset === "Standard") {
            minSide = 8;  maxSide = 12;
        } else if (preset === "Grand") {
            minSide = 12; maxSide = 16;
        } else if (preset === "Colossal") {
            minSide = 14; maxSide = 18;
        } else if (preset === "Titan") {
            minSide = 16; maxSide = 20;
        } else if (preset === "Cosmic") {
            minSide = 18; maxSide = 20;
        } else {
            minSide = 8; maxSide = 12;
        }

        rows = minSide + Math.floor(Math.random() * (maxSide - minSide + 1));
        // Cols within 0–2 less than rows → near-square portrait
        let colOffset = Math.floor(Math.random() * 3);
        cols = Math.max(minSide - 2, rows - colOffset);
        cols = Math.min(maxSide, cols);

        // Mobile portrait adjustment
        if (typeof window !== 'undefined' && window.innerWidth) {
            const screenW = window.innerWidth;
            if (screenW < 768 && screenW < (window.innerHeight || 800)) {
                const optimalCols = Math.ceil((screenW - 4) / 34);
                cols = Math.max(cols, Math.min(optimalCols, maxSide));
            }
        }

        if (cols > rows) { let tmp = rows; rows = cols; cols = tmp; }

        // Safety clamps for preset modes
        rows = Math.max(8, Math.min(20, rows));
        cols = Math.max(6, Math.min(20, cols));
    }

    return { rows, cols };
}

function getDifficultyLabel(level) {
    if (State.gridSizePreset !== "Auto") {
        return { label: `${State.gridSizePreset.toUpperCase()}`, color: "#6366f1" };
    }
    const diff = State.boardDifficulty || "NORMAL";
    const colors = {
        EASY: "#10b981",    // Emerald Green
        NORMAL: "#3b82f6",  // Blue
        HARD: "#f97316",    // Orange
        EXPERT: "#a855f7",  // Purple
        TITAN: "#ec4899"    // Pink
    };
    return { label: diff, color: colors[diff] || "#3b82f6" };
}

const TOPOLOGIES = {
    SQUARE: {
        name: "Square Matrix",
        makeMask: (r, c) => Array(r).fill().map(() => Array(c).fill(1))
    },
    CROSS: {
        name: "Cruciform Cross",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(0));
            let padR = Math.floor(r * 0.25);
            let padC = Math.floor(c * 0.25);
            for (let row = 0; row < r; row++) {
                for (let col = 0; col < c; col++) {
                    if ((row >= padR && row < r - padR) || (col >= padC && col < c - padC)) m[row][col] = 1;
                }
            }
            return m;
        }
    },
    DIAMOND: {
        name: "Rhombus Diamond",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(0));
            let midR = (r - 1) / 2;
            let midC = (c - 1) / 2;
            for (let row = 0; row < r; row++) {
                for (let col = 0; col < c; col++) {
                    if (Math.abs(row - midR) / Math.max(1, midR) + Math.abs(col - midC) / Math.max(1, midC) <= 1.0) m[row][col] = 1;
                }
            }
            return m;
        }
    },
    DONUT: {
        name: "Hollow Donut",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(1));
            let padR = Math.max(1, Math.floor(r * 0.3));
            let padC = Math.max(1, Math.floor(c * 0.3));
            for (let row = padR; row < r - padR; row++) {
                for (let col = padC; col < c - padC; col++) m[row][col] = 0;
            }
            return m;
        }
    },
    OCTAGON: {
        name: "Beveled Octagon",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(1));
            for (let row = 0; row < r; row++) {
                for (let col = 0; col < c; col++) {
                    if (row / r + col / c < 0.25) m[row][col] = 0;
                    if ((r - 1 - row) / r + col / c < 0.25) m[row][col] = 0;
                    if (row / r + (c - 1 - col) / c < 0.25) m[row][col] = 0;
                    if ((r - 1 - row) / r + (c - 1 - col) / c < 0.25) m[row][col] = 0;
                }
            }
            return m;
        }
    },
    CIRCLE: {
        name: "Circle Shield",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(0));
            let midR = (r - 1) / 2;
            let midC = (c - 1) / 2;
            for (let row = 0; row < r; row++) {
                for (let col = 0; col < c; col++) {
                    let dist = Math.pow((row - midR) / Math.max(1, midR), 2) + Math.pow((col - midC) / Math.max(1, midC), 2);
                    if (dist <= 1.25) m[row][col] = 1;
                }
            }
            return m;
        }
    },
    HOURGLASS: {
        name: "Hourglass Prism",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(1));
            for (let row = 0; row < r; row++) {
                let factor = Math.abs(row - (r - 1) / 2) / Math.max(1, r / 2);
                let cut = Math.floor(c * 0.35 * (1 - factor));
                for (let col = 0; col < cut; col++) {
                    m[row][col] = 0;
                    m[row][c - 1 - col] = 0;
                }
            }
            return m;
        }
    },
    WAVES: {
        name: "Serpentine Waves",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(1));
            for (let row = 0; row < r; row++) {
                for (let col = 0; col < c; col++) {
                    let wave = Math.sin(row * 0.8) * (c * 0.15);
                    let center = c / 2 + wave;
                    if (Math.abs(col - center) > c * 0.38) {
                        m[row][col] = 0;
                    }
                }
            }
            return m;
        }
    },
    CORNER_CASTLE: {
        name: "Corner Castle",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(1));
            let blockR = Math.max(1, Math.floor(r * 0.35));
            let blockC = Math.max(1, Math.floor(c * 0.35));
            for (let row = 0; row < blockR; row++) {
                for (let col = 0; col < blockC; col++) {
                    m[row][col] = 0;
                }
            }
            for (let row = r - blockR; row < r; row++) {
                for (let col = c - blockC; col < c; col++) {
                    m[row][col] = 0;
                }
            }
            return m;
        }
    },
    GATEWAY: {
        name: "Hedge Gateway",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(1));
            let wallW = Math.max(1, Math.floor(c * 0.25));
            let midR = Math.floor(r / 2);
            for (let col = 0; col < wallW; col++) {
                m[midR][col] = 0;
                m[midR][c - 1 - col] = 0;
            }
            return m;
        }
    },

    // ── Rectangle-family topologies ────────────────────────────────────────

    // Playable cells form only the outer border of the rectangle.
    // The interior is a large void, leaving a thin picture-frame ring.
    FRAME: {
        name: "Rectangle Frame",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(0));
            let t = Math.max(1, Math.floor(Math.min(r, c) * 0.15));
            for (let row = 0; row < r; row++) {
                for (let col = 0; col < c; col++) {
                    if (row < t || row >= r - t || col < t || col >= c - t) {
                        m[row][col] = 1;
                    }
                }
            }
            return m;
        }
    },

    // Rectangle with the top-right quadrant removed, forming an L-shape.
    L_BLOCK: {
        name: "L-Block",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(1));
            let cutR = Math.floor(r * 0.5);
            let cutC = Math.floor(c * 0.5);
            for (let row = 0; row < cutR; row++) {
                for (let col = cutC; col < c; col++) {
                    m[row][col] = 0;
                }
            }
            return m;
        }
    },

    // Rectangle split into two separate panels by a horizontal void gap.
    // Top and bottom panels are each independent rectangles.
    TWIN_PANELS: {
        name: "Twin Panels",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(1));
            let gap = Math.max(1, Math.floor(r * 0.1));
            let gapStart = Math.floor(r / 2) - Math.floor(gap / 2);
            for (let row = gapStart; row < gapStart + gap; row++) {
                if (row >= 0 && row < r) {
                    for (let col = 0; col < c; col++) m[row][col] = 0;
                }
            }
            return m;
        }
    },

    // Three descending rectangular steps from full-width at the top
    // to one-third width at the bottom, like a staircase viewed from the side.
    STAIRCASE: {
        name: "Staircase Steps",
        makeMask: (r, c) => {
            let m = Array(r).fill().map(() => Array(c).fill(0));
            const steps = 3;
            for (let row = 0; row < r; row++) {
                let step = Math.floor(row / r * steps);
                let colWidth = Math.max(2, Math.floor(c * (steps - step) / steps));
                for (let col = 0; col < colWidth; col++) {
                    m[row][col] = 1;
                }
            }
            return m;
        }
    },

    // Full rectangle with all cells playable, but the board is always oriented
    // portrait (rows > cols) — taller than wide.  The enforcePortrait flag tells
    // build100PackedLevel to swap the generated dimensions when needed.
    VERTICAL_RECT: {
        name: "Vertical Rectangle",
        enforcePortrait: true,
        makeMask: (r, c) => Array(r).fill().map(() => Array(c).fill(1))
    }
};

function getTopologyForLevel(level, rows, cols) {
    const minSide = Math.min(rows, cols);
    const aspectRatio = Math.max(rows, cols) / Math.max(1, minSide);

    // Small boards (shorter side ≤ 10): always full rectangle.
    // Shape topologies on tiny boards waste too many active cells.
    if (minSide <= 10) {
        return Math.random() < 0.8 ? TOPOLOGIES.VERTICAL_RECT : TOPOLOGIES.SQUARE;
    }

    // Very tall boards (aspect ratio > 1.8 — e.g. 20×36, 20×50):
    // Restrict to topologies that work well on tall portraits.
    // DIAMOND / CIRCLE / WAVES on a 20×50 produce near-empty top/bottom thirds
    // which kills density. Octagon, Hourglass, L-Block, Staircase all work fine.
    if (aspectRatio > 1.8) {
        const tallWeights = {
            VERTICAL_RECT: 6,   // full portrait — most common
            SQUARE:         1,   // plain full rect
            OCTAGON:        2,   // mild corner bevels — works on any ratio
            CORNER_CASTLE:  2,   // cuts two diagonal corners
            HOURGLASS:      1,   // narrows at centre — choke-point variety
            L_BLOCK:        1,   // L-shape asymmetry
            STAIRCASE:      1,   // stepped sides
            CROSS:          1,   // vertical+horizontal band
            TWIN_PANELS:    1,   // two stacked rectangles
        };
        const pool = [];
        for (const [key, w] of Object.entries(tallWeights)) {
            if (TOPOLOGIES[key]) {
                for (let i = 0; i < w; i++) pool.push(TOPOLOGIES[key]);
            }
        }
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // Near-square and moderate boards: full topology variety.
    // DIAMOND and CIRCLE work well here because the aspect ratio is ≤ 1.8.
    const TOPOLOGY_WEIGHTS = {
        VERTICAL_RECT: 5,   // most common
        SQUARE:         1,   // plain rectangle
    };
    const DEFAULT_WEIGHT = 2;

    const pool = [];
    for (const [key, topo] of Object.entries(TOPOLOGIES)) {
        const w = TOPOLOGY_WEIGHTS[key] !== undefined ? TOPOLOGY_WEIGHTS[key] : DEFAULT_WEIGHT;
        for (let i = 0; i < w; i++) pool.push(topo);
    }
    return pool[Math.floor(Math.random() * pool.length)];
}
