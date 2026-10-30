/**
 * API istemcisi ve oturum yönetimi.
 * API adresi sabitler bölümünden değiştirilebilir.
 */

/**
 * ---------------------------------------------------------------------------
 * API adresinin belirlenmesi
 * ---------------------------------------------------------------------------
 * Sıra ile şu kurallar uygulanır:
 *
 *  1. index.html içindeki <meta name="api-taban" content="..."> etiketi.
 *     Yayınlama betiği bu değeri kendisi yazar. Sunucuda yol değişirse
 *     yeniden derlemeye gerek kalmadan index.html düzenlenebilir.
 *  2. Derleme sırasında tanımlı VITE_API_TABAN değeri (.env.production).
 *  3. Aşağıdaki SABIT_API_ADRESI sabiti.
 *  4. Sayfa geliştirme sunucusunda açıldıysa aynı makinenin 5177 portu.
 *  5. Hiçbiri yoksa aynı alan adına göreli istek: /api/...
 * ---------------------------------------------------------------------------
 */
const SABIT_API_ADRESI = "";
const API_PORT = 5177;
const GELISTIRME_PORTLARI = ["5173", "5174", "5178", "5179"];

const temizle = (deger?: string | null): string =>
  (deger ?? "").trim().replace(/\/+$/, "");

const apiAdresiBelirle = (): string => {
  // 1. index.html içindeki meta etiketi (çalışma zamanı)
  const etiket = document.querySelector<HTMLMetaElement>('meta[name="api-taban"]');
  const metaDeger = temizle(etiket?.content);
  if (metaDeger) return metaDeger;

  // 2. Derleme değişkeni. Vite bu ifadeyi metin olarak yerine koyduğu için
  //    kalıbın aynen "import.meta.env.VITE_API_TABAN" olması zorunludur.
  const cevre = temizle(import.meta.env.VITE_API_TABAN);
  if (cevre) return cevre;

  // 3. Elle tanımlanmış sabit
  if (SABIT_API_ADRESI) return temizle(SABIT_API_ADRESI);

  // 4. Geliştirme sunucusu
  const { protocol, hostname, port } = window.location;
  if (GELISTIRME_PORTLARI.includes(port)) {
    return `${protocol}//${hostname}:${API_PORT}`;
  }

  // 5. Aynı alan adı
  return "";
};

export const API_TABAN = apiAdresiBelirle();

/**
 * Kurum logosu API üzerinden tek bir yerden yayınlanır:
 * BicenKariyer.API/wwwroot/logo.png
 */
export const LOGO_ADRESI = `${API_TABAN}/api/Logo`;

const OTURUM_ANAHTARI = "bicen_ik_oturum";

export interface Oturum {
  /** Rolün ayardan gelen yetkileri; menü ve düğme kısıtlaması için */
  yetki?: {
    menuler?: string[];
    saltOkunur?: boolean;
    gizliAlanlar?: string[];
    gizliSekmeler?: string[];
  };

  /** Kullanıcı kimliği; sınırlı ekranların denetiminde kullanılır */
  id?: number;
  token: string;
  kullaniciAdi: string;
  adSoyad: string;
  rol: string;
  gecerlilikSonu: string;
  /** İşe alım onayı verebilir mi */
  onayYetkisi?: boolean;

  /** Başka bir kullanıcı adına açılmış oturumda gerçek kişinin adı */
  taklitEden?: string;

  /** Taklit öncesi kendi oturumu; geri dönmek için saklanır */
  oncekiOturum?: Oturum | null;
}

/* -------------------------------------------------------------------------- */
/* Oturum                                                                      */
/* -------------------------------------------------------------------------- */

