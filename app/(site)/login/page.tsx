import { redirect } from "next/navigation";
import { isOwner, ownerAuthConfigured } from "@/src/lib/owner";
import { Opener, TextRow } from "../_parts/opener";
import { GoogleSignIn } from "./sign-in";

export const metadata = { title: "Owner sign-in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isOwner()) redirect("/admin");
  const { error } = await searchParams;
  return <>
    <Opener>
      <h1>Owner sign-in</h1>
    </Opener>
    <TextRow>
      <div className="form">
        <p>Sign in with the owner&rsquo;s Google account to plan sessions and log workouts.</p>
        {error && <p className="notice notice--alert" role="alert">Sign-in did not complete. Choose the Google account that is set up as the owner, then try again.</p>}
        {ownerAuthConfigured
          ? <div className="form-actions"><GoogleSignIn /></div>
          : <p className="notice">Owner sign-in is not available yet: Google OAuth has not been configured on this server.</p>}
      </div>
    </TextRow>
  </>;
}
