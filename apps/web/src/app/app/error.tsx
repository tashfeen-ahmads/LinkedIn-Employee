"use client";

import { ErrorRecovery } from "@/components/error-recovery";

// A page that throws keeps its frame: the sidebar stays, and the error says
// what to do in place of the page rather than replacing the whole screen.
export default function SectionError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery {...props} />;
}
