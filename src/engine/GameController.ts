// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
import { BOARD_SHAPE, HINTS, TEST_LEVEL, TEST_MODE, TEST_SIZE, TEST_TIER, TIERS, sizeForLevel, tierForLevel } from './constants';
import { lane, pick } from './utils';
import { BoardGenerator } from './BoardGenerator';
import { Camera } from './Camera';
import { GameState } from './GameState';
import { GridShape } from './GridShape';
import { Hud } from './Hud';
import { InputHandler } from './InputHandler';
import { Persistence } from './Persistence';
import { Renderer } from './Renderer';
// Orchestrates a game: generation, state, rendering, input, HUD, and the core tap logic.
// Depends on constants.js (BOARD), utils.js (lane, pick), and the BoardGenerator / GameState /
// Renderer / InputHandler / Hud classes.
export class GameController {
    constructor() {
        this.generator = new BoardGenerator();
        this.camera = new Camera();
        this.renderer = new Renderer(document.getElementById("board"), this.camera);
        this.hud = new Hud();
        this.input = new InputHandler(this.renderer, this);
        this.persistence = new Persistence();
        this.G = null;
    }

    start() {
        this.input.attach();
        this.#wireButtons();
        // Store the bound listeners so destroy() can remove exactly these.
        this._onResize = () => { if (this.G) this.renderer.layout(); };
        // Safety net: snapshot the board when the app is backgrounded/closed, in case a per-tap save
        // was missed (e.g. closed mid-animation).
        this._flush = () => { if (this.G && !this.G.over) this.#persistBoard(); };
        this._onVisibility = () => { if (document.visibilityState === "hidden") this._flush(); };
        window.addEventListener("resize", this._onResize);
        window.addEventListener("pagehide", this._flush);
        document.addEventListener("visibilitychange", this._onVisibility);

        // Resume where the player left off (skipped while testing so boards stay fresh).
        if (!TEST_MODE) {
            const saved = this.persistence.load();
            if (saved && saved.board) { this.#resume(saved.board); }
            else { this.newGame(saved ? saved.level : 1); }
        } else {
            this.newGame(TEST_LEVEL);
        }
        this.renderer.startLoop();
    }

    // Tear everything down when leaving the game screen: stop the render loop, detach input, remove
    // window/document listeners, and cancel pending timers. (The current board is already persisted,
    // so re-entering resumes it.) No gameplay state is mutated.
    destroy() {
        this._flush && this._flush();   // final save before leaving
        this.renderer.stop();
        this.input.detach();
        if (this._onResize) window.removeEventListener("resize", this._onResize);
        if (this._flush) window.removeEventListener("pagehide", this._flush);
        if (this._onVisibility) document.removeEventListener("visibilitychange", this._onVisibility);
        clearTimeout(this._winTO);
        clearTimeout(this._hintTO);
    }

    // Rebuild and show a persisted in-progress board (no entrance reveal — it's already underway).
    #resume(boardData) {
        this.G = GameState.restore(boardData);
        this._origin = boardData;   // best-effort "original" for a retry from this state
        this.renderer.setGame(this.G);
        this.G.boardImage = this.renderer.renderThumbnail(this.G.arrows, this.G.COLS, this.G.ROWS);
        this.renderer.resetView();
        this.camera.startEntrance();   // gentle zoom-in; pieces are tappable immediately (no reveal)
        this.hud.render(this.G);
        this.hud.hide();
        this.hud.updateCount(this.G);
        this.#updateHintBtn();
        console.log(`Resumed level ${this.G.level} [${this.G.tierName}] — ${this.G.arrows.length} pieces left, ${this.G.hearts} lives`);
    }

    // Persist the live board (resume target). No-op while testing.
    #persistBoard() {
        if (!TEST_MODE && this.G) this.persistence.saveBoard(this.G);
    }

