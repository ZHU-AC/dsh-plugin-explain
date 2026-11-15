# 插件说明（dsh-plugin-explain）

按 **Ctrl+Alt+P**（macOS 上是 Cmd+Alt+P），就能看到当前 profile 到底加载了哪些插件——每个都有一句中文用途，以及你在哪里能用到它。

它解决的问题很具体：一个 DSH profile 装上十几个插件之后，名字全是英文、用途藏在没人会打开的 README 里。这个插件负责回答「这是什么、我去哪用它」，而且不用离开界面。

[English](README.md)

## 你会得到什么

- **快捷键浮层**：每个已加载的包一张卡片——中文名、一句话用途、包名、版本、来源标记（官方内置 / 第三方）、运行状态；只有英文说明的会带一个醒目的「英文原文」标记。
- **侧栏面板**：同一份清单的整页版本，想浏览而不是搜索时用它。
- **搜索**：中文名、包名、中文摘要和英文原文都能搜。
- **展开看细节**：怎么用、标签、中文文案来自哪个文件，以及包仓库的链接。
- **可改键**：命令注册进宿主的快捷键服务，所以它会出现在「设置 → 通用 → 快捷键」里，能像内置命令一样改绑。

## 中文文案从哪来

先质量、再兜底，绝不替你瞎猜。每个包都会记录「哪一级给出了答案」（接口字段 `source`，界面上的「来源」）：

| 顺序 | 来源 | 说明 |
|---|---|---|
| 1 | `lib/data/curated.zh.json` | 为这个 profile 会装的插件手写的中文释义。 |
| 2 | 插件自带的本地化元信息 | `locale/*.json` 里的 `meta.title` / `meta.description`。 |
| 3 | 插件 `package.json` 的 `description` | 当它本身就是中文时。 |
| 4 | `README.zh.md` / `README.zh-CN.md` 摘录 | 已剥掉徽章、HTML、图片和代码块。 |
| 5 | 英文 `description` | 原样保留并标上「英文原文」，绝不在背后机器翻译。 |

如果一个包什么说明都没有，界面会直说，而不是显示一行空白。

## 安装

```bash
dsh plugin --profile desktop add D:/deepseek/main/dsh-plugin-explain
```

或从 registry 安装：

```bash
dsh plugin --profile desktop add dsh-plugin-explain
```

如果 profile 没有自动启用，补一行：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: plugin-explain
  name: dsh-plugin-explain
  config:
    lang: zh
    includeOfficial: false
```

profile 开了 HMR 时无需重启即可生效，否则重启 Harness。

## 配置项

| 键 | 默认值 | 含义 |
|---|---|---|
| `lang` | `zh` | 摘要优先使用哪种语言。 |
| `includeOfficial` | `false` | 是否也列出 `@deepseek-ai/*`（宿主自带包）。 |
| `summaryChars` | `320` | 单条摘要的长度上限。 |
| `readmeChars` | `8000` | 按需读取的 README 摘录长度上限。 |
| `shortcut` | `true` | 预留开关；快捷键本身在设置里改。 |

## HTTP 接口

两个只读接口，都做同源与回环校验：

| 路由 | 返回 |
|---|---|
| `GET /plugin-explain/api/list` | `{ generatedAt, plugin, profile, lang, counts, plugins[] }` |
| `GET /plugin-explain/api/readme?pkg=<name>` | `{ packageName, lang, file, summary, text }` |
| `GET /plugin-explain/api/health` | `{ ok: true, name, version }` |

浏览器端完全不碰文件系统，只有宿主半侧解析包。

## 为什么不容易坏

- 宿主半侧**不 import 任何** `@deepseek-ai/*` 模块。它用到的服务（`loader`、`pluginPackages`、`profileContext`、`webServer`）全是可选的，访问也做了防御，因此 DSH 升级不会通过内部路径弄坏它。
- 浏览器 bundle 只 require `react` 和 `react-dom`，两者都在宿主冻结的共享模块表里。
- 按包名合并行：一个 bundle 贡献多条子路径行时仍然只有一张卡片，取最健康的 fiber 状态。

## 已知限制

- 面板是只读的：不启用、不卸载、不安装。这些用宿主自己的插件页（卡片上有入口）。
- 只有英文说明的包会保持英文——这是刻意的。
- 没有 `package.json` 的松散文件行，会显示模块名并说明「包身份未知」。

## 开发

```bash
node --test "test/*.test.mjs"
```

测试覆盖文案优先级、README 提取、行合并，以及用假 Cordis context 验证宿主返回结构——不需要真的跑一个 DSH。

## 许可

MIT
