// =============================================================================
// PipelineConfig.js — Stage 0 configuration for the generation pipeline
//
// Derives motif weights and topology weights from a level number.
// The Generator calls fromLevel() to produce a config object, then fills in
// the runtime fields (boardRows, boardCols, mask, activeCount, difficultyTarget)
// before handing the config to BoardBlueprint.
//
// Weight progression:
//   Levels  1–30  — CORRIDOR + LOOP dominant; simple topology (LINEAR/STAR)
//   Levels 31–60  — SPIRAL + RING introduced; TREE topology unlocked
//   Levels 61+    — NESTED_RECT + CHAMBER unlocked; MESH topology unlocked
// =============================================================================

class PipelineConfig {

    // ── Main factory ──────────────────────────────────────────────────────────

    // Returns a partial config object. Runtime fields (boardRows, boardCols,
    // mask, activeCount, difficultyTarget) are null — the Generator fills them.
    static fromLevel(level, seed = null, context = 'normal') {
        const resolvedSeed = seed !== null ? seed : PipelineConfig._defaultSeed(level);
        return {
            level,                    // stored so downstream stages can gate by level
            seed: resolvedSeed,
            context,
            difficultyTarget: null,   // set by Generator after tier selection
            boardRows: null,   // set by Generator after size selection
            boardCols: null,   // set by Generator after size selection
            mask: null,   // set by Generator after mask selection
            activeCount: null,   // set by Generator after mask selection
            motifWeights: PipelineConfig.motifWeightsForLevel(level, resolvedSeed),
            topologyWeights: PipelineConfig.topologyWeightsForLevel(level),
        };
    }

    // ── Motif weights ─────────────────────────────────────────────────────────

    // Returns relative weights for each motif type at the given level.
    // Weights do not need to sum to any fixed value — they are used for
    // weighted random selection by MotifAssigner.
    //
    //   CORRIDOR      — straight channel; works in any elongated region
    //   LOOP          — closed cycle; simple, any region
    //   SNAKE         — alternating segments; elongated regions
    //   ZIGZAG        — sharp alternating turns; elongated or irregular
    //   SPIRAL        — concentric turns; square regions, area ≥ 40 nodes
    //   RING          — perimeter path; compact square regions
    //   NESTED_RECT   — concentric rectangles; square regions, area ≥ 60 nodes
    //   CHAMBER       — rooms + connectors; irregular regions
    static motifWeightsForLevel(level, seed = null) {
        // Predefined 7 theme palettes using CORRIDOR, NESTED_RECT, RING, LOOP, SNAKE
        const palettes = [
            { CORRIDOR: 40, SPIRAL: 0, NESTED_RECT: 40, LOOP: 0,  SNAKE: 0,  ZIGZAG: 0, RING: 40, CHAMBER: 0 }, // CORRIDOR, NESTED_RECT, RING
            { CORRIDOR: 0,  SPIRAL: 0, NESTED_RECT: 45, LOOP: 30, SNAKE: 0,  ZIGZAG: 0, RING: 45, CHAMBER: 0 }, // NESTED_RECT, LOOP, RING
            { CORRIDOR: 50, SPIRAL: 0, NESTED_RECT: 0,  LOOP: 35, SNAKE: 20, ZIGZAG: 0, RING: 0,  CHAMBER: 0 }, // LOOP, SNAKE, CORRIDOR
            { CORRIDOR: 45, SPIRAL: 0, NESTED_RECT: 0,  LOOP: 35, SNAKE: 0,  ZIGZAG: 0, RING: 40, CHAMBER: 0 }, // CORRIDOR, LOOP, RING
            { CORRIDOR: 0,  SPIRAL: 0, NESTED_RECT: 45, LOOP: 0,  SNAKE: 20, ZIGZAG: 0, RING: 45, CHAMBER: 0 }, // NESTED_RECT, SNAKE, RING
            { CORRIDOR: 0,  SPIRAL: 0, NESTED_RECT: 0,  LOOP: 35, SNAKE: 20, ZIGZAG: 0, RING: 45, CHAMBER: 0 }, // LOOP, SNAKE, RING
            { CORRIDOR: 45, SPIRAL: 0, NESTED_RECT: 0,  LOOP: 0,  SNAKE: 20, ZIGZAG: 0, RING: 45, CHAMBER: 0 }  // CORRIDOR, SNAKE, RING
        ];

        const val = seed !== null ? seed : level;
        const idx = Math.abs(val | 0) % palettes.length;
        return { ...palettes[idx] };

        // Early (1–10): only simple linear motifs
        if (level <= 10) {
            return {
                CORRIDOR: 50,
                LOOP: 30,
                SNAKE: 15,
                ZIGZAG: 5,
                SPIRAL: 0,
                RING: 0,
                NESTED_RECT: 0,
                CHAMBER: 0,
            };
        }

        // Beginner (11–30): linear motifs dominate; RING introduced lightly
        if (level <= 30) {
            return {
                CORRIDOR: 40,
                LOOP: 30,
                SNAKE: 18,
                ZIGZAG: 7,
                SPIRAL: 0,
                RING: 5,
                NESTED_RECT: 0,
                CHAMBER: 0,
            };
        }

        // Intermediate (31–50): SPIRAL and RING enter; linear motifs reduce
        if (level <= 50) {
            return {
                CORRIDOR: 28,
                LOOP: 20,
                SNAKE: 15,
                ZIGZAG: 10,
                SPIRAL: 15,
                RING: 12,
                NESTED_RECT: 0,
                CHAMBER: 0,
            };
        }

        // Advanced (51–60): SPIRAL becomes dominant; RING grows
        if (level <= 60) {
            return {
                CORRIDOR: 22,
                LOOP: 14,
                SNAKE: 13,
                ZIGZAG: 9,
                SPIRAL: 22,
                RING: 15,
                NESTED_RECT: 0,
                CHAMBER: 5,
            };
        }

        // Expert (61–80): NESTED_RECT unlocked; CHAMBER grows
        if (level <= 80) {
            return {
                CORRIDOR: 18,
                LOOP: 10,
                SNAKE: 10,
                ZIGZAG: 8,
                SPIRAL: 22,
                RING: 12,
                NESTED_RECT: 14,
                CHAMBER: 6,
            };
        }

        // Master (81+): full motif palette; NESTED_RECT and SPIRAL lead
        return {
            CORRIDOR: 13,
            LOOP: 9,
            SNAKE: 9,
            ZIGZAG: 6,
            SPIRAL: 22,
            RING: 11,
            NESTED_RECT: 20,
            CHAMBER: 10,
        };
    }

