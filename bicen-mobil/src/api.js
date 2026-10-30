/**
 * API katmanı
 * ---------------------------------------------------------------------------
 * Sunucuyla tüm iletişim buradan geçer.
 *
 * Oturum jetonu SecureStore'da tutulur: cihazın şifreli alanı olduğu için
 * AsyncStorage'dan güvenlidir ve telefon kaybolduğunda jeton okunamaz.
 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { onbellekTemizle } from "./onbellek";
import { gorunumTemizle, hukukMu } from "./gorunum";

/* Dosya yükleyici koşullu: paket kurulu olmadığında import çözülemiyor ve
   uygulama açılışta beyaz ekranda kalıyordu. Bulunamazsa yükleme eski
   fetch yoluna düşüyor. */
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

const ADRES =
  Constants.expoConfig?.extra?.apiAdresi ??
  "https://kariyer.bicen.com.tr/apiservis";

const JETON_ANAHTARI = "bicen_personel_jeton";

let jeton = null;

/** Uygulama açılışında saklanan jetonu yükler */
export const jetonYukle = async () => {
  try {
    jeton = await SecureStore.getItemAsync(JETON_ANAHTARI);
  } catch {
    jeton = null;
  }

  return jeton;
};

export const jetonYaz = async (deger) => {
  jeton = deger;

  try {
    if (deger) await SecureStore.setItemAsync(JETON_ANAHTARI, deger);
    else await SecureStore.deleteItemAsync(JETON_ANAHTARI);
  } catch {
    /* Saklanamazsa oturum yalnızca bu açılış boyunca sürer */
  }
};

/* Çıkışta patron önbelleği ve görünüm seçimi de siliniyor: aynı
   telefonda başka biri oturum açtığında önceki kişinin yönetim verisi
   (şubeler, personel, başvurular) ilk görüntü olarak çıkmamalı. Oturum
   düştüğünde (401) de buradan geçiliyor. */
export const cikisYap = async () => {
  await jetonYaz(null);
  modulOnbellek = { zaman: 0, veri: null, suren: null };

  try {
    await onbellekTemizle();
    await gorunumTemizle();
  } catch {
    /* Temizlenemese de oturum kapanmış olmalı */
  }
};

/* Oturumun sunucu tarafından kapatılma sebebi (26.10.2026).

   Sunucu, çıkış tarihi gelmiş personelin isteklerine 401 ve
   { kod: "ayrildi" } dönüyor. Jeton silinip giriş ekranına dönülürken
   sebep burada tutuluyor; giriş ekranı bir kez gösterip siliyor. Eski
   sürümler gövdeyi okumadan 401'de çıkış yapıyor; sunucu tarafı tek
   başına yetiyor, bu yalnızca açıklayıcı mesaj için. */
const AYRILDI_MESAJI = "Çıkış tarihiniz geldiği için oturumunuz kapatıldı.";
const OTURUM_MESAJI = "Oturumunuz sona erdi. Yeniden giriş yapınız.";

let oturumKapanmaNedeni = "";

/** Giriş ekranı açılırken okunur ve temizlenir */
export const oturumKapanmaNedeniAl = () => {
  const n = oturumKapanmaNedeni;
  oturumKapanmaNedeni = "";
  return n;
};

/**
 * 401 yanıtını işler: jetonu siler, sebebi saklar ve fırlatılacak
 * hatayı döner. Mesaj "oturum" sözcüğünü içeriyor; ekranlar bununla
 * giriş sayfasına dönüyor.
 */
export const oturumDustu = async (yanit) => {
  /* fetch yanıtı ya da çözülmüş gövde verilebilir */
  let veri = yanit;

  if (typeof yanit?.json === "function") {
    try {
      veri = await yanit.json();
    } catch {
      /* Gövdesiz 401 olabilir */
      veri = null;
    }
  } else if (typeof yanit?.body === "string") {
    /* FileSystem.uploadAsync sonucu: gövde metin */
    try {
      veri = JSON.parse(yanit.body || "{}");
    } catch {
      veri = null;
    }
  }

  await cikisYap();

  const ayrildi = veri?.kod === "ayrildi";
  oturumKapanmaNedeni = ayrildi ? AYRILDI_MESAJI : "";

  return new Error(ayrildi ? AYRILDI_MESAJI : OTURUM_MESAJI);
};

/**
 * Geçerli jeton.
 *
 * Biçen360 API'si ayrı bir sunucu ama aynı imza anahtarını kullanıyor;
 * ikinci bir giriş olmasın diye `api360.js` bu jetonu okuyor.
 */
export const jetonOku = () => jeton;

/**
 * İstek gönderir.
 *
 * Hata mesajı sunucudan geliyorsa olduğu gibi gösterilir; kullanıcıya
 * "bir hata oluştu" demek yerine sebebi söylemek daha yardımcı.
 */
const istek = async (yol, secenek = {}) => {
  let yanit;

  /* Zaman aşımı (1.9): zayıf bağlantıda asılı kalan istek ekranı sonsuz
     göstergede bırakıyordu; 25 saniyede kesilip hata gösteriliyor. */
  const kesici = typeof AbortController !== "undefined" && !secenek.signal ? new AbortController() : null;
  const zaman = kesici ? setTimeout(() => kesici.abort(), 25_000) : null;

  try {
    yanit = await fetch(`${ADRES}${yol}`, {
      ...(kesici ? { signal: kesici.signal } : {}),
      ...secenek,
      headers: {
        "Content-Type": "application/json",
        /* Sunucu yeni sürümde ekranı olan modülleri (avans) buna göre gönderiyor */
        "X-Uygulama-Surum": String(Constants.expoConfig?.version ?? ""),
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
        ...(secenek.headers ?? {}),
      },
    });
  } catch {
    /* fetch yalnızca ağ seviyesinde başarısız olunca hata fırlatır:
       internet yok, sunucuya erişilemiyor, sertifika sorunu. */
    throw new Error(
      kesici?.signal?.aborted
        ? "Sunucu zamanında yanıt vermedi. Bağlantınızı kontrol edip tekrar deneyiniz."
        : "Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol ediniz."
    );
  } finally {
    if (zaman) clearTimeout(zaman);
  }

  /* Oturum düşmüşse jeton temizlenir; ekran giriş sayfasına döner */
  if (yanit.status === 401) throw await oturumDustu(yanit);

  let veri = null;

  try {
    veri = await yanit.json();
  } catch {
    /* Gövdesiz yanıt olabilir */
  }

  if (!yanit.ok) {
    /* Durum kodları kullanıcıya bir şey anlatmıyor; ne yapması
       gerektiğini söyleyen bir karşılık verilir. */
    const varsayilan =
      yanit.status === 404
        ? "Sunucuya ulaşıldı ama bu servis bulunamadı. Sistem güncellenmemiş olabilir."
        : yanit.status === 503 || yanit.status === 502
        ? "Sistem şu anda yanıt vermiyor. Biraz sonra deneyiniz."
        : yanit.status >= 500
        ? "Sunucuda bir sorun oluştu. Biraz sonra deneyiniz."
        : "İşlem tamamlanamadı.";

    /* Ayrıntı da mesaja ekleniyor: sunucu "Dinlenme süresi yetmiyor"
       başlığının altında hangi gün, hangi vardiya olduğunu söylüyor ve
       bu bilgi ekrana hiç ulaşmıyordu. */
    throw new Error(
      [veri?.hata, veri?.ayrinti].filter(Boolean).join("\n\n") || varsayilan
    );
  }

  return veri;
};

export const api = {
  al: (yol) => istek(yol),

  gonder: (yol, govde, yontem = "POST") =>
    istek(yol, {
      method: yontem,
      ...(govde === null ? {} : { body: JSON.stringify(govde ?? {}) }),
    }),

  /**
   * Personel fotoğrafı.
   *
   * Sunucu her zaman oturumdaki kişinin fotoğrafını döner; sicil
   * numarası gönderilmez. Image bileşeni jetonu başlıkta taşıyamadığı
   * için adres jetonu sorgu olarak alır.
   */
  resimAdresi: () =>
    `${ADRES}/api/Mobil/Resim${jeton ? `?j=${encodeURIComponent(jeton)}` : ""}`,

  /* Logo /api/Logo ucundan yayınlanır; panel de aynı adresi kullanır */
  logoAdresi: () => `${ADRES}/api/Logo`,

  adres: ADRES,
};

/* ========================================================================== */
/* Uçlar                                                                      */
/* ========================================================================== */

