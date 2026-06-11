const fs   = require('fs');
const vm   = require('vm');
const path = require('path');
const JS   = p => path.join(__dirname, '..', 'js', p);
const read = p => fs.readFileSync(JS(p), 'utf8');

const sandbox = {
  console: console,
  Math, Array, Object, Number, String, Boolean, JSON,
  Int8Array, Uint8Array, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
  Set, Map, WeakMap, WeakSet, Promise, Symbol,
  Infinity, NaN, undefined,
  Date,
  setTimeout: () => {},
  clearTimeout: () => {},
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
for (const f of FILES) {
  vm.runInContext(read(f), sandbox);
}

vm.runInContext(`
  const oracle  = new SolvabilityOracle();
  const builder = new RCBuilder(oracle);
  const diff    = new DifficultyEngine();
  const val     = new Validator(oracle);
  const gen     = new Generator(builder, diff, val);

  console.log("Running generator.build(24, 24, 20, 4, 'daily')...");
  try {
    const board = gen.build(24, 24, 20, 4, 'daily');
    console.log("SUCCESS! Board generated with paths:", board ? board.paths.length : null);
  } catch (e) {
    console.error("FAILED with error:", e);
  }
`, sandbox);
