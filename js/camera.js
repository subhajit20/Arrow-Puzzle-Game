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
    if (State.cssZoom > 6.0) State.cssZoom = 6.0;

    const container = document.getElementById('board-container');
    if (container && State.canvasW && State.canvasH) {
        const bcr = container.getBoundingClientRect();
        const scaledW = State.canvasW * State.cssZoom;
        const scaledH = State.canvasH * State.cssZoom;

        const isMobile = bcr.width < 768 && bcr.width < bcr.height;
        let topBarH = 0;
        let bottomBarH = 0;
        if (isMobile) {
            const header = document.getElementById('game-header');
            const footer = document.getElementById('game-controls');
            if (header) topBarH = header.getBoundingClientRect().height;
            if (footer) bottomBarH = footer.getBoundingClientRect().height;
        }

        const availW = bcr.width;
        const availH = bcr.height - topBarH - bottomBarH;

        // Horizontal ─────────────────────────────────────────────────────────
        if (scaledW <= availW) {
            // Canvas narrower than available: centre it
            State.matE = (availW - scaledW) / 2;
        } else {
            // Canvas wider: allow panning
            const ox = State.offsetX || 0;
            const brdW = (State.gridCols || 0) * (State.cellSize || 0);
            const maxE = -ox * State.cssZoom;
            const minE = availW - (ox + brdW) * State.cssZoom;
            State.matE = Math.min(maxE, Math.max(minE, State.matE));
        }

        // Vertical ───────────────────────────────────────────────────────────
        if (scaledH <= availH) {
            // Canvas shorter than available: centre it perfectly between bars
            State.matF = topBarH + (availH - scaledH) / 2;
        } else {
            // Canvas taller: scroll from just below top bar to just above bottom bar
            const maxF = topBarH;
            const minF = topBarH + availH - scaledH;
            State.matF = Math.min(maxF, Math.max(minF, State.matF));
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
    State.matE = 0;
    State.matF = 0;
    applyBoardTransform();
}

// ---------------------------------------------------------------------------
// resizeCanvas — size the canvas to State.canvasW × State.canvasH (always
// exactly the container size); anchor it to the container's top-left so
// getCanvasCoords in input.js stays accurate.
// ---------------------------------------------------------------------------
function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const container = document.getElementById('board-container');
    const bcr = container.getBoundingClientRect();

    calculateMetrics(bcr.width, bcr.height);

    // canvas.width reset clears the 2-D context transform — set it first.
    canvas.width = Math.round(State.canvasW * dpr);
    canvas.height = Math.round(State.canvasH * dpr);
    canvas.style.width = State.canvasW + 'px';
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
        const cellByWidth = (w - 4) / State.gridCols;
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

    const bcr = container.getBoundingClientRect();
    const isMobile = bcr.width < 768 && bcr.width < bcr.height;

    if (!isMobile || !State.cellSize) { resetCamera(); return; }

    const boardW = State.gridCols * State.cellSize;
    const boardH = State.gridRows * State.cellSize;

    let topBarH = 0;
    let bottomBarH = 0;
    const header = document.getElementById('game-header');
    const footer = document.getElementById('game-controls');
    if (header) topBarH = header.getBoundingClientRect().height;
    if (footer) bottomBarH = footer.getBoundingClientRect().height;

    const availW = bcr.width;
    const availH = bcr.height - topBarH - bottomBarH;

    // Use a small safe padding (6%) so edges never touch borders
    const fitZoomX = (availW * 0.94) / boardW;
    const fitZoomY = (availH * 0.94) / boardH;
    const fitZoom = Math.min(fitZoomX, fitZoomY, 1.0);  // never zoom in beyond 1×

    // Allow zooming out to 40 % of the fit view (more freedom than the overview)
    State.minZoom = Math.max(fitZoom * 0.40, 0.08);

    // Snap directly to the fit position per user request (Option A)
    // We remove the animation completely for large boards so they stay fully visible.
    State.cssZoom = fitZoom;
    applyBoardTransform(); // This correctly centers the board within the available area
}

window.addEventListener('resize', () => {
    resizeCanvas();
    drawEngine();
});
