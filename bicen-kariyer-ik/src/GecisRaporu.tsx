/**
 * ---------------------------------------------------------------------------
 * Günlük Geçiş Raporu
 * ---------------------------------------------------------------------------
 * Seçilen günde hangi personelin QR okuttuğunu, kimin hiç okutmadığını
 * mağaza bazında gösterir.
 *
 * Okutmayan personel her zaman devamsız demek değildir: izinli olabilir,
 * telefonu yanında olmamış olabilir ya da okutmayı atlamış olabilir. Rapor bunları
 * ayırt etmez, yalnızca kaydı olmayanları listeler.
 * ---------------------------------------------------------------------------
 */

import { PersonelAdi } from "./personelKarti";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { tabloIndir } from "./raporExcel";
import { calismaSuresiIndir, gunuHesapla, VARSAYILAN_KURAL, type CalismaKurali } from "./calismaSuresiExcel";
import {
  ChevronRight,
  DoorOpen,
  Download,
  FileDown,
  FileText,
  ImageDown,
  Mail,
  RefreshCw,
  Search,
} from "lucide-react";

import Tablo from "./Tablo";
import OkutmaAraligi from "./OkutmaAraligi";
import { api } from "./api";
import { gorselOlarakIndir, pdfOlarakIndir } from "./disaAktar";
import { HareketListesi, KaynakEtiketi, KaynakEtiketleri } from "./OkutmaKaynagi";

const { Text, Paragraph } = Typography;

/** Doluluk oranına göre renk */
const oranRengi = (oran: number): string => {
  if (oran >= 95) return "#389e0d";
  if (oran >= 85) return "#7cb305";
  if (oran >= 70) return "#d48806";
  return "#cf1322";
};

/** İzin sebebinin etiket rengi (09.10.2026) */
const nedenRengi = (n?: string | null) =>
  !n
    ? "blue"
    : n.startsWith("Haftalık")
    ? "blue"
    : n.startsWith("Yıllık")
    ? "green"
    : n.startsWith("Resmî")
    ? "cyan"
    : n === "Raporlu"
    ? "magenta"
    : "geekblue";

