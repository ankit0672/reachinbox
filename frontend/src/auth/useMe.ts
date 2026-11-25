import { useQuery } from "@tanstack/react-query";
import { getMe } from "../api/auth";

export const meQueryKey = ["auth", "me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: getMe,
    retry: false, // the guard shows a retry button instead
    staleTime: 5 * 60_000,
  });
}
