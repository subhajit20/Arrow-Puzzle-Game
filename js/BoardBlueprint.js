// =============================================================================
// BoardBlueprint.js — Central data carrier for the 18-stage generation pipeline
//
// Every stage reads from and writes to one section of this object.
// No stage owns fields from another stage's section.
//
// Section lifecycle:
//   config        — populated by PipelineConfig (Stage 0)
//   grid          — populated by Generator at grid creation (Stage 1)
//   regions       — populated by RegionLayout (Stage 2)
//   connectivity  — populated by RegionConnectivity (Stage 3)
//   topology      — populated by TopologyGenerator (Stage 4)
//   motifs        — populated by MotifAssigner (Stage 5)
//   skeletons     — populated by MotifSkeletonGenerator (Stage 6)
//   regionGraphs  — populated by RegionNodeGraphBuilder (Stage 7)
//   globalGraph   — populated by GlobalNodeGraphBuilder (Stage 8)
//   routedPaths   — populated by PathRouter (Stage 9)
//   interactions  — populated by PathInteractionDetector (Stage 10)
//   dependencyGraph — populated by DependencyGraphBuilder (Stage 11)
//   solveOrder    — populated by SolveOrderPlanner (Stage 12)
//   rcConstraints — populated by toRCConstraints() adapter
// =============================================================================

class BoardBlueprint {
    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    constructor(config = null) {
        // Stage 0 — generation configuration
        // { seed, difficultyTarget, boardRows, boardCols, mask, activeCount,
        //   motifWeights, topologyWeights }
        this.config = config ? this._copyConfig(config) : null;

        // Stage 1 — grid dimensions and mask
        // { rows, cols, mask, activeCount }
        this.grid = null;

        // Stage 2 — region layout
        // { regionCount, assignment: Int32Array, regions: [...] }
        this.regions = null;

        // Stage 3 — region connectivity graph
        // { adjacency: Map, links: [...] }
        this.connectivity = null;

        // Stage 4 — topology
        // { style, graph: { nodes, edges } }
        this.topology = null;

        // Stage 5 — motif assignments
        // [{ regionId, type, parameters }]
        this.motifs = null;

        // Stage 6 — motif skeletons
        // [{ regionId, anchorNodes, entryNodes, exitNodes, internalNodes, nodeSet }]
        this.skeletons = null;

        // Stage 7 — per-region node graphs
        // [{ regionId, nodes, edges }]
        this.regionGraphs = null;

        // Stage 8 — global node graph
        // { nodes: [{ id, r, c, regionId, role }], edges: [...] }
        this.globalGraph = null;

        // Stage 9 — routed paths
        // [{ regionId, motifType, nodes, heading, role }]
        this.routedPaths = null;

        // Stage 10 — path interaction metadata
        // { blocking, containment, nesting, hiddenDeps }
        this.interactions = null;

        // Stage 11 — dependency DAG
        // { nodes, edges, roots, leaves }
        this.dependencyGraph = null;

        // Stage 12 — solve order
        // { intendedSequence, solvableDepth, fixedPaths, blockerRatio }
        this.solveOrder = null;

        // Adapter output — consumed by RCBuilder.fillWithBlueprint()
        // { fixedPaths, chainDepth, clusterCenters, topoWeight, zoneOverride }
        this.rcConstraints = null;
    }

    // -------------------------------------------------------------------------
    // Adapter — Stage 12 → Stage 13
    // -------------------------------------------------------------------------

    // Translates blueprint data into RCBuilder constraints.
    // Returns null until Stage 12 (SolveOrderPlanner) has run.
    toRCConstraints() {
        if (!this.solveOrder || !this.solveOrder.fixedPaths) return null;

        this.rcConstraints = {
            fixedPaths:     this.solveOrder.fixedPaths,
            chainDepth:     this.solveOrder.solvableDepth,
            clusterCenters: this.regions
                ? this.regions.regions.map(r => r.center)
                : [],
            topoWeight:     this.solveOrder.blockerRatio,
            zoneOverride:   this._buildZoneOverride(),
        };

        return this.rcConstraints;
    }

    // -------------------------------------------------------------------------
    // Validation
    // -------------------------------------------------------------------------

