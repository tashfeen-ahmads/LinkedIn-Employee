import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Security and data — where your data sits and who can reach it",
  description:
    "Your LinkedIn password never reaches us. Tokens are encrypted before storage, every tenant is isolated at the database, and a prospect can be erased on request.",
  path: "/security",
});

const POINTS = [
  {
    title: "We never see your LinkedIn password",
    body: "Connecting an account happens on the provider's own hosted page. What comes back is a token bound to your workspace, not a credential we could sign in with.",
  },
  {
    title: "Tokens are encrypted before they are stored",
    body: "Every OAuth credential — LinkedIn, calendar, CRM — is encrypted with AES-256-GCM before it touches the database, using a key held only by the worker. A copy of the database on its own is not enough to act as you.",
  },
  {
    title: "One workspace cannot read another",
    body: "Every table carrying customer data has row-level security keyed to workspace membership, enforced by the database rather than by application code remembering to filter.",
  },
  {
    title: "A prospect can be erased",
    body: "One click removes a person and everything written about them, and records that they must not be contacted again — the record of the erasure is the only thing that survives it, because otherwise the next campaign would find them afresh.",
  },
  {
    title: "Retention is a limit, not a promise",
    body: "Prospect data older than the workspace's retention window is deleted by a nightly sweep, whether or not anyone remembers to ask.",
  },
  {
    title: "Every message is attributable",
    body: "Each sent message records the prompt version that produced it. If a campaign starts saying something wrong, the change that caused it is one query away.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "Security", path: "/security" },
        ]}
      />

      <section className="section">
        <div className="container stack-7">
          <header className="stack-4">
            <p className="eyebrow">Security and data</p>
            <h1>Your account, your data, your call.</h1>
            <p className="lede prose">
              This product acts on a real LinkedIn account and holds real information about real
              people. Both deserve stating plainly rather than a badge.
            </p>
          </header>

          <div className="grid grid-2">
            {POINTS.map((point) => (
              <article key={point.title} className="card stack-2">
                <h2 style={{ fontSize: "1.0625rem" }}>{point.title}</h2>
                <p className="muted small">{point.body}</p>
              </article>
            ))}
          </div>

          <div className="notice">
            <p>
              <strong>What we do not claim.</strong> We are not SOC 2 audited and we do not say we
              are. Ask us again when we have a report to hand you, and in the meantime take this page
              as the honest version.
            </p>
          </div>

          <p className="small subtle prose">
            The other half of safety is not losing the account in the first place — that is on{" "}
            <Link href="/linkedin-automation-limits">the limits page</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
