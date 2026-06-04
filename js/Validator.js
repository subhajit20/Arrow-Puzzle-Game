// =============================================================================
// Validator.js — Inline board construction invariant checks
//
// All checks are called during generation, not as a final pass.
// Each method returns { ok: bool, errors: string[] } so callers can log
// or throw immediately at the point of violation.
//
// Dependencies: SolvabilityOracle
// =============================================================================

class Validator {
    constructor(oracle) {
        this.oracle = oracle; // SolvabilityOracle instance
    }

    // ── Rule: Orthogonality ───────────────────────────────────────────────────

    // Every consecutive node pair must differ by exactly 1 in r OR c (not both).
    // Enforced inline during growWalk — this is a confirmation check.
    checkOrthogonality(path) {
        const errors = [];
        const nodes  = path.nodes || (path.nodes = []);

        for (let i = 0; i < nodes.length - 1; i++) {
            const a  = nodes[i], b = nodes[i + 1];
            const dr = Math.abs(b.r - a.r);
            const dc = Math.abs(b.c - a.c);
            if (dr + dc !== 1) {
                errors.push(
                    `Path ${path.id}: non-orthogonal step at index ${i} — ` +
                    `(${a.r},${a.c})→(${b.r},${b.c}) (dr=${dr}, dc=${dc})`
                );
            }
        }

        if (errors.length) errors.forEach(e => console.error('[Validator]', e));
        return { ok: errors.length === 0, errors };
    }

    // ── Rule: Single owner ────────────────────────────────────────────────────

    // Every node in the path must be recorded in grid.nodeOwner under the same id.
    // Guards against two paths accidentally claiming the same node.
    checkSingleOwner(grid, path) {
        const errors = [];

        for (const { r, c } of path.nodes) {
            const actual = grid.owner(r, c);
            if (actual !== path.id) {
                errors.push(
                    `Path ${path.id}: node (${r},${c}) owned by ${actual} in grid`
                );
            }
        }

        if (errors.length) errors.forEach(e => console.error('[Validator]', e));
        return { ok: errors.length === 0, errors };
    }

    // ── Rule: Minimum length ──────────────────────────────────────────────────

    // minNodes defaults to 2 (Phase D 2-node pieces allowed).
    // Pass minNodes=3 when checking Phase A/B/C paths.
    checkMinLength(path, minNodes = 2) {
        const len    = path.nodes.length;
        const ok     = len >= minNodes;
        const errors = ok ? [] : [
            `Path ${path.id}: has ${len} node(s) — minimum is ${minNodes}`
        ];
        if (!ok) errors.forEach(e => console.error('[Validator]', e));
        return { ok, errors };
    }

    // ── Rule: Coverage threshold ──────────────────────────────────────────────

    // Hard-fails below 90% (genuinely degenerate board).
    // Info-logs below 100% (structural dead-ends from Phase D are accepted).
    // Target is ≥96%; boards between 90–99% are valid and playable.
    checkCoverage(paths, grid) {
        const R = grid.rows + 1, C = grid.cols + 1;
        const total   = R * C;
        let empty = 0;
        let firstEmpty = null;

        for (let r = 0; r < R; r++) {
            for (let c = 0; c < C; c++) {
                if (grid.isFree(r, c)) {
                    empty++;
                    if (!firstEmpty) firstEmpty = { r, c };
                }
            }
        }

        const covered  = total - empty;
        const coverage = Math.round(covered / total * 100);
        const hardFail = coverage < 90;

        if (empty > 0) {
            const fn = hardFail ? console.error : console.info;
            fn(
                `[Validator] Coverage: ${covered}/${total} (${coverage}%) — ` +
                `${empty} empty nodes remain`
            );
        }

        // Return first empty node for the Generator's retry log, even on soft-fail.
        const errors = hardFail && firstEmpty
            ? [`Uncovered node at (${firstEmpty.r},${firstEmpty.c})`]
            : [];

        return { ok: !hardFail, errors, coverage, empty, firstEmpty };
    }

    // ── Rule: Solvability ─────────────────────────────────────────────────────

    // Final lightweight confirmation that the complete board is solvable.
    // Should always pass on a correctly constructed RC board.
    confirmSolvable(paths, grid) {
        const ok     = this.oracle.isBoardSolvable(paths, grid);
        const errors = ok ? [] : ['Board failed solvability oracle — RC invariant violated'];
        if (!ok) errors.forEach(e => console.error('[Validator]', e));
        return { ok, errors };
    }

    // ── Full inline check (called after each phase) ───────────────────────────

    // Runs orthogonality + single-owner on a single newly placed path.
    // Fast — only checks the new path, not the entire board.
    checkPath(grid, path) {
        const r1 = this.checkOrthogonality(path);
        const r2 = this.checkSingleOwner(grid, path);
        return {
            ok:     r1.ok && r2.ok,
            errors: [...r1.errors, ...r2.errors],
        };
    }

    // ── Full board check (called after fillD) ─────────────────────────────────

    // Runs coverage + solvability — the only two checks needed at the end.
    checkBoard(paths, grid) {
        const r1 = this.checkCoverage(paths, grid);
        const r2 = this.confirmSolvable(paths, grid);
        return {
            ok:       r1.ok && r2.ok,
            coverage: r1.coverage,
            errors:   [...r1.errors, ...r2.errors],
        };
    }
}
