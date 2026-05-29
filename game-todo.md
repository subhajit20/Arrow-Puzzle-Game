# Arrow Game — Edge-Based Engine Migration TODO

Each step requires explicit approval before starting.
Do NOT begin the next step until the current one is confirmed complete and approved.

---

## STEP 1 — Graph Construction + Odd-Degree Pairing
**File:** `js/edge-gen.js` (new file)
- Allocate `hEdge[ROWS+1][COLS]` and `vEdge[ROWS][COLS+1]` arrays (all -1)
- Compute `degree[r][c]` for every node based on grid bounds
- Identify all odd-degree nodes (degree-3 border non-corner nodes)
- Greedy nearest-neighbour pairing → output N/2 (start, end) pairs

**Approval required before Step 2**

---

## STEP 2 — Edge-Warnsdorff Trail Generation
**File:** `js/edge-gen.js` (continue)
- For each (start, end) pair, walk via unvisited edges using Warnsdorff heuristic
- Score = free edges at destination (lower = preferred) + small random jitter
- Bridge guard: detect and avoid moves that isolate remaining free edges
- Reserve each traversed edge with path ID in hEdge/vEdge
- **Test in test.html:** render all 906 edges, each trail in a different colour, zero white edges remaining

**Approval required before Step 3**

---

## STEP 3 — Residual Edge Cleanup
**File:** `js/edge-gen.js` (continue)
- After all trails generated, scan for any remaining free edges (-1)
- Group free edges into connected components
- Attach each component to nearest trail endpoint or create new micro-path
- **Test in test.html:** assert zero free edges, all hEdge/vEdge ≥ 0, log confirmation

**Approval required before Step 4**

---

## STEP 4 — Path Fragmentation
**File:** `js/edge-gen.js` (continue)
- Split long trails into puzzle-length segments using scored cut-point selection
- Turn scoring: 0 turns = -0.5 / 1 turn = +0.5 / 2 turns = +2.0 / 3+ turns = +2.8
- Enforce minimum segment length = 3 nodes
- Apply level-based target lengths (short early levels, longer late levels)
- **Test in test.html:** show 60–120 coloured paths, display shape distribution stats (straight / L / S-Z-U / spiral / serpentine counts)

**Approval required before Step 5**

---

## STEP 5 — Heading Assignment
**File:** `js/edge-gen.js` (continue)
- Evaluate both endpoints of each path as candidate arrowhead positions
- Apply chevron self-collision guard (same logic as current `assignSmartHeadings`)
- Assign `heading` field (UP / DOWN / LEFT / RIGHT) from direction of last two nodes
- **Test in test.html:** render arrowheads at path heads, verify no arrowhead immediately faces its own body

**Approval required before Step 6**

---

## STEP 6 — DAG Dependency Construction
**File:** `js/edge-logic.js` (new file)
- Port `buildDAGHeadings` logic to work on `path.nodes` instead of `path.points`
- 6 passes: flip free paths to point at other paths' bodies
- Cycle guard before each flip to prevent deadlocks
- **Test in test.html:** log dependency depth stats, confirm < 5% free paths, max chain depth ≥ 3

**Approval required before Step 7**

---

## STEP 7 — Unjamming Pass
**File:** `js/edge-logic.js` (continue)
- Port `runUnjammingSolvabilityTweak` to edge-based model
- 5 passes: detect deadlock cycles, flip stuck paths if reversal resolves
- Run after DAG construction
- **Test in test.html:** run 100 boards, log how many needed unjamming

**Approval required before Step 8**

---

## STEP 8 — Solvability Validation
**File:** `js/edge-logic.js` (continue)
- Port `isBoardFullySolvable` to edge-based model
- Greedy simulation: iteratively clear paths whose escape corridor is unblocked
- Own-edges transparent invariant preserved
- Reject board if any paths remain after simulation
- **Test in test.html:** generate 50 boards, log pass/fail rate, target 100% pass after unjamming

**Approval required before Step 9**

---

## STEP 9 — Complexity Scoring
**File:** `js/edge-logic.js` (continue)
- Port `evaluateBoardComplexity` to edge-based model
- Score = maxDepth × 3 + blockerRatio × 5.5 - freeRatio × 8
- Level-based threshold: reject if below minimum score
- **Test in test.html:** show complexity score per board, verify scores increase with level

**Approval required before Step 10**

---

## STEP 10 — Wire Renderer
**File:** `js/renderer.js` (edit)
- Change `fullTrack` to read from `path.nodes` directly (no center-offset conversion)
- Node (r,c) → canvas pixel `(ox + c × cellSize, oy + r × cellSize)`
- Update dashed preview line to use node coordinates
- Draw grid lines as board background
- **Test in index.html:** open game, verify paths render on cell border lines, arrowheads correct, animation works

**Approval required before Step 11**

---

