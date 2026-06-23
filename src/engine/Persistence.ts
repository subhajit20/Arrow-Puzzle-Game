// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
// (no shared-symbol imports needed)
// localStorage-backed save/resume. Persists the IN-PROGRESS board so a player returns to the exact
// point they left (pieces already cleared stay cleared, lives/hints/blocked pieces preserved).
// Stored as one versioned JSON blob:  { v, level, board }  where board is null when only the level
// progression matters (after a win/loss) and a full snapshot while a puzzle is in progress.
export class Persistence {
    constructor(key = "arrowEscapeSave") { this.key = key; this.V = 1; }

    // Minimal snapshot needed to rebuild the exact mid-puzzle state.
    #serialize(G) {
        return {
            level: G.level, tierName: G.tierName, COLS: G.COLS, ROWS: G.ROWS,
            mask: G.mask ? Array.from(G.mask) : null,
            total: G.total, hearts: G.hearts, hintsLeft: G.hintsLeft,
            initialOccupied: [...G.initialOccupied],   // original occupancy (so vacated cells still dot)
            arrows: G.arrows.map(a => ({ id: a.id, body: a.body, dir: a.dir, blocked: !!a.blocked })),
        };
    }

    // Resume to this exact board next time.
    saveBoard(G) {
        try { localStorage.setItem(this.key, JSON.stringify({ v: this.V, level: G.level, board: this.#serialize(G) })); }
        catch (e) { /* storage unavailable/full: ignore */ }
    }

    // A plain serialized snapshot of a board (e.g. the fresh original of a level), to stash and
    // restore later — used so a lost level replays the SAME board instead of a new random one.
    snapshot(G) { return this.#serialize(G); }

    // Save a pre-serialized board snapshot as the resume target.
    saveSnapshot(level, board) {
        try { localStorage.setItem(this.key, JSON.stringify({ v: this.V, level, board })); }
        catch (e) { /* ignore */ }
    }

    // Progression only (no in-progress board) — used on win/loss so the next open starts the right
    // level with a FRESH board rather than a half-finished or empty one.
    saveProgress(level) {
        try { localStorage.setItem(this.key, JSON.stringify({ v: this.V, level, board: null })); }
        catch (e) { /* ignore */ }
    }

    load() {
        try {
            const raw = localStorage.getItem(this.key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || data.v !== this.V) return null;   // version mismatch → ignore (fresh start)
            return data;
        } catch (e) { return null; }
    }

    clear() { try { localStorage.removeItem(this.key); } catch (e) { /* ignore */ } }
}
