// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
import { HINTS, LIVES } from './constants';
// Mutable state for a single playthrough of a level. Depends on constants.js (LIVES).
export class GameState {
    constructor(level, C, R, arrows, mask = null) {
        this.level = level;
        this.COLS = C;
        this.ROWS = R;
        this.mask = mask;   // optional board shape (Uint8Array, 1=in-board); null = full rectangle
        // Clone arrows so gameplay mutations never touch the generator's output.
        this.arrows = arrows.map(a => ({ ...a }));
        this.total = arrows.length;
        this.hearts = LIVES;
        this.anims = [];
        this.hintId = null;
        this.hintsLeft = HINTS;   // limited hints per board (button disables at 0)
        this.over = false;

        // cell id -> owning arrow id (authoritative occupancy lookup).
        this.board = new Map();
        for (const a of this.arrows) for (const c of a.body) this.board.set(c, a.id);

        // Cells occupied at board start. A dot is shown only for these once they're vacated
        // (by clearing an arrow); cells empty from the start (coverage gaps) never show a dot.
        this.initialOccupied = new Set(this.board.keys());
    }

    // Rebuild a mid-puzzle state from a persisted snapshot (see Persistence). Unlike the constructor,
    // this keeps already-cleared pieces gone and preserves hearts/hints/blocked flags + the ORIGINAL
    // initialOccupied (so cells vacated before the save still render dots).
    static restore(d) {
        const g = Object.create(GameState.prototype);
        g.level = d.level;
        g.COLS = d.COLS;
        g.ROWS = d.ROWS;
        g.mask = d.mask ? Uint8Array.from(d.mask) : null;
        g.arrows = d.arrows.map(a => ({ ...a }));
        g.total = d.total;
        g.hearts = d.hearts;
        g.hintsLeft = d.hintsLeft != null ? d.hintsLeft : HINTS;
        g.anims = [];
        g.hintId = null;
        g.over = false;
        g.revealing = false;          // a resumed board is already in progress — no entrance reveal
        g.tierName = d.tierName;
        g.board = new Map();
        for (const a of g.arrows) for (const c of a.body) g.board.set(c, a.id);
        g.initialOccupied = new Set(d.initialOccupied);
        return g;
    }
}
