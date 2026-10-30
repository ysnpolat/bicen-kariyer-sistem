/**
 * Tek barkod teşhisi
 * ===========================================================================
 * Bir barkodun hangi Open Facts veritabanında bulunduğunu ve görselinin
 * olup olmadığını tek tek gösterir.
 *
 * İndirici "bulunamadı" dediğinde sebebin hangi aşamada olduğunu görmek
 * için: barkod hiç kayıtlı değil mi, kayıtlı ama görseli mi yok, yoksa
 * servise mi ulaşılamıyor.
 *
 * Kullanım:
 *     node tekli-dene.js 8699197731488
 * ===========================================================================
 */

const KAYNAKLAR = {
  "gıda v2": "https://world.openfoodfacts.org/api/v2/product/",
  "kozmetik v2": "https://world.openbeautyfacts.org/api/v2/product/",
  "genel ürün v2": "https://world.openproductsfacts.org/api/v2/product/",
  "evcil hayvan v2": "https://world.openpetfoodfacts.org/api/v2/product/",
  "gıda v0": "https://world.openfoodfacts.org/api/v0/product/",
  "kozmetik v0": "https://world.openbeautyfacts.org/api/v0/product/",
};

const BASLIK = {
  "User-Agent": "BicenPortal/1.0 (kurumsal envanter; bilgi@bicen.com.tr)",
};

const barkod = process.argv[2];

if (!barkod) {
  console.log("Kullanım: node tekli-dene.js <barkod>");
  process.exit(1);
}

(async () => {
  console.log(`Barkod: ${barkod}\n`);

  for (const [ad, kaynak] of Object.entries(KAYNAKLAR)) {
    try {
      const yanit = await fetch(`${kaynak}${barkod}.json`, { headers: BASLIK });

      if (yanit.status === 404) {
        console.log(`${ad.padEnd(18)} kayıtlı değil (404)`);
        continue;
      }

      if (!yanit.ok) {
        console.log(`${ad.padEnd(18)} servis hatası ${yanit.status}`);
        continue;
      }

      const veri = await yanit.json();

      if (veri?.status !== 1) {
        console.log(`${ad.padEnd(18)} kayıtlı değil`);
        continue;
      }

      const urun = veri.product ?? {};
      const gorsel =
        urun.image_front_url || urun.image_url || urun.image_front_small_url;

      console.log(
        `${ad.padEnd(18)} BULUNDU · ${urun.product_name || "adsız"} · ` +
          (gorsel ? "görsel var" : "GÖRSEL YOK")
      );

      if (gorsel) console.log(`${" ".repeat(18)} ${gorsel}`);
    } catch (h) {
      console.log(`${ad.padEnd(18)} ulaşılamadı: ${h.message}`);
    }

    await new Promise((c) => setTimeout(c, 300));
  }
})();
