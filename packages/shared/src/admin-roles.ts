/**
 * Who may do what in the operator console, said once (rule 15, rule 59).
 *
 * Four roles, because the people who run this product do four different jobs.
 * An owner runs the platform and decides who else may; an admin runs it without
 * that; support answers customers; a viewer reads. The worker checks every
 * control against this before it acts, and the console hides what a role
 * cannot press, so the two can never disagree about who may pause a campaign.
 */
export const ADMIN_ROLES = ["owner", "admin", "support", "viewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, { name: string; does: string }> = {
  owner: { name: "Owner", does: "Everything, including adding and removing admins." },
  admin: { name: "Admin", does: "Every control and setting. Cannot change who is an admin." },
  support: { name: "Support", does: "Answers tickets and resets passwords. Reads everything else." },
  viewer: { name: "Viewer", does: "Reads the console. Cannot press anything." },
};

/** What a role is allowed to do, by area. */
export type AdminPermission = "manage-admins" | "controls" | "announcements" | "support";

const GRANTS: Record<AdminRole, readonly AdminPermission[]> = {
  owner: ["manage-admins", "controls", "announcements", "support"],
  admin: ["controls", "announcements", "support"],
  support: ["support"],
  viewer: [],
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

/** An unknown or missing role can do nothing: the privilege is what is being asked about. */
export function adminCan(role: string | null | undefined, permission: AdminPermission): boolean {
  return isAdminRole(role) && GRANTS[role].includes(permission);
}

/** The permission a console control needs. Support ops are support's; everything else is a control. */
export function permissionForControl(op: string): AdminPermission {
  // Hiding a workspace from every admin decides what the whole team can see,
  // so it is an owner's, like deciding who is on the team.
  if (op === "workspace-console-hidden") return "manage-admins";
  return op === "support-redraft" || op === "support-sweep" || op === "user-password-reset" ? "support" : "controls";
}
