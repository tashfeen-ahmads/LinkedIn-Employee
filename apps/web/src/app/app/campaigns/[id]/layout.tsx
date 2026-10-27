import type { ReactNode } from "react";
import { CTA_DEFINITIONS } from "@le/shared";
import { PageHeader } from "@/components/page";
import { NavIcon } from "@/components/icons";
import { SectionLayout, SectionNav, type SectionNavItem } from "@/components/section-nav";
import { SubmitButton } from "@/components/submit-button";
import { label } from "@/lib/labels";
import { loadCampaign, type CampaignView } from "./data";
import { retryFailed, sendOneNow, setStatus } from "./actions";
import { CAMPAIGN_SECTIONS, sectionHref, type CampaignSection } from "./sections";

/**
 * The frame of one campaign: its name, its state and what can be done to the
 * whole of it, then a side menu of its parts with the chosen part beside it.
 *
 * The one page heading for every section is here (rule 34), so the sections below
 * carry `Section` headings only. The menu's hints are live — "142 queued · 1
 * invited", "Book a meeting · sends your scheduling link" — because a menu
 * of bare words makes somebody open every part to learn which one wants them.
 */
export default async function CampaignLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;
  const view = await loadCampaign(id);
  const { campaign, account, strategy, running, blockers, failed, queued } = view;

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app/campaigns", label: "Campaigns" }]}
        title={campaign.name}
        status={
          <span className={`pill ${running ? "positive" : campaign.status === "paused" ? "warning" : ""}`}>
            {label(campaign.status)}
          </span>
        }
        lede={
          <>
            {strategy?.name ? `From the strategy “${strategy.name}”` : "Built from your prospect list"}
            {account?.display_name ? ` · sending as ${account.display_name}` : ""}
          </>
        }
        actions={
          <>
            {/*
              A failed row is not waiting for anything — the loop reads `queued`
              and nothing else — so without this the only way back is rebuilding
              the campaign, which spends the invitation allowance again on people
              who were never actually reached.
            */}
            {failed.length > 0 ? (
              <form action={retryFailed}>
                <input type="hidden" name="campaignId" value={campaign.id} />
                <SubmitButton className="btn secondary" pendingLabel="Requeueing…">
                  Retry {failed.length} failed
                </SubmitButton>
              </form>
            ) : null}
            {running ? (
              <form action={setStatus}>
                <input type="hidden" name="campaignId" value={campaign.id} />
                <input type="hidden" name="status" value="paused" />
                <SubmitButton className="btn secondary" pendingLabel="Pausing…">
                  Pause
                </SubmitButton>
              </form>
            ) : (
              /*
                Launch saves nothing: every section that edits copy saves with
                its own button, and offers Save and launch beside it, so what
                launches from there is what is on screen. Pressed here, the
                saved campaign is what goes.
              */
              <form action={setStatus}>
                <input type="hidden" name="campaignId" value={campaign.id} />
                <input type="hidden" name="status" value="running" />
                <SubmitButton
                  className="btn"
                  pendingLabel="Launching…"
                  disabled={blockers.length > 0}
                  title={blockers.length > 0 ? "Fix what Overview lists under Not ready to launch first" : undefined}
                >
                  {campaign.status === "paused" ? "Resume" : "Launch campaign"}
                </SubmitButton>
              </form>
            )}
            {/*
              Proof, on demand. A campaign that has sent nothing is otherwise
              indistinguishable from one that cannot, and the difference took
              eight days to establish once.
            */}
            {running && queued.length > 0 ? (
              <form action={sendOneNow}>
                <input type="hidden" name="campaignId" value={campaign.id} />
                <SubmitButton className="btn" pendingLabel="Sending…">
                  <NavIcon name="campaigns" className="btn-icon" />
                  Send one now
                </SubmitButton>
              </form>
            ) : null}
          </>
        }
      />
      <SectionLayout nav={<SectionNav label="Campaign sections" items={menuItems(view)} />}>{children}</SectionLayout>
    </>
  );
}

/** The menu, each part with a line saying what is in it right now. */
function menuItems(view: CampaignView): SectionNavItem[] {
  const { campaign, rows, counts, actionable, failed, onTemplate, steps, cta, bookingUrl, ctaMissing, agent, autonomous, blockers, pacing, variantRows } = view;
  const hints: Record<CampaignSection, Omit<SectionNavItem, "href" | "title">> = {
    "": {
      hint:
        campaign.status === "draft"
          ? blockers.length > 0
            ? `Draft · ${blockers.length} ${blockers.length === 1 ? "thing" : "things"} before launch`
            : "Draft · ready to launch"
          : pacing?.title ?? label(campaign.status),
      attention: (campaign.status === "draft" && blockers.length > 0) || pacing?.tone === "danger",
    },
    goal: {
      hint: ctaMissing ? "No link chosen yet" : cta.label || CTA_DEFINITIONS[cta.kind].label,
      attention: ctaMissing,
    },
    people: {
      hint: `${actionable.toLocaleString()} queued · ${counts.invited.toLocaleString()} invited`,
      count: rows.length,
      attention: failed.length > 0,
    },
    opener: {
      hint:
        rows.length === 0
          ? "No notes yet"
          : `${(rows.length - onTemplate).toLocaleString()} of ${rows.length.toLocaleString()} notes written for them`,
    },
    "follow-ups": {
      hint: `${steps.length} ${steps.length === 1 ? "message" : "messages"} after they accept`,
    },
    replies: {
      hint: `${
        campaign.reply_mode === "approval" ? "Held for your approval" : autonomous ? "Nora answers on its own" : "Clean replies sent for you"
      }${agent ? ` · ${agent.name}` : ""}`,
    },
    settings: {
      hint: `Up to ${campaign.daily_invite_cap} invitations a day`,
    },
  };
  return CAMPAIGN_SECTIONS.map((section) => ({
    href: sectionHref(campaign.id, section.slug),
    title: section.title,
    ...hints[section.slug],
  }));
}

