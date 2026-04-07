import {
  type GitActionProgressEvent,
  type GitStackedAction,
  type ThreadId,
} from "@t3tools/contracts";
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import type { NativeApi } from "@t3tools/contracts";
import { ensureNativeApi } from "../nativeApi";

const GIT_STATUS_STALE_TIME_MS = 5_000;
const GIT_STATUS_REFETCH_INTERVAL_MS = 15_000;
const GIT_BRANCHES_STALE_TIME_MS = 15_000;
const GIT_BRANCHES_REFETCH_INTERVAL_MS = 60_000;
const GIT_BRANCHES_PAGE_SIZE = 100;

export const gitQueryKeys = {
  all: ["git"] as const,
  status: (cwd: string | null, serverId: string = "default") =>
    ["git", "status", serverId, cwd] as const,
  branches: (cwd: string | null, serverId: string = "default") =>
    ["git", "branches", serverId, cwd] as const,
  branchSearch: (cwd: string | null, query: string, serverId: string = "default") =>
    ["git", "branches", serverId, cwd, "search", query] as const,
};

export const gitMutationKeys = {
  init: (cwd: string | null, serverId: string = "default") =>
    ["git", "mutation", "init", serverId, cwd] as const,
  checkout: (cwd: string | null, serverId: string = "default") =>
    ["git", "mutation", "checkout", serverId, cwd] as const,
  runStackedAction: (cwd: string | null, serverId: string = "default") =>
    ["git", "mutation", "run-stacked-action", serverId, cwd] as const,
  pull: (cwd: string | null, serverId: string = "default") =>
    ["git", "mutation", "pull", serverId, cwd] as const,
  preparePullRequestThread: (cwd: string | null, serverId: string = "default") =>
    ["git", "mutation", "prepare-pull-request-thread", serverId, cwd] as const,
};

export function invalidateGitQueries(
  queryClient: QueryClient,
  input?: { cwd?: string | null; serverId?: string },
) {
  const cwd = input?.cwd ?? null;
  const serverId = input?.serverId ?? "default";
  if (cwd !== null) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: gitQueryKeys.status(cwd, serverId) }),
      queryClient.invalidateQueries({ queryKey: gitQueryKeys.branches(cwd, serverId) }),
      queryClient.invalidateQueries({
        queryKey: gitQueryKeys.branchSearch(cwd, "", serverId),
      }),
    ]);
  }

  return queryClient.invalidateQueries({ queryKey: gitQueryKeys.all });
}

export function invalidateGitStatusQuery(
  queryClient: QueryClient,
  cwd: string | null,
  serverId: string = "default",
) {
  if (cwd === null) {
    return Promise.resolve();
  }

  return queryClient.invalidateQueries({ queryKey: gitQueryKeys.status(cwd, serverId) });
}

export function gitStatusQueryOptions(
  cwd: string | null,
  apiOverride?: NativeApi,
  serverId: string = "default",
) {
  return queryOptions({
    queryKey: gitQueryKeys.status(cwd, serverId),
    queryFn: async () => {
      const api = apiOverride ?? ensureNativeApi();
      if (!cwd) throw new Error("Git status is unavailable.");
      return api.git.status({ cwd });
    },
    enabled: cwd !== null,
    staleTime: GIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
  });
}

export function gitBranchSearchInfiniteQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  api?: NativeApi;
  serverId?: string;
}) {
  const normalizedQuery = input.query.trim();
  const serverId = input.serverId ?? "default";

  return infiniteQueryOptions({
    queryKey: gitQueryKeys.branchSearch(input.cwd, normalizedQuery, serverId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const api = input.api ?? ensureNativeApi();
      if (!input.cwd) throw new Error("Git branches are unavailable.");
      return api.git.listBranches({
        cwd: input.cwd,
        ...(normalizedQuery.length > 0 ? { query: normalizedQuery } : {}),
        cursor: pageParam,
        limit: GIT_BRANCHES_PAGE_SIZE,
      });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: input.cwd !== null && (input.enabled ?? true),
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_BRANCHES_REFETCH_INTERVAL_MS,
  });
}

export function gitResolvePullRequestQueryOptions(input: {
  cwd: string | null;
  reference: string | null;
  api?: NativeApi;
  serverId?: string;
}) {
  const serverId = input.serverId ?? "default";
  return queryOptions({
    queryKey: ["git", "pull-request", serverId, input.cwd, input.reference] as const,
    queryFn: async () => {
      const api = input.api ?? ensureNativeApi();
      if (!input.cwd || !input.reference) {
        throw new Error("Pull request lookup is unavailable.");
      }
      return api.git.resolvePullRequest({ cwd: input.cwd, reference: input.reference });
    },
    enabled: input.cwd !== null && input.reference !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function gitInitMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  api?: NativeApi;
  serverId?: string;
}) {
  const serverId = input.serverId ?? "default";
  return mutationOptions({
    mutationKey: gitMutationKeys.init(input.cwd, serverId),
    mutationFn: async () => {
      const api = input.api ?? ensureNativeApi();
      if (!input.cwd) throw new Error("Git init is unavailable.");
      return api.git.init({ cwd: input.cwd });
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient, { cwd: input.cwd, serverId });
    },
  });
}

export function gitCheckoutMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  api?: NativeApi;
  serverId?: string;
}) {
  const serverId = input.serverId ?? "default";
  return mutationOptions({
    mutationKey: gitMutationKeys.checkout(input.cwd, serverId),
    mutationFn: async (branch: string) => {
      const api = input.api ?? ensureNativeApi();
      if (!input.cwd) throw new Error("Git checkout is unavailable.");
      return api.git.checkout({ cwd: input.cwd, branch });
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient, { cwd: input.cwd, serverId });
    },
  });
}

