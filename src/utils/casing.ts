/**
 * Case Conversion Utilities
 *
 * Provides deep conversion between snake_case (API) and camelCase (SDK).
 * User-defined JSON blobs are preserved without conversion.
 */

/**
 * Keys that should NOT have their values deeply converted.
 * These typically contain user-defined JSON that shouldn't be modified.
 */
const SKIP_CONVERSION_KEYS = new Set([
  'payload',
  'result',
  'metadata',
  'tags',
  'settings',
  'details',
  'extra',
  'payloadTemplate',
  'payload_template',
  'customLimits',
  'custom_limits',
]);

/**
 * Check if a value is a plain object (not array, Date, null, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

/**
 * Convert a string from camelCase to snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert a string from snake_case to camelCase
 */
export function snakeToCamel(str: string): string {
  // Handle numeric segments like `completed_24h` -> `completed24h`
  // and then standard `_x` -> `X` conversion.
  return str
    .replace(/_([0-9]+)/g, (_, digits) => digits)
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Deep convert object keys from camelCase to snake_case.
 * Preserves values in SKIP_CONVERSION_KEYS without deep conversion.
 *
 * @param obj - Object to convert
 * @param skipDeepConversion - Whether current context should skip deep conversion of values
 * @returns Object with snake_case keys
 */
export function toSnakeCase<T = unknown>(obj: T, skipDeepConversion = false): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => toSnakeCase(item, skipDeepConversion)) as T;
  }

  if (obj instanceof Date) {
    return obj.toISOString() as T;
  }

  if (!isPlainObject(obj)) {
    return obj;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key);

    // Check if this key's value should skip deep conversion
    const shouldSkip = skipDeepConversion || SKIP_CONVERSION_KEYS.has(key) || SKIP_CONVERSION_KEYS.has(snakeKey);

    if (shouldSkip) {
      // Don't convert the value, just preserve it as-is
      result[snakeKey] = value;
    } else {
      // Recursively convert the value
      result[snakeKey] = toSnakeCase(value, false);
    }
  }

  return result as T;
}

/**
 * Deep convert object keys from snake_case to camelCase.
 * Preserves values in SKIP_CONVERSION_KEYS without deep conversion.
 *
 * @param obj - Object to convert
 * @param skipDeepConversion - Whether current context should skip deep conversion of values
 * @returns Object with camelCase keys
 */
export function toCamelCase<T = unknown>(obj: T, skipDeepConversion = false): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => toCamelCase(item, skipDeepConversion)) as T;
  }

  if (obj instanceof Date) {
    return obj as T;
  }

  if (!isPlainObject(obj)) {
    return obj;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key);

    // Check if this key's value should skip deep conversion
    const shouldSkip = skipDeepConversion || SKIP_CONVERSION_KEYS.has(key) || SKIP_CONVERSION_KEYS.has(camelKey);

    if (shouldSkip) {
      // Don't convert the value, just preserve it as-is
      result[camelKey] = value;
    } else {
      // Recursively convert the value
      result[camelKey] = toCamelCase(value, false);
    }
  }

  return result as T;
}

/**
 * Convert request body from camelCase (SDK) to snake_case (API)
 */
export function convertRequest<T>(body: T): T {
  return toSnakeCase(body);
}

/**
 * Convert response body from snake_case (API) to camelCase (SDK)
 */
export function convertResponse<T>(body: T): T {
  return toCamelCase(body);
}

/**
 * Convert query parameters from camelCase to snake_case.
 * Only converts top-level keys, not nested objects.
 */
export function convertQueryParams(
  params: Record<string, string | number | boolean | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      const snakeKey = camelToSnake(key);
      result[snakeKey] = String(value);
    }
  }

  return result;
}
