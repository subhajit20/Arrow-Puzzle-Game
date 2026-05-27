function applyBoardTransform() {
    if (State.cssZoom < 0.1) {
        State.cssZoom = 0.1;
    }
    
    const container = document.getElementById('board-container');
    if (container && State.canvasW && State.canvasH) {
        const bcr = container.getBoundingClientRect();
        const scaledW = State.canvasW * State.cssZoom;
        const scaledH = State.canvasH * State.cssZoom;
        
        if (scaledW <= bcr.width) {
            State.matE = 0;
        } else {
            const maxE = (scaledW - bcr.width) / 2;
            State.matE = Math.min(maxE, Math.max(-maxE, State.matE));
        }
        
        if (scaledH <= bcr.height) {
            State.matF = 0;
        } else {
            const maxF = (scaledH - bcr.height) / 2;
            State.matF = Math.min(maxF, Math.max(-maxF, State.matF));
        }
    }
    
    canvas.style.transform = `matrix(${State.cssZoom},0,0,${State.cssZoom},${State.matE},${State.matF})`;
}

window.cameraAnimReq = null;

function resetCamera() {
    if (window.cameraAnimReq) cancelAnimationFrame(window.cameraAnimReq);
    State.cssZoom = 1.0;
    State.matE = 0;
    State.matF = State.initialMatF || 0;
    applyBoardTransform();
}

function startCameraEntranceAnimation() {
    const container = document.getElementById('board-container');
    if (!container || !State.canvasW || !State.canvasH) return;
    const bcr = container.getBoundingClientRect();
    
    const fitZoomX = (bcr.width * 0.9) / State.canvasW;
    const fitZoomY = (bcr.height * 0.9) / State.canvasH;
    const autoFitZoom = Math.min(fitZoomX, fitZoomY);
    
    if (autoFitZoom >= 1.0) return;
    
    State.cssZoom = autoFitZoom;
    State.matE = 0; 
    State.matF = 0; 
    applyBoardTransform();
    
    const duration = 1600;
    const startTime = performance.now();
    const targetZoom = 1.0;
    const targetMatF = State.initialMatF || 0;
    
    if (window.cameraAnimReq) cancelAnimationFrame(window.cameraAnimReq);
    
    function animStep(now) {
        let elapsed = now - startTime;
        if (elapsed < 600) {
            window.cameraAnimReq = requestAnimationFrame(animStep);
            return;
        }
        
        let progress = (elapsed - 600) / (duration - 600);
        if (progress >= 1.0) progress = 1.0;
        
        let t = progress;
        let ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        
        State.cssZoom = autoFitZoom + (targetZoom - autoFitZoom) * ease;
        State.matF = 0 + (targetMatF - 0) * ease;
        
        applyBoardTransform();
        
        if (progress < 1.0) {
            window.cameraAnimReq = requestAnimationFrame(animStep);
        }
    }
    
    window.cameraAnimReq = requestAnimationFrame(animStep);
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const container = document.getElementById('board-container');
    const bcr = container.getBoundingClientRect();
    
    calculateMetrics(bcr.width, bcr.height);
    
    canvas.width = State.canvasW * dpr;
    canvas.height = State.canvasH * dpr;
    canvas.style.width = `${State.canvasW}px`;
    canvas.style.height = `${State.canvasH}px`;
    
    ctx.scale(dpr, dpr);
}

function calculateMetrics(w, h) {
    let isMobile = w < 768 && w < h;
    
    if (isMobile) {
        let horizontalPadding = Math.min(24, w * 0.05); 
        State.cellSize = (w - horizontalPadding) / State.gridCols;
        State.cellSize = Math.min(State.cellSize, w / 5); 
    } else {
        State.cellSize = Math.min(w / State.gridCols, h / State.gridRows);
    }

    let boardW = State.gridCols * State.cellSize;
    let boardH = State.gridRows * State.cellSize;

    State.canvasW = Math.max(w, boardW);
    State.canvasH = Math.max(h, boardH + (isMobile ? 120 : 0));

    State.offsetX = (State.canvasW - boardW) / 2;
    
    if (boardH < h) {
        State.offsetY = (State.canvasH - boardH) / 2;
        State.initialMatF = 0;
    } else {
        State.offsetY = 40; 
        State.initialMatF = (State.canvasH - h) / 2;
    }
    
    if (State.matE === 0 && (State.matF === 0 || State.matF === State.initialMatF)) {
        State.matF = State.initialMatF;
        applyBoardTransform();
    }
}
