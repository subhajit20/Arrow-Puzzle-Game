# Arrow Puzzle — Path Validation Rule Book

## Overview

This rule book defines all validation rules that every generated puzzle must satisfy before being presented to the player. Rules are divided into two categories:

- **Path-Level Rules** — apply to each individual path
- **Grid-Level Rules** — apply across all paths together

A puzzle is only valid when ALL rules pass. If any rule fails, the puzzle must be regenerated.

---

## Path-Level Rules

These rules are checked for every individual path in the puzzle.

---

### Rule 1 — No Segment Self-Loop

A path cannot use the same segment twice.

```
INVALID:
*→-*→-*
      ↓
*←-*←-*  ← loops back reusing already visited segments
```

**Check:** Every segment in a path must appear exactly once in that path's segment list.

---

### Rule 2 — No Tail-Bite (No Closed Loop)

The start dot and end dot of a path cannot be the same dot.

```
INVALID:
*→-*→-*
|       |
*←-*←-*  ← end connects back to start forming a closed loop
```

**Check:** `path.startDot !== path.endDot`

---

### Rule 3 — No Dot Revisit

A path cannot pass through the same dot more than once.

```
INVALID:
*→-*→-*→-*
         ↓
    *←-*←-*  ← revisits a dot already visited earlier in the path
```

**Check:** All dots visited by a path must be unique. No dot appears twice in the path's dot sequence.

---

### Rule 4 — No Dot Skipping

Each step in a path must move to an immediately adjacent dot only. No jumping over intermediate dots.

```
INVALID:
*          *   ← jumped over the dot in between

VALID:
*----*----*    ← passes through every dot on the way
```

**Check:** The Euclidean distance between any two consecutive dots in a path must equal exactly one grid unit (horizontal or vertical step only).

---

### Rule 5 — No Diagonal Movement

Paths can only move horizontally or vertically. Diagonal connections are strictly forbidden.

```
INVALID:         VALID:
*               *---*
 ↘                  |
   *                *

No diagonal connections allowed under any circumstance.
```

**Check:** For any two consecutive dots, either their row must be equal (horizontal move) or their column must be equal (vertical move). Never both different at the same time.

---

### Rule 6 — Consecutive Segment Connectivity

Each segment in a path must share exactly one dot with the next segment. No gaps are allowed within a path.

```
INVALID:
*→-*     *→-*   ← gap between segments, path is broken

VALID:
*→-*→-*→-*      ← each segment connects to the next via a shared dot
```

**Check:** The end dot of segment N must equal the start dot of segment N+1 for every consecutive pair in the path.

---

### Rule 7 — Arrow Direction Must Match Movement Direction

The arrow assigned to a segment must exactly match the actual direction of travel along that segment.

```
Path travels from left dot to right dot → arrow must be →
Path travels from top dot to bottom dot → arrow must be ↓
Path travels from right dot to left dot → arrow must be ←
Path travels from bottom dot to top dot → arrow must be ↑

INVALID:
*←-*   ← arrow points left but path actually travels right
```

**Check:** Derive direction from `(fromDot → toDot)` coordinates and compare against assigned arrow. They must match exactly.

---

### Rule 8 — Minimum Path Length

Every path must contain at least 2 segments. Single-segment paths are too trivial for gameplay.

```
INVALID:
*→-*      ← only 1 segment, too trivial

VALID:
*→-*→-*   ← at least 2 segments
```

**Check:** `path.segments.length >= 2`

---

### Rule 9 — Valid Exit Point

Every path's end dot must align precisely with its assigned exit point on the board edge. A path cannot claim an exit it cannot physically reach.

```
Board edge:      [EXIT]
                    ↑
Path end dot must land exactly here
```

**Check:** `path.endDot` coordinates must match the assigned `path.exitPoint` coordinates exactly. The exit point must also lie on the board boundary (row 0, last row, col 0, or last col).

---

### Rule 10 — Path Is One Continuous Chain

All segments in a path must form one single unbroken connected chain from start to end. No disconnected or floating segments are allowed within the same path.

```
INVALID:
Path 1: *→-*     *→-*   ← two disconnected pieces assigned to same path

VALID:
Path 1: *→-*→-*→-*      ← one unbroken chain
```

