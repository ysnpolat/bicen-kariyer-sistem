/**
 * Renkli zeminli simge
 * ---------------------------------------------------------------------------
 * Simgeyi kendi renginde yumuşak bir kare zeminin içine koyar.
 *
 * Tek renk ince çizgili simgeler liste içinde birbirine benziyordu:
 * personel aradığı modülü adını okuyarak buluyordu, simge yardımcı
 * olmuyordu. Renk ve dolgu ayrımı tanımayı hızlandırıyor.
 *
 * Renk eşlemesi burada tek yerde: modül renklerini üç ekranda ayrı ayrı
 * tanımlamak, bir rengi değiştirirken birini unutmaya yol açıyordu.
 */

import { View, StyleSheet } from "react-native";

import Simge from "./Simge";
import { renk } from "../tema";

/* -------------------------------------------------------------------------- */

/** Modül koduna göre renk ve zemin.

    12.10.2026: Diğer sekmesinde modüllerin çoğu yeşildi (tanımsız olanlar
    varsayılan yeşile düşüyordu ve birkaçı zaten yeşildi); her modül kendi
    renginde. Aynı grupta yan yana gelenler farklı tonlarda. */
export const MODUL_RENGI = {
  /* Günlük işler */
  vardiya:      { renk: "#1a5fb4", zemin: "#e7f0fc" },
  checklist:    { renk: "#0f8a7e", zemin: "#e2f5f2" },
  isemri:       { renk: "#7a3fd1", zemin: "#f1eafc" },

  /* Mağaza */
  ariza:        { renk: "#e8481c", zemin: "#fdece7" },
  envanter:     { renk: "#8a5a2b", zemin: "#f6eee5" },
  fiyatkontrol: { renk: "#5f8c10", zemin: "#eef7e0" },
  rakipfiyat:   { renk: "#d4380d", zemin: "#fff0e8" },
  kunye:        { renk: "#c27c00", zemin: "#fdf4df" },
  izinonay:     { renk: "#1d3f73", zemin: "#e6edf7" },
  puantaj:      { renk: "#0b7fab", zemin: "#e3f3fa" },
  vardiyaplani: { renk: "#5b5bd6", zemin: "#ececfb" },
  ekibim:       { renk: "#c41d7f", zemin: "#fbe8f3" },

  /* Özlük */
  izin:         { renk: "#2b8a3e", zemin: "#e6f5e9" },
  avans:        { renk: "#b8860b", zemin: "#fbf3dc" },
  prim:         { renk: "#9c36b5", zemin: "#f6e8fa" },
  performans:   { renk: "#1971c2", zemin: "#e7f1fb" },
  bilgilerim:   { renk: "#495057", zemin: "#eef0f2" },

  /* İletişim ve yönetim */
  duyuru:       { renk: "#e67700", zemin: "#fff3e0" },
  haberler:     { renk: "#e03131", zemin: "#fdeaea" },
  rapor:        { renk: "#6741d9", zemin: "#efeafc" },
  ikrapor:      { renk: "#6741d9", zemin: "#efeafc" },
  etik:         { renk: "#c92a2a", zemin: "#fbe9e9" },
  kazankazan:   { renk: "#c8930a", zemin: "#fff6dc" },
  ekipdegerlendirme: { renk: "#5f8c10", zemin: "#f2f9e8" },
  mesajlar:     { renk: "#0b8f6a", zemin: "#e4f6ef" },
  devamsizlik:  { renk: "#d4380d", zemin: "#fff1ec" },
  skt:          { renk: "#b45309", zemin: "#fff4e0" },

  /* Ana sayfa ve görev kartları */
  mazeret:      { renk: renk.turuncu, zemin: "#fdece7" },
  oryantasyon:  { renk: "#2f9e44", zemin: "#e7f6ea" },
  rotasyon:     { renk: "#1864ab", zemin: "#e7f0fa" },
  bilgi:        { renk: "#1a4d80", zemin: "#e8f0f8" },

  /* Bilgilerim sayfasının bölümleri */
  belgeler:     { renk: "#1a4d80", zemin: "#e8f0f8" },
  pusula:       { renk: "#722ed1", zemin: "#f2ecfb" },
  egitim:       { renk: "#d48806", zemin: "#fdf3e0" },
  kartvizit:    { renk: renk.yesilKoyu, zemin: renk.yesilAcik },
  kasa:         { renk: renk.turuncu, zemin: "#fdece7" },
};

/** Sunucunun eski sürümlerle ortak gönderdiği simge yerine 1.7'de daha uygunu */
export const MODUL_SIMGESI = {
  izinonay: "canta",
  avans: "para",
  ekibim: "ekip",
  envanter: "kutu",
  rakipfiyat: "etiket",
  haberler: "kalp",
  kazankazan: "kupa",
  mesajlar: "mesaj",
  devamsizlik: "uyari",
  skt: "takvim",
  ekipdegerlendirme: "ekip",
};

const VARSAYILAN = { renk: renk.yesilKoyu, zemin: renk.yesilAcik };

/**
 * @param kod     Modül kodu; renk bundan seçiliyor
 * @param ad      Simge adı; verilmezse kod kullanılıyor
 * @param boyut   Zeminin kenar uzunluğu
 */
export default function SimgeKutu({ kod, ad, boyut = 40, yuvarlak }) {
  const r = MODUL_RENGI[kod] ?? VARSAYILAN;
  const simge = MODUL_SIMGESI[kod] ?? ad ?? kod;

  return (
    <View
      style={[
        s.kutu,
        {
          width: boyut,
          height: boyut,
          borderRadius: yuvarlak ?? boyut * 0.33,
          backgroundColor: r.zemin,
        },
      ]}
    >
      <Simge ad={simge} boyut={boyut * 0.48} renkli={r.renk} dolgu />
    </View>
  );
}

const s = StyleSheet.create({
  kutu: { alignItems: "center", justifyContent: "center" },
});
