/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  /** '1' = 演示构建（浏览器内 mock API） */
  readonly VITE_DEMO?: string;
}
