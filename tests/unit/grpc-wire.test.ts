/**
 * Protobuf wire contract tests for lease fencing fields.
 */

import * as protoLoader from "@grpc/proto-loader";
import type { MessageTypeDefinition } from "@grpc/proto-loader";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTO_LOADER_OPTIONS } from "../../src/grpc/loader.js";

type MessageDefinition = MessageTypeDefinition<Record<string, unknown>, Record<string, unknown>>;

const definition = protoLoader.loadSync(
  resolve("proto/spooled.proto"),
  PROTO_LOADER_OPTIONS,
);

function message(name: string): MessageDefinition {
  return definition[`spooled.v1.${name}`] as unknown as MessageDefinition;
}

function expectLeaseWire(
  messageName: string,
  request: Record<string, unknown>,
  fieldTag: number,
  leaseId: string,
): void {
  const type = message(messageName);
  const wire = type.serialize(request);
  const decoded = type.deserialize(wire);
  const tag = (fieldTag << 3) | 2;
  const encodedTag =
    tag < 128
      ? Buffer.from([tag])
      : Buffer.from([(tag & 0x7f) | 0x80, tag >> 7]);

  expect(wire.includes(encodedTag)).toBe(true);
  expect(decoded.leaseId).toBe(leaseId);
}

describe("gRPC lease wire contract", () => {
  it("serializes Job.lease_id unchanged at field 19", () => {
    expectLeaseWire(
      "Job",
      { id: "job_1", leaseId: "lease_job" },
      19,
      "lease_job",
    );
  });

  it("serializes CompleteRequest.lease_id unchanged at field 4", () => {
    expectLeaseWire(
      "CompleteRequest",
      { jobId: "job_1", workerId: "worker_1", leaseId: "lease_complete" },
      4,
      "lease_complete",
    );
  });

  it("serializes FailRequest.lease_id unchanged at field 5", () => {
    expectLeaseWire(
      "FailRequest",
      {
        jobId: "job_1",
        workerId: "worker_1",
        error: "boom",
        leaseId: "lease_fail",
      },
      5,
      "lease_fail",
    );
  });

  it("serializes RenewLeaseRequest.lease_id unchanged at field 4", () => {
    expectLeaseWire(
      "RenewLeaseRequest",
      {
        jobId: "job_1",
        workerId: "worker_1",
        extensionSecs: 30,
        leaseId: "lease_renew",
      },
      4,
      "lease_renew",
    );
  });
});
