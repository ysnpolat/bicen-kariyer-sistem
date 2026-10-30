/**
 * Çalışma süresi raporu · Excel (26.10.2026)
 * ---------------------------------------------------------------------------
 * Günlük QR okutma raporundan, seçilen tarih aralığında gün gün:
 * personelin ilk giriş – son çıkış arası (brüt), mola düşülmüş net süre,
 * günlük hedefe göre fazla / eksik; haftalık (Pzt–Paz) toplam ve 45 saat
 * hedefine göre fazla / eksik; dönem özeti. Biçimli .xlsx (ExcelJS).
 *
 * Kurallar (pencereden değiştirilebilir):
 *  - Günlük çalışma 8:30, içinde 1 saat mola → net hedef 7:30.
 *  - Mola, brüt süre en az "molaEsik" (varsayılan 6 saat) ise düşülür.
 *  - Haftalık hedef 45 saat; izinli/raporlu/resmî tatil günleri hedeften
 *    düşer (hafta hedefi = en çok 45, beklenen gün × 7:30).
 *  - Okutma beklenmeyen gün (izin, rapor, muaf, resmî tatil) çalışıldıysa
 *    bütün net süre fazla çalışmadır.
 *  - Çıkış okutması yoksa süre hesaplanmaz ("Çıkış yok").
 */
import ExcelJS from "exceljs";
import dayjs, { Dayjs } from "dayjs";
import { dosyaIndir } from "./formIndir";

export interface CalismaKurali {
  netHedefDk: number; // 450 = 7:30
  molaDk: number; // 60
  molaEsikDk: number; // 360
  haftalikHedefDk: number; // 2700 = 45 saat
}

export const VARSAYILAN_KURAL: CalismaKurali = { netHedefDk: 450, molaDk: 60, molaEsikDk: 360, haftalikHedefDk: 2700 };

interface Gun {
  tarih: Dayjs;
  birim: string;
  kod: string;
  ad: string;
  pozisyon: string;
  durum: string;
  beklenen: boolean;
  tatil: string | null;
  giris: Dayjs | null;
  cikis: Dayjs | null;
  brut: number | null;
  mola: number | null;
  net: number | null;
  hedef: number;
  fazla: number | null;
  eksik: number | null;
  /** Onaylanmış fazla mesai (dk) ve saatleri */
  fmDk: number;
  fmSaat: string;
  not: string;
}

const KOYU = "1F4D2B";
const YESIL = "7CB518";
const dolgu = (r: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + r } });
const cerceve: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFE0E4DA" } },
  bottom: { style: "thin", color: { argb: "FFE0E4DA" } },
  left: { style: "thin", color: { argb: "FFE0E4DA" } },
  right: { style: "thin", color: { argb: "FFE0E4DA" } },
};
const SURE = "[h]:mm";
/** Dakika → Excel süre değeri (gün kesri) */
const s = (dk: number | null | undefined) => (dk == null ? null : dk / 1440);
const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** Bir günün GecisRaporu yanıtını satırlara çevirir */
export const gunuHesapla = (tarih: Dayjs, veri: any, k: CalismaKurali): Gun[] => {
  const tatil: string | null = veri?.resmiTatil?.ad ?? null;
  const cikti: Gun[] = [];
  for (const b of veri?.birimler ?? [])
    for (const p of b.kisiler ?? []) {
      const giris = p.ilkGiris ? dayjs(p.ilkGiris) : null;
      const cikis = p.sonCikis ? dayjs(p.sonCikis) : null;
      const okuttu = !!p.okuttuMu;
      const beklenen = !tatil && !p.beklenmiyor && !p.muaf && !p.raporlu && !p.izinli;
      const durum = okuttu
        ? tatil ? "Tatilde çalıştı" : "Çalıştı"
        : p.raporlu ? "Raporlu" : p.muaf ? "Muaf" : p.izinli || p.neden ? p.neden ?? "İzinli" : tatil ? "Resmî tatil" : "Okutmadı";
      const hedef = beklenen ? k.netHedefDk : 0;

      let brut: number | null = null, mola: number | null = null, net: number | null = null, not = "";
      if (giris && cikis && cikis.isAfter(giris)) {
        brut = cikis.diff(giris, "minute");
        mola = brut >= k.molaEsikDk ? k.molaDk : 0;
        net = Math.max(0, brut - mola);
      } else if (okuttu) not = giris && !cikis ? "Çıkış yok" : "Süre hesaplanamadı";
      if (!okuttu && beklenen) not = "Okutma yok";

      const fazla = net == null ? null : Math.max(0, net - hedef);
      const eksik = net == null ? (beklenen && !okuttu ? hedef : null) : Math.max(0, hedef - net);

      cikti.push({
        tarih, birim: b.birim, kod: p.personelKodu, ad: `${p.ad ?? ""} ${p.soyad ?? ""}`.trim(), pozisyon: p.pozisyon ?? "",
        durum, beklenen, tatil, giris, cikis, brut, mola, net, hedef, fazla, eksik,
        fmDk: (p.fazlaMesai ?? []).reduce((t: number, f: any) => t + (f.sureDk ?? 0), 0),
        fmSaat: (p.fazlaMesai ?? []).map((f: any) => `${f.baslangic}–${f.bitis}`).join(", "),
        not,
      });
    }
  return cikti;
};

