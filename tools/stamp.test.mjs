import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStamp } from "./lib/stamp.mjs";

test("numeric Unix-seconds epoch → ISO", () => {
  assert.equal(buildStamp("1700000000"), "2023-11-14T22:13:20.000Z");
});

test("ISO string is accepted (regression: deploy passed repository.updated_at)", () => {
  assert.equal(buildStamp("2026-04-14T23:33:01Z"), "2026-04-14T23:33:01.000Z");
});

test("unparseable value falls back instead of throwing", () => {
  assert.equal(buildStamp("not-a-date"), "build");
});

test("empty/undefined falls back", () => {
  assert.equal(buildStamp(""), "build");
  assert.equal(buildStamp(undefined), "build");
});
