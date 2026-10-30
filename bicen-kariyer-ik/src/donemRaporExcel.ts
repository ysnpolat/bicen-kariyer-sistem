/**
 * ---------------------------------------------------------------------------
 * İzin ve avans dönem raporları — Excel (08.10.2026)
 * ---------------------------------------------------------------------------
 * İzin: seçilen ay ya da tarih aralığında kimin hangi izin türüne kaç gün
 * çıktığı. Sayfalar: Özet (türe göre, şube × tür, aylık dağılım), Kişi
 * bazında (kişi × tür), Aylık (kişi × ay, aralık birden çok aya yayılıyorsa)
 * ve Ayrıntı (izin kaydı başına bir satır).
 *
 * Avans: kim ne kadar avans almış, kaç taksit ödemiş, kaç taksit kalmış,
 * kapananlar. Sayfalar: Özet, Avanslar, Devam edenler, Kapananlar, Kişi
 * bazında ve Taksit planı.
 *
 * Toplam satırları SUBTOTAL ile: Excel'de süzgeç uygulanınca kendiliğinden
 * güncellenir.
 * ---------------------------------------------------------------------------
 */

import ExcelJS from "exceljs";
import { dosyaIndir } from "./formIndir";

/* Renkler: Biçen yeşili ve türevleri (raporExcel ile aynı) */
const KOYU = "1F4D2B";
const YESIL = "7CB518";
const ACIK = "F2F9E8";
const ZEBRA = "FAFBF8";
const GRI = "6B7280";
const TURUNCU = "E8A33A";

const dolgu = (renk: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + renk } });
const cerceve: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFE0E4DA" } },
  bottom: { style: "thin", color: { argb: "FFE0E4DA" } },
  left: { style: "thin", color: { argb: "FFE0E4DA" } },
  right: { style: "thin", color: { argb: "FFE0E4DA" } },
};

const harf = (n: number): string => {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export type Tip = "metin" | "sayi" | "gun" | "para" | "tarih" | "yuzde";

export interface Sutun {
  ad: string;
  tip?: Tip;
  /** Toplam satırında toplanır (sayı, gün ve parada varsayılan açık) */
  toplam?: boolean;
  /** Veri çubuğu (sayısal) */
  cubuk?: boolean;
  /** Renk ölçeği (sayısal) */
  olcek?: boolean;
}

const BICIM: Record<Tip, string | undefined> = {
  metin: undefined,
  sayi: "#,##0",
  gun: "General",
  para: '#,##0.00 "₺"',
  tarih: "dd.mm.yyyy",
  yuzde: "0%",
};

const sayisal = (t?: Tip) => t === "sayi" || t === "gun" || t === "para" || t === "yuzde";

const deger = (v: any, t?: Tip) => {
  if (v === null || v === undefined || v === "") return null;
  if (t === "tarih") {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    /* Saat dilimi kaymasın: yerel günün UTC gece yarısı */
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  if (sayisal(t)) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  return v;
};

/** Sayfa başlığı: büyük başlık, alt başlık (dönem · hazırlayan · tarih) */
const baslikYaz = (ws: ExcelJS.Worksheet, baslik: string, alt: string, genislik: number) => {
  const son = harf(Math.max(genislik, 4));
  ws.mergeCells(`A1:${son}1`);
  const b = ws.getCell("A1");
  b.value = baslik;
  b.font = { name: "Calibri", size: 17, bold: true, color: { argb: "FF" + KOYU } };
  b.alignment = { vertical: "middle" };
  ws.getRow(1).height = 30;

  ws.mergeCells(`A2:${son}2`);
  const a = ws.getCell("A2");
  a.value = alt;
  a.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF" + GRI } };
};

/** Bölüm başlığı (Özet sayfasındaki tabloların üstü) */
const bolumYaz = (ws: ExcelJS.Worksheet, satir: number, metin: string, genislik: number) => {
  ws.mergeCells(`A${satir}:${harf(genislik)}${satir}`);
  const c = ws.getCell(`A${satir}`);
  c.value = metin;
  c.font = { name: "Calibri", size: 12.5, bold: true, color: { argb: "FF" + KOYU } };
  c.border = { bottom: { style: "medium", color: { argb: "FF" + YESIL } } };
  ws.getRow(satir).height = 22;
};

/** Göstergeler: her biri iki sütun genişliğinde kutu (etiket + büyük değer) */
const kutularYaz = (ws: ExcelJS.Worksheet, satir: number, kutular: { ad: string; deger: any; tip?: Tip; renk?: string }[]) => {
  kutular.forEach((k, i) => {
    const s1 = harf(i * 2 + 1);
    const s2 = harf(i * 2 + 2);
    ws.mergeCells(`${s1}${satir}:${s2}${satir}`);
    ws.mergeCells(`${s1}${satir + 1}:${s2}${satir + 1}`);
    const e = ws.getCell(`${s1}${satir}`);
    e.value = k.ad;
    e.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: "FF" + GRI } };
    e.fill = dolgu(ACIK);
    e.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    const d = ws.getCell(`${s1}${satir + 1}`);
    d.value = deger(k.deger, k.tip);
    d.font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF" + (k.renk ?? KOYU) } };
    d.fill = dolgu(ACIK);
    d.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    if (k.tip && BICIM[k.tip]) d.numFmt = BICIM[k.tip]!;
  });
  ws.getRow(satir).height = 18;
  ws.getRow(satir + 1).height = 30;
};

