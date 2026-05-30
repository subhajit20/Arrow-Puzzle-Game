# Arrow Game — Technical Features Summary

### Path Generation — Reverse Construction
- **Solvability by construction** — boards built backwards: each piece placed only when its head's straight exit ray is clear; solve order = reverse of placement. No solvability search, no retries, no fallback grid.
- Node-Hamiltonian model — each micro-grid intersection owned by at most one path; empty nodes are valid (~15–20% typical)
- Chain backbone — `rcBuildChain` places (depth+1) right-pointing length-2 pieces left-to-right; each blocked by its right neighbour → forced dependency chain of depth = chainDepth. Controls difficulty tier deterministically.
- Phase A fill — `rcFillA`: winding self-avoiding walks from interior-biased anchors, head-ray-clear test, difficulty bias on exit-ray length
- Phase B gap fill — `rcFillB`: small new pieces into empty pockets, both endpoints tried as head
- Phase C tail-append — `rcFillC`: isolated empty nodes appended to adjacent piece tails; each append validated with `rcBoardSolvable`, reverted LIFO if solvability breaks; `placeOrder` recomputed from fresh greedy clear
- Difficulty tier steering — `chainDepth` knob maps EASY→TITAN; `evaluateBoardComplexity` measures (`maxDepth × 3 + blockerRatio × 5.5 − freeRatio × 8`) as a label only, not a gate
- Aesthetic scoring — `computeAestheticScore`: length variance + turn distribution + visual balance; used as a soft accept criterion (≥0.40)
- Coverage floor ≥ 80% — ~85% average achieved; strict 100% invariant relaxed (required for solvability at scale)
- Post-build asserts — `validateBoardAsserts`: orthogonal-only steps, single-owner nodes, coverage floor; `isBoardFullySolvable` as a final guard (should never fire)

### Subcell Subdivision
- `subdivFactor = 2` — each root cell splits into a 2×2 micro routing grid
- Root grid drives screen fitting; micro grid drives path routing
- `subCellSize = cellSize / subdivFactor` — pixel pitch of micro-node step, auto-recalculated on resize
- All rendering, input, and collision operate on micro-grid coordinates

### Organic Appearance System (retained in `edge-gen.js`, not currently active)
The Warnsdorff trail generator and its full personality system are preserved in `edge-gen.js`
but are not wired into `_build100PackedLevelEdge` since the RC migration. They remain
available as a future shape-enhancement layer that could be layered on top of RC paths.
- Length tier queue — 25% SHORT / 50% MEDIUM / 25% LONG distribution per board, pre-planned
- Phase vocabulary — SWEEP / COIL / FLOW / COMPRESS with distinct turn pressure per phase
- Rhythm profiles — 6 named phase sequences assigned per trail (`flow`, `staccato`, `sweep-hook`, `breath`, `coil`, `arm-cluster-arm`)
- Handedness — CW / CCW rotational preference per trail (45/45/10 split)
- Momentum system — sigmoid turn pressure from `straightStreak`; pullback after 3+ consecutive turns
- Axis bias — H / V / neutral directional identity per trail (40/40/20 split)
- Trail personality object — all per-trail parameters packaged before each Warnsdorff walk
- Board-level diversity queues — guaranteed axis, handedness, and rhythm variety by design

The RC constructor (`rcGrowWalk`) currently uses a simpler turn-preference walk (turns score 1.0,
straights 0.4) without the full OA personality system.

### Difficulty & Level Progression
- Five difficulty tiers — EASY / NORMAL / HARD / EXPERT / TITAN
- Level-based tier caps — TITAN unlocks at L46+, EXPERT at L46+, HARD at L21+ (see `getAllowedTiersForLevel`)
- Tier steering via `chainDepth` knob in the RC constructor; measured by `evaluateBoardComplexity`
- Recent difficulty balancing — last 5 board tiers tracked to avoid streaks (`selectTargetDifficulty`)
- Level-aware grid sizing — portrait boards (2:1 ratio), root dims grow from 6×3 at L1 to 36×16 at L100 (see `getSizesForLevel`)

### Rendering
- Canvas 2D, no framework, no WebGL
- Zoom and pan via `ctx.translate` + `ctx.scale` — never CSS transform, always crisp
- Dot grid background at every micro-node intersection
- Polyline path rendering with sliding animation window
- Chevron arrowhead (two-triangle 3D shape), scales with `subCellSize`
- Blue glow shadow on selected path
- Red cell flash overlay on crashing path (8-frame duration)
- Confetti particle explosion on level win
- Camera shake on crash

### Camera
- Zoom range `minZoom` (dynamic, 40% of fit-zoom) to 6.0×
- Pan with board-edge clamping
- `minZoom` set dynamically per board so full board is always reachable
- Board entrance animation — fit-to-overview then ease to 1.35× zoom (cubic ease-in-out, 1100ms)
- Staggered path reveal animation before camera zoom-in

### Input
- Edge-proximity tap detection — nearest `hEdge`/`vEdge` midpoint within `cellSize × 0.7` hit radius
- Touch pan — single finger drag
- Pinch zoom — two finger spread/squeeze anchored at midpoint
- Mouse drag pan + scroll wheel zoom anchored at cursor
- Double-tap camera reset button

### Audio
- Web Audio API procedural synthesis, no audio files
- Lazy `AudioContext` init on first user gesture
- 5 sound events — tap, clear, crash, win, hint tone

### Game Logic
- 3 lives — each crash costs one, 0 lives triggers fail overlay
- Score — +10 per cleared path, +100 per level win
- Hint — highlights the most-unblocked IDLE path
- Skip level, Retry level, Cycle board size

### Persistence
- V4 save format — subdivision-aware, survives reload
- V3 / V2 silently discarded on load (incompatible coordinate space)
- Dimension guard in `_loadV4` — saves with `rootRows/rootCols` outside `getSizesForLevel(level)` are discarded (catches old forward-pipeline fallback saves with a stale 10×12 grid)
- `nodeOwner` rebuilt from `paths.nodes` on every load (not persisted)
- Daily puzzle saves best score and attempt count separately

### Daily Puzzle
- `mulberry32` seeded PRNG keyed to today's date — deterministic board per day
- Fixed at level 7 difficulty, "Auto" preset
- Separate score tracking — does not affect regular game progress
- Splash screen mode selector between Regular and Daily
