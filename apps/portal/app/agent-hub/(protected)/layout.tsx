import { redirect } from "next/navigation";
import { readHubAuthFromRequest } from "@/lib/hub-auth";

export default async function AgentHubProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await readHubAuthFromRequest();
  if (!auth.ok) {
    redirect("/agent-hub/login");
  }
  return <>{children}</>;
}
