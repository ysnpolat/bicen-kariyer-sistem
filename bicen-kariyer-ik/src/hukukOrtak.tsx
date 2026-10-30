/**
 * Hukuk masası ortak tipleri ve küçük bileşenleri (24.10.2026).
 * Uçlar: /api/Hukuk (HukukController, HukukYazisma, HukukYonetim).
 */
import dayjs from "dayjs";
import { API_TABAN, oturumOku } from "./api";

export interface Tur { kod: string; ad: string }
export interface Ben {
  yetkili: boolean; anahtar: string; ad: string; kurum: string | null; tur: "ic" | "danisman";
  yetki: "tam" | "okuma" | "danisman"; danisman: boolean; turler: Tur[]; olayTurleri: Tur[];
}
export interface Sonraki { id: number; tur: string; turAdi: string; tarih: string; baslik: string }
export interface Dosya {
  id: number; dosyaNo: string; tur: string; turAdi: string; davaciAd: string; davaciSicil: string | null;
  gorev: string | null; sube: string | null; mahkeme: string | null; esasNo: string | null; karsiVekil: string | null;
  davaTarihi: string | null; tebligTarihi: string | null; asama: string | null; risk: number;
  talepTutar: number | null; tutarGizli: boolean; ozet: string | null; durum: "acik" | "kapandi";
  sonuc: string | null; kapanisTarihi: string | null; olusturma: string; sonraki: Sonraki | null;
}
export interface Olay { id: number; tur: string; turAdi: string; tarih: string; baslik: string; aciklama: string | null; tamam: boolean; ekleyenAd: string | null; olusturma?: string }
export interface Belge { id: number; ad: string; tur: string | null; boyut: number; uzanti: string; yukleyenAd: string | null; tarih: string; yaziId: number | null; dosyaId: number | null }
export interface YaziOzet {
  id: number; kayitNo: string; konu: string; ozet: string; gonderenAd: string; gonderenKurum: string | null;
  benGonderdim: boolean; kime: string[]; dosyaId: number | null; dosyaNo: string | null; dosyaTur: string | null;
  davaciAd: string | null; cevapSuresi: string | null; yanitlandi: boolean; okunmadi: boolean; okunduAlici: boolean; ek: number; tarih: string;
}

export const SONUCLAR: Record<string, string> = {
  lehe: "Lehe sonuçlandı", kismen: "Kısmen kabul", aleyhe: "Aleyhe sonuçlandı",
  sulh: "Sulh / anlaşma", feragat: "Feragat", diger: "Diğer",
};
export const HAKLAR: Record<string, string> = { tam: "Tam yetki", standart: "Standart", okuma: "Yalnız okuma" };
export const HAK_ACIKLAMA: Record<string, string> = {
  tam: "Dosyayı düzenler, süre ve belge ekler",
  standart: "Süre, süreç kaydı ve belge ekler; yazışır",
  okuma: "Dosyayı ve belgeleri görür, yazışır",
};

/** Dosya türüne göre renk (sol çizgi ve rozet) */
export const TUR_RENK: Record<string, string> = {
  ise_iade: "e-kir", alacak: "e-alt", is_kazasi: "e-tur", arabuluculuk: "e-mav", ihtarname: "e-mor", tespit: "e-gri", diger: "e-gri",
};
export const OLAY_RENK: Record<string, string> = {
  durusma: "e-mav", kesin_sure: "e-kir", arabuluculuk: "e-mor", sure: "e-tur", surec: "e-gri", yazi: "e-alt",
};

const AV_RENK = ["#14213d", "#b08d57", "#2f5d9e", "#6a4c9c", "#3f7d4e", "#a8641c", "#2c4372"];
export const avRenk = (a = "") => AV_RENK[[...a].reduce((t, c) => t + c.charCodeAt(0), 0) % AV_RENK.length];
export const basHarf = (a = "") =>
  a.replace(/^(Av\.|Dr\.|Prof\.|Doç\.|Stj\.)\s*/i, "").split(" ").filter((x) => /\p{L}/u.test(x[0] ?? ""))
    .map((x) => x[0]).slice(0, 2).join("").toLocaleUpperCase("tr");

