import { describe, expect, it } from 'vitest'
import { computeDivergence, resolveDivergenceConfig } from '../src/divergence.js'
import { gradeDecision, resolveGradeConfig } from '../src/grade.js'
import { describe as describeValue, escapeText, isBlank, isPlainRecord } from '../src/internal.js'
import type { Decision, JudgmentPair, Observation, Recommendation } from '../src/types.js'

// Input contract: caller input is read once and snapshotted, rows are plain
// dense records, blank identity is rejected, and error messages cannot throw.

const recommendation: Recommendation = { id: 'r', subjectId: 's', checkKey: 'c', proposedAt: '2026-01-01' }
const decision: Decision = { recommendationId: 'r', status: 'adopted', decidedAt: '2026-02-01' }
const row = (observedAt: string, state: 'good' | 'bad', exposed?: boolean): Observation => ({
  subjectId: 's',
  checkKey: 'c',
  state,
  observedAt,
  ...(exposed === undefined ? {} : { exposed }),
})
const thinLog = [row('2026-01-10', 'bad'), row('2026-02-10', 'good', true)]
const fullLog = [
  row('2026-01-10', 'bad'),
  row('2026-01-11', 'bad'),
  row('2026-01-12', 'good'),
  row('2026-02-10', 'good', true),
  row('2026-02-11', 'good', true),
  row('2026-02-12', 'good', true),
]

/** A plain object whose fields are getters that count how often each is read. */
function counting<T extends object>(fields: T, reads: Record<string, number>): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    Object.defineProperty(out, key, {
      enumerable: true,
      get() {
        reads[key] = (reads[key] ?? 0) + 1
        return value
      },
    })
  }
  return out as T
}

/** A plain object whose getter returns `first` once and `later` on every read after. */
function flipping<T extends object>(fields: T, key: keyof T & string, later: unknown): T {
  const out: Record<string, unknown> = { ...(fields as Record<string, unknown>) }
  let count = 0
  Object.defineProperty(out, key, {
    enumerable: true,
    get() {
      count += 1
      return count === 1 ? (fields as Record<string, unknown>)[key] : later
    },
  })
  return out as T
}

