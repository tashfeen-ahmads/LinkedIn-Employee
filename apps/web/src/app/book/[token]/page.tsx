import { redirect } from "next/navigation";
import { callWorker } from "@/lib/worker";
import { SlotPicker } from "./slot-picker";

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
 *
 * And it never shows the worker's own words. The person reading it is a
 * prospect, not an operator, and "The background service is not responding"
 * is our plumbing printed on somebody else's screen (rule 54). Every refusal
 * below is one of a handful of fixed sentences, chosen by a code.
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

/** What `?error=` may say. A code, never a sentence from the URL. */
const ERRORS: Record<string, string> = {
  choose: "Pick one of the times, then book it.",
  details: "Please check your name and email address, then try again.",
  taken: "That time has just been taken. Please pick another.",
  link: "This booking link cannot be used. Reply to the message and we will send another.",
  failed: "That time could not be booked just now. Try again, or reply to the message and we will sort it out.",
};

/** The worker's refusals, as the codes above. Matched, never forwarded. */
function bookingErrorCode(said: string): keyof typeof ERRORS {
  if (/just been taken|no longer/i.test(said)) return "taken";
  if (/link cannot be used/i.test(said)) return "link";
  if (/name and email/i.test(said)) return "details";
  return "failed";
}

const UNAVAILABLE = "This link cannot be used right now. Reply to the message and we will find a time.";

/**
 * A zone as somebody reads it: "British Summer Time (London)" rather than
 * "Europe/London", which is a database key, and in the case of
 * "America/Indiana/Indianapolis" not even a familiar one.
 */
function readableZone(timeZone: string): string {
  try {
    const long = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "long" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    const city = timeZone.includes("/") ? timeZone.split("/").pop()!.replace(/_/g, " ") : null;
    if (long && city) return `${long} (${city})`;
    return long ?? timeZone;
  } catch {
    return timeZone;
  }
}

async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const startsAt = String(formData.get("startsAt") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const back = (code: keyof typeof ERRORS) => redirect(`/book/${encodeURIComponent(token)}?error=${code}`);

  if (!startsAt) back("choose");
  if (!name || !email) back("details");

  /*
   * The time must be one this page offered, checked here as well as in the
   * worker. `startsAt` arrives from a form and anybody can post one; the
   * worker's `bookFromLink` re-derives the free slots and refuses anything not
   * among them (rule 18), and that stays the guarantee. Asking first means a
   * forged or stale value is answered with "pick another" before a booking is
   * attempted, rather than relying on the one check that also writes.
   */
  const offered = await callWorker<BookingPage>("/booking/page", { token });
  if (!offered.ok || !offered.data) back("failed");
  else if (offered.data.unavailable) back("link");
  else if (!offered.data.slots.some((slot) => slot.iso === startsAt)) back("taken");

  const result = await callWorker<{ ok: boolean; when?: string }>("/booking/confirm", {
    token,
    startsAt,
    name,
    email,
  });

  if (!result.ok) back(bookingErrorCode(result.error));
  // No time in the URL: the confirmation reads it back from the booking
  // itself, so nobody can send a link that shows a meeting that does not exist.
  redirect(`/book/${encodeURIComponent(token)}?booked=1`);
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

  const result = await callWorker<BookingPage>("/booking/page", { token });
  const page = result.ok ? result.data : null;

  if (query.booked) {
    return (
      <Shell>
        <h1>You are booked in</h1>
        {page?.alreadyBookedFor ? <p className="lede">{page.alreadyBookedFor}</p> : null}
        <p className="small muted">
          A calendar invitation is on its way to the address you gave. Opening it adds the meeting to
          your calendar. You can close this page.
        </p>
      </Shell>
    );
  }

  if (!page || page.unavailable) {
    return (
      <Shell>
        <h1>This page is not available</h1>
        <p className="small muted">{UNAVAILABLE}</p>
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
  const error = query.error
    ? Object.prototype.hasOwnProperty.call(ERRORS, query.error)
      ? ERRORS[query.error]
      : ERRORS.failed
    : null;

  return (
    <Shell>
      <h1>
        {page.prospectFirstName ? `${page.prospectFirstName}, pick` : "Pick"} a time with {who}
      </h1>
      <p className="lede">
        {page.meetingMinutes} minutes. Times are shown in {readableZone(page.timezone)}.
        {page.location ? ` ${page.location}` : ""}
      </p>

      {error ? (
        <div className="notice danger" role="alert">
          <p>{error}</p>
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
        <form action={confirm} className="card">
          <input type="hidden" name="token" value={token} />
          <SlotPicker slots={page.slots}>
            <div className="form-row">
              <label className="field compact">
                <span>Your name</span>
                <input name="name" required maxLength={120} autoComplete="name" />
              </label>
              <label className="field compact">
                <span>Email for the invitation</span>
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={320}
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
            </div>
          </SlotPicker>
        </form>
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
    <main className="auth-page" id="main" tabIndex={-1}>
      <div className="narrow stack-5">{children}</div>
    </main>
  );
}
