'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const Connectors = lazy(() => import('@/features/Settings/connector'));
const Skills = lazy(() => import('@/features/Settings/skill'));
const Apps = lazy(() => import('@/features/Integrations'));
const Shops = lazy(() => import('@/routes/(main)/stores'));
const Loading = createSurfaceSkeleton('list');
const sections = [
  { id: 'plugins', label: 'workNav.plugins', path: '/plugins' },
  { id: 'shops', label: 'shops.store', path: '/stores' },
  { id: 'skills', label: 'workNav.skills', path: '/plugins/skills' },
  { id: 'apps', label: 'workNav.apps', path: '/plugins/apps' },
] as const;
export type PluginSection = (typeof sections)[number]['id'];
const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    flexGrow: 1,
    minWidth: 0,
  },
  title: { fontSize: 24, marginBlockStart: 20, marginBlockEnd: 8, marginInline: 24 },
  nav: {
    display: 'flex',
    gap: 24,
    paddingInline: 24,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: cssVar.colorBorderSecondary,
  },
  tab: {
    paddingBlock: 10,
    color: cssVar.colorTextSecondary,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
  },
  active: { color: cssVar.colorText, borderBottomColor: cssVar.colorText, fontWeight: 600 },
  body: { flexGrow: 1, minHeight: 0, overflow: 'auto' },
});
export default function PluginHub({ section }: { section: PluginSection }) {
  const { t } = useTranslation('agent');
  return (
    <section {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>{t('workNav.plugins')}</h1>
      <nav {...stylex.props(styles.nav)} aria-label={t('workNav.sections')}>
        {sections.map((item) => (
          <WorkspaceLink
            {...stylex.props(styles.tab, section === item.id && styles.active)}
            aria-current={section === item.id ? 'page' : undefined}
            key={item.id}
            to={item.path}
          >
            {t(item.label)}
          </WorkspaceLink>
        ))}
      </nav>
      <div {...stylex.props(styles.body)}>
        <Suspense fallback={<Loading />}>
          {section === 'plugins' && <Connectors />}
          {section === 'shops' && <Shops />}
          {section === 'skills' && <Skills />}
          {section === 'apps' && <Apps basePath="/plugins/apps" />}
        </Suspense>
      </div>
    </section>
  );
}