describe('bug class 1: caller input is read once', () => {
  it('reads each decision, recommendation, observation and config field once in gradeDecision', () => {
    const dReads: Record<string, number> = {}
    const rReads: Record<string, number> = {}
    const cReads: Record<string, number> = {}
    const oReads: Record<string, number>[] = fullLog.map(() => ({}))
    const grade = gradeDecision(
      counting({ ...decision, status: 'adopted' as const }, dReads),
      counting({ ...recommendation, basis: 'observed' as const }, rReads),
      fullLog.map((o, i) => counting({ ...o }, oReads[i] as Record<string, number>)),
      counting({ minBaselineObservations: 3, proposeThreshold: 2, requireObservedBasis: false }, cReads),
    )
    expect(grade.verdict).toBe('holding')
    for (const reads of [dReads, rReads, cReads, ...oReads]) {
      for (const [key, count] of Object.entries(reads)) expect([key, count]).toEqual([key, 1])
    }
    expect(Object.keys(dReads).sort()).toEqual(['decidedAt', 'recommendationId', 'status'])
    expect(Object.keys(rReads).sort()).toEqual(['basis', 'checkKey', 'id', 'subjectId'])
  })

  it('counts a state that changes after the first read by the value that was validated', () => {
    const bad = flipping(row('2026-01-10', 'bad'), 'state', 'good')
    const grade = gradeDecision(decision, recommendation, [bad, ...fullLog.slice(1)])
    expect(grade.baseline.observations).toBe(3)
    expect(grade.baseline.bad).toBe(2)
    expect(grade.baseline.good).toBe(1)
  })

  it('echoes and compares the decidedAt it validated', () => {
    const shifty = flipping(decision, 'decidedAt', '2026-03-01')
    const grade = gradeDecision(shifty, recommendation, fullLog)
    expect(grade.decidedAt).toBe('2026-02-01')
    expect(grade.baseline.observations).toBe(3)
    expect(grade.result.observations).toBe(3)
  })

  it('does not let a status or basis that changes after validation reach the result', () => {
    const grade = gradeDecision(
      flipping(decision, 'status', 'dismissed'),
      flipping({ ...recommendation, basis: 'observed' as const }, 'basis', 'model-proposed'),
      fullLog,
    )
    expect(grade.status).toBe('adopted')
    expect(grade.basis).toBe('observed')
  })

  it('reads each pair field once in computeDivergence and gives a consistent partition', () => {
    const reads: Record<string, number>[] = []
    const pairs = Array.from({ length: 12 }, (_, i) => {
      const r: Record<string, number> = {}
      reads.push(r)
      const fields: JudgmentPair =
        i < 6
          ? { engineJudgment: 'keep', humanJudgment: 'keep', group: 'g' }
          : { engineJudgment: 'keep', humanJudgment: 'remove', laterOutcome: 'keep', group: 'g', id: `p${i}` }
      return counting({ ...fields }, r)
    })
    const { overall } = computeDivergence(pairs)
    expect(overall.comparablePairs).toBe(12)
    for (const r of reads) for (const [key, count] of Object.entries(r)) expect([key, count]).toEqual([key, 1])
  })

  it('a laterOutcome that changes between reads cannot break engineRight + humanRight + neitherRight', () => {
    const outcomes = ['keep', 'remove', 'other']
    const pairs = Array.from({ length: 6 }, () => {
      let n = 0
      const pair: Record<string, unknown> = { engineJudgment: 'keep', humanJudgment: 'remove' }
      Object.defineProperty(pair, 'laterOutcome', {
        enumerable: true,
        get: () => outcomes[n++ % 3],
      })
      return pair as unknown as JudgmentPair
    })
    const { calibration } = computeDivergence(pairs).overall
    expect(calibration.resolvedDivergent).toBe(6)
    expect(calibration.engineRight + calibration.humanRight + calibration.neitherRight).toBe(6)
    expect(Math.min(calibration.engineRight, calibration.humanRight, calibration.neitherRight)).toBeGreaterThanOrEqual(0)
  })

  it('returns copies as examples, so a pair changed after the call cannot change what was reported', () => {
    const original: JudgmentPair = { engineJudgment: 'keep', humanJudgment: 'remove', id: 'a' }
    const { overall } = computeDivergence([original])
    expect(overall.examples).toHaveLength(1)
    expect(overall.examples[0]).not.toBe(original)
    expect(overall.examples[0]).toEqual(original)
    original.humanJudgment = 'keep'
    expect(overall.examples[0]?.humanJudgment).toBe('remove')
  })

  it('hands groupBy a snapshot that still carries the caller’s extra fields', () => {
    const pairs = [
      { engineJudgment: 'a', humanJudgment: 'a', source: 'web' },
      { engineJudgment: 'a', humanJudgment: 'a', source: 'app' },
    ]
    const result = computeDivergence(pairs, {
      groupBy: (pair) => (pair as JudgmentPair & { source: string }).source,
    })
    expect(result.groups.map((g) => g.group)).toEqual(['app', 'web'])
  })

  it('a groupBy that edits its argument cannot change the counts', () => {
    const pairs: JudgmentPair[] = [
      ...Array.from({ length: 10 }, () => ({ engineJudgment: 'a', humanJudgment: 'a' })),
      ...Array.from({ length: 3 }, () => ({ engineJudgment: 'a', humanJudgment: 'b' })),
    ]
    const result = computeDivergence(pairs, {
      groupBy: (pair) => {
        pair.humanJudgment = pair.engineJudgment
        return 'all'
      },
    })
    expect(result.overall.divergentCount).toBe(3)
    expect(result.groups[0]?.divergentCount).toBe(3)
    expect(pairs[12]?.humanJudgment).toBe('b')
  })
})