**Check:** Starting from the first segment, each segment must connect to the next. The chain must account for all segments in the path with no breaks.

---

## Grid-Level Rules

These rules are checked across all paths together as a complete puzzle.

---

### Rule 11 — No Segment Overlap

Two different paths cannot share the same segment. Every segment belongs to exactly one path.

```
INVALID:
Path 1: *→-*→-*
Path 2:    *→-*→-*   ← Path 2 reuses a segment from Path 1

VALID:
Path 1: *→-*→-*
Path 2:         *→-*→-*   ← each path uses its own segments
```

**Check:** Build a set of all segments across all paths. No segment should appear more than once across all paths combined.

---

### Rule 12 — 100% Grid Coverage

Every single grid segment must belong to exactly one path. No segment can be left unassigned.

```
Total horizontal segments = cols × (rows + 1)
Total vertical segments   = rows × (cols + 1)
Total segments            = both combined

All must be assigned to a path. Zero unused segments allowed.
```

**Check:** Count of all segments across all paths must equal total grid segments exactly.

---

### Rule 13 — Unique Exit Points

No two paths can share the same exit point on the board edge. Every path must have its own distinct exit.

```
INVALID:
Path 1 exit → position (0, 3) on top edge
Path 2 exit → position (0, 3) on top edge   ← same exit, invalid

VALID:
Path 1 exit → position (0, 3) on top edge
Path 2 exit → position (0, 7) on top edge   ← different exits
```

**Check:** All `path.exitPoint` values across all paths must be unique. No two paths share the same exit coordinates.

---

### Rule 14 — No Permanent Deadlock (Solvability Guarantee)

At every possible game state, at least one path must be freeable (able to slide to its exit without colliding with other paths). The puzzle must never reach a state where no path can move.

```
INVALID puzzle order:
State: Path A blocks Path B, Path B blocks Path A
→ Neither can be freed → deadlock → unsolvable

VALID puzzle:
There always exists at least one path with a clear slide to its exit
```

**Check:** Run a solver simulation. Starting from the initial puzzle state, verify that a valid sequence of moves exists that frees all paths. If no such sequence exists, the puzzle is invalid and must be regenerated.

---

## Validation Checklist Summary

| # | Rule | Level | What It Prevents |
|---|------|-------|-----------------|
| 1 | No segment self-loop | Path | Path reusing its own segments |
| 2 | No tail-bite | Path | Closed loops |
| 3 | No dot revisit | Path | Self-intersecting paths |
| 4 | No dot skipping | Path | Jumping over intermediate dots |
| 5 | No diagonal movement | Path | Invalid non-grid-aligned connections |
| 6 | Consecutive connectivity | Path | Gaps within a path |
| 7 | Arrow matches movement | Path | Incorrect arrow directions |
| 8 | Minimum path length | Path | Trivially short paths |
| 9 | Valid exit point | Path | Unreachable or off-board exits |
| 10 | Continuous chain | Path | Fragmented/broken paths |
| 11 | No segment overlap | Grid | Two paths sharing a segment |
| 12 | 100% coverage | Grid | Unused/orphan segments |
| 13 | Unique exit points | Grid | Two paths competing for same exit |
| 14 | No permanent deadlock | Grid | Unsolvable puzzles |

---

## Validation Order

Run rules in this order for efficiency. Stop at first failure and regenerate.

```
1. Run Rules 4, 5       → cheapest geometric checks first
2. Run Rules 1, 2, 3    → path self-consistency checks
3. Run Rules 6, 7, 8    → path structure checks
4. Run Rules 9, 10      → path exit and chain checks
5. Run Rules 11, 12, 13 → grid-wide consistency checks
6. Run Rule 14          → solvability check (most expensive, run last)
```

---

## Notes

- Rules 1–10 are checked per path during generation and can be enforced as constraints while growing each path, preventing violations before they occur rather than detecting them after.
- Rules 11–13 are checked once all paths are generated.
- Rule 14 (deadlock check) is the most computationally expensive and should always run last.
- If Rule 14 fails frequently, adjust the generation algorithm to prefer exit-aligned growth directions rather than purely random walks.
