/**
 * What a ticket's captured context says, in sentences an operator can read.
 *
 * The ticket carries a snapshot of what the product believed when somebody
 * pressed Raise a ticket (`context` on `support_tickets`). This turns it into
 * the three or four facts that decide which stage to look at.
 *
 * The rule here is the same one that runs through the diagnostics page: a fact
 * this snapshot does not have is **said to be missing**, never left out. A list
 * that simply does not mention the sending loop reads as a loop that was fine,
 * and sends whoever is answering to investigate the wrong stage — which is the
 * failure the snapshot exists to prevent, reintroduced at the last step.
 */
export interface TicketContext {
  stuckOn?: string | null;
  stuckOnLabel?: string | null;
  linkedInStatus?: string | null;
  linkedInDetail?: string | null;
  sendingLoopRunning?: boolean | null;
  pacingBeatAt?: string | null;
  workerBootAt?: string | null;
  workerBuild?: string | null;
  raisedAt?: string | null;
}

function asContext(value: unknown): TicketContext {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TicketContext) : {};
}

function ago(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function describeTicketContext(raw: unknown, now: number = Date.now()): string[] {
  const context = asContext(raw);
  const facts: string[] = [];

  facts.push(
    context.stuckOnLabel
      ? `Stuck on: ${context.stuckOnLabel}`
      : context.stuckOn
        ? `Stuck on: ${context.stuckOn}`
        : "Setup step: not captured",
  );

  facts.push(
    context.linkedInStatus
      ? `LinkedIn: ${context.linkedInStatus.replaceAll("_", " ")}${
          context.linkedInDetail ? ` — ${context.linkedInDetail}` : ""
        }`
      : "LinkedIn: not captured",
  );

  // The one that decides whether this is a campaign problem or a deployment
  // problem, and the one most easily read as fine when it is absent.
  const beat = ago(context.pacingBeatAt, now);
  facts.push(
    context.sendingLoopRunning === true
      ? `Sending loop: running${beat ? ` (last run ${beat})` : ""}`
      : context.sendingLoopRunning === false
        ? `Sending loop: NOT running${beat ? ` (last run ${beat})` : " (never run)"}`
        : "Sending loop: not captured",
  );

  const booted = ago(context.workerBootAt, now);
  facts.push(
    context.workerBootAt
      ? `Worker booted ${booted}${context.workerBuild ? ` on ${context.workerBuild.slice(0, 7)}` : ", build unknown"}`
      : "Worker boot: not captured",
  );

  return facts;
}
