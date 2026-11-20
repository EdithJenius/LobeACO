import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseExpertPackage } from './package';

const manifest = {
  description: 'Design products',
  format: 'lobehub-expert-v1',
  id: 'designer',
  instructions: ['role.md'],
  name: 'Designer',
  skills: ['skills/images'],
  version: '1',
};

const fixture = (overrides = {}) =>
  zipSync({
    'expert.json': strToU8(JSON.stringify({ ...manifest, ...overrides })),
    'role.md': strToU8('Design with the images skill.'),
    'skills/images/SKILL.md': strToU8(
      '---\nname: images\ndescription: Image guidance\n---\nRead references/poster.md.',
    ),
    'skills/images/references/poster.md': strToU8('Use a square canvas.'),
  });

describe('expert package import', () => {
  it('retains skill references and builds stable skill archives for retries', () => {
    const first = parseExpertPackage(fixture());
    const second = parseExpertPackage(fixture());
    expect(first.systemRole).toBe('Design with the images skill.');
    expect(first.skills[0].hash).toBe(second.skills[0].hash);
    expect(unzipSync(first.skills[0].bytes)['references/poster.md']).toEqual(
      strToU8('Use a square canvas.'),
    );
  });

  it('rejects missing instructions before importing anything', () => {
    expect(() => parseExpertPackage(fixture({ instructions: ['missing.md'] }))).toThrow(
      'expertPackageMissingFile',
    );
  });

  it('rejects traversal entries', () => {
    expect(() => parseExpertPackage(zipSync({ '../outside': strToU8('bad') }))).toThrow(
      'expertPackageInvalidArchive',
    );
  });

  it('rejects repeated skill folders and external avatar paths', () => {
    expect(() =>
      parseExpertPackage(fixture({ skills: ['skills/images', 'skills/images'] })),
    ).toThrow('expertPackageDuplicateSkill');
    expect(() => parseExpertPackage(fixture({ avatar: 'https://example.com/avatar.png' }))).toThrow(
      'expertPackageMissingFile',
    );
  });
});