/**
 * Cihaz kimliği (26.10.2026 — kalıcı kimlik).
 *
 * Bir personel tek cihazda oturum açabildiği için cihazın ayırt edilmesi
 * gerekiyor. 1.9'a kadar kimlik rastgele üretilip SecureStore'da
 * saklanıyordu; Android'de uygulama silinince SecureStore da silindiği
 * için yeniden kurulumda kimlik değişiyor ve personel aynı telefondayken
 * "başka cihaza tanımlı" hatası alıyordu.
 *
 * MAC adresi ve seri numarası kullanılamıyor: iOS uygulamalara hiç
 * vermiyor, Android 10+ da vermiyor (MAC ayrıca rastgeleleştiriliyor).
 * Bunun yerine:
 *   - Android: ANDROID_ID ("and-" öneki). Uygulama imzası + cihaz +
 *     kullanıcı için sabittir; silip kurmada değişmez, fabrika
 *     ayarlarında değişir.
 *   - iOS: Keychain'de saklanan UUID. Keychain kaydı uygulama silinse de
 *     kalır; 1.9'daki kimlik de Keychain'de olduğu için olduğu gibi
 *     kullanılmaya devam eder. Keychain okunamazsa satıcı kimliği (IDFV).
 *
 * Eski rastgele kimlik silinmeden saklanır ve girişte / açılışta sunucuya
 * da gönderilir; sunucu kaydı kalıcı kimliğe taşır (bkz. cihazKimligiTasi).
 */
const CIHAZ_ANAHTARI = "bicen_cihaz_id"; /* 1.9 ve öncesinin rastgele kimliği */
const KALICI_ANAHTARI = "bicen_cihaz_kalici"; /* Keychain/Keystore UUID */

/* Paket kurulu değilse (eski derleme) uygulama açılışta kalmasın */
let Application = null;

try {
  Application = require("expo-application");
} catch {
  Application = null;
}

const isletimAdi = () => (Platform.OS === "ios" ? "iOS" : "Android");

const rastgeleKimlik = () =>
  `${Date.now().toString(36)}-` +
  Math.random().toString(36).slice(2, 12) +
  Math.random().toString(36).slice(2, 12);

const uuidUret = () => {
  try {
    const u = globalThis.crypto?.randomUUID?.();
    if (u) return String(u).toLowerCase();
  } catch {
    /* randomUUID yoksa aşağıdaki üretim kullanılır */
  }

  return rastgeleKimlik();
};

/** 1.9 ve öncesinin sakladığı rastgele kimlik; yoksa null */
export const eskiCihazKimligi = async () => {
  try {
    return (await SecureStore.getItemAsync(CIHAZ_ANAHTARI)) || null;
  } catch {
    return null;
  }
};

const eskiKimligiSil = async () => {
  try {
    await SecureStore.deleteItemAsync(CIHAZ_ANAHTARI);
  } catch {
    /* Silinemezse bir sonraki girişte yeniden gönderilir; zararsız */
  }
};

export const cihazKimligi = async () => {
  /* Android: donanıma bağlı, kurulumdan bağımsız kimlik */
  if (Platform.OS === "android") {
    try {
      const a = Application?.getAndroidId?.();

      if (a && /^[0-9a-f]{16}$/i.test(String(a))) return `and-${String(a).toLowerCase()}`;
    } catch {
      /* Alınamazsa aşağıdaki saklanan kimliğe düşülür */
    }
  }

  /* iOS (ve Android'de ANDROID_ID alınamazsa): güvenli alanda saklanan UUID.
     1.9'un kimliği varsa o devam eder; böylece iOS'ta taşıma gerekmez. */
  try {
    let id = await SecureStore.getItemAsync(KALICI_ANAHTARI);

    if (!id) {
      id = (await SecureStore.getItemAsync(CIHAZ_ANAHTARI)) || `ios-${uuidUret()}`;
      await SecureStore.setItemAsync(KALICI_ANAHTARI, id);
    }

    return id;
  } catch {
    /* Keychain okunamıyorsa satıcı kimliği; o da yoksa geçici kimlik */
    try {
      const v = await Application?.getIosIdForVendorAsync?.();
      if (v) return `idfv-${String(v).toLowerCase()}`;
    } catch {
      /* Aşağıdaki geçici kimlik */
    }

    return `gecici-${Date.now().toString(36)}`;
  }
};

/** Cihaz modeli; panelde okunur biçimde gösterilir */
export const cihazAdi = () =>
  `${Device.brand ?? ""} ${Device.modelName ?? "Bilinmeyen"}`.trim();

/** Kimlik ve telefonu doğrular, SMS gönderir */
export const kodIste = (kimlikNo, telefon) =>
  api.gonder("/api/Mobil/KodIste", { kimlikNo, telefon });

/** Kodu doğrular, jeton döner */
export const kodDogrula = async (kimlikNo, telefon, kod) => {
  const cihazId = await cihazKimligi();
  const eski = await eskiCihazKimligi();

  const d = await api.gonder("/api/Mobil/KodDogrula", {
    kimlikNo,
    telefon,
    kod,
    cihazId,
    /* Güncellemeyle gelen eski rastgele kimlik; sunucu kaydı kalıcı
       kimliğe taşır, aylık hak harcanmaz */
    ...(eski && eski !== cihazId ? { eskiCihazId: eski } : {}),
    cihazAdi: cihazAdi(),
    isletim: isletimAdi(),
  });

  if (d?.jeton) {
    await jetonYaz(d.jeton);
    if (eski && eski !== cihazId) await eskiKimligiSil();
  }

  return d;
};

/**
 * Açık oturumun cihaz kaydını kalıcı kimliğe taşır.
 *
 * Güncellenen uygulama ilk açılışta çağırır: eski rastgele kimlik hâlâ
 * saklıysa ve kalıcı kimlikten farklıysa sunucuya kalıcı kimlik gönderilir;
 * sunucu kaydı taşıyıp yeni jeton döner. Personel hiçbir şey yapmaz.
 * Sunucu henüz güncellenmemişse (404) sessizce geçilir, bir sonraki
 * açılışta yeniden denenir.
 */
export const cihazKimligiTasi = async () => {
  if (!jeton) return false;

  const eski = await eskiCihazKimligi();
  if (!eski) return false;

  const kalici = await cihazKimligi();
  if (!kalici || kalici === eski || kalici.startsWith("gecici-")) return false;

  const d = await api.gonder("/api/Mobil/CihazKimligiTasi", {
    cihazId: kalici,
    cihazAdi: cihazAdi(),
    isletim: isletimAdi(),
  });

  if (d?.jeton) await jetonYaz(d.jeton);

  /* tasindi=false sunucunun taşıyacak bir şey bulamaması (jeton eski
     biçimde ya da kayıt zaten kalıcı): eski kimlik girişte bir kez daha
     gönderilsin diye yalnızca taşındığında silinir */
  if (d?.tasindi) await eskiKimligiSil();

  return !!d?.tasindi;
};

/**
 * Uygulamadan çıkış.
 *
 * Sunucuda oturum kapatılır ama cihaz eşleştirmesi kaldırılmaz: aksi
 * hâlde çıkış yapan personel aylık değişim hakkını harcamadan başka bir
 * telefona geçebilirdi.
 */
export const oturumKapat = async () => {
  try {
    await api.gonder("/api/Mobil/Cikis");
  } catch {
    /* Sunucuya ulaşılamasa da yerel oturum kapanmalı */
  }

  await cikisYap();
};

export const ozetAl = () => api.al("/api/Mobil/Ozet");
export const izinAl = () => api.al("/api/Mobil/Izin");
export const performansAl = (yil, ay) =>
  api.al(
    yil && ay
      ? `/api/Mobil/Performans?yil=${yil}&ay=${ay}`
      : "/api/Mobil/Performans"
  );
export const primAl = () => api.al("/api/Mobil/Prim");
export const duyuruAl = () => api.al("/api/Mobil/Duyurular");

/** Kişinin görebileceği modüller; yetki pozisyona göre verilir */
/* Modül listesi (1.9): App, ana sayfa ve menü aynı anda istiyordu; aynı
   açılışta üç-dört kez sunucuya gidiliyordu. 60 saniye bellekte tutuluyor,
   süren istek paylaşılıyor. zorla = true taze alır. */
let modulOnbellek = { zaman: 0, veri: null, suren: null };
export const modullerimAl = (zorla = false) => {
  if (!zorla && modulOnbellek.veri && Date.now() - modulOnbellek.zaman < 60_000) return Promise.resolve(modulOnbellek.veri);
  if (modulOnbellek.suren) return modulOnbellek.suren;
  const p = api.al("/api/Mobil/Modullerim")
    .then((v) => {
      modulOnbellek = { zaman: Date.now(), veri: v, suren: null };
      return v;
    })
    .catch((h) => {
      modulOnbellek.suren = null;
      throw h;
    });
  modulOnbellek.suren = p;
  return p;
};
export const modulOnbellekTemizle = () => {
  modulOnbellek = { zaman: 0, veri: null, suren: null };
};
export const vardiyaAl = () => api.al("/api/Mobil/Vardiya");

