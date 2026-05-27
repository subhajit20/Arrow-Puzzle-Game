# VECTO — Colossal Mosaic Edition

> A pure logic puzzle game. Tap an arrow, watch it slide free. Clear the entire board to win.

---

## What is VECTO?

VECTO is a minimalist puzzle game played on a grid of arrows. Every arrow on the board points in one direction — Up, Down, Left, or Right. Your goal is simple: **tap each arrow so it slides off the board without crashing into another one.**

The catch? Arrows can block each other. Tap them in the wrong order and you'll cause a collision — lose three lives and the board resets. Find the right sequence and the whole board unravels in a satisfying chain of sliding lines.

---

## How to Play

### The Objective

Clear every single arrow from the board. An arrow is cleared when it slides all the way off the grid edge. You win the level when the board is completely empty.

### The Rules

1. **Tap or click any arrow** — it starts sliding in the direction it points.
2. **An arrow slides in a straight line** until it exits the board edge. Nothing stops it mid-flight.
3. **If a sliding arrow hits an arrow that is still sitting still**, it crashes — you lose one ❤️.
4. **Two arrows that are both already moving** pass through each other harmlessly.
5. **Lose all 3 lives** and the level resets to its starting state (your level progress is kept, your score is not penalised further).

### Reading the Board

- Each arrow shows a **dashed line preview** extending in front of it. That line shows exactly how far it will travel before exiting — and whether it will hit anything in its path.
- If the dashed line is short or absent, something is blocking the path. That arrow is not safe to tap yet.

---

## Controls & Camera System

VECTO features a fully responsive, hardware-accelerated **cinematic camera system** tailored for mobile viewports:

- **Cinematic Entrance Sequence**: When entering any gameplay mode or continuing progress, the board starts empty and dynamically draws the arrow paths progressively with a staggered timeline. The moment drawing completes, the camera seamlessly sweeps in to a deep, focused **`1.35×` gameplay zoom**.
- **Bounded Panning & Centering**: Camera drag panning is strictly confined to the active board boundaries, preventing you from ever losing the board off-screen. Boards smaller than your screen height or width automatically center themselves perfectly.

### On Mobile (Touch)

| Gesture | Action |
|---|---|
| **Tap** an arrow | Launch it |
| **Drag** with one finger | Pan the camera (safely bounded) |
| **Pinch** with two fingers | Zoom in or out |

### On Desktop (Mouse)

| Action | Result |
|---|---|
| **Click** an arrow | Launch it |
| **Click and drag** | Pan the camera (safely bounded) |
| **Scroll wheel** | Zoom in or out |
| **Hover** over an arrow | Highlights it |

> **Zoom range:** Dynamic fit-view minimum (allowing zooming out for overview navigation) up to 6× gameplay zoom.

---

## The HUD

```
┌─────────────────────────────────────────┐
│  Level 4        Points         ❤️ ❤️ ❤️  │
│  HARD            250                    │
└─────────────────────────────────────────┘
```

- **Level** — which puzzle you are on. Boards grow larger as levels increase.
- **Difficulty badge** — EASY / NORMAL / HARD / EXPERT / TITAN, dynamically evaluated using a directed blocker-dependency graph (DAG) measuring strategic depth, nested moves, and initial escape options.
- **Points** — your running score across all levels.
- **Hearts** — your remaining lives on this level (starts at 3).

---

## Scoring

| Event | Points |
|---|---|
| Arrow clears the board | **+10** |
| All arrows cleared (level complete) | **+100 bonus** |

Your score is cumulative across all levels and saved automatically between sessions.

---

## Bottom Controls

```
[ 🏠 ]  [ 💡 Auto Solver ]
```

- **🏠 Home button** — returns to the mode selection screen. Your regular game progress is saved.
- **💡 Auto Solver** — highlights one arrow that is safe to tap right now. Use it when you're stuck. It will always point to an arrow with a clear escape path.

---

## Game Modes

### ⚡ Level Play

The main campaign. Start at Level 1 and progress through increasingly large and complex boards. Your level and score are saved automatically — you can quit and come back anytime.

Boards are portrait-oriented and utilize a **dynamic grid proportion-balancing generator** that ensures grids visually fill the mobile viewport screen comfortably (targeting aspect ratios of `1.35` to `1.65` for 95% of generated puzzles, and rarely introducing tall `2.8–4.0` vertical challenge columns). Dimensions grow with each level:

| Levels | Height (rows) | Width (cols) |
|---|---|---|
| 1 – 2 | 6 – 12 | 2 – 5 |
| 3 – 5 | 8 – 20 | 3 – 8 |
| 6 – 8 | 12 – 30 | 4 – 12 |
| 9 – 12 | 18 – 38 | 6 – 15 |
| 13 – 18 | 25 – 45 | 9 – 17 |
| 19+ | 35 – 50 | 14 – 20 |

After Level 10, boards are always at least 15 rows tall and 6 columns wide. All generated matrices strictly respect these difficulty scaling preset boundaries while mathematically locking in comfortable portrait proportions.

