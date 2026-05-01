import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { getAgentHub } from "@/lib/agent-hub-store";
import { HubAutoRefresh } from "./HubAutoRefresh";
import { LogoutButton } from "./LogoutButton";
import { AgentDialogsView } from "./AgentDialogsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgentHubPage() {
  noStore();
  const { dialogs } = await getAgentHub();
  const hasData = dialogs.some((d) => d.updatedAt !== new Date(0).toISOString());

  return (
    <main className="agent-hub">
      <HubAutoRefresh intervalMs={5000} />
      <header className="agent-hub-header">
        <h1 className="agent-hub-title">Состояние агента Cursor</h1>
        <div className="agent-hub-actions">
          <LogoutButton />
          <Link className="agent-hub-link" href="/">
            На главную
          </Link>
        </div>
      </header>
      <p className="agent-hub-meta">
        {hasData
          ? `Диалогов агентов: ${dialogs.length}`
          : "Ещё не было данных от агентов. Запустите relay и дождитесь первого ingest."}
      </p>
      <AgentDialogsView dialogs={dialogs} gatewayIngestMode={Boolean(process.env.AGENT_HUB_BACKEND_URL)} />
    </main>
  );
}
