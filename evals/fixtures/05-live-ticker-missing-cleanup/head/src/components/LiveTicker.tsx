import { useEffect, useState } from "react";

export interface LiveTickerProps {
  symbol: string;
}

/**
 * Subscribes to live price updates for a symbol and renders the latest price.
 */
export function LiveTicker({ symbol }: LiveTickerProps) {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    const socket = openPriceStream(symbol);
    socket.onMessage((update) => setPrice(update.price));
  }, [symbol]);

  return <span className="ticker">{price ?? "—"}</span>;
}
