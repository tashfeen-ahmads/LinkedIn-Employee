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

  if (!name) redirect(errorQuery("/app/cta", "Give it a name you will recognise in a list."));
  if (!CTA_KINDS.includes(kind)) redirect(errorQuery("/app/cta", "Pick what this asks for."));

  // The same check the agent's drafts pass. A destination refused here can
  // never reach a prospect, which is the point of checking it at the door
  // rather than at the moment of sending.
  if (CTA_DEFINITIONS[kind].needsUrl) {
    const verdict = checkCtaUrl(url);
    if (!verdict.ok) redirect(errorQuery("/app/cta", verdict.reason));
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

  if (error) redirect(errorQuery("/app/cta", `That did not save: ${error.message}`));

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

  await supabase
    .from("ctas")
    .update({ archived_at: restore ? null : new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/cta");
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

  const live = (ctas ?? []).filter((c) => !c.archived_at);
  const archived = (ctas ?? []).filter((c) => c.archived_at);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Calls to action"
        lede="What your campaigns ask for. Keep as many as you run — a campaign picks one, and changing a destination here changes it everywhere it is used."
      />

      <PageNotice error={params.error} notice={params.notice} />

      <Section
        id="add"
        title="Add one"
        description="The goal decides what counts as success: a campaign sending a link is never reported as failing to book meetings."
      >
        <div className="card">
          <form action={saveCta} className="stack-3">
            <div className="form-row">
              <label className="field grow">
                <span>Name it</span>
                <input type="text" name="name" placeholder="Free teardown" maxLength={80} required />
                <span className="hint">What you will recognise in a list of twenty.</span>
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
            </div>
            <div className="form-row">
              <label className="field grow">
                <span>Destination</span>
                <input type="url" name="url" placeholder="https://example.com/teardown" />
                <span className="hint">
                  Needed for a link. Left empty for a meeting or a conversation.
                </span>
              </label>
              <label className="field grow">
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
                  <form action={saveCta} className="stack-3">
                    <input type="hidden" name="id" value={cta.id} />
                    <div className="form-row">
                      <label className="field grow">
                        <span className="sr-only">Name</span>
                        <input type="text" name="name" defaultValue={cta.name} maxLength={80} required />
                      </label>
                      <label className="field">
                        <span className="sr-only">Asks for</span>
                        <select name="kind" defaultValue={cta.kind}>
                          {CTA_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {CTA_DEFINITIONS[kind].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="form-row">
                      <label className="field grow">
                        <span className="sr-only">Destination</span>
                        <input type="url" name="url" defaultValue={cta.url ?? ""} placeholder="No destination" />
                      </label>
                      <label className="field grow">
                        <span className="sr-only">Wording</span>
                        <input type="text" name="label" defaultValue={cta.label ?? ""} maxLength={80} />
                      </label>
                    </div>
                    <div className="form-row">
                      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                      <span className="tiny subtle">
                        {used.length === 0
                          ? "Not used by any campaign yet."
                          : `Used by ${used.length} campaign${used.length === 1 ? "" : "s"}: ${used.join(", ")}. Saving changes where all of them point.`}
                      </span>
                    </div>
                  </form>
                  <form action={archiveCta}>
                    <input type="hidden" name="id" value={cta.id} />
                    <button className="btn ghost small" type="submit">
                      Archive
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title="No calls to action yet.">
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Asks for</th>
                  <th>Destination</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {archived.map((cta) => (
                  <tr key={cta.id}>
                    <td>{cta.name}</td>
                    <td className="small muted">{CTA_DEFINITIONS[cta.kind].label}</td>
                    <td className="small mono breakable">{cta.url ?? "—"}</td>
                    <td>
                      <form action={archiveCta}>
                        <input type="hidden" name="id" value={cta.id} />
                        <input type="hidden" name="restore" value="1" />
                        <button className="btn ghost small" type="submit">
                          Restore
                        </button>
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
