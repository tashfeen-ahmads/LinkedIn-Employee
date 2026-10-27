import { PageNotice } from "@/components/page-notice";
import { PageHeader, Section } from "@/components/page";
import { SectionLayout } from "@/components/section-nav";
import { StrategyNav } from "@/components/strategy-nav";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { addBusiness, rewriteStrategies, writeMoreStrategies } from "../actions";
import { businessLabel, loadStrategyMenu } from "../data";

/**
 * Reaching more of the right people: three different requests, each with its
 * own button because the wrong one is expensive.
 *
 * More strategies extends the business already here (rule 37); different ones
 * replace suggestions that missed, from the owner's own words (rule 65's
 * "None of these fit?"); another business is the deliberate split rule 37
 * otherwise forbids. They sat at the top and bottom of one long page, where
 * the second did not exist at all after setup.
 */
export default async function MoreStrategiesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; business?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();
  const menu = await loadStrategyMenu(supabase, session.workspaceId);
  const businessRow = menu.businesses.find((b) => b.id === params.business) ?? menu.businesses[0] ?? null;
  // Nothing to add to yet: the business profile page says what Sage is doing.
  if (!businessRow) redirect("/app/strategy");

  const profiles = menu.profiles.filter((row) => row.business_profile_id === businessRow.id);
  const businessHref = menu.businesses.length > 1 ? `/app/strategy?business=${businessRow.id}` : "/app/strategy";
  const waiting = profiles.filter((row) => !row.approved_at && !row.do_not_pursue).length;

  return (
    <>
      <PageHeader
        crumbs={[{ href: businessHref, label: "Strategies" }]}
        title="Ask Sage for more"
        lede="Reach more of the right people: more strategies for this business, different ones when these missed, or a second business with its own list."
      />
      <PageNotice error={params.error} notice={params.notice} />

      <SectionLayout
        nav={
          <StrategyNav
            businessHref={businessHref}
            businessName={businessLabel(businessRow)}
            strategies={profiles.map((row) => ({
              ...row,
              found: menu.yieldByStrategy.get(row.id)?.found ?? 0,
              campaigns: menu.yieldByStrategy.get(row.id)?.campaigns ?? 0,
            }))}
          />
        }
      >
        <Section
          id="more"
          title="More strategies"
          description={`Sage writes four more for ${businessLabel(businessRow)}, told which ${profiles.length === 1 ? "one" : `${profiles.length}`} you already have so it does not hand back the same markets with different nouns. They arrive unapproved, like the others.`}
        >
          <form action={writeMoreStrategies} className="card">
            <input type="hidden" name="businessProfileId" value={businessRow.id} />
            <input type="hidden" name="from" value="more" />
            <div>
              <SubmitButton pendingLabel="Writing…" className="btn">
                Write four more strategies
              </SubmitButton>
            </div>
          </form>
        </Section>

        <Section
          id="different"
          title="None of these fit?"
          description={
            waiting
              ? `Tell Sage who you actually sell to and it writes new strategies from that. Once they arrive, the ${waiting} still waiting for approval ${waiting === 1 ? "is" : "are"} set aside. Approved strategies and any with a campaign are kept.`
              : "Tell Sage who you actually sell to and it writes new strategies from that. Approved strategies and any with a campaign are kept."
          }
        >
          <form action={rewriteStrategies} className="card">
            <input type="hidden" name="businessProfileId" value={businessRow.id} />
            <input type="hidden" name="from" value="more" />
            <label className="field">
              <span>Who you actually sell to</span>
              <textarea
                name="guidance"
                rows={3}
                maxLength={600}
                required
                autoComplete="off"
                placeholder="Owners of HVAC and plumbing companies in Texas with 5 to 50 staff…"
              />
              <span className="hint">Titles, industries, places and company size all help.</span>
            </label>
            <div>
              <SubmitButton className="btn secondary" pendingLabel="Asking Sage…">
                Write new strategies
              </SubmitButton>
            </div>
          </form>
        </Section>

        {/*
          A second business, for somebody who really runs two. Its own section
          rather than beside "More strategies", because they are different
          things and the wrong one is expensive: adding strategies extends the
          business already here, and this creates the split on purpose.
        */}
        {["owner", "admin"].includes(session.role) ? (
          <Section
            id="add-business"
            title="Another business"
            description="Each business keeps its own profile, its own strategies and its own copy. A workspace running a cleaning company and a real estate agency should not post one's claims in the other's voice."
          >
            <form action={addBusiness} className="card">
              <input type="hidden" name="from" value="more" />
              <label className="field">
                <span>Its website</span>
                <input type="url" name="websiteUrl" autoComplete="url" spellCheck={false} placeholder="https://…" />
                <span className="hint">
                  Sage reads the site and writes that business its own profile and three to five
                  strategies, unapproved, exactly as it did the first time.
                </span>
              </label>
              <label className="field">
                <span>Or describe it</span>
                <textarea
                  name="description"
                  rows={3}
                  maxLength={2000}
                  autoComplete="off"
                  placeholder="What it sells, and who buys it…"
                />
                <span className="hint">
                  One or the other is required. Sage will not invent a business from nothing.
                </span>
              </label>
              <div>
                <SubmitButton className="btn secondary" pendingLabel="Reading the site…">
                  Add this business
                </SubmitButton>
              </div>
            </form>
          </Section>
        ) : null}
      </SectionLayout>
    </>
  );
}
