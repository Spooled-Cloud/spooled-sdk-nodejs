/**
 * Failure message coercion
 *
 * `POST /jobs/{id}/fail` rejects an empty or over-long `error` with a 400.
 * A worker that reported its failure with such text got nothing recorded: the
 * job stayed `processing` until its lease ran out, then ran again. The text of
 * a failure is therefore always made acceptable before it is sent.
 */

/** Longest error text the API accepts (characters, not bytes). */
export const MAX_FAILURE_MESSAGE_CHARS = 2048;

/** Text sent when a handler failed without saying why. */
export const DEFAULT_FAILURE_MESSAGE = "Job failed";

/**
 * Make `message` acceptable to the fail endpoint: empty becomes
 * {@link DEFAULT_FAILURE_MESSAGE}; text over {@link MAX_FAILURE_MESSAGE_CHARS}
 * is cut to that many characters. The cut is by code point, so an emoji or
 * other astral character is never split into a lone surrogate.
 */
export function coerceFailureMessage(message: unknown): string {
  const text =
    typeof message === "string" ? message : message == null ? "" : `${message}`;
  if (text === "") {
    return DEFAULT_FAILURE_MESSAGE;
  }
  // UTF-16 length is an upper bound of the code point count: skip the
  // allocation for the common short message.
  if (text.length <= MAX_FAILURE_MESSAGE_CHARS) {
    return text;
  }
  const codePoints = Array.from(text);
  return codePoints.length <= MAX_FAILURE_MESSAGE_CHARS
    ? text
    : codePoints.slice(0, MAX_FAILURE_MESSAGE_CHARS).join("");
}
