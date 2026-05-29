const Persistence = {
    _KEY_V2: 'vecto_colossal_mosaic_save_v2',
    _KEY_V3: 'vecto_colossal_mosaic_save_v3',
    _KEY_V4: 'vecto_colossal_mosaic_save_v4',

    // ── Public API ────────────────────────────────────────────────────────────

    saveState() {
        if (State.dailyPuzzleMode) return;
        try {
            if (State.rootRows) {
                this._saveV4();
            } else if (State.hEdge && State.vEdge) {
                this._saveV3();
            } else {
                this._saveV2();
            }
        } catch (e) {
            console.error("Failed to write to local storage quota:", e);
        }
    },

    loadState() {
        // V4 is the current format (subdivision-aware).
        // V3 and V2 are silently discarded — incompatible node coordinate space.
        return this._loadV4();
    },

    clearState() {
        localStorage.removeItem(this._KEY_V2);
        localStorage.removeItem(this._KEY_V3);
        localStorage.removeItem(this._KEY_V4);
    },

    // ── V3 — edge-based format ────────────────────────────────────────────────

    _saveV3() {
        const data = {
            version:           3,
            level:             State.level,
            score:             State.score,
            lives:             State.lives,
            gridRows:          State.gridRows,
            gridCols:          State.gridCols,
            gridSize:          State.gridSize,
            shapeName:         State.shapeName,
            gridSizePreset:    State.gridSizePreset,
            boardDifficulty:   State.boardDifficulty,
            recentDifficulties: State.recentDifficulties,
            // Int32Arrays → plain arrays for JSON serialisation
            hEdge: State.hEdge.map(row => Array.from(row)),
            vEdge: State.vEdge.map(row => Array.from(row)),
            paths: State.paths.map(p => ({
                id:            p.id,
                nodes:         p.nodes,
                heading:       p.heading,
                state:         p.state,
                animProgress:  p.animProgress,
                originalNodes: p.originalNodes
            }))
        };
        localStorage.setItem(this._KEY_V3, JSON.stringify(data));
    },

    _loadV3() {
        const raw = localStorage.getItem(this._KEY_V3);
        if (!raw) return false;
        try {
            const s = JSON.parse(raw);

            // Version and dimension guards
            if (s.version !== 3)                  return false;
            if (!s.gridRows || !s.gridCols)       return false;
            if (!s.hEdge    || !s.vEdge)          return false;
            if (s.hEdge.length !== s.gridRows + 1) return false;
            if (s.vEdge.length !== s.gridRows)     return false;

            // Every path must have a nodes array
            if (!s.paths || !s.paths.every(p => Array.isArray(p.nodes))) return false;

            State.level              = s.level  || 1;
            State.score              = s.score  || 0;
            State.lives              = s.lives  !== undefined ? s.lives : 3;
            State.gridRows           = s.gridRows;
            State.gridCols           = s.gridCols;
            State.gridSize           = s.gridSize || Math.max(s.gridRows, s.gridCols);
            State.shapeName          = s.shapeName       || "Square Matrix";
            State.gridSizePreset     = s.gridSizePreset  || "Auto";
            State.boardDifficulty    = s.boardDifficulty || "NORMAL";
            State.recentDifficulties = s.recentDifficulties || [];

            // Restore typed arrays
            State.hEdge = s.hEdge.map(row => new Int32Array(row));
            State.vEdge = s.vEdge.map(row => new Int32Array(row));

            // Restore paths — always reset animProgress on load
            State.paths = s.paths.map(p => ({
                id:               p.id,
                nodes:            p.nodes,
                heading:          p.heading,
                state:            p.state || "IDLE",
                animProgress:     0,
                originalNodes:    p.originalNodes || p.nodes.slice(),
                crashFlashFrames: 0
            }));

            // Rebuild nodeOwner from restored paths (not persisted, derived on load)
            const _W = s.gridCols + 1;
            State.nodeOwner = new Int32Array((s.gridRows + 1) * _W).fill(-1);
            for (const p of State.paths)
                for (const { r, c } of p.nodes)
                    State.nodeOwner[r * _W + c] = p.id;

            return true;
        } catch (e) {
            console.error("Failed to rehydrate V3 data store:", e);
            return false;
        }
    },

    // ── V4 — subdivision-aware format ────────────────────────────────────────

    _saveV4() {
        const data = {
            version:            4,
            rootRows:           State.rootRows,
            rootCols:           State.rootCols,
            subdivFactor:       State.subdivFactor,
            gridRows:           State.gridRows,
            gridCols:           State.gridCols,
            level:              State.level,
            score:              State.score,
            lives:              State.lives,
            gridSize:           State.gridSize,
            shapeName:          State.shapeName,
            gridSizePreset:     State.gridSizePreset,
            boardDifficulty:    State.boardDifficulty,
            recentDifficulties: State.recentDifficulties,
            hEdge: State.hEdge.map(row => Array.from(row)),
            vEdge: State.vEdge.map(row => Array.from(row)),
            paths: State.paths.map(p => ({
                id:            p.id,
                nodes:         p.nodes,
                heading:       p.heading,
                state:         p.state,
                animProgress:  p.animProgress,
                originalNodes: p.originalNodes
            }))
        };
        localStorage.setItem(this._KEY_V4, JSON.stringify(data));
    },

    _loadV4() {
        const raw = localStorage.getItem(this._KEY_V4);
        if (!raw) return false;
        try {
            const s = JSON.parse(raw);

            if (s.version !== 4)            return false;
            if (!s.rootRows || !s.rootCols) return false;
            if (!s.subdivFactor)            return false;
            if (!s.hEdge || !s.vEdge)       return false;
            if (!s.paths || !s.paths.every(p => Array.isArray(p.nodes))) return false;

            State.rootRows           = s.rootRows;
            State.rootCols           = s.rootCols;
            State.subdivFactor       = s.subdivFactor;
            State.gridRows           = s.rootRows * s.subdivFactor;
            State.gridCols           = s.rootCols * s.subdivFactor;
            State.gridSize           = s.gridSize           || s.rootRows;
            State.level              = s.level              || 1;
            State.score              = s.score              || 0;
            State.lives              = s.lives !== undefined ? s.lives : 3;
            State.shapeName          = s.shapeName          || "Square Matrix";
            State.gridSizePreset     = s.gridSizePreset     || "Auto";
            State.boardDifficulty    = s.boardDifficulty    || "NORMAL";
            State.recentDifficulties = s.recentDifficulties || [];

            State.hEdge = s.hEdge.map(row => new Int32Array(row));
            State.vEdge = s.vEdge.map(row => new Int32Array(row));

            State.paths = s.paths.map(p => ({
                id:               p.id,
                nodes:            p.nodes,
                heading:          p.heading,
                state:            p.state || "IDLE",
                animProgress:     0,
                originalNodes:    p.originalNodes || p.nodes.slice(),
                crashFlashFrames: 0
            }));

            // Rebuild nodeOwner from restored paths (not persisted, derived on load)
            const _W = State.gridCols + 1;
            State.nodeOwner = new Int32Array((State.gridRows + 1) * _W).fill(-1);
            for (const p of State.paths)
                for (const { r, c } of p.nodes)
                    State.nodeOwner[r * _W + c] = p.id;

            return true;
        } catch (e) {
            console.error("Failed to rehydrate V4 data store:", e);
            return false;
        }
    },

    // ── V2 — cell-based format (legacy, unchanged) ────────────────────────────

    _saveV2() {
        const data = {
            level:              State.level,
            score:              State.score,
            lives:              State.lives,
            gridRows:           State.gridRows,
            gridCols:           State.gridCols,
            gridSize:           State.gridSize,
            gridMask:           State.gridMask,
            shapeName:          State.shapeName,
            gridSizePreset:     State.gridSizePreset,
            paths:              State.paths,
            boardDifficulty:    State.boardDifficulty,
            recentDifficulties: State.recentDifficulties
        };
        localStorage.setItem(this._KEY_V2, JSON.stringify(data));
    },

    _loadV2() {
        const raw = localStorage.getItem(this._KEY_V2);
        if (!raw) return false;
        try {
            const s = JSON.parse(raw);
            const mask = s.gridMask || [];
            // Discard saves that contain obstacle pillars or bad dimensions
            if (mask.some(row => row.includes(-1)) || !s.gridRows || !s.gridCols) {
                return false;
            }
            State.level              = s.level  || 1;
            State.score              = s.score  || 0;
            State.lives              = s.lives  !== undefined ? s.lives : 3;
            State.gridRows           = s.gridRows;
            State.gridCols           = s.gridCols;
            State.gridSize           = s.gridSize || Math.max(s.gridRows, s.gridCols);
            State.gridMask           = mask;
            State.shapeName          = s.shapeName       || "Square Matrix";
            State.gridSizePreset     = s.gridSizePreset  || "Auto";
            State.paths              = s.paths || [];
            State.boardDifficulty    = s.boardDifficulty || "NORMAL";
            State.recentDifficulties = s.recentDifficulties || [];
            return true;
        } catch (e) {
            console.error("Failed to rehydrate V2 data store:", e);
            return false;
        }
    }
};
