import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

process.env.HOME = mkdtempSync(join(tmpdir(), "pi-hashline-lean2-test-"));

const jiti = createJiti(import.meta.url, { interopDefault: true });
const hashlineExtension = (await jiti.import("../index.ts")).default;
const collapsedDisplayService = Symbol.for(
  "@local/pi-collapsed-tools.display-service.v1",
);
const expectedTools = [
  "read",
  "replace",
  "replace_match",
  "insert",
  "copy",
  "move",
  "grep",
  "undo_last_change",
];

function createPi(registered, commands) {
  return {
    registerTool(tool) {
      registered.push(tool);
    },
    registerCommand(name, cmd) {
      commands.push([name, cmd]);
    },
    on() {},
    getActiveTools() {
      return ["read", "bash", "write", "grep", ...expectedTools];
    },
    getAllTools() {
      return [];
    },
    setActiveTools() {},
  };
}

// Only the lean range/insert-edge/transfer field descriptions survive; everything else is stripped.
const KEPT_DESCRIPTIONS = {
  replace: ["properties.remove_from", "properties.remove_to", "properties.text"],
  replace_match: ["properties.replace_from", "properties.replace_to"],
  insert: ["properties.text"],
  copy: ["properties.source_from", "properties.source_to", "properties.anchor"],
};

function descriptionPaths(value, at = []) {
  if (!value || typeof value !== "object") return [];
  const own = "description" in value ? [at.join(".")] : [];
  return own.concat(
    Object.entries(value).flatMap(([key, child]) => descriptionPaths(child, [...at, key])),
  );
}

test("registers the upstream 6.4.6 tools with lean model-facing text", () => {
  const registered = [];
  const commands = [];
  const pi = createPi(registered, commands);
  const originalRegisterTool = pi.registerTool;

  hashlineExtension(pi);

  assert.equal(pi.registerTool, originalRegisterTool);
  assert.deepEqual(registered.map((tool) => tool.name), expectedTools);

  for (const tool of registered) {
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length < 100, `${tool.name} description is not lean`);
    // Pi lists a tool under "Available tools" only when it has a snippet.
    assert.equal(typeof tool.promptSnippet, "string");
    assert.ok(tool.promptSnippet.length < 50, `${tool.name} snippet is not lean`);
    assert.ok(tool.promptGuidelines === undefined || Array.isArray(tool.promptGuidelines));
    assert.deepEqual(descriptionPaths(tool.parameters), KEPT_DESCRIPTIONS[tool.name] ?? []);
    // The newline note is stated once in the shared edit rule, not per field.
    assert.ok(!JSON.stringify(tool.parameters).includes("A trailing line break"));
    assert.ok(Reflect.ownKeys(tool.parameters).includes("~kind"));
    assert.ok(Object.values(tool.parameters.properties).every((property) =>
      Reflect.ownKeys(property).includes("~kind"),
    ));
  }

  // 6.x contract: anchor-only edits (no path) take one exact `text` string.
  const replace = registered.find((tool) => tool.name === "replace");
  assert.deepEqual(Object.keys(replace.parameters.properties), [
    "remove_from",
    "remove_to",
    "text",
  ]);
  const insert = registered.find((tool) => tool.name === "insert");
  assert.deepEqual(Object.keys(insert.parameters.properties), [
    "anchor",
    "direction",
    "text",
  ]);
  const undo = registered.find((tool) => tool.name === "undo_last_change");
  assert.deepEqual(Object.keys(undo.parameters.properties), ["path"]);

  // Lean text must not teach retired 4.x names or fields.
  const visible = JSON.stringify([
    ...registered.map((tool) => [tool.description, tool.promptGuidelines, tool.parameters]),
    ...commands.map(([, cmd]) => cmd.description),
  ]);
  for (const stale of ["replacement_lines", "anchor_grep", "E_AUTO_READ_ALL", "one string per item"]) {
    assert.equal(visible.includes(stale), false, `model-visible text mentions ${stale}`);
  }
  // Lean text only condenses upstream: no routing to bash or scripts of its own.
  for (const own of [/\bbash\b/i, /\bscripts?\b/i]) {
    assert.equal(own.test(visible), false, `model-visible text adds ${own}`);
  }
  // Upstream's partial-line route on replace and its cross-file move undo rule follow the toggles.
  assert.ok(replace.description.includes("replace_match"));
  assert.ok(undo.promptGuidelines.some((line) => line.includes("cross-file move")));
  // Upstream repeats its tool-preference line on every tool; lean keeps it once, on read.
  assert.deepEqual(
    registered
      .filter((tool) => (tool.promptGuidelines ?? []).some((line) => line.startsWith("Remember to use the hashline tools")))
      .map((tool) => tool.name),
    ["read"],
  );
});

test("trims upstream command descriptions without dropping commands", () => {
  const registered = [];
  const commands = [];
  hashlineExtension(createPi(registered, commands));

  const byName = Object.fromEntries(commands);
  assert.ok("hashline-config" in byName);
  assert.ok("clear-anchors" in byName);
  for (const [, cmd] of commands) {
    assert.equal(typeof cmd.description, "string");
    assert.ok(cmd.description.length < 80);
    assert.equal(typeof cmd.handler, "function");
  }
});

test("uses the optional local collapsed-display service without installing one", () => {
  const registered = [];
  const commands = [];
  const decorated = [];
  globalThis[collapsedDisplayService] = {
    version: 1,
    decorate(tool) {
      decorated.push(tool.name);
      return { ...tool, collapsedDisplayDecorated: true };
    },
  };

  try {
    hashlineExtension(createPi(registered, commands));
  } finally {
    delete globalThis[collapsedDisplayService];
  }

  assert.deepEqual(decorated, expectedTools);
  assert.ok(registered.every((tool) => tool.collapsedDisplayDecorated === true));
  assert.equal(globalThis[collapsedDisplayService], undefined);
});
