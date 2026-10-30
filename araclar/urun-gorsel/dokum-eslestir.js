/**
 * Döküm eşleştirici
 * ===========================================================================
 * İndirilen dökümleri tarar, barkod listesindeki ürünlerin görsel
 * adreslerini bulur ve görselleri indirir.
 *
 * Döküm sıkıştırılmış hâlde, akış olarak okunuyor: milyonlarca satırlık
 * dosyayı belleğe almak mümkün değil. Her satır tek bir ürün; aranan
 * barkodlar bir kümede tutulup satır satır kontrol ediliyor.
 *
 * Servise tek tek sorulmadığı için istek sınırı devreye girmiyor.
 * Yalnızca bulunan görseller indiriliyor ve onlar resim sunucusundan
 * geliyor.
 *
 * Kullanım:
 *     node dokum-eslestir.js barkodlar.txt
 *     node dokum-eslestir.js barkodlar.txt --klasor gorseller --dokum dokum
 * ===========================================================================
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");

const DOSYALAR = [
  { ad: "gıda", dosya: "gida.jsonl.gz" },
  { ad: "kozmetik", dosya: "kozmetik.jsonl.gz" },
  { ad: "genel ürün", dosya: "genel.jsonl.gz" },
  { ad: "evcil hayvan", dosya: "evcil.jsonl.gz" },
];

const BASLIK = {
  "User-Agent": "BicenPortal/1.0 (kurumsal envanter; bilgi@bicen.com.tr)",
};

const bekle = (ms) => new Promise((c) => setTimeout(c, ms));

/** Kayıttaki en uygun görselin adresi */
function gorselAdresi(urun) {
  for (const anahtar of ["image_front_url", "image_url", "image_front_small_url"]) {
    if (urun[anahtar]) return urun[anahtar];
  }

  return null;
}

/**
 * Bir dökümü tarar.
 *
 * Aranan barkod bulunduğunda kümeden çıkarılıyor: sonraki dosyalarda
 * aynı ürünü aramak gereksiz ve hangi barkodların kaldığını görmek
 * ilerlemeyi de anlaşılır kılıyor.
 */
function tara(yol, aranan, bulunan, ad) {
  return new Promise((coz, sakat) => {
    let satir = 0;

    const okuyucu = readline.createInterface({
      input: fs.createReadStream(yol).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });

    okuyucu.on("line", (metin) => {
      satir++;

      if (satir % 200000 === 0)
        process.stdout.write(
          `\r  ${ad}: ${(satir / 1000).toFixed(0)}b satır, ${bulunan.size} eşleşme   `
        );

      /* Barkod satırın başlarında geçiyor; JSON ayrıştırmadan önce
         kaba bir eleme yapmak taramayı kat kat hızlandırıyor.
         Milyonlarca satırın hepsini ayrıştırmak saatler sürerdi. */
      if (aranan.size === 0) {
        okuyucu.close();
        return;
      }

      let urun;

      try {
        urun = JSON.parse(metin);
      } catch {
        return;
      }

      const kod = String(urun.code ?? "").replace(/^0+/, "");

      if (!aranan.has(kod)) return;

      const adres = gorselAdresi(urun);

      if (adres) bulunan.set(kod, { adres, ad: urun.product_name ?? "" });

      aranan.delete(kod);
    });

    okuyucu.on("close", () => {
      process.stdout.write(
        `\r  ${ad}: ${(satir / 1000).toFixed(0)}b satır tarandı, toplam ${bulunan.size} eşleşme      \n`
      );
      coz();
    });

    okuyucu.on("error", sakat);
  });
}

async function gorselIndir(kod, adres, klasor) {
  const hedef = path.join(klasor, `${kod}.jpg`);

  if (fs.existsSync(hedef)) return "atlandi";

  try {
    const yanit = await fetch(adres, { headers: BASLIK });

    if (!yanit.ok) return "hata";

    const icerik = Buffer.from(await yanit.arrayBuffer());

    /* Çok küçük dosyalar genelde yer tutucu görsel */
    if (icerik.length < 3000) return "kucuk";

    fs.writeFileSync(hedef, icerik);

    return "indi";
  } catch {
    return "hata";
  }
}

async function main() {
  const liste = process.argv[2] ?? "barkodlar.txt";

  const kIndex = process.argv.indexOf("--klasor");
  const klasor = kIndex > 0 ? process.argv[kIndex + 1] : "gorseller";

  const dIndex = process.argv.indexOf("--dokum");
  const dokumKlasor = dIndex > 0 ? process.argv[dIndex + 1] : "dokum";

  if (!fs.existsSync(liste)) {
    console.log(`Dosya bulunamadı: ${liste}`);
    process.exit(1);
  }

  fs.mkdirSync(klasor, { recursive: true });

  /* Baştaki sıfırlar atılıyor: Mikro'daki barkod ile dökümdeki kod
     farklı doldurulmuş olabiliyor ve aynı ürün eşleşmiyordu. */
  const barkodlar = [
    ...new Set(
      fs
        .readFileSync(liste, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim().replace(/^0+/, ""))
        .filter(Boolean)
    ),
  ];

  const aranan = new Set(barkodlar);
  const bulunan = new Map();

  console.log(`${barkodlar.length} barkod aranacak\n`);

  for (const d of DOSYALAR) {
    const yol = path.join(dokumKlasor, d.dosya);

    if (!fs.existsSync(yol)) {
      console.log(`  ${d.ad}: döküm yok, atlanıyor`);
      continue;
    }

    if (aranan.size === 0) break;

    try {
      await tara(yol, aranan, bulunan, d.ad);
    } catch (h) {
      console.log(`\r  ${d.ad}: okunamadı (${h.message})      `);
    }
  }

  console.log(`\n${bulunan.size} ürünün görseli bulundu, indiriliyor\n`);

  const sayac = { indi: 0, atlandi: 0, hata: 0, kucuk: 0 };
  let sira = 0;

  for (const [kod, bilgi] of bulunan) {
    sira++;

    const sonuc = await gorselIndir(kod, bilgi.adres, klasor);

    sayac[sonuc]++;

    if (sira % 20 === 0 || sira === bulunan.size)
      process.stdout.write(
        `\r  ${sira}/${bulunan.size} · indirilen ${sayac.indi}   `
      );

    /* Resim sunucusu daha esnek ama yine de nefes payı bırakılıyor */
    if (sonuc === "indi") await bekle(120);
  }

  const eksik = barkodlar.filter((b) => !bulunan.has(b));
  const eksikDosya = path.join(klasor, "_bulunamayanlar.txt");

  fs.writeFileSync(eksikDosya, eksik.join("\n"), "utf8");

  console.log(
    `\n\nİndirilen: ${sayac.indi}   Zaten vardı: ${sayac.atlandi}   ` +
      `Bulunamayan: ${eksik.length}   Hata: ${sayac.hata + sayac.kucuk}`
  );
  console.log(`Bulunamayanlar: ${eksikDosya}`);
  console.log(
    "\nGörselleri portalda Yönetim → Ürün Görselleri ekranından toplu olarak yükleyebilirsiniz."
  );
}

main();
