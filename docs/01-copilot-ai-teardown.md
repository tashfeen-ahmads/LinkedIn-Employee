# 01 · CoPilot AI teardown (what we are matching)

Source: https://www.copilotai.com/lp2/intl-b2b-teams (copy captured 2026-09-08).
The site is not reachable from the build environment, so this teardown is based on the
landing-page copy plus public knowledge of the product. Anything marked *inferred* should be
verified by signing up for their 7-day trial before we commit to a spec.

## 1. Positioning

| Element | CoPilot AI |
|---|---|
| Headline | "Turn LinkedIn into your sales team's secret weapon." |
| Promise | Each B2B rep gets an AI SDR that finds high-intent leads and books meetings, cutting up to 90% of manual prospecting. |
| Offer | 7-day free trial, then per-seat subscription (inferred: ~USD 300–500 per seat per month, Sales Navigator required). |
| Buyer | Sales leaders and founders at B2B teams; heavy adoption among financial advisors, recruiters, consultants, and agencies (visible in their testimonials). |
| Proof | 1000+ ICP connections in 3 months, 60 meetings in 60 days, 35% meeting-booked rate, 10x ROI, $3.3M deal volume, 2 hours saved per rep per day. |
| Social proof | 13 customer quotes with name, title, company. |

## 2. The four-step "agents working together" story

| Step | Agent | What the user does | What the agent does |
|---|---|---|---|
| 1 | Strategy Agent | Shares website and LinkedIn presence. | Builds a Business Profile and multiple Customer Profiles (who to target, how to engage). |
| 2 | Targeting Agent | Picks which Customer Profiles to pursue. | Builds high-fit, high-intent prospect lists via LinkedIn Sales Navigator inside the app, then builds launch-ready prospecting campaigns. |
| 3 | Reply Agent | Sets rules of engagement (when to reply, when a human steps in, what context to use). Connects calendar. | Replies to prospects and books meetings on the rep's behalf. |
| 4 | Human closes | Shows up to booked meetings. | Meetings land directly in the calendar. |

Design lesson: the product is sold as a *sequence of hires*, not a feature list. Each agent has
one job, one input from the user, and one output. We should keep this exact narrative shape.

## 3. Built-in "extra wins"

- **Team management**: no duplicate outreach across reps, role-based access, performance
  monitoring, and no sharing of LinkedIn logins (each rep connects their own account).
- **CRM integration**: native HubSpot and Salesforce, plus Zapier and webhooks.
- **Human support**: live onboarding, strategy support, a dedicated Account Manager on Teams plans.

## 4. How the product actually reaches LinkedIn (inferred)

CoPilot AI is a cloud-based automation tool. It does not use an official LinkedIn API for
messaging or search, because none exists for third parties. In practice this means:

- The rep connects their LinkedIn account (session login through the app), and the cloud worker
  drives LinkedIn on the rep's behalf with a dedicated IP and human-like pacing.
- Prospect lists come from Sales Navigator searches, so every seat needs an active Sales
  Navigator subscription (roughly USD 100 per month, paid to LinkedIn).
- Outreach is a connection request with a personalized note, followed by a short message
  sequence to people who accept, followed by AI-assisted reply handling.
- Sending is capped to stay under LinkedIn's limits (about 100 to 200 connection requests
  per week, plus a daily message cap) and randomized to look human.

This is the "limitation regarding the agent" you flagged. LinkedIn's User Agreement (section 8.2)
prohibits bots and automation, so every vendor in this category carries account-restriction
risk and manages it with pacing, warm-up, and pause-on-warning logic. Section 3 of the
architecture doc covers how we handle this.

## 5. What their landing page does well (copy this structure)

1. Hero: one-line promise, one-line qualifier ("Need a new way to hit target and scale?"), one CTA.
2. Six proof stats in a strip.
3. "How it works" as four numbered steps, each with two bullets and a repeated CTA.
4. A single "Did you know?" stat with a cited source (Salesforce State of Sales).
5. Three "extra wins" cards: team, CRM, support.
6. A long wall of named testimonials with titles and companies.
7. Trial form anchored at the bottom; every CTA links to it.

## 6. Gaps we can exploit

- **No intent-signal transparency.** They say "high-intent" but never show which signals.
  We will show the signals (job change, hiring, funding, post engagement) on every lead.
- **Reply Agent is a black box.** We ship an approval inbox by default: the agent drafts, the
  rep approves with one click, and can flip to full autopilot per campaign once trust is earned.
- **Sales Navigator lock-in.** We support Sales Navigator but also a non-Navigator path using
  third-party prospect data, so a rep can start on a basic LinkedIn account.
- **No multi-channel.** LinkedIn-first, but we can add an email follow-up step later using
  the existing cold email server codebase.
- **Pricing opacity.** Public, simple per-seat pricing with a real free trial is a lead magnet
  on its own.
