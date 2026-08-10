"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// The third door.
//
// Supabase can hand a confirmed session back in three shapes, and which one
// arrives depends on project settings and on how the link was created rather
// than on anything in our code:
//
//   ?token_hash=   -> /auth/confirm  (server)
//   ?code=         -> /auth/callback (server)
//   #access_token= -> here           (browser only)
//
// The third is invisible to a route handler: a URL fragment is never sent to
// the server. Traced against the live project, that shape lands the browser on
// a page with a valid session sitting in the address bar and nothing reading
// it, so the middleware sees no cookie and redirects to the login form — the
// exact "it confirmed but dumped me somewhere useless" this was meant to fix.
//
// Rendered on the pages such a link can land on. It does nothing at all unless
// there are tokens in the fragment.
// Renders nothing, ever. It was going to show "Finishing sign-in…", but that
// needs state set synchronously inside the effect, which the React Compiler
// lint rejects as impure — and the alternative, reading location.hash during
// render, mismatches between server and client. The exchange is one fast
// request, so the page simply settles into its signed-in wording.
export function HashSession() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#") || !hash.includes("access_token")) return;

    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;

    let cancelled = false;

    createClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        // Take the tokens out of the address bar either way. They are live
        // credentials, and leaving them in the URL puts them into browser
        // history and into anything the person pastes the link into.
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );

        if (cancelled || error) return;

        // The session now lives in a cookie, so the server can see it. Refresh
        // to re-render the page as signed in.
        router.replace("/auth/confirmed");
        router.refresh();
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
