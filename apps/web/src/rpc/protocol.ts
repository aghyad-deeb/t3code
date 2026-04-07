import { WsRpcGroup } from "@t3tools/contracts";
import { Duration, Effect, Layer, Schedule } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import type { ProtocolHooks } from "../connections/types";
import { resolveServerUrl } from "../lib/utils";
import {
  acknowledgeRpcRequest,
  clearAllTrackedRpcRequests,
  trackRpcRequestSent,
} from "./requestLatencyState";
import {
  getWsReconnectDelayMsForRetry,
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
  WS_RECONNECT_MAX_RETRIES,
} from "./wsConnectionState";

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);

type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;

/**
 * Default hooks that delegate to the global singleton state functions.
 * Used when no explicit hooks are provided (backward-compatible path).
 */
const defaultProtocolHooks: ProtocolHooks = {
  onAttempt: (socketUrl) => recordWsConnectionAttempt(socketUrl),
  onOpened: () => recordWsConnectionOpened(),
  onErrored: (message) => recordWsConnectionErrored(message),
  onClosed: (details) => recordWsConnectionClosed(details),
  onRequestSent: (requestId, tag) => trackRpcRequestSent(requestId, tag),
  onRequestAcked: (requestId) => acknowledgeRpcRequest(requestId),
  onAllRequestsCleared: () => clearAllTrackedRpcRequests(),
};

export function createWsRpcProtocolLayer(url?: string, hooks?: ProtocolHooks) {
  const h = hooks ?? defaultProtocolHooks;
  const resolvedUrl = resolveServerUrl({
    url,
    protocol: window.location.protocol === "https:" ? "wss" : "ws",
    pathname: "/ws",
  });
  const trackingWebSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) => {
      h.onAttempt(socketUrl);
      const socket = new globalThis.WebSocket(socketUrl, protocols);

      socket.addEventListener(
        "open",
        () => {
          h.onOpened();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          h.onAllRequestsCleared();
          h.onErrored("Unable to connect to the T3 server WebSocket.");
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        (event) => {
          h.onAllRequestsCleared();
          h.onClosed({
            code: event.code,
            reason: event.reason,
          });
        },
        { once: true },
      );

      return socket;
    },
  );
  const socketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(trackingWebSocketConstructorLayer),
  );
  const retryPolicy = Schedule.addDelay(Schedule.recurs(WS_RECONNECT_MAX_RETRIES), (retryCount) =>
    Effect.succeed(Duration.millis(getWsReconnectDelayMsForRetry(retryCount) ?? 0)),
  );
  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    Effect.map(
      RpcClient.makeProtocolSocket({
        retryPolicy,
        retryTransientErrors: true,
      }),
      (protocol) => ({
        ...protocol,
        run: (writeResponse) =>
          protocol.run((response) => {
            if (response._tag === "Chunk" || response._tag === "Exit") {
              h.onRequestAcked(response.requestId);
            } else if (response._tag === "ClientProtocolError" || response._tag === "Defect") {
              h.onAllRequestsCleared();
            }
            return writeResponse(response);
          }),
        send: (request, transferables) => {
          if (request._tag === "Request") {
            h.onRequestSent(request.id, request.tag);
          }
          return protocol.send(request, transferables);
        },
      }),
    ),
  );

  return protocolLayer.pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
}
