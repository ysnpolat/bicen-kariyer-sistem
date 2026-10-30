/**
 * Open Facts dökümlerini indirir
 * ===========================================================================
 * Dört veritabanının tam dökümünü indirir. Bir kez indirildikten sonra
 * barkod eşleştirmesi yerelde yapılıyor ve servisin dakikalık istek
 * sınırı hiç devreye girmiyor.
 *
 * Dökümler sıkıştırılmış hâlde duruyor; açılmıyor. Açılmış hâli on
 * gigabaytları buluyor ve okumak için gerekmiyor — akış hâlinde
 * satır satır işleniyor.
 *
 * Kullanım:
 *     node dokum-indir.js
 *     node dokum-indir.js --klasor D:\dokum
 * ===========================================================================
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const DOKUMLER = [
  {
    ad: "gıda",
    dosya: "gida.jsonl.gz",
    adres: "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz",
  },
  {
    ad: "kozmetik",
    dosya: "kozmetik.jsonl.gz",
    adres: "https://static.openbeautyfacts.org/data/openbeautyfacts-products.jsonl.gz",
  },
  {
    ad: "genel ürün",
    dosya: "genel.jsonl.gz",
    adres: "https://static.openproductsfacts.org/data/openproductsfacts-products.jsonl.gz",
  },
  {
    ad: "evcil hayvan",
    dosya: "evcil.jsonl.gz",
    adres: "https://static.openpetfoodfacts.org/data/openpetfoodfacts-products.jsonl.gz",
  },
];

const mb = (bayt) => (bayt / 1024 / 1024).toFixed(0);

/**
 * Dosyayı indirir ve ilerlemeyi aynı satırda gösterir.
 *
 * Yarım kalan indirme silinip baştan alınıyor: bozuk bir arşiv,
 * eşleştirme aşamasında anlaşılmaz hatalar veriyordu.
 */
function indir(adres, hedef, ad) {
  return new Promise((coz, sakat) => {
    const gecici = `${hedef}.yariM`;
    const akis = fs.createWriteStream(gecici);

    const istek = (u, kalanYonlendirme = 5) => {
      https
        .get(u, (yanit) => {
          /* Dökümler yönlendirme arkasında durabiliyor */
          if (
            yanit.statusCode >= 300 &&
            yanit.statusCode < 400 &&
            yanit.headers.location
          ) {
            if (kalanYonlendirme === 0) {
              sakat(new Error("çok fazla yönlendirme"));
              return;
            }

            yanit.resume();
            istek(yanit.headers.location, kalanYonlendirme - 1);
            return;
          }

          if (yanit.statusCode !== 200) {
            sakat(new Error(`servis ${yanit.statusCode}`));
            return;
          }

          const toplam = Number(yanit.headers["content-length"] ?? 0);
          let inen = 0;
          let sonYazim = 0;

          yanit.on("data", (parca) => {
            inen += parca.length;

            /* Saniyede bir yazılıyor: her parçada yazmak konsolu
               kilitliyor ve indirmeyi yavaşlatıyor. */
            const simdi = Date.now();

            if (simdi - sonYazim > 1000) {
              sonYazim = simdi;

              const oran = toplam ? `%${Math.round((inen / toplam) * 100)}` : "";

              process.stdout.write(
                `\r  ${ad}: ${mb(inen)} MB${toplam ? ` / ${mb(toplam)} MB ${oran}` : ""}   `
              );
            }
          });

          yanit.pipe(akis);

          akis.on("finish", () => {
            akis.close(() => {
              fs.renameSync(gecici, hedef);
              process.stdout.write(`\r  ${ad}: ${mb(inen)} MB · tamam        \n`);
              coz(inen);
            });
          });
        })
        .on("error", (h) => {
          akis.close();

          if (fs.existsSync(gecici)) fs.unlinkSync(gecici);

          sakat(h);
        });
    };

    istek(adres);
  });
}

async function main() {
  const kIndex = process.argv.indexOf("--klasor");
  const klasor = kIndex > 0 ? process.argv[kIndex + 1] : "dokum";

  fs.mkdirSync(klasor, { recursive: true });

  console.log(`Dökümler indiriliyor → ${klasor}\n`);
  console.log("Bu işlem bağlantı hızınıza göre uzun sürebilir.\n");

  for (const d of DOKUMLER) {
    const hedef = path.join(klasor, d.dosya);

    if (fs.existsSync(hedef)) {
      console.log(`  ${d.ad}: zaten indirilmiş (${mb(fs.statSync(hedef).size)} MB)`);
      continue;
    }

    try {
      await indir(d.adres, hedef, d.ad);
    } catch (h) {
      /* Bir döküm alınamazsa diğerleri yine indiriliyor: kozmetik
         dökümü olmadan da gıda eşleştirmesi çalışıyor. */
      console.log(`\r  ${d.ad}: alınamadı (${h.message})        `);
    }
  }

  console.log("\nSıradaki adım:");
  console.log("  node dokum-eslestir.js barkodlar.txt");
}

main();
