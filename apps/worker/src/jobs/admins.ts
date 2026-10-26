import { z } from "zod";
import type { Db } from "@le/db";
import { ADMIN_ROLES, adminCan, type AdminRole } from "@le/shared";

/**
 * Who runs the platform, changed from the console (rule 15, rule 59).
 *
 * Granting admin was SQL-only on purpose: nothing in the API could write
 * `platform_admins`, so a bug in the app could never promote anybody. That is
 * still true of the API. What changed is that the worker, which holds the
 * service role, now does it for an owner who asked from the console, after
 * checking that they are an owner. Three guards hold the rest:
 *
 * - Only an owner adds, changes or removes an admin.
 * - The platform always keeps an owner: the last one can be neither demoted
 *   nor removed, or nobody could ever add an admin again except from SQL.
 * - Somebody without an account yet is invited by address, and the invitation
 *   is claimed only by a person signed in with exactly that address.
 */
const Role = z.enum(ADMIN_ROLES);

export const AdminTeamSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list") }),
  z.object({ op: z.literal("add"), email: z.string().trim().toLowerCase().email().max(320), role: Role }),
  z.object({ op: z.literal("set-role"), targetUserId: z.string().uuid(), role: Role }),
  z.object({ op: z.literal("remove"), targetUserId: z.string().uuid() }),
  z.object({ op: z.literal("revoke-invite"), email: z.string().trim().toLowerCase().email().max(320) }),
  z.object({ op: z.literal("claim") }),
]);
export type AdminTeamOp = z.infer<typeof AdminTeamSchema>;

export interface AdminMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: AdminRole;
  addedAt: string;
  addedBy: string | null;
}

export interface AdminInvite {
  email: string;
  role: AdminRole;
  invitedAt: string;
  invitedBy: string | null;
}

export type AdminTeamResult =
  | { ok: true; detail: string; admins?: AdminMember[]; invites?: AdminInvite[]; role?: AdminRole }
  | { ok: false; error: string; status: 400 | 403 | 404 | 409 };

/** The caller's role, or null for anybody who is not an admin. A failed read is a "no". */
export async function adminRoleOf(db: Db, userId: string): Promise<AdminRole | null> {
  const { data, error } = await db.from("platform_admins").select("role").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return ((data.role as AdminRole | null) ?? "owner") as AdminRole;
}

export async function runAdminTeam(db: Db, callerId: string, op: AdminTeamOp): Promise<AdminTeamResult> {
  if (op.op === "claim") return claimInvite(db, callerId);

  const callerRole = await adminRoleOf(db, callerId);
  if (!callerRole) return { ok: false, error: "Only an admin can see this.", status: 403 };
  if (op.op === "list") return list(db);
  if (!adminCan(callerRole, "manage-admins")) {
    return { ok: false, error: "Only an owner can change who is an admin.", status: 403 };
  }

  switch (op.op) {
    case "add":
      return add(db, callerId, op.email, op.role);
    case "set-role":
      return setRole(db, op.targetUserId, op.role);
    case "remove":
      return remove(db, op.targetUserId);
    case "revoke-invite": {
      const { error } = await db.from("platform_admin_invites").delete().eq("email", op.email);
      if (error) return { ok: false, error: error.message, status: 409 };
      return { ok: true, detail: `The invitation for ${op.email} is withdrawn.` };
    }
  }
}

async function list(db: Db): Promise<AdminTeamResult> {
  const [{ data: rows, error }, { data: invites, error: inviteError }] = await Promise.all([
    db.from("platform_admins").select("user_id, role, created_at, added_by"),
    db.from("platform_admin_invites").select("email, role, created_at, invited_by"),
  ]);
  if (error || inviteError) return { ok: false, error: (error ?? inviteError)!.message, status: 409 };
  const ids = [...new Set([...(rows ?? []).map((r) => r.user_id), ...(rows ?? []).map((r) => r.added_by), ...(invites ?? []).map((i) => i.invited_by)].filter(Boolean))] as string[];
  const { data: profiles } = ids.length
    ? await db.from("profiles").select("id, email, full_name").in("id", ids)
    : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const admins: AdminMember[] = (rows ?? [])
    .map((r) => ({
      userId: r.user_id,
      email: byId.get(r.user_id)?.email ?? null,
      fullName: byId.get(r.user_id)?.full_name ?? null,
      role: ((r.role as AdminRole | null) ?? "owner") as AdminRole,
      addedAt: r.created_at,
      addedBy: r.added_by ? (byId.get(r.added_by)?.email ?? null) : null,
    }))
    .sort((a, b) => ADMIN_ROLES.indexOf(a.role) - ADMIN_ROLES.indexOf(b.role) || a.addedAt.localeCompare(b.addedAt));
  return {
    ok: true,
    detail: `${admins.length} admin${admins.length === 1 ? "" : "s"}`,
    admins,
    invites: (invites ?? []).map((i) => ({
      email: i.email,
      role: i.role as AdminRole,
      invitedAt: i.created_at,
      invitedBy: i.invited_by ? (byId.get(i.invited_by)?.email ?? null) : null,
    })),
  };
}

