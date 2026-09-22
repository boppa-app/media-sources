import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const script = (name: string, runAt = "document-end", body = "(function() {})();\n") =>
  `// ==UserScript==\n// @name         ${name}\n// @run-at       ${runAt}\n// ==/UserScript==\n\n${body}`;

export const baseManifest = {
  id: "example.com",
  version: "1.0.0",
  name: "Example",
  url: "example.com",
};

export function makeSource(files: Record<string, string | object>): string {
  const dir = mkdtempSync(join(tmpdir(), "boppa-source-"));
  const all: Record<string, string | object> = {
    "manifest.json": baseManifest,
    "data/search/songs.js": "postResult({ items: [] });\n",
    "playback/index.html": "<!doctype html><html></html>\n",
    "playback/01-bridge.js": script("Bridge", "document-start"),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    if (content === undefined) continue;
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}
