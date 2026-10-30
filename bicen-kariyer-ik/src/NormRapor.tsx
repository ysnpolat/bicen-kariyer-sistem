/**
 * ---------------------------------------------------------------------------
 * Şube Norm Raporu
 * ---------------------------------------------------------------------------
 * İki görünüm sunar:
 *
 *   1. Şube Listesi  — her şube bir satır; eksik pozisyonlar gün bilgisiyle,
 *                      işe alınanlar, evrak aşamasındakiler ve fazla personel.
 *   2. Norm Tablosu  — şubeler sütun, ölçütler satır olacak şekilde özet
 *                      (norm, mevcut, fark, engelli, raporlu, eksik/fazla detayı).
 *
 * Raporlu (03.10.2026): rapor gününde sağlık raporlu çalışan sayısı. Engelli
 * gibi bilgi amaçlı; raporlu personel mevcut sayısına dahildir.
 *
 * Renk kodları İK'nın kullandığı tabloyla aynıdır.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Col,
  DatePicker,
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
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import { tabloIndir } from "./raporExcel";
import {
  Download,
  FileDown,
  FileSpreadsheet,
  ImageDown,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  excelOlarakIndir,
  gorselOlarakIndir,
  pdfOlarakIndir,
  tarihDamgasi,
} from "./disaAktar";

import Tablo from "./Tablo";
import { api } from "./api";

const { Text } = Typography;

interface KadroSatiri {
  bolum: string;
  adet: number;
  gun: number;
  aciklama: string;
}

interface SubeRaporu {
  sira: number;
  subeKodu: string;
  subeAdi: string;
  birimTuru: string;
  bolge: string;
  norm: number;
  mevcut: number;
  fark: number;
  engelliCalisan: number;
  eksikler: KadroSatiri[];
  fazlalar: KadroSatiri[];
  iseAlinanlar: string[];
  evrakTamamlayanlar: string[];
  rotasyon: number;
  havuzdakiAday: number;

  /** Çıkış tarihi ileri bir güne yazılmış, ayrılacağı belli olan personel */
  ayrilacak: number;

  /** "Ad Soyad · Ünvan · 12.09.2026" biçiminde liste */
  ayrilacaklar: string[];

  /** Rapor gününde raporlu çalışan (kişi); mevcuda dahil */
  raporlu?: number;

  /** "Ad Soyad · Ünvan · rapor bitişi" biçiminde liste */
  raporlular?: string[];
}

interface Veri {
  toplamNorm: number;
  toplamMevcut: number;
  toplamFark: number;
  toplamEngelli: number;
  /** Rapor gününde raporlu çalışan (kişi); mevcuda dahil */
  toplamRaporlu?: number;
  toplamEksik: number;
  toplamFazla: number;
  toplamAlinan: number;
  toplamEvrak: number;
  toplamRotasyon: number;
  toplamHavuz: number;

  /** Raporda görünmeyen birimler dahil, çıkışı planlanmış personelin tamamı */
  toplamAyrilacak: number;
  ayrilacakListesi: {
    personelKodu: string;
    adSoyad: string;
    birim: string;
    pozisyon: string;
    cikisTarihi: string;
    kalanGun: number;
  }[];
  satirlar: SubeRaporu[];
  mikroSenkron?: {
    guncellenen: number;
    sayilan: number;
    toplamAktif: number;
    eslesemeyen: string[];
    hata: string | null;
  };
}

const BOS: Veri = {
  toplamNorm: 0,
  toplamMevcut: 0,
  toplamFark: 0,
  toplamEngelli: 0,
  toplamRaporlu: 0,
  toplamEksik: 0,
  toplamFazla: 0,
  toplamAlinan: 0,
  toplamEvrak: 0,
  toplamRotasyon: 0,
  toplamHavuz: 0,
  toplamAyrilacak: 0,
  ayrilacakListesi: [],
  satirlar: [],
};

/** Ondalık sayıyı Türkçe biçimde yazar: 24.5 → "24,5" */
const sayi = (deger: number): string => {
  if (deger === null || deger === undefined) return "—";
  return Number.isInteger(deger)
    ? String(deger)
    : deger.toFixed(1).replace(".", ",");
};

/** Eksik süresine göre uyarı rengi */
const gunRengi = (gun: number) => {
  if (gun <= 0) return "default";
  if (gun <= 7) return "gold";
  if (gun <= 30) return "orange";
  return "red";
};

