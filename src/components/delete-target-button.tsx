"use client";

import { useActionState, useState } from "react";
import { deleteTarget, type TargetFormState } from "@/app/actions";

const EMPTY: TargetFormState = {};

// Removing a target cascades to its checks, so the history goes with it. That
// is worth one deliberate second, but not a modal — the confirmation happens
// in place, on the tile being removed.
export function DeleteTargetButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteTarget, EMPTY);

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-muted underline-offset-2 transition-colors hover:text-down hover:underline"
        >
          Remove
        </button>
        {state.error ? (
          <p role="alert" className="text-xs text-down">
            {state.error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <p className="text-xs text-muted">Remove {name} and its history?</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-muted underline-offset-2 hover:underline"
        >
          Cancel
        </button>
        <button
          disabled={pending}
          className="rounded border border-down/40 px-2 py-0.5 text-xs font-medium text-down transition-colors hover:bg-down/10 disabled:opacity-60"
        >
          {pending ? "Removing…" : "Remove"}
        </button>
      </div>
    </form>
  );
}
