# Arrow Escape — Generation Pipeline Overhaul

## Rules
- Each phase requires explicit approval before starting.
- Do NOT begin the next phase until the current one is confirmed complete and approved.
- Every new file must be tested before moving to the next phase.
- `test-regression.js` must pass after every phase.
- Blueprint pipeline is an A/B switch — old generation path must remain intact.

---

## Architecture Target

```
Generator (orchestrator)
├── PipelineConfig          [NEW] Stage 0 — seed, difficulty, motif/topology weights
├── BoardBlueprint          [NEW] Stage 0 — central data carrier for all 18 stages
│
├── RegionLayout            [NEW] Stage 2 — Voronoi region growth over mask
├── RegionConnectivity      [NEW] Stage 3 — region adjacency + crossing points
│
├── TopologyGenerator       [NEW] Stage 4 — LINEAR/STAR/TREE/MESH topology
├── MotifAssigner           [NEW] Stage 5 — match motif types to region shapes
│
├── MotifSkeletonGenerator  [NEW] Stage 6 — node coords for 8 motif types
├── RegionNodeGraphBuilder  [NEW] Stage 7 — per-region node graphs
├── GlobalNodeGraphBuilder  [NEW] Stage 8 — stitch region graphs globally
│
├── PathRouter              [NEW] Stage 9  — A* orthogonal routing
├── PathInteractionDetector [NEW] Stage 10 — blocking, containment, nesting
├── DependencyGraphBuilder  [NEW] Stage 11 — DAG from interactions + topology
├── SolveOrderPlanner       [NEW] Stage 12 — topological sort, solution lock
│
├── RCBuilder               [MODIFY] Stage 13 — gains fillWithBlueprint()
├── Validator               [MODIFY] Stage 15 — gains checkBlueprintCoverage()
├── SolvabilityOracle       [unchanged] Stage 16
├── DifficultyEngine        [unchanged] Stage 17
└── BoardRepairer           [NEW] Stage 18 — fix invalid paths, dead regions
```

---

## Phase 1 — Foundation: Blueprint Data Model + Config

### 1.1 BoardBlueprint.js [x]
- [x] `constructor(config)` — initialise all section fields as null/empty
- [x] `config` section: `{ seed, difficultyTarget, boardRows, boardCols, mask, activeCount, motifWeights, topologyWeights }`
- [x] `grid` section: `{ rows, cols, mask, activeCount }`
- [x] `regions` section: null until Stage 2
- [x] `connectivity` section: null until Stage 3
- [x] `topology` section: null until Stage 4
- [x] `motifs` section: null until Stage 5
- [x] `skeletons` section: null until Stage 6
- [x] `regionGraphs` section: null until Stage 7
- [x] `globalGraph` section: null until Stage 8
- [x] `routedPaths` section: null until Stage 9
- [x] `interactions` section: null until Stage 10
- [x] `dependencyGraph` section: null until Stage 11
- [x] `solveOrder` section: null until Stage 12
- [x] `rcConstraints` section: null until adapter runs
- [x] `toRCConstraints()` — adapter: translates blueprint → RCBuilder constraints (returns null initially)
- [x] `validate()` — structural self-check, logs warnings per section
- [x] `clone()` — deep copy for attempt branching

### 1.2 PipelineConfig.js [x]
- [x] `static fromLevel(level, seed, context)` — full config object from level
- [x] `static motifWeightsForLevel(level)` — `{ CORRIDOR, SPIRAL, NESTED_RECT, LOOP, SNAKE, ZIGZAG, RING, CHAMBER }`
- [x] `static topologyWeightsForLevel(level)` — `{ LINEAR, STAR, TREE, MESH }`
- [x] Weight tables: levels 1–30 favour CORRIDOR/LOOP; 31–60 add SPIRAL/SNAKE; 61+ unlock NESTED_RECT/CHAMBER

### 1.3 Generator.js modifications [x]
- [x] `build()` creates a `BoardBlueprint` and fills `blueprint.config` via `PipelineConfig.fromLevel()`
- [x] `_constructAttempt(grid, tier, zoneMap, blueprint = null)` — blueprint param added
- [x] Blueprint rides as `board.blueprint` on returned board (never required by game code)
- [x] Old path runs unmodified when `blueprint` is null

**Phase 1 test:** `test-regression.js` passes. Assert `board.blueprint !== undefined`. Board output statistically identical to pre-change.

---

