/**
 * Reading a console form into one control for the worker.
 *
 * Pure, so the mapping can be tested without a request. The worker validates
 * the result again with its own schema; this only decides which fields a form
 * may send, so a hidden input cannot smuggle anything else along.
 */
export const CONTROL_FIELDS = ["reason", "ticketId", "campaignId", "workspaceId", "accountId", "task", "queue"] as const;

export type ControlInput = { op: string } & Partial<Record<(typeof CONTROL_FIELDS)[number], string>> & { on?: boolean };

export function controlFromForm(form: FormData): ControlInput | null {
  const op = String(form.get("op") ?? "").trim();
  if (!op) return null;
  const control: ControlInput = { op };
  for (const field of CONTROL_FIELDS) {
    const value = form.get(field);
    if (typeof value === "string" && value.trim()) control[field] = value.trim();
  }
  const on = form.get("on");
  if (on === "true" || on === "false") control.on = on === "true";
  return control;
}

/**
 * Where to come back to after a control. Only a console path: the value comes
 * from a form field, and an unchecked redirect target is a link anybody can
 * craft to send an operator somewhere else after they press a button.
 */
export function safeBack(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (/^\/admin(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_%.-]*)?$/.test(value) && !value.startsWith("//")) return value;
  return "/admin";
}
