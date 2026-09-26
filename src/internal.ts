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

/** Throw a TypeError with the package prefix. */
export function typeFail(message: string): never {
  throw new TypeError(`advice-ledger-kit: ${message}`)
}

/** Render a received value for an error message: strings quoted, the rest via String(). */
export function shown(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}