## STEP 11 — Wire Collision Detection
**File:** `js/renderer.js` + `js/edge-logic.js` (edit)
- Replace cell-based leading-cell check with edge-based leading-edge check
- During MOVING: check hEdge/vEdge at the leading node for foreign path ownership
- Crash and clear logic unchanged
- **Test in index.html:** tap path, fire it, verify it crashes into blockers correctly and clears when path is free

**Approval required before Step 12**

---

## STEP 12 — Wire Input Detection
**File:** `js/input.js` (edit)
- Replace cell-proximity tap with edge-proximity tap
- Tap at pixel → find nearest hEdge or vEdge midpoint within hit radius
- Return owner path ID
- **Test in index.html:** tap every path on a generated board, verify correct path selected every time

**Approval required before Step 13**

---

## STEP 13 — Wire Persistence V3
**File:** `js/persistence.js` (edit)
- Version bump: V2 → V3
- Serialize `path.nodes`, `hEdge`, `vEdge` instead of `path.points`, `gridMask`
- Silently discard V2 saves (incompatible format)
- **Test in index.html:** complete a level, reload page, verify board state restored correctly

**Approval required before Step 14**

---

## STEP 14 — Wire Build Pipeline to Main Game ✅
**File:** `js/board-gen.js` (edit) + `js/state.js` (edit)
- Add `State.hEdge`, `State.vEdge` fields
- Replace `build100PackedLevel` internals with edge-gen.js pipeline
- Keep feature flag `USE_EDGE_GEN = true` for instant rollback
- **Test in index.html:** play through levels 1–10, verify boards generate correctly, all sizes work

---

## STEP 14A — Rewrite Trail Generator: Node-Hamiltonian Cover Model

**Why this is needed:**
The current engine is **Edge-Eulerian** — it covers every edge exactly once, but nodes can be shared by multiple trails. The user-required model is **Node-Hamiltonian** — each intersection node belongs to exactly one path.

These two models are mathematically incompatible in a rectangular grid (interior degree-4 nodes can only contribute 2 edges per self-avoiding path; the other 2 edges would need a second path that also "visits" the node — contradiction). The node-exclusive model wins. Grid lines become background; only edges that are part of paths are drawn as path lines.

**Files:** `js/edge-gen.js`

**Changes:**

1. `buildEdgeGraph`: add `nodeOwner` — flat `Int32Array` of size `(rows+1)*(cols+1)` filled with `-1`. Index: `r*(cols+1)+c`.

2. Replace `getFreeNeighbors(graph, r, c)` with `getFreeNeighborNodes(graph, r, c)`:
   - Returns orthogonal neighbors where `graph.nodeOwner[nb.r*(cols+1)+nb.c] === -1` (node is unclaimed)
   - No longer checks hEdge/vEdge — the edge is implicitly free if the destination node is free

3. Rewrite `walkWarnsdorff(graph, startNode, pathId)` — **remove `endNode` parameter**:
   - Remove per-walk `inTrail` array; use `graph.nodeOwner` as the global visited-node tracker
   - On start: `graph.nodeOwner[startNode.r*(cols+1)+startNode.c] = pathId`
   - At each step: call `getFreeNeighborNodes`; score each by count of ITS free neighbor nodes (Warnsdorff); pick lowest score + jitter
   - On move to `(nr, nc)`: `graph.nodeOwner[nr*(cols+1)+nc] = pathId`
   - Stop when no free neighbor nodes remain
   - Return visited node sequence

4. Rewrite `generateTrails(graph)` — **remove `pairs` parameter**:
   - Remove pair-based loop entirely (no more odd-degree pairing)
   - New loop: scan nodes in row-major order; for each node where `nodeOwner[r][c] === -1`, call `walkWarnsdorff(graph, {r,c}, nextId++)` and push result to `trails`
   - Continue until all `(rows+1)*(cols+1)` nodes are owned
   - Return `{ trails, nextId }`

5. After all trails are generated: derive hEdge/vEdge from each trail's node sequence by calling `reserveEdge` for every consecutive pair. (hEdge/vEdge are now derived, not primary.)

6. Update `forwardRayClearSteps(pathId, startNode, heading, graph)`:
   - Replace edge-owner check with: `if (graph.nodeOwner[nr*(cols+1)+nc] === pathId) break;`
   - Self-collision is now "own node ahead" not "own edge ahead"

7. **Remove** (no longer needed): `getOddDegreeNodes`, `pairOddNodes`, `findFreeEdgeComponents`, `residualCleanup`

**Test:** Generate 20 boards at 10×12. Assert:
- `countFreeNodes(graph) === 0` after generation (all nodes owned)
- No node owned by two different trails
- All path node sequences are valid orthogonal steps (no diagonal)
- At least 8 distinct paths per board

**Approval required before Step 14B**

---

