import { CTA_DEFINITIONS, CTA_KINDS, type CtaKind } from "@le/shared";

/** Each goal's name, handed to the goal cards so the browser is not sent the shared package for it. */
export const GOAL_LABELS = Object.fromEntries(CTA_KINDS.map((kind) => [kind, CTA_DEFINITIONS[kind].label])) as Record<
  CtaKind,
  string
>;
