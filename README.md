# upstream-check

An agent skill that finds local work which never reached its remote, pushes only what is safe to
push, and then checks whether the listings people actually read still agree with the repos.

Plain `git status` compares your branch against a remote-tracking ref that is only as fresh as the
last fetch. That is how a repo sits there with unpushed commits and reports "up to date". This skill
fetches first and classifies honestly.

## Install

```
npx skills add arm-pz/upstream-check --skill upstream-check
```

Or copy the `upstream-check/` folder into `~/.qoder/skills/` (Qoder) or `~/.claude/skills/`
(Claude Code), then start a new session.

## Audit

```bash
node scripts/upstream_check.mjs --root ~/Downloads/Qoder          # read-only
node scripts/upstream_check.mjs --root ~/Downloads/Qoder --json   # for another agent to consume
node scripts/upstream_check.mjs --root ~/Downloads/Qoder --only a,b --push
```

Every repo under `--root` gets one verdict: `push-ready`, `level`, `behind`, `diverged`,
`no-upstream`, `no-remote`, `unreadable`.

`--push` fast-forwards the `push-ready` ones and refuses everything else. It never uses `--force`,
never uses `--no-verify`, and never resolves a divergence by overwriting one side. The outgoing diff
is screened for credential-shaped strings (GitHub, AWS, OpenAI-style, Slack, private-key blocks) and
that repo's push is aborted on a hit; `--allow-secret-hits` is the only override, and it is meant to
be typed deliberately after you have read the line.

A dirty working tree does not block a push — `git push` sends commits, so uncommitted files stay
local and are named as such. The skill never commits someone's loose work to make a count look tidy.

`--only` exists because a machine can have more than one person on it. A repo can be push-ready by
arithmetic while another session is mid-way through it; scope the batch by name.

## Listing drift

```bash
node scripts/drift_check.mjs --owner arm-pz --site https://skills.caffeinity.com
```

Ground truth is every owned repo that ships a `SKILL.md` at the root or at `skills/<repo>/SKILL.md`.
Repo descriptions are not evidence — they drift, and a description can claim a skill the repo does
not contain. Each published source is then measured against that truth: the machine-readable site
index, the site homepage, the plugin marketplace manifest and the named READMEs, each reported as
*absent* (a real repo the source omits) or *not in ground truth* (a name no repo ships — sometimes
legitimate, when a plugin id differs from its repo).

A source that could not be read is reported **INCONCLUSIVE**, never counted as empty. `--offline`
makes that explicit for every network source.

## Tests

```bash
node --test tests/upstream_check.test.mjs
```

Twelve cases. Each builds a throwaway repo in one git state against a throwaway remote and asserts
the verdict, so the suite judges classification rather than file contents. Two of them exist to prove
the guards bite rather than pass vacuously: a planted AWS access key blocks its push, and
`--allow-secret-hits` is what lets it through.

## Limits

Repos are discovered one level below `--root`. The driller uses the unauthenticated GitHub API, so a
full sweep is rate-budgeted; it makes one listing call and reads the rest from raw hosts. It reports
what a listing claims, not whether the listing is good — prose and discoverability belong to
[`findable`](https://github.com/arm-pz/findable), and whether a build is safe to deploy belongs to
the pre-ship skills.

MIT — see [LICENSE](LICENSE).
