/**
 * Hard product red line: never let replay click anything that could be irreversible.
 * If you find yourself wanting to remove a keyword to make a flow work — record around it instead.
 */
const DANGEROUS_KEYWORDS_ZH = [
  '删除', '移除', '注销', '解绑', '退款', '退订', '退货',
  '支付', '付款', '充值', '购买', '下单', '提交订单', '立即购买',
  '确认提交', '确认删除', '确认支付', '确认下单',
  '清空', '解散', '停用', '禁用',
];

const DANGEROUS_KEYWORDS_EN = [
  'delete', 'remove', 'cancel subscription', 'unsubscribe',
  'pay now', 'purchase', 'place order', 'buy now', 'checkout',
  'confirm delete', 'confirm payment', 'confirm submit',
  'deactivate', 'disable account', 'wipe',
];

export interface SafetyResult {
  safe: boolean;
  matched?: string;
}

export function checkSafety(visibleText: string | null | undefined): SafetyResult {
  if (!visibleText) return { safe: true };
  const normalized = visibleText.toLowerCase();

  for (const kw of DANGEROUS_KEYWORDS_ZH) {
    if (visibleText.includes(kw)) return { safe: false, matched: kw };
  }
  for (const kw of DANGEROUS_KEYWORDS_EN) {
    if (normalized.includes(kw)) return { safe: false, matched: kw };
  }
  return { safe: true };
}
