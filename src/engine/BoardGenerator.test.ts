import { describe, expect, it } from 'vitest'
import { BoardGenerator } from './BoardGenerator'
import { DIRS, TIERS } from './constants'
import { GridShape } from './GridShape'
import { mulberry32 } from './utils'

type Arrow = { id: number; body: number[]; dir: keyof typeof DIRS }

// Greedy clear: repeatedly remove any arrow whose head ray to the edge is free of other arrows.
function solvable(arrows: Arrow[], C: number, R: number) {
  const owner = new Int32Array(C * R).fill(-1)
  for (const a of arrows) for (const c of a.body) owner[c] = a.id
  const left = new Map(arrows.map(a => [a.id, a]))
  let progress = true
  while (left.size && progress) {
    progress = false
    for (const a of [...left.values()]) {
      const head = a.body[a.body.length - 1]
      let c = head % C, r = Math.floor(head / C)
      const [dc, dr] = DIRS[a.dir]
      let clear = true
      for (;;) {
        c += dc; r += dr
        if (c < 0 || c >= C || r < 0 || r >= R) break
        const o = owner[r * C + c]
        if (o !== -1 && o !== a.id) { clear = false; break }
      }
      if (clear) {
        for (const cell of a.body) owner[cell] = -1
        left.delete(a.id)
        progress = true
      }
    }
  }
  return left.size === 0
}

function expectWellFormed(arrows: Arrow[], C: number, R: number, mask: Uint8Array | null = null) {
  const seen = new Set<number>()
  for (const a of arrows) {
    expect(a.body.length).toBeGreaterThanOrEqual(2)
    const [hx, hy] = [a.body.at(-1)! % C, Math.floor(a.body.at(-1)! / C)]
    const [px, py] = [a.body.at(-2)! % C, Math.floor(a.body.at(-2)! / C)]
    expect([hx - px, hy - py]).toEqual(DIRS[a.dir])
    for (let i = 0; i < a.body.length; i++) {
      const cell = a.body[i]
      expect(seen.has(cell)).toBe(false)
      seen.add(cell)
      if (mask) expect(mask[cell]).toBe(1)
      if (i > 0) {
        const prev = a.body[i - 1]
        const step = Math.abs((cell % C) - (prev % C)) + Math.abs(Math.floor(cell / C) - Math.floor(prev / C))
        expect(step).toBe(1)
      }
    }
  }
  expect(solvable(arrows, C, R)).toBe(true)
}

describe('mulberry32', () => {
  it('repeats the same sequence for the same seed and stays in [0, 1)', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43)
    const sa = Array.from({ length: 50 }, a)
    expect(Array.from({ length: 50 }, b)).toEqual(sa)
    expect(Array.from({ length: 50 }, c)).not.toEqual(sa)
    for (const x of sa) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1) }
  })
})

describe('BoardGenerator seeding', () => {
  const tier = TIERS.find(t => t.name === 'HARD')!

  it('rebuilds the same board from the same seed', () => {
    const g = new BoardGenerator()
    const a = g.generateForTier(20, 32, null, tier, null, 1234)
    const b = new BoardGenerator().generateForTier(20, 32, null, tier, null, 1234)
    expect(b.arrows).toEqual(a.arrows)
    expect(b.branching).toBe(a.branching)
    expect(a.seed).toBe(1234)
    expect(g.generate(16, 20, null, 0.5, null, 7).arrows).toEqual(g.generate(16, 20, null, 0.5, null, 7).arrows)
  })

  it('builds different boards from different seeds', () => {
    const g = new BoardGenerator()
    expect(g.generateForTier(20, 32, null, tier, null, 1).arrows)
      .not.toEqual(g.generateForTier(20, 32, null, tier, null, 2).arrows)
  })

  it('restores the unseeded random source after a seeded call', () => {
    const g = new BoardGenerator()
    g.generateForTier(12, 16, null, tier, null, 5)
    expect(g.rng).toBe(Math.random)
  })
})

