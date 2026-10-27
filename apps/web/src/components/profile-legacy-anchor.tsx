"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { legacyAnchorTarget } from "@/app/app/profile/sections";

/**
 * Sends an old one-page profile link to the section it meant.
 *
 * `/app/profile#billing` is in the trial banner, in billing emails already
 * sent and in people's history. The fragment never reaches the server, so it
 * is read here, on arrival and on every move inside the profile, and the
 * query string (`?error=`, `?notice=`, `?checkout=`) goes with the person
 * rather than being said on a section they did not ask for.
 */
export function ProfileLegacyAnchor() {
  const router = useRouter();
  // The layout holding this stays mounted while somebody moves between
  // sections, so it looks again whenever the path or the fragment changes.
  const current = usePathname();
  useEffect(() => {
    const follow = () => {
      const { pathname, search, hash } = window.location;
      if (!hash) return;
      const target = legacyAnchorTarget(pathname, hash);
      if (target) router.replace(`${target}${search}`);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [router, current]);
  return null;
}
