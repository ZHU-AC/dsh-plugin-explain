# dsh-plugin-explain

Press **Ctrl+Alt+P** (Cmd+Alt+P on macOS) and see every plugin your profile
actually loads — each with a plain-language name, one sentence about what it
does, and how to reach the feature.

The problem it solves: a DSH profile accumulates a dozen or two packages whose
names are English and whose purpose is buried in a README you will never open.
This plugin answers "what is this and where do I use it?" without leaving the
app.

[中文说明](README.zh.md)

## What you get

- **A shortcut-opened overlay.** One card per loaded package: Chinese name,
  one-line purpose, package name, version, source badge (built in / third
  party), run state, and a warning badge when only English text exists.
- **A sidebar panel.** The same list as a full page, for when you would rather
  browse than search.
- **Search** across the Chinese name, the package name, the summary and the
  English original.
- **Expand for the details**: how to reach the feature, tags, the file the
  Chinese text came from, and a link to the package's repository.
- **Rebindable shortcut.** The command registers with the Host's shortcut
  service, so it appears in *Settings → General → Keyboard shortcuts* and can be
  changed like any built-in one.

## Where the Chinese text comes from

Quality first, guessing never. For each package the host half walks a ladder and
records which rung answered (`source` in the payload, and *来源* in the panel):

| Order | Source | Notes |
|---|---|---|
| 1 | `lib/data/curated.zh.json` | Authored by hand for the plugins this profile ships with. |
| 2 | The package's own localized metadata | `locale/*.json` `meta.title` / `meta.description`. |
| 3 | The package's `description`, when it is Chinese | Some plugins are authored in Chinese. |
| 4 | An excerpt of `README.zh.md` / `README.zh-CN.md` | Badges, HTML, images and code fences are stripped. |
| 5 | The English `description` | Kept verbatim and flagged **English** — never machine-translated behind your back. |

A package with no text at all says so instead of showing an empty line.

## Install

```bash
dsh plugin --profile desktop add D:/deepseek/main/dsh-plugin-explain
```

or from a registry build:

```bash
dsh plugin --profile desktop add dsh-plugin-explain
```

Then enable the row if the profile does not do it for you:

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: plugin-explain
  name: dsh-plugin-explain
  config:
    lang: zh
    includeOfficial: false
```

With HMR enabled the row activates without a restart; otherwise restart Harness.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `lang` | `zh` | Which language the summary ladder prefers. |
| `includeOfficial` | `false` | Also list `@deepseek-ai/*` rows (the Host's own packages). |
| `summaryChars` | `320` | Length cap for one summary line. |
| `readmeChars` | `8000` | Length cap for the on-demand README excerpt. |
| `shortcut` | `true` | Reserved; the shortcut itself can be rebound in settings. |

## HTTP surface

Two read-only endpoints, both same-origin and loopback-checked:

| Route | Answer |
|---|---|
| `GET /plugin-explain/api/list` | `{ generatedAt, plugin, profile, lang, counts, plugins[] }` |
| `GET /plugin-explain/api/readme?pkg=<name>` | `{ packageName, lang, file, summary, text }` |
| `GET /plugin-explain/api/health` | `{ ok: true, name, version }` |

The browser never touches the filesystem; only the host half resolves packages.

## How it stays compatible

- The host half imports **no** `@deepseek-ai/*` module. Every Host service it
  uses (`loader`, `pluginPackages`, `profileContext`, `webServer`) is optional
  and read defensively, so a DSH upgrade cannot break it through an internal
  path.
- The browser bundle requires only `react` and `react-dom`, both in the Host's
  frozen shared-module table.
- Rows are merged per package, so a bundle that contributes several subpath rows
  still produces one card, with the healthiest fiber phase winning.

## Known limits

- The panel is read-only: it does not enable, disable or install anything. Use
  the Host's own plugin page for that (the card links to it when available).
- Packages whose text exists only in English stay English, by design.
- Code that contributes no `package.json` (a loose file row) shows its module
  name and says the package identity is unknown.

## Development

```bash
node --test "test/*.test.mjs"
```

The suite covers the text ladder, README extraction, row merging and the host
payload shape against a fake Cordis context — no DSH process required.

## Licence

MIT
