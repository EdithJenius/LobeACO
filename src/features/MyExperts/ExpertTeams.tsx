import { GROUP_CHAT_URL } from '@lobechat/const';
import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import { Alert, Button, Flexbox, Input, Text } from '@lobehub/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { chatGroupService } from '@/services/chatGroup';
import { useHomeStore } from '@/store/home';
import {
  approvedContacts,
  ChannelPicker,
  contactKey,
  type Contact,
  TemplateInput,
} from './TeamInputs';

export default function ExpertTeams({
  experts,
  teams,
}: {
  experts: SidebarAgentItem[];
  teams: SidebarAgentItem[];
}) {
  const { t } = useTranslation('agent');
  const navigate = useWorkspaceAwareNavigate();
  const refresh = useHomeStore((s) => s.refreshAgentList);
  const { allowed } = usePermission('create_content');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [lead, setLead] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [summary, setSummary] = useState('');
  const [tasks, setTasks] = useState<{ title: string; query: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef('');
  const lock = useRef(false);
  const submit = async () => {
    const leader = experts.find((e) => e.id === lead);
    if (
      !allowed ||
      lock.current ||
      !leader ||
      !members.includes(lead) ||
      !name.trim() ||
      members.length + contacts.length > 10 ||
      members.some((id) => !experts.some((e) => e.id === id))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      if (!pending.current) {
        if (contacts.length) {
          const approved = new Set((await approvedContacts(members)).map(contactKey));
          if (contacts.some((c) => !approved.has(contactKey(c)))) throw Error('渠道成员授权已变化');
        }
        const { group } = await chatGroupService.createGroup({
          config: {
            ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
            openingQuestions: tasks.map((task) => task.query),
          },
          description: [
            summary,
            ...contacts.map(
              (c) =>
                '渠道成员 ' +
                c.channelId +
                ' · ' +
                c.label +
                ' (' +
                c.userId +
                ' / ' +
                c.providerId +
                ')',
            ),
          ]
            .filter(Boolean)
            .join('\n'),
          content: t('teams.assignment', { id: lead, name: agentDisplayName(leader) ?? lead }),
          title: name.trim(),
          visibility: 'private',
        });
        pending.current = group.id;
      }
      await chatGroupService.addAgentsToGroup(pending.current, members);
      await refresh();
      navigate(GROUP_CHAT_URL(pending.current));
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const toggle = (id: string) => {
    const next = members.includes(id) ? members.filter((m) => m !== id) : [...members, id];
    setMembers(next);
    setContacts([]);
    if (!next.includes(lead)) setLead(next[0] ?? '');
  };
  return (
    <Flexbox gap={16} paddingBlock={16}>
      {editing ? (
        <>
          <fieldset disabled={busy || !!pending.current}>
            <TemplateInput
              ids={experts.map((e) => e.id)}
              onImport={(title, ids, leader, description, starters) => {
                setName(title);
                setMembers(ids);
                setLead(leader);
                setSummary(description);
                setTasks(starters);
                setContacts([]);
              }}
            />
            {tasks.map((task, i) => (
              <div key={i}>{task.title}</div>
            ))}
          </fieldset>
          <Input
            aria-label={t('teams.name')}
            disabled={busy || !!pending.current}
            placeholder={t('teams.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <fieldset disabled={busy || !!pending.current}>
            <legend>
              {t('teams.members')} ({members.length + contacts.length}/10)
            </legend>
            {experts.map((e) => (
              <Flexbox horizontal gap={12} key={e.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={members.includes(e.id)}
                    disabled={!members.includes(e.id) && members.length + contacts.length >= 10}
                    onChange={() => toggle(e.id)}
                  />{' '}
                  {agentDisplayName(e)}
                </label>
                {members.includes(e.id) && (
                  <label>
                    <input
                      type="radio"
                      name="team-lead"
                      checked={lead === e.id}
                      onChange={() => setLead(e.id)}
                    />{' '}
                    {t('teams.lead')}
                  </label>
                )}
              </Flexbox>
            ))}
          </fieldset>
          <fieldset disabled={busy || !!pending.current || !members.length}>
            <ChannelPicker
              key={members.join(',')}
              ids={members}
              value={contacts}
              onChange={setContacts}
              max={10 - members.length}
            />
          </fieldset>
          {error && <Alert type="error" title={t('teams.failed')} />}
          <Flexbox horizontal gap={8}>
            <Button disabled={busy || !!pending.current} onClick={() => setEditing(false)}>
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={!allowed || !name.trim() || !lead}
              onClick={submit}
            >
              {t('teams.start')}
            </Button>
          </Flexbox>
        </>
      ) : (
        <Button disabled={!allowed || !experts.length} onClick={() => setEditing(true)}>
          {t('teams.create')}
        </Button>
      )}
      {teams.map((team) => (
        <Button key={team.id} onClick={() => navigate(GROUP_CHAT_URL(team.id))}>
          {team.title || t('teams.title')}
        </Button>
      ))}
      {!teams.length && !editing && <Text type="secondary">{t('teams.empty')}</Text>}
    </Flexbox>
  );
}
