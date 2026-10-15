/**
 * Runs the real fit scorer over the labelled prospects and reports how often a
 * person would have been queued who should not have been, and the reverse.
 *
 *   OPENAI_API_KEY=... pnpm --filter @le/agents eval:fit
 *
 * "Queued" is decided exactly as the targeting job decides it: not
 * disqualified, and a fit score at or above `MIN_FIT_TO_QUEUE`.
 *
 * The headline error is a false positive. A queued person who would never buy
 * spends an invitation from a capped daily allowance, carries restriction risk
 * for the account sending it, and, when it is a competitor, puts the company's
 * outreach in front of the one audience that will study it (rule 49). A false
 * negative is a real buyer left off the list, which costs less but is still
 * counted, because a scorer that drops everybody would otherwise pass.
 *
 * This spends real money: one classifier call per profile (four in all).
 */
import { MIN_FIT_TO_QUEUE } from "@le/shared";
import { createLlmClient } from "../src/llm.js";
import { scoreProspects, type RankedProspect } from "../src/targeting.js";
import { FIT_EVAL_PROFILES, FIT_SCORE_CASES, toCandidate, type FitScoreCase } from "./fit-score-cases.js";

/** At most this share of the no_fit cases may be queued. */
export const MAX_FALSE_POSITIVE_RATE = 0.1;
/** At least this share of the fit cases must be queued. */
export const MIN_FIT_RECALL = 0.8;

export interface FitResult {
  testCase: FitScoreCase;
  fitScore: number;
  disqualified: boolean;
  queued: boolean;
  reasons: string[];
  disqualifyReason?: string;
  error?: string;
}

export interface FitReport {
  accuracy: number;
  falsePositives: number;
  falsePositiveRate: number;
  falseNegatives: number;
  fitRecall: number;
  errors: number;
  failed: boolean;
}

/** The targeting job's own rule (`apps/worker/src/jobs/targeting.ts`). */
export function isQueued(ranked: Pick<RankedProspect, "disqualified" | "fitScore">): boolean {
  return !ranked.disqualified && ranked.fitScore >= MIN_FIT_TO_QUEUE;
}

export function missingKeyMessage(env: Record<string, string | undefined>): string | null {
  if (env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY) return null;
  return [
    "The fit-score eval calls the real scorer and needs a model provider key.",
    "Set OPENAI_API_KEY or ANTHROPIC_API_KEY and run it again:",
    "",
    "  OPENAI_API_KEY=sk-... pnpm --filter @le/agents eval:fit",
    "",
    "Nothing was scored and nothing was spent.",
  ].join("\n");
}

