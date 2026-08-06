export default function Home() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-zinc-500">
        WorkWright
      </p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        This tool is being built in the shop.
      </h1>
      <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        A WorkWright House Stack app, scaffolded from{" "}
        <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
          workwrightutah/template
        </code>
        . Replace this page with the real thing.
      </p>
      <p className="text-sm text-zinc-500">
        Health check:{" "}
        <a className="underline underline-offset-4" href="/status">
          /status
        </a>
      </p>
    </main>
  );
}
