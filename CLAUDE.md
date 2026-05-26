# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

Open `Arrow.html` directly in a browser — no build step, no server required. All dependencies (Tailwind CSS, Google Fonts) are loaded from CDN.

## Architecture

The entire game lives in one file: `Arrow.html`. It is structured as three sequential `<script>` blocks:

1. **`AudioEngine`** — Web Audio API synthesis. Five sound events: `tap`, `clear`, `crash`, `win`, and a generic `playTone`. Lazy-initializes `AudioContext` on first user gesture.

2. **`State`** — Single global object holding all mutable game state: grid dimensions (`gridRows`, `gridCols`), `gridMask` (2D array: `1`=playable, `0`=void, `-1`=solid wall), `paths`, animation state (`animatingCount`), camera (`zoom`, `panX`, `panY`), lives, score, level, and UI helpers.

3. **Core game controller** — Everything else: board generation, rendering, input handling, game logic.

## Key systems

### Board generation pipeline (`build100PackedLevel`)
1. Pick grid dimensions via `generateRandomGridDimensions` (respects the active `SIZING_PRESETS` mode).
2. Pick a `TOPOLOGIES` shape (Square, Cross, Diamond, Donut, Octagon, Circle, Hourglass, Waves, Corner Castle, Hedge Gateway) to build `State.gridMask`.
3. `tryGenerateBoard()` — greedy crawler fills all active cells with paths using four movement styles (Spiral, Serpentine, Staircase, Standard). Runs a gap-filling pass to ensure 100% coverage.
4. `assignSmartHeadings()` — picks which endpoint becomes the arrowhead using the Chevron Self-Collision Guard (evaluates forward ray for self-intersection; picks safer end).
5. `runUnjammingSolvabilityTweak()` — multi-pass unjammer that greedily clears escapable paths and flips headings to resolve deadlocks.
6. Retries up to 20 times if any path has both endpoints self-colliding.
7. `validatePaths()` enforces two hard invariants before accepting a board: every active cell covered exactly once, no diagonal steps between consecutive path points.

### Path data model
Each path: `{ id, points: [{r,c}…], heading: "UP"|"DOWN"|"LEFT"|"RIGHT", state: "IDLE"|"MOVING"|"CRASHING"|"CLEARED", animProgress, originalPoints }`.

`animProgress` is a float: during MOVING it increments 0.26/frame; the path body slides forward by `animProgress` cells. During CRASHING it decrements 0.16/frame back to 0.

### Rendering (`drawEngine`)
Canvas 2D. Each frame: clear → apply camera transform (`panX/Y`, `zoom`) → batch-draw grid cells by mask value → draw each non-CLEARED path as a polyline with `getSubTrackPoints` → draw 3D chevron arrowhead at head → draw confetti particles. Uses `requestAnimationFrame` loop via `animationUpdateTick`.

### Collision detection
During MOVING, the leading grid cell (rounded from `animProgress`) is checked against all other paths' `getPathOccupiedCells()`. A collision sets the path to CRASHING and decrements `State.lives`. `processFailurePenalty` triggers the fail overlay at 0 lives.

### Persistence (`Persistence`)
Saves/loads from `localStorage` key `vecto_colossal_mosaic_save_v2`. Stale saves containing obstacle pillars (`-1` in mask) or missing rectangular dimensions are silently discarded.

### Input
- **Click/tap**: selects the path under the cursor and sets it to MOVING.
- **Drag / touch-pan**: pans the camera.
- **Pinch / scroll wheel**: zooms the camera (range 0.5–6.0).
- **Double tap**: resets camera to default.
- **`actions` object**: `cycleMatrixSize`, `triggerNextLevel`, `retryCurrentLevel`, `skipLevel`, `useHint` — all called from inline `onclick` attributes.

## Critical invariants

- **Strictly orthogonal paths** — `validatePaths` rejects any path with a diagonal step (`|dr| + |dc| !== 1`). Never write code that places two path points diagonally adjacent.
- **100% active-cell coverage** — every cell where `gridMask[r][c] === 1` must belong to exactly one path. The gap-filling and fallback-steal algorithms enforce this; don't bypass them.
- **Solvability** — `isBoardFullySolvable` simulates a greedy solve. Boards that fail it are retried. Heading changes must preserve this guarantee.
- **`gridOwnership` encoding**: `-1` = unassigned, `-2` = masked/void, `-3` = failed start (temporary), `≥1` = path ID.
