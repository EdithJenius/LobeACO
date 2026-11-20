import { isDesktop } from '@lobechat/const';

import { ensureElectronIpc } from '@/utils/electron/ipc';

export interface ShopRun {
  account: string;
  error?: string;
  finishedAt?: string;
  id: string;
  metrics: Record<string, string | null>;
  note?: string;
  report?: { name: string; scope: string; capturedAt: string };
  scope: string;
  sourceUrl?: string;
  startedAt: string;
  status: string;
  storeName?: string;
}
export interface LocalShop {
  canCollect?: boolean;
  canCheckLogin?: boolean;
  accountName?: string | null;
  pendingCheck?: boolean;
  checkError?: string | null;
  authStatus?: string;
  checkedAt?: string;
  enabled: boolean;
  id: string;
  manual?: boolean;
  name: string;
  platform: string;
  running?: boolean;
  storeName?: string;
}
export interface LocalShopData {
  pairRequired?: boolean;
  removed?: Pick<LocalShop, 'id' | 'name' | 'platform'>[];
  runs?: ShopRun[];
  schedule?: { intervalMinutes: number; startTime: string; tasksPerSlot: number };
  shops?: LocalShop[];
}
class LocalShopsService {
  async command<T = LocalShopData>(input: Record<string, unknown>): Promise<T> {
    if (isDesktop) return ensureElectronIpc().localShop.command(input) as Promise<T>;
    const response = await fetch('/api/local-shops', {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }
}
export const localShopsService = new LocalShopsService();
