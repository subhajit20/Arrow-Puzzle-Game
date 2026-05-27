function generateRandomGridDimensions(preset, level) {
    // Global hard limits: rows 6–50, cols 2–20.
    let minR, maxR, minC, maxC;

    if (preset === "Standard") {
        minR = 6;  maxR = 20;
        minC = 2;  maxC = 10;
    } else if (preset === "Grand") {
        minR = 15; maxR = 28;
        minC = 6;  maxC = 13;
    } else if (preset === "Colossal") {
        minR = 22; maxR = 38;
        minC = 9;  maxC = 16;
    } else if (preset === "Titan") {
        minR = 32; maxR = 46;
        minC = 13; maxC = 18;
    } else if (preset === "Cosmic") {
        minR = 40; maxR = 50;
        minC = 16; maxC = 20;
    } else {
        // Auto — rows and cols scale independently with level
        if (level <= 2) {
            minR = 6;  maxR = 12;
            minC = 2;  maxC = 5;
        } else if (level <= 5) {
            minR = 8;  maxR = 20;
            minC = 3;  maxC = 8;
        } else if (level <= 8) {
            minR = 12; maxR = 30;
            minC = 4;  maxC = 12;
        } else if (level <= 12) {
            minR = 18; maxR = 38;
            minC = 6;  maxC = 15;
        } else if (level <= 18) {
            minR = 25; maxR = 45;
            minC = 9;  maxC = 17;
        } else {
            minR = 35; maxR = 50;
            minC = 14; maxC = 20;
        }
        // After level 10: hard floor of 15 rows × 6 cols
        if (level > 10) {
            minR = Math.max(minR, 15);
            minC = Math.max(minC, 6);
        }
    }

    // Determine target ratio (5% chance of vertical challenge, 95% balanced)
    let targetRatio;
    if (Math.random() < 0.05) {
        targetRatio = 2.8 + Math.random() * 1.2; // 2.8 to 4.0 (tall vertical challenge)
    } else {
        targetRatio = 1.35 + Math.random() * 0.3; // 1.35 to 1.65 (balanced portrait)
    }

    // 1. Roll rows within the active bounds
    let rows = minR + Math.floor(Math.random() * (maxR - minR + 1));

    // 2. Calculate columns using the target aspect ratio
    let cols = Math.ceil(rows / targetRatio);

    // 3. Mobile portrait: ensure enough columns so the board spans the full screen width
    if (typeof window !== 'undefined' && window.innerWidth) {
        const screenW = window.innerWidth;
        if (screenW < 768 && screenW < (window.innerHeight || 800)) {
            const optimalCols = Math.ceil((screenW - 4) / 34);
            cols = Math.max(cols, optimalCols);
        }
    }

    // 4. Strictly clamp cols within active preset boundaries
    cols = Math.max(minC, Math.min(maxC, cols));

    // 5. Keep the originally rolled rows — do NOT recalculate from clamped cols.
    // Recalculating would snap rows back to near minR whenever cols is capped
    // (e.g. level 19+: rolled rows=45 → cols clamped to 20 → ceil(20×1.5)=30
    //  → max(35,30)=35, discarding the rolled 45). Just clamp to preset bounds.
    rows = Math.max(minR, Math.min(maxR, rows));

    // 6. Global hard safety clamps
    rows = Math.min(50, Math.max(6, rows));
    cols = Math.min(20, Math.max(2, cols));

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
    // Weighted selection — VERTICAL_RECT appears most often, SQUARE rarely.
    // Every other topology uses DEFAULT_WEIGHT.
    const TOPOLOGY_WEIGHTS = {
        VERTICAL_RECT: 5,   // ← most common: tall portrait boards
        SQUARE:        1,   // ← least common: plain full rectangle
    };
    const DEFAULT_WEIGHT = 2;

    const pool = [];
    for (const [key, topo] of Object.entries(TOPOLOGIES)) {
        const w = TOPOLOGY_WEIGHTS[key] !== undefined ? TOPOLOGY_WEIGHTS[key] : DEFAULT_WEIGHT;
        for (let i = 0; i < w; i++) pool.push(topo);
    }
    return pool[Math.floor(Math.random() * pool.length)];
}
