---
name: upstream-check
description: Find local work that never reached its remote and push only what is safe, then check whether published listings agree with the repos. Fetches a folder of git clones, classifies every repo as push-ready, level, behind, diverged, no-upstream or no-remote, screens the outgoing diff for credential-shaped lines, and with --push fast-forwards only the clean ones and never forces, uses --no-verify, or touches a diverged repo. A second checker counts a catalogue wherever it is published (site index, homepage, marketplace, READMEs) against the repos that ship a SKILL.md, and names what drifted. Use when the user asks what has not been pushed, whether clones are behind upstream, to push a batch, or why a site and a README list different numbers than GitHub. Not for writing or tuning a skill (use draft-skill or tune-skill), making a repo discoverable (use findable), or deciding whether a build is safe to deploy (use release-gate-chair).
---

# Upstream check

Two failures this covers, because they look nothing alike but come from the same gap. One: work is committed locally and never leaves the machine, so the public repo silently lags behind what you are actually doing. Two: everything is pushed, but the numbers people read — a site index, a marketplace manifest, a README table — disagree with each other and with the repos, because each was hand-maintained at a different moment.

Both are answered by reading, not by inferring. `git status` compares against a remote-tracking ref you have not refreshed, so it lies about "up to date" until something is fetched. A repo description is not evidence a skill exists; only a `SKILL.md` is.

## Ground rules

- **Read-only unless told otherwise.** Without `--push` nothing is written anywhere. Run the audit, show it, get a yes for the batch.
- **Push only fast-forwards.** A repo that is behind or diverged is reported and skipped. Never `--force`, never `--force-with-lease` as a shortcut around a divergence you have not explained, never `--no-verify`.
- **A dirty tree is context, not a blocker.** `git push` sends commits, so uncommitted files stay local and are named as such. Never commit someone else's loose work to make a number look tidy.
- **Unreadable is INCONCLUSIVE.** If a fetch fails or a listing cannot be parsed, say so. An unreadable source is never counted as an empty one, and a failed fetch means the remote side may be stale rather than level.
- **Counts move while you read.** If another session is deploying or pushing, re-run immediately before acting and say which run the numbers came from.

## Audit

```
node scripts/upstream_check.mjs --root <dir-with-clones>        # read-only
node scripts/upstream_check.mjs --root <dir> --json             # for another agent to consume
node scripts/upstream_check.mjs --root <dir> --only a,b --push  # act on named repos only
```

Default root is `~/Downloads/Qoder`. `--no-fetch` uses the refs you already have and must be labelled as possibly stale. Name `--only` whenever a machine has more than one person on it: a repo another session is mid-way through is push-ready by arithmetic and not yours to send.

| Verdict | Meaning | Action |
| --- | --- | --- |
| `push-ready` | Local commits exist, remote has none you lack | Clean fast-forward. Safe to push. |
| `level` | Nothing to send, nothing to take | None. |
| `behind` | Remote moved, local did not | Pull or re-clone. Pushing is not the answer. |
| `diverged` | Both moved | Stop. Explain the two histories before touching either. |
| `no-upstream` | Branch tracks nothing | Decide the branch, then `--set-upstream-to`. |
| `no-remote` | No origin at all | Nothing to check; a local-only project. |
| `unreadable` | A git call failed | Report as inconclusive, not as level. |

Before a push the script screens added lines in the outgoing diff for GitHub, AWS, OpenAI-style, Slack and private-key shapes and aborts that repo on a hit. If a hit is a documented placeholder you have read and judged, `--allow-secret-hits` overrides — but say what you waved through. For an asset that publishes attack or exploit tooling, confirm it carries its authorization framing before it goes public; a harness that boots a mutated copy of your own app is fine, an unlabelled attack script on a public repo is not.

## Listing drift

```
node scripts/drift_check.mjs --owner arm-pz --site https://skills.caffeinity.com
```

Ground truth is every owned repo that ships `SKILL.md` at the root or at `skills/<repo>/SKILL.md`. Each published source is then measured against it: the machine-readable index, the homepage, the marketplace manifest, and the named READMEs. `--offline` reports every network source as inconclusive instead of zero.

Read the columns this way:

- **absent** — a real repo this source does not mention. A README that lists fewer than the repos is usually stale, not deliberate.
- **not in ground truth** — the source names something no repo ships. Sometimes legitimate: a plugin id and its repo can differ (`release-gate` published from `release-gate-chair`). Confirm the manifest's `source.repo` resolves before calling it an error.
- **two site indexes disagreeing** — the pages a visitor sees and the file an installer reads are built separately. Treat that as a live bug, not a cosmetic mismatch, and check whether one of them 404s.

A repo that ships a skill but appears in no listing is a distribution gap, not a drift finding — that one belongs with `findable`.

## Report

Verdict table first, then what was pushed and what was refused and why. Name what you did not verify: a branch you did not fetch, a page you did not open, a deploy someone else may have run mid-check. If drift turned up, hand the listing edits to `findable` and the boundary clean-up to `tune-skill` rather than rewriting prose here.

## Tests

```
node --test tests/upstream_check.test.mjs
```

Each case builds a throwaway repo in one git state against a throwaway remote and asserts the verdict, so the suite judges classification rather than file contents. It also asserts two guards actually bite: a planted credential key blocks the push, and `--allow-secret-hits` is what lets it through.
