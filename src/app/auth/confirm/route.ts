import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { originFromHeaders } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

// Where Supabase's confirmation and recovery links land.
//
// Without this route the link 404s, which is exactly what "confirm your email"
// did before: the proxy let /auth through as public, but nothing was listening.
//
// Supabase sends a one-time token_hash. Exchanging it here both proves the
// address and establishes the session, so the person arrives signed in rather
// than being asked to log in again immediately after clicking a link that was
// supposed to log them in.

function safeNext(value: string | null): string {
  // Only ever redirect within this site — a crafted ?next= would otherwise
  // turn a link we email out into an open redirect.
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/auth/confirmed";
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  // Not requestUrl.origin — see lib/site-url.ts.
  const origin = originFromHeaders(request.headers) ?? requestUrl.origin;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "That confirmation link is incomplete. Ask for a new one.",
      )}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Expired or already-used links are the common case, not an outage. Say so
    // plainly rather than showing a stack trace or a bare "invalid token".
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        `That link didn't work: ${error.message}. Links expire — request a new one.`,
      )}`,
    );
  }

  // Password recovery drops them on the login form with their session already
  // established; everything else goes where they were headed.
  if (type === "recovery") {
    return NextResponse.redirect(
      `${origin}/login?notice=${encodeURIComponent(
        "Signed in. Set a new password from your account if you need to.",
      )}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
