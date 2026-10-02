"use client";

import "./globals.css";
import { ErrorRecovery } from "@/components/error-recovery";

// The root layout's own boundary: it replaces the layout, so it brings its own
// document.
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorRecovery {...props} />
      </body>
    </html>
  );
}
