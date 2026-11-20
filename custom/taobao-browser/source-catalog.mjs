import {readFile} from 'node:fs/promises';

const catalogUrl = new URL('../analysis/taobao-chain/taobao-source-catalog.json',import.meta.url);

export async function searchTaobaoSources(query = '') {
  const catalog = JSON.parse(await readFile(catalogUrl,'utf8'));
  const term = query.trim().toLowerCase();
  const matches = [];
  for (const source of catalog.sources) {
    const metrics = catalog.metrics.filter(metric => metric.source_id === source.source_id);
    const matching = metrics.filter(metric => metric.metric_name.toLowerCase().includes(term));
    const sourceMatch = [source.source_id,source.name,source.description].some(s => s?.toLowerCase().includes(term));
    if (!sourceMatch && !matching.length) continue;
    matches.push({
      sourceId:source.source_id, name:source.name, acquisition:source.source_type,
      description:source.description, metricCount:metrics.length,
      sampleMetrics:(sourceMatch ? metrics : matching).slice(0,5).map(metric => metric.metric_name),
    });
  }
  return {scope:'Accio Work 淘宝来源与指标定义。此查询不采集店铺业务数据，也不代表下载执行器已接通。',sources:matches};
}