describe('BoardGenerator boards', () => {
  it('produces solvable, non-overlapping boards with no lone dots', () => {
    const g = new BoardGenerator()
    for (const [C, R, seed] of [[10, 12, 1], [20, 32, 2], [30, 50, 3]]) {
      for (const t of TIERS) expectWellFormed(g.generateForTier(C, R, null, t, null, seed).arrows, C, R)
    }
  })

  it('keeps shaped boards inside their mask', () => {
    const g = new BoardGenerator()
    const { COLS, ROWS } = GridShape.sizeFor('circle', 0)
    const mask = GridShape.maskFor('circle', COLS, ROWS)
    const board = g.generateForTier(COLS, ROWS, mask, TIERS[2], GridShape.motifsFor('circle'), 11)
    expectWellFormed(board.arrows, COLS, ROWS, mask)
  })
})

describe('direction variety', () => {
  it('regional penalty keeps areas from all pointing one way', () => {
    const avgRegional = (penalty: number) => {
      const g = new BoardGenerator()
      ;(g as unknown as { regionDirPenalty: number }).regionDirPenalty = penalty
      let sum = 0, n = 0
      for (const t of TIERS) for (let seed = 1; seed <= 3; seed++) {
        sum += g.measureRegionalDirClustering(g.generateForTier(30, 50, null, t, null, seed).arrows, 30, 50)
        n++
      }
      return sum / n
    }
    const without = avgRegional(0), withPenalty = avgRegional(0.8)
    expect(withPenalty).toBeLessThan(without - 0.03)
    expect(withPenalty).toBeLessThan(0.26)
  })
})

describe('tier calibration', () => {
  // Sizes each tier actually appears at in tierForLevel / sizeForLevel.
  const cases: [string, number, number][] = [
    ['EASY', 16, 24], ['NORMAL', 24, 24], ['HARD', 26, 26], ['EXPERT', 28, 28], ['TITAN', 30, 50],
  ]

  it.each(cases)('%s boards land in their branching band', (name, C, R) => {
    const g = new BoardGenerator()
    const tier = TIERS.find(t => t.name === name)!
    let hits = 0
    for (let seed = 1; seed <= 6; seed++) {
      const { branching } = g.generateForTier(C, R, null, tier, null, seed)
      if (branching >= tier.min && branching <= tier.max) hits++
    }
    expect(hits).toBeGreaterThanOrEqual(5)
  })

  it('orders tiers from most to least branching at a fixed size', () => {
    const g = new BoardGenerator()
    const medians = TIERS.map(t => {
      const v = [1, 2, 3, 4, 5].map(s => g.generateForTier(30, 50, null, t, null, s).branching).sort((a, b) => a - b)
      return v[2]
    })
    for (let i = 1; i < medians.length; i++) expect(medians[i]).toBeLessThan(medians[i - 1])
  })
})

describe('measureBranching', () => {
  const g = new BoardGenerator()

  it('scores five independent pieces as 5, 4, 3 free over the first 75% of the solve', () => {
    // 2x5 board: one east-facing arrow per row, nothing in anyone's way.
    const open: Arrow[] = Array.from({ length: 5 }, (_, y) => ({ id: y, body: [y * 2, y * 2 + 1], dir: 'E' }))
    expect(g.measureBranching(open, 2, 5)).toBeCloseTo(4 / Math.sqrt(5))
  })

  it('scores a single blocking chain as one free piece at a time', () => {
    // 10x1 board: five east-facing arrows in a row; each is blocked by the one ahead of it.
    const chain: Arrow[] = Array.from({ length: 5 }, (_, k) => ({ id: k, body: [2 * k, 2 * k + 1], dir: 'E' }))
    expect(g.measureBranching(chain, 10, 1)).toBeCloseTo(1 / Math.sqrt(5))
  })
})
