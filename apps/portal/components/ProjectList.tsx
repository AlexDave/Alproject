import Link from "next/link";
import type { ProjectManifest } from "@/lib/registry";

function ProjectEntryLink({ entry }: { entry: string | null }) {
  if (!entry) {
    return <span className="portal-project-entry portal-project-entry-none">без веб-URL</span>;
  }
  if (entry.startsWith("http://") || entry.startsWith("https://")) {
    return (
      <a
        className="portal-project-entry"
        href={entry}
        aria-label={`Открыть ${entry}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Открыть
      </a>
    );
  }
  return (
    <Link className="portal-project-entry" href={entry}>
      Открыть
    </Link>
  );
}

export function ProjectList({ projects }: { projects: ProjectManifest[] }) {
  return (
    <section className="portal-registry" aria-label="Зарегистрированные проекты">
      <div className="portal-registry-header">
        <h2 className="portal-registry-title">Проекты</h2>
        <span className="portal-registry-count">{projects.length}</span>
      </div>
      <ul className="portal-registry-list">
        {projects.map((p) => (
          <li key={p.id} className="portal-registry-item">
            <div className="portal-project-card">
              <div className="portal-project-head">
                <span className="portal-project-name">{p.name}</span>
                <span className="portal-project-type">{p.type}</span>
              </div>
              {p.description ? <p className="portal-project-desc">{p.description}</p> : null}
              {p.tags && p.tags.length > 0 ? (
                <ul className="portal-project-tags">
                  {p.tags.map((t) => (
                    <li key={t} className="portal-project-tag">
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="portal-project-meta">
                <code className="portal-project-path" title={p.path}>
                  {p.path}
                </code>
                <ProjectEntryLink entry={p.entry ?? null} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
