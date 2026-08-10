"use client";

import { useActionState, useEffect, useRef } from "react";
import { addTarget, type TargetFormState } from "@/app/actions";

const EMPTY: TargetFormState = {};

export function AddTargetForm() {
  const [state, action, pending] = useActionState(addTarget, EMPTY);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields once a target lands, so adding three sites in a row
  // doesn't mean selecting and retyping over the last one.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <section className="mt-8 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-medium">Add a site</h2>
      <p className="mt-1 text-sm text-muted">
        It gets checked every five minutes. Two failures in a row raises an
        alert.
      </p>

      <form ref={formRef} action={action} className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <input
              name="name"
              required
              placeholder="WorkWright marketing site"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-copper focus:ring-1 focus:ring-copper"
            />
          </label>

          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">Address</span>
            <input
              name="url"
              required
              inputMode="url"
              placeholder="workwright.co"
              className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-copper focus:ring-1 focus:ring-copper"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            disabled={pending}
            className="rounded-md bg-copper px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Adding…" : "Add site"}
          </button>

          {state.error ? (
            <p role="alert" className="text-sm text-down">
              {state.error}
            </p>
          ) : null}
          {state.ok ? (
            <p role="status" className="text-sm text-up">
              {state.ok}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
