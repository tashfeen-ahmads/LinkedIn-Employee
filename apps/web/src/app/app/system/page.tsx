import Link from "next/link";
import { requireSession } from "@/lib/workspace";
import { callWorker } from "@/lib/worker";

/**
 * Where the chain is broken, and what to do about it.
 *
 * Built after a week in which every stage of this product failed silently in
 * its own way — a queue that accepted a job and said nothing, a connected
 * account the provider had dropped, a search sent with words where LinkedIn
 * takes ids — and each was found by reasoning backwards from a screen that
 * looked identical in all three cases. This asks every question at once and
 * shows the answers, including the two that need the provider on the phone.
 */

export const dynamic = "force-dynamic";

type CheckState = "ok" | "blocked" | "waiting" | "unknown" | "todo";

interface Check {
  key: string;
  stage: string;
  label: string;
  state: CheckState;
  detail: string;
  fix?: string;
  href?: string;
}

const MARK: Record<CheckState, { glyph: string; word: string; tone: string }> = {
  ok: { glyph: "✓", word: "Working", tone: "positive" },
  blocked: { glyph: "✕", word: "Blocked", tone: "danger" },
  todo: { glyph: "•", word: "Your move", tone: "accent" },
  waiting: { glyph: "·", word: "Waiting", tone: "plain" },
  unknown: { glyph: "?", word: "Unknown", tone: "plain" },
};

export default async function SystemPage() {
  const session = await requireSession();
  const result = await callWorker<{ checkedAt: string; checks: Check[] }>("/jobs/diagnostics", {
    workspaceId: session.workspaceId,
    userId: session.userId,
  });

  if (!result.ok) {
    return (
      <>
        <header className="page-head">
          <p className="eyebrow">System check</p>
          <h1>System check</h1>
        </header>
        <div className="notice danger">
          <p>
            <strong>The background service could not be reached.</strong> {result.error}
          </p>
          <p className="small">
            That is itself the first answer: nothing that depends on the worker — the agents,
            LinkedIn, sending — is running right now.
          </p>
        </div>
      </>
    );
  }

  const checks = result.data?.checks ?? [];
  const blocked = checks.filter((c) => c.state === "blocked");
  const todo = checks.filter((c) => c.state === "todo");
  // The first thing standing in the way, named once at the top. A list of
  // fifteen rows with one red one in the middle is a list nobody reads.
  const next = blocked[0] ?? todo[0] ?? null;

  const stages = [...new Set(checks.map((c) => c.stage))];

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">System check</p>
        <h1>What is standing in the way</h1>
        <p className="small muted prose">
          Every precondition between signing up and a booked meeting, checked against what is true
          right now. Two of these ask LinkedIn&rsquo;s provider directly rather than trusting what is
          stored here — which is the difference between an account that says it is connected and one
          that is.
        </p>
      </header>

      {next ? (
        <div className={`notice ${next.state === "blocked" ? "danger" : "accent"}`}>
          <p>
            <strong>{next.state === "blocked" ? "Blocked: " : "Next: "}</strong>
            {next.label}. {next.detail}
          </p>
          {next.fix ? (
            <p className="small">
              {next.fix}{" "}
              {next.href ? (
                <Link href={next.href} className="btn small">
                  Go
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="notice accent">
          <p>
            <strong>Nothing is blocked.</strong> Every stage from onboarding to replies has what it
            needs.
          </p>
        </div>
      )}

      {stages.map((stage) => (
        <section className="card stack-3" key={stage}>
          <h3>{stage}</h3>
          <ul className="checklist">
            {checks
              .filter((c) => c.stage === stage)
              .map((check) => {
                const mark = MARK[check.state] ?? MARK.unknown;
                return (
                  <li key={check.key} className={`checklist-row${check.state === "ok" ? " is-done" : ""}`}>
                    <span className="checklist-tick" aria-hidden="true">
                      {mark.glyph}
                    </span>
                    <div className="stack-1 grow">
                      <div className="cluster">
                        <span className="small">{check.label}</span>
                        <span className={`pill ${mark.tone} tiny`}>{mark.word}</span>
                      </div>
                      <p className="tiny subtle prewrap">{check.detail}</p>
                      {check.fix ? <p className="tiny">{check.fix}</p> : null}
                    </div>
                    {check.href ? (
                      <Link href={check.href} className="btn ghost small checklist-go">
                        Open
                      </Link>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      <p className="tiny subtle">
        Checked {result.data?.checkedAt ? new Date(result.data.checkedAt).toLocaleString() : "just now"}.
        Reload to run it again — the LinkedIn checks are live calls, so they are not cached.
      </p>
    </>
  );
}
