---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance (Vercel). Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices", and before shipping any change to apps/web.
metadata:
  author: vercel (vendored)
  version: "1.0.0"
  source: https://github.com/vercel-labs/web-interface-guidelines (command.md, vendored 2026-10-08)
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Vercel's Web Interface Guidelines.

## How it works

1. Read the rules in `guidelines.md` next to this file. They are a pinned copy of
   upstream `command.md`, so a review does not depend on a network fetch and the
   rules cannot change underneath us without a commit. To refresh, replace
   `guidelines.md` with the latest upstream file in a reviewed commit.
2. Read the specified files (or ask which files/pattern to review).
3. Check them against every rule in `guidelines.md`.
4. Report findings in the terse `file:line` format the guidelines specify.

## Project notes (this repo)

The project's own rules in `CLAUDE.md` win where they are stricter — in
particular rule 34 (one `<h1>` via `PageHeader`, `<h2>` via `Section`), rule 38
and 53 (one definition per CSS class; app styles scoped under `.app`), rule 35
(charts drawn in `components/charts.tsx`), and rule 54 (no vendor names on
customer screens). Run `pnpm --filter @le/web test` after any fix: several of
those rules are enforced by tests.
