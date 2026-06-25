// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
// Shared constants for Arrow Escape. Loaded as a classic script; these top-level
// declarations are visible to the other js/ files loaded after it.

// Direction unit vectors [dx, dy] and the ordered list of direction keys.
export const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
export const DK = Object.keys(DIRS);

// Opposite / clockwise / counter-clockwise direction maps (used by the generator).
export const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const CW = { E: 'S', S: 'W', W: 'N', N: 'E' };
export const CCW = { E: 'N', N: 'W', W: 'S', S: 'E' };

// Palette.
export const COLORS = {
    NAVY: "#26324F",
    GREEN: "#16B26B",
    BLUE: "#3D8BFF",
    RED: "#FF4B55",
    DOT: "#A3B4D1",
};


// Grid size grows with the level. Each band lists a few sizes [cols, rows] — a mix of portrait
// and SQUARE grids; consecutive levels rotate through them so nearby levels differ. Difficulty is
// size-independent, so growing/reshaping the board here needs NO difficulty re-tuning.
export const SIZE_BANDS = [
    // each band mixes tall rectangles, a near-square rectangle, and squares (varied per level)
    { maxLevel: 2, sizes: [[8, 10], [10, 12], [8, 12], [10, 10]] },                          // very small (first levels)
    { maxLevel: 5, sizes: [[12, 16], [12, 18], [14, 14], [12, 12], [14, 18]] },              // small
    { maxLevel: 10, sizes: [[16, 24], [18, 28], [16, 20], [18, 18], [20, 20]] },
    { maxLevel: 18, sizes: [[20, 32], [22, 34], [20, 26], [24, 24], [26, 26]] },
    { maxLevel: 30, sizes: [[24, 38], [26, 42], [24, 30], [28, 28], [30, 30]] },
    { maxLevel: 45, sizes: [[28, 46], [30, 50], [28, 36], [32, 32], [36, 36]] },
    { maxLevel: Infinity, sizes: [[30, 54], [34, 58], [32, 42], [36, 36], [40, 40]] },        // endgame — large
];
export function sizeForLevel(level) {
    const L = Math.max(1, level);
    const band = SIZE_BANDS.find(b => L <= b.maxLevel) || SIZE_BANDS[SIZE_BANDS.length - 1];
    const [c, r] = band.sizes[(L - 1) % band.sizes.length];   // rotate within the band for variety
    return { COLS: c, ROWS: r };
}

// World pixel size of one cell. The board lives in a fixed "world" of COLS*CELL_SIZE x
// ROWS*CELL_SIZE; the Camera scales/translates that world onto the screen (zoom & pan).
export const CELL_SIZE = 24;

// Zoom limits relative to the fit-to-screen zoom (min) and an absolute max.
export const ZOOM_MAX = 5;

// Starting lives.
export const LIVES = 3;

// Hints allowed per board (the hint button highlights one currently-clearable path).
export const HINTS = 3;

// Every 10th level (10, 20, 30, …) is a shape-mask "milestone" board — shapes + their suitable grid
// sizes live in GridShape.js (GridShape.SHAPES / SHAPE_SIZES).
//
// Board shape override for TESTING: "rect" = normal (shapes only on milestone levels);
// any name in GridShape.SHAPES (e.g. "circle") forces that shape on every board.
export const BOARD_SHAPE = "rect";

// Difficulty tiers. Each tier defines:
//   knob     — starting deep-head-bias strength (0..1) the generator builds with
//   min/max  — the target BRANCHING band (avg pieces clearable per step) this tier must land in
// The generator builds, measures the real branching, adapts the knob, and keeps a board whose
// measured branching is inside [min, max] — so every board provably plays at its tier (not a guess).
// Difficulty is measured as a SIZE-INDEPENDENT fraction: how open the board is = pieces clearable
// on the opening board / total pieces (high = easy, low = hard). Because it's a ratio, ONE band set
// works for EVERY grid size — and calibration nudges the per-board `knob` so the measured fraction
// lands in [min, max] regardless of board size. (`knob` = starting deep-head-bias strength.)
export const TIERS = [
    { name: "EASY", knob: 0.25, min: 0.16, max: 1.00 },
    { name: "NORMAL", knob: 0.45, min: 0.11, max: 0.16 },
    { name: "HARD", knob: 0.62, min: 0.075, max: 0.11 },
    { name: "EXPERT", knob: 0.80, min: 0.05, max: 0.075 },
    { name: "TITAN", knob: 0.95, min: 0.00, max: 0.05 },
];

// Level -> tier. Instead of one fixed tier per band, each level range has a POOL of allowed tiers
// (with weights) and we pick one at random — so a mix of difficulties shows up within every range.
// The floor rises as you climb: EASY fades out and is gone after level 20; beyond that all the
// harder tiers appear in every range, leaning harder the further you go.
export function tierForLevel(level) {
    const L = Math.max(1, level);
    let pool;
    if (L <= 3) pool = [["EASY", 1]];                                            // intro — all EASY
    else if (L <= 10) pool = [["EASY", 3], ["NORMAL", 2], ["HARD", 1]];          // easy-leaning mix
    else if (L <= 20) pool = [["EASY", 1], ["NORMAL", 2], ["HARD", 2], ["EXPERT", 1]];  // EASY fading
    else if (L <= 40) pool = [["NORMAL", 2], ["HARD", 3], ["EXPERT", 2], ["TITAN", 1]]; // no EASY; harder
    else pool = [["NORMAL", 1], ["HARD", 2], ["EXPERT", 3], ["TITAN", 3]];       // endgame — hardest-leaning
    let r = Math.random() * pool.reduce((s, p) => s + p[1], 0);
    let name = pool[pool.length - 1][0];
    for (const [n, w] of pool) { if ((r -= w) < 0) { name = n; break; } }
    return TIERS.find(t => t.name === name);
}

// ── TEST MODE ───────────────────────────────────────────────────────────────
// TEST_MODE = true  → every board uses TEST_LEVEL + TEST_TIER (the level progression is ignored),
//                     so you can test one specific level/difficulty. Winning replays the same config.
// TEST_MODE = false → normal game: starts at level 1 and the tier ramps with the level (EASY→TITAN).
export const TEST_MODE = true;
export const TEST_LEVEL = 63;          // level number used while testing
export const TEST_TIER = "EXPERT";      // "EASY" | "NORMAL" | "HARD" | "EXPERT" | "TITAN"
export const TEST_SIZE = [38, 48];      // [cols, rows] to force any grid size while testing; null = use the level's size