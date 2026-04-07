export interface BackendLifecycle {
  readonly type: "local" | "ssh";
  readonly wsUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onUnexpectedExit(handler: (reason: string) => void): void;
}
