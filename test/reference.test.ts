// A second, deliberately naive implementation of both engines, written from
// the documented rules rather than from the source, and compared against the
// real exports on thousands of seeded random inputs.
//
// The reference uses plain loops, and exact integer arithmetic (BigInt) for
// rounding and for the rate floor, so a floating-point shortcut in the real
// code shows up as a mismatch.

import { describe, expect, it } from 'vitest'
import { computeDivergence } from '../src/divergence.js'
import { gradeDecision } from '../src/grade.js'
import type {
  Decision,
  DecisionVerdict,
  GradeRefusalCode,
  JudgmentPair,
  Observation,
  Recommendation,
} from '../src/types.js'

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) so every run sees the same inputs.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRandom(seed: number) {
  const next = mulberry32(seed)
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1))
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i)
      const tmp = out[i] as T
      out[i] = out[j] as T
      out[j] = tmp
    }
    return out
  }
  return { next, int, pick, shuffle }
}

/** Exact half-up rounding of part/whole to 3 places, as an integer count of thousandths. */
function thousandths(part: number, whole: number): bigint {
  const p = BigInt(part)
  const w = BigInt(whole)
  return (2000n * p + w) / (2n * w)
}

function refRate(part: number, whole: number): number | null {
  return whole === 0 ? null : Number(thousandths(part, whole)) / 1000
}

// ---------------------------------------------------------------------------
// Reference gradeDecision
// ---------------------------------------------------------------------------

interface RefGradeConfig {
  minBaselineObservations: number
  minResultObservations: number
  minExposedResultObservations: number
  minBaselineBadObservations: number
  proposeThreshold: number
  refuteThreshold: number
  requireObservedBasis: boolean
}

function refGrade(
  decision: Decision,
  recommendation: Recommendation,
  observations: Observation[],
  c: RefGradeConfig,
) {
  const structural: GradeRefusalCode[] = []
  if (decision.recommendationId !== recommendation.id) structural.push('decision_recommendation_mismatch')
  if (recommendation.checkKey.trim() === '') structural.push('no_gradeable_check_key')
  if (c.requireObservedBasis && recommendation.basis === 'model-proposed') structural.push('basis_not_gradeable')
  if (structural.length > 0) {
    const empty = { observations: 0, bad: 0, good: 0, badRate: null }
    return {
      verdict: 'refused' as DecisionVerdict,
      refusalCodes: structural,
      baseline: empty,
      result: empty,
      secondary: { ...empty, wouldBeVerdict: 'refused' as DecisionVerdict },
      badRateDelta: null,
      atBoundaryObservations: 0,
    }
  }

  let bN = 0, bBad = 0, aN = 0, aBad = 0, eN = 0, eBad = 0, atBoundary = 0
  for (const o of observations) {
    if (o.subjectId !== recommendation.subjectId || o.checkKey !== recommendation.checkKey) continue
    const bad = o.state === 'bad' ? 1 : 0
    if (o.observedAt < decision.decidedAt) {
      bN++
      bBad += bad
    } else if (o.observedAt > decision.decidedAt) {
      aN++
      aBad += bad
      if (o.exposed === true) {
        eN++
        eBad += bad
      }
    } else {
      atBoundary++
    }
  }

  const codes: GradeRefusalCode[] = []
  if (bN < c.minBaselineObservations) codes.push('baseline_below_minimum')
  if (bBad < c.minBaselineBadObservations) codes.push('baseline_lacks_negative_signal')
  if (aN < c.minResultObservations) codes.push('result_below_minimum')
  if (eN < c.minExposedResultObservations) codes.push('exposed_result_below_minimum')

  const blindRefused =
    bN < c.minBaselineObservations ||
    bBad < c.minBaselineBadObservations ||
    aN < c.minResultObservations ||
    aN < c.minExposedResultObservations

  return {
    verdict: (codes.length > 0 ? 'refused' : eBad >= c.refuteThreshold ? 'not-holding' : 'holding'),
    refusalCodes: codes,
    baseline: { observations: bN, bad: bBad, good: bN - bBad, badRate: refRate(bBad, bN) },
    result: { observations: eN, bad: eBad, good: eN - eBad, badRate: refRate(eBad, eN) },
    secondary: {
      observations: aN,
      bad: aBad,
      good: aN - aBad,
      badRate: refRate(aBad, aN),
      wouldBeVerdict: (blindRefused ? 'refused' : aBad >= c.refuteThreshold ? 'not-holding' : 'holding'),
    },
    badRateDelta:
      bN === 0 || eN === 0 ? null : Number(thousandths(eBad, eN) - thousandths(bBad, bN)) / 1000,
    atBoundaryObservations: atBoundary,
  }
}

