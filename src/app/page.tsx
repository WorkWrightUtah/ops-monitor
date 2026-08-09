import { AutoRefresh } from "@/components/auto-refresh";
import { StatusTile, type TargetStatus } from "@/components/status-tile";
import type { ChartPoint } from "@/components/response-chart";
import { isoHoursAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ops Monitor" };

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  // Set by the auth confirm/callback routes. Landing silently after clicking
  // "confirm your email" leaves people wondering whether it worked.
  const params = await searchParams;
  const justConfirmed =
    (Array.isArray(params.confirmed) ? params.confirmed[0] : params.confirmed) === "1";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reads run as the signed-in user, so RLS decides what comes back. A
  // non-team account gets empty arrays here — not an error, just nothing.
  const since = isoHoursAgo(24);

  const [statusResult, historyResult] = await Promise.all([
    supabase.from("target_status").select("*").order("name"),
    supabase
      .from("checks")
      .select("target_id, checked_at, response_ms, ok")
      .gte("checked_at", since)
      .order("checked_at", { ascending: true }),
  ]);

  const targets = (statusResult.data ?? []) as TargetStatus[];
  const loadError = statusResult.error ?? historyResult.error;

  // Group the 24h history once, rather than filtering the whole array per tile.
  const historyByTarget = new Map<string, ChartPoint[]>();
  for (const row of historyResult.data ?? []) {
    const points = historyByTarget.get(row.target_id) ?? [];
    points.push({
      checked_at: row.checked_at,
      response_ms: row.response_ms,
      ok: row.ok,
    });
    historyByTarget.set(row.target_id, points);
  }

  const watched = targets.filter((t) => t.active);
  const down = watched.filter((t) => t.last_ok === false);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <AutoRefresh seconds={60} />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-copper">
            WorkWright
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Ops Monitor
          </h1>
          <p className="mt-1 text-sm text-muted">
            {targets.length === 0
              ? "Nothing to show."
              : down.length > 0
                ? `${down.length} of ${watched.length} watched ${
                    watched.length === 1 ? "site is" : "sites are"
                  } down.`
                : `${watched.length} ${
                    watched.length === 1 ? "site" : "sites"
                  } watched, all up. Checked every 5 minutes.`}
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">{user?.email}</span>
          <form action={signOut}>
            <button className="rounded-md border border-border px-3 py-1.5 font-medium transition-colors hover:border-copper hover:text-copper">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {justConfirmed ? (
        <p
          role="status"
          className="mt-6 rounded-md border border-up/30 bg-up/10 px-3 py-2 text-sm text-up"
        >
          Email confirmed — you&rsquo;re signed in.
        </p>
      ) : null}

      {loadError ? (
        <p
          role="alert"
          className="mt-8 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down"
        >
          Could not load monitoring data. Try again in a moment.
        </p>
      ) : null}

      {!loadError && targets.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
          <p>
            No monitoring data is visible to this account. Ops Monitor is
            team-only — if you think that&rsquo;s wrong, ask Ryan.
          </p>
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-4">
        {targets.map((target) => (
          <StatusTile
            key={target.id}
            target={target}
            history={historyByTarget.get(target.id) ?? []}
          />
        ))}
      </div>
    </main>
  );
}
