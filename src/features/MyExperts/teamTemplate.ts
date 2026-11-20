import { z } from 'zod';

const label = z.string().trim().min(1).max(255);
const member = z.object({
  packageCode: label,
  role: z.string().optional(),
  sortOrder: z.number().optional(),
});
const task = z.object({
  id: label,
  title: label,
  query: z.string().max(16000).optional(),
  prompt: z.string().max(16000).optional(),
  sortOrder: z.number().optional(),
});
const base = z.object({
  members: z.array(member).min(1).max(10),
  leadPackageCode: label.optional(),
});
const detail = base.extend({
  teamCode: label,
  content: z.object({
    name: label,
    summary: z.string().max(4000).optional(),
    starterTasks: z.array(task).max(100).default([]),
  }),
});
const normalized = base.extend({
  title: label,
  summary: z.string().max(4000).optional(),
  tasks: z.array(task).max(100).default([]),
});
export function readTeamTemplate(input: unknown) {
  const wrapped = z.object({ data: detail }).safeParse(input);
  const raw = detail.safeParse(wrapped.success ? wrapped.data.data : input);
  const value = raw.success
    ? {
        ...raw.data,
        title: raw.data.content.name,
        summary: raw.data.content.summary,
        tasks: raw.data.content.starterTasks,
      }
    : normalized.parse(input);
  const members = value.members.toSorted(
    (a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity),
  );
  const codes = members.map((m) => m.packageCode);
  const leads = members.filter((m) => m.role === 'LEAD');
  const lead =
    value.leadPackageCode ??
    leads[0]?.packageCode ??
    (!members.some((m) => m.role) ? codes[0] : undefined);
  if (
    new Set(codes).size !== codes.length ||
    leads.length > 1 ||
    !lead ||
    !codes.includes(lead) ||
    (leads.length && leads[0].packageCode !== lead)
  )
    throw Error('模板成员或团长有冲突');
  return {
    name: value.title,
    summary: value.summary ?? '',
    codes,
    lead,
    tasks: value.tasks
      .toSorted((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity))
      .map((t) => ({ title: t.title, query: t.query ?? t.prompt ?? '' }))
      .filter((t) => t.query),
  };
}
