# Transport

- REST base default `https://api.spooled.cloud`; timeout 30s; HTTP retry maxRetries 3 (`src/config.ts`).
- Auth: `Authorization: Bearer` (`src/utils/http.ts`); admin `X-Admin-Key`.
- gRPC: `grpc.spooled.cloud:443`, metadata `x-api-key` (`src/grpc/client.ts`). Unary calls inherit the configured client timeout as a gRPC deadline; streaming calls remain opt-in via stream options.
- Proto loader `defaults: true` (`src/grpc/loader.ts`) — encodeEnqueue omits unset ints (1.0.39); backend maps wire 0 → QUEUE*DEFAULT*\* since 0.1.107.

- `getProtoPath` resolves `proto/spooled.proto` from both `dist/` and `src/grpc/` layouts (1.0.39 / NS-04).
