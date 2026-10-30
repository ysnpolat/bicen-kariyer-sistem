/**
 * ---------------------------------------------------------------------------
 * Norm Kadro Matris Girişi
 * ---------------------------------------------------------------------------
 * Excel tablosundaki gibi çalışır: satırlarda pozisyonlar, sütunlarda şubeler.
 * Her hücreye o şubedeki pozisyonun değeri girilir.
 *
 * Üstteki seçimle hangi değerin girildiği belirlenir:
 *   Norm    → olması gereken kadro
 *   Mevcut  → hâlen çalışan personel
 *   Engelli → engelli çalışan sayısı
 *
 * Yarım kadrolar için ondalık değer girilebilir (24,5 gibi).
 * Yalnızca yönetici kullanabilir.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Col,
  Drawer,
  Empty,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { Save, X } from "lucide-react";

import { api } from "./api";

const { Text } = Typography;

type Olcut = "norm" | "mevcut" | "engelli";

interface Birim {
  kod: string;
  ad: string;
  tur?: string;
}

interface Kadro {
  id?: number;
  bolum: string;
  subeKodu: string | null;
  norm: number;
  mevcut: number;
  engelli: number;
  aciklama?: string;
}

/** Ondalık sayıyı Türkçe biçimde yazar */
const ondalik = (deger: number): string =>
  !deger ? "" : Number.isInteger(deger) ? String(deger) : deger.toFixed(1).replace(".", ",");

const OLCUT_BILGI: Record<Olcut, { ad: string; aciklama: string; renk: string }> = {
  norm: {
    ad: "Norm Kadro",
    aciklama: "Bu pozisyonda çalışması gereken kişi sayısı",
    renk: "#d9f7be",
  },
  mevcut: {
    ad: "Mevcut Personel",
    aciklama: "Hâlen çalışan personel sayısı",
    renk: "#fffbe6",
  },
  engelli: {
    ad: "Engelli Çalışan",
    aciklama: "Bu pozisyonda çalışan engelli personel sayısı",
    renk: "#fff7e6",
  },
};

