// Shared handle so touchstart / mousedown can cancel an in-flight entrance anim.
window.cameraAnimReq = null;

// ---------------------------------------------------------------------------
// applyBoardTransform
// Applies cssZoom + matE/matF as a CSS matrix.
//
// Clamping rules:
//   • Zoom is clamped to [State.minZoom, 6.0].
//   • When the scaled canvas is NARROWER/SHORTER than the container it is
//     centred automatically (used during fit-view and zoom-out).
//   • When it is WIDER/TALLER the user can pan freely within the board bounds.
// ---------------------------------------------------------------------------
function applyBoardTransform() {
    // Clamp zoom
    if (State.cssZoom < State.minZoom) State.cssZoom = State.minZoom;
    if (State.cssZoom > 6.0)           State.cssZoom = 6.0;

    const container = document.getElementById('board-container');
    if (container && State.canvasW && State.canvasH && State.cellSize) {
        const bcr     = container.getBoundingClientRect();
        const isMobile = bcr.width < 768 && bcr.width < bcr.height;

        const boardW  = State.rootCols * State.cellSize;
        const boardH  = State.rootRows * State.cellSize;

        const scaledBoardW = boardW * State.cssZoom;
        const scaledBoardH = boardH * State.cssZoom;

        // Horizontal ─────────────────────────────────────────────────────────
        const ox = State.offsetX || 0;
        if (scaledBoardW <= bcr.width) {
            // Board narrower than container: center it horizontally
            const scaledW = State.canvasW * State.cssZoom;
            State.matE = (bcr.width - scaledW) / 2;
        } else {
            // Board wider than container: allow panning across full board width
            const maxE  = -ox * State.cssZoom;
            const minE  = bcr.width - (ox + boardW) * State.cssZoom;
            State.matE  = Math.min(maxE, Math.max(minE, State.matE));
        }

        // Vertical ───────────────────────────────────────────────────────────
        const oy = State.offsetY || 0;
        const header  = document.getElementById('game-header');
        const topBarH = header ? header.getBoundingClientRect().height : 0;
        const visibleH = isMobile ? Math.min(bcr.height, window.innerHeight - topBarH) : bcr.height;

        if (scaledBoardH <= visibleH) {
            // Board shorter than visible gameplay height: center it vertically
            State.matF = visibleH / 2 - (oy + boardH / 2) * State.cssZoom;
        } else {
            // Board taller than visible gameplay height: allow vertical panning
            const maxF = -oy * State.cssZoom;
            const minF = visibleH - (oy + boardH) * State.cssZoom;
            State.matF = Math.min(maxF, Math.max(minF, State.matF));
        }
    }

    // Zoom/pan applied via ctx transforms in drawEngine — no CSS transform needed.
    canvas.style.transform = 'none';
}

// ---------------------------------------------------------------------------
// resetCamera — cancel any animation and snap to zoom-1, top of board
// ---------------------------------------------------------------------------
function resetCamera() {
    if (window.cameraAnimReq) {
        cancelAnimationFrame(window.cameraAnimReq);
        window.cameraAnimReq = null;
    }
    State.cssZoom = 1.0;
    State.matE    = 0;
    State.matF    = 0;
    applyBoardTransform();
}

// ---------------------------------------------------------------------------
// resizeCanvas — size the canvas to State.canvasW × State.canvasH (always
// exactly the container size); anchor it to the container's top-left so
// getCanvasCoords in input.js stays accurate.
// ---------------------------------------------------------------------------
function resizeCanvas() {
    const dpr       = window.devicePixelRatio || 1;
    const container = document.getElementById('board-container');
    const bcr       = container.getBoundingClientRect();

    calculateMetrics(bcr.width, bcr.height);

    // canvas.width reset clears the 2-D context transform — set it first.
    canvas.width  = Math.round(State.canvasW * dpr);
    canvas.height = Math.round(State.canvasH * dpr);
    canvas.style.width  = State.canvasW + 'px';
    canvas.style.height = State.canvasH + 'px';

    // Prevent the flex container's align-items:center from shifting a
    // taller-than-container canvas upward, which would offset all tap coords.
    canvas.style.alignSelf = 'flex-start';

    ctx.scale(dpr, dpr);
    applyBoardTransform();
}

