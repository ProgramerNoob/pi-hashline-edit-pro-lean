// pi-hashline-edit-pro-lean: full pi-hashline-edit-pro@6.4.6 runtime,
// with concise provider-facing tool/command text and local collapsed-display support.
//
// Design: delegate 100% of the runtime to upstream by calling its default
// export with a proxied `pi`. Only model-visible text differs, and it is
// upstream's own wording condensed: short tool descriptions and snippets,
// guidelines kept only where a slip silently produces a wrong edit, and
// parameter schemas without per-field descriptions except upstream's text for
// range bounds, copy/move source and destination, and replace/insert text.
// No rule of our own is added; defaults, behavior and error semantics are
// upstream's.
//
// 6.x contract: replace/insert take one exact `text` string ("" deletes in
// replace); the anchored search tool is named `grep`. Edit tools resolve the
// file from anchors alone; undo_last_change still requires `path`.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import upstream from "pi-hashline-edit-pro";
import { TEXT_ENDING_NOTE } from "pi-hashline-edit-pro/src/constants";

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

// Rule of thumb: a rule upstream already enforces at runtime (an error or hint
// that names the fix) is not repeated here; the model pays for it only when it
// trips it. Enforced upstream: range lines must be served before a non-empty
// replace (E_RANGE_STALE lists fresh anchors), same-message ranges are disjoint
// (E_BATCH_OVERLAP), path must match anchor ownership (E_BAD_SHAPE), anchor│
// prefixes in text are stripped (W_*), a copy/move gap inside the source is
// rejected (E_BAD_SHAPE), stale/dead anchors fail (E_STALE_ANCHOR), undo
// with nothing to undo (E_UNDO_*). A rule stays when breaking it silently
// gives a wrong result or loses something the error cannot give back (the
// single undo slot, escape decoding, the anchor-row format).
const DESC: Record<string, string> = {
  read: "Read a file as anchor│content rows (4-char anchors); supports paging and images.",
  replace: "Replace whole anchored lines.",
  replace_match: "Replace exact fragments within anchored lines.",
  insert: "Insert new lines before or after an anchor.",
  copy: "Copy an anchored block verbatim, within or across files.",
  move: "Move an anchored block verbatim, within or across files.",
  undo_last_change: "Undo a file's latest hashline edit.",
  grep: "Search files with ripgrep; hits are N:│ anchor│content rows (N-│ context), editable without a read.",
};
// Upstream's replace description points partial-line edits to replace_match
// and drops that sentence while replace_match is off; follow it.
const REPLACE_MATCH_ROUTE = " For part of a line, use replace_match.";

// Pi lists only tools that have a snippet under "Available tools" in the system prompt.
const SNIPPET: Record<string, string> = {
  read: "Read files with line anchors",
  replace: "Replace anchored lines",
  replace_match: "Replace fragments in lines",
  insert: "Insert lines at an anchor",
  copy: "Copy an anchored block",
  move: "Move an anchored block",
  undo_last_change: "Undo a file's last edit",
  grep: "Search with anchors",
};

// Condensed upstream guidelines (tool-prompts/*-guidelines.md and the shared
// ones in src/edit-common.ts), each line with its own label. `up` is the
// tool's upstream guideline list, so lines upstream shows only under some
// settings follow those settings. Rules shared by every edit tool sit on
// replace, which is always active; copy/move rules sit on copy (one toggle).
const has = (up: string[], marker: string) => up.some((line) => line.includes(marker));
const GUIDE: Record<string, (up: string[]) => string[]> = {
  read: (up) =>
    has(up, "post-edit diff")
      ? ["read: after an edit, + and space diff rows carry live anchors and - rows are dead; read again only for anchors you lack."]
      : has(up, "call again after an edit")
        ? ["read: call again after an edit when you need anchors you lack."]
        : [],
  replace: (up) => [
    "replace: one line uses the same anchor twice. A pure deletion checks only the boundary lines and removes the interior as it stands.",
    `edit tools: text is the exact content without anchor prefixes; escapes are decoded once, so \\uXXXX is the character and \\\\uXXXX stays literal. ${TEXT_ENDING_NOTE}`,
    "edit tools: same-file calls in one message form one batch; one undo reverts all.",
    ...(has(up, "Script calls apply immediately")
      ? ["edit tools: codemode script calls apply immediately in order, and only the most recent edit per file is undoable."]
      : []),
  ],
  replace_match: () => [
    "replace_match: old_string is only the fragment that changes; every match in the range changes, so scope the range to the lines that should change. If old_string covers the line except indentation and trailing punctuation, use replace.",
  ],
  insert: () => ["insert: check the diff for a missing or extra blank row at block edges."],
  copy: () => [
    "copy/move: move takes copy's fields. To append to a file, anchor its last line with direction after, not a marker line or the block's own end. Only the source's boundary rows and the destination line need reading.",
  ],
  move: () => [],
  undo_last_change: (up) => [
    "undo_last_change: one slot per file; undo before any other edit or write to that file.",
    ...(has(up, "cross-file `move`")
      ? ["undo_last_change: undo a cross-file move on both files; undoing one side leaves lines duplicated or missing."]
      : []),
  ],
  grep: () => [
    "grep: set literal: true when the pattern contains regex metacharacters. A match shown as a ... fragment has an anchor covering the whole line.",
  ],
};
// Upstream lines passed through verbatim: the tool-preference line (upstream
// repeats it on every tool; kept once, on read) and codemode-only lines.
const PASS_THROUGH = (line: string, name: string) =>
  (name === "read" && line.startsWith("Remember to use the hashline tools")) || line.includes("codemode script");

