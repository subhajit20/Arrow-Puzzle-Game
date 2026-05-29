# Arrow Game — Technical Features Summary

### Path Generation
- Node-Hamiltonian graph model — each micro-grid intersection owned by exactly one path
- Warnsdorff self-avoiding walk for trail generation
- Trail fragmentation into puzzle-length segments with turn-scoring
- Chevron Self-Collision Guard — forward ray evaluation for arrowhead endpoint selection
- DAG dependency chain construction — headings flipped to create solve-order dependencies
- Unjamming pass — resolves deadlock cycles in the dependency graph
- Greedy solvability simulation — boards failing full solve are rejected and retried
- Complexity scoring — `maxDepth × 3 + blockerRatio × 5.5 − freeRatio × 8`
- Aesthetic scoring filter — length variance + turn distribution + visual balance composite score
- Up to 20 generation attempts per board with hard fallback grid on total failure
- Graceful failure recovery — on total generation failure, old board is preserved, level counter rolls back

### Subcell Subdivision
- `subdivFactor = 2` — each root cell splits into a 2×2 micro routing grid
- Root grid drives screen fitting; micro grid drives path routing
- `subCellSize = cellSize / subdivFactor` — pixel pitch of micro-node step, auto-recalculated on resize
- All rendering, input, and collision operate on micro-grid coordinates

### Organic Appearance System
- Length tier queue — 25% SHORT / 50% MEDIUM / 25% LONG distribution per board, pre-planned
- Phase vocabulary — SWEEP / COIL / FLOW / COMPRESS with distinct turn pressure per phase
- Rhythm profiles — 6 named phase sequences assigned per trail (`flow`, `staccato`, `sweep-hook`, `breath`, `coil`, `arm-cluster-arm`)
- Handedness — CW / CCW rotational preference per trail (45/45/10 split)
- Momentum system — sigmoid turn pressure from `straightStreak`; pullback after 3+ consecutive turns
- Axis bias — H / V / neutral directional identity per trail (40/40/20 split)
- Trail personality object — all per-trail parameters packaged before each Warnsdorff walk
- Board-level diversity queues — guaranteed axis, handedness, and rhythm variety by design

### Difficulty & Level Progression
- Five difficulty tiers — EASY / NORMAL / HARD / EXPERT / TITAN
- Level-based tier caps — TITAN unlocks at 30+, EXPERT at 20+, HARD at 10+
- Recent difficulty balancing — last 5 board tiers tracked to avoid streaks
- Level-aware grid sizing — board dimensions grow from 8×6 at level 1 to 26×20 at high levels

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
- `nodeOwner` rebuilt from `paths.nodes` on every load (not persisted)
- Daily puzzle saves best score and attempt count separately

### Daily Puzzle
- `mulberry32` seeded PRNG keyed to today's date — deterministic board per day
- Fixed at level 7 difficulty, "Auto" preset
- Separate score tracking — does not affect regular game progress
- Splash screen mode selector between Regular and Daily
