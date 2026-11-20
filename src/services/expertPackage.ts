import { sha256 } from 'js-sha256';
import { z } from 'zod';

import businessRole from '@/features/LocalShops/business-role.json';
import type { ExpertPackage } from '@/features/MyExperts/package';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { lambdaClient } from '@/libs/trpc/client';
import { agentService } from '@/services/agent';
import { agentSkillService } from '@/services/skill';
import { uploadService } from '@/services/upload';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { settingsSelectors, userProfileSelectors } from '@/store/user/selectors';

/** Native skill imports are durable and reusable after an interrupted expert import. */
const performImport = async (
  bundle: ExpertPackage,
  scope: string,
  progress: (value: string) => void,
) => {
  const assertScope = () => {
    if (scope !== getCacheScope()) throw new Error('expertPackageScopeChanged');
  };
  assertScope();
  await useHomeStore.getState().refreshAgentList();
  assertScope();
  const userId = userProfileSelectors.userId(useUserStore.getState());
  const agents = homeAgentListSelectors
    .allAgents(useHomeStore.getState())
    .filter((item) => item.type === 'agent' && item.userId === userId);
  for (const agent of agents) {
    assertScope();
    const config = await agentService.getAgentConfigById(agent.id);
    const identity = z
      .object({ metadata: z.object({ expertPackage: z.object({ hash: z.string() }) }) })
      .safeParse(config);
    if (identity.success && identity.data.metadata.expertPackage.hash === bundle.hash)
      return agent.id;
  }

  assertScope();
  const installed = (await agentSkillService.list()).data;
  const plugins: string[] = [];
  for (const skill of bundle.skills) {
    assertScope();
    progress(skill.path.split('/').at(-1) ?? skill.path);
    const existing = installed.find((item) => item.zipFileHash === skill.hash);
    if (existing) {
      plugins.push(existing.identifier);
      continue;
    }
    const file = new File([new Uint8Array(skill.bytes)], 'skill.zip', { type: 'application/zip' });
    const { data } = await uploadService.uploadFileToS3(file, { directory: 'skills' });
    let registered = false;
    try {
      assertScope();
      const stored = await lambdaClient.file.createFile.mutate({
        fileType: file.type,
        hash: sha256(skill.bytes),
        metadata: {},
        name: file.name,
        size: file.size,
        url: data.path,
      });
      registered = true;
      assertScope();
      const result = await agentSkillService.importFromZip({ zipFileId: stored.id });
      if (!result) throw new Error('expertPackageSkillImportFailed');
      plugins.push(result.skill.identifier);
      installed.push(result.skill);
    } finally {
      if (!registered && scope === getCacheScope()) await uploadService.releaseUpload(data.path);
    }
  }
  assertScope();
  const defaults = settingsSelectors.defaultAgentConfig(useUserStore.getState());
  const manifest =
    bundle.manifest.id === '1688-seller-assistant'
      ? {
          ...bundle.manifest,
          name: businessRole.name,
          description: businessRole.description,
          tasks: businessRole.tasks,
          requirements: businessRole.requirements,
        }
      : bundle.manifest;
  const result = await agentService.createAgent({
    config: {
      avatar: bundle.avatar,
      description: manifest.description,
      metadata: { expertPackage: { ...manifest, hash: bundle.hash } },
      model: defaults.model,
      name: manifest.name,
      plugins,
      provider: defaults.provider,
      systemRole:
        bundle.manifest.id === '1688-seller-assistant'
          ? businessRole.systemRole
          : bundle.systemRole,
      tags: manifest.tasks,
      title: manifest.name,
    },
    visibility: 'private',
  });
  // Once creation succeeds, a refresh failure must not turn it into a failed import.
  if (scope === getCacheScope())
    await Promise.allSettled([
      useHomeStore.getState().refreshAgentList(),
      useToolStore.getState().refreshAgentSkills(),
    ]);
  return result.agentId;
};

export const importExpertPackage = async (
  bundle: ExpertPackage,
  progress: (value: string) => void,
) => {
  const scope = getCacheScope();
  // Serialise imports across tabs, including two different packages sharing a skill.
  return navigator.locks.request(`expert-import:${scope}`, () =>
    performImport(bundle, scope, progress),
  );
};
