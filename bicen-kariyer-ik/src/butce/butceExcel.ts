/**
 * B_T_E Excel'ini (xlsm / xlsx) tarayıcıda okur (30.10.2026).
 *
 * Sunucuda Excel kütüphanesi yok; dosya tarayıcıda SheetJS ile açılır,
 * yalnız hesaplanmış hücre DEĞERLERİ okunur (makro çalıştırılmaz), kişi
 * listesi ve parametreler JSON olarak sunucuya gönderilir.
 *
 * Okunanlar:
 *  - "… BÜTÇE" sayfası: A şube, B bölüm, C sicil, D ad, E gün (30/15),
 *    G normal/emekli, H bayrak, I meslek, J GRM önceki, K GRM, M bordro net;
 *    kişi başı yan gider sütunları (ilk 30 günlük satırdan), tek seferlik
 *    sütunlar (GT gün sayısı başlıktan).
 *  - "HESAP VE TANIM": asgari ücret, tavan katsayısı, vergi dilimleri, oranlar.
 *  - "GECE ÇALIŞMASI AYRINTI": rol maaşları ve şube kadro/norm tablosu.
 */
import * as XLSX from "xlsx";
import type { GeceRol, GeceSube, KisiGirdi, Parametre, TekSeferlik, YanGider } from "./butceOrtak";

export interface Uyari { satir?: number; ad?: string; metin: string; tur: "hata" | "uyari" }

export interface OkumaSonucu {
  kisiler: KisiGirdi[];
  parametre: Parametre;
  uyarilar: Uyari[];
  sayfa: string;
  bulunan: { yanGider: string[]; tekSeferlik: string[]; parametre: boolean; gece: boolean };
}

const buyuk = (s: unknown) => String(s ?? "").toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
const sayi = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Başlık → yan gider kodu eşlemesi (anahtar kelimeler; yıl sayısı silinir) */
const YAN_GIDER_ESLEME: { kod: string; ad: string; anahtar: string[]; gunOranli?: boolean }[] = [
  { kod: "yemek", ad: "Yemek", anahtar: ["YEMEK"], gunOranli: true },
  { kod: "yolSgk", ad: "Yol SGK payı", anahtar: ["YOL SGK"] },
  { kod: "yol", ad: "Yol", anahtar: ["YOL"] },
  { kod: "maasCek", ad: "Maaş çeki", anahtar: ["MAAŞ ÇEK"], gunOranli: true },
  { kod: "trendyolCek", ad: "Trendyol çeki", anahtar: ["TRENDYOL"] },
  { kod: "primCek", ad: "Prim çeki", anahtar: ["PRİM ÇEK", "PRIM ÇEK"] },
  { kod: "sgkDanismanlik", ad: "SGK danışmanlık", anahtar: ["DANIŞMANLIK"] },
  { kod: "kasaTazminati", ad: "Kasa tazminatı", anahtar: ["KASA TAZM"] },
  { kod: "tesvikIottech", ad: "Teşvik (IOTTECH)", anahtar: ["TEŞVİK", "IOTTECH"] },
  { kod: "isg", ad: "İSG", anahtar: ["İSG"] },
  { kod: "kiyafet", ad: "Kıyafet", anahtar: ["KIYAFET"] },
  { kod: "ihbar", ad: "İhbar tazminatı", anahtar: ["İHBAR"] },
  { kod: "isciAlacagi", ad: "İşçi alacağı", anahtar: ["İŞÇİ ALACAĞI"] },
  { kod: "terfiFark", ad: "Terfi / atama fark ücreti", anahtar: ["TERFİ"] },
  { kod: "hediye", ad: "Hediye (düğün, cenaze, doğum)", anahtar: ["HEDİYE"] },
  { kod: "satisGmy", ad: "Satış GMY bütçesi", anahtar: ["SATIŞ GMY"] },
  { kod: "fazlaMesai", ad: "Fazla mesai", anahtar: ["FM", "FAZLA MESAİ"] },
  { kod: "kazanKazan", ad: "Kazan-Kazan", anahtar: ["KAZAN"] },
  { kod: "egitim", ad: "Eğitim", anahtar: ["EĞİTİM"] },
];

