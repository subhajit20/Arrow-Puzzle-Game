// =============================================================================
// Path.js — A single arrow path on the board
//
// A path is an ordered sequence of orthogonally adjacent nodes.
// The HEAD is nodes[last] — the arrowhead that the player fires.
// The TAIL is nodes[0]   — the end the player pulls from in reverse play.
// HEADING is the direction from nodes[last-1] → nodes[last].
// =============================================================================

class Path {
    // nodes: array of {r, c} objects
    // heading: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
    constructor(id, nodes, heading) {
        this.id               = id;
        this.nodes            = nodes.map(n => ({ r: n.r, c: n.c }));
        this.heading          = heading;
        this.state            = 'IDLE';   // IDLE | MOVING | CRASHING | CLEARED
        this.animProgress     = 0;        // 0.0 → 1.0 float driving slide animation
        this.crashFlashFrames = 0;
        this.placeOrder       = id;       // recomputed by SolvabilityOracle
        this.originalNodes    = nodes.map(n => ({ r: n.r, c: n.c }));
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    head() { return this.nodes[this.nodes.length - 1]; }
    tail() { return this.nodes[0]; }

    // ── Clone ─────────────────────────────────────────────────────────────────

    clone() {
        const p          = new Path(this.id, this.nodes, this.heading);
        p.state          = this.state;
        p.animProgress   = this.animProgress;
        p.placeOrder     = this.placeOrder;
        p.originalNodes  = this.originalNodes.map(n => ({ r: n.r, c: n.c }));
        return p;
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    // Restores path to its original node sequence and resets animation state.
    // Heading is re-derived from the last two original nodes.
    reset() {
        this.nodes            = this.originalNodes.map(n => ({ r: n.r, c: n.c }));
        this.state            = 'IDLE';
        this.animProgress     = 0;
        this.crashFlashFrames = 0;

        if (this.nodes.length >= 2) {
            const a    = this.nodes[this.nodes.length - 2];
            const b    = this.nodes[this.nodes.length - 1];
            this.heading = Path.deltaToHeading(b.r - a.r, b.c - a.c);
        }
    }

    // ── Reverse ───────────────────────────────────────────────────────────────

    // Reverses the node sequence so the old tail becomes the new head.
    // Recomputes heading from the new last two nodes.
    reverse() {
        this.nodes.reverse();
        if (this.nodes.length >= 2) {
            const a    = this.nodes[this.nodes.length - 2];
            const b    = this.nodes[this.nodes.length - 1];
            this.heading = Path.deltaToHeading(b.r - a.r, b.c - a.c);
        }
    }

    // ── Static heading helpers ────────────────────────────────────────────────

    static headingToDelta(heading) {
        if (heading === 'UP')   return { dr: -1, dc:  0 };
        if (heading === 'DOWN') return { dr:  1, dc:  0 };
        if (heading === 'LEFT') return { dr:  0, dc: -1 };
        return                         { dr:  0, dc:  1 };
    }

    static deltaToHeading(dr, dc) {
        if (dr === -1) return 'UP';
        if (dr ===  1) return 'DOWN';
        if (dc === -1) return 'LEFT';
        return 'RIGHT';
    }

    // ── Static factory ────────────────────────────────────────────────────────

    // Creates a Path from a legacy plain-object path (used during transition).
    static fromLegacy(obj) {
        const p          = new Path(obj.id, obj.nodes, obj.heading);
        p.state          = obj.state          || 'IDLE';
        p.animProgress   = obj.animProgress   || 0;
        p.placeOrder     = obj.placeOrder      != null ? obj.placeOrder : obj.id;
        p.originalNodes  = (obj.originalNodes || obj.nodes).map(n => ({ r: n.r, c: n.c }));
        return p;
    }

    // Converts back to a plain object for persistence / BoardLoader export.
    toLegacy() {
        return {
            id:            this.id,
            nodes:         this.nodes.map(n => ({ r: n.r, c: n.c })),
            heading:       this.heading,
            state:         this.state,
            animProgress:  this.animProgress,
            placeOrder:    this.placeOrder,
            originalNodes: this.originalNodes.map(n => ({ r: n.r, c: n.c })),
            crashFlashFrames: this.crashFlashFrames,
        };
    }
}
