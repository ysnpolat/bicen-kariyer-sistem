/**
 * Biçen360 API katmanı
 * ---------------------------------------------------------------------------
 * Uygulama iki sunucuya birden gidiyor: İK modülleri Kariyer API'den,
 * Biçen360 modülleri buradan. Jeton ortak — iki API aynı imza anahtarını
 * kullanıyor — bu yüzden ayrı bir giriş yok, `src/api.js` içindeki jeton
 * olduğu gibi kullanılıyor.
 *
 * Neden ayrı dosya: adres, hata mesajları ve dosya gönderimi birebir aynı
 * desende ama taban adres farklı. api.js içine ikinci bir taban eklemek,
 * her uçta hangi sunucuya gittiğini takip etmeyi zorlaştırıyordu.
 */

import Constants from "expo-constants";
/* Dosya yükleyici isteğe bağlı yükleniyor.

   "expo-file-system/legacy" giriş noktası paketin bütün sürümlerinde yok;
   olmadığında import çözülemiyor ve uygulama açılışta beyaz ekranda
   kalıyordu. Bulunamazsa fotoğraf yüklemesi eski fetch yoluna düşüyor. */
let FileSystem = null;

try {
  FileSystem = require("expo-file-system/legacy");
} catch {
  try {
    FileSystem = require("expo-file-system");
  } catch {
    FileSystem = null;
  }
}

import { jetonOku, oturumDustu } from "./api";

/* Yayın adresi. Yerelde denemek için app.json içindeki
   extra.api360Adresi değerini bilgisayarınızın ağ adresiyle
   (http://192.168.1.x:5181) değiştiriniz; telefon localhost göremiyor. */
const ADRES =
  Constants.expoConfig?.extra?.api360Adresi ?? "https://kariyer.bicen.com.tr/portalservis";

