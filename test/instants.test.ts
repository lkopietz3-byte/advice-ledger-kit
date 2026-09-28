import { describe, expect, it } from 'vitest'
import { gradeDecision } from '../src/grade.js'
import { parseInstant } from '../src/internal.js'
import type { Decision, Observation, ObservationState, Recommendation } from '../src/types.js'

// AL-004: window decisions compare parsed instants, not text. Date-only values
// are UTC midnight, timestamps need an explicit zone, and anything else throws.

const recommendation: Recommendation = { id: 'r', subjectId: 's', checkKey: 'c', proposedAt: '2026-01-01' }
const decisionAt = (decidedAt: string): Decision => ({ recommendationId: 'r', status: 'adopted', decidedAt })
const obs = (observedAt: string, state: ObservationState = 'bad', exposed = true): Observation => ({
  subjectId: 's',
  checkKey: 'c',
  state,
  observedAt,
  exposed,
})

describe('equal instants in different string forms sit on the boundary', () => {
  // Each of these is exactly 2026-02-01T00:00:00.000Z.
  const sameInstant = [
    '2026-02-01T00:00:00.000Z',
    '2026-02-01T00:00:00Z',
    '2026-02-01T00:00:00.0Z',
    '2026-02-01T00:00:00+00:00',
    '2026-02-01T00:00:00-00:00',
    '2026-02-01T01:00:00+01:00',
    '2026-01-31T19:00:00-05:00',
    '2026-02-01',
  ]

  it.each(sameInstant)('decision at 2026-02-01T00:00:00.000Z, observation at %s', (observedAt) => {
    const grade = gradeDecision(decisionAt('2026-02-01T00:00:00.000Z'), recommendation, [obs(observedAt)])
    expect(grade.atBoundaryObservations).toBe(1)
    expect(grade.baseline.observations).toBe(0)
    expect(grade.secondary.observations).toBe(0)
    expect(grade.result.observations).toBe(0)
  })

  it.each(sameInstant)('decision written as %s, observation at the canonical form', (decidedAt) => {
    const grade = gradeDecision(decisionAt(decidedAt), recommendation, [obs('2026-02-01T00:00:00.000Z')])
    expect(grade.atBoundaryObservations).toBe(1)
    expect(grade.baseline.observations + grade.secondary.observations).toBe(0)
  })

  it('the audit fixture: three same-instant rows are boundary rows, so the grade refuses (R05)', () => {
    const rows = [
      obs('2026-01-10T00:00:00.000Z'),
      obs('2026-01-11T00:00:00.000Z'),
      obs('2026-01-12T00:00:00.000Z'),
      obs('2026-02-01T00:00:00Z'),
      obs('2026-02-01T00:00:00Z'),
      obs('2026-02-01T00:00:00Z'),
    ]
    const grade = gradeDecision(decisionAt('2026-02-01T00:00:00.000Z'), recommendation, rows)
    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual(['result_below_minimum', 'exposed_result_below_minimum'])
    expect(grade.atBoundaryObservations).toBe(3)
    expect(grade.baseline.observations).toBe(3)
  })
})

describe('one millisecond either side of the boundary', () => {
  it('splits before, boundary and after by the instant', () => {
    const grade = gradeDecision(decisionAt('2026-02-01T00:00:00.500Z'), recommendation, [
      obs('2026-02-01T00:00:00.499Z'),
      obs('2026-02-01T00:00:00.500Z'),
      obs('2026-02-01T00:00:00.501Z'),
    ])
    expect(grade.baseline.observations).toBe(1)
    expect(grade.atBoundaryObservations).toBe(1)
    expect(grade.result.observations).toBe(1)
  })
})

describe('mixed offsets no longer compare wrongly (P18)', () => {
  it('reads 00:30+01:00 as 23:30Z the day before, so it is baseline, not result', () => {
    // Lexically '2026-02-01T00:30:00+01:00' sorts after '2026-02-01T00:00:00Z'.
    const grade = gradeDecision(decisionAt('2026-02-01T00:00:00Z'), recommendation, [
      obs('2026-02-01T00:30:00+01:00'),
      obs('2026-02-01T00:45:00+01:00'),
      obs('2026-02-01T00:59:00+01:00'),
    ])
    expect(grade.baseline.observations).toBe(3)
    expect(grade.secondary.observations).toBe(0)
    expect(grade.result.observations).toBe(0)
  })

  it('an observation four hours before the decision is baseline whatever its offset', () => {
    const grade = gradeDecision(decisionAt('2026-02-01T12:00:00Z'), recommendation, [
      obs('2026-02-01T17:00:00+09:00'), // 08:00Z, four hours before
    ])
    expect(grade.baseline.observations).toBe(1)
    expect(grade.result.observations).toBe(0)
  })

  it('a later instant with an earlier-looking text is after', () => {
    const grade = gradeDecision(decisionAt('2026-02-01T12:00:00Z'), recommendation, [
      obs('2026-02-01T09:00:00-05:00'), // 14:00Z, two hours after
    ])
    expect(grade.result.observations).toBe(1)
    expect(grade.baseline.observations).toBe(0)
  })
})