/* ----------------------------------------------------------- checklist */

/**
 * Dosya gönderimi.
 *
 * Ortak `istek` yardımcısı her isteğe JSON başlığı koyuyor; çok parçalı
 * gönderimde sınır (boundary) değerini fetch'in kendisi yazmalı, o yüzden
 * ayrı bir yol kullanılıyor.
 */
const dosyaGonder = async (yol, form) => {
  let yanit;

  try {
    yanit = await fetch(`${ADRES}${yol}`, {
      method: "POST",
      headers: {
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      },
      body: form,
    });
  } catch (e) {
    /* Sebep metne giriyor: her ağ hatasını "internet bağlantınızı
       kontrol ediniz" diye göstermek, dosya çok büyük olduğu için
       düşen istekleri bağlantı sorunu sanmaya yol açıyordu. */
    throw new Error(
      `Sunucuya bağlanılamadı (${e?.message ?? "bilinmeyen"}). ` +
        "Bağlantınızı kontrol ediniz."
    );
  }

  if (yanit.status === 401) throw await oturumDustu(yanit);

  /* Dosya sunucunun sınırını aştığında IIS 404.13 ya da 413 dönüyor;
     bunu bağlantı hatasından ayırmak gerekiyor. */
  if (yanit.status === 413 || yanit.status === 404) {
    throw new Error(
      "Fotoğraf çok büyük ya da adres bulunamadı. Daha küçük bir " +
        "fotoğrafla deneyiniz."
    );
  }

  let veri = null;

  try {
    veri = await yanit.json();
  } catch {
    /* Gövdesiz yanıt olabilir */
  }

  if (!yanit.ok) {
    throw new Error(veri?.hata ?? "Fotoğraf yüklenemedi.");
  }

  return veri;
};

/** Bugün doldurulabilecek kontrol listeleri */
/**
 * Personelin kendi özlük belgeleri (tutanak, ihtar, sözleşme).
 *
 * İK panelinden yüklenen evrakın bir kopyası kişinin kendisinde de
 * olmalı; personel kendi tutanağını görmek için İK'yı aramak zorunda
 * kalıyordu.
 */
/* ------------------------------------------------------------- etik hat */

/** Form seçenekleri: bildirim türleri, olay yerleri ve kişinin şubesi */
export const etikSecenekler = () => api.al("/api/Etik/Secenekler");

/**
 * Yeni bildirim.
 *
 * Çok parçalı gönderiliyor: ileride kanıt dosyası eklenecek ve gövde
 * biçimini o zaman değiştirmek, çalışan bir akışı yeniden kırardı.
 * Anonim seçildiğinde sunucu kimlik alanlarını hiç yazmıyor.
 */
export const etikAc = async (girdi) => {
  const form = new FormData();

  Object.entries(girdi).forEach(([anahtar, deger]) => {
    if (deger !== null && deger !== undefined)
      form.append(anahtar, String(deger));
  });

  const jeton = jetonOku();

  const cevap = await fetch(`${ADRES}/api/Etik`, {
    method: "POST",
    headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
    body: form,
  });

  const metin = await cevap.text();
  const veri = metin ? JSON.parse(metin) : null;

  if (!cevap.ok)
    throw new Error(veri?.hata ?? `Bildirim gönderilemedi (${cevap.status}).`);

  return veri;
};

/** Kimlikle açılmış bildirimler; anonimler burada görünmez */
export const etikBenim = () => api.al("/api/Etik/Benim");

/** Takip numarasıyla sorgulama; anonim bildirimin tek takip yolu */
export const etikSorgu = (numara) =>
  api.al(`/api/Etik/Sorgu/${encodeURIComponent(numara)}`);

export const etikMesaj = (numara, metin) =>
  api.gonder(`/api/Etik/Sorgu/${encodeURIComponent(numara)}/Mesaj`, { metin });

/* ------------------------------------------------------ eğitim dokümanları */

/** Personelin görebileceği eğitimler; zorunlu olanlar başta */
export const egitimlerimAl = () => api.al("/api/Egitim/Benim");

/** Bağlantı türü eğitimlerde okundu işareti */
export const egitimOkundu = (id) => api.gonder(`/api/Egitim/Okundu/${id}`, {});

/**
 * Eğitim dosyasının açılabilir adresi.
 *
 * Video ve PDF telefonun kendi görüntüleyicisinde açılıyor; o istek başlık
 * taşıyamadığı için belirteç adres satırında gidiyor.
 */
export const egitimAdresi = (id) => {
  const jeton = jetonOku();

  if (!id || !jeton) return "";

  return `${ADRES}/api/Egitim/Goster/${id}?t=${encodeURIComponent(jeton)}`;
};

/* ------------------------------------------------ sayfa yardım videoları */

/** Videosu olan sayfalar: { videolar: { Izin: 1790608812, ... } } */
export const yardimVideolariAl = () => api.al("/api/YardimVideo/Mobil");

/**
 * Yardım videosunun oynatılabilir adresi. Oynatıcı istek başlığı
 * gönderemediği için belirteç adres satırında; sürüm, video yenilenince
 * telefonun eski kopyayı göstermemesi için.
 */
export const yardimVideoAdresi = (kod, surum) => {
  const jeton = jetonOku();

  if (!kod || !jeton) return "";

  /* s: uygulama sürümü (1.6): sunucu sürüme özel videoyu seçiyor (yeni düğmeleri anlatan) */
  const s = encodeURIComponent(String(Constants.expoConfig?.version ?? ""));

  return `${ADRES}/api/YardimVideo/Izle/${encodeURIComponent(kod)}?t=${encodeURIComponent(jeton)}&v=${surum ?? 0}&s=${s}`;
};

/* --------------------------------------------------- haftalık izin günü */

/** Personelin kendi izin günü ve bekleyen talebi */
export const haftalikIznimAl = () => api.al("/api/HaftalikIzin/Benim");

/** Gün seçimi doğrudan geçerli olmuyor; mağaza müdürünün onayına düşüyor */
export const haftalikIzinSec = (gun, not) =>
  api.gonder("/api/HaftalikIzin/Sec", { gun, not });

/** Mağaza müdürünün onayını bekleyen talepler */
export const izinTalepleriAl = () => api.al("/api/HaftalikIzin/Bekleyenler");

export const izinTalebiOnayla = (id, onay, sebep) =>
  api.gonder(`/api/HaftalikIzin/Onay/${id}`, { onay, sebep });

/** Onayımı bekleyen yıllık izin talepleri; zincir organizasyon şemasından */
export const yillikIzinBekleyenlerAl = () => api.al("/api/IzinTalep/Mobil/Bekleyenler");

export const yillikIzinKarar = (id, onay, not) =>
  api.gonder(`/api/IzinTalep/Mobil/${id}/Karar`, { onay, not });

/** Yönetici eksik bildirir (26.10.2026, 2.0): talep reddedilmez, personel düzeltir, aynı adımdan devam eder (avans eksi kimlikle) */
export const yillikIzinEksikBildir = (id, aciklama) =>
  api.gonder(`/api/IzinTalep/Mobil/${id}/Eksik`, { aciklama });

/** Personelin kendi nöbetleri */
export const nobetlerimAl = () => api.al("/api/Nobet/Benim");

/** Bugün doğum günü mü; uygulamada kutlama penceresi için */
export const dogumGunuAl = () => api.al("/api/Mobil/DogumGunu");

export const belgelerimAl = () => api.al("/api/Mobil/Belgelerim");

/**
 * Belgenin tarayıcıda açılabilir adresi.
 *
 * Telefon belgeyi tarayıcıda açıyor ve o istek başlık taşıyamadığı için
 * belirteç adres satırında gidiyor; sunucu bu yolu yalnızca belge ve
 * görsel uçlarında kabul ediyor ve yalnızca kişinin kendi belgesini
 * veriyor.
 */
export const belgeAdresi = (id) => {
  const jeton = jetonOku();

  if (!id || !jeton) return "";

  return `${ADRES}/api/Mobil/BelgeGoster/${id}?t=${encodeURIComponent(jeton)}`;
};

/* ------------------------------------------------------ ücret pusulası */

/** Personelin ücret pusulaları ve durumları */
export const pusulalarimAl = () => api.al("/api/Mobil/Pusulalarim");

/**
 * Pusulanın tarayıcıda açılabilir adresi.
 *
 * Telefon PDF'i tarayıcıda açıyor ve o istek başlık taşıyamadığı için
 * belirteç adres satırında gidiyor; sunucu yalnızca kişinin kendi
 * pusulasını veriyor.
 */
export const pusulaAdresi = (id) => {
  const jeton = jetonOku();

  if (!id || !jeton) return "";

  return `${ADRES}/api/Mobil/PusulaGoster/${id}?t=${encodeURIComponent(jeton)}`;
};

