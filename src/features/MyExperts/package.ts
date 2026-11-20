import { strFromU8, unzipSync, zipSync } from 'fflate';
import { sha256 } from 'js-sha256';
import { z } from 'zod';

const manifestSchema = z.object({
  format: z.literal('lobehub-expert-v1'),
  id: z.string().min(1).max(100),
  version: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  description: z.string().max(1000),
  avatar: z.string().optional(),
  instructions: z.array(z.string()).min(1),
  skills: z.array(z.string()).max(50).default([]),
  tasks: z.array(z.string().max(80)).max(12).default([]),
  requirements: z.array(z.string().max(300)).max(30).default([]),
});

export type ExpertManifest = z.infer<typeof manifestSchema>;
export interface ExpertPackage {
  avatar?: string;
  hash: string;
  manifest: ExpertManifest;
  skills: { bytes: Uint8Array; hash: string; path: string }[];
  systemRole: string;
}

const MAX_BYTES = 50 * 1024 * 1024;
const safePath = (path: string) =>
  path.length > 0 &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !path.includes(':') &&
  !path.split('/').some((part) => part === '..' || part === '.');

/** Validate before decompression, then retain each skill's complete directory tree. */
export const parseExpertPackage = (bytes: Uint8Array): ExpertPackage => {
  if (bytes.byteLength > MAX_BYTES) throw new Error('expertPackageTooLarge');
  let total = 0;
  let count = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize;
      count += 1;
      if (!safePath(entry.name) || total > MAX_BYTES || count > 3000)
        throw new Error('expertPackageInvalidArchive');
      return !entry.name.endsWith('/');
    },
  });
  const read = (path: string) => {
    if (!safePath(path) || !files[path]) throw new Error(`expertPackageMissingFile: ${path}`);
    return files[path];
  };
  const manifest = manifestSchema.parse(JSON.parse(strFromU8(read('expert.json'))));
  const systemRole = manifest.instructions.map((path) => strFromU8(read(path))).join('\n\n');
  if (!systemRole.trim() || systemRole.length > 200_000)
    throw new Error('expertPackageInvalidInstructions');
  let avatar: string | undefined;
  if (manifest.avatar) {
    const data = read(manifest.avatar);
    const extension = manifest.avatar.split('.').pop()?.toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[
      extension ?? ''
    ];
    if (!mime || data.length > 2 * 1024 * 1024) throw new Error('expertPackageInvalidAvatar');
    let binary = '';
    for (const byte of data) binary += String.fromCharCode(byte);
    avatar = `data:${mime};base64,${btoa(binary)}`;
  }
  if (new Set(manifest.skills).size !== manifest.skills.length)
    throw new Error('expertPackageDuplicateSkill');
  const skills = manifest.skills.map((path) => {
    if (!safePath(path) || path.endsWith('/')) throw new Error('expertPackageInvalidSkillPath');
    read(`${path}/SKILL.md`);
    const entries = Object.fromEntries(
      Object.entries(files)
        .filter(([name]) => name.startsWith(`${path}/`))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, data]) => [name.slice(path.length + 1), data]),
    );
    const packed = zipSync(entries, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
    return { bytes: packed, hash: sha256(packed), path };
  });
  return { avatar, hash: sha256(bytes), manifest, skills, systemRole };
};
