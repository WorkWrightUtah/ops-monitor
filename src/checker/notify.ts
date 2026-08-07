import type { CheckResult } from "./http-check";

export type NoticeKind = "down" | "recovered";

export type NoticeTarget = {
  id: string;
  name: string;
  url: string;
};

export type DeliveryReport = {
  email: "sent" | "failed" | "skipped";
  teams: "sent" | "failed" | "skipped";
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
export function reason(result: CheckResult | null): string {
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
  result: CheckResult | null,
  checkedAt: string,
): string {
  const lines =
    kind === "down"
      ? [
          `${target.name} failed two checks in a row and looks down.`,
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

async function sendEmail(
  kind: NoticeKind,
  target: NoticeTarget,
  result: CheckResult | null,
  checkedAt: string,
): Promise<{ status: "sent" | "failed" | "skipped"; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;

  if (!apiKey || !to || !from) {
    return { status: "skipped", error: "RESEND_API_KEY / ALERT_EMAIL_* not set" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: subjectFor(kind, target),
        text: bodyFor(kind, target, result, checkedAt),
      }),
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

    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: `Resend request failed: ${String(error)}` };
  }
}

async function postToTeams(
  kind: NoticeKind,
  target: NoticeTarget,
  result: CheckResult | null,
  checkedAt: string,
): Promise<{ status: "sent" | "failed" | "skipped"; error?: string }> {
  const webhook = process.env.N8N_ALERT_WEBHOOK_URL;
  if (!webhook) return { status: "skipped", error: "N8N_ALERT_WEBHOOK_URL not set" };

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

    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: `n8n request failed: ${String(error)}` };
  }
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
  result: CheckResult | null,
  checkedAt: string,
): Promise<DeliveryReport> {
  const [email, teams] = await Promise.all([
    sendEmail(kind, target, result, checkedAt),
    postToTeams(kind, target, result, checkedAt),
  ]);

  const errors = [email.error, teams.error].filter(
    (e): e is string => typeof e === "string",
  );

  return {
    email: email.status,
    teams: teams.status,
    delivered: email.status === "sent" || teams.status === "sent",
    errors,
  };
}
