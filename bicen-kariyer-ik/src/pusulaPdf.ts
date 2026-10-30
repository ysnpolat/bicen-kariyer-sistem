/**
 * Ücret hesap pusulası PDF'i.
 *
 * Mikro'nun makbuz düzeni (kazanç / sosyal yardım / özel kesinti / yasal
 * kesinti dört sütun, altta toplamlar ve imza) A4'e temiz bir tabloyla
 * çizilir. Veri /api/Tahakkuk/Pusula'dan gelir; hangi alanın hangi Mikro
 * sütunundan okunduğu sunucuda eşlenir, burada yalnızca yerleştirilir.
 *
 * Türkçe karakter için DejaVu Sans public/fonts altından bir kez yüklenir;
 * jsPDF'in yerleşik yazı tipleri ş, ğ, İ basamıyor.
 */
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { dosyaIndir } from "./formIndir";

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz",
  "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

let fontYuklendi: Promise<{ mono: string; monoKalin: string }> | null = null;

const base64 = (b: ArrayBuffer) => {
  const bytes = new Uint8Array(b);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
};

const fontlariGetir = () => {
  if (!fontYuklendi) {
    const kok = (import.meta as any).env?.BASE_URL ?? "/";
    /* Mikro'nun makbuzu eşit aralıklı (Courier) yazıyla basılır; sütunlar
       o yüzden hizalı duruyor. Aynı görünüm için DejaVu Sans Mono —
       jsPDF'in yerleşik Courier'i Türkçe karakter basamıyor. */
    fontYuklendi = Promise.all([
      fetch(`${kok}fonts/DejaVuSansMono.ttf`).then((r) => r.arrayBuffer()),
      fetch(`${kok}fonts/DejaVuSansMono-Bold.ttf`).then((r) => r.arrayBuffer()),
    ]).then(([m, mk]) => ({ mono: base64(m), monoKalin: base64(mk) }));
  }
  return fontYuklendi;
};

const para = (v: any) =>
  v === null || v === undefined || v === ""
    ? "0,00"
    : Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sayi = (v: any, basamak = 1) =>
  v === null || v === undefined || v === "" ? "0" : Number(v).toLocaleString("tr-TR", { maximumFractionDigits: basamak });

const tarih = (v: any) => (v ? new Date(v).toLocaleDateString("tr-TR") : "");

export interface PusulaVerisi {
  donem: { yil: number; ay: number };
  isyeri: any;
  sube: { sskNo: number; ad?: string | null; sicilNo?: string | null };
  alanTanimlari: { kod: string; grup: string; etiket: string; tur: string }[];
  kisiler: any[];
}

/** Bir kişinin pusulasını PDF olarak üretir (Blob). */
/* -------------------------------------------------------------------------- */
/* Metin yardımcıları — Mikro çıktısı sabit genişlikli karakterlerle kurulur  */
/* -------------------------------------------------------------------------- */

/** Sola dayalı, genişliğe kırpılmış/doldurulmuş hücre */
const sol_ = (m: any, g: number) => {
  const t = String(m ?? "");
  return t.length > g ? t.slice(0, g) : t + " ".repeat(g - t.length);
};

/** Sağa dayalı hücre (rakamlar) */
const sag_ = (m: any, g: number) => {
  const t = String(m ?? "");
  return t.length > g ? t.slice(t.length - g) : " ".repeat(g - t.length) + t;
};

/** Ortalanmış hücre (başlıklar) */
const orta_ = (m: any, g: number) => {
  const t = String(m ?? "");
  if (t.length >= g) return t.slice(0, g);
  const bos = g - t.length;
  const sol = Math.floor(bos / 2);
  return " ".repeat(sol) + t + " ".repeat(bos - sol);
};

