/**
 * Envanter sayfasının ortak tipleri ve yardımcıları.
 *
 * Tutarlar KDV dahil. Şube kullanıcısında sunucu tutar alanlarını boş
 * (null) gönderiyor; ekran bu durumda maliyet sekmelerini hiç çizmiyor.
 */

import { useEffect, useState } from "react";

import { API_TABAN, oturumOku } from "../../api";

/* -------------------------------------------------------------------------- */

export interface Cihaz {
  id: number;
  subeKodu: string;
  tur: string | null;
  marka: string | null;
  model: string | null;
  seriNo: string | null;
  sicilNo: string | null;
  sahibi: string | null;
  konum: string | null;
  departmanId: number | null;
  departman: string | null;
  ustCihazId: number | null;
  ustCihaz: string | null;
  tedarikci: string | null;
  alisTarihi: string | null;
  garantiVar: boolean;
  garantiBaslangic: string | null;
  garantiAy: number | null;
  garantiBitis: string | null;
  garantiSaglayici: string | null;
  garantiNotu: string | null;
  sonBakim: string | null;
  sonrakiBakim: string | null;
  /** gün */
  bakimAraligi: number | null;
  bakimFirmasi: string | null;
  bakimNotu: string | null;
  etiketler: string | null;
  notlar: string | null;
  durum: string;
  olusturma?: string;
  alisBedeli: number | null;
  /** ay */
  ekonomikOmur: number | null;
  kapakKirp: boolean;

  /* yalnızca listede */
  acikAriza?: number;
  arizaSayisi?: number;
  kapakId?: number | null;
  gorselSayisi?: number;
  belgeSayisi?: number;
  tamirSayisi?: number;
  tamirToplam?: number | null;
  buYilTamir?: number | null;
  gunDisi?: number;
  siradakiAktivite?: string | null;
  /** Bitmemiş son tamirin aşaması ve firması (09.10.2026) */
  tamirAsama?: "merkezde" | "firmada" | null;
  tamirFirma?: string | null;
}

export interface Erisim {
  maliyet: boolean;
  /** Rolde envanter yalnızca "görür" ise false (13.10.2026) */
  duzenler?: boolean;
  /** Kendi departmanının kategorilerini düzenleyebilir (13.10.2026) */
  kategoriYonetir?: boolean;
  tumu: boolean;
  sube: string | null;
  departmanlar: number[];
  departmanAdlari: string[];
}

export interface Kalem {
  ad: string;
  tip: "parca" | "iscilik" | "diger";
  adet: number;
  birim: number | null;
}

export interface Tamir {
  id: number;
  tarih: string;
  tur: string;
  arizaId: number | null;
  arizaBaslik: string | null;
  firma: string | null;
  yapan: string;
  gunDisi: number;
  kalemler: Kalem[];
  kdv: number;
  garantide: boolean;
  faturaNo: string | null;
  aciklama: string | null;
  araToplam: number | null;
  toplam: number | null;
  olusturanAdi: string | null;
  belgeSayisi: number;
  /** merkezde · firmada · tamamlandi (09.10.2026) */
  asama?: string;
  asamaTarih?: string | null;
}

export interface ServisFormu {
  id: number;
  formNo: string;
  olusturma: string;
  mudahale: string;
  yapilanIslem: string | null;
  teknisyen: string | null;
  servisFirma: string | null;
  parcaTutari: number | null;
  iscilik: number | null;
  toplam: number | null;
  olusturanAdi: string | null;
  arizaId: number | null;
  arizaBaslik: string | null;
}

export interface Ariza {
  id: number;
  baslik: string;
  durum: string;
  oncelik: string;
  olusturma: string;
  tur: string | null;
  formNo: string | null;
  servisToplam: number | null;
}

export interface Hareket {
  id: number;
  tur: "log" | "not";
  metin: string;
  yapanAdi: string | null;
  tarih: string;
}

export interface Konum {
  id: number;
  subeKodu: string;
  konum: string | null;
  notu: string | null;
  yapanAdi: string | null;
  tarih: string;
}

export interface Aktivite {
  id: number;
  tur: "bakim" | "ara" | "yap";
  tarih: string;
  ozet: string;
  atanan: string | null;
  olusturan: string | null;
}

export interface Belge {
  id: number;
  tur: string;
  ozgunAd: string | null;
  boyut: number;
  tamirId: number | null;
  yukleyen: string | null;
  olusturma: string;
}

export interface Gorsel {
  id: number;
  ozgunAd: string | null;
  boyut: number;
  kapak: boolean;
}

export interface Ayrinti {
  cihaz: Cihaz;
  arizalar: Ariza[];
  gorseller: Gorsel[];
  tamirler: Tamir[];
  servisFormlari: ServisFormu[];
  hareketler: Hareket[];
  konumlar: Konum[];
  aktiviteler: Aktivite[];
  belgeler: Belge[];
  erisim: Erisim;
}

