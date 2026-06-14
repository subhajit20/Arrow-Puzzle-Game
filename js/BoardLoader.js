// =============================================================================
// BoardLoader.js — Loads pre-built boards from the BOARDS static data object
//
// BOARDS is defined in boards-data.js and has the shape:
//   { "100": { level, gridRows, gridCols, difficulty, paths: [{id,nodes,heading}] } }
//
// load(level) returns a board object ready for GameController.startLevel():
//   { grid: Grid, paths: Path[], mask: null, difficulty: string }
//
// export(board) serialises the current board to a boards-data.js entry string.
// =============================================================================

class BoardLoader {
    // data: the BOARDS object from boards-data.js (pass `typeof BOARDS !== 'undefined' ? BOARDS : {}`)
    constructor(data) {
        this._data = data || {};
    }

    // ── Existence check ───────────────────────────────────────────────────────

    has(level) {
        return !!this._data[level];
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    // Returns { grid, paths, mask, difficulty } or null if level not found.
    load(level) {
        const entry = this._data[level];
        if (!entry) return null;

        const rows = entry.gridRows;
        const cols = entry.gridCols;

        // Build Grid
        const grid = new Grid(rows, cols);

        // Build Path instances and claim nodeOwner
        const paths = entry.paths.map(p => {
            const nodes = p.nodes.map(n => ({ r: n.r, c: n.c }));
            const path  = new Path(p.id, nodes, p.heading);
            for (const { r, c } of nodes) grid.setOwner(r, c, p.id);
            return path;
        });

        // Reserve edges from node sequences
        for (const p of paths) {
            for (let i = 0; i < p.nodes.length - 1; i++) {
                const a = p.nodes[i], b = p.nodes[i + 1];
                grid.reserveEdge(a.r, a.c, b.r, b.c, p.id);
            }
            p.originalNodes = p.nodes.map(n => ({ r: n.r, c: n.c }));
        }

        console.log(
            `[BoardLoader] Level ${level} loaded` +
            ` | paths: ${paths.length}` +
            ` | grid: ${rows}×${cols}`
        );

        return {
            grid,
            paths,
            mask:       null,
            difficulty: entry.difficulty || 'NORMAL',
        };
    }

    // ── Multiplayer: build from the server's serialized board ─────────────────

    // Builds a board from the multiplayer server's board_json (Persistence V5
    // shape + `mask`). Mirrors load(): claims node owners, reserves edges, and
    // records originalNodes so retry/reset works.
    // Returns { grid, paths, mask, difficulty } or null.
    fromServer(b) {
        if (!b || !Array.isArray(b.paths)) return null;

        const grid = new Grid(b.gridRows, b.gridCols);

        const paths = b.paths.map(p => {
            const nodes = p.nodes.map(n => ({ r: n.r, c: n.c }));
            const path  = new Path(p.id, nodes, p.heading);
            for (const { r, c } of nodes) grid.setOwner(r, c, p.id);
            return path;
        });

        for (const p of paths) {
            for (let i = 0; i < p.nodes.length - 1; i++) {
                const a = p.nodes[i], c = p.nodes[i + 1];
                grid.reserveEdge(a.r, a.c, c.r, c.c, p.id);
            }
            p.originalNodes = p.nodes.map(n => ({ r: n.r, c: n.c }));
        }

        // Race boards are rectangular (mask null). Shaped masks ride through as
        // the server's array form for the renderer's active-node test.
        grid.mask = b.mask || null;

        return {
            grid,
            paths,
            mask:       b.mask || null,
            difficulty: b.boardDifficulty || 'NORMAL',
        };
    }

    // ── Export ────────────────────────────────────────────────────────────────

    // Serialises a live board into a boards-data.js entry string.
    // levelKey: the key to use in the BOARDS object (e.g. 100).
    export(board, levelKey) {
        if (!board || !board.grid || !board.paths) return '';

        const { grid, paths, difficulty } = board;

        const nodesStr = p =>
            p.nodes.map(n => `{"r":${n.r},"c":${n.c}}`).join(',');

        const pathsStr = paths
            .map(p => `{"id":${p.id},"nodes":[${nodesStr(p)}],"heading":"${p.heading}"}`)
            .join(',\n      ');

        const totalNodes = (grid.rows + 1) * (grid.cols + 1);
        const usedNodes  = paths.reduce((s, p) => s + p.nodes.length, 0);
        const coverage   = Math.round(usedNodes / totalNodes * 100);

        console.log(`[BoardLoader] Export: ${paths.length} paths, ${coverage}% coverage`);

        return (
`const BOARDS = {
  "${levelKey}": {
    "level": ${levelKey},
    "gridRows": ${grid.rows},
    "gridCols": ${grid.cols},
    "difficulty": "${difficulty || 'NORMAL'}",
    "paths": [
      ${pathsStr}
    ]
  }
};`
        );
    }
}
