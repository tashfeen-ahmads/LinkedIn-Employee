import { NextResponse } from "next/server";
import { requireSession } from "@/lib/workspace";
import { callWorker } from "@/lib/worker";

/**
 * Everything this workspace holds, as a file.
 *
 * `docs/03-architecture.md` has promised "per-workspace data export and delete
 * endpoints for GDPR requests" since the first week. The delete has a button on
 * the Prospects page. The export had a worker route and nothing anywhere that
 * could reach it — so serving a subject-access request meant somebody with the
 * internal API secret running curl, which is the same failure as a repair that
 * depends on finding a terminal. A promise only an operator can keep is a
 * promise the customer does not have.
 *
 * A route handler rather than a server action because the answer is a download:
 * an action can only redirect or re-render, and neither hands anybody a file.
 *
 * Owners and admins only. The file contains every prospect, conversation and
 * message in the workspace — it is the one screen in this product that hands
 * over other people's data in bulk, and a rep does not need it to do their job.
 */
export async function GET() {
  const session = await requireSession();
  if (!["owner", "admin"].includes(session.role)) {
    return NextResponse.json({ error: "Only an owner or admin can export a workspace." }, { status: 403 });
  }

  const result = await callWorker<{ exportedAt: string; complete: boolean }>("/jobs/export", {
    // From the session, never from the request: a workspace id in a query
    // string is a way to ask for somebody else's file.
    workspaceId: session.workspaceId,
    userId: session.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(result.data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${session.workspaceName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${stamp}.json"`,
      // Never cached anywhere: this is the most sensitive response the product
      // produces, and a shared cache holding it is a data leak with no bug.
      "cache-control": "no-store, private",
    },
  });
}
