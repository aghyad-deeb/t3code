import type { Atom } from "effect/unstable/reactivity";

import type { SlowRpcAckRequest } from "../rpc/requestLatencyState";
import type { WsConnectionStatus } from "../rpc/wsConnectionState";
import type { WsRpcClient } from "../wsRpcClient";

export type ConnectionId = string & { readonly __brand: unique symbol };

export function ConnectionId(id: string): ConnectionId {
  return id as ConnectionId;
}

export interface ProtocolHooks {
  readonly onAttempt: (socketUrl: string) => void;
  readonly onOpened: () => void;
  readonly onErrored: (message: string) => void;
  readonly onClosed: (details: { code: number; reason: string }) => void;
  readonly onRequestSent: (requestId: string, tag: string) => void;
  readonly onRequestAcked: (requestId: string) => void;
  readonly onAllRequestsCleared: () => void;
}

export interface ConnectionStatusState {
  readonly atom: Atom.Writable<WsConnectionStatus, WsConnectionStatus>;
  readonly recordAttempt: (socketUrl: string) => WsConnectionStatus;
  readonly recordOpened: () => WsConnectionStatus;
  readonly recordErrored: (message?: string | null) => WsConnectionStatus;
  readonly recordClosed: (details?: {
    readonly code?: number;
    readonly reason?: string;
  }) => WsConnectionStatus;
  readonly resetBackoff: () => WsConnectionStatus;
  readonly setBrowserOnline: (online: boolean) => WsConnectionStatus;
  readonly exhaustIfStillWaiting: (expectedNextRetryAt: string) => WsConnectionStatus;
  readonly getStatus: () => WsConnectionStatus;
}

export interface RequestLatencyState {
  readonly slowRequestsAtom: Atom.Writable<
    ReadonlyArray<SlowRpcAckRequest>,
    ReadonlyArray<SlowRpcAckRequest>
  >;
  readonly trackSent: (requestId: string, tag: string) => void;
  readonly acknowledge: (requestId: string) => void;
  readonly clearAll: () => void;
  readonly useSlowRequests: () => ReadonlyArray<SlowRpcAckRequest>;
}

export interface ConnectionEntry {
  readonly id: ConnectionId;
  readonly label: string;
  readonly rpcClient: WsRpcClient;
  readonly connectionStatus: ConnectionStatusState;
  readonly requestLatency: RequestLatencyState;
  readonly hooks: ProtocolHooks;
}

export interface ConnectionConfig {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}
