import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { connection } from "next/server";

export const ownerAuthConfigured = Boolean(
  process.env.NEXTAUTH_SECRET &&
  process.env.GOOGLE_AUTH_CLIENT_ID &&
  process.env.GOOGLE_AUTH_CLIENT_SECRET &&
  process.env.OWNER_GOOGLE_EMAIL,
);

function ownerEmail(email: unknown) {
  return typeof email === "string" && email.toLowerCase() === process.env.OWNER_GOOGLE_EMAIL?.trim().toLowerCase();
}

export const authOptions: NextAuthOptions = {
  providers: ownerAuthConfigured ? [
    GoogleProvider({
      clientId: process.env.GOOGLE_AUTH_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET!,
    }),
  ] : [],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ account, profile }) {
      const google = profile as { email?: string; email_verified?: boolean; sub?: string; hd?: string } | undefined;
      const subject = process.env.OWNER_GOOGLE_SUB?.trim();
      if (account?.provider !== "google" || !google?.email_verified || !ownerEmail(google.email)) return false;
      return subject ? google.sub === subject : Boolean(google.email?.toLowerCase().endsWith("@gmail.com") || google.hd);
    },
    jwt({ token, account }) {
      if (account?.provider === "google") token.sub = account.providerAccountId;
      return token;
    },
    session({ session, token }) {
      const subject = process.env.OWNER_GOOGLE_SUB?.trim();
      if (!ownerEmail(token.email) || (subject && subject !== token.sub)) return { ...session, user: undefined };
      return session;
    },
  },
};

export async function isOwner() {
  await connection();
  if (!ownerAuthConfigured) return false;
  const session = await getServerSession(authOptions);
  return ownerEmail(session?.user?.email);
}

export async function requireOwner(): Promise<void> {
  if (!(await isOwner())) redirect("/login");
}
