// divergence.ts — measure where two independent judges of the same object
// disagree, and where a later outcome exists, who turned out right.
//
// The premise: two judges of the same thing are most informative when they
// DISAGREE. When they agree, a later outcome cannot tell them apart; a
// disagreement is where one of them can be shown to be wrong. It is common to
// store the engine's rating and the human's override and never put the two
// side by side.
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
import {
  denseCopy,
  describe,
  isPlainRecord,
  label,
  rate,
  requireCount,
  requirePlainRecord,
  text,
  typeFail,
} from './internal.js'

/**
 * The defaults every unspecified `DivergenceConfig` floor falls back to: 10
 * comparable pairs, 3 disagreements, a 0.05 disagreement rate, 3 settled
 * disagreements, and 10 examples. Frozen.
 */
export const DEFAULT_DIVERGENCE_CONFIG: Readonly<ResolvedDivergenceConfig> = Object.freeze({
  minComparablePairs: 10,
  minDivergentCount: 3,
  minDivergentRate: 0.05,
  minResolvedDivergent: 3,
  exampleLimit: 10,
})

const spoke = (judgment: unknown): judgment is string =>
  typeof judgment === 'string' && judgment.length > 0

/**
 * Fill in defaults and reject nonsensical floors. `null` and `undefined`
 * fields fall back to the defaults, and an omitted (`undefined`) config means
 * all defaults. `groupBy` is not part of the result. Each field is read once.
 *
 * @throws TypeError when `config` is present but not a plain object (a Map,
 *   array, Date, class instance or `null` is not read as "use the defaults").
 * @throws RangeError when `minDivergentRate` is not a finite number in
 *   [0, 1], `exampleLimit` is not an integer >= 0, or any other count is not
 *   an integer >= 1.
 */
export function resolveDivergenceConfig(config: DivergenceConfig = {}): ResolvedDivergenceConfig {
  const d = DEFAULT_DIVERGENCE_CONFIG
  const given = requirePlainRecord('config', config) as DivergenceConfig
  const minDivergentRate = given.minDivergentRate ?? d.minDivergentRate
  if (!Number.isFinite(minDivergentRate) || minDivergentRate < 0 || minDivergentRate > 1) {
    throw new RangeError(
      `advice-ledger-kit: minDivergentRate must be a number between 0 and 1, received ${describe(minDivergentRate)}`,
    )
  }
  return {
    minComparablePairs: requireCount(
      'minComparablePairs',
      given.minComparablePairs ?? d.minComparablePairs,
      1,
    ),
    minDivergentCount: requireCount(
      'minDivergentCount',
      given.minDivergentCount ?? d.minDivergentCount,
      1,
    ),
    minDivergentRate,
    minResolvedDivergent: requireCount(
      'minResolvedDivergent',
      given.minResolvedDivergent ?? d.minResolvedDivergent,
      1,
    ),
    exampleLimit: requireCount('exampleLimit', given.exampleLimit ?? d.exampleLimit, 0),
  }
}

/** One pair after it has been read once: the fields the counts use, plus the snapshot handed back as an example. */
interface Entry {
  readonly pair: JudgmentPair
  readonly engine: unknown
  readonly human: unknown
  readonly outcome: unknown
}

