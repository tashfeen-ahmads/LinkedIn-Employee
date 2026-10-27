import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { carryVoiceToAgent } from "@/lib/agent-voice";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { linkedInConnectError } from "@le/shared";
import { PageNotice } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/page";
import { label } from "@/lib/labels";
import { forwardQuery } from "@/lib/forward-query";
import { cannotSend } from "../team/repair";
import { describeClaim } from "./claim";
import { linkedInState } from "./linkedin-state";
import { ConnectLinkedInButton } from "./linkedin-connect";
import { PROFILE_SECTIONS } from "./sections";

/**
 * You: the name invitations go out under, and how you describe yourself.
 *
 * The first section of the profile, at the profile's own address, so every
 * link that ever pointed at `/app/profile` still opens something sensible.
 *
 * It is also where the round trips land. LinkedIn's sign-in comes back to
 * `/app/profile?connected=1&account_id=…`, Stripe's checkout to
 * `?checkout=…`, and a refused sign-in to `?error=<code>`; each is handed to
 * the section it is about before anything renders here, so the answer is said
 * beside the thing it is an answer about.
 */

/** Saves the rep's own details. The agent writes every message, so a corrected name reaches it too. */
async function saveYou(formData: FormData) {
  "use server";
  const session = await requireSession();
  const supabase = await createClient();

  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!fullName) {
    redirect(errorQuery(PROFILE_SECTIONS.you, "Your name is what a prospect sees the invitation come from, so it cannot be blank."));
  }
  const bio = String(formData.get("bio") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  const { data: before } = await supabase.from("profiles").select("full_name, bio").eq("id", session.userId).maybeSingle();
  const { data: saved, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName.slice(0, 120), bio: bio || null, address: address || null })
    .eq("id", session.userId)
    .select("id");
  if (error || !saved?.length) redirect(errorQuery(PROFILE_SECTIONS.you, "Your details could not be saved. Please try again."));

  // As onboarding does: the agent writes under this name and from this bio.
  await carryVoiceToAgent(
    supabase,
    session.workspaceId,
    { fullName: before?.full_name ?? null, bio: before?.bio ?? null },
    { fullName: fullName.slice(0, 120), bio: bio || null },
  );

  revalidatePath("/app/profile", "layout");
  redirect(noticeQuery(PROFILE_SECTIONS.you, "Saved."));
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const one = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : undefined);
  const session = await requireSession();

  /*
   * The hosted flow comes back here, and the id it carries is the connection.
   *
   * The provider's accounts list returns nothing holding the identifier the
   * hosted link was given, so an account finished at the provider could not be
   * tied to the rep who started it by asking. It can by being handed the id on
   * the way back, which is what `account_id` is, and the worker checks it
   * against the provider and the rep's own pending row before it binds.
   *
   * And it reports what actually happened. An unconditional "LinkedIn is
   * connected." over a claim the worker refused is the screen contradicting
   * the database with the reassuring half arriving first (`describeClaim`).
   */
  if (one("connected") && one("account_id")) {
    const claim = await callWorker<{ claimed?: boolean; reason?: string }>("/jobs/linkedin-claim", {
      workspaceId: session.workspaceId,
      userId: session.userId,
      accountId: one("account_id"),
    });
    const said = describeClaim(claim);
    redirect(
      said.tone === "notice"
        ? noticeQuery(PROFILE_SECTIONS.linkedin, said.message)
        : errorQuery(PROFILE_SECTIONS.linkedin, said.message),
    );
  }
  // A return with no id is asked about on arrival by the LinkedIn section.
  if (one("connected")) redirect(`${PROFILE_SECTIONS.linkedin}?connected=1`);
  // A refused LinkedIn sign-in comes back as a code, never a sentence.
  if (linkedInConnectError(one("error"))) redirect(`${PROFILE_SECTIONS.linkedin}${forwardQuery(raw)}`);
  // Back from Stripe's checkout.
  if (one("checkout")) redirect(`${PROFILE_SECTIONS.billing}${forwardQuery(raw)}`);

  const supabase = await createClient();
  const [{ data: me }, { data: account }] = await Promise.all([
    supabase.from("profiles").select("bio, address, username").eq("id", session.userId).maybeSingle(),
    supabase
      .from("linkedin_accounts")
      .select("status, status_detail, provider_account_id")
      .eq("workspace_id", session.workspaceId)
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);
  const linkedIn = linkedInState(account);
  // The account banner says "Reconnect on your profile" and links here, so the
  // button it promised is on this page too, above everything else.
  const blocked = !account || linkedIn.kind !== "attached" || cannotSend(account.status) || account.status !== "active";

  return (
    <>
      <PageNotice error={one("error")} notice={one("notice")} />

      {blocked ? (
        <div className="notice warning profile-blocked" role="status">
          <p>
            <strong>Your LinkedIn account cannot send yet.</strong>{" "}
            {linkedIn.kind === "failed" ? linkedIn.detail : "Nothing goes out until it is connected."}
          </p>
          <div className="profile-blocked-actions">
            <ConnectLinkedInButton>{linkedIn.kind === "attached" ? "Connect LinkedIn again" : "Connect LinkedIn"}</ConnectLinkedInButton>
          </div>
        </div>
      ) : null}

      <Section id="you" title="You" description="Invitations and replies go out under your name, in your voice.">
        <form action={saveYou} className="card profile-card profile-form">
          <div className="profile-fields">
            <label className="field">
              <span>Your name</span>
              <input name="fullName" required maxLength={120} autoComplete="name" defaultValue={session.fullName ?? ""} />
            </label>
            <label className="field">
              <span>How you would describe yourself to a prospect</span>
              <textarea
                name="bio"
                rows={4}
                defaultValue={me?.bio ?? ""}
                placeholder="Twelve years in logistics ops before this. I care about the boring parts…"
              />
              <span className="hint">Nora reads this before writing anything as you. A sentence or two is plenty.</span>
            </label>
            <label className="field">
              <span>Business address (optional)</span>
              <textarea name="address" rows={2} autoComplete="street-address" defaultValue={me?.address ?? ""} />
            </label>
          </div>
          <dl className="profile-facts">
            <div>
              <dt>Signed in as</dt>
              <dd>{session.email}</dd>
            </div>
            {me?.username ? (
              <div>
                <dt>Username</dt>
                <dd>{me.username}</dd>
              </div>
            ) : null}
            <div>
              <dt>Role</dt>
              <dd>{label(session.role)}</dd>
            </div>
          </dl>
          <div className="profile-form-foot">
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </div>
        </form>
      </Section>
    </>
  );
}
