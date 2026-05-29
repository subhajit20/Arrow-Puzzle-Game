const State = {
    gridSizePreset: "Auto", // "Auto", "Standard", "Grand", "Colossal", "Titan", "Cosmic"
    level: 1,
    score: 0,
    lives: 3,
    // Root grid — visual layout and screen fitting (from getSizesForLevel)
    rootRows:    0,
    rootCols:    0,
    // Micro routing grid — rootRows × subdivFactor (actual path traversal space)
    gridRows: 8,
    gridCols: 8,
    gridSize: 8,
    // Subdivision
    subdivFactor: 2,      // each root-cell axis splits into this many micro-units
    subCellSize:  0,      // pixel pitch of micro-grid nodes = cellSize / subdivFactor
    gridMask: [],
    shapeName: "Square Matrix",
    hEdge: null,      // edge-based: (rows+1) × cols  Int32Array[]
    vEdge: null,      // edge-based: rows × (cols+1) Int32Array[]
    nodeOwner: null,  // flat Int32Array (rows+1)*(cols+1) — rebuilt from paths, not persisted
    paths: [],
    particles: [],
    selectedPath: null,
    isWinState: false,
    isFailState: false,
    animatingCount: 0,
    cellSize: 0,
    offsetX: 0,
    offsetY: 0,
    hintPathId: null,
    levelStartScore: 0,
    dailyPuzzleMode: false,
    dailyPuzzleScoreAtStart: 0,
    dailyScore: 0,
    cssZoom: 1.0,
    matE: 0,
    matF: 0,
    canvasW: 0,
    canvasH: 0,
    minZoom: 0.15,  // updated dynamically by startCameraEntranceAnimation
    revealActive: false,
    revealProgress: 0.0,
    boardDifficulty: "NORMAL",
    recentDifficulties: []
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const SIZING_PRESETS = ["Auto", "Standard", "Grand", "Colossal", "Titan", "Cosmic"];
