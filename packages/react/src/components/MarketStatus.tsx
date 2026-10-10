import { Badge } from "./ui";
import type { Market } from "../types";
export function MarketStatus({ status }: { status: Market["status"] }) {
  return (
    <Badge
      tone={
        status === "open"
          ? "success"
          : status === "resolved"
            ? "violet"
            : "warning"
      }
    >
      {
        {
          open: "Open",
          closed: "Awaiting result",
          resolved: "Resolved",
          cancelled: "Cancelled",
        }[status]
      }
    </Badge>
  );
}
