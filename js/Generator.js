// =============================================================================
// Generator.js — Orchestrates the full RC board generation pipeline
//
// Pipeline per attempt:
//   1. buildChain  — difficulty backbone (forced dependency chain)
//   2. fillA       — main fill (winding self-avoiding walks)
//   3. fillB       — gap fill (small pieces in empty pockets)
//   4. fillC       — tail-append (isolated nodes → adjacent tails)
//   5. evaluate    — score difficulty BEFORE fillD (gap pieces must not dilute)
//   6. fillD       — oracle gap fill (convergence + reversal + force-fill)
//   7. recomputePlaceOrder
//   8. Validator.checkBoard (coverage + solvability)
//
// Returns: { grid, paths, difficulty, coverage }
//
// Dependencies: Grid, Path, ZoneMap, RCBuilder, DifficultyEngine, Validator,
//               SolvabilityOracle
// =============================================================================

class Generator {
    constructor(builder, difficulty, validator) {
        this.builder = builder;    // RCBuilder
        this.difficulty = difficulty; // DifficultyEngine
        this.validator = validator;  // Validator
    }

    // ── Grid sizes per level ──────────────────────────────────────────────────

    sizesForLevel(level) {
        // Every 10th level → per-shape large grids (3 candidates, matched to
        // the milestone shape's aspect ratio and detail — see GridShape.SHAPE_SIZES).
        if (level % 10 === 0) {
            return GridShape.milestoneSizes(level);
        }

        // All other levels → rectangular + square grids.
        if (level <= 3) return [{ rows: 10, cols: 6 }, { rows: 12, cols: 8 }, { rows: 8, cols: 8 }];
        if (level <= 7) return [{ rows: 14, cols: 8 }, { rows: 12, cols: 8 }, { rows: 14, cols: 10 }, { rows: 12, cols: 12 }];
        if (level <= 12) return [{ rows: 18, cols: 10 }, { rows: 16, cols: 10 }, { rows: 18, cols: 12 }, { rows: 14, cols: 14 }];
        if (level <= 20) return [{ rows: 24, cols: 14 }, { rows: 20, cols: 12 }, { rows: 22, cols: 14 }, { rows: 18, cols: 18 }];
        if (level <= 30) return [{ rows: 30, cols: 18 }, { rows: 28, cols: 16 }, { rows: 32, cols: 20 }, { rows: 22, cols: 22 }];
        if (level <= 40) return [{ rows: 36, cols: 22 }, { rows: 32, cols: 20 }, { rows: 38, cols: 24 }, { rows: 28, cols: 28 }];
        if (level <= 55) return [{ rows: 42, cols: 26 }, { rows: 40, cols: 24 }, { rows: 44, cols: 28 }, { rows: 34, cols: 34 }];
        if (level <= 70) return [{ rows: 50, cols: 30 }, { rows: 48, cols: 28 }, { rows: 52, cols: 32 }, { rows: 40, cols: 40 }];
        if (level <= 85) return [{ rows: 56, cols: 34 }, { rows: 52, cols: 32 }, { rows: 58, cols: 36 }, { rows: 46, cols: 46 }];
        return [{ rows: 60, cols: 38 }, { rows: 60, cols: 36 }, { rows: 58, cols: 40 }, { rows: 62, cols: 40 }, { rows: 50, cols: 50 }];
    }

    // ── Board shape mask — delegated to GridShape ─────────────────────────────

    selectBoardMask(level, rows, cols, context = 'normal') {
        return GridShape.selectMask(level, rows, cols, context);
    }

    // ── Single board construction attempt ─────────────────────────────────────

