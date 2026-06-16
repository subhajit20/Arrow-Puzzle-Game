// =============================================================================
// RaceClient.js — runs the game engine for a multiplayer race.
//
// Instantiates the presentation/interaction stack (Camera, Renderer,
// AnimationEngine, AudioEngine, InputHandler, GameController) WITHOUT the
// generator — the board comes from the server as board_json. Persistence is a
// no-op so a race never touches the single-player save.
//
// Usage:
//   const race = new RaceClient();
//   race.start(boardJson, { onProgress, onWin, onFail });
//   race.stop();   // on leave
//
// Requires (loaded before this file): Grid, Path, SolvabilityOracle, Camera,
//   Renderer, AnimationEngine, AudioEngine, GameController, BoardLoader.
// =============================================================================

class RaceClient {
    constructor(canvasId = 'gameCanvas', containerId = 'board-container') {
        this.canvas      = document.getElementById(canvasId);
        this.containerEl = document.getElementById(containerId);

        this.camera    = new Camera(this.canvas);
        this.renderer  = new Renderer(this.canvas, this.camera);
        this.animation = new AnimationEngine(this.renderer);
        this.audio     = new AudioEngine();

        // No-op persistence — races must not write the single-player save.
        const noopPersistence = { save() {}, load() { return null; }, clear() {} };

        this.gc = new GameController(null, this.renderer, this.audio, noopPersistence, this.animation);
        this.gc.raceMode = true;

        this.input  = new InputHandler(this.canvas, this.camera, this.gc);
        this.loader = new BoardLoader({});
        this.started = false;

        this._onResize = () => {
            if (this.started && this.gc.board) {
                this.renderer.resize(this.containerEl, this.gc.board.grid.rows, this.gc.board.grid.cols);
            }
        };
        window.addEventListener('resize', this._onResize);
    }

    // Build the board from board_json and start gameplay. The race container
    // MUST be visible before calling this (resize measures the container).
    start(boardJson, { onProgress, onWin, onRetry } = {}) {
        const board = this.loader.fromServer(boardJson);
        if (!board) { console.error('[RaceClient] invalid board_json'); return false; }

        this.gc.onProgress  = onProgress || null;
        this.gc.onRaceWin   = onWin || null;
        this.gc.onRaceRetry = onRetry || null;

        // Same boot sequence main.js uses for a level.
        if (this.camera._animReq) { cancelAnimationFrame(this.camera._animReq); this.camera._animReq = null; }
        this.input.detach();
        this.animation.stop();
        this.renderer.resize(this.containerEl, board.grid.rows, board.grid.cols);
        this.camera.reset();
        this.animation.start(board, this.gc);
        this.input.attach(this.containerEl);
        this.gc.startLevel(0, board, this.containerEl);

        this.started = true;
        return true;
    }

    // Total pieces on the current board (for progress display).
    total() { return this.gc.board ? this.gc.board.paths.length : 0; }

    // The order in which the player cleared paths — sent on finish so the
    // server can verify the solve before recording a placement.
    clearOrder() { return this.gc.getClearOrder(); }

    stop() {
        this.input.detach();
        this.animation.stop();
        if (this.camera._animReq) { cancelAnimationFrame(this.camera._animReq); this.camera._animReq = null; }
        this.started = false;
    }
}
