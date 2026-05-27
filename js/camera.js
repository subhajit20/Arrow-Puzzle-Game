// ---------------------------------------------------------------------------
// applyBoardTransform
// Applies the current cssZoom + matE/matF values as a CSS matrix transform.
// Clamps panning so the board cannot be dragged completely off screen.
// ---------------------------------------------------------------------------
function applyBoardTransform() {
    if (State.cssZoom < 1.0) State.cssZoom = 1.0;

    const container = document.getElementById('board-container');
    if (container && State.canvasW && State.canvasH) {
        const bcr = container.getBoundingClientRect();
        const scaledW = State.canvasW * State.cssZoom;
        const scaledH = State.canvasH * State.cssZoom;

        // Horizontal: keep canvas centred when it fits; clamp over-pan when zoomed
        if (scaledW <= bcr.width) {
            State.matE = 0;
        } else {
            const maxE = (scaledW - bcr.width) / 2;
            State.matE = Math.min(maxE, Math.max(-maxE, State.matE));
        }

        // Vertical: allow panning for tall boards; no panning past either edge
        if (scaledH <= bcr.height) {
            State.matF = 0;
        } else {
            // matF = 0   → top of canvas visible
            // matF = -(scaledH - bcr.height) → bottom of canvas visible
            const maxScrollDown = scaledH - bcr.height;
            State.matF = Math.min(0, Math.max(-maxScrollDown, State.matF));
        }
    }

    canvas.style.transform =
        `matrix(${State.cssZoom},0,0,${State.cssZoom},${State.matE},${State.matF})`;
}

// ---------------------------------------------------------------------------
// resetCamera — snap back to top-left at zoom 1
// ---------------------------------------------------------------------------
function resetCamera() {
    State.cssZoom = 1.0;
    State.matE = 0;
    State.matF = 0;
    applyBoardTransform();
}

// ---------------------------------------------------------------------------
// resizeCanvas
// Reads the container dimensions, recalculates metrics, then resizes the
// canvas element to match State.canvasW × State.canvasH (which may be taller
// than the screen on mobile).
// ---------------------------------------------------------------------------
function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const container = document.getElementById('board-container');
    const bcr = container.getBoundingClientRect();

    calculateMetrics(bcr.width, bcr.height);

    // Setting canvas.width resets the 2-D context transform — do it first so
    // ctx.scale() below starts from a clean identity matrix.
    canvas.width  = Math.round(State.canvasW * dpr);
    canvas.height = Math.round(State.canvasH * dpr);

    // CSS display size: canvas can be taller than the container on mobile;
    // overflow:hidden on the container clips the excess, and the CSS transform
    // (matF < 0) scrolls it up to reveal the lower part of the board.
    canvas.style.width  = State.canvasW + 'px';
    canvas.style.height = State.canvasH + 'px';

    // CRITICAL: the board-container uses flex + align-items:center.  Without
    // this override, a canvas taller than the container gets flex-centred, i.e.
    // its top is shifted up by (containerH - canvasH)/2.  getCanvasCoords in
    // input.js assumes canvasTop == containerTop, so that offset makes every
    // tap land on the wrong path and breaks zoom anchoring.
    canvas.style.alignSelf = 'flex-start';

    ctx.scale(dpr, dpr);
    applyBoardTransform();
}

// ---------------------------------------------------------------------------
// calculateMetrics
// The core sizing function.
//
// Mobile (portrait):  cellSize = (containerWidth - 4) / gridCols
//   — fills the full screen width.  The column count produced by
//     generateRandomGridDimensions keeps individual cells readable.
//   — canvasH is large enough to hold the full board; the user pans down.
//
// Desktop / landscape: cellSize = min(w/cols, h/rows) — fits in the box.
// ---------------------------------------------------------------------------
function calculateMetrics(w, h) {
    const isMobile = w < 768 && w < h;

    if (isMobile) {
        // 4 px total edge clearance (2 px per side) so cells don't bleed to the
        // physical screen edge.  No height constraint — column count drives density.
        State.cellSize = (w - 4) / State.gridCols;
    } else {
        // Desktop / landscape: fit the whole board inside the container box.
        State.cellSize = Math.min(w / State.gridCols, h / State.gridRows);
    }

    const boardW = State.gridCols * State.cellSize;
    const boardH = State.gridRows * State.cellSize;

    // Canvas width always equals the container width.
    // Canvas height covers the full board plus safe-area padding for mobile.
    State.canvasW = w;
    State.canvasH = isMobile
        ? Math.max(h, boardH + 140)   // 140 px: header + footer safe-area buffer
        : Math.max(h, boardH);

    // Centre the board horizontally (yields the 2 px clearance each side).
    State.offsetX = (State.canvasW - boardW) / 2;

    // Vertical placement:
    //   • Board fits on screen → vertically centred.
    //   • Board taller than screen → start below the floating header (~10 % of h).
    if (boardH + 20 <= h) {
        State.offsetY = (State.canvasH - boardH) / 2;
    } else {
        State.offsetY = Math.round(h * 0.10);
    }
}

window.addEventListener('resize', () => {
    resizeCanvas();
    drawEngine();
});
