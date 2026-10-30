/**
 * ---------------------------------------------------------------------------
 * Personel Başı Ciro Verimliliği
 * ---------------------------------------------------------------------------
 * Şubelerin günlük cirosunu hem mevcut personele hem norm kadroya bölerek
 * gösterir. İki oran arasındaki fark, kadronun ne kadar dolu çalıştığını
 * ortaya koyar.
 *
 * Ciro Mikro V15'ten, kadro bilgisi norm kadro tanımlarından gelir.
 * Geriye dönük sorgularda o tarihte geçerli olan norm kullanılır.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Card,
  Col,
  Button,
  DatePicker,
  Dropdown,
  Empty,
  Input,
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
import {
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  ImageDown,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react";

import Tablo from "./Tablo";
import { api } from "./api";
import {
  excelOlarakIndir,
  gorselOlarakIndir,
  pdfOlarakIndir,
} from "./disaAktar";


const { RangePicker } = DatePicker;
const { Text, Title, Paragraph } = Typography;

/** Para biçimi */
const para = (deger?: number | null): string =>
  deger
    ? Number(deger).toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";

/**
 * Değeri genel ortalamaya göre renklendirir.
 * Kırmızı belirgin altta, yeşil belirgin üstte demektir.
 */
const oranRengi = (deger: number, ortalama: number): string => {
  if (!ortalama || !deger) return "#8a8f98";

  const oran = deger / ortalama;

  if (oran >= 1.1) return "#389e0d";
  if (oran >= 0.98) return "#7cb305";
  if (oran >= 0.9) return "#d48806";
  return "#cf1322";
};

/**
 * Yüzde değişimi renkli bir rozet olarak yazar.
 * Önceki dönemde veri yoksa çizgi gösterilir.
 */
