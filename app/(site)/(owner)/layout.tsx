import { requireOwner } from "@/src/lib/owner";
import { OwnerNav } from "./owner-nav";

export default async function OwnerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireOwner();
  return (
    <>
      <OwnerNav />
      {children}
    </>
  );
}
