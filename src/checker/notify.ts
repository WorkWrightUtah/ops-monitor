import { FAILURE_THRESHOLD } from "./alert-rules";
import type { CheckResult } from "./http-check";

export type NoticeKind = "down" | "recovered";

/**
 * Just the parts of a check a notice actually quotes.
 *
 * Narrower than CheckResult on purpose: a notice reports what was observed,
 * and should not start depending on how many attempts it took or how the
 * outcome was classified. A full CheckResult still satisfies it.
 */
export type NoticeResult = Pick<CheckResult, "status_code" | "response_ms" | "ok">;

export type NoticeTarget = {
  id: string;
  name: string;
  url: string;
};

export type DeliveryReport = {
  email: "accepted" | "failed" | "skipped";
  teams: "accepted" | "failed" | "skipped";
  /** True when at least one channel got the message out. */
  delivered: boolean;
  errors: string[];
};

/**
 * Why the target is being reported, in plain words.
 *
 * Exported for tests: this string is what a human reads at 2am, and getting it
 * wrong is a real failure even though nothing throws.
 */
export function reason(result: NoticeResult | null): string {
  if (!result) return "the target was switched off while an alert was open";
  if (result.status_code === null) {
    return "no response — DNS failure, refused connection, or timeout";
  }
  return `HTTP ${result.status_code}`;
}

export function subjectFor(kind: NoticeKind, target: NoticeTarget): string {
  return kind === "down"
    ? `DOWN: ${target.name}`
    : `Recovered: ${target.name}`;
}

export function bodyFor(
  kind: NoticeKind,
  target: NoticeTarget,
  result: NoticeResult | null,
  checkedAt: string,
): string {
  const lines =
    kind === "down"
      ? [
          `${target.name} failed ${FAILURE_THRESHOLD} checks in a row and looks down.`,
          "",
          `URL:      ${target.url}`,
          `Reason:   ${reason(result)}`,
          `Observed: ${checkedAt}`,
          "",
          "You will get one more message when it comes back. No repeats in the meantime.",
        ]
      : [
          result
            ? `${target.name} is responding again.`
            : `${target.name} was switched off while an alert was open, so the alert is being closed out.`,
          "",
          `URL:      ${target.url}`,
          ...(result
            ? [
                `Status:   HTTP ${result.status_code} in ${result.response_ms} ms`,
              ]
            : []),
          `Observed: ${checkedAt}`,
        ];

  return lines.join("\n");
}

type SendStatus = "accepted" | "failed" | "skipped";
type SendResult = { status: SendStatus; error?: string };

/**
 * One Resend send. Both channels go through here now — the mailbox and the
 * Teams channel — because the Teams channel is just an email address.
 */
async function resendSend(to: string, subject: string, text: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;

  if (!apiKey || !from) {
    return { status: "skipped", error: "RESEND_API_KEY / ALERT_EMAIL_FROM not set" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // Read the body: Resend explains refusals ("domain not verified") here,
      // and a bare status code would send someone hunting for no reason.
      const detail = await response.text().catch(() => "");
      return {
        status: "failed",
        error: `Resend ${response.status}: ${detail.slice(0, 300)}`,
      };
    }

    // "accepted", not "sent", and the distinction is not pedantry. A 200 from
    // Resend means the message was queued — it says nothing about delivery.
    // This bit us: a test send to a non-existent mailbox returned 200, hard
    // bounced, and Resend auto-suppressed the address, so the next two real
    // alerts were dropped silently while the logs cheerfully said "sent".
    //
    // Knowing the true outcome requires Resend delivery webhooks, which are
    // out of scope here. Until then the honest word is "accepted", so nobody
    // reads these logs as proof an alert arrived.
    return { status: "accepted" };
  } catch (error) {
    return { status: "failed", error: `Resend request failed: ${String(error)}` };
  }
}

async function sendEmail(
  kind: NoticeKind,
  target: NoticeTarget,
  result: NoticeResult | null,
  checkedAt: string,
): Promise<SendResult> {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) return { status: "skipped", error: "ALERT_EMAIL_TO not set" };

  return resendSend(
    to,
    subjectFor(kind, target),
    bodyFor(kind, target, result, checkedAt),
  );
}

