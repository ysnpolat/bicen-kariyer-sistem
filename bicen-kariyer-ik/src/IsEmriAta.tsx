/**
 * İş Emri Atama
 * ---------------------------------------------------------------------------
 * Her sayfaya konabilen tek bir buton. Bulunduğu kaydı (başvuru, personel,
 * şube ...) iş emrine bağlar; böylece emri alan kişi işin neyle ilgili
 * olduğunu görür ve panelde ilgili kayda dönebilir.
 *
 * Yalnızca yönetici rollerinde görünür — yetkisi olmayana buton hiç
 * basılmaz, tıklayıp hata almasındansa görmemesi daha doğru.
 *
 * Kullanımı:
 *   <IsEmriAta ekran="basvuru" kayitId={String(basvuru.id)}
 *              kayitBaslik={basvuru.adSoyad} />
 */

import { useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
import { ClipboardList } from "lucide-react";

import { api, oturumOku } from "./api";
import IsIcerik from "./IsIcerik";

const { TextArea } = Input;
const { Text } = Typography;

/** İş emri atayabilen roller; sunucudaki yetkiyle aynı olmalı */
const ATAMA_ROLLERI = ["Admin", "IKYoneticisi", "GenelMudurYardimcisi"];

interface Aday {
  tur: string;
  kod: string;
  ad: string;
  bilgi: string | null;
}

interface Props {
  /** Kaynak ekran anahtarı: "basvuru", "personel", "norm" ... */
  ekran: string;
  /** Kaydın kimliği; iş emri listesinden bu kayda dönmek için */
  kayitId?: string;
  /** Kaydın okunabilir adı: "AHMET YILMAZ" gibi */
  kayitBaslik?: string;
  /** Başlığa önerilecek metin */
  onerilenBaslik?: string;
  /** Buton görünümü */
  boyut?: "small" | "middle" | "large";
  tip?: "default" | "primary" | "text" | "link";
  /** Yalnızca simge göster (dar yerlerde) */
  yalnizSimge?: boolean;
}

export default function IsEmriAta({
  ekran,
  kayitId,
  kayitBaslik,
  onerilenBaslik,
  boyut = "middle",
  tip = "default",
  yalnizSimge = false,
}: Props) {
  const { message } = AntdApp.useApp();
  const oturum = oturumOku();

  const [acik, setAcik] = useState(false);
  const [tur, setTur] = useState<"panel" | "personel">("panel");
  const [adaylar, setAdaylar] = useState<{ panel: Aday[]; personel: Aday[] }>({
    panel: [],
    personel: [],
  });
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Çizelge atama anında kuruluyor.

     Düzenleyici önce yalnızca atandıktan sonraki ayrıntı penceresinde
     vardı; işi atan kişi önce boş bir iş açıp sonra geri dönüp çizelgeyi
     kurmak zorunda kalıyordu. Tabloyu işi tarif ederken kurmak doğal
     olan. */
  const [bloklar, setBloklar] = useState<any[]>([]);
  const [sablonlar, setSablonlar] = useState<any[]>([]);
  const [form] = Form.useForm();

  /* Yetki denetimi kancalardan SONRA: koşullu return kancaların önüne
     konursa React kancaları her render'da aynı sırada çağrılmaz. */
  const yetkili = !!oturum && ATAMA_ROLLERI.includes(oturum.rol);

  useEffect(() => {
    if (!acik) return;

    let iptal = false;

    setYukleniyor(true);

    api
      .al<{ panel: Aday[]; personel: Aday[] }>("/api/IsEmri/Atanabilecekler")
      .then((v) => {
        if (!iptal) setAdaylar(v);
      })
      .catch(() => {
        if (!iptal) message.error("Kişi listesi alınamadı.");
      })
      .finally(() => {
        if (!iptal) setYukleniyor(false);
      });

    return () => {
      iptal = true;
    };
  }, [acik, message]);

  /* Şablonlar açılışta okunuyor: aynı çizelge her hafta yeniden
     kuruluyordu. */
  useEffect(() => {
    if (!acik) return;

    api
      .al<{ sablonlar: any[] }>("/api/IsEmri/Sablonlar")
      .then((c) => setSablonlar(c.sablonlar ?? []))
      .catch(() => setSablonlar([]));
  }, [acik]);

  const kaydet = async () => {
    const degerler = await form.validateFields();

    setKaydediliyor(true);

    try {
      const secilen = (tur === "panel" ? adaylar.panel : adaylar.personel).find(
        (x) => x.kod === degerler.atananKod
      );

      const sonuc = await api.gonder<{ id: number }>("/api/IsEmri/Ata", {
        baslik: degerler.baslik,
        aciklama: degerler.aciklama,
        oncelik: degerler.oncelik ?? "Normal",
        atananTur: tur,
        atananKod: degerler.atananKod,
        atananAd: secilen?.ad ?? "",
        kaynakEkran: ekran,
        kaynakId: kayitId ?? null,
        kaynakBaslik: kayitBaslik ?? null,
        sonTarih: degerler.sonTarih
          ? degerler.sonTarih.format("YYYY-MM-DD")
          : null,
      });

      /* İçerik ayrı uçtan yazılıyor: atama ucu blok yapısını bilmiyor ve
         iki uca da aynı doğrulamayı koymak gereksiz. Çizelge
         yazılamazsa iş yine atanmış oluyor; kullanıcıya söyleniyor. */
      if (bloklar.length > 0 && sonuc?.id)
        try {
          await api.gonder(`/api/IsEmri/${sonuc.id}/Icerik`, {
            icerik: JSON.stringify(bloklar),
          });
        } catch {
          message.warning(
            "İş atandı ancak çizelge kaydedilemedi. Ayrıntı penceresinden ekleyebilirsiniz."
          );
        }

      message.success("İş emri atandı.");
      setAcik(false);
      form.resetFields();
      setBloklar([]);
    } catch (e) {
      message.error(
        e instanceof Error ? e.message : "İş emri atanamadı."
      );
    } finally {
      setKaydediliyor(false);
    }
  };

  const liste = tur === "panel" ? adaylar.panel : adaylar.personel;

  /* Yetkisi olmayana buton hiç basılmaz: tıklayıp hata almasındansa
     görmemesi daha doğru. */
  if (!yetkili) return null;

  return (
    <>
      <Tooltip title="Bu kayıtla ilgili bir iş emri ata">
        <Button
          size={boyut}
          type={tip}
          icon={<ClipboardList size={15} />}
          onClick={() => setAcik(true)}
        >
          {yalnizSimge ? null : "İş Ata"}
        </Button>
      </Tooltip>

      <Modal
        open={acik}
        title="İş Emri Ata"
        okText="Ata"
        cancelText="Vazgeç"
        confirmLoading={kaydediliyor}
        onOk={kaydet}
        onCancel={() => setAcik(false)}
        destroyOnClose
        /* Çizelge kurulabilsin diye geniş: dar pencerede tablo sütunları
           üst üste biniyordu. */
        width={840}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            baslik: onerilenBaslik ?? "",
            oncelik: "Normal",
          }}
        >
          {kayitBaslik ? (
            <Form.Item label="İlgili kayıt">
              <Input value={kayitBaslik} disabled />
            </Form.Item>
          ) : null}

          <Form.Item label="Kime">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Segmented
                block
                value={tur}
                onChange={(v) => {
                  setTur(v as "panel" | "personel");
                  form.setFieldValue("atananKod", undefined);
                }}
                options={[
                  { label: "Panel kullanıcısı", value: "panel" },
                  { label: "Mağaza personeli", value: "personel" },
                ]}
              />

              <Form.Item
                name="atananKod"
                noStyle
                rules={[{ required: true, message: "Bir kişi seçiniz." }]}
              >
                <Select
                  showSearch
                  loading={yukleniyor}
                  placeholder="Kişi arayın"
                  optionFilterProp="label"
                  style={{ width: "100%" }}
                  options={liste.map((x) => ({
                    value: x.kod,
                    label: x.bilgi ? `${x.ad} — ${x.bilgi}` : x.ad,
                  }))}
                />
              </Form.Item>
            </Space>
          </Form.Item>

          <Form.Item
            name="baslik"
            label="İş"
            rules={[{ required: true, message: "Başlık zorunludur." }]}
          >
            <Input placeholder="Kısaca yapılacak iş" maxLength={200} />
          </Form.Item>

          <Form.Item name="aciklama" label="Açıklama">
            <TextArea
              rows={3}
              placeholder="Ayrıntı, beklenen sonuç, dikkat edilecekler"
            />
          </Form.Item>

          {/* --------------------------------------------------- çizelge */}
          <Card
            size="small"
            title="Çizelge"
            style={{ marginBottom: 16 }}
            extra={
              sablonlar.length > 0 && (
                <Select
                  size="small"
                  style={{ width: 200 }}
                  placeholder="Şablondan doldur"
                  value={undefined}
                  onChange={(d) => {
                    const s = sablonlar.find((x) => x.id === d);

                    try {
                      setBloklar(s?.icerik ? JSON.parse(s.icerik) : []);
                      message.success("Şablon yüklendi.");
                    } catch {
                      message.error("Şablon okunamadı.");
                    }
                  }}
                  options={sablonlar.map((s) => ({ value: s.id, label: s.ad }))}
                />
              )
            }
          >
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
              İsteğe bağlı. Kontrol listesi, tablo ve biçimli metin
              ekleyebilirsiniz; atanan kişi kilitli olmayan alanları
              doldurur.
            </Text>

            <IsIcerik
              bloklar={bloklar}
              setBloklar={setBloklar}
              doldurma={{}}
              kip="duzenle"
            />
          </Card>

          <Space size="middle" style={{ width: "100%" }}>
            <Form.Item name="oncelik" label="Öncelik">
              <Select
                style={{ width: 140 }}
                options={[
                  { value: "Düşük", label: "Düşük" },
                  { value: "Normal", label: "Normal" },
                  { value: "Acil", label: "Acil" },
                ]}
              />
            </Form.Item>

            <Form.Item name="sonTarih" label="Son tarih">
              <DatePicker format="DD.MM.YYYY" placeholder="İsteğe bağlı" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
