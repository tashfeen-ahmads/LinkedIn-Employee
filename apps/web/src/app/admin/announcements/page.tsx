import Link from "next/link";
import { redirect } from "next/navigation";
import { announcementEmail } from "@le/email";
import { appOrigin } from "@le/shared";
import { createClient } from "@/lib/supabase-server";
import { requirePlatformAdmin } from "@/lib/admin";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { PageHeader, Section, Empty } from "@/components/page";
import { PageNotice } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

const PATH = "/admin/announcements";

/**
 * Product updates, written here and sent to every user who has not
 * unsubscribed.
 *
 * Every write goes through the worker, which checks again that the caller is a
 * platform admin and holds both double-send guards: the announcement is
 * claimed in one statement when "Send to everyone" is pressed, and each person
 * is claimed in `email_sends` before they are written to. So a second press, a
 * second tab or a retried request sends nothing — the page says so rather than
 * trusting the button to be pressed once.
 */
function draftFrom(formData: FormData) {
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  return {
    id: text("id") || undefined,
    subject: text("subject"),
    body: text("body"),
    ctaLabel: text("ctaLabel") || null,
    ctaUrl: text("ctaUrl") || null,
  };
}

async function saveDraft(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const draft = draftFrom(formData);
  const back = draft.id ? `${PATH}?id=${draft.id}` : PATH;
  if (!draft.subject || !draft.body) redirect(errorQuery(back, "A subject and a body, both."));

  const result = await callWorker<{ id: string }>("/admin/announcements", { op: "save", userId: admin.userId, ...draft });
  if (!result.ok || !result.data?.id) {
    redirect(errorQuery(back, result.ok ? "The draft did not save." : result.error));
  }
  redirect(
    noticeQuery(`${PATH}?id=${result.data.id}`, "Saved. The preview below is exactly what people will receive."),
  );
}

async function sendTest(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  const back = `${PATH}?id=${id}`;
  const result = await callWorker<{ to: string }>("/admin/announcements", { op: "test", userId: admin.userId, id });
  if (!result.ok) redirect(errorQuery(back, result.error));
  redirect(noticeQuery(back, `Test sent to ${result.data?.to ?? admin.email}. Nobody else received it.`));
}

async function sendToEveryone(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  const back = `${PATH}?id=${id}`;
  if (formData.get("confirm") !== "on") {
    redirect(errorQuery(back, "Tick the box to confirm. This emails every user who has not unsubscribed."));
  }
  const result = await callWorker("/admin/announcements", {
    op: "send",
    userId: admin.userId,
    id,
    confirm: true,
  });
  if (!result.ok) redirect(errorQuery(back, result.error));
  redirect(noticeQuery(back, "Sending now. Each person receives it once; this page shows the count when it finishes."));
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
    new Date(iso),
  );
}

function statusOf(row: { send_requested_at: string | null; sent_at: string | null; recipients: number | null }) {
  if (row.sent_at) return `Sent to ${row.recipients ?? 0}`;
  if (row.send_requested_at) return "Sending";
  return "Draft";
}

