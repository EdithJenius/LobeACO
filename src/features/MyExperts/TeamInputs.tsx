import { Button, Flexbox, Text } from '@lobehub/ui';
import { useState } from 'react';
import { z } from 'zod';
import { agentService } from '@/services/agent';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { readTeamTemplate } from './teamTemplate';

export type Contact = { providerId: string; channelId: string; userId: string; label: string };
export const contactKey = (c: Contact) => JSON.stringify([c.providerId, c.channelId, c.userId]);
export async function approvedContacts(ids: string[]): Promise<Contact[]> {
  const providers = (
    await Promise.all(ids.map((id) => agentBotProviderService.getByAgentId(id)))
  ).flat();
  return providers
    .filter((p) => p.enabled)
    .flatMap((p) => {
      const entries = z
        .object({
          allowFrom: z
            .array(z.union([z.string(), z.object({ id: z.string(), name: z.string().optional() })]))
            .optional(),
        })
        .safeParse(p.settings);
      return (entries.success ? (entries.data.allowFrom ?? []) : []).flatMap((entry) => {
        const userId = typeof entry === 'string' ? entry : entry.id;
        return !userId.trim() || userId === '*'
          ? []
          : [
              {
                providerId: p.id,
                channelId: p.platform,
                userId,
                label: typeof entry === 'string' ? entry : (entry.name ?? userId),
              },
            ];
      });
    });
}
export function TemplateInput({
  ids,
  onImport,
}: {
  ids: string[];
  onImport: (
    name: string,
    ids: string[],
    lead: string,
    summary: string,
    tasks: { title: string; query: string }[],
  ) => void;
}) {
  const [notice, setNotice] = useState('');
  return (
    <label>
      导入 Accio 团队模板（JSON）
      <input
        type="file"
        accept=".json,application/json"
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          try {
            if (file.size > 512000) throw Error('模板过大');
            const template = readTeamTemplate(JSON.parse(await file.text()));
            const configs = await Promise.all(
              ids.map(async (id) => ({ id, config: await agentService.getAgentConfigById(id) })),
            );
            const resolved = new Map<string, string>();
            for (const code of template.codes) {
              const matches = configs.filter(
                (x) =>
                  z
                    .object({
                      metadata: z.object({ expertPackage: z.object({ id: z.literal(code) }) }),
                    })
                    .safeParse(x.config).success,
              );
              if (matches.length !== 1) throw Error('请先安装或确认唯一专家包：' + code);
              resolved.set(code, matches[0].id);
            }
            onImport(
              template.name,
              template.codes.map((code) => resolved.get(code)!),
              resolved.get(template.lead)!,
              template.summary,
              template.tasks,
            );
            setNotice('模板已载入');
          } catch (err) {
            setNotice(err instanceof z.ZodError ? '模板格式无效' : String(err));
          }
        }}
      />
      <Text role="status">{notice}</Text>
    </label>
  );
}
export function ChannelPicker({
  ids,
  value,
  onChange,
  max,
}: {
  ids: string[];
  value: Contact[];
  onChange: (v: Contact[]) => void;
  max: number;
}) {
  const [options, setOptions] = useState<Contact[]>([]);
  const [notice, setNotice] = useState('');
  return (
    <Flexbox>
      <Button
        onClick={async () => {
          try {
            const contacts = await approvedContacts(ids);
            setOptions(contacts);
            setNotice(contacts.length ? '选择渠道成员' : '所选专家目前没有已批准的渠道成员');
          } catch {
            setNotice('无法读取渠道成员');
          }
        }}
      >
        读取已批准的渠道成员
      </Button>
      <Text role="status">{notice}</Text>
      {options.map((c) => {
        const k = contactKey(c),
          selected = value.some((v) => contactKey(v) === k);
        return (
          <label key={k}>
            <input
              type="checkbox"
              checked={selected}
              disabled={!selected && value.length >= max}
              onChange={() =>
                onChange(selected ? value.filter((v) => contactKey(v) !== k) : [...value, c])
              }
            />{' '}
            {c.channelId} · {c.label}
          </label>
        );
      })}
    </Flexbox>
  );
}
