/**
 * Proto Loader Utility
 *
 * Dynamically loads the Spooled proto file for gRPC communication.
 */

/* global __dirname */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { ServiceClientConstructor } from '@grpc/grpc-js';

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
 * Get the path to the proto file.
 * Supports both ESM and CJS environments.
 */
function getProtoPath(): string {
  // In ESM, use import.meta.url
  if (typeof import.meta?.url !== 'undefined') {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return join(__dirname, '../../proto/spooled.proto');
  }

  // Fallback for CJS (when bundled)
  return join(__dirname, '../../proto/spooled.proto');
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

  const packageDefinition = protoLoader.loadSync(protoPath, PROTO_LOADER_OPTIONS);
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

  const packageDefinition = await protoLoader.load(protoPath, PROTO_LOADER_OPTIONS);
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
