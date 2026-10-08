import { BOOT_BEAT } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin, ago, when } from "@/lib/admin";
import { PageHeader, Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { ControlButton } from "@/components/admin-control";
import { adminControl } from "../actions";

export const dynamic = "force-dynamic";

/** The worker refuses a longer reason (admin-control.ts). */
const OUTREACH_PAUSE_REASON_MAX = 300;

/**
 * The platform's switches.
 *
 * Two of them, and both are things an operator used to do in SQL: stopping
 * every account sending at once, and deciding whether the support assistant
 * may answer customers by itself.
 */
export default async function AdminSettingsPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: settings }, { data: users }, { data: boot }] = await Promise.all([
    supabase
      .from("platform_settings")
      .select("outreach_paused_at, outreach_paused_reason, outreach_paused_by, support_autopilot, updated_at")
      .maybeSingle(),
    supabase.rpc("platform_users"),
    supabase.from("worker_heartbeats").select("beat_at, detail").eq("name", BOOT_BEAT).maybeSingle(),
  ]);

  const admins = (users ?? []).filter((u) => u.is_admin);
  const pausedBy = settings?.outreach_paused_by
    ? (users ?? []).find((u) => u.user_id === settings.outreach_paused_by)
    : null;
  const bootDetail = (boot?.detail ?? {}) as { commit?: string | null; nodeEnv?: string | null };
  const autopilot = settings?.support_autopilot !== false;

  return (
    <>
      <PageHeader eyebrow="Operator" title="Settings" lede="Switches that apply to every workspace on the platform." />
      <PageNotice error={params.error} notice={params.notice} />

      <Section
        title="Outreach"
        description="The kill switch. While it is on, every invitation, profile view and follow-up on every account waits — nothing is failed or dropped, and resuming picks the queue up where it stood. Replies a person approved still go."
      >
        {settings?.outreach_paused_at ? (
          <div className="card">
            <p>
              <span className="pill danger">Paused</span>{" "}
              <span className="small">
                since {when(settings.outreach_paused_at)} ({ago(settings.outreach_paused_at)})
                {pausedBy ? ` by ${pausedBy.full_name ?? pausedBy.email}` : ""}
              </span>
            </p>
            <p className="small muted">Reason: {settings.outreach_paused_reason ?? "none given"}</p>
            <p className="tiny subtle">Customers see only that sending is paused for a short while; the reason stays here.</p>
            <ControlButton
              op="outreach-resume"
              back="/admin/settings"
              label="Resume all outreach"
              tone="primary"
              confirm="Resume every account's outreach"
              pendingLabel="Resuming…"
            />
          </div>
        ) : (
          <form action={adminControl} className="card">
            <input type="hidden" name="op" value="outreach-pause" />
            <input type="hidden" name="back" value="/admin/settings" />
            <p>
              <span className="pill positive">Sending</span> <span className="small muted">Every account sends on its own schedule.</span>
            </p>
            <label className="field">
              <span>Why are you pausing? (only operators see this)</span>
              <input
                type="text"
                name="reason"
                required
                minLength={3}
                maxLength={OUTREACH_PAUSE_REASON_MAX}
                placeholder="LinkedIn is restricting accounts this morning; holding until it settles."
              />
            </label>
            <SubmitButton className="btn danger" pendingLabel="Pausing…">
              Pause all outreach
            </SubmitButton>
          </form>
        )}
      </Section>

      <Section
        title="Support autopilot"
        description="When on, the assistant sends an answer itself if it is sure, the question is a how-to, the ticket is under two days old and the answer names nothing internal. Bugs, billing, feature requests and anybody who said the last answer did not help always wait for a person. When off, every answer is drafted and waits for you."
      >
        <div className="card">
          <p>
            <span className={`pill ${autopilot ? "positive" : "plain"}`}>{autopilot ? "On" : "Off"}</span>
          </p>
          <ControlButton
            op="support-autopilot"
            fields={{ on: autopilot ? "false" : "true" }}
            back="/admin/settings"
            label={autopilot ? "Turn autopilot off" : "Turn autopilot on"}
          />
        </div>
      </Section>

      <Section
        title="Operators"
        description="People with access to this console. Granted with a database statement only, never through the product — so a leaked session can never make another admin."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Last signed in</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.user_id}>
                  <td>
                    <span className="small">{a.full_name ?? "—"}</span>
                    <p className="tiny subtle">{a.email}</p>
                  </td>
                  <td className="small subtle">{ago(a.last_sign_in_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Deployment">
        <div className="table-scroll">
          <table>
            <tbody>
              <tr>
                <th scope="row">Worker build</th>
                <td className="mono small">{bootDetail.commit?.slice(0, 12) ?? "unknown"}</td>
              </tr>
              <tr>
                <th scope="row">Worker started</th>
                <td className="small">{when(boot?.beat_at)}</td>
              </tr>
              <tr>
                <th scope="row">Settings last changed</th>
                <td className="small">{when(settings?.updated_at)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
