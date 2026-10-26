import Image from "next/image";
import Link from "next/link";
import { BRAND, DEFAULT_WORKING_HOURS, FREE_NOTES_PER_MONTH, INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS, SUSTAINED_INVITES_PER_DAY, WEEKS_TO_SUSTAINED } from "@le/shared";
import { SITE } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/plans";
import {
  BOOKED_DAY_NAME,
  BOOKED_SLOT,
  EXAMPLE_DAY,
  EXAMPLE_DAY_CAP,
  EXAMPLE_DAY_NUMBER,
  EXAMPLE_MESSAGES,
  EXAMPLE_NEXT,
  EXAMPLE_NOTES,
  EXAMPLE_SENT,
  EXAMPLE_SLOTS,
  EXAMPLE_SPREAD,
  HERO_NOTE,
  HERO_NOTE_TEXT,
  PEOPLE,
  SLOT_TZ_LABEL,
  meetingLines,
  slotLabel,
  twelveHour,
} from "@/lib/marketing-examples";
import { SEARCH_FILTERS } from "@le/linkedin";
import { RampChart } from "./diagrams";
import { NavIcon } from "./icons";
import { LogoMark } from "./logo";
import { Reveal } from "./reveal";

/*
 * The home page, one section per reference frame, in the order a buyer asks
 * their questions: what is it, how much of it is mine to do, will it sound
 * like me, will it cost me my account, what happens when somebody answers.
 *
 * Every picture here is a real mini component fed by the worked example in
 * `lib/marketing-examples.ts`, which is computed by the sender's own
 * functions. The people in it are invented and labelled as examples.
 */

const SIGNUP = `${SITE.app}/signup`;

/** A number as a fraction of its cap, for a meter's fill. */
function fill(value: number, of: number): React.CSSProperties {
  return { ["--fill" as string]: String(Math.min(1, value / of)) };
}

/* -------------------------------------------------------------- 1. hero */

export function Hero() {
  return (
    <section className="mk-hero hero-wash">
      <div className="container mk-hero-grid">
        <div className="mk-hero-copy">
          <p className="mk-hero-badge">
            <span className="mk-hero-badge-dot" aria-hidden="true" />
            {TRIAL_DAYS}-day free trial. No card.
          </p>
          <h1 className="mk-display">
            <span className="mk-line">The AI SDR for LinkedIn</span>{" "}
            <span className="mk-line">
              built around <span className="mk-hero-em">account safety</span>.
            </span>
          </h1>
          <p className="mk-hero-sub">
            {BRAND.name} finds the right people, writes each one a personal note, drafts your replies and
            books the call, all paced inside daily limits.
          </p>
          <p className="mk-hero-fast">
            <NavIcon name="campaigns" className="mk-icon" />
            <span>
              <strong>A few guided steps, then one click to go live.</strong> Your first invitation goes out
              within seconds, inside your sending hours.
            </span>
          </p>
          <div className="mk-hero-actions">
            <Link href={SIGNUP} className="btn large">
              Start a {TRIAL_DAYS}-day free trial
            </Link>
            <Link href="/how-it-works" className="btn large secondary mk-hero-second">
              See how it works <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ul className="mk-hero-proof">
            <li>
              <NavIcon name="check" className="mk-icon" />
              You approve every launch
            </li>
            <li>
              <NavIcon name="check" className="mk-icon" />
              Never contacts anyone twice
            </li>
            <li>
              <NavIcon name="check" className="mk-icon" />
              <span>
                <span className="mk-num">
                  {LINKEDIN_LIMITS.invitesPerDayStart} to {SUSTAINED_INVITES_PER_DAY}
                </span>{" "}
                invitations a day
              </span>
            </li>
          </ul>
        </div>

        <HeroScene />
      </div>
    </section>
  );
}

/**
 * The product at work, layered the way it happens: the day's invitations
 * spread across working hours behind, one note written for one person in
 * front, and the warm-up the account is on. Every number is the sender's own
 * (the ramp's cap for the example day, the spread's real times, the note's
 * length against the real limit); the person is an invented example.
 */