export function Avatar({ ad, boyut = 38 }: { ad: string; boyut?: number }) {
  return (
    <span className="hk-av" style={{ width: boyut, height: boyut, fontSize: boyut * 0.34, background: avRenk(ad) }}>
      {basHarf(ad)}
    </span>
  );
}

export function Risk({ d }: { d: number }) {
  const ad = ["Düşük", "Düşük", "Orta", "Yüksek"][d] ?? "";
  const s = d >= 3 ? "d" : d === 2 ? "o" : "y";
  return (
    <span className="hk-risk" title={`Risk: ${ad}`}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= Math.max(1, d) ? s : ""} />)} {ad}
    </span>
  );
}

export const tarihYaz = (t?: string | null, saat = false) => {
  if (!t) return "—";
  const d = dayjs(t);
  const s = saat && (d.hour() || d.minute()) ? " " + d.format("HH:mm") : "";
  return d.format("DD.MM.YYYY") + s;
};
export const zamanKisa = (t: string) => {
  const d = dayjs(t);
  if (d.isSame(dayjs(), "day")) return d.format("HH:mm");
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Dün";
  return d.format("DD.MM.YYYY");
};
/** Kalan gün metni ve rengi */
export const kalan = (t: string) => {
  const g = dayjs(t).startOf("day").diff(dayjs().startOf("day"), "day");
  if (g < 0) return { metin: `${-g} gün geçti`, renk: "var(--kir)" };
  if (g === 0) return { metin: "Bugün", renk: "var(--kir)" };
  if (g === 1) return { metin: "Yarın", renk: "var(--kir)" };
  if (g <= 7) return { metin: `${g} gün`, renk: "var(--tur)" };
  return { metin: `${g} gün`, renk: "var(--s)" };
};
export const para = (n?: number | null) =>
  n == null ? "—" : n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
export const boyutYaz = (b?: number | null) =>
  !b ? "" : b > 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB` : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export const belgeAdresi = (id: number, indir = false) =>
  `${API_TABAN}/api/Hukuk/Belge/${id}?t=${encodeURIComponent(oturumOku()?.token ?? "")}${indir ? "&indir=true" : ""}`;

const RESIM = ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "HEIC"];
export const resimMi = (b: Belge) => RESIM.includes(b.uzanti);
export const uzantiSinif = (u: string) =>
  u === "PDF" ? "u-pdf" : u === "UDF" ? "u-udf" : RESIM.includes(u) ? "u-img"
    : ["DOC", "DOCX", "RTF", "ODT", "TXT"].includes(u) ? "u-doc" : ["XLS", "XLSX", "CSV"].includes(u) ? "u-xls" : "u-dig";

export function BelgeKarti({ b, sil }: { b: Belge; sil?: () => void }) {
  return (
    <div className="hk-bel" onClick={() => window.open(belgeAdresi(b.id), "_blank", "noopener")} title={b.ad}>
      <div className={"on " + uzantiSinif(b.uzanti)}>
        {resimMi(b) ? <img src={belgeAdresi(b.id)} alt="" loading="lazy" /> : b.uzanti || "DOSYA"}
      </div>
      <div className="ad">{b.ad}</div>
      <div className="alt">{boyutYaz(b.boyut)} · {tarihYaz(b.tarih)}{b.yaziId ? " · yazı eki" : ""}</div>
      {sil && (
        <button className="sil" title="Kaldır" onClick={(e) => { e.stopPropagation(); sil(); }}>×</button>
      )}
    </div>
  );
}

export function EkSatiri({ b }: { b: Belge }) {
  return (
    <div className="hk-ek" onClick={() => window.open(belgeAdresi(b.id), "_blank", "noopener")} title={b.ad}>
      <i className={uzantiSinif(b.uzanti)}>{b.uzanti || "—"}</i>
      <div><b>{b.ad}</b><small>{boyutYaz(b.boyut)}</small></div>
    </div>
  );
}

/** Sunucuya giden tarih: saat dilimi eklemeden yerel değer */
export const yerelTarih = (d: dayjs.Dayjs | null | undefined, saat = false) =>
  d ? d.format(saat ? "YYYY-MM-DDTHH:mm:00" : "YYYY-MM-DD") : null;
