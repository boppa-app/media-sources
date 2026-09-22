import { readFileSync } from "node:fs";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { headerPayloadFits } from "./header.ts";
import { isSafePath } from "./paths.ts";
import { parseUserScriptMetadata, type UserScriptMetadata } from "./userscript.ts";

export type InjectionTime = "atDocumentStart" | "atDocumentEnd";

export interface ContextConfig {
  title: string;
  url: string;
  intervalSeconds: number;
  customUserAgent?: string;
}

export interface PopupConfig {
  title: string;
  url: string;
  customUserAgent?: string;
}

export interface Manifest {
  $schema?: string;
  id: string;
  version: string;
  name: string;
  url: string;
  author?: string;
  highlightColor?: string;
  allowedUrls?: string[];
  playbackUrl?: string;
  playbackUserAgent?: string;
  context?: Record<string, ContextConfig>;
  popup?: Record<string, PopupConfig>;
}

export interface AppConfig {
  $schema?: string;
  format: 1;
  defaultMediaSources: string[];
}

export interface UserScript extends UserScriptMetadata {
  file: string;
}

export const MANIFEST_FILE = "manifest.json";
export const ICON_FILE = "icon.svg";
export const PLAYBACK_DIR = "playback";
export const PLAYBACK_HTML_FILE = `${PLAYBACK_DIR}/index.html`;

export const DATA_SCRIPTS = {
  search: ["songs", "videos", "albums", "artists", "playlists"],
  list: ["album", "playlist", "artistSongs", "artistVideos", "artistAlbums", "artistPlaylists", "trackRadio"],
  get: ["artist", "song", "video", "album", "playlist"],
} as const;

export type DataGroup = keyof typeof DATA_SCRIPTS;

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export class ValidationError extends Error {
  readonly problems: string[];

  constructor(subject: string, problems: string[]) {
    super(`${subject} is invalid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

const schemaUrl = (name: string) => new URL(`../../../schema/${name}`, import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: false });
let manifestValidator: ValidateFunction | undefined;
let appConfigValidator: ValidateFunction | undefined;

function compile(name: string): ValidateFunction {
  return ajv.compile(JSON.parse(readFileSync(schemaUrl(name), "utf8")));
}

function describeSchemaErrors(errors: ErrorObject[] | null | undefined): string[] {
  return [...new Set((errors ?? []).map((e) => {
    const at = e.instancePath || "(root)";
    if (e.keyword === "additionalProperties") {
      return `${at}: unknown field "${(e.params as { additionalProperty: string }).additionalProperty}"`;
    }
    return `${at}: ${e.message}`;
  }))];
}

export function parseJson(text: string, subject: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ValidationError(subject, [`not valid JSON: ${(error as Error).message}`]);
  }
}

export function validateAppConfig(value: unknown): AppConfig {
  appConfigValidator ??= compile("iOS-config.v1.schema.json");
  if (!appConfigValidator(value)) {
    throw new ValidationError("iOS-config.json", describeSchemaErrors(appConfigValidator.errors));
  }
  return value as AppConfig;
}

export function userScripts(files: Map<string, Buffer>, dir: string): UserScript[] {
  const prefix = `${dir}/`;
  return [...files.keys()]
    .filter((path) => path.startsWith(prefix) && path.endsWith(".js") && !path.slice(prefix.length).includes("/"))
    .sort(compareBytes)
    .map((file) => ({ file, ...parseUserScriptMetadata(files.get(file)!.toString("utf8")) }));
}

export function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

export function validateSource(
  subject: string,
  manifestValue: unknown,
  files: Map<string, Buffer>,
): Manifest {
  manifestValidator ??= compile("manifest.v1.schema.json");
  if (!manifestValidator(manifestValue)) {
    throw new ValidationError(subject, describeSchemaErrors(manifestValidator.errors));
  }
  const manifest = manifestValue as Manifest;
  const problems: string[] = [];

  if (!headerPayloadFits(manifest.id, manifest.version)) {
    problems.push("id and version are too long to fit in the 256-byte package header");
  }

  const hasPlaybackHtml = files.has(PLAYBACK_HTML_FILE);
  if (hasPlaybackHtml && manifest.playbackUrl !== undefined) {
    problems.push(`use either ${PLAYBACK_HTML_FILE} or "playbackUrl" in manifest.json, not both`);
  } else if (!hasPlaybackHtml && manifest.playbackUrl === undefined) {
    problems.push(`add ${PLAYBACK_HTML_FILE} or set "playbackUrl" in manifest.json`);
  }

  const contextKeys = new Set(Object.keys(manifest.context ?? {}));
  const popupIds = new Set(Object.keys(manifest.popup ?? {}));
  let totalBytes = 0;
  let dataScriptCount = 0;

  for (const [path, data] of files) {
    totalBytes += data.length;
    if (!isSafePath(path)) {
      problems.push(`${path}: file names may only contain letters, digits, ".", "_" and "-"`);
      continue;
    }
    let text: string | undefined;
    try {
      text = utf8.decode(data);
    } catch {
      problems.push(`${path}: not valid UTF-8`);
    }

    const parts = path.split("/");
    const userScriptDir = parts.length >= 2 && parts.at(-1)!.endsWith(".js") ? parts.slice(0, -1).join("/") : undefined;

    if (path === ICON_FILE) {
      if (text !== undefined && !/<svg[\s>]/.test(text)) problems.push(`${path}: does not contain an <svg> element`);
    } else if (path === PLAYBACK_HTML_FILE) {
      continue;
    } else if (parts[0] === "data") {
      const names = DATA_SCRIPTS[parts[1] as DataGroup] as readonly string[] | undefined;
      if (parts.length !== 3 || !names?.includes(parts[2].replace(/\.js$/, "")) || !parts[2].endsWith(".js")) {
        problems.push(`${path}: not a known data script; expected one of ${describeDataScripts()}`);
      } else {
        dataScriptCount++;
      }
    } else if (userScriptDir !== undefined && isUserScriptDir(userScriptDir, contextKeys, popupIds)) {
      if (text !== undefined) {
        try {
          parseUserScriptMetadata(text);
        } catch (error) {
          problems.push(`${path}: ${(error as Error).message}`);
        }
      }
    } else if (parts[0] === "context" && parts.length === 3 && !contextKeys.has(parts[1])) {
      problems.push(`${path}: "${parts[1]}" is not a key of "context" in manifest.json`);
    } else if (parts[0] === "popup" && parts.length === 3 && !popupIds.has(parts[1])) {
      problems.push(`${path}: "${parts[1]}" is not a key of "popup" in manifest.json`);
    } else {
      problems.push(`${path}: not part of the package layout`);
    }
  }

  if (totalBytes > MAX_SOURCE_BYTES) {
    problems.push(`source is ${totalBytes} bytes, the limit is ${MAX_SOURCE_BYTES}`);
  }
  if (dataScriptCount === 0) problems.push("no data scripts found under data/");

  if (problems.length > 0) throw new ValidationError(subject, problems);
  return manifest;
}

function isUserScriptDir(dir: string, contextKeys: Set<string>, popupIds: Set<string>): boolean {
  if (dir === PLAYBACK_DIR) return true;
  const [kind, key, ...rest] = dir.split("/");
  if (rest.length > 0) return false;
  return (kind === "context" && contextKeys.has(key)) || (kind === "popup" && popupIds.has(key));
}

function describeDataScripts(): string {
  return Object.entries(DATA_SCRIPTS)
    .map(([group, names]) => `data/${group}/{${names.join(",")}}.js`)
    .join(", ");
}
