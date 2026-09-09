import { cacheHitRate, formatUsd } from "@le/shared";

/**
 * Turning the llm_calls log into the two questions an owner has: what are we
 * spending, and what does a meeting cost to produce.
 *
 * Nothing read this table. Every call's tokens, latency, prompt version and
 * errors were recorded faithfully and no screen or query ever looked at them,
 * so the unit economics of a per-seat product were unknowable from inside it.
 */
export interface UsageRow {
  agent: string;
  model: string;
  prompt_version: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
}

export interface UsageGroup {
  key: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Null when any call in the group was made by a model we cannot price. */
  costUsd: number | null;
  cacheHitRate: number | null;
  medianLatencyMs: number | null;
}

function summarize(key: string, rows: readonly UsageRow[]): UsageGroup {
  let costUsd: number | null = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let failed = 0;
  const latencies: number[] = [];

  for (const row of rows) {
    inputTokens += row.input_tokens ?? 0;
    outputTokens += row.output_tokens ?? 0;
    cacheReadTokens += row.cache_read_tokens ?? 0;
    if (row.error) failed += 1;
    if (row.latency_ms !== null) latencies.push(row.latency_ms);
    // One unpriced call makes the whole total a guess, and a total that is
    // partly a guess should not be shown as a number.
    if (costUsd !== null) costUsd = row.cost_usd === null ? null : costUsd + row.cost_usd;
  }

  return {
    key,
    calls: rows.length,
    failed,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    costUsd,
    cacheHitRate: cacheHitRate(inputTokens, cacheReadTokens),
    medianLatencyMs: median(latencies),
  };
}

/** Median, not mean: one 40-second retry should not describe every call. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export function groupBy(rows: readonly UsageRow[], key: (row: UsageRow) => string): UsageGroup[] {
  const buckets = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const bucket = key(row);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), row]);
  }
  return [...buckets.entries()]
    .map(([bucket, bucketRows]) => summarize(bucket, bucketRows))
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.calls - a.calls);
}

/**
 * The number that decides whether the pricing works. Null rather than a dash
 * when nothing has been booked yet: dividing by no meetings is not a very
 * large cost, it is not yet a number.
 */
export function costPerMeeting(totalCostUsd: number | null, meetings: number): number | null {
  if (totalCostUsd === null || meetings <= 0) return null;
  return totalCostUsd / meetings;
}

export { formatUsd };
