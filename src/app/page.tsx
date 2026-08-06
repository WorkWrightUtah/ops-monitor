import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirected anonymous visitors, so reaching here means
  // signed in. Whether they can see any *data* is RLS's call, not ours.
  const { data: targets } = await supabase.from("targets").select("id");
  const isTeam = targets !== null && targets.length > 0;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-copper">
          WorkWright
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Ops Monitor
        </h1>
      </div>

      <p className="text-sm text-muted">
        Signed in as <span className="text-foreground">{user?.email}</span>.
      </p>

      {isTeam ? (
        <p className="text-sm text-muted">
          Data layer is live. The dashboard lands in Phase 4.
        </p>
      ) : (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
          This account is not on the WorkWright team, so there is no monitoring
          data to show. Ask Ryan if you think that&rsquo;s wrong.
        </p>
      )}

      <form action={signOut}>
        <button className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:border-copper hover:text-copper">
          Sign out
        </button>
      </form>
    </main>
  );
}
