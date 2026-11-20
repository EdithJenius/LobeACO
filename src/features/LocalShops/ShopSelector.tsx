import { Popover, Text } from '@lobehub/ui';
import * as sx from '@stylexjs/stylex';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useTopicId } from '@/features/ChatInput/hooks/useTopicId';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { localShopsService } from '@/services/localShops';
import { useAgentStore } from '@/store/agent';

import { ui } from './chat.style';
import { type Access, businessAgent, getAccess, type LinkKey } from './live';
import { shopPlatforms } from './platforms';

import { ShopWorkbench, groups } from './ShopWorkbench';

function ShopControls({ link, business }: { link: LinkKey; business: boolean }) {
  const { t } = useTranslation('agent');
  const [menuOpen, setMenuOpen] = useState(false);
  const { data, mutate, error } = useSWR(['chat-shops', link], () => getAccess(link), {
    refreshInterval: menuOpen ? 5000 : 0,
    shouldRetryOnError: false,
  });
  const [saving, setSaving] = useState(false),
    [errorText, setError] = useState('');
  const [group, setGroup] = useState<number | null>(null);
  const shops = data?.shops ?? [],
    selected = shops.filter((p) => data?.accounts.includes(p.id));
  const platformIds = [...new Set(shops.map((shop) => shop.platform))];
  const menuPlatforms = [
    ...shopPlatforms.filter((platform) => platformIds.includes(platform.id)),
    ...platformIds.filter((id) => !shopPlatforms.some((platform) => platform.id === id))
      .map((id) => ({ id, name: id, icon: '' })),
  ];
  if (!data || !shops.length)
    return business && (error || data) ? (
      <WorkspaceLink to="/stores">{t('shops.title')}</WorkspaceLink>
    ) : null;
  const toggle = async (id: string) => {
    const accounts = data.accounts.includes(id)
      ? data.accounts.filter((k) => k !== id)
      : [...data.accounts, id];
    if (!accounts.length || saving) return;
    setSaving(true);
    setError('');
    setGroup(null);
    try {
      const next = await localShopsService.command<Access>({
        ...link,
        action: 'setAccess',
        accounts,
        revision: data.revision,
      });
      await mutate(next, false);
    } catch (e) {
      setError((e as Error).message);
      await mutate();
    } finally {
      setSaving(false);
    }
  };
  const menu = (
    <div {...sx.props(ui.menu)}>
      <div {...sx.props(ui.menuTitle)}>{t('shops.linkedAccounts')}</div>
      {menuPlatforms.map(
        (p) => (
            <div key={p.id}>
              <div {...sx.props(ui.group)}>
                {p.icon && <img alt="" height={18} src={p.icon} width={18} />}
                {p.name}
              </div>
              {shops
                .filter((s) => s.platform === p.id)
                .map((s) => {
                  const on = data.accounts.includes(s.id);
                  const status = s.authStatus;
                  const label = status === 'authenticated' ? 'shops.loginBadge.online'
                    : status === 'expired' ? 'shops.loginBadge.offline'
                    : status === 'security_verification' ? 'shops.status.security_verification'
                    : status === 'checking' ? 'shops.loginBadge.pending'
                    : status === 'awaiting_close' ? 'shops.loginBadge.pending'
                    : status === 'check_failed' ? 'shops.status.check_failed' : 'shops.status.unknown';
                  return (
                    <button
                      aria-checked={on}
                      disabled={saving || (on && selected.length === 1)}
                      key={s.id}
                      role="checkbox"
                      type="button"
                      {...sx.props(ui.option, on && ui.chosen)}
                      onClick={() => void toggle(s.id)}
                    >
                      <span title={s.name} {...sx.props(ui.optionName)}>{s.name}</span>
                      <span {...sx.props(ui.status, status === 'authenticated' && ui.online,
                        status === 'expired' && ui.offline, status === 'security_verification' && ui.challenge)}>
                        {t(label)}
                      </span>
                      {on && <Check size={17} {...sx.props(ui.tick)} />}
                    </button>
                  );
                })}
            </div>
          ),
      )}
      <WorkspaceLink to="/stores">{t('shops.title')}</WorkspaceLink>
    </div>
  );
  return (
    <div {...sx.props(ui.surface)}>
      <div {...sx.props(ui.bar)}>
        <Popover content={menu} placement="topRight" trigger="click" onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) void mutate().catch(() => {});
        }}>
          <button type="button" {...sx.props(ui.pill)}>
            {t('shops.linked')}{' '}
            <img
              alt=""
              height={15}
              src={shopPlatforms.find((p) => p.id === selected[0]?.platform)?.icon}
              width={15}
            />
            <span {...sx.props(ui.ellipsis)}>{selected[0]?.name}</span>
            {selected.length > 1 && <strong>+{selected.length - 1}</strong>}
            <ChevronDown size={14} />
          </button>
        </Popover>
      </div>
      {business && (
        <div {...sx.props(ui.panel)}>
          <div {...sx.props(ui.tabs)}>
            {groups.map((g, i) => (
              <button
                aria-pressed={group === i}
                disabled={saving}
                key={g.key}
                type="button"
                {...sx.props(ui.tab, group === i && ui.active)}
                onClick={() => setGroup(i)}
              >
                <g.icon color="#159568" size={16} />
                {t(`shops.workbench.${g.key}`)}
                <ChevronRight size={12} />
              </button>
            ))}
          </div>
          {group !== null && (
            <ShopWorkbench
              key={data.revision}
              access={data}
              link={link}
              initialGroup={group}
              onClose={() => setGroup(null)}
            />
          )}
        </div>
      )}
      {errorText && <Text type="danger">{errorText}</Text>}
    </div>
  );
}
export function ShopSelector() {
  const scope = useCacheScope(),
    agent = useAgentId(),
    topic = useTopicId() ?? '';
  const business = useAgentStore((s) => businessAgent(s.agentMap[agent]));
  return agent ? (
    <ShopControls
      business={business}
      key={JSON.stringify([scope, agent, topic])}
      link={{ scope, agent, topic }}
    />
  ) : null;
}