const baslikYaz = (ws: ExcelJS.Worksheet, baslik: string, alt: string, sutunlar: { ad: string; gen: number; tip?: "sure" | "sayi" | "tarih" | "saat" }[]) => {
  const son = String.fromCharCode(64 + sutunlar.length);
  sutunlar.forEach((c, i) => (ws.getColumn(i + 1).width = c.gen));
  ws.mergeCells(`A1:${son}1`);
  ws.getCell("A1").value = baslik;
  ws.getCell("A1").font = { size: 15, bold: true, color: { argb: "FF" + KOYU } };
  ws.getRow(1).height = 26;
  ws.mergeCells(`A2:${son}2`);
  ws.getCell("A2").value = alt;
  ws.getCell("A2").font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
  const r = ws.getRow(4);
  r.values = sutunlar.map((c) => c.ad);
  r.height = 30;
  r.eachCell((h) => {
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = dolgu(KOYU);
    h.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    h.border = cerceve;
  });
  ws.autoFilter = { from: "A4", to: `${son}4` };
  ws.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
};

const satirBicimle = (ws: ExcelJS.Worksheet, sutunlar: { tip?: string }[], ilk: number, son: number) => {
  for (let i = ilk; i <= son; i++) {
    const row = ws.getRow(i);
    row.eachCell({ includeEmpty: true }, (c, j) => {
      const t = sutunlar[j - 1]?.tip;
      c.border = cerceve;
      if ((i - ilk) % 2 === 1) c.fill = dolgu("F7F9F4");
      if (t === "sure") { c.numFmt = SURE; c.alignment = { horizontal: "center" }; }
      if (t === "saat") { c.numFmt = "hh:mm"; c.alignment = { horizontal: "center" }; }
      if (t === "tarih") { c.numFmt = "dd.mm.yyyy"; c.alignment = { horizontal: "center" }; }
      if (t === "sayi") c.alignment = { horizontal: "center" };
    });
  }
};

/** Tarih hücresi: ExcelJS Date'i UTC yazıyor; yerel gece yarısı bir önceki güne kaymasın */
const gunTarihi = (d: Dayjs) => new Date(Date.UTC(d.year(), d.month(), d.date()));

/** Excel'in saat hücresi için (yerel saat, gün kesri) */
const saatDegeri = (d: Dayjs | null) => (d ? (d.hour() * 60 + d.minute()) / 1440 : null);

