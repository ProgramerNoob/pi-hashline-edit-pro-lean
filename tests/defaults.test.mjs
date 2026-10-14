import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

process.env.HOME = mkdtempSync(join(tmpdir(), "pi-hashline-lean-defaults-"));

const jiti = createJiti(import.meta.url, { interopDefault: true });
const hashlineExtension = (await jiti.import("../index.ts")).default;

const stubPi = {
  registerTool() {},
  registerCommand() {},
  on() {},
  getActiveTools: () => [],
  getAllTools: () => [],
  setActiveTools() {},
};

// Load the wrapper against a fresh config dir and return its config file text.
function loadWith(initial) {
  const dir = mkdtempSync(join(tmpdir(), "pi-hashline-lean-config-"));
  const file = join(dir, "config.json");
  if (initial !== undefined) writeFileSync(file, initial);
  process.env.PI_HASHLINE_DIR = dir;
  hashlineExtension(stubPi);
  return readFileSync(file, "utf8");
}

test("turns copy/move and replace_match off when the user never set them", () => {
  assert.deepEqual(JSON.parse(loadWith(undefined)), {
    copyMoveEnabled: false,
    replaceMatchEnabled: false,
  });
});

test("keeps explicit user choices and other settings", () => {
  const config = JSON.parse(loadWith('{"autoRead":false,"copyMoveEnabled":true}'));
  assert.deepEqual(config, {
    autoRead: false,
    copyMoveEnabled: true,
    replaceMatchEnabled: false,
  });
});

test("leaves a corrupt config for upstream to handle", () => {
  assert.equal(loadWith("{not json"), "{not json");
});
