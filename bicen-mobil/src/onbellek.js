/**
 * İstemci önbelleği
 * ---------------------------------------------------------------------------
 * Patron ekranlarının verisi ağır hesaplardan geliyor (okutma, norm,
 * başvuru özetleri) ve her ekran açılışında boş bir sayfada dönen
 * gösterge beklemek "uygulama yavaş" şikâyetine yol açtı.
 *
 * Yaklaşım: son alınan yanıt hemen gösterilir, yenisi arka planda
 * istenir ve gelince ekran kendiliğinden tazelenir.
 *
 *   - Bellek: aynı açılışta ekranlar arası geçiş anında olsun diye.
 *   - Dosya: uygulama kapatılıp açıldığında da ilk görüntü beklemesin
 *     diye (documentDirectory altında, anahtar başına bir JSON dosyası).
 *
 * Aynı anahtar için süren istek paylaşılır: Özet ile İK aynı veriyi
 * isterse sunucuya tek istek gider.
 *
 * Dosya sistemi koşullu yükleniyor (api.js ile aynı desen): paket yoksa
 * ya da web'de çalışılıyorsa önbellek yalnızca bellekte kalır, uygulama
 * yine çalışır.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";

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

const KLASOR =
  FileSystem?.documentDirectory && FileSystem?.writeAsStringAsync
    ? `${FileSystem.documentDirectory}onbellek/`
    : null;

/* anahtar → { veri, zaman } */
const bellek = new Map();

/* anahtar → Set<fn(kayit)> */
const dinleyiciler = new Map();

/* anahtar → süren istek (Promise) */
const surenler = new Map();

/* anahtar → son kullanılan yükleyici. Bir onaydan sonra ilgili verinin
   tazelenmesi gerekiyor; o anda ekranın yükleyicisine buradan ulaşılıyor. */
const yukleyiciler = new Map();

/* Çıkışta artar: çıkıştan önce başlamış bir isteğin yanıtı, sonradan
   gelip yeni oturumun önbelleğine yazılmasın. */
let nesil = 0;

let klasorHazir = false;

/* Dosya adı: anahtardaki ?, =, Türkçe harf gibi karakterler dosya
   sisteminde sorun çıkarmasın diye kodlanıyor. */
const dosyaAdi = (anahtar) =>
  `${String(anahtar).replace(/[^a-zA-Z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}.json`;

const klasoruHazirla = async () => {
  if (klasorHazir || !KLASOR) return;

  try {
    await FileSystem.makeDirectoryAsync(KLASOR, { intermediates: true });
  } catch {
    /* Klasör zaten varsa hata veriyor; yazma denemesi sonucu belirler */
  }

  klasorHazir = true;
};

const dosyayaYaz = async (anahtar, kayit) => {
  if (!KLASOR) return;

  try {
    await klasoruHazirla();
    await FileSystem.writeAsStringAsync(KLASOR + dosyaAdi(anahtar), JSON.stringify(kayit));
  } catch {
    /* Yazılamazsa yalnızca bellekte kalır; ekranı etkilemez */
  }
};

const dosyadanOku = async (anahtar) => {
  if (!KLASOR || !FileSystem?.readAsStringAsync) return null;

  try {
    const metin = await FileSystem.readAsStringAsync(KLASOR + dosyaAdi(anahtar));
    const kayit = JSON.parse(metin);

    return kayit && typeof kayit.zaman === "number" ? kayit : null;
  } catch {
    /* Dosya yoksa (ilk açılış) ya da bozuksa sunucudan alınır */
    return null;
  }
};

const haberVer = (anahtar, kayit) => {
  dinleyiciler.get(anahtar)?.forEach((f) => {
    try {
      f(kayit);
    } catch {
      /* Bir ekranın hatası diğerlerini engellemesin */
    }
  });
};

/* ========================================================================== */

/** Bellekteki kayıt (eşzamanlı; ilk çizimde gösterge çıkmasın diye) */
export const bellekten = (anahtar) => bellek.get(anahtar) ?? null;

/** Bellekte yoksa dosyadan okur */
export const oku = async (anahtar) => {
  const b = bellek.get(anahtar);
  if (b) return b;

  const n = nesil;
  const d = await dosyadanOku(anahtar);

  /* Dosya okunurken ağdan daha yenisi geldiyse o korunur */
  if (d && n === nesil && !bellek.has(anahtar)) bellek.set(anahtar, d);

  return bellek.get(anahtar) ?? null;
};

