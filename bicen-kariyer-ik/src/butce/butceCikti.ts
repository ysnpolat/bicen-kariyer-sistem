/**
 * Personel Bütçesi Excel çıktıları (30.10.2026): panelin ortak tabloIndir
 * biçimi. Her dışa aktarma sunucu günlüğüne yazılır (ücret verisi).
 */
import { tabloIndir } from "../raporExcel";
import type { AyBordro, Donem, Kisi, KisiDetay, Ozet } from "./butceOrtak";
import { butceApi } from "./butceOrtak";

const dosyaAdi = (d: Donem, ek: string) => `personel_butcesi_${d.yil}_${ek}`.replace(/[^\w\-]+/g, "_");

export const aylikExcel = async (d: Donem, o: Ozet, ayTuru: "bordro" | "odeme") => {
  const aylar = ayTuru === "bordro" ? o.bordroAylari : o.odemeAylari;
  await tabloIndir({
    baslik: `${d.ad} · aylık personel maliyeti (${ayTuru === "bordro" ? "bordro ayı" : "ödeme ayı"})`,
    altBaslik: `${o.kisi} kişi · ${o.fte} FTE`,
    sayfaAdi: "Aylık", dosyaAdi: dosyaAdi(d, "aylik"),
    sutunlar: [
      { ad: "Ay", tip: "metin", genislik: 16 }, { ad: "Brüt ücret", tip: "para" }, { ad: "İşveren SGK", tip: "para" }, { ad: "GR farkı", tip: "para" },
      { ad: "Yan giderler", tip: "para" }, { ad: "Tek seferlik", tip: "para" }, { ad: "Toplam maliyet", tip: "para", veriCubugu: true }, { ad: "Bankaya yatan net", tip: "para" },
    ],
    satirlar: aylar.map((a) => [a.etiket, a.brut, a.isverenSgk, a.grFarki, a.yanGider, a.tekSeferlik, a.toplam, a.netBanka]),
    genelToplam: true,
  });
  void butceApi.log("excel_aylik", d.id, ayTuru);
};

export const subeExcel = async (d: Donem, o: Ozet) => {
  await tabloIndir({
    baslik: `${d.ad} · şube bazında yıllık personel maliyeti`,
    sayfaAdi: "Şubeler", dosyaAdi: dosyaAdi(d, "subeler"),
    sutunlar: [
      { ad: "Şube", tip: "metin", genislik: 26 }, { ad: "Kişi", tip: "sayi" }, { ad: "FTE", tip: "ondalik" }, { ad: "Brüt", tip: "para" }, { ad: "İşveren SGK", tip: "para" },
      { ad: "GR farkı", tip: "para" }, { ad: "Yan giderler", tip: "para" }, { ad: "Tek seferlik", tip: "para" }, { ad: "Yıllık toplam", tip: "para", veriCubugu: true },
      { ad: "Aylık", tip: "para" }, { ad: "Kişi başı / ay", tip: "para", toplam: false }, { ad: "Ortalama GRM", tip: "para", toplam: false },
    ],
    satirlar: o.subeler.map((s) => [s.ad, s.kisi, s.fte, s.brut, s.isverenSgk, s.grFarki, s.yanGider, s.tekSeferlik, s.toplam, s.toplam / 12, s.kisiBasiAylik, s.ortalamaNet]),
    genelToplam: true,
  });
  void butceApi.log("excel_subeler", d.id);
};

