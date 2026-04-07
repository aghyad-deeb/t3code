import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";

import type { ConnectionStatusState } from "../connections/types";
import { appAtomRegistry } from "./atomRegistry";

export type WsConnectionUiState = "connected" | "connecting" | "error" | "offline" | "reconnecting";
export type WsReconnectPhase = "attempting" | "exhausted" | "idle" | "waiting";

export const WS_RECONNECT_INITIAL_DELAY_MS = 1_000;
export const WS_RECONNECT_BACKOFF_FACTOR = 2;
export const WS_RECONNECT_MAX_DELAY_MS = 64_000;
export const WS_RECONNECT_MAX_RETRIES = 7;
export const WS_RECONNECT_MAX_ATTEMPTS = WS_RECONNECT_MAX_RETRIES + 1;

export interface WsConnectionStatus {
  readonly attemptCount: number;
  readonly closeCode: number | null;
  readonly closeReason: string | null;
  readonly connectedAt: string | null;
  readonly disconnectedAt: string | null;
  readonly hasConnected: boolean;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  readonly nextRetryAt: string | null;
  readonly online: boolean;
  readonly phase: "idle" | "connecting" | "connected" | "disconnected";
  readonly reconnectAttemptCount: number;
  readonly reconnectMaxAttempts: number;
  readonly reconnectPhase: WsReconnectPhase;
  readonly socketUrl: string | null;
}

function makeInitialStatus(): WsConnectionStatus {
  return Object.freeze<WsConnectionStatus>({
    attemptCount: 0,
    closeCode: null,
    closeReason: null,
    connectedAt: null,
    disconnectedAt: null,
    hasConnected: false,
    lastError: null,
    lastErrorAt: null,
    nextRetryAt: null,
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    phase: "idle",
    reconnectAttemptCount: 0,
    reconnectMaxAttempts: WS_RECONNECT_MAX_ATTEMPTS,
    reconnectPhase: "idle",
    socketUrl: null,
  });
}

function isoNow() {
  return new Date().toISOString();
}

function applyDisconnectState(
  current: WsConnectionStatus,
  updates: Partial<
    Pick<WsConnectionStatus, "closeCode" | "closeReason" | "lastError" | "lastErrorAt">
  >,
): WsConnectionStatus {
  const disconnectedAt = current.disconnectedAt ?? isoNow();
  const nextRetryDelayMs =
    current.nextRetryAt !== null || current.reconnectPhase === "exhausted"
      ? null
      : getWsReconnectDelayMsForRetry(Math.max(0, current.reconnectAttemptCount - 1));

  return {
    ...current,
    ...updates,
    disconnectedAt,
    nextRetryAt:
      nextRetryDelayMs === null
        ? current.nextRetryAt
        : new Date(Date.now() + nextRetryDelayMs).toISOString(),
    phase: "disconnected",
    reconnectPhase:
      current.reconnectPhase === "waiting" || current.reconnectPhase === "exhausted"
        ? current.reconnectPhase
        : nextRetryDelayMs === null
          ? "exhausted"
          : "waiting",
  };
}

// ---------------------------------------------------------------------------
// Factory: creates a scoped ConnectionStatusState bundle
// ---------------------------------------------------------------------------

