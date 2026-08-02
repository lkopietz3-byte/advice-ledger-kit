// divergence.ts — measure where two independent judges of the same object
// disagree, and where a later outcome exists, who turned out right.
//
// The premise: two judges of the same thing are most informative when they
// DISAGREE. Agreement is cheap and mostly uninformative; disagreement is the
// only place either judge can be shown to be wrong. Most systems that have two
// judges available never compute the disagreement at all — they store the
// engine's rating, store the human's override, and never put the two side by
// side.
//
// Two disciplines make the number safe to act on:
//
//   1. Disagreement needs BOTH a count floor and a rate floor before it means
//      anything. Three disagreements out of three occasions is a 100% rate and
//      still noise. Three out of a thousand is a real rate and still noise.
//      Either floor alone lets one of those through.
//
//   2. When a later outcome settles a disagreement, "the engine was right" and
//      "the human was right" are reported as two separate numbers and are
//      never combined. A single blended accuracy answers a question nobody
//      asked and hides the one that matters: when a person bothers to overrule
//      this system, which of them is usually correct?

import type {
  CalibrationReading,
  DivergenceConfig,
  DivergenceRefusalCode,
  DivergenceReport,
  DivergenceResult,
  JudgmentPair,
  ResolvedDivergenceConfig,
} from './types.js'

/** The defaults every unspecified `DivergenceConfig` floor falls back to. */
export const DEFAULT_DIVERGENCE_CONFIG: ResolvedDivergenceConfig = Object.freeze({
  minComparablePairs: 10,
  minDivergentCount: 3,
  minDivergentRate: 0.05,
  minResolvedDivergent: 3,
  exampleLimit: 10,
})

function requireCount(name: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `advice-ledger-kit: ${name} must be an integer >= ${minimum}, received ${String(value)}`,
    )
  }
  return value
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? Number((part / whole).toFixed(3)) : null
}

const spoke = (judgment: string | undefined): judgment is string =>
  typeof judgment === 'string' && judgment.length > 0

/** Fill in defaults and reject nonsensical floors. */
export function resolveDivergenceConfig(config: DivergenceConfig = {}): ResolvedDivergenceConfig {
  const d = DEFAULT_DIVERGENCE_CONFIG
  const minDivergentRate = config.minDivergentRate ?? d.minDivergentRate
  if (!Number.isFinite(minDivergentRate) || minDivergentRate < 0 || minDivergentRate > 1) {
    throw new RangeError(
      `advice-ledger-kit: minDivergentRate must be a number between 0 and 1, received ${String(minDivergentRate)}`,
    )
  }
  return {
    minComparablePairs: requireCount(
      'minComparablePairs',
      config.minComparablePairs ?? d.minComparablePairs,
      1,
    ),
    minDivergentCount: requireCount(
      'minDivergentCount',
      config.minDivergentCount ?? d.minDivergentCount,
      1,
    ),
    minDivergentRate,
    minResolvedDivergent: requireCount(
      'minResolvedDivergent',
      config.minResolvedDivergent ?? d.minResolvedDivergent,
      1,
    ),
    exampleLimit: requireCount('exampleLimit', config.exampleLimit ?? d.exampleLimit, 0),
  }
}

function calibrationFor(
  divergent: readonly JudgmentPair[],
  thresholds: ResolvedDivergenceConfig,
): CalibrationReading {
  const resolved = divergent.filter((p) => spoke(p.laterOutcome))
  // On a divergent pair the two judgments differ by definition, so at most one
  // of these can match. engineRight, humanRight and neitherRight therefore
  // partition `resolved` exactly, which is why no blended accuracy number is
  // even constructible from this shape.
  const engineRight = resolved.filter((p) => p.laterOutcome === p.engineJudgment).length
  const humanRight = resolved.filter((p) => p.laterOutcome === p.humanJudgment).length
  const neitherRight = resolved.length - engineRight - humanRight

  const refusalCodes: DivergenceRefusalCode[] = []
  if (resolved.length < thresholds.minResolvedDivergent) {
    refusalCodes.push('resolved_divergent_below_minimum')
  }

  return {
    resolvedDivergent: resolved.length,
    engineRight,
    humanRight,
    neitherRight,
    engineRightRate: rate(engineRight, resolved.length),
    humanRightRate: rate(humanRight, resolved.length),
    neitherRightRate: rate(neitherRight, resolved.length),
    status: refusalCodes.length > 0 ? 'refused' : 'reportable',
    refusalCodes,
    note: 'engine_and_human_accuracy_reported_separately_never_merged',
  }
}

