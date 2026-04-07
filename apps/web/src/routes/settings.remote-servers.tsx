import { createFileRoute } from "@tanstack/react-router";
import {
  MonitorIcon,
  PlusIcon,
  XIcon,
  PlugIcon,
  UnplugIcon,
  PencilIcon,
  Trash2Icon,
  LoaderIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SshHostConfig } from "@t3tools/contracts";

import { isElectron } from "../env";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { addConnection, removeConnection } from "../connections/connectionRegistry";
import { useServerConnectionStore, type ServerConnectionInfo } from "../serverConnectionStore";

export const Route = createFileRoute("/settings/remote-servers")({
  component: RemoteServersPanel,
});

// ---------------------------------------------------------------------------
// localStorage persistence for web-only mode
// ---------------------------------------------------------------------------

const REMOTE_HOSTS_STORAGE_KEY = "t3code:remote-hosts:v1";

interface WebHostConfig {
  id: string;
  label: string;
  wsUrl: string;
  authToken?: string | undefined;
}

function loadWebHosts(): WebHostConfig[] {
  try {
    const raw = localStorage.getItem(REMOTE_HOSTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WebHostConfig[]) : [];
  } catch {
    return [];
  }
}

function saveWebHosts(hosts: WebHostConfig[]): void {
  localStorage.setItem(REMOTE_HOSTS_STORAGE_KEY, JSON.stringify(hosts));
}

// ---------------------------------------------------------------------------
// Desktop host persistence helpers (delegates to desktopBridge)
// ---------------------------------------------------------------------------

async function loadDesktopHosts(): Promise<SshHostConfig[]> {
  try {
    return (await window.desktopBridge?.sshListHosts()) ?? [];
  } catch {
    return [];
  }
}

async function saveDesktopHost(config: SshHostConfig): Promise<void> {
  await window.desktopBridge?.sshSaveHost(config);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function connectionStatusLabel(status: ServerConnectionInfo["status"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
  }
}

function statusDotClass(status: ServerConnectionInfo["status"]): string {
  switch (status) {
    case "connected":
      return "bg-success";
    case "connecting":
      return "bg-amber-400";
    case "disconnected":
      return "bg-muted-foreground/40";
    case "error":
      return "bg-destructive";
  }
}

// ---------------------------------------------------------------------------
// SettingsPageContainer / SettingsSection (matching SettingsPanels.tsx)
// ---------------------------------------------------------------------------

function SettingsPageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">{children}</div>
    </div>
  );
}

