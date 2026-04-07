import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";

import type { RequestLatencyState } from "../connections/types";
import { appAtomRegistry } from "./atomRegistry";

export const SLOW_RPC_ACK_THRESHOLD_MS = 15_000;
export const MAX_TRACKED_RPC_ACK_REQUESTS = 256;
let slowRpcAckThresholdMs = SLOW_RPC_ACK_THRESHOLD_MS;

export interface SlowRpcAckRequest {
  readonly requestId: string;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly tag: string;
  readonly thresholdMs: number;
}

interface PendingRpcAckRequest {
  readonly request: SlowRpcAckRequest;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

function shouldTrackRpcAck(tag: string): boolean {
  return !tag.startsWith("subscribe");
}

// ---------------------------------------------------------------------------
// Factory: creates a scoped RequestLatencyState bundle
// ---------------------------------------------------------------------------

export function createRequestLatencyState(label?: string): RequestLatencyState {
  const pendingRpcAckRequests = new Map<string, PendingRpcAckRequest>();

  const slowRequestsAtom = Atom.make<ReadonlyArray<SlowRpcAckRequest>>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel(label ?? "slow-rpc-ack-requests"),
  );

  function setSlowRpcAckRequests(requests: ReadonlyArray<SlowRpcAckRequest>) {
    appAtomRegistry.set(slowRequestsAtom, [...requests]);
  }

  function getSlowRpcAckRequestsValue(): ReadonlyArray<SlowRpcAckRequest> {
    return appAtomRegistry.get(slowRequestsAtom);
  }

  function clearTrackedRpcRequest(requestId: string): void {
    const pending = pendingRpcAckRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    pendingRpcAckRequests.delete(requestId);
  }

  function appendSlowRpcAckRequest(request: SlowRpcAckRequest): void {
    const requests = [...getSlowRpcAckRequestsValue(), request];
    if (requests.length <= MAX_TRACKED_RPC_ACK_REQUESTS) {
      setSlowRpcAckRequests(requests);
      return;
    }

    setSlowRpcAckRequests(requests.slice(-MAX_TRACKED_RPC_ACK_REQUESTS));
  }

  function evictOldestPendingRpcRequestIfNeeded(): void {
    while (pendingRpcAckRequests.size >= MAX_TRACKED_RPC_ACK_REQUESTS) {
      const oldestRequestId = pendingRpcAckRequests.keys().next().value;
      if (oldestRequestId === undefined) {
        return;
      }

      clearTrackedRpcRequest(oldestRequestId);
    }
  }

  function trackSent(requestId: string, tag: string): void {
    if (!shouldTrackRpcAck(tag)) {
      return;
    }

    clearTrackedRpcRequest(requestId);
    evictOldestPendingRpcRequestIfNeeded();

    const startedAtMs = Date.now();
    const request: SlowRpcAckRequest = {
      requestId,
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      tag,
      thresholdMs: slowRpcAckThresholdMs,
    };
    const timeoutId = setTimeout(() => {
      pendingRpcAckRequests.delete(requestId);
      appendSlowRpcAckRequest(request);
    }, slowRpcAckThresholdMs);

    pendingRpcAckRequests.set(requestId, {
      request,
      timeoutId,
    });
  }

  function acknowledge(requestId: string): void {
    clearTrackedRpcRequest(requestId);
    const slowRequests = getSlowRpcAckRequestsValue();
    if (!slowRequests.some((request) => request.requestId === requestId)) {
      return;
    }

    setSlowRpcAckRequests(slowRequests.filter((request) => request.requestId !== requestId));
  }

  function clearAll(): void {
    for (const pending of pendingRpcAckRequests.values()) {
      clearTimeout(pending.timeoutId);
    }
    pendingRpcAckRequests.clear();
    setSlowRpcAckRequests([]);
  }

  function useSlowRequests(): ReadonlyArray<SlowRpcAckRequest> {
    return useAtomValue(slowRequestsAtom);
  }

  return {
    slowRequestsAtom,
    trackSent,
    acknowledge,
    clearAll,
    useSlowRequests,
  };
}

// ---------------------------------------------------------------------------
// Default instance — preserves all legacy exports
// ---------------------------------------------------------------------------

const defaultRequestLatency = createRequestLatencyState();

export function getSlowRpcAckRequests(): ReadonlyArray<SlowRpcAckRequest> {
  return appAtomRegistry.get(defaultRequestLatency.slowRequestsAtom);
}

export function trackRpcRequestSent(requestId: string, tag: string): void {
  defaultRequestLatency.trackSent(requestId, tag);
}

export function acknowledgeRpcRequest(requestId: string): void {
  defaultRequestLatency.acknowledge(requestId);
}

export function clearAllTrackedRpcRequests(): void {
  defaultRequestLatency.clearAll();
}

export function resetRequestLatencyStateForTests(): void {
  slowRpcAckThresholdMs = SLOW_RPC_ACK_THRESHOLD_MS;
  defaultRequestLatency.clearAll();
}

export function setSlowRpcAckThresholdMsForTests(thresholdMs: number): void {
  slowRpcAckThresholdMs = thresholdMs;
}

export function useSlowRpcAckRequests(): ReadonlyArray<SlowRpcAckRequest> {
  return defaultRequestLatency.useSlowRequests();
}