// ---------------------------------------------------------------------------
// calculateMetrics — derive cellSize, canvasW/H, offsetX/Y from container size
//
// On mobile the cell size is driven by the TRUE visible gameplay area:
//
//   availableWidth  = window.innerWidth  − 2 × PAD
//   availableHeight = window.innerHeight − topBarH − bottomBarH − 2 × PAD
//
// Driving the calculation from window.innerHeight (the live CSS viewport
// height) minus the measured bar heights is more reliable than the container
// BCR alone.  Some browsers (iOS -webkit-fill-available, early Android Chrome
// svh fall-back) make the body taller than the actual on-screen area, which
// inflates the container BCR.  Sizing cells from that inflated height causes
// the board to overflow the real viewport.
//
// offsetY is centred inside the VISIBLE slice of the canvas (capped at
// window.innerHeight − topBarH) rather than the full canvas height, so the
// board stays entirely within the screen even when the container extends
// below the viewport edge.
// ---------------------------------------------------------------------------
function calculateMetrics(w, h) {
    // Shim: rootRows/rootCols are 0 until SD-3 wires board generation.
    // Fall back to gridRows/gridCols so the game works before that step.
    if (!State.rootRows) State.rootRows = State.gridRows;
    if (!State.rootCols) State.rootCols = State.gridCols;

    const isMobile = w < 768 && w < h;

    if (isMobile) {
        // ── Measure bars to find the actual on-screen play area ──────────────
        const header  = document.getElementById('game-header');
        const ctrls   = document.getElementById('game-controls');
        const topBarH = header ? header.getBoundingClientRect().height : 0;
        const botBarH = ctrls  ? ctrls.getBoundingClientRect().height  : 0;

        // 4 px safe gap on every edge so corners never touch the bar borders
        const PAD    = 4;
        const availW = w - PAD * 2;
        const availH = Math.max(20, window.innerHeight - topBarH - botBarH - PAD * 2);

        // Use the SMALLER ratio — guarantees the full board fits in both axes
        const cellByWidth  = availW / State.rootCols;
        const cellByHeight = availH / State.rootRows;
        State.cellSize = Math.max(1, Math.min(cellByWidth, cellByHeight));

        const boardW = State.rootCols * State.cellSize;
        const boardH = State.rootRows * State.cellSize;

        State.canvasW = w;
        State.canvasH = h;
        State.offsetX = (w - boardW) / 2;

        // Centre within the VISIBLE portion of the canvas.
        // The canvas origin is at the board-container top-left (below the header).
        // Cap the reference height at (window.innerHeight − topBarH) so the board
        // never extends below the viewport edge on inflated-body devices.
        const visibleH = Math.min(h, window.innerHeight - topBarH);
        State.offsetY  = Math.max(PAD, (visibleH - boardH) / 2);
    } else {
        // Desktop: container is explicitly size-constrained by CSS — use its BCR.
        State.cellSize = Math.min(w / State.rootCols, h / State.rootRows);

        const boardW = State.rootCols * State.cellSize;
        const boardH = State.rootRows * State.cellSize;

        State.canvasW = w;
        State.canvasH = h;
        State.offsetX = (w - boardW) / 2;
        State.offsetY = (h - boardH) / 2;
    }

    State.subCellSize = State.cellSize / (State.subdivFactor || 1);
}

