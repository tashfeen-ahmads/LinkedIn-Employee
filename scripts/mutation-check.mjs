#!/usr/bin/env node
/**
 * Mutation check for the safety-critical rules.
 *
 * A passing test suite proves nothing on its own: a test can pass because the
 * code is right, or because the test never reaches the code. One of ours did
 * exactly that — it set needsHuman true, which routes to hold-for-human, so it
 * never touched the branch it claimed to cover.
 *
 * This breaks each rule on purpose and demands that some test notice. A
 * SURVIVED line means the rule in question is currently unguarded.
 *
 *   node scripts/mutation-check.mjs            # all mutations
 *   node scripts/mutation-check.mjs rate       # only ids containing "rate"
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Each mutation states the rule it breaks, so a SURVIVED line reads as a
 * sentence about the product rather than a diff.
 */
const MUTATIONS = [
  {
    id: "limiter/daily-invite-cap",
    rule: "An account past its daily invite cap must not send",
    file: "packages/linkedin/src/rate-limit.ts",
    from: "if (usage.invitesToday >= dailyInviteCap(usage.connectedAt, now)) {",
    to: "if (false) {",
    pkg: "@le/linkedin",
  },
  {
    id: "limiter/weekly-ceiling",
    rule: "The weekly invitation ceiling is absolute",
    file: "packages/linkedin/src/rate-limit.ts",
    from: "if (usage.invitesThisWeek >= LINKEDIN_LIMITS.invitesPerWeek) {",
    to: "if (false) {",
    pkg: "@le/linkedin",
  },
  {
    id: "limiter/working-hours",
    rule: "Nothing sends outside the rep's working hours",
    file: "packages/linkedin/src/rate-limit.ts",
    from: "if (!isWithinWorkingHours(now, usage.workingHours, usage.timezone)) {",
    to: "if (false) {",
    pkg: "@le/linkedin",
  },
  {
    id: "limiter/min-gap",
    rule: "Two actions never happen back to back",
    file: "packages/linkedin/src/rate-limit.ts",
    from: "if (elapsed < LINKEDIN_LIMITS.minGapMs) {",
    to: "if (false) {",
    pkg: "@le/linkedin",
  },
  {
    id: "limiter/warmup-ramp",
    rule: "A new account starts at the low cap and ramps",
    file: "packages/linkedin/src/rate-limit.ts",
    from: "if (days >= warmupDays) return invitesPerDayMax;",
    to: "return invitesPerDayMax;",
    pkg: "@le/linkedin",
  },
  {
    id: "gate/approval-mode",
    rule: "Approval mode holds every reply",
    file: "packages/agents/src/reply.ts",
    from: 'if (rules.mode === "approval") {',
    to: "if (false) {",
    pkg: "@le/agents",
  },
  {
    id: "gate/pricing",
    rule: "A pricing question always reaches a human",
    file: "packages/agents/src/reply.ts",
    from: "if (rules.handOffOnPricing && classification.mentionsPricing) {",
    to: "if (false) {",
    pkg: "@le/agents",
  },
  {
    id: "gate/legal",
    rule: "A legal or security question always reaches a human",
    file: "packages/agents/src/reply.ts",
    from: "if (rules.handOffOnLegal && classification.mentionsLegalOrCompliance) {",
    to: "if (false) {",
    pkg: "@le/agents",
  },
  {
    id: "gate/low-confidence",
    rule: "An unconfident classification reaches a human",
    file: "packages/agents/src/reply.ts",
    from: "if (classification.confidence < rules.minConfidence) {",
    to: "if (false) {",
    pkg: "@le/agents",
  },
  {
    id: "gate/opt-out",
    rule: "An opt-out stops the sequence, whatever else is true",
    file: "packages/agents/src/reply.ts",
    from: "if (classification.optOut) {",
    to: "if (false) {",
    pkg: "@le/agents",
  },
  {
    id: "optout/phrase-matching",
    rule: "Opt-out phrases are caught deterministically, not only by the model",
    file: "packages/agents/src/reply.ts",
    from: "return OPT_OUT_PHRASES.some((phrase) => normalized.includes(phrase));",
    to: "return false;",
    pkg: "@le/agents",
  },
  {
    id: "slots/working-hours",
    rule: "No slot is offered outside working hours",
    file: "packages/calendar/src/slots.ts",
    // Both bounds must go: for a 30-minute slot either check alone still
    // constrains the other, so mutating one is a no-op that proves nothing.
    from:
      "      isWithinWorkingHours(start, workingHours, timezone) &&\n" +
      "      isWithinWorkingHours(new Date(end.getTime() - 60_000), workingHours, timezone) &&",
    to: "      true &&",
    pkg: "@le/calendar",
  },
  {
    id: "slots/conflicts",
    rule: "No slot is offered over an existing meeting",
    file: "packages/calendar/src/slots.ts",
    from: "!overlapsAny(cursor, cursor + durationMs, blocks)",
    to: "true",
    pkg: "@le/calendar",
  },
  {
    id: "slots/min-notice",
    rule: "Nothing is offered sooner than the minimum notice",
    file: "packages/calendar/src/slots.ts",
    from: "const earliest = new Date(Math.max(from.getTime(), Date.now() + minNoticeHours * 3_600_000));",
    to: "const earliest = new Date(from.getTime());",
    pkg: "@le/calendar",
  },
  {
    id: "booking/negation",
    rule: "A declined slot is never booked",
    file: "apps/worker/src/jobs/booking.ts",
    from: "if (NEGATION.test(text)) return false;",
    to: "",
    pkg: "@le/worker",
  },
  {
    id: "booking/unoffered-slot",
    rule: "Only a slot we actually offered can be booked",
    file: "apps/worker/src/jobs/booking.ts",
    from: "  if (!chosen) return null;",
    to: "  const _unused = chosen;",
    pkg: "@le/worker",
  },
  {
    id: "booking/ambiguity",
    rule: "An ambiguous acceptance books nothing",
    file: "apps/worker/src/jobs/booking.ts",
    from: "if (ordinalMatches.length > 1) return null;",
    to: "",
    pkg: "@le/worker",
  },
  {
    id: "webhook/signature",
    rule: "An unsigned or wrongly signed webhook is rejected",
    file: "packages/linkedin/src/unipile.ts",
    from: "if (!input.signature || !verifySignature(input.body, input.signature, this.webhookSecret)) {",
    to: "if (false) {",
    pkg: "@le/linkedin",
  },
  {
    id: "webhook/fails-closed",
    rule: "A missing webhook secret rejects rather than accepts",
    file: "packages/linkedin/src/unipile.ts",
    from: "if (!this.webhookSecret) {",
    to: "if (false) {",
    pkg: "@le/linkedin",
  },
  {
    id: "api/bearer-check",
    rule: "The internal API rejects a wrong secret",
    file: "apps/worker/src/server.ts",
    from: "if (!constantTimeEquals(presented, secret)) return c.json({ error: \"unauthorized\" }, 401);",
    to: "",
    pkg: "@le/worker",
  },
  {
    id: "api/fails-closed",
    rule: "An unconfigured internal API rejects rather than opens",
    file: "apps/worker/src/server.ts",
    from: 'if (!secret) return c.json({ error: "worker is not configured for internal calls" }, 503);',
    to: "",
    pkg: "@le/worker",
  },
  {
    id: "api/membership",
    rule: "Credentials cannot be bound to a workspace you are not in",
    file: "apps/worker/src/server.ts",
    from: "  return Boolean(data);",
    to: "  return true;",
    pkg: "@le/worker",
  },
  {
    id: "pipeline/do-not-contact",
    rule: "A do-not-contact prospect is never messaged",
    file: "apps/worker/src/jobs/linkedin-action.ts",
    from: "if (prospect.do_not_contact) {",
    to: "if (false) {",
    pkg: "@le/worker",
  },
  {
    id: "pipeline/approved-reply-limiter",
    rule: "An approved reply still passes the rate limiter",
    file: "apps/worker/src/jobs/linkedin-action.ts",
    from: "if (!replyDecision.allowed) {",
    to: "if (false) {",
    pkg: "@le/worker",
  },
  {
    id: "pipeline/reply-stops-sequence",
    rule: "A reply stops the scheduled follow-ups",
    file: "apps/worker/src/jobs/inbound.ts",
    from: 'if (canTransition(cp.status as CampaignProspectStatus, "replied")) {',
    to: "if (false) {",
    pkg: "@le/worker",
  },
  {
    id: "pipeline/webhook-idempotency",
    rule: "A redelivered webhook is not answered twice",
    file: "apps/worker/src/jobs/inbound.ts",
    from: "if (existing) return;",
    to: "",
    pkg: "@le/worker",
  },
  {
    id: "billing/trial-expiry",
    rule: "An expired trial stops outreach",
    file: "apps/worker/src/jobs/campaign-tick.ts",
    from: "if (!entitled.get(campaign.workspace_id)) continue;",
    to: "",
    pkg: "@le/worker",
  },
  {
    id: "billing/canceled-subscription",
    rule: "A canceled subscription stops sending",
    file: "packages/billing/src/entitlement.ts",
    from: 'if (billing.subscriptionStatus === "canceled" || billing.subscriptionStatus === "unpaid") {',
    to: "if (false) {",
    pkg: "@le/billing",
  },
  {
    id: "billing/read-never-blocked",
    rule: "Reading is never blocked, whatever the billing state",
    file: "packages/billing/src/entitlement.ts",
    from: 'return { canSend: false, canRead: true, reason: "trial_expired", trialDaysLeft: 0 };',
    to: 'return { canSend: false, canRead: false, reason: "trial_expired", trialDaysLeft: 0 };',
    pkg: "@le/billing",
  },
  {
    id: "invites/email-binding",
    rule: "An invitation only admits the address it was sent to",
    file: "apps/web/src/lib/invitations.ts",
    from: "if (invite.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {",
    to: "if (false) {",
    pkg: "@le/web",
  },
  {
    id: "invites/expiry",
    rule: "An expired invitation is refused",
    file: "apps/web/src/lib/invitations.ts",
    from: 'if (Date.parse(invite.expires_at) <= now.getTime()) return { ok: false, reason: "expired" };',
    to: "",
    pkg: "@le/web",
  },
  {
    id: "invites/revocation",
    rule: "A revoked invitation stays revoked",
    file: "apps/web/src/lib/invitations.ts",
    from: 'if (invite.revoked_at) return { ok: false, reason: "revoked" };',
    to: "",
    pkg: "@le/web",
  },
  {
    id: "crypto/auth-tag",
    rule: "Tampered ciphertext is rejected",
    file: "apps/worker/src/crypto.ts",
    from: "decipher.setAuthTag(Buffer.from(tagPart, \"base64url\"));",
    to: "",
    pkg: "@le/worker",
  },
  {
    id: "retention/live-activity",
    rule: "Retention spares a prospect with an open campaign or upcoming meeting",
    file: "apps/worker/src/jobs/retention.ts",
    from: "if (await hasLiveActivity(db, workspace.id, prospect.id, now)) continue;",
    to: "",
    pkg: "@le/worker",
  },
  {
    id: "retention/tombstone",
    rule: "Erasure leaves a do-not-contact tombstone",
    file: "apps/worker/src/jobs/retention.ts",
    from: "      do_not_contact: true,\n      do_not_contact_reason: `erased: ${input.reason}`,",
    to: "      do_not_contact: false,\n      do_not_contact_reason: null,",
    pkg: "@le/worker",
  },
  {
    id: "targeting/cross-rep-dedupe",
    rule: "A prospect another rep already has is never targeted again",
    file: "apps/worker/src/jobs/targeting.ts",
    from: "const unknown = page.items.filter((c) => !known.has(normalizeLinkedInUrl(c.linkedinUrl)));",
    to: "const unknown = page.items;",
    pkg: "@le/worker",
  },
  {
    id: "targeting/fit-threshold",
    rule: "Nobody below the fit threshold is queued for outreach",
    file: "apps/worker/src/jobs/targeting.ts",
    from: "const shortlist = ranked.filter((r) => !r.disqualified && r.fitScore >= MIN_FIT_TO_QUEUE);",
    to: "const shortlist = ranked;",
    pkg: "@le/worker",
  },
  {
    id: "targeting/draft-not-running",
    rule: "A generated campaign waits for a human before it sends",
    file: "apps/worker/src/jobs/targeting.ts",
    from: '      status: "draft",',
    to: '      status: "running",',
    pkg: "@le/worker",
  },
  {
    id: "targeting/do-not-pursue",
    rule: "A profile marked do-not-pursue produces no campaign",
    file: "apps/worker/src/jobs/targeting.ts",
    from: "if (!profileRow || profileRow.do_not_pursue) return null;",
    to: "if (!profileRow) return null;",
    pkg: "@le/worker",
  },
  {
    id: "targeting/paused-account",
    rule: "No campaign is built on a paused or restricted account",
    file: "apps/worker/src/jobs/targeting.ts",
    from: 'if (!account?.provider_account_id || account.status !== "active") return null;',
    to: "if (!account?.provider_account_id) return null;",
    pkg: "@le/worker",
  },
  {
    id: "targeting/canonical-url",
    rule: "Prospects are stored canonically so later runs dedupe against them",
    file: "apps/worker/src/jobs/targeting.ts",
    from: "linkedin_url: normalizeLinkedInUrl(r.candidate.linkedinUrl),",
    to: "linkedin_url: r.candidate.linkedinUrl,",
    pkg: "@le/worker",
  },
  {
    id: "strategy/needs-input",
    rule: "The Strategy Agent refuses to invent an ICP from nothing",
    file: "packages/agents/src/strategy.ts",
    from: "if (!input.websiteUrl && !input.linkedinCompanyUrl && !input.description && !input.websiteText) {",
    to: "if (false) {",
    pkg: "@le/agents",
  },
  {
    id: "strategy/profiles-unapproved",
    rule: "Generated profiles wait for a human before targeting acts on them",
    file: "apps/worker/src/jobs/strategy.ts",
    from: "      priority: profile.priority,",
    to: "      priority: profile.priority,\n      approved_at: new Date().toISOString(),",
    pkg: "@le/worker",
  },
  {
    id: "crm/html-escaping",
    rule: "Prospect text cannot inject markup into a CRM note",
    file: "packages/crm/src/hubspot.ts",
    from: "return `<b>${who}</b><br><br>${escapeHtml(activity.body).replace(/\\n/g, \"<br>\")}`;",
    to: "return `<b>${who}</b><br><br>${activity.body}`;",
    pkg: "@le/crm",
  },
  {
    id: "connect/binds-the-provider-account",
    rule: "A finished hosted login binds the provider account, or nothing ever sends",
    file: "apps/worker/src/server.ts",
    from: "          provider_account_id: account.providerAccountId,",
    to: "          provider_account_id: null,",
    pkg: "@le/worker",
  },
  {
    id: "connect/no-rebinding",
    rule: "A replayed connection notice never repoints an account already working",
    file: "apps/worker/src/server.ts",
    from: '.in("status", ["connecting", "reauth_required", "restricted"])',
    to: '.not("status", "is", null)',
    pkg: "@le/worker",
  },
  {
    id: "connect/verified-deliveries-only",
    rule: "An unverifiable connection notice binds nothing",
    file: "apps/worker/src/server.ts",
    from: '      console.error("rejected account webhook", err);\n      return c.json({ error: "invalid signature" }, 401);',
    to: '      console.error("rejected account webhook", err);\n      accounts = [];',
    pkg: "@le/worker",
  },
  {
    id: "health/recovers-from-restriction",
    rule: "An account whose restriction lifts starts sending again",
    file: "apps/worker/src/accounts.ts",
    from: 'if (account.status !== "active" && account.status !== "connecting") {',
    to: 'if (account.status === "warning") {',
    pkg: "@le/worker",
  },
  {
    id: "acceptance/notices-a-connection",
    rule: "An accepted invitation is noticed, which is what starts the follow-up sequence",
    file: "apps/worker/src/jobs/acceptance.ts",
    from: "if (!providerId || !connected.has(providerId)) continue;",
    to: "if (true) continue;",
    pkg: "@le/worker",
  },
  {
    id: "acceptance/schedules-the-follow-up",
    rule: "Accepting schedules the first follow-up, not merely a status change",
    file: "apps/worker/src/jobs/acceptance.ts",
    from: "next_action_at: new Date(now.getTime() + delayDays * 86_400_000).toISOString(),",
    to: "next_action_at: null,",
    pkg: "@le/worker",
  },
  {
    id: "acceptance/withdrawn-invitations",
    rule: "A connection made long after a withdrawn invitation is not counted as accepting it",
    file: "apps/worker/src/jobs/acceptance.ts",
    from: '.gte("invited_at", oldest.toISOString())',
    to: '.not("invited_at", "is", null)',
    pkg: "@le/worker",
  },
  {
    id: "limiter/atomic-counters",
    rule: "Two sends at once are both counted, so an account cannot slip past its cap",
    file: "apps/worker/src/accounts.ts",
    from: 'const { error } = await db.rpc("record_linkedin_action", { p_account_id: accountId, p_kind: kind });',
    to: [
      'const { data: row } = await db',
      '    .from("linkedin_accounts")',
      '    .select("invites_today, invites_this_week, messages_today")',
      '    .eq("id", accountId)',
      "    .single();",
      "  const error = null;",
      "  if (row) {",
      '    await db.from("linkedin_accounts").update({',
      '      invites_today: kind === "invite" ? row.invites_today + 1 : row.invites_today,',
      '      invites_this_week: kind === "invite" ? row.invites_this_week + 1 : row.invites_this_week,',
      '      messages_today: kind === "message" ? row.messages_today + 1 : row.messages_today,',
      '    }).eq("id", accountId);',
      "  }",
    ].join("\n  "),
    pkg: "@le/worker",
  },
  {
    id: "limiter/uncounted-action",
    rule: "A counter write that fails is raised, never swallowed",
    file: "apps/worker/src/accounts.ts",
    from: "if (error) throw new Error(",
    to: "if (false) throw new Error(",
    pkg: "@le/worker",
  },
  {
    id: "digest/event-subject-types",
    rule: "A digest counts an event against the id space its subject actually lives in",
    file: "apps/worker/src/jobs/digest.ts",
    from: "const owned = mine[event.subject_type];",
    to: "const owned = mine.campaign_prospect;",
    pkg: "@le/worker",
  },
  {
    id: "digest/low-acceptance-warning",
    rule: "The low acceptance warning the nightly sweep records reaches the rep",
    file: "apps/worker/src/jobs/digest.ts",
    from: "  if (lowAcceptance) {",
    to: "  if (false) {",
    pkg: "@le/worker",
  },
  {
    id: "pricing/unpriced-is-not-free",
    rule: "A model we cannot price reports unknown cost, never zero",
    file: "packages/shared/src/pricing.ts",
    from: "if (!price) return null;",
    to: "if (!price) return 0;",
    pkg: "@le/shared",
  },
  {
    id: "pricing/never-rounds-a-cost-to-nothing",
    rule: "A real cost is never displayed as $0.00",
    file: "packages/shared/src/pricing.ts",
    from: "  if (Math.abs(amount) < 0.01) {",
    to: "  if (false) {",
    pkg: "@le/shared",
  },
  {
    id: "usage/partial-total-is-no-total",
    rule: "A spend total containing an unpriced call is reported as unknown",
    file: "apps/web/src/lib/usage.ts",
    from: "if (costUsd !== null) costUsd = row.cost_usd === null ? null : costUsd + row.cost_usd;",
    to: "costUsd = (costUsd ?? 0) + (row.cost_usd ?? 0);",
    pkg: "@le/web",
  },
  {
    id: "knowledge/no-truncation",
    rule: "A document too long for the prompt is left out whole, never trimmed to fit",
    file: "packages/agents/src/knowledge.ts",
    from: "    if (used + cost <= budget) {",
    to: "    if (true) {",
    pkg: "@le/agents",
  },
  {
    id: "knowledge/names-omissions",
    rule: "The agent is told which documents it has not read, so it hands off instead of guessing",
    file: "packages/agents/src/knowledge.ts",
    from: "  if (omitted.length === 0) return body;",
    to: "  return body;",
    pkg: "@le/agents",
  },
  {
    id: "holds/booking-survives-a-reply",
    rule: "Sending a reply never clears a hold asking someone to book a meeting by hand",
    file: "apps/worker/src/holds.ts",
    from: '    .eq("id", conversationId)\n    .eq("needs_human_kind", kind);',
    to: '    .eq("id", conversationId);',
    pkg: "@le/worker",
  },
  {
    id: "holds/undraftable-reply",
    rule: "A reply the agent could not draft is still put in front of a person",
    file: "apps/worker/src/jobs/inbound.ts",
    from: 'await flagForHuman(db, conversation.id, "could not draft a reply, answer this one yourself");',
    to: "// mutated",
    pkg: "@le/worker",
  },
  {
    id: "strategy/targeting-needs-approval",
    rule: "Targeting refuses a customer profile no human has approved",
    file: "apps/worker/src/jobs/targeting.ts",
    from: "if (!profileRow.approved_at) return null;",
    to: "if (false) return null;",
    pkg: "@le/worker",
  },
  {
    id: "strategy/empty-search",
    rule: "A search must have something to match on, or it returns anyone",
    file: "apps/web/src/lib/profile-form.ts",
    from: "    filters.keywords.length === 0",
    to: "    false",
    pkg: "@le/web",
  },
  {
    id: "launch/inactive-account",
    rule: "A campaign never launches from an account that is not connected and healthy",
    file: "apps/web/src/lib/campaign.ts",
    from: 'if (state.accountStatus !== "active") {',
    to: "if (false) {",
    pkg: "@le/web",
  },
  {
    id: "launch/cap-ceiling",
    rule: "A campaign may ask to send slower than the safe ceiling, never faster",
    file: "apps/web/src/lib/campaign.ts",
    from: "if (state.dailyInviteCap > LINKEDIN_LIMITS.invitesPerDayMax) {",
    to: "if (false) {",
    pkg: "@le/web",
  },
  {
    id: "launch/empty-message",
    rule: "A campaign never launches with a blank message in its sequence",
    file: "apps/web/src/lib/campaign.ts",
    from: "const blank = state.steps.findIndex((step) => !step.message.trim());",
    to: "const blank = -1;",
    pkg: "@le/web",
  },
  {
    id: "exclusions/send-time-check",
    rule: "An account added to the exclusion list stops sends already queued against it",
    file: "apps/worker/src/jobs/linkedin-action.ts",
    from: "  if (excluded) {",
    to: "  if (false) {",
    pkg: "@le/worker",
  },
  {
    id: "exclusions/targeting-filter",
    rule: "An excluded account never reaches the scoring model or a new campaign",
    file: "apps/worker/src/jobs/targeting.ts",
    from: "(c) => !matchExclusion(exclusions, { company: c.company, linkedinUrl: c.linkedinUrl }),",
    to: "() => true,",
    pkg: "@le/worker",
  },
  {
    id: "exclusions/company-normalization",
    rule: "One company written several ways is one account to the exclusion list",
    file: "packages/shared/src/exclusions.ts",
    from: 'return kind === "person" ? normalizeLinkedInUrl(raw) : normalizeCompany(raw);',
    to: "return raw;",
    pkg: "@le/shared",
  },
  {
    id: "funnel/cumulative-stages",
    rule: "A funnel stage counts everyone who passed it, not only those sitting on it",
    file: "packages/shared/src/funnel.ts",
    from: '{ key: "accepted", label: "Accepted", statuses: AT_LEAST_ACCEPTED },',
    to: '{ key: "accepted", label: "Accepted", statuses: ["accepted"] },',
    pkg: "@le/shared",
  },
  {
    id: "funnel/counts-what-happened",
    rule: "A stage that happened stays counted after a terminal status overwrites it",
    file: "packages/shared/src/funnel.ts",
    from: "const invited = accepted || (row.invited_at || at(\"invited\") ? 1 : 0);",
    to: 'const invited = accepted || (at("invited") ? 1 : 0);',
    pkg: "@le/shared",
  },
  {
    id: "funnel/monotonic",
    rule: "Reaching a later stage implies every earlier one, whatever the row says",
    file: "packages/shared/src/funnel.ts",
    from: "const accepted = replied || (row.accepted_at || at(\"accepted\") ? 1 : 0);",
    to: 'const accepted = row.accepted_at || at("accepted") ? 1 : 0;',
    pkg: "@le/shared",
  },
  {
    id: "funnel/min-sample",
    rule: "A rate is withheld until there is enough of a sample to mean anything",
    file: "packages/shared/src/funnel.ts",
    from: "counts.invited >= MIN_FOR_RATE ? counts.accepted / counts.invited : null",
    to: "counts.accepted / counts.invited",
    pkg: "@le/shared",
  },
  {
    id: "lifecycle/nudge-once",
    rule: "A step is nudged once and never again — repetition is what makes a reminder spam",
    file: "apps/worker/src/jobs/lifecycle.ts",
    from: "const eventName = `onboarding.nudged.${step.key}`;",
    to: "const eventName = `onboarding.nudged.${step.key}.${Math.random()}`;",
    pkg: "@le/worker",
  },
  {
    id: "lifecycle/grace-days",
    rule: "Nobody is nudged in their first days — someone who signed up an hour ago is reading, not stalled",
    file: "apps/worker/src/jobs/lifecycle.ts",
    from: "if (daysIn < GRACE_DAYS) return 0;",
    to: "if (false) return 0;",
    pkg: "@le/worker",
  },
  {
    id: "lifecycle/no-trial-dunning",
    rule: "A workspace that has already subscribed is never warned that its trial is ending",
    file: "apps/worker/src/jobs/lifecycle.ts",
    from: 'if (workspace.subscription_status === "active" || !workspace.trial_ends_at) return 0;',
    to: "if (false) return 0;",
    pkg: "@le/worker",
  },
  {
    id: "onboarding/welcome-once",
    rule: "The welcome email is sent once per workspace, however often strategy is re-run",
    file: "apps/worker/src/jobs/strategy.ts",
    from: "if (already) return;",
    to: "if (false) return;",
    pkg: "@le/worker",
  },
  {
    id: "booking/first-meeting-only",
    rule: "The meeting email announces the first booking only, never every one",
    file: "apps/worker/src/jobs/booking.ts",
    from: "if ((count ?? 0) !== 1) return;",
    to: "if (false) return;",
    pkg: "@le/worker",
  },
];

