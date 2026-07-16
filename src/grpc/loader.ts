/**
 * Proto Loader Utility
 *
 * Dynamically loads the Spooled proto file for gRPC communication.
 */

/* global __dirname */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { ServiceClientConstructor } from "@grpc/grpc-js";

/** Proto loader options for consistent parsing */
export const PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: false, // Convert snake_case to camelCase
  longs: String, // Represent int64 as strings
  enums: String, // Represent enums as strings
  defaults: true, // Include default values
  oneofs: true, // Support oneofs
};

export interface SpooledProtoDefinition {
  spooled: {
    v1: {
      QueueService: ServiceClientConstructor;
      WorkerService: ServiceClientConstructor;
    };
  };
}

let cachedDefinition: SpooledProtoDefinition | null = null;

/**
 * Resolve the directory that contains this module (ESM or CJS).
 */
function getModuleDir(): string {
  if (typeof import.meta?.url !== "undefined") {
    return dirname(fileURLToPath(import.meta.url));
  }
  return __dirname;
}

/**
 * Get the path to the proto file.
 *
 * tsup bundles `src/grpc/loader.ts` into `dist/index.js`, so a single
 * `../../proto` relative path (correct from `src/grpc/`) resolves one level
 * above the package root from `dist/` and breaks gRPC client construction.
 * Try both layouts (plus package-root fallbacks) and pick the first hit.
 */
export function getProtoPath(): string {
  const moduleDir = getModuleDir();
  const candidates = [
    // Bundled ESM/CJS: dist/index.js → ../proto/spooled.proto
    join(moduleDir, "../proto/spooled.proto"),
    // Source / unbundled: src/grpc/loader.ts → ../../proto/spooled.proto
    join(moduleDir, "../../proto/spooled.proto"),
    // Extra safety if moduleDir is package root
    join(moduleDir, "proto/spooled.proto"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Spooled gRPC proto not found. Tried: ${candidates.join(", ")}. ` +
      `Ensure the package's proto/spooled.proto is installed next to dist/.`,
  );
}

/**
 * Load the Spooled proto definition synchronously.
 * Caches the result for subsequent calls.
 */
export function loadProtoDefinition(): SpooledProtoDefinition {
  if (cachedDefinition) {
    return cachedDefinition;
  }

  const protoPath = getProtoPath();

  const packageDefinition = protoLoader.loadSync(
    protoPath,
    PROTO_LOADER_OPTIONS,
  );
  const grpcObject = grpc.loadPackageDefinition(packageDefinition);

  cachedDefinition = grpcObject as unknown as SpooledProtoDefinition;
  return cachedDefinition;
}

/**
 * Load the Spooled proto definition asynchronously.
 */
export async function loadProtoDefinitionAsync(): Promise<SpooledProtoDefinition> {
  if (cachedDefinition) {
    return cachedDefinition;
  }

  const protoPath = getProtoPath();

  const packageDefinition = await protoLoader.load(
    protoPath,
    PROTO_LOADER_OPTIONS,
  );
  const grpcObject = grpc.loadPackageDefinition(packageDefinition);

  cachedDefinition = grpcObject as unknown as SpooledProtoDefinition;
  return cachedDefinition;
}

/**
 * Clear the cached proto definition (mainly for testing).
 */
export function clearProtoCache(): void {
  cachedDefinition = null;
}
