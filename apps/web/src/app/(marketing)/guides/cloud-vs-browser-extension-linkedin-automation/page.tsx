import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";
import { LINKEDIN_LIMITS } from "@le/shared";
import { backOff, classifyProviderError } from "@le/linkedin";

const PATH = "/guides/cloud-vs-browser-extension-linkedin-automation";

export const metadata: Metadata = articleMeta(PATH);

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const THROTTLE = classifyProviderError("errors/cannot_resend_yet");
const FIRST_COOLDOWN_H = Math.round((THROTTLE.kind === "retry_later" ? THROTTLE.cooldownMs : 0) / HOUR_MS);
const LONGEST_COOLDOWN_H = Math.round(
  backOff(THROTTLE.kind === "retry_later" ? THROTTLE.cooldownMs : 0, Number.MAX_SAFE_INTEGER) / HOUR_MS,
);
const MIN_GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / MINUTE_MS);

const FAQ: readonly Faq[] = [
  {
    q: "Are Chrome extensions safe for LinkedIn automation?",
    a: "No automation is safe in the sense of risk-free, because LinkedIn's terms prohibit it. Extensions carry one risk of their own: as of 2026 LinkedIn's site is reported to check visitors' browsers for thousands of installed extensions, and LinkedIn confirmed it scans for them. A careful, low-volume extension user may still be at less risk than a cloud user sending at full volume. Behaviour decides most of it.",
  },
  {
    q: "Can LinkedIn detect cloud-based automation?",
    a: "LinkedIn does not say how it detects automation, so nobody outside it can answer precisely. A cloud tool leaves no extension to find, but the session is used from a server rather than your laptop, often at hours you are not at your desk, and the account's sending pattern is visible whatever runs it. Treat claims that cloud tools are undetectable as marketing.",
  },
  {
    q: "Does LinkedIn scan browser extensions?",
    a: "Yes. In April 2026 BleepingComputer reported a script on LinkedIn's site that checks for 6,236 extensions by probing for files belonging to each one, and collects device details such as screen resolution and time zone. LinkedIn confirmed it scans for extensions to find people breaking its terms, and called the wider claims in the report that prompted the coverage wrong.",
  },
  {
    q: "Which is better for a team of one?",
    a: "Usually a cloud tool, if you want outreach to run across the working day while you do your actual job, because an extension only works while your browser is open. Choose by safeguards rather than architecture: published caps, a ramp from the first send, a day spread out rather than sent in a burst, and a hard stop when LinkedIn refuses.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Automated activity on LinkedIn (prohibited software and extensions)", url: "https://www.linkedin.com/help/linkedin/answer/90586" },
  { label: "BleepingComputer: LinkedIn secretly scans for 6,000+ Chrome extensions, collects data (3 April 2026)", url: "https://www.bleepingcomputer.com/news/security/linkedin-secretely-scans-for-6-000-plus-chrome-extensions-collects-data" },
  { label: "Tom's Hardware: LinkedIn scans visitors' browsers for over 6,000 Chrome extensions", url: "https://www.tomshardware.com/software/browsers/linkedin-scans-visitors-browsers-for-over-6000-chrome-extensions-and-collects-device-data" },
  { label: "Tom's Guide: what LinkedIn says about scanning browser extensions", url: "https://www.tomsguide.com/computing/online-security/linkedin-reportedly-extracting-the-customer-lists-of-thousands-of-software-companies-from-their-users-browsers-and-its-not-asking-for-permission" },
  { label: "Computing: LinkedIn accused of covert data collection in BrowserGate report", url: "https://computing.co.uk/news/2026/security/linkedin-accused-of-covert-data-collection-in-browsergate-report" },
  { label: "Konnector: Chrome extension vs cloud-based LinkedIn automation (a cloud vendor, studied for this page)", url: "https://konnector.ai/chrome-extension-vs-cloud-based-linkedin-automation/" },
  { label: "Dripify: cloud vs extension (a cloud vendor, studied for this page)", url: "https://dripify.com/?p=28026" },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="Cloud vs browser extension LinkedIn automation: which is safer?"
      lede="Neither cloud nor Chrome-extension LinkedIn automation is safe by design: an extension runs in your own browser, where LinkedIn has confirmed it scans for installed extensions, while a cloud tool runs your session on a server, which removes that risk and adds trust in the vendor. What decides whether an account gets restricted is behaviour (volume, pace, acceptance and what happens after a refusal), not where the software runs."
      faq={FAQ}
      sources={SOURCES}
    >
      <p>In short:</p>
      <ul>
        <li>
          <strong>Extension:</strong> cheap, simple, works only while your browser is open, and visible to LinkedIn&apos;s
          extension check.
        </li>
        <li>
          <strong>Cloud:</strong> runs on a schedule with your laptop shut, nothing to detect in your browser, and you trust a
          vendor with your session.
        </li>
        <li>
          <strong>Both:</strong> against LinkedIn&apos;s terms, and both get accounts restricted when they send too much, too fast,
          to people who do not accept.
        </li>
      </ul>
      <p>
        The pages that rank for this question are mostly written by vendors arguing for their own architecture, and they
        disagree with each other, and the risk percentages some of them quote come with no published method behind them. We run
        in the cloud ourselves, so weigh this page the same way, and check what we say
        against the sources at the end.
      </p>

      <h2 id="architectures">Cloud vs Chrome extension LinkedIn automation: the two architectures in plain words</h2>
      <p>
        A <strong>browser extension</strong> is installed in Chrome and acts on the LinkedIn tab you have open, using the
        session you are already signed in with. Actions come from your own computer and internet connection. It works while the
        browser is running, and many need a LinkedIn tab left open. A <strong>desktop app</strong> is a close cousin: it runs its
        own browser on your machine, so it is not an extension in your everyday Chrome, but it still only works while the app is
        running.
      </p>
      <p>
        A <strong>cloud tool</strong> holds a LinkedIn session on a server and sends from there, on a schedule, whether your
        computer is on or not. How it gets that session matters: some ask for your password, others have you sign in on a hosted
        page so the tool never sees it. Many vendors say they route each account through a fixed address in its own country so
        the location stays steady; that is a sensible precaution, and most of what is published about it comes from vendors.
      </p>
      <CompareTable
        caption="Browser extension, desktop app and cloud LinkedIn automation compared"
        columns={["Browser extension", "Desktop app", "Cloud"]}
        rows={[
          { label: "Where it runs", values: ["Inside your Chrome", "An app on your computer", "The vendor's servers"] },
          { label: "Computer must be on", values: ["Yes, with the browser open", "Yes, with the app running", "No"] },
          { label: "Sends from", values: ["Your own connection", "Your own connection", "A server, often with a fixed address per account"] },
          {
            label: "What you hand over",
            values: ["Broad access to the pages you visit", "Software running on your machine", "A LinkedIn session, and sometimes a password"],
          },
          {
            label: "Typical failure",
            values: [
              "Stops when the laptop sleeps; breaks on browser updates",
              "Stops when the app closes; you maintain it",
              "Keeps sending overnight if limits are set badly",
            ],
          },
        ]}
      />

      <h2 id="what-linkedin-sees">What LinkedIn can see from each</h2>
      <p>
        LinkedIn&apos;s help center says it does not allow third-party software, including bots, browser plug-ins and extensions,
        that scrapes, changes the appearance of, or automates activity on its site. The rule names extensions and covers
        everything else too. What differs is the trail each leaves.
      </p>

      <h3 id="extensions-in-page">Extensions in the page</h3>
      <p>
        An extension that acts on LinkedIn has to be present in the browser that loads LinkedIn&apos;s pages, which means those
        pages can look for it. If an automation extension is installed in the browser you use LinkedIn with, assume LinkedIn can
        tell. Desktop apps avoid that particular check, but not anything else on this list.
      </p>

      <h3 id="cloud-sessions">Cloud sessions and IPs</h3>
      <p>
        A cloud tool leaves nothing in your browser. Instead, the session is used from somewhere other than your laptop, possibly
        at the same moment you are browsing LinkedIn on your phone, and activity happens whether you are at your desk or not.
        Fixed addresses in the right country reduce the location mismatch; they do not make the session look like your laptop.
        Ask any cloud vendor whether two of its customers ever share an address.
      </p>

      <h3 id="scanning-2026">The 2026 extension-scanning reports</h3>
      <p>
        On 3 April 2026 BleepingComputer reported on a document called BrowserGate, published by Fairlinked, a group describing
        itself as an association of commercial LinkedIn users. BleepingComputer tested the claim and found a script on
        LinkedIn&apos;s site that checks for 6,236 browser extensions by trying to load files belonging to each one, and collects
        device details such as screen resolution, time zone and memory. LinkedIn confirmed that it scans for extensions, said it
        does so to find people breaking its terms, and called other claims in the report wrong.
      </p>
      <p>
        The wider allegations, about what the data is used for and whom LinkedIn targets, are disputed and we do not repeat them
        as fact. Researchers have traced earlier, much shorter versions of the list back years. The narrow, undisputed point is
        the one that matters for choosing a tool: LinkedIn can see installed extensions and says it looks for ones that break its
        rules.
      </p>

      <h2 id="reliability">Reliability and control</h2>
      <ul>
        <li>
          <strong>Uptime.</strong> An extension stops when the laptop sleeps, the tab closes or Chrome updates. That is sometimes a
          safety feature by accident: it cannot send at three in the morning. A cloud tool keeps its schedule, which is only as
          good as the schedule. It needs working hours, a time zone and a daily spread, or it will happily send all night.
        </li>
        <li>
          <strong>Visibility.</strong> With an extension you can watch it work. With a cloud tool you depend on its screens to tell
          you what it did and why it stopped. Ask to see what the tool shows when LinkedIn refuses an invitation.
        </li>
        <li>
          <strong>Access.</strong> An extension can read the pages you visit. A cloud tool holds a session that can act as you.
          Both are real trust decisions; ask how access is revoked.
        </li>
        <li>
          <strong>Multiple devices.</strong> A cloud tool and an extension on the same account are two senders each counting only
          their own actions. Never run both, or two of either.
        </li>
      </ul>

      <h2 id="behaviour">Why behaviour beats architecture</h2>
      <p>
        LinkedIn&apos;s own published reasons for restricting invitations say nothing about architecture. They are many invitations
        in a short time, many invitations ignored, left pending or marked as spam, and suspected use of automation tools. The first
        two are entirely about behaviour, and they are visible whatever the software.
      </p>
      <p>
        Our own first live account is the example. It was cloud-run, with nothing in anybody&apos;s browser, and it still sent seven
        invitations in 27 minutes on its first day because nothing spread the day&apos;s allowance out. LinkedIn throttled its
        invitations for days. The architecture was the &quot;safe&quot; one; the behaviour was not. What fixed it was pacing: a
        day&apos;s allowance divided across the working hours left, with at least {MIN_GAP_MIN} minutes between any two actions.
      </p>
      <Callout tone="safety">
        <p>
          <strong>The questions that matter more than cloud or extension:</strong> are the caps published and below the reported
          ceilings? Does the ramp start at the first send? Is the day spread out? What happens on the first &quot;try again
          later&quot;? Is acceptance rate watched? Our guide to{" "}
          <Link href="/guides/is-linkedin-automation-safe">whether LinkedIn automation is safe</Link> has a full checklist, and{" "}
          <Link href="/guides/safest-linkedin-automation-tool">eight checks for the safest LinkedIn automation tool</Link> applies
          them to the main tools.
        </p>
      </Callout>

      <h2 id="decision-guide">A short decision guide</h2>
      <CompareTable
        caption="Which kind of LinkedIn automation suits which situation"
        columns={["Better fit", "Why"]}
        rows={[
          { label: "A few requests a day, sent while you watch", values: ["Extension or desktop app", "Cheap, and you see every action. Accept that LinkedIn may see the extension."] },
          { label: "Outreach running across the working day while you work", values: ["Cloud", "It keeps a schedule without a laptop awake, if the schedule is good."] },
          { label: "Several reps, one view of who was contacted", values: ["Cloud", "One shared record makes it possible to never contact a person twice."] },
          { label: "You cannot afford any restriction at all", values: ["Neither", "Send by hand. No architecture removes the risk."] },
          { label: "A tool that will not publish its caps", values: ["Neither", "Architecture cannot make up for limits you are not allowed to see."] },
        ]}
      />
      <p>
        If you are comparing AI SDRs rather than plain sequence tools, the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to the best AI SDR tools</Link> covers the questions that go beyond
        architecture.
      </p>

      <h2 id="nora">Where Nora sits</h2>
      <p>
        Nora is a cloud tool, so take our view of the trade-off with that in mind. You connect LinkedIn on a hosted sign-in page,
        so we never see your password, and nothing is installed in your browser. Every account starts at{" "}
        {PUBLIC_LIMITS.invitesPerDayStart} invitations a day, ramps to at most {PUBLIC_LIMITS.invitesPerDayMax} over{" "}
        {PUBLIC_LIMITS.warmupWeeks} weeks from its first send, never passes {PUBLIC_LIMITS.invitesPerWeek} a week, and has each
        day spread across your working hours. A &quot;try again later&quot; from LinkedIn stops invitations for{" "}
        {FIRST_COOLDOWN_H} hours, doubling up to {LONGEST_COOLDOWN_H}, and a warning or restriction pauses the account. The{" "}
        <Link href="/security">security page</Link> covers where your data sits, <Link href="/how-it-works">how Nora works</Link>{" "}
        covers the rest, and more guides are in the <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
      <Callout tone="info">
        <p>
          Nothing to install, and nothing sent until you approve and launch. <a href={`${SITE.app}/signup`}>Sign up free</a>.
        </p>
      </Callout>
    </ArticleLayout>
  );
}