/** Değişiklikleri dinler; dinlemeyi bırakan işlev döner */
export const dinle = (anahtar, f) => {
  if (!dinleyiciler.has(anahtar)) dinleyiciler.set(anahtar, new Set());
  dinleyiciler.get(anahtar).add(f);

  return () => dinleyiciler.get(anahtar)?.delete(f);
};

/** Bu anahtar için istek sürüyor mu */
export const suruyorMu = (anahtar) => surenler.has(anahtar);

/**
 * Sunucudan yeniden alır ve önbelleğe yazar.
 *
 * Aynı anahtar için süren istek varsa ona katılır. Hata olursa önbellek
 * bozulmaz; çağıran hatayı gösterir, eski veri ekranda kalır.
 */
export const tazele = (anahtar, yukleyici) => {
  if (yukleyici) yukleyiciler.set(anahtar, yukleyici);

  const suren = surenler.get(anahtar);
  if (suren) return suren;

  const fn = yukleyici ?? yukleyiciler.get(anahtar);
  if (!fn) return Promise.resolve(bellek.get(anahtar)?.veri ?? null);

  const n = nesil;

  const istek = Promise.resolve()
    .then(fn)
    .then((veri) => {
      if (n !== nesil) return veri;

      const kayit = { veri, zaman: Date.now() };

      bellek.set(anahtar, kayit);
      dosyayaYaz(anahtar, kayit);
      haberVer(anahtar, kayit);

      return veri;
    })
    .finally(() => {
      if (surenler.get(anahtar) === istek) surenler.delete(anahtar);
    });

  surenler.set(anahtar, istek);

  return istek;
};

/**
 * Önceden yükler (ekran açılmadan). Taze veri varsa istek atılmaz.
 * Hata sessizce yutulur: kullanıcı o ekrana girdiğinde zaten yeniden
 * denenecek.
 */
export const onceYukle = async (anahtar, yukleyici, tazeSure = 20_000) => {
  const k = await oku(anahtar);

  if (k && !k.eski && Date.now() - k.zaman < tazeSure) return;

  tazele(anahtar, yukleyici).catch(() => undefined);
};

/**
 * Veriyi eskimiş sayar: bir onay ya da not yazıldıktan sonra ilgili
 * ekranlar bir sonraki görünüşte (ekranda açıksa hemen) tazelensin.
 *
 * @param onEk Bu önekle başlayan bütün anahtarlar
 */
export const eskit = (onEk) => {
  for (const [anahtar, kayit] of bellek) {
    if (!anahtar.startsWith(onEk)) continue;

    /* Zaman korunuyor: ekrandaki "son güncelleme" saati doğru kalsın */
    bellek.set(anahtar, { ...kayit, eski: true });

    /* Ekranda dinleyen varsa beklemeden tazelenir */
    if (dinleyiciler.get(anahtar)?.size && yukleyiciler.has(anahtar))
      tazele(anahtar).catch(() => undefined);
  }
};

/**
 * Önbelleği temizler (çıkışta). Önek verilmezse hepsi.
 *
 * Başka bir kişi aynı telefonda oturum açtığında önceki kişinin şube,
 * personel ve başvuru verisi ilk görüntü olarak çıkmamalı.
 */
export const onbellekTemizle = async (onEk = "") => {
  nesil += 1;

  for (const anahtar of [...bellek.keys()])
    if (anahtar.startsWith(onEk)) bellek.delete(anahtar);

  for (const anahtar of [...surenler.keys()])
    if (anahtar.startsWith(onEk)) surenler.delete(anahtar);

  if (!KLASOR) return;

  try {
    if (!onEk) {
      await FileSystem.deleteAsync(KLASOR, { idempotent: true });
      klasorHazir = false;
      return;
    }

    const kodluOnEk = dosyaAdi(onEk).replace(/\.json$/, "");
    const dosyalar = await FileSystem.readDirectoryAsync(KLASOR);

    await Promise.all(
      dosyalar
        .filter((d) => d.startsWith(kodluOnEk))
        .map((d) => FileSystem.deleteAsync(KLASOR + d, { idempotent: true }))
    );
  } catch {
    /* Klasör hiç oluşmamış olabilir */
  }
};

