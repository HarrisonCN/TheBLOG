// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error 纯 JS 模块
import { badgeBlock, check, collectVersions, parseCommit, renderSection, topChangelogVersion } from '../../scripts/changelog.mjs';

describe('版本 / 更新日志（scripts/changelog.mjs）', () => {
  it('解析 conventional commit', () => {
    expect(parseCommit('feat(api): cursor pagination')).toEqual({ type: 'feat', scope: 'api', breaking: false, subject: 'cursor pagination' });
    expect(parseCommit('fix!: drop offset')).toMatchObject({ type: 'fix', breaking: true });
    expect(parseCommit('l14: 影集')).toMatchObject({ type: 'other', subject: 'l14: 影集' });
    expect(parseCommit('Merge pull request #4')).toMatchObject({ type: 'other' });
  });
  it('按类型分组生成段落，跳过 wip', () => {
    const md = renderSection({ version: '9.9.9', date: '2026-10-11', title: 't', commits: [{ sha: 'a'.repeat(40), subject: 'feat: x' }, { sha: 'b'.repeat(40), subject: 'wip: y' }, { sha: 'c'.repeat(40), subject: 'fix(web): z' }] });
    expect(md).toContain('## [9.9.9]');
    expect(md).toContain('### 新功能 Features');
    expect(md).toContain('- **web:** z (ccccccc)');
    expect(md).not.toContain('y (bbbbbbb)');
    expect(topChangelogVersion(md)).toBe('9.9.9');
  });
  it('跳过 docs(changelog): regenerate 提交（避免自引用）', () => {
    const md = renderSection({ version: '9.9.9', date: '2026-10-11', title: 't', commits: [{ sha: 'd'.repeat(40), subject: 'docs(changelog): regenerate' }, { sha: 'e'.repeat(40), subject: 'docs(readme): keep me' }] });
    expect(md).not.toContain('regenerate');
    expect(md).toContain('keep me');
  });
  it('徽章来自 package.json / package-lock（Motionary 用实际解析的版本）', () => {
    const v = collectVersions();
    const b = badgeBlock(v);
    expect(b).toContain(`version-${v.root.replace(/-/g, '--')}`);
    expect(b).toContain(`motionary/v/${v.motionary}`);
  });
  it('仓库里所有版本一致（与 CI 的 --check 相同）', () => {
    expect(check()).toEqual([]);
  });
  it('SemVer：Lnn = 1.nn.x', () => {
    expect(collectVersions().root).toMatch(/^1\.\d+\.\d+$/);
  });
});
