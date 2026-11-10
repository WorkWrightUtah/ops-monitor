// The checker. One pass over every active target: GET it, record the result,
// then decide whether anyone needs to be told.
//
// Runs as a Railway cron service every 5 minutes and exits. Kept out of the
// web process on purpose — a redeploy or idle-sleep of the dashboard must not
// be able to silently stop the monitoring.

import { outcomeOf, reconcile, type CheckOutcome } from "../lib/check-outcome";
import { decide, type AlertAction } from "./alert-rules";
import { checkUrl, type CheckResult } from "./http-check";
import { sendNotice, type NoticeResult } from "./notify";
import { askSecondVantage, type SecondOpinionResult } from "./second-opinion";
import { sharedRefusal, type RunReading } from "./shared-refusal";
import { createAdminClient } from "./supabase";
import { normalizeUrl } from "../lib/target-url";

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
  result: NoticeResult | null,
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

/** What phase one hands to phase two for one target. */
type Checked = {
  target: Target;
  result: CheckResult;
  second: SecondOpinionResult;
  /** Whether the second vantage was actually asked. */
  asked: boolean;
  checkedAt: string;
};

/**
 * Phase one: check one active target and record the result.
 *
 * Returns null when there is nothing for phase two to act on: a URL we refused
 * to check, or a row that failed to save.
 */
async function checkTarget(supabase: Supabase, target: Target): Promise<Checked | null> {
  /*
    Validate the URL before fetching it.

    The dashboard's add-target form used to do this, and the form is gone —
    targets are now written straight into the table by hand. The database only
    insists on an http(s) prefix, which `https://user:pass@evil.example` satisfies
    perfectly well while sending our checker somewhere nobody intended, with
    credentials attached. normalizeUrl refuses that shape.

    Skipping rather than throwing: one malformed row must not stop the other
    targets being checked, and the log names it so it can be fixed.
  */
  const checked = normalizeUrl(target.url);
  if ("error" in checked) {
    log(`  ! ${target.name}: refusing to check this url — ${checked.error}`);
    return null;
  }

  await sleep(Math.random() * JITTER_MS);

  const result = await checkUrl(checked.value);

  // Only bother a second network when our own answer is bad news. A healthy
  // response needs no corroboration, and this keeps the Worker's traffic
  // proportional to trouble rather than to time.
  const asked = result.outcome !== "up";
  const second = asked
    ? await askSecondVantage(target.url)
    : { outcome: "unavailable" as const, status_code: null, detail: "not asked" };
  const outcome = reconcile(result.outcome, second.outcome);

  const checkedAt = new Date().toISOString();

  const row = {
    target_id: target.id,
    checked_at: checkedAt,
    status_code: result.status_code,
    response_ms: result.response_ms,
    ok: result.ok,
    // The reconciled verdict, not the raw status. Two rows with the same
    // status code can now mean opposite things, so it is written down here
    // rather than re-derived later from evidence that no longer contains it.
    outcome,
  };

  // What the second network saw, beside what we saw. NULL second_outcome means
  // "not asked", which is not the same as "asked and got nothing" — hence
  // `asked` rather than reading the placeholder above.
  const secondColumns = {
    second_outcome: asked ? second.outcome : null,
    second_status_code: asked ? second.status_code : null,
  };

  let { error: insertError } = await supabase
    .from("checks")
    .insert({ ...row, ...secondColumns });

  // Railway deploys on merge, so this code can be live before the migration
  // that adds the second_* columns has been applied. PostgREST then refuses the
  // whole insert (PGRST204, unknown column) and every target would go
  // unrecorded — a monitor gone blind over a column that is merely nice to
  // have. Write the row without them instead, and say so in the log. Once the
  // migration is applied this branch never runs.
  if (insertError?.code === "PGRST204") {
    log(
      `  ! ${target.name}: checks.second_* columns missing — apply ` +
        `20261110211223_checks_second_vantage.sql. Recording without them.`,
    );
    ({ error: insertError } = await supabase.from("checks").insert(row));
  }

  if (insertError) {
    // Without the row on disk the history is wrong, and the alert decision
    // below would be made against a record that does not match reality.
    // Better to skip this target this cycle and let the next run redo it.
    log(`  ! ${target.name}: failed to record check: ${insertError.message}`);
    return null;
  }

  const label =
    outcome === "up" ? "up" : outcome === "blocked" ? "BLOCKED" : "DOWN";

  log(
    `  ${target.name}: ${label} ` +
      `(${result.status_code ?? "no response"}, ${result.response_ms} ms` +
      `${result.attempts > 1 ? `, ${result.attempts} attempts` : ""})`,
  );

  if (result.outcome !== "up") {
    log(
      `    we saw ${result.outcome}; second vantage saw ${second.outcome}` +
        (second.detail ? ` (${second.detail})` : ""),
    );
    // Logged on every bad reading, because lib/edge.ts rests on an unverified
    // guess: that a host's edge labels the refusals it issues itself. The first
    // real refusal after this ships answers it, here.
    log(`    answered by: ${result.edge ?? "unknown edge (no recognised headers)"}`);
  }

  if (outcome === "blocked") {
    log(`    refused, not down — nobody is being paged for this.`);
  }

  if (result.outcome === "blocked" && outcome === "down") {
    // Two different stories end here and they are worth telling apart in the
    // log. "Both refused" is the corroborated-refusal case the second vantage
    // exists for; the other is us being refused while an independent network
    // saw the site genuinely failing, which is a stronger signal, not a
    // weaker one. Printing "both networks were refused" for both was wrong,
    // and it made a live test look like it had exercised a path it had not.
    log(
      second.outcome === "blocked"
        ? `    both networks were refused — treating this as a real outage.`
        : `    we were refused; the second vantage saw a genuine failure — treating this as a real outage.`,
    );
  }

  return { target, result, second, asked, checkedAt };
}

