'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import { Block, Button, cssVar, Flexbox, Tag, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const ExpertCard = ({ agent }: { agent: SidebarAgentItem }) => {
  const { t } = useTranslation('agent');
  const navigate = useWorkspaceAwareNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);
  const hydrate = useAgentStore((s) => s.useHydrateAgentConfig);
  hydrate(isLogin, agent.id);
  const config = useAgentStore((s) => s.agentMap[agent.id]);
  const name = agentDisplayName(agent);

  return (
    <Block style={{ borderRadius: 20, padding: 20, minHeight: 290 }} variant="outlined">
      <Flexbox align="center" gap={14} height="100%">
        <Avatar
          avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
          size={60}
          title={name}
        />
        <Text strong style={{ fontSize: 18 }}>
          {name}
        </Text>
        <Text style={{ alignSelf: 'stretch' }} type="secondary">
          {agent.description || t('myExperts.noDescription')}
        </Text>
        <Flexbox horizontal gap={4} style={{ alignSelf: 'stretch' }} wrap="wrap">
          {config?.tags?.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Flexbox>
        <Button
          block
          style={{
            marginTop: 'auto',
            borderRadius: 24,
            backgroundColor: cssVar.colorSuccessBg,
            color: cssVar.colorSuccessText,
            borderColor: cssVar.colorSuccessBorder,
          }}
          onClick={() => navigate(AGENT_CHAT_URL(agent.id, false))}
        >
          {t('myExperts.chat')}
        </Button>
      </Flexbox>
    </Block>
  );
};

export default ExpertCard;
