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
| 15   | Full Game Sweep                    | pending |
| 16   | Cleanup + Final                    | pending |
