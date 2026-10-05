import Link from "next/link";
import { BRAND } from "@le/shared";
import { SiteFooter, SiteHeader } from "@/components/marketing";

export const dynamic = "force-dynamic";

/**
 * Where the unsubscribe link in a product email lands.
 *
 * Opening the link changes nothing. Corporate mail filters fetch every link in
 * a message to scan it, and an unsubscribe that fired on GET would quietly
 * unsubscribe everybody behind one of those filters — so the page asks, and
 * the button posts. Mailbox providers that support RFC 8058 skip this page
 * entirely and POST to `/unsubscribe/confirm` themselves.
 *
 * No sign-in: the signed token in the link is the whole authorisation, and it
 * can only ever stop email.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";

  return (
    <>
      <SiteHeader />
      <main className="auth-page">
        {params.done ? (
          <header>
            <h1>You are unsubscribed</h1>
            <p className="muted">
              No more product emails from {BRAND.name} — no setup tips and no announcements. Emails about
              your own account, like a paused LinkedIn connection or a teammate&rsquo;s invitation,
              still arrive, because those are things you need to know.
            </p>
            <p className="muted small">
              <Link href="/app">Back to {BRAND.name}</Link>
            </p>
          </header>
        ) : token ? (
          <>
            <header>
              <h1>Unsubscribe from product emails?</h1>
              <p className="muted">
                You will stop getting setup tips and product announcements from {BRAND.name}. Emails
                about your own account still arrive.
              </p>
            </header>
            {params.error ? <div className="notice danger">{params.error}</div> : null}
            <form method="post" action={`/unsubscribe/confirm?token=${encodeURIComponent(token)}`}>
              <input type="hidden" name="from" value="page" />
              <button className="btn block" type="submit">
                Unsubscribe
              </button>
            </form>
          </>
        ) : (
          <header>
            <h1>This link is incomplete</h1>
            <p className="muted">
              The unsubscribe link is missing the part that says who it is for. Open it again from the
              email, or reply to any email from us and we will take you off by hand.
            </p>
          </header>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
