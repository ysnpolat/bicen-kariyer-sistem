/**
 * ---------------------------------------------------------------------------
 * Norm Kadro İçeri Aktarma
 * ---------------------------------------------------------------------------
 * Excel'den kopyalanan listeyi tek seferde sisteme aktarır.
 *
 * İki liste biçimi desteklenir:
 *
 *   1. Kişi listesi   → her satır bir personel (Departman kodu | Mesleği)
 *                       Satırlar sayılarak birim/pozisyon adetleri bulunur.
 *   2. Özet liste     → Departman kodu | Meslek | Adet
 *
 * Departman ve meslek adları sistemdeki birim ve pozisyonlarla eşleştirilir;
 * eşleşmeyenler için ekranda elle seçim yapılabilir.
 * ---------------------------------------------------------------------------
 */

import { useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Col,
  Drawer,
  Empty,
  Input,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { ArrowRight, FileUp, Save, X } from "lucide-react";

import Tablo from "./Tablo";
import { api } from "./api";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface Birim {
  kod: string;
  ad: string;
  tur?: string;
}

interface Kadro {
  bolum: string;
  subeKodu: string | null;
  subeAdi?: string;
  norm: number;
  mevcut: number;
  engelli: number;
  aciklama?: string;
}

interface Satir {
  /** Listede yazan departman */
  departman: string;
  /** Listede yazan meslek */
  meslek: string;
  adet: number;
  /** Eşleştirilen birim kodu */
  subeKodu: string | null;
  /** Eşleştirilen pozisyon adı */
  bolum: string | null;
}

/** Ondalıklı sayıyı Türkçe biçimde yazar */
const sayiMetni = (deger: number): string =>
  Number.isInteger(deger) ? String(deger) : deger.toFixed(1).replace(".", ",");

/** Türkçe karşılaştırma için sadeleştirir */
const sadelestir = (metin: string): string =>
  (metin ?? "")
    .toLocaleUpperCase("tr")
    .replace(/\u0130/g, "I")
    .replace(/[^A-Z0-9ÇĞÖŞÜ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Sefaköy Şubesi" ile "SEFAKÖY" eşleşsin diye ekleri atar */
const birimAnahtari = (metin: string): string =>
  sadelestir(metin)
    .replace(/\b(SUBESI|ŞUBESI|SUBE|ŞUBE|MAGAZASI|MAĞAZASI)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Meslek adındaki çalışma biçimi eklerini ayıklar */
const meslekAnahtari = (metin: string): string =>
  sadelestir(metin)
    .replace(/\b(PART|TAM|ZAMANLI|VKL|VEKIL|VEKALET|GECICI)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export default function IceriAktar({
  acik,
  kapat,
  kadrolar,
  birimler,
  birimTurleri,
  kaydedildi,
}: {
  acik: boolean;
  kapat: () => void;
  kadrolar: Kadro[];
  birimler: Birim[];
  birimTurleri: { ad: string; bolumler: string[] }[];
  kaydedildi: () => void;
}) {
  const { message } = AntdApp.useApp();

  const [metin, setMetin] = useState("");
  const [bicim, setBicim] = useState<"kisi" | "ozet">("kisi");
  const [hedef, setHedef] = useState<"mevcut" | "norm">("mevcut");
  const [sifirla, setSifirla] = useState(true);
  const [yukleniyor, setYukleniyor] = useState(false);

  /** Elle yapılan eşleştirmeler: "departman" veya "meslek" → sistem karşılığı */
  const [birimEsleme, setBirimEsleme] = useState<Record<string, string>>({});
  const [bolumEsleme, setBolumEsleme] = useState<Record<string, string>>({});

  /* Tüm pozisyonlar (tür ayrımı olmadan) */
  const tumBolumler = useMemo(
    () =>
      Array.from(
        new Set(birimTurleri.flatMap((t) => t.bolumler ?? []))
      ).sort((a, b) => a.localeCompare(b, "tr")),
    [birimTurleri]
  );

  /* ------------------------------------------------------------ çözümleme */

  /**
   * Metni çözümler.
   *
   * Aynı birim ve meslekteki satırlar tek kayıtta toplanır; bu yüzden
   * sonuçtaki satır sayısı, yapıştırılan satır sayısından az olur.
   * Kaybı fark edebilmek için okunan ve atlanan satırlar ayrıca sayılır.
   */
  const cozum = useMemo(() => {
    const harita = new Map<string, Satir>();
    const atlananlar: string[] = [];
    let okunan = 0;
    let toplamKisi = 0;

    if (!metin.trim()) {
      return { liste: [] as Satir[], okunan, atlananlar, toplamKisi };
    }

    const hamSatirlar = metin.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

    hamSatirlar.forEach((ham, sira) => {
      /* Excel'den kopyalanan veri sekmeyle ayrılır. Sekme yoksa noktalı
         virgül, o da yoksa virgül veya çoklu boşluk denenir. */
      const ayirici = ham.includes("\t")
        ? /\t/
        : ham.includes(";")
        ? /;/
        : ham.includes(",")
        ? /,/
        : /\s{2,}/;

      const parcalar = ham.split(ayirici).map((x) => x.trim()).filter(Boolean);

      if (parcalar.length < 2) {
        atlananlar.push(ham);
        return;
      }

      // Başlık satırı atlanır
      if (
        sira === 0 &&
        /DEPARTMAN|BIRIM|BİRİM|SUBE|ŞUBE/i.test(parcalar[0]) &&
        /MESLEK|POZ|UNVAN|ÜNVAN/i.test(parcalar[1])
      ) {
        return;
      }

      const departman = parcalar[0];
      const meslek = parcalar[1];

      const adet =
        bicim === "ozet" && parcalar[2]
          ? Number(parcalar[2].replace(",", ".")) || 0
          : 1;

      okunan++;
      toplamKisi += adet;

      const anahtar = `${sadelestir(departman)}|${sadelestir(meslek)}`;

      if (harita.has(anahtar)) {
        harita.get(anahtar)!.adet += adet;
      } else {
        harita.set(anahtar, { departman, meslek, adet, subeKodu: null, bolum: null });
      }
    });

    /* Eşleştirme */
    const liste = Array.from(harita.values()).map((s) => {
      const dAnahtar = birimAnahtari(s.departman);

      const birim =
        birimler.find((b) => sadelestir(b.kod) === sadelestir(s.departman)) ??
        birimler.find((b) => birimAnahtari(b.ad) === dAnahtar) ??
        birimler.find(
          (b) => dAnahtar.length > 2 && birimAnahtari(b.ad).startsWith(dAnahtar)
        );

      const mAnahtar = meslekAnahtari(s.meslek);

      const bolum =
        tumBolumler.find((b) => sadelestir(b) === sadelestir(s.meslek)) ??
        tumBolumler.find((b) => meslekAnahtari(b) === mAnahtar);

      return {
        ...s,
        subeKodu: birimEsleme[s.departman] ?? birim?.kod ?? null,
        bolum: bolumEsleme[s.meslek] ?? bolum ?? null,
      };
    });

    return { liste, okunan, atlananlar, toplamKisi };
  }, [metin, bicim, birimler, tumBolumler, birimEsleme, bolumEsleme]);

  const satirlar = cozum.liste;

  const eslesen = satirlar.filter((x) => x.subeKodu && x.bolum);
  const eksikBirimler = Array.from(
    new Set(satirlar.filter((x) => !x.subeKodu).map((x) => x.departman))
  );
  const eksikMeslekler = Array.from(
    new Set(satirlar.filter((x) => x.subeKodu && !x.bolum).map((x) => x.meslek))
  );

  /* --------------------------------------------------------------- kaydet */

  const kaydet = async () => {
    if (eslesen.length === 0) {
      message.warning("Aktarılacak eşleşmiş satır yok.");
      return;
    }

    setYukleniyor(true);
    try {
      /* Aynı birim ve pozisyon için toplamlar birleştirilir */
      const toplam = new Map<string, number>();
      eslesen.forEach((s) => {
        const anahtar = `${s.subeKodu}|${s.bolum}`;
        toplam.set(anahtar, (toplam.get(anahtar) ?? 0) + s.adet);
      });

      const gonderilecek: Kadro[] = [];
      const dokunulan = new Set<string>();

      toplam.forEach((adet, anahtar) => {
        const [subeKodu, bolum] = anahtar.split("|");
        const birim = birimler.find((b) => b.kod === subeKodu);

        const eski = kadrolar.find(
          (k) => k.bolum === bolum && (k.subeKodu ?? "") === subeKodu
        );

        dokunulan.add(anahtar);

        gonderilecek.push({
          bolum,
          subeKodu,
          subeAdi: birim?.ad ?? subeKodu,
          norm: hedef === "norm" ? adet : eski?.norm ?? 0,
          mevcut: hedef === "mevcut" ? adet : eski?.mevcut ?? 0,
          engelli: eski?.engelli ?? 0,
          aciklama: eski?.aciklama ?? "",
        });
      });

      /* İstenirse listede olmayan kayıtların ilgili alanı sıfırlanır */
      if (sifirla) {
        const listedekiBirimler = new Set(eslesen.map((x) => x.subeKodu));

        kadrolar
          .filter((k) => k.subeKodu && listedekiBirimler.has(k.subeKodu))
          .filter((k) => !dokunulan.has(`${k.subeKodu}|${k.bolum}`))
          .forEach((k) => {
            gonderilecek.push({
              bolum: k.bolum,
              subeKodu: k.subeKodu,
              subeAdi: k.subeAdi,
              norm: hedef === "norm" ? 0 : k.norm,
              mevcut: hedef === "mevcut" ? 0 : k.mevcut,
              engelli: k.engelli,
              aciklama: k.aciklama ?? "",
            });
          });
      }

      await api.gonder("/api/Havuz/KadroToplu", gonderilecek);

      message.success(
        `${toplam.size} birim/pozisyon kaydedildi · ` +
          `${sayiMetni(eslesen.reduce((t, x) => t + x.adet, 0))} kişi.`
      );

      setMetin("");
      setBirimEsleme({});
      setBolumEsleme({});
      kaydedildi();
      kapat();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <Drawer
      open={acik}
      onClose={kapat}
      width="min(1080px, 96vw)"
      className="rp-cekmece"
      title={
        <Space size={10} wrap>
          <FileUp size={17} strokeWidth={2} />
          <Text strong>Excel'den İçeri Aktar</Text>
          {satirlar.length > 0 && (
            <>
              <Tag color="blue">{cozum.okunan} satır</Tag>
              <Tag color="blue">{sayiMetni(cozum.toplamKisi)} kişi</Tag>
              <Tag color={eslesen.length === satirlar.length ? "green" : "orange"}>
                {eslesen.length} / {satirlar.length} kayıt eşleşti
              </Tag>
            </>
          )}
        </Space>
      }
      footer={
        <Space style={{ float: "right" }}>
          <Button icon={<X size={15} strokeWidth={2} />} onClick={kapat}>
            Kapat
          </Button>
          <Button
            type="primary"
            loading={yukleniyor}
            disabled={eslesen.length === 0}
            icon={<Save size={15} strokeWidth={2} />}
            onClick={kaydet}
          >
            Aktar ({eslesen.length} satır)
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="Excel'deki iki sütunu kopyalayıp aşağıya yapıştırınız"
        description={
          <span>
            Departman kodu ve meslek sütunlarını birlikte seçip kopyalamanız
            yeterlidir. Başlık satırı varsa otomatik atlanır. Kişi listesinde
            her satır bir personel sayılır; aynı birim ve meslekteki satırlar
            toplanarak sayıya dönüştürülür.
          </span>
        }
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Liste biçimi
          </Text>
          <Radio.Group
            value={bicim}
            onChange={(e) => setBicim(e.target.value)}
            style={{ display: "block", marginTop: 4 }}
          >
            <Radio value="kisi">Kişi listesi (her satır bir personel)</Radio>
            <Radio value="ozet">Özet liste (birim | meslek | adet)</Radio>
          </Radio.Group>
        </Col>

        <Col xs={24} md={8}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Hangi alana yazılsın
          </Text>
          <Radio.Group
            value={hedef}
            onChange={(e) => setHedef(e.target.value)}
            style={{ display: "block", marginTop: 4 }}
          >
            <Radio value="mevcut">Mevcut personel</Radio>
            <Radio value="norm">Norm kadro</Radio>
          </Radio.Group>
        </Col>

        <Col xs={24} md={8}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Seçenek
          </Text>
          <div style={{ marginTop: 8 }}>
            <Checkbox
              checked={sifirla}
              onChange={(e) => setSifirla(e.target.checked)}
            >
              Listede olmayan pozisyonları sıfırla
            </Checkbox>
            <Paragraph type="secondary" style={{ fontSize: 11.5, marginTop: 4 }}>
              Yalnızca listede geçen birimler için geçerlidir.
            </Paragraph>
          </div>
        </Col>
      </Row>

      <TextArea
        rows={7}
        value={metin}
        onChange={(e) => setMetin(e.target.value)}
        placeholder={
          bicim === "kisi"
            ? "ADAKENT\tMAĞAZA MÜDÜRÜ\nADAKENT\tKASİYER\nADAKENT\tKASİYER\n..."
            : "ADAKENT\tKASİYER\t8\nADAKENT\tMANAV\t3\n..."
        }
        style={{ fontFamily: "monospace", fontSize: 12.5 }}
      />

      {/* ------------------------------------------------------- sayaçlar */}
      {satirlar.length > 0 && (
        <Alert
          type={cozum.atlananlar.length > 0 ? "warning" : "success"}
          showIcon
          style={{ marginTop: 12 }}
          message={
            <span>
              <b>{cozum.okunan}</b> satır okundu ·{" "}
              <b>{sayiMetni(cozum.toplamKisi)}</b> kişi ·{" "}
              <b>{satirlar.length}</b> birim/pozisyon kaydına dönüştürüldü
              {cozum.atlananlar.length > 0 && (
                <>
                  {" "}
                  · <b>{cozum.atlananlar.length}</b> satır atlandı
                </>
              )}
            </span>
          }
          description={
            <div style={{ fontSize: 12.5 }}>
              Aynı birim ve meslekteki satırlar tek kayıtta toplanır; bu yüzden
              kayıt sayısı satır sayısından az olur. Kişi toplamı listenizdeki
              satır sayısıyla aynı olmalıdır.
              {cozum.atlananlar.length > 0 && (
                <div className="ia-atlanan">
                  <b>Atlanan satırlar (ilk 10):</b>
                  {cozum.atlananlar.slice(0, 10).map((x, i) => (
                    <div key={i}>{x}</div>
                  ))}
                  <div style={{ marginTop: 4 }}>
                    Bu satırlarda iki sütun ayırt edilemedi. Sütunların sekme
                    veya noktalı virgülle ayrıldığından emin olunuz.
                  </div>
                </div>
              )}
            </div>
          }
        />
      )}

      {/* --------------------------------------------- eşleşmeyen birimler */}
      {eksikBirimler.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 14 }}
          message={`${eksikBirimler.length} departman eşleştirilemedi`}
          description={
            <div className="ia-esleme">
              {eksikBirimler.map((d) => (
                <div className="ia-esleme-satir" key={d}>
                  <Text strong style={{ fontSize: 13 }}>
                    {d}
                  </Text>
                  <ArrowRight size={14} strokeWidth={2} />
                  <Select
                    size="small"
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    placeholder="Birim seçiniz"
                    style={{ minWidth: 240 }}
                    value={birimEsleme[d]}
                    onChange={(v) =>
                      setBirimEsleme({ ...birimEsleme, [d]: v })
                    }
                    options={birimler
                      .filter((b) => b.kod)
                      .map((b) => ({
                        value: b.kod,
                        label: `${b.ad}${b.tur ? ` · ${b.tur}` : ""}`,
                      }))}
                  />
                </div>
              ))}
            </div>
          }
        />
      )}

      {/* -------------------------------------------- eşleşmeyen meslekler */}
      {eksikMeslekler.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message={`${eksikMeslekler.length} meslek eşleştirilemedi`}
          description={
            <div className="ia-esleme">
              {eksikMeslekler.map((m) => (
                <div className="ia-esleme-satir" key={m}>
                  <Text strong style={{ fontSize: 13 }}>
                    {m}
                  </Text>
                  <ArrowRight size={14} strokeWidth={2} />
                  <Select
                    size="small"
                    showSearch
                    allowClear
                    placeholder="Pozisyon seçiniz"
                    style={{ minWidth: 240 }}
                    value={bolumEsleme[m]}
                    onChange={(v) => setBolumEsleme({ ...bolumEsleme, [m]: v })}
                    options={tumBolumler.map((b) => ({ value: b, label: b }))}
                  />
                </div>
              ))}
            </div>
          }
        />
      )}

      {/* --------------------------------------------------------- önizleme */}
      {satirlar.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Text strong style={{ fontSize: 13 }}>
            Önizleme
          </Text>

          <Tablo
            rowKey={(k: Satir) => `${k.departman}|${k.meslek}`}
            size="small"
            style={{ marginTop: 8 }}
            dataSource={satirlar}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            scroll={{ x: 720 }}
            rowClassName={(k) =>
              k.subeKodu && k.bolum ? "" : "ia-satir-eksik"
            }
            columns={[
              { title: "Departman", dataIndex: "departman", width: 160 },
              { title: "Meslek", dataIndex: "meslek", width: 190 },
              {
                title: "Adet",
                dataIndex: "adet",
                width: 80,
                align: "center",
                render: (v: number) => <Tag color="blue">{v}</Tag>,
              },
              {
                title: "Birim karşılığı",
                dataIndex: "subeKodu",
                width: 190,
                render: (v: string) =>
                  v ? (
                    <Tag color="green">
                      {birimler.find((b) => b.kod === v)?.ad ?? v}
                    </Tag>
                  ) : (
                    <Tag color="red">eşleşmedi</Tag>
                  ),
              },
              {
                title: "Pozisyon karşılığı",
                dataIndex: "bolum",
                render: (v: string) =>
                  v ? <Tag color="green">{v}</Tag> : <Tag color="red">eşleşmedi</Tag>,
              },
            ]}
          />
        </div>
      )}

      {metin.trim() && satirlar.length === 0 && (
        <Empty
          style={{ marginTop: 16 }}
          description="Satırlar çözümlenemedi. Sütunların sekme, noktalı virgül veya virgülle ayrıldığından emin olunuz."
        />
      )}
    </Drawer>
  );
}
