import { knowledgeSentences, type AgentKnowledge } from "@le/shared";
import { Section } from "@/components/page";

/**
 * What this workspace's agent has accumulated.
 *
 * First on the Agents screen, above the agents themselves, because it answers
 * the question a person asks in month six rather than the one they ask on day
 * one. A sequence in a competing tool is a text file — retyped in ten minutes
 * by anybody, which is why those tools churn. Approved copy, tested angles and
 * the record of everybody already spoken to are none of them retypeable, and
 * they were accruing silently behind screens that showed only rates.
 */
export function AgentKnows({ knowledge }: { knowledge: AgentKnowledge }) {
  return (
    <Section
      id="knows"
      title="What your agent knows"
      description="This is yours, and it grows. None of it is anything a new tool could be handed on day one."
    >
      <div className="report">
        {knowledgeSentences(knowledge).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </Section>
  );
}
