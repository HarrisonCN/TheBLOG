import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';
import { DEFAULT_NOTE_STYLE, guardInk, INK_PRESETS, inkContrast, NOTE_PAPERS, normalizeNoteStyle, validateNoteStyle } from '../src/note-style';

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv({});
  admin = await login(env, '10.9.7.1');
});
afterAll(disposeEnv);
const ip = (n: number) => ({ 'cf-connecting-ip': `10.77.0.${n}` });

describe('note-style 校验器（Worker 份）', () => {
  it('缺省 → 默认样式；部分字段补齐默认值', () => {
    expect(validateNoteStyle(undefined)).toEqual({ ok: true, style: DEFAULT_NOTE_STYLE });
    const r = validateNoteStyle({ font: 'kai', effect: 'glow' });
    expect(r.ok && r.style).toEqual({ ...DEFAULT_NOTE_STYLE, font: 'kai', effect: 'glow' });
  });
  it('拒绝原始 CSS、未知字段、错误类型与非白名单枚举', () => {
    for (const bad of [
      'color:red',
      [],
      { css: 'color:red' },
      { color: 'red' },
      { color: '#fff; background:url(x)' },
      { color: '#12345' },
      { font: 'Comic Sans' },
      { size: 99 },
      { weight: 700 },
      { italic: 'yes' },
      { effect: 'blink' },
      { effect: 'none', __proto__x: 1 },
    ]) expect(validateNoteStyle(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it('对比度守卫：太浅的颜色被拒绝，guardInk 能把它加深到 ≥ 4.5:1', () => {
    expect(validateNoteStyle({ color: '#ffff00' }, 'yellow').ok).toBe(false);
    const fixed = guardInk('#ffff00');
    for (const p of NOTE_PAPERS) expect(inkContrast(fixed, p)).toBeGreaterThanOrEqual(4.5);
    for (const c of INK_PRESETS) for (const p of NOTE_PAPERS) expect(inkContrast(c.hex, p), `${c.hex} on ${p}`).toBeGreaterThanOrEqual(4.5);
  });
  it('normalize：坏数据 / 坏 JSON 退回默认，不抛错', () => {
    expect(normalizeNoteStyle('{bad json')).toEqual(DEFAULT_NOTE_STYLE);
    expect(normalizeNoteStyle({ color: 'javascript:alert(1)' })).toEqual(DEFAULT_NOTE_STYLE);
    expect(normalizeNoteStyle('{"font":"serif","size":"xl"}').font).toBe('serif');
  });
});

describe('POST /api/notes 的 style 字段', () => {
  it('合法样式写入 D1 并原样（归一化后）返回；列表接口也带 style', async () => {
    const style = { color: '#1D4ED8', font: 'hand', size: 'l', weight: 'bold', italic: true, effect: 'rainbow' };
    const r = await call(env, '/api/notes', { body: { name: '样式', content: '彩虹字', color: 'blue', style }, headers: ip(1) });
    expect(r.status).toBe(201);
    const note = (await r.json()) as any;
    expect(note.style).toEqual({ ...style, color: '#1d4ed8' });
    const list = ((await (await call(env, '/api/notes')).json()) as any).notes;
    expect(list.find((n: any) => n.id === note.id).style).toEqual({ ...style, color: '#1d4ed8' });
    const all = ((await (await call(env, '/api/admin/notes', { cookie: admin.cookie })).json()) as any).notes;
    expect(all.find((n: any) => n.id === note.id).style.effect).toBe('rainbow');
  });
  it('不带样式 / 默认样式 → style 为 null（旧便签同样为 null）', async () => {
    const a = (await (await call(env, '/api/notes', { body: { name: '默认', content: '普通便签' }, headers: ip(2) })).json()) as any;
    expect(a.style).toBeNull();
    const b = (await (await call(env, '/api/notes', { body: { name: '默认', content: '默认样式', style: DEFAULT_NOTE_STYLE }, headers: ip(3) })).json()) as any;
    expect(b.style).toBeNull();
  });
  it('非法样式 → 400 validation_error，且不会写库', async () => {
    const before = ((await (await call(env, '/api/admin/notes', { cookie: admin.cookie })).json()) as any).notes.length;
    for (const style of [{ css: 'x' }, { color: 'red' }, { font: 'papyrus' }, { effect: 'marquee' }, { color: '#fef08a' }, 'color: red']) {
      const r = await call(env, '/api/notes', { body: { name: '坏', content: '坏样式', color: 'yellow', style }, headers: ip(4) });
      expect(r.status, JSON.stringify(style)).toBe(400);
      expect(((await r.json()) as any).error.code).toBe('validation_error');
    }
    const extra = await call(env, '/api/notes', { body: { name: '坏', content: '多余字段', html: '<b>x</b>' }, headers: ip(5) });
    expect(extra.status).toBe(400);
    const after = ((await (await call(env, '/api/admin/notes', { cookie: admin.cookie })).json()) as any).notes.length;
    expect(after).toBe(before);
  });
  it('库里的坏样式在读取时按默认（null）返回', async () => {
    const n = (await (await call(env, '/api/notes', { body: { name: '库', content: '被改坏的', color: 'green' }, headers: ip(6) })).json()) as any;
    await env.DB.prepare('UPDATE sticky_notes SET style = ? WHERE id = ?').bind('{"color":"red","css":"x"}', n.id).run();
    const list = ((await (await call(env, '/api/notes')).json()) as any).notes;
    expect(list.find((x: any) => x.id === n.id).style).toBeNull();
  });
});
