/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YACEWO_ROOMS_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
