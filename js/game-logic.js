function getPathOccupiedCells(p) {
    if (p.state === "CLEARED") return [];
    return p.nodes;
}

function triggerCameraShake() {
    const container = document.getElementById('board-container');
    container.classList.add('shake');
    setTimeout(() => container.classList.remove('shake'), 400);
}

function processFailurePenalty() {
    State.lives--;
    Persistence.saveState();
    updateDomUI();
    if (State.lives <= 0) {
        State.isFailState = true;
        setTimeout(() => {
            document.getElementById('fail-overlay').classList.remove('opacity-0', 'pointer-events-none', 'scale-105');
        }, 500);
    }
}

function checkVictoryConditionStates() {
    if (State.paths.length === 0) return;
    let remains = State.paths.some(p => p.state !== "CLEARED");
    if (!remains && !State.isWinState) {
        State.isWinState = true;
        AudioEngine.win();
        spawnWinExplosionParticles();

        if (State.dailyPuzzleMode) {
            State.dailyScore += 100;
        } else {
            State.score += 100;
        }
        updateDomUI();

        if (State.dailyPuzzleMode) {
            const earned = State.dailyScore;
            const existing = DailyPuzzle.load();
            const attempts = (existing ? existing.attempts : 0) + 1;
            const bestScore = existing ? Math.max(existing.bestScore || 0, earned) : earned;
            DailyPuzzle.save({ bestScore, attempts });

            document.getElementById('daily-result-date').innerText = DailyPuzzle.getTodayFormatted();
            document.getElementById('daily-result-earned').innerText = `+${earned} pts`;
            document.getElementById('daily-result-best').innerText =
                attempts > 1 ? `Best today: ${bestScore} pts · Attempt ${attempts}` : `First solve today!`;

            setTimeout(() => {
                document.getElementById('daily-result-overlay').classList.remove('hidden');
            }, 700);
        } else {
            Persistence.clearState();

            const quotes = [
                "All long vector corridors have been cleared!",
                "Unrivaled spatial analysis!",
                "The lanes slide free flawlessly.",
                "An elegant untangle solution!",
                "The white board is empty!"
            ];
            document.getElementById('win-quote').innerText = `"${quotes[Math.floor(Math.random() * quotes.length)]}"`;

            setTimeout(() => {
                document.getElementById('win-overlay').classList.remove('opacity-0', 'pointer-events-none', 'scale-105');
            }, 600);
        }
    }
}

function spawnWinExplosionParticles() {
    const colors = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ec4899"];
    const pCount = 75;
    const originX = State.offsetX + (State.gridCols * State.cellSize) / 2;
    const originY = State.offsetY + (State.gridRows * State.cellSize) / 2;
    for (let i = 0; i < pCount; i++) {
        State.particles.push({
            x: originX,
            y: originY,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            size: 2 + Math.random() * 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 1,
            decay: 0.015 + Math.random() * 0.015
        });
    }
}

const actions = {
    cycleMatrixSize() {
        let idx = SIZING_PRESETS.indexOf(State.gridSizePreset);
        let nextIdx = (idx + 1) % SIZING_PRESETS.length;
        State.gridSizePreset = SIZING_PRESETS[nextIdx];
        build100PackedLevel(true);
    },
    triggerNextLevel() {
        State.level++;
        document.getElementById('win-overlay').classList.add('opacity-0', 'pointer-events-none', 'scale-105');
        State.isWinState = false;
        State.isFailState = false;
        State.hintPathId = null;
        State.selectedPath = null;
        State.particles = [];
        State.animatingCount = 0;

        let success = false;
        try {
            success = build100PackedLevel(true);
        } catch (e) {
            console.error("Level generation error:", e);
        }

        if (!success) {
            State.level--;
            State.isWinState = true;
            document.getElementById('win-overlay').classList.remove('opacity-0', 'pointer-events-none', 'scale-105');
        }
    },
    retryCurrentLevel() {
        if (State.dailyPuzzleMode) {
            State.dailyScore = 0;
        } else {
            State.score = State.levelStartScore;
        }
        State.lives = 3;
        document.getElementById('fail-overlay').classList.add('opacity-0', 'pointer-events-none', 'scale-105');
        State.isFailState = false;

        State.paths.forEach(p => {
            p.state = "IDLE";
            p.animProgress = 0;
        });
        State.hintPathId = null;
        State.selectedPath = null;

        resetCamera();
        if (!State.dailyPuzzleMode) Persistence.saveState();
        updateDomUI();
    },
    skipLevel() {
        if (State.animatingCount > 0) return;
        build100PackedLevel(true);
    },
    useHint() {
        if (State.isWinState || State.isFailState) return;
        const remaining = State.paths.filter(p => p.state === "IDLE");
        if (remaining.length > 0) {
            State.hintPathId = remaining[Math.floor(Math.random() * remaining.length)].id;
            AudioEngine.playTone(880.00, 'sine', 0.15, 0.08);
        }
    }
};
