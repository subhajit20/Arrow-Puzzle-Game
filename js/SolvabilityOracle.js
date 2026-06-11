// =============================================================================
// SolvabilityOracle.js — Board solvability simulation
//
// Uses the RC (Reverse Construction) escape model:
//   A path can escape if its head ray reaches the board edge when walking
//   in the heading direction, treating empty cells, own body nodes, and
//   already-cleared path nodes as transparent.
//
// isBoardSolvable runs a greedy forward simulation:
//   repeatedly find any path that can currently escape → clear it → repeat
//   until no more paths can escape or all are cleared.
//   Returns true only if every path was cleared.
// =============================================================================

class SolvabilityOracle {

    // ── Core escape check ─────────────────────────────────────────────────────

    // Returns true if path's head ray reaches the board edge.
    // Transparent cells: empty (-1), own body (path.id), already removed paths.
    canEscape(path, removed, grid) {
        const { dr, dc } = Path.headingToDelta(path.heading);
        const head       = path.head();
        let r = head.r, c = head.c;

        for (;;) {
            const nr = r + dr, nc = c + dc;
            if (!grid.inBounds(nr, nc)) return true;   // reached board edge
            const o = grid.owner(nr, nc);
            if (o === -1 || o === path.id || removed.has(o)) {
                r = nr; c = nc; continue;              // transparent — keep walking
            }
            return false;                              // blocked by foreign path
        }
    }

    // ── Self-clear check ──────────────────────────────────────────────────────

    // Returns false if the path's head ray hits any node owned by the SAME path
    // before reaching the board edge or a foreign path.
    // A path whose arrowhead points into its own body is visually broken.
    headSelfClear(path, grid) {
        const { dr, dc } = Path.headingToDelta(path.heading);
        const head = path.head();
        let r = head.r + dr, c = head.c + dc;

        // Walk the full ray to the board edge, passing through foreign paths.
        // Foreign paths will eventually be cleared in solve order, so the only
        // thing that must never appear on the ray is the path's own body/tail.
        while (grid.inBounds(r, c)) {
            if (grid.owner(r, c) === path.id) return false;
            r += dr; c += dc;
        }
        return true;
    }

    // ── Board-wide solvability ────────────────────────────────────────────────

    // Greedy forward simulation: repeatedly clear any escapable path until
    // stuck or done. Returns true only if all paths cleared.
    isBoardSolvable(paths, grid) {
        const removed = new Set();
        let prog = true;

        while (prog) {
            prog = false;
            for (const p of paths) {
                if (removed.has(p.id)) continue;
                if (this.canEscape(p, removed, grid)) {
                    removed.add(p.id);
                    prog = true;
                }
            }
        }

        return removed.size === paths.length;
    }

    // ── Branching factor ──────────────────────────────────────────────────────

    // Simulates the solve and measures how many pieces are free at each step.
    //   avg — mean free-piece count per step. 1.0 = unique solve order
    //         (every move forced); higher = more interchangeable moves.
    //   max — peak simultaneous free pieces.
    // Clears one free piece per step so the count reflects what a player
    // actually faces at each decision point.
    measureBranching(paths, grid) {
        const removed = new Set();
        let sumFree = 0, steps = 0, maxFree = 0;

        while (removed.size < paths.length) {
            let first = null, freeCount = 0;
            for (const p of paths) {
                if (removed.has(p.id)) continue;
                if (this.canEscape(p, removed, grid)) {
                    freeCount++;
                    if (!first) first = p;
                }
            }
            if (!first) break; // unsolvable remainder — caller validates separately

            sumFree += freeCount;
            steps++;
            if (freeCount > maxFree) maxFree = freeCount;
            removed.add(first.id);
        }

        return { avg: steps ? sumFree / steps : 0, max: maxFree, steps };
    }

    // ── Decoy count ───────────────────────────────────────────────────────────

    // Counts pieces that LOOK free but aren't: blocked pieces whose first
    // blocker sits ≥ minDist cells down the head ray. These force the player
    // to trace rays instead of eyeballing.
    countDecoys(paths, grid, minDist = 4) {
        let decoys = 0;
        for (const p of paths) {
            const { dr, dc } = Path.headingToDelta(p.heading);
            const head = p.head();
            let r = head.r + dr, c = head.c + dc, dist = 1;
            while (grid.inBounds(r, c)) {
                const o = grid.owner(r, c);
                if (o >= 0 && o !== p.id) {
                    if (dist >= minDist) decoys++;
                    break;
                }
                r += dr; c += dc; dist++;
            }
        }
        return decoys;
    }

    // ── Place order assignment ────────────────────────────────────────────────

    // Derives placeOrder for every path from the greedy clear order.
    // First cleared = highest placeOrder (was placed last in RC construction).
    // Returns false if the board is not fully solvable.
    recomputePlaceOrder(paths, grid) {
        const removed    = new Set();
        const clearOrder = [];
        let prog = true;

        while (prog) {
            prog = false;
            for (const p of paths) {
                if (removed.has(p.id)) continue;
                if (this.canEscape(p, removed, grid)) {
                    removed.add(p.id);
                    clearOrder.push(p);
                    prog = true;
                }
            }
        }

        if (removed.size !== paths.length) return false;

        const N = clearOrder.length;
        clearOrder.forEach((p, i) => { p.placeOrder = N - 1 - i; });
        return true;
    }
}
