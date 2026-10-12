/**
 * Protobuf wire contract tests: lease fencing fields, `optional` presence
 * fields that must match the backend proto, and unknown enum values.
 */

import * as protoLoader from "@grpc/proto-loader";
import type { MessageTypeDefinition } from "@grpc/proto-loader";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTO_LOADER_OPTIONS } from "../../src/grpc/loader.js";
import { encodeFailRequest } from "../../src/grpc/encode.js";
import type { GrpcRegisterWorkerRequest } from "../../src/grpc/types.js";

type MessageDefinition = MessageTypeDefinition<
  Record<string, unknown>,
  Record<string, unknown>
>;

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

describe("gRPC proto drift: FailRequest.retry presence (proto field 4)", () => {
  const type = message("FailRequest");
  const base = { jobId: "job_1", workerId: "worker_1", error: "boom" };
  // Field 4, wire type 0 (varint): tag byte 0x20.
  const RETRY_FALSE = Buffer.from([0x20, 0x00]);
  const RETRY_TRUE = Buffer.from([0x20, 0x01]);

  it("puts an explicit retry=false on the wire, so the server dead-letters", () => {
    const wire = type.serialize(
      encodeFailRequest({ ...base, leaseId: "lease_1", retry: false }),
    );
    expect(wire.includes(RETRY_FALSE)).toBe(true);
    const decoded = type.deserialize(wire);
    expect(decoded.retry).toBe(false);
    // `optional bool retry = 4` gives the field presence: the receiver can
    // tell "false" from "not sent".
    expect(decoded._retry).toBe("retry");
  });

  it("sends retry=true by default, which every server version reads as retry", () => {
    const wire = type.serialize(encodeFailRequest({ ...base, leaseId: "l" }));
    expect(wire.includes(RETRY_TRUE)).toBe(true);
    expect(wire.includes(RETRY_FALSE)).toBe(false);
  });

  it("decodes a FailRequest without field 4 as not set rather than false", () => {
    const decoded = type.deserialize(type.serialize({ ...base, leaseId: "l" }));
    expect(Object.prototype.hasOwnProperty.call(decoded, "retry")).toBe(false);
    expect(decoded._retry).toBeUndefined();
  });
});

describe("gRPC proto drift: RegisterWorkerRequest.worker_id (proto field 7)", () => {
  const type = message("RegisterWorkerRequest");
  const request: GrpcRegisterWorkerRequest = {
    queueName: "emails",
    hostname: "host-1",
    workerId: "emails-worker-01",
  };

  it("serializes workerId at field 7", () => {
    const wire = type.serialize(request as unknown as Record<string, unknown>);
    // Field 7, wire type 2 (length-delimited): tag byte 0x3a.
    const id = Buffer.from(request.workerId!, "utf8");
    const expected = Buffer.concat([Buffer.from([0x3a, id.length]), id]);
    expect(wire.includes(expected)).toBe(true);
    expect(type.deserialize(wire).workerId).toBe("emails-worker-01");
  });

  it("leaves field 7 off when no workerId is given", () => {
    const wire = type.serialize({ queueName: "emails", hostname: "host-1" });
    expect(wire.includes(Buffer.from([0x3a]))).toBe(false);
  });
});

describe("gRPC forward compatibility (unknown enum values)", () => {
  it("decodes a Job status number this SDK's proto does not know", () => {
    const type = message("Job");
    // Field 1 (id) = "j", field 4 (status) = 42.
    const wire = Buffer.from([0x0a, 0x01, 0x6a, 0x20, 42]);
    const decoded = type.deserialize(wire);
    expect(decoded.id).toBe("j");
    expect(decoded.status).toBe(42);
  });
});