/** Onay imza yerine geçiyor; geri alınamıyor */
export const pusulaOnayla = (id) =>
  api.gonder(`/api/Mobil/PusulaOnayla/${id}`, {});

export const pusulaItiraz = (id, sebep, aciklama) =>
  api.gonder(`/api/Mobil/PusulaItiraz/${id}`, { sebep, aciklama });

export const checklistlerimAl = () => api.al("/api/Mobil/Checklistlerim");

/** Bir listenin maddeleri ve verilmiş cevaplar */
export const checklistAl = (id) => api.al(`/api/Mobil/Checklist/${id}`);

/** Bir maddeyi cevaplar */
export const checklistCevapla = (checklistId, maddeId, cevap, yorum) =>
  api.gonder("/api/Mobil/ChecklistCevap", {
    checklistId,
    maddeId,
    cevap,
    yorum,
  });

/**
 * Bir maddeye fotoğraf ekler.
 *
 * <para>
 * Yükleme `FileSystem.uploadAsync` ile yapılıyor. Yeni mimaride FormData
 * artık `{uri, name, type}` biçimindeki dosya nesnesini kabul etmiyor ve
 * istek "Unsupported FormDataPart implementation" ile düşüyordu: liste
 * dolduruluyor ama fotoğraf hiç eklenemiyordu. uploadAsync dosyayı
 * platformun kendi yükleme akışıyla gönderiyor.
 * </para>
 *
 * <para>
 * Arıza fotoğrafı aynı yolu kullanıyor; iki akışın ayrı yöntemlerle
 * yüklemesi, birinde çıkan sorunun diğerinde fark edilmemesine yol
 * açıyordu.
 * </para>
 */
export const checklistGorselYukle = async (checklistId, maddeId, dosyaAdresi) => {
  /* Eski yol yedek olarak duruyor: uploadAsync'in bulunmadığı bir ortamda
     (web önizlemesi gibi) yükleme tamamen durmasın. */
  const eskiYol = () => {
    const form = new FormData();

    form.append("checklistId", String(checklistId));
    form.append("maddeId", String(maddeId));
    form.append("dosya", {
      uri: dosyaAdresi,
      name: `kontrol_${Date.now()}.jpg`,
      type: "image/jpeg",
    });

    return dosyaGonder("/api/Mobil/ChecklistGorsel", form);
  };

  if (!FileSystem?.uploadAsync) return eskiYol();

  let sonuc;

  try {
    sonuc = await FileSystem.uploadAsync(
      `${ADRES}/api/Mobil/ChecklistGorsel`,
      dosyaAdresi,
      {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "dosya",
        mimeType: "image/jpeg",
        parameters: {
          checklistId: String(checklistId),
          maddeId: String(maddeId),
        },
        headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
      }
    );
  } catch (hata) {
    /* Yükleyicinin kendisi çalışmadıysa eski yola düşülüyor; ağ hatası
       ise olduğu gibi yukarı çıkıyor. */
    if (`${hata?.message ?? ""}`.includes("uploadAsync")) return eskiYol();

    throw new Error(
      `Fotoğraf gönderilemedi (${hata?.message ?? "bilinmeyen"}).`
    );
  }

  if (sonuc.status === 401) throw await oturumDustu(sonuc);

  /* Dosya sunucunun sınırını aştığında IIS 404.13 ya da 413 dönüyor;
     bunu bağlantı hatasından ayırmak gerekiyor. */
  if (sonuc.status === 413 || sonuc.status === 404)
    throw new Error(
      "Fotoğraf çok büyük ya da adres bulunamadı. Daha küçük bir "
        + "fotoğrafla deneyiniz."
    );

  if (sonuc.status >= 200 && sonuc.status < 300) {
    try {
      return JSON.parse(sonuc.body || "{}");
    } catch {
      return {};
    }
  }

  let sebep = null;

  try {
    sebep = JSON.parse(sonuc.body || "{}")?.hata;
  } catch {
    /* Gövde JSON değilse durum kodu yeterli */
  }

  throw new Error(sebep ?? `Fotoğraf yüklenemedi (${sonuc.status}).`);
};

/* --------------------------------------------- Dönemsel değerlendirme (1.8) */

export const ekipDegerlendirmeAl = () => api.al("/api/DonemselDegerlendirme/Mobil/Ekip");

export const ekipDegerlendirmeFormAl = (kod) =>
  api.al(`/api/DonemselDegerlendirme/Mobil/Form/${encodeURIComponent(kod)}`);

export const ekipDegerlendirmeKaydet = (govde) => api.gonder("/api/DonemselDegerlendirme/Mobil/Kaydet", govde);

/* Bölge müdürü (26.10.2026): şubelerin değerlendirmeleri */
export const bolgeDegerlendirmeAl = () => api.al("/api/DonemselDegerlendirme/Mobil/Bolge");
export const bolgeSubeDegerlendirmeAl = (sube) =>
  api.al(`/api/DonemselDegerlendirme/Mobil/Bolge/Sube?sube=${encodeURIComponent(sube)}`);
export const bolgeKisiDegerlendirmeAl = (kod) =>
  api.al(`/api/DonemselDegerlendirme/Mobil/Bolge/Kisi/${encodeURIComponent(kod)}`);

/* --------------------------------------------------------- Kazan-Kazan */

export const kazanKazanAl = () => api.al("/api/KazanKazan/Ozet");

export const kazanKazanBarkod = (barkod) =>
  api.al(`/api/KazanKazan/BarkodKontrol?barkod=${encodeURIComponent(barkod)}`);

/**
 * Yeni ürün önerisi: alanlar ve görsel tek istekte. Yükleme checklist
 * fotoğrafıyla aynı yoldan (uploadAsync, yoksa FormData).
 */
export const kazanKazanOneri = async ({ urunAdi, barkod, neden }, dosyaAdresi) => {
  const uzanti = (String(dosyaAdresi).split("?")[0].split(".").pop() || "jpg").toLowerCase();
  const tur = uzanti === "png" ? "image/png" : uzanti === "pdf" ? "application/pdf" : uzanti === "mp4" ? "video/mp4" : "image/jpeg";
  const alanlar = { urunAdi, barkod, neden };

  const eskiYol = () => {
    const form = new FormData();
    Object.entries(alanlar).forEach(([k, v]) => form.append(k, String(v ?? "")));
    form.append("dosya", { uri: dosyaAdresi, name: `oneri_${Date.now()}.${uzanti}`, type: tur });
    return dosyaGonder("/api/KazanKazan/Oneri", form);
  };

  if (!FileSystem?.uploadAsync) return eskiYol();

  let sonuc;
  try {
    sonuc = await FileSystem.uploadAsync(`${ADRES}/api/KazanKazan/Oneri`, dosyaAdresi, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "dosya",
      mimeType: tur,
      parameters: alanlar,
      headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
    });
  } catch (hata) {
    if (`${hata?.message ?? ""}`.includes("uploadAsync")) return eskiYol();
    throw new Error(`Öneri gönderilemedi (${hata?.message ?? "bilinmeyen"}).`);
  }

  if (sonuc.status === 401) throw await oturumDustu(sonuc);
  if (sonuc.status === 413) throw new Error("Görsel çok büyük. Daha küçük bir dosyayla deneyiniz.");

  let govde = {};
  try {
    govde = JSON.parse(sonuc.body || "{}");
  } catch {
    /* JSON değil */
  }
  if (sonuc.status >= 200 && sonuc.status < 300) return govde;
  throw new Error(govde?.hata ?? `Öneri gönderilemedi (${sonuc.status}).`);
};

/* ------------------------------------------------------------- iş emri */

/** Bana atanan iş emirleri; acikSayi rozet için, yeniler açılır pencere için */
export const islerimAl = (tumu = false) =>
  api.al(`/api/Mobil/IsEmirlerim${tumu ? "?tumu=true" : ""}`);

export const isEmriGordum = (id) =>
  api.gonder(`/api/Mobil/IsEmriGordum/${id}`, {});

/**
 * İş içeriğini doldurur.
 *
 * Panelde kurulan çizelgenin kilitli olmayan hücreleri; ilerleme oranı
 * istemcide hesaplanıp gönderiliyor ki liste ekranı her açılışta JSON
 * ayrıştırmasın.
 */
/** Mobilden iş atanabilecek kişiler; yetki yoksa boş liste döner */
export const isAtanabileceklerAl = () => api.al("/api/Mobil/IsAtanabilecekler");

/** Mobilden iş atama; mağaza müdürü ve şefler kullanabiliyor */
export const isEmriAta = (girdi) => api.gonder("/api/Mobil/IsEmriAta", girdi);

