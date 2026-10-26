import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { seeOther } from "@/lib/see-other";

/** Turns liking and commenting on prospects' posts on or off for the workspace (rule 68). */
export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return seeOther(errorQuery("/app/engagement", "That was refused. Change it from this page."));
  }
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    return seeOther(errorQuery("/app/engagement", "Only an owner or admin can change this."));
  }
  const form = await request.formData().catch(() => null);
  const on = String(form?.get("on") ?? "") === "true";
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspaces")
    .update({ engage_posts: on })
    .eq("id", session.workspaceId)
    .select("id");
  if (!data?.length) return seeOther(errorQuery("/app/engagement", "That could not be saved just now. Try again."));
  return seeOther(
    noticeQuery(
      "/app/engagement",
      on ? "Nora will like and comment on your prospects' posts again." : "Nora has stopped liking and commenting. Anything already planned is skipped.",
    ),
  );
}
