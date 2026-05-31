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
const veBaseline = []; // visual entropy baseline per size

console.log('RV-5 Regression Harness — every size in getSizesForLevel');
console.log('='.repeat(72));
console.log(`${'Size'.padEnd(8)} ${'Level'.padEnd(6)} ${'Solv'.padEnd(7)} ${'Cov%'.padEnd(10)} ${'Paths'.padEnd(8)} ${'ms/bd'.padEnd(7)} ${'VF%'.padEnd(9)} ${'Tiers'}`);
console.log('-'.repeat(72));

for (const [key, { rows, cols, repLevel }] of unique) {
  let solvFail = 0, assertErr = 0, assertWarn = 0, fallback = 0, rulebookFail = 0;
  let visualFilterPass = 0; // boards that pass boardPassesVisualFilter
  const covs = [], paths = [], times = [];
  const tierCount = {};
  const veAccum = { straightness: 0, dirEntropy: 0, turnClustering: 0, densityVariance: 0 };
  let veCount = 0;

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

    // VT-1: Visual entropy metrics (measurement only — no fail conditions).
    const ve = S.computeVisualEntropy(S.State.paths, rbGraph);
    veAccum.straightness    += ve.straightness;
    veAccum.dirEntropy      += ve.dirEntropy;
    veAccum.turnClustering  += ve.turnClustering;
    veAccum.densityVariance += ve.densityVariance;
    veCount++;

    // VT-2: Visual filter pass rate (independent harness-level check).
    const vfResult = S.boardPassesVisualFilter(S.State.paths, rbGraph);
    if (vfResult.pass) visualFilterPass++;

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

  const veAvg = veCount > 0 ? {
    straightness:    veAccum.straightness    / veCount,
    dirEntropy:      veAccum.dirEntropy      / veCount,
    turnClustering:  veAccum.turnClustering  / veCount,
    densityVariance: veAccum.densityVariance / veCount,
  } : { straightness: 0, dirEntropy: 0, turnClustering: 0, densityVariance: 0 };

  const filterRate = veCount > 0 ? Math.round(visualFilterPass / veCount * 100) : 0;

  const row = {
    key, repLevel, solvFail, assertErr, assertWarn, fallback, rulebookFail,
    avgCov: avg(covs), minCov: minC, maxCov: maxC,
    avgPaths: avg(paths), avgMs: avg(times), tierCount, veAvg, filterRate
  };
  allRows.push(row);
  veBaseline.push({ key, repLevel, filterRate, ...veAvg });

  console.log(
    `${status} ${key.padEnd(8)} L${String(repLevel).padEnd(4)} ` +
    `${(TRIALS-solvFail)+'/'+TRIALS} `.padEnd(7) +
    `${avg(covs)}%(${minC}-${maxC})`.padEnd(11) +
    `~${avg(paths)} `.padEnd(8) +
    `${avg(times)}ms `.padEnd(7) +
    `vf:${filterRate}% `.padEnd(9) +
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

// ── VT-1 Baseline: Visual Entropy Metrics ────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log('VT-1 Visual Entropy Baseline (measurement only — no fail conditions)');
console.log('='.repeat(72));
console.log(
  `${'Size'.padEnd(8)} ${'Filt%'.padEnd(7)} ${'Straight'.padEnd(10)} ${'DirEntropy'.padEnd(12)} ${'TurnClust'.padEnd(11)} ${'DensVar'}`
);
console.log('-'.repeat(72));
for (const v of veBaseline) {
  console.log(
    `${v.key.padEnd(8)} ` +
    `${String(v.filterRate+'%').padEnd(7)} ` +
    `${v.straightness.toFixed(2).padEnd(10)} ` +
    `${v.dirEntropy.toFixed(3).padEnd(12)} ` +
    `${v.turnClustering.toFixed(3).padEnd(11)} ` +
    `${v.densityVariance.toFixed(4)}`
  );
}
console.log('-'.repeat(72));
console.log('  Straightness : avg nodes per straight run   (target after VT-5: < 4.0)');
console.log('  DirEntropy   : heading distribution entropy (target: ~2.0 bits max)');
console.log('  TurnClust    : turn-node neighbourhood density (target after VT-6: > 0.3)');
console.log('  DensVar      : zone density variance          (target after VT-3: higher)');

// ── VT-4 Mutation Engine Test ────────────────────────────────────────────────
const VT4_TRIALS = 100;
let vt4Pass = 0, vt4Fail = 0, vt4NoOp = 0;

console.log('\n' + '='.repeat(72));
console.log(`VT-4 Mutation Engine Test — ${VT4_TRIALS} random 3×3 mutations at 16×12`);
console.log('='.repeat(72));

for (let t = 0; t < VT4_TRIALS; t++) {
  assertErrors.length = 0; assertWarns.length = 0;
  S.State.level = 31; S.State.recentDifficulties = [];
  S._build100PackedLevelEdge(true);
  if (!S.State.paths.length) { vt4Fail++; continue; }

  const rows = S.State.gridRows, cols = S.State.gridCols, W = cols + 1;
  // Pick random 3×3 node region (centre at least 1 node from each edge)
  const cr = 1 + ((Math.random() * (rows - 2)) | 0);
  const cc = 1 + ((Math.random() * (cols - 2)) | 0);
  const nodeSet = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      nodeSet.push({ r: cr + dr, c: cc + dc });

  const G = { nodeOwner: S.State.nodeOwner, rows, cols,
              hEdge: S.State.hEdge, vEdge: S.State.vEdge };

  const prevOwned = S.State.paths.reduce((s, p) => s + p.nodes.length, 0);
  const ok = S.mutateRegion(S.State.paths, G, nodeSet);
  const afterOwned = S.State.paths.reduce((s, p) => s + p.nodes.length, 0);
  if (prevOwned === afterOwned && ok) vt4NoOp++; // trivial no-op

  let fail = false, failReason = '';

  // 1. nodeOwner ↔ paths consistency
  for (const p of S.State.paths) {
    for (const { r, c } of p.nodes) {
      if (S.State.nodeOwner[r * W + c] !== p.id) { fail = true; failReason = 'owner mismatch'; break; }
    }
    if (fail) break;
  }

  // 2. Solvability (Rule 14)
  if (!fail && !S.rcBoardSolvable(S.State.paths, G))
    { fail = true; failReason = 'unsolvable'; }

  // 3. Rule 8: no path with fewer than 3 nodes
  if (!fail && S.State.paths.some(p => p.nodes.length < 3))
    { fail = true; failReason = 'rule8 violation'; }

  if (fail) {
    vt4Fail++;
    console.log(`  FAIL t${t}: ok=${ok} reason=${failReason} errors:${assertErrors.slice(0,1).join('')}`);
  } else {
    vt4Pass++;
  }
}

console.log(`Result: ${vt4Pass} pass / ${vt4Fail} fail / ${vt4NoOp} no-op (of ${VT4_TRIALS} trials)`);
const vt4AllPassed = vt4Fail === 0;
console.log(vt4AllPassed ? '✅ VT-4 ALL MUTATION TESTS PASSED' : `❌ VT-4 FAILURES: ${vt4Fail}`);