function SettingsSection({
  title,
  icon,
  headerAction,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs/5 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Panel component
// ---------------------------------------------------------------------------

function RemoteServersPanel() {
  const isDesktop = isElectron;
  const storeConnections = useServerConnectionStore((s) => s.connections);

  // Desktop: SSH host configs
  const [desktopHosts, setDesktopHosts] = useState<SshHostConfig[]>([]);
  // Web: simple ws configs
  const [webHosts, setWebHosts] = useState<WebHostConfig[]>([]);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connectingIds, setConnectingIds] = useState<Set<string>>(new Set());
  const [connectError, setConnectError] = useState<string | null>(null);

  // Desktop form fields
  const [formLabel, setFormLabel] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formUser, setFormUser] = useState("");
  const [formPort, setFormPort] = useState(22);
  const [formIdentityFile, setFormIdentityFile] = useState("");
  const [formRemoteProjectPath, setFormRemoteProjectPath] = useState("");
  const [formRemoteServerPort, setFormRemoteServerPort] = useState(3773);

  // Web form fields
  const [formWsUrl, setFormWsUrl] = useState("");
  const [formAuthToken, setFormAuthToken] = useState("");

  // Load saved hosts on mount
  useEffect(() => {
    if (isDesktop) {
      void loadDesktopHosts().then(setDesktopHosts);
    } else {
      setWebHosts(loadWebHosts());
    }
  }, [isDesktop]);

  const getConnectionStatus = useCallback(
    (hostId: string): ServerConnectionInfo["status"] | null => {
      const conn = storeConnections.find((c) => c.id === hostId);
      return conn?.status ?? null;
    },
    [storeConnections],
  );

  function resetForm(): void {
    setFormLabel("");
    setFormHost("");
    setFormUser("");
    setFormPort(22);
    setFormIdentityFile("");
    setFormRemoteProjectPath("");
    setFormRemoteServerPort(3773);
    setFormWsUrl("");
    setFormAuthToken("");
    setEditingId(null);
    setShowForm(false);
    setConnectError(null);
  }

  // ---- Desktop: Save SSH host ----
  const handleSaveDesktopHost = useCallback(async () => {
    const id = editingId ?? generateId();
    const config: SshHostConfig = {
      id,
      label: formLabel || formHost,
      host: formHost,
      user: formUser,
      port: formPort,
      ...(formIdentityFile ? { identityFile: formIdentityFile } : {}),
      remoteProjectPath: formRemoteProjectPath,
      remoteServerPort: formRemoteServerPort,
    };

    await saveDesktopHost(config);
    const hosts = await loadDesktopHosts();
    setDesktopHosts(hosts);
    resetForm();
  }, [
    editingId,
    formLabel,
    formHost,
    formUser,
    formPort,
    formIdentityFile,
    formRemoteProjectPath,
    formRemoteServerPort,
  ]);

  // ---- Web: Save web host ----
  const handleSaveWebHost = useCallback(() => {
    const id = editingId ?? generateId();
    const config: WebHostConfig = {
      id,
      label: formLabel || formWsUrl,
      wsUrl: formWsUrl,
      ...(formAuthToken ? { authToken: formAuthToken } : {}),
    };

    const existing = loadWebHosts();
    const idx = existing.findIndex((h) => h.id === id);
    if (idx >= 0) {
      existing[idx] = config;
    } else {
      existing.push(config);
    }
    saveWebHosts(existing);
    setWebHosts(existing);
    resetForm();
  }, [editingId, formLabel, formWsUrl, formAuthToken]);

  // ---- Desktop: Connect ----
  const handleDesktopConnect = useCallback(async (host: SshHostConfig) => {
    setConnectingIds((prev) => new Set(prev).add(host.id));
    setConnectError(null);
    try {
      const result = await window.desktopBridge!.sshConnect(host);
      addConnection({
        id: host.id,
        label: host.label,
        url: result.wsUrl,
      });
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setConnectingIds((prev) => {
        const next = new Set(prev);
        next.delete(host.id);
        return next;
      });
    }
  }, []);

  // ---- Web: Connect ----
  const handleWebConnect = useCallback((host: WebHostConfig) => {
    addConnection({
      id: host.id,
      label: host.label,
      url: host.wsUrl,
    });
  }, []);

  // ---- Disconnect ----
  const handleDisconnect = useCallback(async (id: string) => {
    await removeConnection(id);
    if (isElectron) {
      await window.desktopBridge?.sshDisconnect(id);
    }
  }, []);

  // ---- Delete ----
  const handleDeleteDesktopHost = useCallback(
    async (id: string) => {
      // Disconnect first if connected
      const status = getConnectionStatus(id);
      if (status === "connected" || status === "connecting") {
        await handleDisconnect(id);
      }

      // Re-load hosts, filter, re-save
      const hosts = await loadDesktopHosts();
      const filtered = hosts.filter((h) => h.id !== id);
      // Desktop doesn't have a delete API, so we reload the list
      // after disconnecting — the host list is managed by the bridge
      setDesktopHosts(filtered);
    },
    [getConnectionStatus, handleDisconnect],
  );

  const handleDeleteWebHost = useCallback(
    async (id: string) => {
      const status = getConnectionStatus(id);
      if (status === "connected" || status === "connecting") {
        await handleDisconnect(id);
      }

      const hosts = loadWebHosts().filter((h) => h.id !== id);
      saveWebHosts(hosts);
      setWebHosts(hosts);
    },
    [getConnectionStatus, handleDisconnect],
  );

  // ---- Edit ----
  function startEditDesktopHost(host: SshHostConfig): void {
    setEditingId(host.id);
    setFormLabel(host.label);
    setFormHost(host.host);
    setFormUser(host.user);
    setFormPort(host.port);
    setFormIdentityFile(host.identityFile ?? "");
    setFormRemoteProjectPath(host.remoteProjectPath);
    setFormRemoteServerPort(host.remoteServerPort);
    setShowForm(true);
    setConnectError(null);
  }

  function startEditWebHost(host: WebHostConfig): void {
    setEditingId(host.id);
    setFormLabel(host.label);
    setFormWsUrl(host.wsUrl);
    setFormAuthToken(host.authToken ?? "");
    setShowForm(true);
    setConnectError(null);
  }

  const canSaveDesktop = formHost.trim().length > 0 && formUser.trim().length > 0;
  const canSaveWeb = formWsUrl.trim().length > 0;

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Remote Servers"
        icon={<MonitorIcon className="size-3.5" />}
        headerAction={
          !showForm ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              <PlusIcon className="size-3.5" />
              Add remote server
            </Button>
          ) : null
        }
      >
        {/* --- Add/Edit form --- */}
        {showForm && (
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">
                {editingId ? "Edit server" : "Add remote server"}
              </h3>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            </div>

            {isDesktop ? (
              /* Desktop SSH form */
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldGroup label="Label">
                  <Input
                    value={formLabel}
                    onChange={(e) => setFormLabel((e.target as HTMLInputElement).value)}
                    placeholder="GPU Box"
                    size="sm"
                  />
                </FieldGroup>
                <FieldGroup label="Host">
                  <Input
                    value={formHost}
                    onChange={(e) => setFormHost((e.target as HTMLInputElement).value)}
                    placeholder="192.168.1.50"
                    size="sm"
                  />
                </FieldGroup>
                <FieldGroup label="User">
                  <Input
                    value={formUser}
                    onChange={(e) => setFormUser((e.target as HTMLInputElement).value)}
                    placeholder="user"
                    size="sm"
                  />
                </FieldGroup>
                <FieldGroup label="SSH Port">
                  <Input
                    type="number"
                    value={formPort}
                    onChange={(e) =>
                      setFormPort(Number((e.target as HTMLInputElement).value) || 22)
                    }
                    size="sm"
                  />
                </FieldGroup>
                <FieldGroup label="Identity File">
                  <Input
                    value={formIdentityFile}
                    onChange={(e) => setFormIdentityFile((e.target as HTMLInputElement).value)}
                    placeholder="~/.ssh/id_ed25519"
                    size="sm"
                  />
                </FieldGroup>
                <FieldGroup label="Remote Project Path">
                  <Input
                    value={formRemoteProjectPath}
                    onChange={(e) => setFormRemoteProjectPath((e.target as HTMLInputElement).value)}
                    placeholder="/home/user/my-project"
                    size="sm"
                  />
                </FieldGroup>
                <FieldGroup label="Remote Server Port">
                  <Input
                    type="number"
                    value={formRemoteServerPort}
                    onChange={(e) =>
                      setFormRemoteServerPort(Number((e.target as HTMLInputElement).value) || 3773)
                    }
                    size="sm"
                  />
                </FieldGroup>
              </div>
            ) : (
              /* Web-only form */
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldGroup label="Label">
                  <Input
                    value={formLabel}
                    onChange={(e) => setFormLabel((e.target as HTMLInputElement).value)}
                    placeholder="My Remote Server"
                    size="sm"
                  />
                </FieldGroup>
                <FieldGroup label="WebSocket URL">
                  <Input
                    value={formWsUrl}
                    onChange={(e) => setFormWsUrl((e.target as HTMLInputElement).value)}
                    placeholder="ws://localhost:3774"
                    size="sm"
                  />
                </FieldGroup>
                <FieldGroup label="Auth Token (optional)">
                  <Input
                    value={formAuthToken}
                    onChange={(e) => setFormAuthToken((e.target as HTMLInputElement).value)}
                    placeholder="Optional"
                    size="sm"
                  />
                </FieldGroup>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button size="xs" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button
                size="xs"
                disabled={isDesktop ? !canSaveDesktop : !canSaveWeb}
                onClick={() => {
                  if (isDesktop) {
                    void handleSaveDesktopHost();
                  } else {
                    handleSaveWebHost();
                  }
                }}
              >
                {editingId ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        )}

        {/* --- Host list --- */}
        {isDesktop
          ? desktopHosts.map((host) => {
              const status = getConnectionStatus(host.id);
              const isConnecting = connectingIds.has(host.id);
              const isConnected = status === "connected";

              return (
                <HostRow
                  key={host.id}
                  label={host.label}
                  detail={`${host.user}@${host.host}:${host.port}`}
                  status={status}
                  isConnecting={isConnecting}
                  onConnect={() => void handleDesktopConnect(host)}
                  onDisconnect={() => void handleDisconnect(host.id)}
                  onEdit={() => startEditDesktopHost(host)}
                  onDelete={() => void handleDeleteDesktopHost(host.id)}
                  isConnected={isConnected}
                />
              );
            })
          : webHosts.map((host) => {
              const status = getConnectionStatus(host.id);
              const isConnected = status === "connected";

              return (
                <HostRow
                  key={host.id}
                  label={host.label}
                  detail={host.wsUrl}
                  status={status}
                  isConnecting={false}
                  onConnect={() => handleWebConnect(host)}
                  onDisconnect={() => void handleDisconnect(host.id)}
                  onEdit={() => startEditWebHost(host)}
                  onDelete={() => void handleDeleteWebHost(host.id)}
                  isConnected={isConnected}
                />
              );
            })}

        {/* Empty state */}
        {((isDesktop && desktopHosts.length === 0) || (!isDesktop && webHosts.length === 0)) &&
          !showForm && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No remote servers configured.
            </div>
          )}

        {/* Connection error */}
        {connectError && (
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs text-destructive">{connectError}</p>
          </div>
        )}
      </SettingsSection>

      {/* Instructions for web-only users */}
      {!isDesktop && (
        <SettingsSection title="How to connect">
          <div className="px-4 py-4 text-xs leading-relaxed text-muted-foreground sm:px-5">
            <ol className="list-inside list-decimal space-y-1.5">
              <li>Start t3code on your remote machine.</li>
              <li>
                Set up SSH port forwarding, e.g.:{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  ssh -L 3774:localhost:3773 user@remote
                </code>
              </li>
              <li>
                Add a remote server above with WebSocket URL{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  ws://localhost:3774
                </code>
              </li>
            </ol>
          </div>
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function HostRow({
  label,
  detail,
  status,
  isConnecting,
  isConnected,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: {
  label: string;
  detail: string;
  status: ServerConnectionInfo["status"] | null;
  isConnecting: boolean;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
          {status && (
            <span className="flex items-center gap-1">
              <span className={`inline-block size-1.5 rounded-full ${statusDotClass(status)}`} />
              <span className="text-[11px] text-muted-foreground">
                {connectionStatusLabel(status)}
              </span>
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isConnected ? (
          <Button size="xs" variant="outline" onClick={onDisconnect}>
            <UnplugIcon className="size-3" />
            Disconnect
          </Button>
        ) : (
          <Button
            size="xs"
            variant="outline"
            onClick={onConnect}
            disabled={isConnecting || status === "connecting"}
          >
            {isConnecting || status === "connecting" ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <PlugIcon className="size-3" />
            )}
            Connect
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" onClick={onEdit} disabled={isConnected}>
          <PencilIcon className="size-3" />
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={onDelete} disabled={isConnected}>
          <Trash2Icon className="size-3" />
        </Button>
      </div>
    </div>
  );
}
