import { YOUR_DECISIONS } from "@le/shared";

/**
 * What happens to the answers, beside the form that asks for them.
 *
 * Onboarding is the one screen where somebody types a lot before seeing
 * anything happen. The page said nothing about what any of it was for, so it
 * read as a registration form rather than as the thing that teaches the agent
 * — and a person filling in a sending window has no way to know it is the
 * reason their first campaign will not send at four in the morning.
 *
 * The three decisions are read from `YOUR_DECISIONS` rather than retold here.
 * They are already the definition three other screens use, and a fourth
 * telling is the one that drifts (rule 32's argument, applied to copy).
 */
export function SetupRail() {
  return (
    <aside className="setup-rail" aria-label="What happens next">
      <div className="stack-3">
        <p className="eyebrow">What happens when you press it</p>
        <p className="prose muted">
          Sage, the team&rsquo;s strategist, reads what you publish and writes three to five
          customer profiles — who to go after, why they would care, what to say. About a minute.
        </p>
      </div>

      <div className="stack-3">
        <p className="field-group-label">Then it is yours, three times</p>
        <ol className="stack-3">
          {YOUR_DECISIONS.map((decision) => (
            <li key={decision.title} className="setup-step">
              <span className="setup-step-mark" aria-hidden="true" />
              <span className="setup-step-body">
                <strong>{decision.title}</strong>
                <span className="small muted">{decision.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/*
        The sentence that makes the form worth filling in carefully. Somebody
        typing a sending window into a signup form has no reason to believe it
        matters; this says where it lands.
      */}
      <p className="small muted prose">
        Nothing leaves your account until you press Launch — not while you are filling this in, and
        not while the agent is writing. Every answer here lands on your profile, where you can
        change any of it later.
      </p>
    </aside>
  );
}
