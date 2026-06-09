// =============================================================================
// BoardRepairer.js — Stage 18: targeted board repair after validation failure
//
// Called by Generator.build() when checkBoard fails but retries remain.
// Attempts up to MAX_ITER repair passes before giving up, allowing the
// generator to accept a repaired board instead of discarding and regenerating.
//
// Repair methods (each is additive — they never break an already-working invariant):
//   _fixInvalidPaths     — reverse paths whose arrowhead points into own body
//   _fixDeadRegions      — run fillD on uncovered node clusters
//   _fixExcessiveBranching — log paths with inDegree > 3 (split deferred)
//   _fixLowDifficulty    — inject one extra buildChain pass
//   _fixHighDifficulty   — reverse the top blocker to reduce dependency depth
//   _revalidate          — full checkBoard, returns { ok, coverage, errors }
//
// Dependencies: Validator, SolvabilityOracle, DifficultyEngine, RCBuilder
// =============================================================================

class BoardRepairer {

    // ── Entry point ───────────────────────────────────────────────────────────

    // builder and config are optional — repair degrades gracefully without them.
    repair(paths, grid, validator, oracle, difficulty, builder = null, config = {}) {
        const MAX_ITER = 3;

        // ctr for assigning IDs to any new paths created during repair
        const ctr = { n: paths.reduce((m, p) => Math.max(m, p.id), -1) + 1 };

        for (let iter = 0; iter < MAX_ITER; iter++) {

            // Step 1 — fix paths whose arrowhead points into own body
            const fixedPaths = this._fixInvalidPaths(paths, grid, oracle);
            if (fixedPaths > 0)
                console.log(`[BoardRepairer] iter ${iter}: fixed ${fixedPaths} invalid path(s)`);

            // Step 2 — fill dead (uncovered) nodes via fillD
            if (builder) {
                const fixedNodes = this._fixDeadRegions(paths, grid, builder, ctr);
                if (fixedNodes > 0)
                    console.log(`[BoardRepairer] iter ${iter}: fillD added ${fixedNodes} path(s)`);
            }

            // Step 3 — difficulty adjustment
            if (config.targetScore && difficulty && builder) {
                const cx    = difficulty.evaluate(paths, grid);
                const score = cx.score;

                if (score < config.targetScore * 0.7) {
                    const added = this._fixLowDifficulty(paths, grid, builder, ctr, config);
                    if (added > 0)
                        console.log(`[BoardRepairer] iter ${iter}: injected ${added} chain path(s) for low difficulty`);

                } else if (score > config.targetScore * 1.5) {
                    const fixed = this._fixHighDifficulty(paths, grid, oracle);
                    if (fixed > 0)
                        console.log(`[BoardRepairer] iter ${iter}: reversed blocker for high difficulty`);
                }
            }

            // Revalidate — return immediately on success
            const result = this._revalidate(paths, grid, validator);
            if (result.ok) {
                console.log(`[BoardRepairer] Board repaired on iter ${iter} — coverage: ${result.coverage}%`);
                return result;
            }
        }

        // Return final state even if not ok — Generator decides whether to accept
        return this._revalidate(paths, grid, validator);
    }

    // ── 18.1 — Fix invalid paths ──────────────────────────────────────────────

    // A path is "invalid" when its arrowhead points into its own body
    // (oracle.headSelfClear returns false). Reversing fixes this in most cases.
    _fixInvalidPaths(paths, grid, oracle) {
        let fixed = 0;
        for (const p of paths) {
            if (oracle.headSelfClear(p, grid)) continue;

            const origNodes   = p.nodes.slice();
            const origHeading = p.heading;

            p.nodes = [...p.nodes].reverse();
            p.heading = this._headingFromTail(p.nodes);

            if (oracle.headSelfClear(p, grid) && oracle.isBoardSolvable(paths, grid)) {
                oracle.recomputePlaceOrder(paths, grid);
                fixed++;
            } else {
                // Revert — reversal made things worse
                p.nodes   = origNodes;
                p.heading = origHeading;
            }
        }
        return fixed;
    }