describe('bug class 2: sparse and non-array inputs', () => {
  const sparse = <T>(items: T[]): T[] => {
    const copy = [...items]
    Reflect.deleteProperty(copy, 1)
    return copy
  }

  it('rejects a hole in the observations array instead of skipping it', () => {
    expect(() => gradeDecision(decision, recommendation, sparse(fullLog))).toThrow(TypeError)
    expect(() => gradeDecision(decision, recommendation, sparse(fullLog))).toThrow(
      /observations\[1\] is missing/,
    )
  })

  it('rejects a hole in the pairs array, with or without a groupBy', () => {
    const pairs: JudgmentPair[] = Array.from({ length: 4 }, () => ({ engineJudgment: 'a', humanJudgment: 'a' }))
    expect(() => computeDivergence(sparse(pairs))).toThrow(/pairs\[1\] is missing/)
    expect(() => computeDivergence(sparse(pairs), { groupBy: () => null })).toThrow(/pairs\[1\] is missing/)
  })

  it('rejects an array that is not an array', () => {
    expect(() => gradeDecision(decision, recommendation, new Set(fullLog) as unknown as Observation[])).toThrow(
      /observations must be an array/,
    )
    expect(() => gradeDecision(decision, recommendation, undefined as unknown as Observation[])).toThrow(
      /observations must be an array, received undefined/,
    )
    expect(() => computeDivergence('abc' as unknown as JudgmentPair[])).toThrow(/pairs must be an array/)
    expect(() => computeDivergence({ length: 0 } as unknown as JudgmentPair[])).toThrow(/pairs must be an array/)
  })

  it('does not read the observations at all when the grade refuses structurally', () => {
    const trap = new Proxy([], {
      get() {
        throw new Error('observations were read')
      },
      has() {
        throw new Error('observations were read')
      },
    }) as unknown as Observation[]
    const grade = gradeDecision({ ...decision, recommendationId: 'other' }, recommendation, trap)
    expect(grade.refusalCodes).toEqual(['decision_recommendation_mismatch'])
  })

  it('accepts an empty array and an array with undefined-free rows', () => {
    expect(gradeDecision(decision, recommendation, []).verdict).toBe('refused')
    expect(computeDivergence([]).overall.totalPairs).toBe(0)
  })
})

