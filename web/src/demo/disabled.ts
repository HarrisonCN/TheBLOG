/** 正式构建里 ./demo/client 的替身（见 vite.config.ts 的 alias）：确保演示代码和演示密码不进入正式产物。 */
import type { MockResponse } from './mock-api';

const off = (): never => {
  throw new Error('演示模式未启用');
};
export const DEMO_PASSWORD = '';
export const demoHandle = (_path: string, _init?: RequestInit): Promise<MockResponse> => off();
export const mountDemoBanner = (_opts?: { adminHref?: string; siteHref?: string }): void => off();
