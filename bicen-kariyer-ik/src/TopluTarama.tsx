/**
 * ---------------------------------------------------------------------------
 * Toplu tarama (15.10.2026): işe giriş evraklarının hepsi tek seferde
 * ---------------------------------------------------------------------------
 * 1. Kalıcı ayraç seti (16.10.2026): her evrak türünün bir ayracı var
 *    (evrakın adı ve makinenin okuyacağı kare işaretler). Set bir kez
 *    basılıp lamine edilir; kişiye bağlı değildir, her adayda yeniden
 *    kullanılır. Deste: önce ayraç, ardından o evrakın sayfaları.
 *    Ayraç numarası evrak tanımında saklanır ve hiç değişmez.
 * 2. "Tara" (ya da taranmış PDF / resimleri seç): sayfalar okunur; ayraç
 *    görülünce sonraki sayfalar o evraka ayrılır. Boş sayfalar (çift yüz
 *    taramanın arkaları) kendiliğinden çıkarılır.
 * 3. İK önizlemede kontrol eder: sayfayı başka evraka taşır, çıkarır.
 *    "Onayla ve yükle" ile her evrak tek PDF olarak kendi satırına yüklenir.
 *
 * Ayraçsız taramada sayfalar "Atanmamış"a düşer; İK her sayfanın evrakını
 * seçer. Ayraç sayfaları kaydedilmez. Bütün iş tarayıcıda yapılır; sayfalar
 * yalnızca onaydan sonra sunucuya gider.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App as AntdApp, Button, Empty, Modal, Progress, Select, Space, Spin, Tag, Tooltip } from "antd";
import { FileStack, Printer, Trash2, Upload } from "lucide-react";
import { jsPDF } from "jspdf";

import TaramaDugmesi from "./TaramaDugmesi";

export interface TopluEvrak {
  kod: string;
  ad: string;
  durum: "tamam" | "eksik" | "gerekmiyor";
  /** Kalıcı ayraç numarası (sunucudan; 1–127) */
  ayracNo?: number;
}

/* ======================================================================== */
/* Ayraç işareti                                                            */
/* ======================================================================== */

/* A4 (mm). Üstte kalın bant, altında 12 kare: [1,1, 7 veri biti, eşlik, 0,1].
   15.10'daki kişiye özel ayraçlar [1,0,…] ile başlıyordu ve evrak sırasını
   taşıyordu; okununca "eski ayraç" denir, evrak atanmaz. */
const A4 = { g: 210, y: 297 };
const BANT = { x: 15, y: 15, g: 180, y2: 22 };
const KARE = { x: 21, y: 48, k: 14, adet: 12 };

const bitler = (no: number) => {
  const veri = Array.from({ length: 7 }, (_, i) => (no >> (6 - i)) & 1);
  const birler = veri.reduce((t, b) => t + b, 0);
  const esl = birler % 2 === 0 ? 1 : 0; /* toplam tek olsun */
  return [1, 1, ...veri, esl, 0, 1];
};

