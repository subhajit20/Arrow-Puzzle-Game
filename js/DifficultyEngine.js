// =============================================================================
// DifficultyEngine.js — Difficulty tier selection and board complexity scoring
//
// Responsibilities:
//   selectTier   — picks the target difficulty tier for a level
//   evaluate     — scores a completed board and maps it to a tier
//   computeDAGStats — builds dependency graph and computes depth/ratio stats
//   chainDepthForTier — maps tier to RC backbone chain depth
//   knobsForTier — maps tier to full RC construction knobs
// =============================================================================

class DifficultyEngine {

    // Oracle is used for branching-factor measurement (solve simulation).
    // Falls back to a private instance so legacy `new DifficultyEngine()`
    // call sites keep working.
    constructor(oracle = null) {
        this.oracle = oracle ||
            (typeof SolvabilityOracle !== 'undefined' ? new SolvabilityOracle() : null);
    }

    // ── Tier → score thresholds ───────────────────────────────────────────────

    static TIER_CENTER = { EASY: 3, NORMAL: 9.5, HARD: 17.5, EXPERT: 25.5, TITAN: 33 };

    // ── Tier → branching-factor target ────────────────────────────────────────
    // Average free pieces per solve step. 1.0 = unique solve order (every move
    // forced). The base applies to small boards (~24 pieces); the target grows
    // logarithmically with piece count because the irreducible branching floor
    // scales with board size (more pieces → more simultaneous unlock cascades).
    // Acceptance tolerance is added on top by the Generator.
    static BRANCH_TARGET = { EASY: 3.0, NORMAL: 2.2, HARD: 1.6, EXPERT: 1.2, TITAN: 1.1 };
    static BRANCH_TOL = { EASY: 1.0, NORMAL: 1.0, HARD: 0.6, EXPERT: 0.4, TITAN: 0.4 };

    branchTargetForTier(tier, pathCount = 24) {
        const base = DifficultyEngine.BRANCH_TARGET[tier] ?? 2.2;
        const sizeAllow = Math.max(0, Math.log2(Math.max(1, pathCount / 24)));
        return base + sizeAllow;
    }

    branchTolForTier(tier) {
        return DifficultyEngine.BRANCH_TOL[tier] ?? 1.0;
    }

    static scoreTier(score) {
        if (score < 6) return 'EASY';
        if (score < 13) return 'NORMAL';
        if (score < 22) return 'HARD';
        if (score < 29) return 'EXPERT';
        return 'TITAN';
    }

    // ── Allowed tiers per level ───────────────────────────────────────────────

    allowedTiers(level) {
        if (level === 100) return ['TITAN'];
        if (level <= 10) return ['EASY', 'NORMAL'];
        if (level <= 20) return ['EASY', 'NORMAL', 'HARD'];
        if (level <= 45) return ['NORMAL', 'HARD'];
        if (level <= 99) return ['NORMAL', 'HARD', 'EXPERT'];
        return ['NORMAL', 'HARD', 'EXPERT', 'TITAN'];
    }

    // ── Tier selection ────────────────────────────────────────────────────────

    // Resolves a weighted probability per level, applying history pacing rules
    // to prevent streaks and inject difficulty relief when needed.
    selectTier(level, recentDifficulties = []) {
        if (level === 100) return 'TITAN';

        let probs;
        if (level <= 10) probs = { EASY: 0.60, NORMAL: 0.40, HARD: 0.00, EXPERT: 0.00, TITAN: 0.00 };
        else if (level <= 20) probs = { EASY: 0.15, NORMAL: 0.75, HARD: 0.10, EXPERT: 0.00, TITAN: 0.00 };
        else if (level <= 45) probs = { EASY: 0.00, NORMAL: 0.35, HARD: 0.65, EXPERT: 0.00, TITAN: 0.00 };
        else if (level <= 70) probs = { EASY: 0.00, NORMAL: 0.20, HARD: 0.60, EXPERT: 0.20, TITAN: 0.00 };
        else if (level <= 99) probs = { EASY: 0.00, NORMAL: 0.05, HARD: 0.50, EXPERT: 0.45, TITAN: 0.00 };
        else probs = { EASY: 0.00, NORMAL: 0.10, HARD: 0.40, EXPERT: 0.35, TITAN: 0.15 };

        const allowed = new Set(Object.keys(probs).filter(t => probs[t] > 0));
        const last1 = recentDifficulties[recentDifficulties.length - 1];
        const last2 = recentDifficulties[recentDifficulties.length - 2];

        // Two easy in a row → push to HARD if available, else NORMAL
        if (last1 === 'EASY' && last2 === 'EASY') {
            probs.EASY = 0;
            const boost = allowed.has('HARD') ? 'HARD' : 'NORMAL';
            if (allowed.has(boost)) probs[boost] = Math.min(1.0, probs[boost] + 0.5);
        }

        // Two hard+ in a row → inject relief
        const hardPlus = t => t === 'HARD' || t === 'EXPERT' || t === 'TITAN';
        if (hardPlus(last1) && hardPlus(last2)) {
            probs.EXPERT = 0; probs.TITAN = 0;
            if (allowed.has('HARD')) probs.HARD = Math.min(probs.HARD, 0.3);
            const relief = allowed.has('EASY') ? 'EASY' : 'NORMAL';
            if (allowed.has(relief)) probs[relief] = Math.max(probs[relief], 0.5);
            if (allowed.has('NORMAL')) probs.NORMAL = Math.max(probs.NORMAL, 0.4);
        }

        // Weighted random selection
        const roll = Math.random();
        let sum = 0;
        for (const tier in probs) {
            sum += probs[tier];
            if (roll <= sum) return tier;
        }
        return [...allowed][0] || 'NORMAL';
    }

