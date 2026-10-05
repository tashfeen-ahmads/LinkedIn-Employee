import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery } from "@/lib/worker";
import { requestAccountEmails } from "@/lib/account-emails";
import { isValidTimezone } from "@le/shared";

/**
 * First run. Creates the workspace and kicks off the Strategy Agent, so the
 * first screen a new user sees is their own Business Profile rather than an
 * empty dashboard.
 */
export async function createWorkspace(formData: FormData): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/login";

  // A second press, or a retry after the first one worked, must not make a
  // second workspace.
  const { data: existing } = await supabase.from("memberships").select("workspace_id").eq("user_id", user.id).limit(1);
  if (existing?.length) return "/app";

  const companyName = String(formData.get("companyName") ?? "").trim();
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const linkedinCompanyUrl = String(formData.get("linkedinCompanyUrl") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!companyName) return "/onboarding?error=Company+name+is+required";
  if (!websiteUrl && !linkedinCompanyUrl && !description) {
    return "/onboarding?error=Give+us+a+website%2C+a+LinkedIn+page%2C+or+a+description+to+work+from";
  }

  const slug = `${slugify(companyName)}-${Math.random().toString(36).slice(2, 7)}`;

  // One call, not three. A workspace is only visible to its members, so
  // inserting it here and asking for the new id back was refused by the SELECT
  // policy — the membership that would make it visible is written next. The
  // function does both writes together, under the caller's own identity.
  const { data: workspaceId, error } = await supabase.rpc("create_workspace", {
    p_name: companyName,
    p_slug: slug,
    p_full_name: fullName || null,
  });
  if (error || !workspaceId) return `/onboarding?error=${encodeURIComponent(error?.message ?? "Could not create workspace")}`;

  /*
   * Everything else this product needs about a person, written now.
   *
   * Onboarding used to collect five things and the profile screen then asked
   * for six more — a bio, a timezone, sending hours, a Sales Navigator tick
   * and an autonomy setting — on a page somebody had to go and find. Each of
   * those six steers an agent, so until they were answered the product ran on
   * defaults nobody chose: the writer had no voice to use, the limiter read
   * 8-to-18 in UTC, and the Targeting Agent searched a tier the account may
   * not have.
   *
   * That last one is not cosmetic. A search sent to a tier an account does
   * not hold returns nobody at all (rule 12), which reads on screen as "your
   * customer profile matched nobody" rather than "you are not subscribed". A
   * default guessed here is a campaign that silently finds nothing.
   *
   * So the answers land before the Strategy Agent is even asked to run, and
   * the profile screen becomes somewhere to change them rather than the place
   * they are first demanded.
   */
  const bio = String(formData.get("bio") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();

  const profilePatch: { bio?: string; address?: string; timezone?: string } = {};
  if (bio) profilePatch.bio = bio;
  if (address) profilePatch.address = address;
  // Only a zone this runtime can actually evaluate. An unreadable one falls
  // back to UTC inside the limiter and says nothing, which is how this
  // deployment came to invite New Yorkers at four in the morning.
  if (timezone && isValidTimezone(timezone)) profilePatch.timezone = timezone;
  if (Object.keys(profilePatch).length > 0) {
    await supabase.from("profiles").update(profilePatch).eq("id", user.id);
  }

  // The Strategy Agent runs in the worker; the web tier only enqueues it. A
  // worker outage must not lose the signup, so this does not block — the
  // workspace exists and the user can retry from the dashboard.
  //
  // But it is not silent either. Without this the first screen after signing up
  // is an empty dashboard that looks like the product doing nothing, when in
  // fact nothing was ever started.
  /*
   * The sending window and the search tier belong to the LinkedIn account,
   * which does not exist yet — nobody has connected one. They are stashed on
   * the workspace so the row can take them the moment it is created, rather
   * than being asked for a second time after connecting.
   */
  const start = Number(formData.get("start"));
  const end = Number(formData.get("end"));
  const days = [1, 2, 3, 4, 5, 6, 0].filter((day) => formData.get(`day-${day}`) === "on");
  const hoursUsable =
    Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && start < end && days.length > 0;

  await supabase
    .from("workspaces")
    .update({
      onboarding: {
        workingHours: hoursUsable ? { start, end, days } : null,
        hasSalesNavigator: formData.get("hasSalesNavigator") === "on",
        autonomy: formData.get("autonomy") === "autonomous" ? "autonomous" : "supervised",
      } as never,
    })
    .eq("id", workspaceId);

  const queued = await callWorker("/jobs/strategy", {
    workspaceId,
    userId: user.id,
    websiteUrl: websiteUrl || undefined,
    linkedinCompanyUrl: linkedinCompanyUrl || undefined,
    description: description || undefined,
  });

  // The operators hear that onboarding finished, and anybody whose welcome
  // was lost to a worker blip at signup gets it now.
  await requestAccountEmails(user.id);

  if (!queued.ok) {
    return errorQuery("/app", `Your workspace is ready, but we could not start writing your profiles: ${queued.error}`);
  }
  return "/app";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
}
