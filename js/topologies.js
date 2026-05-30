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

