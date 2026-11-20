import { describe, expect, it } from 'vitest';

import { useShopClientRuntime } from './browserRouting';

describe('shop browser runtime selection', () => {
  const agent = { title: '生意助手' };
  it('routes personal ordinary business chats to the client bridge', () => {
    expect(useShopClientRuntime({ agent, scope: 'main' })).toBe(true);
    expect(useShopClientRuntime({ agent, scope: 'thread' })).toBe(true);
  });
  it('preserves unrelated assistants, workspaces, groups, explicit targets and forced runtimes', () => {
    expect(useShopClientRuntime({ agent: { title: 'other' }, scope: 'main' })).toBe(false);
    expect(useShopClientRuntime({ agent: { ...agent, workspaceId: 'ws' }, scope: 'main' })).toBe(
      false,
    );
    expect(useShopClientRuntime({ agent, scope: 'group' })).toBe(false);
    expect(useShopClientRuntime({ agent, scope: 'page' })).toBe(false);
    expect(useShopClientRuntime({ agent, scope: 'main', executionTarget: 'sandbox' })).toBe(false);
    expect(useShopClientRuntime({ agent, scope: 'main', forceRuntime: 'gateway' })).toBe(false);
    expect(useShopClientRuntime({ agent, scope: 'main', heterogeneousProvider: {} })).toBe(false);
  });
});
