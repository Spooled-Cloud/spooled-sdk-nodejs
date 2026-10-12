/**
 * Package entry points: `@spooled/sdk/package.json` is resolvable through the
 * `exports` map (tools read the installed version that way).
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SDK_VERSION } from "../../src/config.js";

// Resolves "@spooled/sdk/..." through this package's own exports map
// (Node package self-reference), exactly as a consumer's require would.
const require = createRequire(resolve("package.json"));

describe("package exports", () => {
  it("exposes ./package.json", () => {
    const pkg = require("@spooled/sdk/package.json") as {
      name: string;
      version: string;
    };
    expect(pkg.name).toBe("@spooled/sdk");
    expect(pkg.version).toBe(SDK_VERSION);
  });

  it("keeps the existing entry points", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(pkg.exports)).toEqual([
      ".",
      "./worker",
      "./package.json",
    ]);
  });
});
