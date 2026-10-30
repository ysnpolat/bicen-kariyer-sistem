/**
 * Bildirimler
 * ---------------------------------------------------------------------------
 * İzin ister, jetonu alır ve sunucuya bildirir.
 *
 * Jeton her açılışta yeniden gönderilir: işletim sistemi jetonu
 * yenileyebiliyor ve eskisi sessizce çalışmaz hâle geliyor.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";

import { bildirimJetonuYaz } from "./api";
import { gorunumOku } from "./gorunum";

/* Uygulama açıkken de bildirim görünsün: kullanıcı başka sekmedeyken
   gelen izin onayını kaçırmasın.

   Çağrı try içinde: bu satır modül yüklenirken çalışıyor ve burada çıkan
   bir hata bütün paketi düşürüyor. React hiç başlamıyor, açılış perdesi
   kalkmıyor ve ekranda hata bile görünmüyor — uygulama açılış görselinde
   donmuş gibi kalıyor. Bildirimlerin biçimlenmemesi, uygulamanın hiç
   açılmamasından iyidir. */
try {
  Notifications.setNotificationHandler({
    /* Mesaj bildirimi uygulama açıkken sistem şeridi olarak çıkmıyor:
       üstteki kendi balonu (yanıtlanabilir) gösteriliyor (1.9). Liste
       ve ses de yok; balon kendi sesini çalıyor. */
    handleNotification: async (n) => {
      const ekran = String(n?.request?.content?.data?.ekran ?? "").toLowerCase();
      const mesaj = ekran === "mesaj" && mesajBalonu.etkin;
      return {
        shouldShowBanner: !mesaj,
        shouldShowList: !mesaj,
        shouldPlaySound: !mesaj,
        shouldSetBadge: false,
      };
    },
  });
} catch (hata) {
  console.warn("Bildirim biçimi ayarlanamadı:", hata?.message);
}

/**
 * İzin alır ve jetonu sunucuya bildirir.
 *
 * Başarısız olursa sessizce geçilir: bildirim çalışmaması uygulamayı
 * kullanılamaz yapmaz, kullanıcıyı izin vermeye zorlamak da doğru değil.
 */
/* Son çalıştırmanın sonucu.

   Hata sessizce yutuluyordu ve bildirimin neden gelmediğini anlamak için
   sunucu günlüğüne bakmak bile yetmiyordu — sorun cihazdaysa orada iz
   kalmıyor. Durum burada tutulup Diğer ekranında gösteriliyor. */
export const bildirimDurumu = { asama: "başlamadı", jeton: null, hata: null };

/* Uygulama içi mesaj balonu çalışıyor mu (MesajBalonu bileşeni ayarlar).
   Çalışıyorsa ön plandaki mesaj bildirimi sistem şeridi olarak çıkmaz. */
export const mesajBalonu = { etkin: false };

/* Sunucudaki BildirimServisi.SesSec ile aynı kimlikler ve dosya adları */
const BICEN_KANALLARI = [
  {
    id: "bicen-onay",
    ad: "Onay bekleyenler",
    aciklama: "İzin ve diğer onaylarınızı bekleyen işler",
    ses: "bicen_onay_bekliyor.wav",
  },
  {
    id: "bicen-genel",
    ad: "Duyurular",
    aciklama: "Biçen duyuruları ve günlük özet",
    ses: "bicen_her_zaman_taze.wav",
  },
  {
    id: "bicen-kisa",
    ad: "Bildirimler",
    aciklama: "İzin, vardiya, Biçen Kart ve diğer bildirimler",
    ses: "bicen_taze_kisa.wav",
  },
];