async function main(): Promise<void> {
  const missing = missingKeyMessage(process.env);
  if (missing) {
    console.error(missing);
    process.exitCode = 2;
    return;
  }

  let client;
  try {
    client = createLlmClient(process.env as never);
  } catch (error) {
    console.error(`Cannot start the fit-score eval: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  const ctx = { client };
  console.log(`Provider: ${client.provider} (${client.models.classifier})`);
  console.log(`Queue cut-off: ${MIN_FIT_TO_QUEUE}\n`);

  const perProfile = await Promise.all(
    FIT_EVAL_PROFILES.map(async (evalProfile): Promise<FitResult[]> => {
      const cases = FIT_SCORE_CASES.filter((c) => c.profileId === evalProfile.id);
      try {
        const ranked = await scoreProspects(ctx, {
          profile: evalProfile.profile,
          candidates: cases.map(toCandidate),
          business: evalProfile.business,
        });
        const byId = new Map(ranked.map((r) => [r.candidate.providerId, r]));
        return cases.map((testCase) => toResult(testCase, byId.get(testCase.id)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return cases.map((testCase) => errored(testCase, message));
      }
    }),
  );

  report(perProfile.flat());
}

function toResult(testCase: FitScoreCase, ranked: RankedProspect | undefined): FitResult {
  if (!ranked) return errored(testCase, "missing from the scorer's output");
  /*
   * A prospect the model left out, or scored with something that is not a
   * number, comes back disqualified at 0. That is the right thing for
   * production to do and the wrong thing for an eval to count: it would score
   * every no_fit case it skipped as a correct answer.
   */
  if (ranked.disqualifyReason === "not scored" || ranked.disqualifyReason === "unreadable score") {
    return errored(testCase, ranked.disqualifyReason);
  }
  return {
    testCase,
    fitScore: ranked.fitScore,
    disqualified: ranked.disqualified,
    queued: isQueued(ranked),
    reasons: ranked.fitReasons,
    disqualifyReason: ranked.disqualifyReason,
  };
}

function errored(testCase: FitScoreCase, error: string): FitResult {
  return { testCase, fitScore: 0, disqualified: true, queued: false, reasons: [], error };
}

/**
 * Scores a finished run and decides whether it passed. Exported so the
 * arithmetic can be checked without spending anything.
 */
export function report(results: FitResult[]): FitReport {
  const scored = results.filter((r) => !r.error);
  const errors = results.filter((r) => r.error);
  const shouldQueue = scored.filter((r) => r.testCase.expect === "fit");
  const shouldNot = scored.filter((r) => r.testCase.expect === "no_fit");

  const falsePositives = shouldNot.filter((r) => r.queued);
  const falseNegatives = shouldQueue.filter((r) => !r.queued);
  const correct = scored.length - falsePositives.length - falseNegatives.length;

  const accuracy = scored.length ? correct / scored.length : 0;
  const falsePositiveRate = shouldNot.length ? falsePositives.length / shouldNot.length : 0;
  const fitRecall = shouldQueue.length ? (shouldQueue.length - falseNegatives.length) / shouldQueue.length : 1;

  console.log("\n=== Fit scorer ===");
  console.log(`cases                 ${results.length}  (${errors.length} errored)`);
  console.log(`accuracy              ${pct(accuracy)}  (${correct}/${scored.length})`);
  console.log(
    `false positives       ${falsePositives.length}/${shouldNot.length}  ${pct(falsePositiveRate)}  [gate: at most ${pct(MAX_FALSE_POSITIVE_RATE)}]`,
  );
  console.log(
    `false negatives       ${falseNegatives.length}/${shouldQueue.length}  fit recall ${pct(fitRecall)}  [gate: at least ${pct(MIN_FIT_RECALL)}]`,
  );

  const traps = scored.filter((r) => r.testCase.trap);
  const trapsRight = traps.filter((r) => r.queued === (r.testCase.expect === "fit"));
  console.log(`traps handled         ${trapsRight.length}/${traps.length}`);

  if (falsePositives.length) {
    console.log("\nFALSE POSITIVES: these people would have been invited:");
    for (const r of falsePositives) line(r);
  }
  if (falseNegatives.length) {
    console.log("\nFalse negatives: real buyers left off the list:");
    for (const r of falseNegatives) line(r);
  }
  if (errors.length) {
    console.log("\nErrors:");
    for (const r of errors) console.log(`  ${r.testCase.id}: ${r.error}`);
  }

  /*
   * An error fails the run as hard as a miss. An errored case is recorded as
   * disqualified and unqueued, which is a correct answer for every no_fit case
   * it touches, so a run with errors reports a better number than it earned.
   */
  const failed =
    errors.length > 0 || falsePositiveRate > MAX_FALSE_POSITIVE_RATE || fitRecall < MIN_FIT_RECALL;
  if (failed) {
    const why =
      errors.length > 0
        ? `${errors.length} case(s) errored, so the number is not trustworthy`
        : falsePositiveRate > MAX_FALSE_POSITIVE_RATE
          ? `false positive rate ${pct(falsePositiveRate)} is above ${pct(MAX_FALSE_POSITIVE_RATE)}`
          : `fit recall ${pct(fitRecall)} is below ${pct(MIN_FIT_RECALL)}`;
    console.log(`\nFAILED: ${why}.`);
    process.exitCode = 1;
  } else {
    console.log("\nPASSED");
  }

  return {
    accuracy,
    falsePositives: falsePositives.length,
    falsePositiveRate,
    falseNegatives: falseNegatives.length,
    fitRecall,
    errors: errors.length,
    failed,
  };
}

function line(r: FitResult): void {
  const trap = r.testCase.trap ? ` [${r.testCase.trap}]` : "";
  const dq = r.disqualified ? " disqualified" : "";
  console.log(`  ${r.testCase.id}${trap}  score=${r.fitScore}${dq}  "${r.testCase.prospect.headline}"`);
  console.log(`      why it matters: ${r.testCase.note}`);
  if (r.reasons.length) console.log(`      scorer said: ${r.reasons.join("; ")}`);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/*
 * Only when run directly. Imported by a test that checks the scoring, this
 * file must not reach for a model provider.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