describe('date-only values are UTC midnight', () => {
  it('sorts a date-only decision against timestamps by the instant', () => {
    const grade = gradeDecision(decisionAt('2026-02-01'), recommendation, [
      obs('2026-01-31T23:59:59Z'),
      obs('2026-02-01T00:00:00Z'),
      obs('2026-02-01T00:00:01Z'),
      obs('2026-02-01T05:00:00-05:00'), // 10:00Z
      obs('2026-01-31T19:00:00-05:00'), // 2026-02-01T00:00Z exactly
    ])
    expect(grade.baseline.observations).toBe(1)
    expect(grade.atBoundaryObservations).toBe(2)
    expect(grade.result.observations).toBe(2)
  })

  it('keeps the decidedAt string exactly as supplied in the result', () => {
    const grade = gradeDecision(decisionAt('2026-02-01T01:00:00+01:00'), recommendation, [])
    expect(grade.decidedAt).toBe('2026-02-01T01:00:00+01:00')
  })
})

describe('parseInstant', () => {
  it('parses the accepted grammar to epoch milliseconds', () => {
    expect(parseInstant('x', '2026-02-01')).toBe(Date.UTC(2026, 1, 1))
    expect(parseInstant('x', '2026-02-01T00:00:00Z')).toBe(Date.UTC(2026, 1, 1))
    expect(parseInstant('x', '2026-02-01T00:00:00.5Z')).toBe(Date.UTC(2026, 1, 1, 0, 0, 0, 500))
    expect(parseInstant('x', '2026-02-01T00:00:00.12Z')).toBe(Date.UTC(2026, 1, 1, 0, 0, 0, 120))
    expect(parseInstant('x', '2026-02-01T00:00:00.123Z')).toBe(Date.UTC(2026, 1, 1, 0, 0, 0, 123))
    expect(parseInstant('x', '2026-02-01T05:30:00+05:30')).toBe(Date.UTC(2026, 1, 1))
    expect(parseInstant('x', '2026-01-31T18:00:00-06:00')).toBe(Date.UTC(2026, 1, 1))
    expect(parseInstant('x', '2026-02-01T23:59:59+14:00')).toBe(Date.UTC(2026, 1, 1, 9, 59, 59))
  })

  it('accepts real leap days and the calendar edges', () => {
    expect(parseInstant('x', '2024-02-29')).toBe(Date.UTC(2024, 1, 29))
    expect(parseInstant('x', '2000-02-29')).toBe(Date.UTC(2000, 1, 29))
    expect(parseInstant('x', '2026-12-31')).toBe(Date.UTC(2026, 11, 31))
    expect(parseInstant('x', '2026-01-31')).toBe(Date.UTC(2026, 0, 31))
    expect(parseInstant('x', '2026-04-30')).toBe(Date.UTC(2026, 3, 30))
    expect(parseInstant('x', '9999-12-31T23:59:59Z')).toBe(Date.UTC(9999, 11, 31, 23, 59, 59))
    const year0 = new Date(0)
    year0.setUTCFullYear(0, 0, 1)
    expect(parseInstant('x', '0000-01-01')).toBe(year0.getTime())
  })

  it('always yields a finite number for anything the grammar and calendar accept', () => {
    for (const year of [0, 1, 99, 100, 1900, 2000, 2024, 2026, 9999]) {
      const y = String(year).padStart(4, '0')
      for (const md of ['01-01', '02-28', '03-31', '04-30', '12-31']) {
        expect(Number.isFinite(parseInstant('x', `${y}-${md}`))).toBe(true)
        expect(Number.isFinite(parseInstant('x', `${y}-${md}T23:59:59.999+14:00`))).toBe(true)
        expect(Number.isFinite(parseInstant('x', `${y}-${md}T00:00:00-23:59`))).toBe(true)
      }
    }
  })

  const rejected: Array<[string, string]> = [
    ['impossible month and day (R09)', '2026-99-99'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-01-00'],
    ['Feb 30', '2026-02-30'],
    ['Feb 29 in a common year', '2025-02-29'],
    ['Feb 29 in a century year', '1900-02-29'],
    ['Apr 31', '2026-04-31'],
    ['day 32', '2026-01-32'],
    ['no zone', '2026-02-01T00:00:00'],
    ['no seconds', '2026-02-01T00:00Z'],
    ['space separator', '2026-02-01 00:00:00Z'],
    ['lowercase t', '2026-02-01t00:00:00Z'],
    ['lowercase z', '2026-02-01T00:00:00z'],
    ['offset without colon', '2026-02-01T00:00:00+0100'],
    ['offset hour 24', '2026-02-01T00:00:00+24:00'],
    ['offset minute 60', '2026-02-01T00:00:00+01:60'],
    ['hour 24', '2026-02-01T24:00:00Z'],
    ['minute 60', '2026-02-01T00:60:00Z'],
    ['second 60', '2026-02-01T00:00:60Z'],
    ['four fractional digits', '2026-02-01T00:00:00.1234Z'],
    ['empty fraction', '2026-02-01T00:00:00.Z'],
    ['one-digit month', '2026-2-1'],
    ['basic format', '20260201'],
    ['two-digit year', '26-02-01'],
    ['leading space', ' 2026-02-01'],
    ['trailing newline', '2026-02-01\n'],
    ['trailing text', '2026-02-01 UTC'],
    ['words', 'yesterday'],
    ['date with only a zone', '2026-02-01Z'],
    ['US format', '02/01/2026'],
    ['an epoch number as text', '1769904000'],
  ]

  it.each(rejected)('rejects %s: %s', (_label, text) => {
    expect(() => parseInstant('decision.decidedAt', text)).toThrow(RangeError)
    expect(() => parseInstant('decision.decidedAt', text)).toThrow(/decision\.decidedAt must be a date/)
  })
})

describe('invalid timestamps throw a RangeError from gradeDecision, distinct from a refusal', () => {
  const good = [obs('2026-01-10'), obs('2026-01-11'), obs('2026-01-12')]

  it('throws for an impossible calendar date on a matching observation (R09)', () => {
    expect(() =>
      gradeDecision(decisionAt('2026-02-01'), recommendation, [...good, obs('2026-99-99')]),
    ).toThrow(RangeError)
    expect(() =>
      gradeDecision(decisionAt('2026-02-01'), recommendation, [...good, obs('2026-99-99')]),
    ).toThrow(/observations\[3\]\.observedAt must be a date .* received "2026-99-99"/)
  })

  it('throws for a timestamp with no zone on a matching observation', () => {
    expect(() =>
      gradeDecision(decisionAt('2026-02-01'), recommendation, [obs('2026-02-02T10:00:00')]),
    ).toThrow(/observations\[0\]\.observedAt must be a date .* explicit zone/)
  })

  it('throws for an impossible or unzoned decidedAt, even when the grade would refuse structurally', () => {
    for (const decidedAt of ['2026-02-30', '2026-02-01T00:00:00', 'tomorrow']) {
      expect(() => gradeDecision(decisionAt(decidedAt), recommendation, good)).toThrow(RangeError)
      expect(() =>
        gradeDecision({ ...decisionAt(decidedAt), recommendationId: 'other' }, recommendation, good),
      ).toThrow(/decision\.decidedAt must be a date/)
    }
  })

  it('does not parse the date of an observation that belongs to another subject or check', () => {
    const other: Observation = { subjectId: 'other', checkKey: 'c', state: 'bad', observedAt: 'not-a-date' }
    expect(() => gradeDecision(decisionAt('2026-02-01'), recommendation, [other])).not.toThrow()
  })

  it('still reports an empty or non-string date as a TypeError, not a RangeError', () => {
    expect(() => gradeDecision(decisionAt(''), recommendation, good)).toThrow(TypeError)
    expect(() => gradeDecision(decisionAt('2026-02-01'), recommendation, [obs('')])).toThrow(TypeError)
  })

  it('a valid ledger in one consistent form grades exactly as before', () => {
    const rows = [
      obs('2026-01-10', 'bad'),
      obs('2026-01-11', 'bad'),
      obs('2026-01-12', 'good'),
      obs('2026-02-10', 'good'),
      obs('2026-02-11', 'good'),
      obs('2026-02-12', 'good'),
    ]
    const grade = gradeDecision(decisionAt('2026-02-01'), recommendation, rows)
    expect(grade.verdict).toBe('holding')
    expect(grade.baseline).toEqual({ observations: 3, bad: 2, good: 1, badRate: 0.667 })
    expect(grade.result).toEqual({ observations: 3, bad: 0, good: 3, badRate: 0 })
  })
})
