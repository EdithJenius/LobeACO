'use client';

import { Alert, Button, createModal, Flexbox, Input, Switch, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CalendarClock, Link2, Plus, RefreshCw, Search, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import type { LocalShop } from '@/services/localShops';
import { localShopsActions, useLocalShopsStore } from '@/store/localShops';

import { BindShop } from './BindShop';
import { accountPlatforms } from './platforms';
import { greenAction, styles } from './style';

const supportsLoginCheck = (shop: LocalShop) => shop.canCheckLogin ?? shop.platform === 'taobao';
const supportsCollection = (shop: LocalShop) => shop.canCollect ?? shop.platform === 'taobao';

export const LocalShops = () => {
  const { t } = useTranslation('agent');
  const sync = localShopsActions.useFetch();
  const data = useLocalShopsStore((s) => s.data.local);
  const [platformFilter, setPlatformFilter] = useState('');
  const watchingLogin = Boolean(
    data?.shops?.some(
      (s) => supportsLoginCheck(s) && (s.manual || s.pendingCheck || s.authStatus === 'checking'),
    ),
  );
  useEffect(() => {
    if (!watchingLogin) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await localShopsActions.refresh();
      } catch {
        /* The next poll retries a transient connection failure. */
      }
      if (active) timer = setTimeout(poll, 1400);
    };
    timer = setTimeout(poll, 1200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [watchingLogin]);
  const [removing, setRemoving] = useState<LocalShop | null>(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [time, setTime] = useState('');
  const [interval, setInterval] = useState('');
  const [batch, setBatch] = useState('');
  const run = async (input: Record<string, unknown>) => {
    const key = String(input.account ?? input.action);
    if (busy[key]) return;
    setBusy((prior) => ({ ...prior, [key]: String(input.action) }));
    setError('');
    try {
      const result = await localShopsActions.command<{ status?: string; error?: string }>(input);
      if (result?.status === 'failed' && result.error) setError(result.error);
      if (input.action === 'unbind') setRemoving(null);
      if (input.action === 'schedule') setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prior) => {
        const next = { ...prior };
        delete next[key];
        return next;
      });
    }
  };
  const allShops = data?.shops ?? [];
  const platformFor = (id: string) => accountPlatforms.find((p) => p.id === id);
  const shops = allShops.filter(
    (s) =>
      (!platformFilter || s.platform === platformFilter) &&
      [s.name, s.storeName, s.accountName, s.id, platformFor(s.platform)?.name].some((v) =>
        v?.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  const latestError = error || (sync.error instanceof Error ? sync.error.message : '');
  return (
    <main {...stylex.props(styles.page)}>
      {removing && (
        <ImperativeModal
          open
          cancelText={t('shops.cancel')}
          okButtonProps={{ danger: true, loading: busy[removing.id] === 'unbind' }}
          okText={t('shops.confirmUnbind')}
          title={t('shops.unbind')}
          onCancel={() => setRemoving(null)}
          onOk={() => run({ action: 'unbind', account: removing.id })}
        >
          <Text>{t('shops.unbindHint', { name: removing.storeName || removing.name })}</Text>
          {latestError && <Alert title={latestError} type="error" />}
        </ImperativeModal>
      )}
      <div {...stylex.props(styles.inner)}>
        <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
          <div>
            <h1 {...stylex.props(styles.title)}>{t('shops.title')}</h1>
            <div {...stylex.props(styles.sub)}>{t('shops.description')}</div>
          </div>
          <Flexbox horizontal gap={8} wrap="wrap">
            <Button
              icon={RefreshCw}
              loading={Boolean(busy.list)}
              type="text"
              onClick={() => run({ action: 'list' })}
            >
              {t('shops.refresh')}
            </Button>
            <Button
              disabled={!data || data.pairRequired}
              icon={Plus}
              style={greenAction}
              type="primary"
              onClick={() =>
                createModal({
                  width: 800,
                  footer: null,
                  content: (
                    <BindShop
                      removed={data?.removed ?? []}
                      connected={allShops
                        .filter((shop) => shop.authStatus === 'authenticated')
                        .map((shop) => shop.platform)}
                    />
                  ),
                  title: t('shops.bindTitle'),
                })
              }
            >
              {t('shops.add')}
            </Button>
          </Flexbox>
        </Flexbox>
        {latestError && <Alert title={latestError} type="error" />}
        {!data && !latestError && <Text>{t('shops.loading')}</Text>}
        {data?.pairRequired ? (
          <Flexbox className={stylex.props(styles.pair).className} gap={16}>
            <Link2 color="#16805b" size={28} />
            <h2 {...stylex.props(styles.title)}>{t('shops.connect')}</h2>
            <Text>{t('shops.pairHint')}</Text>
            <a href="http://127.0.0.1:18765" rel="noreferrer" target="_blank">
              {t('shops.openManager')}
            </a>
            <Input
              aria-label={t('shops.code')}
              placeholder={t('shops.code')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              disabled={!code.trim()}
              loading={Boolean(busy.pair)}
              style={greenAction}
              type="primary"
              onClick={() => run({ action: 'pair', code })}
            >
              {t('shops.connect')}
            </Button>
          </Flexbox>
        ) : (
          data && (
            <>
              <section {...stylex.props(styles.banner)}>
                <div>
                  <div {...stylex.props(styles.summary)}>
                    <CalendarClock size={17} />
                    {t('shops.scheduleTitle')}
                  </div>
                  <div {...stylex.props(styles.meta)}>{t('shops.summaryScope')}</div>
                  <div {...stylex.props(styles.meta)}>
                    {data.schedule &&
                      t('shops.summaryTime', {
                        time: data.schedule.startTime,
                        batch: String(data.schedule.tasksPerSlot),
                        interval: String(data.schedule.intervalMinutes),
                      })}
                  </div>
                </div>
                <Button
                  aria-expanded={editing}
                  icon={Settings2}
                  shape="round"
                  size="small"
                  onClick={() => setEditing(!editing)}
                >
                  {t('shops.adjust')}
                </Button>
              </section>
              {editing && (
                <section {...stylex.props(styles.panel)}>
                  <Flexbox horizontal align="center" gap={8} wrap="wrap">
                    <Text>{t('shops.daily')}</Text>
                    <Input
                      aria-label={t('shops.startTime')}
                      style={{ width: 110 }}
                      type="time"
                      value={time || data.schedule?.startTime}
                      onChange={(e) => setTime(e.target.value)}
                    />
                    <Text>{t('shops.batch')}</Text>
                    <Input
                      aria-label={t('shops.batch')}
                      style={{ width: 65 }}
                      type="number"
                      value={batch || String(data.schedule?.tasksPerSlot)}
                      onChange={(e) => setBatch(e.target.value)}
                    />
                    <Text>{t('shops.interval')}</Text>
                    <Input
                      aria-label={t('shops.interval')}
                      style={{ width: 70 }}
                      type="number"
                      value={interval || String(data.schedule?.intervalMinutes)}
                      onChange={(e) => setInterval(e.target.value)}
                    />
                    <Button
                      disabled={Boolean(busy.schedule)}
                      onClick={() =>
                        run({
                          action: 'schedule',
                          intervalMinutes: Number(interval || data.schedule?.intervalMinutes),
                          startTime: time || data.schedule?.startTime,
                          tasksPerSlot: Number(batch || data.schedule?.tasksPerSlot),
                        })
                      }
                    >
                      {t('shops.save')}
                    </Button>
                  </Flexbox>
                  <div {...stylex.props(styles.meta)}>{t('shops.hostHint')}</div>
                </section>
              )}
              <Flexbox horizontal gap={6} style={{ marginBottom: 12 }} wrap="wrap">
                {[
                  { id: '', name: t('shops.all') },
                  ...accountPlatforms.filter((p) => allShops.some((s) => s.platform === p.id)),
                ].map((p) => (
                  <Button
                    aria-pressed={platformFilter === p.id}
                    key={p.id}
                    shape="round"
                    size="small"
                    type={platformFilter === p.id ? 'default' : 'text'}
                    onClick={() => setPlatformFilter(p.id)}
                  >
                    {p.name}{p.id.endsWith('-buyer') ? ' · ' + t('shops.buyerAccount') : ''} {allShops.filter((s) => !p.id || s.platform === p.id).length}
                  </Button>
                ))}
              </Flexbox>
              <Input
                aria-label={t('shops.search')}
                placeholder={t('shops.search')}
                prefix={<Search size={15} />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div {...stylex.props(styles.scroll)}>
                <table {...stylex.props(styles.table)}>
                  <thead>
                    <tr>
                      {['shopName', 'scheduled', 'auth', 'actions'].map((k) => (
                        <th key={k} {...stylex.props(styles.th)}>
                          {t(`shops.${k}` as any)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shops.map((shop) => (
                      <tr key={shop.id}>
                        <td {...stylex.props(styles.cell)}>
                          <Flexbox horizontal align="center" gap={10}>
                            <img
                              alt=""
                              height={28}
                              src={platformFor(shop.platform)?.icon}
                              style={{ borderRadius: 7, objectFit: 'contain' }}
                              width={28}
                            />
                            <div>
                              <Text strong>{shop.storeName || shop.name}</Text>
                              {shop.platform.endsWith('-buyer') && <Text type="secondary"> · {t('shops.buyerAccount')}</Text>}
                              {shop.accountName && (
                                <>
                                  <br />
                                  <Text type="secondary">{shop.accountName}</Text>
                                </>
                              )}
                            </div>
                          </Flexbox>
                        </td>
                        <td {...stylex.props(styles.cell)}>
                          <Flexbox horizontal align="center" gap={8}>
                            <Switch
                              aria-label={t(shop.enabled ? 'shops.pause' : 'shops.enable')}
                              checked={shop.enabled}
                              disabled={Boolean(busy[shop.id]) || !supportsCollection(shop)}
                              size="small"
                              onChange={(enabled) =>
                                run({ account: shop.id, action: 'enable', enabled })
                              }
                            />
                            <Text type="secondary">
                              {t(
                                !supportsCollection(shop)
                                  ? supportsLoginCheck(shop)
                                    ? 'shops.noScheduledCollection'
                                    : 'shops.loginOnly'
                                  : shop.enabled
                                    ? 'shops.on'
                                    : 'shops.off',
                              )}
                            </Text>
                          </Flexbox>
                        </td>
                        <td {...stylex.props(styles.cell)}>
                          <span
                            {...stylex.props(
                              styles.dot,
                              shop.authStatus === 'authenticated' && !shop.manual && styles.online,
                            )}
                          />
                          {shop.manual
                            ? t(
                                supportsLoginCheck(shop)
                                  ? 'shops.status.awaiting_close'
                                  : 'shops.loginWindow',
                              )
                            : t(`shops.status.${shop.authStatus || 'unknown'}` as any)}
                          <br />
                          <Text type="secondary">
                            {shop.checkError ||
                              (shop.checkedAt ? new Date(shop.checkedAt).toLocaleString() : '')}
                            {shop.authStatus === 'authenticated' && shop.accountName === null && (
                              <>
                                {' · '}
                                {t('shops.noAccountName')}
                              </>
                            )}
                          </Text>
                        </td>
                        <td {...stylex.props(styles.cell)}>
                          <Flexbox horizontal gap={6} wrap="wrap">
                            {[
                              'login',
                              ...(supportsLoginCheck(shop)
                                ? [shop.manual ? 'finishLogin' : 'check']
                                : []),
                              ...(shop.platform.endsWith('-buyer') ? [] : ['collect']),
                              'openWorkbench',
                              'close',
                            ].map((action) => (
                              <Button
                                disabled={
                                  Boolean(busy[shop.id]) || Boolean(shop.running) ||
                                  (action === 'collect' && (!supportsCollection(shop) || shop.manual))
                                }
                                loading={busy[shop.id] === action}
                                key={action}
                                size="small"
                                type="text"
                                onClick={() => run({ account: shop.id, action })}
                              >
                                {t(shop.platform.endsWith('-buyer') && action === 'openWorkbench' ? 'shops.openBuyer' : `shops.${action}` as any)}
                              </Button>
                            ))}
                            <Button
                              disabled={Boolean(busy[shop.id]) || Boolean(shop.running)}
                              size="small"
                              type="text"
                              onClick={() => setRemoving(shop)}
                            >
                              {t('shops.unbind')}
                            </Button>
                          </Flexbox>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!shops.length && <p>{t('shops.empty')}</p>}
              <details {...stylex.props(styles.history)}>
                <summary {...stylex.props(styles.disclosure)}>
                  {t('shops.history')} · {data.runs?.length ?? 0}
                </summary>
                {(data.runs ?? []).length === 0 && <p>{t('shops.noRuns')}</p>}
                {(data.runs ?? []).map((r) => (
                  <Flexbox gap={6} key={r.id} style={{ paddingBlock: 14 }}>
                    <Text strong>
                      {r.storeName || r.account} · {r.report && r.report.name + ' · '}
                      {t(`shops.run.${r.status}` as any)} · {new Date(r.startedAt).toLocaleString()}
                    </Text>
                    {r.error ? (
                      <Text type="danger">{r.error}</Text>
                    ) : (
                      <Text>
                        {Object.entries(r.metrics)
                          .map(([k, v]) => `${k}：${v ?? '--'}`)
                          .join('　')}
                      </Text>
                    )}
                    {r.note && <Text type="secondary">{r.note}</Text>}
                  </Flexbox>
                ))}
              </details>
            </>
          )
        )}
      </div>
    </main>
  );
};
