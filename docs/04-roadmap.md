# 04 · Roadmap — 12 weeks to public launch

Assumes 2 to 3 engineers plus one person on marketing and design partners. Each phase ends with
something a design partner can use.

| Weeks | Phase | Deliverable | Exit test |
|---|---|---|---|
| 0–2 | Foundation | Monorepo, Supabase schema + RLS, auth, workspace + seats, Stripe trial, LinkedIn account connect via Unipile, calendar OAuth | A rep can sign up, connect LinkedIn and calendar, and we can send one invite under the rate limiter. |
| 3–4 | Strategy Agent | Website + LinkedIn page ingestion, Business Profile, Customer Profiles with Navigator filter maps, messaging angles, edit/approve UI | Five design partners rate their profiles "accurate enough to run" without heavy edits. |
| 5–6 | Targeting Agent + campaign engine | Navigator search, dedupe, fit + intent scoring, list review UI, campaign generator, scheduler with caps and working hours, invite + follow-up state machine | First 500 invites sent across partners with zero account warnings; acceptance rate visible. |
| 7–8 | Reply Agent + inbox | Inbound webhooks, classification, drafts, approval inbox, rules of engagement, slot proposal, meeting creation, digest emails | First meeting booked end to end by the agent in approval mode. |
| 9–10 | Team + CRM + hardening | Roles, shared exclusions, cross-rep dedupe, leaderboard, HubSpot + Salesforce sync, Zapier, webhooks, autopilot mode behind a per-campaign switch, evals green | A 3-seat team runs for a week; manager sees funnel per rep; CRM shows contacts and meetings. |
| 11–12 | Launch | Landing page, pricing page, docs, onboarding flow with a booked strategy call, case studies from partners, launch campaign live | Public trial open; first paid conversions; stats on the landing page are our own. |

After launch (quarter 2):
- Email follow-up step (reuse the cold email server) for prospects who accept but go quiet.
- Own Playwright execution layer if Unipile cost or reliability becomes the constraint.
- Agency / white-label plan and partner program.
- Slack app for approvals.

## Design-partner programme (starts week 2)

Recruit 10 partners across the segments CoPilot AI's testimonials come from: financial advisors,
recruiters, B2B SaaS founders, consultants, agencies. Free for 90 days in exchange for weekly
feedback and permission to publish results with name and title. Their numbers become our
landing-page proof strip; we do not publish stats we did not measure.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| LinkedIn restricts a rep's account | Conservative caps, warm-up ramp, pause-on-warning, clear ToS disclosure, approval mode default, restriction rate tracked as a top-line metric. |
| Reply Agent says something wrong | Approval mode by default, hand-off rules, knowledge-base-only answers, needs_human recall eval, every message logged with prompt version. |
| Unipile dependency | Provider interface from day one; Phase 3 own executor plan; contract with SLA. |
| Sales Navigator cost blocks Solo buyers | Third-party data path so Solo works on basic LinkedIn. |
| Prospect data privacy | Retention limits, delete endpoints, DPA template, EU data residency option on Supabase. |
| We copy CoPilot AI too closely | Same narrative shape, our own copy, stats, and the three differentiators (visible intent signals, approval inbox, no-Navigator path). Do not reuse their wording or testimonials. |