describe('bug class 6: only plain records are accepted where records are expected', () => {
  class Row {
    subjectId = 's'
    checkKey = 'c'
    state = 'bad'
    observedAt = '2026-01-10'
  }
  const notPlain: Array<[string, unknown]> = [
    ['a Map', new Map([['subjectId', 's']])],
    ['a Date', new Date(0)],
    ['a RegExp', /x/],
    ['a Set', new Set()],
    ['an array', ['s']],
    ['a class instance', new Row()],
    ['a boxed String', new String('s')],
    ['null', null],
    ['a number', 7],
    ['a string', 'row'],
    ['undefined', undefined],
  ]

  it.each(notPlain)('rejects %s as an observation row, including one that matches nothing', (_l, value) => {
    expect(() => gradeDecision(decision, recommendation, [value as Observation])).toThrow(TypeError)
    expect(() => gradeDecision(decision, recommendation, [value as Observation])).toThrow(
      /observations\[0\] must be a plain object/,
    )
  })

  it.each(notPlain)('rejects %s as a pair', (_l, value) => {
    expect(() => computeDivergence([value as JudgmentPair])).toThrow(/pairs\[0\] must be a plain object/)
  })

  it.each(notPlain)('rejects %s as a decision and as a recommendation', (_l, value) => {
    expect(() => gradeDecision(decision, value as Recommendation, fullLog)).toThrow(
      /recommendation must be a plain object/,
    )
    expect(() => gradeDecision(value as Decision, recommendation, fullLog)).toThrow(
      /decision must be a plain object/,
    )
  })

  it.each(notPlain.filter(([label]) => label !== 'undefined'))('rejects %s as a config', (_l, value) => {
    expect(() => resolveGradeConfig(value as never)).toThrow(/config must be a plain object/)
    expect(() => resolveDivergenceConfig(value as never)).toThrow(/config must be a plain object/)
    expect(() => gradeDecision(decision, recommendation, fullLog, value as never)).toThrow(TypeError)
    expect(() => computeDivergence([], value as never)).toThrow(TypeError)
  })

  it('a Map with a floor in it is not silently read as "use the defaults"', () => {
    expect(() => resolveGradeConfig(new Map([['minBaselineObservations', 1]]) as never)).toThrow(TypeError)
  })

  it('undefined config still means the defaults', () => {
    expect(resolveGradeConfig(undefined).minBaselineObservations).toBe(3)
    expect(resolveDivergenceConfig(undefined).minComparablePairs).toBe(10)
  })

  it('accepts null-prototype records and JSON.parse output everywhere', () => {
    const bare = <T extends object>(value: T): T => Object.assign(Object.create(null) as object, value)
    const grade = gradeDecision(bare(decision), bare(recommendation), fullLog.map(bare), bare({ proposeThreshold: 2 }))
    expect(grade.verdict).toBe('holding')
    const parsed = JSON.parse(JSON.stringify({ decision, recommendation, fullLog })) as {
      decision: Decision
      recommendation: Recommendation
      fullLog: Observation[]
    }
    expect(gradeDecision(parsed.decision, parsed.recommendation, parsed.fullLog).verdict).toBe('holding')
    const pairs = [bare({ engineJudgment: 'a', humanJudgment: 'b' })]
    expect(computeDivergence(pairs, bare({ minComparablePairs: 1 })).overall.divergentCount).toBe(1)
  })

  it('isPlainRecord separates records from everything else', () => {
    expect(isPlainRecord({})).toBe(true)
    expect(isPlainRecord(Object.create(null))).toBe(true)
    expect(isPlainRecord(JSON.parse('{"__proto__": {"x": 1}}'))).toBe(true)
    expect(isPlainRecord([])).toBe(false)
    expect(isPlainRecord(new Map())).toBe(false)
    expect(isPlainRecord(Object.create({}))).toBe(false)
    expect(isPlainRecord(() => 1)).toBe(false)
    expect(isPlainRecord(null)).toBe(false)
  })
})

describe('bug class 7: blank identity is not identity', () => {
  const invisible = [
    '',
    ' ',
    '\t\n',
    '\u200B',
    '\u2066\u2069',
    '\u061C',
    '\u3164',
    '\u00AD',
    '\uFEFF',
    '\u180E',
    ' \u200B\u2067 ',
    '\u202E',
  ]

  it.each(invisible.map((v) => [JSON.stringify(v), v]))('refuses a checkKey of %s as no_gradeable_check_key', (_l, key) => {
    const grade = gradeDecision(decision, { ...recommendation, checkKey: key }, fullLog)
    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual(['no_gradeable_check_key'])
  })

  it('still grades a key that has visible content next to invisible characters', () => {
    const key = 'seal\u200B-leak'
    const rows = fullLog.map((o) => ({ ...o, checkKey: key }))
    const grade = gradeDecision(decision, { ...recommendation, checkKey: key }, rows)
    expect(grade.verdict).toBe('holding')
  })

  it.each(invisible.map((v) => [JSON.stringify(v), v]))('rejects an id of %s instead of letting blank match blank', (_l, id) => {
    expect(() => gradeDecision(decision, { ...recommendation, id: id }, fullLog)).toThrow(
      /recommendation\.id must not be blank/,
    )
    expect(() =>
      gradeDecision({ ...decision, recommendationId: id }, recommendation, fullLog),
    ).toThrow(/decision\.recommendationId must not be blank/)
    expect(() => gradeDecision(decision, { ...recommendation, subjectId: id }, fullLog)).toThrow(
      /recommendation\.subjectId must not be blank/,
    )
  })

  it('a blank id on both sides no longer produces a grade', () => {
    expect(() =>
      gradeDecision(
        { ...decision, recommendationId: '' },
        { ...recommendation, id: '' },
        fullLog.map((o) => ({ ...o, subjectId: '' })),
      ),
    ).toThrow(TypeError)
  })

  it('isBlank covers whitespace plus every default-ignorable code point', () => {
    for (const cp of [0x0009, 0x00a0, 0x061c, 0x115f, 0x1160, 0x17b4, 0x180b, 0x200b, 0x2028, 0x2066, 0x2069, 0x3164, 0xfe0f, 0xfeff, 0xffa0, 0xe0001]) {
      expect(isBlank(String.fromCodePoint(cp))).toBe(true)
    }
    expect(isBlank('')).toBe(true)
    expect(isBlank('a')).toBe(false)
    expect(isBlank('\u200Ba\u200B')).toBe(false)
    expect(isBlank('\u2800')).toBe(false)
  })
})