export default function NormRapor() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<Veri>(BOS);
  const [gorunum, setGorunum] = useState<"liste" | "tablo">("liste");
  const [arama, setArama] = useState("");
  const [bolgeFiltre, setBolgeFiltre] = useState<string | undefined>();
  /* Eksik/fazla süzgeci tek değerde: iki ayrı açma-kapama olsaydı ikisi
     birden açıkken "hem eksiği hem fazlası olan şubeler" gibi kimsenin
     istemediği bir liste çıkardı. */
  const [suzgec, setSuzgec] = useState<"" | "eksik" | "fazla">("");

  /* İşe alınanlar bu güne aittir; varsayılan bugündür */
  const [gun, setGun] = useState<Dayjs>(dayjs());

  /* Ayrılacak personel kartına tıklanınca açılan liste. Sayıyı görmek
     yetmiyordu: "kim, ne zaman, hangi şubeden" sorusunun cevabı için
     ekranda satır satır aramak gerekiyordu. */
  const [ayrilacakAcik, setAyrilacakAcik] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(
        await api.al<Veri>(
          `/api/Havuz/NormRapor?gun=${gun.format("YYYY-MM-DD")}`
        )
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message, gun]);

  useEffect(() => {
    getir();
  }, [getir]);

  const bolgeler = useMemo(
    () =>
      Array.from(new Set(veri.satirlar.map((x) => x.bolge)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "tr")),
    [veri.satirlar]
  );

  const satirlar = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    return veri.satirlar.filter((x) => {
      if (bolgeFiltre && x.bolge !== bolgeFiltre) return false;
      if (suzgec === "eksik" && x.eksikler.length === 0) return false;
      if (suzgec === "fazla" && (x.fazlalar?.length ?? 0) === 0) return false;
      if (q && !x.subeAdi.toLocaleLowerCase("tr").includes(q)) return false;
      return true;
    });
  }, [veri.satirlar, arama, bolgeFiltre, suzgec]);

  /* ------------------------------------------------------------ dışa aktar */

  const disaAktar = () => {
    if (satirlar.length === 0) {
      message.info("Dışa aktarılacak kayıt yok.");
      return;
    }

    tabloIndir({
      baslik: "Norm Kadro Raporu",
      altBaslik: `${satirlar.length} birim`,
      sayfaAdi: "Norm Kadro",
      dosyaAdi: "norm_kadro_raporu",
      grupSutunu: 2,
      genelToplam: true,
      sutunlar: [
        { ad: "No", tip: "sayi", toplam: false, genislik: 6 },
        { ad: "Şube", genislik: 28 },
        { ad: "Bölge", genislik: 18 },
        { ad: "Norm", tip: "ondalik" },
        { ad: "Mevcut", tip: "ondalik" },
        { ad: "Fark", tip: "ondalik", renkOlcegi: true },
        { ad: "Engelli Çalışan", tip: "ondalik" },
        { ad: "Raporlu", tip: "sayi" },
        { ad: "Raporlu Personel", genislik: 40 },
        { ad: "Eksik Personel Detayı", genislik: 40 },
        { ad: "Fazla Personel Detayı", genislik: 40 },
        { ad: "Ayrılacak", tip: "sayi" },
        { ad: "Ayrılacak Personel", genislik: 40 },
        { ad: "Bugün İşe Alınan", genislik: 30 },
        { ad: "Evrak Tamamlıyor", genislik: 30 },
        { ad: "Rotasyon", genislik: 24 },
        { ad: "Havuzda", tip: "sayi" },
      ],
      satirlar: satirlar.map((x) => [
        x.sira, x.subeAdi, x.bolge, x.norm, x.mevcut, x.fark, x.engelliCalisan,
        x.raporlu ?? 0, (x.raporlular ?? []).join(" | "),
        x.eksikler.map((e) => `${e.bolum} (${sayi(e.adet)} kişi, ${e.gun} gün)`).join(" | "),
        x.fazlalar.map((f) => `${f.bolum} (${sayi(f.adet)}${f.gun ? `, ${f.gun} gün` : ""})`).join(" | "),
        x.ayrilacak ?? 0, (x.ayrilacaklar ?? []).join(" | "),
        x.iseAlinanlar.join(" | "), x.evrakTamamlayanlar.join(" | "), x.rotasyon, x.havuzdakiAday,
      ]),
    });
  };

  /* --------------------------------------------------------- liste görünümü */

  const listeSutunlari: ColumnsType<SubeRaporu> = [
    {
      title: "No",
      dataIndex: "sira",
      width: 55,
      align: "center",
      fixed: "left",
      render: (v: number) => <Text type="secondary">{v}</Text>,
    },
    {
      title: "Şube",
      dataIndex: "subeAdi",
      width: 170,
      fixed: "left",
      render: (v: string, k) => (
        <div>
          <Text strong>{v}</Text>
          <div style={{ fontSize: 11.5, color: "#8a8f98" }}>{k.bolge}</div>
        </div>
      ),
    },
    {
      title: "Eksik Personel",
      key: "eksik",
      width: 230,
      render: (_v, k) =>
        k.eksikler.length === 0 ? (
          <span style={{ color: "#bbb" }}>—</span>
        ) : (
          <Space size={5} wrap>
            {k.eksikler.map((e) => (
              <Tooltip key={e.bolum} title={e.aciklama || undefined}>
                <span className="nr-eksik">
                  <span className="nr-eksik-ad">{e.bolum}</span>
                  <span className="nr-eksik-adet">{sayi(e.adet)}</span>
                  {e.gun > 0 && (
                    <Tag
                      color={gunRengi(e.gun)}
                      style={{ marginInlineEnd: 0, marginLeft: 4 }}
                    >
                      {e.gun} gün
                    </Tag>
                  )}
                </span>
              </Tooltip>
            ))}
          </Space>
        ),
    },
    {
      title: "Norm",
      dataIndex: "norm",
      width: 70,
      align: "center",
      sorter: (a, b) => a.norm - b.norm,
      render: (v: number) => <b>{sayi(v)}</b>,
    },
    {
      title: "Mevcut",
      dataIndex: "mevcut",
      width: 75,
      align: "center",
      render: (v: number) => sayi(v),
    },
    {
      title: "Fark",
      dataIndex: "fark",
      width: 80,
      align: "center",
      sorter: (a, b) => a.fark - b.fark,
      render: (v: number) => {
        if (v === 0) return <Tag color="green">0</Tag>;
        return v < 0 ? (
          <Tag color="red">{sayi(v)}</Tag>
        ) : (
          <Tag color="default">+{sayi(v)}</Tag>
        );
      },
    },
    {
      title: "Fazla Personel",
      key: "fazla",
      width: 230,
      render: (_v, k) => {
        if (k.fazlalar.length === 0) {
          return <span style={{ color: "#bbb" }}>—</span>;
        }

        return (
          <Space size={5} wrap>
            {k.fazlalar.map((f) => (
              <Tooltip key={f.bolum} title={f.aciklama || undefined}>
                <span className="nr-fazla">
                  {f.bolum} <b>+{sayi(f.adet)}</b>
                  {f.gun > 0 && <i className="nr-gun">{f.gun} gün</i>}
                </span>
              </Tooltip>
            ))}
          </Space>
        );
      },
    },
    {
      title: "Engelli",
      dataIndex: "engelliCalisan",
      key: "engelli",
      width: 80,
      align: "center",
      sorter: (a, b) => a.engelliCalisan - b.engelliCalisan,
      render: (v: number) =>
        v > 0 ? (
          <span className="nr-engelli">
            <b>{sayi(v)}</b>
          </span>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
    {
      /* Raporlu: rapor gününde sağlık raporlu olan çalışan. Engelli gibi
         bilgi amaçlı; mevcuda dahil, farkı değiştirmez. */
      title: (
        <Tooltip title="Rapor gününde sağlık raporlu çalışan. Mevcut sayısına dahildir; farkı değiştirmez.">
          Raporlu
        </Tooltip>
      ),
      dataIndex: "raporlu",
      key: "raporlu",
      width: 85,
      align: "center",
      sorter: (a, b) => (a.raporlu ?? 0) - (b.raporlu ?? 0),
      render: (v: number, k) =>
        v > 0 ? (
          <Tooltip
            title={
              <div style={{ whiteSpace: "pre-line" }}>
                {`Raporlu · bitiş tarihi\n${(k.raporlular ?? []).join("\n")}\n\nMevcut sayısına dahil.`}
              </div>
            }
          >
            <span className="nr-raporlu">
              <b>{v}</b>
            </span>
          </Tooltip>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
    {
      /* Mevcut sayısına dahil olmaya devam ediyorlar — çıkış gününe kadar
         çalışıyorlar — ama şubenin kaç kişiyi kaybedeceği ayrı görünmeli:
         norm tutuyor görünen bir şube iki hafta sonra üç kişi eksik
         kalabiliyordu. */
      title: "Ayrılacak",
      dataIndex: "ayrilacak",
      key: "ayrilacak",
      width: 150,
      align: "center",
      sorter: (a, b) => (a.ayrilacak ?? 0) - (b.ayrilacak ?? 0),
      render: (v: number, k) =>
        !v ? (
          <span style={{ color: "#bbb" }}>—</span>
        ) : (
          <Tooltip
            title={
              <div style={{ whiteSpace: "pre-line" }}>
                {(k.ayrilacaklar ?? []).join("\n")}
              </div>
            }
          >
            <Space size={4} wrap style={{ justifyContent: "center" }}>
              <Tag color="volcano">{v}</Tag>

              {(k.ayrilacaklar ?? []).slice(0, 2).map((a) => (
                <span key={a} className="nr-ayrilacak">
                  {a}
                </span>
              ))}

              {(k.ayrilacaklar ?? []).length > 2 && (
                <span className="nr-ayrilacak">
                  +{(k.ayrilacaklar ?? []).length - 2}
                </span>
              )}
            </Space>
          </Tooltip>
        ),
    },
    {
      title: gun.isSame(dayjs(), "day") ? "Bugün İşe Alınan" : `İşe Alınan · ${gun.format("DD.MM")}`,
      key: "alinan",
      width: 170,
      render: (_v, k) =>
        k.iseAlinanlar.length === 0 ? (
          <span style={{ color: "#bbb" }}>—</span>
        ) : (
          <Space size={5} wrap>
            {k.iseAlinanlar.map((a) => (
              <span key={a} className="nr-alinan">
                {a}
              </span>
            ))}
          </Space>
        ),
    },
    {
      title: "Evrak Tamamlıyor",
      key: "evrak",
      width: 170,
      render: (_v, k) =>
        k.evrakTamamlayanlar.length === 0 ? (
          <span style={{ color: "#bbb" }}>—</span>
        ) : (
          <Space size={5} wrap>
            {k.evrakTamamlayanlar.map((a) => (
              <span key={a} className="nr-evrak">
                {a}
              </span>
            ))}
          </Space>
        ),
    },
    {
      title: "Rotasyon",
      dataIndex: "rotasyon",
      width: 85,
      align: "center",
      render: (v: number) =>
        v > 0 ? <Tag color="gold">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "Havuzda",
      dataIndex: "havuzdakiAday",
      width: 85,
      align: "center",
      render: (v: number) =>
        v > 0 ? <Tag color="blue">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
  ];

  /* Ayrılacak personel, şube satırlarından toplanıyor. Sunucu her şube için
     "Ad Soyad · Ünvan · gg.aa.yyyy" biçiminde veriyor; burada tek listeye
     açılıp çıkış tarihine göre sıralanıyor — en yakın çıkış en üstte. */
  /* Liste sunucudan geliyor, şube satırlarından toplanmıyor: merkez büro
     ve depo gibi "norm raporunda gizle" işaretli birimlerdeki ya da hiçbir
     şubeye eşleşmeyen personel aksi hâlde hiçbir yerde görünmüyordu ve
     çıkışı tamamen kaçırılabiliyordu. */
  const ayrilacakListesi = useMemo(
    () =>
      (veri.ayrilacakListesi ?? [])
        .map((k) => ({
          ad: k.adSoyad,
          unvan: k.pozisyon,
          sube: k.birim,
          tarih: dayjs(k.cikisTarihi).format("DD.MM.YYYY"),
          kalan: k.kalanGun,
        }))
        .sort((a, b) => a.kalan - b.kalan),
    [veri.ayrilacakListesi]
  );

  const ayrilacakToplam = veri.toplamAyrilacak ?? ayrilacakListesi.length;

  /* --------------------------------------------------------- tablo görünümü */

  /* Dar ekranlarda 39 sütunluk tablo okunamaz; kart görünümüne geçilir */
  const [darEkran, setDarEkran] = useState(
    typeof window !== "undefined" && window.innerWidth < 900
  );

  useEffect(() => {
    const olcum = () => setDarEkran(window.innerWidth < 900);
    window.addEventListener("resize", olcum);
    return () => window.removeEventListener("resize", olcum);
  }, []);

  /* Norm tablosu görünümünde sayfa kenar boşlukları daraltılır;
     böylece 39 sütunluk tablo daha geniş yer bulur. */
  useEffect(() => {
    const genis = gorunum === "tablo" && !darEkran;

    document.body.classList.toggle("nr-genis", genis);
    return () => document.body.classList.remove("nr-genis");
  }, [gorunum, darEkran]);

  const [aktariliyor, setAktariliyor] = useState<"" | "pdf" | "gorsel" | "excel">("");

  /**
   * Aktarılacak alanı hazırlar.
   *
   * Özet kutuları ile tablo tek bir kapsayıcıda birleştirilir; ayrıca dikey
   * yazılmış şube başlıkları geçici olarak yatay hâle getirilir. Görüntüye
   * çevirme işlemi döndürülmüş yazıları doğru basamadığı için bu gerekli.
   */
  const alanHazirla = (): HTMLElement | null => {
    const tablo = document.getElementById("nr-yazdirilacak");
    if (!tablo) return null;

    const ozet = document.getElementById("nr-ozetler");

    const kapsayici = document.createElement("div");
    kapsayici.className = "nr-aktarim-alani";

    const baslik = document.createElement("div");
    baslik.className = "nr-aktarim-baslik";
    baslik.textContent = `Şube Norm Kadro Raporu · ${dayjs().format("DD.MM.YYYY")}`;
    kapsayici.appendChild(baslik);

    if (ozet) {
      const ozetKopya = ozet.cloneNode(true) as HTMLElement;

      /* Üstteki özet kutuları da flex kullanıyor; aynı düzeltme onlara
         da uygulanır ki sayılar aktarımda kaybolmasın. */
      /* Aynı koşulsuz düzeltme özet kartlarına da uygulanır. */
      ozetKopya.querySelectorAll<HTMLElement>("*").forEach((el) => {
        el.style.setProperty("gap", "0", "important");
      });

      kapsayici.appendChild(ozetKopya);
    }

    const tabloKopya = tablo.cloneNode(true) as HTMLElement;

    /* Rozetlerin içindeki kutucuklar aktarımda boş çıkıyordu.
       Sebep: rozetler "inline-flex" + "gap" ile diziliyor ve görsel
       motoru bu ikisini birlikte çizemiyor — doğrudan yazılmış metin
       görünüyor ama iç içe geçmiş elemanlar kayboluyor.

       Yapı bozulmadan çözülür: kopyada dizilim "inline-block"a
       çevrilir, "gap" yerine kenar boşluğu verilir. Görünüm ekrandakiyle
       aynı kalır. */
    const govdeler = tabloKopya.querySelectorAll<HTMLElement>(
      ".nr-eksik, .nr-fazla, .nr-alinan, .nr-engelli, .nr-raporlu, .ant-space, .ant-space-item"
    );

    /* Düzeltme koşulsuz uygulanır. Önceki sürüm getComputedStyle ile
       "flex mi" diye bakıyordu, ama kopya henüz sayfaya eklenmemiş
       olduğu için o çağrı boş değer döndürüyor ve koşul hiç
       tutmuyordu — rozetler bu yüzden hâlâ boş çıkıyordu. */
    govdeler.forEach((el) => {
      if (el.classList.contains("ant-space")) {
        el.style.setProperty("display", "block", "important");
        el.style.setProperty("gap", "0", "important");
        return;
      }

      if (el.classList.contains("ant-space-item")) {
        el.style.setProperty("display", "inline-block", "important");
        el.style.setProperty("margin-right", "5px", "important");
        el.style.setProperty("margin-bottom", "3px", "important");
        return;
      }

      /* Rozetin kendisi: flex yerine satır içi blok */
      el.style.setProperty("display", "inline-block", "important");
      el.style.setProperty("gap", "0", "important");
    });

    /* Rozet içindeki elemanlar: gap kalktığı için boşluk elle verilir.
       Gün etiketleri de buraya dahildir — eksikte Ant Design Tag,
       fazlada .nr-gun olarak farklı yazılmışlar ama ikisi de rozetin
       doğrudan çocuğu. */
    tabloKopya
      .querySelectorAll<HTMLElement>(
        ".nr-eksik > *, .nr-fazla > *, .nr-engelli > *, .nr-raporlu > *, .nr-alinan > *"
      )
      .forEach((el) => {
        el.style.setProperty("display", "inline-block", "important");
        el.style.setProperty("margin-left", "4px", "important");
        el.style.setProperty("vertical-align", "middle", "important");
      });

    /* Ant Design etiketleri kendi içlerinde de flex kullanabiliyor;
       tablodaki tüm etiketler satır içi bloğa çevrilir. */
    tabloKopya.querySelectorAll<HTMLElement>(".ant-tag").forEach((el) => {
      el.style.setProperty("display", "inline-block", "important");
      el.style.setProperty("gap", "0", "important");
      el.style.setProperty("vertical-align", "middle", "important");
    });

    kapsayici.appendChild(tabloKopya);

    // Ekranın dışında, gerçek genişlikte oluşturulur
    kapsayici.style.position = "fixed";
    kapsayici.style.left = "-10000px";
    kapsayici.style.top = "0";
    /* Aktarım genişliği sabit tutulur: tablonun kaydırma genişliği
       kullanıldığında görsel çok geniş çıkıp okunmaz hâle geliyordu.
       Sütunlar bu genişliğe göre daralır, uzun adlar alt satıra sarar. */
    kapsayici.style.width = "1560px";
    kapsayici.style.background = "#ffffff";
    kapsayici.style.padding = "16px";

    document.body.appendChild(kapsayici);
    return kapsayici;
  };

  const alaniKaldir = (alan: HTMLElement | null) => {
    if (alan && alan.parentNode) alan.parentNode.removeChild(alan);
  };

  const pdfIndir = async () => {
    setAktariliyor("pdf");
    const alan = alanHazirla();

    try {
      if (alan) await pdfOlarakIndir(alan, `norm_kadro_${tarihDamgasi()}`);
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
      if (alan) await gorselOlarakIndir(alan, `norm_kadro_${tarihDamgasi()}`);
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
      .getElementById("nr-yazdirilacak")
      ?.querySelector("table");

    if (!tablo) {
      message.info("Aktarılacak tablo bulunamadı.");
      return;
    }

    setAktariliyor("excel");
    try {
      excelOlarakIndir(
        tablo as HTMLElement,
        `norm_kadro_${tarihDamgasi()}`,
        `Şube Norm Kadro Raporu · ${dayjs().format("DD.MM.YYYY")}`
      );
    } catch (hata: any) {
      message.error("Excel oluşturulamadı: " + hata.message);
    } finally {
      setAktariliyor("");
    }
  };

  /* ------------------------------------------------------------------ ekran */

  return (
    <>
      {/* --------------------------------------------------------- özetler */}
      <div id="nr-ozetler">
      <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={3}>
          <div className="rp-norm-kutu">
            <span>Norm</span>
            <b>{sayi(veri.toplamNorm)}</b>
          </div>
        </Col>
        <Col xs={12} md={3}>
          <div className="rp-norm-kutu">
            <span>Mevcut</span>
            <b>{sayi(veri.toplamMevcut)}</b>
          </div>
        </Col>
        <Col xs={12} md={3}>
          <div className="rp-norm-kutu rp-norm-ihtiyac">
            <span>Eksik</span>
            <b>{sayi(veri.toplamEksik)}</b>
          </div>
        </Col>
        <Col xs={12} md={3}>
          <div className="rp-norm-kutu nr-fazla-kutu">
            <span>Norm Dışı Fazla</span>
            <b>{sayi(veri.toplamFazla)}</b>
          </div>
        </Col>
        <Col xs={12} md={3}>
          <div className="rp-norm-kutu nr-engelli-kutu">
            <span>Engelli</span>
            <b>{sayi(veri.toplamEngelli)}</b>
          </div>
        </Col>
        <Col xs={12} md={3}>
          <Tooltip title="Rapor gününde sağlık raporlu çalışan. Mevcut sayısına dahildir.">
            <div className="rp-norm-kutu nr-raporlu-kutu">
              <span>
                Raporlu ·{" "}
                {gun.isSame(dayjs(), "day") ? "bugün" : gun.format("DD.MM")}
              </span>
              <b>{veri.toplamRaporlu ?? 0}</b>
            </div>
          </Tooltip>
        </Col>
        <Col xs={12} md={3}>
          <div className="rp-norm-kutu nr-alinan-kutu">
            <span>
              Alındı ·{" "}
              {gun.isSame(dayjs(), "day") ? "bugün" : gun.format("DD.MM")}
            </span>
            <b>{veri.toplamAlinan}</b>
          </div>
        </Col>
        <Col xs={12} md={3}>
          <div className="rp-norm-kutu nr-evrak-kutu">
            <span>Evrak Tamamlıyor</span>
            <b>{veri.toplamEvrak}</b>
          </div>
        </Col>
        <Col xs={12} md={3}>
          <div className="rp-norm-kutu nr-rotasyon-kutu">
            <span>Rotasyon</span>
            <b>{veri.toplamRotasyon}</b>
          </div>
        </Col>

        {/* Toplam sunucudan gelmiyor, satırlardan toplanıyor: bölge ve şube
            süzmesi uygulandığında ekrandaki satırlarla tutarlı kalsın. */}
        <Col xs={12} md={3}>
          <Tooltip title="Listeyi görmek için tıklayınız">
            <div
              className="rp-norm-kutu nr-ayrilacak-kutu nr-tiklanir"
              role="button"
              tabIndex={0}
              onClick={() => setAyrilacakAcik(true)}
              onKeyDown={(e) => e.key === "Enter" && setAyrilacakAcik(true)}
            >
              <span>Ayrılacak</span>
              <b>{ayrilacakToplam}</b>
            </div>
          </Tooltip>
        </Col>
      </Row>
      </div>

      {/* --------------------------------------------------------- filtreler */}
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }} align="middle">
        <Col xs={24} md={5}>
          <Segmented
            block
            value={gorunum}
            onChange={(v) => setGorunum(v as "liste" | "tablo")}
            options={[
              { label: "Şube Listesi", value: "liste" },
              { label: "Norm Tablosu", value: "tablo" },
            ]}
          />
        </Col>

        <Col xs={12} md={4}>
          <DatePicker
            value={gun}
            format="DD.MM.YYYY"
            allowClear={false}
            style={{ width: "100%" }}
            /* İleri tarih seçilemez */
            disabledDate={(d) => !!d && d > dayjs().endOf("day")}
            onChange={(d) => d && setGun(d)}
          />
        </Col>

        <Col xs={12} md={4}>
          <Input
            allowClear
            placeholder="Şube ara"
            prefix={<Search size={15} strokeWidth={2} color="#9AA3AF" />}
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />
        </Col>

        <Col xs={12} md={4}>
          <Select
            allowClear
            showSearch
            placeholder="Bölge"
            style={{ width: "100%" }}
            value={bolgeFiltre}
            onChange={setBolgeFiltre}
            options={bolgeler.map((b) => ({ value: b, label: b }))}
          />
        </Col>

        <Col xs={24} md={4}>
          {/* Açık olan düğmeye yeniden basmak tümünü geri getiriyor;
              ayrı bir "Tümünü göster" düğmesi yer kaplıyordu. */}
          <Space.Compact block>
            <Button
              style={{ width: "50%" }}
              type={suzgec === "eksik" ? "primary" : "default"}
              danger={suzgec === "eksik"}
              onClick={() => setSuzgec(suzgec === "eksik" ? "" : "eksik")}
              title="Yalnızca eksiği olan şubeler"
            >
              Eksikler
            </Button>

            <Button
              style={{ width: "50%" }}
              type={suzgec === "fazla" ? "primary" : "default"}
              onClick={() => setSuzgec(suzgec === "fazla" ? "" : "fazla")}
              title="Yalnızca fazlası olan şubeler"
            >
              Fazlalar
            </Button>
          </Space.Compact>
        </Col>

        <Col xs={24} md={5}>
          <Space.Compact block>
            <Button
              loading={aktariliyor === "excel"}
              icon={<FileSpreadsheet size={15} strokeWidth={2} />}
              onClick={excelIndir}
              title="Renkleriyle birlikte Excel dosyası indir"
            >
              Excel
            </Button>
            <Button
              loading={aktariliyor === "pdf"}
              icon={<FileDown size={15} strokeWidth={2} />}
              onClick={pdfIndir}
              title="PDF olarak indir"
            >
              PDF
            </Button>
            <Button
              loading={aktariliyor === "gorsel"}
              icon={<ImageDown size={15} strokeWidth={2} />}
              onClick={gorselIndir}
              title="Görsel (PNG) olarak indir"
            >
              Görsel
            </Button>
            <Button
              icon={<Download size={15} strokeWidth={2} />}
              onClick={disaAktar}
              title="Ham veriyi CSV olarak indir"
            />
          </Space.Compact>
        </Col>

        <Col xs={12} md={2}>
          <Space>
            <Button
              loading={yukleniyor}
              icon={<RefreshCw size={15} strokeWidth={2} />}
              onClick={getir}
            />
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {satirlar.length} şube
            </Text>
          </Space>
        </Col>
      </Row>

      {/* ------------------------------------------------------ senkron uyarısı */}
      {veri.mikroSenkron?.hata && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 14 }}
          message="Personel listesine ulaşılamadı"
          description={`${veri.mikroSenkron.hata} "Mevcut" sütunu son bilinen değerleri gösteriyor, elle düzeltilemez.`}
        />
      )}

      {!veri.mikroSenkron?.hata &&
        (veri.mikroSenkron?.eslesemeyen?.length ?? 0) > 0 && (
          <Alert
            type="warning"
            showIcon
            closable
            style={{ marginBottom: 14 }}
            message={
              `Personel listesindeki ${veri.mikroSenkron!.toplamAktif} aktif personelin ` +
              `${veri.mikroSenkron!.sayilan} tanesi norm kadroya yazıldı; ` +
              `${veri.mikroSenkron!.toplamAktif - veri.mikroSenkron!.sayilan} kişiye kadroda yer bulunamadı`
            }
            description={
              <details>
                <summary style={{ cursor: "pointer" }}>
                  Sayılamayan personelin dökümü için tıklayın
                </summary>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {veri.mikroSenkron!.eslesemeyen.map((satir, i) => (
                    <li key={i} style={{ fontSize: 12.5 }}>
                      {satir}
                    </li>
                  ))}
                </ul>
              </details>
            }
          />
        )}

      {/* ------------------------------------------------------------- içerik */}
      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : satirlar.length === 0 ? (
        <Empty description="Gösterilecek şube bulunamadı." />
      ) : veri.toplamNorm === 0 && veri.toplamMevcut === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Henüz norm kadro verisi girilmemiş"
          description={
            <span>
              Kadro Düzenleme sekmesindeki <b>"Excel görünümünde gir"</b>
              düğmesiyle şube ve pozisyon bazında norm ve mevcut personel
              sayılarını giriniz. Veriler kaydedildikten sonra bu rapor otomatik
              dolar.
            </span>
          }
        />
      ) : gorunum === "liste" ? (
        <div id="nr-yazdirilacak">
        <div className="nr-pivot-baslik">
          Şube Norm Kadro Raporu
          <span>
            {dayjs().format("DD.MM.YYYY")} · {satirlar.length} birim
          </span>
        </div>
        <Tablo<SubeRaporu>
          rowKey="subeKodu"
          size="small"
          columns={listeSutunlari}
          dataSource={satirlar}
          pagination={false}
          scroll={{ x: 1500 }}
          rowClassName={(k) =>
            k.eksikler.length > 0
              ? "nr-satir-eksik"
              : k.fazlalar.length > 0
              ? "nr-satir-fazla"
              : ""
          }
        />
        </div>
      ) : darEkran ? (
        /* Dar ekranda sütunlu tablo okunmaz; şube kartlarına dönülür */
        <div className="nr-kartlar">
          {satirlar.map((x) => (
            <div className="nr-kart" key={x.subeKodu}>
              <div className="nr-kart-ust">
                <b>{x.subeAdi}</b>
                <span>{x.bolge}</span>
              </div>

              <div className="nr-kart-sayilar">
                <div>
                  <span>Norm</span>
                  <b>{sayi(x.norm)}</b>
                </div>
                <div>
                  <span>Mevcut</span>
                  <b>{sayi(x.mevcut)}</b>
                </div>
                <div>
                  <span>Fark</span>
                  <b style={{ color: x.fark < 0 ? "#cf1322" : "#389e0d" }}>
                    {x.fark > 0 ? `+${sayi(x.fark)}` : sayi(x.fark)}
                  </b>
                </div>
                <div>
                  <span>Engelli</span>
                  <b>{x.engelliCalisan ? sayi(x.engelliCalisan) : "—"}</b>
                </div>
              </div>

              {(x.raporlu ?? 0) > 0 && (
                <div className="nr-kart-detay">
                  <span>Raporlu</span>
                  <Space size={4} wrap>
                    {(x.raporlular ?? []).map((r) => (
                      <span key={r} className="nr-raporlu">
                        {r}
                      </span>
                    ))}
                  </Space>
                </div>
              )}

              {x.eksikler.length > 0 && (
                <div className="nr-kart-detay">
                  <span>Eksik</span>
                  <Space size={4} wrap>
                    {x.eksikler.map((e) => (
                      <span key={e.bolum} className="nr-eksik">
                        <span className="nr-eksik-ad">{e.bolum}</span>
                        <span className="nr-eksik-adet">{sayi(e.adet)}</span>
                      </span>
                    ))}
                  </Space>
                </div>
              )}

              {x.fazlalar.length > 0 && (
                <div className="nr-kart-detay">
                  <span>Fazla</span>
                  <Space size={4} wrap>
                    {x.fazlalar.map((f) => (
                      <span key={f.bolum} className="nr-fazla">
                        {f.bolum} <b>+{sayi(f.adet)}</b>
                      </span>
                    ))}
                  </Space>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Tüm şubeler ekrana sığsın diye sabit yerleşimli tablo kullanılır */
        <div className="nr-pivot-alan" id="nr-yazdirilacak">
          <div className="nr-pivot-baslik">
            Şube Norm Kadro Tablosu
            <span>
              {dayjs().format("DD.MM.YYYY")} · {satirlar.length} birim
            </span>
          </div>

          <table className="nr-pivot">
            <thead>
              <tr>
                <th className="nr-pivot-kose" />
                {satirlar.map((x) => (
                  <th key={x.subeKodu}>
                    <div className="nr-pivot-dikey">{x.subeAdi}</div>
                  </th>
                ))}
                <th className="nr-pivot-toplam-baslik">
                  <div className="nr-pivot-dikey">Genel Toplam</div>
                </th>
              </tr>
            </thead>

            <tbody>
              <tr className="nr-satir-norm">
                <th>G.M. ONAYLI NORM</th>
                {satirlar.map((x) => (
                  <td key={x.subeKodu}>{x.norm ? sayi(x.norm) : ""}</td>
                ))}
                <td className="nr-pivot-toplam">{sayi(veri.toplamNorm)}</td>
              </tr>

              <tr className="nr-satir-mevcut">
                <th>MEVCUT DURUM</th>
                {satirlar.map((x) => (
                  <td key={x.subeKodu}>{x.mevcut ? sayi(x.mevcut) : ""}</td>
                ))}
                <td className="nr-pivot-toplam">{sayi(veri.toplamMevcut)}</td>
              </tr>

              <tr className="nr-satir-fark">
                <th>FARK</th>
                {satirlar.map((x) => (
                  <td key={x.subeKodu}>
                    {x.norm || x.mevcut ? sayi(x.fark) : ""}
                  </td>
                ))}
                <td className="nr-pivot-toplam">{sayi(veri.toplamFark)}</td>
              </tr>

              <tr className="nr-satir-engelli">
                <th>ENGELLİ ÇALIŞAN</th>
                {satirlar.map((x) => (
                  <td key={x.subeKodu}>
                    {x.engelliCalisan ? sayi(x.engelliCalisan) : ""}
                  </td>
                ))}
                <td className="nr-pivot-toplam">{sayi(veri.toplamEngelli)}</td>
              </tr>

              {/* Raporlu: mevcuda dahil, bilgi amaçlı (engelli gibi) */}
              <tr className="nr-satir-raporlu">
                <th title="Rapor gününde sağlık raporlu çalışan; mevcuda dahil">RAPORLU</th>
                {satirlar.map((x) => (
                  <td key={x.subeKodu} title={(x.raporlular ?? []).join("\n")}>
                    {x.raporlu ? x.raporlu : ""}
                  </td>
                ))}
                <td className="nr-pivot-toplam">{veri.toplamRaporlu ?? 0}</td>
              </tr>

              <tr className="nr-satir-detay nr-satir-eksik-detay">
                <th>EKSİK PERSONEL</th>
                {satirlar.map((x) => (
                  <td key={x.subeKodu} title={x.eksikler.map((e) => e.bolum).join(", ")}>
                    {x.eksikler.map((e) => e.bolum).join(", ")}
                  </td>
                ))}
                <td className="nr-pivot-toplam">{sayi(veri.toplamEksik)}</td>
              </tr>

              <tr className="nr-satir-detay nr-satir-fazla-detay">
                <th>FAZLA PERSONEL</th>
                {satirlar.map((x) => (
                  <td key={x.subeKodu} title={x.fazlalar.map((f) => f.bolum).join(", ")}>
                    {x.fazlalar.map((f) => f.bolum).join(", ")}
                  </td>
                ))}
                <td className="nr-pivot-toplam">{sayi(veri.toplamFazla)}</td>
              </tr>

              {/* Çıkışı planlanmış personel. Mevcut satırına hâlâ dahiller —
                  çıkış gününe kadar çalışıyorlar — ama hangi şubenin kimi,
                  ne zaman kaybedeceği tabloda görünmeliydi: norm tutuyor
                  görünen bir şube iki hafta sonra eksiğe düşebiliyor. */}
              <tr className="nr-satir-detay nr-satir-ayrilacak-detay">
                <th>AYRILACAK PERSONEL</th>
                {satirlar.map((x) => (
                  <td
                    key={x.subeKodu}
                    title={(x.ayrilacaklar ?? []).join("\n")}
                  >
                    {(x.ayrilacaklar ?? [])
                      .map((a) => {
                        /* Sütunlar dar; tabloda ad ve tarih yetiyor,
                           ünvanın tamamı ipucunda duruyor. */
                        const [ad = a, tarih = ""] = a.split(" · ");

                        return tarih ? `${ad} (${tarih})` : ad;
                      })
                      .join(", ")}
                  </td>
                ))}
                <td className="nr-pivot-toplam">
                  {satirlar.reduce((t, x) => t + (x.ayrilacak ?? 0), 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------------ renk anahtarı */}
      <div className="nr-anahtar">
        <span>
          <i style={{ background: "#fff1f0", borderColor: "#ffa39e" }} /> Eksik
        </span>
        <span>
          <i style={{ background: "#e6f4ff", borderColor: "#91caff" }} /> Evrak
          tamamlıyor
        </span>
        <span>
          <i style={{ background: "#f6ffed", borderColor: "#b7eb8f" }} /> Alındı
        </span>
        <span>
          <i style={{ background: "#fffbe6", borderColor: "#ffe58f" }} /> Rotasyon
        </span>
        <span>
          <i style={{ background: "#f5f5f5", borderColor: "#d9d9d9" }} /> Norm dışı
          fazla
        </span>
        <span>
          <i style={{ background: "#fff7e6", borderColor: "#ffd591" }} /> Engelli
        </span>
        <span>
          <i style={{ background: "#fbeaf5", borderColor: "#f1c4e2" }} /> Raporlu
          (mevcuda dahil)
        </span>
      </div>

      <Modal
        open={ayrilacakAcik}
        onCancel={() => setAyrilacakAcik(false)}
        footer={null}
        width={620}
        title={
          <Space size={8}>
            <span>Ayrılacak personel</span>
            <Tag color="volcano">{ayrilacakToplam}</Tag>
          </Space>
        }
      >
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Çıkış tarihi ileri bir güne yazılmış personel. Çıkış gününe kadar
          çalışmaya devam ediyor ve mevcut sayısına dahiller; yerlerine alım
          bu listeye bakılarak planlanır.
        </Text>

        {/* Tablo yerine kart listesi: dört sütun dar pencerede yatay kaydırma
            çubuğu çıkarıyor, ünvan da kesiliyordu. Kartta her bilgi kendi
            satırında duruyor ve en yakın çıkış en üstte. */}
        <div className="nr-ayrilacak-liste">
          {ayrilacakListesi.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Çıkışı planlanmış personel yok."
            />
          ) : (
            ayrilacakListesi.map((k) => (
              <div className="nr-ayrilacak-kart" key={`${k.sube}-${k.ad}-${k.tarih}`}>
                <div
                  className={`nr-ayrilacak-gun${
                    k.kalan <= 1 ? " nr-ayrilacak-acil" : ""
                  }`}
                >
                  <b>{k.kalan <= 0 ? "•" : k.kalan}</b>
                  <span>
                    {k.kalan <= 0 ? "bugün" : k.kalan === 1 ? "gün" : "gün"}
                  </span>
                </div>

                <div className="nr-ayrilacak-bilgi">
                  <div className="nr-ayrilacak-ad">{k.ad}</div>

                  <div className="nr-ayrilacak-alt">
                    {k.unvan}
                    {k.sube ? ` · ${k.sube}` : ""}
                  </div>
                </div>

                <div className="nr-ayrilacak-tarih">
                  <span>Çıkış</span>
                  <b>{k.tarih}</b>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
