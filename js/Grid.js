// =============================================================================
// Grid.js — Board lattice: node ownership + edge ownership
//
// The board is a (rows+1) × (cols+1) node lattice.
// Every node is either free (-1) or owned by one path (≥ 0).
// Edges are derived from path node sequences — not all edges are used.
// =============================================================================

class Grid {
    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;

        // Flat Int32Array — index: r * (cols+1) + c
        // -1 = free, ≥0 = path id
        this.nodeOwner = new Int32Array((rows + 1) * (cols + 1)).fill(-1);

        // Horizontal edges: hEdge[r][c] — between node(r,c) and node(r,c+1)
        // dims: (rows+1) × cols
        this.hEdge = Array.from({ length: rows + 1 },
            () => new Int32Array(cols).fill(-1));

        // Vertical edges: vEdge[r][c] — between node(r,c) and node(r+1,c)
        // dims: rows × (cols+1)
        this.vEdge = Array.from({ length: rows },
            () => new Int32Array(cols + 1).fill(-1));

        // Degree table — number of edges incident to each node (informational)
        this.degree = Array.from({ length: rows + 1 }, (_, r) =>
            Array.from({ length: cols + 1 }, (_, c) => {
                let d = 0;
                if (c > 0)    d++;
                if (c < cols) d++;
                if (r > 0)    d++;
                if (r < rows) d++;
                return d;
            })
        );

        // Optional shape mask — Uint8Array of (rows+1)*(cols+1).
        // 1 = active (paths can be placed here), 0 = inactive.
        // null = full rectangle (all nodes active).
        this.mask = null;
    }

    // Width of the node lattice (cols + 1)
    get W() { return this.cols + 1; }

    // ── Node ownership ────────────────────────────────────────────────────────

    owner(r, c) {
        return this.nodeOwner[r * this.W + c];
    }

    setOwner(r, c, id) {
        this.nodeOwner[r * this.W + c] = id;
    }

    isFree(r, c) {
        return this.nodeOwner[r * this.W + c] === -1;
    }

    // Returns true if the node is within the active mask area (or mask is null).
    isActive(r, c) {
        return !this.mask || this.mask[r * this.W + c] === 1;
    }

    // A node is available for path placement only if free AND active.
    isAvailable(r, c) {
        return this.isFree(r, c) && this.isActive(r, c);
    }

    // ── Bounds ────────────────────────────────────────────────────────────────

    inBounds(r, c) {
        return r >= 0 && r <= this.rows && c >= 0 && c <= this.cols;
    }

    // ── Edge ownership ────────────────────────────────────────────────────────

    // Marks the edge between two orthogonally adjacent nodes as owned by pathId.
    reserveEdge(r1, c1, r2, c2, pathId) {
        if (r1 === r2) this.hEdge[r1][Math.min(c1, c2)] = pathId;
        else           this.vEdge[Math.min(r1, r2)][c1]  = pathId;
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    // Clears all ownership back to -1 (empty grid).
    reset() {
        this.nodeOwner.fill(-1);
        for (const row of this.hEdge) row.fill(-1);
        for (const row of this.vEdge) row.fill(-1);
    }

    // ── Pocket check helper ───────────────────────────────────────────────────

    // Returns how many orthogonal neighbours of (r,c) are currently free.
    // Used by RCBuilder.pocketCheck to detect potential isolated-node formation.
    freeNeighborCount(r, c) {
        let n = 0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
            const nr = r + dr, nc = c + dc;
            if (this.inBounds(nr, nc) && this.isFree(nr, nc)) n++;
        }
        return n;
    }

    // Returns a flat legacy-compatible graph object so existing RC helpers
    // (rcHeadRayClear etc.) can still operate on this Grid during the transition.
    toLegacyGraph() {
        return {
            nodeOwner: this.nodeOwner,
            hEdge:     this.hEdge,
            vEdge:     this.vEdge,
            rows:      this.rows,
            cols:      this.cols,
        };
    }
}
