import { AgentHubMiniClient } from "./AgentHubMiniClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AgentHubMiniPage() {
  return (
    <main className="agent-hub-mini">
      <AgentHubMiniClient />
    </main>
  );
}
