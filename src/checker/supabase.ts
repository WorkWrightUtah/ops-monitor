import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for the checker.
 *
 * Uses the service_role key, which bypasses RLS — that is deliberate and it is
 * why this file lives under src/checker/ and not src/lib/supabase/. The
 * dashboard must never import it: the dashboard reads as the signed-in user so
 * the team-only policies stay in force. The checker is a trusted background
 * job with no user attached, and it is the only thing that writes `checks`.
 */
export function createAdminClient() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !key) {
    throw new Error(
      "Checker needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY. See .env.local.example.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
