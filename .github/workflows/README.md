# CI

`ci.yml` runs on every push and pull request: install, build, typecheck, test.

## The mutation check

`scripts/mutation-check.mjs` breaks each safety rule on purpose and requires
that some test notice. It runs on every push.

This exists because a passing suite is not evidence. Twice now a test here
passed for the wrong reason — once by setting `needsHuman: true`, which routes
to hold-for-human and never reaches the branch the test claimed to cover, and
once by using a phrase the acceptance matcher rejects outright, so the
ambiguity logic under test never ran. Both looked green. Neither would have
caught a regression.

A `SURVIVED` line names a rule that is currently unguarded. A `STALE` line
means the code moved and the mutation no longer describes it — equally a
failure, because a stale mutation silently stops checking anything.

## What is deliberately not here

**The reply-classification eval.** It calls the Anthropic API, so it costs money
per run and needs a key. Running it on every push would make a red build mean
"someone pushed a typo in a README" as often as "the safety gate regressed".
Run it before shipping a prompt change:

```bash
ANTHROPIC_API_KEY=... pnpm --filter @le/agents eval:classify
```

Its dataset consistency checks *do* run in CI — they need no key, and a
self-contradictory dataset silently weakens every measurement taken against it.

**Anything that touches LinkedIn.** There is no integration test against a real
account, by design. `LINKEDIN_PROVIDER=mock` covers the flow end to end without
risking a rep's account, and the rate limiter is unit-tested against the caps
in `packages/shared/src/constants.ts`.
