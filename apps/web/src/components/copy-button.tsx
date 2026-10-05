"use client";

import { useState } from "react";

/**
 * Copies a value and says so.
 *
 * The invitation table printed the whole link in a monospace column, which
 * pushed the Revoke button off the edge of every phone and still had to be
 * selected by hand. The link is what somebody wants to paste, so the button
 * hands it over; the full text stays as the button's title for anyone who
 * wants to read it.
 */
export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn secondary small"
      title={value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", value);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
