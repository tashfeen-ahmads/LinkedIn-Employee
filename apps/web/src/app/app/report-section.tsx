import Link from "next/link";
import { Section } from "@/components/page";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { loadDailyReport } from "@/lib/daily-report";

/**
 * What the agent did today, in words.
 *
 * The first thing on the overview, above every chart, because it answers the
 * question a person actually arrives with. The funnel answers "how is it
 * going", which is a question about the month; this answers "what happened",
 * which is a question about yesterday afternoon, and until now the product had
 * no answer to it at all — every fact was in the database and none of it was
 * ever read back to anybody.
 *
 * Sentences first and numbers second, in that order and not the other way
 * round. A row of counters is a dashboard; a paragraph is a colleague. The
 * counters are underneath for the person who wants to check the arithmetic,
 * which is a different and rarer need.
 */
export async function DailyReportSection() {
  const session = await requireSession();
  const supabase = await createClient();
  const { lines, facts } = await loadDailyReport(supabase, session.workspaceId);

  const counts = [
    { label: "Profiles viewed", value: facts.warmed },
    { label: "Invitations", value: facts.invited },
    { label: "Accepted", value: facts.accepted },
    { label: "Messages", value: facts.messaged },
    { label: "Replies", value: facts.replies },
  ].filter((entry) => entry.value > 0);

  const waiting = facts.held.reduce((sum, item) => sum + item.count, 0);

  return (
    <Section
      id="today"
      title="Today"
      description="What your agent did, and anything it needs from you."
      action={
        waiting > 0 ? (
          <Link className="btn small" href="/app/inbox">
            Open the inbox
          </Link>
        ) : facts.loopStalled ? (
          <Link className="btn small" href="/app/system">
            System check
          </Link>
        ) : null
      }
    >
      <div className={`report${facts.loopStalled ? " report-alarm" : ""}`}>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      {/* Only what happened. A row of zeroes reads as a failed day; an absent
          counter reads as "it did not come up", which is the truth. */}
      {counts.length > 0 ? (
        <dl className="report-counts">
          {counts.map((entry) => (
            <div key={entry.label}>
              <dt className="tiny subtle">{entry.label}</dt>
              <dd className="nums">{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Section>
  );
}
