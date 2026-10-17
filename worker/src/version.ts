/** L21：版本号来自 worker/package.json（发布时三个 package.json 一起改）；部署时 APP_VERSION 变量优先。 */
import pkg from '../package.json';

export const APP_VERSION: string = pkg.version;
/** 这份代码需要的最新 D1 迁移（smoke 检查与 /api/health 用它判断远程 D1 是否已经迁移到位）；新增迁移时同步修改（测试会检查） */
export const EXPECTED_MIGRATION = '0025_media';
