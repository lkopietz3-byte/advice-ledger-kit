// internal.ts — helpers shared by grade.ts and divergence.ts. Not exported
// from the package entry point.

/** Throw a RangeError unless `value` is an integer >= `minimum`. */
export function requireCount(name: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `advice-ledger-kit: ${name} must be an integer >= ${minimum}, received ${String(value)}`,
    )
  }
  return value
}

/**
 * `part / whole` rounded to 3 decimal places, exact halves rounded up.
 * `null` on an empty denominator, never NaN.
 *
 * Rounds `part * 1000 / whole` rather than calling `toFixed(3)` on the ratio.
 * `toFixed` rounds the binary value, so 0.0125 (1 of 80) went up to 0.013
 * while 0.0375 (3 of 80) went down to 0.037. With integer counts,
 * `part * 1000 / whole` is an exact half exactly when the ratio is, so every
 * half rounds the same way.
 */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 1000) / whole) / 1000 : null
}

/** `a - b` for two values already rounded to 3 places, cleaned of float noise. */
export function difference3(a: number, b: number): number {
  return Math.round((a - b) * 1000) / 1000
}

/**
 * Whether `bad1 / whole1` is a strictly higher rate than `bad2 / whole2`,
 * compared as an exact rational via cross-multiplication rather than
 * floating-point division. Two rates can round to the same 3-place `badRate`
 * while differing exactly (the same class of bug the rate floor had), so this
 * never divides and never looks at a rounded value.
 *
 * Both `whole1` and `whole2` must be positive integers; the caller is
 * responsible for that (this is an internal helper, not a general-purpose
 * comparator). Counts this library deals with are small enough that the
 * cross-multiplication stays within `Number.MAX_SAFE_INTEGER`.
 */
export function rateHigherThan(bad1: number, whole1: number, bad2: number, whole2: number): boolean {
  return bad1 * whole2 > bad2 * whole1
}

/** Throw a TypeError with the package prefix. */
export function typeFail(message: string): never {
  throw new TypeError(`advice-ledger-kit: ${message}`)
}

/** Render a received value for an error message: strings quoted, the rest via String(). */
export function shown(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

// One grammar for every `decidedAt` and `observedAt`, the same one freshness-kit
// uses for its review dates: a calendar date (read as UTC midnight) or a
// timestamp with seconds and an explicit zone. Anything else is rejected
// instead of being compared as text.
const INSTANT_GRAMMAR =
  /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/

/**
 * Parse a `decidedAt` or `observedAt` string to epoch milliseconds.
 *
 * Accepts `YYYY-MM-DD` (UTC midnight) and `YYYY-MM-DDTHH:mm:ss[.f{1,3}]` with
 * an explicit `Z` or `+hh:mm`/`-hh:mm` zone. Two strings that name the same
 * instant parse to the same number, whatever their form.
 *
 * @throws RangeError when the text does not match, or names a day that does
 *   not exist (2026-02-30, 2025-02-29, month 13).
 */
export function parseInstant(name: string, value: string): number {
  const match = INSTANT_GRAMMAR.exec(value)
  if (!match) {
    throw new RangeError(
      `advice-ledger-kit: ${name} must be a date (YYYY-MM-DD, read as UTC midnight) or a timestamp with seconds and an explicit zone (Z or +hh:mm), received ${shown(value)}`,
    )
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] as number)) {
    throw new RangeError(
      `advice-ledger-kit: ${name} must be a date that exists on the calendar (not 2026-02-30 or month 13), received ${shown(value)}`,
    )
  }
  return Date.parse(match[4] === undefined ? `${value}T00:00:00Z` : value)
}
