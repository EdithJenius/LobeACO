'use client';

import { Alert, Button, Flexbox, Input, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ExpertCard from './ExpertCard';
import ExpertTeams from './ExpertTeams';
import { openImportExpert } from './ImportExpert';

const Skeleton = createSurfaceSkeleton('grid');
const styles = stylex.create({
  page: { backgroundColor: cssVar.colorBgLayout, height: '100%', overflowY: 'auto', padding: 24 },
  grid: {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))',
    marginTop: 24,
  },
  header: {
    display: 'flex',
    gap: 16,
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

const MyExperts = () => {
  const { t } = useTranslation('agent');
  const [query, setQuery] = useState('');
  const [showTeams, setShowTeams] = useState(false);
  const { error, mutate } = useFetchAgentList();
  const ready = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const agents = useHomeStore(homeAgentListSelectors.allAgents, isEqual);
  const userId = useUserStore(userProfileSelectors.userId);
  const { allowed } = usePermission('create_content');
  const mine = [
    ...new Map(
      agents
        .filter((item) => item.type === 'agent' && item.userId === userId)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const search = query.trim().toLocaleLowerCase();
  const filtered = mine.filter((item) =>
    `${item.name ?? ''} ${item.title ?? ''} ${item.description ?? ''}`
      .toLocaleLowerCase()
      .includes(search),
  );

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.header)}>
        <Text as="h1" style={{ fontSize: 24, margin: 0 }}>
          {t('myExperts.title')}
        </Text>
        <Flexbox horizontal gap={12} wrap="wrap">
          <Button aria-pressed={!showTeams} onClick={() => setShowTeams(false)}>
            {t('myExperts.title')}
          </Button>
          <Button aria-pressed={showTeams} onClick={() => setShowTeams(true)}>
            {t('teams.title')}
          </Button>
          {!showTeams && (
            <Input
              aria-label={t('myExperts.search')}
              placeholder={t('myExperts.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <Button disabled={!allowed} type="primary" onClick={openImportExpert}>
            {t('myExperts.create')}
          </Button>
        </Flexbox>
      </div>
      {error ? (
        <Alert
          description={<Button onClick={() => void mutate()}>{t('myExperts.retry')}</Button>}
          title={t('myExperts.loadFailed')}
          type="error"
        />
      ) : !ready ? (
        <Skeleton />
      ) : showTeams ? (
        <ExpertTeams
          experts={mine}
          teams={agents.filter((item) => item.type === 'group' && item.userId === userId)}
        />
      ) : filtered.length ? (
        <div {...stylex.props(styles.grid)}>
          {filtered.map((agent) => (
            <ExpertCard agent={agent} key={agent.id} />
          ))}
        </div>
      ) : (
        <Flexbox align="center" gap={16} padding={64}>
          <Text type="secondary">{t(mine.length ? 'myExperts.noResults' : 'myExperts.empty')}</Text>
          {!mine.length && (
            <Button disabled={!allowed} onClick={openImportExpert}>
              {t('myExperts.firstImport')}
            </Button>
          )}
        </Flexbox>
      )}
    </main>
  );
};

export default MyExperts;
