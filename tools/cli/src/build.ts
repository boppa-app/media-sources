import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MANIFEST_FILE, ValidationError } from "./manifest.ts";
import { contentHash, loadSourceDir, pack, type Source } from "./package.ts";

export const SCHEMA_DIR = "schema";
export const INDEX_PATH = "index.json";
export const BASE_URL_VARIABLE = "BOPPA_BASE_URL";

const SOURCE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface IndexEntry {
  name: string;
  id: string;
  version: string;
  contentHash: string;
}

export interface Repo {
  sources: Map<string, Source>;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function defaultBaseUrl(): string {
  const configured = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
    boppa?: { baseUrl?: string };
  };
  return normalizeBaseUrl(process.env[BASE_URL_VARIABLE] || configured.boppa?.baseUrl || "");
}

export function packageUrl(baseUrl: string, name: string): string {
  return `${baseUrl}/${name}.boppa`;
}

export function loadRepo(root: string): Repo {
  const problems: string[] = [];
  const sources = new Map<string, Source>();
  const ids = new Map<string, string>();

  const names = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && existsSync(join(root, e.name, MANIFEST_FILE)))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    if (!SOURCE_NAME.test(name)) {
      problems.push(`${name}: folder names must be lowercase letters, digits and dashes`);
      continue;
    }
    try {
      const source = loadSourceDir(join(root, name));
      const existing = ids.get(source.manifest.id);
      if (existing) problems.push(`${name}: id "${source.manifest.id}" is already used by ${existing}`);
      ids.set(source.manifest.id, name);
      sources.set(name, source);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      problems.push(...error.problems.map((p) => `${name}: ${p}`));
    }
  }

  if (problems.length > 0) throw new ValidationError("Repository", problems);
  return { sources };
}

export function buildIndex(sources: Map<string, Source>): IndexEntry[] {
  return [...sources].map(([name, source]) => ({
    name,
    id: source.manifest.id,
    version: source.manifest.version,
    contentHash: contentHash(source),
  }));
}

export function build(root: string, outDir: string): Map<string, Buffer> {
  const { sources } = loadRepo(root);
  const output = new Map<string, Buffer>();
  const text = (value: string) => Buffer.from(value, "utf8");

  for (const [name, source] of sources) {
    output.set(`${name}.boppa`, pack(source));
  }
  output.set(INDEX_PATH, text(JSON.stringify(buildIndex(sources), null, 2) + "\n"));

  const schemaDir = join(root, SCHEMA_DIR);
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".json")).sort()) {
    output.set(`${SCHEMA_DIR}/${file}`, readFileSync(join(schemaDir, file)));
  }

  rmSync(outDir, { recursive: true, force: true });
  for (const [path, data] of output) {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return output;
}
