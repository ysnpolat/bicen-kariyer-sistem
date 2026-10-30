/**
 * API istemcisi ve oturum yönetimi.
 *
 * Desen İK panelindeki api.ts ile aynı; adres belirleme sırası da öyle.
 * Oturum anahtarı farklı: iki panel aynı tarayıcıda açık olabilir ve
 * birinden çıkmak diğerini düşürmemeli.
 */

const SABIT_API_ADRESI = "";
const API_PORT = 5181;
const GELISTIRME_PORTLARI = ["5173", "5174", "5180"];

const temizle = (deger?: string | null): string =>
  (deger ?? "").trim().replace(/\/+$/, "");

const apiAdresiBelirle = (): string => {
  // 1. index.html içindeki meta etiketi (çalışma zamanı)
  const etiket = document.querySelector<HTMLMetaElement>('meta[name="api-taban"]');
  const metaDeger = temizle(etiket?.content);
  if (metaDeger) return metaDeger;

  // 2. Derleme değişkeni
  const cevre = temizle(import.meta.env.VITE_API_TABAN);
  if (cevre) return cevre;

  // 3. Elle tanımlanmış sabit
  if (SABIT_API_ADRESI) return temizle(SABIT_API_ADRESI);

  // 4. Geliştirme sunucusu
  const { protocol, hostname, port } = window.location;
  if (GELISTIRME_PORTLARI.includes(port)) return `${protocol}//${hostname}:${API_PORT}`;

  /* 5. Aynı alan adı.
     Panel /portal altinda, API /portalservis altinda yayinlaniyor.
     Kok yol dondurulseydi istekler /api/... adresine gider ve orada
     Kariyer API'si duruyor. */
  return "/portalservis";
};

export const API_TABAN = apiAdresiBelirle();

/**
 * Kurum logosu API üzerinden tek bir yerden yayınlanır:
 * Bicen360.API/wwwroot/logo.png
 */
export const LOGO_ADRESI = `${API_TABAN}/api/Logo`;

const OTURUM_ANAHTARI = "bicen360_oturum";

export interface Oturum {
  id: number;
  jeton: string;
  kullaniciAdi: string;
  adSoyad: string;
  rol: string;
  gecerlilikSonu: string;

  /** Açılabilecek panel sayfaları; menü buna göre kurulur */
  sayfalar: string[];

  /** Şube kullanıcısının şubesi; kilit yoksa boş. Asıl kilit sunucuda. */
  sube?: string | null;

  /** Portal rolü (Yönetim › Roller); atanmamışsa boş */
  portalRol?: string | null;
}

export const oturumOku = (): Oturum | null => {
  try {
    const ham = localStorage.getItem(OTURUM_ANAHTARI);
    if (!ham) return null;

    const oturum = JSON.parse(ham) as Oturum;

    /* Süresi dolmuş oturumla açılan panel, her istekte 401 alıp anlamsız
       hatalar gösteriyor. Baştan giriş ekranına düşmek daha anlaşılır. */
    if (new Date(oturum.gecerlilikSonu) <= new Date()) {
      localStorage.removeItem(OTURUM_ANAHTARI);
      return null;
    }

    return oturum;
  } catch {
    return null;
  }
};

export const oturumYaz = (oturum: Oturum) =>
  localStorage.setItem(OTURUM_ANAHTARI, JSON.stringify(oturum));

export const oturumSil = () => localStorage.removeItem(OTURUM_ANAHTARI);

export const adminMi = (o: Oturum | null) => o?.rol === "Admin";

/** Sayfa bu kullanıcıya açık mı. Asıl denetim sunucuda. */
export const sayfaAcik = (o: Oturum | null, kod: string) =>
  (o?.sayfalar ?? []).includes(kod);

/* ------------------------------------------------------------------ istek */

class YetkiHatasi extends Error {}

