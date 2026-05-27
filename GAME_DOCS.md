# Arrow Puzzle Game — Complete Technical Reference

> This document is the authoritative reference for the Arrow Puzzle Game codebase.
> Use it to understand architecture, trace bugs, and make targeted changes safely.

---

## Table of Contents

1. [How to Run](#1-how-to-run)
2. [File Structure](#2-file-structure)
3. [State Object — Every Field](#3-state-object--every-field)
4. [Path Data Model](#4-path-data-model)
5. [Grid Mask Encoding](#5-grid-mask-encoding)
6. [Board Generation Pipeline](#6-board-generation-pipeline)
7. [Animation & Rendering System](#7-animation--rendering-system)
8. [Collision Detection](#8-collision-detection)
9. [Score System](#9-score-system)
10. [Daily Puzzle System](#10-daily-puzzle-system)
11. [Input Handling](#11-input-handling)
12. [Camera System](#12-camera-system)
13. [Persistence (localStorage)](#13-persistence-localstorage)
14. [Audio Engine](#14-audio-engine)
15. [Topologies](#15-topologies)
16. [Difficulty & Sizing Presets](#16-difficulty--sizing-presets)
17. [Critical Invariants — Never Break These](#17-critical-invariants--never-break-these)
18. [Win / Fail Lifecycle](#18-win--fail-lifecycle)
19. [Fixed Bugs Log](#19-fixed-bugs-log)
20. [Known Remaining Bugs](#20-known-remaining-bugs)
21. [Common Pitfalls for Future Changes](#21-common-pitfalls-for-future-changes)

---

## 1. How to Run

Open `index.html` directly in a browser. No build step, no server, no dependencies to install.
External CDN resources: Tailwind CSS and Google Fonts (loaded in `<head>`).

---

## 2. File Structure

```
Arrow-Game/
├── index.html          # Shell: DOM structure, inline styles, onclick wiring
├── js/
│   ├── state.js        # Global State object + canvas/ctx + SIZING_PRESETS
│   ├── audio.js        # AudioEngine — Web Audio API synthesis
│   ├── camera.js       # applyBoardTransform(), resetCamera(), resizeCanvas(), calculateMetrics()
│   ├── topologies.js   # TOPOLOGIES map, generateRandomGridDimensions(), getDifficultyLabel(), getTopologyForLevel()
│   ├── board-gen.js    # Full board generation pipeline (tryGenerateBoard, assignSmartHeadings,
│   │                   #   runUnjammingSolvabilityTweak, fixVisualSelfIntersections,
│   │                   #   isBoardFullySolvable, hasAnyDoubleSelfCollidingPath, build100PackedLevel)
│   ├── renderer.js     # updateDomUI(), drawEngine(), animationUpdateTick(), per-frame loop
│   ├── game-logic.js   # getPathOccupiedCells(), getUnblockedPaths(), checkVictoryConditionStates(),
│   │                   #   processFailurePenalty(), actions object (cycleMatrixSize, triggerNextLevel,
│   │                   #   retryCurrentLevel, skipLevel, useHint)
│   ├── input.js        # Touch and mouse event handlers, camera pan/pinch/zoom
│   ├── persistence.js  # Persistence object — localStorage save/load/clear
│   └── daily.js        # DailyPuzzle object, initDailySplash(), startDailyPuzzle(),
│                       #   startNormalGame(), exitDailyPuzzle(), showSplashScreen()
└── CLAUDE.md           # Project instructions for Claude
```

**Script load order in index.html** (matters — each file depends on the previous):
`state.js` → `audio.js` → `camera.js` → `topologies.js` → `board-gen.js` → `renderer.js` → `game-logic.js` → `input.js` → `persistence.js` → `daily.js`

---

## 3. State Object — Every Field

Defined in `state.js`. Single global mutable object. No encapsulation.

| Field | Type | Purpose |
|---|---|---|
| `gridSizePreset` | string | `"Auto"`, `"Standard"`, `"Grand"`, `"Colossal"`, `"Titan"`, `"Cosmic"` |
| `level` | number | Current level number (1-based). Drives grid size in Auto mode. |
| `score` | number | Regular game cumulative score. **Never modified during daily mode.** |
| `dailyScore` | number | Daily puzzle score — reset to 0 at each daily session start, discarded on exit. |
| `lives` | number | Current lives remaining (starts at 3). |
| `gridRows` | number | Active board row count. |
| `gridCols` | number | Active board column count. |
| `gridSize` | number | `Math.max(gridRows, gridCols)` — used for scaling/animation thresholds. |
| `gridMask` | `number[][]` | 2D array encoding playable/void/wall per cell. See §5. |
| `shapeName` | string | Display name of current topology (e.g. `"Corner Castle"`). |
| `paths` | `Path[]` | All paths on the board. See §4. |
| `particles` | object[] | Win-explosion confetti particles. |
| `selectedPath` | Path\|null | Path under mouse cursor (desktop hover highlight). |
| `isWinState` | boolean | True after all paths cleared — locks input. |
| `isFailState` | boolean | True after lives hit 0 — locks input. |
| `animatingCount` | number | Paths currently MOVING or CRASHING this frame. Reset to 0 each frame. |
| `cellSize` | number | Pixel size of one grid cell (computed by `calculateMetrics`). |
| `offsetX` | number | Canvas pixel offset to horizontally center the grid. |
| `offsetY` | number | Canvas pixel offset to vertically center the grid. |
| `hintPathId` | number\|null | ID of path to highlight as hint. Cleared on retry/next level/exit. |
| `levelStartScore` | number | Score snapshot at level start — used to reset on retry. |
| `dailyPuzzleMode` | boolean | True while playing daily puzzle. Gates score routing and persistence. |
| `dailyPuzzleScoreAtStart` | number | Legacy field — no longer used in logic, kept for compatibility. |
| `cssZoom` | number | Current camera zoom level. Range `1.0–6.0`. |
| `matE` | number | CSS matrix translate X (pan offset in pixels). |
| `matF` | number | CSS matrix translate Y (pan offset in pixels). |
| `boardDifficulty` | string | Current evaluated difficulty tier of the generated board (`"EASY"`, `"NORMAL"`, `"HARD"`, `"EXPERT"`, `"TITAN"`). |
| `recentDifficulties` | string[] | A sliding log history (max length 5) of recent board difficulties used for pacing overrides. |

---

## 4. Path Data Model

Each element of `State.paths`:

```js
{
  id: number,              // Unique integer ≥ 1. Assigned sequentially during generation.
  points: [{r, c}, ...],  // Ordered grid cells. LAST point is always the arrowhead (head).
  heading: "UP"|"DOWN"|"LEFT"|"RIGHT",  // Direction the arrowhead moves when tapped.
  state: "IDLE"|"MOVING"|"CRASHING"|"CLEARED",
  animProgress: number,    // 0.0 at rest. Increments +0.26/frame when MOVING, -0.16/frame when CRASHING.
  crashFlashFrames: number,// Flash duration after crash (set to 8 on crash).
  originalPoints: [{r,c}] // Snapshot of points at the time of heading assignment (used internally).
}
```

**Key relationships:**
- `points[0]` = tail (the end that does NOT move).
- `points[points.length - 1]` = head (the arrowhead end — moves in `heading` direction).
- `heading` must always match the direction from `points[len-2]` → `points[len-1]`.
- `originalPoints` is set by `assignSmartHeadings` and `runUnjammingSolvabilityTweak`. It is written but not read elsewhere in the current code.

**State transitions:**
```
IDLE → MOVING (on tap)
MOVING → CLEARED (animProgress exceeds gridSize * 1.5)
MOVING → CRASHING (leading cell hits another IDLE path or wall)
CRASHING → IDLE (animProgress returns to 0 after crash animation)
```

---

## 5. Grid Mask Encoding

`State.gridMask[r][c]` values:

| Value | Meaning |
|---|---|
| `1` | Playable cell — must be covered by exactly one path |
| `0` | Void / unplayable — outside the topology shape |
| `-1` | Solid wall — blocks arrow movement (used by some topologies) |

**gridOwnership** (local variable in `tryGenerateBoard`, not in State):

| Value | Meaning |
|---|---|
| `-1` | Unassigned playable cell |
| `-2` | Masked / void (mirrors gridMask 0 and -1) |
| `-3` | Failed path start or temporarily freed cell |
| `≥ 1` | Cell assigned to path with that ID |

---

## 6. Board Generation Pipeline

Called via `build100PackedLevel(forceNewGeneration)`.

### Full sequence:

```
build100PackedLevel(true/false)
  │
  ├─ false + Persistence.loadState() succeeds → resetCamera(), resizeCanvas(), updateDomUI(), RETURN
  │
  ├─ Set gridRows/gridCols from generateRandomGridDimensions(preset, level)
  ├─ Set gridMask from getTopologyForLevel(level, rows, cols)
  ├─ resetCamera() + resizeCanvas()
  │
  └─ Retry loop (up to 20 attempts):
       tryGenerateBoard()
         ├─ Init gridOwnership from gridMask
         ├─ Greedy crawler: pick highest-neighbor-score unassigned cell as path start
         ├─ Grow path using one of: Spiral / Serpentine / Staircase / Standard style
         ├─ Gap-fill pass: attach orphaned cells to adjacent path endpoints
         ├─ Fallback steal: steal 2-cell segments when gap-fill fails
         └─ assignSmartHeadings(paths) → sets heading + reverses points if needed
       │
       runUnjammingSolvabilityTweak(paths)   ← up to 5 passes
         ├─ Greedily clear paths that can escape
         └─ For stuck paths: try flipping heading (only if !selfIntersect AND canEscapeOccupancy)
       │
       fixVisualSelfIntersections(paths)     ← post-unjammer visual cleanup
         └─ If arrowhead faces own body at dist=1, try flipping back if safe
       │
       hasAnyDoubleSelfCollidingPath() → reject if true
       isBoardFullySolvable()          → reject if false
       │
       Accept board → State.paths = validResult.paths
```

### `assignSmartHeadings` — Chevron Self-Collision Guard

For each path, evaluates both endpoints as potential arrowheads. Fires a forward ray from each and checks for self-intersection with the path body. Selection priority:

1. Prefer endpoint whose forward ray does NOT hit own body (`selfIntersect = false`)
2. If both self-intersect: prefer endpoint with **greater** `selfIntersectDist` (body further away)
3. Tie-breaks in order: not heading toward opposite endpoint → straight run-in → longer run-in → fewer adjacent body cells → fewer board cells in ray

### `isBoardFullySolvable` — Greedy simulation

Simulates clearing. In each pass, finds any path whose forward ray to the board edge is only blocked by its **own** cells (own cells are transparent to escape). Clears that path's cells from the occupancy grid and repeats. Returns `true` only if all paths cleared. This is the definitive solvability check.

> **Important:** Own cells are always transparent in escape checks. A path whose heading points into its own body at dist=1 still "can escape" in solvability terms — it slides through its own body to open space. This is intentional game physics.

---

## 7. Animation & Rendering System

**Entry point:** `animationUpdateTick()` in `renderer.js`, driven by `requestAnimationFrame`.

### Per-frame sequence:

```
animationUpdateTick()
  ├─ State.animatingCount = 0
  ├─ For each path:
  │   ├─ MOVING: animProgress += 0.26, check leading cell collision, check cleared
  │   └─ CRASHING: crashFlashFrames--, animProgress -= 0.16 → returns to IDLE at 0
  └─ drawEngine()
       ├─ clear canvas
       ├─ save ctx, apply camera transform (zoom + pan)
       ├─ Draw grid cells by mask value (playable=light, wall=dark, void=nothing)
       ├─ Draw grid lines and wall borders
       ├─ For each non-CLEARED path:
       │   ├─ Build fullTrack (pixel coords): path body + forward extension (gridSize+2 cells)
       │   ├─ IDLE: draw body only (fullTrack[0..len])
       │   ├─ MOVING/CRASHING: draw sliding window via getSubTrackPoints(dStart, dEnd)
       │   ├─ Draw dashed preview line (IDLE only): stops at solid wall or void cell
       │   └─ Draw 3D chevron arrowhead at head position
       ├─ Draw confetti particles
       └─ restore ctx
```

### `fullTrack` extension (renderer.js:197)

The `fullTrack` array extends beyond the path's last point by `gridSize + 2` cells in the heading direction. This allows the MOVING animation to slide the path body forward — the tail cell disappears as the head extends beyond the grid edge. These extension cells have no bounds check; they may go off-grid (intentional).

### Dashed preview line (renderer.js:231–258)

Drawn only for IDLE paths. Walks forward from the arrowhead cell-by-cell, stopping when:
- Off the grid boundary
- Cell is a solid wall (`gridMask === -1`)
- Cell is void (`gridMask !== 1`) ← **Bug 1 fix: changed from `!== -1` to `=== 1`**

### Chevron arrowhead

3D layered chevron drawn at the head cell center. Color changes: default dark navy, selected/hinted = blue, crashing = red.

---

## 8. Collision Detection

Two separate systems:

### During MOVING animation (renderer.js:301–319)

```js
let leadingGridR = Math.round(head.r + dr * p.animProgress);
let leadingGridC = Math.round(head.c + dc * p.animProgress);
```

Checks the **rounded leading grid cell** against:
- All **IDLE** paths' occupied cells via `getPathOccupiedCells(other)`
- Solid walls (`gridMask === -1`)
- MOVING paths are **skipped** (two moving paths pass through each other)

Collision → path transitions to CRASHING, `processFailurePenalty()` called.

### `getPathOccupiedCells(p)` (game-logic.js:1–29)

Returns the grid cells a path currently occupies, accounting for animation progress:
- CLEARED → empty array
- IDLE → `p.points` (all body cells)
- MOVING/CRASHING → sliding window: `startIdx = floor(animProgress)`, `endIdx = ceil((len-1) + animProgress)`

> **Note:** These two systems use different math (`Math.round` vs `Math.floor/ceil`). They are not in conflict — one finds the leading edge of the mover, the other computes the body of obstacles.

---

## 9. Score System

### Regular game

| Event | Points |
|---|---|
| Path cleared (slides off board) | +10 |
| All paths cleared (level win) | +100 |

- Score saved to `localStorage` via `Persistence.saveState()` on every path clear.
- On retry: `State.score` reset to `State.levelStartScore`.
- On next level: `State.levelStartScore` updated to current `State.score`.

### Daily puzzle

- `State.dailyScore` is a **fully independent counter** — starts at 0, never touches `State.score`.
- Same +10 per path, +100 for win, but go to `State.dailyScore`.
- HUD shows `State.dailyScore` while `State.dailyPuzzleMode === true`.
- On retry during daily: `State.dailyScore = 0`.
- On exit: `State.dailyScore = 0`, `State.score` is left **exactly as it was** before daily mode started.
- Best daily score saved to `localStorage` key `vecto_daily_puzzle_v1` with `{date, bestScore, attempts}`.
- `Persistence.saveState()` is a no-op during daily mode (`if (State.dailyPuzzleMode) return`).

---

## 10. Daily Puzzle System

### Storage keys

| Key | Contents |
|---|---|
| `vecto_colossal_mosaic_save_v2` | Regular game save (level, score, lives, grid, paths) |
| `vecto_daily_puzzle_v1` | `{date: "YYYY-MM-DD", bestScore: N, attempts: N}` — today only |

### Puzzle seed

`getDailyPuzzleSeed()` returns `YYYYMMDD` as an integer using **local time**. This is the seed for `mulberry32` (fast deterministic PRNG). Two players in the same timezone on the same calendar day get the same puzzle. Different timezones may get different puzzles.

### Lifecycle

```
showSplashScreen()         ← shown on game start or after exiting daily
  └─ initDailySplash()     ← reads DailyPuzzle.load() for best score display

startDailyPuzzle()
  ├─ State.dailyPuzzleMode = true
  ├─ State.dailyScore = 0
  ├─ Replace Math.random with seeded mulberry32 PRNG
  ├─ Force level=7, preset="Auto" (fixed difficulty for all players)
  ├─ build100PackedLevel(true) → generates deterministic puzzle
  └─ Restore Math.random, level, preset

exitDailyPuzzle()          ← called from daily result overlay "Exit" button
  ├─ State.dailyPuzzleMode = false
  ├─ State.dailyScore = 0
  └─ build100PackedLevel(false) → resumes regular game from save
```

### Daily mode gates

- `Persistence.saveState()`: skipped if `dailyPuzzleMode`
- `processFailurePenalty()`: lives decrement works normally in daily mode
- `retryCurrentLevel()`: resets `dailyScore = 0` instead of `score`
- `checkVictoryConditionStates()`: shows daily result overlay instead of regular win overlay

---

## 11. Input Handling

All handlers in `input.js`.

### Touch (mobile)

| Gesture | Behaviour |
|---|---|
| Single tap (< 250ms, < 15px move) | Select and launch IDLE path under finger |
| Single-finger drag | Pan camera (updates `State.matE/matF`) |
| Two-finger pinch | Zoom camera (range 1.0–6.0, anchor at pinch midpoint) |

**Touch state machine:**
```
touchMode: "none" → "pan" (1 finger down) → "pinch" (2 fingers down)
                ↑                          ↓
                └─────── "pan" (1 finger lifts) ──┘
```

**Tap detection:** `ignoreTap` flag set on drag detected. Duration + distance threshold applied. Tap fires on `touchend` if `touchMode === "pan"`.

**Known issue:** `ignoreTap` is not set when a second finger lands (starting a pinch). If both fingers lift quickly after a pinch, a spurious tap can fire at the original first-touch position.

### Mouse (desktop)

| Action | Behaviour |
|---|---|
| Click (< 250ms hold) | Select and launch IDLE path under cursor |
| Click-drag | Pan camera |
| Scroll wheel | Zoom camera (anchor at cursor position) |
| Hover | Highlights path under cursor (`State.selectedPath`) |

### Canvas coordinate conversion

```js
function getCanvasCoords(clientX, clientY) {
    const boardBcr = document.getElementById('board-container').getBoundingClientRect();
    const canvasX = (clientX - boardBcr.left - State.matE) / State.cssZoom;
    const canvasY = (clientY - boardBcr.top  - State.matF) / State.cssZoom;
}
```

Grid cell from canvas coords:
```js
let clickedR = Math.floor((canvasY - State.offsetY) / State.cellSize);
let clickedC = Math.floor((canvasX - State.offsetX) / State.cellSize);
```

---

## 12. Camera System

All in `camera.js`.

### Camera Fields
| Field | Default | Range | Description |
|---|---|---|---|
| `State.cssZoom` | 1.0 | 1.0–6.0 | Active camera scale multiplier. |
| `State.matE` | 0 | Panned (bounds) | Horizontal translation pixel offset. |
| `State.matF` | 0 | Panned (bounds) | Vertical translation pixel offset. |
| `State.revealActive` | `false` | Boolean | Flags whether the path drawing entrance animation is running. |
| `State.revealProgress` | `0.0` | 0.0–1.0 | Interpolated timeline position of the progressive path reveal. |

### 1. `applyBoardTransform()`
Applies the scale and translation matrix to the canvas: `matrix(zoom, 0, 0, zoom, matE, matF)`.
- **Clamping & Centering Bounds**: Calculates boundaries based on the **scaled board dimensions** (`scaledBoardW = gridCols * cellSize * cssZoom` and `scaledBoardH = gridRows * cellSize * cssZoom`) rather than the canvas size.
  - **Horizontal**: If `scaledBoardW <= bcr.width`, centers the board perfectly. Otherwise, clamps translation between `minE` (right board edge at container right) and `maxE` (left board edge at container left), preventing unwanted left-side sticking or snapping.
  - **Vertical**: If `scaledBoardH <= visibleH` (excluding header), centers the board. Otherwise, clamps translation between `minF` (bottom board edge at visible bottom) and `maxF` (top board edge at visible top), keeping it panned perfectly inside the active playing slice.

### 2. `startPathRevealAnimation()`
Runs the universal staggered reveal animation when entering any gameplay mode or continuation rehydration.
- Locks the camera at the fitted overview scale (`fitZoom`) with an empty board layout.
- Animates paths progressively from their tail to their head over an **adaptive timeline**:
  `duration = Math.min(900, Math.max(300, N * 60))` (between 300ms and 900ms based on path count `N`).
- Staggers path drawing start delays dynamically by their index to create a sequential, hand-drawn look.
- Short-circuits all touch/click/drag input events while the animation is active.
- Launches `startCameraEntranceAnimation()` sequentially upon completion.

### 3. `startCameraEntranceAnimation()`
Plays the smooth automatic camera zoom-in transition.
- **Target Zoom**: Zooms closer into the board to a deeper, more immersive **`1.35x` target zoom** on mobile viewports.
- **Glitch-Free Scale Handoff**: After dynamically calculating translation targets (`targetE`, `targetF`) at `1.35` scale, it immediately calls `applyBoardTransform()` after restoring the starting fit coordinates. This restores the fitted overview transform on the canvas, eliminating the intermediate zoom-out snapping glitch.
- Set `HOLD_MS` to `0ms` to seamlessly sweep the camera in instantly right after path drawing finishes.

### 4. `resetCamera()`
Resets scale and translations to default values (`cssZoom = 1.0`, `matE = 0`, `matF = 0`) and applies the transform. Used primarily on desktop viewports where no intro sequence plays.

---

## 13. Persistence (localStorage)

Key: `vecto_colossal_mosaic_save_v2`

**Saved fields:** `level`, `score`, `lives`, `gridRows`, `gridCols`, `gridSize`, `gridMask`, `shapeName`, `gridSizePreset`, `paths`, `boardDifficulty`, `recentDifficulties`

**NOT saved:** `dailyScore`, `hintPathId`, `selectedPath`, `isWinState`, `isFailState`, `cssZoom`, `matE`, `matF`, `animatingCount`, `particles`

**Load guards** (returns `false` / discards save if):
- `localStorage` has no entry for the key
- `gridMask` contains any `-1` value (stale save with obstacle pillars)
- `gridRows` or `gridCols` is missing

**Save is a no-op during daily mode.**

---

## 14. Audio Engine

Web Audio API, lazy-initialised on first user gesture (required by browser policy).

| Method | Sound |
|---|---|
| `tap()` | 600Hz triangle, 0.1s |
| `clear()` | 3-note ascending chord (C5→E5→G5), 60ms apart |
| `crash()` | 180Hz sawtooth + 90Hz triangle simultaneously |
| `win()` | 8-note ascending scale, 50ms per note |
| `playTone(freq, type, duration, vol)` | Generic tone primitive |

All sound is wrapped in try/catch — audio failure is always silent.

---

## 15. Topologies

Defined in `TOPOLOGIES` object in `topologies.js`. Each has a `name` and `makeMask(rows, cols)` function returning a 2D array.

| Key | Name | Shape |
|---|---|---|
| `SQUARE` | Square Matrix | Full rectangle — all cells playable |
| `CROSS` | Cruciform Cross | Plus/cross shape (25% padding cut from corners) |
| `DIAMOND` | Rhombus Diamond | Diamond inscribed in rectangle |
| `DONUT` | Hollow Donut | Rectangle with rectangular hole (30% inset) |
| `OCTAGON` | Beveled Octagon | Rectangle with 4 corners cut at 25% diagonal |
| `CIRCLE` | Circle Shield | Approximate circle |
| `HOURGLASS` | Hourglass Prism | Narrow waist at centre row |
| `WAVES` | Serpentine Waves | Sinusoidal vertical band |
| `CORNER_CASTLE` | Corner Castle | Rectangle with top-left and bottom-right corners removed (35%) |
| `GATEWAY` | Hedge Gateway | Rectangle with gap cut in the middle row left and right edges |
| `FRAME` | Rectangle Frame | Thin outer border ring (15% of min dim); large void centre |
| `L_BLOCK` | L-Block | Full rectangle with the top-right 50%×50% quadrant removed |
| `TWIN_PANELS` | Twin Panels | Two separate rectangles split by a horizontal void gap (~10% height) |
| `STAIRCASE` | Staircase Steps | Three descending rectangular steps, full-width at top → ⅓-width at bottom |
| `VERTICAL_RECT` | Vertical Rectangle | Full rectangle, all cells playable — always portrait (rows > cols) |

### Rectangle-family topology notes

- **FRAME** — The interior void spans roughly the inner 70%×70% of the grid. The playable border ring is always at least 1 cell thick. On small grids the ring may be only a single-cell frame; on large grids it is a multi-cell-wide moat. Paths can only travel around the perimeter.

- **L_BLOCK** — Removes a rectangular quadrant from the top-right (rows 0..r/2, cols c/2..c). The remaining L-shape forces many paths through the bottom-left corner, creating natural bottlenecks.

- **TWIN_PANELS** — The void gap runs the full width of the grid, splitting it into an independent upper panel and a lower panel. Paths can slide off the board from both panels independently. They **cannot** collide across the void gap mid-flight; however, the solvability checker handles this correctly because escaped paths are removed from the occupancy grid.

- **STAIRCASE** — Three steps descend from full width (cols 0..c) at the top third, to two-thirds width in the middle, to one-third width at the bottom. The right side of each lower step is void. Creates an asymmetric, right-leaning play area where paths in lower rows have fewer escape options toward the right.

### Topology selection weights

`getTopologyForLevel` uses a weighted pool — not a uniform random pick:

| Topology key | Weight | Approx frequency |
|---|---|---|
| `VERTICAL_RECT` | 5 | ~15 % |
| `SQUARE` | 1 | ~3 % |
| All others (13 topologies) | 2 each | ~6 % each |

To change how often a topology appears, edit `TOPOLOGY_WEIGHTS` in `getTopologyForLevel` (`topologies.js`). Topologies not in that map default to weight 2.

**`enforcePortrait` flag:** If a topology object has `enforcePortrait: true`, `build100PackedLevel` will swap `State.gridRows` and `State.gridCols` whenever the random dimension generator produces a landscape board (cols > rows). `gridSize` (the max of the two) is unaffected by a swap and does not need recalculating.

---

## 16. Difficulty & Sizing Presets

Grid dimensions are procedurally generated by `generateRandomGridDimensions(preset, level)` in `topologies.js`.

### Mobile Aspect Ratio Proportions & Grid Balancing
Rather than selecting rows and columns completely independently (which previously resulted in excessively tall, narrow boards like `20x2` or `30x6` that felt visually cramped), the generation pipeline utilizes a **ratio-driven proportions-balancing generator** to ensure grids naturally fit mobile portrait screens:

1. **Aspect Ratio Probability Gating**:
   - **95% chance (Balanced Portrait)**: The aspect ratio (`rows / cols`) is procedurally targeted between **`1.35` and `1.65`**. This produces beautifully proportioned portrait layouts that visually fill viewports and are comfortable to analyze.
   - **5% chance (Vertical Challenge)**: A tall, narrow aspect ratio between **`2.8` and `4.0`** is selected to preserve classic vertical variety and high-difficulty hallway clusters.

2. **Two-Step Dimension Calculation**:
   To prevent dimensions from breaking preset limits, the generator runs a self-correcting recalculation flow:
   - **Step A**: A raw vertical height (`rows`) is rolled within the active preset's ranges (`minR` to `maxR`).
   - **Step B**: Ideal columns are calculated based on the target aspect ratio: `cols = Math.ceil(rows / targetRatio)`.
   - **Step C**: Mobile overrides are checked to verify `cols` can span mobile screen widths naturally (maintaining comfortable cell sizes).
   - **Step D**: Strict clamping is applied to `cols` to stay within the active preset's bounds (`minC` to `maxC`). This preserves difficulty scaling tiers.
   - **Step E**: Height is recomputed based on the final columns to lock in the target aspect ratio:
     `rows = Math.max(minR, Math.min(maxR, Math.ceil(cols * targetRatio)))`
     This ensures both rows and columns strictly respect preset boundaries while maintaining the desired layout proportions.

Global hard safety limits are enforced as a fallback: rows `6–50`, columns `2–20`.

| Preset | Rows (height) | Cols (width) |
|---|---|---|
| Standard | 6–20 | 2–10 |
| Grand | 15–28 | 6–13 |
| Colossal | 22–38 | 9–16 |
| Titan | 32–46 | 13–18 |
| Cosmic | 40–50 | 16–20 |

Auto mode scales rows and cols independently with level:

| Level | Rows | Cols |
|---|---|---|
| 1–2 | 6–12 | 2–5 |
| 3–5 | 8–20 | 3–8 |
| 6–8 | 12–30 | 4–12 |
| 9–12 | 18–38 | 6–15 |
| 13–18 | 25–45 | 9–17 |
| 19+ | 35–50 | 14–20 |

**Level 10+ floor (Auto only):** rows ≥ 15, cols ≥ 6 — enforced via `Math.max` on the lower bounds inside `generateRandomGridDimensions`.

### Adaptive Complexity & Difficulty System (Auto Mode Only)
Instead of determining difficulty purely by board sizing, the system evaluates strategic and topological complexity using a **directed blocker dependency graph (DAG)**. Puzzles are analyzed recursively during generation to select target tiers with specific adaptive pacing.

#### 1. Blocker Dependency Graph Evaluation
Before accepting a generated board candidate, `evaluateBoardComplexity(paths, rows, cols)` is executed:
- **Direct Blockers**: Traces ray escape paths for each path in its heading direction. Any intersection with another path adds a directed blocker dependency.
- **Maximum Dependency Depth (`maxDepth`)**: Recursively computes the maximum chain of nested block dependencies required to unlock the board.
- **Blocker Ratio**: Calculates the ratio of total block dependencies to path count.
- **Initial Escape Options**: Counts paths with `0` blocker dependencies (can escape immediately). High difficulty matches target **3 to 6 initial safe choices**; extremely low (< 2) or high (> 6) initial escape counts are penalized to ensure interesting, non-trivial, yet readable starting play.
- **Complexity Score formula**:
  `score = maxDepth * 3 + blockerRatio * 5.5 - initialEscapePen`
  
The resulting score classifies boards into five difficulty tiers (with their corresponding HUD colors):
- **EASY**: Score `< 6` (Emerald Green HUD: `#10b981`)
- **NORMAL**: Score `6–12.99` (Blue HUD: `#3b82f6`)
- **HARD**: Score `13–21.99` (Orange HUD: `#f97316`)
- **EXPERT**: Score `22–28.99` (Purple HUD: `#a855f7`)
- **TITAN**: Score `≥ 29` (Pink HUD: `#ec4899`)

#### 2. Weighted Level Progressions
Base target difficulty probabilities scale dynamically by level:
- **Levels 1–10**: EASY (60%), NORMAL (30%), HARD (9%), EXPERT (1%)
- **Levels 11–20**: EASY (20%), NORMAL (45%), HARD (30%), EXPERT (5%)
- **Levels 21–40**: EASY (10%), NORMAL (20%), HARD (50%), EXPERT (20%)
- **Levels 41+**: EASY (5%), NORMAL (15%), HARD (50%), EXPERT (30%)

#### 3. Intelligent Difficulty Pacing & Relief Boards
To maintain a comfortable flow and prevent cognitive fatigue, a 5-level sliding log history (`State.recentDifficulties`) enforces pacing override rules:
- **Anti-Streak Guard**: Restricts generating more than 2 consecutive `EXPERT` or `EASY` boards.
- **Relief Interjections**: If two consecutive high-difficulty (`HARD` or `EXPERT`) boards are played, the system temporarily reduces difficulty of the next board to `EASY` (40%) or `NORMAL` (60%) for player relief.

---

## 17. Critical Invariants — Never Break These

These are hard rules enforced by `validatePaths()`:

1. **Strictly orthogonal paths** — consecutive path points must be exactly 1 cell apart horizontally or vertically (`|dr| + |dc| === 1`). No diagonals ever.

2. **100% active-cell coverage** — every cell where `gridMask[r][c] === 1` must be covered by exactly one path. No cell covered twice, no cell uncovered.

3. **`heading` matches geometry** — `p.heading` must agree with the direction from `p.points[len-2]` to `p.points[len-1]`. `getHeadingFromDiff(dr, dc)` is the source of truth.

4. **Path IDs are unique and sequential** — IDs start at 1 and never repeat within a board.

5. **`points[last]` is the head** — the arrowhead is always the last element of the points array. Reversing points must be accompanied by updating `heading`.

6. **Own cells are transparent to escape** — collision and solvability checks use `occupiedId !== p.id` to skip own cells. A path can "pass through" its own body. This is intentional game physics, not a bug.

---

## 18. Win / Fail Lifecycle

### Win

```
Last path animProgress > gridSize * 1.5
  → p.state = "CLEARED"
  → checkVictoryConditionStates()
      → State.isWinState = true
      → AudioEngine.win()
      → spawnWinExplosionParticles()
      → score += 100 (dailyScore in daily mode)
      → updateDomUI()
      → if daily: show daily-result-overlay (after 700ms delay)
      → if normal: Persistence.clearState(), show win-overlay (after 600ms delay)
```

**Exiting win state (normal):** `triggerNextLevel()` — increments level, clears overlays, resets hint/selected/particles, calls `build100PackedLevel(true)`.

**Exiting win state (daily):** `exitDailyPuzzle()` — resets daily state, calls `build100PackedLevel(false)` to resume regular game.

### Fail

```
Collision detected during MOVING
  → p.state = "CRASHING"
  → processFailurePenalty()
      → State.lives--
      → if lives === 0: State.isFailState = true, show fail-overlay (after 500ms)
```

**Exiting fail state:** `retryCurrentLevel()` — resets score to `levelStartScore` (or `dailyScore = 0`), resets all paths to IDLE at `animProgress = 0`, resets camera, saves if not daily.

---

## 19. Fixed Bugs Log

| # | Description | File | Fix |
|---|---|---|---|
| F1 | Arrowhead visually points into own body after unjammer flip | `board-gen.js` | Added `fixVisualSelfIntersections()` post-unjammer pass |
| F2 | Invalid board loaded after all 20 generation attempts fail | `board-gen.js` | Changed `result` to `validResult` — only set on passing board |
| F3 | Fallback generation checked solvability before unjamming (wrong order) | `board-gen.js` | Fixed order: unjam → fixVisual → validate → accept |
| F4 | Error recovery path in game-logic had no validation loop | `game-logic.js` | Added 10-attempt validated loop matching primary path |
| F5 | Daily puzzle score added back into regular score on exit | `daily.js` | Introduced `State.dailyScore`; daily mode never touches `State.score` |
| F6 | Retry in daily mode reset `State.score` instead of `State.dailyScore` | `game-logic.js` | Daily retry now sets `State.dailyScore = 0` |
| F7 | Camera not reset when loading saved game | `board-gen.js:798` | Added `resetCamera()` before `return` in save-load fast path |
| F8 | Unjammer could flip heading to self-intersecting direction | `board-gen.js` (unjammer) | Unjammer now checks `!evalResult.selfIntersect` before accepting flip |
| F9 | Board dimensions were symmetric (rows = cols range) — produced square/landscape boards | `topologies.js` | Rows and cols now use independent portrait-biased ranges (rows 6–50, cols 2–20) |
| F10 | Complex topologies on tiny boards produced < 6 playable cells, causing degenerate generation | `board-gen.js` | Added playable-cell-count guard; falls back to VERTICAL_RECT mask if count < 6 |
| F11 | Fallback and emergency boards used 8×8 / 6×6 square — violated portrait design intent | `board-gen.js`, `game-logic.js` | Fallback → 15×8 VERTICAL_RECT; Emergency → 12×6 VERTICAL_RECT |
| F12 | Camera animated zoom-in not triggering on mobile | `camera.js` | Correctly measured and subtracted bottom controls height (`botBarH`) from visible playing area height (`usableH`) |
| F13 | Canvas briefly jumps/zooms-out before zoom-in animation starts | `camera.js` | Forcibly re-applied starting fitZoom to canvas transform immediately after target recalculations |
| F14 | Board snaps and sticks to left edge when manually zoomed in | `camera.js` | Migrated horizontal/vertical bounds clamping and centering calculations to use scaled board dimensions instead of canvas dimensions |
| F15 | Overly stretched vertical boards feel visually narrow and cramped | `topologies.js` | Introduced ratio-driven procedural generation with 95% balanced portrait aspect ratios (1.35x-1.65x) and strict preset bounds clamping |
| F16 | Board difficulty was determined purely by dimension sizes | `js/board-gen.js`, `js/topologies.js` | Replaced with evaluated blocker-dependency graph DAG complexity, adaptive weighted probability, and relief pacing controls |

---

## 20. Known Remaining Bugs

| # | Severity | Description | File | Trigger |
|---|---|---|---|---|
| B1 | Fixed ✅ | Dashed preview line extends through void cells | `renderer.js:236` | Non-rectangular topology; arrow points toward void area |
| B2 | Medium | Daily puzzle seed uses local time, not UTC | `daily.js:11` | Players in different timezones get different "daily" puzzles |
| B3 | Low | Pinch gesture can trigger spurious tap | `input.js:87` | Quick two-finger pinch + both fingers lift within 250ms |
| B4 | Fixed ✅ | Camera pan is unbounded — board can be panned off-screen | `camera.js` | Strict board-edge limits are now enforced in `applyBoardTransform()` |

> **B1 was fixed** by changing the dashed preview line stop condition from `!== -1` to `=== 1`.
> **B4 was fixed** by enforcing strict, board-edge horizontal/vertical boundaries during camera transform.

---

## 21. Common Pitfalls for Future Changes

**1. Always call `resetCamera()` when changing levels or loading boards.**
Every `build100PackedLevel` path must call it. The save-load early-return path was missing it (F7).

**2. Never add score to `State.score` during daily mode.**
Check `State.dailyPuzzleMode` and route to `State.dailyScore` instead. See §9.

**3. `Persistence.saveState()` is silently a no-op during daily mode.**
Don't rely on it for mid-daily-game state saving.

**4. The unjammer (`runUnjammingSolvabilityTweak`) runs AFTER `assignSmartHeadings`.**
It can override headings. Always run `fixVisualSelfIntersections` immediately after the unjammer.

**5. Validation order must be: unjam → fixVisual → `hasAnyDoubleSelfCollidingPath` → `isBoardFullySolvable`.**
Reversing the order allows invalid boards to slip through.

**6. Never use the last loop iteration's board as a fallback.**
If the retry loop exhausts all attempts without a valid board, trigger the fallback 8×8 Square path — never use an unvalidated board.

**7. Own cells are transparent to all escape checks.**
`getPathOccupiedCells`, `isBoardFullySolvable`, `canEscapeOccupancy`, `canPathEscapeVirtual` all skip cells belonging to the path being checked (`occupiedId !== p.id`). This is intentional. Do not "fix" it.

**8. `points[last]` = head. Reversing requires updating `heading`.**
Use `getHeadingFromDiff(newLast.r - newPrev.r, newLast.c - newPrev.c)` after any reversal.

**9. `gridMask[r][c] === 1` is playable. `=== 0` is void. `=== -1` is wall.**
Many checks use `!== -1` which incorrectly includes void cells. For "is this a valid playable cell", always use `=== 1`.

**10. `Math.random` is temporarily replaced during daily puzzle generation.**
`startDailyPuzzle` swaps `Math.random` with `mulberry32` before calling `build100PackedLevel` and restores it after. Any code inside `build100PackedLevel` that calls `Math.random` will use the seeded PRNG. Do not introduce `Math.random` calls in generation code that should be non-deterministic.

**11. `animatingCount` is recalculated from scratch every frame.**
It is reset to 0 at the top of `animationUpdateTick` and incremented per MOVING/CRASHING path. Never cache it; never manually set it to anything other than 0.

**12. `State.hintPathId` must be cleared when the level changes.**
`triggerNextLevel`, `retryCurrentLevel`, and `exitDailyPuzzle` all clear it. If you add a new level-transition path, clear it there too.
