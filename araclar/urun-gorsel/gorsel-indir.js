/**
 * Ürün görseli indirici
 * ===========================================================================
 * Barkod listesindeki ürünlerin görsellerini Open Food Facts'ten indirir ve
 * <barkod>.jpg biçiminde adlandırır. Portaldaki toplu yükleme ekranı dosya
 * adından ürünü bulduğu için başka bir eşleştirme gerekmiyor.
 *
 * Node ile yazıldı: bilgisayarda Expo için zaten kurulu ve ayrıca bir şey
 * yüklemek gerekmiyor.
 *
 * Neden arama motoru kullanılmıyor: arama sonuçlarından görsel toplamak
 * kullanım şartlarına aykırı ve çıkan dosyaların telifi başkalarına ait.
 * Open Food Facts açık veri olarak yayınlanıyor.
 *
 * Kullanım:
 *     node gorsel-indir.js barkodlar.txt
 *     node gorsel-indir.js barkodlar.txt gorseller
 * ===========================================================================
 */

const fs = require("fs");
const path = require("path");

/* Open Facts tek veritabanı değil: gıda, kozmetik, evcil hayvan ve genel
   ürünler ayrı ayrı tutuluyor. Bir markette bunların hepsinden ürün var
   ve yalnızca gıdaya bakmak, temizlik ve kozmetik raflarını tamamen
   dışarıda bırakıyordu.

   v2 bulamazsa v0 deneniyor: eski kayıtların bir kısmı yeni uçta
   görünmüyor. */
const KAYNAKLAR = [
  "https://world.openfoodfacts.org/api/v2/product/",
  "https://world.openbeautyfacts.org/api/v2/product/",
  "https://world.openproductsfacts.org/api/v2/product/",
  "https://world.openpetfoodfacts.org/api/v2/product/",
];

/* Servis kendini tanıtmamızı istiyor; kimliksiz istekler engelleniyor */
const BASLIK = {
  "User-Agent": "BicenPortal/1.0 (kurumsal envanter; bilgi@bicen.com.tr)",
};

/* Servis dakikada yüz istek kabul ediyor.

   Her barkod için dört kaynak deneniyor, yani saniyede birden fazla
   barkod işlemek sınırı aşıyor ve 429 alınıyordu. Bekleme istek
   başına hesaplanıyor, barkod başına değil. */
const ISTEK_ARASI = 700;

/* 429 alındığında beklenecek süre: servis kendine gelsin diye uzun.
   Hemen yeniden denemek engellenmeyi uzatıyor. */
const CEZA_BEKLEMESI = 65000;

const bekle = (ms) => new Promise((c) => setTimeout(c, ms));

/**
 * İstek atar; sınır aşımında bekleyip bir kez daha dener.
 *
 * Sayaç dışarıdan taşınıyor: kaç istek atıldığını bilmek, sınıra
 * yaklaşıldığında kendiliğinden yavaşlamayı mümkün kılıyor.
 */
async function istek(adres, durum) {
  for (let deneme = 0; deneme < 2; deneme++) {
    await bekle(ISTEK_ARASI);

    const yanit = await fetch(adres, { headers: BASLIK });

    if (yanit.status !== 429) return yanit;

    durum.cezali++;

    console.log(
      `    (servis sınırı aşıldı, ${Math.round(CEZA_BEKLEMESI / 1000)} saniye bekleniyor)`
    );

    await bekle(CEZA_BEKLEMESI);
  }

  return null;
}

/** Kayıttaki en uygun görselin adresi */
function gorselAdresi(veri) {
  const urun = veri?.product ?? {};

  /* Öncelik ön yüz görselinde; küçük boy yerine orta boy alınıyor,
     küçük görsel ekranda bulanık kalıyor. */
  for (const anahtar of ["image_front_url", "image_url", "image_front_small_url"]) {
    if (urun[anahtar]) return urun[anahtar];
  }

  return null;
}

