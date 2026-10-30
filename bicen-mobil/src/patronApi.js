/**
 * Patron görünümü uçları
 * ---------------------------------------------------------------------------
 * Bütün okumalar önbellekten geçiyor (bkz. onbellek.js): ekran son
 * görülen veriyle hemen açılır, yenisi arka planda gelir.
 *
 * Anahtarlar "patron/" ile başlıyor; çıkışta ve bir karar verildikten
 * sonra bu önekle topluca temizlenip eskitilebiliyor.
 */

import { useRef } from "react";

import { api, jetonOku } from "./api";
import { useOnbellek, onceYukle, eskit } from "./onbellek";
import { aralikSorgusu } from "./bilesenler/patron/aralik";

const KOK = "/api/PatronMobil/";

/* Sunucu kökünün kaynağı (https://kariyer.bicen.com.tr): fotoğraf ve
   sayfa adreslerinde jetonun yalnızca bu sunucuya gitmesi için. */
export const KOK_KAYNAK = (() => {
  const m = /^(https?:\/\/[^/]+)/i.exec(api.adres ?? "");
  return m ? m[1].toLowerCase() : "";
})();

/** Adres bizim sunucumuza mı (http(s), aynı alan adı ve kapı) */
export const bizimAdresMi = (adres) => {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(String(adres ?? ""));
  return !!m && !!KOK_KAYNAK && m[1].toLowerCase() === KOK_KAYNAK;
};

/**
 * Fotoğraf kaynağı (Image `source`).
 *
 * Sunucu `fotoUrl`'i göreli veriyor ("/api/PatronMobil/Foto/..."); başına
 * API kökü ekleniyor. Jeton hem başlıkta hem `t` sorgusunda: Android'de
 * Image başlıkları her durumda iletmiyor (önbellekten yeniden çizimde,
 * bazı yönlendirmelerde), sunucu ikisini de kabul ediyor.
 *
 * Başka bir alan adına (tam adres verilmişse) jeton gönderilmiyor.
 *
 * @returns { uri, headers } ya da fotoğraf yoksa null
 */
export const fotoKaynagi = (fotoUrl) => {
  const yol = String(fotoUrl ?? "").trim();
  if (!yol) return null;

  const tam = /^https?:\/\//i.test(yol) ? yol : `${api.adres}${yol.startsWith("/") ? "" : "/"}${yol}`;
  const jeton = jetonOku();

  /* İmzalı adres (s=) jetonsuz açılıyor: jetonu eklemek adresi uzatıyor
     ve görüntüleyici önbelleğini her oturumda bozuyordu (1.6). */
  if (!jeton || !bizimAdresMi(tam) || /[?&]s=/.test(tam)) return { uri: tam };

  return {
    uri: `${tam}${tam.includes("?") ? "&" : "?"}t=${encodeURIComponent(jeton)}`,
    headers: { Authorization: `Bearer ${jeton}` },
  };
};

/** Sunucu tanımlı sayfanın adresi (WebSayfa) */
export const sayfaAdresi = (kod) => `${api.adres}/patron-sayfa/${encodeURIComponent(String(kod ?? ""))}`;

/**
 * Özet yanıtındaki sunucu tanımlı sayfalardan belirli yerde gösterilecekler.
 * Kodu olmayan ya da yer listesi bozuk satırlar atlanıyor: sunucudaki bir
 * yazım hatası ekranı düşürmemeli.
 *
 * @param yer "ozet" | "ik"
 */
export const sayfalariSec = (ozet, yer) =>
  (Array.isArray(ozet?.sayfalar) ? ozet.sayfalar : []).filter(
    (x) => x && x.kod && (Array.isArray(x.yer) ? x.yer : [x.yer]).includes(yer)
  );

/** Önbellek anahtarı: uç adı ve sorgu (ör. "Sube?ad=GEMLİK") */
export const patronAnahtari = (uc) => `patron/${uc}`;

/* Sorgu değerleri burada kodlanıyor: şube adlarında Türkçe harf ve
   boşluk var, kodlanmadan gönderilince sunucu adı bulamıyordu. */
export const sorgu = (nesne) => {
  const parcalar = Object.entries(nesne ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);

  return parcalar.length ? `?${parcalar.join("&")}` : "";
};

export const patronAl = (uc) => api.al(`${KOK}${uc}`);

/**
 * Tarih aralıklı uç (1.6): `aralikliUc("Gecis", { filtre }, aralik)` →
 * "Gecis?filtre=…&bas=2026-10-01&bit=2026-10-06". "Bugün" seçiliyken tarih
 * eklenmiyor (klasik yanıt, 1.5 ile aynı önbellek anahtarı). Önbellek
 * anahtarı ucun kendisi olduğundan her aralığın verisi ayrı saklanıyor.
 */
export const aralikliUc = (uc, ek, aralik) => `${uc}${sorgu({ ...(ek ?? {}), ...aralikSorgusu(aralik) })}`;

/**
 * Önbellekli okuma kancası.
 *
 * @param uc  "Ozet", "Subeler", `Sube${sorgu({ ad })}` gibi; null verilirse
 *            istek atılmaz (parametre henüz belli değilken).
 */
export const usePatron = (uc, secenek) =>
  useOnbellek(uc ? patronAnahtari(uc) : null, () => patronAl(uc), secenek);

/**
 * Süzgeç değişince (başvuru durumu, bölge, arama) yeni anahtarın verisi
 * gelene kadar bir önceki sonuç ekranda kalsın: her dokunuşta sayfanın
 * boşalıp dönen göstergeye düşmesi, süzgeci kullanılmaz kılıyordu.
 */
export const useSonVeri = (veri) => {
  const son = useRef(null);
  if (veri) son.current = veri;
  return veri ?? son.current;
};

/**
 * useSonVeri, eskilik bilgisiyle: tarih aralığı değişince yeni aralığın
 * verisi gelene kadar önceki aralığın sayıları soluk gösteriliyor
 * (`eski`). Boş sayfaya düşmek yerine; ama önceki aralığın rakamı yeni
 * aralığınkiymiş gibi de okunmamalı.
 */
export const useAralikVerisi = (veri) => {
  const son = useRef(null);
  if (veri) son.current = veri;
  return { v: veri ?? son.current, eski: !veri && !!son.current };
};

/** Ekrana girilmeden önce yükler: Özet açılınca Onaylar ve Şubeler */
export const patronOnceYukle = (uc) => onceYukle(patronAnahtari(uc), () => patronAl(uc));

/**
 * Onay ya da red.
 *
 * Sonrasında onay listesi ve özet eskitiliyor: rozetteki sayı ve
 * özetteki şerit kararı hemen yansıtsın. Başvuru ve norm da
 * etkileniyor (işe alım onayı başvuru durumunu, norm onayı kadroyu
 * değiştiriyor).
 */
export const onayVer = async (id, onay, not) => {
  const y = await api.gonder(`${KOK}Onay/${id}`, { onay: !!onay, not: not || null });

  eskit(patronAnahtari("Onaylar"));
  eskit(patronAnahtari("Ozet"));
  eskit(patronAnahtari("Basvuru"));
  eskit(patronAnahtari("Norm"));
  eskit(patronAnahtari("Kart"));

  return y;
};

/** Başvuruya İK için not (panelde görünür) */
export const basvuruNotuYaz = async (id, metin) => {
  const y = await api.gonder(`${KOK}Basvuru/${id}/Not`, { metin });

  eskit(patronAnahtari(`Basvuru/${id}`));

  return y;
};
