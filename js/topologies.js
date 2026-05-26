function generateRandomGridDimensions(preset, level) {
    let minR, maxR, minC, maxC;

    if (preset === "Standard") {
        minR = 2; maxR = 12;
        minC = 2; maxC = 12;
    } else if (preset === "Grand") {
        minR = 12; maxR = 22;
        minC = 12; maxC = 22;
    } else if (preset === "Colossal") {
        minR = 20; maxR = 32;
        minC = 20; maxC = 32;
    } else if (preset === "Titan") {
        minR = 30; maxR = 42;
        minC = 30; maxC = 42;
    } else if (preset === "Cosmic") {
        minR = 40; maxR = 50;
        minC = 40; maxC = 50;
    } else {
        if (level <= 2) {
            minR = 2; maxR = 8;
            minC = 2; maxC = 8;
        } else if (level <= 5) {
            minR = 6; maxR = 12;
            minC = 6; maxC = 12;
        } else if (level <= 8) {
            minR = 10; maxR = 20;
            minC = 10; maxC = 20;
        } else if (level <= 12) {
            minR = 18; maxR = 30;
            minC = 18; maxC = 30;
        } else if (level <= 18) {
            minR = 25; maxR = 40;
            minC = 25; maxC = 40;
        } else {
            minR = 35; maxR = 50;
            minC = 35; maxC = 50;
        }
    }

    let rows = minR + Math.floor(Math.random() * (maxR - minR + 1));
    let cols = minC + Math.floor(Math.random() * (maxC - minC + 1));
    rows = Math.min(50, Math.max(2, rows));
    cols = Math.min(50, Math.max(2, cols));
    return { rows, cols };
}

function getDifficultyLabel(level) {
    const maxDim = Math.max(State.gridRows, State.gridCols);
    if (State.gridSizePreset !== "Auto") {
        return { label: `${State.gridSizePreset.toUpperCase()}`, color: "#6366f1" };
    }
    if (maxDim <= 8) return { label: "NORMAL", color: "#10b981" };
    if (maxDim <= 12) return { label: "HARD", color: "#3b82f6" };
    if (maxDim <= 20) return { label: "EXPERT", color: "#f97316" };
    if (maxDim <= 30) return { label: "GRAND", color: "#a855f7" };
    return { label: "TITAN", color: "#ec4899" };
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
    }
};

function getTopologyForLevel(level, rows, cols) {
    const choices = Object.values(TOPOLOGIES);
    return choices[Math.floor(Math.random() * choices.length)];
}
