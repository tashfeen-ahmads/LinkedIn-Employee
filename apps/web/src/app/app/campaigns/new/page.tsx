import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CTA_DEFINITIONS,
  DEFAULT_OPENER_TEMPLATE,
  FIRST_STEP_DELAY_DAYS,
  FIRST_STEP_TIMING_LABEL,
  fieldsUsed,
  LINKEDIN_LIMITS,
} from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { SelectAll } from "@/components/select-all";

/**
 * A campaign built from a list you already have.
 *
 * Every campaign here used to begin with a fresh search: the Targeting Agent
 * ran a strategy, found people, and built the campaign around them in one
 * step. That is the right flow for finding somebody new and the wrong one for
 * everything else — a rep with four hundred prospects already in the workspace
 * had no way to run a second campaign over a chosen slice of them without
 * spending another search off a seat somebody pays for.
 *
 * So: name it, choose who is on it, choose what it asks for, choose the agent
 * that writes it, and say what stops it. Five decisions, in the order somebody
 * actually makes them.
 *
 * Who is offered is the load-bearing part. Anybody this workspace has already
 * contacted is not on the list, because nobody is approached twice under a
 * different pretext (rule 24) — and the send path checks again immediately
 * before the invitation anyway, because two campaigns built from the same list
 * can legitimately queue the same person.
 */