export function createConnectionStatusState(label?: string): ConnectionStatusState {
  const initialStatus = makeInitialStatus();
  const atom = Atom.make(initialStatus).pipe(
    Atom.keepAlive,
    Atom.withLabel(label ?? "ws-connection-status"),
  );

  function getStatus(): WsConnectionStatus {
    return appAtomRegistry.get(atom);
  }

  function update(
    updater: (current: WsConnectionStatus) => WsConnectionStatus,
  ): WsConnectionStatus {
    const nextStatus = updater(getStatus());
    appAtomRegistry.set(atom, nextStatus);
    return nextStatus;
  }

  function recordAttempt(socketUrl: string): WsConnectionStatus {
    return update((current) => ({
      ...current,
      attemptCount: current.attemptCount + 1,
      nextRetryAt: null,
      phase: "connecting",
      reconnectAttemptCount: current.phase === "connected" ? 1 : current.reconnectAttemptCount + 1,
      reconnectPhase: "attempting",
      socketUrl,
    }));
  }

  function recordOpened(): WsConnectionStatus {
    return update((current) => ({
      ...current,
      closeCode: null,
      closeReason: null,
      connectedAt: isoNow(),
      disconnectedAt: null,
      hasConnected: true,
      nextRetryAt: null,
      phase: "connected",
      reconnectAttemptCount: 0,
      reconnectPhase: "idle",
    }));
  }

  function recordErrored(message?: string | null): WsConnectionStatus {
    return update((current) =>
      applyDisconnectState(current, {
        lastError: message?.trim() ? message : current.lastError,
        lastErrorAt: isoNow(),
      }),
    );
  }

  function recordClosed(details?: {
    readonly code?: number;
    readonly reason?: string;
  }): WsConnectionStatus {
    return update((current) =>
      applyDisconnectState(current, {
        closeCode: details?.code ?? current.closeCode,
        closeReason: details?.reason?.trim() ? details.reason : current.closeReason,
      }),
    );
  }

  function resetBackoff(): WsConnectionStatus {
    return update((current) => ({
      ...current,
      nextRetryAt: null,
      reconnectAttemptCount: 0,
      reconnectPhase: "idle",
    }));
  }

  function setBrowserOnline(online: boolean): WsConnectionStatus {
    return update((current) => ({
      ...current,
      online,
    }));
  }

  function exhaustIfStillWaiting(expectedNextRetryAt: string): WsConnectionStatus {
    return update((current) => {
      if (
        current.reconnectPhase !== "waiting" ||
        current.nextRetryAt !== expectedNextRetryAt ||
        !current.online ||
        !current.hasConnected
      ) {
        return current;
      }

      return {
        ...current,
        nextRetryAt: null,
        reconnectAttemptCount: current.reconnectMaxAttempts,
        reconnectPhase: "exhausted",
      };
    });
  }

  return {
    atom,
    recordAttempt,
    recordOpened,
    recordErrored,
    recordClosed,
    resetBackoff,
    setBrowserOnline,
    exhaustIfStillWaiting,
    getStatus,
  };
}

// ---------------------------------------------------------------------------
// Default instance — preserves all legacy exports
// ---------------------------------------------------------------------------

const defaultConnectionStatus = createConnectionStatusState();

export const wsConnectionStatusAtom = defaultConnectionStatus.atom;

export function getWsConnectionStatus(): WsConnectionStatus {
  return defaultConnectionStatus.getStatus();
}

export function getWsConnectionUiState(status: WsConnectionStatus): WsConnectionUiState {
  if (status.phase === "connected") {
    return "connected";
  }

  if (!status.online && (status.disconnectedAt !== null || status.phase === "disconnected")) {
    return "offline";
  }

  if (!status.hasConnected) {
    return status.phase === "disconnected" ? "error" : "connecting";
  }

  return "reconnecting";
}

export function recordWsConnectionAttempt(socketUrl: string): WsConnectionStatus {
  return defaultConnectionStatus.recordAttempt(socketUrl);
}

export function recordWsConnectionOpened(): WsConnectionStatus {
  return defaultConnectionStatus.recordOpened();
}

export function recordWsConnectionErrored(message?: string | null): WsConnectionStatus {
  return defaultConnectionStatus.recordErrored(message);
}

export function recordWsConnectionClosed(details?: {
  readonly code?: number;
  readonly reason?: string;
}): WsConnectionStatus {
  return defaultConnectionStatus.recordClosed(details);
}

export function setBrowserOnlineStatus(online: boolean): WsConnectionStatus {
  return defaultConnectionStatus.setBrowserOnline(online);
}

export function resetWsReconnectBackoff(): WsConnectionStatus {
  return defaultConnectionStatus.resetBackoff();
}

export function exhaustWsReconnectIfStillWaiting(expectedNextRetryAt: string): WsConnectionStatus {
  return defaultConnectionStatus.exhaustIfStillWaiting(expectedNextRetryAt);
}

export function resetWsConnectionStateForTests(): void {
  appAtomRegistry.set(wsConnectionStatusAtom, makeInitialStatus());
}

export function useWsConnectionStatus(): WsConnectionStatus {
  return useAtomValue(wsConnectionStatusAtom);
}

export function getWsReconnectDelayMsForRetry(retryIndex: number): number | null {
  if (!Number.isInteger(retryIndex) || retryIndex < 0 || retryIndex >= WS_RECONNECT_MAX_RETRIES) {
    return null;
  }

  return Math.min(
    Math.round(WS_RECONNECT_INITIAL_DELAY_MS * WS_RECONNECT_BACKOFF_FACTOR ** retryIndex),
    WS_RECONNECT_MAX_DELAY_MS,
  );
}