## Phase 2 — Spatial Structure: Regions + Connectivity

### 2.1 RegionLayout.js [x]
- [x] `generate(grid, regionCount, seed)` — runs all sub-stages, returns `RegionLayoutResult`
- [x] `_determineRegionCount(activeCount, level)` — targets ~80 nodes/region, level-gated cap
- [x] `_generateSeeds(grid, count, seed)` — farthest-point sampling
- [x] `_growRegions(grid, seeds)` — multi-source BFS flood fill respecting mask
- [x] `_resolveOverlaps(regions)` — assign BFS-unreachable active nodes to nearest neighbour
- [x] `_smoothBoundaries(regions, passes)` — majority-vote cellular automaton, 2 passes (≥3/4 threshold)
- [x] `_computeCenters(regions)` — centroid of each region's active nodes
- [x] `_computeStats(regions, grid)` — area, aspectRatio, perimeter, compactness (isoperimetric)
- [x] Result shape: `{ regionCount, assignment: Int32Array, regions: [{ id, seed, center, nodes, area, aspectRatio, perimeter, compactness }] }`

### 2.2 RegionConnectivity.js [x]
- [x] `generate(regionLayout, grid)` — runs all sub-stages, returns `RegionConnectivityResult`
- [x] `_detectNeighbors(regionLayout, grid)` — scan boundary nodes for region-pair adjacencies
- [x] `_generateCandidateLinks(neighbors, regionLayout)` — narrowest crossing point per adjacent pair
- [x] `_buildGraph(candidateLinks)` — adjacency list (Map<regionId, Set<regionId>>)
- [x] `_removeRedundant(graph, regionLayout)` — Kruskal's MST + keep sharedCount ≥ 3 extras
- [x] `_ensureConnectivity(graph, regionLayout)` — re-add pruned edges until BFS reaches all regions
- [x] `_assignStrengths(graph, regionLayout)` — strength = sharedCount / maxSharedCount (0–1)
- [x] Result shape: `{ adjacency: Map, links: [{ regionA, regionB, crossingNodes, strength }] }`

### 2.3 Generator.js modifications [x]
- [x] `_constructAttempt` calls `RegionLayout.generate()` and `RegionConnectivity.generate()` before buildChain
- [x] Store results in `blueprint.regions` and `blueprint.connectivity`
- [x] Skip regions if `totalNodes > 2000` (budget guard) — old path proceeds
- [x] Guard prevents recomputation across batch attempts (`!blueprint.regions`)

**Phase 2 test:** Every active node has exactly one region assignment. Region graph is connected. Debug: render regions as coloured fills in sandbox.html.

---

## Phase 3 — Structural Intent: Topology + Motif Assignment

### 3.1 TopologyGenerator.js [x]
- [x] `generate(connectivity, config)` — runs sub-stages 4.1–4.7
- [x] `_selectStyle(topologyWeights, regionCount)` — weighted random; clamps MESH/TREE/STAR for tiny region counts
- [x] `_buildGraph(style, connectivity)` — LINEAR/STAR/TREE/MESH directed edges
- [x] `_assignHierarchy(graph)` — BFS depth from inDegree-0 roots; cycle guard
- [x] `_assignBranches(graph)` — flag outDegree > 1 nodes
- [x] `_assignHubs(graph)` — flag top-quartile degree nodes (min threshold 3)
- [x] `_validate(graph, connectivity)` — warns on missing regions and unreachable nodes
- [x] `_storeMetadata(graph)` — sets role: HUB > BRANCH > ROOT > LEAF > INTERNAL
- [x] Result: `{ style, graph: { nodes: [{ regionId, role, depth, inDegree, outDegree }], edges: [{ from, to, type }] } }`

### 3.2 MotifAssigner.js [x]
- [x] `assign(regionLayout, topology, config)` — runs sub-stages 5.1–5.5
- [x] `_analyzeShapes(regionLayout)` — IRREGULAR (compactness < 0.35) / ELONGATED (AR > 2) / SQUARE
- [x] `_selectCandidates(region, shapeClass, topology, weights)` — intersection of shape constraints + level weights; topology-role bias (ROOT→LOOP, LEAF→SPIRAL)
- [x] `_assignTypes` — `PipelineConfig.weightedPick` per region from filtered candidates
- [x] `_assignParameters` — derives axis/rings/depth/etc from bounding box + area
- [x] `_validateCompatibility` — fixes SPIRAL < 40, NESTED_RECT < 60, CHAMBER < 30, RING out-of-range
- [x] Compatibility rules enforced:
  - [x] CORRIDOR: aspectRatio > 2.0, area > 15
  - [x] SPIRAL: aspectRatio ≤ 1.5, area > 40, compactness > 0.3
  - [x] NESTED_RECT: aspectRatio ≤ 1.5, area > 60
  - [x] LOOP: area > 20
  - [x] SNAKE: aspectRatio > 1.5, area > 12
  - [x] ZIGZAG: ELONGATED or IRREGULAR
  - [x] RING: aspectRatio ≤ 1.5, area 15–80
  - [x] CHAMBER: IRREGULAR, area > 30