    // Builds one board attempt for the given tier on the provided grid.
    // Returns { paths, cx } where cx is the evaluated difficulty before fillD.
    _constructAttempt(grid, tier, zoneMap, blueprint = null) {
        const knobs = this.difficulty.knobsForTier(tier, zoneMap);
        const paths = [];
        const ctr = { n: 0 };

        // Stages 2–3 — Region layout and connectivity.
        // Guard: only run once per blueprint (mask is constant across batch attempts).
        // Skip on very large boards (> 2000 nodes) to stay within time budget.
        const _bpNodes = (grid.rows + 1) * (grid.cols + 1);
        if (blueprint && !blueprint.regions && _bpNodes <= 3500) {
            const _activeCount = blueprint.config.activeCount ?? _bpNodes;
            // Use the level passed to build() directly via blueprint.config.level.
            // Fall back to boardRows/boardCols-derived estimate only if missing.
            const _level = blueprint.config.level ?? blueprint.config.boardRows ?? 1;
            const _seed = blueprint.config.seed ?? 0;
            const _count = RegionLayout._determineRegionCount(_activeCount, _level);
            console.log(`[Generator] Blueprint regions: ${_count} (level=${_level}, activeNodes=${_activeCount})`);
            const activePal = Object.keys(blueprint.config.motifWeights || {}).filter(k => blueprint.config.motifWeights[k] > 0);
            console.log(`[Generator] Motif Palette: [${activePal.join(', ')}] (seed=${_seed})`);
            const _layout = new RegionLayout().generate(grid, _count, _seed);
            blueprint.regions = _layout;
            if (_layout) {
                blueprint.connectivity = new RegionConnectivity().generate(_layout, grid);
            }
        }

        // Stages 4–5 — Topology and motif assignment.
        // Guard: only run once per blueprint (depends on regions, constant per mask).
        if (blueprint && blueprint.regions && blueprint.connectivity &&
            !blueprint.topology && _bpNodes <= 3500) {
            blueprint.topology = new TopologyGenerator().generate(
                blueprint.connectivity, blueprint.config
            );
            if (blueprint.topology) {
                blueprint.motifs = new MotifAssigner().assign(
                    blueprint.regions, blueprint.topology, blueprint.config
                );
                if (blueprint.motifs?.length) {
                    console.log(
                        `[Blueprint] ${blueprint.motifs.length} regions | ` +
                        blueprint.motifs.map(m => `${m.regionId}:${m.type}`).join(' ')
                    );
                }
            }
        }

        // Stages 6–8 — Motif skeletons, region node graphs, global node graph.
        if (blueprint && blueprint.motifs && !blueprint.skeletons && _bpNodes <= 3500) {
            blueprint.skeletons = new MotifSkeletonGenerator().generate(
                blueprint.motifs, blueprint.regions, grid
            );
            if (blueprint.skeletons) {
                blueprint.regionGraphs = new RegionNodeGraphBuilder().build(
                    blueprint.skeletons, blueprint.regions, blueprint.connectivity
                );
                if (blueprint.regionGraphs) {
                    blueprint.globalGraph = new GlobalNodeGraphBuilder().build(
                        blueprint.regionGraphs, blueprint.connectivity, blueprint.topology
                    );
                }
            }
        }

        // Stages 9–12 — Path routing, interaction detection, dependency DAG, solve order.
        if (blueprint && blueprint.globalGraph && !blueprint.routedPaths && _bpNodes <= 3500) {
            blueprint.routedPaths = new PathRouter().route(
                blueprint.globalGraph, blueprint.regionGraphs, blueprint.topology, grid,
                blueprint.skeletons   // orderedPath enables shape-following routing
            );
            if (blueprint.routedPaths?.length) {
                blueprint.interactions = new PathInteractionDetector().detect(
                    blueprint.routedPaths, grid
                );
                blueprint.dependencyGraph = new DependencyGraphBuilder().build(
                    blueprint.routedPaths, blueprint.interactions, blueprint.topology
                );
                if (blueprint.dependencyGraph) {
                    const tmpGrid = this._freshGrid(grid.rows, grid.cols, grid.mask);
                    blueprint.solveOrder = new SolveOrderPlanner().plan(
                        blueprint.dependencyGraph, blueprint.routedPaths,
                        blueprint.config, tmpGrid, this.builder.oracle
                    );
                }
            }
        }

        // Resolve blueprint constraints — used to switch generation path below.
        // Also extract the motif zone map independently: it is used even when
        // solveOrder fails, so the RC fallback path still gets region-aware fill.
        const bpConstraints = blueprint?.solveOrder ? blueprint.toRCConstraints() : null;
        const motifZone = (blueprint?.motifs && blueprint?.regions)
            ? blueprint._buildZoneOverride()
            : null;

        // 1–3. Fill backbone — blueprint path or original RC path
        const totalNodes = (grid.rows + 1) * (grid.cols + 1);
        const maxFails = Math.max(400, Math.floor(totalNodes * 0.55));

        if (bpConstraints) {
            // ── Blueprint generation path ──────────────────────────────────────
            console.log(
                `[Generator] Blueprint attempt — fixed: ${bpConstraints.fixedPaths?.length ?? 0} paths,` +
                ` solvableDepth: ${bpConstraints.chainDepth}`
            );
            bpConstraints.lockWeight = knobs.lockWeight;
            bpConstraints.branchBudget = knobs.branchBudget;
            this.builder.fillWithBlueprint(grid, paths, ctr, bpConstraints);
        } else {
            // ── Original RC generation path ────────────────────────────────────
            const chainRow = 1 + ((Math.random() * grid.rows) | 0);
            if (knobs.chainDepth > 0)
                this.builder.buildChain(grid, paths, ctr, knobs.chainDepth, chainRow);

            // Use motif zone map when available so RC paths within each region
            // visually express the region's motif style (corridor = straight, etc.)
            this.builder.fillA(grid, paths, ctr, maxFails, {
                d: knobs.d, lenScale: knobs.lenScale,
                lockWeight: knobs.lockWeight,
                branchBudget: knobs.branchBudget,
                zoneMap: motifZone || zoneMap,
            });
        }

        // 2.5 Early branch reduction — reversals have far more freedom before
        // the gap fills densify the board (fewer deadlock rejections), so a
        // first squeeze here gets large boards much closer to the tier target.
        if (knobs.lockWeight >= 1)
            this.builder.reduceBranching(grid, paths,
                this.difficulty.branchTargetForTier(tier, paths.length), 3);

        // 3. Gap fill — lock-aware: gap pieces prefer blocked placements so
        // they join the dependency order instead of diluting it.
        this.builder.fillB(grid, paths, ctr, knobs.lockWeight);
        this.builder.fillC(grid, paths);
        this.builder.fillB(grid, paths, ctr, knobs.lockWeight);
        this.builder.fillC(grid, paths);

        // 4. Score complexity BEFORE fillD — gap pieces must not dilute the score
        const cx = this.difficulty.evaluate(paths, grid);

        // 5. Oracle gap fill.
        // When blueprint is active, skip the reversal pass inside fillD — it
        // changes headings of existing paths and breaks blueprint solvability.
        // The convergence loop and force-fill still run, giving full coverage.
        this.builder.fillD(grid, paths, ctr, !!bpConstraints, knobs.lockWeight);

        // 6. Final branch reduction — reverse excess free pieces into blocked
        // orientations (oracle-gated, shape-preserving) until the branching
        // factor approaches the tier target. This is what makes large boards
        // converge on a (near-)unique solve order.
        this.builder.reduceBranching(grid, paths,
            this.difficulty.branchTargetForTier(tier, paths.length), 3);

        // 7. Final branching — measured AFTER fillD + reduction on the complete
        // board, because gap pieces affect real gameplay even though they are
        // excluded from the difficulty score. This is the acceptance metric.
        const fb = this.builder.oracle.measureBranching(paths, grid);
        cx.finalBranchAvg = fb.avg;
        cx.finalBranchMax = fb.max;
        cx.finalDecoys = this.builder.oracle.countDecoys(paths, grid);

        return { paths, cx };
    }

