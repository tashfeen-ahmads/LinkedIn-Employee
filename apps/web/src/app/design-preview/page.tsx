import { notFound } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { PageHeader, PageGroup, Section, Empty } from "@/components/page";
import { NeedsYou } from "@/components/needs-you";
import { Kpi, FunnelChart, AllowanceMeter, StackedDays } from "@/components/charts";
import type { NeedsYouItem } from "@le/shared";

/**
 * A design harness: every shared surface on one screen, with no database.
 *
 * Not reachable in production. It exists so the application's own frame can be
 * looked at rather than reasoned about — which is the only way to catch a
 * section running into the next one or a card with no air in it.
 */
export const dynamic = "force-static";

const NEEDS: NeedsYouItem[] = [
  {
    kind: "linkedin_disconnected",
    title: "Your LinkedIn account is disconnected.",
    why: "Nothing is sent while this is broken — invitations, follow-ups and replies all stop here.",
    href: "/app/profile",
    action: "Reconnect",
    tone: "blocker",
    count: 1,
  },
  {
    kind: "held_reply",
    title: "3 replies are waiting for you.",
    why: "A prospect who answered on Friday and hears nothing by Monday is a warm lead going cold.",
    href: "/app/inbox",
    action: "Open inbox",
    tone: "warning",
    count: 3,
  },
  {
    kind: "strategy_unapproved",
    title: "2 strategies need review.",
    why: "Nobody is searched for until one is approved.",
    href: "/app/strategy",
    action: "Review",
    tone: "warning",
    count: 2,
  },
];

export default function DesignPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="app">
      <aside className="app-aside">
        <div className="app-brand">
          <Link href="/app">LinkedIn&nbsp;Employee</Link>
          <p className="tiny subtle">Referral Nova</p>
        </div>
        <AppNav
          groups={[
            {
              label: "Work",
              alwaysOpen: true,
              items: [
                { href: "/app", label: "Overview", icon: "overview" },
                { href: "/app/inbox", label: "Inbox", icon: "inbox", count: 3 },
                { href: "/app/campaigns", label: "Campaigns", icon: "campaigns", state: "next", stateLabel: "next step" },
              ],
            },
            {
              label: "Setup",
              items: [
                { href: "/app/strategy", label: "Strategies", icon: "strategies" },
                { href: "/app/agents", label: "Agents", icon: "agents" },
                { href: "/app/cta", label: "Calls to action", icon: "cta" },
                { href: "/app/exclusions", label: "Do not contact", icon: "exclusions" },
                { href: "/app/profile", label: "Profile & team", icon: "profile" },
              ],
            },
            {
              label: "More",
              items: [
                { href: "/app/prospects", label: "Prospects", icon: "prospects" },
                { href: "/app/meetings", label: "Meetings", icon: "meetings" },
                { href: "/app/tutorial", label: "How it works", icon: "tutorial" },
                { href: "/app/system", label: "System check", icon: "system" },
              ],
            },
          ]}
        />
        <div className="app-account">
          <div className="app-account-who">
            <p className="small">Tashfeen Ahmad</p>
            <p className="tiny subtle">glovecars@gmail.com</p>
          </div>
          <button className="btn ghost small" type="button">Sign out</button>
        </div>
      </aside>

      <div className="app-main">
        <div className="app-banners">
          <div className="notice warning">
            <p>Trial ends in 4 days. <Link href="/app/billing">Billing</Link></p>
          </div>
        </div>

        <main className="app-body">
          <PageHeader
            title="Morning, Tashfeen."
            lede="What needs you, and whether yesterday's sending worked."
            actions={<Link className="btn ghost small" href="/app/analytics">All results</Link>}
          />

          <NeedsYou items={NEEDS} />

          <Section title="Yesterday" description="The four numbers that answer whether this is working.">
            <div className="grid grid-4 tight">
              <Kpi label="Invitations sent" value="34" note="of 35 allowed" />
              <Kpi label="Accepted" value="41%" note="14 of 34" />
              <Kpi label="Replies" value="6" note="43% of accepted" />
              <Kpi label="Meetings" value="2" note="this week" />
            </div>
          </Section>

          <Section title="The funnel" description="Everyone who entered a campaign, and where they got to.">
            <div className="card">
              <FunnelChart
                steps={[
                  { label: "Invited", value: 212 },
                  { label: "Accepted", value: 87 },
                  { label: "Replied", value: 31 },
                  { label: "Meetings", value: 9 },
                ]}
              />
            </div>
          </Section>

          <Section title="Sending limits" description="Every guardrail, against its own cap.">
            <div className="card">
              <div className="allowance-row">
                <AllowanceMeter label="Invitations today" used={34} cap={35} note="Day 12 of the warm-up ramp" />
                <AllowanceMeter label="Messages today" used={18} cap={60} note="Follow-ups and replies" />
                <AllowanceMeter label="Profile views" used={9} cap={40} note="Warm-up, on its own allowance" />
              </div>
            </div>
          </Section>

          <Section title="This week" action={<Link className="btn secondary small" href="/app/analytics">Details</Link>}>
            <div className="card">
              <StackedDays
                series={["Invitations", "Accepted", "Replies"]}
                days={[
                  { date: "2026-09-21", values: [12, 4, 1] },
                  { date: "2026-09-22", values: [14, 6, 2] },
                  { date: "2026-09-23", values: [11, 3, 0] },
                  { date: "2026-09-24", values: [15, 7, 3] },
                  { date: "2026-09-25", values: [13, 5, 1] },
                  { date: "2026-09-26", values: [0, 0, 0] },
                  { date: "2026-09-27", values: [0, 0, 0] },
                ]}
              />
            </div>
          </Section>

          <PageGroup id="campaigns">
            <Section
              title="Campaigns"
              description="Grouped by the strategy that found the people in them."
              action={<Link className="btn small" href="/app/campaigns/new">New campaign</Link>}
            >
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th className="num">Invited</th>
                      <th className="num">Accepted</th>
                      <th className="num">Replies</th>
                      <th>Next invitation</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><Link href="/app/campaigns/1">Agency owners, London</Link></td>
                      <td><span className="pill positive tiny">Running</span></td>
                      <td className="num">112</td>
                      <td className="num">48</td>
                      <td className="num">17</td>
                      <td className="small muted">in 34 minutes</td>
                    </tr>
                    <tr>
                      <td><Link href="/app/campaigns/2">Fractional CFOs</Link></td>
                      <td><span className="pill accent tiny">Review</span></td>
                      <td className="num">0</td>
                      <td className="num">0</td>
                      <td className="num">0</td>
                      <td className="small muted">not launched</td>
                    </tr>
                    <tr>
                      <td><Link href="/app/campaigns/3">Shopify store owners</Link></td>
                      <td><span className="pill warning tiny">Paused</span></td>
                      <td className="num">100</td>
                      <td className="num">39</td>
                      <td className="num">14</td>
                      <td className="small muted">paused by you</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Nothing here yet">
              <Empty title="No meetings booked yet." action="See availability" href="/app/meetings">
                A prospect books from a link in a reply, so the first meeting arrives after the first
                conversation does.
              </Empty>
            </Section>
          </PageGroup>
        </main>
      </div>
    </div>
  );
}
