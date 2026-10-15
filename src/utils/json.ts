/**
 * JSON parsing for API responses.
 *
 * `JSON.parse` (and `response.json()`) turns every number into a float64, so
 * an integer above 2^53 is silently changed: 1234567890123456789 arrives as
 * 1234567890123456768. User-owned JSON (payload, result, tags, and the other
 * {@link SKIP_CONVERSION_KEYS}) keeps those integers as decimal strings, which
 * are already a {@link JsonValue}. Numbers a float64 holds exactly, including
 * 2^53 itself, stay numbers. Typed counters outside those blobs are left
 * alone, so a field declared as `number` does not change type.
 */

import { SKIP_CONVERSION_KEYS } from "./casing.js";

/** 2^53. Every integer with a smaller magnitude is exactly a float64. */
const TWO_POW_53 = "9007199254740992";

/**
 * Parse an API JSON body, preserving integers above 2^53 inside user JSON.
 * Throws `SyntaxError` on malformed JSON, as `JSON.parse` does.
 */
export function parseApiJson(text: string): unknown {
  return JSON.parse(preserveExactIntegers(text));
}

function magnitudeExceedsTwoPow53(digits: string): boolean {
  let start = 0;
  while (start < digits.length - 1 && digits.charCodeAt(start) === 48) {
    start++;
  }
  const len = digits.length - start;
  if (len !== TWO_POW_53.length) {
    return len > TWO_POW_53.length;
  }
  for (let i = 0; i < len; i++) {
    const digit = digits.charCodeAt(start + i);
    const limit = TWO_POW_53.charCodeAt(i);
    if (digit !== limit) {
      return digit > limit;
    }
  }
  // Equal to 2^53, which float64 represents exactly.
  return false;
}

interface Frame {
  kind: "object" | "array";
  /** This container is itself inside a user-JSON value. */
  exact: boolean;
  expect: "key" | "colon" | "value" | "after";
  /** The object key just read names a user-JSON blob. */
  keyIsExact: boolean;
}

/** True when the value about to be read must keep oversized integers. */
function inExactValue(frames: Frame[]): boolean {
  const top = frames[frames.length - 1];
  if (!top || top.expect !== "value") {
    return false;
  }
  return top.exact || top.keyIsExact;
}

/**
 * Rewrite integer literals above 2^53 that sit inside user JSON so that a
 * following `JSON.parse` cannot round them. Everything else is copied through.
 * The rewrite has to happen on the text: a reviver already receives the
 * rounded number.
 */
function preserveExactIntegers(text: string): string {
  const out: string[] = [];
  const frames: Frame[] = [];
  const n = text.length;
  let i = 0;

  const valueEnded = (): void => {
    const top = frames[frames.length - 1];
    if (top) {
      top.expect = "after";
    }
  };

  while (i < n) {
    const c = text[i];

    if (c === " " || c === "\n" || c === "\r" || c === "\t") {
      out.push(c);
      i++;
      continue;
    }

    if (c === "{") {
      frames.push({
        kind: "object",
        exact: inExactValue(frames),
        expect: "key",
        keyIsExact: false,
      });
      out.push(c);
      i++;
      continue;
    }

    if (c === "[") {
      frames.push({
        kind: "array",
        exact: inExactValue(frames),
        expect: "value",
        keyIsExact: false,
      });
      out.push(c);
      i++;
      continue;
    }

    if (c === "}" || c === "]") {
      frames.pop();
      out.push(c);
      i++;
      valueEnded();
      continue;
    }

    if (c === ":") {
      const top = frames[frames.length - 1];
      if (top && top.kind === "object") {
        top.expect = "value";
      }
      out.push(c);
      i++;
      continue;
    }

    if (c === ",") {
      const top = frames[frames.length - 1];
      if (top) {
        top.expect = top.kind === "object" ? "key" : "value";
        top.keyIsExact = false;
      }
      out.push(c);
      i++;
      continue;
    }

    if (c === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (text[i] === "\\") {
          i++;
          if (i < n) i++;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      const raw = text.slice(start, i);
      const top = frames[frames.length - 1];
      if (top && top.kind === "object" && top.expect === "key") {
        let key = "";
        try {
          key = JSON.parse(raw) as string;
        } catch {
          key = "";
        }
        top.keyIsExact =
          typeof key === "string" && SKIP_CONVERSION_KEYS.has(key);
        top.expect = "colon";
      } else {
        valueEnded();
      }
      out.push(raw);
      continue;
    }

    if (c === "-" || (c >= "0" && c <= "9")) {
      const start = i;
      if (text[i] === "-") i++;
      const digitsAt = i;
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
      const digitsEnd = i;
      let isInteger = true;
      if (i < n && text[i] === ".") {
        isInteger = false;
        i++;
        while (i < n && text[i] >= "0" && text[i] <= "9") i++;
      }
      if (i < n && (text[i] === "e" || text[i] === "E")) {
        isInteger = false;
        i++;
        if (i < n && (text[i] === "+" || text[i] === "-")) i++;
        while (i < n && text[i] >= "0" && text[i] <= "9") i++;
      }
      const raw = text.slice(start, i);
      const digits = text.slice(digitsAt, digitsEnd);
      if (
        isInteger &&
        digits.length > 0 &&
        inExactValue(frames) &&
        magnitudeExceedsTwoPow53(digits)
      ) {
        out.push(`"${raw}"`);
      } else {
        out.push(raw);
      }
      valueEnded();
      continue;
    }

    if (c >= "a" && c <= "z") {
      const start = i;
      while (i < n && text[i] >= "a" && text[i] <= "z") i++;
      out.push(text.slice(start, i));
      valueEnded();
      continue;
    }

    out.push(c);
    i++;
  }

  return out.join("");
}
