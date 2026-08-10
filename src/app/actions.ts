"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeUrl } from "@/lib/target-url";

// Adding and removing targets from the dashboard.
//
// These use the request-scoped client, not the checker's service_role client,
// so every write goes through the same team-only RLS policies as the reads. A
// non-team account submitting this form gets refused by the database, not by a
// hidden button.

export type TargetFormState = { error?: string; ok?: string };

export async function addTarget(
  _prev: TargetFormState,
  formData: FormData,
): Promise<TargetFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const url = normalizeUrl(String(formData.get("url") ?? ""));

  if (!name) return { error: "Give it a name — you'll see this in the alert." };
  if ("error" in url) return { error: url.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("targets")
    .insert({ name, url: url.value, active: true });

  if (error) {
    // 23505 unique_violation, 23514 check_violation, 42501 RLS refusal. Say
    // what happened in words rather than passing a Postgres error to someone
    // who just wanted to add a website.
    if (error.code === "23505") {
      return { error: `${url.value} is already on the board.` };
    }
    if (error.code === "23514") {
      return { error: "That address isn't one the checker can request." };
    }
    if (error.code === "42501") {
      return {
        error: "This account isn't allowed to add targets. Ask Ryan for access.",
      };
    }
    return { error: `Could not add it: ${error.message}` };
  }

  revalidatePath("/");
  return { ok: `Watching ${name}. The first check runs within five minutes.` };
}

export async function deleteTarget(
  _prev: TargetFormState,
  formData: FormData,
): Promise<TargetFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Nothing selected to remove." };

  const supabase = await createClient();

  // .select() matters here. A delete that RLS refuses comes back with no error
  // and no rows — indistinguishable from success unless we ask what was
  // actually deleted.
  const { data, error } = await supabase
    .from("targets")
    .delete()
    .eq("id", id)
    .select("name");

  if (error) return { error: `Could not remove it: ${error.message}` };
  if (!data || data.length === 0) {
    return { error: "That target is already gone, or this account can't remove it." };
  }

  revalidatePath("/");
  return { ok: `Removed ${data[0].name}.` };
}