/**
 * Post the notice into the Teams channel.
 *
 * Preferred route is the channel's own email address, because it has no token
 * to expire. The alternative — a webhook into n8n, into a Power Automate flow,
 * into Teams — died silently on 2026-08-06 when the flow's Microsoft
 * connection lost its token, and stayed dead for a week while every hop in the
 * chain reported success. Delegated OAuth always expires eventually; an email
 * address does not.
 *
 * The address is restricted in Teams to senders from `workwright.co` and
 * `send.workwright.co`. Both are needed: Teams matches the *envelope* sender,
 * and Resend's return path is on the `send.` subdomain. Allowing only the bare
 * domain looks right and drops every message on the floor — Resend reports
 * "delivered" because Microsoft accepted the mail before discarding it.
 */
async function postToTeams(
  kind: NoticeKind,
  target: NoticeTarget,
  result: NoticeResult | null,
  checkedAt: string,
): Promise<SendResult> {
  const channelEmail = process.env.TEAMS_CHANNEL_EMAIL;
  if (channelEmail) {
    return resendSend(
      channelEmail,
      subjectFor(kind, target),
      bodyFor(kind, target, result, checkedAt),
    );
  }

  // Legacy route, kept so unsetting one variable rolls back to the path that
  // was live before 2026-08-14. Do not add features to it.
  const webhook = process.env.N8N_ALERT_WEBHOOK_URL;
  if (!webhook) {
    return { status: "skipped", error: "TEAMS_CHANNEL_EMAIL / N8N_ALERT_WEBHOOK_URL not set" };
  }

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Structured, so the n8n workflow can format the Teams card without
      // parsing prose, plus a ready-made `text` for the simple case.
      body: JSON.stringify({
        event: kind === "down" ? "target.down" : "target.recovered",
        target: { id: target.id, name: target.name, url: target.url },
        status_code: result?.status_code ?? null,
        response_ms: result?.response_ms ?? null,
        reason: reason(result),
        checked_at: checkedAt,
        title: subjectFor(kind, target),
        text: bodyFor(kind, target, result, checkedAt),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        status: "failed",
        error: `n8n ${response.status}: ${detail.slice(0, 300)}`,
      };
    }

    return { status: "accepted" };
  } catch (error) {
    return { status: "failed", error: `n8n request failed: ${String(error)}` };
  }
}

/**
 * The email you get when the Teams leg breaks.
 *
 * Exported for tests, and for the same reason `reason()` is: this is read by a
 * human who is trying to work out whether to trust the channel, so the wording
 * is part of the behaviour.
 */
export function channelFailureNotice(targetName: string, error: string): string {
  return [
    "The alert for " + targetName + " went out by email, but posting it to the",
    "Teams channel failed. Alerts are reaching this mailbox and nothing else.",
    "",
    `Error:    ${error}`,
    "",
    "This is the failure that went unnoticed for a week in August 2026, so it",
    "now gets its own email. Runbook: README, \"When Teams cards stop arriving\".",
  ].join("\n");
}

/**
 * Send one notice to both channels.
 *
 * `delivered` is true when at least one channel succeeded. The caller uses it
 * to decide whether the alert counts as announced: if both channels fail we
 * leave the alert open so the next run tries again, but we do not re-send just
 * because one of two channels was down — "one outage, one alert" is the
 * stronger promise, and the per-channel failure is in the logs either way.
 */
export async function sendNotice(
  kind: NoticeKind,
  target: NoticeTarget,
  result: NoticeResult | null,
  checkedAt: string,
): Promise<DeliveryReport> {
  const [email, teams] = await Promise.all([
    sendEmail(kind, target, result, checkedAt),
    postToTeams(kind, target, result, checkedAt),
  ]);

  const errors = [email.error, teams.error].filter(
    (e): e is string => typeof e === "string",
  );

  // Tell somebody, in the channel that still works, that the other one didn't.
  //
  // Only when Teams *failed* — "skipped" means nobody configured it, which is
  // not a fault and must not generate mail. Best effort on purpose: if this
  // send fails too the alert itself already went out, and turning a warning
  // into a hard error would be a poor trade.
  const to = process.env.ALERT_EMAIL_TO;
  if (teams.status === "failed" && email.status === "accepted" && to) {
    const warning = await resendSend(
      to,
      `Teams delivery failed: ${target.name}`,
      channelFailureNotice(target.name, teams.error ?? "no detail"),
    );
    if (warning.error) errors.push(`could not send the Teams-failure warning: ${warning.error}`);
  }

  return {
    email: email.status,
    teams: teams.status,
    delivered: email.status === "accepted" || teams.status === "accepted",
    errors,
  };
}
