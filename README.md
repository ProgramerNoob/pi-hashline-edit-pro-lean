# pi-hashline-edit-pro-lean

[简体中文](README.zh-CN.md)

A token-lean Pi wrapper around [`pi-hashline-edit-pro`](https://github.com/YuGiMob/pi-hashline-edit-pro). It pins the complete upstream `6.4.5` runtime while shortening persistent provider-facing tool text.

## Context footprint

<!-- token-benchmark:benchmark:start -->
Measured against upstream `pi-hashline-edit-pro@6.4.5`:

| Configuration | Lean | Upstream | Saved |
| --- | ---: | ---: | ---: |
| Default: five core tools | **503** | 2,114 | **1,611 (76.2%)** |
| All eight tools on | **859** | 4,732 | **3,873 (81.8%)** |

- **Default: five core tools Lean:** `read` (81) + `grep` (113) + `replace` (128) + `insert` (118) + `undo_last_change` (63)
- **Default: five core tools upstream:** `read` (349) + `grep` (502) + `replace` (573) + `insert` (489) + `undo_last_change` (201)
- **All eight tools on Lean:** `read` (81) + `grep` (113) + `replace` (128) + `replace_match` (117) + `insert` (118) + `copy` (121) + `move` (118) + `undo_last_change` (63)
- **All eight tools on upstream:** `read` (388) + `grep` (514) + `replace` (644) + `replace_match` (953) + `insert` (524) + `copy` (731) + `move` (707) + `undo_last_change` (271)

Measured with Pi 1.2.0 in separate temporary processes with empty working directories and configuration. Built-in tools, skills, context files, session history, user messages, unrelated extensions, runtime UI, and slash commands are excluded; `before_agent_start` additions are included. Tokens are a fixed character-proxy estimate using `ceil(characters / 4)`, not provider tokenizer billing.
<!-- token-benchmark:benchmark:end -->

## What it keeps

- Four-character Hashline anchors and served-anchor validation.
- Safe anchor-only `replace`, `replace_match`, `insert`, `copy`, and `move` operations (no `path` by default), plus per-file undo.
- Anchored ripgrep results under the `grep` name, enabled by default.
- Hash store, automatic reads, file checks, write-echo protection, and upstream session hooks.
- The upstream runtime, schemas, and tool availability settings rather than a reduced reimplementation.
- Optional compatibility with the local `@local/pi-collapsed-tools.display-service.v1` decorator.

## Why it is lean

Only model-facing prose is trimmed: concise descriptions and critical usage rules replace upstream prompt text, parameter descriptions are removed, and no prompt resources are added. Runtime behavior, validation, error contracts, and tool schemas remain upstream-compatible.

## Install

```bash
pi install git:github.com/kunkun9527/pi-hashline-edit-pro-lean
```

Requires Pi `>=0.99.0`. Do not load another Hashline wrapper or the upstream package at the same time, or tools may be registered twice.

## Tools

```text
read
replace            # anchor-only: no path by default
replace_match      # off by default; exact substring inside an anchored range
insert             # anchor-only: no path by default
copy / move        # off by default; anchored line ranges, same or another file
grep               # anchored ripgrep; replaces Pi's built-in grep
undo_last_change   # still requires path
```

Always copy the four-character anchors returned by `read` or `grep`. Never invent anchors. `replace` and `insert` take one exact `text` string; line breaks inside it separate lines, and `text: ""` deletes the selected range in `replace`. Same-file edits in one message form one batch with a combined diff and a single undo.

## Configuration

Settings live in `~/.config/pi-hashline-edit-pro/config.json` (or `$PI_HASHLINE_DIR/config.json`) and are shared with upstream. Use `/hashline-config` to change them.

One default differs from upstream: `copy`, `move`, and `replace_match` start **off**, so the default tool set is `read`, `grep`, `replace`, `insert`, and `undo_last_change`. On load, the wrapper writes `false` for `copyMoveEnabled` and `replaceMatchEnabled` only when the config does not set them yet; an explicit value is never changed. To turn them on, toggle them in `/hashline-config` or set:

```json
{
  "copyMoveEnabled": true,
  "replaceMatchEnabled": true
}
```

Two upstream settings swap in Pi's plain tools: `anchorGrepEnabled: false` registers the built-in `grep`, and a model matched by `disableOnModels` gets the built-in `read` and `grep` with the edit tools off. This wrapper replaces text by tool name, so in those modes the plain `read`/`grep` still carry the lean anchored descriptions even though their output has no anchors. Leave both settings at their defaults with this wrapper, or use the upstream package if you need them.

## Upgrading from 4.x

- `replacement_lines` / `lines` arrays are replaced by the `text` string; `[]` becomes `""`.
- `anchor_grep` is now `grep` and replaces Pi's built-in `grep`.
- New `replace_match`, `copy`, and `move` tools, off by default in this wrapper and switchable in `/hashline-config`.
- A pure deletion verifies its boundary lines; interior lines that were never served are removed as they currently stand.

Start a fresh Pi session after upgrading so the model receives the new schemas and instructions.

## Versions

- Lean wrapper: `6.4.5-lean.1`
- Upstream runtime: `pi-hashline-edit-pro@6.4.5`
- Pi: `>=0.99.0`
- Node.js: `>=22.19.0`

## Development

```bash
npm ci
npm run check
```

## License and upstream

MIT. This project wraps the MIT-licensed [`pi-hashline-edit-pro`](https://github.com/YuGiMob/pi-hashline-edit-pro).
