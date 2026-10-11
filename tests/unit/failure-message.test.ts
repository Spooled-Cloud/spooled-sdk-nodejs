/**
 * Failure text coercion: the fail endpoint rejects empty or >2048 char text.
 */

import { describe, it, expect } from "vitest";
import {
  coerceFailureMessage,
  DEFAULT_FAILURE_MESSAGE,
  MAX_FAILURE_MESSAGE_CHARS,
} from "../../src/utils/failure.js";

describe("coerceFailureMessage", () => {
  it("replaces empty text with 'Job failed'", () => {
    expect(coerceFailureMessage("")).toBe(DEFAULT_FAILURE_MESSAGE);
    expect(DEFAULT_FAILURE_MESSAGE).toBe("Job failed");
  });

  it("replaces null/undefined with 'Job failed'", () => {
    expect(coerceFailureMessage(undefined)).toBe("Job failed");
    expect(coerceFailureMessage(null)).toBe("Job failed");
  });

  it("passes ordinary text through unchanged", () => {
    expect(coerceFailureMessage("boom")).toBe("boom");
    const exact = "x".repeat(MAX_FAILURE_MESSAGE_CHARS);
    expect(coerceFailureMessage(exact)).toBe(exact);
  });

  it("truncates text over 2048 characters to exactly 2048", () => {
    const out = coerceFailureMessage("x".repeat(5000));
    expect(out).toHaveLength(MAX_FAILURE_MESSAGE_CHARS);
  });

  it("counts characters, not UTF-16 units, and never splits a surrogate pair", () => {
    // 2000 astral characters = 4000 UTF-16 units but only 2000 characters:
    // within the limit, so it must pass through intact.
    const within = "😀".repeat(2000);
    expect(coerceFailureMessage(within)).toBe(within);

    // 3000 astral characters are cut at 2048 whole characters.
    const out = coerceFailureMessage("😀".repeat(3000));
    expect(Array.from(out)).toHaveLength(MAX_FAILURE_MESSAGE_CHARS);
    expect(out).toBe("😀".repeat(MAX_FAILURE_MESSAGE_CHARS));
    // No lone surrogate left behind.
    expect(out.isWellFormed()).toBe(true);
  });

  it("stringifies non-string input", () => {
    expect(coerceFailureMessage(42)).toBe("42");
  });
});
