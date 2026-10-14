// pi-hashline-edit-pro-lean: full pi-hashline-edit-pro@6.4.5 runtime,
// with concise provider-facing tool/command text and local collapsed-display support.
//
// Design: delegate 100% of the runtime to upstream by calling its default
// export with a proxied `pi`. Only model-visible text differs: short tool
// descriptions, one-line guidelines, parameter schemas without per-field
// descriptions, and short command descriptions. Upstream behavior and error
// semantics stay intact. One default differs: copy/move and replace_match
// start off (seeded into the shared upstream config, so /hashline-config
// shows and toggles the real state).
//
// 6.x contract: replace/insert take one exact `text` string ("" deletes in
// replace); the anchored search tool is named `grep`. Edit tools resolve the
// file from anchors alone; undo_last_change still requires `path`.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import upstream from "pi-hashline-edit-pro";
import { configPath } from "pi-hashline-edit-pro/src/paths";

const COLLAPSED_DISPLAY_SERVICE = Symbol.for(
  "@local/pi-collapsed-tools.display-service.v1",
);

type CollapsedDisplayTool = { name: string };
type CollapsedDisplayService = {
  readonly version: 1;
  decorate<T extends CollapsedDisplayTool>(tool: T): T;
};

function decorateWithCollapsedDisplay<T extends CollapsedDisplayTool>(tool: T): T {
  const services = globalThis as unknown as Record<PropertyKey, unknown>;
  const candidate = services[COLLAPSED_DISPLAY_SERVICE];
  if (!candidate || typeof candidate !== "object") return tool;
  const service = candidate as Partial<CollapsedDisplayService>;
  return service.version === 1 && typeof service.decorate === "function"
    ? service.decorate(tool)
    : tool;
}

const DESC: Record<string, string> = {
  read: "Read a file with 4-char HASH anchors; supports paging and images.",
  replace: "Replace lines by bare 4-char HASH anchors; anchor-only, no path.",
  replace_match: "Replace an exact substring inside an anchored line range; anchor-only.",
  insert: "Insert text around a bare 4-char HASH anchor; anchor-only.",
  copy: "Copy an anchored line range to another anchor, in any file.",
  move: "Move an anchored line range to another anchor, in any file.",
  undo_last_change: "Undo the most recent hashline edit for a file; needs path.",
  grep: "Search text with ripgrep; hits carry anchors for direct editing.",
};

const GUIDE: Record<string, string> = {
  read: "Use fresh anchors from read output; re-read after edits.",
  replace: "Anchors resolve the file; do not pass path unless parameters list it. text is the exact raw content, no HASH prefixes; \"\" deletes. Same-file calls in one message form one batch; follow +anchor rows in the diff. Re-read after failure.",
  replace_match: "old_string is only the changing fragment; every match in the range is replaced. Whole-line changes use replace.",
  insert: "Anchor resolves the file; do not pass path unless parameters list it. text is the exact raw content; the anchor line stays. Re-read after failure.",
  copy: "Destination must be outside the source range; to append, anchor the file's last line with direction after.",
  move: "Destination must be outside the source range; re-read the source file after a cross-file move.",
  undo_last_change: "Needs path. Only the latest edit per file; write clears it. Re-read if stale.",
  grep: "Use returned anchors directly in edits; narrow path, glob, or limit; literal: true for metacharacters.",
};

const CMD_DESC: Record<string, string> = {
  "hashline-config": "Open hashline settings: read, grep, copy/move, replace_match, path, diff.",
  "clear-anchors": "Clear session anchor claims; re-read to reclaim.",
};

const PARAMS = new Set(Object.keys(DESC));

type AnyTool = {
  name: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string | string[];
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
};

type AnyCommand = {
  description?: string;
  [key: string]: unknown;
};

function toGuidelineLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (!value || typeof value !== "object") return value;

  const out = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "description") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) descriptor.value = stripDescriptions(descriptor.value);
    Object.defineProperty(out, key, descriptor);
  }
  return out;
}

function trimTool(tool: AnyTool): AnyTool {
  const out: AnyTool = { ...tool };
  const name = out.name ?? "";
  if (DESC[name]) out.description = DESC[name];
  delete out.promptSnippet;
  if (GUIDE[name]) out.promptGuidelines = toGuidelineLines(GUIDE[name]).map((line) => `${name}: ${line}`);
  if (out.parameters && PARAMS.has(name)) {
    out.parameters = stripDescriptions(out.parameters) as Record<string, unknown>;
  }
  return out;
}

function trimCommand(name: string, cmd: AnyCommand): AnyCommand {
  if (!cmd || typeof cmd !== "object") return cmd;
  if (!CMD_DESC[name] || typeof cmd.description !== "string") return cmd;
  return { ...cmd, description: CMD_DESC[name] };
}

function leanPi(pi: ExtensionAPI): ExtensionAPI {
  return new Proxy(pi, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (tool: AnyTool) => target.registerTool(
          decorateWithCollapsedDisplay(trimTool(tool)) as never,
        );
      }
      if (prop === "registerCommand") {
        const register = Reflect.get(target, prop, receiver) as unknown;
        if (typeof register !== "function") return register;
        return (name: string, cmd: AnyCommand) =>
          (register as (n: string, c: AnyCommand) => unknown).call(
            target,
            name,
            trimCommand(name, cmd),
          );
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Lean defaults for settings the user has never set. Upstream defaults both
// to true; writing only missing keys keeps any explicit user choice.
const LEAN_DEFAULTS: Record<string, boolean> = {
  copyMoveEnabled: false,
  replaceMatchEnabled: false,
};

function seedLeanDefaults(): void {
  const file = configPath();
  let config: unknown = {};
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    // Unreadable or corrupt files are left for upstream to report or quarantine.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) return;
  const record = config as Record<string, unknown>;
  const missing = Object.keys(LEAN_DEFAULTS).filter((key) => typeof record[key] !== "boolean");
  if (missing.length === 0) return;
  for (const key of missing) record[key] = LEAN_DEFAULTS[key];
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.lean.tmp`;
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(temp, file);
  } catch {
    // Read-only config: upstream defaults apply.
  }
}

// Full upstream lifecycle (session registry, auto-read-all, batch,
// config overlay, write hook) runs unchanged; only the text the model
// sees is trimmed by the proxy above. Defaults are seeded before upstream
// reads the config on session_start.
export default function (pi: ExtensionAPI): void {
  seedLeanDefaults();
  upstream(leanPi(pi));
}
