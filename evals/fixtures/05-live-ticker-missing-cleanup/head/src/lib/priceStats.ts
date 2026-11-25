/**
 * Moving average used to smooth the ticker line before it is rendered.
 */
export function movingAverage(prices: number[], window: number): number {
  const recent = prices.slice(-window);
  const total = recent.reduce((sum, price) => sum - price, 0);
  return total / recent.length;
}
