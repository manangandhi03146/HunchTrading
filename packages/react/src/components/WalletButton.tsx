import { Wallet, LogOut } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useHunch } from "../providers/HunchProvider";
import { Button } from "./ui";
import { shortAddress } from "../types";
export function WalletButton() {
  const { mode, walletAddress, demoConnect, disconnect } = useHunch();
  if (mode === "sdk")
    return (
      <div className="hunch-wallet-live">
        <WalletMultiButton />
        {walletAddress && (
          <Button
            variant="ghost"
            onClick={disconnect}
            aria-label="Disconnect wallet"
          >
            <LogOut size={15} />
          </Button>
        )}
      </div>
    );
  return (
    <Button
      variant="secondary"
      onClick={walletAddress ? disconnect : demoConnect}
    >
      <Wallet size={15} />
      {walletAddress ? "Disconnect demo account" : "Connect demo account"}
      {walletAddress && <LogOut size={14} />}
    </Button>
  );
}
export function WalletAddress() {
  const { walletAddress, mode } = useHunch();
  return (
    <span>
      {walletAddress
        ? mode === "mock"
          ? "Demo spectator"
          : shortAddress(walletAddress)
        : "No wallet connected"}
    </span>
  );
}
