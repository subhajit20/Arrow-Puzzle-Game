// -----------------------------------------------------------------------------
// findPathByEdgeTap
// Edge-based path selection: find the path whose nearest edge midpoint is
// within hitRadius canvas pixels of the tapped/hovered canvas coordinate.
//
// Each edge has a midpoint:
//   hEdge[r][c]  →  pixel (ox + (c+0.5)×cSize,  oy + r×cSize)
//   vEdge[r][c]  →  pixel (ox + c×cSize,          oy + (r+0.5)×cSize)
//
// Returns the nearest IDLE path within hitRadius, or null.
// Falls back automatically when State.hEdge/vEdge are not yet available.
// -----------------------------------------------------------------------------
function findPathByEdgeTap(canvasX, canvasY, hitRadius) {
    if (!State.hEdge || !State.vEdge) return null;

    // Edge midpoints are at micro-grid pitch; hit radius stays in root-cell
    // units (State.cellSize * 0.6–0.7) so tap targets remain finger-sized.
    const sCS = State.subCellSize || State.cellSize;
    const ox    = State.offsetX;
    const oy    = State.offsetY;
    const rows  = State.gridRows;
    const cols  = State.gridCols;

    let bestDist = hitRadius;
    let bestId   = -1;

    // Horizontal edges
    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c < cols; c++) {
            const owner = State.hEdge[r][c];
            if (owner < 0) continue;
            const d = Math.hypot(canvasX - (ox + (c + 0.5) * sCS),
                                 canvasY - (oy + r * sCS));
            if (d < bestDist) { bestDist = d; bestId = owner; }
        }
    }

    // Vertical edges
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c <= cols; c++) {
            const owner = State.vEdge[r][c];
            if (owner < 0) continue;
            const d = Math.hypot(canvasX - (ox + c * sCS),
                                 canvasY - (oy + (r + 0.5) * sCS));
            if (d < bestDist) { bestDist = d; bestId = owner; }
        }
    }

    if (bestId < 0) return null;
    return State.paths.find(p => p.id === bestId && p.state === "IDLE") ?? null;
}

function getCanvasCoords(clientX, clientY) {
    const boardBcr = document.getElementById('board-container').getBoundingClientRect();
    const canvasX = (clientX - boardBcr.left - State.matE) / State.cssZoom;
    const canvasY = (clientY - boardBcr.top - State.matF) / State.cssZoom;
    return { x: canvasX, y: canvasY };
}

let touchMode = "none"; // "none", "pan", "pinch"
let lastTouchX1 = 0, lastTouchY1 = 0;
let startTouchDistance = 0;
let startZoom = 1.0;
let pinchAnchorX = 0, pinchAnchorY = 0;
let touchStartCoords = { x: 0, y: 0 };
let touchStartClientX = 0, touchStartClientY = 0;
let touchStartTime = 0;
let ignoreTap = false;

