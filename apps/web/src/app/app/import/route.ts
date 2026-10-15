import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/workspace";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { seeOther } from "@/lib/see-other";

/** Matches `IMPORT_MAX_BYTES` in the worker. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Brings a workspace export back in: configuration and the suppression list,
 * never prospects, campaigns, conversations or members.
 *
 * A route handler rather than a server action for two reasons: an action's
 * body is capped at one megabyte by default, and its id changes with every
 * deploy, so a page opened before one and posted after it fails (rule 57). The
 * answer is a 303 back to the profile page carrying a notice either way.
 *
 * Owners and admins only, as with the export. The workspace is the session's,
 * never anything in the file: the worker writes every row to it and ignores
 * whatever ids the file carries.
 */
export async function POST(request: NextRequest) {
  // A form posted from another site does not get to rewrite somebody's
  // exclusion list with their cookie.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return seeOther(errorQuery("/app/profile", "That import was refused. Please upload the file from this page."));
  }

  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    return seeOther(errorQuery("/app/profile", "Only an owner or admin can import into a workspace."));
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024) {
    return seeOther(errorQuery("/app/profile", "That file is too large to import. The limit is 5 MB."));
  }

  const form = await request.formData().catch(() => null);
  const upload = form?.get("file");
  if (!upload || typeof upload === "string" || upload.size === 0) {
    return seeOther(errorQuery("/app/profile", "Choose an export file to import."));
  }
  if (upload.size > MAX_BYTES) {
    return seeOther(errorQuery("/app/profile", "That file is too large to import. The limit is 5 MB."));
  }

  let file: unknown;
  try {
    file = JSON.parse(await upload.text());
  } catch {
    return seeOther(errorQuery("/app/profile", "That file is not a workspace export. Nothing was imported."));
  }

  const result = await callWorker<{ summary?: string }>(
    "/jobs/import-workspace",
    { workspaceId: session.workspaceId, userId: session.userId, file },
    60_000,
  );
  if (!result.ok) return seeOther(errorQuery("/app/profile", result.error));

  return seeOther(noticeQuery("/app/profile", result.data?.summary ?? "Imported."));
}
