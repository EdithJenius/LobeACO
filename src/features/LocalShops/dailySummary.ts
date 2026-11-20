import type { LiveResult } from './live';

const dayMs = 86_400_000;
export const seriesColors = ['#6760cf', '#188574', '#be731c', '#ad5686', '#477cb8'];
type Metric = { count: number; sum: number };
export const average = (metric: Metric) => (metric.count ? metric.sum / metric.count : null);
export const amount = (metric: Metric) => (metric.count ? metric.sum : null);

function metric(values: (number | null)[]): Metric {
  const known = values.filter((n): n is number => n !== null);
  return { count: known.length, sum: known.reduce((a, b) => a + b, 0) };
}
function numberCell(value: string | null | undefined) {
  if (value == null || !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function summarize(items: LiveResult[], days: number) {
  const end = items
    .flatMap((item) => (item.data?.report?.rows ?? []).map((r) => r['日期']))
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  const dates = end
    ? Array.from({ length: days }, (_, i) =>
        new Date(Date.parse(end) - (days - i - 1) * dayMs).toISOString().slice(0, 10),
      )
    : [];
  const shops = items.map((item, i) => {
    const rows = new Map((item.data?.report?.rows ?? []).map((r) => [r['日期'], r]));
    const cells = dates.map((d) => rows.get(d));
    const series = cells.map((r) => numberCell(r?.['支付金额(元)']));
    return {
      item,
      color: seriesColors[i % seriesColors.length],
      series,
      capturedAt: item.data?.report?.capturedAt,
      coverage: cells.filter(Boolean).length,
      paid: metric(series),
      visitors: metric(cells.map((r) => numberCell(r?.['访客数']))),
      conversion: metric(cells.map((r) => numberCell(r?.['支付转化率(%)']))),
    };
  });
  const combined = (key: 'paid' | 'visitors' | 'conversion') =>
    shops.reduce((m, s) => ({ count: m.count + s[key].count, sum: m.sum + s[key].sum }), {
      count: 0,
      sum: 0,
    });
  return {
    dates,
    shops,
    days,
    paid: combined('paid'),
    visitors: combined('visitors'),
    conversion: combined('conversion'),
    coverage: shops.reduce((n, s) => n + s.coverage, 0),
    complete: !!shops.length && shops.every((s) => s.paid.count === days),
  };
}
