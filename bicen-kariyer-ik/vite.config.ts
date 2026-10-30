import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Insan Kaynaklari paneli.
 *
 * Yayin derlemesinde base "/panel/" olarak ayarlanir; panel alan adinin
 * /panel alt klasorunde yayinlanir:
 *     https://kariyer.bicen.com.tr/panel
 *
 * Gelistirme sunucusunda base "/" kalir: http://localhost:5178
 */
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/panel/" : "/",
  server: {
    host: true,
    port: 5178,
    open: true,
  },
  preview: {
    host: true,
    port: 5178,
  },
}));
