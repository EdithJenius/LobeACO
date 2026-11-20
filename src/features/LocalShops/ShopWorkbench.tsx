import * as sx from '@stylexjs/stylex';
import { Headset, Store, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import ImperativeModal from '@/components/ImperativeModal';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { type Access, type LinkKey, liveReport, type SnapshotKind } from './live';
import { Panorama } from './Panorama';
import { st } from './panorama.style';
import { Report } from './StoredReport';

export const groups = [
  { key: 'customers', icon: UsersRound, kinds: ['todo', 'quality'] },
  { key: 'panorama', icon: Store, kinds: ['daily', 'finance', 'products', 'quality', 'todo'] },
  { key: 'operator', icon: Headset, kinds: ['todo', 'products'] },
] as const;
export function ShopWorkbench({
  access,
  link,
  initialGroup,
  onClose,
}: {
  access: Access;
  link: LinkKey;
  initialGroup: number;
  onClose: () => void;
}) {
  const { t } = useTranslation('agent');
  const [group, setGroup] = useState(initialGroup);
  const [preferredKind, setKind] = useState<SnapshotKind>(groups[initialGroup].kinds[0]);
  const [shop, setShop] = useState('');
  const selected = access.shops.filter((s) => access.accounts.includes(s.id));
  const displayed = selected.filter((s) => !shop || s.id === shop);
  const inPanorama = groups[group].key === 'panorama';
  const hasPdd = displayed.some((s) => s.platform === 'pinduoduo');
  const kinds: SnapshotKind[] = inPanorama
    ? [
        ...(hasPdd ? ['pddOverview' as const] : []),
        ...(displayed.some((s) => s.platform === 'taobao') ? groups[group].kinds
          : displayed.some((s) => s.platform !== 'pinduoduo') ? ['todo' as const] : []),
      ]
    : [...groups[group].kinds];
  const kind = kinds.includes(preferredKind) ? preferredKind : kinds[0];
  const accounts = displayed.filter((s) => {
    if (!inPanorama) return true;
    if (kind === 'pddOverview') return s.platform === 'pinduoduo';
    return kind === 'todo' || s.platform === 'taobao';
  }).map((s) => s.id);
  const { data, error, isValidating } = useSWR(
    accounts.length ? ['shop-snapshots', link, access.revision, kind, accounts] : null,
    () => liveReport(link, { ...access, accounts }, kind, 'snapshot'),
    { shouldRetryOnError: false, revalidateOnFocus: false, dedupingInterval: 0 },
  );
  const visible = data ?? [];
  const title = t(`shops.workbench.${groups[group].key}`);
  return (
    <ImperativeModal
      open
      footer={null}
      title={
        <div {...sx.props(st.nav)}>
          {groups.map((g, i) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={group === i}
              {...sx.props(st.btn, group === i && st.active)}
              onClick={() => {
                setGroup(i);
                setKind(g.kinds[0]);
              }}
            >
              <g.icon size={15} />
              {t(`shops.workbench.${g.key}`)}
            </button>
          ))}
        </div>
      }
      width="min(96vw, 1520px)"
      styles={{ body: { maxHeight: '80dvh', overflowY: 'auto' } }}
      onCancel={onClose}
    >
      <div {...sx.props(st.sheet)}>
        <div {...sx.props(st.heading)}>
          <h2 {...sx.props(st.title)}>{title}</h2>
          <select
            aria-label={t('shops.displayShops')}
            value={shop}
            {...sx.props(st.select)}
            onChange={(e) => setShop(e.target.value)}
          >
            <option value="">{t('shops.selectedShops', { count: selected.length })}</option>
            {selected.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div {...sx.props(st.nav)}>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              {...sx.props(st.btn, kind === k && st.active)}
              onClick={() => setKind(k)}
            >
              {t(k === 'daily' ? 'shops.dailyAnalysis' : `shops.report.${k}`)}
            </button>
          ))}
        </div>
        <div {...sx.props(st.muted)}>
          {t('shops.snapshotHint')} ·{' '}
          <WorkspaceLink to="/stores" onClick={onClose}>
            {t('shops.title')}
          </WorkspaceLink>
        </div>
        {error ? (
          <div role="alert">{error.message}</div>
        ) : !data || isValidating ? (
          <p role="status">{t('shops.loading')}</p>
        ) : kind === 'daily' ? (
          <Panorama items={visible} />
        ) : kind === 'pddOverview' ? (
          visible.map(({ shop: current, data: snapshot, error: issue }) => (
            <section key={current.id} {...sx.props(st.box)}>
              <div {...sx.props(st.heading)}>
                <strong>{current.name}</strong>
                {snapshot?.report && <time {...sx.props(st.muted)} dateTime={snapshot.report.capturedAt}>
                  {new Date(snapshot.report.capturedAt).toLocaleString()}
                </time>}
              </div>
              {issue && <p role="alert">{issue}</p>}
              {snapshot?.report && <p {...sx.props(st.muted)}>{snapshot.report.scope}</p>}
              {Object.entries(snapshot?.report?.sections ?? {}).map(([section, fields]) =>
                Object.keys(fields).length > 0 && <section key={section}>
                  <h3 {...sx.props(st.label)}>{section}</h3>
                  <dl {...sx.props(st.four)}>
                    {Object.entries(fields).map(([label, value]) => typeof value === 'string' && (
                      <div key={label} {...sx.props(st.card)}>
                        <dt {...sx.props(st.muted)}>{label}</dt>
                        <dd style={{ margin: 0 }} {...sx.props(st.number)}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </section>
          ))
        ) : (
          visible.map((item) => <Report item={item} key={item.shop.id} />)
        )}
      </div>
    </ImperativeModal>
  );
}
