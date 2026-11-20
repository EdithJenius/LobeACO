export function businessAgent(agent: { metadata?: unknown; title?: string | null } | undefined) {
  const meta = agent?.metadata as { expertPackage?: { id?: string } } | undefined;
  return (
    meta?.expertPackage?.id === '1688-seller-assistant' ||
    meta?.expertPackage?.id === 'shop-operations-assistant' ||
    agent?.title === '生意助手' ||
    agent?.title === '1688生意助手'
  );
}

// The local browser bridge is available to a personal business-assistant chat.
// Keep explicitly chosen execution targets and all workspace/group routes intact.
export function useShopClientRuntime(input: {
  agent?: { metadata?: unknown; title?: string | null; workspaceId?: string | null };
  scope?: string;
  workspaceScoped?: boolean;
  executionTarget?: string;
  forceRuntime?: string;
  heterogeneousProvider?: unknown;
}) {
  return (
    businessAgent(input.agent) &&
    !input.agent?.workspaceId &&
    !input.workspaceScoped &&
    (!input.scope || input.scope === 'main' || input.scope === 'thread') &&
    !input.executionTarget &&
    !input.forceRuntime &&
    !input.heterogeneousProvider
  );
}