export const kisilerExcel = async (d: Donem, kisiler: Kisi[]) => {
  await tabloIndir({
    baslik: `${d.ad} · kişi listesi`,
    altBaslik: `${kisiler.length} kişi`,
    sayfaAdi: "Kişiler", dosyaAdi: dosyaAdi(d, "kisiler"),
    sutunlar: [
      { ad: "Şube", tip: "metin", genislik: 22 }, { ad: "Bölüm", tip: "metin", genislik: 10 }, { ad: "Sicil / TC", tip: "metin", genislik: 14 }, { ad: "Ad soyad", tip: "metin", genislik: 26 },
      { ad: "Gün", tip: "sayi", toplam: false }, { ad: "SGK", tip: "metin", genislik: 9 }, { ad: "Meslek", tip: "metin", genislik: 18 },
      { ad: "GRM önceki", tip: "para" }, { ad: "GRM", tip: "para" }, { ad: "Zam", tip: "yuzde", toplam: false }, { ad: "Bordro net", tip: "para" }, { ad: "Ocak brüt", tip: "para" },
      { ad: "Yıllık işveren maliyeti", tip: "para" }, { ad: "Yıllık GR farkı", tip: "para" }, { ad: "Yıllık yan gider", tip: "para" }, { ad: "Yıllık tek seferlik", tip: "para" },
      { ad: "Yıllık toplam", tip: "para", veriCubugu: true }, { ad: "Aylık ortalama", tip: "para" }, { ad: "Durum", tip: "metin", genislik: 10 },
    ],
    satirlar: kisiler.map((k) => [
      k.sube, k.bolum, k.sicil, k.ad, k.gun, k.emekli ? "Emekli" : "Normal", k.meslek, k.grmOnceki, k.grm, k.zamOrani ?? 0, k.bordroNet, k.ocakBrut,
      k.yillikIsveren, k.yillikGrFarki, k.yillikYanGider, k.yillikTekSeferlik, k.yillikToplam, k.aylikOrtalama, k.aktif ? "Aktif" : "Pasif",
    ]),
    grupSutunu: 0, genelToplam: true, toplamEki: " toplamı",
  });
  void butceApi.log("excel_kisiler", d.id, `${kisiler.length} kişi`);
};

export const bordroExcel = async (d: Donem, det: KisiDetay) => {
  const k = det.kisi;
  const satir = (a: AyBordro) => [
    a.etiket, a.brut, a.sgkIsci, a.issizlikIsci, a.matrah, a.kumulatifMatrah, a.gv, a.dv, a.gvIstisna, a.dvIstisna, a.gvSon, a.dvSon, a.net,
    a.sskIsveren, a.indirim, a.issizlikIsveren, a.isverenMaliyeti, a.netBanka, a.grFarki, a.yanGider, a.tekSeferlik, a.toplam,
  ];
  await tabloIndir({
    baslik: `${k.ad ?? ""} · ${d.yil} bordro ve maliyet`,
    altBaslik: `${k.sube ?? ""} · ${k.meslek ?? ""} · ${k.gun} gün · ${k.emekli ? "emekli (SGDP)" : "normal"} · bordro net ${k.bordroNet.toLocaleString("tr-TR")} · GRM ${k.grm.toLocaleString("tr-TR")}`,
    sayfaAdi: "Bordro", dosyaAdi: dosyaAdi(d, "kisi"),
    sutunlar: [
      { ad: "Ay", tip: "metin", genislik: 10 }, { ad: "Brüt", tip: "para" }, { ad: "SGK işçi", tip: "para" }, { ad: "İşsizlik işçi", tip: "para" }, { ad: "Matrah", tip: "para" },
      { ad: "Kümülatif matrah", tip: "para", toplam: false }, { ad: "GV", tip: "para" }, { ad: "DV", tip: "para" }, { ad: "GV istisna", tip: "para" }, { ad: "DV istisna", tip: "para" },
      { ad: "İstisna sonrası GV", tip: "para" }, { ad: "İstisna sonrası DV", tip: "para" }, { ad: "Net", tip: "para" }, { ad: "SSK işveren", tip: "para" }, { ad: "İndirim", tip: "para" },
      { ad: "İşsizlik işveren", tip: "para" }, { ad: "İşveren maliyeti", tip: "para" }, { ad: "Net (banka)", tip: "para" }, { ad: "GR farkı", tip: "para" }, { ad: "Yan giderler", tip: "para" },
      { ad: "Tek seferlik", tip: "para" }, { ad: "Toplam", tip: "para", veriCubugu: true },
    ],
    satirlar: det.aylar.map(satir),
    genelToplam: true,
  });
  void butceApi.log("excel_bordro", d.id, `kişi #${k.id}`);
};
