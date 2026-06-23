// @ts-nocheck — faithful port of the original JS engine; types added incrementally.
// (no shared-symbol imports needed)
// Celebration sound — plays ONLY on the congratulations (win) screen, not during gameplay or other
// screens. It loops while that screen is shown and stops when the player moves on. A speaker button
// toggles mute, remembered in localStorage. (showWin is fired from inside a tap, so play() is allowed
// under the autoplay policy.)
export const SPEAKER_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="#3D8BFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8 8 0 0 1 0 12"/></svg>';
export const SPEAKER_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="#8B93A6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>';

export class BgAudio {
    constructor() {
        this.el = document.getElementById("bgm");
        this.tapEl = document.getElementById("tapSfx");
        this.muted = localStorage.getItem("arrowEscapeMuted") === "1";
        if (this.el) { this.el.loop = true; this.el.volume = 0.6; }
        this._sfx = [];
        this.#wireButton();
    }

    // Short tap sound — played ONLY when a piece is successfully cleared (its exit lane is free).
    // Cloned per play so rapid clears overlap cleanly instead of cutting each other off.
    playTap() {
        if (this.muted || !this.tapEl) return;
        const s = this.tapEl.cloneNode(true);
        s.volume = 0.7;
        this._sfx.push(s);
        s.addEventListener("ended", () => {
            const i = this._sfx.indexOf(s);
            if (i >= 0) this._sfx.splice(i, 1);
        });
        s.play().catch(() => { /* ignore */ });
    }

    // Start the celebration cheer from the top (win screen). Respects mute.
    playCelebration() {
        if (!this.el || this.muted) return;
        try { this.el.currentTime = 0; } catch (e) { /* ignore */ }
        this.el.play().catch(() => { /* ignore */ });
    }

    // Stop the cheer (leaving the win screen).
    stop() {
        if (!this.el) return;
        this.el.pause();
        try { this.el.currentTime = 0; } catch (e) { /* ignore */ }
    }

    toggle() {
        this.muted = !this.muted;
        localStorage.setItem("arrowEscapeMuted", this.muted ? "1" : "0");
        if (this.muted) this.stop();
        this.#updateButton();
    }

    #wireButton() {
        const b = document.getElementById("soundBtn");
        if (!b) return;
        b.onclick = () => this.toggle();
        this.#updateButton();
    }

    #updateButton() {
        const b = document.getElementById("soundBtn");
        if (b) b.innerHTML = this.muted ? SPEAKER_OFF : SPEAKER_ON;
    }
}