## STEP 14B — Wire State.nodeOwner + Fix Runtime Collision

**Files:** `js/state.js`, `js/board-gen.js`, `js/persistence.js`, `js/renderer.js`, `js/edge-logic.js`

**Changes:**

1. `state.js`: add `nodeOwner: null` field (rebuilt from paths, not persisted)

2. `board-gen.js` (`_build100PackedLevelEdge`): after `fragmentAllTrails`, build `State.nodeOwner`:
   ```js
   const W = cols + 1;
   State.nodeOwner = new Int32Array((rows + 1) * W).fill(-1);
   for (const p of State.paths)
       for (const {r, c} of p.nodes)
           State.nodeOwner[r * W + c] = p.id;
   ```

3. `persistence.js` (`_loadV3`): rebuild `State.nodeOwner` from loaded paths using the same formula after restoring `State.paths`

4. `renderer.js` (`animationUpdateTick` edge-based collision branch): replace `getLeadingEdgeOwner` check with node-owner check:
   - Leading node: `{ r: headNode.r + dr, c: headNode.c + dc }` (one step ahead of path head)
   - Check `State.nodeOwner[leadR * W + leadC]`
   - If value is a path id other than `p.id` AND that path is not CLEARED/MOVING → crash

5. `edge-logic.js` (`canEscapeEdge`): update escape-corridor check to walk forward node-by-node using `State.nodeOwner` instead of hEdge/vEdge edge ownership

6. `edge-logic.js` (`getLeadingEdgeOwner`): can be removed or kept as a no-op since renderer now uses nodeOwner directly

**Test:**
- Fire a path into another path's body → crash triggers correctly
- Fire a path into open space → clears correctly
- Reload saved state → nodeOwner rebuilt, collisions still work
- Solvability simulation still passes 100% on 50 generated boards

**Approval required before Step 15**

---

## STEP 15 — Full Game Sweep + All Grid Sizes
**Files:** integration testing
- Test all preferred grid sizes: 8×10, 10×12, 10×14, 12×16, 14×18, 16×20, 18×24, 20×26
- Test levels 1 through 60
- Verify: generation speed < 500ms, no crashes, solvability 100%, shape variety visible
- Fix any edge cases found
- **Test:** play 20+ levels across different grid sizes, confirm puzzle quality feels premium

**Approval required before Step 16**

---

## STEP 16 — Remove Old Cell Engine + Final Cleanup
**Files:** `js/board-gen.js`, `js/game-logic.js` (cleanup)
- Remove cell-based generation functions from board-gen.js
- Remove cell-based collision/solvability from game-logic.js
- Remove feature flag
- Update CLAUDE.md with new architecture
- Update game-todo.md — mark all steps complete
- **Final test:** full game play session, daily puzzle, save/load, all UI flows

---

---

# SUBCELL SUBDIVISION PLAN

**Design principle:** Root grid defines visual layout and screen fitting. Micro-grid (root × subdivFactor) is the actual path routing space. The board occupies the same physical screen rectangle — only internal routing resolution increases. Paths can make tighter turns, produce richer shapes, at the same visual board size.

**Key scalars:**
- `State.rootRows / rootCols` — from `getSizesForLevel`, visual grid, used for screen fitting
- `State.subdivFactor = 2` — constant; each root axis is split into 2 micro-units
- `State.gridRows = rootRows × subdivFactor` — micro routing grid
- `State.gridCols = rootCols × subdivFactor`
- `State.cellSize` — root cell pixel size, screen-fitting unchanged
- `State.subCellSize = cellSize / subdivFactor` — micro-node pixel pitch used by renderer and input

Each step requires explicit approval before starting.

---

## STEP SD-1 — Add Subdivision Scalars to State
**File:** `js/state.js`

Add four new fields to the `State` object:

```js
rootRows:    0,   // root grid rows — visual grid (from getSizesForLevel)
rootCols:    0,   // root grid cols — visual grid
subdivFactor: 2,  // subdivision per root-cell axis; 2 → 2×2 micro-cells per root cell
subCellSize:  0,  // pixel pitch of micro-grid nodes = cellSize / subdivFactor
```

- `gridRows` and `gridCols` semantics change: they now hold the **micro-grid** dimensions (`rootRows × subdivFactor`). Document this in a comment.
- No other logic changes in this step.

**Test:** Open game, verify no JS errors on load.

**Approval required before SD-2**

---

## STEP SD-2 — Fix Screen Fitting in Camera
**File:** `js/camera.js`

Three functions reference `State.gridCols / gridRows` for board pixel dimensions. All must switch to `rootCols / rootRows` so the visual board stays the same size after `gridRows/Cols` doubles.