export default async function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const admin = await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: history }, { count: audience }, current] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, subject, created_at, send_requested_at, sent_at, recipients")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .is("marketing_opt_out_at", null),
    params.id
      ? supabase
          .from("announcements")
          .select("id, subject, body, cta_label, cta_url, send_requested_at, sent_at, recipients")
          .eq("id", params.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const draft = current.data;
  const locked = Boolean(draft?.send_requested_at);
  const appUrl = appOrigin(process.env.APP_URL);

  // Rendered with the same function the worker sends with, so the preview is
  // not a second reading of the template.
  const preview = draft
    ? announcementEmail({
        to: admin.email,
        appUrl,
        subject: draft.subject,
        body: draft.body,
        cta: draft.cta_label && draft.cta_url ? { label: draft.cta_label, url: draft.cta_url } : null,
        unsubscribeUrl: `${appUrl}/unsubscribe?token=preview`,
      })
    : null;

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <PageHeader
        eyebrow="Operator"
        title="Announcements"
        lede="Product updates, sent once to every user who has not unsubscribed. Write it, preview it, send yourself a test, then send it."
        actions={
          draft ? (
            <Link className="btn secondary small" href={PATH}>
              New announcement
            </Link>
          ) : null
        }
      />

      <Section
        title={draft ? (locked ? "What was sent" : "Edit the draft") : "Write an announcement"}
        description="Plain text. A blank line starts a new paragraph. Nothing you type is read as HTML."
      >
        <form action={saveDraft} className="card">
          {draft ? <input type="hidden" name="id" value={draft.id} /> : null}
          <label className="field">
            <span>Subject</span>
            <input
              type="text"
              name="subject"
              required
              maxLength={200}
              defaultValue={draft?.subject ?? ""}
              disabled={locked}
              placeholder="Replies now land straight in your inbox"
            />
          </label>
          <label className="field">
            <span>Body</span>
            <textarea
              name="body"
              required
              rows={10}
              maxLength={10_000}
              defaultValue={draft?.body ?? ""}
              disabled={locked}
              placeholder={"What changed, in a sentence.\n\nWhy it matters to them, in two more."}
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Button label (optional)</span>
              <input
                type="text"
                name="ctaLabel"
                maxLength={60}
                defaultValue={draft?.cta_label ?? ""}
                disabled={locked}
                placeholder="Take a look"
              />
            </label>
            <label className="field">
              <span>Button link (optional)</span>
              <input
                type="url"
                name="ctaUrl"
                maxLength={2000}
                pattern="https://.*"
                defaultValue={draft?.cta_url ?? ""}
                disabled={locked}
                placeholder={`${appUrl}/app`}
              />
            </label>
          </div>
          {locked ? null : (
            <div className="row">
              <SubmitButton pendingLabel="Saving…">{draft ? "Save and preview" : "Preview"}</SubmitButton>
            </div>
          )}
        </form>
      </Section>

      {draft && preview ? (
        <Section
          id="preview"
          title="Preview"
          description={`Subject: ${preview.subject}. Rendered by the same template the worker sends, at desktop and phone width.`}
        >
          <div className="email-preview-pair">
            <iframe title="Email preview, desktop" srcDoc={preview.html} className="email-preview" sandbox="" />
            <iframe
              title="Email preview, phone"
              srcDoc={preview.html}
              className="email-preview is-phone"
              sandbox=""
            />
          </div>
        </Section>
      ) : null}

      {draft && !locked ? (
        <Section
          title="Send"
          description="A test goes to you alone and is not recorded, so you still receive the real one."
        >
          <div className="card">
            <form action={sendTest} className="row">
              <input type="hidden" name="id" value={draft.id} />
              <SubmitButton className="btn secondary" pendingLabel="Sending test…">
                Send test to me ({admin.email})
              </SubmitButton>
            </form>
            <form action={sendToEveryone} className="stack-2">
              <input type="hidden" name="id" value={draft.id} />
              <label className="small check">
                <input type="checkbox" name="confirm" required />
                <span>
                  I have read the preview. Email it to all {audience ?? 0} users who have not
                  unsubscribed. This cannot be undone or sent twice.
                </span>
              </label>
              <div className="row">
                <SubmitButton pendingLabel="Queueing…">Send to all users</SubmitButton>
              </div>
            </form>
          </div>
        </Section>
      ) : null}

      <Section title="Sent and drafts" description="Newest first. Times are UTC.">
        {history?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Written</th>
                  <th>Status</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`${PATH}?id=${row.id}`}>{row.subject}</Link>
                    </td>
                    <td className="num">{when(row.created_at)}</td>
                    <td>{statusOf(row)}</td>
                    <td className="num">{when(row.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nothing written yet">
            The first announcement you write appears here, with how many people it reached.
          </Empty>
        )}
      </Section>
    </>
  );
}