// ---------------------------------------------------------------------------
// Reference computeDivergence (default groupBy)
// ---------------------------------------------------------------------------

interface RefDivConfig {
  minComparablePairs: number
  minDivergentCount: number
  /** The rate floor as an exact fraction k / 1000. */
  rateThousandths: number
  minResolvedDivergent: number
  exampleLimit: number
}

const said = (x: unknown): boolean => typeof x === 'string' && x !== ''

function refReport(group: string | null, pairs: JudgmentPair[], c: RefDivConfig) {
  let comparable = 0
  const divergent: JudgmentPair[] = []
  for (const p of pairs) {
    if (!said(p.engineJudgment) || !said(p.humanJudgment)) continue
    comparable++
    if (p.engineJudgment !== p.humanJudgment) divergent.push(p)
  }
  const codes: string[] = []
  if (comparable < c.minComparablePairs) codes.push('comparable_pairs_below_minimum')
  if (divergent.length < c.minDivergentCount) codes.push('divergent_count_below_minimum')
  // Exact: divergent / comparable < k / 1000  <=>  1000 * divergent < k * comparable
  if (comparable === 0 || 1000 * divergent.length < c.rateThousandths * comparable) {
    codes.push('divergent_rate_below_minimum')
  }

  let resolved = 0, engineRight = 0, humanRight = 0
  for (const p of divergent) {
    if (!said(p.laterOutcome)) continue
    resolved++
    if (p.laterOutcome === p.engineJudgment) engineRight++
    if (p.laterOutcome === p.humanJudgment) humanRight++
  }
  const neither = resolved - engineRight - humanRight
  const calCodes = resolved < c.minResolvedDivergent ? ['resolved_divergent_below_minimum'] : []

  return {
    group,
    totalPairs: pairs.length,
    comparablePairs: comparable,
    agreements: comparable - divergent.length,
    divergentCount: divergent.length,
    divergentRate: refRate(divergent.length, comparable),
    status: codes.length > 0 ? 'refused' : 'reportable',
    refusalCodes: codes,
    calibration: {
      resolvedDivergent: resolved,
      engineRight,
      humanRight,
      neitherRight: neither,
      engineRightRate: refRate(engineRight, resolved),
      humanRightRate: refRate(humanRight, resolved),
      neitherRightRate: refRate(neither, resolved),
      status: calCodes.length > 0 ? 'refused' : 'reportable',
      refusalCodes: calCodes,
      note: 'engine_and_human_accuracy_reported_separately_never_merged',
    },
    examples: divergent.slice(0, c.exampleLimit),
    interpretation: 'disagreement_is_a_signal_not_a_verdict',
  }
}

function refDivergence(pairs: JudgmentPair[], c: RefDivConfig) {
  const keys: string[] = []
  const buckets: Record<string, JudgmentPair[]> = Object.create(null) as Record<string, JudgmentPair[]>
  for (const p of pairs) {
    if (p.group === undefined) continue
    if (!(p.group in buckets)) {
      buckets[p.group] = []
      keys.push(p.group)
    }
    buckets[p.group]?.push(p)
  }
  keys.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
  return {
    overall: refReport(null, pairs, c),
    groups: keys.map((k) => refReport(k, buckets[k] ?? [], c)),
  }
}

// ---------------------------------------------------------------------------
// Random input generators
// ---------------------------------------------------------------------------

const DATES = ['2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04']

