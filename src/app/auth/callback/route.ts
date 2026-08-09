import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The PKCE half of the same story.
//
// Depending on the email template and flow, Supabase either sends a token_hash
// (handled in ../confirm) or redirects back with a ?code= to exchange. Which
// one you get depends on Supabase settings rather than on our code, so both
// doors are open — a link landing on a 404 because the project was configured
// for the other flow is a miserable thing to debug.

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "That sign-in link is incomplete. Ask for a new one.",
      )}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        `That link didn't work: ${error.message}. Links expire — request a new one.`,
      )}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}?confirmed=1`);
}
