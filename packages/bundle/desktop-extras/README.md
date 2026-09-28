---
description: "Ship the desktop application's third-party plugins as one switchable profile layer."
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-extras

English | [中文](README.zh.md)

## Summary

This optional bundle inserts six third-party plugins into a profile: Claude Code compatibility, MCP server management, a memory directory, CJK webfont beautification, HTML design review, and git worktree isolation. Shipped templates leave it switched off, and a new desktop profile selects it. Enable Desktop extras in the plugin manager, or run the `dsh plugin` command below. Each row keeps its own configuration, downloads, and network behavior.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Plugins and enable Desktop extras, or name the layer in a profile:

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-desktop-extras
dsh plugin --profile <name> remove @deepseek-ai/dsh-desktop-extras
```

That command installs the package into the profile from the registry, so it reports a 404 until this version is published. In a distribution that already carries the package, listing the layer in `dsh.profile.bundles` selects it without a registry copy. Removing the layer disables all six rows and keeps the installed packages. A profile patch can override or disable any row by id, because the profile patch applies after every bundle layer.

### What you get

- `claude-compat` — Claude Code compatibility: skills discovery, memory-file loading, scoped rules, and a settings switch.
- `mcp-manager` — MCP server management: author composition rows, choose when a server loads, and filter its tools per session.
- `memory` — a memory directory with a `MEMORY.md` index, topic files, the memory tool, and a settings page.
- `ui-beautify` — downloads open-source CJK webfonts on demand and lets the Web GUI pick its body font.
- `web-design` — previews and edits HTML elements in the sidebar.
- `worktree` — creates a git worktree, registers it as its own project, and starts the session inside it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` inserts six rows over the profile root, each carrying a stable id. Every row keeps the package's own configuration, peers, and client bundles; this layer adds no service of its own. Optional-bundle admission ships the package without selecting it in a profile template, so the plugin manager offers it switched off and `OPTIONAL_BUNDLES` records the admission. No runtime invariant companion is published because the layer owns no runtime state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Desktop application](../../../apps/desktop/README.md), [shipped optional bundles](../../../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md), [package map](../../README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this layer only inserts third-party rows and each inserted package owns its own model-facing behavior.

#### KV Cache effect

No effect of its own; the inserted packages own any prompt or tool-schema change they make.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The six packages are third-party dependencies pinned by range (`^1.0.0`). Their tests and release qualification stay with their own project, so an incompatible release needs a new range here.
- The layer ships no MCP server and no credentials. `mcp-manager` authors rows, but a server still needs its own command or URL in the profile patch.
- A new desktop profile selects this layer, so the desktop application starts with all six plugins enabled. Shipped templates stay unchanged, and a Web or CLI profile enables the layer explicitly.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
