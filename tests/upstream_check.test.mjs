#!/usr/bin/env node
// Behavioral tests for upstream_check.mjs: build a repo in each git state, assert the verdict
// it gets and whether a push is allowed. Judgement is on verdicts, not on file contents.
//
//   node --test tests/upstream_check.test.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "upstream_check.mjs");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e", GIT_TERMINAL_PROMPT: "0" };
const sh = (cwd, args) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// Make <root>/<name>: a bare "remote", a clone tracking it, in the state the scenario asks for.
function fixture(root, name, state) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  const bare = path.join(root, `${name}.git`);
  if (state === "no-remote") {
    sh(dir, ["init", "-q"]);
    writeFileSync(path.join(dir, "a.txt"), "a\n");
    sh(dir, ["add", "a.txt"]);
    sh(dir, ["commit", "-qm", "seed"]);
    return { dir, bare };
  }
  sh(root, ["init", "--bare", "-q", bare]);
  sh(dir, ["clone", "-q", bare, "."]);
  sh(dir, ["remote", "set-url", "origin", bare]);
  if (state === "no-upstream") { writeFileSync(path.join(dir, "a.txt"), "a\n"); sh(dir, ["add", "a.txt"]); sh(dir, ["commit", "-qm", "seed"]); return { dir, bare }; }

  writeFileSync(path.join(dir, "a.txt"), "a\n");
  sh(dir, ["add", "a.txt"]);
  sh(dir, ["commit", "-qm", "seed"]);
  sh(dir, ["push", "-q", "-u", "origin", "HEAD"]);

  const commit = (msg, body = "x\n") => {
    writeFileSync(path.join(dir, `${msg}.txt`), body);
    sh(dir, ["add", "-A"]);
    sh(dir, ["commit", "-qm", msg]);
  };
  const remoteCommit = (msg) => {
    const other = path.join(root, `${name}-other`);
    sh(root, ["clone", "-q", bare, other]);
    commitIn(other, msg);
  };
  const commitIn = (where, msg) => {
    writeFileSync(path.join(where, `${msg}-r.txt`), "r\n");
    sh(where, ["add", "-A"]); sh(where, ["commit", "-qm", msg]); sh(where, ["push", "-q", "origin", "HEAD"]);
  };

  switch (state) {
    case "ahead": commit("local only"); break;
    case "behind": remoteCommit("remote only"); sh(dir, ["fetch", "-q", "origin"]); break;
    case "diverged": commit("local half"); remoteCommit("remote half"); sh(dir, ["fetch", "-q", "origin"]); break;
    case "ahead-dirty": commit("local only"); writeFileSync(path.join(dir, "loose.txt"), "uncommitted\n"); break;
    case "secret": commit("leaky", 'const creds = { aws: "AKIAABCDEFGHIJKLMNOP" };\n'); break;
    default: break;
  }
  return { dir, bare };
}

function run(root, extra = []) {
  const out = execFileSync(process.execPath, [SCRIPT, "--root", root, "--json", ...extra], { env: ENV, encoding: "utf8", cwd: root });
  return JSON.parse(out).results;
}

const verdict = (rows, name) => {
  const r = rows.find((x) => x.name === name);
  assert.ok(r, `${name} missing from output`);
  return r;
};

const cases = [
  ["level", "level"],
  ["ahead", "push-ready"],
  ["behind", "behind"],
  ["diverged", "diverged"],
  ["no-upstream", "no-upstream"],
  ["no-remote", "no-remote"],
];

for (const [state, want] of cases) {
  test(`a repo that is ${state} is classified ${want}`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), `up-${state}-`));
    try {
      fixture(root, state, state);
      const r = verdict(run(root), state);
      assert.equal(r.verdict, want);
      if (want === "push-ready") assert.equal(r.behind, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("an uncommitted file is reported but never blocks or joins the push", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "up-dirty-"));
  try {
    fixture(root, "ahead-dirty", "ahead-dirty");
    const r = verdict(run(root), "ahead-dirty");
    assert.equal(r.verdict, "push-ready");
    assert.equal(r.dirty, 1);
    assert.match(r.notes.join(" "), /uncommitted .*local/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--push fast-forwards an ahead repo and leaves a diverged one alone", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "up-push-"));
  try {
    fixture(root, "ahead", "ahead");
    fixture(root, "diverged", "diverged");
    const rows = run(root, ["--push"]);
    const a = verdict(rows, "ahead"), d = verdict(rows, "diverged");
    assert.equal(a.pushResult.pushed, true);
    assert.equal(sh(path.join(root, "ahead"), ["rev-list", "--count", "@{u}..HEAD"]), "0", "ahead repo is level after push");
    assert.equal(d.pushResult.pushed, false);
    assert.match(d.pushResult.why, /diverged/);
    assert.equal(verdict(run(root), "diverged").ahead, 1, "diverged repo still has its local commit");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a credential in the outgoing diff stops the push", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "up-secret-"));
  try {
    fixture(root, "secret", "secret");
    const r = verdict(run(root), "secret");
    assert.equal(r.verdict, "push-ready");
    assert.ok(r.secretHits.length > 0, "screener found the planted key");
    assert.equal(r.secretHits[0].label, "aws key id");
    const p = verdict(run(root, ["--push"]), "secret");
    assert.equal(p.pushResult.pushed, false);
    assert.match(p.pushResult.why, /credential-shaped/);
    assert.equal(sh(path.join(root, "secret.git"), ["rev-list", "--count", "--all"]).toString(), "1", "nothing reached the remote");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--allow-secret-hits is an explicit override, not a default", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "up-override-"));
  try {
    fixture(root, "secret", "secret");
    assert.equal(verdict(run(root, ["--push"]), "secret").pushResult.pushed, false);
    assert.equal(verdict(run(root, ["--push", "--allow-secret-hits"]), "secret").pushResult.pushed, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--only scopes a push batch and still reports what it left alone", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "up-only-"));
  try {
    fixture(root, "ahead", "ahead");
    fixture(root, "second", "ahead");
    fixture(root, "level", "level");

    const rows = run(root, ["--push", "--only", "ahead"]);
    assert.equal(verdict(rows, "ahead").pushResult.pushed, true);
    const s = verdict(rows, "second");
    assert.equal(s.verdict, "push-ready", "still classified honestly");
    assert.equal(s.pushResult.pushed, false);
    assert.match(s.pushResult.why, /--only scope/);
    assert.equal(sh(path.join(root, "second"), ["rev-list", "--count", "@{u}..HEAD"]), "1", "unasked-for repo keeps its commit local");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a repo whose remote cannot be read is not silently reported as level", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "up-unreadable-"));
  try {
    fixture(root, "level", "level");
    rmSync(path.join(root, "level.git"), { recursive: true, force: true });
    const r = verdict(run(root), "level");
    assert.equal(r.verdict, "level", "fetch failure does not change the verdict");
    assert.match(r.notes.join(" "), /fetch failed|may be stale/, "but it is recorded as possibly stale");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
