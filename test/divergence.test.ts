import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIVERGENCE_CONFIG,
  computeDivergence,
  describeDivergence,
  resolveDivergenceConfig,
} from '../src/divergence.js'
import type { JudgmentPair } from '../src/types.js'

// Neutral domain: a content-moderation queue. The engine proposes 'remove' or
// 'keep', a reviewer confirms or overrules it, and an appeals board sometimes
// settles the case later.

function agree(n: number, group?: string): JudgmentPair[] {
  return Array.from(
    { length: n },
    (): JudgmentPair => ({
      engineJudgment: 'keep',
      humanJudgment: 'keep',
      ...(group === undefined ? {} : { group }),
    }),
  )
}

/** Engine said remove, the reviewer overruled to keep. */
function overruled(n: number, outcome?: string, group?: string): JudgmentPair[] {
  return Array.from(
    { length: n },
    (): JudgmentPair => ({
      engineJudgment: 'remove',
      humanJudgment: 'keep',
      ...(outcome === undefined ? {} : { laterOutcome: outcome }),
      ...(group === undefined ? {} : { group }),
    }),
  )
}

describe('computeDivergence — reportable divergence', () => {
  it('counts disagreement against the population where it was possible', () => {
    const { overall } = computeDivergence([
      ...agree(15),
      ...overruled(3, 'remove'),
      ...overruled(2, 'keep'),
    ])

    expect(overall.status).toBe('reportable')
    expect(overall.refusalCodes).toEqual([])
    expect(overall.totalPairs).toBe(20)
    expect(overall.comparablePairs).toBe(20)
    expect(overall.agreements).toBe(15)
    expect(overall.divergentCount).toBe(5)
    expect(overall.divergentRate).toBe(0.25)
    expect(overall.interpretation).toBe('disagreement_is_a_signal_not_a_verdict')
  })

  it('excludes pairs where one judge never spoke from the denominator', () => {
    const oneSided: JudgmentPair[] = Array.from({ length: 10 }, () => ({
      engineJudgment: 'remove',
      humanJudgment: '',
    }))
    const { overall } = computeDivergence([...agree(15), ...oneSided, ...overruled(5, 'remove')])

    // A row nobody reviewed is not an agreement, it is an occasion where
    // disagreement was impossible. Counting it would halve the rate.
    expect(overall.totalPairs).toBe(30)
    expect(overall.comparablePairs).toBe(20)
    expect(overall.divergentRate).toBe(0.25)
  })

  it('caps examples and carries the divergent pairs through', () => {
    const { overall } = computeDivergence(
      [...agree(15), ...overruled(5, 'remove')],
      { exampleLimit: 2 },
    )

    expect(overall.examples).toHaveLength(2)
    expect(overall.examples[0]?.engineJudgment).toBe('remove')
    expect(describeDivergence(overall)).toContain('disagreed on 5 of 20 comparable pairs')
  })
})

describe('computeDivergence — floors', () => {
  it('refuses below the divergent-count floor without tripping the rate floor', () => {
    const { overall } = computeDivergence([...agree(13), ...overruled(2, 'remove')])

    expect(overall.status).toBe('refused')
    expect(overall.refusalCodes).toEqual(['divergent_count_below_minimum'])
    // The rate cleared its own floor. Only the count did not.
    expect(overall.divergentRate).toBe(0.133)
    expect(overall.divergentRate).toBeGreaterThan(DEFAULT_DIVERGENCE_CONFIG.minDivergentRate)
  })

  it('refuses below the divergent-rate floor without tripping the count floor', () => {
    const { overall } = computeDivergence([...agree(97), ...overruled(3, 'remove')])

    expect(overall.status).toBe('refused')
    expect(overall.refusalCodes).toEqual(['divergent_rate_below_minimum'])
    expect(overall.divergentCount).toBe(3)
    expect(overall.divergentCount).toBeGreaterThanOrEqual(
      DEFAULT_DIVERGENCE_CONFIG.minDivergentCount,
    )
    expect(overall.divergentRate).toBe(0.03)
  })

  it('refuses below the comparable-pairs floor even at a 100 percent rate', () => {
    const { overall } = computeDivergence(overruled(5, 'remove'))

    expect(overall.status).toBe('refused')
    expect(overall.refusalCodes).toEqual(['comparable_pairs_below_minimum'])
    expect(overall.divergentRate).toBe(1)
  })

  it('refuses everything on an empty population, with a null rate not a zero', () => {
    const { overall } = computeDivergence([])

    expect(overall.status).toBe('refused')
    expect(overall.divergentRate).toBeNull()
    expect(overall.refusalCodes).toEqual([
      'comparable_pairs_below_minimum',
      'divergent_count_below_minimum',
      'divergent_rate_below_minimum',
    ])
    expect(describeDivergence(overall)).toContain('refused')
  })

  it('checks the rate floor against the exact ratio, not the rounded display rate', () => {
    // 5 of 101 is 0.0495..., which displays as 0.05 after rounding. It is still
    // below a 0.05 floor and must be refused.
    const { overall } = computeDivergence([...agree(96), ...overruled(5, 'remove')])

    expect(overall.divergentRate).toBe(0.05)
    expect(overall.status).toBe('refused')
    expect(overall.refusalCodes).toEqual(['divergent_rate_below_minimum'])
  })

  it('reports a rate exactly at the floor', () => {
    // 5 of 100 is exactly 0.05 and 7 of 100 is exactly 0.07: at the floor passes.
    expect(computeDivergence([...agree(95), ...overruled(5, 'remove')]).overall.status).toBe(
      'reportable',
    )
    expect(
      computeDivergence([...agree(93), ...overruled(7, 'remove')], { minDivergentRate: 0.07 })
        .overall.status,
    ).toBe('reportable')
  })

  it('rejects a nonsensical rate floor', () => {
    expect(() => resolveDivergenceConfig({ minDivergentRate: 1.5 })).toThrow(RangeError)
    expect(() => resolveDivergenceConfig({ minComparablePairs: 0 })).toThrow(RangeError)
  })
})

