import {readFile} from 'node:fs/promises';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createQianniuPlugin} from './qianniu-plugin.mjs';

const account = process.argv[2];
if (!account) throw Error('请指定本机已绑定的淘宝账号 ID');
async function command(input) {
  const {port,token} = JSON.parse(await readFile(new URL('./runtime/connection.json',import.meta.url),'utf8'));
  const response = await fetch('http://127.0.0.1:' + port + '/collections', {
    method:'POST', headers:{authorization:'Bearer ' + token, 'content-type':'application/json'},
    body:JSON.stringify({account,...input}),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error);
  return body;
}
const plugin = createQianniuPlugin(account,
  () => command({action:'collect',kind:'todo'}),
  kind => command({action:'report',kind}));
await plugin.connect(new StdioServerTransport());
