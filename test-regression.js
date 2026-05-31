// =============================================================================
// test-regression.js — RV-5 regression harness
// Tests every unique size in getSizesForLevel for solvability, coverage,
// tier spread, generation time, and full RULEBOOK compliance (all 14 rules).
// Run: node test-regression.js
// =============================================================================
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');
const JS   = path.join(__dirname, 'js');
const read = f => fs.readFileSync(path.join(JS, f), 'utf8');

// ── Sandbox ──────────────────────────────────────────────────────────────────
const assertErrors = [], assertWarns = [];
const sandbox = {
  console: {
    log:   () => {},
    warn:  (...a) => { assertWarns.push(a.join(' ')); },
    error: (...a) => { assertErrors.push(a.join(' ')); }
  },
  Math, Array, Int32Array, Set, Map, Infinity, JSON,
  State: {
    subdivFactor: 2, rootRows: 0, rootCols: 0, level: 1,
    recentDifficulties: [], score: 0, lives: 3, paths: [],
    cellSize: 40, subCellSize: 20
  }
};
vm.createContext(sandbox);
vm.runInContext(read('edge-gen.js'),   sandbox);
vm.runInContext(read('edge-logic.js'), sandbox);
sandbox.resizeCanvas = () => {}; sandbox.resetCamera = () => {};
sandbox.Persistence  = { loadState: () => false, saveState: () => {} };
sandbox.updateDomUI  = () => {}; sandbox.startPathRevealAnimation = () => {};
vm.runInContext(read('board-gen.js'), sandbox);

const S = sandbox;
const TIERS = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'TITAN'];
const TRIALS = 30;

// ── Collect every unique {rows,cols,level} from getSizesForLevel ─────────────
const unique = new Map(); // key "RxC" → {rows, cols, repLevel}
for (let L = 1; L <= 101; L++) {
  for (const sz of S.getSizesForLevel(L)) {
    const k = `${sz.rows}x${sz.cols}`;
    if (!unique.has(k)) unique.set(k, { rows: sz.rows, cols: sz.cols, repLevel: L });
  }
}

// ── Run tests ────────────────────────────────────────────────────────────────
let totalBoards = 0, totalSolvFail = 0, totalAssertErr = 0, totalAssertWarn = 0;
let totalFallback = 0, totalRulebookFail = 0;
const allRows = [];

console.log('RV-5 Regression Harness — every size in getSizesForLevel');
console.log('='.repeat(72));
console.log(`${'Size'.padEnd(8)} ${'Level'.padEnd(6)} ${'Solv'.padEnd(7)} ${'Cov%'.padEnd(10)} ${'Paths'.padEnd(8)} ${'ms/bd'.padEnd(7)} ${'Tiers'}`);
console.log('-'.repeat(72));

for (const [key, { rows, cols, repLevel }] of unique) {
  let solvFail = 0, assertErr = 0, assertWarn = 0, fallback = 0, rulebookFail = 0;
  const covs = [], paths = [], times = [];
  const tierCount = {};

  for (let t = 0; t < TRIALS; t++) {
    assertErrors.length = 0; assertWarns.length = 0;
    S.State.level = repLevel; S.State.recentDifficulties = [];

    const t0 = Date.now();
    const ok  = S._build100PackedLevelEdge(true);
    times.push(Date.now() - t0);

    if (!ok) { solvFail++; fallback++; continue; }

    // Verify the generated size is a valid size for the level (no hard fallback to 10×12).
    // The generator picks randomly from the level's pool, so the exact size may differ
    // from the iterated one — but it must be a member of getSizesForLevel(repLevel).
    const validPool = S.getSizesForLevel(repLevel);
    const sizeOk = validPool.some(sz => sz.rows === S.State.rootRows && sz.cols === S.State.rootCols);
    if (!sizeOk) fallback++;

    // Solvability (Rule 14 — post-build cross-check)
    if (!S.rcBoardSolvable(S.State.paths, { nodeOwner: S.State.nodeOwner, rows: S.State.gridRows, cols: S.State.gridCols })) {
      solvFail++;
    }

    // Full RULEBOOK validation — all 14 rules on the committed board.
    // validateRulebook already ran inside _build100PackedLevelEdge as a gate;
    // this is an independent harness-level cross-check.
    const rbGraph = { nodeOwner: S.State.nodeOwner, rows: S.State.gridRows, cols: S.State.gridCols };
    if (!S.validateRulebook(S.State.paths, rbGraph)) rulebookFail++;

    const used  = S.State.paths.reduce((s, p) => s + p.nodes.length, 0);
    const total = (S.State.gridRows + 1) * (S.State.gridCols + 1);
    covs.push(Math.round(used / total * 100));
    paths.push(S.State.paths.length);

    const tier = S.State.boardDifficulty;
    tierCount[tier] = (tierCount[tier] || 0) + 1;

    // Count [Assert] geometry/owner errors from generation (should always be 0).
    // [Rulebook] hard-rule failures on the FINAL board are tracked via rulebookFail
    // above; intermediate board rejections inside the loop are expected and not failures.
    assertErr  += assertErrors.filter(e => e.includes('[Assert]')).length;
    assertWarn += assertWarns.filter(w => w.includes('[Assert]')).length;

    totalBoards++;
  }

  totalSolvFail     += solvFail;
  totalAssertErr    += assertErr;
  totalAssertWarn   += assertWarn;
  totalFallback     += fallback;
  totalRulebookFail += rulebookFail;

  const avg  = a => a.length ? Math.round(a.reduce((s,v)=>s+v,0)/a.length) : 0;
  const minC = covs.length ? Math.min(...covs) : 0;
  const maxC = covs.length ? Math.max(...covs) : 0;
  const tierStr = TIERS.map(t => t.slice(0,2) + ':' + (tierCount[t]||0)).join(' ');
  const status  = solvFail===0 && assertErr===0 && fallback===0 && rulebookFail===0 ? '✓' : '✗';

  const row = {
    key, repLevel, solvFail, assertErr, assertWarn, fallback, rulebookFail,
    avgCov: avg(covs), minCov: minC, maxCov: maxC,
    avgPaths: avg(paths), avgMs: avg(times), tierCount
  };
  allRows.push(row);

  console.log(
    `${status} ${key.padEnd(8)} L${String(repLevel).padEnd(4)} ` +
    `${(TRIALS-solvFail)+'/'+TRIALS} `.padEnd(7) +
    `${avg(covs)}%(${minC}-${maxC})`.padEnd(11) +
    `~${avg(paths)} `.padEnd(8) +
    `${avg(times)}ms `.padEnd(7) +
    tierStr
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('='.repeat(72));
console.log(`Total boards: ${totalBoards} / ${unique.size * TRIALS}`);
console.log(`Solvability failures: ${totalSolvFail}`);
console.log(`Assert errors (diagonal/owner/geometry): ${totalAssertErr}`);
console.log(`Assert warnings (coverage floor): ${totalAssertWarn}`);
console.log(`Rulebook failures (all 14 rules): ${totalRulebookFail}`);
console.log(`Silent size-fallbacks: ${totalFallback}`);

const allPassed = totalSolvFail === 0 && totalAssertErr === 0 && totalFallback === 0 && totalRulebookFail === 0;
console.log('\n' + (allPassed ? '✅ ALL CHECKS PASSED' : '❌ FAILURES DETECTED'));
