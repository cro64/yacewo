/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YACEWO_ROOMS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
