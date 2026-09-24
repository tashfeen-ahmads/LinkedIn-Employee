import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AgentPlaybookSchema,
  CustomFieldSchema,
  DEFAULT_OPENER_TEMPLATE,
  HOOK_MAX_CHARS,
  MERGE_FIELDS,
  PITCH_MAX_CHARS,
  SELECTABLE_MODELS,
  agentGaps,
  isReservedFieldKey,
  isSelectableModel,
  type AgentPlaybook,
  type CustomField,
} from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { PageHeader, PageGroup, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

/**
 * One agent, and everything it needs to be worth putting in front of a stranger.
 *
 * Six things on one screen, in the order a rep actually decides them: who it is
 * and which model it runs on, how it writes, what it opens with, what it
 * offers, what it is trying to find out, and what it is allowed to know. Those
 * used to be three separate screens and a constant in the repo.
 *
 * The parts keep their own rules. An opener and an offer line are approved one
 * at a time and editing the words clears the approval in a database trigger,
 * not in whichever action happened to save them (rule 40) — an approval is a
 * statement about particular text, and without that one approval in September
 * authorises every rewrite after it.
 */

function parsePlaybook(value: unknown): AgentPlaybook {
  const parsed = AgentPlaybookSchema.safeParse(value ?? {});
  // A row written before a field existed, or one an older build stored, still
  // has to render. Defaults rather than a crash.
  return parsed.success ? parsed.data : AgentPlaybookSchema.parse({});
}

function parseCustomFields(value: unknown): CustomField[] {
  if (!Array.isArray(value)) return [];
  const out: CustomField[] = [];
  for (const entry of value) {
    const parsed = CustomFieldSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

async function loadAgent(id: string) {
  const session = await requireSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("agents")
    .select("id, name, model, system_prompt, from_name, playbook, custom_fields, is_default, archived_at")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  return { session, supabase, agent: data };
}

async function saveIdentity(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const { session, supabase } = await loadAgent(id);
  const here = `/app/agents/${id}`;

  const name = String(formData.get("name") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const fromName = String(formData.get("from_name") ?? "").trim();
  const systemPrompt = String(formData.get("system_prompt") ?? "").trim();

  if (!name) redirect(errorQuery(here, "Give the agent a name you will recognise in a picker."));
  // Checked here as well as offered in the select, because a form posts
  // whatever it posts. A model missing from the price table costs null and
  // never zero, and a reader takes a null cost for a free one.
  if (!isSelectableModel(model)) redirect(errorQuery(here, "Pick a model this deployment can price."));

  const { error } = await supabase
    .from("agents")
    .update({
      name,
      model,
      from_name: fromName || null,
      system_prompt: systemPrompt || null,
    })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery(here, error.message));
  revalidatePath(here);
  redirect(noticeQuery(here, "Saved."));
}

async function savePlaybook(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const { session, supabase } = await loadAgent(id);
  const here = `/app/agents/${id}`;

  // One question per line, which is how somebody actually writes a list of
  // things they need to know. A row of inputs for a list whose length nobody
  // knows in advance is a form people abandon.
  const asked = String(formData.get("qualification") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
  const required = new Set(formData.getAll("required").map(String));

  const playbook: AgentPlaybook = {
    objective: String(formData.get("objective") ?? "").trim().slice(0, 500),
    qualification: asked.map((ask) => ({ ask: ask.slice(0, 200), required: required.has(ask) })),
    handOver: String(formData.get("hand_over") ?? "").trim().slice(0, 500),
    avoid: String(formData.get("avoid") ?? "").trim().slice(0, 500),
  };

  const parsed = AgentPlaybookSchema.safeParse(playbook);
  if (!parsed.success) redirect(errorQuery(here, parsed.error.issues[0]?.message ?? "That playbook is not valid."));

  const { error } = await supabase
    .from("agents")
    .update({ playbook: parsed.data as never })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery(here, error.message));
  revalidatePath(here);
  redirect(noticeQuery(here, "Playbook saved."));
}

async function addCustomField(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const { session, supabase, agent } = await loadAgent(id);
  const here = `/app/agents/${id}`;
  if (!agent) notFound();

  const key = String(formData.get("key") ?? "").trim().toLowerCase();
  const label = String(formData.get("label") ?? "").trim();
  const fallback = String(formData.get("fallback") ?? "").trim();

  // A field that shadows one the product already fills would be read by
  // `renderMerge` as the built-in and silently ignored — a setting that exists
  // and changes nothing.
  if (isReservedFieldKey(key)) {
    redirect(errorQuery(here, `${key} is already filled from the prospect's own record.`));
  }
  const parsed = CustomFieldSchema.safeParse({ key, label, fallback });
  if (!parsed.success) {
    redirect(errorQuery(here, parsed.error.issues[0]?.message ?? "That field is not valid."));
  }

  const existing = parseCustomFields(agent.custom_fields);
  if (existing.some((f) => f.key === parsed.data.key)) {
    redirect(errorQuery(here, `${parsed.data.key} is already on this agent.`));
  }

  const { error } = await supabase
    .from("agents")
    .update({ custom_fields: [...existing, parsed.data] as never })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery(here, error.message));
  revalidatePath(here);
  redirect(noticeQuery(here, `{{${parsed.data.key}}} is available in this agent's copy.`));
}

async function removeCustomField(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("key") ?? "");
  const { session, supabase, agent } = await loadAgent(id);
  const here = `/app/agents/${id}`;
  if (!agent) notFound();

  const kept = parseCustomFields(agent.custom_fields).filter((f) => f.key !== key);
  await supabase
    .from("agents")
    .update({ custom_fields: kept as never })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath(here);
  redirect(noticeQuery(here, `Removed {{${key}}}. Copy still using it will show the placeholder.`));
}

/**
 * Ask the agent to write its own openers or offer lines.
 *
 * This is the part of "train the agent" that was reachable from nowhere. The
 * writers existed and ran well — they were behind a screen that had been taken
 * out of the navigation, so the only way to give an agent copy was to type it,
 * and the business profile the product spent onboarding collecting was read by
 * nothing on this page.
 *
 * It writes and does not approve (rule 40). Every line comes back waiting for
 * somebody to read it, which is the whole reason the approval step exists — the
 * last two generations this deployment ran produced a mangled acronym and a
 * product claim in a connection request, and both were caught by a person
 * looking at them.
 *
 * Scoped to this agent, so a rewrite here cannot delete another agent's drafts.
 */
async function writeLines(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const { session } = await loadAgent(id);
  const here = `/app/agents/${id}`;
  const table = String(formData.get("table") ?? "");
  const openers = table === "hooks";
  const instruction = String(formData.get("instruction") ?? "").trim();

  // Ninety seconds rather than the ten a queue-and-return route needs: the
  // writer runs on this request so the person who clicked sees what it
  // produced, and a working agent cut off at ten seconds reads as a broken one.
  const result = await callWorker<{ ok: boolean; reason?: string; written?: number }>(
    openers ? "/jobs/write-hooks" : "/jobs/write-pitch",
    {
      workspaceId: session.workspaceId,
      userId: session.userId,
      agentId: id,
      instruction: instruction || undefined,
    },
    90_000,
  );

  if (!result.ok) redirect(errorQuery(here, result.error));
  if (result.data && result.data.ok === false) {
    redirect(errorQuery(here, result.data.reason ?? "The agent could not write those."));
  }

  revalidatePath(here);
  redirect(
    noticeQuery(
      here,
      `Wrote ${result.data?.written ?? 0} ${openers ? "openers" : "offer lines"}. Read them before approving — they go to real people.`,
    ),
  );
}

async function addOpener(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const { session, supabase } = await loadAgent(id);
  const here = `/app/agents/${id}`;

  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(errorQuery(here, "Write the opening line."));

  // Checked in code, not left to a schema. LinkedIn refuses the whole
  // invitation at 200 characters and the note still has to say one specific
  // thing about the person (rule 16), so an opener that fills the note leaves
  // nothing for them.
  if (body.length > HOOK_MAX_CHARS) {
    redirect(errorQuery(here, `An opener has to fit in ${HOOK_MAX_CHARS} characters. That one is ${body.length}.`));
  }

  const { error } = await supabase.from("hooks").insert({
    workspace_id: session.workspaceId,
    agent_id: id,
    name: name || body.slice(0, 40),
    body,
    written_by: "human",
    // Written here and approved here in one step, because the person typing it
    // is the person who approves it. That is not true of an agent-written line,
    // which is why `written_by` is recorded.
    approved_at: new Date().toISOString(),
    approved_by: session.userId,
  });

  if (error) redirect(errorQuery(here, error.message));
  revalidatePath(here);
  redirect(noticeQuery(here, "Opener added."));
}

async function addOffer(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const { session, supabase } = await loadAgent(id);
  const here = `/app/agents/${id}`;

  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(errorQuery(here, "Write the offer line."));
  if (body.length > PITCH_MAX_CHARS) {
    redirect(
      errorQuery(here, `An offer line has to fit in ${PITCH_MAX_CHARS} characters. That one is ${body.length}.`),
    );
  }

  const { error } = await supabase.from("pitches").insert({
    workspace_id: session.workspaceId,
    agent_id: id,
    name: name || body.slice(0, 40),
    body,
    written_by: "human",
    approved_at: new Date().toISOString(),
    approved_by: session.userId,
  });

  if (error) redirect(errorQuery(here, error.message));
  revalidatePath(here);
  redirect(noticeQuery(here, "Offer line added."));
}

async function approveLine(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const table = String(formData.get("table") ?? "");
  const lineId = String(formData.get("line") ?? "");
  const { session, supabase } = await loadAgent(id);
  const here = `/app/agents/${id}`;
  if (table !== "hooks" && table !== "pitches") redirect(errorQuery(here, "Unknown line."));

  /*
   * The seeded lines arrive written and unapproved, and this is the click that
   * arms them.
   *
   * Seeding them approved would have saved this click and made the approval
   * screen decorative on the one screen where it matters most — the first
   * thing a stranger ever reads from this workspace. An approval is a
   * statement that a person read those exact words (rule 40), and nobody had.
   * Editing them clears it again, in a trigger rather than here, because an
   * approval is about particular text.
   */
  const { error } = await supabase
    .from(table)
    .update({ approved_at: new Date().toISOString(), approved_by: session.userId })
    .eq("id", lineId)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery(here, error.message));
  revalidatePath(here);
  redirect(noticeQuery(here, "Approved. The agent may use it now."));
}

