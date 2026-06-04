# Arrow Game — Full Class-Based Restructure

## Rules
- Each phase requires explicit approval before starting.
- Do NOT begin the next phase until the current one is confirmed complete and approved.
- Do NOT change anything in the existing codebase until the restructure begins.
- Every class must be fully tested before moving to the next.

---

## Architecture Target

```
Game
├── Grid
├── Path
├── SolvabilityOracle
├── Generator
│     ├── RCBuilder
│     ├── ZoneMap
│     ├── DifficultyEngine
│     └── Validator
├── BoardLoader
├── Camera
├── Renderer
├── AnimationEngine
├── InputHandler
├── AudioEngine
├── Persistence
├── GameController
├── DailyPuzzle
└── main.js  (entry point)
```

---

## Phase 1 — Foundation

### 1.1 Grid.js ✓
- [x] `constructor(rows, cols)` — allocates nodeOwner, hEdge, vEdge
- [x] `owner(r, c)` — returns nodeOwner value
- [x] `setOwner(r, c, id)` — sets nodeOwner
- [x] `isFree(r, c)` — returns nodeOwner === -1
- [x] `inBounds(r, c)` — boundary check
- [x] `reserveEdge(r1, c1, r2, c2, pathId)` — marks hEdge or vEdge
- [x] `reset()` — clears all to -1
- [x] `freeNeighborCount(r, c)` — counts adjacent free nodes (used by pocket check)
- [x] `toLegacyGraph()` — bridge for existing RC helpers during transition

### 1.2 Path.js ✓
- [x] `constructor(id, nodes, heading)` — creates path object
- [x] `head()` — returns nodes[last]
- [x] `tail()` — returns nodes[0]
- [x] `clone()` — deep copy
- [x] `reset()` — restore to originalNodes, state IDLE, animProgress 0
- [x] `reverse()` — reverses node array, recomputes heading
- [x] `Path.headingToDelta(heading)` — static heading helper
- [x] `Path.deltaToHeading(dr, dc)` — static heading helper
- [x] `Path.fromLegacy(obj)` — factory from plain object (transition bridge)
- [x] `toLegacy()` — convert back to plain object for persistence

### 1.3 SolvabilityOracle.js ✓
- [x] `canEscape(path, removed, grid)` — walks head ray, own body transparent
- [x] `isBoardSolvable(paths, grid)` — greedy forward simulation, all paths must clear
- [x] `recomputePlaceOrder(paths, grid)` — assigns placeOrder from clear order

---

## Phase 2 — Generation Core

### 2.1 ZoneMap.js ✓
- [x] `generate(rows, cols)` — checkerboard DENSE/OPEN + guaranteed OPEN corridor
- [x] `zoneFor(r, c)` — maps node to DENSE | OPEN | NEUTRAL
- [x] `walkKnobs(r, c)` — returns { straightScore, turnScore, maxStraight } for zone at node
- [x] `lenScale(r, c)` — returns length multiplier for zone at node
- [x] `ZoneMap.WALK_KNOBS` — static knobs table (DENSE/OPEN/NEUTRAL)
- [x] `ZoneMap.LEN_SCALE` — static length multiplier table

### 2.2 RCBuilder.js ✓
Dependencies: Grid, Path, SolvabilityOracle, ZoneMap

- [x] `buildChain(grid, paths, ctr, depth, row)` — forced dependency chain backbone
- [x] `fillA(grid, paths, ctr, maxFails, knobs)` — main fill, winding self-avoiding walks
- [x] `fillB(grid, paths, ctr)` — gap fill, small pieces in empty pockets
- [x] `fillC(grid, paths)` — tail-append isolated nodes, LIFO revert on solvability break
- [x] `fillD(grid, paths, ctr)` — oracle gap fill, convergence loop + reversal pass + force-fill
- [x] `growWalk(grid, anchor, targetLen, zoneMap)` — winding SAW with pocket check
- [x] `pickAnchor(grid)` — least-occupied interior-biased node (14 candidates)
- [x] `headRayClear(grid, head, dr, dc)` — straight ray clear of all placed pieces
- [x] `sampleLen()` — SHORT 3-5 / MEDIUM 5-10 / LONG 10-15 (capped at 15, f=1)
- [x] `pocketCheck(grid, candidate)` — returns false if placing candidate isolates any neighbor