/* ========================================================================== */
/* Ekran kancası                                                              */
/* ========================================================================== */

/**
 * Önbellekli veri.
 *
 * @param anahtar    Önbellek anahtarı (null verilirse hiçbir şey yapılmaz)
 * @param yukleyici  Sunucudan alan işlev
 * @param secenek.tazeSure  Bu süreden yeni veri varken ekrana dönüşte
 *                          istek atılmaz (ms). Sekmeler arasında hızlı
 *                          gezinirken sunucuyu boşuna yormamak için.
 * @param secenek.pasif     Yalnızca dinler, kendisi istek atmaz (rozet
 *                          sayısı gibi başka ekranın verisini okuyanlar)
 *
 * @returns {{ veri, zaman, ilkYukleme, guncelleniyor, yenileniyor, hata,
 *             yenile: (cekme?: boolean) => Promise }}
 *   ilkYukleme: gösterilecek hiçbir veri yok ve istek sürüyor — yalnızca
 *               bu durumda tam ekran gösterge çıkmalı.
 */
export function useOnbellek(anahtar, yukleyici, { tazeSure = 20_000, pasif = false } = {}) {
  const [kayit, setKayit] = useState(() => (anahtar ? bellekten(anahtar) : null));
  const [durum, setDurum] = useState({ guncelleniyor: false, yenileniyor: false, hata: "" });

  /* Dosyadan okuma sürerken "veri yok" denmesin diye */
  const [okunuyor, setOkunuyor] = useState(() => !!anahtar && !bellekten(anahtar));

  const yukleyiciRef = useRef(yukleyici);
  yukleyiciRef.current = yukleyici;

  const anahtarRef = useRef(anahtar);
  anahtarRef.current = anahtar;

  const yenile = useCallback(
    async (cekme = false) => {
      const k = anahtarRef.current;
      if (!k || pasif) return;

      setDurum((d) => ({ ...d, guncelleniyor: true, yenileniyor: !!cekme }));

      try {
        await tazele(k, () => yukleyiciRef.current());

        if (anahtarRef.current === k)
          setDurum({ guncelleniyor: false, yenileniyor: false, hata: "" });
      } catch (e) {
        if (anahtarRef.current === k)
          setDurum({
            guncelleniyor: false,
            yenileniyor: false,
            hata: e?.message ?? "Veri alınamadı.",
          });
      }
    },
    [pasif]
  );

  /* Eskiyse tazeler; ekrana her dönüşte çağrılıyor */
  const gerekirseTazele = useCallback(() => {
    const k = anahtarRef.current;
    if (!k || pasif) return;

    const b = bellekten(k);
    if (!b || b.eski || Date.now() - b.zaman >= tazeSure) yenile();
  }, [pasif, tazeSure, yenile]);

  useEffect(() => {
    if (!anahtar) {
      setKayit(null);
      setOkunuyor(false);
      return undefined;
    }

    let canli = true;
    const b = bellekten(anahtar);

    setKayit(b);
    setOkunuyor(!b);
    setDurum((d) => ({ ...d, hata: "" }));

    const birak = dinle(anahtar, (k) => {
      if (!canli) return;
      setKayit(k);
      setOkunuyor(false);
    });

    (async () => {
      if (!b) {
        const d = await oku(anahtar);
        if (!canli) return;
        if (d) setKayit(d);
        setOkunuyor(false);
      }

      /* Başka bir ekranın başlattığı istek sürüyorsa göstergesi de görünsün */
      if (!pasif && suruyorMu(anahtar)) yenile();
      else gerekirseTazele();
    })();

    return () => {
      canli = false;
      birak();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anahtar]);

  /* Sekmeye dönüşte: sekme ekranları bellekte kalıyor, ilk açılış
     etkisi yeniden çalışmıyor. */
  useFocusEffect(
    useCallback(() => {
      gerekirseTazele();
    }, [gerekirseTazele])
  );

  return {
    veri: kayit?.veri ?? null,
    zaman: kayit?.zaman ?? null,
    ilkYukleme: !kayit && (okunuyor || durum.guncelleniyor || (!durum.hata && !pasif)),
    guncelleniyor: durum.guncelleniyor,
    yenileniyor: durum.yenileniyor,
    hata: durum.hata,
    yenile,
  };
}