/** Kalıcı ayraç sayfası (A4, 150 dpi) */
const ayracCiz = (evrak: string, no: number) => {
  const px = 1240 / A4.g;
  const c = document.createElement("canvas");
  c.width = 1240;
  c.height = Math.round(A4.y * px);
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#000";
  x.fillRect(BANT.x * px, BANT.y * px, BANT.g * px, BANT.y2 * px);
  bitler(no).forEach((b, i) => {
    if (b) x.fillRect((KARE.x + i * KARE.k) * px, KARE.y * px, KARE.k * px, KARE.k * px);
  });
  /* Kare dizisinin çerçevesi (göz için) */
  x.strokeStyle = "#999";
  x.lineWidth = 2;
  x.strokeRect(KARE.x * px, KARE.y * px, KARE.k * KARE.adet * px, KARE.k * px);

  x.textAlign = "center";
  x.fillStyle = "#111";
  x.font = `700 ${Math.round(9 * px)}px Arial, sans-serif`;
  x.fillText("AYRAÇ", c.width / 2, 92 * px);
  x.font = `700 ${Math.round(8 * px)}px Arial, sans-serif`;
  /* Uzun adı iki satıra böl */
  const sozler = evrak.toLocaleUpperCase("tr").split(" ");
  const satirlar: string[] = [];
  let s = "";
  for (const w of sozler) {
    const d = s ? `${s} ${w}` : w;
    if (x.measureText(d).width > 170 * px && s) {
      satirlar.push(s);
      s = w;
    } else s = d;
  }
  if (s) satirlar.push(s);
  satirlar.slice(0, 3).forEach((t, i) => x.fillText(t, c.width / 2, (118 + i * 11) * px));

  x.font = `400 ${Math.round(4.6 * px)}px Arial, sans-serif`;
  x.fillStyle = "#333";
  x.fillText(`Kalıcı ayraç · No ${no}`, c.width / 2, 168 * px);
  /* Sıra şeması: ayraç → evrak */
  x.strokeStyle = "#333";
  x.lineWidth = 3;
  const sema = (sx: number, et: string, dolu: boolean) => {
    x.fillStyle = dolu ? "#111" : "#fff";
    x.fillRect(sx * px, 190 * px, 34 * px, 40 * px);
    x.strokeRect(sx * px, 190 * px, 34 * px, 40 * px);
    x.fillStyle = dolu ? "#fff" : "#111";
    x.font = `700 ${Math.round(4.4 * px)}px Arial, sans-serif`;
    x.fillText(et, (sx + 17) * px, 212 * px);
  };
  sema(52, "1. AYRAÇ", true);
  x.fillStyle = "#111";
  x.font = `700 ${Math.round(9 * px)}px Arial, sans-serif`;
  x.fillText("→", 105 * px, 214 * px);
  sema(124, "2. EVRAK", false);
  x.font = `400 ${Math.round(4 * px)}px Arial, sans-serif`;
  x.fillStyle = "#555";
  [
    "Önce bu ayraç, hemen ardından yukarıda yazan evrakın sayfaları.",
    "Ayraç taranır ama kaydedilmez; kişiye bağlı değildir, her adayda tekrar kullanılır.",
    "Kareleri karalamayın, katlamayın. Laminasyonda mat kaplama tercih edin.",
  ].forEach((t, i) => x.fillText(t, c.width / 2, (246 + i * 7) * px));
  return c;
};

/** Gri tonlu piksel dizisi (0 siyah – 255 beyaz) */
const griVeri = (c: HTMLCanvasElement) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const g = new Uint8Array(c.width * c.height);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0;
  return g;
};

/**
 * Sayfa ayraç mı: evet ise evrak numarası. Tarayıcı sayfayı birkaç mm
 * kaydırabilir ya da hafif küçültebilir: küçük kayma / ölçek denemeleri
 * yapılır. 180° ters konmuş sayfa da okunur (aynalanan konumlar kareleri
 * yine doğru sırada verir).
 */
const ayracOku = (g: Uint8Array, w: number, h: number): number | null => {
  const px = w / A4.g;

  const koyu = (xmm: number, ymm: number, gmm: number, ymm2: number, ters: boolean, dx: number, dy: number, o: number) => {
    let x0 = xmm * o + dx, y0 = ymm * o + dy;
    const gg = gmm * o, yy2 = ymm2 * o;
    if (ters) {
      x0 = A4.g - x0 - gg;
      y0 = A4.y - y0 - yy2;
    }
    /* Kenarlardan %25 içeride örnekle */
    const a = Math.round((x0 + gg * 0.25) * px), b = Math.round((x0 + gg * 0.75) * px);
    const c = Math.round((y0 + yy2 * 0.25) * px), e = Math.round((y0 + yy2 * 0.75) * px);
    let k = 0, t = 0;
    for (let y = Math.max(0, c); y < Math.min(h, e); y += 2)
      for (let x = Math.max(0, a); x < Math.min(w, b); x += 2) {
        t++;
        if (g[y * w + x] < 110) k++;
      }
    return t ? k / t : 0;
  };

  for (const ters of [false, true])
    for (const o of [1, 0.98, 1.02, 0.96, 1.04])
      for (const dy of [0, -2, 2, -4, 4, -6, 6])
        for (const dx of [0, -2, 2, -4, 4, -6, 6]) {
          if (koyu(BANT.x, BANT.y, BANT.g, BANT.y2, ters, dx, dy, o) < 0.75) continue;
          const b: number[] = Array.from({ length: KARE.adet }, (_, i) => {
            const v = koyu(KARE.x + i * KARE.k, KARE.y, KARE.k, KARE.k, ters, dx, dy, o);
            return v > 0.55 ? 1 : v < 0.2 ? 0 : -1;
          });
          if (b.includes(-1)) continue;
          if (b[0] !== 1 || b[10] !== 0 || b[11] !== 1) continue;
          const veri = b.slice(2, 9);
          if ((veri.reduce((t, v) => t + v, 0) + b[9]) % 2 !== 1) continue;
          /* [1,0,…]: 15.10'daki kişiye özel ayraç (evrak sırası taşıyordu) */
          if (b[1] === 0) return ESKI_AYRAC;
          return veri.reduce((t, v) => t * 2 + v, 0);
        }
  return null;
};

