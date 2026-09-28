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

/**
 * Prices in the data are copper. In-game 1,000 copper = 1 silver and 100 silver = 1 gold
 * (Silver Coin sells for 1,000, Gold Coin for 100,000), so show the largest unit:
 * with medal emoji as the coin icons: 850 -> "850 🥉", 19_600 -> "19.6 🥈", 250_000 -> "2.5 🥇".
 */
export function fmtCoins(copper: number): string {
  const abs = Math.abs(copper);
  const num = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/\.?0+$/, ''));
  if (abs >= 100_000) return `${num(copper / 100_000)} 🥇`;
  if (abs >= 1_000) return `${num(copper / 1_000)} 🥈`;
  return `${num(copper)} 🥉`;
}
