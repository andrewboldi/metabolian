import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName } from "./ingest/corpus.mjs";
import { cleanSvg } from "./render-molecules.mjs";

// Regression cover for CodeQL js/incomplete-multi-character-sanitization: a
// single-pass strip can splice two fragments back into the dangerous sequence,
// so both sanitizers loop until stable. These lock that invariant.

test("cleanName keeps the wrapped letter and strips formatting tags", () => {
  assert.equal(cleanName("(<i>R</i>)-linalool"), "(R)-linalool");
  assert.equal(cleanName("<small>L</small>-saccharopinate"), "L-saccharopinate");
});

test("cleanName leaves no tag, even under splicing or entity-encoding", () => {
  for (const evil of [
    "<scr<script>ipt>x</script>",
    "<<script>>",
    "<img src=x onerror=alert(1)>",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  ]) {
    const out = cleanName(evil);
    assert.ok(!out.includes("<"), `residual "<" in ${JSON.stringify(out)}`);
  }
});

test("cleanSvg strips comments, including spliced and unterminated ones", () => {
  for (const svg of [
    "<svg><!-- note --></svg>",
    "<svg><!-<!-- -->-></svg>",
    "<svg><!--<!---->--></svg>",
  ]) {
    const out = cleanSvg(svg);
    assert.ok(!out.includes("<!--"), `residual "<!--" in ${JSON.stringify(out)}`);
  }
});
