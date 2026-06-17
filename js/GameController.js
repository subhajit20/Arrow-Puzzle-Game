// =============================================================================
// GameController.js — Game state machine and level lifecycle
//
// Owns all mutable game state:
//   level, score, lives, isWinState, isFailState
//   selectedPathId, hintPathId, recentDifficulties
//
// Coordinates: Board (data), Renderer (display), AudioEngine (sound),
//              Persistence (save/load), AnimationEngine (particles + reveal).
//
// Does NOT read from global State — fully self-contained.
//
// Dependencies: Board, Renderer, AudioEngine, Persistence, AnimationEngine
// =============================================================================

class GameController {
    constructor(board, renderer, audio, persistence, animation) {
        this.board       = board;       // { grid, paths, mask, difficulty }
        this.renderer    = renderer;    // Renderer
        this.audio       = audio;       // AudioEngine
        this.persistence = persistence; // Persistence
        this.animation   = animation;   // AnimationEngine

        // Game state
        this.level              = 1;
        this.score              = 0;
        this.lives              = 3;
        this.levelStartScore    = 0;
        this.isWinState         = false;
        this.isFailState        = false;
        this.dailyMode          = false;
        this.dailyScore         = 0;
        this.recentDifficulties = [];

        // UI references (set by renderer)
        this.selectedPathId = null;
        this.hintPathId     = null;
        this.revealActive   = false;

        // Container element for camera operations
        this.containerEl = null;

        // Multiplayer race hooks (no-ops in single-player; set by RaceClient).
        this.raceMode    = false;
        this.onProgress  = null; // (cleared, total) => void — fired on each clear
        this.onRaceWin   = null; // () => void — fired when the board is cleared
        this.onRaceRetry = null; // () => void — fired when lives hit 0 (board resets, no elimination)

        // Order in which paths were cleared, for server-side finish verification
        // (race mode). The server replays this against the board to confirm the
        // solve is real before recording a placement.
        this._clearOrder = [];
    }

    // ── Level lifecycle ───────────────────────────────────────────────────────

    // Loads a pre-built board or generates one dynamically.
    // board must be a { grid, paths, mask, difficulty } object.
    startLevel(level, boardData, containerEl) {
        this.level          = level;
        this.isWinState     = false;
        this.isFailState    = false;
        this.hintPathId     = null;
        this.selectedPathId = null;
        this.containerEl    = containerEl;
        this.revealActive   = false;
        this._clearOrder    = [];

        // Commit board data
        this.board = boardData;

        if (boardData.fromSave) {
            // Restoring a mid-solve session — keep CLEARED paths cleared.
            // Only reset MOVING/CRASHING back to IDLE (can't resume mid-animation).
            this.lives           = boardData.lives  ?? 3;
            this.score           = boardData.score  ?? this.score;
            this.levelStartScore = this.score;
            for (const p of this.board.paths) {
                if (p.state !== 'CLEARED') {
                    p.state        = 'IDLE';
                    p.animProgress = 0;
                    p.crashFlashFrames = 0;
                }
            }
        } else {
            // Fresh board — reset everything.
            this.lives           = 3;
            this.levelStartScore = this.score;
            for (const p of this.board.paths) {
                p.state        = 'IDLE';
                p.animProgress = 0;
                p.crashFlashFrames = 0;
            }
        }

        // Track difficulty history
        if (boardData.difficulty) {
            this.recentDifficulties.push(boardData.difficulty);
            if (this.recentDifficulties.length > 5) this.recentDifficulties.shift();
        }

        // Save and update display
        this.persistence.save(this._snapshot(), this.dailyMode);
        this._updateUI();

        // Start reveal animation → entrance animation
        this.revealActive = true;
        this.animation.startRevealAnimation(
            this.board.paths,
            containerEl,
            this.renderer.camera,
            () => { this.revealActive = false; }
        );
    }

    nextLevel() {
        this.level++;
        this._hideOverlay('win-overlay');
        this.isWinState     = false;
        this.isFailState    = false;
        this.hintPathId     = null;
        this.selectedPathId = null;
        this.animation.clearParticles();
        // Caller (main.js) regenerates the board and calls startLevel
    }

    retryLevel() {
        this.score  = this.levelStartScore;
        this.lives  = 3;
        this.isFailState    = false;
        this.hintPathId     = null;
        this.selectedPathId = null;
        this._clearOrder    = []; // board resets to start — re-solve from scratch
        this._hideOverlay('fail-overlay');

        for (const p of this.board.paths) {
            p.state        = 'IDLE';
            p.animProgress = 0;
            p.crashFlashFrames = 0;
            p._logicFired  = false;   // clear the exit flag so cleared-count / win reset to 0
            // Restore original nodes
            if (p.originalNodes && p.originalNodes.length) {
                p.nodes = p.originalNodes.map(n => ({ r: n.r, c: n.c }));
            }
        }

        this.persistence.save(this._snapshot(), this.dailyMode);
        this._updateUI();
    }

    // ── Hint ──────────────────────────────────────────────────────────────────

    useHint() {
        if (this.isWinState || this.isFailState) return;
        const idle = this.board.paths.filter(p => p.state === 'IDLE');
        if (idle.length === 0) return;

        // Hint must point at a piece that can actually escape right now.
        // Boards are built with few free pieces per step (near-unique solve
        // order), so a random idle pick is almost always blocked — a hint
        // that costs a life is worse than none.
        this._oracle = this._oracle || new SolvabilityOracle();
        const cleared = new Set(
            this.board.paths.filter(p => p.state === 'CLEARED').map(p => p.id)
        );
        const movable = idle.filter(p =>
            this._oracle.canEscape(p, cleared, this.board.grid)
        );
        const pool = movable.length ? movable : idle;
        this.hintPathId = pool[Math.floor(Math.random() * pool.length)].id;
        this.audio.playHint();
    }

