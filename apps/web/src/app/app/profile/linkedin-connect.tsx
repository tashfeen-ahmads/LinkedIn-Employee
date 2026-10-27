import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { SubmitButton } from "@/components/submit-button";
import { describeRefreshRefusal, type RefreshResult } from "../team/repair";
import { PROFILE_SECTIONS } from "./sections";

/** Where every answer from these two buttons is said: the LinkedIn account section. */
const HERE = PROFILE_SECTIONS.linkedin;

/**
 * Starts LinkedIn's hosted consent flow.
 *
 * There were five of these — Google Calendar, Microsoft, HubSpot, Salesforce —
 * pointed at worker routes that do not exist and never did. The worker answered
 * 404, `callWorker` swallowed it and returned null, and the button did nothing
 * at all: no error, no navigation, no change on the page. The four have been
 * removed rather than left looking available.
 *
 * One definition, rendered by the LinkedIn section and by the top of the
 * profile when the account cannot send: the banner that says "reconnect" links
 * to the profile, and the profile has to hold the button it promised.
 */
async function connectLinkedIn() {
  "use server";
  const session = await requireSession();
  const result = await callWorker<{ url?: string }>("/auth/linkedin/link", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (!result.ok) redirect(errorQuery(HERE, result.error));
  if (!result.data?.url) {
    redirect(errorQuery(HERE, "LinkedIn did not return a sign-in link. Please try again."));
  }
  redirect(result.data.url);
}

/**
 * Asks the provider whether this rep's account is connected, instead of waiting
 * to be told.
 *
 * The hosted flow reports success by calling a webhook once. If that delivery
 * is rejected — a signature mismatch, a restart, a webhook registered after the
 * account already connected — the account works perfectly at the provider and
 * sits here as "connecting" forever, with a Start again button that runs the
 * same flow to the same end. This is the way out of that, and it costs one
 * request.
 */
async function refreshLinkedIn() {
  "use server";
  const session = await requireSession();
  // `RefreshResult`, not a second copy of it written inline: the panel and the
  // button read the same response through one type.
  const result = await callWorker<RefreshResult>("/jobs/linkedin-refresh", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });
  if (!result.ok) redirect(errorQuery(HERE, result.error));

  // The account this row claimed to hold is gone from the provider. Said out
  // loud because the row looked healthy while every campaign silently failed
  // against it, and because pressing Connect is all it takes.
  if (result.data?.lost) {
    redirect(
      errorQuery(
        HERE,
        "The LinkedIn account this was connected to is no longer connected. Connect LinkedIn again to start sending.",
      ),
    );
  }

  if (result.data?.changed) {
    redirect(noticeQuery(HERE, "Reconnected: your LinkedIn account is attached again and ready."));
  }

  // `unlabelled` is an account that is here and working, attached without our
  // label — nothing to refuse (`describeRepair` says the same on arrival).
  if (!result.data?.mine && !result.data?.unlabelled) {
    // One sentence the rep can act on, from the same place the panel's own
    // wording comes from — never the provider's payload (rule 54).
    redirect(errorQuery(HERE, describeRefreshRefusal(result.data)));
  }
  revalidatePath("/app/profile", "layout");
  redirect(noticeQuery(HERE, "Checked: your LinkedIn account is connected."));
}

export function ConnectLinkedInButton({
  children = "Connect LinkedIn",
  secondary = false,
}: {
  children?: string;
  secondary?: boolean;
}) {
  return (
    <form action={connectLinkedIn}>
      <SubmitButton className={secondary ? "btn secondary" : "btn"} pendingLabel="Opening LinkedIn…">
        {children}
      </SubmitButton>
    </form>
  );
}

export function CheckLinkedInButton({ children = "Check connection" }: { children?: string }) {
  return (
    <form action={refreshLinkedIn}>
      <SubmitButton className="btn secondary" pendingLabel="Checking…">
        {children}
      </SubmitButton>
    </form>
  );
}
