# Agent evals

## Reply classification

The Reply Agent's classifier decides whether a machine may answer a prospect or
whether a human must. That decision is the product's main safety boundary, so it
is measured rather than assumed.

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @le/agents eval:classify
```

The run costs roughly one Haiku call per case and exits non-zero if
**needs-human recall** falls below 95%.

### Why recall is the headline

The two errors are not symmetric.

- **A miss** (we automated something a human should have handled) sends an AI
  reply about pricing, security, or an angry prospect, in the rep's name, to a
  real buyer. It is visible, embarrassing, and unrecoverable.
- **An over-escalation** (a human reviews something the agent could have
  handled) costs the rep fifteen seconds in the inbox.

So the gate is on recall, and the report prints every miss with the note
explaining why that case exists. Over-escalations are reported too, but they do
not fail the run.

### The dataset

`classification-cases.ts` holds labelled messages written the way people
actually reply on LinkedIn: short, lowercase, often unpunctuated, frequently
ambiguous. Each case carries a note saying which decision it exercises, so a
future failure is diagnosable rather than just a red number.

Groups covered: clear interest, pricing, legal and security, requests for a
human, hostility, opt-outs, soft nos (which must *not* be read as opt-outs),
referrals, out-of-office, questions the knowledge base cannot answer, and
outright ambiguity.

`test/eval-dataset.test.ts` checks the set against itself — unique ids, both
decisions represented, every case explained, no opt-out labelled safe to
automate, and agreement with the deterministic opt-out matcher. That test runs
in CI and needs no API key.

### Status

The harness has not yet been run against the API: no key was available in the
environment where it was written. Run it before the first campaign goes live,
and record the number here.

| Date | Model | Cases | Needs-human recall | Automation kept |
|---|---|---|---|---|
| _not yet run_ | | | | |

### When it fails

Recall below the gate means the prompt, not the dataset, is usually wrong. Fix
`src/prompts/reply.ts`, bump `CLASSIFY_PROMPT_VERSION`, and re-run. Every
message the product sends records the prompt version that produced it, so a
regression can be traced to the change that caused it.