export interface Secenekler {
  turler: string[];
  kategoriTurleri: string[];
  departmanlar: { id: number; ad: string }[];
  subeler: string[];
  firmalar: string[];
  erisim: Erisim;
}

/* -------------------------------------------------------------------------- */

export const DURUM: [string, string, string][] = [
  ["aktif", "Çalışıyor", "var(--iyi)"],
  ["bakimda", "Bakımda", "var(--bilgi)"],
  ["arizali", "Arızalı", "var(--kotu)"],
  ["pasif", "Kullanım dışı", "var(--soluk)"],
];
export const DURUM_AD: Record<string, string> = Object.fromEntries(DURUM.map(([k, a]) => [k, a]));
export const DURUM_RENK: Record<string, string> = Object.fromEntries(DURUM.map(([k, , r]) => [k, r]));

export const TAMIR_TUR: [string, string, string][] = [
  ["tamir", "Arıza onarımı", "var(--kotu)"],
  ["bakim", "Periyodik bakım", "var(--bilgi)"],
  ["parca", "Parça değişimi", "var(--uyari)"],
  ["kalibrasyon", "Kalibrasyon / muayene", "var(--mor)"],
];
export const TT_AD: Record<string, string> = Object.fromEntries(TAMIR_TUR.map(([k, a]) => [k, a]));
export const TT_RENK: Record<string, string> = Object.fromEntries(TAMIR_TUR.map(([k, , r]) => [k, r]));

export const ARIZA_DURUM: Record<string, string> = {
  acik: "Açık", devam: "Devam ediyor", beklemede: "Beklemede", cozuldu: "Çözüldü", kapandi: "Kapandı",
};

export const BELGE_TURLERI = ["Fatura", "Garanti belgesi", "Servis formu", "Muayene belgesi", "Sözleşme", "Kullanım kılavuzu", "Fotoğraf", "Diğer"];

/** Tamirin nerede olduğu (09.10.2026) */
export const TAMIR_ASAMA: [string, string, string, string][] = [
  ["merkezde", "Merkezde bekliyor", "🏢", "Cihaz merkezde, servise ya da firmaya gönderilmeyi bekliyor."],
  ["firmada", "Firmaya gönderildi", "🚚", "Cihaz tamir için firmada; dönünce kaydı \"Tamamlandı\" yapın."],
  ["tamamlandi", "Tamamlandı", "✅", "İş bitti; tutar ve fatura bilgisi girilebilir."],
];
export const ASAMA_AD: Record<string, string> = Object.fromEntries(TAMIR_ASAMA.map(([k, a]) => [k, a]));
export const ASAMA_IKON: Record<string, string> = Object.fromEntries(TAMIR_ASAMA.map(([k, , i]) => [k, i]));

/** Belge resim mi (uzantıdan) */
export const resimMi = (ad: string | null | undefined) => /\.(jpe?g|png|webp)$/i.test(ad ?? "");

/**
 * Belge görsellerini oturum başlığıyla indirip küçük resim adresi verir
 * (belge adresinde jeton yok, img etiketi başlık gönderemiyor).
 */
