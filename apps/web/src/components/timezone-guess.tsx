"use client";

import { useEffect } from "react";

/**
 * Starts a timezone select on the browser's own zone when nothing is saved.
 *
 * The server cannot know where somebody is, so the select it renders starts on
 * UTC — which for nearly everybody is wrong, and a sending window read in the
 * wrong zone sends at four in the morning or never. The browser does know.
 * Only a starting value: the person still sees it and confirms it.
 */
export function TimezoneGuess({ targetId }: { targetId: string }) {
  useEffect(() => {
    const select = document.getElementById(targetId);
    if (!(select instanceof HTMLSelectElement)) return;
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone || zone === select.value) return;
    if (![...select.options].some((option) => option.value === zone)) {
      select.add(new Option(zone, zone), 0);
    }
    select.value = zone;
  }, [targetId]);
  return null;
}
