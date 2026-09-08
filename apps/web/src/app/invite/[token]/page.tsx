import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { checkInvite, inviteRejectionMessage } from "@/lib/invitations";
import { SiteFooter, SiteHeader } from "@/components/marketing";

/**
 * Accepting an invitation. The token is looked up server-side and checked
 * against the signed-in user's own email: a link that lands in the wrong inbox,
 * forwarded or shared, must not admit whoever opens it.
 */
async function acceptInvite(formData: FormData) {
  "use server";
  const token = String(formData.get("token"));
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?invite=${encodeURIComponent(token)}`);

  const { data: invite } = await supabase
    .from("invitations")
    .select("id, workspace_id, email, role, expires_at, accepted_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (!invite) redirect(`/invite/${token}?error=notfound`);

  const verdict = checkInvite(invite, user.email ?? "");
  if (!verdict.ok) redirect(`/invite/${token}?error=${verdict.reason}`);

  const { error } = await supabase.from("memberships").insert({
    workspace_id: invite.workspace_id,
    user_id: user.id,
    role: invite.role,
  });
  // A duplicate simply means they were already a member; treat it as success.
  if (error && !error.message.includes("duplicate")) {
    redirect(`/invite/${token}?error=failed`);
  }

  await supabase
    .from("invitations")
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq("id", invite.id);

  redirect("/app");
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: invite } = await supabase
    .from("invitations")
    .select("workspace_id, email, role, expires_at, accepted_at, revoked_at, workspaces(name)")
    .eq("token", token)
    .maybeSingle();

  const workspaceName = (invite?.workspaces as unknown as { name: string } | null)?.name ?? "a workspace";
  const verdict = invite && user ? checkInvite(invite, user.email ?? "") : null;

  return (
    <>
      <SiteHeader />
      <main style={{ padding: "5rem 0" }}>
        <div className="narrow" style={{ maxWidth: 460 }}>
          {!invite ? (
            <>
              <h1 style={{ fontSize: "1.7rem" }}>Invitation not found</h1>
              <p className="muted">
                This link is not valid. Ask whoever invited you to send a new one.
              </p>
            </>
          ) : !user ? (
            <>
              <h1 style={{ fontSize: "1.7rem" }}>You have been invited to {workspaceName}</h1>
              <p className="muted">
                Sign in as <strong>{invite.email}</strong> to accept.
              </p>
              <a className="btn" href={`/login?invite=${encodeURIComponent(token)}`}>
                Sign in to accept
              </a>
            </>
          ) : verdict && !verdict.ok ? (
            <>
              <h1 style={{ fontSize: "1.7rem" }}>This invitation cannot be used</h1>
              <p className="muted">{inviteRejectionMessage(verdict.reason)}</p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: "1.7rem" }}>Join {workspaceName}</h1>
              <p className="muted">
                You will join as a <strong>{invite.role}</strong>. You will connect your own LinkedIn
                account; nobody shares a login.
              </p>
              {error ? (
                <div className="notice danger" style={{ marginBottom: "1rem" }}>
                  Something went wrong accepting this invitation. Try again, or ask for a new link.
                </div>
              ) : null}
              <form action={acceptInvite}>
                <input type="hidden" name="token" value={token} />
                <button className="btn" type="submit">
                  Accept invitation
                </button>
              </form>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