async function createCampaign(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();
  const here = "/app/campaigns/new";

  const name = String(formData.get("name") ?? "").trim();
  const agentId = String(formData.get("agent") ?? "").trim();
  const ctaId = String(formData.get("cta") ?? "").trim();
  const accountId = String(formData.get("account") ?? "").trim();
  const followUpDays = Number(formData.get("follow_up_days") ?? 3);
  const chosen = formData.getAll("prospect").map(String).filter(Boolean);

  if (!name) redirect(errorQuery(here, "Give the campaign a name you will recognise."));
  if (!accountId) redirect(errorQuery(here, "Connect a LinkedIn account before building a campaign."));
  if (chosen.length === 0) redirect(errorQuery(here, "Pick at least one person for this campaign."));
  if (!Number.isFinite(followUpDays) || followUpDays < 1 || followUpDays > 30) {
    redirect(errorQuery(here, "The follow-up wait has to be between 1 and 30 days."));
  }

  // The agent's own opener is the campaign's template note: the line every
  // prospect falls back to when the writer has not answered for them
  // individually. Without one the fallback is empty and the invitation goes
  // out with no note at all, which is ordinary on LinkedIn but is not what
  // anybody picking an agent expected.
  //
  // The default one, not whichever row came back first. An opener is chosen as
  // the default precisely so that a question like "which of these does this
  // workspace lead with" has one answer on every day rather than whichever
  // answer the row order happened to give.
  //
  // Greeted, unless the opener greets them itself. An opener is written to be
  // one line inside a note — most of them are a bare question — and a
  // connection request opening on a bare question, from a name the reader does
  // not know, reads as a mailshot. The two halves together are the shape this
  // product was actually asked for: name the person, name their company, then
  // ask the one thing.
  let template = DEFAULT_OPENER_TEMPLATE;
  if (agentId) {
    const { data: opener } = await supabase
      .from("hooks")
      .select("body, is_default")
      .eq("agent_id", agentId)
      .not("approved_at", "is", null)
      .order("is_default", { ascending: false })
      .limit(1);
    const line = opener?.[0]?.body?.trim();
    if (line) {
      template = fieldsUsed(line).includes("first_name")
        ? line
        : `${DEFAULT_OPENER_TEMPLATE} ${line}`;
    }
  }

  const { data: cta } = ctaId
    ? await supabase
        .from("ctas")
        .select("kind, label, url")
        .eq("id", ctaId)
        .eq("workspace_id", session.workspaceId)
        .maybeSingle()
    : { data: null };

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: session.workspaceId,
      linkedin_account_id: accountId,
      owner_user_id: session.userId,
      agent_id: agentId || null,
      name,
      // Draft, always. A campaign that launched itself the moment it was
      // created would skip the review this product is built on, and the review
      // is the only thing standing between a list and a real person's inbox.
      status: "draft",
      connection_note: template,
      cta_id: ctaId || null,
      cta_kind: (cta?.kind as "meeting" | "link" | "reply") ?? "reply",
      cta_label: cta?.label ?? null,
      cta_url: cta?.url ?? null,
      daily_invite_cap: LINKEDIN_LIMITS.invitesPerDayStart,
      stop_conditions: ["prospect replies", "prospect opts out"] as never,
      rules: { builtFrom: "prospect list" } as never,
    })
    .select("id")
    .single();

  if (error || !campaign) {
    redirect(errorQuery(here, error?.message ?? "The campaign could not be created."));
  }

  // Both steps in one statement. A campaign holding step 1 and not step 2
  // sends a follow-up and then silently stops, and a partial sequence is not a
  // state anybody can see from a screen.
  const { error: stepsError } = await supabase.from("campaign_steps").insert([
    {
      workspace_id: session.workspaceId,
      campaign_id: campaign.id,
      variant_id: null,
      step_number: 1,
      // Not configurable, and not stored as anything else (rule 43): what
      // precedes step 1 is the acceptance, not a message.
      delay_days: FIRST_STEP_DELAY_DAYS,
      message: `Hi {{first_name}}, thanks for connecting.`,
    },
    {
      workspace_id: session.workspaceId,
      campaign_id: campaign.id,
      variant_id: null,
      step_number: 2,
      delay_days: followUpDays,
      // A pointer rather than a copy of the words, so improving the agent's
      // offer improves every campaign using it without re-reviewing copy
      // somebody already approved.
      message: `{{pitch}}`,
    },
  ]);
  if (stepsError) redirect(errorQuery(here, stepsError.message));

  const { error: linkError } = await supabase.from("campaign_prospects").insert(
    chosen.map((prospectId) => ({
      workspace_id: session.workspaceId,
      campaign_id: campaign.id,
      prospect_id: prospectId,
      status: "queued" as const,
      // The template note, named as such. The personalised one is written by
      // the agent on the campaign screen before launch; leaving this null would
      // mean an invitation with no note at all if that never happens.
      invite_note: null,
    })),
  );
  if (linkError) redirect(errorQuery(here, linkError.message));

  redirect(
    noticeQuery(
      `/app/campaigns/${campaign.id}`,
      `${chosen.length} ${chosen.length === 1 ? "person" : "people"} queued. Read the notes before you launch.`,
    ),
  );
}

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<NoticeParams>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: agents }, { data: ctas }, { data: accounts }, { data: prospects }] =
    await Promise.all([
      supabase
        .from("agents")
        .select("id, name, is_default")
        .eq("workspace_id", session.workspaceId)
        .is("archived_at", null)
        .order("is_default", { ascending: false }),
      supabase
        .from("ctas")
        .select("id, name, kind")
        .eq("workspace_id", session.workspaceId)
        .is("archived_at", null),
      supabase
        .from("linkedin_accounts")
        .select("id, display_name, status")
        .eq("workspace_id", session.workspaceId)
        .eq("status", "active"),
      // Never contacted, because nobody is approached twice (rule 24). Showing
      // them greyed out would be worse than leaving them off: a list that
      // offers a person it will refuse to send to is a list that lies.
      supabase
        .from("prospects")
        .select("id, first_name, last_name, company, title, fit_score")
        .eq("workspace_id", session.workspaceId)
        .is("last_contacted_at", null)
        .eq("do_not_contact", false)
        .order("fit_score", { ascending: false, nullsFirst: false })
        .limit(200),
    ]);

  const defaultAgent = (agents ?? []).find((a) => a.is_default) ?? (agents ?? [])[0];

  return (
    <>
      <PageHeader
        eyebrow="Campaigns"
        title="New campaign"
        lede="Built from people you already have. Nothing sends until you have read it and pressed Launch."
        actions={
          <Link className="btn secondary" href="/app/campaigns">
            All campaigns
          </Link>
        }
      />

      <PageNotice error={params.error} notice={params.notice} />

      {(accounts ?? []).length === 0 ? (
        <Empty title="No LinkedIn account connected" action="Connect one" href="/app/profile">
          A campaign sends from an account. Connect yours and this page will have somewhere to send
          from.
        </Empty>
      ) : (prospects ?? []).length === 0 ? (
        <Empty title="Nobody left to add" action="Find prospects" href="/app/strategy">
          Everyone in this workspace has already been contacted, or is on the do-not-contact list.
          Run a strategy to find more.
        </Empty>
      ) : (
        <form action={createCampaign} className="stack">
          <Section title="What it is" description="A name for you, and who it sends from.">
            <label className="field">
              <span>Campaign name</span>
              <input name="name" maxLength={120} required />
            </label>
            <label className="field">
              <span>Sends from</span>
              <select name="account" defaultValue={(accounts ?? [])[0]?.id}>
                {(accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.display_name ?? "Your LinkedIn account"}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section
            title="What it asks for"
            description="The goal decides the copy, what the agent pursues in a reply, and what the funnel counts as success."
          >
            <label className="field">
              <span>Call to action</span>
              <select name="cta" defaultValue="">
                <option value="">Just start a conversation</option>
                {(ctas ?? []).map((cta) => (
                  <option key={cta.id} value={cta.id}>
                    {cta.name} — {CTA_DEFINITIONS[cta.kind as "meeting" | "link" | "reply"].label}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section
            title="Who writes it"
            description="The agent carries the voice, the opener, the offer and the playbook."
          >
            {(agents ?? []).length === 0 ? (
              <Empty title="No agents yet" action="Make one" href="/app/agents">
                A campaign needs an agent to write for it.
              </Empty>
            ) : (
              <label className="field">
                <span>Agent</span>
                <select name="agent" defaultValue={defaultAgent?.id ?? ""}>
                  {(agents ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </Section>

          <Section
            title="Follow-up"
            description="The first message goes out on acceptance. This is the wait before the one after it."
          >
            <p className="small muted">
              Message 1: {FIRST_STEP_TIMING_LABEL} — inside your sending hours, twenty to ninety
              minutes after they accept. That one is not adjustable: a message three days after
              somebody accepted reaches a stranger who has forgotten accepting.
            </p>
            <label className="field">
              <span>Days before message 2</span>
              <input name="follow_up_days" type="number" min={1} max={30} defaultValue={3} />
              <span className="small muted">
                It stops on its own if they reply or opt out.
              </span>
            </label>
          </Section>

          <Section
            title="Who is on it"
            description="Only people this workspace has never contacted. Ranked by fit."
            action={<SelectAll name="prospect" label={`Select all ${(prospects ?? []).length}`} />}
          >
            <div className="scroll-box">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Include</span>
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col">Company</th>
                    <th scope="col">Fit</th>
                  </tr>
                </thead>
                <tbody>
                  {(prospects ?? []).map((prospect) => (
                    <tr key={prospect.id}>
                      <td>
                        <input type="checkbox" name="prospect" value={prospect.id} />
                      </td>
                      <td>
                        {[prospect.first_name, prospect.last_name].filter(Boolean).join(" ")}
                        {prospect.title ? <div className="small muted">{prospect.title}</div> : null}
                      </td>
                      <td>{prospect.company ?? ""}</td>
                      <td className="num">{prospect.fit_score ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <SubmitButton pendingLabel="Building…">Create campaign</SubmitButton>
        </form>
      )}
    </>
  );
}
