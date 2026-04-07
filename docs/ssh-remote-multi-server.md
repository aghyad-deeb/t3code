# SSH Remote Development & Multi-Server UI

This document describes the changes made to support SSH remote development and a unified multi-server UI in t3code.

## Overview

t3code can now connect to multiple servers simultaneously — a local server plus any number of remote servers accessed via SSH tunnels. All projects from all connected servers appear in a single sidebar, grouped by server, with independent connection health monitoring.

## Architecture

```
Browser (React UI)
  |
  |-- ConnectionRegistry (manages N connections)
  |     |
  |     |-- Connection "default" (local)
  |     |     WsTransport -> ws://localhost:3773
  |     |     Own ConnectionStatusState, RequestLatencyState
  |     |
  |     |-- Connection "gpu-box" (remote via SSH tunnel)
  |     |     WsTransport -> ws://localhost:3774  (tunneled)
  |     |     Own ConnectionStatusState, RequestLatencyState
  |     |
  |     +-- Connection "staging" (remote via SSH tunnel)
  |           WsTransport -> ws://localhost:3775  (tunneled)
  |           Own ConnectionStatusState, RequestLatencyState
  |
  |-- Zustand Store
  |     projects: [...] (each tagged with serverId)
  |     threads: [...] (each tagged with serverId)
  |
  |-- Sidebar
        Server groups with status dots
        Projects grouped by server
```

The server code is unaware of multi-server — each server instance runs independently. All multi-server orchestration lives in the client.

## Changes by Phase

### Phase 1: Decouple Global Singletons

**Problem**: The WebSocket/RPC stack had global singletons that would corrupt each other with multiple concurrent connections.

**Solution**: Refactored into factory patterns with a backward-compatible default instance.

**Files changed**:

- `apps/web/src/rpc/wsConnectionState.ts` — `createConnectionStatusState()` factory. Each connection gets its own atom tracking connection phase, reconnect attempts, backoff state.
- `apps/web/src/rpc/requestLatencyState.ts` — `createRequestLatencyState()` factory. Each connection gets its own pending request Map and slow-request atom. `clearAllTrackedRpcRequests()` now only clears one connection's requests.
- `apps/web/src/rpc/protocol.ts` — `createWsRpcProtocolLayer(url?, hooks?)` accepts per-connection callbacks via `ProtocolHooks` interface instead of calling global functions.
- `apps/web/src/wsTransport.ts` — Constructor accepts optional `ProtocolHooks`, forwarded to the protocol layer.
- `apps/web/src/wsRpcClient.ts` — `getWsRpcClient()` delegates to `getDefaultConnection().rpcClient`.
- `apps/web/src/wsNativeApi.ts` — Uses default connection's rpcClient. Extracted `buildNativeApiFromRpcClient()` helper.

**New files**:

- `apps/web/src/connections/types.ts` — `ConnectionId`, `ProtocolHooks`, `ConnectionStatusState`, `RequestLatencyState`, `ConnectionEntry`, `ConnectionConfig` interfaces.
- `apps/web/src/connections/connectionRegistry.ts` — `ConnectionRegistry` managing multiple `ConnectionEntry` objects.

### Phase 2: Server-Aware Data Model

**Problem**: The Zustand store assumed all data came from one server. `syncServerReadModel` did a full state replacement that would clobber data from other servers.

**Solution**: Added `serverId` to all entity types and made state sync merge-based.

**Files changed**:

- `packages/contracts/src/baseSchemas.ts` — Added `ServerId` branded type.
- `apps/web/src/types.ts` — Added `serverId: string` to `Project`, `Thread`, `SidebarThreadSummary`.
- `apps/web/src/store.ts`:
  - `syncServerReadModel(state, readModel, serverId?)` — Now removes entities from the target server, keeps entities from other servers, adds incoming entities tagged with `serverId`. Previously did a full state wipe.
  - `applyOrchestrationEvent(state, event, serverId?)` — Tags new `project.created` and `thread.created` entities with `serverId`.
  - `applyOrchestrationEvents(state, events, serverId?)` — Passes `serverId` through.
  - All Zustand store actions accept optional `serverId` (defaults to `"default"`).

### Phase 3: Active Server Context

**Problem**: 39+ React components called the global singleton `readNativeApi()` to access the server API. This needs to become connection-aware for multi-server.

**Solution**: Created `useActiveApi()` React hook that provides the NativeApi from the active server context.

**New files**:

- `apps/web/src/connections/activeServerContext.tsx` — `ActiveServerProvider`, `useActiveConnection()`, `useActiveApi()`.

**Files changed**:

- `apps/web/src/routes/_chat.tsx` — Wraps children in `<ActiveServerProvider>`.
- 14 component/hook files — Replaced `readNativeApi()` with `useActiveApi()`:
  - `ChatView.tsx` (12 sites), `Sidebar.tsx` (7), `useThreadActions.ts` (4), `GitActionsControl.tsx` (4), `SettingsPanels.tsx` (4), `ThreadTerminalDrawer.tsx` (2), `BranchToolbarBranchSelector.tsx` (2), `OpenInPicker.tsx` (2), `__root.tsx` (2), `PlanSidebar.tsx` (1), `DiffPanel.tsx` (1), `BranchToolbar.tsx` (1), `ChatMarkdown.tsx` (1), `ProposedPlanCard.tsx` (1).
- 3 query factory files — Added optional `api` parameter:
  - `gitReactQuery.ts` (9 factories), `projectReactQuery.ts` (1), `providerReactQuery.ts` (1).
- `hooks/useSettings.ts` — `useUpdateSettings` uses `useActiveApi()`.

### Phase 4: Multi-Server Registry & Sidebar

**Problem**: Need infrastructure to actually create, manage, and display multiple connections.

**Solution**: Expanded ConnectionRegistry, added per-connection event routing, and grouped sidebar by server.

**Files changed**:

- `apps/web/src/connections/connectionRegistry.ts` — Added `addConnection(config)`, `removeConnection(id)`, `getConnection(id)`, `getAllConnections()`. Non-default connections get their own isolated `WsTransport`, `ProtocolHooks`, status/latency state.
- `apps/web/src/connections/activeServerContext.tsx` — `useActiveApi()` is now connection-aware: default connection uses singleton, non-default connections get their own NativeApi via `buildNativeApiFromRpcClient()`.
- `apps/web/src/routes/__root.tsx` — `EventRouter` iterates `getAllConnections()` and renders one `ServerEventSubscription` per connection, each wrapped in its own `ActiveServerProvider` and passing its `serverId` to `syncServerReadModel` and `applyOrchestrationEvents`.
- `apps/web/src/components/Sidebar.tsx` — Projects grouped by `serverId`. Server headers with `ServerStatusDot` (green/amber/grey). Disconnected servers' projects are dimmed. Headers only render when multiple servers exist.

**New files**:

- `apps/web/src/serverConnectionStore.ts` — Zustand store tracking `ServerConnectionInfo[]` with status per connection.

### Phase 5: SSH Tunnel Management

**Problem**: Need to automate SSH tunnel setup so users don't manually run `ssh -L ...`.

**Solution**: Server-side `--print-ready-json` flag + desktop SSH tunnel manager + IPC channels.

**Server changes**:

- `apps/server/src/cli.ts` — Added `--print-ready-json` flag and `T3CODE_PRINT_READY_JSON` env var.
- `apps/server/src/config.ts` — Added `printReadyJson: boolean` to `ServerConfigShape`.
- `apps/server/src/serverRuntimeStartup.ts` — When enabled, writes `{"ready":true,"port":N,"host":"...","pid":N}` to stdout after the HTTP listener is up.

**Desktop changes**:

- `packages/contracts/src/ipc.ts` — Added `SshHostConfig`, `SshConnectResult` interfaces and SSH methods to `DesktopBridge`.
- `apps/desktop/src/preload.ts` — Exposed SSH IPC channels: `sshConnect`, `sshDisconnect`, `sshListHosts`, `sshSaveHost`.
- `apps/desktop/src/main.ts` — IPC handlers for SSH operations. Hosts persisted to `~/.t3/userdata/ssh-hosts.json`. Tunnels cleaned up on app quit.

**New files**:

- `apps/desktop/src/sshTunnel.ts` — `startSshTunnel(config, localPort)` spawns system `ssh` binary with `-L` port forwarding and a remote `t3 --print-ready-json` command. Parses the ready JSON line from stdout. Returns an `SshTunnel` with `stop()` and `onExit()`. Platform-aware SSH binary detection (Windows fallback paths).
- `apps/desktop/src/backendLifecycle.ts` — `BackendLifecycle` interface for local vs SSH backends.

## End-to-End Flow

### Connecting to a remote server