export default function GecisRaporu() {
  const { message } = AntdApp.useApp();

  const [mod, setMod] = useState<"gun" | "aralik">("gun");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<any>(null);
  const [gun, setGun] = useState<Dayjs>(dayjs());
  const [arama, setArama] = useState("");
  /* Varsayılan olarak herkes listelenir; okutmayanlar üstte sıralanır */
  const [suzgec, setSuzgec] = useState<"okutmayan" | "hepsi" | "tatil">("hepsi");
  /* 26.10.2026: resmî tatilde okutanların tüm birimlerden listesi */
  const [tatilAcik, setTatilAcik] = useState(false);
  const [acikBirim, setAcikBirim] = useState<string | null>(null);

  /* Bölge süzgeci */
  const [bolgeler, setBolgeler] = useState<string[]>([]);
  const [tumBolgeler, setTumBolgeler] = useState<string[]>([]);

  /* Mail gönderme */
  const [mailAcik, setMailAcik] = useState(false);
  const [mailAdresler, setMailAdresler] = useState<string[]>([]);
  const [mailBas, setMailBas] = useState<Dayjs>(dayjs().subtract(1, "day"));
  const [mailBit, setMailBit] = useState<Dayjs>(dayjs().subtract(1, "day"));
  const [mailBolgeler, setMailBolgeler] = useState<string[]>([]);
  const [onizleme, setOnizleme] = useState<any>(null);
  const [gorevDurum, setGorevDurum] = useState<any>(null);
  const [mailIsleniyor, setMailIsleniyor] = useState("");

  /* CSV dışa aktarımı gün aralığı alır. Ekrandaki rapor tek gün gösterir
     (sunucu gün bazında üretiyor); indirmede aralık gün gün toplanır ve
     her satıra tarih yazılır. */
  const [csvAcik, setCsvAcik] = useState(false);
  const [csvAralik, setCsvAralik] = useState<[Dayjs, Dayjs] | null>(null);
  const [csvIsleniyor, setCsvIsleniyor] = useState(false);

  /* 26.10.2026: çalışma süresi raporu (xlsx): gün gün net / fazla / eksik */
  const [csAcik, setCsAcik] = useState(false);
  const [csAralik, setCsAralik] = useState<[Dayjs, Dayjs] | null>(null);
  const [csKural, setCsKural] = useState<CalismaKurali>(VARSAYILAN_KURAL);
  const [csIlerleme, setCsIlerleme] = useState<string>("");

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const sorgu = new URLSearchParams({ gun: gun.format("YYYY-MM-DD") });

      if (bolgeler.length > 0) sorgu.set("bolgeler", bolgeler.join(","));

      setVeri(await api.al<any>(`/api/Personel/GecisRaporu?${sorgu}`));
    } catch (hata: any) {
      message.error(hata.message);
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [gun, bolgeler, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Bölge listesi form ayarlarından gelir */
  useEffect(() => {
    api
      .al<any>("/api/Ayar/Form")
      .then((a) =>
        setTumBolgeler(
          (a?.bolgeler ?? [])
            .map((b: any) => b.ad)
            .filter(Boolean)
            .sort((x: string, y: string) => x.localeCompare(y, "tr"))
        )
      )
      .catch(() => undefined);
  }, []);

  const birimler = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    return (veri?.birimler ?? []).filter((b: any) =>
      q ? b.birim?.toLocaleLowerCase("tr").includes(q) : true
    );
  }, [veri, arama]);

  const acik = birimler.find((b: any) => b.birim === acikBirim);

  const listelenen = (acik?.kisiler ?? []).filter((k: any) =>
    suzgec === "okutmayan" ? !k.okuttuMu && !k.muaf && !k.raporlu && !k.izinli && !k.gorevde
    : suzgec === "tatil" ? !!k.tatildeOkuttu
    : true
  );

  /* --------------------------------------------------------- dışa aktarma */

  const [aktariliyor, setAktariliyor] = useState("");

  /** PDF ve görsel için ekran dışında bir kopya hazırlar */
  const alanHazirla = (): HTMLElement | null => {
    const kok = document.getElementById("gr-yazdirilacak");
    if (!kok) return null;

    const kapsayici = document.createElement("div");
    kapsayici.className = "gr-aktarim-alani";

    const baslik = document.createElement("div");
    baslik.className = "gr-aktarim-baslik";
    baslik.textContent =
      `Günlük QR Okutma Raporu · ${gun.format("DD.MM.YYYY")}` +
      (bolgeler.length > 0 ? ` · ${bolgeler.join(", ")}` : "");

    kapsayici.appendChild(baslik);
    kapsayici.appendChild(kok.cloneNode(true));

    kapsayici.style.position = "fixed";
    kapsayici.style.left = "-10000px";
    kapsayici.style.top = "0";
    kapsayici.style.width = "1180px";
    kapsayici.style.background = "#ffffff";
    kapsayici.style.padding = "18px";

    document.body.appendChild(kapsayici);
    return kapsayici;
  };

  const alaniKaldir = (alan: HTMLElement | null) => {
    if (alan?.parentNode) alan.parentNode.removeChild(alan);
  };

  const dosyaAdi = () => `okutma_raporu_${gun.format("YYYYMMDD")}`;

  const gorselIndir = async () => {
    setAktariliyor("gorsel");
    const alan = alanHazirla();

    try {
      if (alan) await gorselOlarakIndir(alan, dosyaAdi());
    } catch (hata: any) {
      message.error("Görsel oluşturulamadı: " + hata.message);
    } finally {
      alaniKaldir(alan);
      setAktariliyor("");
    }
  };

  const pdfIndir = async () => {
    setAktariliyor("pdf");
    const alan = alanHazirla();

    try {
      if (alan) await pdfOlarakIndir(alan, dosyaAdi());
    } catch (hata: any) {
      message.error("PDF oluşturulamadı: " + hata.message);
    } finally {
      alaniKaldir(alan);
      setAktariliyor("");
    }
  };

  /** Mail önizlemesini getirir */
  const onizlemeGetir = async () => {
    setMailIsleniyor("onizleme");

    try {
      const sorgu = new URLSearchParams({
        bas: mailBas.format("YYYY-MM-DD"),
        bit: mailBit.format("YYYY-MM-DD"),
      });

      if (mailBolgeler.length > 0)
        sorgu.set("bolgeler", mailBolgeler.join(","));

      setOnizleme(
        await api.al<any>(`/api/Personel/OkutmaRaporuOnizleme?${sorgu}`)
      );
    } catch (hata: any) {
      message.error(hata.message);
      setOnizleme(null);
    } finally {
      setMailIsleniyor("");
    }
  };

  /** Raporu seçilen adreslere gönderir */
  const mailGonder = async () => {
    if (mailAdresler.length === 0) {
      message.error("En az bir e-posta adresi giriniz.");
      return;
    }

    setMailIsleniyor("gonder");

    try {
      const sonuc = await api.gonder<any>("/api/Personel/OkutmaRaporuGonder", {
        bas: mailBas.format("YYYY-MM-DD"),
        bit: mailBit.format("YYYY-MM-DD"),
        bolgeler: mailBolgeler,
        adresler: mailAdresler,
      });

      if (sonuc.gonderildi) {
        message.success(`Rapor ${sonuc.basarili} adrese gönderildi.`);
        setMailAcik(false);
      } else {
        message.error("Mail gönderilemedi. Mail ayarlarını kontrol ediniz.");
      }
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setMailIsleniyor("");
    }
  };

  /** Bir günün verisini dışa aktarım satırlarına çevirir */
  const gunSatirlari = (tarih: Dayjs, gunVeri: any): any[][] => {
    const cikti: any[][] = [];

    /* Dışa aktarımda herkes yer alır; süzme yalnızca ekran içindir */
    (gunVeri?.birimler ?? []).forEach((b: any) =>
      b.kisiler.forEach((k: any) =>
        cikti.push([
          tarih.toDate(),
          b.birim,
          `${k.ad} ${k.soyad}`,
          k.personelKodu,
          k.pozisyon ?? "",
          k.okuttuMu ? "Okuttu" : k.gorevde ? `Görevde${k.gorev ? ` (${k.gorev})` : ""}` : k.raporlu ? "Raporlu" : k.muaf ? "Muaf" : k.izinli || k.neden ? k.neden ?? "İzinli" : "Okutmadı",
          k.ilkGiris ? dayjs(k.ilkGiris).format("HH:mm") : "",
          k.sonCikis ? dayjs(k.sonCikis).format("HH:mm") : "",
          (k.kaynaklar ?? []).join(", "),
        ])
      )
    );

    return cikti;
  };

  /** Çalışma süresi raporu: aralığı gün gün çekip biçimli xlsx üretir */
  const calismaSuresi = async () => {
    const bas = csAralik?.[0] ?? gun;
    const bit = csAralik?.[1] ?? gun;
    const gunSayisi = bit.startOf("day").diff(bas.startOf("day"), "day") + 1;
    if (gunSayisi < 1) return message.warning("Bitiş tarihi başlangıçtan önce olamaz.");
    if (gunSayisi > 62) return message.warning("En fazla 62 günlük aralık indirilebilir.");

    setCsIlerleme("0");
    try {
      const gunler: ReturnType<typeof gunuHesapla> = [];
      for (let i = 0; i < gunSayisi; i++) {
        const tarih = bas.add(i, "day");
        setCsIlerleme(`${i + 1}/${gunSayisi}`);
        const sorgu = new URLSearchParams({ gun: tarih.format("YYYY-MM-DD") });
        if (bolgeler.length > 0) sorgu.set("bolgeler", bolgeler.join(","));
        const gunVeri = await api.al<any>(`/api/Personel/GecisRaporu?${sorgu}`);
        gunler.push(...gunuHesapla(tarih, gunVeri, csKural));
      }
      await calismaSuresiIndir(gunler, bas, bit, csKural);
      setCsAcik(false);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setCsIlerleme("");
    }
  };

  /** Seçilen aralığı gün gün çekip tek CSV olarak indirir */
  const disaAktar = async () => {
    const bas = csvAralik?.[0] ?? gun;
    const bit = csvAralik?.[1] ?? gun;

    const gunSayisi = bit.startOf("day").diff(bas.startOf("day"), "day") + 1;

    if (gunSayisi < 1) {
      message.warning("Bitiş tarihi başlangıçtan önce olamaz.");
      return;
    }

    /* Her gün ayrı bir sorgu; uzun aralıklar sunucuyu yorar. */
    if (gunSayisi > 62) {
      message.warning("En fazla 62 günlük aralık indirilebilir.");
      return;
    }

    setCsvIsleniyor(true);

    try {
      const satirlar: any[][] = [];

      for (let i = 0; i < gunSayisi; i++) {
        const tarih = bas.add(i, "day");

        const sorgu = new URLSearchParams({ gun: tarih.format("YYYY-MM-DD") });

        if (bolgeler.length > 0) sorgu.set("bolgeler", bolgeler.join(","));

        const gunVeri = await api.al<any>(`/api/Personel/GecisRaporu?${sorgu}`);

        satirlar.push(...gunSatirlari(tarih, gunVeri));
      }

      await tabloIndir({
        baslik: "Günlük Geçiş Raporu",
        altBaslik:
          gunSayisi === 1
            ? bas.format("DD.MM.YYYY")
            : `${bas.format("DD.MM.YYYY")} – ${bit.format("DD.MM.YYYY")} · ${gunSayisi} gün`,
        sayfaAdi: "Geçiş",
        dosyaAdi:
          gunSayisi === 1
            ? `gecis-raporu-${bas.format("YYYYMMDD")}`
            : `gecis-raporu-${bas.format("YYYYMMDD")}-${bit.format("YYYYMMDD")}`,
        grupSutunu: 1,
        sutunlar: [
          { ad: "Tarih", tip: "tarih" },
          { ad: "Birim", genislik: 26 },
          { ad: "Personel", genislik: 28 },
          { ad: "Kod", genislik: 10 },
          { ad: "Pozisyon", genislik: 22 },
          { ad: "Durum", genislik: 11 },
          { ad: "İlk Giriş", genislik: 10 },
          { ad: "Son Çıkış", genislik: 10 },
          { ad: "Okutma Kaynağı", genislik: 18 },
        ],
        satirlar,
      });

      setCsvAcik(false);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setCsvIsleniyor(false);
    }
  };

  /* Oran sunucudan gelir: muaf, raporlu ve izinli olanlar beklenenlere
     girmez (günlük okutma maili ile aynı kural). Önceden burada okutan /
     tüm personel diye bölünüyor, aynı gün için mailden düşük çıkıyordu.
     Eski sunucuda alan yoksa eski hesap kullanılır. */
  const oran =
    typeof veri?.oran === "number"
      ? veri.oran
      : veri?.toplam > 0
        ? Math.round((veri.okutan / veri.toplam) * 100)
        : 0;

  /** Birimin okutma oranı (beklenenler üzerinden) */
  const birimOrani = (b: any): number =>
    typeof b?.oran === "number"
      ? b.oran
      : b?.toplam > 0
        ? Math.round((b.okutan / b.toplam) * 100)
        : 0;

  const hedefOran: number = veri?.hedefOran ?? 90;

  /* Grafikteki çubuklar en kalabalık mağazaya göre ölçeklenir */
  const enBuyukBirim = Math.max(
    1,
    ...(birimler ?? []).map((b: any) => b.toplam ?? 0)
  );

  /* 19.10.2026: tek gün ya da tarih aralığı (şube / personel süzgeçli) */
  const modSecici = (
    <Segmented
      style={{ marginBottom: 12 }}
      value={mod}
      onChange={(v) => setMod(v as "gun" | "aralik")}
      options={[
        { value: "gun", label: "Tek gün" },
        { value: "aralik", label: "Tarih aralığı" },
      ]}
    />
  );

  if (mod === "aralik")
    return (
      <>
        {modSecici}
        <OkutmaAraligi
          tumBolgeler={tumBolgeler}
          subeler={[...new Set<string>((veri?.birimler ?? []).map((b: any) => b.birim).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b, "tr")
          )}
        />
      </>
    );

  return (
    <>
      {modSecici}
      {/* 26.10.2026: resmî tatil günü: tatilde okutanlar */}
      {veri?.resmiTatil && (
        <Alert
          type="warning"
          showIcon
          style={{ borderRadius: 12, marginBottom: 12 }}
          message={<span><b>{veri.resmiTatil.ad}</b> · resmî tatil{veri.resmiTatil.yarimGun ? " (yarım gün)" : ""}</span>}
          description={`Bu gün ${veri.tatildeOkutan ?? 0} personel okutma yaptı (tatilde çalıştı). Listede "Resmî tatil" rozetiyle görünürler.`}
          action={
            <Button size="small" disabled={!veri.tatildeOkutan} onClick={() => setTatilAcik(true)}>
              Tatilde okutanlar ({veri.tatildeOkutan ?? 0})
            </Button>
          }
        />
      )}

      <Modal
        open={tatilAcik}
        onCancel={() => setTatilAcik(false)}
        footer={null}
        width={860}
        title={`${veri?.resmiTatil?.ad ?? "Resmî tatil"} · tatilde okutan personel (${veri?.tatildeOkutan ?? 0})`}
      >
        <Tablo
          rowKey={(k: any) => `${k.birim}|${k.personelKodu}`}
          size="small"
          pagination={false}
          scroll={{ y: 520 }}
          dataSource={(veri?.birimler ?? []).flatMap((b: any) =>
            (b.kisiler ?? []).filter((k: any) => k.tatildeOkuttu).map((k: any) => ({ ...k, birim: b.birim }))
          )}
          columns={[
            { title: "Birim", dataIndex: "birim", width: 170, sorter: (a: any, b: any) => String(a.birim).localeCompare(String(b.birim), "tr") },
            {
              title: "Personel",
              key: "ad",
              render: (_v: unknown, k: any) => (
                <PersonelAdi kod={k.personelKodu}>
                  {k.ad} {k.soyad}
                </PersonelAdi>
              ),
            },
            { title: "Ünvan", dataIndex: "pozisyon", ellipsis: true },
            { title: "İlk giriş", dataIndex: "ilkGiris", width: 90, render: (v: string) => (v ? dayjs(v).format("HH:mm") : "—") },
            { title: "Son çıkış", dataIndex: "sonCikis", width: 90, render: (v: string) => (v ? dayjs(v).format("HH:mm") : "—") },
          ]}
        />
      </Modal>

      {/* ------------------------------------------------------------ filtre */}
      <div className="rr-filtre">
        <DatePicker
          value={gun}
          format="DD.MM.YYYY"
          allowClear={false}
          style={{ width: 150 }}
          disabledDate={(g) => !!g && g > dayjs().endOf("day")}
          onChange={(d) => d && setGun(d)}
        />

        <div className="rr-seg">
          <button
            type="button"
            className={gun.isSame(dayjs(), "day") ? "rr-aktif" : undefined}
            onClick={() => setGun(dayjs())}
          >
            Bugün
          </button>
          <button
            type="button"
            className={gun.isSame(dayjs().subtract(1, "day"), "day") ? "rr-aktif" : undefined}
            onClick={() => setGun(dayjs().subtract(1, "day"))}
          >
            Dün
          </button>
        </div>

        <Input
          allowClear
          placeholder="Mağaza ara"
          style={{ width: 200 }}
          prefix={<Search size={15} strokeWidth={2} color="#9AA3AF" />}
          value={arama}
          onChange={(e) => setArama(e.target.value)}
        />

        <Select
          mode="multiple"
          allowClear
          maxTagCount={1}
          placeholder="Tüm bölgeler"
          style={{ minWidth: 180 }}
          value={bolgeler}
          onChange={setBolgeler}
          options={tumBolgeler.map((b) => ({ value: b, label: b }))}
          maxTagPlaceholder={(k) => `+${k.length}`}
        />

        <div className="rr-filtre-sag">
            <Space size={6} wrap>
              <Tooltip title="Yenile">
                <Button
                  icon={<RefreshCw size={15} strokeWidth={2} />}
                  onClick={getir}
                />
              </Tooltip>

              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "calisma",
                      label: "Çalışma süreleri (Excel)",
                      icon: <FileText size={15} strokeWidth={2} />,
                      onClick: () => {
                        /* Varsayılan: seçili günün haftası (Pazartesi → gün) */
                        setCsAralik([gun.subtract((gun.day() + 6) % 7, "day"), gun]);
                        setCsAcik(true);
                      },
                    },
                    {
                      key: "csv",
                      label: "Geçiş listesi (Excel)",
                      icon: <FileText size={15} strokeWidth={2} />,
                      onClick: () => {
                        setCsvAralik([gun, gun]);
                        setCsvAcik(true);
                      },
                    },
                    {
                      key: "gorsel",
                      label: "Görsel olarak indir",
                      icon: <ImageDown size={15} strokeWidth={2} />,
                      onClick: gorselIndir,
                    },
                    {
                      key: "pdf",
                      label: "PDF olarak indir",
                      icon: <FileDown size={15} strokeWidth={2} />,
                      onClick: pdfIndir,
                    },
                  ],
                }}
              >
                <Button
                  icon={<Download size={15} strokeWidth={2} />}
                  loading={!!aktariliyor}
                />
              </Dropdown>

              <Tooltip title="Raporu mail olarak gönder">
                <Button
                  type="primary"
                  icon={<Mail size={15} strokeWidth={2} />}
                  onClick={() => {
                    setMailBas(gun);
                    setMailBit(gun);
                    setMailBolgeler(bolgeler);
                    setOnizleme(null);
                    setMailAcik(true);

                    /* Otomatik gönderim durumu da gösterilir */
                    api
                      .al<any>("/api/Personel/RaporGoreviDurum")
                      .then(setGorevDurum)
                      .catch(() => setGorevDurum(null));
                  }}
                >
                  Mail gönder
                </Button>
              </Tooltip>
            </Space>
        </div>
      </div>

      <div className="rr-uyari-serit rr-mavi">
        <DoorOpen size={16} strokeWidth={2} />
        <div>
          Seçilen günde QR okutan ve okutmayan çalışan personel mağaza bazında
          listelenir. <b>Muaf</b> (Okutma Kuralları), <b>raporlu</b> ve o gün{" "}
          <b>izinli</b> olanlar (haftalık izin, vardiya planı izni, resmî
          tatil) okutma beklenenlere girmez; oran günlük okutma maili ile aynı
          hesaplanır. Okutmayan her personel devamsız değildir.
        </div>
      </div>

      <KartAktarim />

      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : !veri ? (
        <Empty description="Veri alınamadı." />
      ) : (
        <>
          {/* -------------------------------------------------------- özet */}
          <div id="gr-yazdirilacak">
          {veri.icardUlasilamadi && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="iCard veritabanına ulaşılamadı"
              description="Rapor yalnızca Biçen360 uygulaması okutmalarıyla hazırlandı; iCard okutmaları bu raporda yok."
            />
          )}
          <div className="rr-kpi-satir rr-bes">
            <div className="rr-kpi">
              <div className="rr-kpi-ust"><span>Çalışan personel</span></div>
              <div className="rr-kpi-deger">{veri.toplam}</div>
              <div className="rr-kpi-alt">aktif personel</div>
            </div>
            <Tooltip title="Muaf, raporlu ve izinli olmayanlar; oran bunlar üzerinden">
              <div className="rr-kpi">
                <div className="rr-kpi-ust"><span>Okutma beklenen</span></div>
                <div className="rr-kpi-deger" style={{ color: "#2e6aa8" }}>
                  {veri.beklenen ?? veri.toplam}
                </div>
                <div className="rr-kpi-alt">
                  {[
                    veri.muaf > 0 && `${veri.muaf} muaf`,
                    veri.raporlu > 0 && `${veri.raporlu} raporlu`,
                    veri.izinli > 0 && `${veri.izinli} izinli`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "muaf / raporlu / izinli yok"}
                </div>
              </div>
            </Tooltip>
            <div className="rr-kpi">
              <div className="rr-kpi-ust"><span>QR okutan</span></div>
              <div className="rr-kpi-deger" style={{ color: "#389e0d" }}>{veri.okutan}</div>
              <div className="rr-kpi-alt">
                Biçen360 {veri.bicen360 ?? 0} · iCard {veri.icard ?? 0}
              </div>
            </div>
            <div className="rr-kpi">
              <div className="rr-kpi-ust"><span>Hiç okutmayan</span></div>
              <div
                className="rr-kpi-deger"
                style={{ color: veri.okutmayan > 0 ? "#cf1322" : undefined }}
              >
                {veri.okutmayan}
              </div>
              <div className="rr-kpi-alt">beklenip okutmayan</div>
            </div>
            <Tooltip title="Girişi var ama çıkışı okutulmamış personel">
              <div className="rr-kpi">
                <div className="rr-kpi-ust"><span>Çıkış okutmayan</span></div>
                <div
                  className="rr-kpi-deger"
                  style={{ color: veri.eksikCikis > 0 ? "#d48806" : undefined }}
                >
                  {veri.eksikCikis}
                </div>
                <div className="rr-kpi-alt">girişi var, çıkışı yok</div>
              </div>
            </Tooltip>
          </div>

          <div className="rr-kart rr-oran-kart">
            <div className="rr-oran-kart-ust">
              <b>{dayjs(veri.tarih).format("DD MMMM YYYY, dddd")} · okutma oranı</b>
              <span className="rr-filtre-not">hedef %{hedefOran}</span>
              <span className="rr-buyuk" style={{ color: oranRengi(oran) }}>
                %{oran}
              </span>
            </div>

            <div className="rr-oran-serit">
              <i style={{ width: `${Math.min(100, oran)}%`, background: oranRengi(oran) }} />
              <em style={{ left: `${hedefOran}%` }} title={`Hedef %${hedefOran}`} />
            </div>

            {/* Okutmanın nereden yapıldığı; kişi hem uygulamadan hem
                karttan okuttuysa iki tarafta da sayılır. */}
            <div className="rr-oran-serit-alt">
              <Text type="secondary">Okutma kaynağı:</Text>
              <span>
                <KaynakEtiketi kaynak="Biçen360" /> <b>{veri.bicen360 ?? 0}</b> kişi
              </span>
              <span>
                <KaynakEtiketi kaynak="iCard" /> <b>{veri.icard ?? 0}</b> kişi
              </span>
              <span style={{ marginLeft: "auto" }}>
                {veri.beklenenOkutan ?? veri.okutan} / {veri.beklenen ?? veri.toplam} beklenen okuttu
              </span>
            </div>
          </div>

          {/* --------------------------------------------- mağaza grafiği */}
          {birimler.length > 0 && (
            <div className="rr-kart">
              <div className="rr-kart-bas">
                <b>Mağaza bazında okutma</b>
                <span>{birimler.length} birim</span>
                <div className="rr-sag">
                  <span className="gr-gosterge">
                    <i className="gr-nokta gr-nokta-yesil" /> Okutan
                  </span>
                  <span className="gr-gosterge">
                    <i className="gr-nokta gr-nokta-kirmizi" /> Okutmayan
                  </span>
                </div>
              </div>
              <div className="rr-kart-ic">
              {/* Yatay çubuklar: 35 mağaza dikey sığmıyor, adlar da
                  sıkışıyordu. Yatay düzende ad tam okunur. */}
              <div className="gr-grafik">
                {birimler.map((b: any) => {
                  const bOran = birimOrani(b);

                  /* Şerit uzunluğu en kalabalık mağazaya göre ölçeklenir */
                  const genislik = enBuyukBirim
                    ? (b.toplam / enBuyukBirim) * 100
                    : 0;

                  return (
                    <Tooltip
                      key={b.birim}
                      title={
                        <span>
                          Çalışan: {b.toplam}
                          {b.beklenen !== undefined && b.beklenen !== b.toplam && (
                            <> · beklenen: {b.beklenen}</>
                          )}
                          <br />
                          Okutan: {b.okutan} (%{bOran})
                          <br />
                          Okutmayan: {b.okutmayan}
                          {(b.muaf > 0 || b.raporlu > 0 || b.izinli > 0) && (
                            <>
                              <br />
                              Muaf {b.muaf ?? 0} · Raporlu {b.raporlu ?? 0} · İzinli {b.izinli ?? 0}
                            </>
                          )}
                          <br />
                          Biçen360: {b.bicen360 ?? 0} · iCard: {b.icard ?? 0}
                          {b.eksikCikis > 0 && (
                            <>
                              <br />
                              Çıkış eksik: {b.eksikCikis}
                            </>
                          )}
                        </span>
                      }
                    >
                      <button
                        className="gr-satir"
                        onClick={() => setAcikBirim(b.birim)}
                      >
                        <span className="gr-satir-ad">{b.birim}</span>

                        <span className="gr-satir-alan">
                          <span
                            className="gr-satir-cubuk"
                            style={{ width: `${genislik}%` }}
                          >
                            <i
                              className="gr-parca-okutan"
                              style={{ width: `${bOran}%` }}
                            />
                            <i
                              className="gr-parca-okutmayan"
                              style={{ width: `${100 - bOran}%` }}
                            />
                          </span>
                        </span>

                        <span className="gr-satir-sayi">
                          {/* Oranla aynı payda: beklenenler (muaf/raporlu/izinli hariç) */}
                          <b style={{ color: oranRengi(bOran) }}>{b.beklenenOkutan ?? b.okutan}</b>
                          <i>/ {b.beklenen ?? b.toplam}</i>
                        </span>

                        <span
                          className="gr-satir-oran"
                          style={{ color: oranRengi(bOran) }}
                        >
                          %{bOran}
                        </span>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>

              <Paragraph
                type="secondary"
                style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}
              >
                Şerit uzunluğu mağazanın personel sayısını, yeşil bölüm okutma
                oranını (beklenenler üzerinden) gösterir. Ayrıntı için satıra
                tıklayınız.
              </Paragraph>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------ mağazalar */}
          {birimler.length === 0 ? (
            <Empty description="Kayıt bulunamadı." />
          ) : (
            <Row gutter={[10, 10]}>
              {birimler.map((b: any) => {
                const bOran = birimOrani(b);

                return (
                  <Col xs={24} sm={12} xl={8} key={b.birim}>
                    <button
                      className={`gr-birim${
                        b.okutmayan > 0 ? " gr-birim-eksik" : ""
                      }`}
                      onClick={() => setAcikBirim(b.birim)}
                    >
                      <div className="gr-birim-ust">
                        <span className="gr-birim-ad">{b.birim}</span>
                        <span
                          className="gr-birim-sayi"
                          style={{ color: oranRengi(bOran) }}
                        >
                          {b.beklenenOkutan ?? b.okutan}
                          <i>/ {b.beklenen ?? b.toplam}</i>
                        </span>
                      </div>

                      <div className="gr-birim-cubuk">
                        <span
                          style={{
                            width: `${bOran}%`,
                            background: oranRengi(bOran),
                          }}
                        />
                      </div>

                      <div className="gr-birim-alt">
                        {b.okutmayan > 0 ? (
                          <b>{b.okutmayan} kişi okutmadı</b>
                        ) : (
                          <span>tamamı okuttu</span>
                        )}

                        {b.eksikCikis > 0 && (
                          <i>· {b.eksikCikis} çıkış eksik</i>
                        )}

                        {b.okutan > 0 && (
                          <i style={{ fontStyle: "normal", opacity: 0.8 }}>
                            · Biçen360 {b.bicen360 ?? 0} · iCard {b.icard ?? 0}
                          </i>
                        )}

                        <ChevronRight size={14} strokeWidth={2} />
                      </div>
                    </button>
                  </Col>
                );
              })}
            </Row>
          )}
          </div>
        </>
      )}

      {/* --------------------------------------------------- mail gönderimi */}
      {/* ------------------------------- çalışma süresi raporu (26.10.2026) */}
      <Modal
        open={csAcik}
        title="Çalışma süreleri · Excel"
        okText={csIlerleme ? `Hazırlanıyor ${csIlerleme}` : "Excel'e aktar"}
        cancelText="Vazgeç"
        confirmLoading={!!csIlerleme}
        onOk={calismaSuresi}
        onCancel={() => setCsAcik(false)}
        width={520}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          Seçtiğiniz aralıkta her personelin gün gün ilk giriş – son çıkış süresi, mola düşülmüş net çalışması ve
          hedefe göre fazla / eksik çalışması; haftalık (45 saat) toplam ve dönem özeti ayrı sayfalarda.
        </Text>
        <div style={{ marginTop: 14 }}>
          <DatePicker.RangePicker
            value={csAralik}
            onChange={(d) => setCsAralik(d as [Dayjs, Dayjs] | null)}
            format="DD.MM.YYYY"
            allowClear={false}
            style={{ width: "100%" }}
            disabledDate={(g) => !!g && g > dayjs().endOf("day")}
          />
        </div>
        <Row gutter={10} style={{ marginTop: 14 }}>
          {[
            ["Günlük net hedef (dk)", "netHedefDk", 450],
            ["Mola (dk)", "molaDk", 60],
            ["Mola düşülecek en az süre (dk)", "molaEsikDk", 360],
            ["Haftalık hedef (dk)", "haftalikHedefDk", 2700],
          ].map(([ad, alan]) => (
            <Col span={12} key={alan as string} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 3 }}>{ad}</div>
              <Input
                type="number"
                value={csKural[alan as keyof CalismaKurali]}
                onChange={(e) => setCsKural((k) => ({ ...k, [alan as string]: Math.max(0, Number(e.target.value) || 0) }))}
                suffix={<span style={{ color: "#9aa3af", fontSize: 12 }}>
                  {Math.floor(csKural[alan as keyof CalismaKurali] / 60)}:{String(csKural[alan as keyof CalismaKurali] % 60).padStart(2, "0")}
                </span>}
              />
            </Col>
          ))}
        </Row>
        <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
          Varsayılan: günde 8:30 çalışma, içinde 1 saat mola → net 7:30; haftalık 45 saat. İzinli, raporlu ve resmî tatil
          günlerinde hedef 0, o gün çalışılan süre fazla çalışmadır. En fazla 62 gün.
        </Text>
      </Modal>

      {/* ------------------------------------------- CSV tarih aralığı */}
      <Modal
        open={csvAcik}
        title="Geçiş listesi (Excel)"
        okText="İndir"
        cancelText="Vazgeç"
        confirmLoading={csvIsleniyor}
        onOk={disaAktar}
        onCancel={() => setCsvAcik(false)}
        width={440}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          Seçtiğiniz aralıktaki her gün ayrı ayrı çekilir ve tek dosyada
          birleştirilir. Her satırın başında o günün tarihi yer alır.
        </Text>

        <div style={{ marginTop: 14 }}>
          <DatePicker.RangePicker
            value={csvAralik}
            onChange={(d) => setCsvAralik(d as [Dayjs, Dayjs] | null)}
            format="DD.MM.YYYY"
            allowClear={false}
            style={{ width: "100%" }}
          />
        </div>

        <Text
          type="secondary"
          style={{ fontSize: 12, display: "block", marginTop: 10 }}
        >
          Uzun aralıklar sunucuyu yorduğu için en fazla 62 gün indirilebilir.
        </Text>
      </Modal>

      <Modal
        open={mailAcik}
        onCancel={() => setMailAcik(false)}
        width={onizleme ? "min(860px, 96vw)" : 560}
        title={
          <Space size={8}>
            <Mail size={17} strokeWidth={2} />
            Raporu Mail Olarak Gönder
          </Space>
        }
        footer={[
          <Button key="onizle" loading={mailIsleniyor === "onizleme"} onClick={onizlemeGetir}>
            Önizle
          </Button>,
          <Button key="vazgec" onClick={() => setMailAcik(false)}>
            Vazgeç
          </Button>,
          <Button
            key="gonder"
            type="primary"
            loading={mailIsleniyor === "gonder"}
            icon={<Mail size={15} strokeWidth={2} />}
            onClick={mailGonder}
          >
            Gönder
          </Button>,
        ]}
      >
        <div style={{ marginTop: 14 }}>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Text strong style={{ fontSize: 13 }}>
                Başlangıç
              </Text>
              <DatePicker
                value={mailBas}
                format="DD.MM.YYYY"
                allowClear={false}
                style={{ width: "100%", margin: "6px 0 14px" }}
                disabledDate={(g) => !!g && g > dayjs().endOf("day")}
                onChange={(d) => d && setMailBas(d)}
              />
            </Col>

            <Col xs={24} sm={12}>
              <Text strong style={{ fontSize: 13 }}>
                Bitiş
              </Text>
              <DatePicker
                value={mailBit}
                format="DD.MM.YYYY"
                allowClear={false}
                style={{ width: "100%", margin: "6px 0 14px" }}
                disabledDate={(g) => !!g && g > dayjs().endOf("day")}
                onChange={(d) => d && setMailBit(d)}
              />
            </Col>
          </Row>

          <Text strong style={{ fontSize: 13 }}>
            Bölgeler
          </Text>
          <Select
            mode="multiple"
            allowClear
            placeholder="Tüm bölgeler (boş bırakınız)"
            style={{ width: "100%", margin: "6px 0 14px" }}
            value={mailBolgeler}
            onChange={setMailBolgeler}
            options={tumBolgeler.map((b) => ({ value: b, label: b }))}
          />

          <Text strong style={{ fontSize: 13 }}>
            Alıcılar
          </Text>
          <Select
            mode="tags"
            allowClear
            placeholder="E-posta adresi yazıp Enter'a basınız"
            style={{ width: "100%", margin: "6px 0 6px" }}
            value={mailAdresler}
            onChange={setMailAdresler}
            tokenSeparators={[",", ";", " "]}
            options={[
              { value: "ik@bicen.com.tr" },
              { value: "akif.akbaba@bicen.com.tr" },
              { value: "eyup.bicen@bicen.com.tr" },
            ]}
          />

          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 14 }}>
            Listeden seçebilir ya da yeni adres yazabilirsiniz.
          </Paragraph>

          {gorevDurum && (
            <div className="gr-gorev-durum">
              <div className="gr-gorev-satir">
                <span>Otomatik gönderim</span>
                <b style={{ color: gorevDurum.acik ? "#389e0d" : "#cf1322" }}>
                  {gorevDurum.acik
                    ? `açık · her gün ${gorevDurum.saat}:00`
                    : "KAPALI"}
                </b>
              </div>

              <div className="gr-gorev-satir">
                <span>Son gönderim</span>
                <b>
                  {gorevDurum.sonGonderim
                    ? dayjs(gorevDurum.sonGonderim).format("DD.MM.YYYY HH:mm")
                    : "hiç gönderilmemiş"}
                </b>
              </div>

              <div className="gr-gorev-satir">
                <span>Bölge müdürü alıcıları</span>
                <b>{gorevDurum.bolgeAlicilari?.length ?? 0} kişi</b>
              </div>

              {gorevDurum.eksikBilgililer?.length > 0 && (
                <Alert
                  type="warning"
                  style={{ marginTop: 8 }}
                  message={`${gorevDurum.eksikBilgililer.length} kullanıcının e-posta veya bölge bilgisi eksik`}
                  description={
                    <div style={{ fontSize: 12 }}>
                      {gorevDurum.eksikBilgililer
                        .slice(0, 6)
                        .map((k: any) => (
                          <div key={k.adSoyad}>
                            {k.adSoyad} ({k.rol}) —{" "}
                            {!k.epostaVar && "e-posta yok"}
                            {!k.epostaVar && !k.bolgeVar && ", "}
                            {!k.bolgeVar && "bölge atanmamış"}
                          </div>
                        ))}
                    </div>
                  }
                />
              )}
            </div>
          )}

          {onizleme && (
            <>
              <div className="gr-onizleme-baslik">
                <b>Konu:</b> {onizleme.konu}
              </div>

              <div
                className="gr-onizleme"
                dangerouslySetInnerHTML={{ __html: onizleme.govde }}
              />
            </>
          )}
        </div>
      </Modal>

      {/* ------------------------------------------------------ birim detayı */}
      <Drawer
        open={!!acik}
        onClose={() => setAcikBirim(null)}
        width="min(860px, 96vw)"
        className="rp-cekmece"
        title={
          acik && (
            <div>
              <Space wrap size={8}>
                <DoorOpen size={16} strokeWidth={2} />
                <Text strong>{acik.birim}</Text>

                <Tag color={acik.okutmayan > 0 ? "red" : "green"}>
                  {acik.okutan} / {acik.toplam} okuttu
                </Tag>

                {acik.eksikCikis > 0 && (
                  <Tag color="orange">{acik.eksikCikis} çıkış eksik</Tag>
                )}

                {acik.muaf > 0 && <Tag color="purple">{acik.muaf} muaf</Tag>}
                {acik.raporlu > 0 && <Tag color="magenta">{acik.raporlu} raporlu</Tag>}
                {acik.izinli > 0 && <Tag color="blue">{acik.izinli} izinli</Tag>}
                {acik.gorevde > 0 && <Tag color="cyan">{acik.gorevde} görevde</Tag>}
                <Tag>%{birimOrani(acik)} okutma</Tag>
              </Space>

              <div className="hv-cekmece-alt">
                {dayjs(veri?.tarih).format("DD MMMM YYYY, dddd")}
              </div>
            </div>
          )
        }
      >
        {acik && (
          <>
            <Segmented
              block
              style={{ marginBottom: 12 }}
              value={suzgec}
              onChange={(v) => setSuzgec(v as "okutmayan" | "hepsi" | "tatil")}
              options={[
                { label: `Tümü (${acik.toplam})`, value: "hepsi" },
                {
                  label: `Okutmayanlar (${acik.okutmayan})`,
                  value: "okutmayan",
                },
                ...(veri?.resmiTatil
                  ? [{ label: `Resmî tatilde okutanlar (${acik.tatildeOkutan ?? 0})`, value: "tatil" }]
                  : []),
              ]}
            />

            {listelenen.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={suzgec === "tatil" ? "Bu birimde resmî tatilde okutan yok." : "Bu birimde okutmayan personel yok."}
              />
            ) : (
              <Tablo
                rowKey="personelKodu"
                size="small"
                pagination={false}
                dataSource={listelenen}
                scroll={{ x: 790 }}
                rowClassName={(k: any) => (k.okuttuMu || k.muaf || k.raporlu || k.izinli || k.gorevde ? "" : "gr-okutmayan")}
                columns={[
                  {
                    title: "Personel",
                    key: "ad",
                    width: 190,
                    render: (_v: unknown, k: any) => (
                      <div>
                        <Text strong style={{ fontSize: 13 }}>
                          <PersonelAdi kod={k.personelKodu}>
                            {k.ad} {k.soyad}
                          </PersonelAdi>
                        </Text>
                        <div style={{ fontSize: 11, color: "#8a8f98" }}>
                          {k.personelKodu}
                          {k.tatildeOkuttu && (
                            <Tooltip title={`${veri?.resmiTatil?.ad ?? "Resmî tatil"} günü okutma yaptı`}>
                              <Tag color="volcano" style={{ marginLeft: 6, fontSize: 10.5, lineHeight: "16px", padding: "0 5px" }}>
                                Resmî tatil
                              </Tag>
                            </Tooltip>
                          )}
                          {(k.fazlaMesai ?? []).length > 0 && (
                            <Tooltip
                              title={`Onaylanmış fazla mesai: ${(k.fazlaMesai as any[])
                                .map((f) => `${f.baslangic}–${f.bitis}`)
                                .join(", ")}`}
                            >
                              <Tag color="geekblue" style={{ marginLeft: 6, fontSize: 10.5, lineHeight: "16px", padding: "0 5px" }}>
                                FM {(k.fazlaMesai as any[]).map((f) => `${f.baslangic}–${f.bitis}`).join(", ")} ·{" "}
                                {(() => {
                                  const dk = (k.fazlaMesai as any[]).reduce((t, f) => t + (f.sureDk ?? 0), 0);
                                  return `${Math.floor(dk / 60)}:${String(dk % 60).padStart(2, "0")}`;
                                })()}
                              </Tag>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    ),
                  },
                  { title: "Ünvan", dataIndex: "pozisyon", ellipsis: true },
                  {
                    title: "Durum",
                    key: "durum",
                    width: 130,
                    render: (_v: unknown, k: any) =>
                      k.okuttuMu ? (
                        <Tag color={k.eksikCikis ? "orange" : "green"}>
                          {k.eksikCikis ? "Çıkış eksik" : "Okuttu"}
                        </Tag>
                      ) : k.gorevde ? (
                        /* 26.10.2026: onaylı görevlendirme (İzin Yönetimi › Görevlendirme) */
                        <Tooltip title={`Onaylı görevlendirme${k.gorev ? `: ${k.gorev}` : ""}; okutma beklenmez`}>
                          <Tag color="cyan">Görevde</Tag>
                        </Tooltip>
                      ) : k.raporlu ? (
                        /* Sağlık raporlu: okutmadı sayılmaz */
                        <Tooltip title="Sağlık raporlu (personel kartındaki raporlar ya da rapor izni)">
                          <Tag color="magenta">Raporlu</Tag>
                        </Tooltip>
                      ) : k.muaf ? (
                        /* Okutma Kuralları'nda okutmadan muaf tutulan personel */
                        <Tooltip title="Okutmadan muaf (Vardiya Karekodları → Okutma Kuralları)">
                          <Tag color="purple">Muaf</Tag>
                        </Tooltip>
                      ) : k.izinli || k.neden ? (
                        /* O gün izinli (09.10.2026): sebebiyle — haftalık izin,
                           yıllık izin, mazeret izni, resmî tatil… */
                        <Tooltip title={`${k.neden ?? "İzinli"}: o gün okutma beklenmez`}>
                          <Tag color={nedenRengi(k.neden)}>{k.neden ?? "İzinli"}</Tag>
                        </Tooltip>
                      ) : (
                        <Tag color="red">Okutmadı</Tag>
                      ),
                  },
                  {
                    title: "Kaynak",
                    key: "kaynak",
                    width: 150,
                    render: (_v: unknown, k: any) =>
                      k.kaynaklar?.length ? (
                        <KaynakEtiketleri kaynaklar={k.kaynaklar} kucuk />
                      ) : (
                        <span style={{ color: "#bbb" }}>—</span>
                      ),
                  },
                  {
                    title: "İlk Giriş",
                    dataIndex: "ilkGiris",
                    width: 95,
                    render: (v: string) =>
                      v ? (
                        dayjs(v).format("HH:mm")
                      ) : (
                        <span style={{ color: "#bbb" }}>—</span>
                      ),
                  },
                  {
                    title: "Son Çıkış",
                    dataIndex: "sonCikis",
                    width: 95,
                    render: (v: string) =>
                      v ? (
                        dayjs(v).format("HH:mm")
                      ) : (
                        <span style={{ color: "#bbb" }}>—</span>
                      ),
                  },
                  {
                    title: "Hareket",
                    dataIndex: "hareketSayisi",
                    width: 85,
                    align: "center",
                    render: (v: number, k: any) => (
                      <Tooltip
                        title={
                          k.hareketler?.length ? (
                            <HareketListesi hareketler={k.hareketler} />
                          ) : undefined
                        }
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 12,
                            cursor: v > 0 ? "help" : undefined,
                            textDecoration: v > 0 ? "underline dotted" : undefined,
                          }}
                        >
                          {v}
                        </Text>
                      </Tooltip>
                    ),
                  },
                ]}
              />
            )}

            <Paragraph
              type="secondary"
              style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}
            >
              Haftalık izin günü, vardiya planındaki izin ve resmî tatil "İzinli"
              görünür; yıllık izin bu listede ayrıca işaretlenmez, izin
              kayıtlarıyla birlikte değerlendiriniz.
            </Paragraph>
          </>
        )}
      </Drawer>

    </>
  );
}


