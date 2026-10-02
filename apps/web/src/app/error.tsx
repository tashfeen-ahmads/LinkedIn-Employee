"use client";

import { ErrorRecovery } from "@/components/error-recovery";

// Without a boundary, any error in the browser replaced the whole screen with
// Next.js's bare "Application error" sentence.
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery {...props} />;
}
