"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession, destroySession } from "@/lib/auth";

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const principal = await authenticate(email, password);
  if (!principal) {
    // Deliberately vague: don't reveal whether the address exists.
    redirect(`/login?error=${encodeURIComponent("Email or password is incorrect.")}`);
  }

  await createSession(principal.user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
