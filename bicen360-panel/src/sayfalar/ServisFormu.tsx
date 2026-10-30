/**
 * ---------------------------------------------------------------------------
 * Teknik Servis Formu
 * ---------------------------------------------------------------------------
 * Arıza çözüldü ya da kapatıldı yapılırken doldurulur. Ne yapıldığı,
 * müdahale biçimi, değişen parçalar ve maliyet kayıt altına alınır.
 *
 * Durum, form kaydedilmeden değişmiyor: "çözüldü" yazan ama ne yapıldığı
 * belli olmayan kayıt, aynı arıza tekrarladığında hiçbir şey anlatmıyordu
 * ve maliyet hiçbir yerde toplanmıyordu.
 *
 * Parça tutarları ekranda hesaplanıp gösteriliyor ama sunucu kendi
 * hesabını yapıyor; ekrandaki rakam bilgi amaçlı.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import {
  Button,
  Col,
  DatePicker,
  Divider,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { Plus, Trash2 } from "lucide-react";

import { api } from "../api";

const { Text } = Typography;

interface Parca {
  ad: string;
  kod: string;
  adet: number;
  birimFiyat: number;
  notu: string;
}

const paraYaz = (d: number) =>
  d.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";

/* ========================================================================== */

export default function ServisFormu({
  arizaId,
  envanterId,
  yeniDurum,
  kapat,
  kaydedildi,
}: {
  arizaId: number;
  envanterId?: number | null;
  yeniDurum: string;
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const [mudahale, setMudahale] = useState("yerinde");
  const [tespit, setTespit] = useState("");
  const [yapilanIslem, setYapilanIslem] = useState("");
  const [cihazDegisti, setCihazDegisti] = useState(false);
  const [yeniCihaz, setYeniCihaz] = useState("");
  const [iscilik, setIscilik] = useState<number>(0);

  /* Tutar yetkisi (13.10.2026): rolünde maliyet kapalı olan fiyat
     alanlarını görmez; kaydedince önceki fiyatları sunucu korur. */
  const [tutarGorur, setTutarGorur] = useState(true);
  const [servisFirma, setServisFirma] = useState("");
  const [teknisyen, setTeknisyen] = useState("");
  const [aralik, setAralik] = useState<[Dayjs, Dayjs] | null>(null);
  const [parcalar, setParcalar] = useState<Parca[]>([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Daha önce açılmış form varsa dolduruluyor: kapatıldı yapılırken
     çözüldü aşamasında girilenleri yeniden yazmak gerekmemeli. */
  useEffect(() => {
    api
      .getir<any>(`ServisFormu/Ariza/${arizaId}`)
      .then((c) => {
        if (c?.tutarGorur === false) setTutarGorur(false);

        if (!c?.form) return;

        const f = c.form;

        setMudahale(f.mudahale ?? "yerinde");
        setTespit(f.tespit ?? "");
        setYapilanIslem(f.yapilanIslem ?? "");
        setCihazDegisti(!!f.cihazDegisti);
        setYeniCihaz(f.yeniCihaz ?? "");
        setIscilik(Number(f.iscilik ?? 0));
        setServisFirma(f.servisFirma ?? "");
        setTeknisyen(f.teknisyen ?? "");

        if (f.baslangic && f.bitis)
          setAralik([dayjs(f.baslangic), dayjs(f.bitis)]);

        setParcalar(
          (c.parcalar ?? []).map((p: any) => ({
            ad: p.ad ?? "",
            kod: p.kod ?? "",
            adet: Number(p.adet ?? 1),
            birimFiyat: Number(p.birimFiyat ?? 0),
            notu: p.notu ?? "",
          }))
        );
      })
      .catch(() => undefined);
  }, [arizaId]);

  const parcaTutari = parcalar.reduce(
    (t, p) => t + (p.adet || 0) * (p.birimFiyat || 0),
    0
  );

  const toplam = parcaTutari + (iscilik || 0);

  const parcaGuncelle = (sira: number, alan: keyof Parca, deger: any) =>
    setParcalar((o) => o.map((p, i) => (i === sira ? { ...p, [alan]: deger } : p)));

  const kaydet = async () => {
    if (!yapilanIslem.trim()) {
      message.warning("Yapılan işlemi yazınız.");
      return;
    }

    setKaydediliyor(true);

    try {
      await api.gonder("ServisFormu", {
        arizaId,
        envanterId: envanterId ?? null,
        mudahale,
        tespit: tespit.trim() || null,
        yapilanIslem: yapilanIslem.trim(),
        cihazDegisti,
        yeniCihaz: cihazDegisti ? yeniCihaz.trim() || null : null,
        iscilik: iscilik || 0,
        servisFirma: servisFirma.trim() || null,
        teknisyen: teknisyen.trim() || null,
        baslangic: aralik?.[0]?.toISOString() ?? null,
        bitis: aralik?.[1]?.toISOString() ?? null,
        parcalar: parcalar
          .filter((p) => p.ad.trim())
          .map((p) => ({
            ad: p.ad.trim(),
            kod: p.kod.trim() || null,
            adet: p.adet || 1,
            birimFiyat: p.birimFiyat || 0,
            notu: p.notu.trim() || null,
          })),
      });

      /* Form kaydedildikten sonra durum değiştiriliyor; ikisi tek
         işlem gibi görünmeli ama formsuz durum değişmemeli. */
      await api.gonder(`Ariza/${arizaId}/Guncelle`, { durum: yeniDurum });

      message.success("Servis formu kaydedildi, durum güncellendi.");
      kaydedildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      title={`Teknik servis formu · ${yeniDurum === "cozuldu" ? "Çözüldü" : "Kapatıldı"}`}
      onCancel={kapat}
      onOk={kaydet}
      okText="Kaydet ve durumu değiştir"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      width={780}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Müdahale biçimi
          </Text>
          <div>
            <Segmented
              value={mudahale}
              onChange={(d) => setMudahale(String(d))}
              options={[
                { value: "uzaktan", label: "Uzaktan" },
                { value: "yerinde", label: "Yerinde" },
                { value: "merkezde", label: "Merkezde (cihaz getirildi)" },
              ]}
            />
          </div>
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Tespit — sorunun sebebi neydi
          </Text>
          <Input.TextArea
            rows={2}
            value={tespit}
            onChange={(e) => setTespit(e.target.value)}
            placeholder="Örn. güç kaynağı arızası, yazıcı kafası aşınmış"
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Yapılan işlem <Text type="danger">*</Text>
          </Text>
          <Input.TextArea
            rows={3}
            value={yapilanIslem}
            onChange={(e) => setYapilanIslem(e.target.value)}
            placeholder="Ne yapıldı, nasıl çözüldü"
          />
        </div>

        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Servis firması
            </Text>
            <Input
              value={servisFirma}
              onChange={(e) => setServisFirma(e.target.value)}
              placeholder="Kendi ekibimizse boş"
            />
          </Col>

          <Col xs={24} md={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Teknisyen
            </Text>
            <Input
              value={teknisyen}
              onChange={(e) => setTeknisyen(e.target.value)}
              placeholder="Müdahale eden kişi"
            />
          </Col>
        </Row>

        <Row gutter={12} align="middle">
          <Col xs={24} md={14}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Başlangıç – bitiş
            </Text>
            <DatePicker.RangePicker
              showTime
              format="DD.MM.YYYY HH:mm"
              style={{ width: "100%" }}
              value={aralik}
              onChange={(d) => setAralik(d as [Dayjs, Dayjs] | null)}
            />
          </Col>

          <Col xs={24} md={10}>
            <Space style={{ marginTop: 18 }}>
              <Switch checked={cihazDegisti} onChange={setCihazDegisti} />
              <Text>Cihaz değiştirildi</Text>
            </Space>
          </Col>
        </Row>

        {cihazDegisti && (
          <Input
            value={yeniCihaz}
            onChange={(e) => setYeniCihaz(e.target.value)}
            placeholder="Yeni cihaz (marka, model, seri no)"
          />
        )}

        <Divider style={{ margin: "4px 0" }}>Parçalar</Divider>

        {parcalar.map((p, sira) => (
          <Row gutter={8} key={sira} align="middle">
            <Col xs={24} md={7}>
              <Input
                placeholder="Parça adı"
                value={p.ad}
                onChange={(e) => parcaGuncelle(sira, "ad", e.target.value)}
              />
            </Col>

            <Col xs={12} md={4}>
              <Input
                placeholder="Kod"
                value={p.kod}
                onChange={(e) => parcaGuncelle(sira, "kod", e.target.value)}
              />
            </Col>

            <Col xs={6} md={3}>
              <InputNumber
                min={0.01}
                style={{ width: "100%" }}
                placeholder="Adet"
                value={p.adet}
                onChange={(d) => parcaGuncelle(sira, "adet", d ?? 1)}
              />
            </Col>

            {tutarGorur ? (
              <>
                <Col xs={6} md={4}>
                  <InputNumber
                    min={0}
                    style={{ width: "100%" }}
                    placeholder="Birim ₺"
                    value={p.birimFiyat}
                    onChange={(d) => parcaGuncelle(sira, "birimFiyat", d ?? 0)}
                  />
                </Col>

                <Col xs={20} md={5}>
                  <Text strong style={{ fontSize: 13 }}>
                    {paraYaz((p.adet || 0) * (p.birimFiyat || 0))}
                  </Text>
                </Col>
              </>
            ) : (
              <Col xs={20} md={9} />
            )}

            <Col xs={4} md={1}>
              <Button
                type="text"
                danger
                size="small"
                icon={<Trash2 size={14} />}
                onClick={() => setParcalar((o) => o.filter((_, i) => i !== sira))}
              />
            </Col>
          </Row>
        ))}

        <Button
          size="small"
          icon={<Plus size={14} />}
          onClick={() =>
            setParcalar((o) => [...o, { ad: "", kod: "", adet: 1, birimFiyat: 0, notu: "" }])
          }
        >
          Parça ekle
        </Button>

        {!tutarGorur && (
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Tutarlar rolünüzde gizli; parça fiyatlarını ve işçiliği yetkili kişi girer.
          </Text>
        )}

        {tutarGorur && <Divider style={{ margin: "4px 0" }}>Maliyet</Divider>}

        {tutarGorur && <Row gutter={12} align="middle">
          <Col xs={24} md={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              İşçilik / servis ücreti
            </Text>
            <InputNumber
              min={0}
              style={{ width: "100%" }}
              value={iscilik}
              onChange={(d) => setIscilik(d ?? 0)}
              addonAfter="₺"
            />
          </Col>

          <Col xs={12} md={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Parça toplamı
            </Text>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{paraYaz(parcaTutari)}</div>
          </Col>

          <Col xs={12} md={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Genel toplam
            </Text>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#5f8c10" }}>
              {paraYaz(toplam)}
            </div>
          </Col>
        </Row>}
      </Space>
    </Modal>
  );
}
