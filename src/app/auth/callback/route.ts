import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The PKCE half of the same story.
//
// Depending on the email template and flow, Supabase either sends a token_hash
// (handled in ../confirm) or redirects back with a ?code= to exchange. Which
// one you get depends on Supabase settings rather than on our code, so both
// doors are open — a link landing on a 404 because the project was configured
// for the other flow is a miserable thing to debug.
//
// This is the door the default template actually uses: its link points at
// Supabase's own /auth/v1/verify, which confirms the address server-side and
// then bounces the browser here.

function safeNext(value: string | null, fallback: string): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : fallback;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), "/auth/confirmed");

  // Supabase reports a refused link by redirecting here with error params
  // rather than a code — an expired or already-used link is the usual cause.
  const error = searchParams.get("error_description") ?? searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        `That link didn't work: ${error}. Links expire — request a new one.`,
      )}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "That sign-in link is incomplete. Ask for a new one.",
      )}`,
    );
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  // Reaching this point without an error param means Supabase already verified
  // the address before redirecting — so a failed exchange means "confirmed but
  // not signed in", not "not confirmed". That happens when the link is opened
  // in a different browser than it was requested from, since the PKCE verifier
  // lives in a cookie. The confirmed page reads the session itself and says the
  // signed-out version of the same truth.
  if (exchangeError) return NextResponse.redirect(`${origin}/auth/confirmed`);

  return NextResponse.redirect(`${origin}${next}`);
}
