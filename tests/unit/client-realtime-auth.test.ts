/**
 * The realtime JWT must not replace the REST bearer (SDKNP-02).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SpooledClient } from "../../src/client.js";

const BASE = "https://api.spooled.cloud/api/v1";
const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

function makeJwt(expSeconds: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ exp: expSeconds })}.sig`;
}

describe("client.realtime() and the REST bearer", () => {
  it("keeps REST calls on the API key after realtime() mints a JWT", async () => {
    const jwt = makeJwt(Math.floor(Date.now() / 1000) + 24 * 3600);
    const loginAuth: Array<string | null> = [];
    const restAuth: Array<string | null> = [];
    server.use(
      http.post(`${BASE}/auth/login`, ({ request }) => {
        loginAuth.push(request.headers.get("Authorization"));
        return HttpResponse.json({
          access_token: jwt,
          refresh_token: "refresh_1",
          token_type: "Bearer",
          expires_in: 24 * 3600,
          refresh_expires_in: 7 * 24 * 3600,
        });
      }),
      http.get(`${BASE}/queues`, ({ request }) => {
        restAuth.push(request.headers.get("Authorization"));
        return HttpResponse.json([]);
      }),
    );

    const client = new SpooledClient({ apiKey: "sk_test_123" });
    await client.queues.list();

    const realtime = await client.realtime({ type: "sse" });
    await client.queues.list();

    // A forced re-mint (e.g. after a 401 on the socket) must not leak either.
    await (client as any).getJwtToken(true);
    await client.queues.list();

    expect(loginAuth.length).toBeGreaterThanOrEqual(2);
    expect(restAuth).toEqual([
      "Bearer sk_test_123",
      "Bearer sk_test_123",
      "Bearer sk_test_123",
    ]);
    // The realtime transport got the JWT as its own token.
    expect((realtime as any).client.options.token).toBe(jwt);
  });

  it("does not turn the login's refresh token into the client's refresh token", async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json({
          access_token: makeJwt(Math.floor(Date.now() / 1000) + 3600),
          refresh_token: "refresh_from_realtime_login",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_expires_in: 7200,
        }),
      ),
    );

    const client = new SpooledClient({ apiKey: "sk_test_123" });
    await client.realtime();

    expect(client.getConfig().refreshToken).toBeUndefined();
  });

  it("keeps the realtime token fresh on its own: a near-expiry JWT is re-minted for the next (re)connect", async () => {
    let logins = 0;
    server.use(
      http.post(`${BASE}/auth/login`, () => {
        logins++;
        // First token has 30 s left (inside the 60 s skew); the second is fresh.
        const exp =
          Math.floor(Date.now() / 1000) + (logins === 1 ? 30 : 24 * 3600);
        return HttpResponse.json({
          access_token: makeJwt(exp),
          refresh_token: "r",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_expires_in: 7200,
        });
      }),
    );

    const client = new SpooledClient({ apiKey: "sk_test_123" });
    const realtime = await client.realtime();
    const options = (realtime as any).client.options;

    const first = options.token as string;
    const second = (await options.tokenProvider()) as string;

    expect(logins).toBe(2);
    expect(second).not.toBe(first);
  });
});
