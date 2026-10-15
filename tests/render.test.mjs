// Rendered lean text after upstream's session_start refresh: lines upstream
// shows only under some settings must follow those settings.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

process.env.HOME = mkdtempSync(join(tmpdir(), "pi-hashline-lean-render-"));
const jiti = createJiti(import.meta.url, { interopDefault: true });
const hashlineExtension = (await jiti.import("../index.ts")).default;

async function render(config, { codemode = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-hashline-lean-render-cfg-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  process.env.PI_HASHLINE_DIR = dir;
  const tools = new Map();
  const handlers = {};
  let active = ["read", "bash", "write", "grep", ...(codemode ? ["codemode"] : [])];
  hashlineExtension({
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand() {},
    on: (event, handler) => (handlers[event] ??= []).push(handler),
    getActiveTools: () => active,
    getAllTools: () => [],
    setActiveTools: (next) => {
      active = next;
    },
  });
  const ctx = { cwd: dir, signal: new AbortController().signal, ui: { notify() {} } };
  for (const handler of handlers.session_start ?? []) await handler({}, ctx);
  // Upstream re-registers the edit tools asynchronously after reading the config.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const lines = (name) => tools.get(name)?.promptGuidelines ?? [];
  return { tools, lines, all: [...tools.values()].flatMap((tool) => tool.promptGuidelines ?? []) };
}

test("default: all eight tools, shared rules once, labels for copy/move", async () => {
  const { tools, lines, all } = await render({});
  assert.ok(tools.get("replace").description.includes("replace_match"));
  assert.ok(lines("read").some((line) => line.includes("post-edit diff") || line.includes("+ and space diff rows")));
  assert.ok(lines("replace").some((line) => line.includes("one undo reverts all")));
  assert.ok(lines("replace").some((line) => line.includes("decoded once")));
  assert.ok(lines("copy").some((line) => line.startsWith("copy/move:")));
  assert.ok(lines("undo_last_change").some((line) => line.includes("cross-file move")));
  assert.ok(all.some((line) => line.startsWith("Remember to use the hashline tools")));
  assert.equal(all.some((line) => line.includes("codemode")), false);
});

test("replace_match and copy/move off drop the lines that point at them", async () => {
  const { tools, lines } = await render({ replaceMatchEnabled: false, copyMoveEnabled: false });
  assert.equal(tools.get("replace").description.includes("replace_match"), false);
  assert.equal(lines("undo_last_change").some((line) => line.includes("cross-file move")), false);
});

test("autoRead off uses upstream's neutral re-read line", async () => {
  const { lines } = await render({ autoRead: false });
  assert.deepEqual(lines("read").filter((line) => line.startsWith("read:")), [
    "read: call again after an edit when you need anchors you lack.",
  ]);
});

test("codemode passes upstream's script lines through", async () => {
  const { lines, all } = await render({}, { codemode: true });
  assert.ok(lines("replace").some((line) => line.includes("codemode script calls apply immediately")));
  assert.ok(all.some((line) => line.includes("When called from a codemode script")));
});

test("Pi's plain grep keeps its own text", async () => {
  const { tools } = await render({ anchorGrepEnabled: false });
  const grep = tools.get("grep");
  assert.equal(grep.description.includes("anchor│"), false);
  assert.equal((grep.promptGuidelines ?? []).some((line) => line.startsWith("grep: set literal")), false);
});
