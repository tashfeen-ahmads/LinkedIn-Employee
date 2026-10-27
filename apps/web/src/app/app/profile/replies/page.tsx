import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { AUTONOMY_ROLES, setAutonomy } from "@/lib/autonomy";
import { readWorkspaceEntitlement, replyPlanNote } from "@/lib/entitlement";
import { alwaysHoldsSentence } from "@le/shared";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/page";
import { readAutonomy } from "../autonomy-state";
import { PROFILE_SECTIONS } from "../sections";

const HERE = PROFILE_SECTIONS.replies;

/**
 * Who finishes a conversation: Nora on its own, or Nora with you reading the
 * uncertain ones first (rule 41).
 *
 * Two plain choices rather than a dropdown, because the difference between
 * them is the most consequential setting on this screen and a dropdown hides
 * the option you did not pick. What autopilot never does on its own is said
 * under both, from the one shared list (`alwaysHoldsSentence`).
 */
async function saveReplies(formData: FormData) {
  "use server";
  const session = await requireSession();
  if (!(AUTONOMY_ROLES as readonly string[]).includes(session.role)) {
    redirect(errorQuery(HERE, "Only an owner, admin or manager can change how replies are handled."));
  }
  const wanted = formData.get("autonomy");
  if (wanted !== "autonomous" && wanted !== "supervised") redirect(errorQuery(HERE, "Choose one of the two."));
  const supabase = await createClient();

  /* ---- how much the agent finishes on its own ---- */
  // On the workspace and on every campaign in it: one definition, shared with
  // onboarding, so neither writes half of it.
  await setAutonomy(supabase, session.workspaceId, wanted === "autonomous" ? "autonomous" : "supervised");

  revalidatePath("/app/profile", "layout");
  redirect(
    noticeQuery(
      HERE,
      wanted === "autonomous"
        ? "Saved. Nora answers and books on its own, on every campaign."
        : "Saved. Anything Nora is unsure of waits for you in the Inbox.",
    ),
  );
}

export default async function RepliesPage({ searchParams }: { searchParams: NoticeParams }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const [{ data: wsRow }, { data: ruleRows }, entitlement] = await Promise.all([
    supabase.from("workspaces").select("onboarding").eq("id", session.workspaceId).maybeSingle(),
    supabase.from("campaigns").select("rules").eq("workspace_id", session.workspaceId),
    readWorkspaceEntitlement(supabase, session.workspaceId),
  ]);
  // The workspace's own answer first, its campaigns only when it has none.
  const autonomy = readAutonomy(wsRow?.onboarding, ruleRows);
  // A Pro workspace that picks "on its own" is held anyway (`rulesForPlan` in
  // the worker), so the screen says so rather than letting the choice look
  // like it took.
  const planNote = replyPlanNote(entitlement);
  const canChange = (AUTONOMY_ROLES as readonly string[]).includes(session.role);

  const choices = [
    {
      value: "autonomous",
      title: "Nora answers on its own",
      body: "Replies go out and meetings are booked without waiting for you. You can read every conversation in the Inbox.",
    },
    {
      value: "supervised",
      title: "Nora asks me when it is unsure",
      body: "Clear replies go out. Anything uncertain, like pricing or a complaint, waits in the Inbox for you to read first.",
    },
  ] as const;

  return (
    <>
      <PageNotice error={params.error} notice={params.notice} />
      <Section id="autonomy" title="Replies" description="What happens when somebody writes back. This applies to every campaign.">
        {canChange ? (
          <form action={saveReplies} className="card profile-card profile-form">
            <fieldset className="profile-choices">
              <legend>When a reply arrives</legend>
              {choices.map((choice) => (
                <label key={choice.value} className="profile-choice">
                  <input type="radio" name="autonomy" value={choice.value} defaultChecked={autonomy === choice.value} />
                  <span className="profile-choice-text">
                    <strong>{choice.title}</strong>
                    <span className="small muted">{choice.body}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="small muted">{alwaysHoldsSentence()}</p>
            {planNote ? <p className="small warning-text">{planNote}</p> : null}
            <div className="profile-form-foot">
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </div>
          </form>
        ) : (
          <div className="card profile-card">
            <p>
              <strong>{autonomy === "autonomous" ? choices[0].title : choices[1].title}.</strong>{" "}
              <span className="muted">{autonomy === "autonomous" ? choices[0].body : choices[1].body}</span>
            </p>
            <p className="small muted">{alwaysHoldsSentence()}</p>
            {planNote ? <p className="small muted">{planNote}</p> : null}
            <p className="small muted">An owner, admin or manager can change this.</p>
          </div>
        )}
      </Section>
    </>
  );
}
