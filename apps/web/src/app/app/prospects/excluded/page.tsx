import Link from "next/link";
import { Empty, PageHeader, Section } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { SectionLayout } from "@/components/section-nav";
import { ProspectNav } from "@/components/prospect-nav";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { formatDate, isoAttr } from "@/lib/format";
import { label } from "@/lib/labels";
import { displayName, loadProspectMenu } from "../data";

/** How many do-not-contact people the page lists. Said on screen when reached. */
const LIST_LIMIT = 200;

/**
 * Who is off-limits, and why.
 *
 * Two lists with one meaning: people marked do-not-contact (they asked to be
 * removed, were erased, or a reply stopped everything — rule 7), and the
 * workspace's shared exclusion list of companies and people a colleague
 * promised nobody would write to (rule 14). Both are checked immediately
 * before every send. The shared list is changed on its own page, where only
 * the roles allowed to change it can, so this one reads it and links there.
 */
export default async function ExcludedProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [menu, { data: people, count }, { data: exclusions }, { data: me }] = await Promise.all([
    loadProspectMenu(supabase, session.workspaceId),
    supabase
      .from("prospects")
      .select("id, first_name, last_name, headline, company, do_not_contact_reason, updated_at", { count: "exact" })
      .eq("workspace_id", session.workspaceId)
      .eq("do_not_contact", true)
      .order("updated_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from("exclusions")
      .select("id, kind, raw_value, reason, created_at")
      .eq("workspace_id", session.workspaceId)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
  ]);
  const timezone = me?.timezone ?? null;
  const dnc = people ?? [];
  const shared = exclusions ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Work"
        title="Prospects"
        lede="People and companies Nora will never contact. Adding a name now also stops an invitation already waiting to go to them."
      />
      <PageNotice error={params.error} notice={params.notice} />
      <SectionLayout
        nav={<ProspectNav everyone={menu.everyone} review={menu.review} searchable={menu.searchable} excluded={menu.excluded} />}
      >
        <Section
          id="dnc"
          title="Do not contact"
          description="People who asked to be removed, were erased on request, or whose reply stopped every message. Nothing is ever sent to them again."
        >
          {dnc.length === 0 ? (
            <Empty title="Nobody is marked do-not-contact.">
              Somebody who says &ldquo;remove me&rdquo; lands here at once, and is never written to again.
            </Empty>
          ) : (
            <>
              {count !== null && count > dnc.length ? (
                <p className="small muted">
                  Showing the {dnc.length} most recent of {count.toLocaleString()}.
                </p>
              ) : null}
              <div className="table-scroll card-rows">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Company</th>
                      <th>Why</th>
                      <th>Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dnc.map((person) => (
                      <tr key={person.id}>
                        <td data-label="Person" className="strongish">
                          {displayName(person)}
                        </td>
                        <td data-label="Company" className="muted">
                          {person.company || "—"}
                        </td>
                        <td data-label="Why" className="small">
                          {person.do_not_contact_reason || "Not recorded"}
                        </td>
                        <td data-label="Since" className="muted">
                          <time dateTime={isoAttr(person.updated_at)}>{formatDate(person.updated_at, timezone)}</time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>

        <Section
          id="shared"
          title="The shared exclusion list"
          description="Companies and people a colleague promised nobody here would contact. A company matches however it is written."
          action={
            <Link className="btn secondary small" href="/app/exclusions">
              Manage the list
            </Link>
          }
        >
          {shared.length === 0 ? (
            <Empty title="The shared list is empty." action="Add a company or person" href="/app/exclusions">
              Add a customer, a partner or anybody else nobody should write to.
            </Empty>
          ) : (
            <div className="table-scroll card-rows">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Why</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {shared.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Name" className="strongish">
                        {entry.raw_value}
                      </td>
                      <td data-label="Type">{label(entry.kind)}</td>
                      <td data-label="Why" className="small muted">
                        {entry.reason || "—"}
                      </td>
                      <td data-label="Added" className="muted">
                        <time dateTime={isoAttr(entry.created_at)}>{formatDate(entry.created_at, timezone)}</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </SectionLayout>
    </>
  );
}
