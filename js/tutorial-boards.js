// =============================================================================
// tutorial-boards.js — Handcrafted boards for the first-play coached tutorial
//
// TUTORIAL_BOARDS is merged into the BOARDS object by main.js so BoardLoader
// serves them for levels 0 and 1. They are NEVER generated and never saved
// (GameController skips persistence while gc.tutorialMode is true).
//
//   Level 0 — teaches the tap: three independent vertical arrows (up / down /
//             up) in well-separated columns. No blocking — every arrow has a
//             clear runway off its own edge.
//
//   Level 1 — teaches blocking + solve order: two free arrows (top points
//             RIGHT, bottom points LEFT) and two blocked arrows whose exit
//             nodes are occupied by a free arrow. Clearing a free arrow opens
//             the runway for a blocked one.
//
// Coordinates are node-lattice coords (Grid is (rows+1)×(cols+1) nodes).
// A path's HEAD is nodes[last]; heading is nodes[last-1] → nodes[last].
// =============================================================================

const TUTORIAL_BOARDS = {
    // ── Level 0 — tap teaching (6×4 grid → 7×5 node lattice) ─────────────────
    "0": {
        level: 0,
        gridRows: 6,
        gridCols: 4,
        difficulty: "EASY",
        paths: [
            // col 0 — points UP (head at top), clear runway off top edge
            { id: 10, heading: "UP",
              nodes: [{ r: 5, c: 0 }, { r: 4, c: 0 }, { r: 3, c: 0 }, { r: 2, c: 0 }, { r: 1, c: 0 }] },
            // col 2 — points DOWN (head at bottom), clear runway off bottom edge
            { id: 11, heading: "DOWN",
              nodes: [{ r: 1, c: 2 }, { r: 2, c: 2 }, { r: 3, c: 2 }, { r: 4, c: 2 }, { r: 5, c: 2 }] },
            // col 4 — points UP (head at top), clear runway off top edge
            { id: 12, heading: "UP",
              nodes: [{ r: 5, c: 4 }, { r: 4, c: 4 }, { r: 3, c: 4 }, { r: 2, c: 4 }, { r: 1, c: 4 }] },
        ],
    },

    // ── Level 1 — blocking + solve order (6×4 grid → 7×5 node lattice) ───────
    "1": {
        level: 1,
        gridRows: 6,
        gridCols: 4,
        difficulty: "EASY",
        paths: [
            // FREE: top row, points RIGHT off the right edge
            { id: 20, heading: "RIGHT",
              nodes: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }, { r: 0, c: 4 }] },
            // FREE: bottom row, points LEFT off the left edge
            { id: 21, heading: "LEFT",
              nodes: [{ r: 6, c: 4 }, { r: 6, c: 3 }, { r: 6, c: 2 }, { r: 6, c: 1 }, { r: 6, c: 0 }] },
            // BLOCKED-UP: col 1, points UP — exit node (0,1) is owned by path 20
            { id: 22, heading: "UP",
              nodes: [{ r: 5, c: 1 }, { r: 4, c: 1 }, { r: 3, c: 1 }, { r: 2, c: 1 }, { r: 1, c: 1 }] },
            // BLOCKED-DOWN: col 3, points DOWN — exit node (6,3) is owned by path 21
            { id: 23, heading: "DOWN",
              nodes: [{ r: 1, c: 3 }, { r: 2, c: 3 }, { r: 3, c: 3 }, { r: 4, c: 3 }, { r: 5, c: 3 }] },
        ],
    },
};
