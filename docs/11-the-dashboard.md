# 11 · The dashboard — the idea, the logic, the plan

Doc 10 is the marketing site: how somebody decides to try this. This is the
part that decides whether they are still paying in six months, which is the
only number that makes a company worth anything.

---

## 1. The thesis

> **Dripify sells a control panel. We sell a colleague who reports to you.**

That single sentence decides every screen below.

A **control panel** asks you to operate it. Build the sequence. Watch the
stats. Tag the leads. Check the inbox. The value is in your hands on the
controls, so the moment you stop operating it, it stops producing — and the
moment you stop producing, you cancel. Dripify's dashboard is: campaigns list,
drag-and-drop sequence builder, leads with tags and filters, Smart Inbox,
analytics, team controls. Every one of those is a thing *you* do.

A **colleague** reports. They tell you what they did, what they need from you,
and what they are about to do next. You open the app to answer them, not to
operate them. Something is still happening on the days you do not open it at
all — and that is the difference between a $59 tool and a $249 employee.

We already have the machinery for the second one. Four agents, a reply gate, a
pacing loop, prospect research, approved copy. What we do not have is a
dashboard shaped like it. Ours is currently shaped like theirs: twenty-two
screens in five groups, and the user has to know which one to open.

---

## 2. Where we are (honest)

Twenty-two screens. The nav is five groups:

| Group | Screens |
|---|---|
| Work | Overview, Inbox (with a waiting count), Meetings |
| Pipeline | Strategies, Prospects, Campaigns |
| Agent | Agents |
| Settings | Profile & team, Calls to action, Do not contact, Billing, Usage |
| Help | How it works, System check, Support |

What is genuinely better than Dripify already:

- **The agent** writes per-prospect copy from that person's own profile, is
  testable before a stranger reads it, and carries the voice, openers, offer
  and playbook in one row. They have merge fields.
- **The reply gate** drafts and *holds* — pricing, legal, negative sentiment,
  low confidence, a request for a human. They have a shared inbox and a person.
- **The angle comparison** uses Wilson intervals and refuses to call a winner
  on eleven invitations. They have a raw A/B percentage.
- **The safety machinery** — caps as product rules, the ramp from first send,
  the escalating throttle backoff, the warm-up on its own allowance. Their
  reviewers report 27–34% of users restricted within 90 days.

What is worse:

- **Time to first value.** Strategy → approve → Prospects → Campaign → pick
  agent → read notes → launch. Six screens and several waits before anything
  is sent. Dripify is: connect, paste a list, drag four blocks, go.
- **There is no daily loop.** Overview shows "how it is going" and a strategy
  list. Neither answers *what needs me today*, so the honest answer to "why
  open this tomorrow" is "to check if anything broke".
- **The proof is buried.** `/app/analytics` is fourteen lines pointing at a
  section. The funnel, the angle comparison and the spend are the evidence the
  subscription is working, and they are two clicks from nowhere.
- **The safety story is invisible.** All of section 2's advantages live on
  `/app/system`, which a rep opens once, when something is already wrong.

---

## 3. The logic: three questions, in this order

A colleague's report has exactly three parts. So does the dashboard.

### Q1 — "What needs me?"

**The only thing on the home screen.** Not a section on it; the whole of it.

It is a single list of things that are stopped until a human acts, each with
the one action that unblocks it:

- a reply held for pricing, legal, negative sentiment, low confidence, or
  because they asked for a person → *read and send*
- a campaign built and never launched → *review the notes and launch*
- a strategy written and never approved → *approve*
- an opener or offer written and never approved → *approve* (today a follow-up
  is silently held waiting for this, and nothing says so on the home screen)
- a LinkedIn account that needs reconnecting → *reconnect*
- notes that read as personalised and are not (`notes_missing`, empty
  grounding) → *rewrite with the agent*

**Zero items is the good day, and it must look like one.** Not an empty state
apologising — a sentence: *"Nothing needs you. Here is what I did."* followed
by Q2. A dashboard that looks broken when everything is fine teaches people to
stop opening it.

*Most of this already exists as data.* `holds.ts` has the kinds,
`setup-state.ts` computes where a workspace has got to, `nav-marks.ts` already
picks the one thing that matters. What is missing is one screen that reads them
together.

### Q2 — "What did you do?"

**In words, then numbers.** A colleague does not hand you a bar chart.