function HeroScene() {
  const { startMin, endMin, minutes } = EXAMPLE_SPREAD;
  const span = endMin - startMin;
  const at = (minute: number) => `${(((minute - startMin) / span) * 100).toFixed(2)}%`;
  const next = minutes[EXAMPLE_SENT];
  return (
    <figure className="mk-scene" aria-label="Example: one invitation written for one person, inside one account's day">
      <div className="mk-scene-day">
        <div className="mk-scene-day-head">
          <p className="mk-scene-title">Your day</p>
          <p className="mk-scene-count mk-num">
            {EXAMPLE_SENT} of {EXAMPLE_DAY_CAP} sent
          </p>
        </div>
        <div className="mk-scene-track" aria-hidden="true">
          {minutes.map((minute, index) => (
            <span
              key={minute}
              className={`mk-scene-dot${index < EXAMPLE_SENT ? " is-sent" : ""}${index === EXAMPLE_SENT ? " is-next" : ""}`}
              style={{ left: at(minute) }}
            />
          ))}
          {next !== undefined ? <span className="mk-scene-tick" style={{ left: at(next) }} /> : null}
        </div>
        <div className="mk-scene-axis mk-num" aria-hidden="true">
          <span>{EXAMPLE_DAY.start}</span>
          <span>{EXAMPLE_DAY.end}</span>
        </div>
        <p className="mk-scene-next">
          <NavIcon name="clock" className="mk-icon" />
          <span>
            Next invitation <strong className="mk-num">{EXAMPLE_NEXT}</strong>
          </span>
        </p>
      </div>

      <div className="mk-scene-note">
        <div className="mk-scene-person">
          <Image
            src={HERO_NOTE.person.photo}
            alt={`Example prospect ${HERO_NOTE.person.name}`}
            width={56}
            height={56}
            priority
            className="mk-scene-avatar"
          />
          <div>
            <p className="mk-scene-name">{HERO_NOTE.person.name}</p>
            <p className="mk-scene-role">
              {HERO_NOTE.person.role}, {HERO_NOTE.person.company}
            </p>
          </div>
        </div>
        <p className="mk-scene-text">
          {HERO_NOTE.parts.map((part) =>
            part.from ? (
              <mark key={part.text} className="mk-scene-mark" title={`From ${part.from}`}>
                {part.text}
                <span className="sr-only"> (from {part.from})</span>
              </mark>
            ) : (
              <span key={part.text}>{part.text}</span>
            ),
          )}
        </p>
        <div className="mk-scene-foot">
          <span className="mk-num">
            {HERO_NOTE_TEXT.length} / {INVITE_NOTE_MAX_CHARS} characters
          </span>
          <span className="mk-scene-ok">
            <NavIcon name="check" className="mk-icon" />
            Approved by you
          </span>
        </div>
      </div>

      <p className="mk-scene-chip">
        <NavIcon name="shield" className="mk-icon" />
        <span>
          Day {EXAMPLE_DAY_NUMBER} of warm-up <span aria-hidden="true">·</span>{" "}
          <span className="mk-num">{EXAMPLE_DAY_CAP}</span> a day
        </span>
      </p>
    </figure>
  );
}

/* ---------------------------------------------------- 2. three decisions */

const RAIL = [
  { icon: "profile", label: "Finds real people" },
  { icon: "posts", label: "Writes one note per person" },
  { icon: "campaigns", label: "Follows up" },
  { icon: "support", label: "Drafts every reply" },
  { icon: "meetings", label: "Books the call" },
] as const;

