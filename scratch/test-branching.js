// =============================================================================
// scratch/test-branching.js — UQ verification: branching factor per tier
//
// Generates boards at representative sizes/levels and reports the measured
// final branching factor (avg free pieces per solve step), decoy count, and
// how often the tier target was hit.
// Run: node scratch/test-branching.js
// =============================================================================

'use strict';
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');
const JS   = p => path.join(__dirname, '..', 'js', p);
const read = p => fs.readFileSync(JS(p), 'utf8');

const sandbox = {
  console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  Math, Array, Object, Number, String, Boolean, JSON,
  Int8Array, Uint8Array, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
  Set, Map, WeakMap, WeakSet, Promise, Symbol,
  Infinity, NaN, undefined, Date,
  setTimeout: () => {}, clearTimeout: () => {},
  performance: { now: () => Date.now() },
};
vm.createContext(sandbox);

const FILES = [
  'Grid.js', 'Path.js', 'SolvabilityOracle.js',
  'ZoneMap.js', 'RCBuilder.js', 'DifficultyEngine.js',
  'Validator.js', 'GridShape.js',
  'BoardBlueprint.js', 'PipelineConfig.js',
  'RegionLayout.js', 'RegionConnectivity.js',
  'TopologyGenerator.js', 'MotifAssigner.js',
  'MotifSkeletonGenerator.js', 'RegionNodeGraphBuilder.js', 'GlobalNodeGraphBuilder.js',
  'PathRouter.js', 'PathInteractionDetector.js',
  'DependencyGraphBuilder.js', 'SolveOrderPlanner.js',
  'BoardRepairer.js', 'Generator.js',
];
for (const f of FILES) vm.runInContext(read(f), sandbox);

vm.runInContext(`
  var oracle  = new SolvabilityOracle();
  var builder = new RCBuilder(oracle);
  var diff    = new DifficultyEngine(oracle);
  var val     = new Validator(oracle);
  var gen     = new Generator(builder, diff, val);
`, sandbox);

// Representative (rows, cols, level) per band — levels chosen so the target
// tier distribution spans EASY → EXPERT.
const CASES = [
  { rows: 12, cols: 8,  level: 3,  trials: 6 },
  { rows: 18, cols: 12, level: 12, trials: 6 },
  { rows: 30, cols: 18, level: 28, trials: 5 },
  { rows: 42, cols: 26, level: 50, trials: 4 },
  { rows: 50, cols: 30, level: 65, trials: 3 },
];

console.log('UQ branching verification');
console.log('='.repeat(95));
console.log(
  'size      lvl  tier(target)      paths  branchAvg  target≤   hit  decoys  initFree  ms'
);
console.log('-'.repeat(95));

const tierStats = {};

for (const { rows, cols, level, trials } of CASES) {
  for (let t = 0; t < trials; t++) {
    sandbox._r = rows; sandbox._c = cols; sandbox._l = level;
    const t0 = Date.now();
    const result = vm.runInContext('gen.build(_r, _c, _l, 2)', sandbox);
    const ms = Date.now() - t0;
    if (!result) { console.log(`${rows}x${cols} L${level}: GEN FAIL`); continue; }

    sandbox._paths = result.paths; sandbox._grid = result.grid;
    const fb = vm.runInContext('oracle.measureBranching(_paths, _grid)', sandbox);
    const decoys = vm.runInContext('oracle.countDecoys(_paths, _grid)', sandbox);
    const solvable = vm.runInContext('oracle.isBoardSolvable(_paths, _grid)', sandbox);

    // initial free pieces
    const initFree = vm.runInContext(
      '_paths.filter(p => oracle.canEscape(p, new Set(), _grid)).length', sandbox);

    const tier = result.difficulty;
    const target = vm.runInContext(`diff.branchTargetForTier('${tier}', _paths.length) + diff.branchTolForTier('${tier}')`, sandbox);
    const hit = fb.avg <= target;

    if (!tierStats[tier]) tierStats[tier] = { n: 0, sum: 0, hits: 0 };
    tierStats[tier].n++; tierStats[tier].sum += fb.avg;
    if (hit) tierStats[tier].hits++;

    console.log(
      `${(rows + 'x' + cols).padEnd(9)} ${String(level).padEnd(4)}` +
      `${tier.padEnd(17)} ${String(result.paths.length).padEnd(6)}` +
      ` ${fb.avg.toFixed(2).padEnd(10)} ${target.toFixed(1).padEnd(9)}` +
      ` ${(hit ? 'Y' : 'n').padEnd(4)} ${String(decoys).padEnd(7)}` +
      ` ${String(initFree).padEnd(9)} ${ms}${solvable ? '' : '  !!UNSOLVABLE'}`
    );
  }
}

console.log('='.repeat(95));
for (const [tier, s] of Object.entries(tierStats)) {
  console.log(
    `${tier.padEnd(8)} boards: ${s.n}  avg branch: ${(s.sum / s.n).toFixed(2)}` +
    `  target hit: ${s.hits}/${s.n}`
  );
}
