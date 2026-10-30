/**
 * Şube raporunu Excel'e aktarır.
 *
 * Üç sayfa üretir:
 *
 * 1. "Şube Raporu" — bölgeye göre gruplanmış, ara toplamlı, renkli
 *    başlıklı, olumlu oranı renk ölçekli okunur rapor. Yöneticiye
 *    doğrudan gönderilebilecek hâl.
 * 2. "Veri" — satır başına bir şube, düz tablo (Excel Tablosu biçiminde).
 *    Pivotun kaynağı budur; kullanıcı isterse kendi pivotunu da bundan
 *    kurar.
 * 3. "Pivot" — Bölge › Şube satırlarında Başvuru / Görüşme / Olumlu /
 *    İşe Alındı / Olumsuz toplamlarıyla GERÇEK bir Excel PivotTable.
 *    exceljs pivot üretemediği için dosya yazıldıktan sonra OpenXML
 *    parçaları elle eklenir (aşağıda `pivotEkle`). Önbellek
 *    `refreshOnLoad` ile işaretlenir; Excel açılışta kendisi hesaplar.
 *
 * Pivot parçası açılışta sorun çıkarırsa `PIVOT_EKLE` kapatılır; ilk iki
 * sayfa ondan bağımsız çalışır.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { dosyaIndir } from "./formIndir";

const PIVOT_EKLE = true;

export interface SubeSatiri {
  bolge?: string | null;
  ad: string;
  toplam: number;
  gorusme: number;
  olumlu: number;
  iseAlindi?: number;
  olumsuz: number;
}

/* Renkler: Biçen yeşili ve türevleri */
const KOYU = "1F4D2B";
const YESIL = "7CB518";
const ACIK_YESIL = "F2F9E8";
const GRI = "F3F4F1";
const BEYAZ = "FFFFFF";

const dolgu = (renk: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF" + renk },
});

const inceCerceve: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFE0E4DA" } },
  bottom: { style: "thin", color: { argb: "FFE0E4DA" } },
  left: { style: "thin", color: { argb: "FFE0E4DA" } },
  right: { style: "thin", color: { argb: "FFE0E4DA" } },
};

const xmlKacir = (m: string) =>
  m.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Excel sütun harfi (1 → A) */
