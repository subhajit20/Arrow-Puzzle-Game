const AudioEngine = {
    ctx: null,
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    playTone(freq, type, duration, vol) {
        this.init();
        if (!this.ctx) return;
        try {
            let osc = this.ctx.createOscillator();
            let gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) { }
    },
    tap() { this.playTone(600.00, 'triangle', 0.1, 0.1); },
    clear() {
        this.playTone(523.25, 'sine', 0.12, 0.08);
        setTimeout(() => this.playTone(659.25, 'sine', 0.12, 0.08), 60);
        setTimeout(() => this.playTone(783.99, 'sine', 0.2, 0.1), 120);
    },
    crash() {
        this.playTone(180, 'sawtooth', 0.2, 0.15);
        this.playTone(90, 'triangle', 0.25, 0.2);
    },
    win() {
        let now = 0;
        [523.25, 587.33, 659.25, 698.46, 783.99, 880.00, 987.77, 1046.50].forEach((f, i) => {
            setTimeout(() => this.playTone(f, 'sine', 0.15, 0.08), now);
            now += 50;
        });
    }
};
