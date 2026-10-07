import { emailAliases, loginIdentifier } from "@le/shared";
import { passwordResetEmail, signInReminderEmail } from "@le/email";
import type { WorkerContext } from "../context.js";
import { sendOnce } from "../email.js";

/**
 * Getting back in: a new password, or a reminder of which address signs in.
 *
 * Every login complaint so far has been one of two things — a forgotten
 * password, or a person signing in with a different address from the one they
 * set up with and being handed a brand new empty account. Both are answered by
 * email, to the address that was typed, and to nobody else.
 *
 * Nothing here says whether an account exists. The route answers the same way
 * for every request, so the form cannot be used to learn who is a customer.
 */
export interface FoundAccount {
  userId: string;
  email: string;
  username: string | null;
  fullName: string | null;
  workspace: string | null;
}

/** How long one person waits between two recovery emails of the same kind. */
export const RECOVERY_WINDOW_MS = 10 * 60_000;

/** Mints a one-time recovery token for an address. Injected so tests need no auth server. */
export type RecoveryTokenMinter = (email: string) => Promise<string | null>;

export function supabaseRecoveryMinter(ctx: WorkerContext): RecoveryTokenMinter {
  return async (email) => {
    const { data, error } = await ctx.db.auth.admin.generateLink({ type: "recovery", email });
    if (error) {
      console.error("could not mint a recovery link", { reason: error.message });
      return null;
    }
    return data?.properties?.hashed_token ?? null;
  };
}

/** Every account an identifier could mean: the address and its aliases, or the username. */
export async function findAccounts(ctx: WorkerContext, raw: string): Promise<{ to: string | null; accounts: FoundAccount[] }> {
  const id = loginIdentifier(raw);
  if (!id) return { to: null, accounts: [] };

  const query = ctx.db.from("profiles").select("id, email, username, full_name");
  const { data: profiles } =
    id.kind === "email"
      ? await query.in("email", emailAliases(id.email))
      : await query.ilike("username", likeExact(id.username));
  if (!profiles?.length) return { to: null, accounts: [] };

  const ids = profiles.map((p) => p.id);
  const { data: memberships } = await ctx.db.from("memberships").select("user_id, workspace_id").in("user_id", ids);
  const workspaceIds = [...new Set((memberships ?? []).map((m) => m.workspace_id))];
  const { data: workspaces } = workspaceIds.length
    ? await ctx.db.from("workspaces").select("id, name").in("id", workspaceIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const nameOf = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const homeOf = new Map((memberships ?? []).map((m) => [m.user_id, nameOf.get(m.workspace_id) ?? null]));

  const accounts = profiles.map((p) => ({
    userId: p.id,
    email: String(p.email).toLowerCase(),
    username: p.username ? String(p.username) : null,
    fullName: p.full_name,
    workspace: homeOf.get(p.id) ?? null,
  }));
  // Written back only to the address typed — an alias of the same inbox — or,
  // for a username, to that account's own address.
  const to = id.kind === "email" ? id.email : (accounts[0]?.email ?? null);
  return { to, accounts };
}

export type RecoveryKind = "password" | "signin";

/**
 * Sends the email, or nothing. Returns what happened for the logs and tests;
 * the route never passes it on.
 */
export async function sendRecovery(
  ctx: WorkerContext,
  input: { identifier: string; kind: RecoveryKind },
  mint: RecoveryTokenMinter = supabaseRecoveryMinter(ctx),
  now: Date = new Date(),
): Promise<"sent" | "no_account" | "throttled" | "no_provider" | "failed"> {
  const { to, accounts } = await findAccounts(ctx, input.identifier);
  if (!to || !accounts.length) return "no_account";
  if (!ctx.email) return "no_provider";

  const appUrl = ctx.env.APP_URL.replace(/\/$/, "");
  const owner = accounts.find((a) => a.workspace) ?? accounts[0]!;
  const bucket = Math.floor(now.getTime() / RECOVERY_WINDOW_MS);
  const step = `recovery.${input.kind}.${bucket}`;

  if (input.kind === "signin") {
    const outcome = await sendOnce(ctx.db, ctx.email, {
      userId: owner.userId,
      step,
      kind: "transactional",
      recipient: to,
      message: signInReminderEmail({ to, appUrl, name: owner.fullName, accounts }),
    });
    return outcome === "sent" ? "sent" : outcome === "already_sent" ? "throttled" : "failed";
  }

  const links: Array<{ email: string; workspace: string | null; url: string }> = [];
  // At most three: one inbox has at most a handful of aliases, and a list
  // longer than that is somebody probing rather than somebody locked out.
  for (const account of accounts.slice(0, 3)) {
    const token = await mint(account.email);
    if (!token) continue;
    const url = `${appUrl}/auth/confirm?type=recovery&token_hash=${encodeURIComponent(token)}&next=${encodeURIComponent("/reset-password")}`;
    links.push({ email: account.email, workspace: account.workspace, url });
  }
  if (!links.length) return "failed";

  const outcome = await sendOnce(ctx.db, ctx.email, {
    userId: owner.userId,
    step,
    kind: "transactional",
    recipient: to,
    message: passwordResetEmail({ to, appUrl, name: owner.fullName, links }),
  });
  return outcome === "sent" ? "sent" : outcome === "already_sent" ? "throttled" : "failed";
}

/**
 * The address a username signs in with, for the sign-in route only — never
 * returned to a browser. The route still needs the password, so this cannot
 * be used to learn anything.
 */
export async function emailForLogin(ctx: WorkerContext, raw: string): Promise<string | null> {
  const id = loginIdentifier(raw);
  if (!id || id.kind !== "username") return null;
  const { data } = await ctx.db.from("profiles").select("email").ilike("username", likeExact(id.username)).maybeSingle();
  return data?.email ? String(data.email).toLowerCase() : null;
}

/**
 * A username as an exact, case-insensitive match. `_` is allowed in usernames
 * and is a wildcard to `ilike`, so it is escaped — `sam_p` must not match
 * `samXp`.
 */
function likeExact(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