export const calismaSuresiIndir = async (gunler: Gun[], bas: Dayjs, bit: Dayjs, k: CalismaKurali) => {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "Biçen Kariyer";
  kitap.created = new Date();
  const donem = bas.isSame(bit, "day") ? bas.format("DD.MM.YYYY") : `${bas.format("DD.MM.YYYY")} – ${bit.format("DD.MM.YYYY")}`;
  const kural = `Günlük net hedef ${Math.floor(k.netHedefDk / 60)}:${String(k.netHedefDk % 60).padStart(2, "0")} (mola ${k.molaDk} dk, brüt ≥ ${k.molaEsikDk / 60} saat ise düşülür) · haftalık hedef ${k.haftalikHedefDk / 60} saat`;

  /* ------------------------------------------------ 1. Personel özeti */
  type Ozet = { kod: string; ad: string; birim: string; pozisyon: string; gun: number; beklenen: number; tatil: number; net: number; fazla: number; eksik: number; cikisYok: number; okutmadi: number; fm: number };
  const ozet = new Map<string, Ozet>();
  for (const g of gunler) {
    const o = ozet.get(g.kod) ?? { kod: g.kod, ad: g.ad, birim: g.birim, pozisyon: g.pozisyon, gun: 0, beklenen: 0, tatil: 0, net: 0, fazla: 0, eksik: 0, cikisYok: 0, okutmadi: 0, fm: 0 };
    if (g.net != null && g.net > 0) o.gun++;
    if (g.beklenen) o.beklenen++;
    if (g.tatil && g.net) o.tatil++;
    o.net += g.net ?? 0;
    o.fazla += g.fazla ?? 0;
    o.eksik += g.eksik ?? 0;
    o.fm += g.fmDk;
    if (g.not === "Çıkış yok") o.cikisYok++;
    if (g.not === "Okutma yok") o.okutmadi++;
    ozet.set(g.kod, o);
  }

  /* ------------------------------------------------ 2. Haftalık */
  type Hafta = { kod: string; ad: string; birim: string; hafta: Dayjs; net: number; beklenenGun: number; gun: number; tatilNet: number };
  const haftalar = new Map<string, Hafta>();
  for (const g of gunler) {
    const pzt = g.tarih.subtract((g.tarih.day() + 6) % 7, "day").startOf("day");
    const a = `${g.kod}|${pzt.format("YYYY-MM-DD")}`;
    const h = haftalar.get(a) ?? { kod: g.kod, ad: g.ad, birim: g.birim, hafta: pzt, net: 0, beklenenGun: 0, gun: 0, tatilNet: 0 };
    h.net += g.net ?? 0;
    if (g.beklenen) h.beklenenGun++;
    if (g.net) h.gun++;
    if (!g.beklenen) h.tatilNet += g.net ?? 0;
    haftalar.set(a, h);
  }

  const wsO = kitap.addWorksheet("Personel özeti");
  const sO = [
    { ad: "Birim", gen: 24 }, { ad: "Personel", gen: 26 }, { ad: "Sicil", gen: 9 }, { ad: "Pozisyon", gen: 20 },
    { ad: "Çalıştığı gün", gen: 10, tip: "sayi" as const }, { ad: "Beklenen gün", gen: 10, tip: "sayi" as const },
    { ad: "Net çalışma", gen: 12, tip: "sure" as const }, { ad: "Hedef", gen: 11, tip: "sure" as const },
    { ad: "Fazla", gen: 11, tip: "sure" as const }, { ad: "Eksik", gen: 11, tip: "sure" as const },
    { ad: "Tatilde çalıştığı gün", gen: 12, tip: "sayi" as const }, { ad: "Çıkış okutmadığı gün", gen: 12, tip: "sayi" as const },
    { ad: "Okutmadığı gün", gen: 11, tip: "sayi" as const },
    { ad: "Onaylı fazla mesai", gen: 12, tip: "sure" as const },
  ];
  baslikYaz(wsO, "Çalışma Süresi Raporu · Personel özeti", `${donem} · ${kural}`, sO);
  const ozetler = [...ozet.values()].sort((a, b) => a.birim.localeCompare(b.birim, "tr") || a.ad.localeCompare(b.ad, "tr"));
  ozetler.forEach((o) =>
    wsO.addRow([o.birim, o.ad, o.kod, o.pozisyon, o.gun, o.beklenen, s(o.net), s(o.beklenen * k.netHedefDk), s(o.fazla), s(o.eksik), o.tatil, o.cikisYok, o.okutmadi, o.fm ? s(o.fm) : null])
  );
  satirBicimle(wsO, sO, 5, 4 + ozetler.length);
  for (let i = 5; i <= 4 + ozetler.length; i++) {
    const f = wsO.getCell(i, 9), e = wsO.getCell(i, 10);
    if (Number(f.value) > 0) f.font = { bold: true, color: { argb: "FF4D7A0C" } };
    if (Number(e.value) > 0) e.font = { bold: true, color: { argb: "FFC2410C" } };
  }

  /* ------------------------------------------------ Haftalık sayfa */
  const wsH = kitap.addWorksheet("Haftalık");
  const sH = [
    { ad: "Hafta (Pzt)", gen: 12, tip: "tarih" as const }, { ad: "Birim", gen: 24 }, { ad: "Personel", gen: 26 }, { ad: "Sicil", gen: 9 },
    { ad: "Çalıştığı gün", gen: 10, tip: "sayi" as const }, { ad: "Beklenen gün", gen: 10, tip: "sayi" as const },
    { ad: "Net çalışma", gen: 12, tip: "sure" as const }, { ad: "Hafta hedefi", gen: 12, tip: "sure" as const },
    { ad: "Fazla çalışma", gen: 12, tip: "sure" as const }, { ad: "Eksik çalışma", gen: 12, tip: "sure" as const },
  ];
  baslikYaz(wsH, "Çalışma Süresi Raporu · Haftalık (45 saat)", `${donem} · hafta hedefi = en çok ${k.haftalikHedefDk / 60} saat, beklenen gün × günlük hedef`, sH);
  const hl = [...haftalar.values()].sort((a, b) => a.hafta.valueOf() - b.hafta.valueOf() || a.birim.localeCompare(b.birim, "tr") || a.ad.localeCompare(b.ad, "tr"));
  hl.forEach((h) => {
    const hedef = Math.min(k.haftalikHedefDk, h.beklenenGun * k.netHedefDk);
    wsH.addRow([gunTarihi(h.hafta), h.birim, h.ad, h.kod, h.gun, h.beklenenGun, s(h.net), s(hedef), s(Math.max(0, h.net - hedef)), s(Math.max(0, hedef - h.net))]);
  });
  satirBicimle(wsH, sH, 5, 4 + hl.length);
  for (let i = 5; i <= 4 + hl.length; i++) {
    const f = wsH.getCell(i, 9), e = wsH.getCell(i, 10);
    if (Number(f.value) > 0) f.font = { bold: true, color: { argb: "FF4D7A0C" } };
    if (Number(e.value) > 0) e.font = { bold: true, color: { argb: "FFC2410C" } };
  }

  /* ------------------------------------------------ Günlük sayfa */
  const wsG = kitap.addWorksheet("Günlük");
  const sG = [
    { ad: "Tarih", gen: 11, tip: "tarih" as const }, { ad: "Gün", gen: 10 }, { ad: "Birim", gen: 22 }, { ad: "Personel", gen: 24 },
    { ad: "Sicil", gen: 8 }, { ad: "Pozisyon", gen: 18 }, { ad: "Durum", gen: 14 },
    { ad: "İlk giriş", gen: 9, tip: "saat" as const }, { ad: "Son çıkış", gen: 9, tip: "saat" as const },
    { ad: "Brüt süre", gen: 10, tip: "sure" as const }, { ad: "Mola", gen: 8, tip: "sure" as const }, { ad: "Net süre", gen: 10, tip: "sure" as const },
    { ad: "Hedef", gen: 9, tip: "sure" as const }, { ad: "Fazla", gen: 9, tip: "sure" as const }, { ad: "Eksik", gen: 9, tip: "sure" as const },
    { ad: "Onaylı FM", gen: 10, tip: "sure" as const }, { ad: "FM saatleri", gen: 14 },
    { ad: "Not", gen: 16 },
  ];
  baslikYaz(wsG, "Çalışma Süresi Raporu · Günlük", `${donem} · ${kural}`, sG);
  const gl = [...gunler].sort((a, b) => a.tarih.valueOf() - b.tarih.valueOf() || a.birim.localeCompare(b.birim, "tr") || a.ad.localeCompare(b.ad, "tr"));
  gl.forEach((g) =>
    wsG.addRow([
      gunTarihi(g.tarih), GUNLER[g.tarih.day()], g.birim, g.ad, g.kod, g.pozisyon, g.durum,
      saatDegeri(g.giris), saatDegeri(g.cikis), s(g.brut), s(g.mola), s(g.net), s(g.hedef), s(g.fazla), s(g.eksik),
      g.fmDk ? s(g.fmDk) : null, g.fmSaat,
      g.tatil && g.net ? `${g.tatil}${g.not ? " · " + g.not : ""}` : g.not,
    ])
  );
  satirBicimle(wsG, sG, 5, 4 + gl.length);
  for (let i = 5; i <= 4 + gl.length; i++) {
    const d = String(wsG.getCell(i, 7).value ?? "");
    const f = wsG.getCell(i, 14), e = wsG.getCell(i, 15);
    if (Number(f.value) > 0) f.font = { bold: true, color: { argb: "FF4D7A0C" } };
    if (Number(e.value) > 0) e.font = { bold: true, color: { argb: "FFC2410C" } };
    if (d === "Tatilde çalıştı") wsG.getCell(i, 7).fill = dolgu("FFE7D6");
    if (d === "Okutmadı") wsG.getCell(i, 7).font = { color: { argb: "FFC2410C" }, bold: true };
  }

  /* ------------------------------------------------ Açıklama */
  const wsA = kitap.addWorksheet("Açıklama");
  wsA.getColumn(1).width = 110;
  [
    "Çalışma süresi raporu nasıl hesaplanır",
    "",
    `• Brüt süre: o günün ilk giriş okutması ile son çıkış okutması arası.`,
    `• Mola: brüt süre ${k.molaEsikDk / 60} saat ve üzerindeyse ${k.molaDk} dakika düşülür. Net süre = brüt − mola.`,
    `• Günlük hedef: ${Math.floor(k.netHedefDk / 60)} saat ${k.netHedefDk % 60} dakika net (8:30 çalışma, içinde 1 saat mola).`,
    "• Fazla = net − hedef (pozitifse), Eksik = hedef − net (pozitifse).",
    "• İzinli, raporlu, muaf ve resmî tatil günlerinde hedef 0'dır; o gün çalışılan bütün süre fazla çalışma sayılır.",
    "• Okutma beklenen gün hiç okutma yoksa günlük hedefin tamamı eksik yazılır (Not: Okutma yok).",
    "• Çıkış okutması yoksa süre hesaplanamaz (Not: Çıkış yok); bu gün fazla/eksik hesabına girmez.",
    `• Haftalık: Pazartesi–Pazar. Hafta hedefi = en çok ${k.haftalikHedefDk / 60} saat; izinli/raporlu/tatil günleri kadar azalır (beklenen gün × günlük hedef).`,
    "• Süre hücreleri Excel süre biçimindedir ([s]:dd); toplanabilir, filtrelenebilir.",
  ].forEach((t, i) => {
    const c = wsA.getCell(i + 1, 1);
    c.value = t;
    c.font = i === 0 ? { bold: true, size: 14, color: { argb: "FF" + KOYU } } : { size: 11 };
    c.alignment = { wrapText: true };
  });
  wsA.getCell(1, 1).border = { bottom: { style: "medium", color: { argb: "FF" + YESIL } } };

  const govde = await kitap.xlsx.writeBuffer();
  dosyaIndir(
    new Blob([govde as any], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `calisma-suresi-${bas.format("YYYYMMDD")}-${bit.format("YYYYMMDD")}.xlsx`
  );
};
