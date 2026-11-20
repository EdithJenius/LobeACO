'use client';

import { DEFAULT_INBOX_TITLE } from '@lobechat/const';
import { agentDisplayName, type RecentItem } from '@lobechat/types';
import { Button } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors, homeRecentSelectors } from '@/store/home/selectors';
import { createRecentQueryKey } from '@/store/home/slices/recent/projection';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { formatNotificationRelativeTime } from '../Header/components/InboxModal/formatNotificationRelativeTime';
import styles from './TopicHistory.module.css';

const PAGE_SIZE = 50;

export default function TopicHistory() {
  const { t, i18n } = useTranslation('agent');
  const [teams, setTeams] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const signedIn = useUserStore(authSelectors.isLogin);
  const fetchTopics = useHomeStore((s) => s.useFetchHomeTopicRecents);
  const sync = fetchTopics(!!signedIn, limit + 1);
  const topics = useHomeStore(
    homeRecentSelectors.query(createRecentQueryKey(limit + 1, { types: 'topic', view: 'mine' })),
  );
  useFetchAgentList();
  const owners = useHomeStore(homeAgentListSelectors.allAgents, isEqual);
  const inboxId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const ownersById = useMemo(() => new Map(owners.map((owner) => [owner.id, owner])), [owners]);
  const grouped = useMemo(() => {
    const groups = new Map<string, RecentItem[]>();
    for (const topic of topics?.slice(0, limit) ?? []) {
      const match = /^\/(agent|group)\/([^/?#]+)/.exec(topic.routePath);
      if (!match || (match[1] === 'group') !== teams) continue;
      const id = match[2];
      const rows = groups.get(id);
      if (rows) rows.push(topic);
      else groups.set(id, [topic]);
    }
    return groups;
  }, [topics, limit, teams]);
  if (!signedIn) return null;
  return (
    <section className={styles.history} aria-label={t('workNav.messages')}>
      <div className={styles.switcher} role="group" aria-label={t('workNav.messages')}>
        {[false, true].map((team) => (
          <button
            key={String(team)}
            type="button"
            aria-pressed={teams === team}
            onClick={() => setTeams(team)}
          >
            {t(team ? 'topicHistory.team' : 'topicHistory.expert')}
          </button>
        ))}
      </div>
      {[...grouped].map(([id, rows]) => {
        const owner = ownersById.get(id);
        const fallback =
          id === inboxId || id === 'inbox'
            ? DEFAULT_INBOX_TITLE
            : t(teams ? 'topicHistory.team' : 'topicHistory.expert');
        const name = owner ? agentDisplayName(owner, fallback) : fallback;
        const avatar = typeof owner?.avatar === 'string' ? owner.avatar : undefined;
        return (
          <div className={styles.group} key={id}>
            <div className={styles.owner}>
              {teams ? (
                <AgentGroupAvatar
                  avatar={avatar}
                  memberAvatars={Array.isArray(owner?.avatar) ? owner.avatar : []}
                  size={18}
                />
              ) : (
                <AgentAvatar agentId={id} avatar={avatar} name={name} size={18} />
              )}
              <span>{name}</span>
            </div>
            {rows.map((topic) => (
              <WorkspaceLink
                className={styles.topic}
                key={topic.id}
                to={topic.routePath}
                title={topic.title}
              >
                <span>{topic.title || t('topicHistory.untitled')}</span>
                <time dateTime={new Date(topic.updatedAt).toISOString()}>
                  {formatNotificationRelativeTime(topic.updatedAt, i18n.language)}
                </time>
              </WorkspaceLink>
            ))}
          </div>
        );
      })}
      {sync.error && !topics ? (
        <Button size="small" onClick={() => void sync.revalidate()}>
          {t('topicHistory.retry')}
        </Button>
      ) : topics && !grouped.size ? (
        <p className={styles.empty}>{t('topicHistory.empty')}</p>
      ) : null}
      {topics && topics.length > limit && (
        <Button size="small" type="text" onClick={() => setLimit(limit + PAGE_SIZE)}>
          {t('topicHistory.more')}
        </Button>
      )}
    </section>
  );
}
