import Link from "next/link";
import { Panel, Section } from "./page";
import { TeamAvatar } from "./team-avatar";
import { LEAD, NORA, TEAM, type TeamFacts, type TeamState, teamStatus } from "@/lib/team";

/** The state in words, because the dot is decoration (rule 32). */
const STATE_LABEL: Record<TeamState, string> = {
  working: "Working",
  done: "Up to date",
  waiting: "Needs you",
  idle: "Waiting on a teammate",
  blocked: "Stopped",
};

/**
 * NORA and her four, each with one line about what they are doing in this
 * workspace right now.
 *
 * Every line is computed by `teamStatus` from facts the overview already
 * loaded (plus one count of prospects), so the panel never says a teammate is
 * busy when nothing was queued — and the needs-you count is the same list at
 * the top of the page, not a second reading of it (rule 50).
 */
export function TeamPanel({ facts }: { facts: TeamFacts }) {
  const status = teamStatus(facts);
  const rows = [
    { key: "lead" as const, name: NORA, role: LEAD.role, href: "/app#needs-you-heading", ...status.lead },
    ...TEAM.map((member) => ({
      key: member.key,
      name: member.name,
      role: member.role,
      href: member.href,
      ...status[member.key],
    })),
  ];

  return (
    <Section
      id="your-team"
      title="Your team"
      description={`${NORA} runs this dashboard; four specialists do the work. Every line is read from this workspace.`}
    >
      <Panel>
        <ul className="roster">
          {rows.map((row) => (
            <li key={row.key}>
              <Link className="roster-row" href={row.href}>
                <TeamAvatar member={row.key} size="sm" />
                <span className="roster-who">
                  <span className="roster-name">{row.name}</span>
                  <span className="tiny subtle">{row.role}</span>
                </span>
                <p className="roster-status small">
                  <span className={`roster-dot ${row.state}`} aria-hidden="true" />
                  <span>
                    <span className="sr-only">{STATE_LABEL[row.state]}: </span>
                    {row.status}
                  </span>
                </p>
                <span className="roster-go" aria-hidden="true">
                  &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </Section>
  );
}