/* ========================================================================== */
/* Kart geçişlerini aktar                                                     */
/* ========================================================================== */

/**
 * Kart geçiş sistemindeki (iCardBicen) okutmaları vardiya tablosuna aktarır.
 *
 * Geçmiş okutmalar kart sisteminde kaldığı için mobil uygulamada puantaj
 * boş görünüyordu. Aktarım tekrar çalıştırılabilir; aynı kayıt ikinci kez
 * eklenmiyor. Günlük aktarım gece kendiliğinden yapılıyor, bu ekran
 * geçmişi almak için.
 */
function KartAktarim() {
  const { message } = AntdApp.useApp();

  const [acik, setAcik] = useState(false);
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf("month"),
    dayjs(),
  ]);
  const [calisiyor, setCalisiyor] = useState(false);
  const [temizle, setTemizle] = useState(false);
  const [sonuc, setSonuc] = useState<any>(null);

  const gun = aralik[1].diff(aralik[0], "day") + 1;

  const aktar = async () => {
    setCalisiyor(true);
    setSonuc(null);

    try {
      setSonuc(
        await api.gonder<any>("/api/KartGecis/Aktar", {
          baslangic: aralik[0].format("YYYY-MM-DD"),
          bitis: aralik[1].format("YYYY-MM-DD"),
          temizle,
        })
      );

      message.success("Aktarım tamamlandı.");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setCalisiyor(false);
    }
  };

  if (!acik)
    return (
      <div style={{ marginBottom: 12 }}>
        <Button size="small" onClick={() => setAcik(true)}>
          Kart geçişlerini aktar
        </Button>
      </div>
    );

  return (
    <Card size="small" style={{ marginBottom: 12 }} title="Kart geçişlerini vardiya kayıtlarına aktar">
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Kart okutma sistemindeki geçmiş okutmalar mobil uygulamanın vardiya kayıtlarına eklenir;
        puantaj çizelgesi ve ekip ekranları o günleri de gösterir. Tek seferde en fazla bir yıl;
        daha eskisi için yıl yıl çalıştırın. Tekrar çalıştırmak zararsızdır, aynı kayıt ikinci kez
        eklenmez. Günlük aktarım her gece kendiliğinden yapılır.
      </Typography.Paragraph>

      <Space wrap>
        <DatePicker.RangePicker
          value={aralik}
          format="DD.MM.YYYY"
          allowClear={false}
          onChange={(d) => d && setAralik(d as [Dayjs, Dayjs])}
        />
        <Button type="primary" loading={calisiyor} disabled={gun > 366} onClick={aktar}>
          {gun > 366 ? `${gun} gün — en fazla 366` : `${gun} günü aktar`}
        </Button>
        <Button type="text" onClick={() => setAcik(false)}>
          Gizle
        </Button>
      </Space>

      <div style={{ marginTop: 8 }}>
        <Checkbox checked={temizle} onChange={(e) => setTemizle(e.target.checked)}>
          <span style={{ fontSize: 12.5 }}>
            Önce bu aralıktaki kart kayıtlarını sil, baştan aktar — saatleri yanlış aktarılmış
            günleri düzeltmek için. Mobil okutmalara dokunulmaz.
          </span>
        </Checkbox>
      </div>

      {calisiyor && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 10 }}>
          Aktarım sürüyor; uzun aralıklarda birkaç dakika sürebilir.
        </Typography.Paragraph>
      )}

      {sonuc && (
        <Alert
          style={{ marginTop: 12 }}
          type={sonuc.eklenen > 0 ? "success" : "info"}
          showIcon
          message={`${sonuc.eklenen} kayıt eklendi`}
          description={
            <>
              {sonuc.silinen > 0 ? `${sonuc.silinen} eski kart kaydı silindi · ` : ""}
              {sonuc.okunan} okutma okundu · {sonuc.zatenVardi} kayıt zaten vardı ·{" "}
              {sonuc.mobilCakismasi} kayıt mobil okutmayla çakıştığı için atlandı
              {sonuc.eslesmeyenKisi > 0 ? ` · ${sonuc.eslesmeyenKisi} kimlik personelle eşleşmedi` : ""}
              <br />
              Giriş/çıkış yönü:{" "}
              {sonuc.yonSutunu ? `${sonuc.yonSutunu} sütunundan` : "gün içindeki sıraya göre"} · Saat:{" "}
              {sonuc.saatSutunu ? `${sonuc.saatSutunu} sütunundan` : "TransitionDate içinden"}
              {sonuc.eslesmeyenKimlikler?.length ? (
                <>
                  <br />
                  Eşleşmeyen kimliklerden bazıları: {sonuc.eslesmeyenKimlikler.join(", ")}
                </>
              ) : null}
            </>
          }
        />
      )}
    </Card>
  );
}
