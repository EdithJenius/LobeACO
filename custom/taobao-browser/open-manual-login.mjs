import {fileURLToPath} from 'node:url';
import {request} from './client.mjs';
import {BrowserManager} from './core.mjs';
import {restoreOccupiedProfiles} from './occupied-profiles.mjs';
import {ProfileStore} from './profiles.mjs';

const account=process.argv[2] || 'taobao-a';
try {
  console.log((await request({account,action:'manual_login'})).message);
} catch (error) {
  if (error.code !== 'ENOENT' && error.cause?.code !== 'ECONNREFUSED') throw error;
  // The standalone entry point is also used when the local manager is offline.
  const manager=new BrowserManager(fileURLToPath(new URL('./runtime/profiles-chromium/',import.meta.url)));
  const profiles=new ProfileStore(manager);
  await profiles.init();
  await restoreOccupiedProfiles(manager,profiles.items);
  console.log((await manager.execute({account,action:'manual_login'})).message);
  manager.manual.get(account)?.unref?.();
}