describe('computeDivergence — who was right, reported separately', () => {
  it('reports engine-right and human-right as two numbers, never merged', () => {
    const { overall } = computeDivergence([
      ...agree(15),
      ...overruled(3, 'remove'), // the appeals board sided with the engine
      ...overruled(2, 'keep'), // the appeals board sided with the reviewer
    ])
    const c = overall.calibration

    expect(c.status).toBe('reportable')
    expect(c.resolvedDivergent).toBe(5)
    expect(c.engineRight).toBe(3)
    expect(c.humanRight).toBe(2)
    expect(c.neitherRight).toBe(0)
    expect(c.engineRightRate).toBe(0.6)
    expect(c.humanRightRate).toBe(0.4)
    expect(c.note).toBe('engine_and_human_accuracy_reported_separately_never_merged')
    // There is no blended accuracy field to read, by construction.
    expect(Object.keys(c)).not.toContain('accuracy')
    expect(describeDivergence(overall)).toContain('the engine was right 3 and the human was right 2')
  })

  it('partitions resolved disagreements exactly, so no single accuracy is constructible', () => {
    const { overall } = computeDivergence([
      ...agree(15),
      ...overruled(3, 'remove'),
      ...overruled(2, 'escalate'), // an outcome neither judge named
    ])
    const c = overall.calibration

    expect(c.engineRight).toBe(3)
    expect(c.humanRight).toBe(0)
    expect(c.neitherRight).toBe(2)
    expect(c.engineRight + c.humanRight + c.neitherRight).toBe(c.resolvedDivergent)
    expect(c.neitherRightRate).toBe(0.4)
  })

  it('refuses the who-was-right reading on its own floor while divergence stays reportable', () => {
    const { overall } = computeDivergence([
      ...agree(15),
      ...overruled(2, 'remove'),
      ...overruled(3), // still open, no outcome yet
    ])

    expect(overall.status).toBe('reportable')
    expect(overall.calibration.status).toBe('refused')
    expect(overall.calibration.refusalCodes).toEqual(['resolved_divergent_below_minimum'])
    // The counts stay visible. Only the reading is withheld.
    expect(overall.calibration.resolvedDivergent).toBe(2)
    expect(overall.calibration.engineRight).toBe(2)
    expect(describeDivergence(overall)).toContain('Who was right is not reported yet')
  })
})

describe('computeDivergence — grouping', () => {
  it('reports nothing per group when no group key is supplied', () => {
    const result = computeDivergence([...agree(15), ...overruled(5, 'remove')])
    expect(result.groups).toEqual([])
    expect(result.overall.group).toBeNull()
  })

  it('applies every floor independently inside each group', () => {
    const result = computeDivergence([
      ...agree(15, 'images'),
      ...overruled(5, 'remove', 'images'),
      ...agree(9, 'text'),
      ...overruled(1, 'remove', 'text'),
    ])

    expect(result.groups.map((g) => g.group)).toEqual(['images', 'text'])

    const images = result.groups[0]
    expect(images?.status).toBe('reportable')
    expect(images?.comparablePairs).toBe(20)
    expect(images?.divergentCount).toBe(5)
    expect(images?.calibration.engineRight).toBe(5)

    const text = result.groups[1]
    expect(text?.status).toBe('refused')
    expect(text?.refusalCodes).toEqual(['divergent_count_below_minimum'])

    // The overall population clears the floors even though one group does not.
    expect(result.overall.status).toBe('reportable')
    expect(result.overall.comparablePairs).toBe(30)
  })

  it('accepts an arbitrary caller-supplied grouping function', () => {
    const result = computeDivergence([...agree(15), ...overruled(5, 'remove')], {
      groupBy: (pair) => `engine-said-${pair.engineJudgment}`,
    })

    expect(result.groups.map((g) => g.group)).toEqual(['engine-said-keep', 'engine-said-remove'])
    expect(result.groups[1]?.comparablePairs).toBe(5)
    expect(result.groups[1]?.divergentCount).toBe(5)
  })

  it('leaves a pair out of the breakdown when groupBy returns null', () => {
    const result = computeDivergence([...agree(15, 'images'), ...overruled(5, 'remove')], {
      groupBy: (pair) => pair.group ?? null,
    })

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.totalPairs).toBe(15)
    expect(result.overall.totalPairs).toBe(20)
  })
})
