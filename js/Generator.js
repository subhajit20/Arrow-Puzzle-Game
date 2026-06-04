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
        this.builder    = builder;    // RCBuilder
        this.difficulty = difficulty; // DifficultyEngine
        this.validator  = validator;  // Validator
    }

    // ── Grid sizes per level ──────────────────────────────────────────────────

    sizesForLevel(level) {
        if (level <= 5)  return [{ rows:  8, cols:  6 }];
        if (level <= 15) return [{ rows: 16, cols: 12 }];
        if (level <= 30) return [{ rows: 24, cols: 18 }];
        if (level <= 50) return [{ rows: 32, cols: 24 }];
        if (level <= 75) return [{ rows: 40, cols: 30 }];
        return [{ rows: 60, cols: 45 }, { rows: 60, cols: 36 }];
    }

    // ── Board shape mask ──────────────────────────────────────────────────────

    // Returns { mask: Uint8Array | null, activeCount: number }
    // mask=null = full rectangle (normal levels)
    // mask=Uint8Array = shaped board (milestone / daily levels)
    selectBoardMask(level, rows, cols, context = 'normal') {
        const totalCells = (rows + 1) * (cols + 1);
        const nullResult = { mask: null, activeCount: totalCells };

        const isMilestone = (level % 10 === 0) || context === 'milestone';
        const isDaily     = context === 'daily';
        if (!isMilestone && !isDaily) return nullResult;
        if (rows < 12 || cols < 10)   return nullResult;

        const shapeFn = isDaily
            ? this._dailyShapeFn()
            : this._milestoneShapeFn(level);

        const mask = shapeFn(rows, cols);
        const { connected, activeCount } = this._validateMask(mask, rows, cols);

        if (!connected || activeCount < totalCells * 0.3) {
            console.warn(`[Generator] L${level} mask invalid — using rectangle`);
            return nullResult;
        }

        return { mask, activeCount };
    }

    _dailyShapeFn() {
        const jan1    = new Date(new Date().getFullYear(), 0, 1);
        const dayOfYr = Math.floor((Date.now() - jan1.getTime()) / 86400000);
        return dayOfYr % 2 === 0 ? this._heartMask : this._diamondMask;
    }

    _milestoneShapeFn(level) {
        return ((level / 10) % 2 === 1) ? this._heartMask : this._diamondMask;
    }

    _heartMask(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.45);
            const y = -(r - R * 0.5) / (R * 0.375);
            const a = x * x + y * y - 1;
            mask[r * W + c] = (a * a * a - x * x * y * y * y <= 0.01) ? 1 : 0;
        }
        return mask;
    }

    _diamondMask(R, C) {
        const W = C + 1;
        const mask = new Uint8Array((R + 1) * W);
        for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) {
            const x = (c - C * 0.5) / (C * 0.45);
            const y = (r - R * 0.5) / (R * 0.45);
            mask[r * W + c] = (Math.abs(x) + Math.abs(y) <= 1.0) ? 1 : 0;
        }
        return mask;
    }

    _validateMask(mask, rows, cols) {
        const W = cols + 1;
        const total = (rows + 1) * W;
        let activeCount = 0, firstActive = -1;
        for (let i = 0; i < total; i++) {
            if (mask[i]) { activeCount++; if (firstActive < 0) firstActive = i; }
        }
        if (activeCount === 0) return { connected: false, activeCount: 0 };

        const visited = new Uint8Array(total);
        const queue   = [firstActive];
        visited[firstActive] = 1;
        let visitedCount = 1, qi = 0;
        while (qi < queue.length) {
            const k = queue[qi++];
            const r = (k / W) | 0, c = k % W;
            const nbrs = [k - W, k + W, k - 1, k + 1];
            const ok   = [r > 0, r < rows, c > 0, c < cols];
            for (let n = 0; n < 4; n++) {
                if (ok[n] && mask[nbrs[n]] && !visited[nbrs[n]]) {
                    visited[nbrs[n]] = 1; visitedCount++; queue.push(nbrs[n]);
                }
            }
        }
        return { connected: visitedCount === activeCount, activeCount };
    }

    // ── Single board construction attempt ─────────────────────────────────────

    // Builds one board attempt for the given tier on the provided grid.
    // Returns { paths, cx } where cx is the evaluated difficulty before fillD.
    _constructAttempt(grid, tier, zoneMap) {
        const knobs = this.difficulty.knobsForTier(tier, zoneMap);
        const paths = [];
        const ctr   = { n: 0 };

        // 1. Chain backbone
        const chainRow = 1 + ((Math.random() * grid.rows) | 0);
        if (knobs.chainDepth > 0)
            this.builder.buildChain(grid, paths, ctr, knobs.chainDepth, chainRow);

        // 2. Main fill
        const totalNodes = (grid.rows + 1) * (grid.cols + 1);
        const maxFails   = Math.max(400, Math.floor(totalNodes * 0.55));
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
        const CENTER  = { EASY: 3, NORMAL: 9.5, HARD: 17.5, EXPERT: 25.5, TITAN: 33 };
        let best = null, bestDelta = Infinity;

        for (let i = 0; i < batch; i++) {
            // Bracket chainDepth ±1 across attempts for variety
            const cd  = this.difficulty.chainDepthForTier(tier);
            const cdi = Math.max(0, cd + ((i % 3) - 1));

            // Override chainDepth in knobs for this attempt
            const zm = zoneMap || new ZoneMap().generate(grid.rows, grid.cols);

            // Clone grid for each attempt (except last — reuse to avoid final reset)
            const attemptGrid = i < batch - 1 ? this._freshGrid(grid.rows, grid.cols) : grid;

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

    _freshGrid(rows, cols) {
        return new Grid(rows, cols);
    }

    _copyGridState(src, dst) {
        dst.nodeOwner.set(src.nodeOwner);
        for (let r = 0; r <= src.rows; r++) dst.hEdge[r].set(src.hEdge[r]);
        for (let r = 0; r < src.rows;  r++) dst.vEdge[r].set(src.vEdge[r]);
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    // Orchestrates the full pipeline for a given level.
    // Returns: { grid, paths, difficulty, coverage, mask }
    build(rows, cols, level, batch = 4, context = 'normal') {
        const totalNodes = (rows + 1) * (cols + 1);
        const BATCH      = totalNodes > 1000 ? 2 : batch;
        const MAX_ROUNDS = totalNodes > 1000 ? 3 : 5;

        // Board mask (null = full rectangle)
        const { mask, activeCount } = this.selectBoardMask(level, rows, cols, context);

        // Target tier
        const tier = this.difficulty.selectTier(level, []);

        const zoneMap = new ZoneMap().generate(rows, cols);
        const grid    = new Grid(rows, cols);

        let result = null;

        for (let round = 0; round < MAX_ROUNDS; round++) {
            grid.reset();
            const attempt = this.constructForTier(grid, tier, BATCH, zoneMap);
            if (!attempt) continue;

            const { paths, cx } = attempt;

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
