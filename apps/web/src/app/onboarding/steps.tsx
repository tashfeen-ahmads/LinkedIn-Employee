import Link from "next/link";
import {
  CLICKS_ARE_INVISIBLE,
  CTA_DEFINITIONS,
  CTA_KINDS,
  EXTERNAL_BOOKINGS_UNCOUNTED,
  FREE_NOTES_PER_MONTH,
  alwaysHoldsSentence,
} from "@le/shared";
import { TimezoneSelect } from "@/components/timezone-select";
import { TimezoneGuess } from "@/components/timezone-guess";
import { PostButton } from "@/components/post-button";
import { FormKeeper } from "@/components/form-keeper";
import { NORA } from "@/lib/team";
import { CopyPreview } from "@/components/copy-preview";
import type { OnboardingStash } from "@/lib/onboarding-stash";
import type { WizardAccount } from "@/lib/wizard-state";
import type { ReplyHandling } from "@/lib/autonomy";

/*
 * The screens of onboarding, one per step (rule 65).
 *
 * Each posts to `/onboarding/save` with an `action` naming the step, and the
 * route decides where to go next from what is then stored — never from which
 * button was pressed.
 */

/** An hour of the day as somebody reads it, for the sending-window selects. */
function hourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "Midnight";
  if (hour === 12) return "Noon";
  return `${hour % 12}:00 ${hour < 12 ? "am" : "pm"}`;
}
const START_HOURS = Array.from({ length: 24 }, (_, h) => h);
const END_HOURS = Array.from({ length: 24 }, (_, h) => h + 1);
const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/* ------------------------------------------------------------------ 1 */

/** The first screen: what the business is, which creates the workspace and starts Sage. */
export function BusinessForm() {
  return (
    <form id="onboarding-business" action="/onboarding/submit" method="post" className="stack-4">
      {/* The key the app clears once a workspace exists (ClearKept), so a second
          sign-up in the same browser does not start with the first one's answers. */}
      <FormKeeper formId="onboarding-business" storageKey="nora:onboarding-answers" />
      <label className="field">
        <span>Company name</span>
        <input name="companyName" required autoComplete="organization" placeholder="Brightwater Dental Group" />
      </label>
      {/* Text with a URL keyboard, not `type="url"`: the browser's check refuses
          "brightwaterdental.com", which is how almost everybody types it. */}
      <label className="field">
        <span>Website</span>
        <input
          name="websiteUrl"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="brightwaterdental.com"
        />
      </label>
      <label className="field">
        <span>LinkedIn company page</span>
        <input
          name="linkedinCompanyUrl"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="linkedin.com/company/brightwater-dental"
        />
      </label>
      <label className="field">
        <span>Anything else worth knowing</span>
        <textarea name="description" rows={4} placeholder="Who you sell to, what you charge, what makes you different." />
        <span className="hint">
          Your website or a description is required. A LinkedIn page helps beside them but cannot be read on its
          own, and Sage will not invent a business from nothing.
        </span>
      </label>
      <PostButton className="btn block" pendingLabel="Starting Sage…">
        Continue
      </PostButton>
    </form>
  );
}

/* ------------------------------------------------------------------ 2 */

const PLANS = [
  {
    value: "basic",
    title: "Free (Basic)",
    hint: `Searches use job title, location and industry only. LinkedIn lets a free account add a note to ${FREE_NOTES_PER_MONTH} invitations a month; after that ${NORA} sends them without one.`,
  },
  { value: "premium", title: "Premium", hint: "Every invitation can carry a note. Searches use job title, location and industry." },
  {
    value: "sales_navigator",
    title: "Sales Navigator",
    hint: "Every invitation can carry a note, and searches also filter by seniority and company size.",
  },
] as const;