export const isEmriDoldur = (id, doldurma, ilerleme) =>
  api.gonder(`/api/Mobil/IsEmriDoldur/${id}`, {
    doldurma: JSON.stringify(doldurma ?? {}),
    ilerleme: ilerleme ?? 0,
  });

export const isEmriBitir = (id, sonuc) =>
  api.gonder(`/api/Mobil/IsEmriBitir/${id}`, { sonuc });

/* ------------------------------------------------------------- yazarkasa */

/** Kendi yazarkasa kullanıcı kodu ve şifresi */
export const yazarkasaAl = () => api.al("/api/Mobil/Yazarkasa");

/** Dört haneli yeni şifre; denetim sunucuda da yapılır */
export const yazarkasaSifreYaz = (yeniSifre) =>
  api.gonder("/api/Mobil/YazarkasaSifre", { yeniSifre });

/* ---------------------------------------------------------- izin talebi */

export const talepTurleriAl = () => api.al("/api/IzinTalep/Turler");
export const taleplerimAl = () => api.al("/api/IzinTalep/Taleplerim");

/** Seçilen izin günlerinden kaçı bakiyeden düşer; tatil ve haftalık izin hariç */
export const izinGunHesabi = (ilk, son) =>
  api.al(`/api/IzinTalep/Mobil/GunHesabi?ilk=${ilk}&son=${son}`);

/* ---------------------------------------------------------- Puantaj / Ekibim */

export const puantajKapsamAl = () => api.al("/api/Ekip/Puantaj/Kapsam");

export const puantajSubelerAl = (tarih) => api.al(`/api/Ekip/Puantaj/Subeler?tarih=${tarih}`);

export const puantajListeAl = (tarih, sube) =>
  api.al(`/api/Ekip/Puantaj/Liste?tarih=${tarih}${sube ? `&sube=${encodeURIComponent(sube)}` : ""}`);

export const ekibimAl = () => api.al("/api/Ekip/Ekibim");

/* Fazla mesai (1.6): yönetici Ekibim › personel'den girer; form şubenin mailine gider */
export const fazlaMesaiKisiAl = (sicil) => api.al(`/api/FazlaMesai/Mobil/Kisi/${encodeURIComponent(sicil)}`);
export const fazlaMesaiGir = (veri) => api.gonder("/api/FazlaMesai/Mobil", veri);
export const fazlaMesaiIptal = (id) => api.gonder(`/api/FazlaMesai/Mobil/${id}/Iptal`, {});

/* Rotasyon (şube değişikliği) talebi (1.6): yönetici açar, personel yalnızca görür,
   yönetici isteğinde bölge müdürü onaylar */
export const rotasyonKisiAl = (sicil) => api.al(`/api/Rotasyon/Mobil/Kisi/${encodeURIComponent(sicil)}`);
export const rotasyonSecenekAl = (sicil) => api.al(`/api/Rotasyon/Mobil/Secenekler/${encodeURIComponent(sicil)}`);
export const rotasyonOlustur = (veri) => api.gonder("/api/Rotasyon/Mobil", veri);
export const rotasyonIptal = (id) => api.gonder(`/api/Rotasyon/Mobil/${id}/Iptal`, {});
export const rotasyonOnaylarAl = () => api.al("/api/Rotasyon/Mobil/Onaylar");
export const rotasyonKarar = (id, onay, not) => api.gonder(`/api/Rotasyon/Mobil/${id}/Karar`, { onay, not });

export const ekipKisiAl = (sicil, gun = 30, aralik = null) =>
  api.al(
    `/api/Ekip/Kisi/${encodeURIComponent(sicil)}?gun=${gun}` +
      (aralik?.bas ? `&bas=${aralik.bas}` : "") +
      (aralik?.bit ? `&bit=${aralik.bit}` : "")
  );

/**
 * Yönetici İşlemleri rozeti (1.7): onay bekleyen sayıları. Mevcut üç uçtan
 * (izin/fazla mesai/avans, haftalık gün, rotasyon); biri alınamazsa 0.
 */
export const yoneticiBekleyenSayisi = async () => {
  const [y, h, r] = await Promise.all([
    yillikIzinBekleyenlerAl().catch(() => null),
    izinTalepleriAl().catch(() => null),
    rotasyonOnaylarAl().catch(() => null),
  ]);

  const l = y?.talepler ?? [];
  const sonuc = {
    izin: l.filter((t) => t.tip !== "fazlamesai" && t.tip !== "avans").length,
    fazlamesai: l.filter((t) => t.tip === "fazlamesai").length,
    avans: l.filter((t) => t.tip === "avans").length,
    haftalik: (h?.talepler ?? []).length,
    rotasyon: (r?.kayitlar ?? []).length,
  };

  sonuc.toplam = sonuc.izin + sonuc.fazlamesai + sonuc.avans + sonuc.haftalik + sonuc.rotasyon;
  return sonuc;
};

/** Alt menü rozetini tazeleyen işlev (App kaydeder; onay verilince çağrılır) */
export const onayRozeti = { tazele: null };

/** Yönetici İşlemleri (1.7): dahil olunan izin, fazla mesai ve avans süreçleri */
export const yoneticiSurecAl = (gun = 60) => api.al(`/api/YoneticiIslem/Mobil/Surec?gun=${gun}`);

/* ------------------------------------------------------------ Vardiya planı */

const gunMetni = (t) =>
  t instanceof Date
    ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
    : t;

/* ------------------------------------------------------------- avans */

/** Avanslarım: devam eden, geçmiş, talep seçenekleri (maaş ve limit dönmez) */
export const avansAl = () => api.al("/api/Avans/Benim");

/** Yeni avans talebi; limit aşılırsa sunucunun uyarısı hata olarak döner */
export const avansTalep = (govde) => api.gonder("/api/Avans/Talep", govde);

/** İK karar vermeden talebi geri çeker */
export const avansIptal = (id) => api.gonder(`/api/Avans/${id}/Iptal`, {});

/** Müdürün ekibinin haftalık planı */
export const vardiyaEkipAl = (hafta) =>
  api.al(`/api/VardiyaPlan/Ekip${hafta ? `?hafta=${gunMetni(hafta)}` : ""}`);

/** Bir güne vardiya atar; akşamcı → sabahçı geçişi uyarı olarak döner */
export const vardiyaAta = (govde) =>
  api.gonder("/api/VardiyaPlan/Ata", { ...govde, gun: gunMetni(govde.gun) });

/** Taslak ve değişmiş planları personele bildirim olarak gönderir */
export const vardiyaGonder = (hafta, siciller) =>
  api.gonder("/api/VardiyaPlan/Gonder", { hafta: gunMetni(hafta), siciller: siciller ?? null });

/** Geçen haftanın planını bu haftaya kopyalar */
export const vardiyaGecenHafta = (hafta, siciller) =>
  api.gonder("/api/VardiyaPlan/GecenHafta", { hafta: gunMetni(hafta), siciller: siciller ?? null });

/** Personelin kendi haftalık planı */
export const vardiyaBenimAl = (hafta) =>
  api.al(`/api/VardiyaPlan/Benim${hafta ? `?hafta=${gunMetni(hafta)}` : ""}`);

/** Haftalık izin günü için özel durum bildirimi (yalnızca yöneticinin verdiği izin gününe) */
export const vardiyaOzelDurum = (izinGun, talepGun, aciklama) =>
  api.gonder("/api/VardiyaPlan/OzelDurum", {
    izinGun: gunMetni(izinGun),
    talepGun: talepGun ? gunMetni(talepGun) : null,
    aciklama,
  });

/** Yöneticinin yanıt bekleyen özel durum bildirimleri */
export const vardiyaOzelDurumlarAl = () => api.al("/api/VardiyaPlan/OzelDurumlar");

/** Özel durumu kabul (izin günü taşınır) ya da reddet */
export const vardiyaOzelDurumKarar = (id, kabul, yeniGun, not) =>
  api.gonder("/api/VardiyaPlan/OzelDurumKarar", {
    id,
    kabul,
    yeniGun: yeniGun ? gunMetni(yeniGun) : null,
    not: not ?? null,
  });

/** Ekip arkadaşının haftalık vardiyası: yalnızca gün ve saat */
export const vardiyaArkadasAl = (sicil, hafta) =>
  api.al(
    `/api/VardiyaPlan/Arkadas?sicil=${encodeURIComponent(sicil)}${hafta ? `&hafta=${gunMetni(hafta)}` : ""}`
  );

/** Bir günün bütün okutmaları: saat saat giriş/çıkış */
export const ekipGunAl = (sicil, tarih) =>
  api.al(`/api/Ekip/Kisi/${encodeURIComponent(sicil)}/Gun?tarih=${tarih}`);

/** Aynı günlerde şubeden kaç kişi izinli; isim verilmez */
export const izinCakisma = (cikis, donus) =>
  api.al(`/api/IzinTalep/Mobil/Cakisma?cikis=${cikis}&donus=${donus}`);

