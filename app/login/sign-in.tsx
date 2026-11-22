"use client";

import { signIn, signOut } from "next-auth/react";

export function GoogleSignIn() {
  return <button type="button" onClick={() => void signIn("google", { callbackUrl: "/admin" })}>Continue with Google</button>;
}

export function GoogleSignOut() {
  return <button type="button" onClick={() => void signOut({ callbackUrl: "/" })}>Sign out</button>;
}