describe('bug class 3: error messages cannot throw and stay bounded', () => {
  it('describes values that String() cannot convert', () => {
    const bare = Object.create(null) as never
    const hostile = { toString: () => { throw new Error('boom') } } as never
    expect(() => resolveGradeConfig({ proposeThreshold: bare })).toThrow(RangeError)
    expect(() => resolveGradeConfig({ proposeThreshold: bare })).toThrow(/proposeThreshold must be an integer >= 1/)
    expect(() => resolveGradeConfig({ minResultObservations: hostile })).toThrow(/minResultObservations must be an integer/)
    expect(() => resolveDivergenceConfig({ minDivergentRate: bare })).toThrow(/minDivergentRate must be a number between 0 and 1/)
    expect(() => resolveDivergenceConfig({ exampleLimit: hostile })).toThrow(/exampleLimit must be an integer/)
  })

  it('describes a bad basis, status and state without calling into the value', () => {
    const bare = Object.create(null) as never
    expect(() => gradeDecision(decision, { ...recommendation, basis: bare }, fullLog)).toThrow(
      /recommendation\.basis must be 'observed' or 'model-proposed'/,
    )
    expect(() => gradeDecision({ ...decision, status: bare }, recommendation, fullLog)).toThrow(
      /decision\.status must be 'adopted' or 'dismissed'/,
    )
    expect(() =>
      gradeDecision(decision, recommendation, [{ ...row('2026-01-10', 'bad'), state: bare }]),
    ).toThrow(/observations\[0\]\.state must be 'good' or 'bad'/)
  })

  it('describes a groupBy result that cannot be converted, and one that is a promise', () => {
    const pairs: JudgmentPair[] = [{ engineJudgment: 'a', humanJudgment: 'a' }]
    expect(() => computeDivergence(pairs, { groupBy: () => Object.create(null) as never })).toThrow(
      /groupBy must return a string or null/,
    )
    expect(() => computeDivergence(pairs, { groupBy: (async () => 'g') as never })).toThrow(
      /groupBy must return a string or null/,
    )
  })

  it('formats bigint, symbol, function, array, object and long-string values', () => {
    expect(describeValue(1n)).toBe('1n')
    expect(describeValue(Symbol('x'))).toBe('a symbol')
    expect(describeValue(() => 1)).toBe('a function')
    expect(describeValue([1, 2])).toBe('an array')
    expect(describeValue({})).toBe('an object')
    expect(describeValue(Object.create(null))).toBe('an object')
    expect(describeValue(undefined)).toBe('undefined')
    expect(describeValue(null)).toBe('null')
    expect(describeValue(NaN)).toBe('NaN')
    expect(describeValue(-0)).toBe('0')
    expect(describeValue(true)).toBe('true')
    expect(describeValue('ok')).toBe('"ok"')
    const long = describeValue('x'.repeat(10_000))
    expect(long.length).toBeLessThan(120)
    expect(long.endsWith('…')).toBe(true)
  })

  it('never returns a raw control or bidi character from a caller string', () => {
    expect(describeValue('a\nb')).toBe('"a\\nb"')
    expect(describeValue('a\u202Eb')).toBe('"a\\u{202E}b"')
    expect(describeValue('a\u001b[31mb')).not.toContain('\u001b')
    const message = (() => {
      try {
        gradeDecision(decision, recommendation, [{ ...row('2026-01-10', 'bad'), state: 'x\u202Ey\nz' as never }])
      } catch (e) {
        return (e as Error).message
      }
      return ''
    })()
    expect(message).toContain('received "x\\u{202E}y\\nz"')
    expect(message).not.toMatch(/[\u202E\n]/)
  })

  it('a value whose inspection throws is still described', () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(describeValue(revoked.proxy)).toBe('an object')
    expect(describeValue(new Proxy({}, { getPrototypeOf() { throw new Error('nope') } }))).toBe('an object')
  })
})

