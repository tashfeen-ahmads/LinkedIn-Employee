"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { controlFromForm, safeBack } from "@/lib/admin-control";

/**
 * Every button on the operator console posts here.
 *
 * The worker performs the op — it holds the service role, and checks
 * `platform_admins` again before it does anything — and its sentence about
 * what happened comes back through the URL, the only channel an action that
 * redirects has.
 */
export async function adminControl(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const back = safeBack(formData.get("back"));
  const control = controlFromForm(formData);
  if (!control) redirect(errorQuery(back.split("?")[0] ?? "/admin", "That control is missing something it needs."));

  // A minute, not ten seconds: some ops ask the provider or a model and say
  // what they found, and cutting that off reports a working op as a failure.
  const result = await callWorker<{ detail?: string }>(
    "/admin/control",
    { userId: admin.userId, control },
    60_000,
  );
  revalidatePath(back.split("?")[0] ?? "/admin");
  const path = back.split("?")[0] ?? "/admin";
  redirect(result.ok ? noticeQuery(path, result.data?.detail ?? "Done.") : errorQuery(path, result.error));
}

/**
 * Adding, changing and removing admins. The worker performs it after checking
 * the caller is an owner, and keeps the platform from losing its last owner.
 */
export async function adminTeam(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const back = "/admin/team";
  const kind = String(formData.get("op") ?? "");
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const op =
    kind === "add"
      ? { op: "add", email: text("email").toLowerCase(), role: text("role") }
      : kind === "set-role"
        ? { op: "set-role", targetUserId: text("targetUserId"), role: text("role") }
        : kind === "remove"
          ? { op: "remove", targetUserId: text("targetUserId") }
          : kind === "revoke-invite"
            ? { op: "revoke-invite", email: text("email").toLowerCase() }
            : null;
  if (!op) redirect(errorQuery(back, "That request is missing something it needs."));
  const result = await callWorker<{ detail?: string }>("/admin/admins", { userId: admin.userId, op }, 15_000);
  revalidatePath(back);
  redirect(result.ok ? noticeQuery(back, result.data?.detail ?? "Done.") : errorQuery(back, result.error));
}
