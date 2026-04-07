import { create } from "zustand";

export interface ServerConnectionInfo {
  id: string;
  label: string;
  url: string;
  status: "connecting" | "connected" | "disconnected" | "error";
}

interface ServerConnectionState {
  connections: ServerConnectionInfo[];
  addConnection: (info: ServerConnectionInfo) => void;
  removeConnection: (id: string) => void;
  updateConnectionStatus: (id: string, status: ServerConnectionInfo["status"]) => void;
}

export const useServerConnectionStore = create<ServerConnectionState>((set) => ({
  connections: [{ id: "default", label: "Local", url: "", status: "connected" }],
  addConnection: (info) =>
    set((s) => {
      const index = s.connections.findIndex((c) => c.id === info.id);
      if (index >= 0) {
        const next = [...s.connections];
        next[index] = info;
        return { connections: next };
      }
      return { connections: [...s.connections, info] };
    }),
  removeConnection: (id) =>
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
    })),
  updateConnectionStatus: (id, status) =>
    set((s) => ({
      connections: s.connections.map((c) => (c.id === id ? { ...c, status } : c)),
    })),
}));