export function Decisions() {
  return (
    <section className="mk-section" id="decisions">
      <div className="container mk-stack">
        <Reveal>
          <header className="mk-head">
            <h2 className="mk-h2">
              <span className="mk-line">You make three decisions.</span>{" "}
              <span className="mk-line">{BRAND.name} does the rest.</span>
            </h2>
            <p className="mk-lede">
              Nothing is sent until you have approved who to reach, what they read, and the launch.
            </p>
          </header>
        </Reveal>

        <div className="mk-decide">
          <ol className="mk-decide-steps">
            <li className="mk-decide-card">
              <span className="mk-step-n" aria-hidden="true">1</span>
              <h3>Approve who to reach</h3>
              <div className="mk-decide-visual" aria-hidden="true">
                <div className="mk-strategy">
                  <span className="mk-strategy-icon">
                    <NavIcon name="strategies" className="mk-icon" />
                  </span>
                  <span>Owners of 5 to 40 person dental groups, US</span>
                </div>
                <span className="mk-fakebtn">Approve</span>
              </div>
              <p className="mk-decide-note">{BRAND.name} drafts the strategies. Only you approve one.</p>
            </li>

            <li className="mk-decide-card">
              <span className="mk-step-n" aria-hidden="true">2</span>
              <h3>Approve what they read</h3>
              <div className="mk-decide-visual" aria-hidden="true">
                <p className="mk-note-sample">
                  Hi Priya, saw you opened a <mark>second clinic</mark> in <mark>Austin</mark> this
                  spring. How are you handling recall across both?
                </p>
                <span className="mk-fakebtn">Approve</span>
              </div>
              <p className="mk-decide-note">
                You approve the opener and the offer, then choose: check each reply yourself, or let {BRAND.name}{" "}
                answer and book on its own.
              </p>
            </li>

            <li className="mk-decide-card">
              <span className="mk-step-n" aria-hidden="true">3</span>
              <h3>One click to go live</h3>
              <div className="mk-decide-visual" aria-hidden="true">
                <dl className="mk-launch">
                  <div>
                    <dt>Sends</dt>
                    <dd>
                      {twelveHour(DEFAULT_WORKING_HOURS.start, 0)} to{" "}
                      {twelveHour(DEFAULT_WORKING_HOURS.end, 0)}, weekdays
                    </dd>
                  </div>
                  <div>
                    <dt>Starts at</dt>
                    <dd>{LINKEDIN_LIMITS.invitesPerDayStart} invitations a day</dd>
                  </div>
                  <div>
                    <dt>First invitation</dt>
                    <dd>Within seconds</dd>
                  </div>
                </dl>
                <span className="mk-fakebtn">Launch my first campaign</span>
              </div>
              <p className="mk-decide-note">
                Nothing sends until you press it. Then your first invitation goes within seconds, the rest are
                spread across your hours.
              </p>
            </li>
          </ol>

          <div className="mk-after">
            <p className="mk-after-label">After launch, {BRAND.name}:</p>
            <ol className="mk-rail" aria-label={`What ${BRAND.name} does after launch`}>
              {RAIL.map((item) => (
                <li key={item.label}>
                  <NavIcon name={item.icon} className="mk-rail-icon" />
                  <span>{item.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------ 2b. Sales Navigator */

/*
 * The search tier, said where somebody deciding "who to reach" will see it.
 * The rows are SEARCH_FILTERS, which a test holds to what the search really
 * applies, so this table cannot promise a filter the product drops.
 */
export function SalesNavigator() {
  return (
    <section className="mk-section mk-tint" id="sales-navigator">
      <div className="container mk-sn">
        <Reveal>
          <div className="mk-sn-copy">
            <span className="mk-eyebrow">Sales Navigator</span>
            <h2 className="mk-h2">Have Sales Navigator? {BRAND.name} searches with it.</h2>
            <p className="mk-lede">
              Tick one box and every search runs on Sales Navigator: tighter lists, and fewer
              invitations spent on the wrong people. No Sales Navigator? {BRAND.name} still works
              on a regular LinkedIn account.
            </p>
            <ul className="mk-sn-points">
              <li>
                <NavIcon name="check" className="mk-sn-icon" />
                <span>One tick in your settings. Nothing else to set up.</span>
              </li>
              <li>
                <NavIcon name="check" className="mk-sn-icon" />
                <span>Without it, each campaign names the filters it could not apply, before you launch.</span>
              </li>
              <li>
                <NavIcon name="check" className="mk-sn-icon" />
                <span>Premium or Sales Navigator also lifts LinkedIn&rsquo;s monthly limit on invitation notes.</span>
              </li>
              <li>
                <NavIcon name="check" className="mk-sn-icon" />
                <span>Sales Navigator is sold by LinkedIn, not by us.</span>
              </li>
            </ul>
            <Link href="/guides/linkedin-prospecting-without-sales-navigator" className="mk-textlink small">
              Prospecting without Sales Navigator <span aria-hidden="true">→</span>
            </Link>
          </div>
        </Reveal>

        <figure className="mk-sn-card">
          <figcaption className="mk-sn-caption">What each search can filter on</figcaption>
          <table className="mk-sn-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Filter</span>
                </th>
                <th scope="col">Regular LinkedIn</th>
                <th scope="col" className="is-sn">
                  Sales Navigator
                </th>
              </tr>
            </thead>
            <tbody>
              {SEARCH_FILTERS.map((filter) => (
                <tr key={filter.label}>
                  <th scope="row">{filter.label}</th>
                  <td>
                    {filter.classic ? (
                      <>
                        <NavIcon name="check" className="mk-sn-yes" />
                        <span className="sr-only">Yes</span>
                      </>
                    ) : (
                      <span className="mk-sn-no">No</span>
                    )}
                  </td>
                  <td className="is-sn">
                    <NavIcon name="check" className="mk-sn-yes" />
                    <span className="sr-only">Yes</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      </div>
    </section>
  );
}

/* ------------------------------------------------- 3. one note per person */

export function Notes() {
  return (
    <section className="mk-notes">
      <div className="container mk-notes-grid">
        <div className="mk-notes-panel">
          <Reveal>
            <div className="mk-notes-copy">
              <h2 className="mk-h2">One note per person, not one template for everyone.</h2>
              <p className="mk-lede">
                Each invitation is written from that person&rsquo;s own headline, role and company.
              </p>
              <ul className="mk-notes-facts">
                <li>
                  <NavIcon name="posts" className="mk-icon" />
                  <span>Up to {INVITE_NOTE_MAX_CHARS} characters each</span>
                </li>
                <li>
                  <NavIcon name="shield" className="mk-icon" />
                  <span>No link and no pitch in a connection request</span>
                </li>
                <li>
                  <NavIcon name="profile" className="mk-icon" />
                  <span>You read every one before launch</span>
                </li>
                <li>
                  <NavIcon name="clock" className="mk-icon" />
                  <span>
                    On a free LinkedIn account, notes on {FREE_NOTES_PER_MONTH} invitations a month, LinkedIn&rsquo;s
                    limit. After that invitations still go, without a note.
                  </span>
                </li>
              </ul>
            </div>
          </Reveal>
        </div>

        <div className="mk-deck-wrap">
          <ul className="mk-deck">
            {EXAMPLE_NOTES.map(({ person, note, grounding }) => (
              <li key={person.name} className="mk-note">
                <Image
                  src={person.photo}
                  alt={`Example prospect ${person.name}`}
                  width={112}
                  height={112}
                  className="mk-note-photo"
                />
                <div className="mk-note-body">
                  <div>
                    <p className="mk-note-name">{person.name}</p>
                    <p className="mk-note-role">
                      {person.role}, {person.company}
                    </p>
                  </div>
                  <p className="mk-note-text">{note}</p>
                </div>
                <p className="mk-note-ground">
                  <span>Written from:</span>
                  {grounding.map((field) => (
                    <span key={field} className="mk-ground">
                      {field}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
          <p className="mk-caption">
            Example people. Your campaign shows its real notes on the review screen before launch.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- 4. safety */

/** What a fully warmed account would send in a five-day week with no weekly cap. */
const UNCAPPED_WEEK = LINKEDIN_LIMITS.invitesPerDayMax * 5;

export function SafetyBento() {
  return (
    <section className="mk-section" id="safety">
      <div className="container mk-stack">
        <Reveal>
          <header className="mk-head">
            <h2 className="mk-h2">Built so your account is not the price.</h2>
            <p className="mk-lede">
              LinkedIn watches for bursts. {BRAND.name} ramps up from your first send and spreads each
              day across your working hours.
            </p>
          </header>
        </Reveal>

        <div className="mk-bento">
          <figure className="mk-tile mk-tile-ramp">
            <figcaption className="mk-tile-head">
              <NavIcon name="shield" className="mk-tile-icon" />
              <div>
                <h3 className="mk-tile-title">Warm-up from your first send</h3>
                <p className="mk-tile-sub">
                  {LINKEDIN_LIMITS.invitesPerDayStart} a day at first, {SUSTAINED_INVITES_PER_DAY} a day after{" "}
                  {WEEKS_TO_SUSTAINED} weeks, never more than {LINKEDIN_LIMITS.invitesPerWeek} a week
                </p>
              </div>
            </figcaption>
            <RampChart />
            <Link href="/linkedin-automation-limits" className="mk-textlink small">
              How the LinkedIn limits work <span aria-hidden="true">→</span>
            </Link>
          </figure>

          <figure className="mk-tile mk-tile-day">
            <figcaption className="mk-tile-head">
              <NavIcon name="clock" className="mk-tile-icon" />
              <div>
                <h3 className="mk-tile-title">Spread across your day</h3>
                <p className="mk-tile-sub">
                  {EXAMPLE_DAY.times.length} invitations, {EXAMPLE_DAY.start} to {EXAMPLE_DAY.end}
                </p>
              </div>
            </figcaption>
            <ol className="mk-day">
              {EXAMPLE_DAY.times.map((time, index) => (
                <li key={time}>
                  <span className="mk-num">{time}</span>
                  <span className="mk-day-dot" aria-hidden="true" />
                  <span className="mk-muted">Invitation {index + 1}</span>
                </li>
              ))}
            </ol>
          </figure>

          <div className="mk-tile mk-tile-never">
            <NavIcon name="shield" className="mk-tile-icon" />
            <div>
              <h3 className="mk-tile-title">Never twice.</h3>
              <p>Once someone has been contacted, no campaign contacts them again.</p>
            </div>
          </div>

          <div className="mk-tile mk-tile-week">
            <div className="mk-tile-head">
              <NavIcon name="shield" className="mk-tile-icon" />
              <h3 className="mk-tile-title">Weekly ceiling</h3>
            </div>
            <p className="mk-big mk-num">{LINKEDIN_LIMITS.invitesPerWeek}</p>
            <div className="mk-meter">
              <div className="mk-meter-row">
                <span>Invitations a week</span>
                <span className="mk-num">
                  {LINKEDIN_LIMITS.invitesPerWeek} of a possible {UNCAPPED_WEEK}
                </span>
              </div>
              <span className="mk-meter-track is-tall" aria-hidden="true">
                <span className="mk-meter-fill" style={fill(LINKEDIN_LIMITS.invitesPerWeek, UNCAPPED_WEEK)} />
              </span>
            </div>
            <p className="mk-tile-sub">
              {LINKEDIN_LIMITS.invitesPerDayMax} a day for five days would be {UNCAPPED_WEEK}. The week
              stops at {LINKEDIN_LIMITS.invitesPerWeek}, shared by every campaign on the account.
            </p>
          </div>
        </div>

        <p className="mk-trust">
          No customer logos yet, and no borrowed ones. We publish the limits we enforce and no
          results we have not measured.{" "}
          <Link href="/about" className="mk-textlink small">
            Why we built it this way <span aria-hidden="true">→</span>
          </Link>
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------ 5. replies and meetings */

const FACTS = [
  {
    icon: "shield",
    title: "Opt-outs stop everything",
    body: "Somebody who asks to be removed is never written to again, checked against a fixed phrase list as well as by the model.",
  },
  {
    icon: "support",
    title: "Pricing and legal can wait for you",
    body: "By default those questions are held for you. Switch to autopilot and it answers from the facts you gave it.",
  },
  {
    icon: "meetings",
    title: "Times come from your calendar",
    body: `${BRAND.name} picks from the free slots your calendar gives it and never writes a time of its own.`,
  },
] as const;

export function Replies() {
  const meeting = BOOKED_SLOT ? meetingLines(BOOKED_SLOT) : null;
  const maya = PEOPLE.maya;

  return (
    <section className="mk-section">
      <div className="container mk-stack">
        <Reveal>
          <h2 className="mk-h2">
            <span className="mk-line">Replies drafted for you.</span>{" "}
            <span className="mk-line">Meetings booked for you.</span>
          </h2>
        </Reveal>

        <div className="mk-convo">
          <div className="mk-thread">
            <div className="mk-msg">
              <Image src={maya.photo} alt={`Example prospect ${maya.name}`} width={44} height={44} className="mk-avatar" />
              <div className="mk-msg-body">
                <p className="mk-msg-who">
                  {maya.name} <span className="mk-muted mk-num">{twelveHour(9, 41)}</span>
                </p>
                <p className="mk-bubble">This is timely. Could we find half an hour next week?</p>
              </div>
            </div>

            <div className="mk-msg">
              <span className="mk-avatar mk-avatar-mark" aria-hidden="true">
                <LogoMark size={28} />
              </span>
              <div className="mk-msg-body">
                <p className="mk-msg-who">{BRAND.name}</p>
                <div className="mk-draft">
                  <p className="mk-draft-label">
                    Drafted by {BRAND.name}. Sends when you approve, or by itself on autopilot.
                  </p>
                  <p>Glad it landed, Maya. Here are three times that work on my side ({SLOT_TZ_LABEL}):</p>
                  <ul className="mk-slots" aria-label="Times offered">
                    {EXAMPLE_SLOTS.map((slot) => (
                      <li key={slot} className={slot === BOOKED_SLOT ? "is-picked" : undefined}>
                        <span className="mk-num">{slotLabel(slot)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="mk-msg">
              <Image src={maya.photo} alt="" width={44} height={44} className="mk-avatar" />
              <div className="mk-msg-body">
                <p className="mk-msg-who">{maya.name}</p>
                <p className="mk-bubble">{BOOKED_DAY_NAME} works. Talk then.</p>
              </div>
            </div>
          </div>

          <span className="mk-convo-arrow" aria-hidden="true">→</span>

          <div className="mk-meeting">
            <div className="mk-meeting-head">
              <NavIcon name="meetings" className="mk-tile-icon is-accent" />
              <span className="mk-tile-title">Your calendar</span>
              <span className="pill positive">Booked</span>
            </div>
            <p className="mk-meeting-title">Intro call with {maya.name}</p>
            {meeting ? (
              <ul className="mk-meeting-rows">
                <li>
                  <NavIcon name="meetings" className="mk-icon" />
                  <span>{meeting.day}</span>
                </li>
                <li>
                  <NavIcon name="clock" className="mk-icon" />
                  <span className="mk-num">{meeting.time}</span>
                </li>
                <li>
                  <NavIcon name="profile" className="mk-icon" />
                  <span>
                    {maya.name}, {maya.company}
                  </span>
                </li>
                <li>
                  <NavIcon name="strategies" className="mk-icon" />
                  <span>Matched against a time that was offered</span>
                </li>
              </ul>
            ) : null}
          </div>

          <p className="mk-caption mk-convo-caption">Example conversation.</p>
        </div>

        <ul className="mk-facts">
          {FACTS.map((fact) => (
            <li key={fact.title}>
              <span className="mk-fact-icon">
                <NavIcon name={fact.icon} className="mk-icon" />
              </span>
              <div>
                <h3>{fact.title}</h3>
                <p>{fact.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
