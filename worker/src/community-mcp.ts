/** 社区模块的 MCP 工具（好朋友 / 徽章 / 便利贴 / 收件箱 / 节日 / 项目）。 */
import { z } from 'zod';
import type { ToolDef } from './mcp';
import * as c from './community';

const memberId = z.number().int().positive().describe('好朋友 ID');

export const COMMUNITY_TOOLS: ToolDef[] = [
  {
    name: 'list_members',
    title: '列出好朋友',
    description: '列出所有好朋友（含邮箱与徽章）。',
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (env) => ({ members: await c.listMembers(env) }),
  },
  {
    name: 'grant_badge',
    title: '颁发徽章',
    description: '给好朋友颁发一枚徽章。编号全站唯一（自动转大写），每人最多 5 枚。style：pearlescent 珍珠 / brushed-metal 拉丝金属；design 可选：DIY 设计对象（texture/shape/fill/color/gradient/border/icon/label/effect/size，白名单校验）。',
    input: c.badgeGrantSchema.extend({ memberId }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (env, { memberId: id, ...rest }) => c.grantBadge(env, id, rest),
  },
  {
    name: 'revoke_badge',
    title: '收回徽章',
    description: '按编号收回好朋友的一枚徽章。',
    input: z.object({ memberId, code: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9-]+$/).describe('徽章编号') }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (env, a) => c.revokeBadge(env, a.memberId, a.code),
  },
  {
    name: 'list_sticky_notes',
    title: '列出便利贴',
    description: '列出所有便利贴（含被举报隐藏的），用于审核。',
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env) => c.listNotes(env, { all: true }),
  },
  {
    name: 'moderate_sticky_note',
    title: '审核便利贴',
    description: 'show 恢复显示（清零举报）/ hide 隐藏 / delete 删除。',
    input: c.noteModerateSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (env, a) => c.moderateNote(env, a),
  },
  {
    name: 'list_inbox',
    title: '查看收件箱',
    description: '列出好朋友上传的文件和语音留言（元数据，不含内容）。',
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (env) => c.listInbox(env),
  },
  {
    name: 'moderate_inbox',
    title: '处理收件箱',
    description: 'kind=files：approve / reject / delete；kind=voice：read / delete。',
    input: c.inboxActionSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (env, a) => c.inboxAction(env, a),
  },
  {
    name: 'get_festivals',
    title: '查看节日',
    description: '列出节日配置（日期 MM-DD 每年 / YYYY-MM-DD 仅当年，持续天数，主题）。',
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (env) => ({ festivals: await c.getCommunity(env, 'festivals') }),
  },
  {
    name: 'set_festivals',
    title: '设置节日',
    description: '整体替换节日列表（最多 60 个）。主题：lunar / xmas / halloween / fireworks。',
    input: z.object({ festivals: c.festivalsSchema }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (env, a) => ({ festivals: await c.setCommunity(env, 'festivals', a.festivals) }),
  },
  {
    name: 'set_projects',
    title: '设置项目',
    description: '整体替换首页「我的项目」列表（最多 30 个）。',
    input: z.object({ items: c.projectsSchema }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (env, a) => ({ items: await c.setCommunity(env, 'projects', a.items) }),
  },
];