**Phase 3 test:** Every region has exactly one motif assignment. Motif distribution matches weights ±15% over 200 boards. Console: `[Blueprint] region 0: CORRIDOR, region 1: SPIRAL, ...`

---

## Phase 4 — Skeleton Generation + Node Graph

### 4.1 MotifSkeletonGenerator.js [x]
- [x] `generate(motifAssignments, regionLayout, grid)` — dispatches by motif type, deduplicates nodes
- [x] `_corridorSkeleton` — spine along longer axis + parallel width tracks, endpoints as anchors
- [x] `_spiralSkeleton` — concentric rectangular rings; corners as anchors, edges as internal
- [x] `_nestedRectSkeleton` — outer→inner boxes by marginStep + radial spoke through center column
- [x] `_loopSkeleton` — rectangular perimeter sized to cycleLength; corners as anchors
- [x] `_snakeSkeleton` — alternating H/V segments with single-node vertical/horizontal transitions
- [x] `_zigzagSkeleton` — phase-alternating amplitude path along axis; phase changes as anchors
- [x] `_ringSkeleton` — rectangular ring at center±radius; corners as anchors
- [x] `_chamberSkeleton` — N rooms side-by-side + 1-wide corridor connectors at midRow
- [x] All skeletons clip via regionSet (Set of "r,c" strings); no convexity assumption
- [x] Entry nodes = anchors on bounding-box boundary; fallback to first/last anchor

### 4.2 RegionNodeGraphBuilder.js [x]
- [x] `build(skeletons, regionLayout, connectivity)` — builds one graph per skeleton
- [x] `_buildAnchorNodes` — used directly from skeleton.anchorNodes
- [x] `_buildEntryNodes(skeleton, connectivity)` — finds crossing nodes from connectivity.links that land in skeleton.nodeSet; fallback to skeleton.entryNodes
- [x] `_buildExitNodes` — equals entryNodes in Phase 4 (topology refines in Phase 5)
- [x] `_buildInternalNodes` — skeleton.internalNodes minus any in entry/exit/anchor key sets
- [x] `_buildMotifGraph(nodes, nodeById)` — edges for all orthogonally adjacent skeleton node pairs
- [x] `_mergeGraphs` — returns the per-region array unchanged

### 4.3 GlobalNodeGraphBuilder.js [x]
- [x] `build(regionGraphs, connectivity, topology)` — merges all regions then runs 8.1–8.5
- [x] `_connectRegionGraphs` — resolveNode (exact pos then nearest) per crossing; adds BRIDGE edges
- [x] `_connectMotifGraphs` — BFS from entry nodes per region; adds INTERNAL edges to unreachable nodes
- [x] `_insertBridgeNodes` — inserts synthetic BRIDGE node at crossing point when posMap has no entry; connects to nearest in each adjacent region
- [x] `_insertTransitionNodes` — marks BRIDGE edges crossing topology depth boundaries as TRANSITION (no new nodes)
- [x] `_validateConnectivity` — BFS from node 0; warns with position info for unreachable nodes

**Phase 4 test:** All skeleton nodes within active mask. All entry/exit nodes on region boundaries from Stage 3. Global graph fully connected. Profile: 50×30 board under 50ms.

---

## Phase 5 — Path Routing + Dependency + Solve Order

### 5.1 PathRouter.js [x]
- [x] `route(globalGraph, regionGraphs, topology, grid)` — full 9-step pipeline
- [x] `_selectEndpoints` — entry nodes prioritised; farthest-entry or farthest-anchor as end
- [x] `_generateRoutes` — BFS through global graph adjacency; orthogonal by construction
- [x] `_avoidCollisions` — higher topology depth wins; conflicting lower-priority routes dropped
- [x] `_routeAroundObstacles` — placeholder (full re-routing deferred to Phase 9)
- [x] `_optimizeRoutes` — drops routes with < 3 nodes
- [x] `_finaliseGeometry` — heading from last segment delta; role = 'SPINE'
- [x] Post-routing filter: `_filterByHeadRayClear` checks mutual occlusion; tries reverse; drops if both fail
- [x] Result: `RoutedPath[]` — `{ regionId, motifType, nodes, heading, role, placeOrder }`

