#!/usr/bin/env node
// Count the same catalogue wherever it is published, and say which source disagrees.
//
//   node scripts/drift_check.mjs [--owner arm-pz] [--site https://skills.caffeinity.com]
//                                [--marketplace caffeinity-skills] [--offline]
//
// Ground truth is a repo that ships a SKILL.md, not a repo whose description mentions one.
// Everything else is a claim about that catalogue: the marketplace manifest, the site index,
// the site homepage, and the README lists. A source that could not be read is reported as
// inconclusive rather than as empty.

const args = process.argv.slice(2);
const arg = (flag, dflt) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : dflt; };
const OWNER = arg("--owner", "arm-pz");
const SITE = arg("--site", "https://skills.caffeinity.com").replace(/\/+$/, "");
const MARKETPLACE = arg("--marketplace", "caffeinity-skills");
const OFFLINE = args.includes("--offline");

const get = async (url, opts = {}) => {
  if (OFFLINE) return { ok: false, status: 0, url, body: "", why: "offline mode" };
  try {
    const res = await fetch(url, { redirect: "follow", ...opts });
    const body = res.ok ? await res.text() : "";
    return { ok: res.ok, status: res.status, url, body, why: res.ok ? "" : `HTTP ${res.status}` };
  } catch (err) { return { ok: false, status: 0, url, body: "", why: err.message }; }
};

const sortSet = (s) => [...s].sort();
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function defaultBranch(repo) {
  const r = await get(`https://api.github.com/repos/${OWNER}/${repo}`);
  if (!r.ok) return null;
  try { return JSON.parse(r.body).default_branch || null; } catch { return null; }
}

async function listOwnedRepos() {
  const r = await get(`https://api.github.com/users/${OWNER}/repos?per_page=100`);
  if (!r.ok) return { ok: false, why: r.why };
  const repos = JSON.parse(r.body).filter((x) => !x.fork);
  return { ok: true, repos };
}

// A skill ships SKILL.md at the repo root or at skills/<name>/SKILL.md.
async function hasSkillMd(repo, branch) {
  const raw = `https://raw.githubusercontent.com/${OWNER}/${repo}/${branch}`;
  for (const p of ["/SKILL.md", `/skills/${repo}/SKILL.md`]) {
    const r = await get(`${raw}${p}`, { method: "HEAD" });
    if (r.ok) return { found: true, at: p };
  }
  return { found: false };
}

function namesFromSiteIndex(body) {
  try {
    const j = JSON.parse(body);
    const arr = Array.isArray(j) ? j : (j.skills || j.entries || j.items || []);
    return { ok: true, names: arr.map((x) => norm(x.name || x.skill || x.slug || x.id)).filter(Boolean) };
  } catch (err) { return { ok: false, why: `index.json unparseable: ${err.message}` }; }
}

function namesFromHomepage(body) {
  const hrefs = [...body.matchAll(/href="\/?([a-z0-9][a-z0-9-]*)\/?"/gi)].map((m) => norm(m[1]));
  const anchors = [...body.matchAll(/href="#([a-z0-9][a-z0-9-]*)"/gi)].map((m) => norm(m[1]));
  const skip = new Set(["", "agent-skills", "index", "fonts", "css", "js", "assets"]);
  // A hub that links to per-skill pages uses #anchors for its own sections (#career, #ship-checks),
  // so anchors only name skills on a single-page hub with no page links.
  const pages = hrefs.filter((n) => n && !skip.has(n));
  const names = pages.length ? pages : anchors.filter((n) => n && !skip.has(n));
  return { ok: true, names: sortSet(new Set(names)) };
}

