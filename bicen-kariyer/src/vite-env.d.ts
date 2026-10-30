/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API adresi. Boş bırakılırsa aynı alan adı üzerinden /api yolu kullanılır. */
  readonly VITE_API_TABAN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
