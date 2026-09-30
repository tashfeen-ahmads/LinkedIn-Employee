import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { AppNav, type NavGroup } from "@/components/app-nav";
import { AppSearch } from "@/components/app-search";
import { NavIcon } from "@/components/icons";
import { BRAND } from "@le/shared";
import { BRAND_QUALIFIER, LogoMark } from "@/components/logo";
import { readSetupState } from "@/lib/setup-state";
import { markFor, type NavMarks } from "@/lib/nav-marks";
import { loadNeedsYou } from "@/lib/needs-you-data";
import { entitlementFor, entitlementMessage } from "@le/billing";
import { isPlatformAdmin } from "@/lib/admin";

/**
 * Twelve links in one flat list is a list you read rather than a nav you use.
 * Grouped by what the rep is doing: the daily loop first, then the things that
 * shape it, then the account.
 */
function navGroups(waiting: number, marks: NavMarks): NavGroup[] {
  // One mark, decided in one place (`markFor`) so the rule is testable rather
  // than a convention three call sites happen to keep.
  const next = (href: string, label: string) => markFor(href, label, marks);

  /*
   * Grouped by what a person is doing, not by what the tables are called.
   *
   * Twelve flat links meant every screen had the same weight: the inbox a rep
   * opens hourly sat beside the billing page they touch twice a year. The
   * groups are the map now — four headings to read instead of twelve links,
   * and everything but the daily loop folds away.
   *
   * Work is `alwaysOpen`: a remembered collapse that hides the Inbox is a rep
   * who stops opening the Inbox.
   */
  return [
    /*
     * The daily loop, and nothing else in it.
     *
     * Three screens are the product: the overview answers what needs you, the
     * inbox holds the conversations, and campaigns is where sending is watched
     * and launched. Everything a rep touches on an ordinary Tuesday is here and
     * everything else folds away — which is what a map is for. `alwaysOpen`
     * because a remembered collapse that hides the Inbox is a rep who stops
     * opening the Inbox.
     */
    {
      label: "Work",
      alwaysOpen: true,
      items: [
        { href: "/app", label: "Overview", icon: "overview" },
        { href: "/app/inbox", label: "Inbox", icon: "inbox", count: waiting },
        { href: "/app/campaigns", label: "Campaigns", icon: "campaigns", ...next("/app/campaigns", "Campaigns") },
      ],
    },
    /*
     * Visited while setting up, and then roughly never.
     *
     * These were in the daily path and they are not daily work: a strategy is
     * approved once, an agent is written once, a destination is named once.
     * Sitting beside the Inbox they made twelve links of equal weight, which is
     * a list to read rather than a nav to use — and the next-step mark had to
     * compete with all of them.
     */
    {
      label: "Setup",
      items: [
        { href: "/app/strategy", label: "Strategies", icon: "strategies", ...next("/app/strategy", "Strategies") },
        { href: "/app/agents", label: "Agents", icon: "agents", ...next("/app/agents", "Agents") },
        { href: "/app/cta", label: "Calls to action", icon: "cta" },
        { href: "/app/exclusions", label: "Do not contact", icon: "exclusions" },
        { href: "/app/profile", label: "Profile & team", icon: "profile", ...next("/app/profile", "Profile & team") },
      ],
    },
    /*
     * Reachable, off the daily path. `/app/system` in particular should stop
     * being a place anybody goes: its failures surface into the overview's
     * list, because repair must never wait for somebody to find a screen
     * (rule 8).
     */
    {
      label: "More",
      items: [
        { href: "/app/prospects", label: "Prospects", icon: "prospects" },
        { href: "/app/meetings", label: "Meetings", icon: "meetings" },
        // Off the daily path deliberately. It is the one thing this product
        // publishes that nobody is waiting for, and a post that waits a day
        // has lost nothing — which is the whole argument for its approval gate.
        { href: "/app/posts", label: "Profile posts", icon: "posts" },
        { href: "/app/tutorial", label: "How it works", icon: "tutorial" },
        { href: "/app/system", label: "System check", icon: "system" },
        { href: "/app/support", label: "Support", icon: "support" },
      ],
    },
  ];
}

