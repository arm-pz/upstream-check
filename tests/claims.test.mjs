import { test } from "node:test";
import assert from "node:assert/strict";
import { statedCounts, judgeCounts, retiredMentions } from "../scripts/claims.mjs";

const ref = { skills: 52, mods: 7 };

test("a headline with mods is read whole and agrees", () => {
  const c = statedCounts("<h1>52 skills and 7 mods · 11 workflows</h1>");
  assert.deepEqual(c.map(({ skills, mods }) => [skills, mods]), [[52, 7]]);
  assert.deepEqual(judgeCounts(c, ref), []);
});

test("mods counted as skills is named as that slip (llms.txt said 59)", () => {
  const [f] = judgeCounts(statedCounts("> Open agent skills: 59 skills mapped into 11 workflows."), ref);
  assert.match(f.why, /skills \+ mods counted as skills/);
});

test("a stale README number is a finding", () => {
  const f = judgeCounts(statedCounts("Agent skills, by A:\n44 skills for writing"), ref);
  assert.equal(f.length, 1);
  assert.equal(f[0].at, "44 skills");
});

test("dated run counts are context, not findings", () => {
  const c = statedCounts("<p>Shown working on the 42 skills in this catalogue.</p><p>regress.py × 44 skills</p>");
  assert.ok(c.every((x) => x.dated));
  assert.deepEqual(judgeCounts(c, ref), []);
});

test("a retired host is named wherever it still appears", () => {
  assert.deepEqual(retiredMentions("Browse at https://skills.caffeinity.com/", ["skills.caffeinity.com"]), ["skills.caffeinity.com"]);
  assert.deepEqual(retiredMentions("Browse at https://skillsmith.tech/", ["skills.caffeinity.com"]), []);
});