Additionally, starting from Level 10 and scaling up through higher levels, the procedural difficulty system targets deeply nested strategic blocker dependencies rather than just large dimension sizes. Puzzles are evaluated dynamically to target specific blocker-dependency depth chains, ensuring you face genuinely clever puzzles requiring strategic move ordering and chain-reaction unlocks. An adaptive pacing algorithm tracks your recent boards to prevent burnout by automatically interjecting relief boards when consecutive hard levels are generated.


### ☀️ Daily Puzzle

One unique puzzle per day, the same for every player. Your score in the daily puzzle is tracked separately — it does not affect your regular game score in any way. After completing (or giving up on) today's puzzle, you're returned right back to where you left off in Level Play.

- Your **best score for today** is saved and shown on the splash screen.
- You can **replay today's puzzle** as many times as you like.
- A fresh puzzle arrives every calendar day.

---

## Board Shapes

Boards are not always plain rectangles. As you play you'll encounter 15 different grid shapes that change how arrows are arranged and which paths are available:

| Shape | Description |
|---|---|
| **Square Matrix** | Full rectangle — the classic layout |
| **Cruciform Cross** | A plus-sign shape with cut corners |
| **Rhombus Diamond** | A diamond inscribed in the grid |
| **Hollow Donut** | Rectangle with an empty centre |
| **Beveled Octagon** | Rectangle with four trimmed corners |
| **Circle Shield** | An approximate circular play area |
| **Hourglass Prism** | Wide top and bottom, narrow waist |
| **Serpentine Waves** | A sinusoidal vertical band |
| **Corner Castle** | Rectangle with two opposite corners removed |
| **Hedge Gateway** | Rectangle with gaps cut into the left and right mid-edges |
| **Rectangle Frame** | Only the outer border is playable — a hollow picture frame |
| **L-Block** | A full rectangle with the top-right quarter removed |
| **Twin Panels** | Two separate rectangles divided by a horizontal void strip |
| **Staircase Steps** | Three descending rectangular steps, widest at the top |
| **Vertical Rectangle** | Full rectangle, always taller than wide — the most common board |

Each shape changes the puzzle feel entirely — some create tight corridors, others create isolated clusters of arrows that need to be freed in a specific order.

---

## Board Size Presets

You can manually override the board size at any time using the **Size** button (cycle through presets). This is independent of your level progress.

| Preset | Height (rows) | Width (cols) |
|---|---|---|
| **Auto** | Scales with your level | Scales with your level |
| **Standard** | 6 – 20 | 2 – 10 |
| **Grand** | 15 – 28 | 6 – 13 |
| **Colossal** | 22 – 38 | 9 – 16 |
| **Titan** | 32 – 46 | 13 – 18 |
| **Cosmic** | 40 – 50 | 16 – 20 |

---

## Tips & Strategy

**1. Read the dashed lines before tapping.**
Every arrow shows a dotted preview of its escape path. If the line is long and unobstructed, that arrow is safe. A short line or no line means something is in the way.

**2. Start with arrows on the edges.**
Arrows that point directly toward a board edge with nothing in front of them are always safe to clear first. They free up space for everything behind them.

**3. Think in chains.**
Clearing one arrow often unblocks the next. Look for sequences: "if I clear A, then B becomes safe, then C." The best solutions unravel the board in one smooth chain.

**4. You cannot crash into your own cleared space.**
Once an arrow is gone, its cells are empty. Arrows that previously couldn't escape may now have a clear path.

**5. Two moving arrows never collide.**
If you tap an arrow while another is already sliding, they can cross paths without crashing. This is sometimes the key to clearing two blocked arrows at once.

**6. Use Auto Solver to break deadlocks, not to play for you.**
The hint tells you one safe arrow to tap right now — but the order you tap after that is still up to you. It's best used when you genuinely can't see a move.

**7. Retry is free.**
Crashing three times resets the level, but your level number and total score are preserved. There is no penalty for retrying — experiment freely.

---

## How to Run

Open **`index.html`** in any modern web browser. No installation, no account, no internet connection required after the first load (the page uses fonts and styles from CDN on first visit).

Works on:
- Desktop browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Android Chrome)
- Installed as a PWA / home screen shortcut on mobile

---

## Frequently Asked Questions

**Q: Can I play without an internet connection?**
After the first load, yes — the game logic is fully local. The CDN fonts (visual only) may fall back to system fonts, but the game works completely.

**Q: Is my progress saved?**
Yes. Level Play saves automatically after every cleared arrow. Close the tab, come back later — you'll land exactly where you left off.

**Q: What happens if I change the board size preset mid-game?**
A brand new board is generated immediately at the new size. Your level number stays the same; any unfinished board is discarded.

**Q: The daily puzzle feels harder than my regular level. Is that intended?**
Yes. The daily puzzle is always generated at a fixed "Level 7" difficulty regardless of where you are in Level Play. It is designed to be a moderate challenge for all players.

**Q: Can I get a puzzle that is impossible to solve?**
No. Every board is validated to be fully solvable before it is shown to you. There always exists at least one ordering of taps that clears the board completely.

**Q: What does "Board Jammed!" mean?**
It means you lost all 3 lives on that level from crash collisions. The level resets to its starting state — tap **Retry Level** to try again.
