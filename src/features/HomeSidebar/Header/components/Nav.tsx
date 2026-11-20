'use client';

import { Flexbox } from '@lobehub/ui';
import { Bell, CalendarClock, Puzzle, SquarePen, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import NavItem from '@/features/NavPanel/components/NavItem';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';

export default function Nav() {
  const { t } = useTranslation('agent');
  const { pathname, search } = useActiveLocation();
  const workspace = useActiveWorkspaceSlug();
  const onHome = pathname.replace(/\/$/, '') === (workspace ? `/${workspace}` : '');
  const inbox = async () => (await import('./InboxModal')).openInboxModal();
  return (
    <nav aria-label={t('workNav.main')}>
      <Flexbox gap={3} paddingInline={8}>
        <WorkspaceLink to="/" aria-current={onHome ? 'page' : undefined}>
          <NavItem active={onHome} icon={SquarePen} title={t('workNav.newTask')} />
        </WorkspaceLink>
        <WorkspaceLink to="/experts">
          <NavItem
            active={pathname.endsWith('/experts')}
            icon={UsersRound}
            title={t('myExperts.title')}
          />
        </WorkspaceLink>
        <WorkspaceLink to="/plugins">
          <NavItem
            active={/(?:^|\/)plugins(?:\/|$)|\/stores\/?$/.test(pathname)}
            icon={Puzzle}
            title={t('workNav.plugins')}
          />
        </WorkspaceLink>
        <WorkspaceLink to="/tasks?collection=scheduled">
          <NavItem
            active={
              pathname.endsWith('/tasks') &&
              new URLSearchParams(search).get('collection') === 'scheduled'
            }
            icon={CalendarClock}
            title={t('workNav.scheduled')}
          />
        </WorkspaceLink>
        <button type="button" style={actionStyle} onClick={inbox}>
          <NavItem icon={Bell} title={t('workNav.messages')} />
        </button>
      </Flexbox>
    </nav>
  );
}

const actionStyle = {
  background: 'transparent',
  border: 0,
  color: 'inherit',
  font: 'inherit',
  padding: 0,
  textAlign: 'start',
} as const;
