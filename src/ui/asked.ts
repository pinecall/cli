/** Hand-written body validators; the CLI ships no schema library (test/the-imports.test.ts). */

import { Refusal } from "./refusal.js";

/** Require a JSON object body. */
export function anObject(asked: unknown, what: string): Record<string, unknown> {
  if (typeof asked !== "object" || asked === null || Array.isArray(asked)) {
    throw new Refusal(422, `${what} is asked for with a JSON object`);
  }
  return asked as Record<string, unknown>;
}

/** Require a non-empty string field. */
export function aString(given: Record<string, unknown>, name: string): string {
  const value = given[name];
  if (typeof value !== "string" || value === "") throw new Refusal(422, `${name} is a name, and it was missing`);
  return value;
}

/** Optional string field; empty counts as absent. */
export function someWords(given: Record<string, unknown>, name: string): string | undefined {
  const value = given[name];
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Refusal(422, `${name} is words`);
  return value;
}

/** Optional boolean field, false when absent. */
export function aFlag(given: Record<string, unknown>, name: string): boolean {
  const value = given[name];
  if (value !== undefined && typeof value !== "boolean") throw new Refusal(422, `${name} is true or false`);
  return value === true;
}

/** Require a finite number within `[least, most]`. */
export function aNumber(given: Record<string, unknown>, name: string, least: number, most: number): number {
  const value = given[name];
  if (typeof value !== "number" || !Number.isFinite(value) || value < least || value > most) {
    throw new Refusal(422, `${name} is a number between ${least} and ${most}`);
  }
  return value;
}

/** Optional variant of `aNumber`. */
export function maybeNumber(
  given: Record<string, unknown>,
  name: string,
  least: number,
  most: number,
): number | undefined {
  return given[name] === undefined ? undefined : aNumber(given, name, least, most);
}

/** Require a non-empty array of strings. */
export function names(given: Record<string, unknown>, name: string): string[] {
  const value = given[name];
  if (!Array.isArray(value) || value.length === 0 || !value.every((one) => typeof one === "string")) {
    throw new Refusal(422, `${name} is a list of at least one name`);
  }
  return value as string[];
}
