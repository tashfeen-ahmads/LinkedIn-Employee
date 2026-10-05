import { NextResponse, type NextRequest } from "next/server";
import { callWorker } from "@/lib/worker";
import { seeOther } from "@/lib/see-other";

/*
 * The one-click unsubscribe endpoint, and the URL in every marketing email's
 * `List-Unsubscribe` header.
 *
 * POST is the only verb that changes anything. It arrives two ways: from the
 * button on /unsubscribe, which carries `from=page` and is sent back to that
 * page with the outcome; and from Gmail or Apple Mail acting on RFC 8058, whose
 * body is `List-Unsubscribe=One-Click` and who wants a 2xx and nothing else.
 *
 * GET only forwards to the page that asks. A link scanner fetching every URL
 * in a message must not be able to unsubscribe the person it is protecting.
 *
 * The token is verified by the worker, which holds the key it was signed with;
 * this route never decides on its own that a token is good.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  return seeOther(`/unsubscribe?token=${encodeURIComponent(token)}`);
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const token = request.nextUrl.searchParams.get("token") ?? String(form?.get("token") ?? "");
  const fromPage = form?.get("from") === "page";

  const result = await callWorker("/email/unsubscribe", { token });

  if (fromPage) {
    const to = result.ok
      ? "/unsubscribe?done=1"
      : `/unsubscribe?token=${encodeURIComponent(token)}&error=${encodeURIComponent(result.error)}`;
    return seeOther(to);
  }

  // A mailbox provider reads the status and nothing else.
  return result.ok
    ? new NextResponse("Unsubscribed.", { status: 200 })
    : new NextResponse(result.error, { status: 400 });
}
