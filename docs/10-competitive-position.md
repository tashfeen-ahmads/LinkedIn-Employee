# 10 · Where we are and where we have to be

Written 2026-09-24, against Dripify (the volume tool) and CoPilot AI (the AI SDR).
Docs `01-copilot-ai-teardown.md` and `06-research.md` are the source for CoPilot;
Dripify's own site is unreachable from this environment, so its numbers come from
2026 third-party reviews and are marked where they are second-hand.

---

## 1. The market has two poles and nothing in the middle

| | **Dripify** | **CoPilot AI** | **Us** |
|---|---|---|---|
| Price / seat / mo | $39–79 annual, $59–99 monthly | $199–299 + mandatory ~$99 Sales Navigator = **$298–398 effective** | $149–249 |
| What it is | A robot that performs actions | An AI SDR, sold as a black box | An AI SDR that shows its work |
| Personalisation | **None.** Merge fields only | AI-generated messages | Per-prospect note written from that person's own headline, title, company, about |
| Enrichment | **None** | "Sales intelligence", signals not shown | Fit score + named reasons + intent signals, all visible |
| Sales Navigator | Optional | **Required** | Optional — classic-search path with dropped filters named on screen |
| Editing a live campaign | **Delete it and start again** (second-hand, consistent across reviews) | Unknown | Rewrite notes, Find more, edit any step |
| Reply handling | Shared inbox, human writes | AI replies, opaque | AI drafts, held for a person by default, autopilot per campaign |
| Account risk | **27–34% restricted within 90 days** post-May-2026 enforcement (second-hand) | Managed pacing | Caps are product rules, not settings; warm-up from first action; pause-on-warning |
| Channels | LinkedIn + email | LinkedIn | LinkedIn (email layer exists, unwired) |

**Dripify's own reviewers name our feature list as its gaps**: no AI personalisation,
no lead enrichment, no conversation tracking, a campaign you cannot edit. We do not
have to invent a wedge. We have to *show* the one we already built.

## 2. The positioning, in one line

> Dripify automates the sending. CoPilot AI automates the thinking and won't show
> you either. We do the thinking, show you every step of it, and stop before it
> embarrasses you.

Price anchors to Dripify's ceiling, not CoPilot's floor: a buyer comparing us to
Dripify at $99/mo monthly has to see why $149 buys something categorically different
within five seconds of the page loading. That is a **design** problem, not a copy
problem — which is what this document exists to fix.

## 3. What Dripify's site does that ours does not

1. **An auto-playing product film directly under the hero.** Ours has a static
   figure. A prospect learns what a product *is* by watching it move; a still panel
   asks them to read, and they do not.
2. **A visible campaign builder.** Their whole proposition is "look how easy the
   sequence is to assemble". Ours is buried on an authenticated screen.
3. **Monthly / annual toggle with the discount stated.** They show −35% and make
   the anchor do the work.
4. **Volume claims in the hero.** "15+ actions and conditions on autopilot."

And one thing they do that we must **not** copy: they lead with volume, which is
what gets accounts restricted. Our equivalent number is the one nobody else prints
— the caps.

## 4. What our site does that theirs does not, and must keep

- Names the account-restriction risk out loud instead of implying safety.
- Shows the reply gate as a working simulator, not a claim.
- Publishes the actual caps and the warm-up ramp.

## 5. Phases

### Phase 1 — the site can sell it *(this work)*
- **Product film** under the hero: the real flow, in motion, looping, no video file.
- **Pricing** rebuilt: monthly/annual toggle, the competitor anchor made explicit,
  the Teams-cheaper-than-Pro confusion fixed.
- **Sequence builder** shown on the marketing site.

### Phase 2 — the product matches the claim
- Email follow-up for accepted-then-quiet prospects (`packages/email` exists, unwired).
- Intent signals surfaced on the prospect list (scored today, shown nowhere).
- Native HubSpot / Salesforce (Zapier only today).

### Phase 3 — the wedge Dripify structurally cannot follow
- The agent as the product: one row that owns the voice, the openers, the offer and
  the playbook, testable before a stranger reads it. **Built.** Now sell it.
- Multi-agent: one agent per segment, compared against each other on real outcomes.

## 6. The honest gaps

- Zero paying customers, one live workspace, no sent-volume proof. Every number on
  the site is a capability claim, not a result — keep it that way until there are
  results.
- The classification eval has still never been run (`packages/agents/evals/`).
- Unipile webhook deliveries still arrive unsigned, so replies do not reach the inbox
  automatically.
