import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, ago, when } from "@/lib/admin";
import { callWorker } from "@/lib/worker";
import { PageHeader, Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { ControlButton } from "@/components/admin-control";

export const dynamic = "force-dynamic";

type QueueStats = Record<
  string,
  {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    recentFailures: Array<{ id: string | null; name: string; reason: string; at: number | null }>;
  }
>;

const QUEUE_LABEL: Record<string, string> = {
  strategy: "Strategy agent",
  targeting: "Finding prospects",
  campaignTick: "Sending loop",
  linkedinAction: "LinkedIn actions",
  inbound: "Incoming replies",
  maintenance: "Maintenance",
  digest: "Emails & reports",
};

/** Things an operator can make happen now rather than at the next scheduled run. */
const TASKS: Array<{ task: string; label: string; detail: string }> = [
  { task: "tick", label: "Sending loop", detail: "Every 5 minutes. Queues the invitations and follow-ups that are due." },
  { task: "acceptance", label: "Acceptances", detail: "Hourly. Notices who accepted, re-arms stalled prospects, recovers accounts, answers tickets." },
  { task: "inbound-poll", label: "Replies", detail: "Every 15 minutes. Asks LinkedIn for replies the webhook did not deliver." },
  { task: "pending-searches", label: "Waiting searches", detail: "Hourly. Starts the search for approved strategies that never had one." },
  { task: "unstick", label: "Stalled prospects", detail: "Hourly. Re-arms anybody whose next step went missing." },
  { task: "posts", label: "LinkedIn posts", detail: "Every 15 minutes. Publishes approved posts whose time has come." },
  { task: "lifecycle", label: "Lifecycle emails", detail: "Hourly. Onboarding emails and operator notes; each is sent once." },
  { task: "nightly", label: "Nightly housekeeping", detail: "03:00 UTC. Counters, retention, repairs, notes, clean-up." },
];

/**
 * The worker's queues, live, and the schedules behind them.
 *
 * Retrying a failed job re-runs every check it would have run the first time —
 * the limiter, the exclusion list, never-twice — so it cannot send somebody a
 * second message. Clearing failed jobs removes the record and nothing else.
 */
export default async function AdminJobsPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const admin = await requirePlatformAdmin();
  const supabase = await createClient();

  const [result, { data: beats }] = await Promise.all([
    callWorker<{ reachable: boolean; queues: QueueStats | null; at: string }>("/admin/queues", { userId: admin.userId }),
    supabase.from("worker_heartbeats").select("name, beat_at, detail").order("name"),
  ]);
  const back = "/admin/jobs";
  const queues = result.ok ? result.data?.queues : null;

  return (
    <>
      <PageHeader
        eyebrow="Operator"
        title="Jobs"
        lede="The worker's queues as they stand right now, the schedules behind them, and the buttons to run any of them early."
      />
      <PageNotice error={params.error} notice={params.notice} />

      {!result.ok ? (
        <div className="notice danger">
          <p>
            <strong>Could not reach the worker.</strong> {result.error}
          </p>
        </div>
      ) : !result.data?.reachable ? (
        <div className="notice danger">
          <p>
            <strong>The worker cannot reach its queue.</strong> Nothing new will be picked up until it can.
          </p>
        </div>
      ) : null}

      <Section title="Queues">
        {queues ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Queue</th>
                  <th className="num">Waiting</th>
                  <th className="num">Running</th>
                  <th className="num">Scheduled</th>
                  <th className="num">Failed</th>
                  <th className="num">Done (24h)</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(queues).map(([name, q]) => (
                  <tr key={name}>
                    <td className="small">{QUEUE_LABEL[name] ?? name}</td>
                    <td className="num mono">{q.waiting}</td>
                    <td className="num mono">{q.active}</td>
                    <td className="num mono">{q.delayed}</td>
                    <td className="num mono">{q.failed ? <span className="pill tiny warning">{q.failed}</span> : 0}</td>
                    <td className="num mono">{q.completed}</td>
                    <td>
                      {q.failed ? (
                        <div className="cluster">
                          <ControlButton
                            op="jobs-retry-failed"
                            fields={{ queue: name }}
                            back={back}
                            label="Retry failed"
                            tone="secondary"
                            pendingLabel="Retrying…"
                          />
                          <ControlButton
                            op="jobs-clean-failed"
                            fields={{ queue: name }}
                            back={back}
                            label="Clear failed"
                            tone="danger"
                            confirm={`Delete ${q.failed} failed job${q.failed === 1 ? "" : "s"}`}
                            pendingLabel="Clearing…"
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">Queue counts are unavailable right now.</p>
        )}
      </Section>

      {queues && Object.values(queues).some((q) => q.recentFailures.length) ? (
        <Section title="Newest failures">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Queue</th>
                  <th>Job</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(queues).flatMap(([name, q]) =>
                  q.recentFailures.map((f) => (
                    <tr key={`${name}-${f.id}`}>
                      <td className="small subtle">{f.at ? ago(new Date(f.at).toISOString()) : "—"}</td>
                      <td className="small">{QUEUE_LABEL[name] ?? name}</td>
                      <td className="small mono">{f.name}</td>
                      <td className="small muted">{f.reason || "—"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title="Run now" description="Each runs once, immediately, exactly as its schedule would.">
        <div className="table-scroll">
          <table>
            <tbody>
              {TASKS.map((t) => (
                <tr key={t.task}>
                  <td>
                    <span className="small">{t.label}</span>
                    <p className="tiny subtle">{t.detail}</p>
                  </td>
                  <td>
                    <ControlButton op="run-task" fields={{ task: t.task }} back={back} label="Run now" pendingLabel="Starting…" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Heartbeats" description="What each part of the worker last wrote down about itself.">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Last</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {(beats ?? []).map((b) => (
                <tr key={b.name}>
                  <td className="small mono">{b.name}</td>
                  <td className="small subtle" title={when(b.beat_at)}>
                    {ago(b.beat_at)}
                  </td>
                  <td className="tiny muted mono">{JSON.stringify(b.detail ?? {}).slice(0, 220)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