### 2.3 DifficultyEngine.js ✓
- [x] `selectTier(level, recentDifficulties)` — returns EASY|NORMAL|HARD|EXPERT|TITAN
- [x] `evaluate(paths, grid)` — score = maxDepth×3 + blockerRatio×5.5 - freeRatio×8
- [x] `computeDAGStats(paths, grid)` — maxDepth, blockerRatio, freeRatio
- [x] `chainDepthForTier(tier)` — returns chain depth knob per tier
- [x] `knobsForTier(tier, zoneMap)` — returns { chainDepth, d, lenScale, zoneMap }
- [x] `allowedTiers(level)` — returns tiers with non-zero probability at level
- [x] `DifficultyEngine.scoreTier(score)` — static score → tier mapping
- [x] `DifficultyEngine.TIER_CENTER` — static tier centre scores

### 2.4 Validator.js ✓
Dependencies: SolvabilityOracle

- [x] `checkOrthogonality(path)` — every consecutive node pair must differ by exactly 1 in r or c
- [x] `checkSingleOwner(grid, path)` — no node shared between paths
- [x] `checkMinLength(path, minNodes)` — minimum 2 (Phase D), minimum 3 from Phases A/B/C
- [x] `checkCoverage(paths, grid)` — 100% coverage required, returns coverage %
- [x] `confirmSolvable(paths, grid)` — final lightweight solvability check
- [x] `checkPath(grid, path)` — fast inline check (orthogonality + single-owner) per new path
- [x] `checkBoard(paths, grid)` — full end check (coverage + solvability) after fillD

### 2.5 Generator.js ✓
Dependencies: RCBuilder, DifficultyEngine, Validator, SolvabilityOracle

- [x] `build(rows, cols, level, batch, context)` — orchestrates full RC pipeline
- [x] `constructForTier(grid, tier, batch, zoneMap)` — runs batch attempts, picks best
- [x] `selectBoardMask(level, rows, cols, context)` — shape mask for milestone/daily levels
- [x] `sizesForLevel(level)` — returns available grid sizes per level
- [x] `_constructAttempt(grid, tier, zoneMap)` — single attempt: chain→A→B→C→score→D
- [x] Pipeline: buildChain → fillA → fillB×2 → fillC×2 → evaluate → fillD → checkBoard
- [x] No validateRulebook at the end — replaced by Validator.checkBoard inline
- [x] 100% coverage guaranteed by pocketCheck in growWalk + Validator.checkCoverage

---

## Phase 3 — Presentation

### 3.1 Camera.js ✓
- [x] `constructor(canvas)` — owns all view-state
- [x] `calculateMetrics(containerW, containerH, gridRows, gridCols)` — cellSize, offsetX/Y
- [x] `getTransform()` — returns { zoom, dx, dy } for Renderer
- [x] `reset()` — cssZoom=1, matE=0, matF=0, cancels animation
- [x] `clampPan(containerEl)` — keeps board on screen with 1-cell overscroll
- [x] `startEntranceAnimation(containerEl)` — fitZoom → 1.65 over 1100ms cubic ease
- [x] `onPinch(newZoom, originX, originY, containerEl)`
- [x] `onScroll(delta, x, y, containerEl)`
- [x] `onPan(dx, dy, containerEl)`
- [x] `resize(containerEl, gridRows, gridCols)` — via Renderer

### 3.2 Renderer.js ✓
Dependencies: Camera

- [x] `constructor(canvas, camera)`
- [x] `drawFrame(board, gameState)` — clear → dots → paths → arrowheads → confetti
- [x] `drawGrid(grid, mask)` — dot at every active micro-node
- [x] `drawPath(path, revealState, selectedId, hintId)` — sliding window polyline
- [x] `drawArrowHead(x, y, heading, size, isSelected, pathState)` — chevron
- [x] `drawConfetti(particles)` — physics + draw, mutates array in place
- [x] `Renderer.getDifficultyLabel(difficulty)` — static { label, color }
- [x] `updateDomUI(gameState)` — level, score, lives, tier badge
- [x] `resize(containerEl, gridRows, gridCols)` — canvas resize + camera update