    // ── DAG dependency graph ──────────────────────────────────────────────────

    // Builds dep[pathId] = Set of path IDs whose nodes block pathId's head ray.
    // A blocks B means A must be cleared before B can fire.
    _buildDAGDep(paths, grid) {
        const dep = {};
        paths.forEach(p => { dep[p.id] = new Set(); });

        paths.forEach(p => {
            const { dr, dc } = Path.headingToDelta(p.heading);
            const head = p.head ? p.head() : p.nodes[p.nodes.length - 1];
            let r = head.r, c = head.c;

            for (let i = 0; i < grid.rows + grid.cols + 4; i++) {
                const nr = r + dr, nc = c + dc;
                if (!grid.inBounds(nr, nc)) break;
                const owner = grid.owner(nr, nc);
                if (owner >= 0 && owner !== p.id) {
                    dep[p.id].add(owner);
                    break;
                }
                r = nr; c = nc;
            }
        });

        return dep;
    }

    // ── Complexity stats ──────────────────────────────────────────────────────

    // Computes aggregate dependency stats from the DAG.
    //   maxDepth    — longest chain (0 = free, N = N levels of blockers)
    //   free        — paths with no blockers (depth 0)
    //   blockerRatio — avg direct blockers per path
    computeDAGStats(paths, grid) {
        const dep = this._buildDAGDep(paths, grid);
        const depths = {};
        const inStack = new Set();

        const getDepth = id => {
            if (depths[id] !== undefined) return depths[id];
            if (inStack.has(id)) return 0; // cycle guard
            inStack.add(id);
            const blockers = dep[id];
            depths[id] = (!blockers || blockers.size === 0)
                ? 0
                : 1 + Math.max(...[...blockers].map(bid => getDepth(bid)));
            inStack.delete(id);
            return depths[id];
        };

        paths.forEach(p => getDepth(p.id));

        let maxDepth = 0, free = 0, totalBlockers = 0;
        paths.forEach(p => {
            const d = depths[p.id] || 0;
            if (d > maxDepth) maxDepth = d;
            if (d === 0) free++;
            totalBlockers += (dep[p.id]?.size || 0);
        });

        return {
            dep, depths, maxDepth, free,
            blockerRatio: totalBlockers / (paths.length || 1),
        };
    }

    // ── Board evaluation ──────────────────────────────────────────────────────

    // Scores the completed board and returns tier + raw stats.
    // Formula: score = maxDepth × 3 + blockerRatio × 5.5 − branchPenalty
    // branchPenalty replaces the old freeRatio term: it measures free CHOICE
    // across the whole solve (avg free pieces per step), not just at the start.
    // branchAvg 1.0 (unique solve order) → no penalty; mushy boards → up to −9.
    evaluate(paths, grid) {
        const { maxDepth, free, blockerRatio } = this.computeDAGStats(paths, grid);
        const freeRatio = free / (paths.length || 1);

        const branching = this.oracle
            ? this.oracle.measureBranching(paths, grid)
            : { avg: Math.max(1, free), max: free, steps: paths.length };
        const decoys = this.oracle ? this.oracle.countDecoys(paths, grid) : 0;

        const branchPenalty = Math.min(9, Math.max(0, branching.avg - 1) * 3.5);
        const score = Math.max(0, maxDepth * 3 + blockerRatio * 5.5 - branchPenalty);

        return {
            score,
            maxDepth,
            blockerRatio,
            freeRatio,
            initialEscapes: free,
            branchAvg: branching.avg,
            branchMax: branching.max,
            decoys,
            tier: DifficultyEngine.scoreTier(score),
        };
    }

    // ── RC construction knobs ─────────────────────────────────────────────────

    // Maps tier to the chain depth used by RCBuilder.buildChain.
    chainDepthForTier(tier) {
        return { EASY: 2, NORMAL: 4, HARD: 8, EXPERT: 13, TITAN: 18 }[tier] || 0;
    }

    knobsForTier(tier, zoneMap = null) {
        // d — topology weight: fraction of placements that try blocked rays.
        const d = { EASY: 0, NORMAL: 0.4, HARD: 0.55, EXPERT: 0.7, TITAN: 0.85 }[tier] ?? 0.5;
        // lockWeight — how strongly fill phases prefer candidates that sit on
        // a currently-free piece's ray (locking it into the dependency order).
        // 0 = fills are freebies (old behaviour); high = fully interlocked board.
        const lockWeight = { EASY: 0.2, NORMAL: 1.0, HARD: 1.6, EXPERT: 2.2, TITAN: 2.6 }[tier] ?? 1.0;
        return {
            chainDepth: this.chainDepthForTier(tier),
            d,
            lockWeight,
            lenScale: 1,
            zoneMap,
        };
    }
}
