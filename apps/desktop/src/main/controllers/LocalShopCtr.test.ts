import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const setup = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.resolve(process.cwd()),
    getPath: () => setup.userData,
    isPackaged: false,
  },
}));
vi.mock('./index', () => ({
  ControllerModule: class {
    constructor(public app: unknown) {}
  },
  IpcMethod: () => () => {},
}));
vi.mock('./RemoteServerConfigCtr', () => ({ default: class {} }));

import LocalShopController from './LocalShopCtr';

const directory = (id: string) =>
  path.join(setup.userData, 'shop-manager', createHash('sha256').update(id).digest('hex'));

describe('desktop shop manager', () => {
  afterEach(async () => {
    for (const id of ['account-a', 'account-b']) {
      try {
        const connection = JSON.parse(
          await readFile(path.join(directory(id), 'connection.json'), 'utf8'),
        );
        process.kill(connection.pid);
      } catch {
        /* The isolated manager may not have started. */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await rm(setup.userData, { force: true, recursive: true });
  });

  it('isolates store data between authenticated desktop accounts', async () => {
    setup.userData = await mkdtemp(path.join(os.tmpdir(), 'lobeaco-desktop-test-'));
    let userId: string | undefined = 'account-a';
    const app = {
      getController: () => ({
        getDesktopBootstrapIdentity: () => ({ isIdentityResolved: true, userId }),
      }),
    };
    const controller = new LocalShopController(app as never);
    const first = await controller.command({ action: 'list' });
    expect(first.shops).toEqual([]);
    await controller.command({ action: 'create', name: '测试店', platform: 'taobao' });
    expect((await controller.command({ action: 'list' })).shops).toHaveLength(1);
    const reopened = new LocalShopController(app as never);
    expect((await reopened.command({ action: 'list' })).shops).toHaveLength(1);
    userId = 'account-b';
    expect((await controller.command({ action: 'list' })).shops).toEqual([]);
    userId = undefined;
    await expect(controller.command({ action: 'list' })).rejects.toThrow('请先登录桌面端账号');
  }, 30_000);
});
