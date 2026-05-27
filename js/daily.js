function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function getDailyPuzzleSeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

const DailyPuzzle = {
    storageKey: 'vecto_daily_puzzle_v1',
    getTodayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    getTodayFormatted() {
        return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    },
    load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data.date === this.getTodayStr() ? data : null;
        } catch (e) { return null; }
    },
    save(data) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify({ date: this.getTodayStr(), ...data }));
        } catch (e) { }
    }
};

function initDailySplash() {
    const today = DailyPuzzle.load();
    document.getElementById('daily-date-display').innerText = DailyPuzzle.getTodayFormatted();
    if (today && today.bestScore !== undefined) {
        document.getElementById('daily-best-display').innerText = `Best today: ${today.bestScore} pts`;
        document.getElementById('daily-play-btn').innerText = 'Play Again →';
    } else {
        document.getElementById('daily-best-display').innerText = "Fresh puzzle — no attempts yet";
        document.getElementById('daily-play-btn').innerText = 'Play Today\'s Puzzle →';
    }

    try {
        const raw = localStorage.getItem('vecto_colossal_mosaic_save_v2');
        if (raw) {
            const saved = JSON.parse(raw);
            document.getElementById('level-play-status').innerText = `Level ${saved.level || 1}`;
            document.getElementById('level-play-score').innerText = `${saved.score || 0} pts · continue where you left off`;
        } else {
            document.getElementById('level-play-status').innerText = 'Start Fresh';
            document.getElementById('level-play-score').innerText = 'No saved progress — begin from Level 1';
        }
    } catch (e) {
        document.getElementById('level-play-status').innerText = 'Start Fresh';
        document.getElementById('level-play-score').innerText = '';
    }

    const splash = document.getElementById('daily-splash');
    splash.style.opacity = '0';
    splash.classList.remove('hidden');
    requestAnimationFrame(() => {
        splash.style.transition = 'opacity 0.2s';
        splash.style.opacity = '1';
    });
}

function showSplashScreen() {
    State.paths.forEach(p => {
        if (p.state === 'MOVING') { p.state = 'IDLE'; p.animProgress = 0; }
    });
    State.animatingCount = 0;

    if (!State.dailyPuzzleMode) {
        Persistence.saveState();
    }

    State.dailyPuzzleMode = false;
    State.isWinState = false;
    State.isFailState = false;

    document.getElementById('daily-result-overlay').classList.add('hidden');
    document.getElementById('win-overlay').classList.add('opacity-0', 'pointer-events-none', 'scale-105');
    document.getElementById('fail-overlay').classList.add('opacity-0', 'pointer-events-none', 'scale-105');

    initDailySplash();
}

function startDailyPuzzle() {
    const splash = document.getElementById('daily-splash');
    splash.style.transition = 'opacity 0.25s';
    splash.style.opacity = '0';
    setTimeout(() => splash.classList.add('hidden'), 260);

    State.dailyPuzzleMode = true;
    State.dailyScore = 0;

    const seededRng = mulberry32(getDailyPuzzleSeed());
    const origRandom = Math.random;
    Math.random = seededRng;

    const savedLevel = State.level;
    const savedPreset = State.gridSizePreset;
    State.level = 7;
    State.gridSizePreset = "Auto";

    build100PackedLevel(true);

    Math.random = origRandom;
    State.level = savedLevel;
    State.gridSizePreset = savedPreset;
}

function startNormalGame() {
    const splash = document.getElementById('daily-splash');
    splash.style.transition = 'opacity 0.25s';
    splash.style.opacity = '0';
    setTimeout(() => splash.classList.add('hidden'), 260);

    build100PackedLevel(false);
}

function exitDailyPuzzle() {
    State.dailyPuzzleMode = false;
    State.dailyScore = 0;
    State.isWinState = false;
    State.isFailState = false;
    State.hintPathId = null;
    State.selectedPath = null;
    State.particles = [];
    State.animatingCount = 0;
    document.getElementById('daily-result-overlay').classList.add('hidden');
    document.getElementById('win-overlay').classList.add('opacity-0', 'pointer-events-none', 'scale-105');

    build100PackedLevel(false);
}
