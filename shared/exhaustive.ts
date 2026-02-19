/**
 * Compile-time exhaustive check for discriminated unions.
 * Use as the default case in switch statements.
 *
 * If a new variant is added to a union but not handled in the switch,
 * TypeScript will report a type error here at compile time.
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