    newGame(level) {
        // In test mode every board is pinned to TEST_LEVEL + TEST_TIER (+ optional TEST_SIZE),
        // ignoring the normal progression.
        let tier, size;
        if (TEST_MODE) {
            level = TEST_LEVEL;
            tier = TIERS.find(t => t.name === TEST_TIER) || tierForLevel(level);
            size = TEST_SIZE ? { COLS: TEST_SIZE[0], ROWS: TEST_SIZE[1] } : sizeForLevel(level);
        } else {
            tier = tierForLevel(level);
            size = sizeForLevel(level);   // grid size grows with the level
        }
        let { COLS, ROWS } = size;
        // Shape-mask board: forced via BOARD_SHAPE (testing), else every 10th level (milestone).
        // The shape and its suitable grid size come from the GridShape library.
        const milestone = level % 10 === 0;
        const shapeName = BOARD_SHAPE !== "rect" ? BOARD_SHAPE : (milestone ? GridShape.forLevel(level) : null);
        let mask = null;
        if (shapeName) {
            // Use the shape's preferred grid size from the library (unless a test size is forced).
            if (!(TEST_MODE && TEST_SIZE)) {
                const ss = milestone ? GridShape.milestoneSize(level) : GridShape.sizeFor(shapeName, 0);
                COLS = ss.COLS; ROWS = ss.ROWS;
            }
            mask = GridShape.maskFor(shapeName, COLS, ROWS);
        }
        const motifs = shapeName ? GridShape.motifsFor(shapeName) : null;   // shape-specific motifs
        const result = this.generator.generateForTier(COLS, ROWS, mask, tier, motifs);
        // Log which motifs THIS board actually used (and how many of each).
        const mc = result.motifCount || {};
        const motifList = Object.keys(mc).sort((a, b) => mc[b] - mc[a]);
        console.log(`Level ${level} [${tier.name}] ${COLS}x${ROWS} — motifs: `
            + (motifList.length ? motifList.map(m => `${m}(${mc[m]})`).join(", ") : "none"));
        this.G = new GameState(level, COLS, ROWS, result.arrows, mask);
        this.G.tierName = tier.name;
        // Stash the fresh, full board so a lost level can replay THIS exact puzzle (reset to full
        // pieces + lives) instead of generating a new random one.
        this._origin = this.persistence.snapshot(this.G);
        this.renderer.setGame(this.G);
        this.G.boardImage = this.renderer.renderThumbnail(this.G.arrows, COLS, ROWS);   // win-screen snapshot of the full puzzle
        // Entrance reveal: paths draw in from tail->head as a staggered wave (taps blocked until done).
        this.G.revealing = true;
        this.G.revealT0 = performance.now();
        this.G.revealDur = 1100;
        this.renderer.setGame(this.G);
        this.renderer.resetView();      // fit the fresh board to the screen
        this.camera.startEntrance();    // then dive in: zoom from overview to fit while paths reveal
        this.hud.render(this.G);
        this.hud.hide();
        this.hud.updateCount(this.G);
        this.#updateHintBtn();          // reset the per-board hint counter on the bottom bar
        this.#persistBoard();           // save the fresh board as the resume point
    }

    // Highlight one currently-clearable path (pulses green). Limited to G.hintsLeft per board.
    hint() {
        const G = this.G;
        if (!G || G.over || G.revealing || G.hintsLeft <= 0) return;
        // Candidates: pieces whose head ray is clear right now and aren't mid-animation.
        const animating = new Set(G.anims.map(an => an.arrow.id));
        const clearable = G.arrows.filter(a => !animating.has(a.id) && this.#corridorClear(a));
        if (!clearable.length) return;
        const a = pick(clearable);
        G.hintId = a.id;
        G.hintsLeft--;
        this.#updateHintBtn();
        this.#persistBoard();           // hints-left is part of the saved state
        // Auto-stop the pulse after a few seconds (also cleared on the next tap).
        clearTimeout(this._hintTO);
        this._hintTO = setTimeout(() => { if (G.hintId === a.id) G.hintId = null; }, 3000);
    }

    #updateHintBtn() {
        const btn = document.getElementById("hintBtn");
        if (!btn) return;
        const left = this.G ? this.G.hintsLeft : HINTS;
        document.getElementById("hintN").textContent = left;
        btn.disabled = left <= 0;
    }

