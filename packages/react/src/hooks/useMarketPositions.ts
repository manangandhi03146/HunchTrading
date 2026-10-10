import { useQuery } from "@tanstack/react-query";
import { useHunch } from "../providers/HunchProvider";
export function useMarketPositions(id: string) {
  const { client, walletAddress } = useHunch();
  return useQuery({
    queryKey: ["positions", id, walletAddress, client.mode],
    queryFn: () => client.getPositions(id, walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: 15000,
  });
}
export function useClaimable(id: string, enabled: boolean) {
  const { client, walletAddress } = useHunch();
  return useQuery({
    queryKey: ["claimable", id, walletAddress, client.mode],
    queryFn: () => client.getClaimableAmount(id, walletAddress!),
    enabled: enabled && !!walletAddress,
    refetchInterval: 15000,
  });
}