### `calculateMetrics(w, h)`
Currently:
```js
const cellByWidth  = availW / State.gridCols;
const cellByHeight = availH / State.gridRows;
```
Change to:
```js
const cellByWidth  = availW / State.rootCols;
const cellByHeight = availH / State.rootRows;
```
Also add at the end of `calculateMetrics` (after `cellSize` is set):
```js
State.subCellSize = State.cellSize / (State.subdivFactor || 1);
```
This makes `subCellSize` auto-update on every resize.

### `applyBoardTransform()`
Change:
```js
const boardW = State.gridCols * State.cellSize;
const boardH = State.gridRows * State.cellSize;
```
To:
```js
const boardW = State.rootCols * State.cellSize;
const boardH = State.rootRows * State.cellSize;
```

### `startCameraEntranceAnimation()`
Same change: `gridCols/gridRows * cellSize` → `rootCols/rootRows * cellSize` in the `boardW/boardH` computation.

### `startPathRevealAnimation()`
Same change in its `boardW/boardH` computation.

**Guard:** Both desktop and mobile branches of `calculateMetrics` need the fix. Desktop branch:
```js
State.cellSize = Math.min(w / State.rootCols, h / State.rootRows);
```

**Test:** Confirm board still fills screen correctly before any generation change is wired. Temporarily hardcode `State.rootRows = State.gridRows; State.rootCols = State.gridCols` at the top of `calculateMetrics` as a no-op shim to verify rendering is unchanged.

**Approval required before SD-3**

---

## STEP SD-3 — Wire Board Generation
**File:** `js/board-gen.js`

### `_build100PackedLevelEdge`

**1. After `getSizesForLevel` pick**, replace the current assignments:
```js
// Before:
State.gridRows = size.rows;
State.gridCols = size.cols;

// After:
State.rootRows  = size.rows;
State.rootCols  = size.cols;
State.gridRows  = size.rows * State.subdivFactor;
State.gridCols  = size.cols * State.subdivFactor;
State.gridSize  = size.rows;  // unchanged — cosmetic only
```

Also update `gridMask` to use root dimensions (edge engine ignores it, but keep it consistent):
```js
State.gridMask = Array.from({ length: size.rows }, () => new Array(size.cols).fill(1));
```

**2. `maxTrailLen` calculation.** Currently:
```js
const maxTrailLen = Math.max(10, getTargetLength(level, rows, cols) * 2);
```
`rows/cols` are now micro-grid. Pass root dimensions and multiply by `subdivFactor`:
```js
const maxTrailLen = Math.max(
    10 * State.subdivFactor,
    getTargetLength(level, State.rootRows, State.rootCols) * State.subdivFactor * 2
);
```

**3. Pass `subdivFactor` to `generateTrails`:**
```js
const { trails } = generateTrails(graph, maxTrailLen, State.subdivFactor);
```

**4. Hard fallback block.** Root dimensions are `FB_R = 10, FB_C = 12`. Micro dimensions are `FB_R * subdivFactor` etc:
```js
const FB_ROOT_R = 10, FB_ROOT_C = 12;
const FB_R = FB_ROOT_R * State.subdivFactor;
const FB_C = FB_ROOT_C * State.subdivFactor;
State.rootRows = FB_ROOT_R; State.rootCols = FB_ROOT_C;
State.gridRows = FB_R; State.gridCols = FB_C;
State.gridSize = FB_ROOT_R;
State.gridMask = Array.from({ length: FB_ROOT_R }, () => new Array(FB_ROOT_C).fill(1));
```
Update `fbMaxTrailLen` similarly using root dimensions.

**5. After `resizeCanvas()` call** (which now computes `cellSize` from rootRows/Cols), set:
```js
// subCellSize is set inside calculateMetrics, but ensure it's available immediately
// (calculateMetrics already does this after SD-2)
```
No extra code needed — `calculateMetrics` handles it.

**Test:** Open game, advance levels 1-10. Board should generate without JS errors. Micro-grid is 2× larger but board appears same size. Path shapes should be visibly finer.

**Approval required before SD-4**

---

## STEP SD-4 — Fix Generator Style Scaling
**File:** `js/edge-gen.js`

### `generateTrails(graph, maxTrailLen, subdivFactor)`
Add `subdivFactor` parameter (default 1 for backward compatibility).

Scale `maxStraight` by `subdivFactor` so turn frequency stays the same in physical (root-cell) terms:
```js
const f = subdivFactor || 1;
const maxStraight = rnd < 0.10 ? 99       // STRAIGHT: effectively no cap
                  : rnd < 0.30 ? 4 * f   // L/U: forced turn every 4 root cells
                  :               2 * f; // COMPLEX: forced turn every 2 root cells
```
Without this, every path would be forced to turn every micro-step (every half root cell), making all paths look like dense zigzags.

### `getTargetLength(level, rows, cols)`
Add a documentation comment: `rows/cols` are **root-cell dimensions**, not micro-grid. The caller in `board-gen.js` multiplies the result by `subdivFactor` to get the micro-node target.

