import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localShopBrowserExecutor } from './localShopBrowser';

const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/services/localShops', () => ({ localShopsService: { command } }));
vi.mock('@/libs/swr/useCacheScope', () => ({ getCacheScope: () => 'owner' }));

describe('local shop browser executor', () => {
  beforeEach(() => {
    command.mockReset();
    command.mockImplementation(async (input) =>
      input.action === 'access'
        ? {
            accounts: ['shop-a'],
            revision: 'revision',
            shops: [{ id: 'shop-a' }, { id: 'shop-b' }],
          }
        : { page: 'ok' },
    );
  });
  it('derives scope and revision from the conversation, not model arguments', async () => {
    const out = await localShopBrowserExecutor.invoke(
      'browser',
      {
        account: 'shop-a',
        operation: 'inspect',
        scope: 'forged',
        revision: 'forged',
        agent: 'forged',
        topic: 'forged',
      },
      { agentId: 'agent', topicId: 'topic', messageId: 'm', rootOperationId: 'run' },
    );
    expect(out.success).toBe(true);
    expect(command).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'browser',
        scope: 'owner',
        agent: 'agent',
        topic: 'topic',
        revision: 'revision',
        account: 'shop-a',
        runId: 'run',
      }),
    );
  });
  it('rejects unselected accounts before any browser call', async () => {
    const out = await localShopBrowserExecutor.invoke(
      'browser',
      { account: 'shop-b', operation: 'open' },
      { agentId: 'agent', messageId: 'm' },
    );
    expect(out.success).toBe(false);
    expect(command).toHaveBeenCalledTimes(1);
  });
  it('routes a bounded product request through the selected conversation', async () => {
    const out = await localShopBrowserExecutor.invoke(
      'listProductLinks',
      { account: 'shop-a', limit: 1000 },
      { agentId: 'agent', topicId: 'topic', messageId: 'm' },
    );
    expect(out.success).toBe(true);
    expect(command).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'productList',
        limit: 1000,
        scope: 'owner',
        agent: 'agent',
        topic: 'topic',
        revision: 'revision',
        account: 'shop-a',
      }),
    );
  });
  it('closes the same task session after the run completes', async () => {
    const callbacks: (() => void | Promise<void>)[] = [];
    await localShopBrowserExecutor.invoke(
      'browser',
      { account: 'shop-a', operation: 'open' },
      {
        agentId: 'agent',
        topicId: 'topic',
        messageId: 'm',
        rootOperationId: 'run-clean',
        registerAfterCompletion: (callback) => callbacks.push(callback),
      },
    );
    expect(callbacks).toHaveLength(1);
    await callbacks[0]();
    expect(command).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'browser',
        operation: 'close',
        runId: 'run-clean',
        revision: 'revision',
        account: 'shop-a',
      }),
    );
  });
});
