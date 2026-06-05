// =============================================================================
// main.js — Entry point: instantiate all classes, wire dependencies, start game
//
// Load order in index.html (before main.js):
//   Grid.js, Path.js, SolvabilityOracle.js,
//   ZoneMap.js, RCBuilder.js, DifficultyEngine.js, Validator.js, Generator.js,
//   Camera.js, Renderer.js, AnimationEngine.js,
//   InputHandler.js, AudioEngine.js, GameController.js,
//   Persistence.js, BoardLoader.js, DailyPuzzle.js,
//   boards-data.js,   ← defines the BOARDS global
//   main.js
// =============================================================================

(function () {
    'use strict';

    // ── DOM elements ──────────────────────────────────────────────────────────

    const canvas = document.getElementById('gameCanvas');
    const containerEl = document.getElementById('board-container');

    // ── Instantiate classes in dependency order ───────────────────────────────

    // Foundation
    const oracle = new SolvabilityOracle();

    // Generation core
    const builder = new RCBuilder(oracle);
    const difficulty = new DifficultyEngine();
    const validator = new Validator(oracle);
    const generator = new Generator(builder, difficulty, validator);

    // Presentation
    const camera = new Camera(canvas);
    const renderer = new Renderer(canvas, camera);
    const animation = new AnimationEngine(renderer);

    // Interaction
    const audio = new AudioEngine();
    const persistence = new Persistence();

    // Pre-built boards (BOARDS defined in boards-data.js, empty object if missing)
    const boardsData = typeof BOARDS !== 'undefined' ? BOARDS : {};
    const loader = new BoardLoader(boardsData);

    // Game controller (board set later in startLevel)
    const gc = new GameController(null, renderer, audio, persistence, animation);

    // Daily puzzle
    const daily = new DailyPuzzle(generator, gc);

    // Input (attach after gc is ready)
    const input = new InputHandler(canvas, camera, gc);

    // ── Window resize ─────────────────────────────────────────────────────────

    window.addEventListener('resize', () => {
        if (gc.board) {
            renderer.resize(containerEl, gc.board.grid.rows, gc.board.grid.cols);
        }
    });

    // ── Generation loader ─────────────────────────────────────────────────────

    function showLoader() {
        const el = document.getElementById('generation-loader');
        if (el) el.classList.add('visible');
    }
    function hideLoader() {
        const el = document.getElementById('generation-loader');
        if (el) el.classList.remove('visible');
    }

    // ── Board loading helpers ─────────────────────────────────────────────────

    function loadBoard(level) {
        // 1. Persistence first — player may have mid-solve progress on this level.
        //    Must take priority over the pre-built board so saved state is restored.
        const saved = persistence.load(lvl => generator.sizesForLevel(lvl));
        if (saved && saved.level === level) {
            const grid = new Grid(saved.gridRows, saved.gridCols);
            grid.nodeOwner.set(saved.nodeOwner);
            for (let r = 0; r <= saved.gridRows; r++) grid.hEdge[r].set(saved.hEdge[r]);
            for (let r = 0; r < saved.gridRows; r++) grid.vEdge[r].set(saved.vEdge[r]);

            const paths = saved.paths.map(p => Path.fromLegacy(p));
            return {
                grid, paths, mask: null,
                difficulty: saved.difficulty,
                fromSave: true,   // tells startLevel not to reset path states
                score: saved.score,
                lives: saved.lives,
            };
        }

        // 2. Pre-built board (fresh — no saved progress at this level)
        if (loader.has(level)) {
            const board = loader.load(level);
            if (board) return board;
        }

        // 3. Dynamic generation — caller handles loader show/hide
        const sizes = generator.sizesForLevel(level);
        const size = sizes[Math.floor(Math.random() * sizes.length)];
        const board = generator.build(size.rows, size.cols, level, 4);
        return board;
    }

    function startNormalLevel(level) {
        showLoader();

        // Give browser one frame to paint the loader before generation blocks JS.
        setTimeout(() => {
            const board = loadBoard(level);
            hideLoader();

            if (!board) { console.error('[main] Failed to load level', level); return; }

            if (camera._animReq) { cancelAnimationFrame(camera._animReq); camera._animReq = null; }
            input.detach();
            animation.stop();
            renderer.resize(containerEl, board.grid.rows, board.grid.cols);
            camera.reset();
            animation.start(board, gc);
            input.attach(containerEl);
            gc.startLevel(level, board, containerEl);
        }, 50);
    }

    // ── Public API (called from HTML onclick handlers) ────────────────────────

    // ── TEST MODE — 40×40, level 70 (milestone → heart mask), HARD
    // Remove this block when test mode is no longer needed.
    const TEST_MODE = true;
    const TEST_ROWS = 36;
    const TEST_COLS = 22;
    const TEST_LEVEL = 99;   // (70/10)%2 = 1 → heart mask
    const TEST_TIER = 'HARD';

    // Exposed on window so existing HTML onclick attributes still work.
    window.startNormalGame = function () {
        _hideSplash();
        showLoader();

        setTimeout(() => {
            if (TEST_MODE) {
                const board = generator.build(TEST_ROWS, TEST_COLS, TEST_LEVEL, 4, 'normal');
                hideLoader();
                if (!board) { console.error('[main] Test board generation failed'); return; }
                board.difficulty = TEST_TIER;
                if (camera._animReq) { cancelAnimationFrame(camera._animReq); camera._animReq = null; }
                input.detach();
                animation.stop();
                renderer.resize(containerEl, board.grid.rows, board.grid.cols);
                camera.reset();
                animation.start(board, gc);
                input.attach(containerEl);
                gc.startLevel(TEST_LEVEL, board, containerEl);
                return;
            }
            hideLoader();
            const saved = persistence.load(lvl => generator.sizesForLevel(lvl));
            const level = saved ? saved.level : 1;
            startNormalLevel(level);
        }, 50);
    };

    window.startDailyPuzzle = function () {
        daily.start(containerEl);
    };

    window.exitDailyPuzzle = function () {
        gc.dailyMode = false;
        gc.dailyScore = 0;
        gc.isWinState = false;
        gc.isFailState = false;
        const overlay = document.getElementById('daily-result-overlay');
        if (overlay) overlay.classList.add('hidden');
        startNormalLevel(gc.level);
    };

    window.showSplashScreen = function () {
        const saved = persistence.load(lvl => generator.sizesForLevel(lvl));
        daily.initSplash(saved);
        document.getElementById('daily-result-overlay')?.classList.add('hidden');
        document.getElementById('win-overlay')?.classList.add('opacity-0', 'pointer-events-none', 'scale-105');
        document.getElementById('fail-overlay')?.classList.add('opacity-0', 'pointer-events-none', 'scale-105');
    };

    // Wired to win overlay "Next Level" button
    window.triggerNextLevel = function () {
        gc.nextLevel();
        if (TEST_MODE) { window.startNormalGame(); return; }
        startNormalLevel(gc.level);
    };

    // Wired to fail overlay "Retry" button
    window.retryCurrentLevel = function () {
        gc.retryLevel();
    };

    // Wired to hint button
    window.useHint = function () {
        gc.useHint();
    };

    function _hideSplash() {
        const splash = document.getElementById('daily-splash');
        if (!splash) return;
        splash.style.transition = 'opacity 0.25s';
        splash.style.opacity = '0';
        setTimeout(() => splash.classList.add('hidden'), 260);
    }

    // ── Startup ───────────────────────────────────────────────────────────────

    window.onload = () => {
        const saved = persistence.load(lvl => generator.sizesForLevel(lvl));
        daily.initSplash(saved);
        // No board loaded here — board loads only when the player taps a button.
    };

})();