export function gitRunStackedActionMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  api?: NativeApi;
  serverId?: string;
}) {
  const serverId = input.serverId ?? "default";
  return mutationOptions({
    mutationKey: gitMutationKeys.runStackedAction(input.cwd, serverId),
    mutationFn: async ({
      actionId,
      action,
      commitMessage,
      featureBranch,
      filePaths,
      onProgress,
    }: {
      actionId: string;
      action: GitStackedAction;
      commitMessage?: string;
      featureBranch?: boolean;
      filePaths?: string[];
      onProgress?: (event: GitActionProgressEvent) => void;
    }) => {
      if (!input.cwd) throw new Error("Git action is unavailable.");
      const api = input.api ?? ensureNativeApi();
      return api.git.runStackedAction(
        {
          actionId,
          cwd: input.cwd,
          action,
          ...(commitMessage ? { commitMessage } : {}),
          ...(featureBranch ? { featureBranch } : {}),
          ...(filePaths ? { filePaths } : {}),
        },
        ...(onProgress ? [{ onProgress }] : []),
      );
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient, { cwd: input.cwd, serverId });
    },
  });
}

export function gitPullMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  api?: NativeApi;
  serverId?: string;
}) {
  const serverId = input.serverId ?? "default";
  return mutationOptions({
    mutationKey: gitMutationKeys.pull(input.cwd, serverId),
    mutationFn: async () => {
      const api = input.api ?? ensureNativeApi();
      if (!input.cwd) throw new Error("Git pull is unavailable.");
      return api.git.pull({ cwd: input.cwd });
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient, { cwd: input.cwd, serverId });
    },
  });
}

export function gitCreateWorktreeMutationOptions(input: {
  queryClient: QueryClient;
  api?: NativeApi;
  serverId?: string;
}) {
  const serverId = input.serverId ?? "default";
  return mutationOptions({
    mutationFn: async ({
      cwd,
      branch,
      newBranch,
      path,
    }: {
      cwd: string;
      branch: string;
      newBranch: string;
      path?: string | null;
    }) => {
      const api = input.api ?? ensureNativeApi();
      if (!cwd) throw new Error("Git worktree creation is unavailable.");
      return api.git.createWorktree({ cwd, branch, newBranch, path: path ?? null });
    },
    mutationKey: ["git", "mutation", "create-worktree", serverId] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient, { serverId });
    },
  });
}

export function gitRemoveWorktreeMutationOptions(input: {
  queryClient: QueryClient;
  api?: NativeApi;
  serverId?: string;
}) {
  const serverId = input.serverId ?? "default";
  return mutationOptions({
    mutationFn: async ({ cwd, path, force }: { cwd: string; path: string; force?: boolean }) => {
      const api = input.api ?? ensureNativeApi();
      if (!cwd) throw new Error("Git worktree removal is unavailable.");
      return api.git.removeWorktree({ cwd, path, force });
    },
    mutationKey: ["git", "mutation", "remove-worktree", serverId] as const,
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient, { serverId });
    },
  });
}

export function gitPreparePullRequestThreadMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  api?: NativeApi;
  serverId?: string;
}) {
  const serverId = input.serverId ?? "default";
  return mutationOptions({
    mutationFn: async ({
      reference,
      mode,
      threadId,
    }: {
      reference: string;
      mode: "local" | "worktree";
      threadId?: ThreadId;
    }) => {
      const api = input.api ?? ensureNativeApi();
      if (!input.cwd) throw new Error("Pull request thread preparation is unavailable.");
      return api.git.preparePullRequestThread({
        cwd: input.cwd,
        reference,
        mode,
        ...(threadId ? { threadId } : {}),
      });
    },
    mutationKey: gitMutationKeys.preparePullRequestThread(input.cwd, serverId),
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient, { cwd: input.cwd, serverId });
    },
  });
}
