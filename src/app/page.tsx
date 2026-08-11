import { AddTargetForm } from "@/components/add-target-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { DeleteTargetButton } from "@/components/delete-target-button";
import { StatusTile, type TargetStatus } from "@/components/status-tile";
import type { ChartPoint } from "@/components/response-chart";
import { outcomeOf } from "@/lib/check-outcome";
import { isoHoursAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ops Monitor" };

export default async function Dashboard() {
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
      .select("target_id, checked_at, response_ms, ok, status_code, outcome")
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
      status_code: row.status_code,
      outcome: row.outcome as ChartPoint["outcome"],
    });
    historyByTarget.set(row.target_id, points);
  }

  const watched = targets.filter((t) => t.active);
  // A refused check is not a failed one. Counting blocked targets as "down"
  // here is the same mistake the alert rules used to make, one screen over.
  const outcomeFor = (t: TargetStatus) =>
    t.last_outcome ?? outcomeOf(t.last_status_code);
  const failing = watched.filter(
    (t) => t.last_ok === false && outcomeFor(t) === "down",
  );
  const blocked = watched.filter(
    (t) => t.last_ok === false && outcomeFor(t) === "blocked",
  );

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const blockedNote = blocked.length
    ? ` ${blocked.length} ${plural(blocked.length, "is", "are")} refusing our checker — not an outage.`
    : "";

  const summary =
    targets.length === 0
      ? "Nothing to show."
      : failing.length > 0
        ? `${failing.length} of ${watched.length} watched ${plural(
            failing.length,
            "site is",
            "sites are",
          )} down.${blockedNote}`
        : blocked.length === watched.length
          ? `${watched.length} ${plural(watched.length, "site", "sites")} watched. None can be checked right now — see below.`
          : `${watched.length - blocked.length} of ${watched.length} watched ${plural(
              watched.length,
              "site",
              "sites",
            )} up. Checked every 5 minutes.${blockedNote}`;

  // Mirrors public.is_team_member() to decide whether to show the controls.
  // Display only — the database still decides who may actually write, and the
  // actions surface its refusal rather than trusting this.
  const canManage = (user?.email ?? "").toLowerCase().endsWith("@workwright.co");

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
          <p className="mt-1 text-sm text-muted">{summary}</p>
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
            action={
              canManage ? (
                <DeleteTargetButton id={target.id} name={target.name} />
              ) : null
            }
          />
        ))}
      </div>

      {canManage ? <AddTargetForm /> : null}
    </main>
  );
}
