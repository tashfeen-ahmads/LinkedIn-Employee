import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { blankAgent, isSelectableModel } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

/**
 * The agents a workspace keeps.
 *
 * One agent owns everything a prospect reads: the model, the voice, the
 * openers, the offer, the playbook and the facts it may use. Before this the
 * same decision was spread over three screens — "Opener & pitch", "Knowledge
 * base" — and a prompt constant in the repo that nobody outside it could see.
 * A rep who wanted the messages to sound different had no single place to go,
 * and no way to find out what a change would produce before a stranger read it.
 *
 * A campaign points at one. Everything an agent gathers keeps the rules it
 * already had: an opener and an offer line are still approved one at a time and
 * still retire without deleting (rule 40), because those are what stand between
 * a line nobody read and a real person.
 */

async function createAgent() {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.userId)
    .maybeSingle();

  // Not a blank form. An agent with no voice produces exactly the unanchored
  // copy this screen exists to replace, and a rep handed an empty box has been
  // given the problem rather than a starting point.
  const seed = blankAgent(profile?.full_name ?? null);

  const { data, error } = await supabase
    .from("agents")
    .insert({
      workspace_id: session.workspaceId,
      name: seed.name,
      model: seed.model,
      system_prompt: seed.systemPrompt,
      from_name: seed.fromName,
      playbook: seed.playbook as never,
      custom_fields: seed.customFields as never,
      // The first agent a workspace makes is the one new campaigns start with.
      // "Which agent" answered by row order is answered differently on
      // different days.
      is_default: await isFirstAgent(supabase, session.workspaceId),
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(errorQuery("/app/agents", error?.message ?? "The agent could not be created."));
  }
  redirect(`/app/agents/${data.id}`);
}

async function isFirstAgent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("agents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .limit(1);
  return (data ?? []).length === 0;
}

async function makeDefault(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect(errorQuery("/app/agents", "No agent was named."));

  // Cleared first, because `agents_one_default` is a unique index and two
  // defaults is a state the database will not hold — which is the point of it.
  await supabase
    .from("agents")
    .update({ is_default: false })
    .eq("workspace_id", session.workspaceId)
    .eq("is_default", true);
  const { error } = await supabase
    .from("agents")
    .update({ is_default: true })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/agents", error.message));
  revalidatePath("/app/agents");
  redirect(noticeQuery("/app/agents", "New campaigns will start with this agent."));
}

async function archiveAgent(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");

  // Retired, never deleted — rule 36's reason. A campaign that ran on this
  // agent still has to be able to say what it was, and its results are the
  // record of what that agent actually produced.
  const { error } = await supabase
    .from("agents")
    .update({ archived_at: new Date().toISOString(), is_default: false })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/agents", error.message));
  revalidatePath("/app/agents");
  redirect(noticeQuery("/app/agents", "Retired. Campaigns that used it keep their history."));
}

export default async function AgentsPage({ searchParams }: { searchParams: Promise<NoticeParams> }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, model, from_name, is_default, updated_at")
    .eq("workspace_id", session.workspaceId)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });

  const ids = (agents ?? []).map((a) => a.id);

  // Counted separately rather than through an embedded join: PostgREST returns
  // the related row and the worker's in-memory double cannot, so the shape is
  // kept to what both can answer (see the testing note in CLAUDE.md).
  const [{ data: openers }, { data: offers }, { data: campaigns }] = await Promise.all([
    ids.length
      ? supabase.from("hooks").select("agent_id, approved_at").in("agent_id", ids)
      : Promise.resolve({ data: [] as Array<{ agent_id: string | null; approved_at: string | null }> }),
    ids.length
      ? supabase.from("pitches").select("agent_id, approved_at").in("agent_id", ids)
      : Promise.resolve({ data: [] as Array<{ agent_id: string | null; approved_at: string | null }> }),
    ids.length
      ? supabase.from("campaigns").select("agent_id").in("agent_id", ids)
      : Promise.resolve({ data: [] as Array<{ agent_id: string | null }> }),
  ]);

  const approvedBy = (rows: Array<{ agent_id: string | null; approved_at: string | null }> | null) => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      if (!row.agent_id || !row.approved_at) continue;
      counts.set(row.agent_id, (counts.get(row.agent_id) ?? 0) + 1);
    }
    return counts;
  };
  const openerCounts = approvedBy(openers);
  const offerCounts = approvedBy(offers);
  const campaignCounts = new Map<string, number>();
  for (const row of campaigns ?? []) {
    if (!row.agent_id) continue;
    campaignCounts.set(row.agent_id, (campaignCounts.get(row.agent_id) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Agents"
        lede="An agent is everything a prospect reads: how it writes, what it opens with, what it offers, and what it is trying to find out. A campaign picks one."
        actions={
          <form action={createAgent}>
            <SubmitButton pendingLabel="Creating…">New agent</SubmitButton>
          </form>
        }
      />

      <PageNotice error={params.error} notice={params.notice} />

      <Section
        id="agents"
        title="Your agents"
        description="Openers and offer lines are still approved one at a time. Nothing unapproved ever opens a conversation."
      >
        {(agents ?? []).length === 0 ? (
          <Empty title="No agents yet">
            An agent carries the voice, the opener, the offer and the playbook your campaigns run
            on. Make one, train it on your own words, and test it against a real prospect before a
            stranger reads anything.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Model</th>
                <th scope="col">Openers</th>
                <th scope="col">Offer lines</th>
                <th scope="col">Campaigns</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(agents ?? []).map((agent) => {
                const openerCount = openerCounts.get(agent.id) ?? 0;
                const offerCount = offerCounts.get(agent.id) ?? 0;
                return (
                  <tr key={agent.id}>
                    <td>
                      <Link href={`/app/agents/${agent.id}`}>{agent.name}</Link>
                      {agent.is_default ? <span className="small subtle"> · default</span> : null}
                      {agent.from_name ? (
                        <div className="small muted">Writes as {agent.from_name}</div>
                      ) : null}
                    </td>
                    <td>
                      {/* A model nobody can price cannot be run, because its spend
                          reports as null and a reader takes that for free. */}
                      {isSelectableModel(agent.model) ? (
                        agent.model
                      ) : (
                        <span className="small warn">Pick a model</span>
                      )}
                    </td>
                    <td className="num">{openerCount || <span className="small warn">none</span>}</td>
                    <td className="num">{offerCount}</td>
                    <td className="num">{campaignCounts.get(agent.id) ?? 0}</td>
                    <td className="row-actions">
                      {agent.is_default ? null : (
                        <form action={makeDefault}>
                          <input type="hidden" name="id" value={agent.id} />
                          <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                            Make default
                          </SubmitButton>
                        </form>
                      )}
                      <form action={archiveAgent}>
                        <input type="hidden" name="id" value={agent.id} />
                        <SubmitButton className="btn secondary small" pendingLabel="Retiring…">
                          Retire
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
