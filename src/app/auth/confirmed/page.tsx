import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Where a confirmation link finally lands.
//
// This page exists because "it worked" needs somewhere to be said. Previously a
// confirmed link dropped people on the dashboard with a small green banner,
// which reads as "here is the app" rather than "your email is confirmed" — and
// if the session didn't take, it read as nothing at all.
//
// Reachable signed out on purpose: clicking a confirmation link in a different
// browser than you signed up in confirms the address but cannot restore the
// session, and that person still deserves a clear answer.

export const dynamic = "force-dynamic";
export const metadata = { title: "Email confirmed · Ops Monitor" };

export default async function ConfirmedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-8 px-6 py-24">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-copper">
          WorkWright
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Email confirmed
        </h1>
      </div>

      <div className="rounded-lg border border-up/30 bg-up/10 px-4 py-3">
        <p className="text-sm text-up">
          {user
            ? `${user.email} is confirmed and you're signed in.`
            : "Your email address is confirmed."}
        </p>
      </div>

      {user ? (
        <Link
          href="/"
          className="rounded-md bg-copper px-3 py-2 text-center text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Go to the dashboard
        </Link>
      ) : (
        <>
          <p className="text-sm text-muted">
            You&rsquo;ll need to sign in to finish — confirmation links only
            carry a session back to the browser they were requested from.
          </p>
          <Link
            href="/login"
            className="rounded-md bg-copper px-3 py-2 text-center text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Sign in
          </Link>
        </>
      )}
    </main>
  );
}
