"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { originFromHeaders } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

// Where confirmation links should come back to.
//
// Read from the request rather than hardcoded, so the link works the same in
// local dev and in production. Supabase only honours this if the URL matches
// the project's allowed Redirect URLs; otherwise it silently substitutes the
// project's Site URL — which is how confirmation emails ended up pointing at
// localhost. See docs/decisions.md.
async function requestOrigin(): Promise<string | undefined> {
  return originFromHeaders(await headers());
}

// Only ever redirect to a path on this site. Without this check, a crafted
// ?next=https://evil.example link would turn our login form into an open
// redirect that borrows our domain's credibility. A leading "//" is rejected
// too, since browsers read "//evil.example" as protocol-relative and off-site.
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function backToLogin(message: string, next: string): never {
  redirect(
    `/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`,
  );
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) backToLogin("Enter your email and password.", next);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // Supabase returns one generic "Invalid login credentials" for both a wrong
  // password and an address that has no account. We pass it through unchanged
  // rather than helpfully distinguishing the two, which would let anyone use
  // this form to discover who has an account.
  if (error) backToLogin(error.message, next);

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) backToLogin("Enter your email and password.", next);

  const origin = await requestOrigin();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: origin ? { emailRedirectTo: `${origin}/auth/callback` } : undefined,
  });

  if (error) backToLogin(error.message, next);

  // Supabase returns a user with no session when the project requires email
  // confirmation. Say so plainly instead of dropping them on a blank page
  // wondering whether it worked.
  if (!data.session) {
    redirect(
      `/login?notice=${encodeURIComponent(
        "Account created. Check your email for the confirmation link, then sign in.",
      )}`,
    );
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