function randomLedger(r: ReturnType<typeof makeRandom>) {
  const recommendation: Recommendation = {
    id: 'rec',
    subjectId: 's1',
    checkKey: r.next() < 0.05 ? '  ' : 'c1',
    proposedAt: '2026-01-01',
    ...(r.next() < 0.5 ? {} : { basis: r.pick(['observed', 'model-proposed'] as const) }),
  }
  const decision: Decision = {
    recommendationId: r.next() < 0.05 ? 'other' : 'rec',
    status: r.pick(['adopted', 'dismissed'] as const),
    decidedAt: r.pick(DATES.slice(1, -1)),
  }
  const observations: Observation[] = Array.from({ length: r.int(0, 30) }, () => {
    const exposed = r.pick([true, false, undefined])
    return {
      subjectId: r.next() < 0.8 ? 's1' : 's2',
      checkKey: r.next() < 0.8 ? 'c1' : 'c2',
      state: r.pick(['good', 'bad'] as const),
      observedAt: r.pick(DATES),
      ...(exposed === undefined ? {} : { exposed }),
    }
  })
  const proposeThreshold = r.int(1, 3)
  const config: RefGradeConfig = {
    minBaselineObservations: r.int(1, 5),
    minResultObservations: r.int(1, 5),
    minExposedResultObservations: r.int(1, 5),
    minBaselineBadObservations: r.int(0, 3),
    proposeThreshold,
    refuteThreshold: proposeThreshold + r.int(0, 2),
    requireObservedBasis: r.next() < 0.3,
  }
  return { recommendation, decision, observations, config }
}

function randomPairs(r: ReturnType<typeof makeRandom>): JudgmentPair[] {
  const judgments = ['keep', 'remove', 'escalate', '', undefined]
  return Array.from({ length: r.int(0, 120) }, (): JudgmentPair => {
    // Mostly agreement, like a real queue, with a tunable disagreement mix.
    const engine = r.pick(judgments)
    const human = r.next() < 0.7 ? engine : r.pick(judgments)
    const outcome = r.pick([...judgments, undefined, undefined])
    const group = r.pick(['images', 'text', 'video', undefined])
    return {
      engineJudgment: engine as string,
      humanJudgment: human as string,
      ...(outcome === undefined ? {} : { laterOutcome: outcome }),
      ...(group === undefined ? {} : { group }),
      id: `p${r.int(0, 40)}`, // duplicates on purpose
    }
  })
}

