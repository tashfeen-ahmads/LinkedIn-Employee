import { z } from "zod";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { jobId, type Queues } from "../queues.js";
import { recoverAccounts } from "../accounts.js";
import { answerSupportTicket, sweepSupportTickets } from "./support.js";
import { startPendingSearches } from "./pending-searches.js";
import { unstickProspects } from "./unstick.js";
import { sendRecovery } from "./account-recovery.js";

/**
 * What an operator can do from the console without opening a SQL editor.
 *
 * Every op here is something an operator did by hand at least once, in SQL,
 * after a customer complained. The worker performs them because it holds the
 * service role; the route that calls this has already checked the caller is in
 * `platform_admins` (the second lock, as for announcements and issues).
 *
 * Two things are deliberately **not** here. Launching a campaign: it is the
 * one gate with no way round it (rule 58's tour, `YOUR_DECISIONS`), and an
 * operator launching for a customer is the product sending under somebody's
 * name without their yes. And granting platform admin: rule 15 — nothing
 * grants admin through the API.
 */
export const AdminControlSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("outreach-pause"), reason: z.string().trim().min(3).max(300) }),
  z.object({ op: z.literal("outreach-resume") }),
  z.object({ op: z.literal("support-autopilot"), on: z.boolean() }),
  z.object({ op: z.literal("support-redraft"), ticketId: z.string().uuid() }),
  z.object({ op: z.literal("support-sweep") }),
  z.object({ op: z.literal("campaign-pause"), campaignId: z.string().uuid() }),
  z.object({ op: z.literal("campaign-resume"), campaignId: z.string().uuid() }),
  z.object({ op: z.literal("workspace-pause"), workspaceId: z.string().uuid() }),
  z.object({ op: z.literal("account-clear-hold"), accountId: z.string().uuid() }),
  z.object({ op: z.literal("accounts-recover") }),
  z.object({ op: z.literal("user-password-reset"), targetUserId: z.string().uuid() }),
  z.object({
    op: z.literal("run-task"),
    task: z.enum(["tick", "acceptance", "inbound-poll", "posts", "lifecycle", "nightly", "pending-searches", "unstick"]),
  }),
  z.object({
    op: z.literal("jobs-retry-failed"),
    queue: z.enum(["strategy", "targeting", "campaignTick", "linkedinAction", "inbound", "maintenance", "digest"]),
  }),
  z.object({
    op: z.literal("jobs-clean-failed"),
    queue: z.enum(["strategy", "targeting", "campaignTick", "linkedinAction", "inbound", "maintenance", "digest"]),
  }),
]);
export type AdminControl = z.infer<typeof AdminControlSchema>;

export type ControlResult = { ok: true; detail: string } | { ok: false; error: string };