1. User configures an SSH host (via settings UI or IPC).
2. Desktop app calls `sshConnect(config)`.
3. Electron spawns: `ssh -L localPort:127.0.0.1:remotePort user@host "T3CODE_AUTH_TOKEN=... t3 --port remotePort --host 127.0.0.1 --no-browser --print-ready-json /path/to/project"`
4. Remote t3code server starts, prints `{"ready":true,"port":3773,"host":"127.0.0.1","pid":12345}` to stdout.
5. Desktop parses the ready JSON, returns `{ wsUrl, authToken }` to the renderer.
6. Renderer calls `addConnection({ id: "gpu-box", label: "GPU Box", url: wsUrl })`.
7. ConnectionRegistry creates a new `WsTransport` with its own isolated state.
8. `EventRouter` picks up the new connection and renders a `ServerEventSubscription` for it.
9. The subscription calls `getSnapshot()` on the remote server, applies it to the store with `serverId: "gpu-box"`.
10. The sidebar shows a "GPU BOX" section with the remote project and its threads.
11. Clicking a remote thread navigates to it; all RPC calls route through the remote connection's transport.

### Disconnection handling

- Each connection has independent reconnection with exponential backoff.
- When a remote server disconnects, its projects dim in the sidebar (opacity-40, pointer-events-none).
- Other servers keep working normally.
- On SSH process exit, the desktop app can show a reconnection UI.
- SSH tunnels are cleaned up on app quit.

## Key Design Decisions

1. **Thin client, not proxy**: The full t3code server runs on the remote machine. The local client connects via SSH-tunneled WebSocket. No file/git/terminal proxying needed.

2. **System `ssh` binary, not `ssh2` library**: Inherits the user's `~/.ssh/config`, SSH agent, ProxyJump chains, and FIDO2 keys with zero reimplementation.

3. **Server needs zero multi-server awareness**: Each server instance is independent. All federation logic lives in the client.

4. **UUIDs don't collide**: Entity IDs (project, thread, message, etc.) are UUIDv4. Cross-server collision probability is negligible. No ID namespacing needed.

5. **`serverId` as a client-side coordinate**: The server doesn't know its own `serverId`. The client tags entities when they arrive.

6. **Merge-based state sync**: `syncServerReadModel` replaces only entities from the re-bootstrapping server, keeping other servers' data intact.

7. **Backward-compatible defaults**: All new parameters default to `"default"` serverId. Single-server behavior is unchanged.

## File Index

### New files

| File                                               | Purpose                               |
| -------------------------------------------------- | ------------------------------------- |
| `apps/web/src/connections/types.ts`                | Connection type definitions           |
| `apps/web/src/connections/connectionRegistry.ts`   | Multi-connection management           |
| `apps/web/src/connections/activeServerContext.tsx` | React context for active server       |
| `apps/web/src/serverConnectionStore.ts`            | Zustand store for connection UI state |
| `apps/desktop/src/sshTunnel.ts`                    | SSH tunnel lifecycle management       |
| `apps/desktop/src/backendLifecycle.ts`             | Backend lifecycle interface           |

### Modified files (server)

| File                                      | Change                        |
| ----------------------------------------- | ----------------------------- |
| `apps/server/src/cli.ts`                  | `--print-ready-json` flag     |
| `apps/server/src/config.ts`               | `printReadyJson` config field |
| `apps/server/src/serverRuntimeStartup.ts` | Ready JSON stdout output      |

### Modified files (contracts)

| File                                    | Change                      |
| --------------------------------------- | --------------------------- |
| `packages/contracts/src/baseSchemas.ts` | `ServerId` type             |
| `packages/contracts/src/ipc.ts`         | SSH host config + IPC types |

### Modified files (web)

| File                                      | Change                            |
| ----------------------------------------- | --------------------------------- |
| `apps/web/src/rpc/wsConnectionState.ts`   | Factory pattern                   |
| `apps/web/src/rpc/requestLatencyState.ts` | Factory pattern                   |
| `apps/web/src/rpc/protocol.ts`            | ProtocolHooks parameter           |
| `apps/web/src/wsTransport.ts`             | Hooks forwarding                  |
| `apps/web/src/wsRpcClient.ts`             | Registry delegation               |
| `apps/web/src/wsNativeApi.ts`             | `buildNativeApiFromRpcClient`     |
| `apps/web/src/types.ts`                   | `serverId` on entities            |
| `apps/web/src/store.ts`                   | Merge-based sync, serverId param  |
| `apps/web/src/routes/_chat.tsx`           | ActiveServerProvider              |
| `apps/web/src/routes/__root.tsx`          | Per-connection EventRouter        |
| `apps/web/src/components/Sidebar.tsx`     | Server group headers              |
| 14 component/hook files                   | `readNativeApi` -> `useActiveApi` |
| 3 query factory files                     | Optional `api` parameter          |

### Modified files (desktop)

| File                          | Change           |
| ----------------------------- | ---------------- |
| `apps/desktop/src/preload.ts` | SSH IPC channels |
| `apps/desktop/src/main.ts`    | SSH IPC handlers |
