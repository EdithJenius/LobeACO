import {readFile} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {diagnose} from './skills/qianniu-todo/diagnose.mjs';
import {z} from 'zod';
import {searchTaobaoSources} from './source-catalog.mjs';

const skillUri = 'skill://qianniu-todo/SKILL.md';
export function createQianniuPlugin(account, collect, readReport) {
  const plugin = new McpServer({name:'qianniu-shop', version:'1.0.0'});
  plugin.registerResource('qianniu-todo', skillUri, {mimeType:'text/markdown'}, async () => ({
    contents:[{uri:skillUri, text:await readFile(new URL('./skills/qianniu-todo/SKILL.md', import.meta.url), 'utf8')}],
  }));
  plugin.registerTool('read_qianniu_todos', {
    description:'读取当前绑定店铺的千牛首页待办及采集时间。店铺由调用端预先选择。',
    inputSchema:{}, annotations:{readOnlyHint:true},
  }, async () => {
    const run = await collect();
    if (run.account !== account || run.status !== 'completed') throw Error(run.error || '未成功取得此店铺的快照');
    return {content:[{type:'text', text:JSON.stringify(run)}]};
  });
  if (readReport) plugin.registerTool('read_taobao_shop_report', {
    description:'读取预选淘宝店铺当前可见的商品、质量分或财务报表。',
    inputSchema:{kind:z.enum(['products','quality','finance','daily'])},annotations:{readOnlyHint:true},
  }, async ({kind}) => {
    const context = await readReport(kind);
    if (context.account !== account || context.report?.kind !== kind || !context.storeId) throw Error('报表与所选店铺不符');
    return {content:[{type:'text',text:JSON.stringify(context)}]};
  });
  plugin.registerTool('search_taobao_source_catalog', {
    description:'按关键词检索 Accio 淘宝来源与指标定义，供判断需要何种报表。',
    inputSchema:{query:z.string().max(100).default('')},annotations:{readOnlyHint:true},
  }, async ({query}) => ({content:[{type:'text',text:JSON.stringify(await searchTaobaoSources(query))}]}));
  return plugin;
}

export async function runQianniuSkill(account, collect) {
  const server = createQianniuPlugin(account, collect);
  const client = new Client({name:'qianniu-todo', version:'1.0.0'});
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);
    await client.connect(right);
    const result = await client.callTool({name:'read_qianniu_todos', arguments:{}}, undefined, {timeout:180000});
    const output = result.content[0];
    if (result.isError || output?.type !== 'text') throw Error(output?.text || '读取千牛待办失败');
    return diagnose(account, JSON.parse(output.text));
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}