export const pusulaPdf = async (veri: PusulaVerisi, kisi: any): Promise<Blob> => {
  const fontlar = await fontlariGetir();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  pdf.addFileToVFS("Mono.ttf", fontlar.mono);
  pdf.addFont("Mono.ttf", "Mono", "normal");
  pdf.addFileToVFS("Mono-Bold.ttf", fontlar.monoKalin);
  pdf.addFont("Mono-Bold.ttf", "Mono", "bold");

  const a = kisi.alanlar ?? {};

  /* Mikro tutarları brütleştirme çarpanıyla basar: girilen tutar ×
     pt_*BNCarpan. Çarpan yoksa ya da 0 ise tutar olduğu gibidir. */
  const al = (k: string) => {
    const v = a[k];
    if (v === null || v === undefined) return v;
    const c = Number(
      a[`${k}Carpan`] ??
      a[k.replace(/Tutar$/, "") + "Carpan"] ??
      (/^kazanc\d+Tutar$/.test(k) ? a.kazancCarpan : 0) ??
      0
    );
    return c > 0 ? Number(v) * c : v;
  };

  /* ---------------------------------------------------------------------- */
  /* Sütun genişlikleri — Mikro'nun makbuzuyla birebir (toplam 133 karakter) */
  /* ---------------------------------------------------------------------- */
  const G = {
    kzAd: 14, kzGun: 9, kzTutar: 14,
    syAd: 14, syTutar: 14,
    ozAd: 14, ozTutar: 12,
    ysAd: 19, ysTutar: 13,
  };

  const satirlar: string[] = [];
  const kalinSatirlar = new Set<number>();
  const ekle = (m: string, kalin = false) => {
    if (kalin) kalinSatirlar.add(satirlar.length);
    satirlar.push(m);
  };

  const tam = "-".repeat(133);

  /* ----------------------------------------------------------- üst başlık */
  ekle(orta_("Ü C R E T  H E S A P  P U S U L A S I    - M A K B U Z -", 133), true);

  /* İşyeri bloğu: solda 74 karakter, sağda dönem / meslek kutuları */
  const i = veri.isyeri ?? {};
  const solGen = 73;
  const solSatirlar = [
    `|İş Yeri Ünvanı  : ${i.unvan ?? ""}`,
    `|`,
    `|İş Yeri Sicil No: ${veri.sube?.sicilNo ?? ""}`,
    `|İş Yeri Adresi  : ${i.adres1 ?? ""}`,
    `|                  ${i.adres2 ?? ""}`,
    `|                  ${i.adres3 ?? ""}`,
    `|                  Tel:${i.telefon ?? ""}     Fax:${i.faks ?? ""}`,
    `|Tic.Sic.No      : ${i.ticSicilNo ?? ""}`,
    `|WEB adresi      : ${i.web ?? ""}`,
  ].map((x) => sol_(x, solGen) + "|");

  const meslekGen = [17, 40];
  const sagSatirlar = [
    "                        " + "-".repeat(24),
    "                        |" + orta_("", 22) + "|",
    "                        |" + orta_(`Dönem:${AYLAR[veri.donem.ay - 1]}-${veri.donem.yil}`, 22) + "|",
    "                        |" + orta_("", 22) + "|",
    "                        " + "-".repeat(24),
    "",
    "-".repeat(meslekGen[0] + 2) + "|" + "-".repeat(meslekGen[1] + 2),
    "| " + sol_("Meslek Kodu", meslekGen[0]) + "| " + sol_("Meslek Adı", meslekGen[1]),
    "-".repeat(meslekGen[0] + 2) + "|" + "-".repeat(meslekGen[1] + 2),
    "|" + sol_(kisi.meslekKodu ?? "", meslekGen[0] + 1) + "|" + sol_(kisi.meslekAdi ?? "", meslekGen[1] + 1),
  ];

  ekle("-".repeat(solGen + 1) + "                        " + "-".repeat(24));
  for (let k = 0; k < Math.max(solSatirlar.length, sagSatirlar.length - 4); k++) {
    const sl = solSatirlar[k] ?? " ".repeat(solGen + 1);
    const sg = k >= 4 ? (sagSatirlar[k + 1] ?? "") : (sagSatirlar[k] ?? "");
    ekle(sol_(sl + sg, 133));
  }
  ekle(tam);

  /* ------------------------------------------------------- personel satırı */
  const pB = ["  KODU    ", "      Adı & Soyadı    ", "T.C. Kim.No", "Giriş Trh.", "Çıkış Trh.",
    " Görevi        ", "Üc.Tipi", "    Ücreti  ", " Döviz ", " SGK Sicil Nosu   "];
  const pG = [10, 22, 11, 10, 10, 15, 7, 12, 7, 18];
  const pD = [
    kisi.personelKodu ?? "", kisi.adSoyad ?? "", kisi.kimlikNo ?? "",
    tarih(kisi.girisTarihi), tarih(kisi.cikisTarihi),
    kisi.gorevAdi ?? kisi.meslekAdi ?? "", kisi.ucretTipi ?? "",
    kisi.ucret != null ? `${para(kisi.ucret)}TL` : "", kisi.doviz && kisi.doviz !== "TL" ? kisi.doviz : "",
    kisi.sgkSicilNo ?? "",
  ];

  ekle("|" + pB.map((b, k) => sol_(b, pG[k])).join("|") + "|", true);
  ekle("|" + pG.map((g) => "-".repeat(g)).join("|") + "|");
  ekle("|" + pD.map((d, k) => (k === 7 ? sag_(d, pG[k]) : sol_(d, pG[k]))).join("|") + "|");
  ekle(tam);
  ekle(tam);

  /* --------------------------------------------------- dört sütunlu gövde */
  const tanim = veri.alanTanimlari ?? [];
  const grup = (g: string) => tanim.filter((t: any) => t.grup === g);

  const satirlar3 = (g: string) => {
    const temeller: string[] = [];
    grup(g).forEach((t: any) => { if (!temeller.includes(t.temel)) temeller.push(t.temel); });
    return temeller.map((tm) => {
      const t = grup(g).filter((x: any) => x.temel === tm);
      const kod = (tur: string) => t.find((x: any) => x.tur === tur)?.kod;
      return {
        ad: t[0].etiket,
        gun: kod("gun") ? al(kod("gun")!) : null,
        saat: kod("saat") ? al(kod("saat")!) : null,
        tutar: kod("tutar") ? al(kod("tutar")!) : null,
      };
    });
  };

  const kazanc = satirlar3("kazanc");
  const ekKazanc = satirlar3("ekKazanc");
  const basit = (g: string) => grup(g).map((t: any) => ({ ad: t.etiket, tutar: al(t.kod), tur: t.tur }));
  const sosyal = basit("sosyal"), ozel = basit("ozelKesinti"), yasal = basit("yasal");
  const topla = (l: any[], k = "tutar") => l.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const kesintiYasal = ["sgkPrimi", "issizlikSigortasi", "gv", "dv", "otomatikBes"]
    .reduce((t, k) => t + (Number(al(k)) || 0), 0);

  const gvIst = Number(al("gvIstisnasi")) || 0;
  const dvIst = Number(al("dvIstisnasi")) || 0;
  const tKazanc = Number(al("toplamKazanc")) || topla(kazanc) + topla(ekKazanc) + topla(sosyal);
  const tKesinti = Number(al("toplamKesinti")) || kesintiYasal + topla(ozel);

  /* 1. sütun: kazanç · ek kazanç · toplamlar (Mikro sırasıyla) */
  const s1: string[] = [];
  const cizgiK = "-".repeat(G.kzAd) + "|" + "-".repeat(G.kzGun) + "|" + "-".repeat(G.kzTutar);
  kazanc.forEach((r) =>
    s1.push(sol_(r.ad, G.kzAd) + "|" + sag_(`${sayi(r.gun, 0)}/${sayi(r.saat)}`, G.kzGun) + "|" + sag_(para(r.tutar) + " ", G.kzTutar)));
  s1.push(cizgiK);
  s1.push(orta_("Toplam", G.kzAd) + "|" + sag_(`${sayi(topla(kazanc, "gun"), 0)}/${sayi(topla(kazanc, "saat"))}`, G.kzGun)
    + "|" + sag_(para(topla(kazanc)) + " ", G.kzTutar));
  s1.push("-".repeat(G.kzAd + G.kzGun + G.kzTutar + 2));
  s1.push(orta_("EK KAZANÇ", G.kzAd + G.kzGun + G.kzTutar + 2));
  s1.push("-".repeat(G.kzAd + G.kzGun + G.kzTutar + 2));
  s1.push(sol_("EKKAZANÇ ADI", G.kzAd) + "|" + orta_("SAAT", G.kzGun) + "|" + sol_("TUTAR", G.kzTutar));
  s1.push(cizgiK);
  ekKazanc.forEach((r) =>
    s1.push(sol_(r.ad, G.kzAd) + "|" + sag_(sayi(r.saat) + " ", G.kzGun) + "|" + sag_(para(r.tutar) + " ", G.kzTutar)));
  s1.push(cizgiK);
  s1.push(sol_("Toplam", G.kzAd) + "|" + sag_(sayi(topla(ekKazanc, "saat")) + " ", G.kzGun)
    + "|" + sag_(para(topla(ekKazanc)) + " ", G.kzTutar));
  s1.push(cizgiK);
  s1.push(sol_("Toplam", G.kzAd) + "|" + sag_(sayi(topla(kazanc, "saat") + topla(ekKazanc, "saat")) + " ", G.kzGun)
    + "|" + sag_(para(topla(kazanc) + topla(ekKazanc)) + " ", G.kzTutar));

  const s2: string[] = sosyal.map((r) => sol_(r.ad, G.syAd) + "|" + sag_(para(r.tutar) + " ", G.syTutar));
  s2.push("-".repeat(G.syAd) + "|" + "-".repeat(G.syTutar));
  s2.push(sol_("Toplam", G.syAd) + "|" + sag_(para(topla(sosyal)) + " ", G.syTutar));

  const s3: string[] = ozel.map((r) => sol_(r.ad, G.ozAd) + "|" + sag_(para(r.tutar) + " ", G.ozTutar));
  s3.push("-".repeat(G.ozAd) + "|" + "-".repeat(G.ozTutar));
  s3.push(sol_("Toplam", G.ozAd) + "|" + sag_(para(topla(ozel)) + " ", G.ozTutar));

  const s4: string[] = yasal.map((r) =>
    sol_(r.ad, G.ysAd) + "|" + sag_((r.tur === "gun" ? sayi(r.tutar, 0) : para(r.tutar)) + " ", G.ysTutar));
  s4.push(sol_("Net(İstisna öncesi", G.ysAd) + "|" + sag_(para(tKazanc - (tKesinti + gvIst) - dvIst) + " ", G.ysTutar));
  s4.push(sol_("Toplam(İstisna önc", G.ysAd) + "|" + sag_(para(tKesinti + gvIst) + " ", G.ysTutar));
  s4.push("-".repeat(G.ysAd) + "|" + "-".repeat(G.ysTutar));
  s4.push(sol_("Toplam", G.ysAd) + "|" + sag_(para(kesintiYasal) + " ", G.ysTutar));

  /* Grup ve alan başlıkları */
  const gKz = G.kzAd + G.kzGun + G.kzTutar + 2;
  const gSy = G.syAd + G.syTutar + 1;
  const gOz = G.ozAd + G.ozTutar + 1;
  const gYs = G.ysAd + G.ysTutar + 1;

  ekle("|" + orta_("KAZANÇ", gKz) + "|" + orta_("SOSYAL YARDIMI", gSy) + "|"
    + orta_("ÖZEL KESİNTİSİ", gOz) + "|" + orta_("YASAL KESİNTİSİ", gYs) + "|", true);
  ekle("|" + "-".repeat(gKz) + "|" + "-".repeat(gSy) + "|" + "-".repeat(gOz) + "|" + "-".repeat(gYs) + "|");
  ekle("|" + orta_("KAZANÇ ADI", G.kzAd) + "|" + orta_("GÜN/SAAT", G.kzGun) + "|" + orta_("TUTARI", G.kzTutar)
    + "|" + orta_("YARDIM ADI", G.syAd) + "|" + orta_("TUTARI", G.syTutar)
    + "|" + orta_("KESİNTİ ADI", G.ozAd) + "|" + orta_("TUTARI", G.ozTutar)
    + "|" + orta_("İNDİRİM ADI", G.ysAd) + "|" + orta_("TUTARI", G.ysTutar) + "|", true);
  ekle("|" + cizgiK + "|" + "-".repeat(G.syAd) + "|" + "-".repeat(G.syTutar) + "|"
    + "-".repeat(G.ozAd) + "|" + "-".repeat(G.ozTutar) + "|" + "-".repeat(G.ysAd) + "|" + "-".repeat(G.ysTutar) + "|");

  const enUzun = Math.max(s1.length, s2.length, s3.length, s4.length);
  for (let k = 0; k < enUzun; k++) {
    ekle("|" + sol_(s1[k] ?? "", gKz) + "|" + sol_(s2[k] ?? "", gSy) + "|"
      + sol_(s3[k] ?? "", gOz) + "|" + sol_(s4[k] ?? "", gYs) + "|");
  }
  ekle(tam);
  ekle(tam);

  /* --------------------------------------------------------- alt toplamlar */
  const tB = ["Toplam Kazanç   ", "T.Kes.(İstis.önc", " Toplam Kesinti ", " Yuvarlama Farkı", "  Net Ödenecek  "];
  const tG = 16;
  const tD = [para(tKazanc), para(tKesinti + gvIst), para(tKesinti), para(al("yuvarlamaFarki")),
    para(al("netOdenecek") ?? tKazanc - tKesinti)];
  const imzaGen = 133 - (tG + 1) * 5 - 1;

  ekle("|" + tB.map((b) => sol_(b, tG)).join("|") + "|" + " ".repeat(imzaGen) + "|");
  ekle("|" + tB.map(() => "-".repeat(tG)).join("|") + "|"
    + orta_(" ÜCRETİN ALINDIĞINA DAİR SİGORTALININ İMZASI ", imzaGen) + "|", true);
  ekle("|" + tD.map((d) => sag_(d + " ", tG)).join("|") + "|" + "-".repeat(imzaGen) + "|");
  ekle("-".repeat((tG + 1) * 5 + 1) + "|" + " ".repeat(imzaGen) + "|");
  for (let k = 0; k < 3; k++) ekle(" ".repeat((tG + 1) * 5 + 1) + "|" + " ".repeat(imzaGen) + "|");
  ekle(" ".repeat((tG + 1) * 5 + 1) + " " + "-".repeat(imzaGen));

  /* ------------------------------------------------------------- basılıyor */
  const puntolar = 6.4;
  const satirYuk = 2.75;
  let y = 12;

  satirlar.forEach((m, k) => {
    pdf.setFont("Mono", kalinSatirlar.has(k) ? "bold" : "normal");
    pdf.setFontSize(puntolar);
    pdf.setTextColor(20, 20, 20);
    pdf.text(m, 8, y);
    y += satirYuk;
  });

  pdf.setFont("Mono", "normal");
  pdf.setFontSize(5.4);
  pdf.setTextColor(150, 150, 150);
  pdf.text(`${new Date().toLocaleString("tr-TR")} · Biçen Kariyer`, 8, 290);

  return pdf.output("blob");
};

