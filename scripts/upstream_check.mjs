#!/usr/bin/env node
// Audit local git clones against their upstream, and push only the clean fast-forwards.
//
//   node scripts/upstream_check.mjs [--root <dir>] [--json] [--no-fetch] [--only a,b] [--push]
//
// Without --push this is read-only: it fetches, classifies every repo, and screens the
// outgoing diff. --push then acts on the push-ready verdicts only. It never forces, never
// uses --no-verify, and never touches a repo that is behind or diverged.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET_PATTERNS = [
  ["github token", /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}/g],
  ["aws key id", /AKIA[0-9A-Z]{16}/g],
  ["private key block", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY/g],
  ["openai-style key", /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g],
  ["slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["assigned credential", /["'`]?(?:secret|token|password|passwd|api[_-]?key|authorization)["'`]?\s*[:=]\s*["'`][^"'`\n]{8,}["'`]/gi],
];

function git(cwd, args) {
  try {
    return { ok: true, out: execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (err) {
    return { ok: false, out: String(err.stdout || "").trim(), err: String(err.stderr || err.message).trim().split("\n")[0] };
  }
}

function resolveRoot(argv) {
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  const preferred = path.join(os.homedir(), "Downloads", "Qoder");
  return existsSync(preferred) ? preferred : process.cwd();
}

function findRepos(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => path.join(root, e.name))
    .filter((p) => existsSync(path.join(p, ".git")))
    .sort();
}

function screenOutgoing(cwd, upstream) {
  const diff = git(cwd, ["diff", `${upstream}..HEAD`]);
  if (!diff.ok) return { screened: false, hits: [] };
  const added = diff.out.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const hits = [];
  for (const [label, re] of SECRET_PATTERNS) {
    re.lastIndex = 0;
    for (const line of added) {
      if (re.test(line)) hits.push({ label, sample: line.slice(1, 120).trim() });
    }
  }
  return { screened: true, addedLines: added.length, hits };
}

function audit(repo, { fetch }) {
  const name = path.basename(repo);
  const r = { name, path: repo, verdict: "", ahead: 0, behind: 0, dirty: 0, notes: [] };
  r.remote = git(repo, ["remote", "get-url", "origin"]).out || null;
  if (!r.remote) { r.verdict = "no-remote"; return r; }
  r.branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  const up = git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!up.ok) { r.verdict = "no-upstream"; r.notes.push("branch has no tracked upstream"); return r; }
  r.upstream = up.out;
  if (fetch) {
    const f = git(repo, ["fetch", "--quiet", "origin"]);
    if (!f.ok) r.notes.push(`fetch failed (${f.err}); remote side may be stale`);
  }
  const counts = git(repo, ["rev-list", "--left-right", "--count", `${r.upstream}...HEAD`]);
  if (!counts.ok) { r.verdict = "unreadable"; r.notes.push(counts.err); return r; }
  const [behind, ahead] = counts.out.split(/\s+/).map(Number);
  r.behind = behind; r.ahead = ahead;
  r.dirty = git(repo, ["status", "--porcelain"]).out.split("\n").filter(Boolean).length;
  if (ahead > 0 && behind === 0) r.verdict = "push-ready";
  else if (ahead === 0 && behind === 0) r.verdict = "level";
  else if (ahead === 0) r.verdict = "behind";
  else r.verdict = "diverged";
  if (r.verdict === "push-ready" && r.dirty) r.notes.push(`${r.dirty} uncommitted paths stay local`);
  if (r.verdict === "push-ready") {
    r.commits = git(repo, ["log", "--oneline", `${r.upstream}..HEAD`]).out.split("\n").filter(Boolean);
    const s = screenOutgoing(repo, r.upstream);
    r.secretHits = s.hits;
    if (!s.screened) r.notes.push("outgoing diff unreadable, not screened");
  }
  return r;
}

function pushOne(r, allowSecretHits) {
  if (r.verdict !== "push-ready") return { name: r.name, pushed: false, why: `verdict is ${r.verdict}` };
  if (r.excluded) return { name: r.name, pushed: false, why: r.excluded };
  if (!r.secretHits) return { name: r.name, pushed: false, why: "not screened" };
  if (r.secretHits.length && !allowSecretHits) {
    return { name: r.name, pushed: false, why: `${r.secretHits.length} credential-shaped line(s): ${r.secretHits[0].label} -> ${r.secretHits[0].sample}` };
  }
  const p = git(r.path, ["push", "origin", r.branch]);
  return p.ok ? { name: r.name, pushed: true, why: `${r.ahead} commit(s) fast-forwarded` }
              : { name: r.name, pushed: false, why: `push rejected: ${p.err}` };
}

const argv = process.argv.slice(2);
const root = resolveRoot(argv);
const asJson = argv.includes("--json");
const doPush = argv.includes("--push");
const allowSecretHits = argv.includes("--allow-secret-hits");
const only = (() => {
  const i = argv.indexOf("--only");
  return i === -1 || !argv[i + 1] ? null : argv[i + 1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
})();
const repos = findRepos(root);
if (!repos.length) { console.error(`no git repos found under ${root}`); process.exit(2); }

const results = repos.map((p) => audit(p, { fetch: !argv.includes("--no-fetch") }));
if (only) for (const r of results) if (!only.includes(r.name.toLowerCase())) r.excluded = "out of --only scope";
if (doPush) for (const r of results) r.pushResult = pushOne(r, allowSecretHits);

if (asJson) { console.log(JSON.stringify({ root, results }, null, 2)); process.exit(0); }

const label = (s) => (s.length > 24 ? `${s.slice(0, 23)}~` : s).padEnd(25);
console.log(`root: ${root}\n`);
console.log("repo                      branch       ahead  behind  dirty  verdict");
for (const r of results) {
  console.log(
    `${label(r.name)}${String(r.branch || "-").padEnd(13)}${String(r.ahead).padStart(5)}  ${String(r.behind).padStart(6)}  ${String(r.dirty).padStart(5)}  ${r.verdict}` +
      (r.pushResult ? ` -> ${r.pushResult.pushed ? "PUSHED" : `not pushed (${r.pushResult.why})`}` : "")
  );
  for (const c of r.commits || []) console.log(`     ${c}`);
  for (const n of r.notes) console.log(`     ! ${n}`);
  for (const h of r.secretHits || []) console.log(`     !! credential-shaped: ${h.label} -> ${h.sample}`);
}
const t = (v) => results.filter((r) => r.verdict === v).length;
console.log(`\n${results.length} repos | push-ready ${t("push-ready")} | level ${t("level")} | behind ${t("behind")} | diverged ${t("diverged")} | no-upstream ${t("no-upstream")} | no-remote ${t("no-remote")} | unreadable ${t("unreadable")}`);
if (!doPush && t("push-ready")) console.log("read-only pass: rerun with --push to fast-forward the push-ready repos above.");
