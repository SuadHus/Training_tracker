import { redirect } from "next/navigation";
import { isOwner, ownerAuthConfigured } from "@/src/lib/owner";
import { GoogleSignIn } from "./sign-in";

export const metadata = { title: "Owner sign-in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isOwner()) redirect("/admin");
  const { error } = await searchParams;
  return <>
    <header className="intro narrow">
      <h1>Owner sign-in</h1>
      <p className="lede">Sign in to plan sessions and log your workouts.</p>
    </header>
    <section className="public-panel login-card" aria-label="Google sign-in">
      {error && <p role="alert">Sign-in didn’t complete. Check that you selected the configured owner account.</p>}
      {ownerAuthConfigured ? <GoogleSignIn /> : <p>Owner sign-in is waiting for Google OAuth configuration.</p>}
    </section>
  </>;
}
