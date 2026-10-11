/**
 * L21 运行状态页 /status/（按需加载，首屏不下载）：服务组件、最近 30 天可用率（来自 Cron 记录的健康检查）、
 * 每日柱状图、定时任务最近一次运行、API 版本 / commit / D1 迁移级别、前端构建信息（dist/build.json）。
 */
import './ops.css';
import { DEMO, request } from './api';
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { url } from './render';
import { STATE_LABEL, formatUptime, type ComponentState, type DayBar, type Uptime } from './ops-core';

interface StatusBody {
  overall: 'ok' | 'degraded' | 'down';
  components: { key: string; label: string; state: ComponentState; ms?: number }[];
  version: string;
  commit: string;
  migration: { latest: string | null; ok: boolean };
  uptime: Record<'24h' | '7d' | '30d', Uptime>;
  days: DayBar[];
  lastCheck: { at: string; ok: boolean } | null;
  cron: { job: string; lastRun: string; ok: boolean }[];
  generatedAt: string;
  demo?: boolean;
}
interface BuildInfo { version: string; commit: string; builtAt: string; bundleHash: string; mode?: string }

const OVERALL: Record<StatusBody['overall'], [string, string]> = {
  ok: ['check', '所有服务运行正常'],
  degraded: ['flag', '部分服务异常'],
  down: ['close', '服务故障'],
};
const JOB_LABEL: Record<string, string> = { cron: '定时触发器', health: '健康检查', open: 'Webmention 重试与邮件摘要' };
const TIME = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const fmt = (iso: string) => (Number.isNaN(Date.parse(iso)) ? '—' : TIME.format(new Date(iso)));
function ago(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
}
const chip = (st: ComponentState | DayBar['state']) => `<span class="ops-chip ops-chip--${st}">${e(STATE_LABEL[st])}</span>`;

async function buildInfo(): Promise<BuildInfo | null> {
  try {
    const r = await fetch(url('/build.json'), { cache: 'no-store' });
    return r.ok ? ((await r.json()) as BuildInfo) : null;
  } catch {
    return null;
  }
}

function render(s: StatusBody, b: BuildInfo | null): string {
  const [ic, text] = OVERALL[s.overall];
  const up = (['24h', '7d', '30d'] as const).map(
    (k) => `<div class="ops-up"><p class="ops-up__v">${formatUptime(s.uptime[k])}</p><p class="ops-up__k">${k === '24h' ? '24 小时' : k === '7d' ? '7 天' : '30 天'}可用率</p><p class="muted small">${s.uptime[k].checks} 次检查${s.uptime[k].failed ? ` · ${s.uptime[k].failed} 次失败` : ''}</p></div>`,
  );
  const incidents = s.days.filter((d) => d.state === 'partial' || d.state === 'down');
  const bars = s.days
    .map((d) => {
      const label = `${DAY.format(new Date(`${d.day}T00:00:00Z`))}：${STATE_LABEL[d.state]}${d.checks ? `（${d.checks} 次检查${d.failed ? `，${d.failed} 次失败` : ''}）` : ''}`;
      return `<li class="ops-bar ops-bar--${d.state}" title="${e(label)}"><span class="visually-hidden">${e(label)}</span></li>`;
    })
    .join('');
  return `
<section class="tile tile--full ops-overall ops-overall--${s.overall}" aria-labelledby="ops-overall-h">
  <h2 class="ops-overall__h" id="ops-overall-h">${icon(ic)}<span>${text}</span></h2>
  <p class="muted small">${s.lastCheck ? `最近一次健康检查 ${fmt(s.lastCheck.at)}（${ago(s.lastCheck.at)}）${s.lastCheck.ok ? '通过' : '失败'}` : '还没有健康检查记录'} · 页面生成于 ${fmt(s.generatedAt)}${s.demo ? ' · <b>演示数据</b>：演示站没有服务器，历史记录是虚构的' : ''}</p>
  <p><button class="btn btn--soft btn--sm js-ops-refresh" type="button">${icon('refresh')}刷新</button></p>
</section>
<section class="tile tile--full" aria-labelledby="ops-comp-h">
  <h2 class="soc-h" id="ops-comp-h">${icon('dashboard')}服务组件</h2>
  <ul class="ops-comps">${s.components.map((c) => `<li><span>${e(c.label)}</span>${chip(c.state)}</li>`).join('')}</ul>
</section>
<section class="tile tile--full" aria-labelledby="ops-up-h">
  <h2 class="soc-h" id="ops-up-h">${icon('chart')}可用率</h2>
  <div class="ops-ups">${up.join('')}</div>
  <h3 class="ops-sub" id="ops-days-h">最近 30 天</h3>
  <ol class="ops-bars" aria-labelledby="ops-days-h">${bars}</ol>
  <p class="ops-legend muted small"><span><i class="ops-dot ops-dot--ok"></i>正常</span><span><i class="ops-dot ops-dot--partial"></i>部分异常</span><span><i class="ops-dot ops-dot--down"></i>故障</span><span><i class="ops-dot ops-dot--nodata"></i>无记录</span></p>
  <p class="muted small">${incidents.length ? `有异常的日子：${incidents.map((d) => `${DAY.format(new Date(`${d.day}T00:00:00Z`))}（${d.failed}/${d.checks}）`).join('、')}` : '最近 30 天没有记录到异常。'}可用率只根据定时健康检查（每 15 分钟一次）计算，不追踪任何访客。</p>
</section>
<section class="tile tile--half" aria-labelledby="ops-cron-h">
  <h2 class="soc-h" id="ops-cron-h">${icon('clock')}定时任务</h2>
  ${s.cron.length ? `<ul class="ops-list">${s.cron.map((c) => `<li><span>${e(JOB_LABEL[c.job] ?? c.job)}</span><span class="muted small">${fmt(c.lastRun)} · ${ago(c.lastRun)}</span>${chip(c.ok ? 'ok' : 'degraded')}</li>`).join('')}</ul>` : '<p class="muted">定时任务还没有运行过。</p>'}
</section>
<section class="tile tile--half" aria-labelledby="ops-ver-h">
  <h2 class="soc-h" id="ops-ver-h">${icon('code')}版本</h2>
  <dl class="ops-dl">
    <div><dt>API 版本</dt><dd>${e(s.version)}</dd></div>
    <div><dt>API commit</dt><dd><code>${e(s.commit)}</code></dd></div>
    <div><dt>数据库迁移</dt><dd><code>${e(s.migration.latest ?? '未知')}</code> ${chip(s.migration.ok ? 'ok' : 'degraded')}</dd></div>
    ${b ? `<div><dt>前端构建</dt><dd>${e(b.version)} · <code>${e(b.commit.slice(0, 7))}</code></dd></div><div><dt>构建时间</dt><dd>${fmt(b.builtAt)}</dd></div>` : ''}
  </dl>
</section>`;
}

export async function mountOps(box: HTMLElement, view: string): Promise<void> {
  if (view !== 'status') return;
  const load = async () => {
    const [s, b] = await Promise.all([request<StatusBody>('/api/status'), buildInfo()]);
    box.innerHTML = render(s, b);
    box.querySelector('.js-ops-refresh')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      try {
        await load();
        box.querySelector<HTMLButtonElement>('.js-ops-refresh')?.focus();
      } finally {
        btn.disabled = false;
      }
    });
  };
  await load();
  if (DEMO) box.dataset.demo = '1';
}
