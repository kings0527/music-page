import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheMetadataMatches,
  parseByteRange,
} from "../cache-logic.js";

test("cached audio range requests resolve bounded and suffix ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-79", 100), { start: 0, end: 79 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseByteRange("bytes=100-120", 100), null);
  assert.equal(parseByteRange("bytes=0-1,4-5", 100), null);
});

test("cache identity requires both the expected bytes and digest", () => {
  const expected = { bytes: 4886135, sha256: "abc123" };
  assert.equal(
    cacheMetadataMatches(expected, {
      bytes: "4886135",
      sha256: "abc123",
    }),
    true,
  );
  assert.equal(
    cacheMetadataMatches(expected, { bytes: "10", sha256: "abc123" }),
    false,
  );
});
