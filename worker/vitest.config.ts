import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

// 所有测试文件共用一份本地 D1（global-setup），顺序会影响「默认为空」之类的断言；
// 默认排序器按缓存的耗时 / 失败记录重排，不同机器、不同次运行顺序不同 → 固定按文件名排序。
class ByNameSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
  }
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    sequence: { sequencer: ByNameSequencer },
  },
});