describe('bug class 8: escapeText', () => {
  it('escapes controls, line separators, bidi and format characters, and lone surrogates', () => {
    expect(escapeText('a\nb\rc\td')).toBe('a\\nb\\rc\\td')
    expect(escapeText('\u001b[31m')).toBe('\\u{1B}[31m')
    expect(escapeText('\u0000\u007f\u0085')).toBe('\\u{0}\\u{7F}\\u{85}')
    expect(escapeText('\u2028\u2029')).toBe('\\u{2028}\\u{2029}')
    expect(escapeText('\u202Eabc\u2066')).toBe('\\u{202E}abc\\u{2066}')
    expect(escapeText('\u061C\u200B\u200F\uFEFF')).toBe('\\u{61C}\\u{200B}\\u{200F}\\u{FEFF}')
    expect(escapeText('\ud800')).toBe('\\u{D800}')
  })

  it('leaves ordinary text, punctuation, backslashes and non-ASCII letters alone', () => {
    for (const text of ['pump-14', 'seal leak', 'C:\\pump', 'naïve café', '日本語', '😀 ok', 'a"b\'c']) {
      expect(escapeText(text)).toBe(text)
    }
  })
})

describe('bug class 9: callback results', () => {
  it('rejects a groupBy that is not a function with a clear TypeError', () => {
    for (const groupBy of ['g', 1, {}, true]) {
      expect(() => computeDivergence([], { groupBy: groupBy as never })).toThrow(/groupBy must be a function/)
    }
  })

  it('null and undefined groupBy mean the default', () => {
    const pairs: JudgmentPair[] = [{ engineJudgment: 'a', humanJudgment: 'a', group: 'x' }]
    expect(computeDivergence(pairs, { groupBy: null as never }).groups.map((g) => g.group)).toEqual(['x'])
    expect(computeDivergence(pairs, { groupBy: undefined as never }).groups.map((g) => g.group)).toEqual(['x'])
  })

  it('does not treat a falsy non-null result as "no group"', () => {
    const pairs: JudgmentPair[] = [{ engineJudgment: 'a', humanJudgment: 'a' }]
    for (const value of [0, false, NaN, '' as unknown]) {
      const call = () => computeDivergence(pairs, { groupBy: () => value as never })
      if (value === '') expect(call().groups.map((g) => g.group)).toEqual([''])
      else expect(call).toThrow(/groupBy must return a string or null/)
    }
  })
})

describe('bug class 10: lookups by key coercion', () => {
  it('rejects boxed strings and arrays where a literal string is required', () => {
    expect(() => gradeDecision({ ...decision, status: new String('adopted') as never }, recommendation, fullLog)).toThrow(
      /decision\.status must be/,
    )
    expect(() =>
      gradeDecision(decision, { ...recommendation, basis: ['observed'] as never }, fullLog),
    ).toThrow(/recommendation\.basis must be/)
    expect(() =>
      gradeDecision(decision, recommendation, [{ ...row('2026-01-10', 'bad'), state: ['bad'] as never }]),
    ).toThrow(/observations\[0\]\.state must be/)
    expect(() => gradeDecision(decision, { ...recommendation, id: ['r'] as never }, fullLog)).toThrow(/recommendation\.id must be a string/)
  })

  it('does not match a checkKey or subjectId by coercion', () => {
    const grade = gradeDecision(
      decision,
      recommendation,
      thinLog.map((o) => ({ ...o, checkKey: ['c'] as never, subjectId: new String('s') as never })),
    )
    expect(grade.baseline.observations).toBe(0)
  })
})