async function istek<T>(yol: string, secenek: RequestInit = {}): Promise<T> {
  const oturum = oturumOku();

  let yanit: Response;

  try {
    yanit = await fetch(`${API_TABAN}/api/${yol}`, {
      ...secenek,
      headers: {
        "Content-Type": "application/json",
        ...(oturum ? { Authorization: `Bearer ${oturum.jeton}` } : {}),
        ...(secenek.headers ?? {}),
      },
    });
  } catch {
    /* fetch yalnızca ağ seviyesinde başarısız olunca hata fırlatır:
       sunucu kapalı, adres yanlış ya da CORS engeli. Bunları ayırt
       edemiyoruz ama nereye gitmeye çalıştığımızı söyleyebiliriz. */
    throw new Error(
      `Sunucuya bağlanılamadı: ${API_TABAN || window.location.origin}. ` +
        "API çalışıyor mu ve adres doğru mu kontrol ediniz.",
    );
  }

  if (yanit.status === 401) {
    oturumSil();
    window.location.reload();
    throw new YetkiHatasi("Oturumunuz sona erdi.");
  }

  if (!yanit.ok) {
    /* Durum kodu mesaja yazılıyor: "İşlem tamamlanamadı" tek başına
       sorunun sunucuda mı, adreste mi, yetkide mi olduğunu gizliyordu. */
    const varsayilan =
      yanit.status === 403
        ? "Bu işlem için yetkiniz yok (403)."
        : yanit.status === 404
        ? `Servis bulunamadı (404). API adresi: ${API_TABAN || "aynı alan adı"}`
        : yanit.status >= 500
        ? `Sunucuda bir sorun oluştu (${yanit.status}). Ayrıntı için sunucu günlüğüne bakınız.`
        : `İşlem tamamlanamadı (${yanit.status}).`;

    let mesaj = varsayilan;

    /* IIS uygulama açılışta çökerse kendi HTML hata sayfasını döndürüyor
       ve gövde JSON olmuyor. Bu durumda sunucudaki hata sarmalayıcısı hiç
       çalışmamış demektir; sorun kodda değil barındırmada. Bunu söylemek,
       "sunucu günlüğüne bakınız" demekten çok daha yardımcı. */
    const tur = yanit.headers.get("content-type") ?? "";

    if (!tur.includes("json")) {
      throw new Error(
        `API yanıt vermiyor (${yanit.status}). ` +
          `Uygulama ${API_TABAN || "bu adreste"} altında ayağa kalkmamış olabilir; ` +
          "sunucuda portalservis\\logs klasöründeki stdout dosyasına bakınız.",
      );
    }

    try {
      const govde = await yanit.json();

      /* ASP.NET model doğrulaması ProblemDetails döndürüyor: alan adı
         "hata" değil "errors" oluyor ve mesaj kayboluyordu. */
      const alanHatalari = govde?.errors
        ? Object.values(govde.errors as Record<string, string[]>)
            .flat()
            .join(" ")
        : null;

      /* "hata" ne olduğunu, "ayrinti" nedenini söylüyor. Kurulum
         sorunlarında asıl işe yarayan ikincisi; ikisi birden gösteriliyor. */
      const ana =
        govde?.hata ?? alanHatalari ?? govde?.detail ?? govde?.title ?? null;

      mesaj = ana
        ? govde?.ayrinti && govde.ayrinti !== ana
          ? `${ana} ${govde.ayrinti}`
          : ana
        : govde?.ayrinti ?? varsayilan;
    } catch {
      /* Gövdesi olmayan ya da HTML dönen hata; varsayılan mesaj kalır */
    }

    throw new Error(mesaj);
  }

  if (yanit.status === 204) return undefined as T;

  return (await yanit.json()) as T;
}

/** Tam adresle istek; api.disGetir ve kardeşleri bunu kullanıyor */
async function disIstek<T>(adres: string, ayar: RequestInit = {}): Promise<T> {
  const oturum = oturumOku();

  const yanit = await fetch(adres, {
    ...ayar,
    headers: {
      "Content-Type": "application/json",
      ...(oturum ? { Authorization: `Bearer ${oturum.jeton}` } : {}),
      ...(ayar.headers ?? {}),
    },
  });

  const metin = await yanit.text();
  const veri = metin ? JSON.parse(metin) : null;

  if (!yanit.ok)
    /* Durum kodu her zaman metne giriyor: 404 "uç yok", 403 "yetki yok"
       demek ve ikisi farklı çözüm istiyor. Yalnızca sunucunun gönderdiği
       metni göstermek bu ayrımı kaybediyordu. */
    throw new Error(
      `${veri?.hata ?? "İstek başarısız"} (${yanit.status} · ${adres})`
    );

  return veri as T;
}

export const api = {
  getir: <T>(yol: string) => istek<T>(yol),

  gonder: <T>(yol: string, govde: unknown) =>
    istek<T>(yol, { method: "POST", body: JSON.stringify(govde) }),

  sil: <T>(yol: string) => istek<T>(yol, { method: "DELETE" }),

  /**
   * Çok parçalı gönderim (görsel yükleme).
   *
   * Genel istek yardımcısı her isteğe `Content-Type: application/json`
   * koyuyor; çok parçalı gövdede bu başlık sınır bilgisini eziyor ve
   * sunucu dosyayı hiç göremiyor. Burada başlık bilinçli verilmiyor,
   * tarayıcı kendisi yazıyor.
   */
  /* Başka bir servise istek: kontrol listesi uçları Kariyer API'sinde
     duruyor ve çalışan bir modülü bölmek yerine oraya bağlanılıyor.
     İki API de aynı jetonu doğruluyor. */
  disGetir: <T,>(adres: string) => disIstek<T>(adres),

  disGonder: <T,>(adres: string, govde: unknown) =>
    disIstek<T>(adres, { method: "POST", body: JSON.stringify(govde) }),

  disSil: <T,>(adres: string) => disIstek<T>(adres, { method: "DELETE" }),

  dosyaGonder: async <T,>(yol: string, form: FormData): Promise<T> => {
    const oturum = oturumOku();

    const yanit = await fetch(`${API_TABAN}/api/${yol}`, {
      method: "POST",
      headers: oturum ? { Authorization: `Bearer ${oturum.jeton}` } : {},
      body: form,
    });

    const metin = await yanit.text();
    const veri = metin ? JSON.parse(metin) : null;

    if (!yanit.ok)
      throw new Error(veri?.hata ?? `Yükleme başarısız (${yanit.status})`);

    return veri as T;
  },
};
