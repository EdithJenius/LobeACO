const amount = /^-?[\d,]+(?:\.\d+)?$/;
const period = /\d{4}-\d\d-\d\d\s*~\s*\d{4}-\d\d-\d\d/;
const between = (text, start, end) => {
  const i = text.indexOf(start);
  if (i < 0) return '';
  const tail = text.slice(i + start.length);
  const j = tail.indexOf(end);
  return j < 0 ? tail : tail.slice(0,j);
};
function fields(text, labels) {
  const lines = text.split('\n').map(s => s.trim());
  return Object.fromEntries(labels.map(label => {
    const i=lines.indexOf(label), value=lines[i+1];
    return [label, i >= 0 && amount.test(value) ? value : null];
  }));
}
export function readFinance(text) {
  const sales = between(text,'销售收支统计','收支构成');
  const bill = between(text,'收支构成','常用财务工具');
  const funds = between(text,'货款账户','保证金账户');
  const settlement = between(funds,'聚合结算账户余额','可提现余额').split('\n').find(v=>amount.test(v.trim()));
  return {
    '实时待办':fields(between(text,'待开票','财务助手'),['给买家开票(笔)','待给平台开票金额(元)','待补缴保证金(元)','欠费金额(元)']),
    '货款账户':{'聚合结算账户余额':settlement?.trim()??null,...fields(funds,['可提现余额(元)','提现中(元)','冻结金额(元)'])},
    '保证金账户':fields(between(text,'保证金账户','推广业务账户'),['可用余额(元)','总金额(元)','冻结金额(元)']),
    '推广业务账户':fields(between(text,'推广业务账户','销售收支'),['直通车(元)','超级推荐(元)','万相台(元)']),
    '销售收支':{period:sales.match(period)?.[0]??null,
      '已支付':fields(between(sales,'已支付','已支付未发货'),['金额(元)','子订单(笔)']),
      '已支付未发货':fields(between(sales,'已支付未发货','已发货未收款'),['金额(元)','子订单数(笔)']),
      '已发货未收款':fields(between(sales,'已发货未收款','已收款'),['金额(元)','子订单数(笔)']),
      '已收款':fields(between(sales,'已收款','收支构成'),['收入金额(元)','子订单数(笔)'])},
    '账单收入':{period:bill.match(period)?.[0]??null,...fields(bill,['收入金额(元)','退款金额(元)'])},
    '账单支出':{period:between(bill,'上月汇总数据','服务费').match(/\d{4}-\d\d/)?.[0]??null,...fields(bill,['服务费等支出(元)'])},
  };
}