async function retireLine(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const table = String(formData.get("table") ?? "");
  const lineId = String(formData.get("line") ?? "");
  const { session, supabase } = await loadAgent(id);
  const here = `/app/agents/${id}`;
  if (table !== "hooks" && table !== "pitches") redirect(errorQuery(here, "Unknown line."));

  // Un-approved rather than deleted. The line stays readable beside the
  // campaigns that used it, which is the only way to answer "what did we
  // actually send these people".
  await supabase
    .from(table)
    .update({ approved_at: null, approved_by: null, is_default: false })
    .eq("id", lineId)
    .eq("workspace_id", session.workspaceId);

  revalidatePath(here);
  redirect(noticeQuery(here, "Retired. It stays on record for campaigns that used it."));
}

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<NoticeParams>;
}) {
  const { id } = await params;
  const notice = await searchParams;
  const { session, supabase, agent } = await loadAgent(id);
  if (!agent) notFound();

  const [{ data: openers }, { data: offers }, { data: documents }] = await Promise.all([
    supabase
      .from("hooks")
      .select("id, name, body, angle, approved_at, written_by")
      .eq("agent_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("pitches")
      .select("id, name, body, approved_at, written_by")
      .eq("agent_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("knowledge_documents")
      .select("id, title, agent_id")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false }),
  ]);

  const playbook = parsePlaybook(agent.playbook);
  const customFields = parseCustomFields(agent.custom_fields);
  const approvedOpeners = (openers ?? []).filter((o) => o.approved_at);
  const approvedOffers = (offers ?? []).filter((o) => o.approved_at);
  // Written and waiting on a person. Shown first, because an agent that cannot
  // send yet and does not say why is the disease this whole product keeps
  // re-learning.
  const pendingOpeners = (openers ?? []).filter((o) => !o.approved_at);
  const pendingOffers = (offers ?? []).filter((o) => !o.approved_at);
  const gaps = agentGaps(
    {
      name: agent.name,
      model: agent.model,
      systemPrompt: agent.system_prompt,
      fromName: agent.from_name,
      playbook,
      customFields,
    },
    { approvedOpeners: approvedOpeners.length, approvedPitches: approvedOffers.length },
  );

  const allFields = [...MERGE_FIELDS, ...customFields.map((f) => f.key)];

  return (
    <>
      <PageHeader
        eyebrow="Agents"
        title={agent.name}
        lede="Everything a prospect reads comes from here. Test it against a real person before a campaign uses it."
        actions={
          <Link className="btn secondary" href={`/app/agents/${id}/test`}>
            Test this agent
          </Link>
        }
      />

      <PageNotice error={notice.error} notice={notice.notice} />

      {gaps.length > 0 ? (
        <div className="notice warn" role="status">
          <p>
            <strong>Not ready for a campaign yet.</strong> This agent still needs {gaps.join(", ")}.
          </p>
        </div>
      ) : null}

      <Section id="identity" title="Who it is" description="The name a prospect reads, and the model it runs on.">
        <form action={saveIdentity} className="stack">
          <input type="hidden" name="id" value={id} />
          <label className="field">
            <span>Agent name</span>
            <input name="name" defaultValue={agent.name} maxLength={80} required />
            <span className="small muted">Yours, not the prospect&rsquo;s. It never appears in a message.</span>
          </label>
          <label className="field">
            <span>Writes as</span>
            <input name="from_name" defaultValue={agent.from_name ?? ""} maxLength={80} />
            <span className="small muted">
              The name in the message. &ldquo;Tashfeen&rdquo; reads like a person; a full legal name reads
              like a signature block.
            </span>
          </label>
          <label className="field">
            <span>Model</span>
            <select name="model" defaultValue={agent.model ?? ""}>
              <option value="">Pick a model…</option>
              {SELECTABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <span className="small muted">
              Only models this deployment can price. Spend is on the overview.
            </span>
          </label>
          <label className="field">
            <span>How it writes</span>
            <textarea name="system_prompt" rows={6} defaultValue={agent.system_prompt ?? ""} maxLength={4000} />
            <span className="small muted">
              Voice, audience, and what to avoid — in your words. This is the difference between copy
              that sounds like you and copy that sounds like software.
            </span>
          </label>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </form>
      </Section>

      <PageGroup id="copy">
        <Section
          title="Openers"
          description={`The first line a stranger reads, up to ${HOOK_MAX_CHARS} characters. Shapes to lean on — the note is still written for the person receiving it.`}
        >
          {/* Written by the product from your onboarding answers, waiting on one
              click. A line nobody has read never opens a conversation. */}
          {pendingOpeners.map((opener) => (
            <div className="notice" role="status" key={opener.id}>
              <p>
                <strong>Ready to approve.</strong> {opener.body}
              </p>
              <form action={approveLine}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="table" value="hooks" />
                <input type="hidden" name="line" value={opener.id} />
                <SubmitButton className="btn small" pendingLabel="Approving…">
                  Approve this opener
                </SubmitButton>
              </form>
            </div>
          ))}

          {approvedOpeners.length === 0 && pendingOpeners.length === 0 ? (
            <Empty title="No openers yet">
              Without one the agent writes from nothing and every note reads the same. A plain,
              recognisable line beats a clever one: <code>{DEFAULT_OPENER_TEMPLATE}</code>
            </Empty>
          ) : approvedOpeners.length === 0 ? null : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Opener</th>
                  <th scope="col">Written by</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {approvedOpeners.map((opener) => (
                  <tr key={opener.id}>
                    <td>
                      {opener.body}
                      {opener.angle ? <div className="small muted">{opener.angle}</div> : null}
                    </td>
                    <td className="small muted">{opener.written_by}</td>
                    <td className="row-actions">
                      <form action={retireLine}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="table" value="hooks" />
                        <input type="hidden" name="line" value={opener.id} />
                        <SubmitButton className="btn secondary small" pendingLabel="Retiring…">
                          Retire
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form action={writeLines} className="stack">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="table" value="hooks" />
            <label className="field">
              <span>Write some with the agent</span>
              <input
                name="instruction"
                maxLength={2000}
                defaultValue=""
                placeholder="Optional: what to change about the ones on screen"
              />
              <span className="small muted">
                Written from your business profile and your approved strategies, and approved by
                nobody — they arrive here for you to read first.
              </span>
            </label>
            <SubmitButton className="btn secondary" pendingLabel="Writing…">
              Write openers
            </SubmitButton>
          </form>

          <form action={addOpener} className="stack">
            <input type="hidden" name="id" value={id} />
            <label className="field">
              <span>New opener</span>
              <input name="body" maxLength={HOOK_MAX_CHARS} defaultValue="" placeholder={DEFAULT_OPENER_TEMPLATE} />
              <span className="small muted">
                Merge fields available: {allFields.map((f) => `{{${f}}}`).join(", ")}
              </span>
            </label>
            <SubmitButton className="btn secondary" pendingLabel="Adding…">
              Add opener
            </SubmitButton>
          </form>
        </Section>

        <Section
          title="The offer"
          description={`What this agent says when somebody asks what it is, in ${PITCH_MAX_CHARS} characters or fewer. Never sent in a connection request.`}
        >
          {pendingOffers.map((offer) => (
            <div className="notice" role="status" key={offer.id}>
              <p>
                <strong>Ready to approve.</strong> {offer.body}
              </p>
              <form action={approveLine}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="table" value="pitches" />
                <input type="hidden" name="line" value={offer.id} />
                <SubmitButton className="btn small" pendingLabel="Approving…">
                  Approve this offer
                </SubmitButton>
              </form>
            </div>
          ))}

          {approvedOffers.length === 0 && pendingOffers.length === 0 ? (
            <Empty title="No offer line yet">
              Without one the agent argues for the product from the business profile and does it
              slightly differently every time — so every prospect who asks &ldquo;what is this?&rdquo;
              hears a different proposition, and none of them was read by anyone.
            </Empty>
          ) : approvedOffers.length === 0 ? null : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Offer line</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {approvedOffers.map((offer) => (
                  <tr key={offer.id}>
                    <td>{offer.body}</td>
                    <td className="row-actions">
                      <form action={retireLine}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="table" value="pitches" />
                        <input type="hidden" name="line" value={offer.id} />
                        <SubmitButton className="btn secondary small" pendingLabel="Retiring…">
                          Retire
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form action={writeLines} className="stack">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="table" value="pitches" />
            <label className="field">
              <span>Write some with the agent</span>
              <input
                name="instruction"
                maxLength={2000}
                defaultValue=""
                placeholder="Optional: what to change about the ones on screen"
              />
              <span className="small muted">
                Written from your business profile and your knowledge base. Nothing is approved
                until you approve it.
              </span>
            </label>
            <SubmitButton className="btn secondary" pendingLabel="Writing…">
              Write offer lines
            </SubmitButton>
          </form>

          <form action={addOffer} className="stack">
            <input type="hidden" name="id" value={id} />
            <label className="field">
              <span>New offer line</span>
              <input name="body" maxLength={PITCH_MAX_CHARS} defaultValue="" />
              <span className="small muted">
                Spoken into a chat window on a phone, two seconds after somebody asked what this is.
                A paragraph there is skimmed and then ignored.
              </span>
            </label>
            <SubmitButton className="btn secondary" pendingLabel="Adding…">
              Add offer line
            </SubmitButton>
          </form>
        </Section>
      </PageGroup>

      <Section
        id="playbook"
        title="Playbook"
        description="What it is trying to achieve, what it needs to find out, and when it stops and asks for you."
      >
        <form action={savePlaybook} className="stack">
          <input type="hidden" name="id" value={id} />
          <label className="field">
            <span>What this agent is for</span>
            <textarea name="objective" rows={2} defaultValue={playbook.objective} maxLength={500} />
          </label>
          <label className="field">
            <span>Qualification questions</span>
            <textarea
              name="qualification"
              rows={5}
              defaultValue={playbook.qualification.map((q) => q.ask).join("\n")}
              placeholder={"One per line\nDo they run a chapter?\nHow many members?"}
            />
            <span className="small muted">
              What it needs to learn before a conversation is worth your time. One per line.
            </span>
          </label>
          <label className="field">
            <span>Hand over to a human when</span>
            <textarea name="hand_over" rows={3} defaultValue={playbook.handOver} maxLength={500} />
            <span className="small muted">
              Never the only thing that stops it. A message it is unsure of, and a prospect who asks
              for a person, are always held — the first because it does not know what was said, the
              second because they asked.
            </span>
          </label>
          <label className="field">
            <span>Never say</span>
            <textarea name="avoid" rows={2} defaultValue={playbook.avoid} maxLength={500} />
          </label>
          <SubmitButton pendingLabel="Saving…">Save playbook</SubmitButton>
        </form>
      </Section>

      <PageGroup id="data">
        <Section
          title="Custom fields"
          description="Merge fields filled from your own prospect data, on top of the ones every agent has."
        >
          <p className="small muted">
            Always available: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(", ")}
          </p>
          {customFields.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Means</th>
                  <th scope="col">When empty</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {customFields.map((field) => (
                  <tr key={field.key}>
                    <td>
                      <code>{`{{${field.key}}}`}</code>
                    </td>
                    <td>{field.label}</td>
                    <td className="small muted">
                      {field.fallback || <span className="warn">placeholder stays visible</span>}
                    </td>
                    <td className="row-actions">
                      <form action={removeCustomField}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="key" value={field.key} />
                        <SubmitButton className="btn secondary small" pendingLabel="Removing…">
                          Remove
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <form action={addCustomField} className="stack">
            <input type="hidden" name="id" value={id} />
            <label className="field">
              <span>Field name</span>
              <input name="key" placeholder="chapter_name" maxLength={40} />
            </label>
            <label className="field">
              <span>What it means</span>
              <input name="label" placeholder="The chapter they lead" maxLength={80} />
            </label>
            <label className="field">
              <span>When a prospect has no value</span>
              <input name="fallback" maxLength={120} />
              <span className="small muted">
                Leave blank to keep the placeholder visible, so it is caught on the review screen
                rather than by the prospect.
              </span>
            </label>
            <SubmitButton className="btn secondary" pendingLabel="Adding…">
              Add field
            </SubmitButton>
          </form>
        </Section>

        <Section
          title="What it may state as fact"
          description="Documents this agent can answer from. It never states a product fact that is not in one."
        >
          {(documents ?? []).length === 0 ? (
            <Empty title="No documents yet" action="Add one" href="/app/knowledge">
              Pricing, what the product does, the objections you hear. Without them the agent answers
              a pricing question from nothing, and a wrong price reaches a prospect looking exactly
              like a right one.
            </Empty>
          ) : (
            <ul className="list">
              {(documents ?? []).map((doc) => (
                <li key={doc.id}>
                  {doc.title}
                  {doc.agent_id === id ? null : <span className="small subtle"> · shared</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageGroup>
    </>
  );
}
