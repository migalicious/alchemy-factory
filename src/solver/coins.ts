import type { GameData } from '../model/types';

export interface CoinCost {
  /** Coins per minute for each raw input; null when it can't be bought (e.g. an item you marked raw). */
  perItem: Record<string, number | null>;
  total: number;
}

/**
 * Coins spent per minute on raw inputs, as upstream: rate x buyPrice, where one recipe
 * unit of a raw is one purchase (1 Iron Ore @1,200 -> 100 Iron Ingot). Currency uses sellPrice.
 */
export function rawCoinCost(db: GameData, raw: Record<string, number>): CoinCost {
  const perItem: Record<string, number | null> = {};
  let total = 0;
  for (const [item, rate] of Object.entries(raw)) {
    const it = db.items[item];
    const price = it?.category === 'Currency' ? it.sellPrice : it?.buyPrice;
    if (price && price > 0) {
      perItem[item] = rate * price;
      total += rate * price;
    } else perItem[item] = null;
  }
  return { perItem, total };
}

/** 1234 -> "1.2k", 3_400_000 -> "3.4M". */
export function fmtCoins(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return abs >= 10 ? n.toFixed(0) : n.toFixed(1);
}
