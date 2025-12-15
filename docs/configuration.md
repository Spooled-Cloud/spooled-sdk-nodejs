# Configuration Guide

This guide covers all configuration options for the Spooled SDK.

## Client Configuration

```typescript
import { SpooledClient } from '@spooled/sdk';

const client = new SpooledClient({
  // === Authentication (required - one of these) ===
  apiKey: 'sk_live_...',           // API key (starts with sk_live_ or sk_test_)
  accessToken: 'jwt_token',         // Or JWT access token
  refreshToken: 'refresh_token',    // Optional: for auto token renewal
  adminKey: 'admin_...',            // Optional: for admin endpoints

  // === API Settings ===
  baseUrl: 'https://api.spooled.cloud',  // API base URL (default)
  grpcAddress: 'grpc.spooled.cloud:443', // gRPC server address (default)
  timeout: 30000,                         // Request timeout in ms (default: 30000)

  // === Retry Configuration ===
  retries: 3,                       // Shorthand for retry.maxRetries
  retryDelay: 1000,                 // Shorthand for retry.baseDelay

  retry: {
    maxRetries: 3,                  // Max retry attempts (default: 3)
    baseDelay: 1000,                // Base delay in ms (default: 1000)
    maxDelay: 30000,                // Max delay cap in ms (default: 30000)
    factor: 2,                      // Exponential backoff factor (default: 2)
    jitter: true,                   // Add randomness to delays (default: true)
    retryOn: (error, attempt) => {  // Custom retry logic
      return error.isRetryable();
    },
  },

  // === Circuit Breaker ===
  circuitBreaker: {
    enabled: true,                  // Enable circuit breaker (default: true)
    failureThreshold: 5,            // Failures to open circuit (default: 5)
    successThreshold: 3,            // Successes to close circuit (default: 3)
    timeout: 30000,                 // Time before retry after open (default: 30000)
  },

  // === Advanced ===
  headers: {                        // Custom headers for all requests
    'X-Custom-Header': 'value',
  },
  fetch: customFetch,               // Custom fetch implementation
  userAgent: 'my-app/1.0.0',        // Custom user agent
  debug: true,                      // Enable debug logging
  autoRefreshToken: true,           // Auto-refresh JWT tokens (default: true)
});
```

## Environment Variables

The SDK reads these environment variables (useful for testing/development):

```bash
# Required
SPOOLED_API_KEY=sk_live_your_api_key

# Optional
SPOOLED_API_URL=https://api.spooled.cloud
SPOOLED_GRPC_ADDRESS=grpc.spooled.cloud:443
SPOOLED_TIMEOUT=30000
SPOOLED_DEBUG=true
```

Example usage:

```typescript
const client = new SpooledClient({
  apiKey: process.env.SPOOLED_API_KEY!,
  baseUrl: process.env.SPOOLED_API_URL,
  debug: process.env.SPOOLED_DEBUG === 'true',
});
```

## Retry Behavior

The SDK uses exponential backoff with jitter for transient failures:

```
delay = min(maxDelay, baseDelay * (factor ^ attempt)) * (1 + random * jitter)
```

| Attempt | Base Delay | With Jitter (approx) |
|---------|------------|----------------------|
| 1       | 1000ms     | 1000-1500ms          |
| 2       | 2000ms     | 2000-3000ms          |
| 3       | 4000ms     | 4000-6000ms          |
| 4       | 8000ms     | 8000-12000ms         |
| 5       | 16000ms    | 16000-24000ms        |

### Retryable Errors

By default, these errors trigger retries:

- Network errors (connection refused, DNS failures)
- Timeout errors
- 429 Too Many Requests (respects `Retry-After` header)
- 5xx Server errors

Non-retryable errors:

- 400 Bad Request
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found
- 409 Conflict

### Custom Retry Logic

```typescript
const client = new SpooledClient({
  apiKey: 'sk_live_...',
  retry: {
    maxRetries: 5,
    retryOn: (error, attempt) => {
      // Don't retry validation errors
      if (error.code === 'VALIDATION_ERROR') {
        return false;
      }
      // Retry everything else up to 5 times
      return attempt < 5;
    },
  },
});
```

## Circuit Breaker

The circuit breaker prevents cascading failures by temporarily blocking requests after repeated failures.

### States

```
CLOSED → (failures >= threshold) → OPEN → (timeout expires) → HALF_OPEN
                                                                    ↓
                              CLOSED ← (successes >= threshold) ←──┘
                                                                    ↓
                              OPEN ← (any failure) ←───────────────┘
```

### Configuration

```typescript
const client = new SpooledClient({
  apiKey: 'sk_live_...',
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,    // Open after 5 consecutive failures
    successThreshold: 3,    // Close after 3 consecutive successes
    timeout: 30000,         // Try again after 30 seconds
  },
});
```

### Handling Circuit Breaker Errors

```typescript
import { CircuitBreakerOpenError } from '@spooled/sdk';

try {
  await client.jobs.create({ ... });
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    console.log('Circuit breaker is open, try again later');
  }
}
```

## Debug Logging

Enable debug mode to see all API requests and responses:

```typescript
const client = new SpooledClient({
  apiKey: 'sk_live_...',
  debug: true,
});
```

Or provide a custom logger:

```typescript
const client = new SpooledClient({
  apiKey: 'sk_live_...',
  debug: (message, meta) => {
    console.log(`[Spooled] ${message}`, meta);
  },
});
```

Example output:

```
[Spooled] POST /api/v1/jobs { body: { queue_name: 'emails', ... } }
[Spooled] Response 201 { job_id: 'job_abc123', created: true }
```

## Custom Fetch Implementation

Useful for testing or special runtime environments:

```typescript
import { SpooledClient } from '@spooled/sdk';

// Mock fetch for testing
const mockFetch = async (url: string, options: RequestInit) => {
  console.log('Fetching:', url);
  return fetch(url, options);
};

const client = new SpooledClient({
  apiKey: 'sk_live_...',
  fetch: mockFetch,
});
```

## Multiple Clients

You can create multiple clients for different environments or API keys:

```typescript
// Production client
const prodClient = new SpooledClient({
  apiKey: 'sk_live_production_key',
});

// Staging client
const stagingClient = new SpooledClient({
  apiKey: 'sk_test_staging_key',
  baseUrl: 'https://staging-api.spooled.cloud',
});

// Admin client
const adminClient = new SpooledClient({
  apiKey: 'sk_live_...',
  adminKey: 'admin_super_secret',
});
```

## Type Exports

Import configuration types for TypeScript:

```typescript
import type {
  SpooledClientConfig,
  RetryConfig,
  CircuitBreakerConfig,
  ResolvedConfig,
} from '@spooled/sdk';

const config: SpooledClientConfig = {
  apiKey: 'sk_live_...',
  timeout: 60000,
};
```

