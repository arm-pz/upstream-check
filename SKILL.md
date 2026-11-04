---
name: upstream-check
description: Find local work that never reached its remote and push only what is safe. Fetches a folder of git clones, classifies every repo as push-ready, level, behind, diverged, no-upstream or no-remote, screens the outgoing diff for credential-shaped lines, and with --push fast-forwards only the clean ones and never forces, uses --no-verify, or touches a diverged repo. Use when the user asks what has not been pushed, whether clones are behind upstream, why GitHub lags behind their machine, or to push a batch of repos. Not for checking whether a site, README or marketplace agrees with the repos (use listing-drift), writing or tuning a skill (use draft-skill or tune-skill), making a repo discoverable (use findable), or deciding whether a build is safe to deploy (use release-gate-chair).
---

# Upstream check

Work committed locally and never pushed is invisible: the public repo silently lags behind what you are actually doing, and nothing on the machine says so.

It is answered by reading, not by inferring. `git status` compares against a remote-tracking ref you have not refreshed, so it lies about "up to date" until something is fetched.

## Ground rules

- **Read-only unless told otherwise.** Without `--push` nothing is written anywhere. Run the audit, show it, get a yes for the batch.
- **Push only fast-forwards.** A repo that is behind or diverged is reported and skipped. Never `--force`, never `--force-with-lease` as a shortcut around a divergence you have not explained, never `--no-verify`.
- **A dirty tree is context, not a blocker.** `git push` sends commits, so uncommitted files stay local and are named as such. Never commit someone else's loose work to make a number look tidy.
- **Unreadable is INCONCLUSIVE.** If a fetch fails, say so. A failed fetch means the remote side may be stale rather than level.
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

## Report

Verdict table first, then what was pushed and what was refused and why. Name what you did not verify: a branch you did not fetch, a repo another session may be mid-way through. Once everything is pushed, `listing-drift` checks whether the site, marketplace and READMEs now agree with the repos.

## Tests

```
node --test tests/upstream_check.test.mjs
```

Each case builds a throwaway repo in one git state against a throwaway remote and asserts the verdict, so the suite judges classification rather than file contents. It also asserts two guards actually bite: a planted credential key blocks the push, and `--allow-secret-hits` is what lets it through.