// READMEs list skills by name; match against ground truth rather than guessing at structure.
function namesFromReadme(body, universe) {
  const text = body.toLowerCase();
  const found = [...universe].filter((n) => new RegExp(`(^|[^a-z0-9-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9-]|$)`, "i").test(text));
  const rows = body.split("\n").filter((l) => /^\|\s*\[?\*?\*?[a-z0-9-]/.test(l) && !/^\|\s*-+/.test(l) && !/\bSkill\b.*What it does/.test(l)).length;
  return { ok: true, names: sortSet(new Set(found)), tableRows: rows };
}

function report(label, source, truth) {
  if (!source || source.ok === false) {
    console.log(`${label.padEnd(28)} INCONCLUSIVE  ${source ? source.why : "unreadable"} (not counted as empty)`);
    return;
  }
  const names = source.names || [];
  if (truth === null) {
    console.log(`${label.padEnd(28)} ${String(names.length).padStart(3)}   ${names.join(", ")}`);
    return;
  }
  const missing = sortSet(new Set(truth.filter((t) => !names.includes(t))));
  const extra = sortSet(new Set(names.filter((n) => !truth.includes(n))));
  console.log(
    `${label.padEnd(28)} ${String(names.length).padStart(3)}   ` +
    (missing.length ? `absent: ${missing.join(", ")}   ` : "absent: none   ") +
    (extra.length ? `not in ground truth: ${extra.join(", ")}` : "")
  );
  if (source.tableRows !== undefined) console.log(`${" ".repeat(28)} (${source.tableRows} markdown table rows counted) `);
}

const owned = await listOwnedRepos();
if (!owned.ok) console.error(`ground truth unavailable (${OWNER} repos: ${owned.why}) - listing counts are still reported, drift is not`);

const truth = [];
const noSkill = [];
for (const repo of (owned.ok ? owned.repos : [])) {
  const branch = repo.default_branch || (await defaultBranch(repo.name)) || "main";
  const probe = await hasSkillMd(repo.name, branch);
  if (probe.found) truth.push(norm(repo.name)); else noSkill.push(norm(repo.name));
}
const base = owned.ok ? truth : null;

if (owned.ok) {
  console.log(`owner ${OWNER} | ${owned.repos.length} owned repos | ${truth.length} ship a SKILL.md\n`);
  console.log(`ground truth (${truth.length}): ${truth.join(", ")}\n`);
}

const mk = await get(`https://raw.githubusercontent.com/${OWNER}/${MARKETPLACE}/main/.claude-plugin/marketplace.json`);
const mkNames = mk.ok ? (() => { try { return { ok: true, names: JSON.parse(mk.body).plugins.map((p) => norm(p.name)) }; } catch (e) { return { ok: false, why: `marketplace.json unparseable: ${e.message}` }; } })()
                     : { ok: false, why: mk.why };
report("marketplace.json", mkNames, base);

const idx = await get(`${SITE}/agent-skills/index.json`);
report("site index.json", idx.ok ? namesFromSiteIndex(idx.body) : { ok: false, why: idx.why }, base);

const home = await get(`${SITE}/`);
const homeNames = home.ok ? namesFromHomepage(home.body) : { ok: false, why: home.why };
report("site homepage", homeNames, base);

if (idx.ok && home.ok) {
  const a = new Set(namesFromSiteIndex(idx.body).names), b = new Set(homeNames.names);
  const onlyIndex = sortSet([...a].filter((x) => !b.has(x)));
  const onlyHome = sortSet([...b].filter((x) => !a.has(x)));
  // Without ground truth there is nothing to filter against; show the raw difference.
  const filterTruth = (l) => base ? base.filter((x) => l.includes(x)) : l;
  console.log(`\nsite internal sync: index.json ${a.size} vs homepage ${b.size}` +
    (onlyIndex.length || onlyHome.length ? ` | index-only: ${filterTruth(onlyIndex).join(", ") || "-"} | homepage-only: ${filterTruth(onlyHome).join(", ") || "-"}` : " | agree"));
}

for (const [label, repo] of [["profile README", OWNER], [`${MARKETPLACE} README`, MARKETPLACE], ["skills-site README", "skills-site"]]) {
  const r = await get(`https://raw.githubusercontent.com/${OWNER}/${repo}/main/README.md`);
  const src = !r.ok ? { ok: false, why: r.why }
    : base === null ? { ok: false, why: "matched against ground truth, which is unavailable" }
    : namesFromReadme(r.body, truth);
  report(label, src, base);
}

if (owned.ok) console.log(`\nnot counted as skills (no SKILL.md at root or skills/<name>/): ${noSkill.join(", ")}`);
console.log("counts above are what each source publishes; ground truth is what actually ships.");