### 5.2 PathInteractionDetector.js [x]
- [x] `detect(routedPaths, grid)` — builds nodeMap, runs all sub-stages
- [x] `_detectIntersections` — flags shared nodes post-routing (should be zero)
- [x] `_detectContainment` — bounding-box containment; smallest enclosing path wins
- [x] `_detectNesting` — chain length from containment map
- [x] `_detectBlocking` — head ray trace per path; records first foreign-path hit
- [x] `_detectHiddenDependencies` — BFS transitive closure on blocking graph
- [x] `_buildMetadata` — per-path: `{ blockedBy, blocks, containedIn, contains, nestingDepth, transitiveDeps }`

### 5.3 DependencyGraphBuilder.js [x]
- [x] `build(routedPaths, interactions, topology)` — full 6-stage pipeline
- [x] `_generateCandidates` — physical blocking (weight=2) + topology region edges (weight=1)
- [x] `_addPrerequisiteEdges` — type: 'PREREQUISITE'
- [x] `_addUnlockEdges` — type: 'UNLOCK'
- [x] `_buildDAG` — deduplicates edges, removes self-loops
- [x] `_removeCycles` — iterative DFS; breaks lowest-weight back-edge per cycle (max 20 iterations)
- [x] `_validate` — BFS from roots; warns on unreachable paths

### 5.4 SolveOrderPlanner.js [x]
- [x] `plan(dag, routedPaths, config, tmpGrid, oracle)` — full pipeline + oracle solvability gate
- [x] `_topologicalSort` — Kahn's with all-orderings DFS; capped at 4 to avoid explosion
- [x] `_generateIntendedSolution` — max critical-path score (hard) / min (easy)
- [x] `_measureDepth` — DFS longest path on DAG with memoisation
- [x] `_removeAlternateSolutions` — adds UNLOCK edges at first divergence point (alternateCount ≤ 3 only)
- [x] `_storeSolution` — places on tmpGrid, oracle.isBoardSolvable gate, oracle.recomputePlaceOrder assigns placeOrder

### 5.5 BoardBlueprint.toRCConstraints() [x]
- [x] Returns `{ fixedPaths, chainDepth, clusterCenters, topoWeight, zoneOverride }` when solveOrder populated
- [x] `zoneOverride` built from motif→zone map in `_buildZoneOverride()`

### 5.6 RCBuilder.js modifications [x]
- [x] `fillWithBlueprint(grid, paths, ctr, constraints)` — places fixedPaths ascending placeOrder, then chain, then fillA
- [x] `_placeFixedPath` — validates: nodes free + orthogonal + headRayClear + isBoardSolvable; reverts cleanly on failure
- [x] `_revertPath` — clears nodeOwner + edges + pops paths + decrements ctr

### 5.7 Generator.js modifications [x]
- [x] Stages 9–12 block in `_constructAttempt` (runs once per blueprint via `!blueprint.routedPaths` guard)
- [x] `bpConstraints = blueprint.toRCConstraints()` switches generation path
- [x] Blueprint path: `fillWithBlueprint` then skips original buildChain+fillA
- [x] Original path: unchanged when `bpConstraints` is null (includes symmetric mode)
- [x] fillB/C/D/scoring always run unchanged after either path
- [x] Log: `[Generator] Blueprint attempt — fixed: K paths, solvableDepth: D`

**Phase 5 test:** Place only `fixedPaths` on a fresh grid → `oracle.isBoardSolvable` must return true in 100% of 200 boards. `test-regression.js` must pass with blueprint mode both on and off.

---

## Phase 6 — Board Repair + Integration Hardening