const AY_ADLARI = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];

const ayBul = (baslik: string): number => {
  const i = AY_ADLARI.findIndex((a) => baslik.includes(a));
  return i < 0 ? 0 : i + 1;
};

/** Yıl sayılarını ve fazlalıkları at: "2026 YOL SGK" → "YOL SGK" */
const baslikTemizle = (s: string) => buyuk(s).replace(/\b20\d\d\b/g, "").replace(/\s+/g, " ").trim();

/** Anahtar kelime tam sözcük olarak geçiyor mu ("TRENDYOL" içindeki "YOL" sayılmaz) */
const sozcukVar = (b: string, k: string) => {
  const temiz = ` ${b.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim()} `;
  return temiz.includes(` ${k} `);
};

const yanGiderKodu = (baslik: string): (typeof YAN_GIDER_ESLEME)[number] | null => {
  const b = baslikTemizle(baslik);
  if (!b || /TOPLAM/.test(b) || /GT\b/.test(b) || /ÇEKİ$/.test(b) || /GECE/.test(b)) return null;
  for (const e of YAN_GIDER_ESLEME) if (e.anahtar.some((k) => sozcukVar(b, k))) return e;
  return null;
};

export function butceExcelOku(veri: ArrayBuffer, varsayilan: Parametre): OkumaSonucu {
  const kitap = XLSX.read(veri, { type: "array", cellFormula: false, cellNF: false, cellText: false });
  const uyarilar: Uyari[] = [];
  const parametre: Parametre = JSON.parse(JSON.stringify(varsayilan));
  const bulunan = { yanGider: [] as string[], tekSeferlik: [] as string[], parametre: false, gece: false };

  const sayfaAdi = kitap.SheetNames.find((s) => buyuk(s).includes("BÜTÇE")) ?? kitap.SheetNames[0];
  const ws = kitap.Sheets[sayfaAdi];
  if (!ws) throw new Error("Bütçe sayfası bulunamadı.");
  const satirlar: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (satirlar.length < 2) throw new Error("Bütçe sayfası boş.");
  const basliklar = (satirlar[0] as unknown[]).map((h) => String(h ?? ""));

  /* ---------------------------------------------------------- kişiler */
  const kisiler: KisiGirdi[] = [];
  /* kisiler[i] ↔ kisiSatirlari[i]: yan gider sütunlarını kişi bazında okumak için */
  const kisiSatirlari: unknown[][] = [];
  const gorulenSicil = new Map<string, number>();
  let bosKadroSayisi = 0;

  let ilkTamSatir: unknown[] | null = null;

  satirlar.slice(1).forEach((r, i) => {
    const satirNo = i + 2;
    const sube = String(r[0] ?? "").trim();
    const ad = String(r[3] ?? "").trim();
    if (!sube && !ad) return;
    if (buyuk(sube).includes("TOPLAM") || buyuk(ad).includes("TOPLAM")) return;

    const refVar = r.some((v) => typeof v === "string" && v.startsWith("#"));
    if (refVar) uyarilar.push({ satir: satirNo, ad, metin: "Satırda hatalı hücre (#REF! vb.) var; değerler kontrol edilmeli.", tur: "uyari" });

    const gunHam = sayi(r[4]);
    const gun = gunHam === 15 ? 15 : gunHam === 30 || gunHam === null ? 30 : Math.max(1, Math.min(30, Math.round(gunHam)));
    if (gunHam !== null && gunHam !== 15 && gunHam !== 30)
      uyarilar.push({ satir: satirNo, ad, metin: `Gün ${gunHam}: 30 (tam) ya da 15 (part-time) bekleniyordu.`, tur: "uyari" });

    const sgkMetin = buyuk(r[6]);
    const bayrak = sayi(r[7]);
    const emekliMetin = sgkMetin.includes("EMEKL");
    const emekli = emekliMetin || bayrak === 0;
    if (emekliMetin !== (bayrak === 0) && bayrak !== null)
      uyarilar.push({ satir: satirNo, ad, metin: `Emekli bilgisi çelişkili (G: "${sgkMetin || "boş"}", H: ${bayrak}); emekli sayıldı.`, tur: "uyari" });

    const grmOnceki = sayi(r[9]) ?? 0;
    const grm = sayi(r[10]) ?? 0;
    const bordroNet = sayi(r[12]) ?? 0;
    let sicil = String(r[2] ?? "").replace(/\D/g, "");
    /* 11111111111 gibi yer tutucu sicil: planlanan boş kadro */
    const yerTutucu = /^(\d)\1{5,}$/.test(sicil);
    if (yerTutucu) sicil = "";

    /* Adsız ama ücretli satır: Excel'de planlanan boş kadro (işe alınacak) */
    const meslekAdi = String(r[8] ?? "").trim();
    const bosKadro = !ad && bordroNet > 0;
    if (bosKadro) bosKadroSayisi++;
    const adSon = bosKadro ? `Boş kadro · ${meslekAdi || "pozisyon"}` : ad;
    if (!ad && !bosKadro) uyarilar.push({ satir: satirNo, metin: "Ad soyad boş.", tur: "hata" });
    if (!sube) uyarilar.push({ satir: satirNo, ad, metin: "Şube boş.", tur: "hata" });
    if (!bordroNet) uyarilar.push({ satir: satirNo, ad, metin: "Bordro neti (M) boş ya da 0.", tur: "hata" });
    if (!grm) uyarilar.push({ satir: satirNo, ad, metin: "GRM (K) boş ya da 0.", tur: "uyari" });
    if (grm && bordroNet && grm < bordroNet * (gun / 30))
      uyarilar.push({ satir: satirNo, ad, metin: `GRM (${grm.toLocaleString("tr-TR")}) bordro netinden (${bordroNet.toLocaleString("tr-TR")}) düşük: GR farkı eksi çıkar.`, tur: "uyari" });
    if (grmOnceki && grm && grm < grmOnceki)
      uyarilar.push({ satir: satirNo, ad, metin: `Zam oranı eksi (${grmOnceki.toLocaleString("tr-TR")} → ${grm.toLocaleString("tr-TR")}).`, tur: "uyari" });
    if (sicil && sicil.length !== 11) uyarilar.push({ satir: satirNo, ad, metin: `Sicil / TC ${sicil.length} haneli.`, tur: "uyari" });
    if (sicil && !bosKadro) {
      const onceki = gorulenSicil.get(sicil);
      if (onceki) uyarilar.push({ satir: satirNo, ad, metin: `Aynı sicil ${onceki}. satırda da var.`, tur: "uyari" });
      else gorulenSicil.set(sicil, satirNo);
    }

    kisiler.push({
      sube, bolum: String(r[1] ?? "").trim() || null, sicil: sicil || null, ad: adSon, gun, emekli, meslek: meslekAdi || null,
      grmOnceki, grm, bordroNet, aktif: true, notu: bosKadro ? "Excel'de adsız satır: planlanan boş kadro" : null,
    });
    kisiSatirlari.push(r);
    if (!ilkTamSatir && gun === 30 && bordroNet > 0 && !refVar) ilkTamSatir = r;
  });

  if (kisiler.length === 0) throw new Error("Bütçe sayfasında kişi satırı bulunamadı.");
  if (bosKadroSayisi > 0) uyarilar.push({ metin: `${bosKadroSayisi} adsız satır "Boş kadro · meslek" adıyla alındı (planlanan kadro; ücretleri hesaba girer).`, tur: "uyari" });

  /* ----------------------------------------------- yan giderler (kişi başı) */
  const ornek = ilkTamSatir ?? satirlar[1];
  const yanGiderler: YanGider[] = [];
  const ozelKalemler: string[] = [];
  const tekSeferlikler: TekSeferlik[] = [];
  let gtGunluk: number | null = null;
  const gorulenKod = new Set<string>();

  basliklar.forEach((h, j) => {
    const b = baslikTemizle(h);
    if (!b || j < 13) return;
    const deger = sayi(ornek[j]);

    /* Resmi tatil: "MART GT 3,5 GÜN" → ay, gün sayısı; tutar / gün = günlük */
    const gt = /GT\s*([\d,.]+)\s*GÜN/.exec(b) ?? /^[^\d]+\s([\d,.]+)\s*GÜN$/.exec(b);
    if (gt) {
      const ay = ayBul(b);
      const gun = sayi(gt[gt.length - 1]) ?? 1;
      if (ay && deger) {
        if (gtGunluk === null && gun > 0) gtGunluk = deger / gun;
        tekSeferlikler.push({ kod: `gt${ay}`, ad: `Resmi tatil çalışması (${AY_ADLARI[ay - 1].toLocaleLowerCase("tr-TR")}, ${gun} gün)`, ay, ayTuru: "bordro", tutar: 0, gun });
        bulunan.tekSeferlik.push(h);
      }
      return;
    }
    if (b.includes("ÇEKİ") && !b.includes("MAAŞ") && !b.includes("TRENDYOL") && !b.includes("PRİM")) {
      const ay = ayBul(b);
      if (ay && deger) {
        tekSeferlikler.push({ kod: b.includes("RAMAZAN") ? "ramazanCeki" : b.includes("BAYRAM") ? "bayramCeki" : `cek${ay}`, ad: b.includes("RAMAZAN") ? "Ramazan çeki" : b.includes("BAYRAM") ? "Bayram çeki" : `Çek (${AY_ADLARI[ay - 1]})`, ay, ayTuru: "odeme", tutar: deger });
        bulunan.tekSeferlik.push(h);
      }
      return;
    }
    if (b.includes("GECE")) {
      const ay = ayBul(b);
      if (ay) {
        /* Eylül yarım: örnek satırda ağustosun yarısı ise 0,5 */
        tekSeferlikler.push({ kod: `gece${ay}`, ad: `Gece çalışması (${AY_ADLARI[ay - 1].toLocaleLowerCase("tr-TR")})`, ay, ayTuru: "bordro", tutar: 1, gece: true });
        bulunan.tekSeferlik.push(h);
      }
      return;
    }
    if (b.includes("KIYAFET") && ayBul(b)) {
      const ay = ayBul(b);
      if (deger) {
        tekSeferlikler.push({ kod: `kiyafet${ay}`, ad: `Kıyafet (${AY_ADLARI[ay - 1].toLocaleLowerCase("tr-TR")})`, ay, ayTuru: "odeme", tutar: deger });
        bulunan.tekSeferlik.push(h);
      }
      return;
    }

    const e = yanGiderKodu(h);
    if (!e || gorulenKod.has(e.kod)) return;
    /* Önceki yılın sütunu ("2025 YOL") değil, bu yılınki: aynı kodda iki sütun varsa yıl büyük olan */
    const yillar = basliklar.map((x, k) => ({ k, y: /\b(20\d\d)\b/.exec(buyuk(x))?.[1], e: yanGiderKodu(x)?.kod })).filter((x) => x.e === e.kod);
    const secili = yillar.length > 1 ? yillar.reduce((a, c) => ((c.y ?? "") > (a.y ?? "") ? c : a)) : { k: j };
    if (secili.k !== j) return;

    /* Varsayılan = tam zamanlı satırlarda en sık görülen değer; ondan sapan satırlar kişiye özel tutar olur
       (yol, kasa tazminatı, İSG kişi bazında farklı). Yol SGK payı türetilir, okunmaz. */
    /* Boş hücre = 0 (o kişiye bu kalem ödenmiyor) */
    const degerler = kisiSatirlari.map((r) => sayi(r[secili.k]) ?? 0);
    const sayac = new Map<number, number>();
    kisiSatirlari.forEach((r, i) => { const v = degerler[i]; if ((sayi(r[4]) ?? 30) >= 30) sayac.set(v, (sayac.get(v) ?? 0) + 1); });
    let varsayilan: number | null = null, enCok = -1;
    sayac.forEach((n, v) => { if (n > enCok) { enCok = n; varsayilan = v; } });
    if (varsayilan === null) return;
    gorulenKod.add(e.kod);
    const vs = Math.round((varsayilan as number) * 100) / 100;
    yanGiderler.push({ kod: e.kod, ad: e.ad, tutar: vs, gunOranli: e.gunOranli, aciklama: `Excel: ${basliklar[secili.k]}` });
    bulunan.yanGider.push(basliklar[secili.k]);
    if (e.kod === "yolSgk") return;
    let ozelSayisi = 0;
    kisiSatirlari.forEach((r, i) => {
      const v = degerler[i];
      const beklenen = e.gunOranli ? vs * ((sayi(r[4]) ?? 30) / 30) : vs;
      if (Math.abs(v - beklenen) > 0.05) {
        kisiler[i].yanGiderler = { ...(kisiler[i].yanGiderler ?? {}), [e.kod]: Math.round(v * 100) / 100 };
        ozelSayisi++;
      }
    });
    if (ozelSayisi > 0) ozelKalemler.push(`${e.ad}: ${ozelSayisi} kişi`);
  });
  if (ozelKalemler.length) uyarilar.push({ metin: `Kişi bazında farklı tutarlar kişiye özel kalem olarak alındı — ${ozelKalemler.join(", ")}.`, tur: "uyari" });

  /* Gece: Eylül yarım (örnek satırda ağustos / eylül oranı) */
  const geceAgu = basliklar.findIndex((h) => buyuk(h).includes("GECE") && buyuk(h).includes("AĞUSTOS"));
  const geceEyl = basliklar.findIndex((h) => buyuk(h).includes("GECE") && buyuk(h).includes("EYLÜL"));
  if (geceAgu >= 0 && geceEyl >= 0) {
    const a = sayi(ornek[geceAgu]); const e = sayi(ornek[geceEyl]);
    const t = tekSeferlikler.find((x) => x.kod === "gece9");
    if (t && a && e !== null) t.tutar = Math.round((e / a) * 100) / 100;
  }

  if (yanGiderler.length > 0) {
    const yol = yanGiderler.find((y) => y.kod === "yol");
    if (yol) yol.aciklama = "Kişinin kendi yol tutarı; boşsa bu varsayılan";
    const yolSgk = yanGiderler.find((y) => y.kod === "yolSgk");
    if (yolSgk) { yolSgk.tutar = 0; yolSgk.aciklama = "Kişinin yolu × yol SGK oranı (kendiliğinden)"; }
    const kazan = yanGiderler.find((y) => y.kod === "kazanKazan");
    if (kazan) kazan.aciklama = "Excel'de toplamdan çıkarılıyordu; burada maliyet olarak eklenir";
    parametre.yanGiderler = yanGiderler;
  } else uyarilar.push({ metin: "Yan gider sütunları bulunamadı; varsayılan değerler kullanıldı.", tur: "uyari" });
  if (tekSeferlikler.length > 0) parametre.tekSeferlikler = tekSeferlikler;
  if (gtGunluk) parametre.gtGunluk = Math.round(gtGunluk * 10000) / 10000;

  /* ------------------------------------------------------- HESAP VE TANIM */
  const hesapAdi = kitap.SheetNames.find((s) => buyuk(s).includes("HESAP"));
  if (hesapAdi) {
    const hs = kitap.Sheets[hesapAdi];
    const h = (adres: string) => sayi(hs[adres]?.v);
    const asgari = h("I21"); const katsayi = h("I23");
    if (asgari) parametre.asgariUcretBrut = asgari;
    if (katsayi) parametre.tavanKatsayisi = katsayi;
    const dilimler = [] as { ustSinir: number | null; oran: number }[];
    for (let r = 22; r <= 30; r++) {
      const oran = h(`A${r}`); if (oran === null) break;
      const ust = h(`C${r}`);
      dilimler.push({ ustSinir: ust ?? null, oran });
    }
    if (dilimler.length >= 2 && dilimler[dilimler.length - 1].ustSinir === null) parametre.vergiDilimleri = dilimler;
    const oranlar: (keyof Parametre)[] = ["sgkIsci", "issizlikIsci", "damgaVergisi", "sgkIsveren", "isverenIndirim", "issizlikIsveren"];
    oranlar.forEach((k, i) => { const v = h(`H${28 + i}`); if (v !== null) (parametre as unknown as Record<string, unknown>)[k] = v; });
    const sgdp = h("I28"); if (sgdp) parametre.sgdpIsci = sgdp;
    bulunan.parametre = true;
  } else uyarilar.push({ metin: "'HESAP VE TANIM' sayfası yok; oranlar varsayılan alındı.", tur: "uyari" });

  /* ------------------------------------------------- GECE ÇALIŞMASI AYRINTI */
  const geceAdi = kitap.SheetNames.find((s) => buyuk(s).includes("GECE"));
  if (geceAdi) {
    const gs: unknown[][] = XLSX.utils.sheet_to_json(kitap.Sheets[geceAdi], { header: 1, raw: true, defval: null, blankrows: false });
    const roller: GeceRol[] = [];
    const besKisi = new Set<string>(); const dortKisi = new Set<string>();
    let blok = 5;
    gs.forEach((r) => {
      const a = buyuk(r[0]);
      if (a.includes("4 KİŞİ")) blok = 4; else if (a.includes("5 KİŞİ")) blok = 5;
      const maas = sayi(r[1]);
      if (a && maas && !a.includes("GECE")) {
        (blok === 5 ? besKisi : dortKisi).add(a);
        if (!roller.some((x) => buyuk(x.ad) === a)) roller.push({ ad: a.charAt(0) + a.slice(1).toLocaleLowerCase("tr-TR"), maas, dortKisideVar: true });
      }
    });
    roller.forEach((x) => { x.dortKisideVar = dortKisi.size === 0 ? true : dortKisi.has(buyuk(x.ad)); });
    const subeler: GeceSube[] = [];
    gs.forEach((r) => {
      const sube = String(r[5] ?? "").trim(); const kisi = sayi(r[4]); const norm = sayi(r[6]);
      if (sube && kisi && norm && buyuk(sube) !== "ŞUBE") subeler.push({ sube, kisi: Math.round(kisi), norm: Math.round(norm) });
    });
    if (roller.length > 0) parametre.geceRoller = roller;
    if (subeler.length > 0) { parametre.geceSubeler = subeler; bulunan.gece = true; }

    /* Bütçe sayfasında gece tutarı yazılı ama şube tablosunda olmayan şubeler */
    const geceSutun = basliklar.findIndex((h) => buyuk(h).includes("GECE"));
    if (geceSutun >= 0 && subeler.length > 0) {
      const tabloda = new Set(subeler.map((s) => buyuk(s.sube)));
      const eksik = new Set<string>();
      satirlar.slice(1).forEach((r) => { const s = String(r[0] ?? "").trim(); const v = sayi(r[geceSutun]); if (s && v && !tabloda.has(buyuk(s))) eksik.add(s); });
      if (eksik.size) uyarilar.push({ metin: `Excel'de gece çalışması tutarı olan ama gece şube tablosunda bulunmayan şubeler: ${[...eksik].join(", ")}. Parametreler › Gece çalışması'ndan ekleyin.`, tur: "uyari" });
    }
  }

  return { kisiler, parametre, uyarilar, sayfa: sayfaAdi, bulunan };
}