> Yesterday I looked at 38 profiles, sent 12 invitations, and 3 people
> accepted. I wrote to all 3. One asked what it costs — I have drafted a
> reply and it is waiting for you. LinkedIn slowed invitations down for four
> hours in the afternoon, so I spent that time warming up tomorrow's list.

Every clause in that paragraph is a row we already write: `prospect.warmed`,
`invite.sent`, acceptance polling, `message.sent`, the hold kind, the
`invite.throttled` event and its reason. Nobody has ever assembled them into a
sentence.

This is the single highest-value screen in the product and it does not exist.
It is what makes the subscription feel like a salary rather than a fee, and it
is the thing a rep forwards to their boss.

### Q3 — "Is it working, and which bet is winning?"

The funnel, per strategy and per angle, with the honesty already built in:
Wilson intervals, `MIN_SENDS_TO_COMPARE`, `CLICKS_ARE_INVISIBLE`, the meetings
stage dropped for a goal that can never reach it.

Promote it out of `/app/analytics` and onto the home screen's second half,
below the report. Not because a chart belongs on a home screen, but because
this one answers "should I keep paying", and that question should never need
navigation.

---

## 4. What that does to the twenty-two screens

Three become the product:

1. **Home** — Q1, then Q2, then Q3. Everything else is configuration.
2. **Inbox** — conversations, unchanged; it is already good and already better
   than a shared inbox, because a draft is waiting in each one.
3. **Campaigns** — the list and the detail, where launching and pacing live.

The rest move behind a **Setup** group that a rep visits during onboarding and
then roughly never: strategies, agents, calls to action, do-not-contact,
knowledge, profile and team, billing.

Prospects, Meetings, Usage and System stay reachable and leave the daily path.
System in particular should stop being a place a person goes — its checks
should surface *into Q1* when they fail, which is rule 8 applied to navigation:
repair must never wait for somebody to find a screen.

**The count in the nav becomes one number**: how many things need you. A
sidebar where six things are urgent has no urgent things — that is already
written down as rule 32 and it applies to the whole dashboard, not just the
marks.

---

## 5. The part that actually makes it a company

Feature parity is not the answer. Three things compound, and none of them is a
feature Dripify could copy in a sprint:

**a. The approved copy is a moat that grows.** Every opener and offer a human
approves, every angle that won, every fact the agent is allowed to state — that
is a workspace's accumulated judgement, and it is what the agent writes from.
A Dripify sequence is a text file; a competitor can retype it in ten minutes. A
workspace that has run this for six months has copy nobody can retype, because
nobody else knows which lines were approved and which won. Make that visible:
*"your agent has 5 approved openers, 3 tested angles, and knows 240 people you
have already spoken to."* That sentence is the renewal.

**b. The history is the dedupe.** `prospects.last_contacted_at` outlives every
campaign, and rule 24 depends on it. The longer a workspace runs, the more
valuable the record — and the more expensive it is to leave, because leaving
means losing the only list of who must never be approached again. This is a
retention mechanism that also happens to be the right thing to do.

**c. Safety is the reason they stay, and it has to be said daily.** The
category's dirty number is 27–34% restricted in 90 days. Our caps, ramp,
backoff and warm-up are real, tested and mutation-checked. Today they are
invisible unless something breaks. One line in the daily report — *"well inside
your limits; LinkedIn has not pushed back this week"* — converts the most
expensive engineering in this repo into the reason somebody renews.

---

## 6. Phases

**Phase 1 — the daily loop (the one that matters).**
- `needsYou()`: one function, one list, from the holds, setup state and marks
  that already exist.
- The home screen becomes Q1 → Q2 → Q3.
- The daily report in words, assembled from events we already write.
- The nav count becomes "things that need you".

**Phase 2 — collapse the navigation.**
- Setup group; System's failures surface into Q1 instead of waiting to be
  visited; Analytics folds into home.

**Phase 3 — the compounding story.**
- "What your agent knows" on the agent screen.
- The weekly report by email, which is the same assembly as Q2 and is what gets
  forwarded to the person who pays.

**Phase 4 — parity where it still matters.**
- The branching sequence builder (if accepted / if replied / if viewed). The
  action model landed with the warm-up; this is the canvas over it.
- Follow and post engagement, once `developer.unipile.com` is reachable and the
  endpoints can be confirmed rather than guessed.

---

## 7. What to build first, if only one thing

**Q2, the daily report in words.**

Q1 is more useful and Q3 is more persuasive, but Q2 is the one that makes this
product feel like something other than software. Every fact in it is already in
the database. Nobody has ever written the sentence.
