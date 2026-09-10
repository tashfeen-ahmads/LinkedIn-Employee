/**
 * Runs the Reply Agent classifier over the labelled set and reports how often
 * it gets each decision right.
 *
 * The headline number is needs-human recall: of the messages a human must
 * handle, how many did the gate actually stop? A false negative there means an
 * AI answered a pricing question, a security question, or an angry prospect.
 * That is the failure this product cannot ship with, so the run exits non-zero
 * below the threshold.
 *
 *   OPENAI_API_KEY=... pnpm --filter @le/agents eval:classify
 *
 * Runs against whichever provider the environment is configured for, which is
 * the point: the number is only worth recording for the provider that will
 * actually answer in production.
 *
 * This spends real money — roughly one classifier call per case.
 */
import { classifyReply } from "../src/reply.js";
import { createLlmClient } from "../src/llm.js";
import { CLASSIFICATION_CASES, EVAL_KNOWLEDGE_TITLES, type ClassificationCase } from "./classification-cases.js";

const RECALL_THRESHOLD = 0.95;
const CONCURRENCY = 4;

interface Result {
  testCase: ClassificationCase;
  needsHuman: boolean;
  intent: string;
  optOut: boolean;
  confidence: number;
  error?: string;
}

async function main(): Promise<void> {
  const client = createLlmClient(process.env as never);
  const ctx = { client };
  console.log(`Provider: ${client.provider} (${client.models.classifier})\n`);
  const results: Result[] = [];

  for (let i = 0; i < CLASSIFICATION_CASES.length; i += CONCURRENCY) {
    const batch = CLASSIFICATION_CASES.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (testCase): Promise<Result> => {
        try {
          const classification = await classifyReply(ctx, {
            message: testCase.message,
            history: (testCase.history ?? []).map((turn) => ({
              ...turn,
              at: new Date().toISOString(),
            })),
            knowledgeTitles: EVAL_KNOWLEDGE_TITLES,
          });
          return {
            testCase,
            needsHuman: classification.needsHuman,
            intent: classification.intent,
            optOut: classification.optOut,
            confidence: classification.confidence,
          };
        } catch (error) {
          return {
            testCase,
            needsHuman: false,
            intent: "error",
            optOut: false,
            confidence: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    results.push(...settled);
    process.stdout.write(`  scored ${results.length}/${CLASSIFICATION_CASES.length}\n`);
  }

  report(results);
}

function report(results: Result[]): void {
  const shouldEscalate = results.filter((r) => r.testCase.expect.needsHuman);
  const shouldAutomate = results.filter((r) => !r.testCase.expect.needsHuman);

  const caught = shouldEscalate.filter((r) => r.needsHuman);
  const missed = shouldEscalate.filter((r) => !r.needsHuman);
  const overEscalated = shouldAutomate.filter((r) => r.needsHuman);

  const recall = shouldEscalate.length ? caught.length / shouldEscalate.length : 1;
  const specificity = shouldAutomate.length
    ? (shouldAutomate.length - overEscalated.length) / shouldAutomate.length
    : 1;
  const intentCorrect = results.filter((r) => r.intent === r.testCase.expect.intent).length;
  const optOutCases = results.filter((r) => r.testCase.expect.optOut !== undefined);
  const optOutCorrect = optOutCases.filter((r) => r.optOut === r.testCase.expect.optOut).length;

  console.log("\n=== Reply Agent classification ===");
  console.log(`cases                 ${results.length}`);
  console.log(`needs-human recall    ${pct(recall)}  (${caught.length}/${shouldEscalate.length})  [gate: ${pct(RECALL_THRESHOLD)}]`);
  console.log(`automation kept       ${pct(specificity)}  (${shouldAutomate.length - overEscalated.length}/${shouldAutomate.length})`);
  console.log(`intent exact match    ${pct(intentCorrect / results.length)}  (${intentCorrect}/${results.length})`);
  console.log(`opt-out accuracy      ${pct(optOutCorrect / (optOutCases.length || 1))}  (${optOutCorrect}/${optOutCases.length})`);

  if (missed.length) {
    console.log("\nMISSED — an AI would have answered these:");
    for (const result of missed) {
      console.log(`  ${result.testCase.id}  conf=${result.confidence.toFixed(2)}  "${truncate(result.testCase.message)}"`);
      console.log(`      why it matters: ${result.testCase.note}`);
    }
  }

  if (overEscalated.length) {
    console.log("\nOver-escalated — a human was pulled in unnecessarily:");
    for (const result of overEscalated) {
      console.log(`  ${result.testCase.id}  "${truncate(result.testCase.message)}"`);
    }
  }

  const errors = results.filter((r) => r.error);
  if (errors.length) {
    console.log("\nErrors:");
    for (const result of errors) console.log(`  ${result.testCase.id}: ${result.error}`);
  }

  if (recall < RECALL_THRESHOLD || errors.length > 0) {
    console.log(`\nFAILED: recall ${pct(recall)} is below the ${pct(RECALL_THRESHOLD)} gate.`);
    process.exitCode = 1;
  } else {
    console.log("\nPASSED");
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function truncate(text: string, max = 68): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

await main();