    // Structural self-check. Logs a warning for each section that is
    // unexpectedly null or structurally inconsistent.
    validate() {
        const warn = (msg) => console.warn(`[BoardBlueprint] ${msg}`);
        let ok = true;

        if (!this.config) {
            warn('config is null — PipelineConfig has not run');
            ok = false;
        } else {
            if (typeof this.config.boardRows !== 'number') { warn('config.boardRows missing'); ok = false; }
            if (typeof this.config.boardCols !== 'number') { warn('config.boardCols missing'); ok = false; }
            if (!this.config.difficultyTarget)             { warn('config.difficultyTarget missing'); ok = false; }
            if (!this.config.motifWeights)                 { warn('config.motifWeights missing'); ok = false; }
            if (!this.config.topologyWeights)              { warn('config.topologyWeights missing'); ok = false; }
        }

        if (!this.grid) {
            warn('grid is null — Stage 1 has not run');
            ok = false;
        } else {
            if (typeof this.grid.rows !== 'number') { warn('grid.rows missing'); ok = false; }
            if (typeof this.grid.cols !== 'number') { warn('grid.cols missing'); ok = false; }
        }

        // Warn about downstream sections only when upstream sections exist,
        // to avoid redundant noise on partially-built blueprints.
        if (this.regions      && !this.connectivity)    warn('regions populated but connectivity is null');
        if (this.connectivity && !this.topology)         warn('connectivity populated but topology is null');
        if (this.topology     && !this.motifs)           warn('topology populated but motifs is null');
        if (this.motifs       && !this.skeletons)        warn('motifs populated but skeletons is null');
        if (this.skeletons    && !this.regionGraphs)     warn('skeletons populated but regionGraphs is null');
        if (this.regionGraphs && !this.globalGraph)      warn('regionGraphs populated but globalGraph is null');
        if (this.globalGraph  && !this.routedPaths)      warn('globalGraph populated but routedPaths is null');
        if (this.routedPaths  && !this.interactions)     warn('routedPaths populated but interactions is null');
        if (this.interactions && !this.dependencyGraph)  warn('interactions populated but dependencyGraph is null');
        if (this.dependencyGraph && !this.solveOrder)    warn('dependencyGraph populated but solveOrder is null');
        if (this.solveOrder      && !this.rcConstraints) warn('solveOrder populated but rcConstraints is null — call toRCConstraints()');

        return ok;
    }

    // -------------------------------------------------------------------------
    // Clone
    // -------------------------------------------------------------------------

