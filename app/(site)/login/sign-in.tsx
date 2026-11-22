"use client";

import { signIn, signOut } from "next-auth/react";

export function GoogleSignIn({ className = "btn" }: { className?: string }) {
  return <button type="button" className={className} onClick={() => void signIn("google", { callbackUrl: "/admin" })}>Continue with Google</button>;
}

export function GoogleSignOut({ className = "btn btn--quiet" }: { className?: string }) {
  return <button type="button" className={className} onClick={() => void signOut({ callbackUrl: "/" })}>Sign out</button>;
}
