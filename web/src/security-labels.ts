/** L22 安全记录的中文说明（会员的隐私与安全中心与后台「二次验证」共用；很小，不带样式）。 */
export const EVENT_LABEL: Record<string, string> = {
  login: '登录',
  new_device: '新设备登录提醒',
  new_network: '新网络登录提醒',
  passkey_added: '添加了 Passkey',
  passkey_renamed: '重命名了 Passkey',
  passkey_removed: '删除了 Passkey',
  passkey_counter: 'Passkey 签名计数异常，已拒绝登录',
  logout_device: '退出了一台设备',
  logout_others: '退出了其它所有设备',
  logout_all: '退出了全部设备',
  export: '导出了全部数据',
  deletion_requested: '申请注销账号',
  deletion_cancelled: '撤销了注销',
  privacy_changed: '修改了隐私设置',
  account_purged: '账号已清除',
  admin_login: '后台登录',
  admin_login_failed: '后台密码错误',
  admin_2fa_failed: '二次验证失败',
  admin_2fa_enabled: '开启了二次验证',
  admin_2fa_disabled: '关闭了二次验证',
  admin_recovery_used: '使用了恢复码登录',
  admin_recovery_regenerated: '重新生成了恢复码',
};
export const METHOD: Record<string, string> = { email: '邮箱验证码', google: 'Google', passkey: 'Passkey', password: '密码', totp: '验证器', recovery: '恢复码' };
export const WARN = new Set(['new_device', 'new_network', 'passkey_counter', 'deletion_requested', 'admin_login_failed', 'admin_2fa_failed', 'admin_2fa_disabled']);
export function eventText(ev: { kind: string; detail: string }): string {
  const base = EVENT_LABEL[ev.kind];
  if (!base) return ev.kind;
  if ((ev.kind === 'login' || ev.kind === 'admin_login') && METHOD[ev.detail]) return `${base}（${METHOD[ev.detail]}）`;
  if ((ev.kind === 'passkey_added' || ev.kind === 'passkey_removed' || ev.kind === 'passkey_renamed') && ev.detail) return `${base}「${ev.detail}」`;
  return base;
}

