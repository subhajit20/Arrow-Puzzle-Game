// =============================================================================
// DailyPuzzle.js — Date-seeded daily puzzle lifecycle
//
// Uses a Mulberry32 PRNG seeded from today's date so every player gets the
// same board on the same calendar day.
//
// Dependencies: Generator, GameController
// =============================================================================

class DailyPuzzle {
    constructor(generator, gameController) {
        this.generator  = generator;      // Generator
        this.gc         = gameController; // GameController
        this._KEY       = 'vecto_daily_puzzle_v1';
    }

    // ── Seed / date helpers ───────────────────────────────────────────────────

    // Returns an integer seed from today's date: YYYYMMDD
    getSeed() {
        const d = new Date();
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }

    _todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Returns a human-readable date string, e.g. "Monday, June 4, 2025"
    getFormatted() {
        return new Date().toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        });
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    // Loads today's saved result. Returns null if nothing saved or stale date.
    load() {
        try {
            const raw = localStorage.getItem(this._KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data.date === this._todayStr() ? data : null;
        } catch (_) { return null; }
    }

    // Saves today's result. score: the points earned this session.
    save(score) {
        try {
            const existing = this.load();
            const attempts  = (existing?.attempts || 0) + 1;
            const bestScore = Math.max(existing?.bestScore || 0, score);
            localStorage.setItem(this._KEY, JSON.stringify({
                date:      this._todayStr(),
                bestScore,
                attempts,
            }));
            return { bestScore, attempts };
        } catch (_) { return null; }
    }

    // ── Splash / UI ───────────────────────────────────────────────────────────

    initSplash(savedProgress) {
        const today = this.load();

        const dateEl = document.getElementById('daily-date-display');
        if (dateEl) dateEl.innerText = this.getFormatted();

        const bestEl = document.getElementById('daily-best-display');
        const btnEl  = document.getElementById('daily-play-btn');

        if (today && today.bestScore !== undefined) {
            if (bestEl) bestEl.innerText = `Best today: ${today.bestScore} pts`;
            if (btnEl)  btnEl.innerText  = 'Play Again →';
        } else {
            if (bestEl) bestEl.innerText = 'Fresh puzzle — no attempts yet';
            if (btnEl)  btnEl.innerText  = 'Play Today\'s Puzzle →';
        }

        // Normal game continue card
        const statusEl = document.getElementById('level-play-status');
        const scoreEl  = document.getElementById('level-play-score');
        if (savedProgress) {
            if (statusEl) statusEl.innerText = `Level ${savedProgress.level}`;
            if (scoreEl)  scoreEl.innerText  = `${savedProgress.score} pts · continue where you left off`;
        } else {
            if (statusEl) statusEl.innerText = 'Start Fresh';
            if (scoreEl)  scoreEl.innerText  = 'No saved progress — begin from Level 1';
        }

        // Fade in splash
        const splash = document.getElementById('daily-splash');
        if (splash) {
            splash.style.opacity = '0';
            splash.classList.remove('hidden');
            requestAnimationFrame(() => {
                splash.style.transition = 'opacity 0.2s';
                splash.style.opacity    = '1';
            });
        }
    }

    _hideSplash() {
        const splash = document.getElementById('daily-splash');
        if (!splash) return;
        splash.style.transition = 'opacity 0.25s';
        splash.style.opacity    = '0';
        setTimeout(() => splash.classList.add('hidden'), 260);
    }

    // ── Daily puzzle start ────────────────────────────────────────────────────

    // Builds a seeded board using Generator and starts it via GameController.
    // containerEl: the board container DOM element (for camera/resize).
    start(containerEl) {
        this._hideSplash();

        // Replace Math.random with the deterministic seeded PRNG
        const seed      = this.getSeed();
        const seededRng = DailyPuzzle._mulberry32(seed);
        const origRandom = Math.random;
        Math.random = seededRng;

        // Generate level-7 board (small, appropriate for daily)
        const board = this.generator.build(16, 12, 7, 4, 'daily');

        // Restore Math.random immediately
        Math.random = origRandom;

        if (!board) {
            console.error('[DailyPuzzle] Failed to generate daily board');
            return;
        }

        this.gc.dailyMode  = true;
        this.gc.dailyScore = 0;
        this.gc.startLevel(7, board, containerEl);
    }

    // ── Daily puzzle end ──────────────────────────────────────────────────────

    end(score) {
        const result = this.save(score);
        if (!result) return;

        const dateEl   = document.getElementById('daily-result-date');
        const earnedEl = document.getElementById('daily-result-earned');
        const bestEl   = document.getElementById('daily-result-best');

        if (dateEl)   dateEl.innerText   = this.getFormatted();
        if (earnedEl) earnedEl.innerText = `+${score} pts`;
        if (bestEl)   bestEl.innerText   = result.attempts > 1
            ? `Best today: ${result.bestScore} pts · Attempt ${result.attempts}`
            : 'First solve today!';

        setTimeout(() => {
            const overlay = document.getElementById('daily-result-overlay');
            if (overlay) overlay.classList.remove('hidden');
        }, 700);
    }

    // ── Mulberry32 PRNG ───────────────────────────────────────────────────────

    // Deterministic PRNG — same seed always produces the same sequence.
    static _mulberry32(seed) {
        return function () {
            seed |= 0;
            seed  = seed + 0x6D2B79F5 | 0;
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
}
