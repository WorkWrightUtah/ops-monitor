// The checker. One pass over every active target: GET it, record the result,
// then decide whether anyone needs to be told.
//
// Runs as a Railway cron service every 5 minutes and exits. Kept out of the
// web process on purpose — a redeploy or idle-sleep of the dashboard must not
// be able to silently stop the monitoring.

import { outcomeOf } from "../lib/check-outcome";
import { decide, type AlertAction } from "./alert-rules";
import { checkUrl, type CheckResult } from "./http-check";
import { sendNotice } from "./notify";
import { createAdminClient } from "./supabase";

/**
 * How many recent checks to read when counting consecutive failures.
 *
 * Was 5 when every row counted. Refusals are now skipped when counting runs,
 * so a blocked stretch can fill the window with rows that say nothing; a wider
 * window keeps enough real checks in view to still reach a verdict.
 */
const HISTORY_WINDOW = 12;

/**
 * Spread each target's check randomly across this many milliseconds.
 *
 * Requests that arrive on a perfect five-minute grid, from one datacenter IP,
 * forever, are a recognisable machine signature — and bot filters score
 * exactly that. Jitter is a hypothesis about why Red Rock's CDN started
 * refusing us after nineteen clean hours, not a proven fix; it costs up to
 * half a minute of detection latency, which is cheap against a five-minute
 * cadence. If it turns out not to help, delete it and lose nothing.
 */
const JITTER_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Target = {
  id: string;
  name: string;
  url: string;
  active: boolean;
  alerting: boolean;
};

type Supabase = ReturnType<typeof createAdminClient>;

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Send the notice for a decided action and, only if it got out, record that we
 * have spoken. Setting `alerting` before a successful send would mark an
 * outage announced that nobody actually heard.
 */
async function announce(
  supabase: Supabase,
  target: Target,
  action: Exclude<AlertAction, "none">,
  result: CheckResult | null,
  checkedAt: string,
) {
  const kind = action === "alert" ? "down" : "recovered";
  const report = await sendNotice(kind, target, result, checkedAt);

  for (const error of report.errors) {
    log(`  ! ${target.name}: ${error}`);
  }

  if (!report.delivered) {
    // Leave `alerting` as it is. For an outage that means the alert stays
    // open and the next run tries again; for a recovery it means the target
    // stays flagged and we retry the close-out.
    log(
      `  ${target.name}: ${kind} notice NOT delivered (email=${report.email}, teams=${report.teams}) — will retry next run`,
    );
    return;
  }

  const { error } = await supabase
    .from("targets")
    .update({ alerting: action === "alert" })
    .eq("id", target.id);

  if (error) {
    log(`  ! ${target.name}: sent ${kind} but failed to update alerting flag: ${error.message}`);
    return;
  }

  log(
    `  ${target.name}: ${kind} notice sent (email=${report.email}, teams=${report.teams})`,
  );
}

/** Check one active target, record it, and act on the result. */
async function processActive(supabase: Supabase, target: Target) {
  await sleep(Math.random() * JITTER_MS);

  const result = await checkUrl(target.url);
  const checkedAt = new Date().toISOString();

  const { error: insertError } = await supabase.from("checks").insert({
    target_id: target.id,
    checked_at: checkedAt,
    status_code: result.status_code,
    response_ms: result.response_ms,
    ok: result.ok,
  });

  if (insertError) {
    // Without the row on disk the history is wrong, and the alert decision
    // below would be made against a record that does not match reality.
    // Better to skip this target this cycle and let the next run redo it.
    log(`  ! ${target.name}: failed to record check: ${insertError.message}`);
    return;
  }

  const label =
    result.outcome === "up"
      ? "up"
      : result.outcome === "blocked"
        ? "BLOCKED"
        : "DOWN";

  log(
    `  ${target.name}: ${label} ` +
      `(${result.status_code ?? "no response"}, ${result.response_ms} ms` +
      `${result.attempts > 1 ? `, ${result.attempts} attempts` : ""})`,
  );

  if (result.outcome === "blocked") {
    log(
      `    refused, not down — something answered. Nobody is being paged for this.`,
    );
  }

  // Read back the tail *including* the row just written, so the threshold is
  // counted against what is actually stored rather than what we think we wrote.
  //
  // status_code comes back too: the outcome is derived from it rather than
  // stored, so old rows reclassify themselves under the current rules instead
  // of freezing yesterday's verdict into the history.
  const { data: recent, error: historyError } = await supabase
    .from("checks")
    .select("status_code")
    .eq("target_id", target.id)
    .order("checked_at", { ascending: false })
    .limit(HISTORY_WINDOW);

  if (historyError) {
    log(`  ! ${target.name}: failed to read history: ${historyError.message}`);
    return;
  }

  const action = decide({
    active: true,
    alerting: target.alerting,
    recent: (recent ?? []).map((row) => outcomeOf(row.status_code)),
  });

  if (action !== "none") {
    await announce(supabase, target, action, result, checkedAt);
  }
}

/**
 * Close out alerts on targets that were switched off while down. They get no
 * new checks, so nothing else would ever resolve them.
 */
async function processDeactivated(supabase: Supabase, target: Target) {
  const action = decide({
    active: false,
    alerting: target.alerting,
    recent: [],
  });

  if (action !== "none") {
    log(`  ${target.name}: deactivated with an alert open — closing it out`);
    await announce(supabase, target, action, null, new Date().toISOString());
  }
}

async function main() {
  const supabase = createAdminClient();

  // One query for both jobs: everything we check, plus anything switched off
  // that still owes a close-out.
  const { data, error } = await supabase
    .from("targets")
    .select("id, name, url, active, alerting")
    .or("active.eq.true,alerting.eq.true")
    .order("name");

  if (error) throw new Error(`Could not load targets: ${error.message}`);

  const targets = (data ?? []) as Target[];
  const active = targets.filter((t) => t.active);
  const standDown = targets.filter((t) => !t.active && t.alerting);

  log(
    `Checking ${active.length} active target${active.length === 1 ? "" : "s"}` +
      (standDown.length ? `, closing out ${standDown.length}` : ""),
  );

  // Targets are independent, so check them concurrently — one slow site should
  // not delay the rest. Promise.allSettled so a thrown error on one target
  // cannot abandon the others mid-run.
  const outcomes = await Promise.allSettled([
    ...active.map((t) => processActive(supabase, t)),
    ...standDown.map((t) => processDeactivated(supabase, t)),
  ]);

  const failures = outcomes.filter((o) => o.status === "rejected");
  for (const failure of failures) {
    log(`  ! unexpected error: ${String((failure as PromiseRejectedResult).reason)}`);
  }

  log(`Done. ${outcomes.length - failures.length}/${outcomes.length} targets processed cleanly.`);

  // A target that blew up is a bad run worth surfacing in Railway, but the
  // rows that did land are still recorded.
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  log(`FATAL: ${String(error)}`);
  process.exit(1);
});
