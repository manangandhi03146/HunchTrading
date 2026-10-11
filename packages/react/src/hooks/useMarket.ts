import { useQuery } from "@tanstack/react-query";
import { useHunch } from "../providers/HunchProvider";
export function useMarket(id: string) {
  const { client } = useHunch();
  return useQuery({
    queryKey: ["market", id, client.mode],
    queryFn: () => client.getMarket(id),
    refetchInterval: (query) =>
      ["resolved", "cancelled"].includes(query.state.data?.status ?? "")
        ? 15000
        : 3000,
  });
}
export function useMarkets() {
  const { client } = useHunch();
  return useQuery({
    queryKey: ["markets", client.mode],
    queryFn: () => client.listMarkets(),
    refetchInterval: 5000,
  });
}
export function useEvents() {
  const { client } = useHunch();
  return useQuery({
    queryKey: ["events", client.mode],
    queryFn: () => client.getEvents(),
    refetchInterval: 3000,
  });
}
export function useBalance() {
  const { client, walletAddress } = useHunch();
  return useQuery({
    queryKey: ["balance", walletAddress, client.mode],
    queryFn: () => client.getTokenBalance(walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: 15000,
  });
}
