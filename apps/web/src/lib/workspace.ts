import { redirect } from "next/navigation";
import { createClient } from "./supabase-server";
import { isAppConfigured } from "./config";

export interface Session {
  userId: string;
  email: string;
  fullName: string | null;
  workspaceId: string;
  workspaceName: string;
  role: string;
}

/** Resolves the signed-in user's workspace, or sends them where they need to go. */
export async function requireSession(): Promise<Session> {
  // Nothing here can work without a database, and the sign-in page is where
  // that gets explained.
  if (!isAppConfigured()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role, workspace_id, workspaces(name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/onboarding");

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const workspace = membership.workspaces as unknown as { name: string } | null;

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    workspaceId: membership.workspace_id,
    workspaceName: workspace?.name ?? "Workspace",
    role: membership.role,
  };
}