export const bildirimHazirla = async () => {
  try {
    bildirimDurumu.asama = "cihaz denetimi";

    /* Emülatörde çalışmıyor; gerçek cihaz gerekiyor */
    if (!Device.isDevice) {
      bildirimDurumu.asama = "emülatör — bildirim çalışmaz";
      return null;
    }

    const mevcut = await Notifications.getPermissionsAsync();
    let durum = mevcut.status;

    if (durum !== "granted") {
      const sonuc = await Notifications.requestPermissionsAsync();
      durum = sonuc.status;
    }

    if (durum !== "granted") {
      bildirimDurumu.asama = "izin verilmedi";
      return null;
    }

    bildirimDurumu.asama = "izin alındı";

    /* Android'de bildirim kanalı tanımlanmazsa sessiz geliyor */
    let sesler = Platform.OS !== "android";

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Genel",
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: "#7cb518",
      });

      /* Biçen bildirim sesleri (1.6): "Bi-çen, her za-man ta-ze".
         Android kanalın sesini sonradan değiştirmeye izin vermiyor; ses
         değişirse kanal kimliği de değişmeli (bicen-genel-2 gibi). Kişi
         her kanalın sesini telefon ayarlarından ayrıca kapatabiliyor. */
      try {
        for (const k of BICEN_KANALLARI) {
          await Notifications.setNotificationChannelAsync(k.id, {
            name: k.ad,
            description: k.aciklama,
            importance: Notifications.AndroidImportance.HIGH,
            sound: k.ses,
            vibrationPattern: [0, 180, 120, 180],
            lightColor: "#7cb518",
          });
        }

        sesler = true;
      } catch (hata) {
        /* Kanal kurulamazsa sunucu varsayılan sesle göndermeye devam eder */
        console.warn("Biçen bildirim kanalları kurulamadı:", hata?.message);
      }
    }

    const projeId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const jeton = (
      await Notifications.getExpoPushTokenAsync(
        projeId ? { projectId: projeId } : undefined
      )
    ).data;

    bildirimDurumu.jeton = jeton;

    if (!jeton) {
      bildirimDurumu.asama = "jeton üretilemedi";
      return null;
    }

    bildirimDurumu.asama = "jeton alındı, sunucuya yazılıyor";

    await bildirimJetonuYaz(jeton, {
      surum: Constants.expoConfig?.version ?? null,
      sesler,
    });

    bildirimDurumu.asama = "tamam";

    return jeton;
  } catch {
    /* İzin verilmemiş, servis erişilemiyor ya da Expo Go sınırı */
    return null;
  }
};

/* Personel uygulamasındaki karşılıklar. Sunucudaki her `ekran` değerinin
   burada karşılığı olmalı; eksik kalan değerde bildirime dokunan personel
   ana sayfaya düşüyor ve bildirimin neyle ilgili olduğunu bulamıyordu. */
const PERSONEL_EKRAN = {
  izin: "Izin",
  izintalep: "Izin",
  /* Yönetici İşlemleri (1.7; eski adı İzin Onayları). "izinonay|izin",
     "izinonay|fazlamesai", "izinonay|avans", "izinonay|rotasyon" ilgili
     kategoriyi açıyor. */
  izinonay: "IzinOnay",
  yonetici: "IzinOnay",
  /* İK'ya ve girene giden fazla mesai bildirimleri */
  fazlamesai: "IzinOnay",
  /* Onaylanan fazla mesai: personelin puantaj çizelgesi */
  puantaj: "Puantaj",
  vardiya: "Vardiya",
  duyuru: "Duyurular",
  isemri: "Isler",
  isler: "Isler",
  checklist: "Checklist",
  ariza: "Ariza",
  prim: "Prim",
  performans: "Performans",
  vardiyaplani: "VardiyaPlani",
  avans: "Avans",
  kunye: "Kunye",
  rakipfiyat: "RakipFiyat",
  /* Biçen'den Haberler (1.7): yeni gönderi, kampanya, anket, yorum */
  haberler: "Haberler",
  haber: "Haberler",

  /* Mazeret belgesi ve oryantasyon: kartlar ana sayfada, yöneticinin
     listesi Ekibim'de */
  anasayfa: "AnaSayfa",
  ekibim: "Ekibim",

  /* Biçen Kart: yükleme, harcama, transfer ve silme bildirimleri */
  giftkart: "GiftKart",
  bicenkart: "GiftKart",

  /* Kazan-Kazan: öneri durumu değişince (1.8) */
  kazankazan: "KazanKazan",

  /* Dönemsel ekip değerlendirmesi (1.8) */
  ekipdegerlendirme: "EkipDegerlendirme",

  /* 1.9: mesajlar ("mesaj|sohbetId") ve devamsızlık ("devamsizlik|sicil") */
  mesaj: "Mesajlar",
  mesajlar: "Mesajlar",
  devamsizlik: "Devamsizlik",
  /* Devamsızlık tutanağı (26.10.2026): "devamsizliktutanak|id" */
  devamsizliktutanak: "DevamsizlikTutanak",
  skt: "Skt",
  /* Denkleştirme (23.10.2026) */
  denklestirme: "Denklestirme",
  denklestirmeonay: "DenklestirmeOnay",
  /* Görevlendirme (26.10.2026) */
  gorevlendirme: "Gorevlendirme",

  /* Belge ve pusula aynı ekranda: ikisi de Bilgilerim altında */
  belge: "Bilgilerim",
  egitim: "Bilgilerim",
  etik: "EtikHat",
  nobet: "Bilgilerim",
  pusula: "Bilgilerim",
};