### 3.3 AnimationEngine.js ✓
Dependencies: Renderer

- [x] `constructor(renderer)`
- [x] `start(board, gameController)` — begins RAF loop
- [x] `stop()` — cancels RAF
- [x] `_tick(board, gameController, now)` — reveal + paths + draw per frame
- [x] `updatePath(path, grid, gameController)` — MOVING/CRASHING state machine
- [x] `startRevealAnimation(paths, containerEl, camera, onComplete)` — staggered reveal
- [x] `spawnConfetti(camera)` — spawns 60 particles from board centre
- [x] `clearParticles()` — resets particle array

---

## Phase 4 — Interaction

### 4.1 InputHandler.js ✓
Dependencies: Camera, GameController

- [x] `constructor(canvas, camera, gameController)` — stores bound handler refs
- [x] `attach(containerEl)` — binds all event listeners
- [x] `detach()` — removes exact same listener references
- [x] `onTap(canvasX, canvasY)` — hitTest → 120ms flash → MOVING
- [x] `_handleTouchStart/Move/End` — single-finger pan + two-finger pinch
- [x] `_handleMouseDown/Move/Up` — drag pan + click fire + hover highlight
- [x] `_handleWheel` — scroll zoom via Camera.onScroll
- [x] `hitTest(canvasX, canvasY)` — edge-based: scans hEdge + vEdge midpoints
- [x] `_canvasCoords(clientX, clientY)` — client → canvas space via camera transform
- [x] `_containerOffset(clientX, clientY)` — client → container-relative coords

### 4.2 AudioEngine.js ✓
- [x] `constructor()`
- [x] `init()` — creates AudioContext on first user gesture
- [x] `playTone(freq, type, gain, duration)` — Web Audio API base, exponential decay
- [x] `playTap()` — 600Hz triangle blip
- [x] `playPathCleared()` — rising C-E-G arpeggio
- [x] `playCollision()` — sawtooth + triangle crash burst
- [x] `playWin()` — ascending 8-note scale
- [x] `playHint()` — soft 880Hz sine bell

### 4.3 GameController.js ✓
Dependencies: Board, Renderer, AudioEngine, Persistence, AnimationEngine

- [x] `constructor(board, renderer, audio, persistence, animation)`
- [x] `startLevel(level, boardData, containerEl)` — commits board, resets state, triggers reveal
- [x] `nextLevel()` — hides win overlay, increments level (caller regenerates board)
- [x] `retryLevel()` — resets paths to originalNodes, restores score + lives
- [x] `useHint()` — random IDLE path hintPathId, plays hint sound
- [x] `onPathCleared(path)` — addScore(10), playPathCleared, checkWin
- [x] `onCollision(path)` — playCollision, camera shake, deductLife
- [x] `checkWin()` — all CLEARED → win bonus, confetti, overlay
- [x] `checkFail()` — lives===0 → isFailState, fail overlay
- [x] `addScore(amount)` — daily or normal score, auto-save
- [x] `deductLife()` — lives--, auto-save, updateUI, checkFail
- [x] `_snapshot()` — serialisable state for Persistence

---

## Phase 5 — Integration

### 5.1 Persistence.js ✓
- [x] `constructor()` — KEY = vecto_colossal_mosaic_save_v5
- [x] `save(gameState)` — serialises GameController._snapshot() to localStorage
- [x] `load(sizesForLevel)` — deserialises V5, dimension guard via callback
- [x] `clear()` — removes V5 key
- [x] `serialize(gameState)` — plain object → V5 JSON shape
- [x] `deserialize(raw, sizesForLevel)` — rebuilds nodeOwner + typed arrays, returns null on stale

### 5.2 BoardLoader.js ✓
- [x] `constructor(data)` — receives BOARDS static object
- [x] `has(level)` — checks BOARDS[level] exists
- [x] `load(level)` — builds Grid + Path[] from BOARDS[level], reserves edges
- [x] `export(board, levelKey)` — serialises live board to boards-data.js string

