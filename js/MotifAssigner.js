// =============================================================================
// MotifAssigner.js — Stage 5: assign motif types to regions
//
// Maps each region to one of 8 motif types based on:
//   - region shape (aspectRatio, compactness, area)
//   - level-gated motifWeights from PipelineConfig
//   - topology role (ROOT/LEAF/HUB/BRANCH) may bias selection
//
// Motif types and their structural requirements:
//   CORRIDOR     — elongated region  (aspectRatio > 2.0)
//   SPIRAL       — compact square    (aspectRatio ≤ 1.5, area > 40)
//   NESTED_RECT  — compact square    (aspectRatio ≤ 1.5, area > 60)
//   LOOP         — any               (area > 20)
//   SNAKE        — elongated         (aspectRatio > 1.5, area > 12)
//   ZIGZAG       — elongated or irregular
//   RING         — compact, bounded  (aspectRatio ≤ 1.5, area 15–80)
//   CHAMBER      — irregular shape   (compactness < 0.35, area > 30)
//
// Pipeline:
//   5.1 _analyzeShapes      — ELONGATED / SQUARE / IRREGULAR per region
//   5.2 _selectCandidates   — filter by shape + level weights
//   5.3 _assignTypes        — weighted random per region
//   5.4 _assignParameters   — derive size params from region geometry
//   5.5 _validateCompatibility — fix area violations; no adjacent RINGs
//
// Result: [{ regionId, type, parameters }]
// =============================================================================

class MotifAssigner {

    // ── Entry point ───────────────────────────────────────────────────────────

    assign(regionLayout, topology, config) {
        const { regions } = regionLayout;
        const rng = MotifAssigner._lcg(config.seed ?? 0);

        // Stage 5.1 — shape classification
        const shapeClasses = this._analyzeShapes(regionLayout);

        // Stage 5.2 + 5.3 — candidate selection and type assignment
        const assignments = regions.map((reg, i) => {
            const topoNode   = topology?.graph?.nodes?.find(n => n.regionId === i) ?? null;
            const candidates = this._selectCandidates(
                reg, shapeClasses[i], topoNode, config.motifWeights
            );
            const type = PipelineConfig.weightedPick(candidates, rng) || 'LOOP';
            return { regionId: i, type, parameters: null };
        });

        // Stage 5.4 — derive parameters from region geometry
        for (const a of assignments)
            a.parameters = this._assignParameters(a.type, regions[a.regionId]);

        // Stage 5.5 — fix any structural incompatibilities
        this._validateCompatibility(assignments, regions);

        return assignments;
    }

    // ── Stage 5.1 — shape classification ─────────────────────────────────────

    // IRREGULAR: very non-convex (compactness < 0.35)
    // ELONGATED: noticeably elongated (aspectRatio > 2.0)
    // SQUARE:    everything else (includes mildly elongated compact regions)
    _analyzeShapes(regionLayout) {
        return regionLayout.regions.map(reg => {
            if (reg.compactness < 0.35) return 'IRREGULAR';
            if (reg.aspectRatio  > 2.0) return 'ELONGATED';
            return 'SQUARE';
        });
    }

    // ── Stage 5.2 — candidate weight map ─────────────────────────────────────

    // Returns a filtered weight map: only motifs whose structural requirements
    // are met AND whose level weight is > 0.
    _selectCandidates(region, shapeClass, topoNode, motifWeights) {
        const { area, aspectRatio, compactness } = region;
        const w = {};

        const add = (key, condition) => {
            if (condition && motifWeights[key] > 0) w[key] = motifWeights[key];
        };

        add('CORRIDOR',    aspectRatio > 1.5 && area > 15);   // A: was > 2.0 — too strict, CORRIDOR ~never qualified
        add('SPIRAL',      aspectRatio <= 2.2 && area > 40 && compactness > 0.3);
        add('NESTED_RECT', aspectRatio <= 2.2 && area > 60);
        add('LOOP',        area > 20);
        add('SNAKE',       aspectRatio > 1.5 && area > 12);
        add('ZIGZAG',      shapeClass !== 'SQUARE' || area > 20);   // B: allow square regions too — ZIGZAG was effectively dead
        add('RING',        aspectRatio <= 2.2 && area >= 15 && area <= 80);
        add('CHAMBER',     area > 25); // works for any region shape

        // Topology-role bias: ROOT regions lean toward shorter paths (LOOP/CORRIDOR)
        // LEAF regions lean toward complex motifs (SPIRAL/NESTED_RECT)
        if (topoNode) {
            if (topoNode.role === 'ROOT') {
                // C: dropped the LOOP ×1.4 boost — LOOP is already the universal
                // fallback, so amplifying it here made it dominate (~61% of regions).
                if (w.CORRIDOR)  w.CORRIDOR  = Math.round(w.CORRIDOR * 1.2);
            }
            if (topoNode.role === 'LEAF') {
                if (w.SPIRAL)      w.SPIRAL      = Math.round(w.SPIRAL * 1.4);
                if (w.NESTED_RECT) w.NESTED_RECT = Math.round(w.NESTED_RECT * 1.3);
            }
        }

        // Fallback: any region can be a LOOP if nothing else fits
        if (!Object.keys(w).length) {
            w[area > 10 ? 'LOOP' : 'CORRIDOR'] = 1;
        }

        return w;
    }

