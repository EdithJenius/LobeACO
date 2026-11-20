import * as sx from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ui } from './chat.style';
import type { LiveResult } from './live';
import { amount, average, summarize } from './dailySummary';
import { st } from './panorama.style';

type Summary = ReturnType<typeof summarize>;
const format = (value: number | null, unit = '') =>
  value === null
    ? '—'
    : (unit === '¥' ? '¥' : '') +
      value.toLocaleString(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: unit ? 2 : 0,
      }) +
      (unit === '%' ? '%' : '');

function Charts({ model }: { model: Summary }) {
  const { t } = useTranslation('agent');
  const { dates, shops, paid, complete } = model;
  const max = Math.max(1, ...shops.flatMap((s) => s.series.map((v) => v ?? 0)));
  const x = (i: number) => 55 + (dates.length === 1 ? 0.5 : i / (dates.length - 1)) * 415;
  const y = (n: number) => 124 - (108 * n) / max;
  let angle = 0;
  const stops = shops.map((s) => {
    const start = angle;
    angle += paid.sum ? (s.paid.sum / paid.sum) * 360 : 0;
    return s.color + ' ' + start + 'deg ' + angle + 'deg';
  });
  return (
    <div {...sx.props(st.columns)}>
      <section {...sx.props(st.box)}>
        <h3 {...sx.props(st.label)}>{t('shops.trend')}</h3>
        {paid.count ? (
          <>
            <svg aria-label={t('shops.trend')} role="img" viewBox="0 0 490 148" width="100%">
              {[0, 0.5, 1].map((frac) => (
                <g key={frac}>
                  <line
                    stroke="currentColor"
                    opacity=".12"
                    x1={55}
                    x2={470}
                    y1={y(frac * max)}
                    y2={y(frac * max)}
                  />
                  <text
                    fill="currentColor"
                    fontSize="10"
                    x={49}
                    y={y(frac * max) + 3}
                    textAnchor="end"
                  >
                    {format(frac * max)}
                  </text>
                </g>
              ))}
              {shops.map((s) => (
                <g key={s.item.shop.id}>
                  {s.series.map((n, i) => {
                    if (n === null) return null;
                    const prev = s.series[i - 1];
                    return (
                      <g key={dates[i]}>
                        {prev != null && (
                          <line
                            stroke={s.color}
                            strokeWidth="2"
                            x1={x(i - 1)}
                            x2={x(i)}
                            y1={y(prev)}
                            y2={y(n)}
                          />
                        )}
                        <circle cx={x(i)} cy={y(n)} fill={s.color} r={2.5}>
                          <title>
                            {s.item.shop.name + ' · ' + dates[i] + ' · ' + format(n, '¥')}
                          </title>
                        </circle>
                      </g>
                    );
                  })}
                </g>
              ))}
              {dates.map(
                (d, i) =>
                  (i === 0 ||
                    i === dates.length - 1 ||
                    (dates.length > 6 && i === Math.floor(dates.length / 2))) && (
                    <text
                      key={d}
                      fill="currentColor"
                      fontSize="10"
                      textAnchor="middle"
                      x={x(i)}
                      y={144}
                    >
                      {d.slice(5)}
                    </text>
                  ),
              )}
            </svg>
            <div {...sx.props(st.legend)}>
              {shops.map((s) => (
                <span key={s.item.shop.id}>
                  <i {...sx.props(st.dot)} style={{ background: s.color }} />
                  {s.item.shop.name}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div {...sx.props(st.empty)}>{t('shops.noTrend')}</div>
        )}
      </section>
      <section {...sx.props(st.box)}>
        <h3 {...sx.props(st.label)}>{t('shops.share')}</h3>
        {complete && paid.sum > 0 ? (
          <>
            <div
              {...sx.props(st.donut)}
              style={{ background: 'conic-gradient(' + stops.join(',') + ')' }}
            >
              <div {...sx.props(st.hole)} />
            </div>
            <div {...sx.props(st.legend)}>
              {shops.map((s) => (
                <span key={s.item.shop.id}>
                  <i {...sx.props(st.dot)} style={{ background: s.color }} />
                  {s.item.shop.name} · {format((100 * s.paid.sum) / paid.sum, '%')}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div {...sx.props(st.empty)}>
            {t(complete ? 'shops.zeroShare' : 'shops.missingShare')}
          </div>
        )}
      </section>
    </div>
  );
}
export function Panorama({ items }: { items: LiveResult[] }) {
  const { t } = useTranslation('agent');
  const [days, setDays] = useState(30);
  const model = summarize(items, days);
  const possible = days * items.length;
  return (
    <>
      <div {...sx.props(st.heading)}>
        <div {...sx.props(st.nav)}>
          {[1, 7, 30].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={days === n}
              {...sx.props(st.btn, days === n && st.active)}
              onClick={() => setDays(n)}
            >
              {t('shops.latestDays', { count: n })}
            </button>
          ))}
        </div>
        <span {...sx.props(st.muted)}>
          {model.dates.length ? model.dates[0] + ' — ' + model.dates.at(-1) : t('shops.noDaily')}
        </span>
      </div>
      <section {...sx.props(st.box)}>
        <h3 {...sx.props(st.label)}>{t('shops.core')}</h3>
        <div {...sx.props(st.four)}>
          {([
            [t('shops.gmv'), format(amount(model.paid), '¥'), model.paid.count],
            [t('shops.avgUv'), format(average(model.visitors)), model.visitors.count],
            [t('shops.avgCvr'), format(average(model.conversion), '%'), model.conversion.count],
            [t('shops.coverage'), model.coverage + ' / ' + possible, null],
          ] as const).map(([title, value, count]) => (
            <div key={title} {...sx.props(st.card)}>
              <span>{title}</span>
              <b {...sx.props(st.number)}>{value}</b>
              <span {...sx.props(st.muted)}>
                {count === null
                  ? t('shops.shopDays')
                  : t('shops.validDays', { valid: String(count), total: String(possible) })}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section {...sx.props(st.box)}>
        <h3 {...sx.props(st.label)}>{t('shops.overview')}</h3>
        <div {...sx.props(ui.scroll)}>
          <table {...sx.props(st.table)}>
            <thead {...sx.props(st.head)}>
              <tr>
                {[
                  'shops.store',
                  'shops.gmv',
                  'shops.avgUv',
                  'shops.avgCvr',
                  'shops.coverage',
                  'shops.asOf',
                ].map((k) => (
                  <th key={k} {...sx.props(st.cell)}>
                    {t(k as 'shops.store')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.shops.map((s) => (
                <tr key={s.item.shop.id}>
                  <th scope="row" {...sx.props(st.cell)}>
                    {s.item.shop.name}
                  </th>
                  {[
                    [format(amount(s.paid), '¥'), s.paid.count],
                    [format(average(s.visitors)), s.visitors.count],
                    [format(average(s.conversion), '%'), s.conversion.count],
                  ].map(([v, n], i) => (
                    <td key={i} {...sx.props(st.cell)}>
                      {v}
                      {n !== days && (
                        <small>
                          {' '}
                          ({n}/{days})
                        </small>
                      )}
                    </td>
                  ))}
                  <td {...sx.props(st.cell)}>
                    {s.coverage}/{days}
                  </td>
                  <td {...sx.props(st.cell)}>
                    {s.capturedAt ? new Date(s.capturedAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p {...sx.props(st.muted)}>{t('shops.metricBasis')}</p>
        {items
          .filter((s) => s.error)
          .map((s) => (
            <div key={s.shop.id} {...sx.props(st.muted)}>
              <b>{s.shop.name}</b> · {s.error}
            </div>
          ))}
      </section>
      <Charts model={model} />
    </>
  );
}



