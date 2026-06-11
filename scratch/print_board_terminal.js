// =============================================================================
// scratch/print_board_terminal.js — Visualizes a generated board in the terminal
// =============================================================================

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const JS = p => path.join(__dirname, '..', 'js', p);
const read = p => fs.readFileSync(JS(p), 'utf8');

const sandbox = {
  console: {
    log: (...a) => console.log(...a),
    info: (...a) => console.info(...a),
    warn: () => { },
    error: () => { },
  },
  Math, Array, Object, Number, String, Boolean, JSON,
  Int8Array, Uint8Array, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
  Set, Map, WeakMap, WeakSet, Promise, Symbol,
  Infinity, NaN, undefined,
  Date,
  setTimeout: () => { },
  clearTimeout: () => { },
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
  var oracle  = new SolvabilityOracle();
  var builder = new RCBuilder(oracle);
  var diff    = new DifficultyEngine();
  var val     = new Validator(oracle);
  var gen     = new Generator(builder, diff, val);
`, sandbox);

// Generate a 12x12 normal difficulty board (level 15)
const rows = 12;
const cols = 12;
const level = 15;

sandbox._rows = rows;
sandbox._cols = cols;
sandbox._level = level;

console.log(`Generating a ${rows}x${cols} board for Level ${level}...`);
const result = vm.runInContext(`gen.build(_rows, _cols, _level, 3)`, sandbox);

if (!result) {
  console.log("❌ Board generation failed.");
  process.exit(1);
}

const { grid, paths, difficulty, coverage } = result;

console.log("\nBoard generated successfully!");
console.log(`Difficulty Tier: ${difficulty}`);
console.log(`Grid Coverage  : ${coverage}%`);
console.log(`Total Paths    : ${paths.length}`);
console.log(`Motif Palette  : [${Object.keys(result.blueprint.config.motifWeights).filter(k => result.blueprint.config.motifWeights[k] > 0).join(', ')}]`);
console.log("=".repeat(50));

// ANSI escape colors for path bodies
const colors = [
  '\x1b[38;5;203m',  // Redish
  '\x1b[38;5;82m',   // Greenish
  '\x1b[38;5;226m',  // Yellowish
  '\x1b[38;5;75m',   // Bluish
  '\x1b[38;5;201m',  // Magenta
  '\x1b[38;5;51m',   // Cyan
  '\x1b[38;5;208m',  // Orange
  '\x1b[38;5;135m',  // Purple
  '\x1b[38;5;197m',  // Pink
  '\x1b[38;5;48m',   // Spring Green
  '\x1b[38;5;39m',   // Sky Blue
];
const resetColor = '\x1b[0m';
const greyColor = '\x1b[38;5;242m';

// Helper to determine arrow glyph
function getArrowGlyph(heading) {
  if (heading === 'UP') return '▲';
  if (heading === 'DOWN') return '▼';
  if (heading === 'LEFT') return '◀';
  return '▶';
}

function getPathChar(id) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return chars[id % chars.length];
}

// Build 2D display grid
const display = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(null));

// Fill display grid with path nodes
paths.forEach((p, pIdx) => {
  const color = colors[pIdx % colors.length];
  p.nodes.forEach((n, nIdx) => {
    const isHead = nIdx === p.nodes.length - 1;
    const pChar = getPathChar(p.id);
    const glyph = isHead ? getArrowGlyph(p.heading) : '●';
    display[n.r][n.c] = {
      id: p.id,
      color,
      char: pChar + glyph,
      isHead
    };
  });
});

// Print the grid
console.log("  " + Array.from({ length: cols + 1 }, (_, c) => String(c).padEnd(3)).join(""));
for (let r = 0; r <= rows; r++) {
  let line = String(r).padStart(2) + " ";
  for (let c = 0; c <= cols; c++) {
    const cell = display[r][c];
    if (cell === null) {
      // Check if coordinate is masked out
      const maskVal = grid.mask ? grid.mask[r * (cols + 1) + c] : 1;
      if (maskVal === 0) {
        line += "   "; // Masked out
      } else {
        line += `${greyColor}·  ${resetColor}`; // Empty active cell
      }
    } else {
      // Print node with path color
      line += `${cell.color}${cell.char} ${resetColor}`;
    }
  }
  console.log(line);
}
console.log("=".repeat(50));
console.log("Key: ● = Path Segment  |  ▲/▼/◀/▶ = Arrow Head (Points in movement direction)");
console.log("Each colored sequence represents a distinct puzzle path.");
console.log("=".repeat(50));
console.log("\nActual Path Sequences (First 10 paths):");
paths.slice(0, 10).forEach((p, idx) => {
  const color = colors[idx % colors.length];
  const nodeStr = p.nodes.map(n => `(${n.r},${n.c})`).join(" ➔ ");
  console.log(`${color}Path ${p.id.toString().padStart(2)} [${p.heading.padEnd(5)}] (length ${p.nodes.length.toString().padStart(2)}): ${nodeStr}${resetColor}`);
});
