// =============================================================================
// AudioEngine.js — Procedural Web Audio API sound synthesis
//
// All sounds are synthesised on the fly — no audio files.
// The AudioContext is created on first user interaction (browser policy).
// =============================================================================

class AudioEngine {
    constructor() {
        this._ctx = null;
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    // Must be called from a user gesture (touch/click) before any sound plays.
    // Safe to call multiple times — creates the context only once.
    init() {
        if (!this._ctx) {
            this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // ── Base tone ─────────────────────────────────────────────────────────────

    // Plays a single oscillator tone with a linear gain envelope.
    // freq     — frequency in Hz
    // type     — OscillatorType: 'sine' | 'triangle' | 'sawtooth' | 'square'
    // gain     — peak volume (0.0 – 1.0)
    // duration — note length in seconds
    playTone(freq, type, gain, duration) {
        this.init();
        if (!this._ctx) return;
        try {
            const osc  = this._ctx.createOscillator();
            const gn   = this._ctx.createGain();
            const now  = this._ctx.currentTime;

            osc.type = type;
            osc.frequency.setValueAtTime(freq, now);

            gn.gain.setValueAtTime(gain, now);
            gn.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            osc.connect(gn);
            gn.connect(this._ctx.destination);
            osc.start(now);
            osc.stop(now + duration);
        } catch (_) { /* AudioContext may be suspended */ }
    }

    // ── Game sounds ───────────────────────────────────────────────────────────

    // Short blip on path tap / selection
    playTap() {
        this.playTone(600, 'triangle', 0.1, 0.10);
    }

    // Rising arpeggio when a path clears the board
    playPathCleared() {
        this.playTone(523.25, 'sine', 0.08, 0.12);
        setTimeout(() => this.playTone(659.25, 'sine', 0.08, 0.12), 60);
        setTimeout(() => this.playTone(783.99, 'sine', 0.10, 0.20), 120);
    }

    // Harsh descending burst on collision
    playCollision() {
        this.playTone(180, 'sawtooth', 0.15, 0.20);
        this.playTone(90,  'triangle', 0.20, 0.25);
    }

    // Full ascending scale on level win
    playWin() {
        const notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880.00, 987.77, 1046.50];
        notes.forEach((f, i) => {
            setTimeout(() => this.playTone(f, 'sine', 0.08, 0.15), i * 50);
        });
    }

    // Soft bell on hint reveal
    playHint() {
        this.playTone(880, 'sine', 0.08, 0.15);
    }

    // Triumphant fanfare for the final leaderboard / champion reveal.
    playFanfare() {
        this.init();
        // Rising arpeggio (C–E–G–C)…
        const arp = [523.25, 659.25, 783.99, 1046.50];
        arp.forEach((f, i) => setTimeout(() => this.playTone(f, 'triangle', 0.12, 0.18), i * 100));
        // …then a held major chord stab.
        setTimeout(() => {
            [523.25, 659.25, 783.99, 1046.50].forEach((f) => this.playTone(f, 'sine', 0.09, 0.7));
        }, 430);
    }
}