export const talepOlustur = (govde) => api.gonder("/api/IzinTalep", govde);

/** İzin süresince yerine bakabilecek kişiler: şubeden ya da departmandan */
export const yerineBakacaklarAl = () => api.al("/api/IzinTalep/YerineBakacaklar");

export const talepIptal = (id) =>
  api.gonder(`/api/IzinTalep/${id}`, null, "DELETE");

export const itirazOlustur = (govde) => api.gonder("/api/Mobil/Itiraz", govde);
export const itirazlarimAl = () => api.al("/api/Mobil/Itirazlarim");

/** Yöneticinin onayını bekleyen manuel giriş-çıkış talepleri */
export const manuelVardiyaBekleyenlerAl = () => api.al("/api/VardiyaDuzeltme/Bekleyenler");

/** Manuel giriş-çıkışı saat yazarak onayla ya da sebeple reddet */
export const manuelVardiyaKarar = (id, onay, saat, not) =>
  api.gonder("/api/VardiyaDuzeltme/Karar", { id, onay, saat: saat ?? null, not: not ?? null });

/**
 * Bildirim jetonunu sunucuya bildirir.
 *
 * 1.6: uygulama sürümü ve Biçen bildirim seslerinin (kanallarının) kurulu
 * olduğu da gidiyor. Sunucu Biçen sesini ve Android kanalını yalnızca
 * `sesler: true` bildiren cihaza gönderiyor; cihazda olmayan kanala giden
 * bildirim Android'de hiç görünmüyor.
 */
export const bildirimJetonuYaz = async (jeton, ek = {}) =>
  /* Dış hukuk danışmanı personel ucuna giremiyor; jetonu hukuk ucuna yazılır */
  (await hukukMu())
    ? api.gonder("/api/Hukuk/BildirimJetonu", { deger: jeton })
    : api.gonder("/api/Mobil/BildirimJetonu", { deger: jeton, ...ek });

/** Duyuru görseli; jeton gerekmez, kimlik taşımıyor */
export const duyuruGorselAdresi = (id) =>
  `${api.adres}/api/Mobil/DuyuruGorsel/${id}`;

/** Kurumsal renkli logo: sunucudaki, panellerin giriş ekranındakiyle aynı */
export const logoAdresi = () => `${api.adres}/api/Logo`;

/** Karekod okutulduğunda giriş ya da çıkış kaydı düşer */
export const vardiyaOkut = (kod, konum) =>
  api.gonder("/api/Mobil/VardiyaOkut", {
    kod,
    enlem: konum?.coords?.latitude ?? null,
    boylam: konum?.coords?.longitude ?? null,
  });

/* Künye analizi */
/* Künye şirketin kendi servisinden okunur; sunucu bizim fiyatı bulur */
export const kunyeOku = (kunye) =>
  api.al(`/api/Kunye/Oku?kunye=${encodeURIComponent(kunye)}`);

export const kunyeKaydet = (govde) => api.gonder("/api/Kunye/Kaydet", govde);

/* ---------------------------------------------- bekleyenler (ana sayfa) */

/**
 * Ana sayfa "Sizi bekleyenler" ve Ekibim etiketleri: kendi mazeret
 * belgeleri ve oryantasyon anketi; yöneticiyse ekibin bekleyenleri.
 */
export const gorevBekleyenlerAl = () => api.al("/api/Gorev/Bekleyenler");

/** İK'nın bildirdiği eksiği tamamladığını bildirir (07.10.2026) */
export const eksikTamamladim = (id, not) =>
  api.gonder(`/api/TalepEksik/Mobil/${id}/Tamamladim`, { not: not || null });

/**
 * Mazeret izni belgesini yükler. Dosya fotoğraf (kamera / galeri) ya da
 * PDF olabilir. Yükleme checklist fotoğrafıyla aynı yoldan:
 * `FileSystem.uploadAsync`, yoksa FormData.
 */
export const mazeretBelgeYukle = async (talepId, tur, dosya, kalem = null) => {
  const adres = `${ADRES}/api/IzinTalep/${talepId}/MazeretBelge`;
  const ad = dosya.ad ?? `belge_${Date.now()}.jpg`;
  const tip = dosya.tip ?? "image/jpeg";

  const eskiYol = async () => {
    const form = new FormData();

    form.append("tur", tur);
    if (kalem) form.append("kalem", kalem);
    form.append("dosya", { uri: dosya.uri, name: ad, type: tip });

    const cevap = await fetch(adres, {
      method: "POST",
      headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
      body: form,
    });

    const metin = await cevap.text();
    let veri = null;

    try {
      veri = metin ? JSON.parse(metin) : null;
    } catch {
      /* Gövde JSON değil */
    }

    if (!cevap.ok) throw new Error(veri?.hata ?? `Belge yüklenemedi (${cevap.status}).`);

    return veri;
  };

  if (!FileSystem?.uploadAsync) return eskiYol();

  let sonuc;

  try {
    sonuc = await FileSystem.uploadAsync(adres, dosya.uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "dosya",
      mimeType: tip,
      parameters: kalem ? { tur, kalem } : { tur },
      headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
    });
  } catch (hata) {
    if (`${hata?.message ?? ""}`.includes("uploadAsync")) return eskiYol();

    throw new Error(`Belge gönderilemedi (${hata?.message ?? "bilinmeyen"}).`);
  }

  if (sonuc.status === 401) throw await oturumDustu(sonuc);

  if (sonuc.status === 413 || sonuc.status === 404)
    throw new Error("Dosya çok büyük ya da adres bulunamadı. Daha küçük bir dosyayla deneyiniz.");

  let veri = {};

  try {
    veri = JSON.parse(sonuc.body || "{}");
  } catch {
    veri = {};
  }

  if (sonuc.status >= 200 && sonuc.status < 300) return veri;

  throw new Error(veri?.hata ?? `Belge yüklenemedi (${sonuc.status}).`);
};

/**
 * Avans belgesi (09.10.2026, 1.7): nedene göre istenen belge. Sunucuda
 * izin evrak ucu eksi kimliği avansa yönlendiriyor (1.6'nın evrak
 * penceresi de aynı yolu kullanıyor); yükleme kodu tek.
 */
export const avansBelgeYukle = (avansId, tur, dosya) => mazeretBelgeYukle(-Math.abs(avansId), tur, dosya, "destek");

/**
 * Raporlu izin (23.10.2026, 1.9): rapor belgesi ve tarihler tek istekte.
 * Yükleme mazeret belgesiyle aynı yoldan (uploadAsync, yoksa FormData).
 */
export const raporluTalepGonder = async ({ baslangic, bitis, iseBaslama, aciklama, dosya }) => {
  const adres = `${ADRES}/api/IzinTalep/Rapor`;
  const ad = dosya.ad ?? `rapor_${Date.now()}.jpg`;
  const tip = dosya.tip ?? "image/jpeg";
  const alanlar = { baslangic, bitis, iseBaslama, aciklama: aciklama ?? "" };
  const basliklar = {
    ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
    "X-Uygulama-Surum": String(Constants.expoConfig?.version ?? ""),
  };

  const coz = (durum, govde) => {
    let veri = {};
    try {
      veri = govde ? JSON.parse(govde) : {};
    } catch {
      veri = {};
    }
    if (durum >= 200 && durum < 300) return veri;
    if (durum === 413) throw new Error("Dosya çok büyük. Daha küçük bir fotoğrafla deneyiniz.");
    throw new Error([veri?.hata, veri?.ayrinti].filter(Boolean).join("\n") || `Gönderilemedi (${durum}).`);
  };

  const eskiYol = async () => {
    const form = new FormData();
    Object.entries(alanlar).forEach(([k, v]) => form.append(k, v));
    form.append("dosya", { uri: dosya.uri, name: ad, type: tip });
    const cevap = await fetch(adres, { method: "POST", headers: basliklar, body: form });
    return coz(cevap.status, await cevap.text());
  };

  if (!FileSystem?.uploadAsync) return eskiYol();

  let sonuc;
  try {
    sonuc = await FileSystem.uploadAsync(adres, dosya.uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "dosya",
      mimeType: tip,
      parameters: alanlar,
      headers: basliklar,
    });
  } catch (hata) {
    if (`${hata?.message ?? ""}`.includes("uploadAsync")) return eskiYol();
    throw new Error(`Rapor gönderilemedi (${hata?.message ?? "bilinmeyen"}).`);
  }

  if (sonuc.status === 401) throw await oturumDustu(sonuc);

  return coz(sonuc.status, sonuc.body);
};

/** Personel: ıslak imzalı aslını İK'ya gönderdiğini işaretler */
export const asilGonderildi = (talepId) => api.gonder(`/api/IzinTalep/${talepId}/AsilGonderildi`, {});