canvas.addEventListener('touchstart', (e) => {
    if (State.revealActive) { e.preventDefault(); return; }
    AudioEngine.init();
    // Cancel any in-flight camera entrance animation so the user's touch takes over immediately
    if (window.cameraAnimReq) {
        cancelAnimationFrame(window.cameraAnimReq);
        window.cameraAnimReq = null;
    }
    if (State.isWinState || State.isFailState) return;

    const now = Date.now();

    if (e.touches.length === 1) {
        ignoreTap = false;
        touchMode = "pan";
        lastTouchX1 = e.touches[0].clientX;
        lastTouchY1 = e.touches[0].clientY;

        touchStartCoords = getCanvasCoords(e.touches[0].clientX, e.touches[0].clientY);
        touchStartClientX = e.touches[0].clientX;
        touchStartClientY = e.touches[0].clientY;
        touchStartTime = now;
    } else if (e.touches.length === 2) {
        touchMode = "pinch";

        const boardBcr = document.getElementById('board-container').getBoundingClientRect();
        const t1x = e.touches[0].clientX - boardBcr.left;
        const t1y = e.touches[0].clientY - boardBcr.top;
        const t2x = e.touches[1].clientX - boardBcr.left;
        const t2y = e.touches[1].clientY - boardBcr.top;

        startTouchDistance = Math.hypot(t1x - t2x, t1y - t2y);
        startZoom = State.cssZoom;
        const midX = (t1x + t2x) / 2;
        const midY = (t1y + t2y) / 2;
        pinchAnchorX = (midX - State.matE) / State.cssZoom;
        pinchAnchorY = (midY - State.matF) / State.cssZoom;
    }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    if (State.isWinState || State.isFailState) return;

    if (e.touches.length === 1 && touchMode === "pan") {
        const dx = e.touches[0].clientX - lastTouchX1;
        const dy = e.touches[0].clientY - lastTouchY1;
        lastTouchX1 = e.touches[0].clientX;
        lastTouchY1 = e.touches[0].clientY;

        State.matE += dx;
        State.matF += dy;
        applyBoardTransform();

    } else if (e.touches.length === 2 && touchMode === "pinch") {
        const boardBcr = document.getElementById('board-container').getBoundingClientRect();
        const t1x = e.touches[0].clientX - boardBcr.left;
        const t1y = e.touches[0].clientY - boardBcr.top;
        const t2x = e.touches[1].clientX - boardBcr.left;
        const t2y = e.touches[1].clientY - boardBcr.top;

        const currentDist = Math.hypot(t1x - t2x, t1y - t2y);
        if (startTouchDistance > 0 && currentDist > 0) {
            const newZoom = Math.min(6.0, Math.max(State.minZoom, startZoom * currentDist / startTouchDistance));
            const midX = (t1x + t2x) / 2;
            const midY = (t1y + t2y) / 2;
            State.cssZoom = newZoom;
            State.matE = midX - newZoom * pinchAnchorX;
            State.matF = midY - newZoom * pinchAnchorY;
            applyBoardTransform();
        }
    }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    if (State.isWinState || State.isFailState) return;

    const now = Date.now();

    if (touchMode === "pan") {
        let duration = now - touchStartTime;

        const released = e.changedTouches[0];
        let distMoved = Math.hypot(released.clientX - touchStartClientX, released.clientY - touchStartClientY);

        if (!ignoreTap && duration < 250 && distMoved < 15) {
            const cSize = State.cellSize;
            const hitR  = cSize * 0.7;

            const selected = findPathByEdgeTap(touchStartCoords.x, touchStartCoords.y, hitR);
            if (selected) {
                AudioEngine.tap();
                selected.state = "MOVING";
            }
        }
    }

    if (e.touches.length === 0) {
        touchMode = "none";
    } else if (e.touches.length === 1) {
        touchMode = "pan";
        lastTouchX1 = e.touches[0].clientX;
        lastTouchY1 = e.touches[0].clientY;
    }
    e.preventDefault();
}, { passive: false });

let isMouseDown = false;
let lastMouseX = 0;
let lastMouseY = 0;
let mouseDownCoords = { x: 0, y: 0 };
let mouseDownTime = 0;

canvas.addEventListener('mousedown', (e) => {
    if (State.revealActive) { e.preventDefault(); return; }
    AudioEngine.init();
    // Cancel any in-flight camera entrance animation on desktop click/drag
    if (window.cameraAnimReq) {
        cancelAnimationFrame(window.cameraAnimReq);
        window.cameraAnimReq = null;
    }
    if (State.isWinState || State.isFailState) return;

    isMouseDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    mouseDownCoords = getCanvasCoords(lastMouseX, lastMouseY);
    mouseDownTime = Date.now();
});

canvas.addEventListener('mousemove', (e) => {
    if (State.isWinState || State.isFailState) return;

    const coords = getCanvasCoords(e.clientX, e.clientY);
    const cSize  = State.cellSize;

    State.selectedPath = findPathByEdgeTap(coords.x, coords.y, cSize * 0.6) || null;

    if (isMouseDown) {
        let dx = e.clientX - lastMouseX;
        let dy = e.clientY - lastMouseY;
        State.matE += dx;
        State.matF += dy;
        applyBoardTransform();
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});

window.addEventListener('mouseup', (e) => {
    if (isMouseDown) {
        isMouseDown = false;
        if (Date.now() - mouseDownTime < 250) {
            const cSize = State.cellSize;
            const hitR  = cSize * 0.7;

            const selected = findPathByEdgeTap(mouseDownCoords.x, mouseDownCoords.y, hitR);
            if (selected) {
                AudioEngine.tap();
                selected.state = "MOVING";
            }
        }
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (State.revealActive) return;
    if (State.isWinState || State.isFailState) return;

    const boardBcr = document.getElementById('board-container').getBoundingClientRect();
    const relX = e.clientX - boardBcr.left;
    const relY = e.clientY - boardBcr.top;
    const anchorX = (relX - State.matE) / State.cssZoom;
    const anchorY = (relY - State.matF) / State.cssZoom;

    const zoomSpeed = 0.1;
    const newZoom = e.deltaY < 0
        ? Math.min(6.0, State.cssZoom * (1 + zoomSpeed))
        : Math.max(State.minZoom, State.cssZoom * (1 - zoomSpeed));

    State.cssZoom = newZoom;
    State.matE = relX - newZoom * anchorX;
    State.matF = relY - newZoom * anchorY;
    applyBoardTransform();
}, { passive: false });
