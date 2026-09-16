import { redirect } from "next/navigation";
import { callWorker } from "@/lib/worker";

/**
 * Where a prospect picks a time.
 *
 * Public, and deliberately the only page in this product that is. The token in
 * the URL is the whole authorisation and never leaves the server: this page
 * hands it to the worker, which looks up the link, the rep and the prospect
 * itself. Nothing here takes a workspace or a rep from the query string,
 * because anyone can type one.
 *
 * It is also the page a stranger sees if a link is forwarded, so it says as
 * little as it can get away with: a first name and some times.
 */

export const dynamic = "force-dynamic";

interface BookingPage {
  repName: string | null;
  prospectFirstName: string | null;
  meetingMinutes: number;
  timezone: string;
  location: string | null;
  slots: Array<{ iso: string; readable: string }>;
  unavailable?: string;
  alreadyBookedFor?: string;
}

async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const result = await callWorker<{ ok: boolean; when?: string }>("/booking/confirm", {
    token,
    startsAt: String(formData.get("startsAt") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
  });

  if (!result.ok) {
    redirect(`/book/${encodeURIComponent(token)}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/book/${encodeURIComponent(token)}?booked=${encodeURIComponent(result.data?.when ?? "1")}`);
}

export default async function BookingPageView({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; booked?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;

  if (query.booked) {
    return (
      <Shell>
        <h1>You are booked in</h1>
        <p className="lede">{query.booked}</p>
        <p className="small muted">
          A calendar invitation is on its way to the address you gave. Opening it adds the meeting to
          your calendar. You can close this page.
        </p>
      </Shell>
    );
  }

  const result = await callWorker<BookingPage>("/booking/page", { token });

  if (!result.ok) {
    return (
      <Shell>
        <h1>This page is not available</h1>
        <p className="small muted">{result.error}</p>
      </Shell>
    );
  }

  const page = result.data;
  if (!page || page.unavailable) {
    return (
      <Shell>
        <h1>This link cannot be used</h1>
        <p className="small muted">{page?.unavailable ?? "This booking link is not valid."}</p>
      </Shell>
    );
  }

  if (page.alreadyBookedFor) {
    return (
      <Shell>
        <h1>Already booked</h1>
        <p className="lede">{page.alreadyBookedFor}</p>
        <p className="small muted">
          This link has been used. If you need to move it, reply to the message and we will sort it
          out.
        </p>
      </Shell>
    );
  }

  const who = page.repName ?? "us";

  return (
    <Shell>
      <h1>
        {page.prospectFirstName ? `${page.prospectFirstName}, pick` : "Pick"} a time with {who}
      </h1>
      <p className="lede">
        {page.meetingMinutes} minutes. Times are shown in {page.timezone}.
        {page.location ? ` ${page.location}` : ""}
      </p>

      {query.error ? (
        <div className="notice danger" role="status">
          <p>{query.error}</p>
        </div>
      ) : null}

      {page.slots.length === 0 ? (
        <div className="notice">
          <p>
            <strong>Nothing is open in the next two weeks.</strong> Reply to the message and we will
            find something.
          </p>
        </div>
      ) : (
        <div className="stack-3">
          {page.slots.map((slot) => (
            <form action={confirm} className="card stack-3" key={slot.iso}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="startsAt" value={slot.iso} />
              <strong>{slot.readable}</strong>
              <div className="form-row">
                <label className="field compact">
                  <span>Your name</span>
                  <input name="name" required maxLength={120} autoComplete="name" />
                </label>
                <label className="field compact">
                  <span>Email for the invitation</span>
                  <input name="email" type="email" required maxLength={320} autoComplete="email" />
                </label>
                <button className="btn" type="submit">
                  Book this
                </button>
              </div>
            </form>
          ))}
        </div>
      )}
    </Shell>
  );
}

/**
 * No app chrome. Whoever opens this has no account here and is not going to
 * get one — a sidebar full of things they cannot click is noise on the one
 * page where the only thing that matters is picking a time.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="narrow stack-5">{children}</div>
    </main>
  );
}