    // Returns a deep copy. Typed arrays (mask, assignment) are copied into new
    // buffers. Null sections remain null. Object sections are deep-cloned via
    // JSON round-trip except for typed arrays which are copied explicitly.
    clone() {
        const b = new BoardBlueprint();

        b.config = this.config ? this._copyConfig(this.config) : null;
        b.grid   = this.grid   ? this._copyGrid(this.grid)     : null;

        // Sections with typed arrays need explicit handling
        b.regions = this.regions ? this._copyRegions(this.regions) : null;

        // Remaining sections: JSON round-trip is safe — no typed arrays after Stage 3
        b.connectivity   = this._jsonClone(this.connectivity);
        b.topology       = this._jsonClone(this.topology);
        b.motifs         = this._jsonClone(this.motifs);
        b.skeletons      = this._jsonClone(this.skeletons);
        b.regionGraphs   = this._jsonClone(this.regionGraphs);
        b.globalGraph    = this._jsonClone(this.globalGraph);
        b.routedPaths    = this._jsonClone(this.routedPaths);
        b.interactions   = this._jsonClone(this.interactions);
        b.dependencyGraph = this._jsonClone(this.dependencyGraph);
        b.solveOrder     = this._jsonClone(this.solveOrder);
        b.rcConstraints  = this._jsonClone(this.rcConstraints);

        return b;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    _copyConfig(cfg) {
        return {
            seed:             cfg.seed,
            difficultyTarget: cfg.difficultyTarget,
            boardRows:        cfg.boardRows,
            boardCols:        cfg.boardCols,
            activeCount:      cfg.activeCount,
            mask:             cfg.mask instanceof Uint8Array
                                  ? new Uint8Array(cfg.mask)
                                  : cfg.mask,
            motifWeights:     cfg.motifWeights
                                  ? { ...cfg.motifWeights }
                                  : null,
            topologyWeights:  cfg.topologyWeights
                                  ? { ...cfg.topologyWeights }
                                  : null,
        };
    }

    _copyGrid(g) {
        return {
            rows:        g.rows,
            cols:        g.cols,
            activeCount: g.activeCount,
            mask:        g.mask instanceof Uint8Array
                             ? new Uint8Array(g.mask)
                             : g.mask,
        };
    }

    _copyRegions(r) {
        return {
            regionCount: r.regionCount,
            assignment:  r.assignment instanceof Int32Array
                             ? new Int32Array(r.assignment)
                             : r.assignment,
            regions:     r.regions.map(reg => ({
                ...reg,
                center: { ...reg.center },
                nodes:  reg.nodes.map(n => ({ r: n.r, c: n.c })),
            })),
        };
    }

    _jsonClone(val) {
        if (val === null || val === undefined) return null;
        return JSON.parse(JSON.stringify(val));
    }

    // Builds a ZoneMap-compatible override whose walkKnobs and lenScale are tuned
    // per motif type, so RC-generated paths within each region visually express
    // the region's motif style. Returns null until Stage 5 (motif assignment) runs.
    //
    // Knob design intent:
    //   CORRIDOR    — very long straight runs, almost no turns
    //   SNAKE       — long straight segments, sharp turn at segment end
    //   NESTED_RECT — long straight edges, regular 90° turns
    //   RING        — medium runs, regular turns
    //   LOOP        — balanced winding
    //   CHAMBER     — short-medium, clustered
    //   SPIRAL      — short runs, frequent turns, inward tendency
    //   ZIGZAG      — minimal straight, constant turns
    _buildZoneOverride() {
        if (!this.motifs || !this.regions) return null;

        // Per-motif walk-scoring knobs (same interface as ZoneMap.WALK_KNOBS)
        const MOTIF_KNOBS = {
            CORRIDOR:    { straightScore: 1.9,  turnScore: 0.08, maxStraight: 22 },
            SNAKE:       { straightScore: 1.4,  turnScore: 0.28, maxStraight: 12 }, // nested box = straight edges + 90° corners
            NESTED_RECT: { straightScore: 1.4,  turnScore: 0.28, maxStraight: 12 },
            RING:        { straightScore: 0.9,  turnScore: 0.65, maxStraight: 5  },
            LOOP:        { straightScore: 0.55, turnScore: 1.4,  maxStraight: 3  },
            CHAMBER:     { straightScore: 0.60, turnScore: 1.0,  maxStraight: 4  },
            SPIRAL:      { straightScore: 0.12, turnScore: 2.8,  maxStraight: 3  },
            ZIGZAG:      { straightScore: 0.08, turnScore: 2.6,  maxStraight: 2  },
        };

        // Per-motif length multiplier (multiplied by knobs.lenScale in fillA).
        // SPIRAL and ZIGZAG must be long enough that the turn pattern is visible —
        // short paths just look like random noise regardless of turn rate.
        const MOTIF_LEN = {
            CORRIDOR:    2.2,
            SNAKE:       1.5,
            NESTED_RECT: 1.5,
            RING:        1.1,
            LOOP:        1.0,
            CHAMBER:     0.90,
            SPIRAL:      1.3,
            ZIGZAG:      1.4,
        };

        const FALLBACK_KNOBS = ZoneMap.WALK_KNOBS[ZoneMap.NEUTRAL];
        const FALLBACK_LEN   = 1.0;

        // Build a flat per-node motif lookup (index = r * W + c)
        const rows = this.grid.rows;
        const cols = this.grid.cols;
        const W    = cols + 1;
        const nodeType = new Array((rows + 1) * W).fill(null);

        const regionToType = new Map(this.motifs.map(m => [m.regionId, m.type]));
        const assignment   = this.regions.assignment;

        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                const rid = assignment[r * W + c];
                if (rid >= 0) nodeType[r * W + c] = regionToType.get(rid) || null;
            }
        }

        // Return an object implementing the ZoneMap interface
        return {
            walkKnobs(r, c) {
                const t = nodeType[r * W + c];
                return MOTIF_KNOBS[t] || FALLBACK_KNOBS;
            },
            lenScale(r, c) {
                const t = nodeType[r * W + c];
                return MOTIF_LEN[t] ?? FALLBACK_LEN;
            },
        };
    }
}
