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
//   • When it is WIDER/TALLER the user can pan freely within bounds.
// ---------------------------------------------------------------------------
function applyBoardTransform() {
    // Clamp zoom
    if (State.cssZoom < State.minZoom) State.cssZoom = State.minZoom;
    if (State.cssZoom > 6.0)           State.cssZoom = 6.0;

    const container = document.getElementById('board-container');
    if (container && State.canvasW && State.canvasH) {
        const bcr     = container.getBoundingClientRect();
        const scaledW = State.canvasW * State.cssZoom;
        const scaledH = State.canvasH * State.cssZoom;

        // Horizontal ─────────────────────────────────────────────────────────
        if (scaledW <= bcr.width) {
            // Canvas narrower than container: centre it (handles zoom-out)
            State.matE = (bcr.width - scaledW) / 2;
        } else {
            // Canvas wider: allow panning across the full board width.
            // Bounds are board-edge-based so the player can reach every column:
            //   maxE  →  board left  edge at container left  edge
            //   minE  →  board right edge at container right edge
            const ox    = State.offsetX  || 0;
            const brdW  = (State.gridCols || 0) * (State.cellSize || 0);
            const maxE  = -ox * State.cssZoom;
            const minE  = bcr.width - (ox + brdW) * State.cssZoom;
            State.matE  = Math.min(maxE, Math.max(minE, State.matE));
        }

        // Vertical ───────────────────────────────────────────────────────────
        if (scaledH <= bcr.height) {
            // Canvas shorter than container: centre it
            State.matF = (bcr.height - scaledH) / 2;
        } else {
            // Canvas taller: scroll from top (matF=0) to bottom (matF=-max)
            const maxDown = scaledH - bcr.height;
            State.matF = Math.min(0, Math.max(-maxDown, State.matF));
        }
    }

    canvas.style.transform =
        `matrix(${State.cssZoom},0,0,${State.cssZoom},${State.matE},${State.matF})`;
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
// On mobile the cell size is constrained by BOTH available width and height so
// the entire board always fits inside the board-container without overflowing.
//   cellByWidth  = (w - 4)  / gridCols  — 2 px breathing room each side
//   cellByHeight = (h - 8)  / gridRows  — 4 px breathing room top + bottom
//   cellSize     = min(cellByWidth, cellByHeight)
//
// Consequence: the canvas is always exactly the container size, the board is
// centred inside it, and no board ever needs vertical scrolling to be seen.
// ---------------------------------------------------------------------------
function calculateMetrics(w, h) {
    const isMobile = w < 768 && w < h;

    if (isMobile) {
        // Fit the board inside the container in BOTH dimensions simultaneously.
        const cellByWidth  = (w - 4) / State.gridCols;
        const cellByHeight = (h - 8) / State.gridRows;
        State.cellSize = Math.min(cellByWidth, cellByHeight);
    } else {
        // Desktop: fit the whole board in the fixed-size container box.
        State.cellSize = Math.min(w / State.gridCols, h / State.gridRows);
    }

    const boardW = State.gridCols * State.cellSize;
    const boardH = State.gridRows * State.cellSize;

    // Canvas is always exactly the container size — the board is centred inside.
    State.canvasW = w;
    State.canvasH = h;

    State.offsetX = (w - boardW) / 2;
    State.offsetY = (h - boardH) / 2;
}

// ---------------------------------------------------------------------------
// startCameraEntranceAnimation
//
// Called once after each new board is generated (not on persistence reload).
//
// Flow:
//   1. Compute fitZoom — the scale at which the full board fits in the
//      viewport with margins for the floating header/footer.
//   2. If the board already fits at zoom=1 (fitZoom ≥ 0.96), skip animation.
//   3. Otherwise:
//      a. Snap to fitZoom (board fully visible, centred on screen).
//      b. Hold for ~600 ms so the player sees the overview.
//      c. Ease back to zoom=1 / matF=0 over ~1100 ms (cubic ease-in-out).
//   4. Set State.minZoom to allow zooming out FURTHER than the fit view
//      (user requirement: freedom to zoom out for navigation).
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

    const boardW = State.gridCols * State.cellSize;
    const boardH = State.gridRows * State.cellSize;

    // Fit scale: show entire board inside the board-container viewport.
    // The bars are separate flex items (not overlaying the canvas), so bcr is
    // already the pure board area — use 0.92 vertically for a small breathing
    // margin rather than the old 0.76 which was designed for floating overlays.
    //   • 0.94 horizontal → ~3 % breathing room each side
    //   • 0.92 vertical   → ~4 % breathing room top and bottom
    const fitZoomX = (bcr.width  * 0.94) / boardW;
    const fitZoomY = (bcr.height * 0.92) / boardH;
    const fitZoom  = Math.min(fitZoomX, fitZoomY, 1.0);  // never zoom in beyond 1×

    // Allow zooming out to 40 % of the fit view (more freedom than the overview)
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
    const targetZ = 1.0;
    const targetE = 0.0;
    const targetF = 0.0;

    const HOLD_MS = 600;   // time to show the full-board overview
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

        // Write the transform directly — skip applyBoardTransform clamping so
        // the lerp is smooth even through intermediate zoom levels.
        canvas.style.transform =
            `matrix(${State.cssZoom},0,0,${State.cssZoom},${State.matE},${State.matF})`;

        window.cameraAnimReq = requestAnimationFrame(step);
    }

    window.cameraAnimReq = requestAnimationFrame(step);
}

window.addEventListener('resize', () => {
    resizeCanvas();
    drawEngine();
});
