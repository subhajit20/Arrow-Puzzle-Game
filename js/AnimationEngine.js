// =============================================================================
// AnimationEngine.js — RAF loop, path animation, reveal, confetti
//
// Owns the requestAnimationFrame loop and all time-based state:
//   - MOVING / CRASHING path animation progress
//   - Staggered path reveal on level load
//   - Confetti particles on win
//
// Does NOT read global State. Board data + callbacks are passed per tick.
//
// Dependencies: Renderer
// =============================================================================

class AnimationEngine {
    // Head speed — faster head creates more dramatic elastic stretch
    static MOVE_SPEED = 0.72;
    // Pixels per frame for crash retraction
    static CRASH_SPEED = 0.32;

    constructor(renderer) {
        this.renderer = renderer;
        this._rafId = null;
        this._running = false;

        // Reveal state (set by startRevealAnimation)
        this.reveal = {
            active: false,
            progress: 0,
            duration: 600,
            startTime: 0,
            onComplete: null,
        };

        // Confetti particles (owned here, passed to Renderer.drawConfetti)
        this.particles = [];

        // Accumulated animating path count per frame
        this.animatingCount = 0;
    }

    // ── Loop control ──────────────────────────────────────────────────────────

    start(board, gameController) {
        if (this._running) return;
        this._running = true;
        this._gameController = gameController;
        const self = this;

        const loop = now => {
            if (!self._running) return;
            // Always read gc.board so board switches (Continue Playing, daily)
            // are reflected immediately without restarting the loop.
            const currentBoard = self._gameController?.board || board;
            self._tick(currentBoard, self._gameController, now);
            self._rafId = requestAnimationFrame(loop);
        };
        this._rafId = requestAnimationFrame(loop);
    }

    stop() {
        this._running = false;
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    }

    // ── Tick ─────────────────────────────────────────────────────────────────

    _tick(board, gameController, now) {
        this.animatingCount = 0;

        // Update reveal state
        let revealState = null;
        if (this.reveal.active) {
            const elapsed = now - this.reveal.startTime;
            const progress = Math.min(1.0, elapsed / this.reveal.duration);
            this.reveal.progress = progress;
            revealState = { active: true, progress };

            if (progress >= 1.0) {
                this.reveal.active = false;
                if (this.reveal.onComplete) {
                    this.reveal.onComplete();
                    this.reveal.onComplete = null;
                }
                revealState = null;
            }
        }

        // Update all paths
        for (const p of (board.paths || [])) {
            this.updatePath(p, board.grid, gameController);
        }

        // Draw
        this.renderer.drawFrame(board, {
            selectedPathId: gameController ? gameController.selectedPathId : null,
            hintPathId: gameController ? gameController.hintPathId : null,
            revealState,
            particles: this.particles,
        });
    }

    // ── Path state machine ────────────────────────────────────────────────────

    updatePath(path, grid, gameController) {
        if (path.state === 'MOVING') {
            this.animatingCount++;
            path.animProgress += AnimationEngine.MOVE_SPEED;

            const head = path.nodes[path.nodes.length - 1];
            const { dr, dc } = Path.headingToDelta(path.heading);
            const steps = Math.round(path.animProgress);
            const leadR = head.r + dr * steps;
            const leadC = head.c + dc * steps;

            const maskW        = grid.cols + 1;
            const leadInBounds = grid.inBounds(leadR, leadC);
            // Active = no mask (full rectangle) OR lead node is inside the mask.
            // Masked-out nodes are inactive gaps — treat them as empty space.
            const leadActive   = !grid.mask || (leadInBounds && grid.mask[leadR * maskW + leadC]);

            // Collision detection — skip on inactive mask nodes so paths in one
            // island never falsely collide with paths in a disconnected island.
            if (leadInBounds && leadActive) {
                const ownerId = grid.owner(leadR, leadC);
                if (ownerId >= 0 && ownerId !== path.id) {
                    const allPaths = gameController?.board?.paths || [];
                    const ownerPath = allPaths.find(o => o.id === ownerId);
                    if (ownerPath &&
                        ownerPath.state !== 'CLEARED' &&
                        ownerPath.state !== 'MOVING') {
                        path.state = 'CRASHING';
                        path.crashFlashFrames = 8;
                        if (gameController) gameController.onCollision(path);
                    }
                }
            }

            // Reset exit flag on first tick of each new launch so retry works.
            if (path.animProgress <= AnimationEngine.MOVE_SPEED) path._logicFired = false;

            // Two-stage exit — applies to ALL boards including masked shapes:
            //   Stage 1 (maxLen OR exitedIsland) — path left the active area
            //     (grid boundary OR inactive masked zone e.g. donut outer edge).
            //     Fire game logic (score + win) immediately but keep path MOVING
            //     so the arrow continues flying off the visible screen.
            //   Stage 2 (offScreenLen) — path has travelled far enough to leave
            //     the visible screen → set CLEARED to stop drawing.
            const maxLen       = Math.max(grid.rows, grid.cols) * 1.5;
            const offScreenLen = maxLen + Math.max(grid.rows, grid.cols) * 2;
            const exitedIsland = steps >= 1 && leadInBounds && !!grid.mask && !grid.mask[leadR * maskW + leadC];

            if (!path._logicFired && (path.animProgress > maxLen || exitedIsland)) {
                path._logicFired = true;
                if (gameController) gameController.onPathCleared(path);
            } else if (path._logicFired && path.animProgress > offScreenLen) {
                path.state = 'CLEARED';
            }

        } else if (path.state === 'CRASHING') {
            this.animatingCount++;
            if ((path.crashFlashFrames || 0) > 0) {
                path.crashFlashFrames--;
            } else {
                path.animProgress -= AnimationEngine.CRASH_SPEED;
                if (path.animProgress <= 0) {
                    path.animProgress = 0;
                    path.state = 'IDLE';
                }
            }
        }
    }

