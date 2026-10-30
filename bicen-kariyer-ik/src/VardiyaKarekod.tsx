/**
 * Vardiya Karekodları
 * ---------------------------------------------------------------------------
 * Her şubenin mağaza girişine asılacak karekodu.
 *
 * Kod sabittir: personel telefonundan kod göstermez, şubedeki kodu okutur.
 * Sabit kod fotoğraflanıp paylaşılabildiği için sunucu tarafında iki önlem
 * var — konum doğrulaması ve arka arkaya okutma engeli.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
  App as AntdApp,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Row,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { MapPin, Printer, QrCode, RefreshCw, Search } from "lucide-react";
import QRCode from "qrcode";
import HerYerdenKarekod from "./HerYerdenKarekod";

import dayjs from "dayjs";

import Tablo from "./Tablo";
import UygulamaKullanimi from "./UygulamaKullanimi";

/* Okutma Kuralları harita kütüphanesini (Leaflet) yalnızca sekme açılınca yükler */
const OkutmaKurallari = lazy(() => import("./OkutmaKurallari"));
import { api } from "./api";

const { Title, Text, Paragraph } = Typography;

export default function VardiyaKarekod() {
  /* Toplu koordinat yükleme ve toplu yazdırma: 36 şubeyi tek tek girmek
     yerine listeyi yapıştırıp bir kerede tanımlamak için. */
  const [topluAcik, setTopluAcik] = useState(false);
  /* Baskı boyutu (21.10.2026): tam sayfa ya da A4'te 15 / 20 etiket */
  const [baski, setBaski] = useState<"buyuk" | "15" | "20">(() => {
    try {
      const v = localStorage.getItem("vardiyaKarekodBaski");
      return v === "buyuk" || v === "15" || v === "20" ? v : "20";
    } catch {
      return "20";
    }
  });
  const baskiSec = (v: "buyuk" | "15" | "20") => {
    setBaski(v);
    try {
      localStorage.setItem("vardiyaKarekodBaski", v);
    } catch {
      /* yok */
    }
  };
  const [topluMetin, setTopluMetin] = useState("");
  const [topluCalisiyor, setTopluCalisiyor] = useState(false);

  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [arama, setArama] = useState("");
  const [sekme, setSekme] = useState<"karekod" | "kural" | "cihaz" | "uygulama">("karekod");

  /* Genel okutma mesafesi; artık Okutma Kuralları sekmesinden ayarlanıyor */
  const [sinirMetre, setSinirMetre] = useState(150);

  useEffect(() => {
    api
      .al<any>("/api/OkutmaKural/Ayar")
      .then((d) => d?.varsayilanYaricap && setSinirMetre(d.varsayilanYaricap))
      .catch(() => undefined);
  }, [sekme]);

  /* Eşleştirilmiş cihazlar */
  const [cihazlar, setCihazlar] = useState<any[]>([]);
  const [cihazYukleniyor, setCihazYukleniyor] = useState(false);

  const cihazGetir = useCallback(async () => {
    setCihazYukleniyor(true);

    try {
      const d = await api.al<any>("/api/Mobil/Cihazlar");
      setCihazlar(d.kayitlar ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setCihazYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    if (sekme === "cihaz") cihazGetir();
  }, [sekme, cihazGetir]);

  const cihazKaldir = (k: any) => {
    modal.confirm({
      title: "Cihaz eşleştirmesi kaldırılsın mı?",
      content: `${k.adSoyad ?? k.personelKodu} yeni telefonundan hemen giriş yapabilir. Aylık bekleme süresi uygulanmaz.`,
      okText: "Kaldır",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Mobil/Cihaz/${encodeURIComponent(k.personelKodu)}`);
          message.success("Eşleştirme kaldırıldı.");
          cihazGetir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  /* Düzenlenen şube */
  const [secili, setSecili] = useState<any | null>(null);
  const [enlem, setEnlem] = useState<number | null>(null);
  const [boylam, setBoylam] = useState<number | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const onizleme = useRef<HTMLCanvasElement>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setVeri(await api.al<any>("/api/Mobil/Karekodlar"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Seçili şubenin kodu önizlemede çizilir */
  useEffect(() => {
    if (!secili?.kod || !onizleme.current) return;

    QRCode.toCanvas(onizleme.current, secili.kod, {
      width: 220,
      margin: 1,
      color: { dark: "#1d2126", light: "#ffffff" },
    }).catch(() => undefined);
  }, [secili]);

  const liste = (veri?.kayitlar ?? []).filter((k: any) => {
    const q = arama.trim().toLocaleLowerCase("tr");
    if (!q) return true;

    return `${k.subeAdi} ${k.subeKodu}`.toLocaleLowerCase("tr").includes(q);
  });

  const ac = (k: any) => {
    setSecili(k);
    setEnlem(k.enlem ?? null);
    setBoylam(k.boylam ?? null);
  };

  const kaydet = async (yenile = false) => {
    if (!secili) return;

    setKaydediliyor(true);

    try {
      const d = await api.gonder<any>("/api/Mobil/Karekod", {
        subeKodu: secili.subeKodu,
        subeAdi: secili.subeAdi,
        enlem,
        boylam,
        yenile,
      });

      message.success(
        yenile
          ? "Yeni kod üretildi. Şubedeki eski çıktı artık geçersizdir."
          : "Kaydedildi."
      );

      setSecili({ ...secili, kod: d.kod, enlem, boylam, tanimliMi: true });
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  /* ---------------------------------------- iCard toplu aktarım */
  const [icardAcik, setIcardAcik] = useState(false);
  const [icardMetin, setIcardMetin] = useState("");
  const [icardCalisiyor, setIcardCalisiyor] = useState(false);
  const [icardSonuc, setIcardSonuc] = useState<any>(null);

  const icardAktar = async () => {
    if (!icardMetin.trim()) {
      message.warning("iCard tablosundan kopyaladığınız satırları yapıştırınız.");
      return;
    }
    setIcardCalisiyor(true);
    try {
      const c = await api.gonder<any>("/api/Mobil/KarekodIcardAktar", { metin: icardMetin });
      setIcardSonuc(c);
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIcardCalisiyor(false);
    }
  };

  /* ---------------------------------------- mevcut (iCard) karekodları */
  const [hariciMetin, setHariciMetin] = useState("");

  const hariciEkle = async () => {
    if (!secili || !hariciMetin.trim()) return;
    try {
      await api.gonder("/api/Mobil/KarekodHarici", {
        subeKodu: secili.subeKodu,
        subeAdi: secili.subeAdi,
        kod: hariciMetin.trim(),
      });
      message.success("Mevcut karekod şubeye tanımlandı.");
      setHariciMetin("");
      const d = await api.al<any>("/api/Mobil/Karekodlar");
      setVeri(d);
      setSecili((d?.kayitlar ?? []).find((x: any) => x.subeKodu === secili.subeKodu) ?? secili);
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const hariciSil = (id: number) => {
    modal.confirm({
      title: "Mevcut karekod kaldırılsın mı?",
      content: "Bu karekod okutulunca artık bu şubenin kaydı düşmez.",
      okText: "Kaldır",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Mobil/KarekodHarici/${id}`);
          const d = await api.al<any>("/api/Mobil/Karekodlar");
          setVeri(d);
          setSecili((d?.kayitlar ?? []).find((x: any) => x.subeKodu === secili?.subeKodu) ?? null);
        } catch (h: any) {
          message.error(h.message);
        }
      },
    });
  };

  const yenileSor = () => {
    modal.confirm({
      title: "Yeni kod üretilsin mi?",
      content:
        "Şubede asılı olan çıktı geçersiz hale gelir ve yeniden yazdırılması gerekir. Kod sızdıysa ya da kötüye kullanıldığından şüpheleniyorsanız yenileyin.",
      okText: "Yenile",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: () => kaydet(true),
    });
  };

  /** Yazdırılabilir sayfa: şube adı, karekod ve kısa yönerge */
  /** "ŞUBE ADI<tab veya ;>41.00247, 28.78171" satırlarını çözer. */
  const topluCoz = (metin: string) =>
    metin
      .split("\n")
      .map((satir) => satir.trim())
      .filter(Boolean)
      .map((satir) => {
        const parca = satir.split(/[\t;|]/).map((x) => x.trim());

        if (parca.length < 2) return null;

        const koordinat = parca[parca.length - 1].replace(/\s/g, "");
        const [en, boy] = koordinat.split(",").map((x) => Number(x));

        if (!Number.isFinite(en) || !Number.isFinite(boy)) return null;

        return { ad: parca[0], enlem: en, boylam: boy };
      })
      .filter(Boolean) as { ad: string; enlem: number; boylam: number }[];

  const anahtar = (x: string) =>
    (x ?? "")
      .toLocaleUpperCase("tr")
      .replace(/İ/g, "I")
      .replace(/[^A-Z0-9]/g, "");

  /**
   * Koordinatları toplu yazar ve kodu olmayan şubelere kod üretir.
   * Mevcut kodlar korunuyor: kod değişirse asılı çıktılar geçersiz olurdu.
   */
  const topluUygula = async () => {
    const satirlar = topluCoz(topluMetin);

    if (satirlar.length === 0) {
      message.warning("Satır çözülemedi. Biçim: ŞUBE ADI ; 41.00247, 28.78171");
      return;
    }

    const eslesmeyen: string[] = [];
    let yazilan = 0;

    setTopluCalisiyor(true);

    try {
      for (const satir of satirlar) {
        const sube = (veri?.kayitlar ?? []).find(
          (k: any) => anahtar(k.subeAdi) === anahtar(satir.ad) || anahtar(k.subeKodu) === anahtar(satir.ad)
        );

        if (!sube) {
          eslesmeyen.push(satir.ad);
          continue;
        }

        await api.gonder("/api/Mobil/Karekod", {
          subeKodu: sube.subeKodu,
          subeAdi: sube.subeAdi,
          enlem: satir.enlem,
          boylam: satir.boylam,
          yenile: false,
        });

        yazilan++;
      }

      message.success(
        `${yazilan} şube güncellendi.` +
          (eslesmeyen.length ? ` Eşleşmeyen: ${eslesmeyen.join(", ")}` : "")
      );

      setTopluAcik(false);
      setTopluMetin("");
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setTopluCalisiyor(false);
    }
  };

  /**
   * Küçük etiket baskısı: A4'te 15 (3×5) ya da 20 (4×5) karekod, kesim
   * çizgili. Tek şubede sayfa aynı kodla dolar; "Tümünü yazdır"da her
   * şubeye bir etiket düşer.
   */
  const etiketYazdir = async (etiketler: any[], adet: 15 | 20, baslik: string) => {
    const pencere = window.open("", "_blank", "width=820,height=1000");

    if (!pencere) {
      message.error("Açılır pencere engellendi. Tarayıcı ayarını kontrol ediniz.");
      return;
    }

    const resimler = new Map<string, string>();
    for (const k of etiketler)
      if (!resimler.has(k.kod))
        resimler.set(
          k.kod,
          await QRCode.toDataURL(k.kod, { width: 500, margin: 1, color: { dark: "#1d2126", light: "#ffffff" } })
        );

    const sutun = adet === 20 ? 4 : 3;
    const qr = adet === 20 ? 33 : 38;
    const kutular = etiketler
      .map(
        (k: any) => `
  <div class="e">
    <div class="b">Vardiya Giriş / Çıkış</div>
    <img src="${resimler.get(k.kod)}" alt="">
    <div class="s">${k.subeAdi}</div>
    <div class="y">Biçen Personel › Vardiya › okut</div>
  </div>`
      )
      .join("");

    pencere.document.write(`
<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8">
<title>${baslik}</title>
<style>
  @page { size: A4; margin: 8mm; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #1f2933; margin: 0; }
  .izgara { display: grid; grid-template-columns: repeat(${sutun}, 1fr); grid-auto-rows: 56mm; }
  .e { border: 0.3mm dashed #b8c2cc; display: flex; flex-direction: column; align-items: center;
       justify-content: center; text-align: center; padding: 2mm; break-inside: avoid; overflow: hidden; }
  .b { font-size: 9pt; font-weight: 700; margin-bottom: 1.2mm; }
  img { width: ${qr}mm; height: ${qr}mm; border: 0.6mm solid #7cb518; border-radius: 2mm; padding: 1mm; }
  .s { font-size: 8.5pt; font-weight: 700; color: #5f8c10; margin-top: 1.2mm; line-height: 1.15;
       max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .y { font-size: 6.5pt; color: #6b7280; margin-top: 0.6mm; }
</style></head>
<body><div class="izgara">${kutular}</div>
<script>window.onload = () => window.print();<\/script>
</body></html>`);

    pencere.document.close();
  };

  /** Kodu olan bütün şubelerin çıktısı tek belgede, sayfa başına bir şube. */
  const tumunuYazdir = async () => {
    const liste = (veri?.kayitlar ?? []).filter((k: any) => k.kod);

    if (liste.length === 0) {
      message.warning("Yazdırılacak kod yok.");
      return;
    }

    if (baski !== "buyuk") {
      await etiketYazdir(liste, Number(baski) as 15 | 20, `Vardiya Karekodları · ${liste.length} şube`);
      return;
    }

    const pencere = window.open("", "_blank", "width=820,height=1000");

    if (!pencere) {
      message.error("Açılır pencere engellendi. Tarayıcı ayarını kontrol ediniz.");
      return;
    }

    const sayfalar = await Promise.all(
      liste.map(async (k: any) => {
        const resim = await QRCode.toDataURL(k.kod, {
          width: 900,
          margin: 1,
          color: { dark: "#1d2126", light: "#ffffff" },
        });

        return `
  <section>
    <h1>Vardiya Giriş / Çıkış</h1>
    <div class="sube">${k.subeAdi}</div>
    <img src="${resim}" alt="">
    <div class="yonerge">
      <b>Biçen Personel uygulamasından okutunuz</b>
      Uygulamayı açın · Vardiya sekmesine girin<br>Karekodu çerçeveye alın
    </div>
    <div class="dipnot">
      Bu kod ${k.subeAdi} şubesine aittir ve yalnızca burada geçerlidir.<br>
      Kodun fotoğrafını çekip paylaşmayınız; konum doğrulaması yapılmaktadır.
    </div>
  </section>`;
      })
    );

    pencere.document.write(`
<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8">
<title>Vardiya Karekodları · ${liste.length} şube</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #1f2933; margin: 0; }
  section { text-align: center; padding: 26px 18px; page-break-after: always; }
  section:last-child { page-break-after: auto; }
  h1 { font-size: 32px; margin: 0 0 6px; }
  .sube { font-size: 19px; color: #5f8c10; font-weight: 700; margin-bottom: 30px; }
  img { width: 360px; height: 360px; border: 3px solid #7cb518; border-radius: 16px; padding: 14px; }
  .yonerge { margin-top: 30px; font-size: 16px; line-height: 1.8; }
  .yonerge b { display: block; font-size: 20px; margin-bottom: 8px; }
  .dipnot { margin-top: 26px; font-size: 12.5px; color: #6b7280; line-height: 1.7; }
</style></head>
<body>${sayfalar.join("")}
<script>window.onload = () => window.print();<\/script>
</body></html>`);

    pencere.document.close();
  };

  const yazdir = async (k: any) => {
    if (!k.kod) {
      message.warning("Önce kod oluşturunuz.");
      return;
    }

    if (baski !== "buyuk") {
      const n = Number(baski) as 15 | 20;
      await etiketYazdir(Array.from({ length: n }, () => k), n, `${k.subeAdi} · Vardiya Karekodu (${n}'li)`);
      return;
    }

    const resim = await QRCode.toDataURL(k.kod, {
      width: 900,
      margin: 1,
      color: { dark: "#1d2126", light: "#ffffff" },
    });

    const pencere = window.open("", "_blank", "width=820,height=1000");

    if (!pencere) {
      message.error("Açılır pencere engellendi. Tarayıcı ayarını kontrol ediniz.");
      return;
    }

    pencere.document.write(`
<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8">
<title>${k.subeAdi} · Vardiya Karekodu</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: "Segoe UI", system-ui, sans-serif; text-align: center;
         color: #1f2933; margin: 0; padding: 30px 20px; }
  h1 { font-size: 34px; margin: 0 0 6px; }
  .sube { font-size: 19px; color: #5f8c10; font-weight: 700;
          margin-bottom: 34px; }
  img { width: 380px; height: 380px; border: 3px solid #7cb518;
        border-radius: 16px; padding: 14px; }
  .yonerge { margin-top: 34px; font-size: 16px; line-height: 1.8; }
  .yonerge b { display: block; font-size: 20px; margin-bottom: 8px; }
  .dipnot { margin-top: 30px; font-size: 12.5px; color: #6b7280;
            line-height: 1.7; }
</style></head>
<body>
  <h1>Vardiya Giriş / Çıkış</h1>
  <div class="sube">${k.subeAdi}</div>

  <img src="${resim}" alt="">

  <div class="yonerge">
    <b>Biçen Personel uygulamasından okutunuz</b>
    Uygulamayı açın · Vardiya sekmesine girin<br>
    Karekodu çerçeveye alın
  </div>

  <div class="dipnot">
    Bu kod ${k.subeAdi} şubesine aittir ve yalnızca burada geçerlidir.<br>
    Kodun fotoğrafını çekip paylaşmayınız; konum doğrulaması yapılmaktadır.
  </div>

  <script>window.onload = () => window.print();<\/script>
</body></html>`);

    pencere.document.close();
  };

  return (
    <div>
      {/* iCard erişim noktaları: şubelerde asılı olan karekodlar yeniden
          basılmadan kullanılsın. */}
      <Modal
        open={icardAcik}
        width={720}
        title="iCard karekodlarını aktar"
        okText={icardCalisiyor ? "Aktarılıyor…" : "Aktar"}
        cancelText="Kapat"
        confirmLoading={icardCalisiyor}
        onCancel={() => {
          setIcardAcik(false);
          setIcardSonuc(null);
        }}
        onOk={icardAktar}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Şubelerdeki iCard karekodları kullanılır, yeni karekod basmaya gerek kalmaz"
          description={
            <>
              iCard veritabanında şu sorguyu çalıştırın, sonucu sağ tıklayıp <b>Copy with Headers</b> ile
              kopyalayıp aşağıya yapıştırın:
              <pre style={{ margin: "6px 0 0", fontSize: 11.5, whiteSpace: "pre-wrap" }}>
                SELECT Name, QRCode, Latitude, Longitude, Active FROM AccessPoint
              </pre>
              Her satırın adı (Name) şube adıyla eşleştirilir ve QRCode o şubenin karekodu olarak
              tanımlanır. Şubenin konumu girilmemişse iCard'daki konum yazılır. Pasif erişim noktaları
              atlanır. Tablonun bütün sütunları da yapıştırılabilir.
            </>
          }
        />

        <Input.TextArea
          rows={10}
          value={icardMetin}
          onChange={(e) => setIcardMetin(e.target.value)}
          placeholder={"Name\tQRCode\tLatitude\tLongitude\tActive\nBİZİMMAHALLE\t365369fd-2439-483d-8973-76c1915e2574\t41,028755\t28,777848\t1"}
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />

        {icardSonuc && (
          <Alert
            style={{ marginTop: 12 }}
            type={(icardSonuc.eslesmeyen?.length ?? 0) > 0 ? "warning" : "success"}
            showIcon
            message={`${icardSonuc.eklenen} karekod tanımlandı · ${icardSonuc.zatenVar} zaten vardı · ${icardSonuc.konumYazilan} şubenin konumu yazıldı${
              icardSonuc.pasif ? ` · ${icardSonuc.pasif} pasif atlandı` : ""
            }`}
            description={
              <>
                {(icardSonuc.eslesmeyen?.length ?? 0) > 0 && (
                  <div>
                    <b>Şubesi bulunamayan:</b> {icardSonuc.eslesmeyen.join(", ")}. Bu adlar şube listesindeki
                    adlardan farklı; listeden şubeyi seçip kodu elle ekleyebilirsiniz.
                  </div>
                )}
                {(icardSonuc.gecersiz?.length ?? 0) > 0 && (
                  <div>
                    <b>Karekodu okunamayan:</b> {icardSonuc.gecersiz.join(", ")}
                  </div>
                )}
              </>
            }
          />
        )}
      </Modal>

      <Modal
        open={topluAcik}
        width={620}
        title="Koordinatları toplu yükle"
        okText={topluCalisiyor ? "Yazılıyor…" : "Uygula"}
        cancelText="Vazgeç"
        confirmLoading={topluCalisiyor}
        onCancel={() => setTopluAcik(false)}
        onOk={topluUygula}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Her satıra bir şube"
          description={
            <>
              Biçim: <b>ŞUBE ADI ; 41.00247, 28.78171</b> — ayırıcı olarak noktalı virgül,
              dikey çizgi ya da sekme kullanabilirsiniz. Şube adı listedeki adla eşleştirilir;
              eşleşmeyenler uyarıda bildirilir. Mevcut karekodlar korunur, yalnızca konum
              yazılır; kodu olmayan şubeye kod üretilir.
            </>
          }
        />

        <Input.TextArea
          rows={12}
          value={topluMetin}
          onChange={(e) => setTopluMetin(e.target.value)}
          placeholder={"TEPEÜSTÜ ; 41.00247, 28.78171\nSOĞUKSU ; 40.9979346, 28.7697536"}
        />
      </Modal>

      <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 14 }}>
        <Col xs={24} md={12}>
          <Title level={5} style={{ marginTop: 0, marginBottom: 0 }}>
            <Space size={8}>
              <QrCode size={18} strokeWidth={2} />
              Vardiya Karekodları
            </Space>
          </Title>
        </Col>

        <Col xs={24} md={12} style={{ textAlign: "right" }}>
          <Space wrap>
            <Button onClick={() => setIcardAcik(true)}>iCard karekodlarını aktar</Button>
            <Button onClick={() => setTopluAcik(true)}>Koordinatları toplu yükle</Button>
            <Segmented
              value={baski}
              onChange={(v) => baskiSec(v as any)}
              options={[
                { label: "Tam sayfa", value: "buyuk" },
                { label: "A4'te 15", value: "15" },
                { label: "A4'te 20", value: "20" },
              ]}
            />
            <Button onClick={tumunuYazdir}>Tümünü yazdır</Button>

            <Input
              allowClear
              prefix={<Search size={14} strokeWidth={2} />}
              placeholder="Şube ara"
              style={{ width: 200 }}
              value={arama}
              onChange={(e) => setArama(e.target.value)}
            />

            <Button
              icon={<RefreshCw size={15} strokeWidth={2} />}
              loading={yukleniyor}
              onClick={getir}
            >
              Yenile
            </Button>
          </Space>
        </Col>
      </Row>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Her şubenin karekodu sabittir ve mağaza girişine asılır. Personel
        uygulamadan bu kodu okutarak vardiya giriş çıkışı yapar. Kod
        rastgele üretilir; şube kodundan türetilmez, tahmin edilemez.
        <br />
        <b>Konum girilmiş şubelerde okutma {sinirMetre} metre sınırına tabidir</b>{" "}
        (şubeye özel mesafe ve personel kuralları “Okutma Kuralları” sekmesinde).{" "}
        Sabit kod fotoğraflanıp paylaşılabildiği için asıl koruma budur;
        konumu olmayan şubede denetim yapılamaz.
      </Paragraph>

      <HerYerdenKarekod kuralAc={() => setSekme("kural")} />

      <Segmented
        block
        value={sekme}
        onChange={(v) => setSekme(v as any)}
        style={{ marginBottom: 14 }}
        options={[
          { label: "Şube Karekodları", value: "karekod" },
          { label: "Eşleştirilmiş Cihazlar", value: "cihaz" },
          { label: "Okutma Kuralları", value: "kural" },
          { label: "Uygulama Kullanımı", value: "uygulama" },
        ]}
      />

      {sekme === "uygulama" && <UygulamaKullanimi />}

      {sekme === "kural" && (
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Yükleniyor…</div>}>
          <OkutmaKurallari />
        </Suspense>
      )}

      {sekme === "uygulama" || sekme === "kural" ? null : sekme === "cihaz" ? (
        <Card size="small">
          <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
            Her personel tek cihazda oturum açabilir. Cihaz değişimi
            <b> ayda bir kez</b> serbesttir; telefonunu kaybeden ya da
            değiştiren personel için eşleştirmeyi buradan kaldırabilirsiniz.
          </Paragraph>

          <Tablo
            rowKey="personelKodu"
            size="small"
            loading={cihazYukleniyor}
            dataSource={cihazlar}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            locale={{ emptyText: "Henüz eşleştirilmiş cihaz yok." }}
            columns={[
              {
                title: "Personel",
                dataIndex: "adSoyad",
                render: (v: string, k: any) => (
                  <div>
                    <b>{v ?? k.personelKodu}</b>
                    <div>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        {k.personelKodu}
                        {k.gorev ? ` · ${k.gorev}` : ""}
                      </Text>
                    </div>
                  </div>
                ),
              },
              { title: "Şube", dataIndex: "subeAdi", width: 130, ellipsis: true },
              {
                title: "Cihaz",
                dataIndex: "cihazAdi",
                width: 165,
                render: (v: string, k: any) => (
                  <span>
                    {v || "—"}
                    {k.isletim && (
                      <Tag
                        color={k.isletim === "iOS" ? "blue" : "green"}
                        style={{ marginLeft: 6 }}
                      >
                        {k.isletim}
                      </Tag>
                    )}
                  </span>
                ),
              },
              {
                title: "Son Giriş",
                dataIndex: "sonGiris",
                width: 135,
                render: (v: string) =>
                  v ? dayjs(v).format("DD.MM.YYYY HH:mm") : "—",
              },
              {
                title: "Değişim",
                key: "degisim",
                width: 130,
                render: (_v: any, k: any) => (
                  <Tooltip
                    title={`Son değişim: ${dayjs(k.sonDegisim).format(
                      "DD.MM.YYYY"
                    )} · toplam ${k.degisimSayisi} kez`}
                  >
                    <Tag color={k.degisimGun < 30 ? "orange" : "default"}>
                      {k.degisimGun < 30
                        ? `${30 - k.degisimGun} gün kilitli`
                        : "değiştirebilir"}
                    </Tag>
                  </Tooltip>
                ),
              },
              {
                title: "Oturum",
                dataIndex: "oturumAcik",
                width: 90,
                render: (v: boolean) =>
                  v ? (
                    <Tag color="green">açık</Tag>
                  ) : (
                    <Tag>kapalı</Tag>
                  ),
              },
              {
                title: "",
                key: "islem",
                width: 100,
                align: "right" as const,
                render: (_v: any, k: any) => (
                  <Button size="small" danger onClick={() => cihazKaldir(k)}>
                    Kaldır
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      ) : (
      <>

      {(veri?.kayitlar ?? []).some((k: any) => k.tanimliMi && !k.enlem) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Bazı şubelerin konumu girilmemiş"
          description="Konumu olmayan şubede uzaktan okutma engellenemiyor. Karekodun fotoğrafı paylaşılırsa personel şubede olmadan giriş yapabilir."
        />
      )}

      {veri?.eksik > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${veri.eksik} şubenin karekodu tanımlanmamış`}
          description="Karekodu olmayan şubede vardiya okutması yapılamaz. Listeden şubeye tıklayıp oluşturunuz."
        />
      )}

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={secili ? 14 : 24}>
          <Card size="small">
            <Tablo
              rowKey="subeKodu"
              size="small"
              loading={yukleniyor}
              dataSource={liste}
              pagination={{ pageSize: 15, showSizeChanger: false }}
              rowClassName={(k: any) =>
                `rp-tiklanabilir ${
                  secili?.subeKodu === k.subeKodu ? "rp-secili" : ""
                }`
              }
              onRow={(k: any) => ({ onClick: () => ac(k) })}
              columns={[
                {
                  title: "Şube",
                  dataIndex: "subeAdi",
                  render: (v: string, k: any) => (
                    <div>
                      <b>{v}</b>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11.5 }}>
                          {k.subeKodu}
                          {k.tur ? ` · ${k.tur}` : ""}
                        </Text>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Karekod",
                  key: "durum",
                  width: 120,
                  render: (_v: any, k: any) => (
                    <Space size={4} wrap>
                      {k.tanimliMi ? (
                        <Tag color="green">tanımlı</Tag>
                      ) : (k.harici ?? []).length === 0 ? (
                        <Tag color="orange">yok</Tag>
                      ) : null}
                      {(k.harici ?? []).length > 0 && (
                        <Tooltip title="Şubede asılı mevcut iCard karekodu tanımlı">
                          <Tag color="purple">iCard</Tag>
                        </Tooltip>
                      )}
                    </Space>
                  ),
                },
                {
                  title: "Konum",
                  key: "konum",
                  width: 110,
                  render: (_v: any, k: any) =>
                    k.enlem && k.boylam ? (
                      <Tooltip title={`${k.enlem}, ${k.boylam}`}>
                        <Tag color="blue">
                          <MapPin size={10} strokeWidth={2.4} /> var
                        </Tag>
                      </Tooltip>
                    ) : (
                      <Text type="secondary">—</Text>
                    ),
                },
                {
                  title: "",
                  key: "islem",
                  width: 100,
                  align: "right" as const,
                  render: (_v: any, k: any) =>
                    k.tanimliMi ? (
                      <Button
                        size="small"
                        icon={<Printer size={13} strokeWidth={2} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          yazdir(k);
                        }}
                      >
                        Yazdır
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        </Col>

        {secili && (
          <Col xs={24} lg={10}>
            <Card
              size="small"
              title={secili.subeAdi}
              extra={
                <Button size="small" type="text" onClick={() => setSecili(null)}>
                  Kapat
                </Button>
              }
            >
              {secili.kod ? (
                <div style={{ textAlign: "center", marginBottom: 14 }}>
                  <canvas ref={onizleme} />
                  <div>
                    <Text
                      type="secondary"
                      style={{ fontSize: 10.5, wordBreak: "break-all" }}
                    >
                      {secili.kod}
                    </Text>
                  </div>
                </div>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 14 }}
                  message="Bu şubenin kodu henüz yok"
                  description="Aşağıdan oluşturabilirsiniz. Konum girmek zorunlu değildir ama girilirse okutmanın doğru şubede yapıldığı doğrulanır."
                />
              )}

              {/* Mevcut (iCard) karekodları: şubede zaten asılı olan kod
                  okutulunca da bu şubenin kaydı düşer. */}
              <div style={{ marginBottom: 14 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Şubedeki mevcut karekod (iCard)
                </Text>
                {(secili.harici ?? []).length === 0 ? (
                  <Paragraph type="secondary" style={{ fontSize: 11.5, margin: "4px 0 8px" }}>
                    Tanımlı değil. Üstteki "iCard karekodlarını aktar" ile bütün şubeleri birlikte
                    tanımlayabilir ya da iCard'daki QRCode değerini aşağıya yapıştırabilirsiniz.
                  </Paragraph>
                ) : (
                  <div style={{ margin: "6px 0 8px", display: "grid", gap: 6 }}>
                    {secili.harici.map((h: any) => (
                      <div
                        key={h.id}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          border: "1px solid #eef0ea",
                          borderRadius: 8,
                          padding: "6px 8px",
                        }}
                      >
                        <Tag color="purple" style={{ margin: 0 }}>
                          {h.kaynak}
                        </Tag>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: 11, wordBreak: "break-all" }}>{h.kod}</Text>
                          <div>
                            <Text type="secondary" style={{ fontSize: 10.5 }}>
                              {h.tanimlayan} · {dayjs(h.olusturma).format("DD.MM.YYYY HH:mm")}
                            </Text>
                          </div>
                        </div>
                        <Button size="small" danger type="text" onClick={() => hariciSil(h.id)}>
                          Kaldır
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    size="small"
                    placeholder="Karekod metnini yapıştırın"
                    value={hariciMetin}
                    onChange={(e) => setHariciMetin(e.target.value)}
                  />
                  <Button size="small" onClick={hariciEkle} disabled={!hariciMetin.trim()}>
                    Ekle
                  </Button>
                </Space.Compact>
              </div>

              <Text type="secondary" style={{ fontSize: 12 }}>
                Şube konumu
              </Text>

              <Row gutter={[8, 8]} style={{ marginTop: 4, marginBottom: 12 }}>
                <Col span={12}>
                  <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Enlem"
                    step={0.000001}
                    value={enlem}
                    onChange={setEnlem}
                  />
                </Col>
                <Col span={12}>
                  <InputNumber
                    style={{ width: "100%" }}
                    placeholder="Boylam"
                    step={0.000001}
                    value={boylam}
                    onChange={setBoylam}
                  />
                </Col>
              </Row>

              <Paragraph type="secondary" style={{ fontSize: 11.5 }}>
                Konumu Google Haritalar'da şubeye sağ tıklayıp
                kopyalayabilirsiniz. <b>Konum girilirse okutma yalnızca {sinirMetre}
                metre yakından yapılabilir</b>; uzaktan denemeler
                reddedilir ve güvenlik günlüğüne yazılır. Konum
                girilmezse bu denetim yapılmaz.
              </Paragraph>

              <Space wrap>
                <Button
                  type="primary"
                  loading={kaydediliyor}
                  onClick={() => kaydet(false)}
                >
                  {secili.kod ? "Konumu kaydet" : "Kod oluştur"}
                </Button>

                {secili.kod && (
                  <>
                    <Button
                      icon={<Printer size={14} strokeWidth={2} />}
                      onClick={() => yazdir(secili)}
                    >
                      Yazdır
                    </Button>

                    <Button danger onClick={yenileSor}>
                      Kodu yenile
                    </Button>
                  </>
                )}
              </Space>
            </Card>
          </Col>
        )}
      </Row>
      </>
      )}
    </div>
  );
}