    // ── Topology weights ──────────────────────────────────────────────────────

    // Returns relative weights for topology styles at the given level.
    //
    //   LINEAR — chain: A→B→C→D (simplest dependency chain)
    //   STAR   — hub + spokes: all regions unlock from one central region
    //   TREE   — branching hierarchy: multiple levels of unlock chains
    //   MESH   — dense cross-dependencies: multiple unlock paths (hardest)
    static topologyWeightsForLevel(level) {
        // Early (1–20): linear chains only; STAR just unlocked
        if (level <= 20) {
            return {
                LINEAR: 65,
                STAR: 25,
                TREE: 10,
                MESH: 0,
            };
        }

        // Beginner (21–40): TREE introduced
        if (level <= 40) {
            return {
                LINEAR: 45,
                STAR: 28,
                TREE: 22,
                MESH: 5,
            };
        }

        // Intermediate (41–60): TREE grows; MESH enters
        if (level <= 60) {
            return {
                LINEAR: 28,
                STAR: 25,
                TREE: 32,
                MESH: 15,
            };
        }

        // Advanced (61–80): MESH becomes significant
        if (level <= 80) {
            return {
                LINEAR: 18,
                STAR: 22,
                TREE: 35,
                MESH: 25,
            };
        }

        // Master (81+): TREE and MESH dominant
        return {
            LINEAR: 12,
            STAR: 18,
            TREE: 38,
            MESH: 32,
        };
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    // Merges runtime fields into a partial config returned by fromLevel().
    // Generator calls this once it has determined rows, cols, mask, tier.
    static mergeRuntime(config, { boardRows, boardCols, mask, activeCount, difficultyTarget }) {
        config.boardRows = boardRows;
        config.boardCols = boardCols;
        config.mask = mask;
        config.activeCount = activeCount;
        config.difficultyTarget = difficultyTarget;
        return config;
    }

    // Picks a weighted random key from a weights object.
    // Returns null if all weights are zero.
    static weightedPick(weights, rng = Math.random) {
        const keys = Object.keys(weights);
        const total = keys.reduce((s, k) => s + weights[k], 0);
        if (total === 0) return null;

        let roll = rng() * total;
        for (const k of keys) {
            roll -= weights[k];
            if (roll <= 0) return k;
        }
        return keys[keys.length - 1];
    }

    // Default seed: mix level with a millisecond timestamp so every generation
    // call produces a unique region layout even at the same level.
    // (The daily puzzle always passes its own explicit seed — this only fires
    //  for normal levels where variety is desired.)
    static _defaultSeed(level) {
        const now = typeof Date !== 'undefined' ? Date.now() : Math.floor(Math.random() * 0xFFFFFFFF);
        return ((level * 1000003) ^ (now * 1664525 + 1013904223)) >>> 0;
    }
}