No logic change in the function body.

**Test:** Generate 20 boards at level 5 and level 20. Shape distribution should visually match the 70/20/10 complex/L-U/straight target. Shapes should not all be dense zigzags.

**Approval required before SD-5**

---

## STEP SD-5 — Renderer: Dot Grid + subCellSize
**File:** `js/renderer.js`

This is the largest change. Every pixel calculation that uses `State.cellSize` for path/node positioning must switch to `State.subCellSize`. The board background rectangle stays in root-cell units.

### Replace grid line block with dot grid

Remove:
```js
ctx.strokeStyle = '#e2e8f0';
ctx.lineWidth = 0.5;
for (let r = 0; r <= rows; r++) { ... }
for (let c = 0; c <= cols; c++) { ... }
```

Replace with:
```js
// Background fill uses root-cell dimensions (visual board size unchanged)
ctx.fillStyle = "#ffffff";
ctx.fillRect(ox, oy, State.rootCols * State.cellSize, State.rootRows * State.cellSize);

// Dot at every micro-node intersection
const sCS  = State.subCellSize;
const dotR = Math.max(0.8, sCS * 0.07);
ctx.fillStyle = "#cbd5e1";
for (let r = 0; r <= State.gridRows; r++) {
    for (let c = 0; c <= State.gridCols; c++) {
        ctx.beginPath();
        ctx.arc(ox + c * sCS, oy + r * sCS, dotR, 0, Math.PI * 2);
        ctx.fill();
    }
}
```

### Update all path pixel calculations

Replace all occurrences of `cSize` (which was `State.cellSize`) with `sCS` (`State.subCellSize`) in:

- `fullTrack` pixel coords: `ox + pt.c * sCS` / `oy + pt.r * sCS`
- `pxOff` for node-based paths: remains `0` (nodes are at intersections, not centers)
- Line width: `Math.max(1, sCS * 0.08)`
- Arrowhead `pyramidSize`: `Math.max(3.0, sCS * 0.32)`
- Clip padding: `Math.ceil(sCS * 0.6)`
- Dashed preview line dash params: `sCS * 0.18`, `sCS * 0.14`
- Dashed preview line endpoint: `hx + dc * steps * sCS`, `hy + dr * steps * sCS`
- Crash flash rect: `ox + pt.c * sCS, oy + pt.r * sCS, sCS, sCS`
- Tail extension `fullTrack.push` coords: `(lastPt.c + dc * j) * sCS`

### `maxR / maxC` bounds for IDLE forward steps
These already use `State.gridRows / gridCols` which are now micro-grid — correct, no change needed.

### Board white fill
Change the board background fill line (above the grid loop) to use root dimensions:
```js
ctx.fillRect(ox, oy, State.rootCols * State.cellSize, State.rootRows * State.cellSize);
```
(The dot loop replaces the old grid line loop, so `cols * cSize` for the fill must become `rootCols * cellSize`.)

**Test:** Open game, verify:
- Board same physical screen size as before
- Dot grid visible instead of grid lines
- Paths draw at finer resolution (more turns visible in same space)
- Arrowheads correct size, not oversized

**Approval required before SD-6**

---

## STEP SD-6 — Fix Input Detection
**File:** `js/input.js`

### `findPathByEdgeTap(canvasX, canvasY, hitRadius)`

Edge midpoint pixel positions use `cSize = State.cellSize` — this must become `State.subCellSize`:

```js
// Before:
const cSize = State.cellSize;
// hEdge midpoint: ox + (c + 0.5) * cSize
// vEdge midpoint: ox + c * cSize

// After:
const sCS = State.subCellSize;
// hEdge midpoint: ox + (c + 0.5) * sCS
// vEdge midpoint: ox + c * sCS
```

The function iterates `r ∈ [0, rows]` and `c ∈ [0, cols]` where `rows/cols = State.gridRows/gridCols` (micro). This is already correct — no change needed to the loop bounds.

### Hit radius at call sites

Three call sites pass `cSize * 0.7` or `cSize * 0.6` as `hitRadius`. These should stay in root-cell units (comfortable finger tap area):

```js
// touchend:
const hitR = State.cellSize * 0.7;   // root-cell unit — unchanged

// mouseup:
const hitR = State.cellSize * 0.7;   // unchanged

// mousemove hover:
const hitR = State.cellSize * 0.6;   // unchanged
```

This keeps tap targets finger-sized even though the routing grid is finer.

**Test:** Tap every path on a generated board. All paths should be selectable. No path should require precise micro-cell tapping to activate.

**Approval required before SD-7**

---

## STEP SD-7 — Persistence V4
**File:** `js/persistence.js`

V3 saves are incompatible: V3 stored `gridRows/gridCols` as root-cell values. After subdivision, `gridRows/gridCols` are micro values. V3 `path.nodes` coordinates are root-cell space; V4 nodes are micro space. Silently discard V3 and V2.