const DegisimRozeti = ({ yuzde }: { yuzde?: number | null }) => {
  if (yuzde === null || yuzde === undefined) {
    return <span style={{ color: "#bbb" }}>—</span>;
  }

  const artis = yuzde > 0;
  const durgun = Math.abs(yuzde) < 0.5;

  return (
    <Tag
      color={durgun ? "default" : artis ? "green" : "red"}
      style={{ marginInlineEnd: 0, minWidth: 62, textAlign: "center" }}
    >
      {durgun ? "≈ " : artis ? "▲ " : "▼ "}
      {Math.abs(yuzde).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%
    </Tag>
  );
};

/** Hazır dönem seçenekleri */
const DONEMLER = [
  { label: "Dün", gun: 1 },
  { label: "7 gün", gun: 7 },
  { label: "30 gün", gun: 30 },
  { label: "90 gün", gun: 90 },
];

export default function CiroVerimliligi() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<any>(null);
  const [arama, setArama] = useState("");
  const [olcut, setOlcut] = useState<"mevcut" | "norm">("mevcut");

  /* Varsayılan dönem: dün. Günlük takip için en sık bakılan aralık budur;
     geniş aralık gerektiğinde üstteki etiketlerden seçilir. */
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(1, "day"),
    dayjs().subtract(1, "day"),
  ]);

  /* Karşılaştırma dönemi */
  const [kiyas, setKiyas] = useState("hafta");
  const [kiyasAralik, setKiyasAralik] = useState<[Dayjs, Dayjs] | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const sorgu = new URLSearchParams({
        bas: aralik[0].format("YYYY-MM-DD"),
        bit: aralik[1].format("YYYY-MM-DD"),
        kiyas,
      });

      if (kiyas === "ozel" && kiyasAralik) {
        sorgu.set("kiyasBas", kiyasAralik[0].format("YYYY-MM-DD"));
        sorgu.set("kiyasBit", kiyasAralik[1].format("YYYY-MM-DD"));
      }

      setVeri(await api.al<any>(`/api/Rapor/CiroVerimliligi?${sorgu}`));
    } catch (hata: any) {
      message.error(hata.message);
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, kiyas, kiyasAralik, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /**
   * Hazır dönem seçimi.
   *
   * Aralık bir haftadan uzunsa kıyas ölçütü "önceki dönem"e çevrilir;
   * "geçen hafta" seçili kalırsa iki dönem örtüşür ve değişim yanıltıcı olur.
   */
  const donemSec = (gun: number) => {
    setAralik([dayjs().subtract(gun, "day"), dayjs().subtract(1, "day")]);

    if (gun > 7 && kiyas === "hafta") setKiyas("donem");
    if (gun <= 7 && kiyas === "donem") setKiyas("hafta");
  };

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    const kayitlar = (veri?.subeler ?? []).filter((s: any) =>
      q ? s.subeAdi?.toLocaleLowerCase("tr").includes(q) : true
    );

    /* Seçilen ölçüte göre sıralanır */
    return [...kayitlar].sort((a: any, b: any) =>
      olcut === "mevcut"
        ? b.mevcutBasi - a.mevcutBasi
        : b.normBasi - a.normBasi
    );
  }, [veri, arama, olcut]);

  /* Kıyas dönemi seçilen dönemle çakışıyorsa karşılaştırma yanıltıcı olur;
     örneğin 30 günlük bir aralığı "geçen hafta" ile kıyaslamak. */
  const ortusmeGunu = useMemo(() => {
    if (!veri?.kiyasDonemi) return 0;

    const bas = dayjs(veri.baslangic);
    const bit = dayjs(veri.bitis);
    const kBas = dayjs(veri.kiyasDonemi.baslangic);
    const kBit = dayjs(veri.kiyasDonemi.bitis);

    const kesisimBas = bas.isAfter(kBas) ? bas : kBas;
    const kesisimBit = bit.isBefore(kBit) ? bit : kBit;

    const gun = kesisimBit.diff(kesisimBas, "day") + 1;
    return gun > 0 ? gun : 0;
  }, [veri]);

  const genel = veri?.genel;

  /* Renk ölçütü MAĞAZA kişi başı ortalaması: tablodaki satırlar mağaza
     personeline bölünüyor. Önceden şirket geneline (merkez dahil) göre
     boyanıyor, bu yüzden hemen her şube "ortalamanın üstünde" yeşil
     görünüyordu. Sunucu da şube kıyası için bu ölçütü öneriyor. */
  const magaza = veri?.magaza;
  const ortalama = olcut === "mevcut" ? magaza?.mevcutBasi : magaza?.normBasi;

  /* --------------------------------------------------------- dışa aktarma */

  const [aktariliyor, setAktariliyor] = useState("");

  /**
   * PDF ve görsel için ekran dışında bir kopya hazırlar.
   *
   * Doğrudan ekrandaki tablo alınırsa kaydırma çubuğu yüzünden sağ sütunlar
   * kesilir. Bu yüzden özet kutuları ve tablo gerçek genişlikte yeniden
   * oluşturulur.
   */
  const alanHazirla = (): HTMLElement | null => {
    const tablo = document.getElementById("cv-yazdirilacak");
    if (!tablo) return null;

    const ozet = document.getElementById("cv-ozetler");

    const kapsayici = document.createElement("div");
    kapsayici.className = "cv-aktarim-alani";

    const baslik = document.createElement("div");
    baslik.className = "cv-aktarim-baslik";

    const donem = `${aralik[0].format("DD.MM.YYYY")} – ${aralik[1].format(
      "DD.MM.YYYY"
    )}`;

    baslik.textContent = `Personel Başı Ciro Verimliliği · ${donem}`;
    kapsayici.appendChild(baslik);

    if (ozet) kapsayici.appendChild(ozet.cloneNode(true));

    const tabloKopya = tablo.cloneNode(true) as HTMLElement;

    /* Kopyada kaydırma kabı kaldırılır; aksi hâlde sağ sütunlar kesilir */
    tabloKopya
      .querySelectorAll<HTMLElement>(".ant-table-body, .ant-table-content")
      .forEach((x) => {
        x.style.overflow = "visible";
        x.style.maxHeight = "none";
      });

    kapsayici.appendChild(tabloKopya);

    /* Sayfanın altına kıyas bilgisi ve üretim zamanı */
    const alt = document.createElement("div");
    alt.className = "cv-aktarim-alt";

    const kiyasMetni = veri?.kiyasDonemi
      ? ` · Karşılaştırma: ${dayjs(veri.kiyasDonemi.baslangic).format(
          "DD.MM.YYYY"
        )} – ${dayjs(veri.kiyasDonemi.bitis).format("DD.MM.YYYY")}`
      : "";

    alt.textContent =
      `Kişi başı değerler günlük ortalamadır${kiyasMetni}` +
      ` · ${dayjs().format("DD.MM.YYYY HH:mm")}`;

    kapsayici.appendChild(alt);

    kapsayici.style.position = "fixed";
    kapsayici.style.left = "-10000px";
    kapsayici.style.top = "0";
    /* Tablonun gerçek genişliği; sütunlar sıkışmasın */
    const icTablo = tablo.querySelector("table");
    const genislik = Math.max(1250, icTablo?.scrollWidth ?? tablo.scrollWidth);

    kapsayici.style.width = `${genislik}px`;
    kapsayici.style.background = "#ffffff";
    kapsayici.style.padding = "16px";

    document.body.appendChild(kapsayici);
    return kapsayici;
  };

  const alaniKaldir = (alan: HTMLElement | null) => {
    if (alan?.parentNode) alan.parentNode.removeChild(alan);
  };

  const dosyaAdi = () =>
    `personel_basi_ciro_${aralik[0].format("YYYYMMDD")}_${aralik[1].format(
      "YYYYMMDD"
    )}`;

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

  /** Tabloyu biçimlendirmesiyle birlikte Excel dosyası olarak indirir */
  const excelIndir = () => {
    const tablo = document
      .getElementById("cv-yazdirilacak")
      ?.querySelector("table");

    if (!tablo) {
      message.info("Aktarılacak tablo bulunamadı.");
      return;
    }

    setAktariliyor("excel");

    const donem = `${aralik[0].format("DD.MM.YYYY")} – ${aralik[1].format(
      "DD.MM.YYYY"
    )}`;

    try {
      excelOlarakIndir(
        tablo as HTMLElement,
        dosyaAdi(),
        `Personel Başı Ciro Verimliliği · ${donem}`
      );
    } catch (hata: any) {
      message.error("Excel oluşturulamadı: " + hata.message);
    } finally {
      setAktariliyor("");
    }
  };

  /** Listeyi biçimli .xlsx olarak indirir */
  const disaAktar = () => {
    if (liste.length === 0) {
      message.warning("Aktarılacak kayıt bulunmuyor.");
      return;
    }

    const kiyasVar = !!veri?.kiyasDonemi;

    tabloIndir({
      baslik: "Personel Başı Ciro",
      altBaslik: `${aralik[0].format("DD.MM.YYYY")} – ${aralik[1].format("DD.MM.YYYY")} · ${liste.length} şube`,
      sayfaAdi: "Personel Başı Ciro",
      dosyaAdi: `personel-basi-ciro-${aralik[0].format("YYYYMMDD")}-${aralik[1].format("YYYYMMDD")}`,
      genelToplam: true,
      sutunlar: [
        { ad: "Şube", genislik: 28 },
        { ad: "Dönem Toplam Ciro", tip: "para", genislik: 18, veriCubugu: true },
        { ad: "Günlük Ciro", tip: "para", genislik: 16 },
        { ad: "Norm", tip: "ondalik" },
        { ad: "Mevcut", tip: "ondalik" },
        { ad: "Norm Başı", tip: "para", genislik: 14, toplam: false },
        { ad: "Mevcut Başı", tip: "para", genislik: 14, toplam: false, renkOlcegi: true },
        ...(kiyasVar
          ? [
              { ad: "Önceki Günlük Ciro", tip: "para" as const, genislik: 16, toplam: false },
              { ad: "Değişim", tip: "yuzde" as const, toplam: false, renkOlcegi: true },
            ]
          : []),
        { ad: "Gün Sayısı", tip: "sayi", toplam: false },
      ],
      satirlar: liste.map((s: any) => [
        s.subeAdi, s.toplamCiro, s.gunlukCiro, s.norm, s.mevcut, s.normBasi, s.mevcutBasi,
        ...(kiyasVar
          ? [s.oncekiGunlukCiro, s.degisimYuzde == null ? null : Number(s.degisimYuzde) / 100]
          : []),
        s.gunSayisi,
      ]),
    });
  };

  return (
    <>
      <div className="rr-uyari-serit rr-mavi">
        <TrendingUp size={16} strokeWidth={2} />
        <div>
          Kişi başı değerler <b>günlük ortalama</b> cirodan hesaplanır: dönemin
          toplam cirosu gün sayısına, sonra personel sayısına bölünür. Norm
          başı değer mevcut başından düşükse kadro eksik, yüksekse fazla
          çalışıyor demektir. Renkler <b>mağaza kişi başı</b> ortalamasına
          göredir. Personel sayıları Norm Kadro ekranındaki kadro tablosundan.
        </div>
      </div>

      {ortusmeGunu > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Karşılaştırma dönemi seçilen dönemle ${ortusmeGunu} gün örtüşüyor`}
          description="Aynı günler her iki dönemde de sayıldığı için değişim yüzdesi olduğundan küçük görünür. Uzun aralıklarda 'Önceki dönem' veya 'Geçen ay' seçeneğini kullanınız."
        />
      )}

      {/* ------------------------------------------------------------ filtre */}
      <div className="rr-filtre">
            <RangePicker
              value={aralik}
              format="DD.MM.YYYY"
              allowClear={false}
              disabledDate={(g) => !!g && g > dayjs().endOf("day")}
              onChange={(d) => d?.[0] && d?.[1] && setAralik([d[0], d[1]])}
            />

            <div className="rr-seg">
              {DONEMLER.map((d) => {
                const secili =
                  aralik[1].isSame(dayjs().subtract(1, "day"), "day") &&
                  aralik[0].isSame(dayjs().subtract(d.gun, "day"), "day");
                return (
                  <button
                    key={d.label}
                    type="button"
                    className={secili ? "rr-aktif" : undefined}
                    onClick={() => donemSec(d.gun)}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>

            <Space.Compact style={{ minWidth: 200 }}>
              <Select
                style={{ width: kiyas === "ozel" ? "45%" : "100%" }}
                value={kiyas}
                onChange={setKiyas}
                options={[
                  { value: "hafta", label: "Geçen hafta" },
                  { value: "donem", label: "Önceki dönem" },
                  { value: "ay", label: "Geçen ay" },
                  { value: "yil", label: "Geçen yıl" },
                  { value: "ozel", label: "Özel tarih" },
                  { value: "yok", label: "Karşılaştırma yok" },
                ]}
              />

              {kiyas === "ozel" && (
                <RangePicker
                  value={kiyasAralik}
                  format="DD.MM"
                  allowClear={false}
                  style={{ width: "55%" }}
                  onChange={(d) =>
                    d?.[0] && d?.[1] && setKiyasAralik([d[0], d[1]])
                  }
                />
              )}
            </Space.Compact>

            <Input
              allowClear
              placeholder="Şube ara"
              style={{ width: 170 }}
              prefix={<Search size={15} strokeWidth={2} color="#9AA3AF" />}
              value={arama}
              onChange={(e) => setArama(e.target.value)}
            />

            <div className="rr-filtre-sag">
            <Segmented
              value={olcut}
              onChange={(v) => setOlcut(v as "mevcut" | "norm")}
              options={[
                { label: "Mevcut", value: "mevcut" },
                { label: "Norm", value: "norm" },
              ]}
            />

            <Space size={6}>
              <Tooltip title="Yenile">
                <Button
                  icon={<RefreshCw size={15} strokeWidth={2} />}
                  onClick={getir}
                />
              </Tooltip>

              <Dropdown
                trigger={["click"]}
                disabled={!!aktariliyor || liste.length === 0}
                menu={{
                  items: [
                    {
                      key: "excel",
                      label: "Excel olarak indir",
                      icon: <FileSpreadsheet size={15} strokeWidth={2} />,
                      onClick: excelIndir,
                    },
                    {
                      key: "csv",
                      label: "CSV olarak indir",
                      icon: <FileText size={15} strokeWidth={2} />,
                      onClick: disaAktar,
                    },
                    { type: "divider" },
                    {
                      key: "pdf",
                      label: "PDF olarak indir",
                      icon: <FileDown size={15} strokeWidth={2} />,
                      onClick: pdfIndir,
                    },
                    {
                      key: "gorsel",
                      label: "Görsel olarak indir",
                      icon: <ImageDown size={15} strokeWidth={2} />,
                      onClick: gorselIndir,
                    },
                  ],
                }}
              >
                <Button
                  icon={<Download size={15} strokeWidth={2} />}
                  loading={!!aktariliyor}
                >
                  İndir
                </Button>
              </Dropdown>
            </Space>
            </div>
      </div>

      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : !veri ? (
        <Empty description="Veri alınamadı." />
      ) : (
        <>
          {/* ------------------------------------------------------- özet */}
          <div id="cv-ozetler">
          <div className="rr-kpi-satir rr-dort">
              <Tooltip title="Seçilen tarih aralığında yapılan toplam satış (eşleşen şubeler)">
                <div className="rr-kpi">
                  <div className="rr-kpi-ust">
                    <span>
                      Dönem toplam cirosu
                      {veri.donem?.gunSayisi > 1 && ` · ${veri.donem.gunSayisi} gün`}
                    </span>
                  </div>
                  <div className="rr-kpi-deger">{para(veri.donem?.toplamCiro)} ₺</div>
                  <div className="rr-kpi-alt">
                    günlük ortalama {para(genel?.gunlukCiro)} ₺{" "}
                    {veri.kiyasDonemi && <DegisimRozeti yuzde={veri.donem?.degisimYuzde} />}
                  </div>
                </div>
              </Tooltip>
              <Tooltip title="Şirketin tüm personeli / yalnızca mağaza personeli (Norm Kadro mevcut sayıları)">
                <div className="rr-kpi">
                  <div className="rr-kpi-ust"><span>Personel (tümü / mağaza)</span></div>
                  <div className="rr-kpi-deger" style={{ color: "#2e6aa8" }}>
                    {genel?.mevcut ?? 0} / {veri.magaza?.mevcut ?? 0}
                  </div>
                  <div className="rr-kpi-alt">
                    {veri.merkezPersoneli?.mevcut > 0
                      ? `merkez ve diğer birimler ${veri.merkezPersoneli.mevcut} kişi`
                      : "mevcut personel"}
                  </div>
                </div>
              </Tooltip>
              <Tooltip title="Mağaza ciroları ÷ şirketin tüm personeli (genel müdürlük, lojistik depo, hal dahil)">
                <div className="rr-kpi">
                  <div className="rr-kpi-ust"><span>Genel kişi başı · günlük</span></div>
                  <div className="rr-kpi-deger" style={{ color: "#2f54eb" }}>
                    {para(olcut === "norm" ? genel?.normBasi : genel?.mevcutBasi)} ₺
                  </div>
                  <div className="rr-kpi-alt">
                    {veri.kiyasDonemi ? (
                      <>
                        önceki {para(olcut === "norm" ? genel?.oncekiNormBasi : genel?.oncekiMevcutBasi)} ₺{" "}
                        <DegisimRozeti
                          yuzde={olcut === "norm" ? genel?.normDegisimYuzde : genel?.degisimYuzde}
                        />
                      </>
                    ) : (
                      "tüm personel"
                    )}
                  </div>
                </div>
              </Tooltip>
              <Tooltip title="Mağaza ciroları ÷ yalnızca mağaza personeli; şube renkleri bu ortalamaya göre">
                <div className="rr-kpi">
                  <div className="rr-kpi-ust"><span>Mağaza kişi başı · günlük</span></div>
                  <div className="rr-kpi-deger" style={{ color: "#389e0d" }}>
                    {para(olcut === "norm" ? veri.magaza?.normBasi : veri.magaza?.mevcutBasi)} ₺
                  </div>
                  <div className="rr-kpi-alt">
                    {veri.kiyasDonemi ? (
                      <>
                        önceki{" "}
                        {para(olcut === "norm" ? veri.magaza?.oncekiNormBasi : veri.magaza?.oncekiMevcutBasi)} ₺{" "}
                        <DegisimRozeti
                          yuzde={olcut === "norm" ? veri.magaza?.normDegisimYuzde : veri.magaza?.degisimYuzde}
                        />
                      </>
                    ) : (
                      "yalnızca mağaza personeli"
                    )}
                  </div>
                </div>
              </Tooltip>
          </div>
          </div>

          {/* Sistemde karşılığı bulunamayan depolar */}
          {veri.eslesmeyenDepolar?.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${veri.eslesmeyenDepolar.length} depo eşleştirilemedi`}
              description={
                <span>
                  Bu depoların cirosu var ancak sistemde aynı adla tanımlı bir
                  şube bulunamadı. Yönetim → Form Ayarları ekranından şube
                  adlarını Mikro'daki yazımla eşitleyebilirsiniz.
                  <div style={{ marginTop: 6 }}>
                    <Space size={4} wrap>
                      {veri.eslesmeyenDepolar.map((d: string) => (
                        <Tag key={d} color="orange" style={{ marginInlineEnd: 0 }}>
                          {d}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                </span>
              }
            />
          )}

          {liste.length === 0 ? (
            <Empty description="Bu dönemde ciro kaydı bulunan şube yok." />
          ) : (
            <div className="rr-kart">
              <div className="rr-kart-bas">
                <b>
                  <TrendingUp size={16} strokeWidth={2} />
                  Şube bazında verimlilik
                </b>
                <span>{liste.length} şube</span>
                <div className="rr-sag">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(veri.baslangic).format("DD.MM.YYYY")} –{" "}
                  {dayjs(veri.bitis).format("DD.MM.YYYY")}
                  {veri.kiyasDonemi && (
                    <>
                      {" · kıyas: "}
                      {dayjs(veri.kiyasDonemi.baslangic).format("DD.MM.YYYY")} –{" "}
                      {dayjs(veri.kiyasDonemi.bitis).format("DD.MM.YYYY")}
                    </>
                  )}
                </Text>
                </div>
              </div>
              <div className="rr-kart-ic rr-sifir">
              <div id="cv-yazdirilacak">
              <Tablo
                rowKey="subeKodu"
                size="small"
                pagination={false}
                /* Genel toplam satırı listenin başında sabit durur */
                dataSource={
                  genel
                    ? [
                        {
                          subeKodu: "__GENEL__",
                          subeAdi: "GENEL KİŞİ BAŞI",
                          gunlukCiro: genel.gunlukCiro,
                          toplamCiro: veri.donem?.toplamCiro,
                          norm: genel.norm,
                          mevcut: genel.mevcut,
                          normBasi: genel.normBasi,
                          mevcutBasi: genel.mevcutBasi,
                          oncekiGunlukCiro: genel.oncekiGunlukCiro,
                          degisimYuzde: genel.degisimYuzde,
                          /* Norm ölçütünde norm değişimi; önceden mevcut
                             değişimi yazılıyordu (alan sunucuda yoktu). */
                          normDegisimYuzde: genel.normDegisimYuzde ?? null,
                          gunSayisi: null,
                          genelMi: true,
                          aciklama: "tüm personel",
                        },
                        {
                          subeKodu: "__MAGAZA__",
                          subeAdi: "MAĞAZA KİŞİ BAŞI",
                          gunlukCiro: veri.magaza?.gunlukCiro,
                          toplamCiro: veri.donem?.toplamCiro,
                          norm: veri.magaza?.norm,
                          mevcut: veri.magaza?.mevcut,
                          normBasi: veri.magaza?.normBasi,
                          mevcutBasi: veri.magaza?.mevcutBasi,
                          oncekiGunlukCiro:
                            veri.magaza?.oncekiGunlukCiro ?? genel.oncekiGunlukCiro,
                          /* Mağaza satırı kendi değişimini gösterir; önceden
                             genel satırın değişimi kopyalanıyordu. */
                          degisimYuzde: veri.magaza?.degisimYuzde ?? null,
                          normDegisimYuzde: veri.magaza?.normDegisimYuzde ?? null,
                          gunSayisi: null,
                          genelMi: true,
                          aciklama: "yalnızca mağaza personeli",
                        },
                        ...liste,
                      ]
                    : liste
                }
                rowClassName={(k: any) =>
                  k.genelMi ? "rp-genel-satir" : ""
                }
                scroll={{ x: 880 }}
                columns={[
                  {
                    title: "Şube",
                    dataIndex: "subeAdi",
                    width: 190,
                    fixed: "left",
                    render: (v: string, k: any) => (
                      <div style={{ lineHeight: 1.3 }}>
                        <Text strong>{v}</Text>
                        {k.aciklama && (
                          <div style={{ fontSize: 11, color: "#8a8f98" }}>
                            {k.aciklama}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: "Günlük Ciro",
                    dataIndex: "gunlukCiro",
                    width: 155,
                    align: "right",
                    sorter: (a: any, b: any) =>
                      a.genelMi || b.genelMi ? 0 : a.gunlukCiro - b.gunlukCiro,
                    render: (v: number, k: any) => (
                      <div style={{ lineHeight: 1.35 }}>
                        <div>{para(v)} ₺</div>
                        {/* Aralık birden fazla günse dönem toplamı da yazılır */}
                        {veri.donem?.gunSayisi > 1 && k.toplamCiro > 0 && (
                          <Text type="secondary" style={{ fontSize: 11.5 }}>
                            toplam {para(k.toplamCiro)} ₺
                          </Text>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: "Norm",
                    dataIndex: "norm",
                    width: 80,
                    align: "center",
                    sorter: (a: any, b: any) =>
                      a.genelMi || b.genelMi ? 0 : a.norm - b.norm,
                    render: (v: number) =>
                      v > 0 ? v : <span style={{ color: "#bbb" }}>—</span>,
                  },
                  {
                    title: "Mevcut",
                    dataIndex: "mevcut",
                    width: 85,
                    align: "center",
                    sorter: (a: any, b: any) =>
                      a.genelMi || b.genelMi ? 0 : a.mevcut - b.mevcut,
                    render: (v: number, k: any) => (
                      <Space size={4}>
                        <span>{v > 0 ? v : "—"}</span>
                        {!k.genelMi && k.norm > 0 && v > 0 && v !== k.norm && (
                          <Tooltip
                            title={
                              v < k.norm
                                ? `Norm kadronun ${(k.norm - v).toFixed(1)} kişi altında`
                                : `Norm kadronun ${(v - k.norm).toFixed(1)} kişi üstünde`
                            }
                          >
                            <i
                              style={{
                                fontSize: 11,
                                fontStyle: "normal",
                                color: v < k.norm ? "#cf1322" : "#d48806",
                              }}
                            >
                              {v < k.norm ? "▼" : "▲"}
                            </i>
                          </Tooltip>
                        )}
                      </Space>
                    ),
                  },
                  {
                    title: (
                      <Tooltip title="Günlük ortalama ciro ÷ norm kadro. Alt satırda dönemin tamamındaki kişi başı ciro yazar.">
                        <span>
                          Norm Başı
                          <i className="cv-baslik-alt">günlük</i>
                        </span>
                      </Tooltip>
                    ),
                    dataIndex: "normBasi",
                    width: 150,
                    align: "right",
                    sorter: (a: any, b: any) =>
                      a.genelMi || b.genelMi ? 0 : a.normBasi - b.normBasi,
                    render: (v: number, k: any) => (
                      <div style={{ lineHeight: 1.35 }}>
                        <b
                          style={{
                            color: k.genelMi
                              ? "#2f54eb"
                              : oranRengi(v, magaza?.normBasi),
                          }}
                        >
                          {para(v)} ₺
                        </b>
                        {/* Dönemin tamamındaki kişi başı ciro */}
                        {veri.donem?.gunSayisi > 1 && v > 0 && (
                          <div>
                            <Text type="secondary" style={{ fontSize: 11.5 }}>
                              {para(v * veri.donem.gunSayisi)} ₺ dönem
                            </Text>
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: (
                      <Tooltip title="Günlük ortalama ciro ÷ çalışan personel. Alt satırda dönemin tamamındaki kişi başı ciro yazar.">
                        <span>
                          Mevcut Başı
                          <i className="cv-baslik-alt">günlük</i>
                        </span>
                      </Tooltip>
                    ),
                    dataIndex: "mevcutBasi",
                    width: 150,
                    align: "right",
                    defaultSortOrder: "descend",
                    sorter: (a: any, b: any) =>
                      a.genelMi || b.genelMi ? 0 : a.mevcutBasi - b.mevcutBasi,
                    render: (v: number, k: any) => (
                      <div style={{ lineHeight: 1.35 }}>
                        <b
                          style={{
                            color: k.genelMi
                              ? "#389e0d"
                              : oranRengi(v, magaza?.mevcutBasi),
                          }}
                        >
                          {para(v)} ₺
                        </b>
                        {veri.donem?.gunSayisi > 1 && v > 0 && (
                          <div>
                            <Text type="secondary" style={{ fontSize: 11.5 }}>
                              {para(v * veri.donem.gunSayisi)} ₺ dönem
                            </Text>
                          </div>
                        )}
                      </div>
                    ),
                  },
                  ...(veri.kiyasDonemi
                    ? [
                        {
                          title: (
                            <Tooltip title="Karşılaştırma dönemindeki günlük ciro">
                              <span>Önceki</span>
                            </Tooltip>
                          ),
                          dataIndex: "oncekiGunlukCiro",
                          width: 130,
                          align: "right" as const,
                          render: (v: number) =>
                            v > 0 ? (
                              <Text type="secondary">{para(v)} ₺</Text>
                            ) : (
                              <span style={{ color: "#bbb" }}>—</span>
                            ),
                        },
                        {
                          title: (
                            <Tooltip title="Kişi başı ciro değişimi. Seçilen ölçüte göre hesaplanır; kadro değiştiyse ciro değişiminden farklı çıkar.">
                              <span>Değişim</span>
                            </Tooltip>
                          ),
                          dataIndex:
                            olcut === "norm" ? "normDegisimYuzde" : "degisimYuzde",
                          width: 100,
                          align: "center" as const,
                          sorter: (a: any, b: any) => {
                            const alan =
                              olcut === "norm" ? "normDegisimYuzde" : "degisimYuzde";
                            return (a[alan] ?? -999) - (b[alan] ?? -999);
                          },
                          render: (v: number | null) => (
                            <DegisimRozeti yuzde={v} />
                          ),
                        },
                      ]
                    : []),
                  {
                    title: "Gün",
                    dataIndex: "gunSayisi",
                    width: 70,
                    align: "center",
                    render: (v: number | null) =>
                      v === null ? (
                        <span style={{ color: "#bbb" }}>—</span>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {v}
                        </Text>
                      ),
                  },
                ]}
              />

              </div>

              <Paragraph
                type="secondary"
                style={{ fontSize: 12, margin: 0, padding: "10px 16px 12px", borderTop: "1px solid #eef1ea" }}
              >
                Renkler seçilen ölçütün mağaza kişi başı ortalamasına göredir.
                Mevcut sütunundaki ok işareti, kadronun normun altında (▼) veya
                üstünde (▲) olduğunu gösterir.
              </Paragraph>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