    // ── Reveal animation ──────────────────────────────────────────────────────

    // Staggered path entrance — shows paths one after another.
    // onComplete is called when the reveal finishes (→ startEntranceAnimation).
    startRevealAnimation(paths, containerEl, camera, onComplete) {
        if (!containerEl || !camera.cellSize) {
            if (onComplete) onComplete();
            return;
        }

        const bcr          = containerEl.getBoundingClientRect();
        const isMobile     = bcr.width < 768 && bcr.width < bcr.height;
        const isLargeBoard = camera.gridRows >= 36 || camera.gridCols >= 22;

        // Fit board into view at overview zoom
        const header = document.getElementById('game-header');
        const ctrls = document.getElementById('game-controls');
        const topBarH = header ? header.getBoundingClientRect().height : 0;
        const botBarH = ctrls ? ctrls.getBoundingClientRect().height : 0;
        const PAD = 4;
        const visibleH = Math.min(bcr.height, window.innerHeight - topBarH);
        const usableW = bcr.width - PAD * 2;
        const usableH = Math.max(20, visibleH - botBarH - PAD * 2);

        const boardW = camera.gridCols * camera.cellSize;
        const boardH = camera.gridRows * camera.cellSize;
        const fitZoom = Math.min(
            (usableW * 0.88) / boardW,
            (usableH * 0.88) / boardH,
            1.0
        );
        camera.minZoom = Math.max(fitZoom * 0.40, 0.08);

        if (isLargeBoard) {
            // Large board: fit to overview zoom before reveal + entrance animation.
            camera.cssZoom = fitZoom; camera.matE = 0; camera.matF = 0;
            camera.clampPan(containerEl);
        }
        // Small board: keep camera at current reset position — no zoom change.

        const N = paths.length;
        const duration = Math.min(900, Math.max(300, N * 60));

        // Run path reveal — and entrance zoom only for large boards.
        this.reveal = {
            active: true,
            progress: 0,
            duration,
            startTime: performance.now(),
            onComplete: onComplete || null,
        };
        if (isLargeBoard) {
            camera.startEntranceAnimation(containerEl);
        }
    }

    // ── Confetti ──────────────────────────────────────────────────────────────

    spawnConfetti(camera) {
        const colors = ['#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#f87171'];
        const cx = camera.offsetX + (camera.gridCols * camera.cellSize) / 2;
        const cy = camera.offsetY + (camera.gridRows * camera.cellSize) / 2;
        const sCx = cx * camera.cssZoom + camera.matE;
        const sCy = cy * camera.cssZoom + camera.matF;

        for (let i = 0; i < 60; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 4;
            this.particles.push({
                x: sCx + (Math.random() - 0.5) * 80,
                y: sCy + (Math.random() - 0.5) * 80,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 2,
                alpha: 0.9 + Math.random() * 0.1,
                decay: 0.012 + Math.random() * 0.008,
                size: 2 + Math.random() * 3,
                color: colors[Math.floor(Math.random() * colors.length)],
            });
        }
    }

    clearParticles() {
        this.particles.length = 0;
    }
}
