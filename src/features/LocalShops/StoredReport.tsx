import { Text } from '@lobehub/ui';
import * as sx from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { ui } from './chat.style';
import type { LiveResult } from './live';

export function Report({ item }: { item: LiveResult }) {
  const { t } = useTranslation('agent');
  const report = item.data?.report,
    run = item.data?.latest;
  return (
    <section {...sx.props(ui.result)}>
      <div {...sx.props(ui.line)}>
        <strong>{item.shop.name}</strong>
        {(report?.capturedAt || run?.finishedAt) && (
          <Text type="secondary">
            {new Date((report?.capturedAt || run?.finishedAt)!).toLocaleString()}
          </Text>
        )}
      </div>
      {item.error && <Text type="danger">{item.error}</Text>}
      {run && (
        <div {...sx.props(ui.metrics)}>
          {Object.entries(run.metrics).map(([k, v]) => (
            <span key={k}>
              {k} <b>{v ?? '—'}</b>
            </span>
          ))}
        </div>
      )}
      {report && (
        <>
          <Text type="secondary">{report.scope}</Text>
          {Object.entries(report.sources ?? {}).map(([hash, source]) => (
            <details key={hash}>
              <summary>
                {source.originalName} · {source.sheet} · {hash.slice(0, 12)}
              </summary>
              <code>{source.file}</code>
            </details>
          ))}
          {report.rows &&
            (report.rows.length ? (
              <div {...sx.props(ui.scroll)}>
                <table {...sx.props(ui.table)}>
                  <thead>
                    <tr>
                      {Object.keys(report.rows[0]).map((k) => (
                        <th key={k} {...sx.props(ui.cell)}>
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, i) => (
                      <tr key={i}>
                        {Object.keys(report.rows![0]).map((k) => (
                          <td key={k} {...sx.props(ui.cell)}>
                            {row[k] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>{t('shops.empty')}</p>
            ))}
          {Object.entries(report.sections ?? {}).map(([section, entries]) => (
            <details key={section}>
              <summary>
                {section} {entries.period ?? ''}
              </summary>
              <div {...sx.props(ui.metrics)}>
                {Object.entries(entries)
                  .filter(([k]) => k !== 'period')
                  .flatMap(([k, v]) =>
                    typeof v === 'object' && v !== null ? (
                      Object.entries(v).map(([n, x]) => (
                        <span key={k + n}>
                          {k} / {n} <b>{x ?? '—'}</b>
                        </span>
                      ))
                    ) : (
                      <span key={k}>
                        {k} <b>{v ?? '—'}</b>
                      </span>
                    ),
                  )}
              </div>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
