import {
  acknowledgeRpcRequest,
  clearAllTrackedRpcRequests,
  createRequestLatencyState,
  trackRpcRequestSent,
} from "../rpc/requestLatencyState";
import {
  createConnectionStatusState,
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
} from "../rpc/wsConnectionState";
import { createWsRpcClient } from "../wsRpcClient";
import { WsTransport } from "../wsTransport";
import {
  ConnectionId,
  type ConnectionConfig,
  type ConnectionEntry,
  type ProtocolHooks,
} from "./types";
import { useServerConnectionStore } from "../serverConnectionStore";
import { useStore } from "../store";

const DEFAULT_CONNECTION_ID = ConnectionId("default");

/**
 * Build ProtocolHooks that delegate to the global default singleton state.
 *
 * This is what the "default" connection uses so that all legacy code paths
 * (which import the top-level functions from wsConnectionState / requestLatencyState)
 * continue to see exactly the same state mutations as before.
 */
function createDefaultProtocolHooks(): ProtocolHooks {
  return {
    onAttempt: (socketUrl) => {
      recordWsConnectionAttempt(socketUrl);
    },
    onOpened: () => {
      recordWsConnectionOpened();
    },
    onErrored: (message) => {
      recordWsConnectionErrored(message);
    },
    onClosed: (details) => {
      recordWsConnectionClosed(details);
    },
    onRequestSent: (requestId, tag) => {
      trackRpcRequestSent(requestId, tag);
    },
    onRequestAcked: (requestId) => {
      acknowledgeRpcRequest(requestId);
    },
    onAllRequestsCleared: () => {
      clearAllTrackedRpcRequests();
    },
  };
}

/**
 * Build ProtocolHooks that delegate to per-connection state instances,
 * not the global singletons. Used for non-default connections.
 */
function createScopedProtocolHooks(
  connectionStatus: ConnectionEntry["connectionStatus"],
  requestLatency: ConnectionEntry["requestLatency"],
): ProtocolHooks {
  return {
    onAttempt: (socketUrl) => {
      connectionStatus.recordAttempt(socketUrl);
    },
    onOpened: () => {
      connectionStatus.recordOpened();
    },
    onErrored: (message) => {
      connectionStatus.recordErrored(message);
    },
    onClosed: (details) => {
      connectionStatus.recordClosed(details);
    },
    onRequestSent: (requestId, tag) => {
      requestLatency.trackSent(requestId, tag);
    },
    onRequestAcked: (requestId) => {
      requestLatency.acknowledge(requestId);
    },
    onAllRequestsCleared: () => {
      requestLatency.clearAll();
    },
  };
}

let defaultEntry: ConnectionEntry | null = null;

/** All non-default connections, keyed by their ConnectionId string. */
const connections = new Map<string, ConnectionEntry>();

let connectionRegistryRevision = 0;
const connectionRegistryListeners = new Set<() => void>();

function bumpConnectionRegistryRevision(): void {
  connectionRegistryRevision += 1;
  for (const listener of connectionRegistryListeners) {
    listener();
  }
}

/** Subscribe to add/remove of non-default connections (for React external store sync). */
export function subscribeConnectionRegistry(onStoreChange: () => void): () => void {
  connectionRegistryListeners.add(onStoreChange);
  return () => {
    connectionRegistryListeners.delete(onStoreChange);
  };
}

export function getConnectionRegistryRevision(): number {
  return connectionRegistryRevision;
}

function ensureDefaultEntry(): ConnectionEntry {
  if (defaultEntry) {
    return defaultEntry;
  }

  const hooks = createDefaultProtocolHooks();
  const connectionStatus = createConnectionStatusState("default-ws-connection-status");
  const requestLatency = createRequestLatencyState("default-slow-rpc-ack-requests");

  // The default connection uses a plain WsTransport with NO explicit hooks,
  // so it falls back to the global singleton functions inside protocol.ts.
  // This ensures zero behavioral change for the existing code paths.
  const transport = new WsTransport();
  const rpcClient = createWsRpcClient(transport);

  defaultEntry = {
    id: DEFAULT_CONNECTION_ID,
    label: "Local",
    rpcClient,
    connectionStatus,
    requestLatency,
    hooks,
  };

  return defaultEntry;
}

export function getDefaultConnection(): ConnectionEntry {
  return ensureDefaultEntry();
}

/**
 * Register a new non-default connection.
 *
 * Creates per-connection state, transport, and rpcClient so that
 * each remote server has fully isolated protocol plumbing.
 */
export function addConnection(config: ConnectionConfig): ConnectionEntry {
  const id = ConnectionId(config.id);

  const existing = connections.get(config.id);
  if (existing) {
    return existing;
  }

  const connectionStatus = createConnectionStatusState(`${config.id}-ws-connection-status`);
  const requestLatency = createRequestLatencyState(`${config.id}-slow-rpc-ack-requests`);
  const hooks = createScopedProtocolHooks(connectionStatus, requestLatency);
  const transport = new WsTransport(config.url, hooks);
  const rpcClient = createWsRpcClient(transport, {
    resetReconnectBackoff: () => {
      connectionStatus.resetBackoff();
    },
  });

  const entry: ConnectionEntry = {
    id,
    label: config.label,
    rpcClient,
    connectionStatus,
    requestLatency,
    hooks,
  };

  connections.set(config.id, entry);
  bumpConnectionRegistryRevision();
  return entry;
}

/**
 * Tear down and remove a non-default connection.
 */
export async function removeConnection(id: string): Promise<void> {
  const entry = connections.get(id);
  if (!entry) {
    return;
  }

  connections.delete(id);
  bumpConnectionRegistryRevision();
  entry.requestLatency.clearAll();
  await entry.rpcClient.dispose();
  useStore.getState().purgeServerEntities(id);
  useServerConnectionStore.getState().removeConnection(id);
}

/**
 * Look up a connection by id. Returns `undefined` for unknown ids.
 * Also covers the default connection when `id` is `"default"`.
 */
export function getConnection(id: string): ConnectionEntry | undefined {
  if (id === "default") {
    return getDefaultConnection();
  }
  return connections.get(id);
}

/**
 * Return all registered connections (default + any added remotes).
 */
export function getAllConnections(): ConnectionEntry[] {
  return [getDefaultConnection(), ...connections.values()];
}

export async function __resetDefaultConnectionForTests(): Promise<void> {
  // Tear down non-default connections
  for (const entry of connections.values()) {
    await entry.rpcClient.dispose();
  }
  connections.clear();
  bumpConnectionRegistryRevision();

  if (defaultEntry) {
    await defaultEntry.rpcClient.dispose();
  }
  defaultEntry = null;
}
