import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true -> telefondan (QR ile) ayni ag uzerinden test edilebilmesi icin
export default defineConfig({
  plugins: [react()],

  /* Eski telefonlar için derleme hedefi.
  
     Vite varsayılan olarak yalnızca modern tarayıcılara derler (yaklaşık
     Chrome 87 / Safari 14 ve sonrası). 2020 öncesi telefonlarda paket
     AYRIŞTIRILAMIYOR; hata tek bir satırda değil, tüm uygulamada çıkıyor.
     Belirtisi de buydu: şube listesi boş kalıyor, tarih alanı açılmıyor,
     sayfa sessizce yarım çalışıyordu.

     es2015 hedefi sözdizimini eski motorların anlayacağı biçime indiriyor.
     Paket biraz büyüyor; başvuru formu için kabul edilebilir bir bedel,
     çünkü aday hangi telefonla geleceğini biz seçemiyoruz. */
  build: {
    target: ["es2015", "safari11", "chrome64", "firefox67", "edge79"],

    /* Eski tarayıcılarda modül ön yüklemesi desteklenmiyor */
    modulePreload: { polyfill: true },
  },

  /* Geliştirme sunucusu da aynı hedefe derlesin ki telefonda test ederken
     canlıdan farklı davranmasın. */
  esbuild: { target: "es2015" },
  optimizeDeps: { esbuildOptions: { target: "es2015" } },

  server: {
    host: true,
    port: 5179,
    open: true,
  },
  preview: {
    host: true,
    port: 5179,
  },
});
