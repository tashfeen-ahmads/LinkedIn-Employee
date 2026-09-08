# 02 · Product spec — LinkedIn Employee

Working name: **LinkedIn Employee**. Positioning: *"Hire an AI SDR for LinkedIn. It finds your
buyers, starts the conversation, and books the meeting. You close."*

We mirror CoPilot AI's four-agent story exactly, then add the differentiators from the teardown.

## 1. Users and roles

| Role | Needs |
|---|---|
| Rep | Connect LinkedIn + calendar, pick a Customer Profile, approve or automate replies, see booked meetings. |
| Sales manager | Invite reps, assign profiles, prevent duplicate outreach, see per-rep funnel, export to CRM. |
| Admin / owner | Billing, seats, integrations, data retention settings. |

## 2. The four agents

### Agent 1 · Strategy Agent
Input: company website URL, LinkedIn company page URL, optional one-paragraph description, optional
existing customer list (CSV) for lookalike modelling.

Output:
- **Business Profile**: what the company sells, to whom, pricing model, proof points, tone of voice,
  competitors, objections it commonly faces.
- **3 to 5 Customer Profiles (ICPs)**, each with: name, job titles, seniority, industries, company
  size, geography, trigger events, pains, value proposition, and a mapped set of Sales Navigator
  filters so the Targeting Agent can execute it directly.
- **Messaging angles** per profile: 3 hooks, 1 connection note, a 3-step follow-up sequence.

User controls: edit any field, approve profiles, mark a profile as "do not pursue".

Implementation: one Claude call per artifact with structured outputs (JSON schema). Website
scraping via a headless fetch of the home, pricing, about, and customers pages. Company page data
via the LinkedIn connector (see architecture doc).

### Agent 2 · Targeting Agent
Input: approved Customer Profiles, daily and weekly volume caps, exclusion lists (current
customers, competitors, colleagues, anyone already contacted by a teammate).

Process:
1. Translate the profile into a Sales Navigator search (or a third-party prospect-data query
   when the rep has no Navigator seat).
2. Pull candidates in pages, dedupe against the workspace-wide contact table.
3. **Fit score** (0 to 100) from profile match against the ICP.
4. **Intent score** from signals we can observe: started a new role in the last 90 days, company
   is hiring for the rep's category, recent funding, posted in the last 30 days, engaged with the
   rep's or competitor's content, viewed the rep's profile, follows the company page.
5. Rank, then show a list the rep can approve, skip, or ban per row. Every row shows the signals.
6. Generate the campaign: connection note (under 300 chars), follow-up messages 1 to 3 with
   delays, stop conditions, and a per-campaign send schedule inside working hours.

Output: a launch-ready campaign with a target list, copy, cadence, and caps. One click to launch.

### Agent 3 · Reply Agent
Input: rules of engagement per campaign.

| Rule | Options |
|---|---|
| Mode | Draft for approval (default) / Autopilot |
| Send window | Working hours in the rep's time zone |
| Hand off to human when | Pricing question, negative sentiment, legal or compliance topic, request to speak to a person, confidence under threshold, any message containing a question the knowledge base cannot answer |
| Context the agent may use | Business Profile, chosen Customer Profile, rep's bio, uploaded FAQ / case studies, calendar availability |
| Goal | Book a meeting / qualify then book / share a resource and nurture |

Process per inbound message:
1. Classify intent: interested, question, objection, not now, not interested, out of office,
   referral to a colleague, spam.
2. Retrieve context (profile, conversation, knowledge base).
3. Draft a reply. If the goal is a meeting and intent is interested, propose two or three slots
   pulled live from the calendar, or send a booking link.
4. Gate: if the rule says human, park in the inbox with a suggested draft. Otherwise send.
5. On confirmation, create the calendar event with a video link, invite the prospect, write the
   meeting to the CRM, and notify the rep.
6. Not now / not interested: set a follow-up date or close the thread and stop the sequence.

### Agent 4 · "Focus on closing" (the rep's view)
- A **Meetings** page: upcoming meetings with a one-page brief per prospect (profile, why they
  matched, the conversation so far, suggested talking points).
- Daily digest email and Slack post: meetings booked, replies waiting for approval, campaign health.

## 3. Extra wins (parity features)

- **Team management**: workspace, seats, roles, per-rep LinkedIn connection, shared exclusion
  list, cross-rep duplicate prevention, leaderboard, per-rep and per-campaign funnel
  (sent -> accepted -> replied -> positive -> meeting booked).
- **CRM**: HubSpot and Salesforce native (OAuth, contact + activity sync, meeting logging),
  Zapier app, outbound webhooks for every event.
- **Support**: onboarding call booking baked into the trial flow, in-app chat, strategy review at
  day 5 of the trial, dedicated account manager on Teams.

## 4. Safety and compliance (non-negotiable product rules)

- Hard caps: 20 connection requests per day ramping to 40 over three weeks, never more than
  150 per week; 60 messages per day; all sends randomized inside working hours.
- Automatic pause on LinkedIn warning, captcha, password reset, or an unusual login screen.
  The rep is notified and must re-authorize.
- Withdraw pending invites older than 21 days automatically.
- Never message someone a teammate contacted in the last 90 days.
- Every AI-sent message is logged with the prompt version and can be reviewed.
- Opt-out phrases ("stop", "not interested", "remove me") end the sequence immediately.
- Prospect data retention default 12 months, deletable per workspace (GDPR / CCPA).
- Terms of service disclose that the product automates LinkedIn actions on the rep's behalf and
  that the rep accepts the associated account risk.

## 5. Pricing (proposed, validate with design partners)

| Plan | Price per seat / month | Includes |
|---|---|---|
| Solo | USD 149 | 1 seat, all four agents, approval-mode replies, 1 CRM via Zapier |
| Pro | USD 249 | Autopilot replies, native HubSpot/Salesforce, intent signals, priority support |
| Teams (3+ seats) | USD 199 | Everything in Pro, team management, shared exclusions, account manager |

7-day free trial on every plan, card required, cancel in one click. Sales Navigator is optional
for Solo (third-party data path) and recommended for Pro and Teams.

## 6. Success metrics

Product metrics we instrument from day one, so the marketing stats are ours and true:
- Acceptance rate (target > 30%), reply rate (> 15%), positive reply rate (> 5%),
  meetings booked per seat per month (target 8+), time to first meeting (< 14 days),
  trial-to-paid conversion (> 20%), accounts restricted per 100 seats (< 2).
