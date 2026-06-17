// =============================================================================
// ui-sound.js — one consistent click sound for every button, app-wide.
//
// Self-contained: synthesizes a short blip with the Web Audio API (no asset),
// and plays it on pointerdown for any <button> / [role=button] / a.btn.
// pointerdown (not click) so the sound starts before a navigating button
// unloads the page. The AudioContext is created/resumed on the first gesture,
// satisfying browser autoplay rules.
// =============================================================================
(function () {
    let ctx = null;

    function ensureCtx() {
        try {
            if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
        } catch (e) { return null; }
        return ctx;
    }

    function playClick() {
        const ac = ensureCtx();
        if (!ac) return;
        // Crisp UI "tap" — a short sine in a higher register than the in-game
        // arrow sound (playTap = 600 Hz triangle), so the button touch is
        // clearly distinct from the arrow-click sound.
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(920, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.05);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.14, t + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.09);
    }

    // Delegated + capture phase so it fires for every button, even if a
    // handler stops propagation. Skips disabled controls.
    document.addEventListener('pointerdown', function (e) {
        const el = e.target.closest && e.target.closest('button, [role="button"], a.btn');
        if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') playClick();
    }, true);
})();