/** Doldurulmuş izin formu (PDF); tarayıcıda / PDF görüntüleyicide açılır */
export const izinFormuAdresi = (talepId) =>
  `${ADRES}/api/IzinTalep/${talepId}/FormDosya${jeton ? `?t=${encodeURIComponent(jeton)}` : ""}`;

/** Sunucu yolunu (ör. "/api/IzinTalep/5/ImzaliForm") oturumla açılacak tam adrese çevirir (09.10.2026) */
export const oturumluAdres = (yol) =>
  `${ADRES}${yol}${jeton ? `${yol.includes("?") ? "&" : "?"}t=${encodeURIComponent(jeton)}` : ""}`;

/** Yönetici: belgesini yüklemeyen ekip üyesine hatırlatma */
export const mazeretBelgeHatirlat = (talepId) =>
  api.gonder(`/api/IzinTalep/${talepId}/MazeretBelgeHatirlat`, {});

/* ------------------------------------------------------- oryantasyon */

/** Personelin anketi: SMS bağlantısının açtığı formla aynı uç (kodla) */
export const uyumAc = (kod) => api.al(`/api/Uyum/${encodeURIComponent(kod)}`);

export const uyumCevapla = (kod, govde) =>
  api.gonder(`/api/Uyum/${encodeURIComponent(kod)}/Cevap`, govde);

/** Yönetici değerlendirmesi (uygulamadan) */
export const oryantasyonDegerlendir = (govde) =>
  api.gonder("/api/Gorev/Oryantasyon/Degerlendir", govde);

/** Yönetici: anketini doldurmayan ekip üyesine hatırlatma */
export const oryantasyonHatirlat = (sicil) =>
  api.gonder(`/api/Gorev/Oryantasyon/Hatirlat?sicil=${encodeURIComponent(sicil)}`, {});

/** Mağazadaki güncel ve en düşük kullanılabilir sürüm (1.7, oturum gerekmez) */
export const uygulamaSurumAl = () => api.al("/api/UygulamaSurum/Mobil");

/* ========================================================================== */
/* Biçen'den Haberler (08.10.2026, 1.7)                                       */
/* ========================================================================== */

/** Akış: gönderiler, kategoriler, paylaşım yetkisi */
export const haberAkisAl = async (once) => {
  const v = await api.al(`/api/Haber/Akis${once ? `?once=${once}` : ""}`);
  return v ? { ...v, gonderiler: (v.gonderiler ?? []).map(haberKarti) } : v;
};

/* Görsel adresleri sunucudan göreli geliyor ("/api/Haber/Gorsel/…");
   Image bileşeni tam adres istiyor. */
const tamAdres = (x) => (typeof x === "string" && x.startsWith("/") ? `${ADRES}${x}` : x);

const haberKarti = (g) =>
  g
    ? {
        ...g,
        gorseller: (g.gorseller ?? []).map(tamAdres),
        /* Video (12.10.2026): aralıklı okumalı dosya adresi */
        video: g.video ? tamAdres(g.video) : null,
        /* Kurum logosu (09.10.2026) */
        yazar: g.yazar ? { ...g.yazar, foto: tamAdres(g.yazar.foto) } : g.yazar,
      }
    : g;

/** Gönderenin profili: "kurum" ya da sicil (09.10.2026) */
export const haberProfilAl = async (anahtar) => {
  const v = await api.al(`/api/Haber/Profil?anahtar=${encodeURIComponent(anahtar)}`);
  return v
    ? { ...v, profil: v.profil ? { ...v.profil, foto: tamAdres(v.profil.foto) } : v.profil, gonderiler: (v.gonderiler ?? []).map(haberKarti) }
    : v;
};

/** Ankette oy: güncel kart döner (yüzdeler oy verince görünüyor) */
export const haberOy = async (id, secenek) => {
  const v = await api.gonder(`/api/Haber/${id}/Oy`, { secenek });
  return haberKarti(v?.gonderi);
};

export const haberBegen = (id, begen) => api.gonder(`/api/Haber/${id}/Begen`, { begen });

export const haberYorumlarAl = (id) => api.al(`/api/Haber/${id}/Yorumlar`);

export const haberYorumYaz = (id, metin) => api.gonder(`/api/Haber/${id}/Yorum`, { metin });

export const haberBegenenlerAl = (id) => api.al(`/api/Haber/${id}/Begenenler`);

/** Gönderinin bir fotoğrafı (checklist fotoğrafıyla aynı yükleme yolu) */
const haberGorselYukle = async (id, sira, dosyaAdresi) => {
  const yol = `/api/Haber/${id}/Gorsel`;
  const eskiYol = () => {
    const form = new FormData();
    form.append("sira", String(sira));
    form.append("dosya", { uri: dosyaAdresi, name: `haber_${Date.now()}_${sira}.jpg`, type: "image/jpeg" });
    return dosyaGonder(yol, form);
  };

  if (!FileSystem?.uploadAsync) return eskiYol();

  const jeton = jetonOku();
  const sonuc = await FileSystem.uploadAsync(`${ADRES}${yol}`, dosyaAdresi, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "dosya",
    mimeType: "image/jpeg",
    parameters: { sira: String(sira) },
    headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
  });

  if (sonuc.status < 200 || sonuc.status >= 300) {
    let sebep = null;
    try {
      sebep = JSON.parse(sonuc.body || "{}")?.hata;
    } catch {
      /* gövde JSON değil */
    }
    throw new Error(sebep ?? `Fotoğraf gönderilemedi (${sonuc.status}).`);
  }
};

/**
 * Yeni gönderi: önce taslak açılıyor, fotoğraflar tek tek yükleniyor, en
 * son yayınlanıyor. Yükleme yarıda kalırsa taslak akışta görünmüyor.
 */
/**
 * Gönderi videosu (12.10.2026): 4 MB'lık parçalarla. IIS istek sınırı 20 MB;
 * parça dosyadan okunup geçici dosyaya yazılıyor ve o yükleniyor (FormData
 * bir dosyanın bir bölümünü gönderemiyor). Kopan parça iki kez yeniden
 * deneniyor.
 */
const VIDEO_PARCA = 4 * 1024 * 1024;

export const haberVideoYukle = async (id, video, ilerleme) => {
  if (!FileSystem?.uploadAsync || !FileSystem?.readAsStringAsync)
    throw new Error("Bu cihazda video yüklenemiyor.");

  let boyut = video.boyut;
  if (!boyut) {
    const bilgi = await FileSystem.getInfoAsync(video.uri, { size: true });
    boyut = bilgi?.size ?? 0;
  }
  if (!boyut) throw new Error("Video okunamadı.");

  const uzanti = (/\.(mp4|m4v|mov|webm)$/i.exec(video.ad ?? video.uri ?? "")?.[1] ?? "mp4").toLowerCase();
  const dosyaAdi = `haber_${Date.now()}.${uzanti}`;
  const toplam = Math.ceil(boyut / VIDEO_PARCA);
  const gecici = `${FileSystem.cacheDirectory}haber-video-parca.bin`;
  const jeton = jetonOku();
  let anahtar = "";

  for (let sira = 0; sira < toplam; sira++) {
    const konum = sira * VIDEO_PARCA;
    const uzunluk = Math.min(VIDEO_PARCA, boyut - konum);

    const b64 = await FileSystem.readAsStringAsync(video.uri, {
      encoding: FileSystem.EncodingType?.Base64 ?? "base64",
      position: konum,
      length: uzunluk,
    });
    await FileSystem.writeAsStringAsync(gecici, b64, { encoding: FileSystem.EncodingType?.Base64 ?? "base64" });

    let sonuc = null;
    for (let deneme = 0; deneme < 3; deneme++) {
      try {
        sonuc = await FileSystem.uploadAsync(`${ADRES}/api/Haber/${id}/VideoParca`, gecici, {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "parca",
          mimeType: "application/octet-stream",
          parameters: {
            anahtar,
            sira: String(sira),
            toplam: String(toplam),
            dosyaAdi,
            boyut: String(boyut),
            parcaBoyut: String(VIDEO_PARCA),
          },
          headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
        });
        if (sonuc.status >= 200 && sonuc.status < 300) break;
        if (sonuc.status >= 400 && sonuc.status < 500) break;
      } catch (h) {
        if (deneme === 2) throw new Error("Video gönderilemedi; bağlantınızı kontrol edin.");
      }
    }

    let govde = {};
    try {
      govde = JSON.parse(sonuc?.body || "{}");
    } catch {
      govde = {};
    }
    if (!sonuc || sonuc.status < 200 || sonuc.status >= 300)
      throw new Error(govde?.hata ?? `Video gönderilemedi (${sonuc?.status ?? "bağlantı"}).`);

    anahtar = govde.anahtar ?? anahtar;
    ilerleme?.((sira + 1) / toplam);
  }

  FileSystem.deleteAsync?.(gecici, { idempotent: true }).catch?.(() => undefined);
  return anahtar;
};

