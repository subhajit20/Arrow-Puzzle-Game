# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

Open `index.html` directly in a browser — no build step, no server required. All dependencies (Tailwind CSS, Google Fonts) are loaded from CDN.

## Architecture

The game is split across `index.html` (HTML/CSS shell + script tags) and modular JS files in `js/`:

| File | Responsibility |
|---|---|
| `js/state.js` | Single `State` global — all mutable game state |
| `js/edge-gen.js` | Graph construction + reverse-construction generator (RC) |
| `js/edge-logic.js` | DAG complexity scoring, solvability assertion, collision |
| `js/board-gen.js` | Level sizing, difficulty selection, generation orchestration |
| `js/camera.js` | Zoom/pan, canvas resize, entrance animation |
| `js/renderer.js` | Canvas 2D draw loop, arrowhead, confetti |
| `js/input.js` | Tap/drag/pinch/scroll input → path selection |
| `js/game-logic.js` | Collision detection, victory, lives, hint |
| `js/audio.js` | Web Audio API procedural synthesis |
| `js/persistence.js` | localStorage V4 save/load |
| `js/topologies.js` | (legacy, unused by RC generator) |
| `js/daily.js` | Daily puzzle — seeded PRNG, separate score |

## Key systems

### Board generation — Reverse Construction

The generator builds boards **backwards**: place pieces one at a time; a piece is placed only when its head's straight ray to the board edge is currently clear of already-placed pieces. Solve order = reverse of placement order. Solvability is a property of construction, never a search.

Pipeline in `_build100PackedLevelEdge` (`board-gen.js`):
1. Pick grid size from `getSizesForLevel` (portrait 2:1 ratios, grows with level).
2. Pick target difficulty tier with `selectTargetDifficulty` (anti-streak, level-gated).
3. Up to 5 rounds: call `rcConstructForTier(graph, tier, batch)` → get `{paths, cx}`.
4. Post-build assert: `isBoardFullySolvable` + `validateRulebook` (all 14 RULEBOOK rules; should always pass).
5. Derive `hEdge`/`vEdge` from node sequences via `reserveEdge`.
6. Commit: set `State.paths`, `State.nodeOwner`, `State.hEdge/vEdge`, difficulty, lives, call `startPathRevealAnimation`.

`rcConstructForTier` (`edge-gen.js`):
- `rcBuildChain` — difficulty backbone: (chainDepth+1) right-pointing length-2 pieces, each placed while its exit ray is clear → forced dependency chain of depth = chainDepth.
- `rcFillA` — main fill: winding self-avoiding walks, head-ray-clear test, difficulty bias on ray length.
- `rcFillB` — gap fill: small pieces into empty pockets, both endpoints tried as head.
- `rcFillC` — tail-append: isolated empty nodes appended to adjacent piece tails; validated with `rcBoardSolvable`, reverted LIFO if solvability breaks, `placeOrder` recomputed.

### Path data model

Each path: `{ id, nodes: [{r,c}…], heading: "UP"|"DOWN"|"LEFT"|"RIGHT", state: "IDLE"|"MOVING"|"CRASHING"|"CLEARED", animProgress, originalNodes, placeOrder }`.

- `nodes` are **micro-grid** intersection coordinates (root cell × `subdivFactor`).
- `heading` is the terminal-segment direction set at placement, never changed after construction.
- `animProgress` is a float: increments 0.26/frame while MOVING (the head slides forward); decrements 0.16/frame while CRASHING back to 0.

### Subcell subdivision

`subdivFactor = 2` — each root cell splits into a 2×2 micro routing grid.
- `State.rootRows/rootCols` — visual grid dimensions (screen fitting).
- `State.gridRows/gridCols = rootRows/rootCols × subdivFactor` — actual routing grid.
- `State.subCellSize = cellSize / subdivFactor` — pixel pitch used by renderer and input.

### Rendering (`drawEngine` in `renderer.js`)

Canvas 2D. Each frame: clear → `ctx.translate(matE,matF)` + `ctx.scale(cssZoom)` → white board fill → dot grid at every micro-node → clip → draw each non-CLEARED path as a polyline with `getSubTrackPoints` sliding window → chevron arrowhead → restore clip → confetti particles.

### Collision detection

`animationUpdateTick` (`renderer.js`): during MOVING, reads `State.nodeOwner[leadR * W + leadC]` one step ahead of the head. If owned by a different non-CLEARED path → CRASHING.

### Persistence

V4 format in `localStorage`. `nodeOwner` is rebuilt from `paths.nodes` on load (not stored). V3/V2 saves are silently discarded (incompatible coordinate space). A dimension guard in `_loadV4` also discards saves whose `rootRows/rootCols` are not in `getSizesForLevel(level)` — this silently drops old forward-pipeline fallback saves that were saved with an incorrectly small board at high levels.

### Regression tests

- `test-regression.js` — 840 boards across all 27 unique sizes in `getSizesForLevel`; asserts 0 solvability failures, 0 diagonal/owner errors, 0 hard fallbacks. Run: `node test-regression.js`
- `test-persistence.js` — 13 persistence scenarios (save/reload, nodeOwner rebuild, fallback guard, stale save discard). Run: `node test-persistence.js`

## Critical invariants

- **Strictly orthogonal paths** — consecutive nodes must differ by exactly 1 in r or c (`|dr| + |dc| === 1`). `validateRulebook` (Rules 4, 5) logs an error on violation. Never place two path nodes diagonally adjacent.
- **Single-owner nodes** — every micro-grid node is owned by at most one path. `nodeOwner` is the authoritative lookup; `validateRulebook` (Rules 3, 11) checks consistency. Empty (unowned) nodes are valid and render as bare dots.
- **Coverage ≥ 90% (target ~96–100%)** — Phase D oracle-based gap fill achieves ~96% average across all board sizes (90–100% range). `validateRulebook` (Rule 12) hard-fails below 90% (genuinely degenerate board) and info-logs below 100% (structural dead-ends are accepted). Rule 8 enforces a minimum of 3 nodes per path (2 segments minimum).
- **Solvability — guaranteed by construction** — `rcBuildChain` + `rcFillA/B/C/D` place or validate each piece so reverse-order removal is always valid. `isBoardFullySolvable` and `validateRulebook` (Rule 14) are post-build assertions; they should never fire.
- **Heading is final after construction** — `p.heading` is set at placement time and may be updated by Phase D's reversal pass (which re-derives it from the new terminal segment), but is never mutated during gameplay. `assignHeadings`, `buildDAGHeadings`, and `runUnjammingPass` are retired.
- **`nodeOwner` encoding** — `-1` = empty node, `≥0` = path id. (Old `gridMask`/`gridOwnership` encoding is retired.)