### 6.1 BoardRepairer.js [x]
- [x] `repair(paths, grid, validator, oracle, difficulty, builder, config)` — 3-iteration loop; accepts repaired board; degrades gracefully without builder
- [x] `_fixInvalidPaths` — oracle.headSelfClear gate; reverses path if clear + solvable; reverts if worse
- [x] `_fixDeadRegions` — delegates to `builder.fillD()` (purpose-built for uncovered nodes)
- [x] `_fixExcessiveBranching` — logs inDegree > 3 paths; splitting deferred to Phase 9 (DAG re-wiring required)
- [x] `_fixLowDifficulty` — `builder.buildChain(depth=1)` on random chain row
- [x] `_fixHighDifficulty` — counts direct blockers per path; reverses top blocker; reverts if oracle fails
- [x] `_revalidate` — `validator.checkBoard(paths, grid)` returns `{ ok, coverage, errors }`

### 6.2 Validator.js modifications [x]
- [x] `checkBlueprintCoverage(routedPaths, blueprint)` — per-region coverage check; warns and returns `{ ok, errors }` when any region < 60%

### 6.3 Generator.js modifications [x]
- [x] `build()` — if `!check.ok` and `round < MAX_ROUNDS - 1`: call `new BoardRepairer().repair(...)` with targetScore from `DifficultyEngine.TIER_CENTER[tier]`
- [x] Accept repaired board if `repaired.ok`; continue to next round if tier mismatch
- [x] Still falls through to `console.warn` + `continue` when repair also fails

**Phase 6 test:** Force-inject invalid boards at each repair target; verify repair closes the gap without breaking solvability. `test-regression.js` must pass.

---

## Data Contracts Between Stages

```
Config         → BoardBlueprint.config
Grid           → RegionLayout.generate(grid, regionCount, seed)
RegionLayout   → RegionConnectivity.generate(result, grid)
Connectivity   → TopologyGenerator.generate(connectivity, config)
Topology       → MotifAssigner.assign(regionLayout, topology, config)
MotifAssign    → MotifSkeletonGenerator.generate(assignments, regionLayout, grid)
Skeletons      → RegionNodeGraphBuilder.build(skeletons, regionLayout, grid)
RegionGraphs   → GlobalNodeGraphBuilder.build(regionGraphs, connectivity, topology)
GlobalGraph    → PathRouter.route(globalGraph, regionGraphs, topology, grid)
RoutedPaths    → PathInteractionDetector.detect(routedPaths, grid)
Interactions   → DependencyGraphBuilder.build(routedPaths, interactions, topology)
DepGraph       → SolveOrderPlanner.plan(dag, routedPaths, config)
SolveOrder     → blueprint.toRCConstraints() → RCBuilder.fillWithBlueprint()
RCBuilder      → Validator → SolvabilityOracle → DifficultyEngine → BoardRepairer → Export
```

---

## Key Risk Areas

| Risk | Mitigation |
|---|---|
| PathRouter produces paths failing headRayClear | Post-routing filter: try both directions; if both fail → mark unroutable, let fillA handle |
| Alternate solution removal too expensive | Only run when alternateCount ≤ 3; accept ambiguity beyond that |
| Non-convex masks (heart, brain) breaking skeletons | All skeleton generators clip to region's active node set, never assume convexity |
| Fixed path placement order conflicts | _placeFixedPath returns boolean; failures are skipped silently, not hard errors |
| fillA/B/C/D logic changes breaking existing boards | These methods are never modified — only called with overridden knobs |

---

## New Files Summary

| File | Stage | Status |
|---|---|---|
| `js/BoardBlueprint.js` | 0 | [ ] |
| `js/PipelineConfig.js` | 0 | [ ] |
| `js/RegionLayout.js` | 2 | [ ] |
| `js/RegionConnectivity.js` | 3 | [ ] |
| `js/TopologyGenerator.js` | 4 | [ ] |
| `js/MotifAssigner.js` | 5 | [ ] |
| `js/MotifSkeletonGenerator.js` | 6 | [ ] |
| `js/RegionNodeGraphBuilder.js` | 7 | [ ] |
| `js/GlobalNodeGraphBuilder.js` | 8 | [ ] |
| `js/PathRouter.js` | 9 | [ ] |
| `js/PathInteractionDetector.js` | 10 | [ ] |
| `js/DependencyGraphBuilder.js` | 11 | [ ] |
| `js/SolveOrderPlanner.js` | 12 | [ ] |
| `js/BoardRepairer.js` | 18 | [ ] |

## Modified Files Summary

| File | Changes |
|---|---|
| `js/Generator.js` | Wire blueprint pipeline, A/B switch |
| `js/RCBuilder.js` | Add fillWithBlueprint() + _placeFixedPath() |
| `js/Validator.js` | Add checkBlueprintCoverage() |
