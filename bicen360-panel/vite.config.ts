import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Bicen360 paneli.
 *
 * Yayin derlemesinde base "/portal/" olarak ayarlanir; Kariyer alan
 * adinin /portal alt klasorunde yayinlanir:
 *     https://kariyer.bicen.com.tr/portal
 *
 * IK paneli /panel altinda kalmaya devam eder; ikisi ayni alan adini
 * paylasir ama ayri klasorlerde durur.
 *
 * Gelistirme sunucusunda base "/" kalir: http://localhost:5180
 */
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/portal/" : "/",
  server: { host: true, port: 5180, open: true },
  preview: { host: true, port: 5180 },
}));
