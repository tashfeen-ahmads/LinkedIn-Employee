import Link from "next/link";
import { PageHeader, Section } from "@/components/page";
import { TOUR_STAGES, stageStatus } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { readSetupState } from "@/lib/setup-state";

/**
 * The product, explained in order, against where this workspace actually is.
 *
 * Not a generic help page. A tour that describes a product in the abstract
 * leaves the reader to work out which paragraph is about them, and the answer
 * was always knowable — `readSetupState` computes it for the sidebar on every
 * request. So each stage is marked done, current or ahead, from the same
 * reading the nav and the dashboard use (rule 32).
 *
 * Every stage states its limit as plainly as its capability. The failures this
 * product has actually had were screens that were quiet about an edge: a funnel
 * counting meetings a campaign never asked for, an acceptance a day late
 * reading as a stalled campaign. Somebody who learns the limits here does not
 * file those as bugs, and does not mistake them for the product being broken.
 */
export const dynamic = "force-dynamic";

export default async function TutorialPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const { state } = await readSetupState(supabase, session.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="Help"
        title="How this works"
        lede={
          <>
          Three of these need a decision from you — approve a strategy, approve the words, press
          launch. Two are answered once at signup. The agents run the rest, and you can take any of
          it over by hand whenever you want to. Each stage says what it cannot do as well as what
          it does: you are going to meet those edges either way, and meeting them here is cheaper.
          </>
        }
      />

      <ol className="tour">
        {TOUR_STAGES.map((stage, index) => {
          const status = stageStatus(stage, state);
          return (
            <li key={stage.id} className={`tour-stage is-${status}`}>
              <div className="tour-mark" aria-hidden="true">
                {index + 1}
              </div>
              <div className="stack-2">
                <div className="row">
                  <h2>{stage.title}</h2>
                  {/* The state in a word, not only in the colour of a rail. */}
                  <span
                    className={`pill tiny ${
                      status === "done" ? "positive" : status === "current" ? "warning" : ""
                    }`}
                  >
                    {status === "done" ? "done" : status === "current" ? "you are here" : "ahead"}
                  </span>
                  {/*
                    Whose the stage is, in its own words. Read off "does this
                    have a youDo", signing up counted as recurring work and the
                    reply stage — which the agent runs on its own once autopilot
                    is on — was marked as the reader's. Six of nine titles then
                    began with "You", which reads as a product that mostly needs
                    you.
                  */}
                  {stage.owner === "agent" ? (
                    <span className="pill tiny">runs by itself</span>
                  ) : stage.owner === "setup" ? (
                    <span className="pill tiny">once, at signup</span>
                  ) : stage.owner === "decision" ? (
                    <span className="pill tiny accent">your decision</span>
                  ) : null}
                </div>

                {stage.youDo ? (
                  <p>
                    <strong>You:</strong> {stage.youDo}
                  </p>
                ) : null}
                <p className="muted">
                  <strong>It:</strong> {stage.weDo}
                </p>
                <p className="small panel">
                  <strong>Worth knowing:</strong> {stage.caveat}
                </p>

                {stage.href ? (
                  <p>
                    <Link
                      className="btn ghost small"
                      href={stage.href}
                      aria-label={`${status === "current" ? "Go and do this" : "Open"}: ${stage.title}`}
                    >
                      {status === "current" ? "Go and do this" : "Open"}
                    </Link>
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <Section
        title="Still stuck"
        description="Raise a ticket and it carries what the product believed at that moment — which step you are on, whether LinkedIn is connected, whether the sending loop is running. You do not have to go and check any of that first."
      >
        <p>
          <Link className="btn secondary small" href="/app/support">
            Raise a ticket
          </Link>
        </p>
      </Section>
    </>
  );
}
