import { describe, expect, it } from 'vitest';

import { mergeShopContext, type ShopContext } from './context';

describe('store context', () => {
  it('replaces a previous store while preserving the question and explicit missing data', () => {
    const a: ShopContext = {
      account: 'a',
      authStatus: 'authenticated',
      latest: null,
      name: 'A',
      platform: 'taobao',
    };
    const first = mergeShopContext('分析当前待办', a);
    const second = mergeShopContext(first, { ...a, account: 'b', name: 'B' });
    expect(second).toContain('分析当前待办');
    expect(second).toContain('```json');
    expect(second).not.toContain('"account": "a"');
    expect(second).toContain('"account": "b"');
    expect(second).toContain('"latest": null');
    expect(second.match(/【关联店铺数据】/g)).toHaveLength(1);
  });
});