    // ── 18.2 — Fix dead (uncovered) regions ───────────────────────────────────

    // Delegates to RCBuilder.fillD, which is specifically designed to cover any
    // remaining empty nodes via oracle-guided gap fill.
    _fixDeadRegions(paths, grid, builder, ctr) {
        const before = paths.length;
        builder.fillD(grid, paths, ctr);
        return paths.length - before;
    }

    // ── 18.3 — Fix excessive branching ────────────────────────────────────────

    // Paths with inDegree > 3 create very deep dependency chains.
    // True splitting requires DAG re-wiring — logged here, deferred to Phase 9.
    _fixExcessiveBranching(paths, grid, dag) {
        if (!dag?.edges) return 0;
        const inDegree = new Int32Array(paths.length);
        for (const e of dag.edges) if (e.to < paths.length) inDegree[e.to]++;

        let flagged = 0;
        for (let i = 0; i < paths.length; i++) {
            if (inDegree[i] > 3 && paths[i].nodes.length >= 6) {
                console.warn(`[BoardRepairer] Path ${paths[i].id} has inDegree ${inDegree[i]} — splitting deferred to Phase 9`);
                flagged++;
            }
        }
        return flagged;
    }

    // ── 18.4 — Fix low difficulty ─────────────────────────────────────────────

    // Board is too easy — inject a short dependency chain to raise the score.
    _fixLowDifficulty(paths, grid, builder, ctr, config) {
        const before   = paths.length;
        const chainRow = 1 + ((Math.random() * grid.rows) | 0);
        builder.buildChain(grid, paths, ctr, 1, chainRow);
        return paths.length - before;
    }

    // ── 18.5 — Fix high difficulty ────────────────────────────────────────────

    // Board is too hard — find the path that blocks the most others and reverse
    // it so its arrowhead no longer blocks as many paths.
    _fixHighDifficulty(paths, grid, oracle) {
        const DR = { UP: -1, DOWN: 1, LEFT: 0, RIGHT: 0 };
        const DC = { UP: 0,  DOWN: 0, LEFT: -1, RIGHT: 1 };

        // Build node→pathId map
        const nodeMap = new Map();
        for (const p of paths)
            for (const n of p.nodes) nodeMap.set(`${n.r},${n.c}`, p.id);

        // Count how many paths each path is blocking (directly)
        const blocksCount = new Map(paths.map(p => [p.id, 0]));
        for (const p of paths) {
            const head = p.head();
            const dr   = DR[p.heading], dc = DC[p.heading];
            let r = head.r + dr, c = head.c + dc;
            while (grid.inBounds(r, c)) {
                const bid = nodeMap.get(`${r},${c}`);
                if (bid !== undefined && bid !== p.id) {
                    blocksCount.set(bid, (blocksCount.get(bid) || 0) + 1);
                    break;
                }
                r += dr; c += dc;
            }
        }

        // Find the biggest blocker
        let maxBlocks = 1, target = null;
        for (const [id, count] of blocksCount) {
            if (count > maxBlocks) { maxBlocks = count; target = paths.find(p => p.id === id); }
        }

        if (!target) return 0;

        // Try reversing
        const origNodes   = target.nodes.slice();
        const origHeading = target.heading;
        target.nodes   = [...target.nodes].reverse();
        target.heading = this._headingFromTail(target.nodes);

        if (oracle.headSelfClear(target, grid) && oracle.isBoardSolvable(paths, grid)) {
            oracle.recomputePlaceOrder(paths, grid);
            return 1;
        }

        // Revert
        target.nodes   = origNodes;
        target.heading = origHeading;
        return 0;
    }

    // ── 18.6 — Revalidate ────────────────────────────────────────────────────

    _revalidate(paths, grid, validator) {
        return validator.checkBoard(paths, grid);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    _headingFromTail(nodes) {
        if (nodes.length < 2) return 'RIGHT';
        const last = nodes[nodes.length - 1], prev = nodes[nodes.length - 2];
        return Path.deltaToHeading(last.r - prev.r, last.c - prev.c);
    }
}
