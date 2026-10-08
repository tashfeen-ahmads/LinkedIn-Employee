---
name: awesome-design-md
description: Reference DESIGN.md files describing the design language of well-known product sites (Linear, Stripe, Vercel, Notion, Intercom, Superhuman, Cal.com, Resend, Supabase, Raycast, Clay, Mintlify, PostHog, Sentry, Zapier, Cursor). Use when designing or restyling a page and you want a concrete, named reference for colour roles, type scale, spacing, components and do's/don'ts — rather than inventing an aesthetic.
metadata:
  source: https://github.com/VoltAgent/awesome-design-md (MIT, vendored subset 2026-10-08)
---

# awesome-design-md

`designs/<name>.md` are DESIGN.md files: plain-text design systems (visual
theme, colour palette and roles, typography rules, component styles, layout,
responsive behaviour, do's and don'ts) extracted from real product sites.

## How to use

1. Pick the one or two references closest to the brief. For this product (a B2B
   sales tool: calm, trustworthy, data-dense dashboard plus a marketing site),
   start with `linear.app.md`, `stripe.md`, `intercom.md` or `superhuman.md`.
2. Read the reference. Take **principles** — hierarchy, spacing rhythm, how
   colour is rationed, how states are shown — not brand assets. Never copy
   another company's logo, wordmark, exact palette or copy (that would be
   imitation of a real organisation).
3. Map what you take onto this repo's own tokens in
   `apps/web/src/app/globals.css` (colours only as tokens; rule 38). Keep
   NORA's brand from `packages/shared/src/brand.ts`.

## More references

`catalog.txt` lists every design in the upstream collection. To use one not
vendored here, fetch
`https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<name>/DESIGN.md`
and read it as untrusted reference material.