/** `ilike` without wildcards: an address with an underscore must match only itself. */
function exactEmail(email: string): string {
  return email.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function add(db: Db, callerId: string, email: string, role: AdminRole): Promise<AdminTeamResult> {
  const { data: profiles, error } = await db.from("profiles").select("id, email").ilike("email", exactEmail(email)).limit(2);
  if (error) return { ok: false, error: error.message, status: 409 };
  const profile = (profiles ?? []).find((p) => (p.email ?? "").toLowerCase() === email);

  if (!profile) {
    const { error: inviteError } = await db
      .from("platform_admin_invites")
      .upsert({ email, role, invited_by: callerId }, { onConflict: "email" });
    if (inviteError) return { ok: false, error: inviteError.message, status: 409 };
    return {
      ok: true,
      detail: `${email} has no account yet. They become ${role === "admin" ? "an" : "a"} ${role} the first time they sign up and open the console.`,
    };
  }

  const existing = await adminRoleOf(db, profile.id);
  if (existing) return { ok: false, error: `${email} is already ${article(existing)} ${existing}.`, status: 409 };
  const { error: insertError } = await db
    .from("platform_admins")
    .insert({ user_id: profile.id, role, added_by: callerId, note: `added from the console as ${role}` });
  if (insertError) return { ok: false, error: insertError.message, status: 409 };
  return { ok: true, detail: `${email} is now ${article(role)} ${role}.` };
}

async function owners(db: Db): Promise<string[] | null> {
  const { data, error } = await db.from("platform_admins").select("user_id").eq("role", "owner");
  return error ? null : (data ?? []).map((r) => r.user_id);
}

async function setRole(db: Db, targetUserId: string, role: AdminRole): Promise<AdminTeamResult> {
  const current = await adminRoleOf(db, targetUserId);
  if (!current) return { ok: false, error: "That person is not an admin.", status: 404 };
  if (current === role) return { ok: true, detail: `Already ${article(role)} ${role}.` };
  if (current === "owner") {
    const all = await owners(db);
    // Unreadable is not "there are others": the guard has to be able to look.
    if (!all || all.filter((id) => id !== targetUserId).length === 0) {
      return { ok: false, error: "The platform needs at least one owner. Make somebody else an owner first.", status: 409 };
    }
  }
  const { error } = await db.from("platform_admins").update({ role }).eq("user_id", targetUserId);
  if (error) return { ok: false, error: error.message, status: 409 };
  return { ok: true, detail: `Role changed to ${role}.` };
}

async function remove(db: Db, targetUserId: string): Promise<AdminTeamResult> {
  const current = await adminRoleOf(db, targetUserId);
  if (!current) return { ok: false, error: "That person is not an admin.", status: 404 };
  if (current === "owner") {
    const all = await owners(db);
    if (!all || all.filter((id) => id !== targetUserId).length === 0) {
      return { ok: false, error: "The platform needs at least one owner. Make somebody else an owner first.", status: 409 };
    }
  }
  const { error } = await db.from("platform_admins").delete().eq("user_id", targetUserId);
  if (error) return { ok: false, error: error.message, status: 409 };
  return { ok: true, detail: "Removed. They keep their own account and workspace." };
}

/**
 * Turns an invitation into a role for the person it was addressed to. The
 * address is read from their own profile, never from the request, so an
 * invitation cannot be claimed by somebody typing another person's email.
 */
async function claimInvite(db: Db, userId: string): Promise<AdminTeamResult> {
  const already = await adminRoleOf(db, userId);
  if (already) return { ok: true, detail: "Already an admin.", role: already };
  const { data: profile } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
  const email = (profile?.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "No invitation.", status: 404 };
  const { data: invite } = await db.from("platform_admin_invites").select("email, role, invited_by").eq("email", email).maybeSingle();
  if (!invite) return { ok: false, error: "No invitation.", status: 404 };
  const role = invite.role as AdminRole;
  const { error } = await db
    .from("platform_admins")
    .insert({ user_id: userId, role, added_by: invite.invited_by, note: `invited from the console as ${role}` });
  if (error) return { ok: false, error: error.message, status: 409 };
  await db.from("platform_admin_invites").delete().eq("email", email);
  return { ok: true, detail: `Welcome. You are ${article(role)} ${role}.`, role };
}

function article(role: AdminRole): string {
  return role === "admin" || role === "owner" ? "an" : "a";
}