### New key
```js
_KEY_V4: 'vecto_colossal_mosaic_save_v4',
```

### `saveState()`
Prefer V4 when `State.rootRows` is set:
```js
saveState() {
    if (State.dailyPuzzleMode) return;
    try {
        if (State.rootRows) {
            this._saveV4();
        } else if (State.hEdge && State.vEdge) {
            this._saveV3();
        } else {
            this._saveV2();
        }
    } catch (e) { ... }
}
```

### `_saveV4()`
Save `rootRows`, `rootCols`, `subdivFactor` in addition to all V3 fields. `gridRows/gridCols` = micro dimensions:
```js
_saveV4() {
    const data = {
        version:      4,
        rootRows:     State.rootRows,
        rootCols:     State.rootCols,
        subdivFactor: State.subdivFactor,
        gridRows:     State.gridRows,    // = rootRows * subdivFactor
        gridCols:     State.gridCols,    // = rootCols * subdivFactor
        level:        State.level,
        score:        State.score,
        lives:        State.lives,
        gridSize:     State.gridSize,
        shapeName:    State.shapeName,
        gridSizePreset: State.gridSizePreset,
        boardDifficulty: State.boardDifficulty,
        recentDifficulties: State.recentDifficulties,
        hEdge: State.hEdge.map(row => Array.from(row)),
        vEdge: State.vEdge.map(row => Array.from(row)),
        paths: State.paths.map(p => ({
            id: p.id, nodes: p.nodes, heading: p.heading,
            state: p.state, animProgress: p.animProgress,
            originalNodes: p.originalNodes
        }))
    };
    localStorage.setItem(this._KEY_V4, JSON.stringify(data));
}
```

### `_loadV4()`
Validate `rootRows/rootCols/subdivFactor`. Derive micro dimensions. Rebuild `nodeOwner`:
```js
_loadV4() {
    const raw = localStorage.getItem(this._KEY_V4);
    if (!raw) return false;
    try {
        const s = JSON.parse(raw);
        if (s.version !== 4)          return false;
        if (!s.rootRows || !s.rootCols) return false;
        if (!s.subdivFactor)          return false;
        if (!s.paths || !s.paths.every(p => Array.isArray(p.nodes))) return false;

        State.rootRows    = s.rootRows;
        State.rootCols    = s.rootCols;
        State.subdivFactor = s.subdivFactor;
        State.gridRows    = s.rootRows * s.subdivFactor;
        State.gridCols    = s.rootCols * s.subdivFactor;
        // ... restore all other fields ...

        State.hEdge = s.hEdge.map(row => new Int32Array(row));
        State.vEdge = s.vEdge.map(row => new Int32Array(row));
        State.paths = s.paths.map(p => ({ ...p, animProgress: 0, crashFlashFrames: 0 }));

        const _W = State.gridCols + 1;
        State.nodeOwner = new Int32Array((State.gridRows + 1) * _W).fill(-1);
        for (const p of State.paths)
            for (const { r, c } of p.nodes)
                State.nodeOwner[r * _W + c] = p.id;

        return true;
    } catch (e) { return false; }
}
```

### `loadState()`
```js
loadState() {
    if (this._loadV4()) return true;
    // V3 and V2 silently discarded — incompatible node coordinate space
    return false;
}
```

**Test:**
- Complete a level, reload page — board restored correctly
- V3 save (if present) silently discarded, new game starts
- `nodeOwner` correct after load, collisions work

**Approval required before SD-8**

---

## STEP SD-8 — Integration Sweep
**Files:** integration testing

Verify the full system end-to-end with subdivision active.

**Board size check:**
- Levels 1-5 (root 8×6 to 12×10): board same physical size as pre-subdivision. Micro-grid 16×12 to 24×20.
- Levels 50+ (root 24×18 to 26×20): micro-grid 48×36 to 52×40. Generation must complete in < 700ms.

**Shape quality check:**
- Paths must visibly route through sub-root-cell geometry — tight turns within a single root cell are now possible and should appear regularly.
- 70/20/10 complex/L-U/straight distribution preserved.

**Interaction check:**
- Tap all paths on a board — correct selection, no dead zones.
- Fire paths — correct crash detection and clear behaviour.
- Pan and zoom — board dimensions and camera behaviour correct.

**Persistence check:**
- Save, reload, resume — V4 save/load works.
- Old V3 save in localStorage — silently discarded, fresh generation starts.

**Collision check:**
- `State.nodeOwner` uses micro-grid coordinates. Confirm leading node check `head.r + dr * (steps+1)` resolves to micro-node boundaries, not root-cell boundaries.

**Fix any issues found before declaring complete.**

**Approval required before Step 15**

---

## STATUS

