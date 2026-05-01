import Link from "next/link";
import { greeting } from "@alproject/shared";
import { ProjectList } from "@/components/ProjectList";
import { loadProjectRegistry } from "@/lib/registry";

export default async function HomePage() {
  const projects = loadProjectRegistry();

  return (
    <main className="portal-home">
      <header className="portal-header">
        <div className="portal-header-left">
          <h1 className="portal-home-title">Портал</h1>
          <p className="portal-home-lead">{greeting()}</p>
          <p className="portal-home-subtitle">
            Каталог проектов и точка входа в Hub экосистеме Alproject.
          </p>
        </div>
        <div className="portal-header-right">
          <Link className="portal-project-link" href="/agent-hub/login">
            Hub агента Cursor
          </Link>
        </div>
      </header>
      <ProjectList projects={projects} />
    </main>
  );
}
