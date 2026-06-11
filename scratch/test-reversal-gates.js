// Diagnoses why reduceBranching reversals fail: self-clear vs still-free vs
// solvability, measured on the initial free set of large generated boards.
// Run: node scratch/test-reversal-gates.js
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const JS = p => path.join(__dirname, '..', 'js', p);
const read = p => fs.readFileSync(JS(p), 'utf8');

const sandbox = {
  console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  Math, Array, Object, Number, String, Boolean, JSON,
  Int32Array, Uint8Array, Set, Map, Infinity, NaN, undefined, Date,
  setTimeout: () => {}, clearTimeout: () => {},
  performance: { now: () => Date.now() },
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
for (const f of FILES) vm.runInContext(read(f), sandbox);

vm.runInContext(`
  var oracle  = new SolvabilityOracle();
  var builder = new RCBuilder(oracle);
  var diff    = new DifficultyEngine(oracle);
  var val     = new Validator(oracle);
  var gen     = new Generator(builder, diff, val);

  function diagnose(rows, cols, level) {
    const result = gen.build(rows, cols, level, 2);
    if (!result) return null;
    const { paths, grid } = result;
    const removed = new Set();
    const free = paths.filter(p => oracle.canEscape(p, removed, grid));
    const stats = { paths: paths.length, free: free.length,
                    selfClearFail: 0, stillFree: 0, unsolvable: 0, ok: 0 };
    for (const p of free) {
      if (p.nodes.length < 2) continue;
      const savedNodes = p.nodes.slice(), savedHeading = p.heading;
      p.nodes.reverse();
      const nh = p.nodes[p.nodes.length-1], np = p.nodes[p.nodes.length-2];
      p.heading = Path.deltaToHeading(nh.r - np.r, nh.c - np.c);
      if (!oracle.headSelfClear(p, grid)) stats.selfClearFail++;
      else if (oracle.canEscape(p, removed, grid)) stats.stillFree++;
      else if (!oracle.isBoardSolvable(paths, grid)) stats.unsolvable++;
      else stats.ok++;
      p.nodes = savedNodes; p.heading = savedHeading;
    }
    return stats;
  }
`, sandbox);

for (const [r, c, l] of [[42, 26, 50], [42, 26, 50], [50, 30, 65]]) {
  const s = vm.runInContext(`diagnose(${r}, ${c}, ${l})`, sandbox);
  console.log(`${r}x${c} L${l}:`, JSON.stringify(s));
}
