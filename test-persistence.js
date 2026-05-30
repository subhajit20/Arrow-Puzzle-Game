// Persistence tests for RC-7 — runs inside same vm context as the game code
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const JS = path.join(__dirname, 'js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8');

const store = {};
const sandbox = {
  console, Math, Array, Int32Array, Set, Map, Infinity, JSON,
  localStorage: {
    getItem:    k => store[k] || null,
    setItem:    (k, v) => { store[k] = v; },
    removeItem: k => { delete store[k]; }
  },
  State: {
    subdivFactor: 2, rootRows: 0, rootCols: 0, level: 1,
    recentDifficulties: [], score: 0, lives: 3, paths: [],
    cellSize: 40, subCellSize: 20, hEdge: null, vEdge: null,
    nodeOwner: null, boardDifficulty: 'NORMAL',
    gridRows: 0, gridCols: 0, gridSize: 0,
    shapeName: '', gridSizePreset: 'Auto', dailyPuzzleMode: false
  }
};
vm.createContext(sandbox);
vm.runInContext(read('edge-gen.js'),   sandbox);
vm.runInContext(read('edge-logic.js'), sandbox);
sandbox.resizeCanvas = () => {}; sandbox.resetCamera = () => {};
sandbox.updateDomUI = () => {};  sandbox.startPathRevealAnimation = () => {};
vm.runInContext(read('persistence.js'), sandbox);
vm.runInContext(read('board-gen.js'),   sandbox);

// All tests run inside the vm so they share the same lexical scope as Persistence
vm.runInContext(`
(function() {
  let pass = 0, fail = 0;
  function check(label, ok) {
    if (ok) { console.log('  PASS:', label); pass++; }
    else     { console.log('  FAIL:', label); fail++; }
  }

  // ── TEST 1: generate L10, save, wipe, reload, verify ──────────────────────
  State.level = 10; State.recentDifficulties = [];
  _build100PackedLevelEdge(true);
  const pathsBefore = State.paths.length, levelBefore = State.level, rrBefore = State.rootRows;
  Persistence.saveState();
  State.paths = []; State.level = 0; State.rootRows = 0; State.nodeOwner = null;
  const t1 = Persistence.loadState();
  check('T1 loadState returns true', t1);
  check('T1 level restored', State.level === levelBefore);
  check('T1 paths count restored', State.paths.length === pathsBefore);
  check('T1 rootRows restored', State.rootRows === rrBefore);
  check('T1 nodeOwner rebuilt', State.nodeOwner !== null);

  // ── TEST 2: nodeOwner consistent with path nodes after load ───────────────
  let ownerOk = true;
  for (const p of State.paths) {
    const W = State.gridCols + 1;
    for (const {r, c} of p.nodes)
      if (State.nodeOwner[r * W + c] !== p.id) { ownerOk = false; break; }
  }
  check('T2 nodeOwner consistent', ownerOk);

  // ── TEST 3: fallback-grid save (10×12 @ L60) silently discarded ───────────
  localStorage.setItem('vecto_colossal_mosaic_save_v4', JSON.stringify({
    version: 4, level: 60, rootRows: 10, rootCols: 12, subdivFactor: 2,
    gridRows: 20, gridCols: 24, score: 500, lives: 2,
    hEdge: Array.from({length:21}, () => Array(24).fill(-1)),
    vEdge: Array.from({length:20}, () => Array(25).fill(-1)),
    paths: [{id:0, nodes:[{r:0,c:0},{r:0,c:1}], heading:'RIGHT',
             state:'IDLE', animProgress:0, originalNodes:[]}]
  }));
  State.level = 0; State.paths = [];
  check('T3 fallback-grid (10×12 @ L60) discarded', !Persistence.loadState());

  // ── TEST 4: valid old V4 save (L5 10×4) loads fine ────────────────────────
  localStorage.setItem('vecto_colossal_mosaic_save_v4', JSON.stringify({
    version: 4, level: 5, rootRows: 10, rootCols: 4, subdivFactor: 2,
    gridRows: 20, gridCols: 8, score: 100, lives: 3,
    hEdge: Array.from({length:21}, () => Array(8).fill(-1)),
    vEdge: Array.from({length:20}, () => Array(9).fill(-1)),
    paths: [{id:0, nodes:[{r:0,c:0},{r:0,c:1}], heading:'RIGHT',
             state:'IDLE', animProgress:0, originalNodes:[{r:0,c:0},{r:0,c:1}]}]
  }));
  State.level = 0; State.paths = [];
  const t4 = Persistence.loadState();
  check('T4 valid L5 (10×4) loads', t4);
  check('T4 level correct', State.level === 5);
  check('T4 rootRows correct', State.rootRows === 10);

  // ── TEST 5: RC board at L60 round-trips correctly ─────────────────────────
  State.level = 60; State.recentDifficulties = [];
  _build100PackedLevelEdge(true);
  const p60 = State.paths.length, rr60 = State.rootRows;
  Persistence.saveState();
  State.paths = []; State.level = 0; State.rootRows = 0;
  const t5 = Persistence.loadState();
  check('T5 RC L60 save+reload', t5);
  check('T5 paths count', State.paths.length === p60);
  check('T5 rootRows', State.rootRows === rr60);

  console.log('\\n' + pass + '/' + (pass+fail) + ' tests passed');
})();
`, sandbox);