function calibrationFor(
  divergent: readonly Entry[],
  thresholds: ResolvedDivergenceConfig,
): CalibrationReading {
  const resolved = divergent.filter((e) => spoke(e.outcome))
  // On a divergent pair the two judgments differ by definition, so at most one
  // of these can match. engineRight, humanRight and neitherRight therefore
  // partition `resolved` exactly, which is why no blended accuracy number is
  // even constructible from this shape.
  const engineRight = resolved.filter((e) => e.outcome === e.engine).length
  const humanRight = resolved.filter((e) => e.outcome === e.human).length
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
  entries: readonly Entry[],
  thresholds: ResolvedDivergenceConfig,
): DivergenceReport {
  // The denominator is only the pairs where BOTH judges spoke, because that is
  // the population where disagreement was even possible. Counting pairs with a
  // missing judgment as agreements would understate divergence badly, and most
  // real datasets have far more one-sided rows than two-sided ones.
  const comparable = entries.filter((e) => spoke(e.engine) && spoke(e.human))
  const divergent = comparable.filter((e) => e.engine !== e.human)
  const divergentRate = rate(divergent.length, comparable.length)

  const refusalCodes: DivergenceRefusalCode[] = []
  if (comparable.length < thresholds.minComparablePairs) {
    refusalCodes.push('comparable_pairs_below_minimum')
  }
  if (divergent.length < thresholds.minDivergentCount) {
    refusalCodes.push('divergent_count_below_minimum')
  }
  // The floor is checked against the exact ratio. `divergentRate` is rounded
  // for display, and 5 of 101 (0.0495) displays as 0.05, which would otherwise
  // clear a 0.05 floor it does not meet.
  if (
    comparable.length === 0 ||
    divergent.length / comparable.length < thresholds.minDivergentRate
  ) {
    refusalCodes.push('divergent_rate_below_minimum')
  }

  return {
    group,
    totalPairs: entries.length,
    comparablePairs: comparable.length,
    agreements: comparable.length - divergent.length,
    divergentCount: divergent.length,
    divergentRate,
    status: refusalCodes.length > 0 ? 'refused' : 'reportable',
    refusalCodes,
    calibration: calibrationFor(divergent, thresholds),
    examples: divergent.slice(0, thresholds.exampleLimit).map((e) => e.pair),
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
 * Counts do not depend on input order. Every pair is copied once, by index,
 * before anything is counted, so a getter or a `groupBy` that edits its
 * argument cannot make the counts disagree with each other. `examples` keep
 * input order and are those shallow copies (all own enumerable fields), not
 * your own pair objects. `groupBy` receives the same copy. Pairs are not
 * deduplicated, even when they share an `id`. Inputs are never modified.
 *
 * @param pairs - every occasion both judges could have spoken on.
 * @param config - floors and the optional `groupBy`. See `resolveDivergenceConfig`.
 * @throws RangeError from `resolveDivergenceConfig`.
 * @throws TypeError when `pairs` is not an array, has a hole, or holds
 *   anything but plain objects; when `config` is not a plain object; when
 *   `groupBy` is present and not a function; or when `groupBy` returns
 *   something other than a string, `null` or `undefined` (a promise is not
 *   awaited and is rejected the same way).
 */
export function computeDivergence(
  pairs: readonly JudgmentPair[],
  config: DivergenceConfig = {},
): DivergenceResult {
  const thresholds = resolveDivergenceConfig(config)
  const rawGroupBy = (config).groupBy
  if (rawGroupBy !== undefined && rawGroupBy !== null && typeof rawGroupBy !== 'function') {
    typeFail(`groupBy must be a function when present, received ${describe(rawGroupBy)}`)
  }
  const groupBy: (pair: JudgmentPair) => unknown =
    rawGroupBy ?? ((pair: JudgmentPair): unknown => pair.group ?? null)

  const rows = denseCopy('pairs', pairs)
  const entries: Entry[] = []
  for (let index = 0; index < rows.length; index++) {
    const source = rows[index]
    if (!isPlainRecord(source)) {
      typeFail(`pairs[${index}] must be a plain object, received ${describe(source)}`)
    }
    // One shallow copy reads every field exactly once. The counts use the
    // values read here, so nothing done to the copy afterwards can change them.
    const pair = { ...source } as unknown as JudgmentPair
    const { engineJudgment, humanJudgment, laterOutcome } = pair
    entries.push({ pair, engine: engineJudgment, human: humanJudgment, outcome: laterOutcome })
  }

  const buckets = new Map<string, Entry[]>()
  for (const entry of entries) {
    const key: unknown = groupBy(entry.pair)
    // undefined is treated like null (a `(p) => p.group` without `?? null`
    // should not create a group literally keyed undefined). Any other
    // non-string would collide with its string form once keys are sorted.
    if (key === null || key === undefined) continue
    if (typeof key !== 'string') {
      typeFail(`groupBy must return a string or null, received ${describe(key)}`)
    }
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }

  const groups = [...buckets.keys()]
    .sort()
    .map((key) => reportFor(key, buckets.get(key) ?? [], thresholds))

  return {
    overall: reportFor(null, entries, thresholds),
    groups,
    thresholds,
  }
}

const DIVERGENCE_LIMIT =
  'These counts compare supplied judgments with supplied outcomes; they do not show causal benefit or general accuracy.'

/** What one refused report is short on, as `name (actual[, required])`. */
function shortfalls(
  report: DivergenceReport,
  thresholds: Readonly<ResolvedDivergenceConfig> | undefined,
): string {
  const need = (value: unknown): string => (thresholds === undefined ? '' : `, ${text(value)} required`)
  const items: string[] = []
  const comparable = report.comparablePairs
  for (const code of report.refusalCodes) {
    if (code === 'comparable_pairs_below_minimum') {
      items.push(`comparable pairs (${text(comparable)}${need(thresholds?.minComparablePairs)})`)
    } else if (code === 'divergent_count_below_minimum') {
      items.push(`disagreements (${text(report.divergentCount)}${need(thresholds?.minDivergentCount)})`)
    } else if (code === 'divergent_rate_below_minimum') {
      const actual = comparable === 0 ? 'no comparable pairs' : `${text(report.divergentCount)} of ${text(comparable)}`
      // The floor is checked on the exact ratio, so the rounded display can
      // sit at or above it while the report is still refused.
      const rounded =
        thresholds !== undefined && report.divergentRate !== null && report.divergentRate >= thresholds.minDivergentRate
          ? `; it displays as ${text(report.divergentRate)} but the exact ratio is lower`
          : ''
      items.push(`disagreement rate (${actual}${need(thresholds?.minDivergentRate)}${rounded})`)
    }
  }
  return items.length === 0 ? '' : ` Short on: ${items.join(', ')}.`
}

/**
 * Render a divergence report as plain text on one line.
 *
 * - A refused report says "refused to report divergence (<codes>)" and gives
 *   the raw counts, then what it is short on. Pass the result's `thresholds`
 *   as the second argument to add the required numbers (and to explain a rate
 *   that displays at the floor but is refused on the exact ratio). It reaches
 *   no conclusion about the engine or the human.
 * - A reportable report gives the disagreement count, then either why
 *   calibration is withheld (with how many disagreements have an outcome) or
 *   the engine-right, human-right and neither-right counts as three separate
 *   numbers that add up to the resolved disagreements, and how many
 *   disagreements are still unresolved. Never prints a blended accuracy, and
 *   never prints the three counts when calibration is refused.
 * - It ends with a note that the counts compare supplied labels with supplied
 *   outcomes and do not show causal benefit or general accuracy.
 *
 * Caller strings (the group name, codes) are escaped, so control, newline and
 * bidi characters cannot forge structure. The wording changed in 0.2.0.
 *
 * @param report - one report from `computeDivergence` (overall or a group).
 * @param thresholds - optional: the `thresholds` from the same result, to show required counts.
 */
export function describeDivergence(
  report: DivergenceReport,
  thresholds?: Readonly<ResolvedDivergenceConfig>,
): string {
  const where = report.group === null ? 'Overall' : `Group ${label(report.group)}`
  const codes = (list: readonly string[]): string => list.map((c) => text(c)).join(', ')
  const compared = `${text(report.divergentCount)} of ${text(report.comparablePairs)} comparable pairs`
  if (report.status === 'refused') {
    return (
      `${where}: refused to report divergence (${codes(report.refusalCodes)}); ${compared} diverged.` +
      `${shortfalls(report, thresholds)} No conclusion about the engine or the human is available from these pairs.`
    )
  }
  const head = `${where}: the human disagreed on ${compared}.`
  const c = report.calibration
  if (c.status === 'refused') {
    const required = thresholds === undefined ? '' : ` (${text(thresholds.minResolvedDivergent)} required)`
    return `${head} Who was right is not reported yet (${codes(c.refusalCodes)}): ${text(c.resolvedDivergent)} of ${text(report.divergentCount)} disagreements have a later outcome${required}. ${DIVERGENCE_LIMIT}`
  }
  const unresolved = Math.max(0, report.divergentCount - c.resolvedDivergent)
  const open =
    unresolved === 0
      ? 'No disagreement is still unresolved.'
      : `${text(unresolved)} more ${unresolved === 1 ? 'has' : 'have'} no later outcome yet.`
  return `${head} Of the ${text(c.resolvedDivergent)} with a later outcome, the engine was right ${text(c.engineRight)}, the human was right ${text(c.humanRight)} and neither was right ${text(c.neitherRight)}. ${open} ${DIVERGENCE_LIMIT}`
}
