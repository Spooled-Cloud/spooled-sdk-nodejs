# Transport

- REST base default `https://api.spooled.cloud`; timeout 30s; HTTP retry maxRetries 3 (`src/config.ts`).
- Auth: `Authorization: Bearer` (`src/utils/http.ts`); admin `X-Admin-Key`.
- gRPC: `grpc.spooled.cloud:443`, metadata `x-api-key` (`src/grpc/client.ts`).
- Proto loader `defaults: true` (`src/grpc/loader.ts`) — unset ints may wire as `0` (backend maps to 3/300 since 0.1.106).