export const haberPaylas = async ({ gorseller, video, metin, kategori, yorumAcik, bildirim, ilerleme }) => {
  const t = await api.gonder("/api/Haber", { metin, kategori, yorumAcik });
  for (const [i, g] of (gorseller ?? []).entries()) await haberGorselYukle(t.id, i, g);
  if (video) await haberVideoYukle(t.id, video, ilerleme);
  return api.gonder(`/api/Haber/${t.id}/Yayinla`, { bildirim });
};

/* ========================================================================== */
/* Çalışan aydınlatma metni (08.10.2026, 1.7)                                 */
/* ========================================================================== */

/** Kişinin onayı bekleniyor mu; bekleniyorsa metin */
export const aydinlatmaAl = () => api.al("/api/Aydinlatma/Benim");

/** "Okudum, onaylıyorum": okunan sürüm ve metin özeti gönderilir */
export const aydinlatmaOnayla = (surum, ozet) => api.gonder("/api/Aydinlatma/Onayla", { surum, ozet });

/* ========================================================================== */
/* 1.9 (23.10.2026): mesajlar ve devamsızlık                                  */
/* ========================================================================== */

/**
 * Dosya ile çok parçalı istek (uploadAsync, yoksa FormData). Rapor
 * yüklemesiyle aynı yol; mesaj eki ve benzerleri için ortak.
 */
export const cokParcali = async (yol, alanlar, dosya) => {
  const adres = `${ADRES}${yol}`;
  const ad = dosya.ad ?? `dosya_${Date.now()}.jpg`;
  const tip = dosya.tip ?? "image/jpeg";
  const temiz = Object.fromEntries(Object.entries(alanlar ?? {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
  const basliklar = {
    ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
    "X-Uygulama-Surum": String(Constants.expoConfig?.version ?? ""),
  };

  const coz = async (durum, govde) => {
    let veri = {};
    try {
      veri = govde ? JSON.parse(govde) : {};
    } catch {
      veri = {};
    }
    if (durum >= 200 && durum < 300) return veri;
    if (durum === 401) throw await oturumDustu(veri);
    if (durum === 413) throw new Error("Dosya çok büyük; büyük dosyaları panelden gönderin.");
    throw new Error([veri?.hata, veri?.ayrinti].filter(Boolean).join("\n") || `Gönderilemedi (${durum}).`);
  };

  const eskiYol = async () => {
    const form = new FormData();
    Object.entries(temiz).forEach(([k, v]) => form.append(k, v));
    form.append("dosya", { uri: dosya.uri, name: ad, type: tip });
    const cevap = await fetch(adres, { method: "POST", headers: basliklar, body: form });
    return coz(cevap.status, await cevap.text());
  };

  if (!FileSystem?.uploadAsync) return eskiYol();

  let sonuc;
  try {
    sonuc = await FileSystem.uploadAsync(adres, dosya.uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "dosya",
      mimeType: tip,
      parameters: temiz,
      headers: basliklar,
    });
  } catch (hata) {
    if (`${hata?.message ?? ""}`.includes("uploadAsync")) return eskiYol();
    throw new Error(`Dosya gönderilemedi (${hata?.message ?? "bilinmeyen"}).`);
  }
  return coz(sonuc.status, sonuc.body);
};

/* ------------------------------------------------------------- mesajlar */

export const mesajSohbetleri = () => api.al("/api/Mesajlasma");
export const mesajKisileri = (q = "") => api.al(`/api/Mesajlasma/Kullanicilar?q=${encodeURIComponent(q)}`);
export const mesajlarAl = (id, { sonra, once } = {}) =>
  api.al(`/api/Mesajlasma/${id}/Mesajlar${sonra ? `?sonra=${sonra}` : once ? `?once=${once}` : ""}`);
export const mesajGonder = (id, metin, yanitId = null) => api.gonder(`/api/Mesajlasma/${id}/Mesaj`, { metin, yanitId });
export const mesajDosyaGonder = (id, dosya, metin = "", yanitId = null) =>
  cokParcali(`/api/Mesajlasma/${id}/Dosya`, { metin, yanitId }, dosya);
export const mesajOkundu = (id, sonId) => api.gonder(`/api/Mesajlasma/${id}/Okundu`, { sonId });
export const mesajSil = (mesajId) => api.gonder(`/api/Mesajlasma/Mesaj/${mesajId}`, null, "DELETE");
export const mesajDuzenle = (mesajId, metin) => api.gonder(`/api/Mesajlasma/Mesaj/${mesajId}`, { metin }, "PUT");
export const sohbetOlustur = (g) => api.gonder("/api/Mesajlasma", g);
export const sohbetUyeleri = (id) => api.al(`/api/Mesajlasma/${id}/Uyeler`);
export const sohbetSessiz = (id, sessiz) => api.gonder(`/api/Mesajlasma/${id}/Sessiz`, { sessiz });
export const sohbettenAyril = (id, ben) => api.gonder(`/api/Mesajlasma/${id}/Uye/${encodeURIComponent(ben)}`, null, "DELETE");
export const mesajOzet = (son = 0) => api.al(`/api/Mesajlasma/Ozet?son=${son}`);
/** Ek dosya adresi: Image/WebView başlık gönderemediği için jeton sorguda */
export const mesajDosyaAdresi = (mesajId, indir = false) =>
  `${ADRES}/api/Mesajlasma/Dosya/${mesajId}?t=${encodeURIComponent(jeton ?? "")}${indir ? "&indir=true" : ""}`;

/* --------------------------------------------------------- devamsızlık */

export const devamsizEkipAl = () => api.al("/api/Devamsizlik/Mobil/Ekip");
export const devamsizKisiAl = (sicil) => api.al(`/api/Devamsizlik/Mobil/Kisi/${encodeURIComponent(sicil)}`);
/* 26.10.2026: açıklama ve iki şahit zorunlu; sunucu tutanak üretip mail atıyor */
export const devamsizlikGir = (sicil, tarihler, aciklama, sahit1, sahit2) =>
  api.gonder(`/api/Devamsizlik/Mobil/Kisi/${encodeURIComponent(sicil)}`, { tarihler, aciklama, sahit1, sahit2 });
export const devamsizlikKaldir = (id) => api.gonder(`/api/Devamsizlik/Mobil/${id}`, null, "DELETE");
export const devamsizSahitlerAl = (sicil) => api.al(`/api/Devamsizlik/Mobil/Kisi/${encodeURIComponent(sicil)}/Sahitler`);

/* Devamsızlık tutanağı (26.10.2026): ana sayfa kartları, ayrıntı, şahit onayı, imzalı yükleme */
export const tutanakBekleyenlerAl = () => api.al("/api/Devamsizlik/Mobil/Tutanak/Bekleyenler");
export const tutanakAl = (id) => api.al(`/api/Devamsizlik/Mobil/Tutanak/${id}`);
export const tutanakSahitKarar = (id, onay, not) => api.gonder(`/api/Devamsizlik/Mobil/Tutanak/${id}/Sahit`, { onay, not });
export const tutanakImzaliYukle = (id, dosya) => cokParcali(`/api/Devamsizlik/Mobil/Tutanak/${id}/ImzaliForm`, {}, dosya);

/* ========================================================================== */
/* Denkleştirme (23.10.2026)                                                  */
/* ========================================================================== */

export const denklestirmeOzetAl = () => api.al("/api/Denklestirme/Mobil/Ozet");

/* Görevlendirme (26.10.2026): şirketin gönderdiği toplantı, seminer, eğitim…
   Onay bekleyenler İzin Onayları listesinde (tip: "gorevlendirme") */
export const gorevlendirmeAl = () => api.al("/api/Gorevlendirme/Mobil");
export const gorevlendirmeGir = (veri) => api.gonder("/api/Gorevlendirme/Mobil", veri);
export const gorevlendirmeIptal = (id) => api.gonder(`/api/Gorevlendirme/Mobil/${id}/Iptal`, {});
export const denklestirmeFormGonder = (veri) => api.gonder("/api/Denklestirme/Mobil/Form", veri);
export const denklestirmeIptal = (id) => api.gonder(`/api/Denklestirme/Mobil/${id}/Iptal`, {});
export const denklestirmeImzaliYukle = (id, dosya) => cokParcali(`/api/Denklestirme/Mobil/${id}/ImzaliForm`, {}, dosya);
export const denklestirmeOnayAl = () => api.al("/api/Denklestirme/Mobil/Onay");
export const denklestirmeKarar = (id, onay, not) => api.gonder(`/api/Denklestirme/Mobil/${id}/Karar`, { onay, not });
