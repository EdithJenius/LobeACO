import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

import { app } from 'electron';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

type Connection = { pid: number; port: number; token: string };

/** Owns the isolated shop manager; credentials never enter the renderer. */
export default class LocalShopController extends ControllerModule {
  static override readonly groupName = 'localShop';
  private readonly pending = new Map<string, Promise<Connection>>();

  private runtime(owner: string) {
    const accountHash = createHash('sha256').update(owner).digest('hex');
    return path.join(app.getPath('userData'), 'shop-manager', accountHash);
  }

  private async request(connection: Connection, owner: string, input: Record<string, unknown>) {
    const response = await fetch(`http://127.0.0.1:${connection.port}/shops`, {
      body: JSON.stringify(input),
      headers: {
        'authorization': `Bearer ${connection.token}`,
        'content-type': 'application/json',
        'x-lobe-user-id': owner,
      },
      method: 'POST',
      signal: AbortSignal.timeout(
        ['collect', 'productList', 'pageRead', 'browser'].includes(String(input.action))
          ? 600_000
          : 90_000,
      ),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Shop manager returned ${response.status}`);
    return data;
  }

  private async connect(owner: string): Promise<Connection> {
    try {
      const existing = JSON.parse(
        await readFile(path.join(this.runtime(owner), 'connection.json'), 'utf8'),
      ) as Connection;
      const status = await fetch(`http://127.0.0.1:${existing.port}/status`, {
        headers: { authorization: `Bearer ${existing.token}` },
        signal: AbortSignal.timeout(1000),
      });
      if (status.ok) return existing;
    } catch {
      /* A new manager is started below. */
    }

    const port = await new Promise<number>((resolve, reject) => {
      const socket = createServer();
      socket.once('error', reject);
      socket.listen(0, '127.0.0.1', () => {
        const address = socket.address();
        if (!address || typeof address === 'string')
          return reject(new Error('No local port available'));
        socket.close(() => resolve(address.port));
      });
    });
    const source = app.isPackaged
      ? path.join(process.resourcesPath, 'lobeaco-shop')
      : path.resolve(app.getAppPath(), '../../custom/taobao-browser');
    const child = spawn(process.execPath, [path.join(source, 'service.mjs')], {
      detached: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PLAYWRIGHT_BROWSERS_PATH: app.isPackaged
          ? path.join(process.resourcesPath, 'lobeaco-browsers')
          : process.env.PLAYWRIGHT_BROWSERS_PATH,
        TAOBAO_BROWSER_PORT: String(port),
        TAOBAO_EMPTY_PROFILES: '1',
        TAOBAO_BROWSER_RUNTIME: this.runtime(owner),
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    let spawnError: Error | undefined;
    child.once('error', (error) => {
      spawnError = error;
    });
    const pid = child.pid;
    child.unref();
    for (let attempt = 0; attempt < 150; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error('店铺管理器启动失败');
      try {
        const connection = JSON.parse(
          await readFile(path.join(this.runtime(owner), 'connection.json'), 'utf8'),
        ) as Connection;
        if (connection.pid === pid && connection.port === port) return connection;
      } catch {
        /* The manager has not written its connection file yet. */
      }
    }
    throw new Error('店铺管理器启动超时');
  }

  @IpcMethod()
  async command(input: Record<string, unknown>) {
    const identity = this.app.getController(RemoteServerConfigCtr).getDesktopBootstrapIdentity();
    if (!identity.isIdentityResolved || !identity.userId) throw new Error('请先登录桌面端账号');
    const owner = identity.userId;
    let pending = this.pending.get(owner);
    if (!pending) {
      pending = this.connect(owner).catch((error) => {
        this.pending.delete(owner);
        throw error;
      });
      this.pending.set(owner, pending);
    }
    const connection = await pending;
    try {
      let result = await this.request(connection, owner, input);
      if (result?.pairRequired) {
        const state = JSON.parse(
          await readFile(path.join(this.runtime(owner), 'shop-collections.json'), 'utf8'),
        );
        if (!state.pairCode) throw new Error('店铺管理器与其他账号关联，请检查独立数据目录');
        await this.request(connection, owner, { action: 'pair', code: state.pairCode });
        result = await this.request(connection, owner, input);
      }
      return result;
    } catch (error) {
      this.pending.delete(owner);
      throw error;
    }
  }
}