async function indir(barkod, klasor, durum) {
  const hedef = path.join(klasor, `${barkod}.jpg`);

  if (fs.existsSync(hedef)) return ["atlandi", "zaten var"];

  let adres = null;
  let sonHata = null;

  /* Kaynaklar sırayla deneniyor; ilk görsel bulunanda duruluyor.
     404 hata değil "bu veritabanında yok" demek, o yüzden sıradakine
     geçiliyor. */
  for (const kaynak of KAYNAKLAR) {
    try {
      const yanit = await istek(`${kaynak}${barkod}.json`, durum);

      if (!yanit) {
        sonHata = "servis sınırı";
        break;
      }

      if (yanit.status === 404) continue;

      if (!yanit.ok) {
        sonHata = `servis ${yanit.status}`;
        continue;
      }

      const veri = await yanit.json();

      if (veri?.status !== 1) continue;

      adres = gorselAdresi(veri);

      if (adres) break;
    } catch (h) {
      sonHata = h.message;
    }
  }

  if (!adres) return sonHata ? ["hata", sonHata] : ["yok", "hiçbir kaynakta yok"];

  try {
    const yanit = await istek(adres, durum);

    if (!yanit) return ["hata", "servis sınırı"];

    if (!yanit.ok) return ["hata", `görsel ${yanit.status}`];

    const icerik = Buffer.from(await yanit.arrayBuffer());

    /* Çok küçük dosyalar genelde yer tutucu görsel oluyor */
    if (icerik.length < 3000) return ["yok", "görsel çok küçük"];

    fs.writeFileSync(hedef, icerik);

    return ["indi", `${Math.round(icerik.length / 1024)} KB`];
  } catch (h) {
    return ["hata", h.message];
  }
}

async function main() {
  const liste = process.argv[2] ?? "barkodlar.txt";
  const klasor = process.argv[3] ?? "gorseller";

  if (!fs.existsSync(liste)) {
    console.log(`Dosya bulunamadı: ${liste}`);
    process.exit(1);
  }

  fs.mkdirSync(klasor, { recursive: true });

  /* Aynı barkod listede birden çok kez geçebiliyor; tekrar indirmek
     boşuna istek demek */
  const barkodlar = [
    ...new Set(
      fs
        .readFileSync(liste, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];

  console.log(`${barkodlar.length} barkod işlenecek → ${klasor}\n`);

  const sayac = { indi: 0, yok: 0, atlandi: 0, hata: 0 };
  const durum = { cezali: 0 };
  const bulunamayan = [];

  const baslangic = Date.now();

  for (let i = 0; i < barkodlar.length; i++) {
    const barkod = barkodlar[i];
    const [sonuc, aciklama] = await indir(barkod, klasor, durum);

    sayac[sonuc]++;

    if (sonuc === "yok" || sonuc === "hata")
      bulunamayan.push(`${barkod}\t${aciklama}`);

    const isaret = { indi: "+", yok: "-", atlandi: "=", hata: "!" }[sonuc];

    /* Kalan süre tahmini: sekiz yüz üründe işlem saatler sürüyor ve
       ne kadar beklemesi gerektiğini bilmeden başlatmak zor. */
    const gecen = (Date.now() - baslangic) / 1000;
    const kalanSayi = barkodlar.length - (i + 1);
    const tahmin = i > 0 ? Math.round((gecen / (i + 1)) * kalanSayi / 60) : 0;

    console.log(
      `[${i + 1}/${barkodlar.length}] ${isaret} ${barkod}  ${aciklama}` +
        (i % 25 === 24 ? `   (kalan ~${tahmin} dk)` : "")
    );
  }

  const eksikDosya = path.join(klasor, "_bulunamayanlar.txt");

  fs.writeFileSync(eksikDosya, bulunamayan.join("\n"), "utf8");

  console.log(
    `\nİndirilen: ${sayac.indi}   Bulunamayan: ${sayac.yok}   ` +
      `Zaten vardı: ${sayac.atlandi}   Hata: ${sayac.hata}`
  );

  if (durum.cezali > 0)
    console.log(
      `Servis sınırı ${durum.cezali} kez aşıldı; o kayıtlar için komutu ` +
        `tekrar çalıştırabilirsiniz (inenler atlanır).`
    );
  console.log(`Bulunamayanlar: ${eksikDosya}`);
  console.log(
    "\nGörselleri portalda Yönetim → Ürün Görselleri ekranından toplu olarak yükleyebilirsiniz."
  );
}

main();
