# Agent Note: Desktop quick-input panel

Status: implemented

English | [中文](2026-09-28-desktop-quick-input-panel.zh.md)

## Problem

Reaching the running task from outside the application window costs a window switch: the main window is the only surface that submits a prompt, so a person working in another application must bring it forward, find the composer, and return. Hiding the rest of the interface to leave a floating composer was the other candidate, but every part of the frame — the columns, the conversation surface, and the elements other plugins register into them — belongs to the Web client's slot composition, and stripping it down would unmount the sidebar and right column on every toggle.

## Decision

The quick-input panel is a separate Electron window owned by the desktop shell, and `packages/client` is untouched.

`DesktopQuickInput` (`apps/desktop/src/quick-input-window.ts`) creates one frameless, transparent, always-on-top window on first show and keeps it for the rest of the run, so a hidden panel keeps its draft. It exposes exactly two channels, `dsh-quick-input:submit` and `dsh-quick-input:close`, each guarded by a check that the caller is the panel's own main frame. The panel renderer (`apps/desktop/src/client/QuickInputPage.tsx`) is a standalone Vite IIFE bundle behind its own sandboxed preload, in the shape the welcome window already established: a textarea, a send control, localized copy, and no conversation.

The main process performs the submission. `submitQuickPrompt` in `apps/desktop/src/main.ts` posts `{ text }` to `POST /desktop/quick-prompt` on the authenticated Host with the cookie the shell already holds, and maps the reply onto four reasons the panel localizes. The panel renderer never reaches the Host, and the shell never speaks the Web client's RPC channel.

`installDesktopQuickPromptRoute` (`apps/desktop-host/src/quick-prompt.ts`) serves that route in the private Desktop Host. It applies `ctx.connection.requestRejection` before reading a body, accepts only `POST` with an `application/json` body under a 64 KiB ceiling and a 16,384-character draft, and calls `ctx.sessionController.prompt` in process. `@Remote` records metadata only and leaves the method body alone, so this direct call runs the implementation the browser reaches, without binding the shell to the client's wire envelope.

The target is the first row of `ctx.sessionController.list` that is neither a subagent child nor blank, falling back to the first top-level row. `list()` returns rows newest activity first, so the first eligible row is the most recently active Session. A refusal whose code is `session/not-found` becomes `no-session`; every other refusal becomes `rejected`.

The panel is reachable from the application menu on every platform and from the Windows tray, which renders its state as a check mark. Without a control outside the panel, a window that is always-on-top and expects focus would be unreachable once a person stopped looking at it.

## Alternatives considered

**Hide the rest of the frame and keep the conversation surface.** This keeps every plugin-registered element and the conversation's own state, but it needs a solo presentation inside `AppFrame`, and the sidebar and right column — terminals, document previews, browser guests — would unmount on each toggle.

**Load a second Web client window and hide its chrome with injected CSS.** No client change would be needed, but the WebSocket cookie injection and the startup-failure guard are both scoped to the primary window, and the injected selectors would depend on the client's rendered markup.

**Let the panel speak the RPC channel directly.** The envelope is generated from the client's own schema, so the shell would break silently whenever that schema moved.

**Let the Host choose the Session from its own most-recent-activity feed.** The route reads the list on each request instead, so `list()`'s ordering stays the single definition of "recently active" and the route holds no state.

**Show the reply in the panel.** That needs the conversation's streaming renderers, which is the client work this decision exists to avoid.

## Consequences

- A draft reaches the active task without bringing the application forward, and the main window's document is untouched.
- The panel shows no reply and no conversation, so the shell and the client share no rendering code and no message reaches the session log outside `user-rpc`.
- A route on the Desktop Host is a second, stable entry point into Session submission beside the RPC channel. Its contract is three fields wide and validated at the process boundary on both sides.
- The panel adds `lib/quick-input/**`, `renderer/quick-input.*`, and `lib/preload-quick-input.cjs` to the packaged application.
- The tray icon stays Windows-only; the application-menu command is the entry on other platforms.
- With no Session on the Host the panel reports that no task is open. It never creates one, and the draft is kept so a retry does not have to retype it.
