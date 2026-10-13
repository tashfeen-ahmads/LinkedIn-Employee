import Image from "next/image";
import Link from "next/link";
import { BRAND, DEFAULT_WORKING_HOURS, INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { SITE } from "@/lib/site";
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
  EXAMPLE_TODAY,
  PEOPLE,
  SLOT_TZ_LABEL,
  meetingLines,
  slotLabel,
  twelveHour,
} from "@/lib/marketing-examples";
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
          <h1 className="mk-display">
            <span className="mk-line">The AI SDR for LinkedIn</span>{" "}
            <span className="mk-line">built around account safety.</span>
          </h1>
          <p className="mk-hero-sub">
            {BRAND.name} finds the right people, writes each one a note, drafts your replies and books
            the call, all inside daily limits.
          </p>
          <div className="mk-actions">
            <Link href={SIGNUP} className="btn large">
              Sign up free
            </Link>
            <Link href="/how-it-works" className="mk-textlink">
              See how it works <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <TodayPanel />
      </div>
    </section>
  );
}

/**
 * One account's day, as the product would show it. The allowance is the ramp's
 * own value for the example day, the next send is where the spread placed it,
 * and the people are labelled as examples.
 */
function TodayPanel() {
  return (
    <figure className="mk-today" aria-label="Example: one account's sending day">
      <div className="mk-today-head">
        <p className="mk-today-title">Today</p>
        <p className="mk-today-tag">Example account, day {EXAMPLE_DAY_NUMBER} of sending</p>
      </div>

      <div className="mk-meters">
        <Meter label="Invitations" value={EXAMPLE_SENT} of={EXAMPLE_DAY_CAP} />
        <Meter label="Messages" value={EXAMPLE_MESSAGES} of={LINKEDIN_LIMITS.messagesPerDay} />
      </div>

      <ul className="mk-today-list">
        {EXAMPLE_TODAY.map(({ person, opener }) => (
          <li key={person.name} className="mk-today-row">
            <Image
              src={person.photo}
              alt={`Example prospect ${person.name}`}
              width={44}
              height={44}
              priority
              className="mk-avatar"
            />
            <div className="mk-today-who">
              <p className="mk-today-name">{person.name}</p>
              <p className="mk-today-role">
                {person.role}, {person.company}
              </p>
              <p className="mk-today-note">Note: {opener}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mk-today-foot">
        <NavIcon name="clock" className="mk-icon" />
        <span>
          Next invitation at <strong className="mk-num">{EXAMPLE_NEXT}</strong>, inside your hours
        </span>
      </p>
    </figure>
  );
}

function Meter({ label, value, of }: { label: string; value: number; of: number }) {
  return (
    <div className="mk-meter">
      <div className="mk-meter-row">
        <span>{label}</span>
        <span className="mk-num">
          {value} of {of}
        </span>
      </div>
      <span className="mk-meter-track" aria-hidden="true">
        <span className="mk-meter-fill" style={fill(value, of)} />
      </span>
    </div>
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
              <p className="mk-decide-note">You approve the opener and the offer, line by line.</p>
            </li>

            <li className="mk-decide-card">
              <span className="mk-step-n" aria-hidden="true">3</span>
              <h3>Press Launch</h3>
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
                </dl>
                <span className="mk-fakebtn">Launch</span>
              </div>
              <p className="mk-decide-note">Nothing sends until you press it, then only inside your hours.</p>
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
                  Daily invitation cap, {LINKEDIN_LIMITS.invitesPerDayStart} rising to{" "}
                  {LINKEDIN_LIMITS.invitesPerDayMax} over {LINKEDIN_LIMITS.warmupDays} days
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
