import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { normalizeExclusionValue, type ExclusionKind } from "@le/shared";
import { revalidatePath } from "next/cache";

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
  await supabase.from("exclusions").upsert(
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

  revalidatePath("/app/exclusions");
}

async function removeExclusion(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const session = await requireSession();
  if (!canManage(session.role)) return;

  const supabase = await createClient();
  await supabase.from("exclusions").delete().eq("id", id).eq("workspace_id", session.workspaceId);

  revalidatePath("/app/exclusions");
}

/**
 * The shared exclusion list. Every member can read it — a rep needs to see why
 * a name was skipped — and admins and managers change it, because removing an
 * entry is what lets a message reach an off-limits account.
 */
export default async function ExclusionsPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("exclusions")
    .select("id, kind, raw_value, reason, created_at, profiles:created_by (full_name, email)")
    .eq("workspace_id", session.workspaceId)
    .order("created_at", { ascending: false });

  const manage = canManage(session.role);
  const entries = rows ?? [];
  const companies = entries.filter((row) => row.kind === "company").length;
  const people = entries.length - companies;

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Exclusions</h1>
      <p className="small muted" style={{ maxWidth: "60ch" }}>
        Accounts and people nobody in this workspace contacts. Checked when a campaign is built and
        again immediately before every send, so adding a company here stops the invitations already
        queued against it.
      </p>

      {manage ? (
        <section className="card" style={{ marginTop: "1.25rem" }}>
          <h3>Add an exclusion</h3>
          <form
            action={addExclusion}
            style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <label className="field" style={{ width: 130, marginBottom: 0 }}>
              <span>Type</span>
              <select name="kind" defaultValue="company">
                {KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: "1 1 220px", marginBottom: 0 }}>
              <span>Company name or profile URL</span>
              <input name="value" required placeholder="Acme Corp." />
            </label>
            <label className="field" style={{ flex: "1 1 200px", marginBottom: 0 }}>
              <span>Why (optional)</span>
              <input name="reason" placeholder="Existing customer" />
            </label>
            <button className="btn" type="submit">
              Add
            </button>
          </form>
          <p className="small muted" style={{ margin: "0.75rem 0 0" }}>
            A company name matches however it is written: Acme, ACME Inc. and Acme Corporation are one
            account.
          </p>
        </section>
      ) : null}

      <section style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1.15rem" }}>
          {entries.length} on the list
          {entries.length ? (
            <span className="small muted" style={{ fontWeight: 400 }}>
              {" "}
              · {companies} {companies === 1 ? "company" : "companies"}, {people}{" "}
              {people === 1 ? "person" : "people"}
            </span>
          ) : null}
        </h2>

        {entries.length === 0 ? (
          <p className="small muted" style={{ marginTop: "1rem" }}>
            Nothing excluded yet. Most teams start with their customer list and the accounts their AEs
            already own.
          </p>
        ) : (
          <div className="table-scroll" style={{ marginTop: "1rem" }}>
            <table>
              <thead>
                <tr>
                  <th>Excluded</th>
                  <th>Type</th>
                  <th>Why</th>
                  <th>Added by</th>
                  {manage ? <th /> : null}
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
                        <span className="pill">{row.kind}</span>
                      </td>
                      <td className="small muted">{row.reason ?? "—"}</td>
                      <td className="small muted">
                        {author?.full_name ?? author?.email ?? "—"}
                        <p className="small muted" style={{ margin: 0 }}>
                          {new Date(row.created_at).toLocaleDateString()}
                        </p>
                      </td>
                      {manage ? (
                        <td>
                          <form action={removeExclusion}>
                            <input type="hidden" name="id" value={row.id} />
                            <button className="btn secondary small" type="submit">
                              Remove
                            </button>
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
      </section>
    </>
  );
}