export async function runAdminControl(
  ctx: WorkerContext,
  queues: Queues,
  userId: string,
  control: AdminControl,
): Promise<ControlResult> {
  const { db } = ctx;
  const now = new Date().toISOString();

  switch (control.op) {
    case "outreach-pause": {
      const { error } = await db
        .from("platform_settings")
        .update({
          outreach_paused_at: now,
          outreach_paused_reason: control.reason,
          outreach_paused_by: userId,
          updated_at: now,
        })
        .eq("id", true);
      if (error) return { ok: false, error: error.message };
      return { ok: true, detail: "Outreach is paused everywhere. Queued work waits; nothing is failed." };
    }
    case "outreach-resume": {
      const { error } = await db
        .from("platform_settings")
        .update({ outreach_paused_at: null, outreach_paused_reason: null, outreach_paused_by: null, updated_at: now })
        .eq("id", true);
      if (error) return { ok: false, error: error.message };
      // Asked now rather than in five minutes, so the screen that pressed the
      // button is not the one wondering whether it worked.
      await queues.campaignTick.add("tick", { workspaceId: "*", campaignId: "*" }, { jobId: jobId("resume", Date.now()) });
      return { ok: true, detail: "Outreach resumed. The pacing loop has been asked to run now." };
    }
    case "support-autopilot": {
      const { error } = await db
        .from("platform_settings")
        .update({ support_autopilot: control.on, updated_at: now })
        .eq("id", true);
      if (error) return { ok: false, error: error.message };
      return {
        ok: true,
        detail: control.on
          ? "Support autopilot is on: confident answers are sent, the rest wait for you."
          : "Support autopilot is off: every answer is drafted and waits for you.",
      };
    }
    case "support-redraft": {
      const outcome = await answerSupportTicket(ctx, control.ticketId, { redraft: true });
      const said: Record<typeof outcome, string> = {
        answered: "The assistant answered it.",
        held: "A fresh draft is waiting in the reply box.",
        failed: "The assistant could not answer it; the reason is on the ticket.",
        skipped: "That ticket is not open any more.",
      };
      return { ok: true, detail: said[outcome] };
    }
    case "support-sweep": {
      const tally = await sweepSupportTickets(ctx, 25);
      return {
        ok: true,
        detail: `Looked at ${tally.answered + tally.held + tally.failed} ticket(s): ${tally.answered} answered, ${tally.held} drafted for you, ${tally.failed} could not be answered.`,
      };
    }
    case "campaign-pause":
    case "campaign-resume": {
      const { data: campaign } = await db
        .from("campaigns")
        .select("id, workspace_id, name, status, launched_at")
        .eq("id", control.campaignId)
        .maybeSingle();
      if (!campaign) return { ok: false, error: "No such campaign." };
      if (control.op === "campaign-pause") {
        if (campaign.status !== "running") return { ok: false, error: `"${campaign.name}" is ${campaign.status}, not running.` };
        await db.from("campaigns").update({ status: "paused" }).eq("id", campaign.id).eq("status", "running");
      } else {
        // Resuming, never launching: a campaign nobody launched waits for its
        // owner's yes, which is the one gate this product has no way round.
        if (campaign.status !== "paused" || !campaign.launched_at) {
          return { ok: false, error: `"${campaign.name}" was never launched by its owner, so it cannot be resumed from here.` };
        }
        await db.from("campaigns").update({ status: "running" }).eq("id", campaign.id).eq("status", "paused");
      }
      await recordEvent(db, {
        workspaceId: campaign.workspace_id,
        name: control.op === "campaign-pause" ? "campaign.paused" : "campaign.resumed",
        actorUserId: userId,
        subjectType: "campaign",
        subjectId: campaign.id,
        payload: { by: "operator" },
      }).catch(() => undefined);
      return { ok: true, detail: `"${campaign.name}" ${control.op === "campaign-pause" ? "paused" : "resumed"}.` };
    }
    case "workspace-pause": {
      const { data: paused, error } = await db
        .from("campaigns")
        .update({ status: "paused" })
        .eq("workspace_id", control.workspaceId)
        .eq("status", "running")
        .select("id");
      if (error) return { ok: false, error: error.message };
      for (const row of paused ?? []) {
        await recordEvent(db, {
          workspaceId: control.workspaceId,
          name: "campaign.paused",
          actorUserId: userId,
          subjectType: "campaign",
          subjectId: row.id,
          payload: { by: "operator", scope: "workspace" },
        }).catch(() => undefined);
      }
      return { ok: true, detail: `${paused?.length ?? 0} running campaign(s) paused.` };
    }
    case "account-clear-hold": {
      const { data: account } = await db
        .from("linkedin_accounts")
        .select("id, workspace_id, invites_paused_until")
        .eq("id", control.accountId)
        .maybeSingle();
      if (!account) return { ok: false, error: "No such account." };
      await db
        .from("linkedin_accounts")
        .update({ invites_paused_until: null, invites_paused_reason: null })
        .eq("id", account.id);
      await recordEvent(db, {
        workspaceId: account.workspace_id,
        name: "linkedin.account.hold_cleared",
        actorUserId: userId,
        subjectType: "linkedin_account",
        subjectId: account.id,
        payload: { by: "operator", was: account.invites_paused_until },
      }).catch(() => undefined);
      return {
        ok: true,
        detail: "Hold cleared. If LinkedIn is still refusing, the next refusal puts it straight back — that is the safety working.",
      };
    }
    case "user-password-reset": {
      const { data: person } = await db.from("profiles").select("email").eq("id", control.targetUserId).maybeSingle();
      if (!person?.email) return { ok: false, error: "No such person." };
      const outcome = await sendRecovery(ctx, { identifier: String(person.email), kind: "password" });
      const said: Record<typeof outcome, ControlResult> = {
        sent: { ok: true, detail: `A password reset link was emailed to ${person.email}.` },
        throttled: { ok: true, detail: `A reset link already went to ${person.email} in the last ten minutes.` },
        no_account: { ok: false, error: "That person has no sign-in to reset." },
        no_provider: { ok: false, error: "Email is switched off on this deployment." },
        failed: { ok: false, error: "The reset link could not be made or sent. Try again in a minute." },
      };
      return said[outcome];
    }
    case "accounts-recover": {
      const run = await recoverAccounts(db, ctx.linkedin);
      if (run.unreachable) return { ok: false, error: `Could not ask the provider: ${run.unreachable}` };
      return { ok: true, detail: `Checked ${run.checked} account(s); repaired ${run.repaired}.` };
    }
    case "run-task": {
      const id = jobId("operator", control.task, Date.now());
      switch (control.task) {
        case "tick":
          await queues.campaignTick.add("tick", { workspaceId: "*", campaignId: "*" }, { jobId: id });
          break;
        case "acceptance":
        case "inbound-poll":
        case "posts":
          await queues.maintenance.add(control.task, {}, { jobId: id });
          break;
        case "nightly":
          await queues.maintenance.add("maintenance", {}, { jobId: id });
          break;
        case "lifecycle":
          await queues.digest.add("lifecycle", {}, { jobId: id });
          break;
        case "pending-searches": {
          const started = await startPendingSearches(ctx, queues);
          return { ok: true, detail: `Started ${started} search(es) that were waiting.` };
        }
        case "unstick": {
          const repaired = await unstickProspects(db);
          return { ok: true, detail: `Re-armed ${repaired} stalled prospect(s).` };
        }
      }
      return { ok: true, detail: `Queued "${control.task}" to run now.` };
    }
    case "jobs-retry-failed": {
      const queue = queues[control.queue];
      const failed = await queue.getFailed(0, 499);
      let retried = 0;
      for (const job of failed) {
        if (!job) continue;
        try {
          await job.retry("failed");
          retried += 1;
        } catch {
          // A job removed between the read and the retry is not an error.
        }
      }
      return { ok: true, detail: `Retried ${retried} failed job(s) in ${control.queue}. Each re-runs every check it would have run the first time.` };
    }
    case "jobs-clean-failed": {
      const removed = await queues[control.queue].clean(0, 5_000, "failed");
      return { ok: true, detail: `Removed ${removed.length} failed job(s) from ${control.queue}.` };
    }
  }
}

export type QueueStats = Record<
  string,
  {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    recentFailures: Array<{ id: string | null; name: string; reason: string; at: number | null }>;
  }
>;

/** What every queue holds right now, with its newest failures. Bounded to three seconds. */
export async function queueStats(queues: Queues): Promise<QueueStats | null> {
  const ask = async (): Promise<QueueStats> => {
    const out: QueueStats = {};
    for (const [name, queue] of Object.entries(queues)) {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      const failed: Array<{ id?: string; name: string; failedReason?: string; finishedOn?: number } | undefined> =
        (counts.failed ?? 0) > 0 ? await queue.getFailed(0, 9) : [];
      out[name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        recentFailures: failed
          .filter((job): job is NonNullable<typeof job> => Boolean(job))
          .map((job) => ({
            id: job.id ?? null,
            name: job.name,
            reason: String(job.failedReason ?? "").slice(0, 240),
            at: job.finishedOn ?? null,
          })),
      };
    }
    return out;
  };
  try {
    return await Promise.race([ask(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000))]);
  } catch {
    return null;
  }
}
