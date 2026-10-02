import { NextResponse, type NextRequest } from "next/server";
import { createWorkspace } from "@/lib/create-workspace";

/*
 * The onboarding form posts here as a plain HTML form, not a server action.
 *
 * A server action is addressed by an id that changes with every deploy, so a
 * form opened before one and submitted after it asked for an action that no
 * longer existed — and the customer got "Application error: a client-side
 * exception" with nothing sent. A URL does not change between deploys, and a
 * 303 is followed by every browser without any of our JavaScript running.
 */
export async function POST(request: NextRequest) {
  const to = await createWorkspace(await request.formData());
  return NextResponse.redirect(new URL(to, request.url), 303);
}