export const useBelgeResimleri = (idler: number[]) => {
  const [adresler, setAdresler] = useState<Record<number, string>>({});
  const anahtar = idler.join(",");

  useEffect(() => {
    let iptal = false;
    const olusan: string[] = [];
    const oturum = oturumOku();

    (async () => {
      for (const id of idler) {
        try {
          const y = await fetch(`${API_TABAN}/api/Envanter/Belge/${id}`, {
            headers: oturum ? { Authorization: `Bearer ${oturum.jeton}` } : {},
          });
          if (!y.ok || iptal) continue;
          const adres = URL.createObjectURL(await y.blob());
          olusan.push(adres);
          if (!iptal) setAdresler((m) => ({ ...m, [id]: adres }));
        } catch {
          /* küçük resim çıkmazsa dosya adı görünür */
        }
      }
    })();

    return () => {
      iptal = true;
      olusan.forEach((a) => URL.revokeObjectURL(a));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anahtar]);

  return adresler;
};

/* -------------------------------------------------------------------------- */

const TL = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
export const tl = (n: number | null | undefined) => `₺${TL.format(Math.round(n || 0))}`;

const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const AY_TAM = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const AY_KISA = AY;

/** "2026-10-08T00:00:00" → "2026-10-08" */
export const gunMetni = (t: string | null | undefined) => (t ? t.slice(0, 10) : "");

const yerel = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const BUGUN = () => yerel(new Date());

export const gunEkle = (t: string, n: number) => {
  const d = new Date(`${t}T00:00:00`);
  d.setDate(d.getDate() + n);
  return yerel(d);
};

export const tarih = (t: string | null | undefined) => {
  const g = gunMetni(t);
  if (!g) return "—";
  const [y, m, d] = g.split("-");
  return `${d}.${m}.${y}`;
};

export const kisa = (t: string | null | undefined) => {
  const g = gunMetni(t);
  if (!g) return "";
  const d = new Date(`${g}T00:00:00`);
  return `${d.getDate()} ${AY[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
};

export const zaman = (t: string) => {
  const ms = new Date(t).getTime();
  const dk = Math.floor((Date.now() - ms) / 60000);
  if (dk < 1) return "şimdi";
  if (dk < 60) return `${dk} dk önce`;
  if (dk < 1440) return `${Math.floor(dk / 60)} sa önce`;
  return kisa(t);
};

export const gunFark = (t: string | null | undefined) => {
  const g = gunMetni(t);
  if (!g) return NaN;
  const bugun = new Date(`${BUGUN()}T00:00:00`).getTime();
  return Math.round((new Date(`${g}T00:00:00`).getTime() - bugun) / 864e5);
};

export const cihazAdi = (c: Pick<Cihaz, "marka" | "model" | "tur">) =>
  [c.marka, c.model].filter((x) => x && x.trim()).join(" ") || c.tur || "Adsız cihaz";

export const etiketler = (c: Pick<Cihaz, "etiketler">) =>
  (c.etiketler ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export type Rozet = { m: string; s: "" | "iyi" | "uyari" | "kotu" };

export const garanti = (c: Cihaz): Rozet => {
  if (!c.garantiBitis) return { m: "Garanti yok", s: "" };
  const f = gunFark(c.garantiBitis);
  if (f < 0) return { m: "Garanti bitti", s: "" };
  if (f <= 60) return { m: `Garanti ${f} gün`, s: "uyari" };
  return { m: "Garantili", s: "iyi" };
};

export const bakimDurumu = (c: Cihaz): (Rozet & { f: number }) | null => {
  if (!c.sonrakiBakim || c.durum === "pasif") return null;
  const f = gunFark(c.sonrakiBakim);
  if (f < 0) return { m: `Bakım ${-f} gün gecikti`, s: "kotu", f };
  if (f <= 30) return { m: `Bakım ${f === 0 ? "bugün" : f + " gün"}`, s: "uyari", f };
  return { m: `Bakım ${kisa(c.sonrakiBakim)}`, s: "", f };
};

export const ayGecen = (c: Cihaz) => {
  const g = gunMetni(c.alisTarihi);
  if (!g) return 0;
  const a = new Date(`${g}T00:00:00`);
  const b = new Date();
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth());
};

export const defterDegeri = (c: Cihaz) =>
  c.alisBedeli ? Math.max(0, c.alisBedeli * (1 - ayGecen(c) / (c.ekonomikOmur || 60))) : 0;

export const kalemTutari = (k: Kalem) => (+k.adet || 0) * (+(k.birim ?? 0) || 0);
export const araToplam = (kalemler: Kalem[]) => kalemler.reduce((a, k) => a + kalemTutari(k), 0);

export const gorselAdresi = (id: number | null | undefined) =>
  id ? `${API_TABAN}/api/Envanter/Gorsel/${id}` : "";

/** Belgeyi oturum başlığıyla indirip yeni sekmede açar (adreste jeton yok). */
export const belgeAc = async (id: number) => {
  const oturum = oturumOku();
  const sekme = window.open("", "_blank");

  const y = await fetch(`${API_TABAN}/api/Envanter/Belge/${id}`, {
    headers: oturum ? { Authorization: `Bearer ${oturum.jeton}` } : {},
  });

  if (!y.ok) {
    sekme?.close();
    throw new Error(`Belge açılamadı (${y.status})`);
  }

  const adres = URL.createObjectURL(await y.blob());

  if (sekme) sekme.location.href = adres;
  else window.location.assign(adres);

  setTimeout(() => URL.revokeObjectURL(adres), 60_000);
};

export const boyutMetni = (b: number) =>
  b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export const KATEGORI_RENK = ["#2662a8", "#7a3fb8", "#e8481c", "#0f766e", "#2563eb", "#0891b2", "#475569", "#b45309", "#334155", "#4f7a0c", "#be185d"];

export const renkSec = (metin: string | null | undefined) =>
  KATEGORI_RENK[[...(metin ?? "")].reduce((a, c) => a + c.charCodeAt(0), 0) % KATEGORI_RENK.length];

/** Tamirlerin ve servis formlarının cihaz başına net toplamı (garantidekiler hariç) */
export const tamirNet = (t: Tamir) => (t.garantide ? 0 : t.toplam ?? 0);
