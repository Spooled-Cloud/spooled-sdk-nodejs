/**
 * Integers above 2^53 in user JSON must survive decoding as decimal strings.
 * A plain JSON.parse turns 1234567890123456789 into 1234567890123456768.
 */

import { describe, it, expect } from "vitest";
import { parseApiJson } from "../../src/utils/json.js";

const BIG = "1234567890123456789";
const ROUNDED = JSON.parse(BIG) as number;

describe("parseApiJson", () => {
  it("keeps integers above 2^53 exact inside user JSON and leaves other numbers alone", () => {
    const parsed = parseApiJson(`{
      "retry_count": 1,
      "sequence": ${BIG},
      "payload": {
        "discord_id": ${BIG},
        "job_type": "send_email",
        "count": 42,
        "edge": 9007199254740992,
        "over": 9007199254740993,
        "under": 9007199254740991,
        "neg": -${BIG},
        "neg_edge": -9007199254740992,
        "ratio": 1.5,
        "sci": 1e21,
        "note": "id ${BIG}",
        "ids": [${BIG}, 7],
        "nested": {"id": ${BIG}},
        "flag": true,
        "empty": null
      },
      "result": {"snowflake": ${BIG}},
      "tags": [${BIG}],
      "metadata": {"id": ${BIG}},
      "payload_template": {"id": ${BIG}},
      "custom_limits": {"id": ${BIG}},
      "details": {"id": ${BIG}},
      "settings": {"id": ${BIG}},
      "extra": {"id": ${BIG}}
    }`) as Record<string, unknown>;

    expect(parsed.retry_count).toBe(1);
    expect(parsed.sequence).toBe(ROUNDED);
    expect(parsed.payload).toEqual({
      discord_id: BIG,
      job_type: "send_email",
      count: 42,
      edge: 9007199254740992,
      over: "9007199254740993",
      under: 9007199254740991,
      neg: `-${BIG}`,
      neg_edge: -9007199254740992,
      ratio: 1.5,
      sci: 1e21,
      note: `id ${BIG}`,
      ids: [BIG, 7],
      nested: { id: BIG },
      flag: true,
      empty: null,
    });
    expect(parsed.result).toEqual({ snowflake: BIG });
    expect(parsed.tags).toEqual([BIG]);
    expect(parsed.metadata).toEqual({ id: BIG });
    expect(parsed.payload_template).toEqual({ id: BIG });
    expect(parsed.custom_limits).toEqual({ id: BIG });
    expect(parsed.details).toEqual({ id: BIG });
    expect(parsed.settings).toEqual({ id: BIG });
    expect(parsed.extra).toEqual({ id: BIG });
    expect(typeof (parsed.payload as { sci: unknown }).sci).toBe("number");
  });

  it("keeps a user-JSON value that is itself an oversized integer", () => {
    expect(parseApiJson(`{"payload":${BIG}}`)).toEqual({ payload: BIG });
    expect(parseApiJson(`{"result":[${BIG}]}`)).toEqual({ result: [BIG] });
  });

  it("does not rewrite a number that is only text, or a key written with escapes", () => {
    expect(
      parseApiJson(`{"payload":{"note":"say \\"${BIG}\\"","n":1},"plain":"x"}`),
    ).toEqual({
      payload: { note: `say "${BIG}"`, n: 1 },
      plain: "x",
    });

    expect(parseApiJson(`{"\\u0070ayload":{"id":${BIG}}}`)).toEqual({
      payload: { id: BIG },
    });
  });

  it("leaves a fractional form of a large integer as a number", () => {
    const parsed = parseApiJson(`{"payload":{"n":${BIG}.0}}`) as {
      payload: { n: unknown };
    };
    expect(typeof parsed.payload.n).toBe("number");
  });

  it("still throws SyntaxError on malformed JSON", () => {
    expect(() => parseApiJson(`{"payload":`)).toThrow(SyntaxError);
  });
});