    // ── Callbacks from AnimationEngine ────────────────────────────────────────

    onPathCleared(path) {
        // Record clear order once per path (AnimationEngine gates this via
        // _logicFired, but guard anyway so a re-fire can't corrupt the order).
        if (this._clearOrder[this._clearOrder.length - 1] !== path.id &&
            !this._clearOrder.includes(path.id)) {
            this._clearOrder.push(path.id);
        }
        this.addScore(10);
        this.audio.playPathCleared();
        this._updateUI();
        if (this.onProgress) this.onProgress(this._clearedCount(), this.board.paths.length);
        this.checkWin();
    }

    // The order in which paths were cleared this solve — sent to the server on
    // race finish so it can verify the solve against the board.
    getClearOrder() {
        return this._clearOrder.slice();
    }

    // Count of pieces that have left the board (CLEARED or exit-logic fired).
    _clearedCount() {
        return this.board.paths.filter(p => p.state === 'CLEARED' || p._logicFired).length;
    }

    onCollision(path) {
        this.audio.playCollision();
        this._triggerCameraShake();
        this.deductLife();
    }

    // ── Score and lives ───────────────────────────────────────────────────────

    addScore(amount) {
        if (this.dailyMode) this.dailyScore += amount;
        else                this.score      += amount;
        this.persistence.save(this._snapshot(), this.dailyMode);
    }

    deductLife() {
        this.lives--;
        this.persistence.save(this._snapshot(), this.dailyMode);
        this._updateUI();
        this.checkFail();
    }

    // ── Win / Fail ────────────────────────────────────────────────────────────

    checkWin() {
        if (this.isWinState) return;
        // A path is "done" when its state is CLEARED or when its exit logic has
        // already fired (_logicFired). The two-stage exit keeps paths in MOVING
        // state while they fly off screen, so checking state alone would miss the
        // win condition until the last path physically leaves the canvas.
        const allCleared = this.board.paths.every(p => p.state === 'CLEARED' || p._logicFired);
        if (!allCleared) return;

        this.isWinState = true;
        this.audio.playWin();
        this.animation.spawnConfetti(this.renderer.camera);
        this.addScore(100); // win bonus
        this._updateUI();

        // Race mode: report the finish and skip the single-player overlays /
        // persistence. RaceClient drives the standings UI from here.
        if (this.raceMode) {
            if (this.onRaceWin) this.onRaceWin();
            return;
        }

        if (this.dailyMode) {
            this.persistence.clear(true);
            if (this.daily) {
                this.daily.end(this.dailyScore);
            } else {
                // Daily puzzle result fallback
                setTimeout(() => this._showOverlay('daily-result-overlay'), 700);
            }
        } else {
            this.persistence.clear(false);
            setTimeout(() => this._showWinOverlay(), 600);
        }
    }

    checkFail() {
        if (this.lives > 0) return;
        // Race mode: out of lives → reset the board and keep racing from the
        // beginning (no elimination). retryLevel() restores pieces + lives and
        // clears isFailState, so gameplay simply continues.
        if (this.raceMode) {
            this.retryLevel();
            if (this.onRaceRetry) this.onRaceRetry();
            return;
        }
        this.isFailState = true;
        setTimeout(() => this._showOverlay('fail-overlay'), 500);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _updateUI() {
        const totalPaths = this.board?.paths?.length || 0;
        this.renderer.updateDomUI({
            level:          this.level,
            score:          this.score,
            dailyScore:     this.dailyScore,
            lives:          this.lives,
            difficulty:     this.board?.difficulty || 'NORMAL',
            dailyMode:      this.dailyMode,
            pathsRemaining: this.board ? totalPaths - this._clearedCount() : totalPaths,
        });
    }

    _triggerCameraShake() {
        const el = document.getElementById('board-container');
        if (!el) return;
        el.classList.add('shake');
        setTimeout(() => el.classList.remove('shake'), 400);
    }

    _showOverlay(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('hidden', 'opacity-0', 'pointer-events-none', 'scale-105');
    }

    _hideOverlay(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('opacity-0', 'pointer-events-none', 'scale-105');
    }

    _showWinOverlay() {
        const quotes = [
            'All long vector corridors have been cleared!',
            'Unrivaled spatial analysis!',
            'The lanes slide free flawlessly.',
            'An elegant untangle solution!',
            'The white board is empty!',
        ];
        const qEl = document.getElementById('win-quote');
        if (qEl) qEl.innerText = `"${quotes[Math.floor(Math.random() * quotes.length)]}"`;
        this._showOverlay('win-overlay');
    }

    // Snapshot for Persistence.save — only serialisable data, no DOM refs.
    _snapshot() {
        return {
            level:              this.level,
            score:              this.score,
            lives:              this.lives,
            difficulty:         this.board?.difficulty || 'NORMAL',
            recentDifficulties: this.recentDifficulties,
            gridRows:           this.board?.grid?.rows,
            gridCols:           this.board?.grid?.cols,
            paths:              this.board?.paths?.map(p => p.toLegacy?.() || p) || [],
            hEdge:              this.board?.grid?.hEdge,
            vEdge:              this.board?.grid?.vEdge,
            dailyMode:          this.dailyMode,
            dailyScore:         this.dailyScore,
            date:               this.dailyMode ? (new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate()) : null,
        };
    }
}
