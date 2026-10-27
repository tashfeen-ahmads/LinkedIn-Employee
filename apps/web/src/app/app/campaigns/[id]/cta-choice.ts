import "server-only";
import { CTA_DEFINITIONS, CTA_KINDS, checkCtaUrl, type CtaKind } from "@le/shared";
import { ensureCta } from "@/lib/cta-library";
import type { createClient } from "@/lib/supabase-server";

/**
 * What a campaign is pointed at, from the goal a person picked.
 *
 * Two screens pick a goal: the campaign's Goal & link section and step 2 of
 * the campaign builder. Both offer the same cards (`CampaignGoalCards`) and
 * both write through here, so they cannot disagree about what a card means.
 *
 * A card is one of three things, and the value says which:
 *
 *  - a saved call to action (its id), the library entry rule 36 made;
 *  - `kind:<goal>`, a goal with no saved entry yet, which is made into one
 *    with `ensureCta` — the same helper setup uses, so picking "Book a
 *    meeting" twice reuses one entry rather than listing it twice;
 *  - empty, "this campaign's own destination", which is what a campaign built
 *    before the library carries. Never a lookup for "".
 *
 * The picked entry's goal is written onto the campaign's own columns as well
 * as the pointer. Writing only `cta_id` left `cta_kind` saying "meeting" on a
 * campaign whose every message now sent a link, and every screen that read the
 * column (the funnel's goal, the results label, the inbox's meeting tab, the
 * meeting-hours row) described a campaign that no longer existed. Readers
 * resolve through the pointer anyway (`campaignCtas`); the columns are kept in
 * step so they are never the odd one out, and so "this campaign's own
 * destination" is the last one picked.
 */
export type CtaPatch = { cta_id: string | null; cta_kind?: CtaKind; cta_label?: string | null; cta_url?: string | null };

export async function ctaPatchFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: { workspaceId: string; userId: string },
  formData: FormData,
): Promise<{ ok: true; patch: CtaPatch } | { ok: false; reason: string }> {
  let ctaId = String(formData.get("ctaId") ?? "").trim();

  if (ctaId.startsWith("kind:")) {
    const kind = ctaId.slice("kind:".length) as CtaKind;
    if (!CTA_KINDS.includes(kind)) return { ok: false, reason: "That goal is not one this product offers. Nothing changed." };
    const label = String(formData.get(`label-${kind}`) ?? "").trim().slice(0, 80) || null;
    let url: string | null = null;
    if (CTA_DEFINITIONS[kind].needsUrl) {
      // Typed by a person and sent to strangers under a real rep's name, so
      // the shape is checked rather than trusted.
      const checked = checkCtaUrl(String(formData.get(`url-${kind}`) ?? ""));
      if (!checked.ok) return { ok: false, reason: checked.reason };
      url = checked.url;
    }
    const made = await ensureCta(supabase, session.workspaceId, session.userId, { kind, label, url });
    if (!made) return { ok: false, reason: "That goal could not be saved. Nothing changed. Try again." };
    ctaId = made;
  }

  let patch: CtaPatch = { cta_id: null };
  if (ctaId) {
    const { data: picked } = await supabase
      .from("ctas")
      .select("id, kind, label, url")
      .eq("id", ctaId)
      .eq("workspace_id", session.workspaceId)
      .is("archived_at", null)
      .maybeSingle();
    if (!picked) return { ok: false, reason: "That call to action is not available any more. Nothing changed." };
    patch = { cta_id: picked.id, cta_kind: picked.kind, cta_label: picked.label, cta_url: picked.url };
  }
  return { ok: true, patch };
}
