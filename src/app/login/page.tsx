import { HashSession } from "@/components/hash-session";
import { signIn, signUp } from "./actions";

export const metadata = { title: "Sign in · Ops Monitor" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const error = first(params.error);
  const notice = first(params.notice);
  const next = first(params.next) ?? "/";

  return (
    <main className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-8 px-6 py-24">
      {/* A confirmation link whose session came back as a URL fragment can be
          bounced here by the middleware, which cannot see fragments. This
          claims the session and moves on; it renders nothing otherwise. */}
      <HashSession />

      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-copper">
          WorkWright
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Ops Monitor
        </h1>
        <p className="mt-2 text-sm text-muted">
          Team only. Sign in with your WorkWright email.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-md border border-copper/30 bg-copper/10 px-3 py-2 text-sm text-copper"
        >
          {notice}
        </p>
      ) : null}

      <form className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-copper focus:ring-1 focus:ring-copper"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            minLength={8}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-copper focus:ring-1 focus:ring-copper"
          />
        </label>

        <div className="mt-2 flex flex-col gap-2">
          <button
            formAction={signIn}
            className="rounded-md bg-copper px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
          <button
            formAction={signUp}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-copper hover:text-copper"
          >
            Create an account
          </button>
        </div>
      </form>

      <p className="text-xs leading-5 text-muted">
        Accounts outside the workwright.co domain can sign in but will not see
        any monitoring data.
      </p>
    </main>
  );
}
