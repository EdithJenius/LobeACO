const reviewOrder = ['待处理投诉', '违规', '待售后', '待发货', '待回复差评', '待付款'];

export function diagnose(account, run) {
  if (run.account !== account || run.status !== 'completed' || !run.storeId || !run.finishedAt) {
    throw new Error(run.error || '未取得当前店铺的已验证快照');
  }
  const pending = [], zero = [], missing = [];
  for (const label of reviewOrder) {
    const value = run.metrics[label];
    if (value === '0') zero.push(label);
    else if (typeof value === 'string' && /^\d+\+?$/.test(value)) pending.push({label, value});
    else missing.push(label);
  }
  return {
    account, name: run.storeName, platform:'taobao', authStatus:'authenticated', latest:run,
    diagnosis:{skill:'qianniu-todo', tool:'read_qianniu_todos', pending, zero, missing},
  };
}