| Step | Description                        | Status  |
|------|------------------------------------|---------|
| 1    | Graph + Pairing                    | ✅ done  |
| 2    | Edge-Warnsdorff                    | ✅ done  |
| 3    | Residual Cleanup                   | ✅ done  |
| 4    | Fragmentation                      | ✅ done  |
| 5    | Heading Assignment                 | ✅ done  |
| 6    | DAG Construction                   | ✅ done  |
| 7    | Unjamming                          | ✅ done  |
| 8    | Solvability Validation             | ✅ done  |
| 9    | Complexity Scoring                 | ✅ done  |
| 10   | Wire Renderer                      | ✅ done  |
| 11   | Wire Collision                     | ✅ done  |
| 12   | Wire Input                         | ✅ done  |
| 13   | Wire Persistence V3                | ✅ done  |
| 14   | Wire Build Pipeline                | ✅ done  |
| 14A  | Node-Hamiltonian Generation        | ✅ done  |
| 14B  | State.nodeOwner + Runtime Fix      | ✅ done  |
| SD-1 | State Subdivision Scalars          | ✅ done  |
| SD-2 | Camera / Screen Fitting Fix        | ✅ done  |
| SD-3 | Board Generation Wiring            | ✅ done  |
| SD-4 | Generator Style Scaling            | ✅ done  |
| SD-5 | Renderer: Dot Grid + subCellSize   | ✅ done  |
| SD-6 | Input Detection Fix                | ✅ done  |
| SD-7 | Persistence V4                     | ✅ done  |
| SD-8 | Integration Sweep                  | pending |
| 15   | Full Game Sweep                    | pending |
| 16   | Cleanup + Final                    | pending |
| OA-1 | Explicit Length Tier Distribution  | ✅ done  |
| OA-2 | Trail Personality Object           | ✅ done  |
| OA-3 | Phase Vocabulary + Rhythm Profiles | ✅ done  |
| OA-4 | Handedness-Aware Turn Selection    | ✅ done  |
| OA-5 | Momentum System                    | ✅ done  |
| OA-6 | Axis Bias on Warnsdorff Ranking    | ✅ done  |
| OA-7 | Aesthetic Scoring Filter           | ✅ done  |
| OA-8 | Board Diversity Enforcement        | ✅ done  |

---

---

# ORGANIC APPEARANCE SYSTEM (Stage 2 — Shape-Aware Traversal)

Goal: evolve the router so paths feel artistically composed, not algorithmically generated.
Implementation order: OA-1 → OA-3 → OA-4 → OA-5 → OA-6 → OA-2 → OA-7 → OA-8

Each step requires explicit approval before starting.

---

## STEP OA-1 — Explicit Length Tier Distribution
**File:** `js/board-gen.js`

The #1 visible problem: all fragments land at roughly the same length, producing uniform visual weight across every board.

**Changes:**
- Define three length tiers: SHORT (4–8 subcells), MEDIUM (10–18 subcells), LONG (22–35 subcells)
- Define a target distribution per board: ~25% short, ~50% medium, ~25% long
- In `fragmentAllTrails` (or equivalent), assign each fragment a length tier from the distribution instead of all fragments targeting the same `getTargetLength` value
- Tier assignment is pre-planned before fragmentation begins — not random per fragment

**Visual result:** boards with clear size hierarchy — a few long anchor paths, majority medium paths, short connector paths filling gaps.

**Approval required before OA-3**

---

## STEP OA-2 — Trail Personality Object
**File:** `js/edge-gen.js`

Package all per-trail state introduced in OA-3 through OA-6 into one clean object attached to each trail before `walkWarnsdorff` is called.

**Object shape:**
```js
trailPersonality = {
    axisBias:      'H' | 'V' | 'neutral',  // 40/40/20 split
    handedness:    1 | -1,                  // clockwise / counterclockwise
    rhythmProfile: 'sweep-hook' | 'coil' | 'breath' | 'staccato' | 'flow' | 'compress',
    currentPhase:  0,                       // index into phase schedule
    straightStreak: 0,                      // consecutive straight steps
    turnStreak:    0,                       // consecutive turn steps
    momentum:      0                        // net behavioral pressure scalar
}
```

**Note:** Done AFTER OA-3 through OA-6 are working as loose parameters — this step is cleanup/formalization only.

**Approval required before OA-7**

---

## STEP OA-3 — Phase Vocabulary + Rhythm Profiles
**File:** `js/edge-gen.js`

Replace the single fixed `maxStraight` / `turnBonus` per trail with a phase schedule that changes behavior over the trail's lifetime.

**Phase constants:**
- SWEEP: high maxStraight (6–10×f), weak turnBonus (0.3) → long arms and runs
- COIL: low maxStraight (1–2×f), strong turnBonus (2.0) → tight winding sections
- FLOW: very high maxStraight (99), near-zero turnBonus (0.1) → almost straight bridges
- COMPRESS: medium maxStraight (3–5×f), moderate turnBonus (1.0) → transitional

