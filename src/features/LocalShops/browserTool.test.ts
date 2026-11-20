import { generateToolsFromManifest } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { shopBrowserManifest } from './browserTool';

describe('shop browser manifest', () => {
  it('offers both selected-shop discovery and browser operations as function tools', () => {
    const tools = generateToolsFromManifest(shopBrowserManifest);
    expect(tools).toHaveLength(3);
    expect(tools.map((tool) => tool.function?.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('listShops'),
        expect.stringContaining('listProductLinks'),
        expect.stringContaining('browser'),
      ]),
    );
  });
});
