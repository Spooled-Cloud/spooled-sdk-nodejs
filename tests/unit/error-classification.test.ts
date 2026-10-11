/**
 * HTTP error classification: 422 validation, quota vs rate-limit 429, 408,
 * and the typed "unsupported" error.
 */

import { describe, it, expect } from "vitest";
import {
  RateLimitError,
  SpooledError,
  UnsupportedOperationError,
  ValidationError,
  createErrorFromResponse,
  isRetryableError,
} from "../../src/errors.js";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("422 validation errors", () => {
  it("maps 422 to ValidationError and keeps the status", async () => {
    // A missing/mistyped JSON field is a 422 from the API's extractor.
    const error = await createErrorFromResponse(
      jsonResponse(422, {
        code: "VALIDATION_ERROR",
        message: "queue_name: missing field",
        details: [{ field: "queue_name", message: "missing field" }],
      }),
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("queue_name: missing field");
  });

  it("still maps 400 to ValidationError with status 400", async () => {
    const error = await createErrorFromResponse(
      jsonResponse(400, { code: "BAD_REQUEST", message: "bad" }),
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.statusCode).toBe(400);
  });

  it("is not retryable", async () => {
    const error = await createErrorFromResponse(
      jsonResponse(422, { code: "VALIDATION_ERROR", message: "x" }),
    );
    expect(isRetryableError(error)).toBe(false);
  });
});

describe("429 quota vs rate limit", () => {
  it("treats code QUOTA_EXCEEDED as a quota: not retryable", async () => {
    const error = await createErrorFromResponse(
      jsonResponse(429, {
        error: "limit_exceeded",
        code: "QUOTA_EXCEEDED",
        message: "jobs per day limit reached (1000/1000)",
        resource: "jobs_per_day",
      }),
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).isQuota).toBe(true);
    expect(error.isRetryable()).toBe(false);
    expect(isRetryableError(error)).toBe(false);
  });

  it("treats the legacy plain-text 'Daily job limit reached' (no Retry-After) as a quota", async () => {
    // The API wraps this plain-text 429 as RATE_LIMIT_EXCEEDED.
    const error = await createErrorFromResponse(
      jsonResponse(429, {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Daily job limit reached",
      }),
    );
    expect((error as RateLimitError).isQuota).toBe(true);
    expect(error.isRetryable()).toBe(false);
  });

  it("keeps a per-second rate limit (with Retry-After) retryable", async () => {
    const error = await createErrorFromResponse(
      jsonResponse(
        429,
        {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests, please retry after 3 seconds",
        },
        { "Retry-After": "3" },
      ),
    );
    expect((error as RateLimitError).isQuota).toBe(false);
    expect(error.isRetryable()).toBe(true);
  });

  it("keeps a rate limit without Retry-After and without plan-limit wording retryable", async () => {
    const error = await createErrorFromResponse(
      jsonResponse(429, {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests, please try again later",
      }),
    );
    expect((error as RateLimitError).isQuota).toBe(false);
    expect(error.isRetryable()).toBe(true);
  });

  it("does not call a limit-reached message with Retry-After a quota", async () => {
    const error = await createErrorFromResponse(
      jsonResponse(
        429,
        { code: "RATE_LIMIT_EXCEEDED", message: "Burst limit reached" },
        { "Retry-After": "1" },
      ),
    );
    expect((error as RateLimitError).isQuota).toBe(false);
  });
});

describe("408 Request Timeout", () => {
  it("is retryable (the server never ran the request)", async () => {
    const error = await createErrorFromResponse(
      jsonResponse(408, { code: "REQUEST_TIMEOUT", message: "timeout" }),
    );
    expect(error).toBeInstanceOf(SpooledError);
    expect(error.statusCode).toBe(408);
    expect(isRetryableError(error)).toBe(true);
  });

  it("leaves other plain 4xx statuses non-retryable", async () => {
    for (const status of [402, 405, 410, 418]) {
      const error = await createErrorFromResponse(
        jsonResponse(status, { code: "X", message: "x" }),
      );
      expect(isRetryableError(error)).toBe(false);
    }
  });
});

describe("UnsupportedOperationError", () => {
  it("names the operation, has no HTTP status, and is not retryable", () => {
    const error = new UnsupportedOperationError("ingest.github", "no route");
    expect(error).toBeInstanceOf(SpooledError);
    expect(error.name).toBe("UnsupportedOperationError");
    expect(error.code).toBe("UNSUPPORTED_OPERATION");
    expect(error.statusCode).toBe(0);
    expect(error.operation).toBe("ingest.github");
    expect(error.message).toBe(
      "ingest.github is not supported by the Spooled API: no route",
    );
    expect(error.isRetryable()).toBe(false);
  });
});
