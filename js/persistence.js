const Persistence = {
    saveState() {
        if (State.dailyPuzzleMode) return;
        try {
            const dataToSave = {
                level: State.level,
                score: State.score,
                lives: State.lives,
                gridRows: State.gridRows,
                gridCols: State.gridCols,
                gridSize: State.gridSize,
                gridMask: State.gridMask,
                shapeName: State.shapeName,
                gridSizePreset: State.gridSizePreset,
                paths: State.paths
            };
            localStorage.setItem('vecto_colossal_mosaic_save_v2', JSON.stringify(dataToSave));
        } catch (e) {
            console.error("Failed to write to local storage quota:", e);
        }
    },
    loadState() {
        const rawData = localStorage.getItem('vecto_colossal_mosaic_save_v2');
        if (!rawData) return false;
        try {
            const saved = JSON.parse(rawData);
            let mask = saved.gridMask || [];
            if (mask.some(row => row.includes(-1)) || !saved.gridRows || !saved.gridCols) {
                return false;
            }
            State.level = saved.level || 1;
            State.score = saved.score || 0;
            State.lives = saved.lives !== undefined ? saved.lives : 3;
            State.gridRows = saved.gridRows;
            State.gridCols = saved.gridCols;
            State.gridSize = saved.gridSize || Math.max(saved.gridRows, saved.gridCols);
            State.gridMask = mask;
            State.shapeName = saved.shapeName || "Square Matrix";
            State.gridSizePreset = saved.gridSizePreset || "Auto";
            State.paths = saved.paths || [];
            return true;
        } catch (e) {
            console.error("Failed to rehydrate data store:", e);
            return false;
        }
    },
    clearState() {
        localStorage.removeItem('vecto_colossal_mosaic_save_v2');
    }
};
