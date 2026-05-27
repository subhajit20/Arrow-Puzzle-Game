const State = {
    gridSizePreset: "Auto", // "Auto", "Standard", "Grand", "Colossal", "Titan", "Cosmic"
    level: 1,
    score: 0,
    lives: 3,
    gridRows: 8,
    gridCols: 8,
    gridSize: 8,
    gridMask: [],
    shapeName: "Square Matrix",
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
    matF: 0
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const SIZING_PRESETS = ["Auto", "Standard", "Grand", "Colossal", "Titan", "Cosmic"];