// ---------------------------------------------------------------------------
// startCameraEntranceAnimation
//
// Called once after each new board is generated (not on persistence reload).
//
// Flow:
//   1. Compute fitZoom — the scale that fits the entire board in the TRUE
//      visible play area (viewport − bars) with 88 % fill so there is
//      visible breathing room around all four edges.
//   2. If fitZoom ≥ 0.96 the board already fits the screen at 1× zoom —
//      skip the animation and snap straight to 1×.
//   3. Otherwise:
//      a. Snap to fitZoom (board fully visible, centred on screen).
//      b. Hold for ~600 ms so the player can read the full puzzle layout.
//      c. Ease back to zoom = 1 over ~1100 ms (cubic ease-in-out).
//   4. Set State.minZoom to allow zooming FURTHER OUT than the fit view
//      (player freedom to navigate large boards).
// ---------------------------------------------------------------------------
function startCameraEntranceAnimation() {
    // Cancel any previous animation
    if (window.cameraAnimReq) {
        cancelAnimationFrame(window.cameraAnimReq);
        window.cameraAnimReq = null;
    }

    const container = document.getElementById('board-container');
    if (!container) { resetCamera(); return; }

    const bcr      = container.getBoundingClientRect();
    const isMobile = bcr.width < 768 && bcr.width < bcr.height;

    if (!isMobile || !State.cellSize) { resetCamera(); return; }

    // ── True visible play area (mirrors calculateMetrics) ───────────────────
    const header  = document.getElementById('game-header');
    const ctrls   = document.getElementById('game-controls');
    const topBarH = header ? header.getBoundingClientRect().height : 0;
    const botBarH = ctrls  ? ctrls.getBoundingClientRect().height  : 0;
    const PAD     = 4;

    // Visible slice of the canvas; container may extend below the viewport on
    // devices with an inflated body, so cap at window.innerHeight − topBarH.
    const visibleH = Math.min(bcr.height, window.innerHeight - topBarH);
    const usableW  = bcr.width - PAD * 2;
    const usableH  = Math.max(20, visibleH - botBarH - PAD * 2);

    const boardW = State.rootCols * State.cellSize;
    const boardH = State.rootRows * State.cellSize;

    // fitZoom: show the full board at 88 % fill — gives a clear overview margin
    const fitZoomX = (usableW * 0.88) / boardW;
    const fitZoomY = (usableH * 0.88) / boardH;
    const fitZoom  = Math.min(fitZoomX, fitZoomY, 1.0);  // never zoom in beyond 1×

    // Allow zooming out to 40 % of the fit view (freedom to navigate)
    State.minZoom = Math.max(fitZoom * 0.40, 0.08);

    if (fitZoom >= 0.96) {
        // Board comfortably fits at full zoom — no intro animation needed
        State.minZoom = 0.25;
        resetCamera();
        return;
    }

    // ── Step 1: snap to fit position ─────────────────────────────────────────
    State.cssZoom = fitZoom;
    State.matE    = 0;
    State.matF    = 0;
    applyBoardTransform();          // sets matE/F to properly centred values

    const startZ = State.cssZoom;
    const startE = State.matE;
    const startF = State.matF;

    // ── Step 2 target: normal gameplay position ───────────────────────────────
    const targetZ = 1.35;
    
    // Dynamically calculate the perfect target translation values for zoom=1.35
    const oldZoom = State.cssZoom;
    const oldE = State.matE;
    const oldF = State.matF;
    
    State.cssZoom = targetZ;
    State.matE = 0;
    State.matF = 0;
    applyBoardTransform();
    
    const targetE = State.matE;
    const targetF = State.matF;
    
    // Restore starting values and immediately apply them to the canvas to prevent snapping/zoom-out jumps
    State.cssZoom = startZ;
    State.matE = startE;
    State.matF = startF;
    applyBoardTransform();

    const HOLD_MS = 0;     // Instant zoom-in seamless handoff
    const ANIM_MS = 1100;  // zoom-in duration
    const t0      = performance.now();

    function step(now) {
        const elapsed = now - t0;

        if (elapsed < HOLD_MS) {
            // Still in the hold phase — keep the overview visible
            window.cameraAnimReq = requestAnimationFrame(step);
            return;
        }

        let p = (elapsed - HOLD_MS) / ANIM_MS;

        if (p >= 1.0) {
            // Animation complete — snap to exact target and re-apply clamping
            State.cssZoom = targetZ;
            State.matE    = targetE;
            State.matF    = targetF;
            applyBoardTransform();
            window.cameraAnimReq = null;
            return;
        }

        // Cubic ease-in-out
        const t = p < 0.5
            ? 4 * p * p * p
            : 1 - Math.pow(-2 * p + 2, 3) / 2;

        State.cssZoom = startZ + (targetZ - startZ) * t;
        State.matE    = startE + (targetE - startE) * t;
        State.matF    = startF + (targetF - startF) * t;

        // State updated — drawEngine picks up cssZoom/matE/matF on next frame.

        window.cameraAnimReq = requestAnimationFrame(step);
    }

    window.cameraAnimReq = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// startPathRevealAnimation
//
// Universal staggered entrance path drawing reveal animation.
// Lock screen at fitted overview, dynamically draw paths sequentially, and
// then trigger the cinematic camera zoom-in transition.
// ---------------------------------------------------------------------------
function startPathRevealAnimation() {
    if (window.cameraAnimReq) {
        cancelAnimationFrame(window.cameraAnimReq);
        window.cameraAnimReq = null;
    }

    State.revealActive = true;
    State.revealProgress = 0.0;

    const container = document.getElementById('board-container');
    if (!container) {
        State.revealActive = false;
        startCameraEntranceAnimation();
        return;
    }

    const bcr      = container.getBoundingClientRect();
    const isMobile = bcr.width < 768 && bcr.width < bcr.height;

    if (!isMobile || !State.cellSize) {
        State.revealActive = false;
        resetCamera();
        return;
    }

    // ── True visible play area (mirrors calculateMetrics) ───────────────────
    const header  = document.getElementById('game-header');
    const ctrls   = document.getElementById('game-controls');
    const topBarH = header ? header.getBoundingClientRect().height : 0;
    const botBarH = ctrls  ? ctrls.getBoundingClientRect().height  : 0;
    const PAD     = 4;

    const visibleH = Math.min(bcr.height, window.innerHeight - topBarH);
    const usableW  = bcr.width - PAD * 2;
    const usableH  = Math.max(20, visibleH - botBarH - PAD * 2);

    const boardW = State.rootCols * State.cellSize;
    const boardH = State.rootRows * State.cellSize;

    const fitZoomX = (usableW * 0.88) / boardW;
    const fitZoomY = (usableH * 0.88) / boardH;
    const fitZoom  = Math.min(fitZoomX, fitZoomY, 1.0);

    State.minZoom = Math.max(fitZoom * 0.40, 0.08);

    // ── Step 1: snap to fitted board zoom (clean and empty board initially) ──
    State.cssZoom = fitZoom;
    State.matE    = 0;
    State.matF    = 0;
    applyBoardTransform();          // sets matE/F to properly centered values

    // ── Step 2: progressive path reveal with adaptive duration (2x speedup) ──
    const N = State.paths.length;
    const duration = Math.min(900, Math.max(300, N * 60));
    const t0 = performance.now();

    function step(now) {
        const elapsed = now - t0;
        let p = elapsed / duration;

        if (p >= 1.0) {
            State.revealProgress = 1.0;
            State.revealActive = false;
            drawEngine();
            // Staggered reveal completes sequentially — run camera entrance animation next!
            startCameraEntranceAnimation();
            return;
        }

        State.revealProgress = p;
        drawEngine();

        window.cameraAnimReq = requestAnimationFrame(step);
    }

    window.cameraAnimReq = requestAnimationFrame(step);
}

window.addEventListener('resize', () => {
    resizeCanvas();
    drawEngine();
});
