/**
 * L28 / v1.28.0 兴趣社群（小组）的页面外壳（纯函数，浏览器和预渲染共用）：
 * - /groups/：小组列表 + 创建小组（登录后）；
 * - /groups/:slug/：小组详情（公告、成员、动态、加入 / 退出、组长与管理员的管理面板）。
 * 内容由 groups-client 在浏览器端按当前身份加载；所有权限判断都在服务端（Worker / 演示 mock）。
 */
import { escapeHtml as e } from './markdown';
import { icon } from './icons';
import { bento, pageHead, shell, tile, type Page, type Route } from './render';
import type { SiteData } from './types';

export function groupsPage(site: SiteData, route: Route): Page {
  return shell(site, route, {
    title: '小组',
    description: '按兴趣组队：加入小组、分享作品、看公告',
    top: pageHead('小组', '按兴趣组队，在小组里分享自己的作品'),
    main: bento(
      [
        tile('full', `<div class="grp-bar"><p class="muted small js-grp-count" aria-live="polite">正在加载小组…</p><button class="btn btn--primary btn--sm js-grp-new" type="button" hidden aria-expanded="false" aria-controls="grp-new">${icon('plus')}创建小组</button></div>
<form class="grp-form" id="grp-new" hidden novalidate>
  <label class="grp-field"><span>小组名称</span><input name="name" maxlength="30" required autocomplete="off"></label>
  <label class="grp-field"><span>网址（小写字母、数字和连字符）</span><input name="slug" maxlength="32" required pattern="[a-z0-9][a-z0-9-]{0,30}[a-z0-9]" autocomplete="off" spellcheck="false"></label>
  <label class="grp-field grp-field--wide"><span>简介</span><textarea name="intro" maxlength="300" rows="2"></textarea></label>
  <fieldset class="grp-field grp-field--wide"><legend>加入方式</legend><label class="grp-radio"><input type="radio" name="joinPolicy" value="open" checked> 直接加入</label><label class="grp-radio"><input type="radio" name="joinPolicy" value="approval"> 需要审核</label></fieldset>
  <div class="grp-actions"><button class="btn btn--primary btn--sm" type="submit">创建</button><p class="grp-err small" role="alert"></p></div>
</form>`, { cls: 'ia-tile grp-head' }),
        tile('full', '<ul class="grp-list" data-groups role="list"></ul>', { cls: 'ia-tile' }),
      ].join(''),
    ),
    kind: 'page--ia page--groups',
  });
}

export function groupPage(site: SiteData, route: Extract<Route, { name: 'group' }>): Page {
  return shell(site, route, {
    title: '小组',
    description: '小组公告、成员与动态',
    top: pageHead('小组', '正在加载…'),
    main: bento(
      [
        tile('full', `<div class="grp-meta js-grp-meta"><p class="muted">正在加载小组…</p></div>`, { cls: 'ia-tile', attrs: `data-group="${e(route.slug)}"` }),
        tile('full', `<section class="grp-notice js-grp-notice" aria-labelledby="grp-notice-h"><h2 id="grp-notice-h" class="grp-h">${icon('flag')}公告</h2><p class="js-grp-notice-text"></p></section>`, { cls: 'ia-tile js-grp-notice-tile', attrs: 'hidden' }),
        tile('full', `<section class="js-grp-admin" aria-labelledby="grp-admin-h"><h2 id="grp-admin-h" class="grp-h">${icon('settings')}管理</h2><div class="js-grp-admin-body"></div></section>`, { cls: 'ia-tile js-grp-admin-tile', attrs: 'hidden' }),
        tile('full', `<section aria-labelledby="grp-feed-h"><h2 id="grp-feed-h" class="grp-h">${icon('image')}小组动态</h2><div class="js-grp-share"></div><ul class="grp-feed js-grp-feed" role="list"></ul><p class="empty js-grp-feed-empty" hidden>还没有人分享作品。</p></section>`, { cls: 'ia-tile' }),
        tile('full', `<section aria-labelledby="grp-mem-h"><h2 id="grp-mem-h" class="grp-h">${icon('users')}成员</h2><ul class="grp-members js-grp-members" role="list"></ul></section>`, { cls: 'ia-tile' }),
      ].join(''),
    ),
    kind: 'page--ia page--group',
  });
}