/**
 * Tablo: başlık satırı, veri (zebra), isteğe bağlı SUBTOTAL toplam satırı,
 * veri çubuğu ve renk ölçeği. Sonraki boş satırın numarasını döndürür.
 */
const tabloYaz = (
  ws: ExcelJS.Worksheet,
  bas: number,
  sutunlar: Sutun[],
  satirlar: any[][],
  s: { toplam?: string | false; suzgec?: boolean; dondur?: number } = {}
): number => {
  const n = sutunlar.length;

  const hr = ws.getRow(bas);
  hr.values = sutunlar.map((c) => c.ad);
  hr.height = 30;
  for (let i = 1; i <= n; i++) {
    const h = hr.getCell(i);
    const c = sutunlar[i - 1];
    h.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = dolgu(KOYU);
    h.alignment = { vertical: "middle", horizontal: sayisal(c.tip) || c.tip === "tarih" ? "center" : "left", wrapText: true };
    h.border = cerceve;
  }

  let no = bas + 1;
  for (const [j, sat] of satirlar.entries()) {
    const r = ws.getRow(no);
    r.values = sat.map((v, i) => deger(v, sutunlar[i]?.tip));
    for (let i = 1; i <= n; i++) {
      const c = r.getCell(i);
      const t = sutunlar[i - 1].tip;
      c.border = cerceve;
      c.font = { name: "Calibri", size: 10.5 };
      if (j % 2 === 1) c.fill = dolgu(ZEBRA);
      if (t && BICIM[t]) c.numFmt = BICIM[t]!;
      c.alignment = { vertical: "middle", horizontal: sayisal(t) ? "right" : t === "tarih" ? "center" : "left" };
    }
    no++;
  }

  const ilk = bas + 1;
  const son = no - 1;

  if (s.toplam !== false && satirlar.length > 0) {
    const r = ws.getRow(no);
    r.values = sutunlar.map((c, i) =>
      i === 0
        ? s.toplam ?? "Toplam"
        : (c.toplam ?? (c.tip === "sayi" || c.tip === "gun" || c.tip === "para"))
        ? { formula: `SUBTOTAL(9,${harf(i + 1)}${ilk}:${harf(i + 1)}${son})` }
        : null
    ) as any;
    for (let i = 1; i <= n; i++) {
      const c = r.getCell(i);
      const t = sutunlar[i - 1].tip;
      c.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = dolgu(YESIL);
      c.border = cerceve;
      if (t && BICIM[t]) c.numFmt = BICIM[t]!;
      c.alignment = { vertical: "middle", horizontal: sayisal(t) ? "right" : "left" };
    }
    r.height = 20;
    no++;
  }

  if (satirlar.length > 0) {
    sutunlar.forEach((c, i) => {
      const ref = `${harf(i + 1)}${ilk}:${harf(i + 1)}${son}`;
      if (c.cubuk)
        ws.addConditionalFormatting({
          ref,
          rules: [{ type: "dataBar", priority: 1, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF" + YESIL } } as any],
        });
      if (c.olcek)
        ws.addConditionalFormatting({
          ref,
          rules: [
            {
              type: "colorScale",
              priority: 2,
              cfvo: [{ type: "min" }, { type: "max" }],
              color: [{ argb: "FFFFFFFF" }, { argb: "FFB7DD7A" }],
            } as any,
          ],
        });
    });
  }

  if (s.suzgec && satirlar.length > 0) ws.autoFilter = { from: `A${bas}`, to: `${harf(n)}${son}` };
  if (s.dondur !== undefined) ws.views = [{ state: "frozen", ySplit: bas, xSplit: s.dondur, showGridLines: false }];

  return no + 1;
};

const genislikler = (ws: ExcelJS.Worksheet, g: number[]) => g.forEach((w, i) => (ws.getColumn(i + 1).width = w));

const yeniSayfa = (kitap: ExcelJS.Workbook, ad: string) =>
  kitap.addWorksheet(ad.slice(0, 31), {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

const trTarih = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString("tr-TR") : "");

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** "2026-10" → "Ekim 2026" */
export const ayAdi = (a: string) => {
  const [y, m] = a.split("-").map(Number);
  return `${AYLAR[m - 1]} ${y}`;
};

/** bas..bit arasındaki aylar ("yyyy-MM") */
export const aylarArasi = (bas: string | Date, bit: string | Date) => {
  const b = new Date(bas);
  const s = new Date(bit);
  const l: string[] = [];
  let y = b.getFullYear();
  let m = b.getMonth();
  while (y < s.getFullYear() || (y === s.getFullYear() && m <= s.getMonth())) {
    l.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return l;
};

const yuvarla = (n: number) => Math.round(n * 100) / 100;
const tr = (a: string, b: string) => (a ?? "").localeCompare(b ?? "", "tr");

const kaydet = async (kitap: ExcelJS.Workbook, ad: string) => {
  const tampon = await kitap.xlsx.writeBuffer();
  dosyaIndir(new Blob([tampon], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), ad);
};

/* ======================================================================== */
/* İzin                                                                     */
/* ======================================================================== */

export interface IzinSatiri {
  id: number;
  kod: string;
  ad: string;
  sube: string | null;
  bolge: string | null;
  gorev: string | null;
  aktif: boolean;
  tur: string;
  bakiyedenDuser: boolean;
  cikis: string;
  donus: string;
  baslama: string | null;
  gun: number;
  donemGun: number;
  saat: number | null;
  saatAraligi: string | null;
  yarimGun: string | null;
  aciklama: string | null;
  giren: string | null;
  olusturma: string;
  aylar: Record<string, number>;
}

export interface IzinDonemVerisi {
  bas: string;
  bit: string;
  hazirlayan: string;
  turler: string[];
  satirlar: IzinSatiri[];
}

/** İzin raporunun hesapları (panel ön izlemesi de bunu kullanıyor) */
export const izinOzeti = (v: IzinDonemVerisi) => {
  const turler = v.turler.filter((t) => v.satirlar.some((x) => x.tur === t));
  const aylar = aylarArasi(v.bas, v.bit);

  type Kisi = { kod: string; ad: string; sube: string; bolge: string; gorev: string; aktif: boolean; tur: Record<string, number>; toplam: number; kayit: number; saat: number; ay: Record<string, number> };
  const kisiler = new Map<string, Kisi>();
  const subeler = new Map<string, { bolge: string; kisi: Set<string>; tur: Record<string, number>; toplam: number }>();
  const turOzet = new Map<string, { kisi: Set<string>; kayit: number; gun: number; saat: number }>();
  const turAy = new Map<string, Record<string, number>>();

  for (const x of v.satirlar) {
    const k = kisiler.get(x.kod) ?? { kod: x.kod, ad: x.ad, sube: x.sube ?? "", bolge: x.bolge ?? "", gorev: x.gorev ?? "", aktif: x.aktif, tur: {}, toplam: 0, kayit: 0, saat: 0, ay: {} };
    k.tur[x.tur] = (k.tur[x.tur] ?? 0) + x.donemGun;
    k.toplam += x.donemGun;
    k.kayit++;
    k.saat += x.saat ?? 0;
    for (const [a, g] of Object.entries(x.aylar ?? {})) k.ay[a] = (k.ay[a] ?? 0) + g;
    kisiler.set(x.kod, k);

    const sk = x.sube ?? "—";
    const s = subeler.get(sk) ?? { bolge: x.bolge ?? "", kisi: new Set<string>(), tur: {}, toplam: 0 };
    s.kisi.add(x.kod);
    s.tur[x.tur] = (s.tur[x.tur] ?? 0) + x.donemGun;
    s.toplam += x.donemGun;
    subeler.set(sk, s);

    const t = turOzet.get(x.tur) ?? { kisi: new Set<string>(), kayit: 0, gun: 0, saat: 0 };
    t.kisi.add(x.kod);
    t.kayit++;
    t.gun += x.donemGun;
    t.saat += x.saat ?? 0;
    turOzet.set(x.tur, t);

    const ta = turAy.get(x.tur) ?? {};
    for (const [a, g] of Object.entries(x.aylar ?? {})) ta[a] = (ta[a] ?? 0) + g;
    turAy.set(x.tur, ta);
  }

  const toplamGun = yuvarla([...kisiler.values()].reduce((s, k) => s + k.toplam, 0));

  return {
    turler,
    aylar,
    kisiler: [...kisiler.values()].sort((a, b) => tr(a.sube, b.sube) || tr(a.ad, b.ad)),
    subeler: [...subeler.entries()].map(([ad, s]) => ({ ad, ...s })).sort((a, b) => tr(a.bolge, b.bolge) || tr(a.ad, b.ad)),
    turOzet: turler.map((t) => ({ tur: t, ...turOzet.get(t)! })),
    turAy,
    toplamGun,
    kisiSayisi: kisiler.size,
    kayitSayisi: v.satirlar.length,
  };
};

export const izinRaporuIndir = async (v: IzinDonemVerisi, suzgecMetni?: string) => {
  const o = izinOzeti(v);
  const donem = `${trTarih(v.bas)} – ${trTarih(v.bit)}`;
  const alt = `Dönem: ${donem}${suzgecMetni ? ` · ${suzgecMetni}` : ""} · Hazırlayan: ${v.hazirlayan} · ${new Date().toLocaleString("tr-TR")}`;

  const kitap = new ExcelJS.Workbook();
  kitap.creator = "Biçen Kariyer";
  kitap.created = new Date();

  /* ---------------------------------------------------------------- Özet */
  const oz = yeniSayfa(kitap, "Özet");
  const ozGen = Math.max(9, 4 + o.turler.length, 2 + o.aylar.length);
  genislikler(oz, [26, 16, ...Array(ozGen).fill(13)]);
  baslikYaz(oz, "İzin Raporu", alt, ozGen);

  const enCok = [...o.turOzet].sort((a, b) => b.gun - a.gun)[0];
  kutularYaz(oz, 4, [
    { ad: "TOPLAM İZİN GÜNÜ", deger: o.toplamGun, tip: "gun" },
    { ad: "İZİN KULLANAN KİŞİ", deger: o.kisiSayisi, tip: "sayi" },
    { ad: "İZİN KAYDI", deger: o.kayitSayisi, tip: "sayi" },
    { ad: "EN ÇOK KULLANILAN", deger: enCok ? `${enCok.tur}` : "—", renk: TURUNCU },
  ]);

  let r = 7;
  bolumYaz(oz, r, "İzin türlerine göre", 6);
  r = tabloYaz(
    oz,
    r + 1,
    [{ ad: "İzin türü" }, { ad: "Kişi", tip: "sayi", toplam: false }, { ad: "Kayıt", tip: "sayi" }, { ad: "Gün", tip: "gun", cubuk: true }, { ad: "Saat (saatlik izin)", tip: "gun" }, { ad: "Pay", tip: "yuzde", toplam: false }],
    o.turOzet.map((t) => [t.tur, t.kisi.size, t.kayit, yuvarla(t.gun), t.saat ? yuvarla(t.saat) : null, o.toplamGun ? t.gun / o.toplamGun : 0]),
    { toplam: "Toplam" }
  );

  bolumYaz(oz, r, "Şube ve izin türü (gün)", 3 + o.turler.length + 1);
  r = tabloYaz(
    oz,
    r + 1,
    [{ ad: "Şube" }, { ad: "Bölge" }, { ad: "Kişi", tip: "sayi" }, ...o.turler.map((t) => ({ ad: t, tip: "gun" as Tip })), { ad: "Toplam", tip: "gun", olcek: true }],
    o.subeler.map((s) => [s.ad, s.bolge, s.kisi.size, ...o.turler.map((t) => yuvarla(s.tur[t] ?? 0) || null), yuvarla(s.toplam)]),
    { toplam: "Genel toplam" }
  );

  if (o.aylar.length > 1) {
    bolumYaz(oz, r, "Aylık dağılım (gün)", o.aylar.length + 2);
    r = tabloYaz(
      oz,
      r + 1,
      [{ ad: "İzin türü" }, ...o.aylar.map((a) => ({ ad: ayAdi(a), tip: "gun" as Tip })), { ad: "Toplam", tip: "gun" }],
      o.turler.map((t) => {
        const ta = o.turAy.get(t) ?? {};
        const d = o.aylar.map((a) => yuvarla(ta[a] ?? 0) || null);
        return [t, ...d, yuvarla(d.reduce((s: number, x) => s + (x ?? 0), 0))];
      }),
      { toplam: "Toplam" }
    );
  }

  const not = oz.getCell(`A${r}`);
  not.value =
    "Gün, seçilen döneme düşen gündür: dönem dışına taşan iznin yalnızca dönem içindeki payı sayılır. Saatlik izinler Saat sütununda. Toplamlar SUBTOTAL ile; süzgeç uygulanınca güncellenir.";
  not.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF" + GRI } };

  /* ---------------------------------------------------------- Kişi bazında */
  const kb = yeniSayfa(kitap, "Kişi bazında");
  genislikler(kb, [10, 26, 22, 16, 22, 11, ...o.turler.map(() => 12), 12, 9, 10]);
  baslikYaz(kb, "İzin Raporu · Kişi bazında", alt, 9 + o.turler.length);
  tabloYaz(
    kb,
    4,
    [
      { ad: "Sicil" },
      { ad: "Ad Soyad" },
      { ad: "Şube" },
      { ad: "Bölge" },
      { ad: "Görev" },
      { ad: "Durum" },
      ...o.turler.map((t) => ({ ad: t, tip: "gun" as Tip })),
      { ad: "Toplam gün", tip: "gun", cubuk: true },
      { ad: "Kayıt", tip: "sayi" },
      { ad: "Saat", tip: "gun" },
    ],
    o.kisiler.map((k) => [
      k.kod,
      k.ad,
      k.sube,
      k.bolge,
      k.gorev,
      k.aktif ? "Çalışıyor" : "Ayrıldı",
      ...o.turler.map((t) => yuvarla(k.tur[t] ?? 0) || null),
      yuvarla(k.toplam),
      k.kayit,
      k.saat ? yuvarla(k.saat) : null,
    ]),
    { toplam: "Toplam", suzgec: true, dondur: 2 }
  );

  /* ------------------------------------------------------------ Aylık */
  if (o.aylar.length > 1) {
    const ay = yeniSayfa(kitap, "Aylık (kişi)");
    genislikler(ay, [10, 26, 22, 22, ...o.aylar.map(() => 12), 12]);
    baslikYaz(ay, "İzin Raporu · Kişi × ay (gün)", alt, 5 + o.aylar.length);
    tabloYaz(
      ay,
      4,
      [{ ad: "Sicil" }, { ad: "Ad Soyad" }, { ad: "Şube" }, { ad: "Görev" }, ...o.aylar.map((a) => ({ ad: ayAdi(a), tip: "gun" as Tip, olcek: true })), { ad: "Toplam", tip: "gun" }],
      o.kisiler.map((k) => [k.kod, k.ad, k.sube, k.gorev, ...o.aylar.map((a) => yuvarla(k.ay[a] ?? 0) || null), yuvarla(k.toplam)]),
      { toplam: "Toplam", suzgec: true, dondur: 2 }
    );
  }

  /* ---------------------------------------------------------- Ayrıntı */
  const ay2 = yeniSayfa(kitap, "Ayrıntı");
  genislikler(ay2, [10, 26, 22, 16, 22, 20, 12, 12, 12, 10, 12, 9, 12, 11, 40, 18, 12]);
  baslikYaz(ay2, "İzin Raporu · Ayrıntı (izin kaydı başına bir satır)", alt, 17);
  tabloYaz(
    ay2,
    4,
    [
      { ad: "Sicil" },
      { ad: "Ad Soyad" },
      { ad: "Şube" },
      { ad: "Bölge" },
      { ad: "Görev" },
      { ad: "İzin türü" },
      { ad: "Çıkış", tip: "tarih" },
      { ad: "Son izin günü", tip: "tarih" },
      { ad: "İşe başlama", tip: "tarih" },
      { ad: "Toplam gün", tip: "gun" },
      { ad: "Bu dönemde gün", tip: "gun" },
      { ad: "Saat", tip: "gun" },
      { ad: "Saat aralığı" },
      { ad: "Bakiyeden düşer" },
      { ad: "Açıklama" },
      { ad: "Giren" },
      { ad: "Kayıt tarihi", tip: "tarih" },
    ],
    [...v.satirlar]
      .sort((a, b) => tr(a.sube ?? "", b.sube ?? "") || tr(a.ad, b.ad) || a.cikis.localeCompare(b.cikis))
      .map((x) => [
        x.kod,
        x.ad,
        x.sube,
        x.bolge,
        x.gorev,
        x.tur + (x.yarimGun ? ` (${x.yarimGun})` : ""),
        x.cikis,
        x.donus,
        x.baslama,
        x.gun,
        x.donemGun,
        x.saat,
        x.saatAraligi,
        x.bakiyedenDuser ? "Evet" : "Hayır",
        x.aciklama,
        x.giren,
        x.olusturma,
      ]),
    { toplam: "Toplam", suzgec: true, dondur: 2 }
  );

  const ad = aylarArasi(v.bas, v.bit).length === 1 && new Date(v.bas).getDate() === 1 ? aylarArasi(v.bas, v.bit)[0] : `${v.bas.slice(0, 10)}_${v.bit.slice(0, 10)}`;
  await kaydet(kitap, `izin-raporu-${ad}.xlsx`);
};

/* ======================================================================== */
/* Avans                                                                    */
/* ======================================================================== */

export interface AvansKaydi {
  id: number;
  personelKodu: string;
  adSoyad: string;
  sube: string | null;
  pozisyon: string | null;
  olusturma: string;
  neden: string | null;
  aciklama: string | null;
  talepTutar: number;
  talepTaksit: number;
  tutar: number;
  taksit: number;
  ilkKesinti: string;
  sonKesinti: string | null;
  durum: string;
  durumAdi: string;
  onayli: boolean;
  devamEdiyor: boolean;
  kapandi: boolean;
  odenenTaksit: number;
  kalanTaksit: number;
  kesilenTutar: number;
  kalanTutar: number;
  siradaki: string | null;
  odemeTarihi: string | null;
  kararVeren: string | null;
  kararTarihi: string | null;
  ikNotu: string | null;
  kaynak: string | null;
  taksitler: { sira: number; tarih: string; tutar: number; kesildi: boolean }[];
}

export interface AvansRaporVerisi {
  bas: string | null;
  bit: string | null;
  hazirlayan: string;
  kesintiGunu: number;
  kayitlar: AvansKaydi[];
}

export const avansOzeti = (v: AvansRaporVerisi) => {
  const onayli = v.kayitlar.filter((x) => x.onayli);
  const devam = onayli.filter((x) => x.devamEdiyor);
  const kapanan = onayli.filter((x) => x.kapandi);

  const kisiler = new Map<string, { kod: string; ad: string; sube: string; pozisyon: string; adet: number; toplam: number; odenen: number; kalan: number; devam: number; kapanan: number; son: string }>();
  for (const x of onayli) {
    const k = kisiler.get(x.personelKodu) ?? { kod: x.personelKodu, ad: x.adSoyad, sube: x.sube ?? "", pozisyon: x.pozisyon ?? "", adet: 0, toplam: 0, odenen: 0, kalan: 0, devam: 0, kapanan: 0, son: x.olusturma };
    k.adet++;
    k.toplam += x.tutar;
    k.odenen += x.kesilenTutar;
    k.kalan += x.kalanTutar;
    if (x.devamEdiyor) k.devam++;
    if (x.kapandi) k.kapanan++;
    if (x.olusturma > k.son) k.son = x.olusturma;
    kisiler.set(x.personelKodu, k);
  }

  const subeler = new Map<string, { kisi: Set<string>; adet: number; toplam: number; odenen: number; kalan: number; devam: number }>();
  for (const x of onayli) {
    const s = subeler.get(x.sube ?? "—") ?? { kisi: new Set<string>(), adet: 0, toplam: 0, odenen: 0, kalan: 0, devam: 0 };
    s.kisi.add(x.personelKodu);
    s.adet++;
    s.toplam += x.tutar;
    s.odenen += x.kesilenTutar;
    s.kalan += x.kalanTutar;
    if (x.devamEdiyor) s.devam++;
    subeler.set(x.sube ?? "—", s);
  }

  const durumlar = new Map<string, { adet: number; tutar: number }>();
  for (const x of v.kayitlar) {
    const ad = x.durum === "bekliyor" ? "Onay bekliyor" : x.durumAdi;
    const d = durumlar.get(ad) ?? { adet: 0, tutar: 0 };
    d.adet++;
    d.tutar += x.tutar;
    durumlar.set(ad, d);
  }

  const aylar = new Map<string, { adet: number; tutar: number; kisi: Set<string> }>();
  for (const x of onayli) {
    const a = x.olusturma.slice(0, 7);
    const d = aylar.get(a) ?? { adet: 0, tutar: 0, kisi: new Set<string>() };
    d.adet++;
    d.tutar += x.tutar;
    d.kisi.add(x.personelKodu);
    aylar.set(a, d);
  }

  return {
    onayli,
    devam,
    kapanan,
    kisiler: [...kisiler.values()].sort((a, b) => b.kalan - a.kalan || tr(a.ad, b.ad)),
    subeler: [...subeler.entries()].map(([ad, s]) => ({ ad, ...s })).sort((a, b) => b.toplam - a.toplam),
    durumlar: [...durumlar.entries()].map(([ad, d]) => ({ ad, ...d })),
    aylar: [...aylar.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ay, d]) => ({ ay, ...d })),
    toplam: onayli.reduce((s, x) => s + x.tutar, 0),
    odenen: onayli.reduce((s, x) => s + x.kesilenTutar, 0),
    kalan: onayli.reduce((s, x) => s + x.kalanTutar, 0),
  };
};

const avansSutunlari: Sutun[] = [
  { ad: "No", tip: "sayi", toplam: false },
  { ad: "Talep tarihi", tip: "tarih" },
  { ad: "Sicil" },
  { ad: "Ad Soyad" },
  { ad: "Şube" },
  { ad: "Pozisyon" },
  { ad: "Neden" },
  { ad: "İstenen", tip: "para" },
  { ad: "Verilen", tip: "para" },
  { ad: "Taksit", tip: "sayi", toplam: false },
  { ad: "Ödenen taksit", tip: "sayi" },
  { ad: "Kalan taksit", tip: "sayi" },
  { ad: "Ödenen tutar", tip: "para" },
  { ad: "Kalan tutar", tip: "para" },
  { ad: "İlerleme", tip: "yuzde", toplam: false, cubuk: true },
  { ad: "İlk kesinti", tip: "tarih" },
  { ad: "Sıradaki kesinti", tip: "tarih" },
  { ad: "Son kesinti", tip: "tarih" },
  { ad: "Ödeme tarihi", tip: "tarih" },
  { ad: "Durum" },
  { ad: "Onaylayan" },
  { ad: "Açıklama" },
];

const avansSatiri = (x: AvansKaydi) => [
  x.id,
  x.olusturma,
  x.personelKodu,
  x.adSoyad,
  x.sube,
  x.pozisyon,
  x.neden,
  x.talepTutar,
  x.onayli ? x.tutar : null,
  x.taksit,
  x.onayli ? x.odenenTaksit : null,
  x.onayli ? x.kalanTaksit : null,
  x.onayli ? x.kesilenTutar : null,
  x.onayli ? x.kalanTutar : null,
  x.onayli && x.taksit ? x.odenenTaksit / x.taksit : null,
  x.ilkKesinti,
  x.siradaki,
  x.sonKesinti,
  x.odemeTarihi,
  x.durumAdi,
  x.onayli ? x.kararVeren : null,
  [x.aciklama, x.ikNotu ? `İK: ${x.ikNotu}` : null].filter(Boolean).join(" · ") || null,
];

const avansGenislik = [7, 12, 10, 24, 20, 18, 16, 13, 13, 8, 10, 10, 13, 13, 11, 12, 13, 12, 12, 24, 22, 40];

export const avansRaporuIndir = async (v: AvansRaporVerisi, suzgecMetni?: string) => {
  const o = avansOzeti(v);
  const donem = v.bas || v.bit ? `${trTarih(v.bas) || "başlangıç"} – ${trTarih(v.bit) || "bugün"}` : "Tüm zamanlar";
  const alt = `Talep tarihi: ${donem}${suzgecMetni ? ` · ${suzgecMetni}` : ""} · Hazırlayan: ${v.hazirlayan} · ${new Date().toLocaleString("tr-TR")}`;

  const kitap = new ExcelJS.Workbook();
  kitap.creator = "Biçen Kariyer";
  kitap.created = new Date();

  /* ---------------------------------------------------------------- Özet */
  const oz = yeniSayfa(kitap, "Özet");
  genislikler(oz, [24, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16]);
  baslikYaz(oz, "Avans Raporu", alt, 12);

  kutularYaz(oz, 4, [
    { ad: "VERİLEN AVANS", deger: o.toplam, tip: "para" },
    { ad: "AVANS ADEDİ / KİŞİ", deger: `${o.onayli.length} / ${o.kisiler.length}` },
    { ad: "ÖDENEN (KESİLEN)", deger: o.odenen, tip: "para" },
    { ad: "KALAN ALACAK", deger: o.kalan, tip: "para", renk: TURUNCU },
    { ad: "DEVAM EDEN", deger: o.devam.length, tip: "sayi" },
    { ad: "KAPANAN", deger: o.kapanan.length, tip: "sayi" },
  ]);

  let r = 7;
  bolumYaz(oz, r, "Duruma göre (bütün talepler)", 3);
  r = tabloYaz(oz, r + 1, [{ ad: "Durum" }, { ad: "Adet", tip: "sayi" }, { ad: "Tutar", tip: "para" }], o.durumlar.map((d) => [d.ad, d.adet, d.tutar]));

  bolumYaz(oz, r, "Şubeye göre (onaylanan avanslar)", 7);
  r = tabloYaz(
    oz,
    r + 1,
    [{ ad: "Şube" }, { ad: "Kişi", tip: "sayi" }, { ad: "Avans", tip: "sayi" }, { ad: "Verilen", tip: "para", cubuk: true }, { ad: "Ödenen", tip: "para" }, { ad: "Kalan", tip: "para", olcek: true }, { ad: "Devam eden", tip: "sayi" }],
    o.subeler.map((s) => [s.ad, s.kisi.size, s.adet, s.toplam, s.odenen, s.kalan, s.devam]),
    { toplam: "Genel toplam" }
  );

  if (o.aylar.length > 0) {
    bolumYaz(oz, r, "Aya göre (talep ayı, onaylanan)", 4);
    r = tabloYaz(oz, r + 1, [{ ad: "Ay" }, { ad: "Kişi", tip: "sayi" }, { ad: "Avans", tip: "sayi" }, { ad: "Tutar", tip: "para", cubuk: true }], o.aylar.map((a) => [ayAdi(a.ay), a.kisi.size, a.adet, a.tutar]));
  }

  const not = oz.getCell(`A${r}`);
  not.value = `Kesinti günü ayın ${v.kesintiGunu}'i; tarihi geçen taksit ödenmiş (kesilmiş) sayılır. "Kapanan": bütün taksitleri kesilmiş avans. Maaş bilgisi rapora alınmaz.`;
  not.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF" + GRI } };

  /* ------------------------------------------------- Avans listeleri */
  const liste = (ad: string, baslik: string, kayitlar: AvansKaydi[]) => {
    const ws = yeniSayfa(kitap, ad);
    genislikler(ws, avansGenislik);
    baslikYaz(ws, baslik, alt, avansSutunlari.length);
    tabloYaz(ws, 4, avansSutunlari, kayitlar.map(avansSatiri), { toplam: `Toplam · ${kayitlar.length} avans`, suzgec: true, dondur: 4 });
  };

  liste("Avanslar", "Avans Raporu · Bütün talepler", [...v.kayitlar].sort((a, b) => b.olusturma.localeCompare(a.olusturma)));
  liste("Devam edenler", "Avans Raporu · Ödemesi devam edenler", [...o.devam].sort((a, b) => (a.siradaki ?? "").localeCompare(b.siradaki ?? "")));
  liste("Kapananlar", "Avans Raporu · Kapananlar (bütün taksitleri ödenmiş)", [...o.kapanan].sort((a, b) => (b.sonKesinti ?? "").localeCompare(a.sonKesinti ?? "")));

  /* ------------------------------------------------------ Kişi bazında */
  const kb = yeniSayfa(kitap, "Kişi bazında");
  genislikler(kb, [10, 26, 22, 20, 10, 14, 14, 14, 11, 11, 13]);
  baslikYaz(kb, "Avans Raporu · Kişi bazında", alt, 11);
  tabloYaz(
    kb,
    4,
    [
      { ad: "Sicil" },
      { ad: "Ad Soyad" },
      { ad: "Şube" },
      { ad: "Pozisyon" },
      { ad: "Avans", tip: "sayi" },
      { ad: "Toplam alınan", tip: "para", cubuk: true },
      { ad: "Ödenen", tip: "para" },
      { ad: "Kalan", tip: "para", olcek: true },
      { ad: "Devam eden", tip: "sayi" },
      { ad: "Kapanan", tip: "sayi" },
      { ad: "Son avans", tip: "tarih" },
    ],
    o.kisiler.map((k) => [k.kod, k.ad, k.sube, k.pozisyon, k.adet, k.toplam, k.odenen, k.kalan, k.devam, k.kapanan, k.son]),
    { toplam: "Toplam", suzgec: true, dondur: 2 }
  );

  /* ------------------------------------------------------ Taksit planı */
  const tp = yeniSayfa(kitap, "Taksit planı");
  genislikler(tp, [8, 10, 26, 22, 9, 13, 13, 12]);
  baslikYaz(tp, "Avans Raporu · Taksit planı", alt, 8);
  const taksitler = o.onayli
    .flatMap((x) => x.taksitler.map((t) => ({ x, t })))
    .sort((a, b) => a.t.tarih.localeCompare(b.t.tarih) || tr(a.x.adSoyad, b.x.adSoyad));
  tabloYaz(
    tp,
    4,
    [{ ad: "Avans no", tip: "sayi", toplam: false }, { ad: "Sicil" }, { ad: "Ad Soyad" }, { ad: "Şube" }, { ad: "Taksit", toplam: false }, { ad: "Kesinti tarihi", tip: "tarih" }, { ad: "Tutar", tip: "para" }, { ad: "Durum" }],
    taksitler.map(({ x, t }) => [x.id, x.personelKodu, x.adSoyad, x.sube, `${t.sira} / ${x.taksit}`, t.tarih, t.tutar, t.kesildi ? "Kesildi" : "Bekliyor"]),
    { toplam: "Toplam", suzgec: true, dondur: 3 }
  );

  const ad = v.bas || v.bit ? `${(v.bas ?? "").slice(0, 10)}_${(v.bit ?? "").slice(0, 10)}` : "tum";
  await kaydet(kitap, `avans-raporu-${ad}.xlsx`);
};
