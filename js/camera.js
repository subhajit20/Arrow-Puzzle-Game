function applyBoardTransform() {
    if (State.cssZoom <= 1.0) {
        State.cssZoom = 1.0;
        State.matE = 0;
        State.matF = 0;
    }
    canvas.style.transform = `matrix(${State.cssZoom},0,0,${State.cssZoom},${State.matE},${State.matF})`;
}

function resetCamera() {
    State.cssZoom = 1.0;
    State.matE = 0;
    State.matF = 0;
    applyBoardTransform();
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const bcr = canvas.getBoundingClientRect();
    canvas.width = bcr.width * dpr;
    canvas.height = bcr.height * dpr;
    ctx.scale(dpr, dpr);
    calculateMetrics(bcr.width, bcr.height);
}

function calculateMetrics(w, h) {
    State.cellSize = Math.min(w / State.gridCols, h / State.gridRows);
    State.offsetX = (w - (State.gridCols * State.cellSize)) / 2;
    State.offsetY = (h - (State.gridRows * State.cellSize)) / 2;
}