// Field descriptions that survive stripping, kept as upstream wrote them except
// TEXT_ENDING_NOTE, which the shared edit rule states once. Without them the model
// guesses range bounds (off-by-one), adds blank lines at insert edges, or puts a
// copy anchor in the wrong file. move has the same fields; the copy/move rule says so.
const PARAM_DESC: Record<string, string[]> = {
  replace: ["remove_from", "remove_to", "text"],
  replace_match: ["replace_from", "replace_to"],
  insert: ["text"],
  copy: ["source_from", "source_to", "anchor"],
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

// Argument repair, run by Pi before schema validation (`prepareArguments`),
// chained after upstream's own. Only unambiguous slips are fixed; everything
// else is returned as is for upstream's validation to report. Models still
// send the retired 4.x field names: `replacement_text` / `replacement_lines`
// for replace and `lines` for insert are the exact-text field `text` (an array
// is joined by upstream's own prepare). Never overwrites a different `text`.
// `ref` is not a field; it is dropped only when it names the same file as `path`.
// remove_to is not defaulted: upstream documents it as required (a single line
// repeats the anchor), and a missing path or anchor cannot be inferred.
const TEXT_ALIASES: Record<string, string[]> = {
  replace: ["replacement_text", "replacement_lines"],
  insert: ["lines"],
};

const sameFile = (ref: string, path: string) => {
  const a = ref.replaceAll("\\", "/").replace(/^\.\//, "");
  const b = path.replaceAll("\\", "/");
  return a.length > 0 && (b === a || b.endsWith(`/${a}`));
};

function repairEditArguments(name: string, args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const out = { ...(args as Record<string, unknown>) };
  for (const alias of TEXT_ALIASES[name] ?? []) {
    if (alias in out && out.text === undefined) {
      out.text = out[alias];
      delete out[alias];
    }
  }
  if (typeof out.ref === "string" && typeof out.path === "string" && sameFile(out.ref, out.path)) delete out.ref;
  return out;
}

function chainPrepare(name: string, upstream: unknown): (args: unknown) => unknown {
  const prepare = typeof upstream === "function" ? (upstream as (args: unknown) => unknown) : (args: unknown) => args;
  return (args) => prepare(repairEditArguments(name, prepare(args)));
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

// Puts upstream's descriptions of the kept fields back onto a stripped copy.
function keepParamDescriptions(
  original: Record<string, unknown>,
  stripped: Record<string, unknown>,
  fields: string[] | undefined,
): Record<string, unknown> {
  type Props = Record<string, Record<string, unknown>> | undefined;
  const from = original.properties as Props;
  const to = stripped.properties as Props;
  for (const field of fields ?? []) {
    const text = from?.[field]?.description;
    if (to?.[field] && typeof text === "string") to[field].description = text.replace(` ${TEXT_ENDING_NOTE}`, "");
  }
  return stripped;
}

function trimTool(tool: AnyTool): AnyTool {
  const out: AnyTool = { ...tool };
  const name = out.name ?? "";
  if (!PARAMS.has(name)) return out;
  const upstreamDesc = tool.description ?? "";
  // On gated models or with anchorGrepEnabled off, upstream registers Pi's plain
  // read/grep (no anchors); they keep their own text.
  if ((name === "read" || name === "grep") && !upstreamDesc.includes("anchor│")) return out;
  const upstreamGuide = tool.promptGuidelines ?? [];
  const upstreamLines = Array.isArray(upstreamGuide) ? upstreamGuide : [upstreamGuide];
  out.description = DESC[name] + (name === "replace" && upstreamDesc.includes("`replace_match`") ? REPLACE_MATCH_ROUTE : "");
  out.promptSnippet = SNIPPET[name];
  if (name in TEXT_ALIASES) out.prepareArguments = chainPrepare(name, tool.prepareArguments);
  const lines = [...(GUIDE[name]?.(upstreamLines) ?? []), ...upstreamLines.filter((line) => PASS_THROUGH(line, name))];
  if (lines.length > 0) out.promptGuidelines = lines;
  else delete out.promptGuidelines;
  if (out.parameters) {
    out.parameters = keepParamDescriptions(
      out.parameters,
      stripDescriptions(out.parameters) as Record<string, unknown>,
      PARAM_DESC[name],
    );
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

// Full upstream lifecycle (session registry, auto-read-all, batch, config,
// defaults, write hook) runs unchanged; only the text the model sees is
// trimmed by the proxy above.
export default function (pi: ExtensionAPI): void {
  upstream(leanPi(pi));
}
