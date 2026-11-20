import { beforeEach, describe, expect, it, vi } from 'vitest';

import { businessMessage } from './live';

const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/services/localShops', () => ({ localShopsService: { command } }));
vi.mock('@/libs/swr/useCacheScope', () => ({ getCacheScope: () => 'owner' }));
vi.mock('@/store/agent', () => ({
  useAgentStore: { getState: () => ({ agentMap: { a: { title: '生意助手' } } }) },
}));

describe('business assistant input', () => {
  beforeEach(() => command.mockReset());
  it('leaves paginated requests and page actions for the actual browser tool', async () => {
    for (const input of ['获取商品管理前1000条链接', '打开订单管理并查询待发货订单'])
      expect(await businessMessage(input, 'a', 'topic')).toBe(input);
    expect(command).not.toHaveBeenCalled();
  });
});