/* Patron görünümü (1.5): `patron-onaylar`, `patron-ozet`, `patron-ik`,
   `patron-sube:<ad>`, `patron-sayfa:<kod>`. */
const PATRON_EKRAN = {
  onaylar: "Onaylar",
  ozet: "Ozet",
  ik: "Ik",
  subeler: "Subeler",
};

/**
 * Bildirim verisini hedef ekrana çevirir.
 *
 * @returns { kok: "Uygulama" | "Patron", ekran, params? } ya da tanınmayan
 *          değerde null. `kok` yığındaki kapsayan ekran: personel
 *          ekranları "Uygulama", yönetim ekranları "Patron" altında.
 */
export const bildirimHedefi = (veri) => {
  const ham = String(veri?.ekran ?? "").trim();
  if (!ham) return null;

  const kucuk = ham.toLowerCase();
  const t = Date.now();

  /* Sunucu tanımlı sayfa, dikkat `hedef` biçimiyle: { ekran: "sayfa", p } */
  if (kucuk === "sayfa")
    return veri?.p ? { kok: "Patron", ekran: "WebSayfa", params: { kod: String(veri.p), t } } : null;

  if (kucuk.startsWith("patron-")) {
    /* Parametre büyük/küçük harfi korunarak alınıyor: şube adı "GEMLİK" */
    const iki = ham.indexOf(":");
    const tur = (iki >= 0 ? kucuk.slice(7, iki) : kucuk.slice(7)).trim();
    const p = iki >= 0 ? ham.slice(iki + 1).trim() : "";

    if (tur === "sube") return p ? { kok: "Patron", ekran: "SubeDetay", params: { ad: p } } : { kok: "Patron", ekran: "Subeler" };
    if (tur === "sayfa") return p ? { kok: "Patron", ekran: "WebSayfa", params: { kod: p, t } } : null;
    if (tur === "onaylar") return { kok: "Patron", ekran: "Onaylar", params: { tur: "hepsi", t } };
    if (PATRON_EKRAN[tur]) return { kok: "Patron", ekran: PATRON_EKRAN[tur] };

    /* Bilinmeyen patron ekranı: en azından yönetim ekranı açılsın */
    return { kok: "Patron", ekran: "Ozet" };
  }

  /* Hukuk masası (24.10.2026): danışman ve hukuk ekibi */
  if (kucuk === "hukuk" || kucuk.startsWith("hukuk:"))
    return { kok: "Hukuk", ekran: "Masa", params: { yazi: veri?.p ? Number(veri.p) || null : null, t } };

  const personel = PERSONEL_EKRAN[kucuk];

  /* İK eksik bildirimi: ana sayfa açılınca eksik penceresi de açılsın */
  if (personel === "AnaSayfa" && veri?.p === "eksik")
    return { kok: "Uygulama", ekran: personel, params: { eksik: t } };

  /* Yönetici İşlemleri: kategori p'den (izinonay|fazlamesai) ya da
     ekran adından (fazlamesai) */
  if (personel === "IzinOnay") {
    const kategori = String(veri?.p ?? (kucuk === "fazlamesai" ? "fazlamesai" : "")).trim().toLowerCase();
    return { kok: "Uygulama", ekran: personel, params: { kategori: kategori || null, t } };
  }

  /* 1.9: sohbet ve kişi parametreyle açılıyor */
  if (personel === "Mesajlar")
    return { kok: "Uygulama", ekran: personel, params: { sohbetId: veri?.p ? Number(veri.p) : null, t } };
  if (personel === "Devamsizlik")
    return { kok: "Uygulama", ekran: personel, params: { sicil: veri?.p ? String(veri.p) : null, t } };
  if (personel === "DevamsizlikTutanak")
    return { kok: "Uygulama", ekran: personel, params: { id: veri?.p ? Number(veri.p) || null : null, t } };

  /* Diğer ekranlar da her dokunuşta yeniden odaklansın diye zaman damgası */
  return personel ? { kok: "Uygulama", ekran: personel, params: { t } } : null;
};

