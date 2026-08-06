// Health check. Reports app liveness and whether required env vars are wired —
// without instantiating any client, so it never crashes on a fresh template.
export const dynamic = "force-dynamic";

export default function Status() {
  const checks = {
    app: "ok",
    time: new Date().toISOString(),
    env: {
      supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    },
    commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
  };

  return (
    <main className="mx-auto max-w-lg px-6 py-24 font-mono text-sm">
      <h1 className="mb-4 text-base font-semibold">Status</h1>
      <pre className="overflow-x-auto rounded-lg bg-black/[.05] p-4 dark:bg-white/[.06]">
        {JSON.stringify(checks, null, 2)}
      </pre>
    </main>
  );
}
