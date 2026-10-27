import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CTA_DEFINITIONS, CTA_KINDS, CLICKS_ARE_INVISIBLE, checkCtaUrl, type CtaKind } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

/**
 * The calls to action a workspace keeps.
 *
 * A business does not have one ask. The same company runs a free-audit link, a
 * newsletter sign-up, a book-a-call and a product page, and each campaign used
 * to retype its own destination into three loose columns — so a URL corrected
 * in one place stayed wrong in four, with no screen able to say which
 * campaigns pointed where.
 *
 * Named once here, picked on a campaign. Rule 29's `{{cta_link}}` is
 * substituted at send time through the pointer, so fixing a typo fixes every
 * campaign using it without rewriting a message or re-reviewing copy somebody
 * already approved.
 */
async function saveCta(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "") as CtaKind;
  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();

  if (!name) redirect(errorQuery("/app/cta", "Give it a name you will recognize in a list."));
  if (!CTA_KINDS.includes(kind)) redirect(errorQuery("/app/cta", "Pick what this asks for."));

  // The same check the agent's drafts pass. A destination refused here can
  // never reach a prospect, which is the point of checking it at the door
  // rather than at the moment of sending.
  if (CTA_DEFINITIONS[kind].needsUrl) {
    const verdict = checkCtaUrl(url);
    if (!verdict.ok) redirect(errorQuery("/app/cta", verdict.reason));
  }

  /*
   * The goal of a call to action in use is fixed.
   *
   * A campaign copies its goal when it picks one (`campaigns.cta_kind`), and
   * its copy was written toward that ask (rule 29). Changing a link into a
   * meeting here cleared the destination every one of those campaigns reads
   * through the pointer at send time, so a message written around
   * `{{cta_link}}` went out with the placeholder in it, under "Updated
   * everywhere it is used". The destination and the wording still change in
   * place; a different ask is a different call to action.
   */
  if (id) {
    const [{ data: current }, { count: users }] = await Promise.all([
      supabase.from("ctas").select("kind").eq("id", id).eq("workspace_id", session.workspaceId).maybeSingle(),
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", session.workspaceId)
        .eq("cta_id", id),
    ]);
    if (!current) redirect(errorQuery("/app/cta", "That call to action is gone."));
    if (current.kind !== kind && (users ?? 0) > 0) {
      redirect(
        errorQuery(
          "/app/cta",
          `${users} campaign${users === 1 ? " was" : "s were"} written to ask for ${CTA_DEFINITIONS[current.kind as CtaKind].label.toLowerCase()}, so what this asks for cannot change. Add a new call to action for the new goal instead.`,
        ),
      );
    }
  }

  const row = {
    workspace_id: session.workspaceId,
    name,
    kind,
    label: label || null,
    // A goal that needs no destination keeps none, rather than carrying a
    // stale URL that a later change of kind would silently start sending.
    url: CTA_DEFINITIONS[kind].needsUrl ? url : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("ctas").update(row).eq("id", id).eq("workspace_id", session.workspaceId)
    : await supabase.from("ctas").insert({ ...row, created_by: session.userId });

  if (error) redirect(errorQuery("/app/cta", "That did not save. Please try again."));

  revalidatePath("/app/cta");
  redirect(noticeQuery("/app/cta", id ? "Updated everywhere it is used." : "Added."));
}

/**
 * Archives rather than deletes.
 *
 * A campaign that already used this destination still has to be able to say
 * what it pointed at — a row that vanishes takes the answer with it, and the
 * campaign's own record of what it sent stops making sense.
 */
