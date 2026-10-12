/**
 * Compile-only type tests for the circuit breaker options.
 *
 * Nothing here runs: `npm run typecheck` compiles this file through
 * `tsconfig.types.json`, so a regression fails the type check. It pins that
 * `isFailure` and `onStateChange` are accepted by `createCircuitBreaker()` and
 * by the client's `circuitBreaker` option, and that the 1.3.0 shapes (a plain
 * `CircuitBreakerConfig`, a `Partial<CircuitBreakerConfig>`) still compile.
 */

import { expectTypeOf } from "vitest";
import {
  CircuitBreaker,
  CircuitState,
  createCircuitBreaker,
  SpooledClient,
} from "../../src/index.js";
import type {
  CircuitBreakerConfig,
  CircuitBreakerOptions,
  CircuitStateChange,
  ResolvedConfig,
  SpooledClientConfig,
} from "../../src/index.js";

// CircuitBreakerOptions is exported and widens CircuitBreakerConfig.
expectTypeOf<CircuitBreakerOptions>().toExtend<CircuitBreakerConfig>();
expectTypeOf<CircuitBreakerConfig>().toExtend<CircuitBreakerOptions>();
// Both callbacks are optional.
expectTypeOf<undefined>().toExtend<CircuitBreakerOptions["isFailure"]>();
expectTypeOf<undefined>().toExtend<CircuitBreakerOptions["onStateChange"]>();
expectTypeOf<
  NonNullable<CircuitBreakerOptions["isFailure"]>
>().parameters.toEqualTypeOf<[Error]>();
expectTypeOf<
  NonNullable<CircuitBreakerOptions["isFailure"]>
>().returns.toEqualTypeOf<boolean>();
expectTypeOf<
  NonNullable<CircuitBreakerOptions["onStateChange"]>
>().parameters.toEqualTypeOf<[CircuitStateChange]>();
expectTypeOf<
  NonNullable<CircuitBreakerOptions["onStateChange"]>
>().returns.toEqualTypeOf<void>();
expectTypeOf<CircuitStateChange["from"]>().toEqualTypeOf<CircuitState>();
expectTypeOf<CircuitStateChange["to"]>().toEqualTypeOf<CircuitState>();
expectTypeOf<CircuitStateChange["timestamp"]>().toEqualTypeOf<Date>();
expectTypeOf<CircuitStateChange["failureCount"]>().toEqualTypeOf<number>();

// createCircuitBreaker() takes the options, and still a plain config.
expectTypeOf(createCircuitBreaker)
  .parameter(0)
  .toEqualTypeOf<CircuitBreakerOptions>();
expectTypeOf(createCircuitBreaker).returns.toEqualTypeOf<CircuitBreaker>();
expectTypeOf<CircuitBreakerConfig>().toExtend<
  Parameters<typeof createCircuitBreaker>[0]
>();
expectTypeOf(CircuitBreaker).constructorParameters.toEqualTypeOf<
  [CircuitBreakerOptions]
>();

export const fromFunction = createCircuitBreaker({
  enabled: true,
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000,
  isFailure: (error) => error.name === "TimeoutError",
  onStateChange: (event) => {
    expectTypeOf(event).toEqualTypeOf<CircuitStateChange>();
    expectTypeOf(event.to).toEqualTypeOf<CircuitState>();
  },
});

// SpooledClientConfig.circuitBreaker accepts them too, in a partial.
expectTypeOf<
  NonNullable<SpooledClientConfig["circuitBreaker"]>
>().toEqualTypeOf<Partial<CircuitBreakerOptions>>();
expectTypeOf<Partial<CircuitBreakerConfig>>().toExtend<
  NonNullable<SpooledClientConfig["circuitBreaker"]>
>();

export const clientConfig: SpooledClientConfig = {
  apiKey: "sp_test_key",
  circuitBreaker: {
    failureThreshold: 10,
    isFailure: (error) => !error.message.includes("expected"),
    onStateChange: ({ from, to }) => {
      expectTypeOf(from).toEqualTypeOf<CircuitState>();
      expectTypeOf(to).toEqualTypeOf<CircuitState>();
    },
  },
};
export const client = new SpooledClient(clientConfig);

// The resolved config carries them, and a 1.3.0 CircuitBreakerConfig still fits.
expectTypeOf<
  ResolvedConfig["circuitBreaker"]
>().toEqualTypeOf<CircuitBreakerOptions>();
expectTypeOf<CircuitBreakerConfig>().toExtend<
  ResolvedConfig["circuitBreaker"]
>();

// Wrong shapes stay errors.
createCircuitBreaker({
  enabled: true,
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000,
  // @ts-expect-error isFailure takes an Error, not a number
  isFailure: (code: number) => code > 499,
});
export const badClientConfig: SpooledClientConfig = {
  apiKey: "sp_test_key",
  circuitBreaker: {
    // @ts-expect-error onStateChange takes a CircuitStateChange, not a string
    onStateChange: (state: string) => state,
  },
};
