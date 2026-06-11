// Validates the new template-based heart mask end-to-end at level 20 (27×27).
// Run: node scratch/test-heart.js
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const JS = p => path.join(__dirname, '..', 'js', p);

const sandbox = {
  console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  Math, Array, Object, Number, String, Boolean, JSON, Int32Array, Uint8Array,
  Set, Map, Infinity, NaN, undefined, Date,
  setTimeout: () => {}, clearTimeout: () => {}, performance: { now: () => Date.now() },
};
vm.createContext(sandbox);
const FILES = [
  'Grid.js', 'Path.js', 'SolvabilityOracle.js', 'ZoneMap.js', 'RCBuilder.js',
  'DifficultyEngine.js', 'Validator.js', 'GridShape.js', 'BoardBlueprint.js',
  'PipelineConfig.js', 'RegionLayout.js', 'RegionConnectivity.js',
  'TopologyGenerator.js', 'MotifAssigner.js', 'MotifSkeletonGenerator.js',
  'RegionNodeGraphBuilder.js', 'GlobalNodeGraphBuilder.js', 'PathRouter.js',
  'PathInteractionDetector.js', 'DependencyGraphBuilder.js',
  'SolveOrderPlanner.js', 'BoardRepairer.js', 'Generator.js',
];
for (const f of FILES) vm.runInContext(fs.readFileSync(JS(f), 'utf8'), sandbox);

vm.runInContext(`
  var oracle = new SolvabilityOracle();
  var gen = new Generator(new RCBuilder(oracle), new DifficultyEngine(oracle), new Validator(oracle));
`, sandbox);

for (let t = 0; t < 3; t++) {
  const b = vm.runInContext('gen.build(27, 27, 20, 2)', sandbox);
  if (!b) { console.log('GEN FAIL'); continue; }
  sandbox._b = b;
  const solvable = vm.runInContext('oracle.isBoardSolvable(_b.paths, _b.grid)', sandbox);
  const fb = vm.runInContext('oracle.measureBranching(_b.paths, _b.grid)', sandbox);
  let outside = 0;
  const W = b.grid.cols + 1;
  for (const p of b.paths)
    for (const n of p.nodes)
      if (b.mask && b.mask[n.r * W + n.c] !== 1) outside++;
  console.log(
    `paths=${b.paths.length} cov=${b.coverage}% solvable=${solvable}` +
    ` branch=${fb.avg.toFixed(2)} nodesOutsideMask=${outside}`
  );
}

// ASCII render of the final board ownership inside the heart
const b = vm.runInContext('gen.build(27, 27, 20, 2)', sandbox);
if (b) {
  const W = b.grid.cols + 1;
  let out = '';
  for (let r = 0; r <= b.grid.rows; r++) {
    let line = '';
    for (let c = 0; c <= W - 1; c++) {
      if (b.mask && b.mask[r * W + c] !== 1) line += ' ';
      else line += b.grid.nodeOwner[r * W + c] >= 0 ? '#' : '.';
    }
    out += line + '\n';
  }
  console.log(out);
}