/**
 * Phase two: decide whether anyone needs telling about one target, and tell them.
 *
 * Runs only after every target in this run has been checked, so an alert can
 * say which other sites were refused at the same time. That costs a little
 * latency (an alert now waits for the slowest target in the run, at most a
 * few tens of seconds) against a five-minute cadence.
 */
async function decideAndAnnounce(
  supabase: Supabase,
  { target, result, second, asked, checkedAt }: Checked,
  run: readonly RunReading[],
) {
  // Read back the tail *including* the row just written, so the threshold is
  // counted against what is actually stored rather than what we think we wrote.
  //
  // status_code comes back too, as a fallback for rows written before
  // checks.outcome existed — or by a checker mid-deploy that did not set it.
  const { data: recent, error: historyError } = await supabase
    .from("checks")
    .select("outcome, status_code")
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
    recent: (recent ?? []).map(
      (row) => (row.outcome as CheckOutcome | null) ?? outcomeOf(row.status_code),
    ),
  });

  if (action !== "none") {
    const shared = sharedRefusal(readingOf({ target, result }), run);
    await announce(
      supabase,
      target,
      action,
      { ...result, ...(asked ? { second } : {}), shared },
      checkedAt,
    );
  }
}

function readingOf({ target, result }: Pick<Checked, "target" | "result">): RunReading {
  return {
    targetId: target.id,
    name: target.name,
    refused: result.outcome === "blocked",
    edge: result.edge,
  };
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

  // Phase one. Targets are independent, so check them concurrently. One slow
  // site should not delay the rest, and Promise.allSettled means a thrown error
  // on one target cannot abandon the others mid-run.
  const checks = await Promise.allSettled(active.map((t) => checkTarget(supabase, t)));

  const checked = checks
    .filter((c): c is PromiseFulfilledResult<Checked | null> => c.status === "fulfilled")
    .map((c) => c.value)
    .filter((c): c is Checked => c !== null);

  // Every reading from this run, so each alert can see the others.
  const run = checked.map(readingOf);

  // Phase two: alerts for checked targets, and close-outs for switched-off ones.
  const decisions = await Promise.allSettled([
    ...checked.map((c) => decideAndAnnounce(supabase, c, run)),
    ...standDown.map((t) => processDeactivated(supabase, t)),
  ]);

  // A target that threw in phase one never reached phase two, so the two
  // phases' failures never double-count one target. The total is per target,
  // as it was before the split: one that stopped early (a URL we refused, a row
  // that failed to save) logged its own reason and still counts as processed.
  const failures = [...checks, ...decisions].filter((o) => o.status === "rejected");
  const total = active.length + standDown.length;
  for (const failure of failures) {
    log(`  ! unexpected error: ${String((failure as PromiseRejectedResult).reason)}`);
  }

  log(`Done. ${total - failures.length}/${total} targets processed cleanly.`);

  // A target that blew up is a bad run worth surfacing in Railway, but the
  // rows that did land are still recorded.
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  log(`FATAL: ${String(error)}`);
  process.exit(1);
});
