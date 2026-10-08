import { requireSession } from "@/lib/workspace";
import { PageHeader, Section, Empty } from "@/components/page";
import { createClient } from "@/lib/supabase-server";
import { normalizeExclusionValue, type ExclusionKind } from "@le/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { formatDate, isoAttr } from "@/lib/format";
import { label } from "@/lib/labels";

const KINDS: ReadonlyArray<{ value: ExclusionKind; label: string }> = [
  { value: "company", label: "Company" },
  { value: "person", label: "Person" },
];

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

/**
 * Adds an entry. The normalized form is computed here, by the same function the
 * worker matches with, so "Acme Corp." and "acme" can never end up as two rows
 * that behave differently.
 */
async function addExclusion(formData: FormData) {
  "use server";
  const kind = String(formData.get("kind") ?? "") as ExclusionKind;
  const raw = String(formData.get("value") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!raw || (kind !== "company" && kind !== "person")) return;

  const value = normalizeExclusionValue(kind, raw);
  if (!value) return;

  const session = await requireSession();
  if (!canManage(session.role)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("exclusions").upsert(
    {
      workspace_id: session.workspaceId,
      kind,
      value,
      raw_value: raw,
      reason: reason || null,
      created_by: session.userId,
    },
    { onConflict: "workspace_id,kind,value" },
  );

  if (error) redirect(errorQuery("/app/exclusions", `That did not save: ${error.message}`));
  revalidatePath("/app/exclusions");
  redirect(noticeQuery("/app/exclusions", `Added ${raw}. Nobody here will contact it.`));
}

async function removeExclusion(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const session = await requireSession();
  if (!canManage(session.role)) return;

  const supabase = await createClient();
  // Checked, and said by name. This said "Saved." whatever the database
  // answered, and removing an entry is the one change here that lets a
  // campaign write to somebody again — so a refusal that reads as success is
  // the dangerous direction to be wrong in.
  const { data, error } = await supabase
    .from("exclusions")
    .delete()
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .select("raw_value");

  if (error) redirect(errorQuery("/app/exclusions", `That did not remove: ${error.message}`));
  revalidatePath("/app/exclusions");
  const removed = data?.[0]?.raw_value;
  redirect(
    noticeQuery(
      "/app/exclusions",
      removed
        ? `Removed ${removed}. Campaigns may contact it again.`
        : "That entry was already gone.",
    ),
  );
}

/**
 * The shared exclusion list. Every member can read it — a rep needs to see why
 * a name was skipped — and admins and managers change it, because removing an
 * entry is what lets a message reach an off-limits account.
 */
export default async function ExclusionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: rows }, { data: me }] = await Promise.all([
    supabase
      .from("exclusions")
      .select("id, kind, raw_value, reason, created_at, profiles:created_by (full_name, email)")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
  ]);

  const manage = canManage(session.role);
  const entries = rows ?? [];
  const companies = entries.filter((row) => row.kind === "company").length;
  const people = entries.length - companies;

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Do not contact"
        lede="Accounts and people nobody in this workspace contacts. Checked when a campaign is built and again immediately before every send, so adding a company here stops the invitations already queued against it."
      />
      <PageNotice error={params.error} notice={params.notice} />

      {manage ? (
        <Section
          title="Add an exclusion"
          description="A company name matches however it is written: Acme, ACME Inc. and Acme Corporation are one account."
        >
          <div className="card">
            <form className="form-row" action={addExclusion}>
              <label className="field compact">
                <span>Type</span>
                <select name="kind" defaultValue="company">
                  {KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Company name or profile URL</span>
                <input name="value" required placeholder="Acme Corp." autoComplete="off" spellCheck={false} />
              </label>
              <label className="field">
                <span>Why (optional)</span>
                <input name="reason" placeholder="Existing customer" />
              </label>
              <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
            </form>
          </div>
        </Section>
      ) : null}

      {/*
        A bare `<section>` takes the frame's fallback rhythm and its heading
        takes the sheet's "air under an h2" margin on top of it, so this list
        sat at a spacing no other list in the product uses. The breakdown is
        the section's `description`, which is where a sentence about a heading
        belongs.
      */}
      <Section
        title={`${entries.length} on the list`}
        description={
          entries.length
            ? `${companies} ${companies === 1 ? "company" : "companies"}, ${people} ${
                people === 1 ? "person" : "people"
              }`
            : undefined
        }
      >

        {entries.length === 0 ? (
          <Empty title="Nothing excluded yet">
            Most teams start with their customer list and the accounts their AEs already own.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Excluded</th>
                  <th>Type</th>
                  <th>Why</th>
                  <th>Added by</th>
                  {manage ? (
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => {
                  const author = row.profiles as unknown as
                    | { full_name: string | null; email: string }
                    | null;
                  return (
                    <tr key={row.id}>
                      <td>{row.raw_value}</td>
                      <td>
                        <span className="pill">{label(row.kind)}</span>
                      </td>
                      <td className="small muted">{row.reason ?? "—"}</td>
                      <td className="small muted">
                        {author?.full_name ?? author?.email ?? "—"}
                        <p className="small muted">
                          <time dateTime={isoAttr(row.created_at)}>
                            {formatDate(row.created_at, me?.timezone)}
                          </time>
                        </p>
                      </td>
                      {manage ? (
                        <td>
                          <form action={removeExclusion}>
                            <input type="hidden" name="id" value={row.id} />
                            <ConfirmButton
                              confirmLabel="Remove — campaigns may contact them again"
                              pendingLabel="Removing…"
                            >
                              Remove
                            </ConfirmButton>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
