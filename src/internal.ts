// internal.ts — helpers shared by grade.ts and divergence.ts. Not exported
// from the package entry point.

/** Throw a RangeError unless `value` is an integer >= `minimum`. */
export function requireCount(name: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `advice-ledger-kit: ${name} must be an integer >= ${minimum}, received ${describe(value)}`,
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

// Control characters (Cc), format characters such as the bidi controls
// U+061C, U+200E/F, U+202A-202E and U+2066-2069 (Cf), line and paragraph
// separators (Zl, Zp) and lone surrogates (Cs). None of these should reach a
// terminal or a log line from a caller-supplied string.
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu

/**
 * Make a caller-supplied string safe to put in a sentence: newlines, tabs and
 * carriage returns become `\n`, `\t` and `\r`, and every other control, bidi
 * or format character becomes `\u{HEX}`. Ordinary text, backslashes and
 * non-ASCII letters are left alone, so the output cannot start a new line,
 * reorder the text around it or send a terminal escape.
 */
export function escapeText(text: string): string {
  return text.replace(UNSAFE_TEXT, (ch) => {
    if (ch === '\n') return '\\n'
    if (ch === '\r') return '\\r'
    if (ch === '\t') return '\\t'
    return `\\u{${(ch.codePointAt(0) as number).toString(16).toUpperCase()}}`
  })
}

const MAX_SHOWN = 80

/**
 * Render a received value for an error message without ever throwing and
 * without calling into the value. Strings are quoted, escaped and cut at 80
 * characters; numbers, booleans, null and undefined print as themselves;
 * bigint prints as `1n`; everything else is named by kind. Never calls
 * `toString`, `toJSON` or a getter, so a hostile value cannot change or break
 * the error that reports it.
 */
export function describe(value: unknown): string {
  if (typeof value === 'string') {
    const cut = value.length > MAX_SHOWN
    return escapeText(JSON.stringify(cut ? value.slice(0, MAX_SHOWN) : value)) + (cut ? '…' : '')
  }
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return 'a symbol'
  if (typeof value === 'function') return 'a function'
  if (typeof value === 'object' && value !== null) {
    try {
      return Array.isArray(value) ? 'an array' : 'an object'
    } catch {
      return 'an object' // a revoked proxy makes Array.isArray throw
    }
  }
  return String(value)
}

/**
 * Whether `text` shows nothing: empty, or only whitespace and
 * Default_Ignorable_Code_Point characters (zero-width spaces, bidi controls,
 * the soft hyphen, variation selectors, Hangul fillers and similar).
 * `String.prototype.trim` alone misses the ignorable ones.
 */
export function isBlank(text: string): boolean {
  return /^[\p{White_Space}\p{Default_Ignorable_Code_Point}]*$/u.test(text)
}

/** A plain object or a null-prototype object: not an array, Map, Set, Date, RegExp or class instance. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === null || Object.getPrototypeOf(proto) === null
}

/** Throw a TypeError unless `value` is a plain record. */
export function requirePlainRecord(name: string, value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) typeFail(`${name} must be a plain object, received ${describe(value)}`)
  return value
}

/**
 * Copy an array once, by index, refusing anything that is not an array and any
 * hole. The copy is what the caller's code must validate and compute from, so
 * a sparse array can never be validated by one traversal (which skips holes)
 * and then processed by another (which visits them).
 */
export function denseCopy(name: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) typeFail(`${name} must be an array, received ${describe(value)}`)
  const length: number = value.length
  const copy: unknown[] = []
  for (let i = 0; i < length; i++) {
    if (!(i in value)) typeFail(`${name}[${i}] is missing (the array has a hole); every position must hold a row`)
    copy.push(value[i])
  }
  return copy
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
      `advice-ledger-kit: ${name} must be a date (YYYY-MM-DD, read as UTC midnight) or a timestamp with seconds and an explicit zone (Z or +hh:mm), received ${describe(value)}`,
    )
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] as number)) {
    throw new RangeError(
      `advice-ledger-kit: ${name} must be a date that exists on the calendar (not 2026-02-30 or month 13), received ${describe(value)}`,
    )
  }
  // A date-only ISO string is UTC midnight by definition, and the grammar
  // above requires an explicit zone on every timestamp, so nothing here is
  // read in local time.
  return Date.parse(value)
}

/**
 * A caller-supplied value as sentence text: strings are escaped (see
 * `escapeText`), everything else is described without calling into it.
 */
export function text(value: unknown): string {
  return typeof value === 'string' ? escapeText(value) : describe(value)
}

/** Like `text`, but a string that shows nothing reads `(blank)` instead of vanishing. */
export function label(value: unknown): string {
  if (typeof value !== 'string') return describe(value)
  return isBlank(value) ? '(blank)' : escapeText(value)
}

/** `1 observation`, `3 observations`. */
export function plural(count: unknown, noun: string): string {
  return `${text(count)} ${noun}${count === 1 ? '' : 's'}`
}