const dosyaAdiTemizle = (m: string) =>
  (m ?? "").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();

/**
 * Seçili şubelerin pusulalarını zip'ler: {yıl}-{ay}/{SGK no - şube}/{ad (kod)}.pdf
 */
export const pusulaZipIndir = async (
  paketler: PusulaVerisi[],
  ilerleme?: (yapilan: number, toplam: number, ad: string) => void
) => {
  const zip = new JSZip();
  const toplam = paketler.reduce((t, p) => t + p.kisiler.length, 0);
  let yapilan = 0;

  for (const p of paketler) {
    const donem = `${p.donem.yil}-${String(p.donem.ay).padStart(2, "0")}`;
    const subeAdi = dosyaAdiTemizle(
      `${String(p.sube.sskNo).padStart(3, "0")}${p.sube.ad ? " - " + p.sube.ad : ""}`
    );
    const klasor = zip.folder(donem)!.folder(subeAdi)!;

    for (const k of p.kisiler) {
      ilerleme?.(yapilan, toplam, k.adSoyad);
      const blob = await pusulaPdf(p, k);
      klasor.file(`${dosyaAdiTemizle(k.adSoyad)} (${dosyaAdiTemizle(k.personelKodu)}).pdf`, blob);
      yapilan++;
    }
  }

  ilerleme?.(toplam, toplam, "");
  const govde = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const ilk = paketler[0]?.donem;
  dosyaIndir(govde, `ucret-pusulasi-${ilk ? `${ilk.yil}-${String(ilk.ay).padStart(2, "0")}` : "donem"}.zip`);
};
