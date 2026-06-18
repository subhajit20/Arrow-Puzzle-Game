# VECTO — Colossal Mosaic Edition

> A minimalist logic puzzle game. Tap an arrow, watch it slide free. Clear the entire board to win.

---

## Screenshots

<table>
  <tr>
    <td><img src="game snaps/Puzzle 1.png" width="180"/></td>
    <td><img src="game snaps/Puzzle 2.png" width="180"/></td>
    <td><img src="game snaps/Puzzle 3.png" width="180"/></td>
  </tr>
  <tr>
    <td><img src="game snaps/Puzzle 4.png" width="180"/></td>
    <td><img src="game snaps/Puzzle 5.png" width="180"/></td>
    <td><img src="game snaps/Puzzle 6.png" width="180"/></td>
  </tr>
  <tr>
    <td><img src="game snaps/Puzzle 7.png" width="180"/></td>
  </tr>
</table>

---

## What is VECTO?

VECTO is a pure logic puzzle game played on a grid of directional arrows. Every arrow points in one direction — Up, Down, Left, or Right. Your goal: **tap each arrow so it slides off the board without crashing into another one.**

The catch? Arrows block each other. Tap them in the wrong order and you'll cause a collision — lose all three lives and the level resets. Find the right sequence and the whole board unravels in a satisfying chain.

---

## How to Play

### Objective
Clear every arrow from the board. An arrow is cleared when it slides all the way off the grid edge. Win the level when the board is completely empty.

### Rules
1. **Tap any arrow** — it slides in the direction it points
2. **Arrows travel in a straight line** until they exit the board edge
3. **A sliding arrow that hits a stationary arrow** — crash! You lose one ❤️
4. **Two moving arrows** pass through each other harmlessly
5. **Lose all 3 lives** — level resets (your level number is kept)

### Controls

**Mobile (Touch)**

| Gesture | Action |
|---|---|
| Tap an arrow | Launch it |
| Drag (one finger) | Pan the camera |
| Pinch (two fingers) | Zoom in / out |

**Desktop (Mouse)**

| Action | Result |
|---|---|
| Click an arrow | Launch it |
| Click and drag | Pan the camera |
| Scroll wheel | Zoom in / out |
| Hover | Highlight arrow |

---

## Game Modes

### ⚡ Level Play
The main campaign. Start at Level 1 and progress through increasingly complex boards. Your level and score save automatically — quit and return anytime from where you left off.

### ☀️ Daily Puzzle
One unique puzzle per day, the same for every player worldwide. Separate score tracking. Replayable as many times as you like. A fresh puzzle every calendar day.

---

## Board Shapes

Every 10th level is a **milestone level** — a special shaped board with a mask. Shapes rotate through:

| Level | Shape |
|---|---|
| 10, 80… | Circle |
| 20, 90… | Heart |
| 30, 100… | Star |
| 40, 110… | Donut |
| 50, 120… | Octagon |
| 60, 130… | Skull |
| 70, 140… | Shield |
| 80, 190… | Leaf |
| 90, 200… | Trophy |
| 100, 210… | Crown |
| 110, 220… | Badge |

Milestone levels use **square grids** (24×24 → 45×45) so shapes appear perfectly symmetrical. Post-level-100 milestone levels use 50×50 grids.

---

## Difficulty Tiers

Each board is evaluated and assigned a difficulty:

| Tier | Description |
|---|---|
| **EASY** | Many free paths, simple solve order |
| **NORMAL** | Some dependencies, moderate chains |
| **HARD** | Deep dependency chains, few free paths |
| **EXPERT** | Most paths require clearing others first |
| **TITAN** | Almost all paths have intentional blockers |

---

## Scoring

| Event | Points |
|---|---|
| Arrow cleared | +10 |
| Level complete (all cleared) | +100 bonus |

Score is cumulative across all levels and saved automatically.

---

## Tips & Strategy

1. **Start with edge arrows** — arrows pointing directly off the board are always safe first taps
2. **Think in chains** — clearing A often unblocks B which unblocks C
3. **Read the path** — the arrow shows which direction it will travel
4. **Two moving arrows never collide** — use this to clear blocked pairs simultaneously
5. **Retry is free** — no score penalty for retrying a level

---

## Running the Game

```
Open index.html in any modern browser
No installation · No account · No internet required
```

Works on Chrome, Firefox, Safari, Edge — desktop and mobile.

---

---

# Developer Documentation

## Architecture

VECTO uses a fully class-based JavaScript architecture with no framework dependencies.

```
js/
├── Grid.js              — Board lattice: node ownership + edge ownership
├── Path.js              — Single arrow path: nodes, heading, state, animation
├── SolvabilityOracle.js — Board solvability simulation (RC escape model)
├── ZoneMap.js           — Spatial zone layout (DENSE / OPEN / NEUTRAL)
├── RCBuilder.js         — Reverse Construction board generator
├── DifficultyEngine.js  — Tier selection + DAG complexity scoring
├── Validator.js         — Inline board invariant checks
├── Generator.js         — Full RC pipeline orchestration
├── GridShape.js         — Board shape masks (circle, heart, star, etc.)
├── Camera.js            — Zoom, pan, pixel metrics, entrance animation
├── Renderer.js          — Canvas 2D draw engine
├── AnimationEngine.js   — RAF loop, path animation, reveal, confetti
├── InputHandler.js      — Touch / mouse / scroll input
├── AudioEngine.js       — Web Audio API procedural synthesis
├── GameController.js    — Game state machine + level lifecycle
├── Persistence.js       — localStorage V5 save / load
├── BoardLoader.js       — Pre-built board loading from boards-data.js
├── DailyPuzzle.js       — Date-seeded daily puzzle lifecycle
└── main.js              — Entry point: instantiate all classes, wire deps
```

