import fs from "fs";
import path from "path";
import { z } from "zod";

const manifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  path: z.string(),
  entry: z.string().nullable(),
  apiBase: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export type ProjectManifest = z.infer<typeof manifestSchema>;

function monorepoRoot(): string {
  const cwd = process.cwd();
  // Next.js может запускать сервер с разным `cwd`, поэтому ищем корень по маркеру.
  const candidates = [
    path.resolve(cwd, "../.."),
    path.resolve(cwd, "../../.."),
    path.resolve(cwd, ".."),
    path.resolve(cwd),
  ];

  for (const root of candidates) {
    if (fs.existsSync(path.join(root, "apps", "portal", "project.manifest.json"))) {
      return root;
    }
  }

  return candidates[0];
}

function collectManifestFiles(dir: string, acc: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (!ent.isDirectory()) continue;
    const manifestPath = path.join(full, "project.manifest.json");
    if (fs.existsSync(manifestPath)) acc.push(manifestPath);
  }
}

export function loadProjectRegistry(): ProjectManifest[] {
  const root = monorepoRoot();
  const files: string[] = [];

  const projectsRoot = path.join(root, "projects");
  if (fs.existsSync(projectsRoot)) {
    for (const lang of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!lang.isDirectory()) continue;
      collectManifestFiles(path.join(projectsRoot, lang.name), files);
    }
  }

  const portalManifest = path.join(root, "apps", "portal", "project.manifest.json");
  if (fs.existsSync(portalManifest)) files.push(portalManifest);

  const byId = new Map<string, ProjectManifest>();
  for (const file of files) {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) continue;
    byId.set(parsed.data.id, parsed.data);
  }

  const list = [...byId.values()];
  list.sort((a, b) => {
    if (a.id === "portal") return -1;
    if (b.id === "portal") return 1;
    return a.name.localeCompare(b.name, "ru");
  });
  return list;
}
