// @ts-nocheck — race-mode controller. Reuses the shared engine (Renderer / Camera / InputHandler /
// GameState) to play a SERVER-PROVIDED board (multiplayer race). Same tap/clear rules as solo, but
// no generation, persistence, hints, or win-celebration — instead it reports progress and the final
// clear order back via callbacks so the socket layer can drive the race.
import { Renderer } from './Renderer';
import { Camera } from './Camera';
import { InputHandler } from './InputHandler';
import { GameState } from './GameState';
import { lane } from './utils';

export class RaceController {
    // board = { level, tier, COLS, ROWS, mask, arrows:[{id,body,dir}] } from the server.
    constructor(canvas, board, hooks = {}) {
        this.hooks = hooks;     // { onProgress(cleared,total), onWin(order), onLifeLost(hearts), onLose() }
        this.board = board;     // kept so we can rebuild the SAME board after a life-out wipe
        this.camera = new Camera();
        this.renderer = new Renderer(canvas, this.camera);
        this.input = new InputHandler(this.renderer, this);
        this.wiping = false;    // true during the brief pause after losing all lives, before the board resets
        this.#buildState();
    }

    // (Re)create a fresh GameState from the original server board — full pieces, full lives, no progress.
    #buildState() {
        const board = this.board;
        const mask = board.mask ? Uint8Array.from(board.mask) : null;
        this.G = new GameState(board.level || 1, board.COLS, board.ROWS, board.arrows, mask);
        this.G.tierName = board.tier;
        this.total = this.G.total;
        this.order = [];        // arrow ids in the order they were cleared (sent on finish)
        this.finished = false;
    }

    #reveal(dur) {
        this.renderer.setGame(this.G);
        this.G.revealing = true;
        this.G.revealT0 = performance.now();
        this.G.revealDur = dur;
        this.renderer.resetView();
        this.camera.startEntrance();
    }

    start() {
        this.input.attach();
        this._onResize = () => { if (this.G) this.renderer.layout(); };
        window.addEventListener('resize', this._onResize);
        // Entrance reveal (same staggered wave as solo), then taps are accepted.
        this.#reveal(1100);
        this.renderer.startLoop();
    }

    // Player ran out of lives — restart the SAME board from the beginning so they can keep racing
    // (a time penalty, not a dead end). Resets progress + lives and tells the socket layer.
    restart() {
        this.wiping = false;
        this.#buildState();
        this.#reveal(700);
        this.hooks.onLifeLost && this.hooks.onLifeLost(this.G.hearts);   // hearts back to full
        this.hooks.onProgress && this.hooks.onProgress(0, this.total);   // marker back to the start line
    }

    tap(cell) {
        const G = this.G;
        if (!G || G.over || G.revealing || this.wiping) return;
        if (cell == null || !G.board.has(cell)) return;
        const id = G.board.get(cell);
        const a = G.arrows.find(x => x.id === id);
        if (!a || G.anims.some(an => an.arrow.id === id)) return;

        if (this.#clear(a)) {
            for (const c of a.body) G.board.delete(c);
            G.arrows = G.arrows.filter(x => x.id !== id);
            G.anims.push({ kind: 'out', arrow: a, t0: performance.now(), dur: 700 });
            this.order.push(id);
            this.hooks.onClear && this.hooks.onClear();   // free exit lane → tap sound (same as solo)
            const cleared = this.total - G.arrows.length;
            this.hooks.onProgress && this.hooks.onProgress(cleared, this.total);
            if (G.arrows.length === 0 && !this.finished) {
                this.finished = true;
                G.over = true;
                this.hooks.onWin && this.hooks.onWin(this.order.slice());
            }
        } else {
            if (!a.blocked) {
                a.blocked = true;
                G.hearts--;
                this.hooks.onLifeLost && this.hooks.onLifeLost(G.hearts);
                if (G.hearts <= 0) {
                    // Out of lives: show this last bump, flash a message, then rebuild the same board.
                    this.wiping = true;
                    this.hooks.onLose && this.hooks.onLose();
                    this._wipeTimer = setTimeout(() => this.restart(), 750);
                }
            }
            const now = performance.now();
            const reach = Math.min(this.#gap(a), 6) + 0.5;
            G.anims.push({ kind: 'bump', arrow: a, t0: now, dur: 460, reach });
            const blocker = this.#blocker(a);
            if (blocker) { blocker.flashT0 = now + 150; blocker.flashDur = 230; }
            if (navigator.vibrate) setTimeout(() => navigator.vibrate(35), 190);
        }
    }

    #clear(a) {
        const G = this.G;
        const head = a.body[a.body.length - 1];
        const own = new Set(a.body);
        return lane(head, a.dir, G.COLS, G.ROWS).every(x => !G.board.has(x) || own.has(x));
    }

    #gap(a) {
        const G = this.G;
        const head = a.body[a.body.length - 1];
        const own = new Set(a.body);
        let gap = 0;
        for (const x of lane(head, a.dir, G.COLS, G.ROWS)) {
            if (!G.board.has(x) || own.has(x)) gap++; else break;
        }
        return gap;
    }

    #blocker(a) {
        const G = this.G;
        const head = a.body[a.body.length - 1];
        const own = new Set(a.body);
        for (const x of lane(head, a.dir, G.COLS, G.ROWS)) {
            if (!G.board.has(x) || own.has(x)) continue;
            return G.arrows.find(p => p.id === G.board.get(x)) || null;
        }
        return null;
    }

    destroy() {
        if (this._wipeTimer) clearTimeout(this._wipeTimer);
        this.renderer.stop();
        this.input.detach();
        if (this._onResize) window.removeEventListener('resize', this._onResize);
    }
}