    // ── Batch tier construction ───────────────────────────────────────────────

    // Runs up to `batch` attempts, returns the best-scoring result.
    // "Best" = tier match + branching within target first, then closest score
    // to tier centre with branch overshoot penalised.
    constructForTier(grid, tier, batch, zoneMap, blueprint = null) {
        const CENTER = { EASY: 3, NORMAL: 9.5, HARD: 17.5, EXPERT: 25.5, TITAN: 33 };
        const branchTol = this.difficulty.branchTolForTier(tier);
        let best = null, bestDelta = Infinity;

        for (let i = 0; i < batch; i++) {
            // Bracket chainDepth ±1 across attempts for variety
            const cd = this.difficulty.chainDepthForTier(tier);
            const cdi = Math.max(0, cd + ((i % 3) - 1));

            // Override chainDepth in knobs for this attempt
            const zm = zoneMap || new ZoneMap().generate(grid.rows, grid.cols);

            // Clone grid for each attempt (except last — reuse to avoid final reset)
            // Pass the mask so every attempt respects the board shape.
            const attemptGrid = i < batch - 1 ? this._freshGrid(grid.rows, grid.cols, grid.mask) : grid;

            // Temporarily override chainDepth
            const origChainDepth = this.difficulty.chainDepthForTier;
            this.difficulty._overrideChainDepth = cdi;

            const { paths, cx } = this._constructAttempt(attemptGrid, tier, zm, blueprint);

            this.difficulty._overrideChainDepth = null;

            // Validate coverage (≥90% hard threshold) and solvability
            const check = this.validator.checkBoard(paths, attemptGrid);
            if (!check.ok) {
                const reason = check.errors[0] || `coverage ${check.coverage}%`;
                console.warn(`[Generator] Attempt ${i} failed validation — ${reason}`);
                if (i < batch - 1) continue;
            }

            const branchAvg = cx.finalBranchAvg ?? cx.branchAvg ?? 99;
            const branchTarget = this.difficulty.branchTargetForTier(tier, paths.length);
            if (cx.tier === tier && branchAvg <= branchTarget + branchTol) {
                // Commit the grid state if this was not the last grid
                if (i < batch - 1) this._copyGridState(attemptGrid, grid);
                return { paths, cx, grid: attemptGrid === grid ? grid : attemptGrid };
            }

            // Branch overshoot weighs heavily — a mushy board at the right
            // score is worse than a tight board slightly off-centre.
            const delta = Math.abs(cx.score - (CENTER[tier] || 10)) +
                Math.max(0, branchAvg - branchTarget) * 6;
            if (delta < bestDelta) {
                bestDelta = delta;
                best = { paths, cx, grid: attemptGrid };
            }

            // Reset for next attempt
            if (i < batch - 1) attemptGrid.reset();
        }

        // Rebuild nodeOwner on the main grid from the best paths
        if (best && best.grid !== grid) {
            this._copyGridState(best.grid, grid);
            best.grid = grid;
        }

        return best;
    }