/* Aynı dokunuş iki kez işlenmesin: personel ve patron gezginleri aynı
   anda yığındaysa ikisinin dinleyicisi de çalışıyor, açılış yanıtı da
   hem dinleyiciye hem son yanıt sorgusuna gelebiliyor. */
const islenenler = new Set();
let acilisBakildi = false;

/**
 * Bildirime dokunulduğunda ilgili ekrana götürür.
 * Sunucu `data.ekran` alanını gönderiyor.
 *
 * @param git  (hedef) => void; hedef bildirimHedefi() biçiminde
 */
export const bildirimDinle = (git) => {
  const isle = (olay) => {
    const istek = olay?.notification?.request;
    const kimlik = istek?.identifier ?? null;

    if (kimlik) {
      if (islenenler.has(kimlik)) return;
      islenenler.add(kimlik);
    }

    const hedef = bildirimHedefi(istek?.content?.data);
    if (!hedef) return;

    if (hedef.kok !== "Patron") {
      git(hedef);
      return;
    }

    /* Patron yetkisi kaldırılmış kişi yönetim ekranına gönderilmez */
    gorunumOku()
      .then((g) => {
        if (g?.patron !== false) git(hedef);
      })
      .catch(() => git(hedef));
  };

  try {
    const dinleyici = Notifications.addNotificationResponseReceivedListener(isle);

    /* Uygulama kapalıyken bildirime dokunularak açıldıysa yanıt
       dinleyiciye her zaman ulaşmıyor (dinleyici açılıştan sonra
       kuruluyor). Bir kez son yanıta bakılıyor.

       1.7: personel bildirimleri de. Önce yalnızca yönetim bildirimleri
       içindi; uygulama kapalıyken gelen izin, avans, fazla mesai
       bildirimine dokunan kişi ana sayfada kalıyordu. Gezginler kurulsun
       diye kısa bir bekleme var. */
    if (!acilisBakildi) {
      acilisBakildi = true;

      /* SDK 57: eşzamanlı sürüm; eskisi (Async) yalnızca yedek. Burada
         çıkan hata kurulan dinleyiciyi düşürmesin diye ayrı try. */
      let son = null;

      try {
        son = Notifications.getLastNotificationResponse
          ? Notifications.getLastNotificationResponse()
          : Notifications.getLastNotificationResponseAsync?.();
      } catch {
        son = null;
      }

      Promise.resolve(son)
        .then((olay) => {
          const hedef = bildirimHedefi(olay?.notification?.request?.content?.data);
          if (!hedef) return;

          /* Çok eski bir yanıt (uygulama sonra elle açıldıysa) yeniden
             işlenmesin: son yanıt, uygulama kapanana kadar aynı kalıyor */
          const zaman = Number(olay?.notification?.date ?? 0);
          const ms = zaman > 1e12 ? zaman : zaman * 1000;
          if (hedef.kok !== "Patron" && ms && Date.now() - ms > 10 * 60 * 1000) return;

          if (hedef.kok === "Patron") isle(olay);
          else setTimeout(() => isle(olay), 450);
        })
        .catch(() => undefined);
    }

    return dinleyici;
  } catch (hata) {
    bildirimDurumu.hata = `${hata?.message ?? hata}`;

    /* Dinleyici kurulamazsa bildirime dokunmak ana sayfayı açar;
       uygulamanın açılmaması pahasına ısrar edilmez. */
    console.warn("Bildirim dinleyicisi kurulamadı:", hata?.message);
    return null;
  }
};