export default function MatrisGiris({
  acik,
  kapat,
  kadrolar,
  birimler,
  birimTurleri,
  bolgeler,
  kaydedildi,
}: {
  acik: boolean;
  kapat: () => void;
  kadrolar: Kadro[];
  birimler: Birim[];
  birimTurleri: { ad: string; bolumler: string[] }[];
  bolgeler: { ad: string; subeler: string[] }[];
  kaydedildi: () => void;
}) {
  const { message, modal } = AntdApp.useApp();

  const [olcut, setOlcut] = useState<Olcut>("norm");
  const [tur, setTur] = useState<string>("Şube");
  const [bolge, setBolge] = useState<string | undefined>();
  const [yukleniyor, setYukleniyor] = useState(false);

  /** Hücre değerleri: "SUBEKODU|Pozisyon" → değer */
  const [degerler, setDegerler] = useState<Record<string, Kadro>>({});
  const [degisenler, setDegisenler] = useState<Set<string>>(new Set());

  /* Açılışta mevcut kadrolar haritaya alınır */
  useEffect(() => {
    if (!acik) return;

    const harita: Record<string, Kadro> = {};

    kadrolar.forEach((k) => {
      if (!k.subeKodu) return;
      harita[`${k.subeKodu}|${k.bolum}`] = {
        bolum: k.bolum,
        subeKodu: k.subeKodu,
        norm: k.norm ?? 0,
        mevcut: k.mevcut ?? 0,
        engelli: k.engelli ?? 0,
        aciklama: k.aciklama,
      };
    });

    setDegerler(harita);
    setDegisenler(new Set());
  }, [acik, kadrolar]);

  /* Sütunlar: seçilen türdeki ve bölgedeki birimler */
  const sutunlar = useMemo(() => {
    const bolgeSubeleri = bolge
      ? bolgeler.find((b) => b.ad === bolge)?.subeler ?? []
      : null;

    return birimler.filter((x) => {
      if (!x.kod) return false;
      if ((x.tur ?? "Şube") !== tur) return false;
      if (bolgeSubeleri && !bolgeSubeleri.includes(x.kod)) return false;
      return true;
    });
  }, [birimler, tur, bolge, bolgeler]);

  /* Satırlar: seçilen birim türünün pozisyonları */
  const satirlar = useMemo(
    () => birimTurleri.find((t) => t.ad === tur)?.bolumler ?? [],
    [birimTurleri, tur]
  );

  const deger = (subeKodu: string, bolum: string): number =>
    degerler[`${subeKodu}|${bolum}`]?.[olcut] ?? 0;

  const degerYaz = (subeKodu: string, bolum: string, yeni: number) => {
    const anahtar = `${subeKodu}|${bolum}`;
    const mevcutKayit = degerler[anahtar] ?? {
      bolum,
      subeKodu,
      norm: 0,
      mevcut: 0,
      engelli: 0,
    };

    setDegerler({
      ...degerler,
      [anahtar]: { ...mevcutKayit, [olcut]: yeni },
    });

    setDegisenler(new Set(degisenler).add(anahtar));
  };

  /* Toplamlar */
  const sutunToplami = (subeKodu: string) =>
    satirlar.reduce((t, b) => t + deger(subeKodu, b), 0);

  const satirToplami = (bolum: string) =>
    sutunlar.reduce((t, s) => t + deger(s.kod, bolum), 0);

  const genelToplam = sutunlar.reduce((t, s) => t + sutunToplami(s.kod), 0);

  /* ------------------------------------------------------------- kaydetme */

  const kaydet = async () => {
    if (degisenler.size === 0) {
      message.info("Değiştirilen bir değer yok.");
      return;
    }

    setYukleniyor(true);
    try {
      const gonderilecek = Array.from(degisenler).map((anahtar) => {
        const k = degerler[anahtar];
        const sube = birimler.find((x) => x.kod === k.subeKodu);

        return {
          bolum: k.bolum,
          subeKodu: k.subeKodu,
          subeAdi: sube?.ad ?? k.subeKodu,
          norm: k.norm,
          mevcut: k.mevcut,
          engelli: k.engelli,
          aciklama: k.aciklama ?? "",
        };
      });

      await api.gonder("/api/Havuz/KadroToplu", gonderilecek);

      message.success(`${gonderilecek.length} hücre kaydedildi.`);
      setDegisenler(new Set());
      kaydedildi();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const kapatmayiDene = () => {
    if (degisenler.size === 0) {
      kapat();
      return;
    }

    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: `${degisenler.size} hücrede değişiklik yaptınız. Kaydetmeden çıkarsanız bu değişiklikler kaybolur.`,
      okText: "Kaydetmeden çık",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: kapat,
    });
  };

  return (
    <Drawer
      open={acik}
      onClose={kapatmayiDene}
      width="96vw"
      className="mg-cekmece"
      title={
        <Space wrap size={10}>
          <Text strong>Norm Kadro Girişi</Text>
          <Tag color="blue">{OLCUT_BILGI[olcut].ad}</Tag>
          {degisenler.size > 0 && (
            <Tag color="orange">{degisenler.size} değişiklik</Tag>
          )}
        </Space>
      }
      footer={
        <Space style={{ float: "right" }}>
          <Button icon={<X size={15} strokeWidth={2} />} onClick={kapatmayiDene}>
            Kapat
          </Button>
          <Button
            type="primary"
            loading={yukleniyor}
            disabled={degisenler.size === 0}
            icon={<Save size={15} strokeWidth={2} />}
            onClick={kaydet}
          >
            Kaydet ({degisenler.size})
          </Button>
        </Space>
      }
    >
      {/* ------------------------------------------------------------ seçim */}
      <Row gutter={[10, 10]} align="middle" style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Segmented
            block
            value={olcut}
            onChange={(v) => setOlcut(v as Olcut)}
            options={[
              { label: "Norm", value: "norm" },
              { label: "Mevcut", value: "mevcut" },
              { label: "Engelli", value: "engelli" },
            ]}
          />
        </Col>

        <Col xs={12} md={5}>
          <Select
            style={{ width: "100%" }}
            value={tur}
            onChange={(v) => setTur(v)}
            options={birimTurleri.map((t) => ({ value: t.ad, label: t.ad }))}
          />
        </Col>

        <Col xs={12} md={5}>
          <Select
            allowClear
            showSearch
            placeholder="Bölgeye göre daralt"
            style={{ width: "100%" }}
            value={bolge}
            onChange={setBolge}
            options={bolgeler
              .filter((b) => b.ad)
              .map((b) => ({ value: b.ad, label: b.ad }))}
          />
        </Col>

        <Col xs={24} md={6}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {sutunlar.length} birim · {satirlar.length} pozisyon ·{" "}
            <b>Genel toplam: {ondalik(genelToplam) || 0}</b>
          </Text>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={OLCUT_BILGI[olcut].aciklama}
        description="Yarım kadrolar için ondalık yazabilirsiniz (örn. 24,5). Değişiklikler turuncu ile işaretlenir; Kaydet düğmesine basana kadar sunucuya yazılmaz."
      />

      {/* ------------------------------------------------------------ matris */}
      {sutunlar.length === 0 || satirlar.length === 0 ? (
        <Empty description="Seçilen tür veya bölge için birim/pozisyon bulunamadı." />
      ) : (
        <div className="mg-sarmal">
          <table className="mg-tablo">
            <thead>
              <tr>
                <th className="mg-kose">Pozisyon</th>
                {sutunlar.map((s) => (
                  <th key={s.kod} className="mg-sube">
                    <div className="mg-dikey">{s.ad}</div>
                  </th>
                ))}
                <th className="mg-toplam-baslik">Toplam</th>
              </tr>
            </thead>

            <tbody>
              {satirlar.map((bolum) => (
                <tr key={bolum}>
                  <th className="mg-pozisyon">{bolum}</th>

                  {sutunlar.map((s) => {
                    const anahtar = `${s.kod}|${bolum}`;
                    const degisti = degisenler.has(anahtar);

                    return (
                      <td
                        key={s.kod}
                        className={`mg-hucre${degisti ? " mg-degisti" : ""}`}
                      >
                        <InputNumber
                          size="small"
                          min={0}
                          max={999}
                          step={0.5}
                          decimalSeparator=","
                          controls={false}
                          value={deger(s.kod, bolum) || null}
                          placeholder="—"
                          onChange={(v) => degerYaz(s.kod, bolum, Number(v) || 0)}
                        />
                      </td>
                    );
                  })}

                  <td className="mg-satir-toplam">{ondalik(satirToplami(bolum))}</td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <th className="mg-pozisyon">TOPLAM</th>
                {sutunlar.map((s) => (
                  <td key={s.kod} className="mg-sutun-toplam">
                    {ondalik(sutunToplami(s.kod))}
                  </td>
                ))}
                <td className="mg-genel-toplam">{ondalik(genelToplam)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Drawer>
  );
}
