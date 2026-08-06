"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the dashboard on an interval. A status board that silently shows
 * five-minute-old data is worse than one that admits it, and refreshing by
 * hand is the kind of chore people stop doing right before it matters.
 *
 * router.refresh() re-runs the Server Component and swaps the result in — no
 * full page reload, so scroll position and focus survive.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return null;
}