const ESKI_AYRAC = -1;

/** Kalıcı ayraç setinin PDF'i (bir kez basılıp lamine edilir) */
export function ayracSetiAc(evraklar: { ad: string; ayracNo?: number }[]) {
  const set = evraklar.filter((e) => (e.ayracNo ?? 0) > 0);
  if (set.length === 0) return false;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  set.forEach((e, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(ayracCiz(e.ad, e.ayracNo!).toDataURL("image/png"), "PNG", 0, 0, 210, 297);
  });
  const url = URL.createObjectURL(pdf.output("blob"));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Boş sayfa: kenar boşlukları dışında koyu piksel oranı çok düşük */
const bosMu = (g: Uint8Array, w: number, h: number) => {
  let k = 0, t = 0;
  for (let y = Math.round(h * 0.06); y < h * 0.94; y += 2)
    for (let x = Math.round(w * 0.06); x < w * 0.94; x += 2) {
      t++;
      if (g[y * w + x] < 150) k++;
    }
  return t > 0 && k / t < 0.004;
};

/* ======================================================================== */
/* Sayfalar                                                                 */
/* ======================================================================== */

interface Sayfa {
  no: number;
  kucuk: string; /* önizleme (data URL) */
  buyuk: () => Promise<HTMLCanvasElement>; /* yükleme için 150 dpi */
  ayrac: number | null;
  bos: boolean;
  evrak: string | null; /* null: atanmamış · "-": çıkarıldı */
}

const tuvaleCiz = (src: CanvasImageSource, w: number, h: number, hedefG: number) => {
  const c = document.createElement("canvas");
  const o = hedefG / w;
  c.width = Math.round(w * o);
  c.height = Math.round(h * o);
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
};

async function sayfalariOku(dosyalar: File[], ilerle: (s: string) => void): Promise<Omit<Sayfa, "evrak">[]> {
  const sonuc: Omit<Sayfa, "evrak">[] = [];

  for (const d of dosyalar) {
    if (d.type === "application/pdf" || d.name.toLowerCase().endsWith(".pdf")) {
      const pdfjs = await import("pdfjs-dist");
      const isci = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = isci;
      const belge = await pdfjs.getDocument({ data: new Uint8Array(await d.arrayBuffer()) }).promise;

      for (let i = 1; i <= Math.min(belge.numPages, 200); i++) {
        ilerle(`${d.name}: sayfa ${i} / ${belge.numPages}`);
        const sayfa = await belge.getPage(i);
        const ilk = sayfa.getViewport({ scale: 1 });
        const ciz = async (gen: number) => {
          const v = sayfa.getViewport({ scale: gen / ilk.width });
          const c = document.createElement("canvas");
          c.width = Math.floor(v.width);
          c.height = Math.floor(v.height);
          const x = c.getContext("2d")!;
          x.fillStyle = "#fff";
          x.fillRect(0, 0, c.width, c.height);
          await sayfa.render({ canvasContext: x, viewport: v }).promise;
          return c;
        };
        const kucuk = await ciz(420);
        const g = griVeri(kucuk);
        sonuc.push({
          no: sonuc.length + 1,
          kucuk: kucuk.toDataURL("image/jpeg", 0.7),
          buyuk: () => ciz(1240),
          ayrac: ayracOku(g, kucuk.width, kucuk.height),
          bos: bosMu(g, kucuk.width, kucuk.height),
        });
      }
    } else if (d.type.startsWith("image/")) {
      ilerle(d.name);
      const bmp = await createImageBitmap(d);
      const kucuk = tuvaleCiz(bmp, bmp.width, bmp.height, 420);
      const g = griVeri(kucuk);
      sonuc.push({
        no: sonuc.length + 1,
        kucuk: kucuk.toDataURL("image/jpeg", 0.7),
        buyuk: async () => tuvaleCiz(bmp, bmp.width, bmp.height, Math.min(1654, bmp.width)),
        ayrac: ayracOku(g, kucuk.width, kucuk.height),
        bos: bosMu(g, kucuk.width, kucuk.height),
      });
    }
  }

  return sonuc;
}

/* ======================================================================== */

export default function TopluTarama({
  acik,
  kapat,
  evraklar,
  kisiAdi,
  yukle,
}: {
  acik: boolean;
  kapat: () => void;
  evraklar: TopluEvrak[];
  kisiAdi: string;
  /** Bir evrakın PDF'ini yükler (sessiz); hata fırlatır */
  yukle: (kod: string, dosya: File) => Promise<void>;
}) {
  const { message, modal } = AntdApp.useApp();
  const [sayfalar, setSayfalar] = useState<Sayfa[]>([]);
  const [okunuyor, setOkunuyor] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState<{ i: number; n: number; ad: string } | null>(null);
  const [buyutulen, setBuyutulen] = useState<Sayfa | null>(null);
  const girdi = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!acik) {
      setSayfalar([]);
      setOkunuyor(null);
      setYukleniyor(null);
    }
  }, [acik]);

  const adlar = useMemo(() => Object.fromEntries(evraklar.map((e) => [e.kod, e.ad])), [evraklar]);

  /* ------------------------------------------------------ ayraç yazdır */
  const ayracYazdir = () => {
    if (!ayracSetiAc(evraklar))
      message.warning("Evrakların ayraç numarası yok; sayfayı yenileyip tekrar deneyin (sunucu güncel olmayabilir).");
  };
  const ayracla = useMemo(() => new Map(evraklar.filter((e) => e.ayracNo).map((e) => [e.ayracNo!, e.kod])), [evraklar]);

  /* ------------------------------------------------------------ oku */
  const oku = async (dosyalar: File[]) => {
    if (dosyalar.length === 0) return;
    setOkunuyor("Sayfalar okunuyor…");
    try {
      const ham = await sayfalariOku(dosyalar, setOkunuyor);
      let simdiki: string | null = null;
      let eski = 0, tanimsiz = 0;
      const yeni: Sayfa[] = ham.map((s) => {
        if (s.ayrac !== null) {
          /* Önce ayraç, ardından evrak: sonraki ayraca kadar her sayfa bu evrakın */
          simdiki = s.ayrac === ESKI_AYRAC ? null : ayracla.get(s.ayrac) ?? null;
          if (s.ayrac === ESKI_AYRAC) eski++;
          else if (!simdiki) tanimsiz++;
          return { ...s, evrak: "-" };
        }
        return { ...s, evrak: s.bos ? "-" : simdiki };
      });
      if (eski)
        modal.warning({
          title: "Eski ayraç bulundu",
          content: `${eski} sayfa 15 Ekim'deki kişiye özel ayraçla taranmış. O ayraçların ardındaki sayfalar "atanmamış"a düştü; evraklarını siz seçin. Bundan sonra kalıcı ayraç setini kullanın.`,
        });
      else if (tanimsiz)
        message.warning(`${tanimsiz} ayraç bu listedeki bir evraka ait değil (evrak pasif ya da silinmiş); ardındaki sayfaları siz atayın.`);
      setSayfalar((o) => [...o, ...yeni.map((s, i) => ({ ...s, no: o.length + i + 1 }))]);
      const ayrac = yeni.filter((s) => s.ayrac !== null).length;
      const bos = yeni.filter((s) => s.bos && s.ayrac === null).length;
      message.success(
        `${yeni.length} sayfa okundu` + (ayrac ? ` · ${ayrac} ayraç bulundu` : " · ayraç bulunamadı, sayfaları siz atayın") + (bos ? ` · ${bos} boş sayfa çıkarıldı` : "")
      );
    } catch (h: any) {
      message.error(h?.message ?? "Sayfalar okunamadı.");
    } finally {
      setOkunuyor(null);
    }
  };

  /* --------------------------------------------------------- gruplar */
  const gruplar = useMemo(() => {
    const m = new Map<string, Sayfa[]>();
    for (const s of sayfalar) {
      if (s.evrak === "-" ) continue;
      const k = s.evrak ?? "";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return m;
  }, [sayfalar]);

  const atanmamis = gruplar.get("") ?? [];
  const cikarilan = sayfalar.filter((s) => s.evrak === "-");
  const evrakGruplari = evraklar.filter((e) => gruplar.has(e.kod));

  const ata = (no: number, evrak: string | null) => setSayfalar((l) => l.map((s) => (s.no === no ? { ...s, evrak } : s)));
  /* Bu sayfa ve ardındaki atanmamışlar */
  const buradanAta = (no: number, evrak: string) =>
    setSayfalar((l) => {
      let devam = true;
      return l.map((s) => {
        if (s.no < no || !devam) return s;
        if (s.no > no && s.evrak !== null) {
          devam = false;
          return s;
        }
        return s.evrak === null || s.no === no ? { ...s, evrak } : s;
      });
    });

  const secenekler = [
    ...evraklar.map((e) => ({ value: e.kod, label: `${e.ad}${e.durum === "tamam" ? " · yüklü" : ""}` })),
    { value: "-", label: "— Çıkar (kaydetme) —" },
  ];

  /* --------------------------------------------------------- yükle */
  const onayla = async () => {
    const isler = evrakGruplari.map((e) => ({ e, sayfa: gruplar.get(e.kod)! }));
    if (isler.length === 0) return;
    setYukleniyor({ i: 0, n: isler.length, ad: "" });
    let basarili = 0;
    const hatalar: string[] = [];
    for (let i = 0; i < isler.length; i++) {
      const { e, sayfa } = isler[i];
      setYukleniyor({ i, n: isler.length, ad: e.ad });
      try {
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        for (let j = 0; j < sayfa.length; j++) {
          const c = await sayfa[j].buyuk();
          if (j > 0) pdf.addPage();
          const oran = c.height / c.width;
          const gen = oran > 297 / 210 ? 297 / oran : 210;
          const yuk = gen * oran;
          pdf.addImage(c.toDataURL("image/jpeg", 0.82), "JPEG", (210 - gen) / 2, (297 - yuk) / 2, gen, yuk);
        }
        const ad = `${e.kod.toLowerCase()}-toplu-tarama.pdf`;
        await yukle(e.kod, new File([pdf.output("blob")], ad, { type: "application/pdf" }));
        basarili++;
      } catch (h: any) {
        hatalar.push(`${e.ad}: ${h?.message ?? "yüklenemedi"}`);
      }
    }
    setYukleniyor(null);
    if (hatalar.length) {
      modal.warning({ title: `${basarili} evrak yüklendi, ${hatalar.length} evrak yüklenemedi`, content: hatalar.join("\n") });
    } else {
      message.success(`${basarili} evrak yüklendi.`);
      kapat();
    }
  };

  const Kucuk = ({ s }: { s: Sayfa }) => (
    <div className={`tt-sayfa${s.evrak === "-" ? " tt-cikarildi" : ""}`}>
      <button type="button" className="tt-resim" onClick={() => setBuyutulen(s)} title="Büyüt">
        <img src={s.kucuk} alt={`Sayfa ${s.no}`} />
        <span className="tt-no">{s.no}</span>
        {s.ayrac !== null && <span className="tt-rozet tt-ayrac">Ayraç</span>}
        {s.bos && s.ayrac === null && <span className="tt-rozet">Boş</span>}
      </button>
      {s.ayrac === null && (
        <Select
          size="small"
          value={s.evrak ?? undefined}
          placeholder="Evrak seçin"
          options={secenekler}
          popupMatchSelectWidth={260}
          style={{ width: "100%" }}
          onChange={(v) => (s.evrak === null && v !== "-" ? buradanAta(s.no, v) : ata(s.no, v))}
        />
      )}
    </div>
  );

  return (
    <Modal
      open={acik}
      onCancel={() => !yukleniyor && kapat()}
      width="min(1100px, 100vw)"
      title={
        <span>
          <FileStack size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          Toplu tarama · {kisiAdi}
        </span>
      }
      footer={
        <Space>
          <Button onClick={kapat} disabled={!!yukleniyor}>
            Vazgeç
          </Button>
          <Button
            type="primary"
            icon={<Upload size={14} />}
            disabled={evrakGruplari.length === 0 || !!okunuyor || atanmamis.length > 0}
            loading={!!yukleniyor}
            onClick={onayla}
          >
            {atanmamis.length > 0
              ? `${atanmamis.length} sayfa atanmamış`
              : `Onayla ve yükle (${evrakGruplari.length} evrak)`}
          </Button>
        </Space>
      }
      destroyOnHidden
    >
      <style>{CSS}</style>

      {sayfalar.length === 0 && !okunuyor ? (
        <div className="tt-baslangic">
          <ol>
            <li>
              <b>Desteyi hazırlayın: önce ayraç, ardından evrak.</b> Adayın getirdiği her evrakın önüne o evrakın kalıcı
              ayracını koyun (Kimlik ayracı → kimlik, Diploma ayracı → diploma…). Ayraçlar kişiye bağlı değildir; tarama
              bitince geri alıp sonraki adayda yine kullanırsınız.
              <div className="tt-sira">
                <Button icon={<Printer size={14} />} onClick={ayracYazdir}>
                  Kalıcı ayraç setini yazdır
                </Button>
                <span className="tt-not">Set bir kez basılır ve lamine edilir (mat kaplama). Kaybolan ayracı yeniden basabilirsiniz.</span>
              </div>
            </li>
            <li>
              <b>Desteyi besleyiciye koyup taratın</b> ya da başka yerde taradığınız PDF / resimleri seçin.
              <div className="tt-sira">
                <TaramaDugmesi ad="toplu-tarama" metin="Tara" onDosya={(d) => oku([d])} />
                <Button onClick={() => girdi.current?.click()}>PDF / resim seç</Button>
              </div>
            </li>
            <li>
              <b>Kontrol edin ve onaylayın.</b> Sistem ayraçlara göre sayfaları evraklara ayırır, boş sayfaları çıkarır. Yanlış
              olanı düzeltip "Onayla ve yükle"ye basın; her evrak tek PDF olarak kendi satırına eklenir.
            </li>
          </ol>
          <Alert
            type="info"
            showIcon
            message="Ayraç kullanmadan da olur"
            description="Ayraçsız taranan sayfalar 'Atanmamış' olarak gelir. Bir sayfanın evrakını seçtiğinizde, ardından gelen atanmamış sayfalar da aynı evraka eklenir; sonraki evrakın ilk sayfasından değiştirmeniz yeter."
          />
        </div>
      ) : null}

      <input
        ref={girdi}
        type="file"
        multiple
        accept=".pdf,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          oku(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {okunuyor && (
        <div className="tt-okunuyor">
          <Spin /> <span>{okunuyor}</span>
        </div>
      )}

      {yukleniyor && (
        <div className="tt-okunuyor">
          <Progress percent={Math.round(((yukleniyor.i + 0.5) / yukleniyor.n) * 100)} size="small" style={{ width: 200 }} />
          <span>
            {yukleniyor.ad} yükleniyor ({yukleniyor.i + 1} / {yukleniyor.n})
          </span>
        </div>
      )}

      {sayfalar.length > 0 && (
        <div className="tt-gruplar">
          <div className="tt-ust">
            <span>
              {sayfalar.length} sayfa · {evrakGruplari.length} evrak
              {cikarilan.length ? ` · ${cikarilan.length} çıkarıldı (ayraç / boş)` : ""}
            </span>
            <Space>
              <TaramaDugmesi ad="toplu-tarama" metin="Devamını tara" boyut="small" onDosya={(d) => oku([d])} />
              <Button size="small" onClick={() => girdi.current?.click()}>
                Dosya ekle
              </Button>
              <Tooltip title="Okunan sayfaları temizle">
                <Button size="small" danger icon={<Trash2 size={13} />} onClick={() => setSayfalar([])} />
              </Tooltip>
            </Space>
          </div>

          {atanmamis.length > 0 && (
            <section className="tt-grup tt-uyari">
              <h4>
                Atanmamış sayfalar <Tag color="orange">{atanmamis.length}</Tag>
                <small>evrakını seçin</small>
              </h4>
              <div className="tt-izgara">
                {atanmamis.map((s) => (
                  <Kucuk key={s.no} s={s} />
                ))}
              </div>
            </section>
          )}

          {evrakGruplari.map((e) => (
            <section key={e.kod} className="tt-grup">
              <h4>
                {e.ad} <Tag color="green">{gruplar.get(e.kod)!.length} sayfa</Tag>
                {e.durum === "tamam" && <small>bu evrak zaten yüklü; yenisi de eklenir</small>}
              </h4>
              <div className="tt-izgara">
                {gruplar.get(e.kod)!.map((s) => (
                  <Kucuk key={s.no} s={s} />
                ))}
              </div>
            </section>
          ))}

          {cikarilan.length > 0 && (
            <details className="tt-grup tt-soluk">
              <summary>Çıkarılan sayfalar ({cikarilan.length}) · ayraçlar ve boş sayfalar kaydedilmez</summary>
              <div className="tt-izgara">
                {cikarilan.map((s) => (
                  <div key={s.no} className="tt-sayfa tt-cikarildi">
                    <button type="button" className="tt-resim" onClick={() => setBuyutulen(s)}>
                      <img src={s.kucuk} alt={`Sayfa ${s.no}`} />
                      <span className="tt-no">{s.no}</span>
                      {s.ayrac !== null && (
                        <span className="tt-rozet tt-ayrac">Ayraç · {s.ayrac === ESKI_AYRAC ? "eski" : adlar[ayracla.get(s.ayrac) ?? ""] ?? "?"}</span>
                      )}
                      {s.bos && s.ayrac === null && <span className="tt-rozet">Boş</span>}
                    </button>
                    {s.ayrac === null && (
                      <Select size="small" placeholder="Geri al" options={secenekler.filter((o) => o.value !== "-")} style={{ width: "100%" }} onChange={(v) => ata(s.no, v)} />
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          {sayfalar.length > 0 && evrakGruplari.length === 0 && atanmamis.length === 0 && (
            <Empty description="Kaydedilecek sayfa yok (hepsi ayraç ya da boş)." />
          )}
        </div>
      )}

      <Modal open={!!buyutulen} onCancel={() => setBuyutulen(null)} footer={null} width="min(760px, 100vw)" title={`Sayfa ${buyutulen?.no ?? ""}`}>
        {buyutulen && <img src={buyutulen.kucuk} alt="" style={{ width: "100%", border: "1px solid #e5e7eb" }} />}
      </Modal>
    </Modal>
  );
}

const CSS = `
.tt-baslangic{display:flex;flex-direction:column;gap:14px}
.tt-baslangic ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:14px;line-height:1.5}
.tt-sira{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px}
.tt-not{font-size:12px;color:#6b7280}
.tt-okunuyor{display:flex;gap:10px;align-items:center;padding:12px;background:#f6f8f3;border-radius:10px;margin:10px 0}
.tt-gruplar{display:flex;flex-direction:column;gap:12px}
.tt-ust{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;color:#6b7280;font-size:13px}
.tt-grup{border:1px solid #e6e9e3;border-radius:12px;padding:10px 12px;background:#fff}
.tt-grup h4{margin:0 0 8px;font-size:14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tt-grup h4 small{font-weight:400;color:#8a929b;font-size:12px}
.tt-uyari{border-color:#ffd591;background:#fffbf2}
.tt-soluk{background:#fafafa}
.tt-soluk summary{cursor:pointer;color:#6b7280;font-size:13px;margin-bottom:8px}
.tt-izgara{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
.tt-sayfa{display:flex;flex-direction:column;gap:4px;min-width:0}
.tt-resim{position:relative;border:1px solid #d9dee5;border-radius:6px;padding:0;background:#fff;cursor:zoom-in;overflow:hidden;aspect-ratio:210/297}
.tt-resim img{width:100%;height:100%;object-fit:contain;display:block}
.tt-cikarildi .tt-resim{opacity:.55}
.tt-no{position:absolute;left:4px;top:4px;background:rgba(17,24,39,.75);color:#fff;font-size:11px;border-radius:4px;padding:0 5px}
.tt-rozet{position:absolute;right:4px;bottom:4px;background:#6b7280;color:#fff;font-size:10.5px;border-radius:4px;padding:1px 5px;max-width:calc(100% - 8px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-ayrac{background:#1d4ed8}
`;