const filter = process.argv[2];
const selected = filter ? MUTATIONS.filter((m) => m.id.includes(filter)) : MUTATIONS;

if (selected.length === 0) {
  console.error(`No mutations match "${filter}"`);
  process.exit(2);
}

console.log(`Running ${selected.length} mutations\n`);

const survived = [];
const inapplicable = [];

for (const mutation of selected) {
  const original = readFileSync(mutation.file, "utf8");

  if (!original.includes(mutation.from)) {
    // The code moved and the mutation no longer describes it. That is a
    // failure of this file, not of the tests, and it must be loud: a stale
    // mutation silently stops checking anything.
    inapplicable.push(mutation);
    console.log(`  STALE     ${mutation.id} — target text not found in ${mutation.file}`);
    continue;
  }

  writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));

  let caught = false;
  try {
    execSync(`pnpm --filter ${mutation.pkg} test`, { stdio: "pipe" });
  } catch {
    // A non-zero exit means a test failed, which is what we want.
    caught = true;
  } finally {
    writeFileSync(mutation.file, original);
  }

  if (caught) {
    console.log(`  caught    ${mutation.id}`);
  } else {
    survived.push(mutation);
    console.log(`  SURVIVED  ${mutation.id} — ${mutation.rule}`);
  }
}

console.log(`\n${selected.length - survived.length - inapplicable.length}/${selected.length} caught`);

if (survived.length) {
  console.log("\nUnguarded rules — a test should fail when each of these breaks:");
  for (const mutation of survived) console.log(`  ${mutation.id}: ${mutation.rule}`);
}
if (inapplicable.length) {
  console.log("\nStale mutations — update scripts/mutation-check.mjs to match the code:");
  for (const mutation of inapplicable) console.log(`  ${mutation.id} (${mutation.file})`);
}

process.exit(survived.length + inapplicable.length > 0 ? 1 : 0);
