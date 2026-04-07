import { ThreadId } from "@t3tools/contracts";
import { Outlet, createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { ActiveServerProvider } from "../connections/activeServerContext";
import {
  getConnection,
  getConnectionRegistryRevision,
  getDefaultConnection,
  subscribeConnectionRegistry,
} from "../connections/connectionRegistry";
import { selectThreadById, useStore } from "../store";

import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { useSettings } from "~/hooks/useSettings";
import { useServerKeybindings } from "~/rpc/serverState";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadIdsSize = useThreadSelectionStore((state) => state.selectedThreadIds.size);
  const { activeDraftThread, activeThread, defaultProjectId, handleNewThread, routeThreadId } =
    useHandleNewThread();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadId
      ? selectThreadTerminalState(state.terminalStateByThreadId, routeThreadId).terminalOpen
      : false,
  );
  const appSettings = useSettings();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && selectedThreadIdsSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? defaultProjectId;
      if (!projectId) return;

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(projectId, {
          envMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(projectId, {
          branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
          worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
          envMode:
            activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
        });
        return;
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectId,
    selectedThreadIdsSize,
    terminalOpen,
    appSettings.defaultThreadEnvMode,
  ]);

  return null;
}

function ChatRouteLayout() {
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const serverId = useStore(
    (s) => (routeThreadId ? selectThreadById(routeThreadId)(s)?.serverId : null) ?? "default",
  );
  const registryRevision = useSyncExternalStore(
    subscribeConnectionRegistry,
    getConnectionRegistryRevision,
    getConnectionRegistryRevision,
  );
  const connection = useMemo(() => {
    void registryRevision;
    return getConnection(serverId) ?? getDefaultConnection();
  }, [registryRevision, serverId]);

  return (
    <ActiveServerProvider connection={connection}>
      <ChatRouteGlobalShortcuts />
      <Outlet />
    </ActiveServerProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