### 5.3 DailyPuzzle.js ✓
- [x] `constructor(generator, gameController)`
- [x] `getSeed()` — YYYYMMDD integer seed
- [x] `getFormatted()` — locale date string
- [x] `load()` — today's result from localStorage (null if stale date)
- [x] `save(score)` — bestScore + attempts, returns { bestScore, attempts }
- [x] `start(containerEl)` — seeded RNG swap, generator.build(16,12,7), gc.startLevel
- [x] `end(score)` — save + populate result overlay DOM
- [x] `initSplash(savedProgress)` — populates splash screen DOM
- [x] `DailyPuzzle._mulberry32(seed)` — static deterministic PRNG

### 5.4 main.js ✓ (Entry Point)
- [x] All classes instantiated in dependency order inside IIFE
- [x] `loadBoard(level)` — prebuilt → persistence → dynamic generation fallback chain
- [x] `startNormalLevel(level)` — resize + attach input + start animation + startLevel
- [x] `window.startNormalGame` — HTML onclick bridge
- [x] `window.startDailyPuzzle` — HTML onclick bridge
- [x] `window.exitDailyPuzzle` — HTML onclick bridge
- [x] `window.triggerNextLevel` — HTML onclick bridge
- [x] `window.retryCurrentLevel` — HTML onclick bridge
- [x] `window.useHint` — HTML onclick bridge
- [x] `window.onload` — shows splash + loads pre-built level 100 behind it
- [x] No global State singleton — all state owned by GameController

---

## Phase 6 — Cleanup

- [x] Delete edge-gen.js → replaced by Grid, Path, RCBuilder, ZoneMap, SolvabilityOracle
- [x] Delete edge-logic.js → replaced by Validator, DifficultyEngine
- [x] Delete board-gen.js → replaced by Generator
- [x] Delete board-loader.js → replaced by BoardLoader class
- [x] Delete camera.js → replaced by Camera class
- [x] Delete renderer.js → replaced by Renderer, AnimationEngine
- [x] Delete input.js → replaced by InputHandler
- [x] Delete game-logic.js → replaced by GameController
- [x] Delete audio.js → replaced by AudioEngine
- [x] Delete persistence.js → replaced by Persistence class
- [x] Delete daily.js → replaced by DailyPuzzle
- [x] Delete state.js → no global State, split into classes
- [x] TFG pipeline removed (was in edge-gen.js, now deleted)
- [x] Warnsdorff dead code removed (was in edge-gen.js, now deleted)
- [x] index.html — old script tags replaced with 19 new class file tags + main.js
- [x] sandbox.html — old tags replaced, inline script rewritten using new classes
- [x] TFG test panel removed from sandbox.html (tfgPartition/Extract/Solvability deleted)
- [x] Shape Selector and PX-1 panels removed from sandbox.html (dead code)
- [ ] Verify 100% board coverage across 10 generated boards
- [ ] Verify solvability on all generated boards
- [ ] Verify path length 2–15 nodes enforced
- [ ] Verify persistence V5 save/load still works

---

## Key Design Decisions (locked)

| Decision | Choice |
|---|---|
| Global State | Removed — each class owns its data |
| validateRulebook at end | Removed — guaranteed by construction |
| Coverage guarantee | pocketCheck in growWalk (Phase A) |
| Path length range | 2 (Phase D last resort) to 15 (capped) |
| Solvability | rcBoardSolvable stays, inline per phase |
| Persistence format | V5 only, V2/V3/V4 fully removed |
| TFG pipeline | Fully removed |
| Warnsdorff pipeline | Fully removed |
| f factor in rcSampleLen | 1 (not 2) — keeps paths under 15 nodes |

---

## Coverage: 100% Guarantee Strategy

```
Phase A (growWalk)
  → pocketCheck before each step
  → if step would leave any neighbor with 0 free neighbors → skip
  → prevents isolated nodes from ever forming

Phase D
  → handles only genuine edge cases (board corners, etc.)
  → most boards reach 100% before Phase D runs

Result: 100% coverage guaranteed by construction
        not by repair
```
