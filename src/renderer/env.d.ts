/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_DEBUG_MODE: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
