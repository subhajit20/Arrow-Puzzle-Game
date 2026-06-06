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
        // Every 10th level → square grid for circle/heart mask.
        if (level % 10 === 0) {
            if (level > 100) return [{ rows: 50, cols: 50 }];
            // Level 10→100: scale 24×24 → 45×45 (3 nodes per decade, capped at 45)
            const tier = Math.floor(level / 10);           // 1..10
            const size = Math.min(45, 24 + (tier - 1) * 3); // 24, 27, 30...45
            return [{ rows: size, cols: size }];
        }

        // All other levels → rectangular grids, no mask.
        if (level <= 3) return [{ rows: 10, cols: 6 }, { rows: 12, cols: 8 }];
        if (level <= 7) return [{ rows: 14, cols: 8 }, { rows: 12, cols: 8 }, { rows: 14, cols: 10 }];
        if (level <= 12) return [{ rows: 18, cols: 10 }, { rows: 16, cols: 10 }, { rows: 18, cols: 12 }];
        if (level <= 20) return [{ rows: 24, cols: 14 }, { rows: 20, cols: 12 }, { rows: 22, cols: 14 }];
        if (level <= 30) return [{ rows: 30, cols: 18 }, { rows: 28, cols: 16 }, { rows: 32, cols: 20 }];
        if (level <= 40) return [{ rows: 36, cols: 22 }, { rows: 32, cols: 20 }, { rows: 38, cols: 24 }];
        if (level <= 55) return [{ rows: 42, cols: 26 }, { rows: 40, cols: 24 }, { rows: 44, cols: 28 }];
        if (level <= 70) return [{ rows: 50, cols: 30 }, { rows: 48, cols: 28 }, { rows: 52, cols: 32 }];
        if (level <= 85) return [{ rows: 56, cols: 34 }, { rows: 52, cols: 32 }, { rows: 58, cols: 36 }];
        return [{ rows: 60, cols: 38 }, { rows: 60, cols: 36 }, { rows: 58, cols: 40 }, { rows: 62, cols: 40 }];
    }

    // ── Board shape mask — delegated to GridShape ─────────────────────────────

    selectBoardMask(level, rows, cols, context = 'normal') {
        return GridShape.selectMask(level, rows, cols, context);
    }

    // ── Single board construction attempt ─────────────────────────────────────

    // Builds one board attempt for the given tier on the provided grid.
    // Returns { paths, cx } where cx is the evaluated difficulty before fillD.
    _constructAttempt(grid, tier, zoneMap) {
        const knobs = this.difficulty.knobsForTier(tier, zoneMap);
        const paths = [];
        const ctr = { n: 0 };

        // 1. Chain backbone
        const chainRow = 1 + ((Math.random() * grid.rows) | 0);
        if (knobs.chainDepth > 0)
            this.builder.buildChain(grid, paths, ctr, knobs.chainDepth, chainRow);

        // 2. Main fill
        const totalNodes = (grid.rows + 1) * (grid.cols + 1);
        const maxFails = Math.max(400, Math.floor(totalNodes * 0.55));
        this.builder.fillA(grid, paths, ctr, maxFails, {
            d: knobs.d, lenScale: knobs.lenScale, zoneMap,
        });

        // 3. Gap fill (two passes)
        this.builder.fillB(grid, paths, ctr);
        this.builder.fillC(grid, paths);
        this.builder.fillB(grid, paths, ctr);
        this.builder.fillC(grid, paths);

        // 4. Score complexity BEFORE fillD — gap pieces must not dilute the score
        const cx = this.difficulty.evaluate(paths, grid);

        // 5. Oracle gap fill — runs after scoring
        this.builder.fillD(grid, paths, ctr);

        return { paths, cx };
    }

    // ── Batch tier construction ───────────────────────────────────────────────

    // Runs up to `batch` attempts, returns the best-scoring result.
    // "Best" = tier match first, then closest score to tier centre.
    constructForTier(grid, tier, batch, zoneMap) {
        const CENTER = { EASY: 3, NORMAL: 9.5, HARD: 17.5, EXPERT: 25.5, TITAN: 33 };
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

            const { paths, cx } = this._constructAttempt(attemptGrid, tier, zm);

            this.difficulty._overrideChainDepth = null;

            // Validate coverage (≥90% hard threshold) and solvability
            const check = this.validator.checkBoard(paths, attemptGrid);
            if (!check.ok) {
                const reason = check.errors[0] || `coverage ${check.coverage}%`;
                console.warn(`[Generator] Attempt ${i} failed validation — ${reason}`);
                if (i < batch - 1) continue;
            }

            if (cx.tier === tier) {
                // Commit the grid state if this was not the last grid
                if (i < batch - 1) this._copyGridState(attemptGrid, grid);
                return { paths, cx, grid: attemptGrid === grid ? grid : attemptGrid };
            }

            const delta = Math.abs(cx.score - (CENTER[tier] || 10));
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

        const zoneMap = new ZoneMap().generate(rows, cols);
        const grid = new Grid(rows, cols);
        grid.mask = mask;   // wire mask into grid so RCBuilder respects it

        let result = null;

        for (let round = 0; round < MAX_ROUNDS; round++) {
            grid.reset();
            grid.mask = mask;   // re-apply after reset (reset clears nodeOwner, not mask)
            const attempt = this.constructForTier(grid, tier, BATCH, zoneMap);
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

            console.log(
                `[Generator] L${level} round ${round + 1}/${MAX_ROUNDS}` +
                ` | tier: ${cx.tier} (target: ${tier})` +
                ` | paths: ${paths.length}` +
                ` | coverage: ${check.coverage}%`
            );

            if (!check.ok) {
                console.warn('[Generator] Validation failed — retrying');
                continue;
            }

            result = { grid, paths, difficulty: cx.tier, coverage: check.coverage, mask };

            // Accept immediately on exact tier match
            if (cx.tier === tier) break;

            // Keep as best if no result yet or closer tier
            result = result || { grid, paths, difficulty: cx.tier, coverage: check.coverage, mask };
        }

        if (!result) {
            console.error('[Generator] Failed to produce a valid board after all rounds');
            return null;
        }

        return result;
    }
}
