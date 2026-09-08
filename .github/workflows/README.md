# CI

`ci.yml` runs on every push and pull request: install, build, typecheck, test.

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
