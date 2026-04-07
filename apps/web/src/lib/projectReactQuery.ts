import type { NativeApi, ProjectSearchEntriesResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (cwd: string | null, query: string, limit: number, serverId: string = "default") =>
    ["projects", "search-entries", serverId, cwd, query, limit] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
  api?: NativeApi;
  serverId?: string;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  const serverId = input.serverId ?? "default";
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit, serverId),
    queryFn: async () => {
      const api = input.api ?? ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}