    // ── Stage 5.4 — parameter derivation ─────────────────────────────────────

    _assignParameters(type, region) {
        const { center, area, aspectRatio } = region;
        const axis = this._longerAxis(region); // 'H' or 'V'

        switch (type) {
            case 'CORRIDOR':
                return {
                    axis,
                    width: Math.min(3, Math.max(1, (area / 15) | 0)),
                };

            case 'SPIRAL':
                return {
                    center:  { r: center.r, c: center.c },
                    rings:   Math.min(4, Math.max(2, (Math.sqrt(area) / 3) | 0)),
                    turnDir: 1,
                };

            case 'NESTED_RECT':
                return {
                    depth:      Math.min(4, Math.max(2, (Math.sqrt(area) / 4) | 0)),
                    marginStep: 2,
                };

            case 'LOOP':
                return {
                    cycleLength: Math.min(20, Math.max(6, (area / 4) | 0)),
                };

            case 'SNAKE': {
                const segs = Math.min(5, Math.max(2, (area / 12) | 0));
                return {
                    axis,
                    segmentCount:  segs,
                    segmentLength: Math.max(3, (area / (segs * 2)) | 0),
                };
            }

            case 'ZIGZAG':
                return {
                    axis,
                    amplitude: Math.min(4, Math.max(2, (area / 20) | 0)),
                    period:    4,
                };

            case 'RING':
                return {
                    center: { r: center.r, c: center.c },
                    radius: Math.min(5, Math.max(2, (Math.sqrt(area) / 2) | 0)),
                };

            case 'CHAMBER':
                return {
                    roomCount:       Math.min(3, Math.max(2, (area / 20) | 0)),
                    connectorWidth:  1,
                };

            default:
                return {};
        }
    }

    // ── Stage 5.5 — compatibility validation ─────────────────────────────────

    // Fixes assignments that violate hard size constraints.
    // Adjacent RING detection requires connectivity — deferred to Phase 5
    // (RingRing adjacency is a topology concern, not a geometry concern).
    _validateCompatibility(assignments, regions) {
        for (const a of assignments) {
            const reg = regions[a.regionId];
            let changed = false;

            if (a.type === 'SPIRAL' && reg.area < 40) {
                a.type = 'LOOP'; changed = true;
            } else if (a.type === 'NESTED_RECT' && reg.area < 60) {
                a.type = reg.area >= 15 ? 'RING' : 'LOOP'; changed = true;
            } else if (a.type === 'CHAMBER' && reg.area < 25) {
                a.type = 'LOOP'; changed = true;
            } else if (a.type === 'RING' && (reg.area < 15 || reg.area > 80)) {
                a.type = reg.area < 15 ? 'CORRIDOR' : 'SPIRAL'; changed = true;
            }

            if (changed) a.parameters = this._assignParameters(a.type, reg);
        }
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    // Determines the longer axis from the region's node bounding box.
    // Returns 'V' (vertical, rows > cols) or 'H' (horizontal, cols ≥ rows).
    _longerAxis(region) {
        if (!region.nodes.length) return 'H';
        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        for (const { r, c } of region.nodes) {
            if (r < minR) minR = r; if (r > maxR) maxR = r;
            if (c < minC) minC = c; if (c > maxC) maxC = c;
        }
        return (maxR - minR) > (maxC - minC) ? 'V' : 'H';
    }

    // ── PRNG ──────────────────────────────────────────────────────────────────

    static _lcg(seed) {
        let s = ((seed | 0) ^ 0xcafe5678) >>> 0;
        return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
    }
}