    // A tap on a board cell (or null if outside / no arrow there).
    tap(cell) {
        const G = this.G;
        if (!G || G.over || G.revealing) return;   // ignore taps until the entrance reveal finishes
        if (cell == null || !G.board.has(cell)) return;
        const id = G.board.get(cell);
        const a = G.arrows.find(x => x.id === id);
        if (!a || G.anims.some(an => an.arrow.id === id)) return;
        G.hintId = null;
        if (this.#corridorClear(a)) {
            if (window.bgAudio) window.bgAudio.playTap();   // free exit lane → play the tap sound
            for (const c of a.body) G.board.delete(c);
            G.arrows = G.arrows.filter(x => x.id !== id);
            G.anims.push({ kind: "out", arrow: a, t0: performance.now(), dur: 700 });
            this.hud.updateCount(G);
            if (G.arrows.length === 0) this.#win();
            else this.#persistBoard();      // save progress after a successful clear
        } else {
            if (!a.blocked) { a.blocked = true; this.#loseLife(); }  // first wrong tap on this piece is the trap: -1 life
            // Lunge: snake-slide the body forward (red) right into the blocking path, hold at the
            // collision, then return. reach = clear gap + 0.5 so the head pushes into the blocker
            // (they visibly touch), capped so it stays snappy.
            const now = performance.now();
            const reach = Math.min(this.#corridorGap(a), 6) + 0.5;
            G.anims.push({ kind: "bump", arrow: a, t0: now, dur: 460, reach });
            // The path it collides with flashes red at impact, then returns to black.
            const blocker = this.#blockerArrow(a);
            if (blocker) { blocker.flashT0 = now + 150; blocker.flashDur = 230; }
            // Haptic buzz at the moment of impact.
            if (navigator.vibrate) setTimeout(() => navigator.vibrate(35), 190);
            if (!G.over) this.#persistBoard();   // save the new blocked-piece + lives state
        }
    }

    // True if the arrow's head ray to the edge is clear of other pieces (its own cells allowed).
    #corridorClear(a) {
        const G = this.G;
        const head = a.body[a.body.length - 1];
        const own = new Set(a.body);
        return lane(head, a.dir, G.COLS, G.ROWS).every(x => !G.board.has(x) || own.has(x));
    }

    // How many cells the head can advance before hitting another path (clear/own cells ahead).
    #corridorGap(a) {
        const G = this.G;
        const head = a.body[a.body.length - 1];
        const own = new Set(a.body);
        let gap = 0;
        for (const x of lane(head, a.dir, G.COLS, G.ROWS)) {
            if (!G.board.has(x) || own.has(x)) gap++;
            else break;   // hit another path
        }
        return gap;
    }

    // The path that blocks this arrow's exit (owner of the first occupied cell in its lane).
    #blockerArrow(a) {
        const G = this.G;
        const head = a.body[a.body.length - 1];
        const own = new Set(a.body);
        for (const x of lane(head, a.dir, G.COLS, G.ROWS)) {
            if (!G.board.has(x) || own.has(x)) continue;
            return G.arrows.find(p => p.id === G.board.get(x)) || null;
        }
        return null;
    }

    #loseLife() {
        const G = this.G;
        G.hearts--;
        this.hud.render(G);
        if (G.hearts <= 0) this.#lose();
    }

    #lose() {
        this.G.over = true;
        const level = this.G.level;
        const origin = this._origin;
        // Keep the SAME board: persist its fresh original so reopening replays this exact puzzle
        // (full pieces + lives), and "Try again" restores it rather than generating a new one.
        if (!TEST_MODE && origin) this.persistence.saveSnapshot(level, origin);
        this.hud.showLose(() => { if (origin) this.#resume(origin); else this.newGame(level); });
    }

    #win() {
        const G = this.G;
        G.over = true;
        G.points = this.#scoreBoard(G);
        // Advance progression now (even if they close on the win screen, they reopen at the next level).
        if (!TEST_MODE) this.persistence.saveProgress(G.level + 1);
        // Hold on the board for a beat (the last piece flies out) while confetti fires from the left
        // and right edges, THEN reveal the congratulations screen.
        this.hud.sideBurst();
        clearTimeout(this._winTO);
        this._winTO = setTimeout(() => this.hud.showWin(G, () => this.newGame(G.level + 1)), 1100);
    }

    // Points for a finished board: per-piece base × tier multiplier, plus bonuses for lives and
    // unused hints remaining (rewards clean, hint-free solves of harder/bigger boards).
    #scoreBoard(G) {
        const mult = { EASY: 1, NORMAL: 1.5, HARD: 2, EXPERT: 2.5, TITAN: 3 }[G.tierName] || 1;
        return Math.round(G.total * 10 * mult) + G.hearts * 150 + G.hintsLeft * 75;
    }

    #wireButtons() {
        document.getElementById("backBtn").onclick = () => this.newGame(1);
        document.getElementById("hintBtn").onclick = () => this.hint();
    }
}