export function LinkedInForm({
  account,
  stash,
  connected,
}: {
  account: WizardAccount | null;
  stash: OnboardingStash;
  connected: boolean;
}) {
  const plan = account
    ? account.has_sales_navigator
      ? "sales_navigator"
      : account.has_premium
        ? "premium"
        : "basic"
    : stash.hasSalesNavigator
      ? "sales_navigator"
      : stash.hasPremium
        ? "premium"
        : stash.hasPremium === false
          ? "basic"
          : null;
  return (
    <form action="/onboarding/save" method="post" className="stack-4">
      <input type="hidden" name="action" value="linkedin-connect" />
      <fieldset className="field-group">
        <legend>Which LinkedIn plan does this account have?</legend>
        <span className="tiny subtle hint">
          It decides how precisely {NORA} can search and whether invitations carry a note. Once you connect,{" "}
          {NORA} also checks with LinkedIn.
        </span>
        {PLANS.map((option) => (
          <label key={option.value} className="small check">
            <input type="radio" name="linkedinPlan" value={option.value} required defaultChecked={plan === option.value} />
            <span>
              <strong>{option.title}</strong>
              <span className="tiny subtle hint">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {connected ? (
        <PostButton className="btn block" pendingLabel="Saving…">
          Continue
        </PostButton>
      ) : (
        <>
          <PostButton className="btn block" pendingLabel="Opening LinkedIn…">
            Connect LinkedIn
          </PostButton>
          <p className="tiny subtle">
            You sign in on LinkedIn&rsquo;s own secure page and come straight back here. We never see your
            password.
          </p>
        </>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ 3 */

/** When prospects may book a call, as the step opens on it. */
export interface MeetingHours {
  start: number;
  end: number;
  days: number[];
  meetingMinutes: number;
  location: string | null;
}

const MEETING_LENGTHS = [15, 20, 30, 45, 60];

export function HoursForm({
  timezone,
  hours,
  meetings,
}: {
  timezone: string | null;
  hours: { start: number; end: number; days: number[] } | null;
  meetings: MeetingHours;
}) {
  const h = hours ?? { start: 9, end: 17, days: [1, 2, 3, 4, 5] };
  const m = meetings;
  return (
    <form action="/onboarding/save" method="post" className="stack-4">
      <input type="hidden" name="action" value="hours" />
      <label className="field medium">
        <span>Your timezone</span>
        <TimezoneSelect id="wz-timezone" value={timezone ?? undefined} />
        {timezone && timezone !== "UTC" ? null : <TimezoneGuess targetId="wz-timezone" />}
        <span className="hint">Check this one. A window in the wrong zone sends at four in the morning, or never.</span>
      </label>
      <div className="form-row">
        <label className="field compact">
          <span>From</span>
          <select name="start" defaultValue={h.start}>
            {START_HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </label>
        <label className="field compact">
          <span>To</span>
          <select name="end" defaultValue={h.end}>
            {END_HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="field-group">
        <legend>Days it may send on</legend>
        <div className="cluster-3">
          {DAYS.map((day) => (
            <label key={day.value} className="small check">
              <input type="checkbox" name={`day-${day.value}`} defaultChecked={h.days.includes(day.value)} />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/*
        When a prospect may book a call, asked beside the sending hours and
        apart from them: invitations going out at eight is fine, a call at
        eight usually is not. These are the only times the agent ever offers
        (rule 6), so a rep who never sees this question is booked into the
        defaults without knowing there were any.
      */}
      <fieldset className="field-group">
        <legend>When prospects can book a call with you</legend>
        <p className="small muted">
          {NORA} only ever offers times inside these hours, in the timezone above, and never two calls on top of each
          other.
        </p>
        <div className="form-row">
          <label className="field compact">
            <span>From</span>
            <select name="meetStart" defaultValue={m.start}>
              {START_HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>To</span>
            <select name="meetEnd" defaultValue={m.end}>
              {END_HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>Each call</span>
            <select name="meetingMinutes" defaultValue={m.meetingMinutes}>
              {(MEETING_LENGTHS.includes(m.meetingMinutes) ? MEETING_LENGTHS : [...MEETING_LENGTHS, m.meetingMinutes]).map(
                (minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        <div className="cluster-3">
          {DAYS.map((day) => (
            <label key={day.value} className="small check">
              <input type="checkbox" name={`meetDay-${day.value}`} defaultChecked={m.days.includes(day.value)} />
              {day.label}
            </label>
          ))}
        </div>
        <label className="field">
          <span>Where you meet · optional</span>
          <input
            name="location"
            defaultValue={m.location ?? ""}
            maxLength={280}
            placeholder="https://meet.google.com/abc-defg-hij"
            autoComplete="off"
          />
          <span className="hint">
            Your video link or phone number, put in every invitation. Blocked-out time and more settings are on
            Meetings.
          </span>
        </label>
      </fieldset>

      <PostButton className="btn block" pendingLabel="Saving…">
        Confirm hours
      </PostButton>
    </form>
  );
}

/* ------------------------------------------------------------------ 4 */

export function VoiceForm({ fullName, bio }: { fullName: string | null; bio: string | null }) {
  return (
    <form action="/onboarding/save" method="post" className="stack-4">
      <input type="hidden" name="action" value="voice" />
      <label className="field">
        <span>Your name</span>
        <input name="fullName" required autoComplete="name" defaultValue={fullName ?? ""} placeholder="Maya Lindqvist" />
        <span className="hint">What a prospect sees the invitation come from.</span>
      </label>
      <label className="field">
        <span>How you would describe yourself to a prospect</span>
        <textarea
          name="bio"
          rows={3}
          defaultValue={bio ?? ""}
          placeholder="Twelve years in logistics ops before this. I care about the boring parts."
        />
        <span className="hint">The voice every note and reply is written in. Left blank it sounds like a company, not a person.</span>
      </label>
      <PostButton className="btn block" pendingLabel="Saving…">
        Confirm and continue
      </PostButton>
    </form>
  );
}

/* ------------------------------------------------------------------ 5 */

export function CtaForm({
  cta,
  bookingUrl,
}: {
  cta: OnboardingStash["cta"];
  bookingUrl: string | null;
}) {
  const kind = cta?.kind ?? "meeting";
  return (
    <form action="/onboarding/save" method="post" className="stack-4">
      <input type="hidden" name="action" value="cta" />
      <fieldset className="field-group">
        <legend>What should your campaigns ask people for?</legend>
        <span className="tiny subtle hint">
          The messages are written toward this, so choose it before the first campaign is built. Each strategy can
          have its own later.
        </span>
        {CTA_KINDS.map((option) => (
          <label key={option} className="small check">
            <input type="radio" name="ctaKind" value={option} required defaultChecked={kind === option} />
            <span>
              <strong>{CTA_DEFINITIONS[option].label}</strong>
              <span className="tiny subtle hint">Asks for {CTA_DEFINITIONS[option].asks}.</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Link · for &ldquo;{CTA_DEFINITIONS.link.label}&rdquo;</span>
        <input
          name="ctaUrl"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={cta?.url ?? ""}
          placeholder="yoursite.com/free-audit"
        />
        <span className="hint">
          Never put in a connection request, only in the messages after one is accepted. {CLICKS_ARE_INVISIBLE}
        </span>
      </label>
      <label className="field">
        <span>What the link is · optional</span>
        <input name="ctaLabel" defaultValue={cta?.label ?? ""} placeholder="A free 15-minute audit" />
      </label>
      <label className="field">
        <span>Your scheduling link · optional, for &ldquo;{CTA_DEFINITIONS.meeting.label}&rdquo;</span>
        <input
          name="bookingUrl"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={bookingUrl ?? ""}
          placeholder="calendly.com/you/intro"
        />
        <span className="hint">
          Leave it blank to offer times from {NORA}&rsquo;s own booking page. {EXTERNAL_BOOKINGS_UNCOUNTED}
        </span>
      </label>
      <PostButton className="btn block" pendingLabel="Saving…">
        Confirm and continue
      </PostButton>
    </form>
  );
}

/* ------------------------------------------------------------------ 6 */

export interface StrategyCard {
  id: string;
  name: string;
  summary: string;
  whatTheyBuy: string | null;
  insteadOfToday: string | null;
  pains: readonly string[];
  /** The competitor warning (rule 49), when this segment names the company's own competitors. */
  rivals: string | null;
  approved: boolean;
}

export function StrategyCards({ cards }: { cards: StrategyCard[] }) {
  return (
    <div className="stack-4">
      {cards.map((card) => (
        <article key={card.id} className="card wz-strategy">
          <header className="between">
            <h3>{card.name.trim() || "Unnamed strategy"}</h3>
            {card.approved ? <span className="pill positive">Approved</span> : null}
          </header>
          <p className="small">{card.summary}</p>
          {card.rivals ? (
            <div className="notice warning">
              <p className="small">
                <strong>Check this is who you meant.</strong> {card.rivals}
              </p>
            </div>
          ) : null}
          <dl className="wz-facts small">
            <dt>What they buy</dt>
            <dd>{card.whatTheyBuy ?? "Not said."}</dd>
            <dt>What they do today instead</dt>
            <dd>{card.insteadOfToday ?? "Not said."}</dd>
            {card.pains.length ? (
              <>
                <dt>What hurts</dt>
                <dd>{card.pains.slice(0, 3).join(" · ")}</dd>
              </>
            ) : null}
          </dl>
          {card.approved ? null : !card.name.trim() ? (
            // Written from nothing: there is no segment to approve, and the
            // way forward is "None of these fit?" below.
            <p className="small muted">
              Sage wrote this one with no name, so it cannot be approved. Tell Sage who you sell to below and it will
              write new ones.
            </p>
          ) : (
            <form action="/onboarding/save" method="post">
              <input type="hidden" name="action" value="approve" />
              <input type="hidden" name="profileId" value={card.id} />
              <PostButton className="btn small" pendingLabel="Approving…">
                Approve and find people
              </PostButton>
            </form>
          )}
        </article>
      ))}
    </div>
  );
}

/**
 * The way out when none of the suggestions fit. Without it the only choice was
 * to approve a segment the owner knew was wrong, or stop, and setup holds the
 * rest of the app until one is approved.
 */
export function RewriteStrategies() {
  return (
    <form action="/onboarding/save" method="post" className="card stack-4">
      <input type="hidden" name="action" value="rewrite" />
      <label className="field">
        <span>
          <strong>None of these fit?</strong> Tell {NORA} who you actually sell to.
        </span>
        <textarea
          name="guidance"
          rows={3}
          maxLength={600}
          required
          placeholder="Owners of HVAC and plumbing companies in Texas with 5 to 50 staff"
        />
        <span className="hint">Titles, industries, places and company size all help. New strategies replace these.</span>
      </label>
      <PostButton className="btn secondary" pendingLabel="Asking Sage…">
        Write new strategies
      </PostButton>
    </form>
  );
}

/* ------------------------------------------------------------------ 7 */

export function SearchButton({ profileId, label = "Search LinkedIn" }: { profileId: string; label?: string }) {
  return (
    <form action="/onboarding/save" method="post">
      <input type="hidden" name="action" value="search" />
      <input type="hidden" name="profileId" value={profileId} />
      <PostButton className="btn" pendingLabel="Starting the search…">
        {label}
      </PostButton>
    </form>
  );
}

/* ------------------------------------------------------------------ 8 */

export interface LaunchReview {
  campaignId: string;
  name: string;
  people: number;
  dailyCap: number;
  asks: string;
  samples: Array<{ who: string; note: string | null }>;
  /** The sequence of the angle most of the list holds (rule 28). */
  steps: Array<{ n: number; delayDays: number; message: string }>;
  /** Who the messages are previewed for, and what fills them (`CopyPreview`). */
  sample: { first_name: string | null; last_name: string | null; company: string | null; title: string | null } | null;
  pitch: string | null;
  linkLabel: string;
  /** That angle, how many queued people hold it, and how many angles the list has; null when nobody holds one. */
  angle: { name: string | null; holders: number; angles: number } | null;
  /** A free account's invitation notes left this month (rule 62); null on a paid plan or when unknown. */
  notesLeft: number | null;
  blockers: string[];
  /** The agent's opener and offer, unapproved; launching approves these exact words. */
  lines: Array<{ table: "hooks" | "pitches"; id: string; body: string; title: string }>;
}

export function LaunchPanel({
  review,
  handling,
  canSetWorkspace,
}: {
  review: LaunchReview;
  /** What the workspace already chose, so the screen opens on it; null asks with nothing ticked. */
  handling: ReplyHandling | null;
  /** Only owners, admins and managers change the workspace's answer; anyone launching sets this campaign's. */
  canSetWorkspace: boolean;
}) {
  const ready = review.blockers.length === 0;
  return (
    <div className="stack-4">
      <dl className="wz-summary">
        <div>
          <dt>Campaign</dt>
          <dd>{review.name}</dd>
        </div>
        <div>
          <dt>People on the list</dt>
          <dd className="num">{review.people}</dd>
        </div>
        <div>
          <dt>Invitations a day, at most</dt>
          <dd className="num">{review.dailyCap}</dd>
        </div>
        <div>
          <dt>It asks for</dt>
          <dd>{review.asks}</dd>
        </div>
      </dl>

      {review.lines.length ? (
        <section className="stack-2" aria-labelledby="wz-lines">
          <h3 id="wz-lines">In your words</h3>
          <ul className="wz-notes">
            {review.lines.map((line) => (
              <li key={line.id}>
                <p className="tiny subtle">{line.title}</p>
                <p className="small">{line.body}</p>
                {line.table === "hooks" ? (
                  // Notes are written when a list is built, so an opener
                  // approved now cannot have shaped this list's (rule 40).
                  <p className="tiny subtle">
                    This shapes the notes written for people {NORA} finds from now on. This list&rsquo;s notes
                    were written when it was built, and are shown below exactly as they will go.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="tiny subtle">
            Launching approves these exact words for {NORA} to use. Change them any time on Agents.
          </p>
        </section>
      ) : null}

      {review.samples.length ? (
        <section className="stack-2" aria-labelledby="wz-samples">
          <h3 id="wz-samples">A few of the connection notes</h3>
          {review.notesLeft !== null ? (
            <p className="small" role="note">
              {review.notesLeft > 0
                ? `${review.notesLeft} of ${FREE_NOTES_PER_MONTH} notes left this month. `
                : `0 of ${FREE_NOTES_PER_MONTH} notes left this month, so invitations go without a note until the month turns, these included. `}
              A free LinkedIn account can add a note to only {FREE_NOTES_PER_MONTH} invitations a month; after
              that invitations are still sent, without one.
            </p>
          ) : null}
          <ul className="wz-notes">
            {review.samples.map((sample, i) => (
              <li key={i}>
                <p className="tiny subtle">To {sample.who}</p>
                <p className="small">{sample.note ?? "No note: the invitation goes without one."}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {review.steps.length ? (
        <section className="stack-2" aria-labelledby="wz-steps">
          <h3 id="wz-steps">After they accept</h3>
          {review.angle ? (
            <p className="small">
              Most people on this list get this angle
              {review.angle.name ? <> (&ldquo;{review.angle.name}&rdquo;)</> : null}: {review.angle.holders} of{" "}
              {review.people}.{" "}
              {review.angle.angles > 1
                ? `${review.angle.angles} angles in total, each with its own messages; every one is on the campaign page.`
                : "It is the only angle on this list."}
            </p>
          ) : null}
          {review.sample?.first_name ? (
            <p className="tiny subtle">Shown as {review.sample.first_name} would read them.</p>
          ) : null}
          <ol className="wz-sequence">
            {review.steps.map((step) => (
              <li key={step.n}>
                <p className="tiny subtle">
                  {step.n === 1
                    ? "Soon after they accept · written for each person"
                    : `${step.delayDays} day${step.delayDays === 1 ? "" : "s"} later, if no reply`}
                </p>
                {step.n === 1 ? (
                  <p className="tiny subtle">
                    The first message after somebody accepts is written for that person, from their own profile
                    and the note they accepted. This is what goes if one cannot be written.
                  </p>
                ) : null}
                <p className="small">
                  <CopyPreview message={step.message} person={review.sample} pitch={review.pitch} linkLabel={review.linkLabel} />
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="small">
        <Link href={`/app/campaigns/${review.campaignId}`}>Read every name and every message</Link> before you
        launch. Nothing is sent until you press the button.
      </p>

      {ready ? null : (
        <div className="notice warning" role="status">
          <p>
            <strong>Not ready to launch yet.</strong>
          </p>
          <ul className="small bullets">
            {review.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <form action="/onboarding/save" method="post">
        <input type="hidden" name="action" value="launch" />
        <input type="hidden" name="campaignId" value={review.campaignId} />
        {review.lines.map((line) => (
          <span key={line.id} hidden>
            <input type="hidden" name="lineTable" value={line.table} />
            <input type="hidden" name="lineId" value={line.id} />
            <input type="hidden" name="lineBody" value={line.body} />
          </span>
        ))}
        <fieldset className="wz-choice">
          <legend>When somebody replies, who answers?</legend>
          <label className="wz-option">
            <input type="radio" name="handling" value="check" required defaultChecked={handling === "check"} />
            <span>
              <strong>I&rsquo;ll check each one</strong>
              <span className="small">
                {NORA} drafts every answer and nothing goes back until you approve it in your Inbox. Slower, and every
                word is yours.
              </span>
            </span>
          </label>
          <label className="wz-option">
            <input type="radio" name="handling" value="nora" defaultChecked={handling === "nora"} />
            <span>
              <strong>Let {NORA} run it and fill my calendar</strong>
              <span className="small">
                {NORA} answers replies and books the meetings on its own, minutes after they arrive, from your own
                material only.
              </span>
            </span>
          </label>
          <p className="tiny subtle">{alwaysHoldsSentence()}</p>
          <p className="tiny subtle">
            {canSetWorkspace
              ? "This becomes the setting for every campaign. Change it any time on your Profile or on a campaign."
              : "This sets it for this campaign. Your workspace owner sets it for the others."}
          </p>
        </fieldset>
        {ready ? (
          <PostButton className="btn block" pendingLabel="Launching…">
            Launch my first campaign
          </PostButton>
        ) : (
          <button type="button" className="btn block" disabled>
            Launch my first campaign
          </button>
        )}
      </form>
      <p className="tiny subtle">
        Inside your sending hours the first invitation goes out within seconds of launching; the rest are spread
        across those hours, a few a day to start on a new account. You can pause it at any time.
      </p>
    </div>
  );
}
