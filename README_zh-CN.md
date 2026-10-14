# pi-hashline-edit-pro-lean

<!-- token-benchmark:summary:start -->
> **Token 基准：Lean 503，上游 `pi-hashline-edit-pro@6.4.5` 2,114，减少 76.2%。**
<!-- token-benchmark:summary:end -->
> **完整配置参考：** [查看 Pi Lean Setup](https://github.com/kunkun9527/my-lean-pi-setup)

[English](README.md)

[`pi-hashline-edit-pro`](https://github.com/YuGiMob/pi-hashline-edit-pro) 的 Token 精简版 Pi 包装层。当前固定使用完整的上游 `6.4.5` 运行时，只精简长期进入模型上下文的工具文本。

## 上下文占用

<!-- token-benchmark:benchmark:start -->
针对上游 `pi-hashline-edit-pro@6.4.5`，实测结果如下：

| 配置 | Lean | 上游 | 节省 |
| --- | ---: | ---: | ---: |
| 默认：五个核心工具 | **503** | 2,114 | **1,611（76.2%）** |
| 开启全部八个工具 | **859** | 4,732 | **3,873（81.8%）** |

- **默认：五个核心工具 Lean：**`read` (81) + `grep` (113) + `replace` (128) + `insert` (118) + `undo_last_change` (63)
- **默认：五个核心工具 上游：**`read` (349) + `grep` (502) + `replace` (573) + `insert` (489) + `undo_last_change` (201)
- **开启全部八个工具 Lean：**`read` (81) + `grep` (113) + `replace` (128) + `replace_match` (117) + `insert` (118) + `copy` (121) + `move` (118) + `undo_last_change` (63)
- **开启全部八个工具 上游：**`read` (388) + `grep` (514) + `replace` (644) + `replace_match` (953) + `insert` (524) + `copy` (731) + `move` (707) + `undo_last_change` (271)

测量环境为 Pi 1.2.0 的独立临时进程、空白工作目录与空白配置。排除内置工具、Skills、上下文文件、会话历史、用户消息、无关扩展、运行时 UI 与 Slash Commands；计入扩展的 `before_agent_start` 注入。Token 是按 `ceil(字符数 / 4)` 计算的固定字符代理估算，并非模型 tokenizer 实际计费值。
<!-- token-benchmark:benchmark:end -->

## 保留的能力

- 四字符 Hashline 锚点与已提供锚点校验。
- 安全的 anchor-only `replace`、`replace_match`、`insert`、`copy`、`move`（默认不传 `path`）和按文件撤销。
- 返回锚点的 ripgrep 搜索，工具名为 `grep`，默认启用。
- Hash store、自动读取、文件检查、write 锚点回显防护和上游 session hooks。
- 直接复用上游运行时、Schema 和工具开关，不缩减或重写安全协议。
- 兼容本地 `@local/pi-collapsed-tools.display-service.v1` 折叠展示装饰器。

## 为什么更精简

只裁剪模型可见文本：用简短描述和关键规则替代上游长 Prompt，删除重复的参数字段说明，也不额外加载 Prompt 资源。运行行为、校验、错误契约和工具 Schema 均与上游保持一致。

## 安装

```bash
pi install git:github.com/kunkun9527/pi-hashline-edit-pro-lean
```

需要 Pi `>=0.99.0`。请勿同时加载其它 Hashline 包装扩展或上游包本身，以免重复注册工具。

## 工具

```text
read
replace            # anchor-only：默认不传 path
replace_match      # 默认关闭；在锚点范围内替换精确子串
insert             # anchor-only：默认不传 path
copy / move        # 默认关闭；复制或移动锚点行范围，可跨文件
grep               # 带锚点的 ripgrep，替代 Pi 内置 grep
undo_last_change   # 仍需要 path
```

必须复制 `read` 或 `grep` 返回的四字符锚点，绝不要猜测。`replace` 和 `insert` 接收一个原样写入的 `text` 字符串，字符串里的换行就是分行；`replace` 中 `text: ""` 表示删除所选范围。同一条消息里对同一文件的编辑会合并成一个 batch，共用一个 diff 和一次撤销。

## 配置

配置保存在 `~/.config/pi-hashline-edit-pro/config.json`（或 `$PI_HASHLINE_DIR/config.json`），与上游共用，用 `/hashline-config` 修改。

有一项默认值与上游不同：`copy`、`move`、`replace_match` 默认**关闭**，所以默认工具是 `read`、`grep`、`replace`、`insert`、`undo_last_change`。加载时，只有当配置里还没有 `copyMoveEnabled`、`replaceMatchEnabled` 时，包装层才写入 `false`；已有的显式设置不会被改动。要开启它们，在 `/hashline-config` 里切换，或者写入：

```json
{
  "copyMoveEnabled": true,
  "replaceMatchEnabled": true
}
```

有两个上游设置会换上 Pi 自带的普通工具：`anchorGrepEnabled: false` 会注册内置 `grep`；被 `disableOnModels` 匹配的模型会改用内置 `read` 和 `grep`，并关闭编辑工具。本包装层按工具名替换文案，所以在这两种模式下，普通 `read`/`grep` 仍会带着“有锚点”的精简说明，但它们的输出并没有锚点。使用本包装层时请保持这两项为默认值；需要它们时请改用上游包。

## 从 4.x 升级

- `replacement_lines` / `lines` 数组改为 `text` 字符串；`[]` 改为 `""`。
- `anchor_grep` 改名为 `grep`，并替代 Pi 内置 `grep`。
- 新增 `replace_match`、`copy`、`move`，本包装层默认关闭，可在 `/hashline-config` 里开启。
- 纯删除会校验首尾两行；中间从未读到的行按磁盘上的当前内容删除。

升级后请新建 Pi 会话，确保模型获得新的 Schema 与使用说明。

## 版本

- Lean 包装层：`6.4.5-lean.2`
- 上游运行时：`pi-hashline-edit-pro@6.4.5`
- Pi：`>=0.99.0`
- Node.js：`>=22.19.0`

## 本地开发

```bash
npm ci
npm run check
```

## 开源协议与上游

MIT。本项目包装了采用 MIT 许可证的 [`pi-hashline-edit-pro`](https://github.com/YuGiMob/pi-hashline-edit-pro)。
