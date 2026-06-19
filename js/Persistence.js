// =============================================================================
// Persistence.js — localStorage V5 save / load
//
// Format V5: direct grid dimensions, no subdivision.
// Saved: gridRows, gridCols, level, score, lives, difficulty,
//        recentDifficulties, hEdge[], vEdge[], paths[].
//
// nodeOwner is NOT saved — it is rebuilt from paths.nodes on load.
// =============================================================================

class Persistence {
    constructor() {
        this.KEY_NORMAL   = 'vecto_colossal_mosaic_save_v5';
        this.KEY_DAILY    = 'vecto_daily_puzzle_board_save_v1';
        this.KEY_TUTORIAL = 'vecto_tutorial_seen_v1';
    }

    // ── Tutorial-seen flag ──────────────────────────────────────────────────────

    tutorialSeen() {
        try { return localStorage.getItem(this.KEY_TUTORIAL) === '1'; }
        catch (e) { return false; }
    }

    setTutorialSeen() {
        try { localStorage.setItem(this.KEY_TUTORIAL, '1'); }
        catch (e) { /* storage unavailable — tutorial may replay; harmless */ }
    }

    // Returns the level number from the raw save blob WITHOUT validating the
    // board (no dimension guard). Used to detect a returning player and resume
    // at their level even if the full board failed to restore — so an existing
    // player is never mistaken for a new one and dropped into the tutorial.
    savedLevel(dailyMode = false) {
        const key = dailyMode ? this.KEY_DAILY : this.KEY_NORMAL;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const s = JSON.parse(raw);
            return (typeof s.level === 'number') ? s.level : null;
        } catch (e) { return null; }
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    // gameState: the plain snapshot object from GameController._snapshot()
    save(gameState, dailyMode = false) {
        if (!gameState) return;
        try {
            const data = this.serialize(gameState);
            const key = dailyMode ? this.KEY_DAILY : this.KEY_NORMAL;
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error('[Persistence] save failed:', e);
        }
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    // sizesForLevel: function(level) → [{rows, cols}] — used for dimension guard.
    // Returns a plain data object on success, or null on failure / stale save.
    load(sizesForLevel, dailyMode = false) {
        const key = dailyMode ? this.KEY_DAILY : this.KEY_NORMAL;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        try {
            return this.deserialize(raw, sizesForLevel);
        } catch (e) {
            console.error('[Persistence] load failed:', e);
            return null;
        }
    }

    // ── Clear ─────────────────────────────────────────────────────────────────

    clear(dailyMode = false) {
        const key = dailyMode ? this.KEY_DAILY : this.KEY_NORMAL;
        localStorage.removeItem(key);
    }

    // ── Serialise ─────────────────────────────────────────────────────────────

    serialize(gameState) {
        return {
            version:            5,
            gridRows:           gameState.gridRows,
            gridCols:           gameState.gridCols,
            level:              gameState.level,
            score:              gameState.score,
            lives:              gameState.lives,
            boardDifficulty:    gameState.difficulty   || 'NORMAL',
            recentDifficulties: gameState.recentDifficulties || [],
            hEdge: (gameState.hEdge || []).map(row => Array.from(row)),
            vEdge: (gameState.vEdge || []).map(row => Array.from(row)),
            paths: (gameState.paths || []).map(p => ({
                id:            p.id,
                nodes:         p.nodes,
                heading:       p.heading,
                state:         p.state         || 'IDLE',
                animProgress:  p.animProgress  || 0,
                originalNodes: p.originalNodes || p.nodes,
            })),
            dailyMode:          gameState.dailyMode,
            dailyScore:         gameState.dailyScore,
            date:               gameState.date,
        };
    }

    // ── Deserialise ───────────────────────────────────────────────────────────

    // Returns null when data is invalid or dimensions don't match level's valid sizes.
    deserialize(raw, sizesForLevel) {
        const s = JSON.parse(raw);

        if (s.version !== 5)            return null;
        if (!s.gridRows || !s.gridCols) return null;
        if (!s.hEdge    || !s.vEdge)    return null;
        if (!s.paths || !s.paths.every(p => Array.isArray(p.nodes))) return null;

        // Dimension guard: discard saves whose grid size is not valid for the level.
        if (typeof sizesForLevel === 'function') {
            const valid = sizesForLevel(s.level || 1);
            const ok    = valid.some(sz => sz.rows === s.gridRows && sz.cols === s.gridCols);
            if (!ok) {
                console.warn('[Persistence] Stale save discarded — grid dimensions mismatch');
                return null;
            }
        }

        // Rebuild typed edge arrays
        const hEdge = s.hEdge.map(row => new Int32Array(row));
        const vEdge = s.vEdge.map(row => new Int32Array(row));

        // Restore paths — keep CLEARED state so half-solved boards resume correctly.
        // Reset MOVING/CRASHING to IDLE (can't resume mid-animation).
        const paths = s.paths.map(p => ({
            id:               p.id,
            nodes:            p.nodes.map(n => ({ r: n.r, c: n.c })),
            heading:          p.heading,
            state:            p.state === 'CLEARED' ? 'CLEARED' : 'IDLE',
            animProgress:     0,
            originalNodes:    (p.originalNodes || p.nodes).map(n => ({ r: n.r, c: n.c })),
            crashFlashFrames: 0,
            placeOrder:       p.id,
        }));

        // Rebuild nodeOwner from paths (not persisted)
        const W         = s.gridCols + 1;
        const nodeOwner = new Int32Array((s.gridRows + 1) * W).fill(-1);
        for (const p of paths)
            for (const { r, c } of p.nodes)
                nodeOwner[r * W + c] = p.id;

        return {
            gridRows:           s.gridRows,
            gridCols:           s.gridCols,
            level:              s.level              || 1,
            score:              s.score              || 0,
            lives:              s.lives != null ? s.lives : 3,
            difficulty:         s.boardDifficulty    || 'NORMAL',
            recentDifficulties: s.recentDifficulties || [],
            hEdge,
            vEdge,
            nodeOwner,
            paths,
            dailyMode:          s.dailyMode          || false,
            dailyScore:         s.dailyScore         || 0,
            date:               s.date,
        };
    }
}