function reportFor(
  group: string | null,
  pairs: readonly JudgmentPair[],
  thresholds: ResolvedDivergenceConfig,
): DivergenceReport {
  // The denominator is only the pairs where BOTH judges spoke, because that is
  // the population where disagreement was even possible. Counting pairs with a
  // missing judgment as agreements would understate divergence badly, and most
  // real datasets have far more one-sided rows than two-sided ones.
  const comparable = pairs.filter((p) => spoke(p.engineJudgment) && spoke(p.humanJudgment))
  const divergent = comparable.filter((p) => p.engineJudgment !== p.humanJudgment)
  const divergentRate = rate(divergent.length, comparable.length)

  const refusalCodes: DivergenceRefusalCode[] = []
  if (comparable.length < thresholds.minComparablePairs) {
    refusalCodes.push('comparable_pairs_below_minimum')
  }
  if (divergent.length < thresholds.minDivergentCount) {
    refusalCodes.push('divergent_count_below_minimum')
  }
  if (divergentRate === null || divergentRate < thresholds.minDivergentRate) {
    refusalCodes.push('divergent_rate_below_minimum')
  }

  return {
    group,
    totalPairs: pairs.length,
    comparablePairs: comparable.length,
    agreements: comparable.length - divergent.length,
    divergentCount: divergent.length,
    divergentRate,
    status: refusalCodes.length > 0 ? 'refused' : 'reportable',
    refusalCodes,
    calibration: calibrationFor(divergent, thresholds),
    examples: divergent.slice(0, thresholds.exampleLimit),
    interpretation: 'disagreement_is_a_signal_not_a_verdict',
  }
}

/**
 * Compute how often a human disagreed with an engine, and where a later
 * outcome settled it, who was right.
 *
 * Counts and rates are always computed and always returned: they are
 * arithmetic, not claims. What the floors gate is the `status` field, which is
 * the only thing that says the number is worth acting on. Below any floor the
 * status is 'refused' and `refusalCodes` names which one, exactly as the
 * counts stay visible on a refused grade.
 *
 * `calibration` carries its own floor and its own status, so a population can
 * legitimately have reportable divergence and refused calibration: plenty of
 * disagreements, not enough of them settled yet.
 *
 * @param pairs - every occasion both judges could have spoken on.
 * @param config - floors and the optional `groupBy`. See `resolveDivergenceConfig`.
 */
export function computeDivergence(
  pairs: readonly JudgmentPair[],
  config: DivergenceConfig = {},
): DivergenceResult {
  const thresholds = resolveDivergenceConfig(config)
  const groupBy = config.groupBy ?? ((pair: JudgmentPair): string | null => pair.group ?? null)

  const buckets = new Map<string, JudgmentPair[]>()
  for (const pair of pairs) {
    const key = groupBy(pair)
    if (key === null) continue
    const bucket = buckets.get(key)
    if (bucket) bucket.push(pair)
    else buckets.set(key, [pair])
  }

  const groups = [...buckets.keys()]
    .sort()
    .map((key) => reportFor(key, buckets.get(key) ?? [], thresholds))

  return {
    overall: reportFor(null, pairs, thresholds),
    groups,
    thresholds,
  }
}

/**
 * Render a divergence report as one plain sentence.
 *
 * Never merges the two hit rates, and says "refused" out loud rather than
 * quietly printing a number that did not clear its floor.
 */
export function describeDivergence(report: DivergenceReport): string {
  const where = report.group === null ? 'Overall' : `Group ${report.group}`
  if (report.status === 'refused') {
    return `${where}: refused to report divergence (${report.refusalCodes.join(', ')}); ${report.divergentCount} of ${report.comparablePairs} comparable pairs diverged.`
  }
  const head = `${where}: the human disagreed on ${report.divergentCount} of ${report.comparablePairs} comparable pairs.`
  const c = report.calibration
  if (c.status === 'refused') {
    return `${head} Who was right is not reported yet (${c.refusalCodes.join(', ')}); ${c.resolvedDivergent} disagreements have an outcome.`
  }
  return `${head} Of the ${c.resolvedDivergent} with a later outcome, the engine was right ${c.engineRight} and the human was right ${c.humanRight}.`
}