const sutunHarfi = (n: number) => {
  let s = "";
  while (n > 0) {
    const k = (n - 1) % 26;
    s = String.fromCharCode(65 + k) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export const subeRaporuIndir = async (
  satirlar: SubeSatiri[],
  donemMetni: string,
  dosyaAdi = "sube_raporu"
) => {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "Biçen Kariyer";
  kitap.created = new Date();

  const veri = satirlar
    .map((s) => ({
      bolge: (s.bolge ?? "Tanımsız").trim() || "Tanımsız",
      sube: s.ad,
      basvuru: s.toplam ?? 0,
      gorusme: s.gorusme ?? 0,
      olumlu: s.olumlu ?? 0,
      iseAlindi: s.iseAlindi ?? 0,
      olumsuz: s.olumsuz ?? 0,
    }))
    .sort((a, b) => a.bolge.localeCompare(b.bolge, "tr") || b.basvuru - a.basvuru);

  /* ==================================================================== */
  /* 1) Şube Raporu — okunur rapor                                        */
  /* ==================================================================== */
  const rapor = kitap.addWorksheet("Şube Raporu", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  rapor.columns = [
    { key: "bolge", width: 22 },
    { key: "sube", width: 32 },
    { key: "basvuru", width: 12 },
    { key: "gorusme", width: 12 },
    { key: "olumlu", width: 12 },
    { key: "iseAlindi", width: 12 },
    { key: "olumsuz", width: 12 },
    { key: "oran", width: 14 },
    { key: "iseAlimOrani", width: 14 },
  ];

  rapor.mergeCells("A1:I1");
  const baslik = rapor.getCell("A1");
  baslik.value = "Şube Bazında Başvuru Raporu";
  baslik.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF" + KOYU } };
  baslik.alignment = { vertical: "middle" };
  rapor.getRow(1).height = 28;

  rapor.mergeCells("A2:I2");
  const altBaslik = rapor.getCell("A2");
  altBaslik.value = `Dönem: ${donemMetni} · Oluşturma: ${new Date().toLocaleString("tr-TR")}`;
  altBaslik.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF6B7280" } };

  const basliklar = [
    "Bölge", "Şube", "Başvuru", "Görüşme", "Olumlu", "İşe Alındı", "Olumsuz",
    "Olumlu Oranı", "İşe Alım Oranı",
  ];
  const baslikSatiri = rapor.getRow(4);
  baslikSatiri.values = basliklar;
  baslikSatiri.height = 22;
  baslikSatiri.eachCell((h) => {
    h.font = { name: "Calibri", bold: true, color: { argb: "FF" + BEYAZ } };
    h.fill = dolgu(KOYU);
    h.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    h.border = inceCerceve;
  });
  rapor.getCell("A4").alignment = { vertical: "middle", horizontal: "left" };
  rapor.getCell("B4").alignment = { vertical: "middle", horizontal: "left" };

  let satirNo = 5;
  let bolgeBas = 0;
  const veriSatirlari: number[] = [];

  const yaz = (
    n: number,
    degerler: (string | number | null)[],
    secenek: { kalin?: boolean; dolgu?: string; italik?: boolean } = {}
  ) => {
    const r = rapor.getRow(n);
    r.values = degerler as any;
    r.eachCell({ includeEmpty: true }, (c, i) => {
      c.border = inceCerceve;
      c.font = { name: "Calibri", size: 11, bold: !!secenek.kalin, italic: !!secenek.italik };
      if (secenek.dolgu) c.fill = dolgu(secenek.dolgu);
      if (i >= 3 && i <= 7) c.numFmt = "#,##0";
      if (i >= 8) c.numFmt = "0%";
      c.alignment = { vertical: "middle", horizontal: i >= 3 ? "right" : "left" };
    });
    /* Boş bırakılan hücreler de çerçeve alsın */
    for (let i = 1; i <= 9; i++) {
      const c = r.getCell(i);
      c.border = inceCerceve;
      if (secenek.dolgu) c.fill = dolgu(secenek.dolgu);
    }
  };

  const oranFormulu = (n: number, pay: string, payda = "C") => ({
    formula: `IF(${payda}${n}=0,0,${pay}${n}/${payda}${n})`,
  });

  const bolgeAraToplami = (bolge: string, bas: number, son: number) => {
    const t = (harf: string) => ({ formula: `SUBTOTAL(9,${harf}${bas}:${harf}${son})` });
    yaz(
      satirNo,
      [`${bolge} toplamı`, `${son - bas + 1} şube`, t("C") as any, t("D") as any, t("E") as any,
       t("F") as any, t("G") as any, oranFormulu(satirNo, "E") as any,
       oranFormulu(satirNo, "F") as any],
      { kalin: true, dolgu: ACIK_YESIL }
    );
    satirNo++;
  };

  let oncekiBolge: string | null = null;

  veri.forEach((v, i) => {
    if (v.bolge !== oncekiBolge) {
      if (oncekiBolge !== null) bolgeAraToplami(oncekiBolge, bolgeBas, satirNo - 1);
      oncekiBolge = v.bolge;
      bolgeBas = satirNo;
    }

    yaz(
      satirNo,
      [v.bolge, v.sube, v.basvuru, v.gorusme, v.olumlu, v.iseAlindi, v.olumsuz,
       oranFormulu(satirNo, "E") as any, oranFormulu(satirNo, "F") as any],
      { dolgu: i % 2 === 0 ? BEYAZ : GRI }
    );
    veriSatirlari.push(satirNo);
    satirNo++;
  });

  if (oncekiBolge !== null) bolgeAraToplami(oncekiBolge, bolgeBas, satirNo - 1);

  /* Genel toplam: SUBTOTAL ara toplamları çift saymaz */
  const ilkVeri = veriSatirlari[0] ?? 5;
  const sonVeri = satirNo - 1;
  const gt = (harf: string) => ({ formula: `SUBTOTAL(9,${harf}${ilkVeri}:${harf}${sonVeri})` });
  yaz(
    satirNo,
    ["GENEL TOPLAM", `${veri.length} şube`, gt("C") as any, gt("D") as any, gt("E") as any,
     gt("F") as any, gt("G") as any, oranFormulu(satirNo, "E") as any,
     oranFormulu(satirNo, "F") as any],
    { kalin: true, dolgu: YESIL }
  );
  rapor.getRow(satirNo).eachCell((c) => {
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF" + BEYAZ } };
  });
  const genelToplamSatiri = satirNo;

  /* Olumlu oranı: kırmızı → sarı → yeşil renk ölçeği (yalnızca şube satırları) */
  if (veriSatirlari.length > 0) {
    const aralik = veriSatirlari.map((n) => `H${n}`).join(" ");
    rapor.addConditionalFormatting({
      ref: aralik,
      rules: [
        {
          type: "colorScale",
          priority: 1,
          cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }],
          color: [{ argb: "FFF8696B" }, { argb: "FFFFEB84" }, { argb: "FF63BE7B" }],
        } as any,
      ],
    });

    /* Başvuru sütununda veri çubuğu: hangi şube yoğun, bir bakışta */
    rapor.addConditionalFormatting({
      ref: veriSatirlari.map((n) => `C${n}`).join(" "),
      rules: [
        {
          type: "dataBar",
          priority: 2,
          cfvo: [{ type: "min" }, { type: "max" }],
          color: { argb: "FF" + YESIL },
        } as any,
      ],
    });
  }

  rapor.autoFilter = { from: "A4", to: `I${genelToplamSatiri}` };

  const not = rapor.getCell(`A${genelToplamSatiri + 2}`);
  not.value =
    "Görüşme = görüşme talebi ve sonrası; Olumlu = olumlu, evrak, işe alındı; oranlar başvuruya göre. " +
    "Bölge ara toplamları ve genel toplam SUBTOTAL ile hesaplanır, süzgeç uygulanınca kendiliğinden güncellenir.";
  not.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF6B7280" } };
  rapor.mergeCells(`A${genelToplamSatiri + 2}:I${genelToplamSatiri + 2}`);

  /* ==================================================================== */
  /* 2) Veri — pivot kaynağı, Excel Tablosu                               */
  /* ==================================================================== */
  const veriSayfasi = kitap.addWorksheet("Veri", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  veriSayfasi.columns = [
    { key: "bolge", width: 22 }, { key: "sube", width: 32 }, { key: "basvuru", width: 12 },
    { key: "gorusme", width: 12 }, { key: "olumlu", width: 12 }, { key: "iseAlindi", width: 12 },
    { key: "olumsuz", width: 12 },
  ];

  const tabloSatirlari = veri.map((v) => [
    v.bolge, v.sube, v.basvuru, v.gorusme, v.olumlu, v.iseAlindi, v.olumsuz,
  ]);

  veriSayfasi.addTable({
    name: "SubeVerisi",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
    columns: [
      { name: "Bölge" }, { name: "Şube" }, { name: "Başvuru" }, { name: "Görüşme" },
      { name: "Olumlu" }, { name: "İşe Alındı" }, { name: "Olumsuz" },
    ],
    rows: tabloSatirlari.length > 0 ? tabloSatirlari : [["—", "—", 0, 0, 0, 0, 0]],
  });

  /* ==================================================================== */
  /* 3) Pivot sayfası — içeriği yazım sonrası eklenir                     */
  /* ==================================================================== */
  const pivotSayfasi = kitap.addWorksheet("Pivot", { views: [{ showGridLines: false }] });
  pivotSayfasi.getCell("A1").value = "Bu sayfadaki özet tablo Excel'de açılınca oluşur.";
  pivotSayfasi.getCell("A1").font = { italic: true, color: { argb: "FF6B7280" }, size: 9 };
  pivotSayfasi.getColumn(1).width = 34;
  for (let i = 2; i <= 7; i++) pivotSayfasi.getColumn(i).width = 14;

  let govde: ArrayBuffer | Buffer = await kitap.xlsx.writeBuffer();

  if (PIVOT_EKLE && veri.length > 0) {
    try {
      govde = await pivotEkle(govde, {
        sayfaNo: kitap.worksheets.indexOf(pivotSayfasi) + 1,
        kaynakSayfa: "Veri",
        kaynakRef: `A1:G${veri.length + 1}`,
        alanlar: ["Bölge", "Şube", "Başvuru", "Görüşme", "Olumlu", "İşe Alındı", "Olumsuz"],
        satirAlanlari: [0, 1],
        sutunAlanlari: [],
        degerAlanlari: [2, 3, 4, 5, 6],
        ad: "SubeOzeti",
        baslik: "Bölge / Şube",
        satirlar: veri.map((v) => [v.bolge, v.sube, v.basvuru, v.gorusme, v.olumlu, v.iseAlindi, v.olumsuz]),
      });
    } catch (hata) {
      /* Pivot parçası eklenemezse dosya pivotsuz iner; rapor ve veri
         sayfaları etkilenmez */
      console.warn("Pivot eklenemedi, dosya pivotsuz indiriliyor", hata);
      govde = await kitap.xlsx.writeBuffer();
    }
  }

  const tarih = new Date().toISOString().slice(0, 10);

  dosyaIndir(
    new Blob([govde as any], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${dosyaAdi}_${tarih}.xlsx`
  );
};

/* ======================================================================== */
/* PivotTable parçaları                                                     */
/* ======================================================================== */

interface PivotTanimi {
  /** Pivotun yerleşeceği sayfa sırası (exceljs sırası: 1 tabanlı) */
  sayfaNo: number;
  kaynakSayfa: string;
  kaynakRef: string;
  /** Kaynak tablonun başlıkları, sırayla */
  alanlar: string[];
  /** Satır alanları (alan dizini) */
  satirAlanlari: number[];
  /** Sütun alanları (alan dizini) */
  sutunAlanlari: number[];
  /** Toplanacak sayısal alanlar (alan dizini) */
  degerAlanlari: number[];
  ad: string;
  baslik: string;
  /** Kaynak satırlar (başlık hariç). Verilirse önbellek kayıtları ve
      paylaşılan öğeler tam yazılır; Excel yerleşimi yeniden kurmak zorunda
      kalmaz, satır alanlarının sırası korunur. */
  satirlar?: (string | number)[][];
}

/**
 * exceljs'in yazdığı dosyaya pivot önbelleği ve pivot tablosu ekler.
 *
 * Önbellek kayıtları yazılmaz; `refreshOnLoad="1"` ile Excel açılışta
 * hesaplar. Excel'in "biçim ve uzantı eşleşmiyor" uyarısı, HTML'i .xls
 * uzantısıyla vermekten çıkıyordu; burada gerçek bir .xlsx paketi
 * üretilir.
 */
const pivotEkle = async (govde: ArrayBuffer | Buffer, t: PivotTanimi) => {
  const zip = await JSZip.loadAsync(govde as any);

  const satirMi = new Set(t.satirAlanlari);
  const sutunMu = new Set(t.sutunAlanlari);
  const degerMi = new Set(t.degerAlanlari);
  const satirlar = t.satirlar ?? [];

  /* Metin alanlarının paylaşılan öğeleri: her alan için benzersiz değer
     listesi ve değer → dizin haritası. Kayıtlar dizinle yazılır. */
  const paylasilan = t.alanlar.map((_, i) => {
    if (degerMi.has(i)) return null;
    const liste: string[] = [];
    const harita = new Map<string, number>();
    satirlar.forEach((r) => {
      const v = String(r[i] ?? "");
      if (!harita.has(v)) {
        harita.set(v, liste.length);
        liste.push(v);
      }
    });
    return { liste, harita };
  });

  const sayisalAralik = (i: number) => {
    let enAz = Infinity, enCok = -Infinity;
    satirlar.forEach((r) => {
      const v = Number(r[i] ?? 0);
      if (v < enAz) enAz = v;
      if (v > enCok) enCok = v;
    });
    if (!Number.isFinite(enAz)) { enAz = 0; enCok = 0; }
    return { enAz, enCok };
  };

  /* --- pivotCacheDefinition1.xml */
  const cacheFields = t.alanlar
    .map((ad, i) => {
      if (degerMi.has(i)) {
        const { enAz, enCok } = sayisalAralik(i);
        const tamSayi = satirlar.every((r) => Number.isInteger(Number(r[i] ?? 0)));
        return `<cacheField name="${xmlKacir(ad)}" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"${tamSayi ? ` containsInteger="1"` : ""} minValue="${enAz}" maxValue="${enCok}"/></cacheField>`;
      }
      const py = paylasilan[i]!;
      const ogeler = py.liste.map((v) => `<s v="${xmlKacir(v)}"/>`).join("");
      return `<cacheField name="${xmlKacir(ad)}" numFmtId="0"><sharedItems count="${py.liste.length}">${ogeler}</sharedItems></cacheField>`;
    })
    .join("");

  const cacheDef =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `r:id="rId1" refreshOnLoad="1" refreshedBy="Biçen Kariyer" refreshedDate="45000" ` +
    `createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${satirlar.length}">` +
    `<cacheSource type="worksheet"><worksheetSource ref="${t.kaynakRef}" sheet="${xmlKacir(t.kaynakSayfa)}"/></cacheSource>` +
    `<cacheFields count="${t.alanlar.length}">${cacheFields}</cacheFields>` +
    `</pivotCacheDefinition>`;

  const kayitlar = satirlar
    .map(
      (r) =>
        `<r>` +
        t.alanlar
          .map((_, i) =>
            degerMi.has(i)
              ? `<n v="${Number(r[i] ?? 0)}"/>`
              : `<x v="${paylasilan[i]!.harita.get(String(r[i] ?? "")) ?? 0}"/>`
          )
          .join("") +
        `</r>`
    )
    .join("");

  const cacheRecords =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" count="${satirlar.length}">${kayitlar}</pivotCacheRecords>`;

  const cacheDefRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" Target="pivotCacheRecords1.xml"/>` +
    `</Relationships>`;

  /* --- pivotTable1.xml */
  /* Eksen alanlarında öğe listesi paylaşılan öğelerle bire bir: Excel
     yerleşimi bilerek kurar, alan sırasını karıştırmaz */
  const ogeListesi = (i: number) => {
    const n = paylasilan[i]?.liste.length ?? 0;
    const ogeler = Array.from({ length: n }, (_, k) => `<item x="${k}"/>`).join("");
    return `<items count="${n + 1}">${ogeler}<item t="default"/></items>`;
  };

  const pivotFields = t.alanlar
    .map((_, i) =>
      satirMi.has(i)
        ? `<pivotField axis="axisRow" showAll="0">${ogeListesi(i)}</pivotField>`
        : sutunMu.has(i)
        ? `<pivotField axis="axisCol" showAll="0">${ogeListesi(i)}</pivotField>`
        : degerMi.has(i)
        ? `<pivotField dataField="1" showAll="0"/>`
        : `<pivotField showAll="0"/>`
    )
    .join("");

  const dataFields = t.degerAlanlari
    .map((i) => `<dataField name="Toplam ${xmlKacir(t.alanlar[i])}" fld="${i}" baseField="0" baseItem="0"/>`)
    .join("");

  const rowFields = t.satirAlanlari.map((i) => `<field x="${i}"/>`).join("");
  /* Birden çok değer alanı varsa "Değerler" sanal alanı (x=-2) sütuna girer */
  const sutunListesi = [...t.sutunAlanlari.map((i) => `<field x="${i}"/>`),
                        ...(t.degerAlanlari.length > 1 ? [`<field x="-2"/>`] : [])];
  const colFields = sutunListesi.length > 0
    ? `<colFields count="${sutunListesi.length}">${sutunListesi.join("")}</colFields>` : "";

  const colItems = t.degerAlanlari.length > 1 && t.sutunAlanlari.length === 0
    ? `<colItems count="${t.degerAlanlari.length}">` +
      t.degerAlanlari.map((_, k) => (k === 0 ? `<i><x/></i>` : `<i i="${k}"><x v="${k}"/></i>`)).join("") +
      `</colItems>`
    : `<colItems count="1"><i/></colItems>`;

  const sutunSayisi = 1 + Math.max(1, t.degerAlanlari.length);

  const pivotTable =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `name="${xmlKacir(t.ad)}" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" ` +
    `applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Değerler" ` +
    `updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" ` +
    `createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0" rowHeaderCaption="${xmlKacir(t.baslik)}">` +
    `<location ref="A3:${sutunHarfi(sutunSayisi)}6" firstHeaderRow="${t.sutunAlanlari.length > 0 ? 1 : 0}" firstDataRow="${t.sutunAlanlari.length > 0 ? 2 : 1}" firstDataCol="1"/>` +
    `<pivotFields count="${t.alanlar.length}">${pivotFields}</pivotFields>` +
    `<rowFields count="${t.satirAlanlari.length}">${rowFields}</rowFields>` +
    `<rowItems count="1"><i t="grand"><x/></i></rowItems>` +
    colFields + colItems +
    `<dataFields count="${t.degerAlanlari.length}">${dataFields}</dataFields>` +
    `<pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1" showRowStripes="1" showColStripes="0" showLastColumn="1"/>` +
    `</pivotTableDefinition>`;

  const pivotTableRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/>` +
    `</Relationships>`;

  zip.file("xl/pivotCache/pivotCacheDefinition1.xml", cacheDef);
  zip.file("xl/pivotCache/pivotCacheRecords1.xml", cacheRecords);
  zip.file("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels", cacheDefRels);
  zip.file("xl/pivotTables/pivotTable1.xml", pivotTable);
  zip.file("xl/pivotTables/_rels/pivotTable1.xml.rels", pivotTableRels);

  const sayfaRelsYolu = `xl/worksheets/_rels/sheet${t.sayfaNo}.xml.rels`;
  const mevcutRels = await zip.file(sayfaRelsYolu)?.async("string");
  const pivotRel =
    `<Relationship Id="rIdPivot1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/>`;

  zip.file(
    sayfaRelsYolu,
    mevcutRels
      ? mevcutRels.replace("</Relationships>", pivotRel + "</Relationships>")
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pivotRel}</Relationships>`
  );

  const wbRelsYolu = "xl/_rels/workbook.xml.rels";
  const wbRels = (await zip.file(wbRelsYolu)?.async("string")) ?? "";
  if (!wbRels) throw new Error("workbook.xml.rels bulunamadı");
  zip.file(
    wbRelsYolu,
    wbRels.replace(
      "</Relationships>",
      `<Relationship Id="rIdPivotCache1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>`
    )
  );

  const wbYolu = "xl/workbook.xml";
  let wb = (await zip.file(wbYolu)?.async("string")) ?? "";
  if (!wb) throw new Error("workbook.xml bulunamadı");
  if (!wb.includes("xmlns:r=")) {
    wb = wb.replace("<workbook ", `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `);
  }
  const pivotCaches = `<pivotCaches><pivotCache cacheId="1" r:id="rIdPivotCache1"/></pivotCaches>`;
  if (wb.includes("<calcPr")) {
    wb = wb.replace(/(<calcPr[^>]*\/>|<calcPr[^>]*>[\s\S]*?<\/calcPr>)/, `$1${pivotCaches}`);
  } else if (wb.includes("</definedNames>")) {
    wb = wb.replace("</definedNames>", `</definedNames>${pivotCaches}`);
  } else {
    wb = wb.replace("</sheets>", `</sheets>${pivotCaches}`);
  }
  zip.file(wbYolu, wb);

  const ctYolu = "[Content_Types].xml";
  const ct = (await zip.file(ctYolu)?.async("string")) ?? "";
  if (!ct) throw new Error("Content_Types bulunamadı");
  zip.file(
    ctYolu,
    ct.replace(
      "</Types>",
      `<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>` +
        `<Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>` +
        `<Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>` +
        `</Types>`
    )
  );

  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
};