export const oturumOku = (): Oturum | null => {
  try {
    const ham = localStorage.getItem(OTURUM_ANAHTARI);
    if (!ham) return null;
    const oturum = JSON.parse(ham) as Oturum;
    if (new Date(oturum.gecerlilikSonu) < new Date()) {
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

export const adminMi = (oturum: Oturum | null) => oturum?.rol === "Admin";

/** Biçen'den Haberler yönetimi: sunucudaki HaberController panel rolleriyle aynı */
export const haberYonetimi = (o: Oturum | null) => {
  const izinli = ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"];
  if (izinli.includes(o?.rol ?? "")) return true;
  /* Özel rollerde oturum.rol özel koddur; temel rol belirteçte ek rol olarak durur */
  return belirtecRolleri(o).some((r) => izinli.includes(r));
};

/** JWT içindeki rol hakları (özel rolün temel rolü dahil) */
export const belirtecRolleri = (o?: Oturum | null): string[] => {
  if (!o?.token) return [];
  try {
    const govde = o.token.split(".")[1];
    if (!govde) return [];
    const duz = govde.replace(/-/g, "+").replace(/_/g, "/");
    const veri = JSON.parse(
      decodeURIComponent(
        atob(duz)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      )
    );
    const ham = veri["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"] ?? veri.role ?? [];
    return (Array.isArray(ham) ? ham : [ham]).map(String);
  } catch {
    return [];
  }
};

/** İK yöneticisi ya da yönetici: havuzdan çıkarma gibi uzmanın yapamadığı işler */
export const ikYoneticisiMi = (o: Oturum | null) =>
  o?.rol === "Admin" || o?.rol === "IKYoneticisi";

/**
 * Çıkış anketi gönderme yetkisi.
 *
 * Listeyi görmek İK uzmanına da açık; göndermek değil. Her davet bir SMS
 * harcıyor ve şirket adına ayrılmış bir kişiye mesaj gidiyor.
 */
export const anketGonderme = (o?: Oturum | null) =>
  o?.yetki?.saltOkunur !== true &&
  o?.rol === "Admin" || o?.rol === "IKYoneticisi";

/** Bölge müdürü: yalnızca kendi şubelerini görür, durum değiştiremez */
export const bolgeMuduruMu = (oturum: Oturum | null) =>
  oturum?.rol === "BolgeMuduru";

/** Durum değiştirme, işe alım ve rotasyon yetkisi */
/**
 * Belirteç içindeki kullanıcı kimliğini okur.
 *
 * Oturum yanıtındaki `id` alanı sonradan eklendi; eski oturumlarda bulunmaz.
 * Belirteçte ise baştan beri var, bu yüzden önce oradan okunur.
 */
export const kullaniciKimligi = (o?: Oturum | null): number => {
  if (o?.id) return o.id;
  if (!o?.token) return 0;

  try {
    const govde = o.token.split(".")[1];
    if (!govde) return 0;

    /* JWT base64url kullanır; standart base64'e çevrilir */
    const duz = govde.replace(/-/g, "+").replace(/_/g, "/");
    const cozulmus = decodeURIComponent(
      atob(duz)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );

    const veri = JSON.parse(cozulmus);

    /* .NET bu hakkı uzun URL adıyla yazar */
    const ham =
      veri["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] ??
      veri.nameid ??
      veri.sub;

    return Number(ham) || 0;
  } catch {
    return 0;
  }
};

/**
 * Yapay zekâ inceleme ekranı yalnızca sistem yöneticisine açıktır.
 * Engellenen başvurularda aday fotoğrafı ve tüm form verisi bulunur.
 */
export const incelemeYetkisi = (o?: Oturum | null) =>
  kullaniciKimligi(o) === 1;

/**
 * Tarih ve saati sunucuya YEREL saat olarak gönderir.
 *
 * `toISOString()` değeri UTC'ye çevirir: Türkiye UTC+3 olduğu için
 * kullanıcının seçtiği 14:00 sunucuya 11:00 olarak gidiyor ve ekranda
 * farklı bir saat görünüyordu. Bu yardımcı saati olduğu gibi bırakır.
 *
 * Dönen biçim: 2026-08-28T14:00:00
 */
export const yerelZaman = (d: unknown): string | null => {
  const t = d as { format?: (k: string) => string } | null | undefined;

  if (!t?.format) return null;

  return t.format("YYYY-MM-DDTHH:mm:ss");
};

/**
 * Yönetim raporu: 1 numaralı kullanıcı ve yönetici rolleri.
 *
 * İnceleme ekranından farklıdır — orası yalnızca sistem yöneticisine
 * açıktır çünkü aday fotoğrafı ve ham form verisi içerir.
 */
export const yonetimRaporu = (o?: Oturum | null) =>
  kullaniciKimligi(o) === 1 ||
  o?.rol === "Admin" ||
  o?.rol === "GenelMudurYardimcisi";

/**
 * İzin düzenleme yetkisi. Görüntüleme daha geniştir: bölge müdürü kendi
 * şubesindeki izinleri görebilmeli ama girememelidir.
 */
export const izinDuzenleme = (o?: Oturum | null) =>
  o?.yetki?.saltOkunur !== true &&
  o?.rol === "Admin" || o?.rol === "IKYoneticisi" || o?.rol === "IK";

/**
 * Sayfa içi bölüm bu role gizli mi.
 *
 * Panelde gizlemek görsel bir kolaylıktır; verinin kendisi sunucuda
 * korunur. Bölüm içinde hassas veri varsa sunucu tarafındaki alan
 * maskelemesi de ayarlanmalıdır.
 */
export const sekmeGizli = (o: Oturum | null, kod: string) =>
  o?.yetki?.gizliSekmeler?.includes(kod) === true;

/** Yalnızca personel fotoğrafı yükleyebilen sınırlı rol */
export const yalnizcaFotograf = (o?: Oturum | null) =>
  o?.rol === "FotografGorevlisi";

/** Personel fotoğrafı yükleme yetkisi */
export const fotografYukleme = (o?: Oturum | null) =>
  ["Admin", "IK", "IKYoneticisi", "FotografGorevlisi"].includes(o?.rol ?? "");

/**
 * Kayıt ekleyip değiştirebilir mi.
 *
 * Rol yetkilerinde "yalnızca görüntüleyebilir" işaretliyse bu izin
 * geçersiz olur. Panelde tek noktadan denetlendiği için düğmeler her
 * ekranda birden gizlenir; asıl koruma sunucudadır.
 */
export const islemYetkisi = (oturum: Oturum | null) =>
  ["Admin", "IK", "IKYoneticisi"].includes(oturum?.rol ?? "") &&
  oturum?.yetki?.saltOkunur !== true;

/**
 * Rol kodu → görünen ad.
 *
 * Kodda sabit roller burada duruyor; panelden açılan roller giriş
 * yapıldıktan sonra `rolAdlariniYaz` ile aynı nesneye ekleniyor. Nesne
 * yerinde güncelleniyor, yenisiyle değiştirilmiyor: ekranların çoğu bunu
 * doğrudan içe aktarıyor ve yeni bir nesne oralara ulaşmazdı.
 */
export const ROL_ADLARI: Record<string, string> = {
  FotografGorevlisi: "Fotoğraf Görevlisi",
  Admin: "Yönetici",
  GenelMudurYardimcisi: "Genel Müdür Yardımcısı",
  IKYoneticisi: "İK Yöneticisi",
  IK: "İK Uzmanı",
  BolgeKoordinatoru: "Bölge Koordinatörü",
  BolgeMuduru: "Bölge Müdürü",
};

/** Sunucudan gelen rol tanımı. */
export type RolTanimi = {
  kod: string;
  ad: string;
  ozel: boolean;
  temel?: string | null;
  aciklama?: string | null;
};

/** Panelden açılan rolleri ad listesine ekler. */
export const rolAdlariniYaz = (roller: RolTanimi[]) => {
  (roller ?? []).forEach((r) => {
    if (r?.kod) ROL_ADLARI[r.kod] = r.ad || r.kod;
  });
};

/** Tanımlı roller ve temel olarak seçilebilecekler. */
export const rolleriGetir = () =>
  api.al<{ roller: RolTanimi[]; temeller: { kod: string; ad: string }[] }>(
    "/api/Ayar/Roller"
  );

/* -------------------------------------------------------------------------- */
/* Yetkiler                                                                    */
/*                                                                             */
/* Sunucudaki Roller sınıfıyla aynı kuralları uygular. Arayüzü buna göre       */
/* şekillendirmek içindir; asıl denetim her zaman sunucuda yapılır.            */
/* -------------------------------------------------------------------------- */

const rolAl = (oturum: Oturum | null): string => oturum?.rol ?? "";

/** Norm kadro ve maaş skalasını düzenleyebilir */
export const kadroDuzenleme = (oturum: Oturum | null): boolean =>
  ["Admin", "GenelMudurYardimcisi"].includes(rolAl(oturum));

/** Norm kadroda değişiklik önerebilir (onaya gider) */
export const kadroOnerme = (oturum: Oturum | null): boolean =>
  rolAl(oturum) === "IKYoneticisi";

/** İK performans ekranını görebilir */
export const performansGorme = (oturum: Oturum | null): boolean =>
  ["Admin", "GenelMudurYardimcisi"].includes(rolAl(oturum));

/** Adayın kimlik bilgilerini görebilir */
export const ozelVeriGorme = (oturum: Oturum | null): boolean =>
  !["BolgeMuduru", "BolgeKoordinatoru"].includes(rolAl(oturum));

/** Sağ üstte bölge seçicisi gösterilir */
export const bolgeSecici = (oturum: Oturum | null): boolean =>
  ["Admin", "GenelMudurYardimcisi", "BolgeKoordinatoru"].includes(rolAl(oturum));

/** Yönetim ekranının tamamını görebilir */
export const tamYonetim = (oturum: Oturum | null): boolean =>
  ["Admin", "GenelMudurYardimcisi"].includes(rolAl(oturum));

/** Yalnızca form ayarlarını görebilir */
export const formAyari = (oturum: Oturum | null): boolean =>
  ["IK", "IKYoneticisi"].includes(rolAl(oturum));

/** Başvurular yerine özet ekranı görür */
export const ozetEkrani = (oturum: Oturum | null): boolean =>
  rolAl(oturum) === "BolgeMuduru";

/** Başka bir kullanıcı adına görüntüleme yapılıyor mu */
export const taklitModu = (oturum: Oturum | null): boolean =>
  !!oturum?.taklitEden;

/** Başka kullanıcı olarak giriş yapabilir mi */
export const kullaniciOlabilir = (oturum: Oturum | null): boolean =>
  ["Admin", "GenelMudurYardimcisi"].includes(oturum?.rol ?? "") &&
  !taklitModu(oturum);

/**
 * Yalnızca görüntüleme yapabilen roller.
 *
 * İki kaynak birleşir: koddaki varsayılan (bölge müdürü ve koordinatör)
 * ve Yönetim → Rol Yetkileri'nden ayarlanan işaret. Ayar yalnızca
 * kısıtlama ekler; koddaki bir kısıtlamayı kaldırmaz.
 */
export const saltOkunur = (oturum: Oturum | null): boolean =>
  oturum?.yetki?.saltOkunur === true ||
  ["BolgeMuduru", "BolgeKoordinatoru"].includes(rolAl(oturum));

/* -------------------------------------------------------------------------- */
/* Bölge seçimi                                                                */
/*                                                                             */
/* Yetkisi olan kullanıcılar sağ üstten bölge seçer; seçim tarayıcıda saklanır */
/* ve her istekte sunucuya iletilir. Boş liste "tümü" demektir.                */
/* -------------------------------------------------------------------------- */

const BOLGE_ANAHTARI = "bicen-secili-bolgeler";

export const secilenBolgeler = (): string[] => {
  try {
    const ham = window.localStorage.getItem(BOLGE_ANAHTARI);
    return ham ? JSON.parse(ham) : [];
  } catch {
    return [];
  }
};

export const bolgeleriYaz = (bolgeler: string[]): void => {
  try {
    if (bolgeler.length === 0) {
      window.localStorage.removeItem(BOLGE_ANAHTARI);
    } else {
      window.localStorage.setItem(BOLGE_ANAHTARI, JSON.stringify(bolgeler));
    }
  } catch {
    // Depolama kapalıysa seçim yalnızca bu oturumda geçerli olur
  }
};

/* -------------------------------------------------------------------------- */
/* İstek                                                                       */
/* -------------------------------------------------------------------------- */

const istek = async <T,>(
  yol: string,
  secenek: RequestInit = {},
  gonderi?: unknown
): Promise<T> => {
  const oturum = oturumOku();
  const bolgeler = secilenBolgeler();

  const cevap = await fetch(`${API_TABAN}${yol}`, {
    ...secenek,
    headers: {
      "Content-Type": "application/json",
      ...(oturum ? { Authorization: `Bearer ${oturum.token}` } : {}),
      /* Bölge seçicisinde seçim varsa sunucu verileri buna göre süzer */
      ...(bolgeler.length > 0
        ? { "X-Bolge": bolgeler.map(encodeURIComponent).join(",") }
        : {}),
      ...(secenek.headers ?? {}),
    },
    body: gonderi !== undefined ? JSON.stringify(gonderi) : secenek.body,
  });

  /* Giriş denemesinde 401, hatalı parola demektir; oturum düşmüş sayılmaz.
     Aksi hâlde sayfa yenilenir ve kullanıcı hatayı hiç göremez. */
  const girisDenemesi = yol.startsWith("/api/Auth/Giris");

  if (cevap.status === 401 && !girisDenemesi) {
    /* Oturum zaten yoksa yenileme yapılmaz.
       Çıkış anında arka planda süren istekler (bildirim, görüşme takibi)
       401 alır; her biri sayfayı yenilemeye kalkarsa ekran yarıda kesilir
       ve beyaz kalır. */
    const vardi = !!oturumOku();

    oturumSil();

    if (vardi) window.location.reload();

    throw new Error("Oturum süresi doldu. Lütfen tekrar giriş yapınız.");
  }

  const metin = await cevap.text();
  const veri = metin ? JSON.parse(metin) : null;

  if (!cevap.ok) {
    // Sunucu ayrıntı gönderdiyse mesaja eklenir; sorunun sebebi görünür olur
    const mesaj = veri?.hata ?? `İşlem başarısız (${cevap.status})`;
    throw new Error(veri?.ayrinti ? `${mesaj}\n\n${veri.ayrinti}` : mesaj);
  }

  return veri as T;
};

export const api = {
  al: <T,>(yol: string) => istek<T>(yol),
  /**
   * Personel fotoğrafının doğrudan adresi.
   * Görsel etiketi başlık gönderemediği için belirteç adrese eklenir.
   */
  /**
   * Personel fotoğrafının adresi.
   *
   * `surum` verildiğinde adrese eklenir; fotoğraf değiştiğinde adres de
   * değişir ve tarayıcı önbellekteki eski görseli göstermez.
   */
  resimAdresi: (kod?: string | null, surum?: number | null) => {
    const oturum = oturumOku();
    const temiz = String(kod ?? "").trim();

    if (!temiz || !oturum) return "";

    const ek = surum ? `&v=${surum}` : "";

    return `${API_TABAN}/api/Personel/Resim?kod=${encodeURIComponent(
      temiz
    )}&t=${encodeURIComponent(oturum.token)}${ek}`;
  },

  /** Aday fotoğrafının adresi; başvuru listesinde küçük görsel için */
  adayResmi: (id?: number | null) => {
    const oturum = oturumOku();

    if (!id || !oturum) return "";

    return `${API_TABAN}/api/Basvuru/${id}/Fotograf?t=${encodeURIComponent(
      oturum.token
    )}`;
  },

  gonder: <T,>(yol: string, govde?: unknown) =>
    istek<T>(yol, { method: "POST" }, govde),
  sil: <T,>(yol: string) => istek<T>(yol, { method: "DELETE" }),
  guncelle: <T,>(yol: string, govde?: unknown) =>
    istek<T>(yol, { method: "PUT" }, govde),

  /**
   * Çok parçalı gönderim (dosya yükleme).
   *
   * Genel istek yardımcısı her isteğe `Content-Type: application/json`
   * koyuyor; çok parçalı gövdede bu başlık sınır (boundary) bilgisini
   * eziyor ve sunucu dosyayı hiç göremiyordu. Burada başlık bilinçli
   * olarak verilmiyor, tarayıcı kendisi yazıyor.
   */
  dosyaGonder: async <T,>(yol: string, form: FormData): Promise<T> => {
    const oturum = oturumOku();

    const cevap = await fetch(`${API_TABAN}${yol}`, {
      method: "POST",
      headers: oturum ? { Authorization: `Bearer ${oturum.token}` } : {},
      body: form,
    });

    const metin = await cevap.text();
    const veri = metin ? JSON.parse(metin) : null;

    if (!cevap.ok)
      throw new Error(veri?.hata ?? `Yükleme başarısız (${cevap.status})`);

    return veri as T;
  },

  /**
   * Belgenin tarayıcıda açılabilir adresi.
   *
   * iframe ve img etiketi istek başlığı gönderemediği için belirteç
   * adres satırına ekleniyor; sunucu bu yolu yalnızca önizleme ve görsel
   * uçlarında kabul ediyor.
   */
  belgeOnizleme: (id?: number | null) => {
    const oturum = oturumOku();

    if (!id || !oturum) return "";

    return `${API_TABAN}/api/PersonelBelge/Onizle/${id}?t=${encodeURIComponent(
      oturum.token
    )}`;
  },

  /**
   * Ücret pusulasının tarayıcıda açılabilir adresi.
   *
   * Yeni sekmede açılıyor ve o istek başlık taşıyamadığı için belirteç
   * adres satırında gidiyor.
   */
  pusulaAdresi: (id?: number | null) => {
    const oturum = oturumOku();

    if (!id || !oturum) return "";

    return `${API_TABAN}/api/Pusula/Goster/${id}?t=${encodeURIComponent(
      oturum.token
    )}`;
  },

  /**
   * Dosya indirir ve tarayıcıya kaydettirir.
   *
   * Adres satırına belirteç eklemek yerine başlıkla isteniyor: belge
   * bağlantısı kopyalanıp paylaşıldığında oturum bilgisi de gitmiş
   * olurdu.
   */
  indir: async (yol: string, dosyaAdi: string) => {
    const oturum = oturumOku();

    const cevap = await fetch(`${API_TABAN}${yol}`, {
      headers: oturum ? { Authorization: `Bearer ${oturum.token}` } : {},
    });

    if (!cevap.ok) {
      const metin = await cevap.text();
      const veri = metin ? JSON.parse(metin) : null;

      throw new Error(veri?.hata ?? `Belge indirilemedi (${cevap.status})`);
    }

    const veri = await cevap.blob();
    const adres = URL.createObjectURL(veri);

    const bag = document.createElement("a");

    bag.href = adres;
    bag.download = dosyaAdi || "belge";

    document.body.appendChild(bag);
    bag.click();
    bag.remove();

    /* Adres hemen bırakılırsa bazı tarayıcılarda indirme yarıda kalıyor */
    setTimeout(() => URL.revokeObjectURL(adres), 4000);
  },
};

/* -------------------------------------------------------------------------- */
/* Durum renkleri                                                              */
/* -------------------------------------------------------------------------- */

export const DURUMLAR = [
  "Yeni",
  "İncelendi",
  "Değerlendirmede",
  "Görüşme Talebi",
  "Olumlu",
  "Evrak Hazırlanıyor",
  "Onay Bekliyor",
  "İşe Alındı",
  "Olumsuz",
] as const;

/** İşe alım onayı verebilen kullanıcı mı? */
export const onayYetkisi = (oturum: Oturum | null): boolean =>
  !!oturum && (oturum.rol === "Admin" || !!oturum.onayYetkisi);

export const durumRengi = (durum: string): string => {
  switch (durum) {
    case "Yeni":
      return "blue";
    case "Değerlendirmede":
      return "gold";
    case "İncelendi":
      return "orange";
    case "Görüşme Talebi":
      return "purple";
    case "Olumlu":
      return "green";
    case "Evrak Hazırlanıyor":
      return "geekblue";
    case "Onay Bekliyor":
      return "volcano";
    case "İşe Alındı":
      return "cyan";
    case "Olumsuz":
      return "red";
    default:
      return "default";
  }
};
