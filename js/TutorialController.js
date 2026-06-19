// =============================================================================
// TutorialController.js — First-play coached tutorial (gated, interactive)
//
// Drives the two handcrafted onboarding levels (tutorial-boards.js):
//   Level 0 — teach the tap (3 independent arrows, no blocking).
//   Level 1 — teach blocking / solve order (2 free + 2 blocked arrows).
//
// Coaching is GATED: only the highlighted arrow responds to taps until the
// player makes the intended move, at which point the script advances. The
// final level-1 step opens the gate so the player finishes unaided.
//
// Integration points (all guarded by gc.tutorialMode):
//   InputHandler.onTap   → allowsTap(id)        — gate which arrow can fire
//   GameController.onCollision → notifyCollision — bounce demo, no life lost
//   GameController.onPathCleared → notifyCleared — advance the script
//   Renderer.drawFrame   → getRenderHint()       — pulsing ring + tap pointer
//
// A "tutorial seen" flag in Persistence means it only runs on first play.
// Replay is forced via game.html?tutorial=1 (set forced=true) and exits to
// the menu on completion so a returning player's real save is never touched.
// =============================================================================

class TutorialController {
    constructor(gameController, camera, containerEl, persistence) {
        this.gc          = gameController;
        this.camera      = camera;
        this.containerEl = containerEl;
        this.persistence = persistence;

        this.active    = false;
        this.forced    = false;          // true during ?tutorial=1 replay
        this.level     = null;
        this.steps     = [];
        this.stepIndex = 0;
        this._finished = false;

        // Set by main.js: (target) => void, where target is a level number or
        // the string 'menu'. Used by skip() and forced-replay completion.
        this.onExit = null;

        this._dom = null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    // Called on every level start. Decides whether to coach this level.
    beginLevel(level) {
        this._teardown();
        this._finished = false;

        const seen = this.persistence.tutorialSeen();
        const shouldCoach = (level === 0 || level === 1) && (this.forced || !seen);

        if (!shouldCoach) {
            this.active = false;
            this.level  = null;
            this.gc.tutorialMode = false;
            return;
        }

        this.active = true;
        this.level  = level;
        this.stepIndex = 0;
        this.steps  = (level === 0) ? this._level0Steps() : this._level1Steps();

        this.gc.tutorialMode = true;
        this.gc.tutorial     = this;

        this._buildDom();
        this._renderStep();

        // Hold the caption back until the entrance reveal animation settles so
        // it doesn't fight the path-reveal. Reveal of a 3–4 path board is short.
        if (this._dom) this._dom.root.style.opacity = '0';
        setTimeout(() => { if (this._dom) this._dom.root.style.opacity = '1'; }, 700);
    }

    // ── Step scripts ──────────────────────────────────────────────────────────

    _level0Steps() {
        return [
            { targetId: 10, advance: 'clear', text: 'Tap this arrow to send it flying.' },
            { targetId: 11, advance: 'clear', text: 'Now this one — each arrow slides the way it points.' },
            { targetId: 12, advance: 'clear', text: 'Last one. Empty the board to win!' },
        ];
    }

    _level1Steps() {
        return [
            // Deliberately point at the blocked arrow first so the player feels
            // the block. Its tap bounces (no life lost) → notifyCollision.
            { targetId: 22, advance: 'blockedDemo', text: 'Tap this arrow to send it up.' },
            // The blocker in its way.
            { targetId: 20, advance: 'clear',       text: "Blocked! Clear the arrow in its way first." },
            // Now the previously-blocked arrow is free.
            { targetId: 22, advance: 'clear',       text: "Now it's free — tap it.",
              flash: 'See? Clearing one opens the way for another.' },
            // Open the gate — let them finish the rest unaided.
            { openGate: true, advance: 'all',        text: 'Now clear the rest yourself!' },
        ];
    }

    _currentStep() {
        return this.steps[this.stepIndex] || null;
    }

    // ── Input gating (called from InputHandler) ───────────────────────────────

    allowsTap(pathId) {
        if (!this.active) return true;
        const step = this._currentStep();
        if (!step) return true;
        if (step.openGate) return true;
        return pathId === step.targetId;
    }

    // ── Game callbacks (called from GameController) ────────────────────────────

    notifyCleared(pathId) {
        if (!this.active) return;
        const step = this._currentStep();
        if (!step) return;

        // Final free-play step ends when the whole board is empty.
        if (step.openGate || step.advance === 'all') {
            if (this._allCleared()) this._finishTutorial();
            return;
        }

        if (step.advance === 'clear' && pathId === step.targetId) {
            if (step.flash) {
                this._setCaption(step.flash);
                setTimeout(() => this._next(), 1300);
            } else {
                this._next();
            }
        }
    }

    notifyCollision(pathId) {
        if (!this.active) return;
        const step = this._currentStep();
        if (step && step.advance === 'blockedDemo' && pathId === step.targetId) {
            this._next();
        }
    }

    // ── Render hint for the canvas (called from Renderer via AnimationEngine) ──

    // Returns { r, c, heading } of the node to point the tap-pointer at, or null.
    getRenderHint() {
        if (!this.active || this.gc.revealActive) return null;
        const step = this._currentStep();
        if (!step || step.targetId == null) return null;
        const p = this.gc.board?.paths?.find(x => x.id === step.targetId);
        if (!p || p.state !== 'IDLE') return null;
        const head = p.nodes[p.nodes.length - 1];
        return { r: head.r, c: head.c, heading: p.heading };
    }

    // ── Skip / finish ──────────────────────────────────────────────────────────

    skip() {
        if (this._finished) return;
        this._finished = true;
        this.active = false;
        this._teardown();
        if (!this.forced) this.persistence.setTutorialSeen();
        this.gc.tutorialMode = false;
        // Forced replay returns to the menu; first-play skip jumps to the first
        // generated level (handcrafted levels 0–1 are the tutorial).
        if (this.onExit) this.onExit(this.forced ? 'menu' : 2);
    }

    _finishTutorial() {
        if (this._finished) return;
        this._finished = true;
        this.active = false;
        this._teardown();

        if (this.level === 1) {
            // Whole tutorial complete.
            if (!this.forced) this.persistence.setTutorialSeen();
            this.gc.tutorialMode = false;
            if (this.forced && this.onExit) { this.onExit('menu'); return; }
            // Non-forced: the standard win overlay → "Next Puzzle" advances to
            // level 2 (first generated). tutorialMode is now false so it saves.
        }
        // Level 0 complete: keep tutorialMode true so the level-0 → level-1
        // transition writes no save; beginLevel(1) re-arms coaching.
    }

    _next() {
        this.stepIndex++;
        if (this.stepIndex >= this.steps.length) { this._finishTutorial(); return; }
        this._renderStep();
    }

    _allCleared() {
        const paths = this.gc.board?.paths || [];
        return paths.length > 0 && paths.every(p => p.state === 'CLEARED' || p._logicFired);
    }

    // ── DOM overlay (caption + skip) ────────────────────────────────────────────

    _buildDom() {
        if (this._dom) return;

        const root = document.createElement('div');
        root.id = 'tutorial-overlay';
        root.style.cssText =
            'position:absolute;inset:0;z-index:15;pointer-events:none;' +
            'transition:opacity .35s ease;';

        const cap = document.createElement('div');
        cap.id = 'tutorial-caption';
        cap.style.cssText =
            'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);' +
            'max-width:88%;padding:11px 18px;border-radius:16px;' +
            'background:rgba(255,255,255,.96);color:#112540;' +
            'font-weight:800;font-size:14px;line-height:1.3;text-align:center;' +
            'box-shadow:0 10px 28px -8px rgba(15,23,42,.28),0 2px 8px -4px rgba(15,23,42,.18);' +
            'border:1px solid rgba(217,119,6,.35);';

        const skip = document.createElement('button');
        skip.id = 'tutorial-skip';
        skip.textContent = 'Skip';
        skip.style.cssText =
            'position:absolute;top:12px;right:12px;pointer-events:auto;' +
            'padding:6px 14px;border-radius:999px;cursor:pointer;' +
            'background:rgba(255,255,255,.92);color:#64748b;' +
            'font-weight:800;font-size:12px;border:1px solid rgba(148,163,184,.4);' +
            'box-shadow:0 4px 12px -6px rgba(15,23,42,.25);';
        skip.addEventListener('click', () => this.skip());

        root.appendChild(cap);
        root.appendChild(skip);
        this.containerEl.appendChild(root);
        this._dom = { root, cap, skip };
    }

    _renderStep() {
        const step = this._currentStep();
        if (step) this._setCaption(step.text);
    }

    _setCaption(text) {
        if (this._dom) this._dom.cap.textContent = text;
    }

    _teardown() {
        if (this._dom) {
            this._dom.root.remove();
            this._dom = null;
        }
    }
}
