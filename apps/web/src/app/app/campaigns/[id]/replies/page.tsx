import Link from "next/link";
import { alwaysHoldsSentence } from "@le/shared";
import { Section } from "@/components/page";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { SubmitButton } from "@/components/submit-button";
import { loadCampaign } from "../data";
import { saveCampaign } from "../actions";

/**
 * Who answers when somebody writes back, and which agent writes for this
 * campaign.
 *
 * The sentence under the setting says which holds are in force on this
 * campaign, because "Pricing, legal and anything negative always wait for a
 * person" was printed under campaigns whose workspace had chosen to let the
 * agent answer exactly those (rule 41).
 */
export default async function CampaignRepliesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const { id } = await params;
  const { campaign, agents, autonomous, planNote } = await loadCampaign(id);

  return (
    <>
      <PageNotice error={notice.error} notice={notice.notice} />

      <Section
        id="handling"
        title="How replies are handled"
        description="A reply is answered by the agent writing for this campaign. You choose whether each answer waits for you."
      >
        <form action={saveCampaign} className="card">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <input type="hidden" name="section" value="replies" />

          <label className="field">
            <span>Replies</span>
            <select name="replyMode" defaultValue={campaign.reply_mode}>
              <option value="approval">Hold for my approval</option>
              <option value="autopilot">Send clean replies for me</option>
            </select>
          </label>
          <p className="small muted">
            {campaign.reply_mode === "approval"
              ? "Every reply waits for you before it is sent."
              : autonomous
                ? "Your rules let the agent answer pricing, legal and negative replies itself."
                : "Pricing, legal and anything negative always wait for a person."}{" "}
            {alwaysHoldsSentence()}
          </p>
          {planNote ? <p className="small muted">{planNote}</p> : null}

          {agents.length > 0 ? (
            <label className="field">
              <span>Written by</span>
              <select name="agentId" defaultValue={campaign.agent_id ?? ""}>
                <option value="">No agent, the workspace&rsquo;s own copy</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.is_default ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <span className="hint">
                The agent carries the voice, the openers, the offer and how replies are answered.
                Changing it here does not rewrite the notes already written. Rewrite notes on Opener
                &amp; offer does that.
              </span>
            </label>
          ) : (
            <p className="small muted">
              No agents yet, so replies are written in the workspace&rsquo;s own voice.{" "}
              <Link href="/app/agents">Make one</Link>
            </p>
          )}

          <div className="cluster">
            <SubmitButton className="btn secondary" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </div>
        </form>
      </Section>
    </>
  );
}
