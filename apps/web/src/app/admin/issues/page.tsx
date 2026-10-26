import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import { ISSUES_TIMEOUT_MS, callWorker } from "@/lib/worker";
import { PageHeader, Section, Empty } from "@/components/page";

export const dynamic = "force-dynamic";

/**
 * Everything wrong across the deployment, in one list.
 *
 * Every fault this product has had was recorded somewhere — a heartbeat, an
 * event, a status column — and shown on no screen anybody read, so each one was
 * found by running SQL after a customer complained. The worker reads all of it
 * (`collectIssues`) and this page says, per workspace and per person, what is
 * wrong, how bad it is and since when.
 */
type Issue = {
  id: string;
  severity: "critical" | "warning" | "info";
  area: string;
  title: string;
  detail: string;
  workspaceId?: string | null;
  workspace?: string | null;
  person?: string | null;
  since?: string | null;
};

const SEVERITY: Record<Issue["severity"], { label: string; tone: string }> = {
  critical: { label: "Critical", tone: "danger" },
  warning: { label: "Warning", tone: "warning" },
  info: { label: "Info", tone: "plain" },
};

function when(at: string | null | undefined): string | null {
  if (!at) return null;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const params = await searchParams;
  const result = await callWorker<{ issues: Issue[]; at: string }>("/admin/issues", { userId: admin.userId }, ISSUES_TIMEOUT_MS);

  const all = result.ok ? (result.data?.issues ?? []) : [];
  const areas = [...new Set(all.map((i) => i.area))];
  const shown = params.area ? all.filter((i) => i.area === params.area) : all;
  const counts = {
    critical: all.filter((i) => i.severity === "critical").length,
    warning: all.filter((i) => i.severity === "warning").length,
    info: all.filter((i) => i.severity === "info").length,
  };

  return (
    <>
      <PageHeader
        title="Issues"
        lede="System faults only — the worker, the sending loop, reply delivery, the LinkedIn provider, failed background jobs, AI calls and email. Not what a customer has yet to do. Read live from the worker each time this page opens."
      />

      {!result.ok ? (
        <div className="notice danger">
          <p>
            <strong>Could not reach the worker to collect issues.</strong> {result.error}
          </p>
        </div>
      ) : null}

      <Section
        title={
          result.ok
            ? `${counts.critical} critical · ${counts.warning} warning · ${counts.info} info`
            : "Issues"
        }
        description={result.ok && result.data?.at ? `Checked ${when(result.data.at)}.` : undefined}
      >
        {areas.length > 1 ? (
          <nav className="tabs" aria-label="Which issues to show">
            <Link
              className={`pill ${params.area ? "" : "accent"}`}
              href="/admin/issues"
              aria-current={params.area ? undefined : "page"}
            >
              All ({all.length})
            </Link>
            {areas.map((area) => (
              <Link
                key={area}
                className={`pill ${params.area === area ? "accent" : ""}`}
                href={`/admin/issues?area=${encodeURIComponent(area)}`}
                aria-current={params.area === area ? "page" : undefined}
              >
                {area} ({all.filter((i) => i.area === area).length})
              </Link>
            ))}
          </nav>
        ) : null}

        {!result.ok ? (
          // Unread is not clean and not empty: an empty table under a red
          // banner reads as "no issues" to anybody who scrolled past it.
          <Empty title="Not checked.">The list appears when the worker answers. Reload to try again.</Empty>
        ) : shown.length === 0 ? (
          <Empty title="No system faults.">Every check the worker runs came back clean.</Empty>
        ) : (
          <div className="table-scroll card-rows">
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Area</th>
                  <th>Issue</th>
                  <th>Who</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((issue) => (
                  <tr key={issue.id}>
                    <td data-label="Severity">
                      <span className={`pill tiny ${SEVERITY[issue.severity].tone}`}>
                        {SEVERITY[issue.severity].label}
                      </span>
                    </td>
                    <td data-label="Area" className="small">{issue.area}</td>
                    <td data-label="Issue">
                      <p className="small">
                        <strong>{issue.title}</strong>
                      </p>
                      <p className="small muted">{issue.detail}</p>
                    </td>
                    <td data-label="Who" className="small">
                      {issue.workspaceId ? (
                        <Link href={`/admin/workspaces/${issue.workspaceId}`}>
                          {issue.workspace ?? "Workspace"}
                        </Link>
                      ) : null}
                      {issue.person ? <p className="small muted">{issue.person}</p> : null}
                      {!issue.workspaceId && !issue.person ? <span className="subtle">Platform</span> : null}
                    </td>
                    <td data-label="Since" className="small subtle">{when(issue.since) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