function randomDivConfig(r: ReturnType<typeof makeRandom>): RefDivConfig {
  return {
    minComparablePairs: r.int(1, 30),
    minDivergentCount: r.int(1, 6),
    rateThousandths: r.int(0, 400),
    minResolvedDivergent: r.int(1, 6),
    exampleLimit: r.int(0, 6),
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

describe('gradeDecision against a naive reference implementation', () => {
  it('agrees on 5,000 seeded random ledgers', () => {
    const r = makeRandom(20260924)
    let verdicts = 0
    for (let i = 0; i < 5000; i++) {
      const { recommendation, decision, observations, config } = randomLedger(r)
      const real = gradeDecision(decision, recommendation, observations, config)
      const ref = refGrade(decision, recommendation, observations, config)
      expect(real).toMatchObject(ref)
      expect(real.secondary.wouldBeVerdict).toBe(ref.secondary.wouldBeVerdict)
      if (real.verdict !== 'refused') verdicts++
    }
    // The generator must reach verdicts, not only refusals, or the check is hollow.
    expect(verdicts).toBeGreaterThan(300)
  })

  it('gives the same grade for any order of observations, and never modifies its inputs', () => {
    const r = makeRandom(7)
    for (let i = 0; i < 1000; i++) {
      const { recommendation, decision, observations, config } = randomLedger(r)
      const before = JSON.stringify({ recommendation, decision, observations, config })
      const frozen = deepFreeze({ recommendation, decision, observations: [...observations], config })
      const graded = gradeDecision(frozen.decision, frozen.recommendation, frozen.observations, frozen.config)
      const shuffled = gradeDecision(decision, recommendation, r.shuffle(observations), config)
      expect(shuffled).toEqual(graded)
      expect(JSON.stringify({ recommendation, decision, observations, config })).toBe(before)
    }
  })

  it('counts duplicate observation rows as separate readings', () => {
    const rec: Recommendation = { id: 'r', subjectId: 's', checkKey: 'c', proposedAt: '2026-01-01' }
    const dec: Decision = { recommendationId: 'r', status: 'adopted', decidedAt: '2026-02-01' }
    const bad: Observation = { subjectId: 's', checkKey: 'c', state: 'bad', observedAt: '2026-01-10' }
    const good: Observation = { subjectId: 's', checkKey: 'c', state: 'good', observedAt: '2026-02-10', exposed: true }
    const grade = gradeDecision(dec, rec, [bad, bad, bad, good, good, good])
    expect(grade.baseline.observations).toBe(3)
    expect(grade.result.observations).toBe(3)
    expect(grade.verdict).toBe('holding')
  })
})

describe('computeDivergence against a naive reference implementation', () => {
  it('agrees on 5,000 seeded random populations, including every group', () => {
    const r = makeRandom(424242)
    let reportable = 0
    let calibrated = 0
    for (let i = 0; i < 5000; i++) {
      const pairs = randomPairs(r)
      const c = randomDivConfig(r)
      const real = computeDivergence(pairs, {
        minComparablePairs: c.minComparablePairs,
        minDivergentCount: c.minDivergentCount,
        minDivergentRate: c.rateThousandths / 1000,
        minResolvedDivergent: c.minResolvedDivergent,
        exampleLimit: c.exampleLimit,
      })
      const ref = refDivergence(pairs, c)
      expect(real.overall).toEqual(ref.overall)
      expect(real.groups).toEqual(ref.groups)
      if (real.overall.status === 'reportable') reportable++
      if (real.overall.calibration.status === 'reportable') calibrated++
    }
    expect(reportable).toBeGreaterThan(300)
    expect(calibrated).toBeGreaterThan(300)
  })

  it('checks the rate floor exactly at, just below and just above k/1000', () => {
    // For every comparable count up to 400 and every floor k/1000, the real
    // floor decision matches exact integer arithmetic.
    for (let comparable = 1; comparable <= 400; comparable += 7) {
      for (let k = 1; k <= 200; k += 3) {
        const floor = k / 1000
        for (let divergent = 0; divergent <= comparable; divergent += Math.max(1, Math.floor(comparable / 25))) {
          const pairs: JudgmentPair[] = [
            ...Array.from({ length: comparable - divergent }, () => ({ engineJudgment: 'a', humanJudgment: 'a' })),
            ...Array.from({ length: divergent }, () => ({ engineJudgment: 'a', humanJudgment: 'b' })),
          ]
          const real = computeDivergence(pairs, {
            minComparablePairs: 1,
            minDivergentCount: 1,
            minDivergentRate: floor,
          }).overall.refusalCodes.includes('divergent_rate_below_minimum')
          expect(real).toBe(1000 * divergent < k * comparable)
        }
      }
    }
  })

  it('gives the same counts for any order of pairs, keeps examples in input order, and never modifies inputs', () => {
    const r = makeRandom(99)
    for (let i = 0; i < 500; i++) {
      const pairs = randomPairs(r)
      const before = JSON.stringify(pairs)
      const a = computeDivergence(deepFreeze([...pairs]), { exampleLimit: 1000 })
      const b = computeDivergence(r.shuffle(pairs), { exampleLimit: 1000 })
      const strip = (x: typeof a.overall) => ({ ...x, examples: x.examples.length })
      expect(strip(b.overall)).toEqual(strip(a.overall))
      expect(b.groups.map(strip)).toEqual(a.groups.map(strip))
      expect(a.overall.examples).toEqual(
        pairs.filter((p) => said(p.engineJudgment) && said(p.humanJudgment) && p.engineJudgment !== p.humanJudgment),
      )
      expect(JSON.stringify(pairs)).toBe(before)
    }
  })

  it('counts pairs that share an id separately', () => {
    const dup: JudgmentPair = { engineJudgment: 'remove', humanJudgment: 'keep', id: 'case-1' }
    const { overall } = computeDivergence([dup, dup, dup], { minComparablePairs: 1 })
    expect(overall.divergentCount).toBe(3)
    expect(overall.examples.map((p) => p.id)).toEqual(['case-1', 'case-1', 'case-1'])
  })
})
