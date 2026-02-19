/**
 * Result type for fallible operations.
 *
 * Simple discriminated union -- no monadic methods.
 * Use pattern matching: if (result.ok) { result.value } else { result.error }
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Construct a success result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Construct an error result. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
