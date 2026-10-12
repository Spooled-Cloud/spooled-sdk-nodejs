/**
 * Paging and query helpers shared by the list resources.
 */

/** Response header that says whether another page follows (API 0.1.122+). */
export const HAS_MORE_HEADER = "X-Has-More";

/**
 * Whether another page follows a list response.
 *
 * Reads `X-Has-More` when the server sends it. An older server does not, so
 * a page as long as the limit the server applied counts as "maybe more": the
 * caller asks once more and gets an empty page at the end.
 */
export function hasMoreFromHeaders(
  headers: Headers,
  count: number,
  limit: number | undefined,
  defaultLimit: number,
  maxLimit: number,
): boolean {
  const header = headers.get(HAS_MORE_HEADER);
  if (header !== null) {
    return header.trim().toLowerCase() === "true";
  }
  const applied = Math.min(Math.max(limit ?? defaultLimit, 1), maxLimit);
  return count >= applied;
}

/**
 * A timestamp query parameter: a `Date` becomes an ISO 8601 UTC string
 * (RFC 3339); a string is sent as given.
 */
export function toQueryTimestamp(
  value: Date | string | undefined,
): string | undefined {
  return value instanceof Date ? value.toISOString() : value;
}
