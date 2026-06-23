// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
import { COLORS } from './constants';
// Top/status bar + win/lose overlay DOM. Depends on constants.js (COLORS).
export const HEART = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#FF4B55" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

export class Hud {
    constructor() {
        this.$ = id => document.getElementById(id);
    }

    render(G) {
        this.$("level").textContent = "Level " + G.level;
        // Hearts are rendered by React (<Hearts>) in the app; this block only runs if a #hearts
        // element exists (i.e. the legacy DOM build). React reads G.hearts directly.
        const h = this.$("hearts");
        if (h) {
            h.innerHTML = "";
            for (let i = 0; i < 3; i++) {
                const s = document.createElement("span");
                s.innerHTML = HEART;
                if (i >= G.hearts) s.firstChild.classList.add("gone");
                h.appendChild(s);
            }
        }
        // Real, verified difficulty tier (falls back to arrow-count label if unset).
        this.$("diff").textContent = G.tierName || (G.total >= 140 ? "HARD" : G.total >= 90 ? "MEDIUM" : "EASY");
    }

    updateCount(G) {
        this.$("count").textContent = G.arrows.length;
    }

    showWin(G, onNext) {
        // Colourful celebration: board screenshot on top, congrats + points below, spiral background.
        const shot = this.$("winShot");
        if (G.boardImage) { shot.src = G.boardImage; shot.style.display = ""; }
        else { shot.style.display = "none"; }
        this.$("cardPoints").style.display = "";
        this.$("pointsVal").textContent = (G.points || 0).toLocaleString();
        this.$("cardTitle").textContent = "Congratulations!";
        this.$("cardTitle").style.color = "";    // celebrate CSS makes it white
        this.$("cardSub").textContent = "Level " + G.level + " complete — every arrow escaped!";
        this.$("cardBtn").textContent = "Next level";
        this.$("cardBtn").onclick = onNext;
        this.$("overlay").classList.add("show", "celebrate");
        this.#startConfetti();
        if (window.bgAudio) window.bgAudio.playCelebration();   // cheer only on the win screen
    }

    // Continuous confetti + cherry rain from the top while the win screen is shown.
    #startConfetti() {
        const box = this.$("confetti");
        if (!box) return;
        this.#stopConfetti();
        const colors = ["#FF4B55", "#FFB02E", "#16B26B", "#3D8BFF", "#9B5DE5", "#F15BB5", "#E11D48"];
        const spawn = () => {
            for (let i = 0; i < 4; i++) {
                const el = document.createElement("div");
                el.className = "confetti-piece";
                const size = 7 + Math.random() * 8;
                el.style.left = (Math.random() * 100) + "%";
                el.style.setProperty("--dur", (1.1 + Math.random() * 1.1) + "s");   // fast fall
                el.style.setProperty("--drift", ((Math.random() * 2 - 1) * 70) + "px");
                el.style.setProperty("--spin", ((Math.random() * 2 - 1) * 900) + "deg");
                el.style.width = size + "px";
                el.style.height = (size * 0.6) + "px";
                el.style.background = colors[(Math.random() * colors.length) | 0];
                el.style.borderRadius = "2px";
                el.addEventListener("animationend", () => el.remove());
                box.appendChild(el);
            }
        };
        spawn();
        this._confetti = setInterval(spawn, 130);
    }

    #stopConfetti() {
        clearInterval(this._confetti);
        this._confetti = null;
        const box = this.$("confetti");
        if (box) box.innerHTML = "";
    }

    // Confetti cannons firing inward from the LEFT and RIGHT edges — used during the brief on-board
    // halt right after the level is solved, before the congrats screen appears. Two staggered volleys.
    sideBurst() {
        const fx = this.$("fx");
        if (!fx) return;
        const colors = ["#FF4B55", "#FFB02E", "#16B26B", "#3D8BFF", "#9B5DE5", "#F15BB5", "#E11D48"];
        const W = window.innerWidth, H = window.innerHeight;
        const volley = () => {
            for (let side = 0; side < 2; side++) {
                const fromLeft = side === 0;
                for (let i = 0; i < 22; i++) {
                    const el = document.createElement("div");
                    el.className = "fx-piece";
                    const size = 7 + Math.random() * 7;
                    el.style.width = size + "px";
                    el.style.height = (size * 0.6) + "px";
                    el.style.background = colors[(Math.random() * colors.length) | 0];
                    el.style.borderRadius = "2px";
                    el.style.top = (H * (0.42 + Math.random() * 0.22)) + "px";
                    el.style[fromLeft ? "left" : "right"] = "-14px";
                    const tx = (fromLeft ? 1 : -1) * (W * (0.35 + Math.random() * 0.5));   // shoot across
                    const ty = (Math.random() * 2 - 1) * H * 0.45;                         // up/down spread
                    el.style.setProperty("--tx", tx + "px");
                    el.style.setProperty("--ty", ty + "px");
                    el.style.setProperty("--spin", ((Math.random() * 2 - 1) * 900) + "deg");
                    el.style.setProperty("--dur", (0.9 + Math.random() * 0.6) + "s");
                    el.addEventListener("animationend", () => el.remove());
                    fx.appendChild(el);
                }
            }
        };
        volley();
        setTimeout(volley, 350);   // second volley sustains it through the halt
    }

    showLose(onRetry) {
        this.$("winShot").style.display = "none";       // no celebration imagery on a loss
        this.$("cardPoints").style.display = "none";
        this.$("cardTitle").textContent = "Out of lives";
        this.$("cardTitle").style.color = COLORS.RED;
        this.$("cardSub").textContent = "Too many blocked taps — read the lanes before you tap.";
        this.$("cardBtn").textContent = "Try again";
        this.$("cardBtn").onclick = onRetry;
        this.$("overlay").classList.add("show");
        this.$("overlay").classList.remove("celebrate");
    }

    hide() {
        this.$("overlay").classList.remove("show", "celebrate");
        this.#stopConfetti();
        if (window.bgAudio) window.bgAudio.stop();   // silence the cheer when leaving the win screen
    }
}