    _freshGrid(rows, cols, mask = null) {
        const g = new Grid(rows, cols);
        g.mask = mask;
        return g;
    }

    _copyGridState(src, dst) {
        dst.nodeOwner.set(src.nodeOwner);
        for (let r = 0; r <= src.rows; r++) dst.hEdge[r].set(src.hEdge[r]);
        for (let r = 0; r < src.rows; r++) dst.vEdge[r].set(src.vEdge[r]);
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    // Orchestrates the full pipeline for a given level.
    // Returns: { grid, paths, difficulty, coverage, mask }
    build(rows, cols, level, batch = 4, context = 'normal') {
        const totalNodes = (rows + 1) * (cols + 1);
        const BATCH = totalNodes > 1000 ? 2 : batch;
        const MAX_ROUNDS = totalNodes > 1000 ? 3 : 5;

        // Board mask (null = full rectangle)
        const { mask, activeCount } = this.selectBoardMask(level, rows, cols, context);

        // Target tier
        const tier = this.difficulty.selectTier(level, []);

        // Blueprint — rides through the pipeline as a data carrier.
        // Stages 2–12 will populate its sections in later phases.
        // `let` — rerolled when the board signature repeats a recent level.
        let blueprint = this._freshBlueprint(level, context, rows, cols, mask, activeCount, tier);

        const zoneMap = new ZoneMap().generate(rows, cols);
        const grid = new Grid(rows, cols);
        grid.mask = mask;   // wire mask into grid so RCBuilder respects it

        const branchTol = this.difficulty.branchTolForTier(tier);

        let result = null, resultDelta = Infinity;

        for (let round = 0; round < MAX_ROUNDS; round++) {
            grid.reset();
            grid.mask = mask;   // re-apply after reset (reset clears nodeOwner, not mask)
            const attempt = this.constructForTier(grid, tier, BATCH, zoneMap, blueprint);
            if (!attempt) continue;

            const { paths, cx } = attempt;

            // Rebuild nodeOwner from paths — attemptGrid may have been reset
            // after being stored as `best`, so we always derive it from paths.
            const W = grid.cols + 1;
            grid.nodeOwner.fill(-1);
            for (const p of paths)
                for (const { r, c } of p.nodes)
                    grid.nodeOwner[r * W + c] = p.id;

            // Reserve edges from path node sequences
            for (const p of paths) {
                for (let i = 0; i < p.nodes.length - 1; i++) {
                    const a = p.nodes[i], b = p.nodes[i + 1];
                    grid.reserveEdge(a.r, a.c, b.r, b.c, p.id);
                }
                p.originalNodes = p.nodes.map(n => ({ r: n.r, c: n.c }));
            }

            // Inline validator — coverage + solvability (no validateRulebook)
            const check = this.validator.checkBoard(paths, grid);

            const branchAvg = cx.finalBranchAvg ?? 99;
            const branchTarget = this.difficulty.branchTargetForTier(tier, paths.length);
            const branchOk = branchAvg <= branchTarget + branchTol;

            console.log(
                `[Generator] L${level} round ${round + 1}/${MAX_ROUNDS}` +
                ` | tier: ${cx.tier} (target: ${tier})` +
                ` | paths: ${paths.length}` +
                ` | coverage: ${check.coverage}%` +
                ` | branch: ${branchAvg.toFixed(2)} (target ≤ ${(branchTarget + branchTol).toFixed(1)})` +
                ` | decoys: ${cx.finalDecoys ?? 0}`
            );

            // Anti-repeat: a board whose structural signature matches a recent
            // level would feel like a rerun. Signature is null for boards the
            // blueprint didn't shape (nothing meaningful to compare), and the
            // check is skipped in daily mode where session history differs per
            // player and would desync the shared date-seeded board.
            const sig = this._boardSignature(blueprint, cx, paths, grid);
            const isRepeat = context !== 'daily' && sig !== null &&
                Generator._recentSigs.includes(sig);

            // Candidate quality: tier mismatch + branch overshoot + repeat
            // penalty, lower = better. Repeats stay eligible as fallback —
            // a rerun beats a generation failure.
            const delta = (cx.tier === tier
                    ? 0
                    : Math.abs(cx.score - (DifficultyEngine.TIER_CENTER[tier] ?? 10))) +
                Math.max(0, branchAvg - branchTarget) * 6 +
                (isRepeat ? 5 : 0);

            if (!check.ok) {
                // Attempt targeted repair before discarding this board entirely.
                // Only repair when more rounds are available (don't waste time on the last round).
                if (round < MAX_ROUNDS - 1) {
                    const targetScore = DifficultyEngine.TIER_CENTER[tier] ?? 10;
                    const repaired = new BoardRepairer().repair(
                        paths, grid, this.validator, this.builder.oracle,
                        this.difficulty, this.builder,
                        { tier, targetScore }
                    );
                    if (repaired.ok) {
                        console.log(`[Generator] L${level} round ${round + 1} repaired — coverage: ${repaired.coverage}%`);
                        if (delta < resultDelta) {
                            resultDelta = delta;
                            result = { grid, paths, difficulty: cx.tier, coverage: repaired.coverage, mask, blueprint, signature: sig };
                        }
                        if (cx.tier === tier && branchOk) break;
                        continue; // repaired but off-target — keep best, try another round
                    }
                }
                console.warn('[Generator] Validation failed — retrying');
                continue;
            }

            if (delta < resultDelta) {
                resultDelta = delta;
                result = { grid, paths, difficulty: cx.tier, coverage: check.coverage, mask, blueprint, signature: sig };
            }

            // On repeat: reroll the blueprint (new seed → new regions/motifs)
            // and use the remaining rounds to find a structurally fresh board.
            if (isRepeat && round < MAX_ROUNDS - 1) {
                console.log(`[Generator] Signature repeats a recent board (${sig}) — rerolling blueprint`);
                blueprint = this._freshBlueprint(level, context, rows, cols, mask, activeCount, tier);
                continue;
            }

            // Accept immediately on tier match with branching inside target
            if (cx.tier === tier && branchOk) break;
        }

        if (!result) {
            console.error('[Generator] Failed to produce a valid board after all rounds');
            return null;
        }

        // Re-sync nodeOwner AND edges with the result paths before returning.
        // Later rounds call grid.reset() which wipes both, and the kept result
        // may come from an earlier round than the last one that touched grid.
        const W = result.grid.cols + 1;
        result.grid.nodeOwner.fill(-1);
        for (const row of result.grid.hEdge) row.fill(-1);
        for (const row of result.grid.vEdge) row.fill(-1);
        for (const p of result.paths) {
            for (const { r, c } of p.nodes)
                result.grid.nodeOwner[r * W + c] = p.id;
            for (let i = 0; i < p.nodes.length - 1; i++) {
                const a = p.nodes[i], b = p.nodes[i + 1];
                result.grid.reserveEdge(a.r, a.c, b.r, b.c, p.id);
            }
        }

        // Remember this board's signature for cross-level anti-repeat
        // (normal mode only — daily boards are shared across players).
        if (context !== 'daily' && result.signature) {
            Generator._recentSigs.push(result.signature);
            if (Generator._recentSigs.length > Generator.RECENT_SIG_MAX)
                Generator._recentSigs.shift();
        }

        return result;
    }

    // ── Board signature & anti-repeat ─────────────────────────────────────────

    // Sliding window of recent board signatures (session lifetime).
    static _recentSigs = [];
    static RECENT_SIG_MAX = 6;

    // Structural signature: motif mix + topology style + dependency shape.
    // Two boards with the same signature play essentially the same way.
    // Returns null when the blueprint didn't shape the board (pure RC fill) —
    // those boards have no comparable structure, so anti-repeat is skipped.
    _boardSignature(blueprint, cx, paths, grid) {
        if (!blueprint?.motifs?.length) return null;
        const motifs = blueprint.motifs.map(m => m.type).sort().join(',');
        const topo = blueprint?.topology?.style || 'none';
        const depthB = Math.round((cx.maxDepth ?? 0) / 2);
        const pathB = Math.round(paths.length / 10);
        return `${grid.rows}x${grid.cols}|${topo}|${motifs}|d${depthB}|p${pathB}`;
    }

    // Creates a fresh blueprint with a new seed — used at build start and when
    // the anti-repeat check rejects the current blueprint's structure.
    // Daily mode derives the seed from Math.random (swapped to the date-seeded
    // PRNG by DailyPuzzle) so every player gets the same blueprint — the
    // Date.now()-based default seed would break daily determinism.
    _freshBlueprint(level, context, rows, cols, mask, activeCount, tier) {
        const seed = context === 'daily'
            ? ((Math.floor(Math.random() * 0xFFFFFFFF) ^ (level * 1000003)) >>> 0)
            : null;
        const cfg = PipelineConfig.fromLevel(level, seed, context);
        PipelineConfig.mergeRuntime(cfg, {
            boardRows: rows, boardCols: cols, mask, activeCount, difficultyTarget: tier,
        });
        const bp = new BoardBlueprint(cfg);
        bp.grid = { rows, cols, mask, activeCount };
        return bp;
    }
}
