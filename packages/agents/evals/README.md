# Agent evals

## Reply classification

The Reply Agent's classifier decides whether a machine may answer a prospect or
whether a human must. That decision is the product's main safety boundary, so it
is measured rather than assumed.

```bash
OPENAI_API_KEY=sk-... pnpm --filter @le/agents eval:classify
```

It needs a real key and makes one classifier call per case — 33 of them — so it
cannot run in CI or in a container without one.

The **scoring** is checked without spending anything
(`packages/agents/test/eval-harness.test.ts`): recall is measured over the
escalations alone rather than over every case, an over-escalation does not fail
the run, and a case that errored fails it rather than counting as automated. A
first paid run that reported a wrong number would be worse than no run, because
the number gets written down and believed.

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

## Prospect fit scoring

The fit scorer (`scoreProspects` in `src/targeting.ts`) decides who is added to
a campaign: anybody not disqualified and scoring at least `MIN_FIT_TO_QUEUE`
(`packages/shared/src/fit-score.ts`, currently 60) is queued, reviewed once,
and then invited from a capped daily allowance under a real rep's name.

```bash
OPENAI_API_KEY=sk-... pnpm --filter @le/agents eval:fit
```

It runs the real scorer through `createLlmClient`, one call per customer
profile (four in all), and decides "queued" with the targeting job's own rule.
Without `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` it refuses, says so, spends
nothing and exits with code 2.

It reports accuracy, **false positives** (a `no_fit` person who would have been
queued) and **false negatives** (a real buyer left off the list), lists each
one with the note saying why that case exists, and exits non-zero when:

- more than 10% of the `no_fit` cases would have been queued,
- fewer than 80% of the `fit` cases would have been, or
- any case errored or came back unscored (an unscored person is disqualified
  at 0, which would otherwise count as a correct rejection).

The false positive is the expensive error: an invitation spent, restriction
risk for the account, and, when it is a competitor, our outreach in front of
the one audience that studies it. The recall gate exists because a scorer that
drops everybody would otherwise pass.

### The dataset

`fit-score-cases.ts` holds 34 hand-labelled prospects across four customer
profiles shaped like real Strategy Agent output, each with `whatTheyBuy`,
`insteadOfToday` and the business's named competitors, because production
passes all three. Each prospect has a headline, title, company and about text
and an expected band, `fit` or `no_fit`.

The traps are the point (CLAUDE.md rule 49):

- `competitor`: sells the same thing, or offers it as a service. Matches the
  profile on title, size and vocabulary.
- `peer`: shares the company's audience and language (a networking group
  leader, a coach, a vendor to the same buyers) and would never buy.
- `different_words`: a real buyer whose title and description do not use the
  company's vocabulary at all.

`test/fit-score-dataset.test.ts` checks the set and the arithmetic without a
key: unique ids, valid bands, every profile parsing as a customer profile, at
least five traps with each kind labelled the way rule 49 reads it, and the
gates failing when they should. That test runs in CI.

### Status

**Not yet run.** No API key was available in the environment where it was
written. Run it before the next strategy prompt change ships, and record the
number here.

| Date | Model | Cases | Accuracy | False positives | False negatives | Traps handled |
|---|---|---|---|---|---|---|
| _not yet run_ | | | | | | |

### When it fails

A false positive on a `competitor` or `peer` trap is usually the prompt
(`FIT_SCORE_SYSTEM` in `src/prompts/targeting.ts`) matching on resemblance
rather than need. Fix it, bump `FIT_SCORE_PROMPT_VERSION`, and re-run. A false
negative on a `different_words` case means the scorer is matching the
profile's words rather than its problem.