async function archiveCta(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const restore = String(formData.get("restore") ?? "") === "1";

  const { data: changed, error } = await supabase
    .from("ctas")
    .update({ archived_at: restore ? null : new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .select("id");

  revalidatePath("/app/cta");
  if (error || !changed?.length) {
    redirect(errorQuery("/app/cta", restore ? "That did not restore. Please try again." : "That did not archive. Please try again."));
  }
  redirect(noticeQuery("/app/cta", restore ? "Back in the picker." : "Archived. Campaigns already using it are unchanged."));
}

export default async function CtaPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: ctas }, { data: campaigns }] = await Promise.all([
    supabase
      .from("ctas")
      .select("id, name, kind, label, url, archived_at")
      .eq("workspace_id", session.workspaceId)
      .order("name", { ascending: true }),
    supabase
      .from("campaigns")
      .select("id, name, cta_id, status")
      .eq("workspace_id", session.workspaceId),
  ]);

  // What each one is actually being used by. A destination you cannot see the
  // blast radius of is one nobody dares edit.
  const usage = new Map<string, string[]>();
  for (const campaign of campaigns ?? []) {
    if (!campaign.cta_id) continue;
    usage.set(campaign.cta_id, [...(usage.get(campaign.cta_id) ?? []), campaign.name]);
  }

  // A meeting with no destination of its own sends the sender's scheduling
  // link, or Nora's booking page without one. Said here, or "No destination"
  // reads as a call to action that was never picked up.
  const { data: me } = await supabase.from("profiles").select("booking_url").eq("id", session.userId).maybeSingle();
  const meetingGoesTo = me?.booking_url
    ? `Your scheduling link (${me.booking_url}), set on your profile`
    : "Your Nora booking page: each person gets their own link to pick a time";

  const live = (ctas ?? []).filter((c) => !c.archived_at);
  const archived = (ctas ?? []).filter((c) => c.archived_at);

  return (
    <>
      <PageHeader
        eyebrow="Setup"
        title="Calls to action"
        lede="What your campaigns ask for. Keep as many as you run: a campaign picks one, and changing a destination here changes it everywhere it is used."
      />

      <PageNotice error={params.error} notice={params.notice} />

      <Section
        id="add"
        title="Add one"
        description="A link to send, a call to book, or simply a reply. Name it once and any campaign can use it."
      >
        <div className="card">
          <form action={saveCta} className="stack-3">
            <div className="form-grid">
              <label className="field">
                <span>Name it</span>
                <input type="text" name="name" placeholder="Free teardown" maxLength={80} required />
                <span className="hint">What you will recognize in a list of twenty.</span>
              </label>
              <label className="field">
                <span>What it asks for</span>
                <select name="kind" defaultValue="link">
                  {CTA_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {CTA_DEFINITIONS[kind].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Destination</span>
                <input type="url" name="url" placeholder="https://example.com/teardown" />
                <span className="hint">
                  Needed for a link. Left empty for a meeting or a conversation.
                </span>
              </label>
              <label className="field">
                <span>How the message refers to it</span>
                <input type="text" name="label" placeholder="a 5-minute teardown" maxLength={80} />
                <span className="hint">Optional. The words that appear in the sentence.</span>
              </label>
            </div>
            <SubmitButton pendingLabel="Saving…">Add call to action</SubmitButton>
          </form>
        </div>
        <p className="tiny subtle">{CLICKS_ARE_INVISIBLE}</p>
      </Section>

      <Section id="live" title="In use">
        {live.length ? (
          <div className="stack-3">
            {live.map((cta) => {
              const used = usage.get(cta.id) ?? [];
              return (
                <article key={cta.id} className="card">
                  {/*
                    The labels are shown, not hidden.
                    They were `sr-only`, which is correct for a control whose
                    job is obvious from what is in it and wrong for four text
                    boxes in a row. The form that *creates* a call to action,
                    twenty lines up this page, labels all four; this one —
                    where the boxes are full of values rather than
                    placeholders, so there is not even a hint to read — showed
                    none. Somebody editing a destination had to work out which
                    box was which from the shape of the text in it.
                  */}
                  <form action={saveCta} className="stack-3">
                    <input type="hidden" name="id" value={cta.id} />
                    <div className="form-grid">
                      <label className="field">
                        <span>Name</span>
                        <input type="text" name="name" defaultValue={cta.name} maxLength={80} required />
                      </label>
                      <label className="field">
                        <span>What it asks for</span>
                        <select name="kind" defaultValue={cta.kind} aria-describedby={used.length ? `cta-kind-${cta.id}` : undefined}>
                          {CTA_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {CTA_DEFINITIONS[kind].label}
                            </option>
                          ))}
                        </select>
                        {used.length ? (
                          <span className="hint" id={`cta-kind-${cta.id}`}>
                            Fixed while campaigns use it.
                          </span>
                        ) : null}
                      </label>
                      <label className="field">
                        <span>Destination</span>
                        <input
                          type="url"
                          name="url"
                          defaultValue={cta.url ?? ""}
                          placeholder={cta.kind === "meeting" ? "Optional" : "No destination"}
                        />
                        {cta.kind === "meeting" && !cta.url ? <span className="hint">Sends: {meetingGoesTo}</span> : null}
                      </label>
                      <label className="field">
                        <span>How the message refers to it</span>
                        <input type="text" name="label" defaultValue={cta.label ?? ""} maxLength={80} />
                      </label>
                    </div>
                    <p className="tiny subtle">
                      {used.length === 0
                        ? "Not used by any campaign yet."
                        : `Used by ${used.length} campaign${used.length === 1 ? "" : "s"}: ${used.join(", ")}. Saving changes where all of them point.`}
                    </p>
                    {/* Save and Archive on one line at the card's foot. Archive
                        belongs to its own form below, named by `form`. */}
                    <div className="cluster">
                      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                      <button className="btn ghost" type="submit" form={`archive-${cta.id}`}>
                        Archive
                      </button>
                    </div>
                  </form>
                  <form action={archiveCta} id={`archive-${cta.id}`} hidden>
                    <input type="hidden" name="id" value={cta.id} />
                  </form>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title="No calls to action yet">
            Add one above and every campaign can point at it. Until then a campaign carries its own
            destination, which is fine for one and unmanageable for ten.
          </Empty>
        )}
      </Section>

      {archived.length ? (
        <Section
          id="archived"
          title="Archived"
          description="Out of the picker, kept so a campaign that used one can still say what it pointed at."
        >
          <div className="table-scroll card-rows">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Asks for</th>
                  <th>Destination</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {archived.map((cta) => (
                  <tr key={cta.id}>
                    <td data-label="Name">{cta.name}</td>
                    <td data-label="Asks for" className="small muted">{CTA_DEFINITIONS[cta.kind].label}</td>
                    <td data-label="Destination" className="small mono cta-url-cell">{cta.url ?? "None"}</td>
                    <td data-label="Actions">
                      <form action={archiveCta}>
                        <input type="hidden" name="id" value={cta.id} />
                        <input type="hidden" name="restore" value="1" />
                        <SubmitButton className="btn ghost small" pendingLabel="Restoring…">
                          Restore
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </>
  );
}