---

## Generation Pipeline

Board generation uses **Reverse Construction (RC)** — boards are built backwards so solvability is guaranteed by construction, never by search.

```
buildEdgeGraph
  ↓
rcBuildChain       — forced dependency backbone (chainDepth paths)
  ↓
fillA              — main fill: winding self-avoiding walks (zone-aware)
  ↓
fillB × 2          — gap fill: 4–9 node pieces in empty pockets
  ↓
fillC × 2          — tail-append: isolated nodes → adjacent tails
  ↓
evaluateDifficulty — DAG stats: maxDepth, blockerRatio, freeRatio
  ↓
fillD              — oracle gap fill: convergence + reversal + force-fill
  ↓
Validator.checkBoard — coverage ≥ 90% + solvability confirmation
```

### Key properties
- **Solvability guaranteed by construction** — no search needed
- **headSelfClear** — every path's head ray is free of its own body
- **Topology-aware Phase A** — intentional blockers via `topoWeight` parameter
- **Coverage ≥ 90%** — validator hard-fails below this threshold
- **Path length: 2–15 nodes** — Phase D can produce 2-node last-resort pieces

---

## Solvability Model

`SolvabilityOracle` uses the **RC escape model**:

- A path can escape if its head ray reaches the board edge
- Own body nodes and already-cleared paths are transparent
- Foreign active paths block the ray
- `isBoardSolvable`: greedy forward simulation — all paths must eventually clear

---

## Difficulty System

```
score = maxDepth × 3 + blockerRatio × 5.5 − freeRatio × 8

score < 6   → EASY
score < 13  → NORMAL
score < 22  → HARD
score < 29  → EXPERT
score ≥ 29  → TITAN
```

**chainDepth by tier:**
```
EASY:   2    NORMAL:  4
HARD:   8    EXPERT: 13    TITAN: 18
```

---

## Persistence

Save format: **V5** (`localStorage` key: `vecto_colossal_mosaic_save_v5`)

Saved fields: `gridRows`, `gridCols`, `level`, `score`, `lives`, `difficulty`, `recentDifficulties`, `hEdge[]`, `vEdge[]`, `paths[]` (with CLEARED state preserved).

`nodeOwner` is rebuilt from `paths.nodes` on load — not persisted.

**Dimension guard:** saves whose grid dimensions don't match `sizesForLevel(level)` are silently discarded.

---

## Grid Sizes

```js
sizesForLevel(level) {
    if (level % 10 === 0)  // milestone → square grid
        return [{ rows: Math.min(45, 24 + (level/10-1)*3), cols: same }]

    if (level <= 3)   return [{ rows: 10, cols:  6 }]
    if (level <= 7)   return [{ rows: 14, cols:  8 }, { rows: 12, cols:  8 }]
    if (level <= 12)  return [{ rows: 18, cols: 10 }, { rows: 16, cols: 10 }]
    if (level <= 20)  return [{ rows: 24, cols: 14 }, { rows: 20, cols: 12 }]
    if (level <= 30)  return [{ rows: 30, cols: 18 }, { rows: 28, cols: 16 }]
    if (level <= 40)  return [{ rows: 36, cols: 22 }, { rows: 32, cols: 20 }]
    if (level <= 55)  return [{ rows: 42, cols: 26 }, { rows: 40, cols: 24 }]
    if (level <= 70)  return [{ rows: 50, cols: 30 }, { rows: 48, cols: 28 }]
    if (level <= 85)  return [{ rows: 56, cols: 34 }, { rows: 52, cols: 32 }]
    return [{ rows: 60, cols: 38 }, { rows: 60, cols: 36 }, { rows: 58, cols: 40 }]
}
```

---

## Adding a New Shape Mask

All shape masks live in `js/GridShape.js` as static methods:

```js
static myShape(R, C) {
    const W    = C + 1;
    const mask = new Uint8Array((R + 1) * W);
    for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
        const x = (c - C * 0.5) / (C * 0.48);
        const y = (r - R * 0.5) / (R * 0.48);
        mask[r * W + c] = /* your shape formula */ ? 1 : 0;
    }
    return mask;
}
```

Then add it to both `forLevel()` and `forDay()` arrays in `GridShape.js`.

**Requirements:**
- Active area ≥ 30% of total nodes (or `selectMask` falls back to rectangle)
- All active nodes must be connected (BFS validation in `GridShape.validate`)
- Use square grids (`rows === cols`) for geometric shapes to avoid ellipse distortion

---

## Sandbox

Open `sandbox.html` in a browser for the generation testing environment:

- Generate boards at any difficulty tier
- Export boards to `boards-data.js` format
- See generation stats: paths, coverage, difficulty, generation time

---

## Running Tests

```bash
node test-regression.js    # 840 boards across all 27 grid sizes
node test-persistence.js   # 13 persistence scenarios
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make changes — keep commits focused and descriptive
4. Test in both `index.html` (game) and `sandbox.html` (generation)
5. Run regression tests: `node test-regression.js`
6. Open a pull request against `master`

### Code style
- Class-based JavaScript, no framework
- No global state — each class owns its data
- Comments only when the WHY is non-obvious
- New shapes → `GridShape.js` only
- New difficulty knobs → `DifficultyEngine.js` only

---

## License

MIT — see `LICENSE` for details.