const istek = async (yol, secenek = {}) => {
  const jeton = jetonOku();
  let yanit;

  try {
    yanit = await fetch(`${ADRES}${yol}`, {
      ...secenek,
      headers: {
        "Content-Type": "application/json",
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
        ...(secenek.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      "Biçen360 sunucusuna bağlanılamadı. İnternet bağlantınızı kontrol ediniz."
    );
  }

  if (yanit.status === 401) throw await oturumDustu(yanit);

  /* 403: modül bu kişiye kapalı. Oturum düşürülmez; yalnızca bu ekran
     kullanılamaz. */
  if (yanit.status === 403) {
    throw new Error("Bu bölüme erişim yetkiniz yok.");
  }

  let veri = null;

  try {
    veri = await yanit.json();
  } catch {
    /* Gövdesiz yanıt olabilir */
  }

  if (!yanit.ok) {
    const varsayilan =
      yanit.status === 404
        ? "Sunucuya ulaşıldı ama bu servis bulunamadı. Sistem güncellenmemiş olabilir."
        : yanit.status >= 500
        ? `Biçen360 sunucusu ${yanit.status} döndürdü.`
        : "İşlem tamamlanamadı.";

    /* Sunucu açılışta çöktüyse sebebi "ayrinti" alanında geliyor; genel
       mesajla değiştirmek, sorunu teşhis edilemez hâle getiriyordu. */
    const sebep = veri?.ayrinti ?? veri?.icHata;

    const hata = new Error(
      veri?.hata
        ? sebep && sebep !== veri.hata
          ? `${veri.hata} ${sebep}`
          : veri.hata
        : sebep ?? varsayilan
    );

    /* Ekran, sunucunun hata kodunu tanıyabilsin (ör. vardiyaPlaniYok) */
    hata.durum = yanit.status;
    hata.kod = veri?.kod;

    throw hata;
  }

  return veri;
};

const dosyaGonder = async (yol, form) => {
  const jeton = jetonOku();
  let yanit;

  try {
    yanit = await fetch(`${ADRES}${yol}`, {
      method: "POST",
      /* Çok parçalı gönderimde sınır (boundary) değerini fetch kendisi
         yazmalı; Content-Type elle konulmaz. */
      headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
      body: form,
    });
  } catch {
    throw new Error("Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol ediniz.");
  }

  if (yanit.status === 401) throw await oturumDustu(yanit);

  let veri = null;

  try {
    veri = await yanit.json();
  } catch {
    /* Gövdesiz yanıt olabilir */
  }

  /* Sunucunun anlattığı sebep olduğu gibi taşınıyor: "yüklenemedi" tek
     başına, klasör izni mi yetki mi boyut mu ayırt ettirmiyordu. */
  if (!yanit.ok)
    throw new Error(veri?.hata ?? `Fotoğraf yüklenemedi (${yanit.status}).`);

  return veri;
};

/* Portal servisinin taban adresi.

   Görsel etiketleri istek başlığı gönderemiyor; adresi doğrudan kuran
   ekranlar buna ihtiyaç duyuyor. */
export const ADRES360 = ADRES;

export const api360 = {
  al: (yol) => istek(yol),

  gonder: (yol, govde, yontem = "POST") =>
    istek(yol, {
      method: yontem,
      ...(govde === null ? {} : { body: JSON.stringify(govde ?? {}) }),
    }),

  adres: ADRES,
};

/* ========================================================================== */
/* Uçlar                                                                      */
/* ========================================================================== */

/** Biçen360 tarafındaki modüller; İK modülleriyle birleştirilir */
/* 60 saniye bellekte (1.9): ana sayfa ve menü aynı açılışta tekrar istiyordu */
let m360 = { zaman: 0, veri: null, suren: null, jeton: null };
export const moduller360Al = (zorla = false) => {
  const j = jetonOku();
  if (!zorla && m360.veri && m360.jeton === j && Date.now() - m360.zaman < 60_000) return Promise.resolve(m360.veri);
  if (m360.suren && m360.jeton === j) return m360.suren;
  const p = api360.al("/api/Mobil/Modullerim")
    .then((v) => {
      m360 = { zaman: Date.now(), veri: v, suren: null, jeton: j };
      return v;
    })
    .catch((h) => {
      m360.suren = null;
      throw h;
    });
  m360 = { ...m360, suren: p, jeton: j };
  return p;
};

/* ------------------------------------------------------------ arıza kayıt */

/** Kayıt açma ekranının listeleri: departman, tür, kendi mağazasının cihazları */
export const arizaFormAl = () => api360.al("/api/Ariza/Form");

/**
 * Bir arıza türünün soru akışı.
 *
 * Ağacın tamamı tek istekte geliyor; her adımda sunucuya sormak, mağazadaki
 * zayıf bağlantıda akışı kullanılamaz hâle getiriyordu.
 */
export const arizaAkisAl = (turId) => api360.al(`/api/Ariza/Akis?turId=${turId}`);

export const arizaAc = (govde) => api360.gonder("/api/Ariza", govde);

/** Görebildiğim kayıtlar; temsilci bayrağı durum değiştirme hakkını söyler */
/**
 * Görebildiğim kayıtlar.
 *
 * kapsam: "departmanim" (temsilcisi olduğum departmanlara açılanlar),
 * "benim" (kendi açtıklarım) ya da boş (görebildiğim her şey).
 */
export const arizalarimAl = (durum, kapsam) => {
  const s = new URLSearchParams();

  if (durum) s.set("durum", durum);
  if (kapsam) s.set("kapsam", kapsam);

  const sorgu = s.toString();

  return api360.al(`/api/Ariza/Kayitlarim${sorgu ? `?${sorgu}` : ""}`);
};

export const arizaDetayAl = (id) => api360.al(`/api/Ariza/${id}`);

export const arizaDurumYaz = (id, durum, aciklama) =>
  api360.gonder(`/api/Ariza/${id}/Guncelle`, { durum, aciklama });

/** Kayda yorum ekler; iç not ve çözüm işaretleme yalnızca temsilcilerde */
export const arizaYorumYaz = (id, metin, secenek = {}) =>
  api360.gonder(`/api/Ariza/${id}/Yorum`, {
    metin,
    icNot: !!secenek.icNot,
    cozum: !!secenek.cozum,
  });

/**
 * Arıza kaydına fotoğraf yükler.
 *
 * <para>
 * Yükleme `FileSystem.uploadAsync` ile yapılıyor, `fetch` + `FormData` ile
 * değil. iOS'ta dosya nesnesi taşıyan bir fetch isteği, sunucuya hiç
 * ulaşmadan "Network request failed" ile düşüyordu: kayıt açılıyor ama
 * fotoğraf her seferinde eklenemiyordu. uploadAsync dosyayı platformun
 * kendi yükleme akışıyla gönderdiği için bu sorun yaşanmıyor.
 * </para>
 *
 * <para>
 * Yine de fetch yolu yedek olarak duruyor: uploadAsync'in çalışmadığı bir
 * ortamda (web önizlemesi gibi) yükleme tamamen durmasın.
 * </para>
 */
export const arizaGorselYukle = async (arizaId, dosyaAdresi) => {
  const jeton = jetonOku();

  /* Kayıt numarası yolda gidiyor: çok parçalı gövdedeki alan sunucu
     tarafında bağlanamadığında istek "Dosya boş" diye reddediliyordu. */
  const adres = `${ADRES}/api/Ariza/Gorsel/${arizaId}`;

  if (!FileSystem?.uploadAsync) {
    /* Yükleyici yoksa doğrudan eski yola: kayıt açılmışken fotoğrafın
       hiç gitmemesi, hata göstermekten iyi değil. */
    const form = new FormData();

    form.append("arizaId", String(arizaId));
    form.append("dosya", {
      uri: dosyaAdresi,
      name: `ariza_${Date.now()}.jpg`,
      type: "image/jpeg",
    });

    return dosyaGonder(`/api/Ariza/Gorsel/${arizaId}`, form);
  }

  try {
    const sonuc = await FileSystem.uploadAsync(adres, dosyaAdresi, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "dosya",
      mimeType: "image/jpeg",
      parameters: { arizaId: String(arizaId) },
      headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
    });

    if (sonuc.status >= 200 && sonuc.status < 300) {
      try {
        return JSON.parse(sonuc.body || "{}");
      } catch {
        return {};
      }
    }

    if (sonuc.status === 401) throw await oturumDustu(sonuc);

    /* Sunucunun anlattığı sebep olduğu gibi taşınıyor */
    let sebep = null;

    try {
      sebep = JSON.parse(sonuc.body || "{}")?.hata;
    } catch {
      /* Gövde JSON değilse durum kodu yeterli */
    }

    throw new Error(sebep ?? `Fotoğraf yüklenemedi (${sonuc.status}).`);
  } catch (hata) {
    /* Oturum ve sunucu hataları olduğu gibi yukarı çıkar; yalnızca
       uploadAsync'in hiç çalışmadığı durumda eski yola düşülür. */
    if (hata?.message && !`${hata.message}`.includes("uploadAsync"))
      throw hata;

    const form = new FormData();

    form.append("arizaId", String(arizaId));
    form.append("dosya", {
      uri: dosyaAdresi,
      name: `ariza_${Date.now()}.jpg`,
      type: "image/jpeg",
    });

    return dosyaGonder(`/api/Ariza/Gorsel/${arizaId}`, form);
  }
};

/**
 * Görsel adresi.
 *
 * Image bileşeni başlık gönderemediği için jeton sorgu olarak taşınır;
 * sunucu yalnızca görsel uçlarında bu yolu kabul ediyor.
 */
/* ---------------------------------------------------------- rakip fiyat */

/** Okutma ekranının firma listesi */
/* --------------------------------------------------------- fiyat kontrol */

/** Sorgulanacak şube ve seçilebilecek şubeler */
export const fiyatSubeAl = () => api360.al("/api/FiyatKontrol/Sube");

/** Sorgulanabilecek şubeler ve seçili olan */
export const fiyatSubeleriAl = () => api360.al("/api/FiyatKontrol/Sube");

/** Sorgulanacak şubeyi seçer; seçim değiştirilene kadar kalıyor */
export const fiyatSubeSec = (subeKodu) =>
  api360.gonder("/api/FiyatKontrol/Sube", { subeKodu });

/** Barkodu sorgular: üç fiyat, yer kodu ve şubedeki eldeki stok */
export const fiyatSorgula = (barkod) =>
  api360.al(`/api/FiyatKontrol/Sorgula?barkod=${encodeURIComponent(barkod)}`);

/** Etiket listesini şubeye mail olarak gönderir */
export const fiyatListeGonder = (girdi) =>
  api360.gonder("/api/FiyatKontrol/ListeGonder", girdi);

/**
 * Ürün görselinin adresi.
 *
 * Görsel etiketleri istek başlığı gönderemiyor; uç bu yüzden kimlik
 * istemiyor ve adres doğrudan kullanılabiliyor.
 */
export const fiyatGorselAdresi = (id) =>
  !id ? "" : `${ADRES}/api/FiyatKontrol/Gorsel/${id}`;

/** Fiyat listesi adları: "Raf Fiyatı" gibi, Mikro'dan geliyor */
export const fiyatListeleri = () => api360.al("/api/FiyatKontrol/Listeler");

export const rakipFormAl = () => api360.al("/api/RakipFiyat/Form");

/** Barkodu ürüne ve kendi satış fiyatımıza çevirir; kaydetmez */
export const rakipBarkodSorgula = (barkod) =>
  api360.al(`/api/RakipFiyat/Sorgula?barkod=${encodeURIComponent(barkod)}`);

/** Karşılaştırmayı kaydeder; fiyat sunucuda yeniden okunur */
export const rakipFiyatKaydet = (govde) => api360.gonder("/api/RakipFiyat", govde);

/** Bu kişinin bir rakipteki bugünkü okutmaları */
export const rakipSonAl = (firmaId) => api360.al(`/api/RakipFiyat/Son?firmaId=${encodeURIComponent(firmaId)}`);

/** Bu kişinin bugünkü bütün okutmaları (rakip ayrımı olmadan; düzeltme için) */
export const rakipBugunAl = () => api360.al("/api/RakipFiyat/Bugun");

/** Kişinin bütün okutma geçmişi (sayfalı). p: { sonId, firmaId, q, gun } */
export const rakipGecmisAl = (p = {}) => {
  const qs = Object.entries(p)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return api360.al(`/api/RakipFiyat/Gecmis${qs ? "?" + qs : ""}`);
};

/** Aynı gün düzeltme: rakip, indirimli/indirimsiz fiyat, not */
export const rakipFiyatDuzelt = (id, govde) => api360.gonder(`/api/RakipFiyat/${id}`, govde, "PUT");

/** Aynı gün silme */
export const rakipFiyatSil = (id) => api360.gonder(`/api/RakipFiyat/${id}`, null, "DELETE");

/** Rakip logosu: sunucu "/api/RakipFiyat/Logo/3?v=2" gönderiyor; yoksa boş */
export const rakipLogoAdresi = (logo) => (logo ? `${ADRES}${logo}` : "");

/* ----------------------------------------------- fiyat kontrol etiket listesi */

/** Gönderilmemiş etiket listesi (sunucuda, kişiye bağlı) */
export const etiketTaslakAl = () => api360.al("/api/FiyatKontrol/Taslak");

/** Taslağı olduğu gibi yazar; boş liste taslağı siler */
export const etiketTaslakYaz = (kalemler) => api360.gonder("/api/FiyatKontrol/Taslak", { kalemler }, "PUT");

/** Son gönderilen 10 liste */
export const etiketSonListeler = () => api360.al("/api/FiyatKontrol/SonListeler");

/* -------------------------------------------------------------- görseller */

export const arizaGorselAdresi = (id) => {
  const jeton = jetonOku();

  return `${ADRES}/api/Ariza/Gorsel/${id}${
    jeton ? `?j=${encodeURIComponent(jeton)}` : ""
  }`;
};

/* ------------------------------------------------------- SKT kontrol (1.9) */

export const sktGorevAl = () => api360.al("/api/Skt/Mobil/Gorev");
export const sktUrunAl = (barkod, planId) =>
  api360.al(`/api/Skt/Mobil/Urun?barkod=${encodeURIComponent(barkod)}${planId ? `&planId=${planId}` : ""}`);
export const sktKaydet = (govde) => api360.gonder("/api/Skt/Mobil/Kaydet", govde);
/** 23.10.2026: genel merkez kullanıcıları şube seçer (Fiyat Kontrol ile ortak seçim) */
export const sktSubelerAl = () => api360.al("/api/Skt/Mobil/Subeler");
export const sktSubeSec = (subeKodu) => api360.gonder("/api/Skt/Mobil/Sube", { subeKodu });
