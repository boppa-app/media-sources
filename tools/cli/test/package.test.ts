import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { HEADER_SIZE, parseHeader } from "../src/header.ts";
import { userScripts, ValidationError } from "../src/manifest.ts";
import { contentHash, loadSourceDir, pack, readPackage } from "../src/package.ts";
import { readZip } from "../src/zip.ts";
import { baseManifest, makeSource, script } from "./helpers.ts";

const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationError) return error.problems;
    throw error;
  }
  assert.fail("expected a ValidationError");
};

test("header is readable from the first bytes alone", () => {
  const bytes = pack(loadSourceDir(makeSource({})));
  assert.deepEqual(parseHeader(bytes.subarray(0, HEADER_SIZE)), {
    format: 1,
    id: "example.com",
    version: "1.0.0",
  });
  assert.equal(HEADER_SIZE, 296);
});

test("header rejects bytes that are not a .boppa header", () => {
  assert.throws(() => parseHeader(Buffer.alloc(HEADER_SIZE)), /signature/);
  const bytes = pack(loadSourceDir(makeSource({})));
  const tampered = Buffer.from(bytes.subarray(0, HEADER_SIZE));
  tampered[60] ^= 1;
  assert.throws(() => parseHeader(tampered), /checksum/);
});

test("packing is deterministic and round-trips", () => {
  const dir = makeSource({});
  const a = pack(loadSourceDir(dir));
  const b = pack(loadSourceDir(dir));
  assert.deepEqual(a, b);
  const pkg = readPackage(a);
  assert.equal(contentHash(pkg), contentHash(loadSourceDir(dir)));
  assert.deepEqual([...readZip(a).keys()].slice(0, 2), ["boppa.json", "manifest.json"]);
});

test("user scripts come from metadata blocks, ordered by file name", () => {
  const source = loadSourceDir(makeSource({
    "playback/02-player.js": script("Player"),
    "playback/10-late.js": script("Late", "document-idle"),
  }));
  assert.deepEqual(userScripts(source.files, "playback").map((s) => [s.file, s.name, s.injectionTime]), [
    ["playback/01-bridge.js", "Bridge", "atDocumentStart"],
    ["playback/02-player.js", "Player", "atDocumentEnd"],
    ["playback/10-late.js", "Late", "atDocumentEnd"],
  ]);
});

test("user scripts without a valid metadata block are rejected", () => {
  const problems = problemsOf(() => loadSourceDir(makeSource({
    "playback/02-no-header.js": "(function() {})();\n",
    "playback/03-no-name.js": "// ==UserScript==\n// @run-at document-end\n// ==/UserScript==\n",
    "playback/04-bad-run-at.js": script("Bad", "context-menu"),
    "playback/05-match.js": "// ==UserScript==\n// @name X\n// @match *://*/*\n// ==/UserScript==\n",
    "playback/06-unclosed.js": "// ==UserScript==\n// @name X\n",
  })));
  assert.equal(problems.length, 5);
  assert.match(problems.join("\n"), /02-no-header\.js: must start with/);
  assert.match(problems.join("\n"), /03-no-name\.js: metadata block is missing @name/);
  assert.match(problems.join("\n"), /04-bad-run-at\.js: @run-at context-menu is not supported/);
  assert.match(problems.join("\n"), /05-match\.js: @match is not supported/);
  assert.match(problems.join("\n"), /06-unclosed\.js: metadata block is not closed/);
});

test("playback needs exactly one of index.html or playbackUrl", () => {
  const dir = makeSource({ "manifest.json": { ...baseManifest, playbackUrl: "https://example.com/player" } });
  assert.match(problemsOf(() => loadSourceDir(dir)).join(), /not both/);
  rmSync(join(dir, "playback/index.html"));
  assert.equal(loadSourceDir(dir).manifest.playbackUrl, "https://example.com/player");
  rmSync(join(dir, "manifest.json"));
  const noPlayback = makeSource({});
  rmSync(join(noPlayback, "playback/index.html"));
  assert.match(problemsOf(() => loadSourceDir(noPlayback)).join(), /add playback\/index\.html/);
});

test("context and popup scripts live in folders named after manifest keys", () => {
  const source = loadSourceDir(makeSource({
    "manifest.json": {
      ...baseManifest,
      context: { session: { title: "Session", url: "https://example.com", intervalSeconds: 1800 } },
      popup: { login: { title: "Log In", url: "https://example.com/login" } },
    },
    "context/session/01-capture.js": script("Capture Session"),
    "popup/login/01-detect.js": script("Detect Login"),
  }));
  assert.equal(userScripts(source.files, "context/session")[0].name, "Capture Session");
  assert.equal(userScripts(source.files, "popup/login")[0].name, "Detect Login");

  const problems = problemsOf(() => loadSourceDir(makeSource({
    "context/missing/01-x.js": script("X"),
    "popup/nope/01-x.js": script("X"),
  })));
  assert.match(problems.join("\n"), /"missing" is not a key of "context"/);
  assert.match(problems.join("\n"), /"nope" is not a key of "popup"/);
});

test("unknown files and data scripts are rejected", () => {
  const problems = problemsOf(() => loadSourceDir(makeSource({
    "data/search/song.js": "",
    "notes.txt": "hi",
    "playback/nested/x.js": script("X"),
  })));
  assert.match(problems.join("\n"), /data\/search\/song\.js: not a known data script/);
  assert.match(problems.join("\n"), /notes\.txt: not part of the package layout/);
  assert.match(problems.join("\n"), /playback\/nested\/x\.js: not part of the package layout/);
});

test("manifest fields are checked against the schema", () => {
  const problems = problemsOf(() => loadSourceDir(makeSource({
    "manifest.json": { ...baseManifest, version: "", playback: {}, highlightColor: "white" },
  })));
  assert.match(problems.join("\n"), /unknown field "playback"/);
  assert.match(problems.join("\n"), /\/version/);
  assert.match(problems.join("\n"), /\/highlightColor/);
});

test("id and version must fit in the header", () => {
  const problems = problemsOf(() => loadSourceDir(makeSource({
    "manifest.json": { ...baseManifest, version: "x".repeat(250) },
  })));
  assert.match(problems.join(), /256-byte package header/);
});
