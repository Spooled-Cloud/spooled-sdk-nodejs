/**
 * Proto path resolution — bundled dist/ vs source src/grpc/ layouts.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import {
  getProtoPath,
  clearProtoCache,
  loadProtoDefinition,
} from "../../src/grpc/loader.js";

describe("getProtoPath", () => {
  it("resolves an existing proto/spooled.proto under the package", () => {
    const path = getProtoPath();
    expect(path.endsWith("proto/spooled.proto")).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it("loads the real proto definition without ENOENT", () => {
    clearProtoCache();
    const def = loadProtoDefinition();
    expect(def.spooled.v1.QueueService).toBeTruthy();
    expect(def.spooled.v1.WorkerService).toBeTruthy();
  });
});