/* ======================================================================== */
/* Norm kadro                                                               */
/* ======================================================================== */

export interface NormGrubu {
  subeKodu?: string;
  subeAdi: string;
  bolge?: string | null;
  norm: number;
  mevcut: number;
  engelli?: number;
  satirlar: { bolum: string; norm?: number | null; mevcut?: number | null }[];
}

/** Pivotta birim › pozisyon altında listelenecek çalışan */
export interface NormPersoneli {
  personelKodu: string;
  adSoyad: string;
  sube: string;
  pozisyon: string;
  girisTarihi?: string | null;
  kimlikNo?: string | null;
  engelli?: boolean;
  telefon?: string | null;
  calismaGunu?: number | null;
}

/**
 * Norm kadroyu Excel'e aktarır: birim × pozisyon çapraz tabloları
 * (norm, mevcut, fark), birim özeti, düz veri ve gerçek PivotTable.
 * Önceki sürüm HTML'i .xls uzantısıyla veriyordu; Excel "biçim ve
 * uzantı eşleşmiyor" uyarısı veriyordu.
 */
export const normKadroIndir = async (
  gruplar: NormGrubu[],
  personeller: NormPersoneli[] = [],
  dosyaAdi = "norm_kadro"
) => {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "Biçen Kariyer";

  const pozisyonlar = Array.from(
    new Set(gruplar.flatMap((g) => (g.satirlar ?? []).map((k) => k.bolum).filter(Boolean)))
  ).sort((a, b) => a.localeCompare(b, "tr"));

  const siraliGruplar = [...gruplar].sort(
    (a, b) =>
      (a.bolge ?? "Tanımsız").localeCompare(b.bolge ?? "Tanımsız", "tr") ||
      a.subeAdi.localeCompare(b.subeAdi, "tr")
  );

  const baslikStili = (h: ExcelJS.Cell, sola = false) => {
    h.font = { name: "Calibri", bold: true, color: { argb: "FF" + BEYAZ } };
    h.fill = dolgu(KOYU);
    h.alignment = { vertical: "middle", horizontal: sola ? "left" : "center", wrapText: true };
    h.border = inceCerceve;
  };

  /** Birim × pozisyon çapraz sayfası */
  const caprazSayfa = (ad: string, alan: "norm" | "mevcut" | "fark", aciklama: string) => {
    const ws = kitap.addWorksheet(ad, {
      views: [{ state: "frozen", xSplit: 2, ySplit: 3, showGridLines: false }],
    });

    ws.getColumn(1).width = 30;
    ws.getColumn(2).width = 18;
    pozisyonlar.forEach((_, i) => (ws.getColumn(i + 3).width = 14));
    ws.getColumn(pozisyonlar.length + 3).width = 12;

    ws.mergeCells(1, 1, 1, pozisyonlar.length + 3);
    ws.getCell("A1").value = `${ad} — ${aciklama}`;
    ws.getCell("A1").font = { size: 14, bold: true, color: { argb: "FF" + KOYU } };
    ws.getRow(1).height = 24;

    const basliklar = ["Birim", "Bölge", ...pozisyonlar, "Toplam"];
    const hr = ws.getRow(3);
    hr.values = basliklar;
    hr.height = 30;
    hr.eachCell((h, i) => baslikStili(h, i <= 2));

    siraliGruplar.forEach((g, gi) => {
      const r = ws.getRow(4 + gi);
      const degerler: (string | number | null)[] = [g.subeAdi, g.bolge ?? "Tanımsız"];

      pozisyonlar.forEach((poz) => {
        const k = (g.satirlar ?? []).find((x) => x.bolum === poz);
        const norm = k?.norm ?? 0;
        const mevcut = k?.mevcut ?? 0;
        const v = alan === "norm" ? norm : alan === "mevcut" ? mevcut : mevcut - norm;
        degerler.push(k ? v : null);
      });

      const sonSutun = sutunHarfi(pozisyonlar.length + 2);
      degerler.push({ formula: `SUM(C${4 + gi}:${sonSutun}${4 + gi})` } as any);

      r.values = degerler as any;
      r.eachCell({ includeEmpty: true }, (c, i) => {
        c.border = inceCerceve;
        c.font = { name: "Calibri", size: 11, bold: i === 1 || i === pozisyonlar.length + 3 };
        c.fill = dolgu(gi % 2 === 0 ? BEYAZ : GRI);
        if (i >= 3) {
          c.numFmt = "0.0;-0.0;";
          c.alignment = { horizontal: "center" };
        }
      });
    });

    const toplamNo = 4 + siraliGruplar.length;
    const tr = ws.getRow(toplamNo);
    const toplamlar: any[] = ["TOPLAM", `${siraliGruplar.length} birim`];
    for (let i = 3; i <= pozisyonlar.length + 3; i++)
      toplamlar.push({ formula: `SUM(${sutunHarfi(i)}4:${sutunHarfi(i)}${toplamNo - 1})` });
    tr.values = toplamlar;
    tr.eachCell({ includeEmpty: true }, (c, i) => {
      c.border = inceCerceve;
      c.fill = dolgu(YESIL);
      c.font = { name: "Calibri", bold: true, color: { argb: "FF" + BEYAZ } };
      if (i >= 3) {
        c.numFmt = "0.0;-0.0;";
        c.alignment = { horizontal: "center" };
      }
    });

    if (alan === "fark" && siraliGruplar.length > 0) {
      const ref = `C4:${sutunHarfi(pozisyonlar.length + 3)}${toplamNo - 1}`;
      ws.addConditionalFormatting({
        ref,
        rules: [
          { type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 1,
            style: { fill: dolgu("FDE2E1"), font: { color: { argb: "FFB42318" }, bold: true } } } as any,
          { type: "cellIs", operator: "greaterThan", formulae: ["0"], priority: 2,
            style: { fill: dolgu("FFF1D6"), font: { color: { argb: "FF9A5B00" } } } } as any,
        ],
      });
    }

    ws.autoFilter = { from: "A3", to: `${sutunHarfi(pozisyonlar.length + 3)}${toplamNo - 1}` };
  };

  caprazSayfa("Norm Kadro", "norm", "birim × pozisyon, planlanan kadro");
  caprazSayfa("Kadro Doluluğu", "mevcut", "birim × pozisyon, çalışan sayısı");
  caprazSayfa("Fark", "fark", "mevcut − norm; eksi kırmızı (eksik), artı turuncu (fazla)");

  /* ---- Mevcut Personel: kişi listesi */
  const bolgeAdi = (sube: string) => {
    const g = siraliGruplar.find(
      (x) => x.subeAdi.toLocaleLowerCase("tr") === (sube ?? "").toLocaleLowerCase("tr")
        || (x.subeKodu && x.subeKodu.toLocaleLowerCase("tr") === (sube ?? "").toLocaleLowerCase("tr"))
    );
    return g?.bolge ?? "Tanımsız";
  };

  const mp = kitap.addWorksheet("Mevcut Personel", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  mp.columns = [
    { header: "Bölge", key: "bolge", width: 18 },
    { header: "Birim", key: "birim", width: 28 },
    { header: "Pozisyon", key: "pozisyon", width: 22 },
    { header: "Ad Soyad", key: "adSoyad", width: 28 },
    { header: "Sicil", key: "sicil", width: 10 },
    { header: "TC Kimlik No", key: "tc", width: 16 },
    { header: "Engelli", key: "engelli", width: 10 },
    { header: "İşe Giriş", key: "giris", width: 13 },
    { header: "Çalışma (gün)", key: "gun", width: 13 },
    { header: "Telefon", key: "telefon", width: 14 },
  ];
  mp.getRow(1).eachCell((h, i) => baslikStili(h, i <= 4));
  mp.getRow(1).height = 22;

  const siraliPersonel = [...personeller].sort(
    (a, b) =>
      bolgeAdi(a.sube).localeCompare(bolgeAdi(b.sube), "tr") ||
      (a.sube ?? "").localeCompare(b.sube ?? "", "tr") ||
      (a.pozisyon ?? "").localeCompare(b.pozisyon ?? "", "tr") ||
      a.adSoyad.localeCompare(b.adSoyad, "tr")
  );

  siraliPersonel.forEach((p, i) => {
    const r = mp.addRow([
      bolgeAdi(p.sube), p.sube, p.pozisyon || "—", p.adSoyad, p.personelKodu,
      p.kimlikNo || "", p.engelli ? "Evet" : "Hayır",
      p.girisTarihi ? new Date(p.girisTarihi) : null,
      p.calismaGunu ?? null, p.telefon || "",
    ]);
    r.eachCell({ includeEmpty: true }, (c, k) => {
      c.border = inceCerceve;
      c.fill = dolgu(i % 2 === 0 ? BEYAZ : GRI);
      if (k === 8) c.numFmt = "dd.mm.yyyy";
      if (k === 9) c.numFmt = "#,##0";
      if (k === 6) c.numFmt = "@";
      if (k === 7 && p.engelli) {
        c.font = { bold: true, color: { argb: "FF9A5B00" } };
        c.fill = dolgu("FFF1D6");
      }
    });
  });

  if (siraliPersonel.length > 0)
    mp.autoFilter = { from: "A1", to: `J${siraliPersonel.length + 1}` };

  /* ---- Özet */
  const oz = kitap.addWorksheet("Özet", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  oz.columns = [
    { header: "Birim", key: "birim", width: 30 }, { header: "Bölge", key: "bolge", width: 18 },
    { header: "Norm", key: "norm", width: 12 }, { header: "Mevcut", key: "mevcut", width: 12 },
    { header: "Fark", key: "fark", width: 12 }, { header: "Doluluk", key: "doluluk", width: 12 },
    { header: "Engelli", key: "engelli", width: 12 },
  ];
  oz.getRow(1).eachCell((h, i) => baslikStili(h, i <= 2));
  siraliGruplar.forEach((g, i) => {
    const n = i + 2;
    const r = oz.addRow([g.subeAdi, g.bolge ?? "Tanımsız", g.norm ?? 0, g.mevcut ?? 0,
      { formula: `D${n}-C${n}` }, { formula: `IF(C${n}=0,0,D${n}/C${n})` }, g.engelli ?? 0]);
    r.eachCell({ includeEmpty: true }, (c, k) => {
      c.border = inceCerceve;
      c.fill = dolgu(i % 2 === 0 ? BEYAZ : GRI);
      if (k >= 3 && k !== 6) c.numFmt = "0.0;-0.0;0";
      if (k === 6) c.numFmt = "0%";
      if (k >= 3) c.alignment = { horizontal: "center" };
    });
  });
  const ozToplam = oz.addRow(["TOPLAM", "", { formula: `SUM(C2:C${siraliGruplar.length + 1})` },
    { formula: `SUM(D2:D${siraliGruplar.length + 1})` }, { formula: `SUM(E2:E${siraliGruplar.length + 1})` },
    { formula: `IF(C${siraliGruplar.length + 2}=0,0,D${siraliGruplar.length + 2}/C${siraliGruplar.length + 2})` },
    { formula: `SUM(G2:G${siraliGruplar.length + 1})` }]);
  ozToplam.eachCell({ includeEmpty: true }, (c, k) => {
    c.fill = dolgu(YESIL); c.font = { bold: true, color: { argb: "FF" + BEYAZ } }; c.border = inceCerceve;
    if (k >= 3 && k !== 6) c.numFmt = "0.0;-0.0;0";
    if (k === 6) c.numFmt = "0%";
  });
  if (siraliGruplar.length > 0) {
    oz.addConditionalFormatting({
      ref: `E2:E${siraliGruplar.length + 1}`,
      rules: [
        { type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 1,
          style: { fill: dolgu("FDE2E1"), font: { color: { argb: "FFB42318" }, bold: true } } } as any,
        { type: "cellIs", operator: "greaterThan", formulae: ["0"], priority: 2,
          style: { fill: dolgu("FFF1D6"), font: { color: { argb: "FF9A5B00" } } } } as any,
      ],
    });
    oz.addConditionalFormatting({
      ref: `F2:F${siraliGruplar.length + 1}`,
      rules: [{ type: "colorScale", priority: 3,
        cfvo: [{ type: "num", value: 0.7 }, { type: "num", value: 1 }, { type: "num", value: 1.2 }],
        color: [{ argb: "FFF8696B" }, { argb: "FF63BE7B" }, { argb: "FFFFEB84" }] } as any],
    });
  }

  /* ---- Veri (pivot kaynağı): kişi düzeyinde.

     Pivotta birim › pozisyon altında çalışanların adı görünsün diye her
     çalışan bir satırdır (Mevcut = 1). Norm kişiye ait olmadığı için
     pozisyon başına tek bir "(norm)" satırında taşınır (Mevcut = 0);
     böylece pozisyon düzeyinde Norm ve Mevcut toplamları doğru çıkar,
     kişi düzeyinde de kim nerede görünür. */
  const veri = kitap.addWorksheet("Veri", { views: [{ state: "frozen", ySplit: 1 }] });
  const duz: (string | number)[][] = [];

  const sade = (m: string) => (m ?? "").trim().toLocaleLowerCase("tr");

  siraliGruplar.forEach((g) => {
    const bolge = g.bolge ?? "Tanımsız";

    /* Bu birimin çalışanları: şube adı ya da koduyla eşleşir */
    const birimPersoneli = personeller.filter(
      (p) => sade(p.sube) === sade(g.subeAdi) || (g.subeKodu && sade(p.sube) === sade(g.subeKodu))
    );

    const kullanilan = new Set<string>();

    (g.satirlar ?? []).forEach((k) => {
      duz.push([bolge, g.subeAdi, k.bolum, "(norm)", "", k.norm ?? 0, 0]);

      birimPersoneli
        .filter((p) => sade(p.pozisyon) === sade(k.bolum))
        .forEach((p) => {
          kullanilan.add(p.personelKodu);
          duz.push([bolge, g.subeAdi, k.bolum, p.adSoyad, p.personelKodu, 0, 1]);
        });
    });

    /* Kadro planında tanımlı olmayan pozisyondaki çalışanlar da düşmesin */
    birimPersoneli
      .filter((p) => !kullanilan.has(p.personelKodu))
      .forEach((p) =>
        duz.push([bolge, g.subeAdi, p.pozisyon || "(pozisyonsuz)", p.adSoyad, p.personelKodu, 0, 1])
      );
  });

  veri.getColumn(1).width = 18; veri.getColumn(2).width = 30; veri.getColumn(3).width = 26;
  veri.getColumn(4).width = 30; veri.getColumn(5).width = 12;
  [6, 7].forEach((i) => (veri.getColumn(i).width = 10));
  veri.addTable({
    name: "NormVerisi", ref: "A1", headerRow: true, totalsRow: false,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
    columns: [{ name: "Bölge" }, { name: "Birim" }, { name: "Pozisyon" }, { name: "Personel" },
      { name: "Sicil" }, { name: "Norm" }, { name: "Mevcut" }],
    rows: duz.length > 0 ? duz : [["—", "—", "—", "—", "", 0, 0]],
  });

  /* ---- Pivot sayfası */
  const pv = kitap.addWorksheet("Pivot", { views: [{ showGridLines: false }] });
  pv.getCell("A1").value =
    "Bölge › Birim › Pozisyon › Personel satırlarında Norm ve Mevcut toplamları. " +
    "Pozisyon satırında norm ve çalışan sayısı, altında çalışanların adı. Excel'de açılınca oluşur.";
  pv.getCell("A1").font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  pv.getColumn(1).width = 34;

  let govde: ArrayBuffer | Buffer = await kitap.xlsx.writeBuffer();

  if (PIVOT_EKLE && duz.length > 0) {
    try {
      govde = await pivotEkle(govde, {
        sayfaNo: kitap.worksheets.indexOf(pv) + 1,
        kaynakSayfa: "Veri",
        kaynakRef: `A1:G${duz.length + 1}`,
        alanlar: ["Bölge", "Birim", "Pozisyon", "Personel", "Sicil", "Norm", "Mevcut"],
        satirAlanlari: [0, 1, 2, 3],
        sutunAlanlari: [],
        degerAlanlari: [5, 6],
        ad: "NormKadroOzeti",
        baslik: "Bölge / Birim / Pozisyon / Personel",
        satirlar: duz,
      });
    } catch (hata) {
      console.warn("Pivot eklenemedi, dosya pivotsuz indiriliyor", hata);
      govde = await kitap.xlsx.writeBuffer();
    }
  }

  dosyaIndir(
    new Blob([govde as any], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${dosyaAdi}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
};

/* ======================================================================== */
/* Genel tablo çıktısı                                                      */
/* ======================================================================== */

export type SutunTipi = "metin" | "sayi" | "ondalik" | "yuzde" | "tarih" | "tarihSaat" | "para";

export interface TabloSutunu {
  ad: string;
  tip?: SutunTipi;
  genislik?: number;
  /** Bu sütunda kırmızı→sarı→yeşil renk ölçeği (yüzde ve sayılar için) */
  renkOlcegi?: boolean;
  /** Bu sütunda veri çubuğu */
  veriCubugu?: boolean;
  /** Toplam satırında toplansın mı (sayısal sütunlarda varsayılan: evet) */
  toplam?: boolean;
}

export interface TabloSecenekleri {
  baslik: string;
  altBaslik?: string;
  sayfaAdi?: string;
  dosyaAdi: string;
  sutunlar: TabloSutunu[];
  /** Satırlar; hücre değeri sütun tipiyle uyumlu (tarih için Date ya da ISO metin) */
  satirlar: any[][];
  /** Bu sütun dizinine göre ara toplam grupları (satırlar bu sütuna göre sıralanır) */
  grupSutunu?: number;
  /** Genel toplam satırı */
  genelToplam?: boolean;
  /** Excel'de bunun bir grup adı olduğu görünsün diye ara toplam etiketi eki */
  toplamEki?: string;
}

/**
 * Panelin her "Excel'e aktar" düğmesi için ortak biçim: başlık ve dönem
 * satırı, koyu yeşil başlık, şeritli satırlar, ince çerçeve, sayı ve
 * tarih biçimleri, isteğe bağlı ara toplam / genel toplam, renk ölçeği ve
 * veri çubuğu, dondurulmuş başlık, süzgeç. Şube raporuyla aynı görünüm.
 *
 * Toplamlar SUBTOTAL ile yazılır: süzgeç uygulanınca kendiliğinden
 * güncellenir ve genel toplam ara toplamları iki kez saymaz.
 */
export const tabloIndir = async (s: TabloSecenekleri) => {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "Biçen Kariyer";
  kitap.created = new Date();

  const ws = kitap.addWorksheet((s.sayfaAdi ?? "Rapor").slice(0, 31), {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const n = s.sutunlar.length;
  const sonHarf = sutunHarfi(n);

  s.sutunlar.forEach((c, i) => {
    ws.getColumn(i + 1).width =
      c.genislik ??
      (c.tip === "tarihSaat" ? 18 : c.tip === "tarih" ? 13 : c.tip && c.tip !== "metin" ? 12 : 22);
  });

  ws.mergeCells(`A1:${sonHarf}1`);
  const b = ws.getCell("A1");
  b.value = s.baslik;
  b.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FF" + KOYU } };
  ws.getRow(1).height = 28;

  ws.mergeCells(`A2:${sonHarf}2`);
  const ab = ws.getCell("A2");
  ab.value =
    (s.altBaslik ? `${s.altBaslik} · ` : "") + `Oluşturma: ${new Date().toLocaleString("tr-TR")}`;
  ab.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF6B7280" } };

  const hr = ws.getRow(4);
  hr.values = s.sutunlar.map((c) => c.ad);
  hr.height = 22;
  hr.eachCell((h, i) => {
    const c = s.sutunlar[i - 1];
    h.font = { name: "Calibri", bold: true, color: { argb: "FF" + BEYAZ } };
    h.fill = dolgu(KOYU);
    h.alignment = {
      vertical: "middle",
      horizontal: !c.tip || c.tip === "metin" ? "left" : "center",
      wrapText: true,
    };
    h.border = inceCerceve;
  });

  const sayisal = (t?: SutunTipi) => t && ["sayi", "ondalik", "yuzde", "para"].includes(t);
  const toplanir = (c: TabloSutunu) =>
    c.toplam ?? (c.tip === "sayi" || c.tip === "ondalik" || c.tip === "para");

  const numFmt = (t?: SutunTipi) =>
    t === "sayi" ? "#,##0" : t === "ondalik" ? "#,##0.0" : t === "yuzde" ? "0%"
    : t === "para" ? "#,##0.00 ₺" : t === "tarih" ? "dd.mm.yyyy" : t === "tarihSaat" ? "dd.mm.yyyy hh:mm" : undefined;

  const hucreDegeri = (v: any, t?: SutunTipi) => {
    if (v === null || v === undefined || v === "") return null;
    if (t === "tarih" || t === "tarihSaat") {
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? String(v) : d;
    }
    if (sayisal(t)) {
      const nn = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
      return Number.isFinite(nn) ? nn : String(v);
    }
    return typeof v === "boolean" ? (v ? "Evet" : "Hayır") : v;
  };

  const satirYaz = (no: number, degerler: any[], k: { kalin?: boolean; dolgu?: string; beyaz?: boolean }) => {
    const r = ws.getRow(no);
    r.values = degerler as any;
    for (let i = 1; i <= n; i++) {
      const c = r.getCell(i);
      const sutun = s.sutunlar[i - 1];
      c.border = inceCerceve;
      c.font = {
        name: "Calibri", size: 11, bold: !!k.kalin,
        color: k.beyaz ? { argb: "FF" + BEYAZ } : undefined,
      };
      if (k.dolgu) c.fill = dolgu(k.dolgu);
      const f = numFmt(sutun.tip);
      if (f) c.numFmt = f;
      c.alignment = {
        vertical: "middle",
        horizontal: sayisal(sutun.tip) ? "right" : sutun.tip === "tarih" || sutun.tip === "tarihSaat" ? "center" : "left",
      };
    }
  };

  const satirlar = [...s.satirlar];
  if (s.grupSutunu !== undefined) {
    const g = s.grupSutunu;
    satirlar.sort((a, b) => String(a[g] ?? "").localeCompare(String(b[g] ?? ""), "tr"));
  }

  let no = 5;
  const veriSatirlari: number[] = [];
  let grupBas = 0;
  let oncekiGrup: string | null = null;

  const toplamFormulleri = (bas: number, son: number): any[] =>
    s.sutunlar.map((c, i) =>
      toplanir(c) ? { formula: `SUBTOTAL(9,${sutunHarfi(i + 1)}${bas}:${sutunHarfi(i + 1)}${son})` } : null
    );

  const araToplam = (grup: string, bas: number, son: number) => {
    const d = toplamFormulleri(bas, son);
    /* Etiket ilk sütunda, satır sayısı grup sütununda (grup ilk sütunsa
       ikinci sütunda) — okunurken "Adakent toplamı … 2 satır" dizilir */
    d[0] = `${grup} ${s.toplamEki ?? "toplamı"}`;
    const sayiSutunu = s.grupSutunu === 0 ? 1 : s.grupSutunu!;
    if (sayiSutunu < n && !toplanir(s.sutunlar[sayiSutunu])) d[sayiSutunu] = `${son - bas + 1} satır`;
    satirYaz(no, d, { kalin: true, dolgu: ACIK_YESIL });
    no++;
  };

  satirlar.forEach((r, i) => {
    if (s.grupSutunu !== undefined) {
      const grup = String(r[s.grupSutunu] ?? "");
      if (grup !== oncekiGrup) {
        if (oncekiGrup !== null) araToplam(oncekiGrup, grupBas, no - 1);
        oncekiGrup = grup;
        grupBas = no;
      }
    }
    satirYaz(no, s.sutunlar.map((c, k) => hucreDegeri(r[k], c.tip)), { dolgu: i % 2 === 0 ? BEYAZ : GRI });
    veriSatirlari.push(no);
    no++;
  });

  if (s.grupSutunu !== undefined && oncekiGrup !== null) araToplam(oncekiGrup, grupBas, no - 1);

  const ilk = veriSatirlari[0] ?? 5;
  const sonVeri = no - 1;

  if (s.genelToplam && veriSatirlari.length > 0) {
    const d = toplamFormulleri(ilk, sonVeri);
    d[0] = "GENEL TOPLAM";
    if (n > 1 && !toplanir(s.sutunlar[1])) d[1] = `${veriSatirlari.length} satır`;
    satirYaz(no, d, { kalin: true, dolgu: YESIL, beyaz: true });
    no++;
  }

  if (veriSatirlari.length > 0) {
    s.sutunlar.forEach((c, i) => {
      const ref = veriSatirlari.map((r) => `${sutunHarfi(i + 1)}${r}`).join(" ");
      if (c.renkOlcegi)
        ws.addConditionalFormatting({
          ref,
          rules: [{ type: "colorScale", priority: 1,
            cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }],
            color: [{ argb: "FFF8696B" }, { argb: "FFFFEB84" }, { argb: "FF63BE7B" }] } as any],
        });
      if (c.veriCubugu)
        ws.addConditionalFormatting({
          ref,
          rules: [{ type: "dataBar", priority: 2, cfvo: [{ type: "min" }, { type: "max" }],
            color: { argb: "FF" + YESIL } } as any],
        });
    });

    ws.autoFilter = { from: "A4", to: `${sonHarf}${no - 1}` };
  }

  const govde = await kitap.xlsx.writeBuffer();

  dosyaIndir(
    new Blob([govde as any], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${s.dosyaAdi}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
};

/**
 * Ekrandaki bir HTML tabloyu aynı biçimle Excel'e aktarır. Başlıklar
 * thead'in son satırından, gövde tbody'den okunur; "1.234,5" gibi
 * sayılar ve "%12" gibi yüzdeler sayıya çevrilir. Eski HTML→.xls
 * yolunun yerine geçer; Excel'in "biçim uzantıyla eşleşmiyor" uyarısı
 * kalkar.
 */
export const htmlTabloIndir = async (
  tablo: HTMLElement,
  dosyaAdi: string,
  baslik: string,
  altBaslik?: string
) => {
  const basliklar = Array.from(
    tablo.querySelectorAll("thead tr:last-child th, thead tr:last-child td")
  ).map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim());

  const satirlar = Array.from(tablo.querySelectorAll("tbody tr"))
    .map((tr) => Array.from(tr.querySelectorAll("td, th")).map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim()))
    .filter((r) => r.some((h) => h.length > 0));

  const yuzdeMi = (v: string) => /^%\s*-?\d+([.,]\d+)?$/.test(v) || /^-?\d+([.,]\d+)?\s*%$/.test(v);
  const sayiMi = (v: string) => /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(v) || /^-?\d+([.,]\d+)?$/.test(v);

  const sutunlar: TabloSutunu[] = basliklar.map((ad, i) => {
    const ornekler = satirlar.map((r) => r[i] ?? "").filter((v) => v.length > 0);
    if (ornekler.length === 0) return { ad, tip: "metin" };
    if (ornekler.every(yuzdeMi)) return { ad, tip: "yuzde", renkOlcegi: true };
    if (ornekler.every(sayiMi)) {
      const ondalik = ornekler.some((v) => /,\d/.test(v) || /\.\d{1,2}$/.test(v));
      return { ad, tip: ondalik ? "ondalik" : "sayi" };
    }
    return { ad, tip: "metin" };
  });

  const degerler = satirlar.map((r) =>
    r.map((v, i) => {
      const t = sutunlar[i]?.tip;
      if (t === "yuzde") return Number(v.replace("%", "").replace(",", ".").trim()) / 100;
      if (t === "sayi" || t === "ondalik") return Number(v.replace(/\./g, "").replace(",", "."));
      return v;
    })
  );

  await tabloIndir({ baslik, altBaslik, dosyaAdi, sutunlar, satirlar: degerler, genelToplam: true });
};