/**
 * Two letters for the avatar, from whatever name we actually have.
 *
 * An email falls back to the part before the @, and a single word to its first
 * letter — never an empty circle, which reads as a photograph that failed to
 * load rather than as somebody who has not uploaded one.
 */
function initials(name: string): string {
  const source = name.includes("@") ? name.split("@")[0]! : name;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]!).join("");
  return (letters || source[0] || "?").toUpperCase();
}

/**
 * There was no way to sign out of this application at all. On a shared or
 * borrowed machine that is not an inconvenience, it is the session staying open
 * for whoever sits down next — and this one can message a rep's real contacts.
 */
async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const supabase = await createClient();
  // Whether to offer the operator console at all. False on error, because
  // the privilege is what is being asked about (rule 54).
  const admin = await isPlatformAdmin();

  /*
   * The count that decides whether a rep opens the app, so it lives in the nav
   * rather than behind a click — and it is now the same reading the overview
   * shows.
   *
   * It used to count `reply_drafts` with `status = "pending"`, which is not what
   * the inbox lists. Rule 10 says a conversation can be flagged with no draft at
   * all: those appeared in the inbox and were counted here by nothing, so the
   * badge read 0 while a real prospect sat waiting. The reverse happened too — a
   * draft left pending on a conversation whose hold had been cleared was counted
   * and appeared nowhere.
   */
  const { facts: needs } = await loadNeedsYou(supabase, session.workspaceId);
  const waiting = needs.heldReplies + needs.heldBookings + needs.heldForCopy;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("plan, trial_ends_at, subscription_status, seats")
    .eq("id", session.workspaceId)
    .single();

  const entitlement = entitlementFor({
    plan: (workspace?.plan ?? "trial") as never,
    trialEndsAt: workspace?.trial_ends_at ?? null,
    subscriptionStatus: workspace?.subscription_status ?? null,
    seats: workspace?.seats ?? 1,
  });
  const billingMessage = entitlementMessage(entitlement);

  const { data: account } = await supabase
    .from("linkedin_accounts")
    .select("status, status_detail")
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .maybeSingle();

  // Where this workspace has got to, read once here and handed to the nav. The
  // dashboard reads the same function, so the sidebar and the page can never
  // disagree about which step somebody is on.
  const { next } = await readSetupState(supabase, session.workspaceId);
  const linkedInNeedsYou = !account || account.status !== "active";

  return (
    <div className="app">
      <aside className="app-aside">
        {/*
          The funnel mark, which the marketing header and the browser tab have
          carried since the first week and the application's own rail did not.
          A product whose every other surface shows a logo and whose main screen
          shows a line of text reads as two different products — and the rail is
          the one surface a customer looks at every day.

          `LogoMark` rather than a second drawing of it: one definition, so the
          tab, the site header and the rail cannot drift apart.
        */}
        <div className="app-brand">
          <Link href="/app" className="app-brand-name">
            <LogoMark size={22} />
            {/*
              Rendered from BRAND, not typed out. This span kept the old name
              for a full release after the rename: it was written with a
              non-breaking entity between the two words, and the check meant to
              ban that name was looking for a plain space.
            */}
            <span>
              {BRAND.name}
              {BRAND_QUALIFIER ? <span className="wordmark-thin">&nbsp;{BRAND_QUALIFIER}</span> : null}
            </span>
          </Link>
          <p className="tiny subtle">{session.workspaceName}</p>
        </div>

        <AppNav
          groups={navGroups(waiting, {
            nextHref: next?.href ?? null,
            linkedInNeedsYou,
          })}
        />

        {/*
          The trial, where a person looks for it.

          `entitlementMessage` already computed this and the only place it
          showed was a banner across the top of every page — which is the right
          shape for something broken and the wrong one for a clock running
          down. In the rail it is present without interrupting, and it carries
          the one action it implies.
        */}
        {entitlement.trialDaysLeft !== null ? (
          <div className="app-upsell">
            <p className="tiny subtle">Trial</p>
            <p className="small strongish">
              {entitlement.trialDaysLeft > 0
                ? `${entitlement.trialDaysLeft} ${entitlement.trialDaysLeft === 1 ? "day" : "days"} left`
                : "Last day"}
            </p>
            <Link className="btn small block" href="/app/billing">
              Choose a plan
            </Link>
          </div>
        ) : null}

        <form action={signOut} className="app-signout">
          <button className="btn ghost small" type="submit">
            Sign out
          </button>
        </form>
      </aside>

      <div className="app-main">
        {/*
          The bar the application was missing.

          Everything that is about *you* rather than about the page — who is
          signed in, what is waiting, the search — was crammed into the bottom
          of a 240px rail or into the nav itself. It belongs across the top,
          where every application a rep already uses puts it, and moving it
          there gives the rail back to the twelve places they can go.
        */}
        <header className="app-top">
          {/*
            The bar spans the frame; its contents keep the page's measure.

            Written without this wrapper the bar had its own padding, so the
            search box started fifty pixels left of the page title directly
            under it — on every screen in the product. That is the same fault
            the banners had, reintroduced by the same shortcut: a full-bleed
            surface has to carry the background and the rule, and the column
            inside it has to carry the measure.
          */}
          <div className="app-top-inner">
            <AppSearch />
            <div className="app-top-actions">
            <Link
              className="app-top-icon"
              href="/app/inbox"
              aria-label={waiting ? `Inbox, ${waiting} waiting` : "Inbox"}
            >
              <NavIcon name="inbox" className="nav-icon" />
              {waiting ? <span className="app-top-count">{waiting}</span> : null}
            </Link>
            <Link className="app-top-icon" href="/app/support" aria-label="Support">
              <NavIcon name="support" className="nav-icon" />
            </Link>
            {/*
              The way into the operator console, for the people who have one.

              There was no link at all: an admin had to know the URL and type
              it. That is rule 8 — repair must never depend on somebody finding
              a button, and it certainly must not depend on them remembering a
              path that nothing in the product links to.

              Rendered from isPlatformAdmin, which returns false when the check
              itself fails: the privilege is the thing being asked about, so a
              failed check falls to the smaller answer (rule 54). This is a
              link and not a permission — /admin re-checks on every page it
              serves, because a control that is merely hidden is not a control.
            */}
            {admin ? (
              <Link className="app-top-icon" href="/admin" aria-label="Operator console">
                <NavIcon name="shield" className="nav-icon" />
              </Link>
            ) : null}
            <Link className="app-top-who" href="/app/profile">
              {/* Initials rather than a photograph: this product has never
                  asked anybody for one, and a grey silhouette is worse than
                  a letter. */}
              <span className="app-avatar" aria-hidden="true">
                {initials(session.fullName ?? session.email)}
              </span>
              <span className="app-top-who-text">
                <span className="small strongish">{session.fullName ?? session.email}</span>
                <span className="tiny subtle">{session.workspaceName}</span>
              </span>
              </Link>
            </div>
          </div>
        </header>

        {billingMessage || (account && account.status !== "active") ? (
          <div className="app-banners">
            {billingMessage ? (
              <div className={`notice ${entitlement.canSend ? "warning" : "danger"}`}>
                <p>
                  {billingMessage} <Link href="/app/billing">Billing</Link>
                </p>
              </div>
            ) : null}
            {account && account.status !== "active" ? (
              <div className={`notice ${account.status === "restricted" ? "danger" : "warning"}`}>
                <p>
                  <strong>LinkedIn account {account.status.replaceAll("_", " ")}.</strong>{" "}
                  {account.status_detail ?? "Sending is paused until this is resolved."}{" "}
                  {/*
                    Profile, not Team, and the difference is the whole bug.
                    `connectLinkedIn` lives on `/app/profile` and nowhere else;
                    `/app/team` is who can sign in to the workspace and has no
                    connect control on it at all — its own lede says "each rep
                    connects their own LinkedIn account on their own profile".
                    So the one banner telling somebody their account cannot send
                    sent them to a page with nothing to press, every time, and
                    the product looked like it had no way to reconnect.
                  */}
                  <Link href="/app/profile">Reconnect on your profile</Link>
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <main className="app-body">{children}</main>
      </div>
    </div>
  );
}
