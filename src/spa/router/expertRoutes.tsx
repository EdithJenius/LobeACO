import type { RouteObject } from 'react-router';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';
import { dynamicElement } from '@/utils/router';

export const expertRoute: RouteObject = {
  element: dynamicElement(() => import('@/routes/(main)/experts'), 'My Experts', {
    preloadId: 'experts',
  }),
  handle: {
    meta: routeMeta({ Skeleton: createSurfaceSkeleton('grid'), titleKey: 'agent:myExperts.title' }),
  },
  path: 'experts',
};

const pluginPage = (path: string, view: 'Plugins' | 'Stores' | 'Skills' | 'Apps'): RouteObject => ({
  element: dynamicElement(
    async () => ({ default: (await import('@/routes/(main)/plugins'))[view] }),
    `Plugins > ${view}`,
    { preloadId: 'plugins' },
  ),
  handle: {
    meta: routeMeta({ Skeleton: createSurfaceSkeleton('list'), titleKey: 'agent:workNav.plugins' }),
  },
  path,
});

export const pluginRoutes = [
  pluginPage('plugins', 'Plugins'),
  pluginPage('stores', 'Stores'),
  pluginPage('plugins/skills', 'Skills'),
  pluginPage('plugins/apps/:sub?', 'Apps'),
];