**Rhythm profiles (phase sequences):**
- `staccato`: [COMPRESS] — single phase, current default behavior
- `sweep-hook`: [SWEEP, COIL] — long run into tight end
- `breath`: [FLOW, COIL, FLOW] — straight → complex middle → straight
- `coil`: [COIL, COIL] — dense winding throughout
- `flow`: [FLOW] — nearly straight bridge
- `arm-cluster-arm`: [SWEEP, COIL, SWEEP] — run, cluster, run

**Assignment by trail length:**
- Short trails: `flow` or `staccato` only (single phase)
- Medium trails: `sweep-hook`, `breath`, `staccato`
- Long trails: `arm-cluster-arm`, `breath`, `sweep-hook`, `coil`

**Phase transitions:** interpolate `maxStraight` and `turnBonus` over 2–3 nodes at each phase boundary — no hard switches.

**Approval required before OA-4**

---

## STEP OA-4 — Handedness-Aware Turn Selection
**File:** `js/edge-gen.js`

Eliminate zigzag as the default output by biasing turn direction toward each trail's assigned handedness.

**Changes inside `walkWarnsdorff`:**
- Assign handedness (CW=1 / CCW=-1) to each trail at creation — 45/45/10 split (CW / CCW / neutral)
- Track `lastTurnDirection` on the trail state (which way the last turn rotated the heading)
- When choosing to turn, add a bonus weight to candidates that continue the preferred rotation direction
- Handedness bonus strength: 0.6 (medium — visible curves but not forced spirals)

**Visual result:** paths produce C-curves and arcs instead of Z-zigzags. Two adjacent paths with opposite handedness visually contrast each other.

**Approval required before OA-5**

---

## STEP OA-5 — Momentum System
**File:** `js/edge-gen.js`

Replace stateless per-step decisions with momentum-driven decisions that create coherent sections within a path.

**Changes inside `walkWarnsdorff`:**
- Track `straightStreak` (increments each straight step, resets on turn)
- Track `turnStreak` (increments each turn step, resets on straight)
- Compute `momentum` scalar: positive = flowing (prefer straight), negative = turning (prefer turn)
- Turn probability is a sigmoid curve of `straightStreak` vs current phase's `maxStraight` — not a hard cutoff
- After `turnStreak` ≥ 3, strong pull back to straight regardless of phase
- Phase `maxStraight` sets the envelope; momentum drives decisions within it

**Visual result:** paths commit to directions, then change character — no rapid step-level oscillation. Sections cohere.

**Approval required before OA-6**

---

## STEP OA-6 — Axis Bias on Warnsdorff Candidate Ranking
**File:** `js/edge-gen.js`

Give each trail a directional identity — H-biased paths feel horizontal, V-biased paths feel vertical.

**Changes inside `walkWarnsdorff`:**
- Assign `axisBias` ('H' / 'V' / 'neutral') to each trail — 40/40/20 split
- When scoring candidate neighbors via Warnsdorff, add affinity weight to moves along preferred axis
- H-biased: horizontal moves (dc=±1) get +0.4 weight
- V-biased: vertical moves (dr=±1) get +0.4 weight
- Neutral: no added weight
- Does not override Warnsdorff correctness — only biases tie-breaking and near-tie-breaking

**Visual result:** board develops cross-directional weave structure. H paths and V paths interleave visibly.

**Approval required before OA-2**

---

## STEP OA-7 — Aesthetic Scoring Filter
**File:** `js/board-gen.js`

Add board-level quality scoring to the existing retry loop. Discard aesthetically poor boards the same way correctness failures are discarded.

**Aesthetic metrics:**
- **Length variance score**: stddev of path lengths across the board — low variance = bad (all paths same size)
- **Turn distribution score**: are turns spread across the board or clustered in one region?
- **Visual balance score**: are paths distributed across grid quadrants or bunched?

**Threshold:** boards below composite aesthetic score get discarded and retried. Threshold tuned so ~30–40% of boards pass (aggressive filter without excessive generation cost).

**Approval required before OA-8**

---

## STEP OA-8 — Board-Level Personality Diversity Enforcement
**File:** `js/edge-gen.js`

Ensure no single board accidentally over-produces one personality type due to random assignment.

**Rules:**
- Enforce 40/40/20 axis split (H / V / neutral) across all trails on a board — assigned in order, not randomly
- Enforce ~45/45/10 handedness split (CW / CCW / neutral) — same approach
- Ensure rhythm profile variety: no single profile used by more than 40% of trails on one board
- Length tier distribution checked against OA-1 targets — if fragmentation drifted, re-balance

**Visual result:** every board is guaranteed to have directional variety, handedness variety, and rhythm variety — not by chance but by design.
