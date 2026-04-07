import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { NativeApi } from "@t3tools/contracts";
import { getDefaultConnection } from "./connectionRegistry";
import { ConnectionId, type ConnectionEntry } from "./types";
import { buildNativeApiFromRpcClient, createWsNativeApi } from "../wsNativeApi";

const ActiveServerContext = createContext<ConnectionEntry | null>(null);

export function ActiveServerProvider({
  children,
  connection,
}: {
  children: ReactNode;
  connection?: ConnectionEntry;
}) {
  const entry = connection ?? getDefaultConnection();
  return <ActiveServerContext.Provider value={entry}>{children}</ActiveServerContext.Provider>;
}

export function useActiveConnection(): ConnectionEntry {
  const entry = useContext(ActiveServerContext);
  if (!entry) {
    return getDefaultConnection();
  }
  return entry;
}

export function useActiveApi(): NativeApi {
  const connection = useActiveConnection();
  return useMemo(() => {
    // For the default connection, use the existing singleton to avoid breaking anything.
    if (connection.id === ConnectionId("default")) {
      return createWsNativeApi();
    }
    // For non-default connections, build a NativeApi from the connection's rpcClient.
    return buildNativeApiFromRpcClient(connection.rpcClient);
  }, [connection.id, connection.rpcClient]);
}
