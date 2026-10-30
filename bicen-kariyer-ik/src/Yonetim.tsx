/**
 * ---------------------------------------------------------------------------
 * Yönetim — ayar merkezi
 * ---------------------------------------------------------------------------
 * Solda gruplu gezinme, üstte arama, açılışta Genel bakış (sayfanın sonundaki
 * "Ayar merkezi" bölümü). Ayar ekranları bu dosyadaki ve ayrı dosyalardaki
 * bileşenler; her biri kendi yetkisiyle görünür.
 * ---------------------------------------------------------------------------
 */

import { HukukYetkiYonetimi } from "./HukukYetkiler";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  DatePicker,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  LogIn,
  ArrowDown,
  ArrowUp,
  ShieldCheck,
  Mail,
  Plus,
  Save,
  Send,
  ShieldAlert,
  Trash2,
  UserPlus,
  CalendarDays,
  Building2,
  Search,
  ChevronRight,
  LayoutGrid,
  History,
  Info,
  AlertTriangle,
  HeartHandshake,
  MessageSquare,
  Palette,
  Workflow,
  ScanLine,
} from "lucide-react";

import GuvenlikGunlugu from "./GuvenlikGunlugu";
import HataSiniri from "./HataSiniri";
import RolYetkiTablosu from "./RolYetkiTablosu";
import { SAYFA_GRUPLARI, TUM_SAYFA_ANAHTARLARI, sayfaAdi } from "./sayfaYetkileri";
import "./Yonetim.css";
import dayjs from "dayjs";
import Tablo from "./Tablo";
import CalismaDuzeni from "./CalismaDuzeni";
import Departmanlar from "./Departmanlar";
import IzinKurallari from "./IzinKurallari";
import AvansKurallari from "./AvansKurallari";
import UygulamaDavetAyari from "./UygulamaDavetAyari";
import YolUcretleri from "./YolUcretleri";
import PersonelEpostalari from "./PersonelEpostalari";
import PanelGorunumu, { gorunumDuzenleyebilir } from "./PanelGorunumu";
import IseGirisEvrakTanimlari, { evrakTanimDuzenleyebilir } from "./IseGirisEvrakTanimlari";
import PatronGorunumu, { patronDuzenleyebilir } from "./PatronGorunumu";
import { GecisKarti, MikroKullaniciAdlari, OnayAkislariOzeti, PencereAcici, SecenekListeleri, SurelerSinirlar } from "./AyarMerkezi";
import IzinOnaySureci from "./IzinOnaySureci";
import AvansOnayTablosu from "./AvansOnayTablosu";
import FazlaMesaiKurallari from "./FazlaMesaiKurallari";
import FazlaMesaiUcretKurallari from "./FazlaMesaiUcretKurallari";
import MaasSkala from "./MaasSkala";
import UygulamaKullanimi from "./UygulamaKullanimi";
import EkibimAyar from "./EkibimAyar";
import KiyafetBedenleri from "./KiyafetBedeni";
import { DonemselKurallar } from "./DonemselDegerlendirme";
import Aydinlatma from "./Aydinlatma";
import YardimVideolari from "./YardimVideolari";
import UygulamaSurumleri from "./UygulamaSurumleri";
import SohbetYonetimi from "./SohbetYonetimi";
import { IzinTurleri } from "./IzinTalepleri";
import { sayfayaGit } from "./gecis";
const OkutmaKurallari = React.lazy(() => import("./OkutmaKurallari"));
import {
  ROL_ADLARI,
  api,
  kullaniciOlabilir,
  oturumOku,
  oturumYaz,
  rolAdlariniYaz,
  tamYonetim,
  formAyari,
  haberYonetimi,
} from "./api";

const { Title, Text, Paragraph } = Typography;

/* ========================================================================== */
/* 1. Mail Ayarları                                                           */
/* ========================================================================== */

function MailAyarlari() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [testAcik, setTestAcik] = useState(false);
  const [testAdres, setTestAdres] = useState("");
  const [testHatasi, setTestHatasi] = useState("");
  const [testGonderiliyor, setTestGonderiliyor] = useState(false);

  useEffect(() => {
    api
      .al<any>("/api/Ayar/Mail")
      .then((a) => form.setFieldsValue(a))
      .catch((h) => message.error(h.message));
  }, [form, message]);

  const kaydet = async () => {
    try {
      const d = await form.validateFields();
      setYukleniyor(true);
      await api.gonder("/api/Ayar/Mail", d);
      message.success("Mail ayarları kaydedildi.");
    } catch (hata: any) {
      if (!hata?.errorFields) message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const testGonder = async () => {
    setTestGonderiliyor(true);
    setTestHatasi("");
    try {
      await api.gonder("/api/Ayar/MailTest", { adres: testAdres });
      message.success("Test maili gönderildi.");
      setTestAcik(false);
    } catch (hata: any) {
      setTestHatasi(hata.message);
    } finally {
      setTestGonderiliyor(false);
    }
  };

  return (
    <Card>
      <Title level={5} style={{ marginTop: 0 }}>
        SMTP Sunucu Ayarları
      </Title>
      <Paragraph type="secondary" style={{ fontSize: 13 }}>
        Başvurular buradaki adreslere mail olarak iletilir. Parola alanı kayıtlı
        ise yıldızlı görünür; değiştirmek istemiyorsanız dokunmayınız.
      </Paragraph>

      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col xs={24} md={10}>
            <Form.Item
              name="sunucu"
              label="Sunucu Adresi"
              rules={[{ required: true, message: "SMTP sunucusunu giriniz." }]}
            >
              <Input placeholder="Örn: mail.bicen.com.tr" />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="port" label="Port" initialValue={587}>
              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={5}>
            <Form.Item
              name="sifrelemeTuru"
              label="Şifreleme"
              initialValue="Otomatik"
              extra="587 → STARTTLS · 465 → SSL · 25 → Yok"
            >
              <Select
                options={[
                  { value: "Otomatik", label: "Otomatik" },
                  { value: "STARTTLS", label: "STARTTLS (587)" },
                  { value: "SSL", label: "SSL (465)" },
                  { value: "Yok", label: "Şifreleme yok (25)" },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={5}>
            <Form.Item name="gonderenAd" label="Gönderen Adı">
              <Input placeholder="Biçen Kariyer" />
            </Form.Item>
          </Col>

          <Col xs={24} md={8}>
            <Form.Item name="kullaniciAdi" label="Kullanıcı Adı">
              <Input autoComplete="off" placeholder="ik@bicen.com.tr" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="parola" label="Parola">
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="gonderenAdres" label="Gönderen Adres">
              <Input placeholder="ik@bicen.com.tr" />
            </Form.Item>
          </Col>

          <Col xs={24} md={12}>
            <Form.Item
              name="siteAdresi"
              label="Site Adresi"
              extra="Mail içindeki logo ve bağlantılar bu adresi kullanır."
            >
              <Input placeholder="https://kariyer.bicen.com.tr" />
            </Form.Item>
          </Col>

          <Col xs={24}>
            <Form.Item
              name="aliciAdresler"
              label="Başvuruların Gideceği Adresler"
              extra="Adresi yazıp Enter tuşuna basınız. Birden fazla adres eklenebilir."
            >
              <Select mode="tags" tokenSeparators={[",", ";", " "]} placeholder="ik@bicen.com.tr" />
            </Form.Item>
          </Col>

          <Col xs={24} md={12}>
            <Form.Item name="basvuruMailiGonder" valuePropName="checked" initialValue={true}>
              <Checkbox>Yeni başvurularda İK'ya mail gönder</Checkbox>
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="adayaBilgiMailiGonder" valuePropName="checked" initialValue={true}>
              <Checkbox>Adaya "başvurunuz alındı" maili gönder</Checkbox>
            </Form.Item>
          </Col>
        </Row>

        <Space wrap>
          <Button
            type="primary"
            loading={yukleniyor}
            icon={<Save size={15} strokeWidth={2} />}
            onClick={kaydet}
          >
            Kaydet
          </Button>
          <Button icon={<Send size={15} strokeWidth={2} />} onClick={() => setTestAcik(true)}>
            Test maili gönder
          </Button>
        </Space>
      </Form>

      <Modal
        open={testAcik}
        title="Test Maili"
        okText="Gönder"
        cancelText="Kapat"
        confirmLoading={testGonderiliyor}
        onOk={testGonder}
        onCancel={() => {
          setTestAcik(false);
          setTestHatasi("");
        }}
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Kayıtlı ayarlarla test maili gönderilir. Önce ayarları kaydediniz.
        </Paragraph>

        <Input
          placeholder="ornek@bicen.com.tr"
          value={testAdres}
          onChange={(e) => setTestAdres(e.target.value)}
        />

        {testHatasi && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 14 }}
            message="Gönderilemedi"
            description={<span style={{ fontSize: 12.5 }}>{testHatasi}</span>}
          />
        )}
      </Modal>
    </Card>
  );
}

/* ========================================================================== */
/* 2. Form Ayarları                                                           */
/* ========================================================================== */

function ListeAlani({
  ad,
  etiket,
  aciklama,
}: {
  ad: string;
  etiket: string;
  aciklama?: string;
}) {
  return (
    <Col xs={24} md={12}>
      <Form.Item name={ad} label={etiket} extra={aciklama}>
        <Select
          mode="tags"
          tokenSeparators={[","]}
          placeholder="Yazıp Enter tuşuna basınız"
          style={{ width: "100%" }}
        />
      </Form.Item>
    </Col>
  );
}

/** Form ayarının panelde ayrı sayfa olarak gösterilen bölümleri */
export type FormBolumu =
  | "birimler"
  | "bolgeler"
  | "birimturleri"
  | "basvuruformu"
  | "kvkk"
  | "gorusme"
  | "uyumanket"
  | "yonetici"
  | "mobilmetin"
  | "izinformu";

/**
 * Form ayarları (FORM) tek bir kayıt; Yönetim'de bölüm bölüm ayrı
 * sayfalarda gösteriliyor. Her sayfa kaydın tamamını okuyup yalnızca
 * kendi alanlarını değiştiriyor: kaydederken sunucudan gelen ayarın
 * üzerine yazıldığı için diğer bölümlerin alanları korunuyor (sunucu da
 * ayrıca birleştiriyor). Hangi bölümden kaydedildiği "?bolum=" ile
 * bildiriliyor; son değişiklik bilgisi bölüm bölüm tutulsun.
 */
function FormAyarlari({
  bolum,
  onKirli,
  onKaydedildi,
}: {
  bolum: FormBolumu;
  onKirli?: (kirli: boolean) => void;
  onKaydedildi?: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  /* Kaydedilmemiş değişiklik: alttaki kaydet çubuğu ve sayfa
     değiştirirken uyarı için üst bileşene de bildiriliyor */
  const [kirli, setKirli] = useState(false);
  const kirliYap = () => {
    setKirli(true);
    onKirli?.(true);
  };
  const temizle = () => {
    setKirli(false);
    onKirli?.(false);
  };

  /* Sunucudan gelen listelerin özeti: listeler bundan farklılaşınca
     "değişti" sayılır (yüklemenin kendisi sayılmasın diye) */
  const kaynakRef = useRef("");

  /* Aşama pencereleri düzenlenirken kaç kişinin listeleneceği anında
     görünsün: sayım sunucudan, yarım saniye gecikmeyle */
  const pencereler = Form.useWatch("uyumPencereleri", form);
  const izinIkEposta = Form.useWatch("izinFormuIkEposta", form);
  const [pencereSayimi, setPencereSayimi] = useState<any[] | null>(null);
  const [pencereSayiliyor, setPencereSayiliyor] = useState(false);

  useEffect(() => {
    /* Sayım yalnızca uyum anketi sayfasında gerekli */
    if (!pencereler || bolum !== "uyumanket") return;

    const zamanlayici = setTimeout(async () => {
      setPencereSayiliyor(true);
      try {
        const d = await api.gonder<any>("/api/Uyum/PencereSayimi", pencereler);
        setPencereSayimi(d?.sonuc ?? []);
      } catch {
        setPencereSayimi(null);
      } finally {
        setPencereSayiliyor(false);
      }
    }, 500);

    return () => clearTimeout(zamanlayici);
  }, [JSON.stringify(pencereler ?? {})]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [subeler, setSubeler] = useState<
    {
      kod: string;
      ad: string;
      tur: string;
      normRaporundaGizle?: boolean;
      eposta?: string;
      izinFormuEposta?: string;
    }[]
  >([]);
  const [birimTurleri, setBirimTurleri] = useState<
    { ad: string; aciklama?: string; rozet?: string; bolumler: string[] }[]
  >([]);
  const [bolgeler, setBolgeler] = useState<{ ad: string; subeler: string[] }[]>([]);

  /* Yönetici eşleştirmesi için birim bazında pozisyon ve personel listesi.
     Aynı birim birden çok satırda kullanılabildiği için önbelleğe alınır. */
  const [birimVerisi, setBirimVerisi] = useState<Record<string, any>>({});

  const birimYukle = async (birim: string) => {
    if (!birim || birimVerisi[birim]) return;

    try {
      const d = await api.al<any>(
        `/api/Personel/Birim?sube=${encodeURIComponent(birim)}`
      );

      setBirimVerisi((o) => ({ ...o, [birim]: d }));
    } catch {
      /* Liste alınamazsa alanlar boş kalır; elle yazmak hâlâ mümkün */
    }
  };

  /* Sunucudan gelen ayarın tamamı saklanıyor. Form yalnızca kendi
     alanlarını döndürüyor; kaydederken bunun üzerine yazılmazsa bu ekranda
     hiç görünmeyen alanlar (sol menü sırası gibi) siliniyordu. Sunucu da
     artık birleştiriyor, bu ikinci güvence. */
  const [tumAyar, setTumAyar] = useState<any>({});

  const [ilkYukleme, setIlkYukleme] = useState(true);

  /* Vazgeç de bunu çağırıyor: form sunucudaki hâline döner */
  const yukle = () => {
    api
      .al<any>("/api/Ayar/Form")
      .then((a) => {
        setTumAyar(a ?? {});
        form.resetFields();
        form.setFieldsValue(a);
        setSubeler(a.subeler ?? []);
        kaynakRef.current = JSON.stringify([
          a.subeler ?? [],
          a.birimTurleri ?? [],
          a.bolgeler ?? [],
        ]);

        /* Kayıtlı eşleştirmelerin birimleri önden yüklenir; kullanıcı
           satırı görünce seçili pozisyon ve yönetici adları da gelsin. */
        if (bolum === "yonetici")
          (a.uyumYoneticiEslesme ?? []).forEach((e: any) => birimYukle(e.birim));
        setBirimTurleri(a.birimTurleri ?? []);
        setBolgeler(a.bolgeler ?? []);
        temizle();
      })
      .catch((h) => message.error(h.message))
      .finally(() => setIlkYukleme(false));
  };

  useEffect(() => {
    yukle();
  }, [form, message]);

  /* Birim, birim türü ve bölge listeleri form dışında (durumda) tutuluyor;
     değiştiklerinde de kaydet çubuğu çıksın. Yüklemeden gelen ilk
     değişiklik sayılmıyor. */
  useEffect(() => {
    if (ilkYukleme) return;
    if (JSON.stringify([subeler, birimTurleri, bolgeler]) !== kaynakRef.current) kirliYap();
  }, [subeler, birimTurleri, bolgeler]);

  const kaydet = async () => {
    /* İzin formu adresleri: yanlış yazılmış adrese form hiç gitmez */
    if (bolum === "izinformu") {
      const hatali = subeler.filter((x) =>
        (x.izinFormuEposta ?? "")
          .split(/[;,\s]+/)
          .filter(Boolean)
          .some((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
      );

      if (hatali.length > 0) {
        message.error(
          `E-posta adresi hatalı: ${hatali.map((x) => x.ad || x.kod).join(", ")}`
        );
        return;
      }
    }

    try {
      const d = await form.validateFields();
      setYukleniyor(true);

      const govde = {
        ...tumAyar,
        ...d,
        subeler,
        birimTurleri,
        bolgeler,
      };

      await api.gonder(`/api/Ayar/Form?bolum=${encodeURIComponent(bolum)}`, govde);

      setTumAyar(govde);
      kaynakRef.current = JSON.stringify([subeler, birimTurleri, bolgeler]);
      temizle();
      onKaydedildi?.();

      message.success(
        bolum === "basvuruformu" || bolum === "kvkk"
          ? "Kaydedildi. Aday sayfası yenilendiğinde geçerli olur."
          : "Kaydedildi."
      );
    } catch (hata: any) {
      if (!hata?.errorFields) message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const subeSutunlari: ColumnsType<any> = [
    {
      title: "Şube Kodu",
      dataIndex: "kod",
      width: 140,
      render: (v: string, _k, sira: number) => (
        <Input
          value={v}
          placeholder="SEFAKOY"
          onChange={(e) => {
            const yeni = [...subeler];
            yeni[sira] = { ...yeni[sira], kod: e.target.value.toUpperCase() };
            setSubeler(yeni);
          }}
        />
      ),
    },
    {
      title: "Birim Adı",
      dataIndex: "ad",
      render: (v: string, _k, sira: number) => (
        <Input
          value={v}
          placeholder="Sefaköy Şubesi"
          onChange={(e) => {
            const yeni = [...subeler];
            yeni[sira] = { ...yeni[sira], ad: e.target.value };
            setSubeler(yeni);
          }}
        />
      ),
    },
    {
      title: "Türü",
      dataIndex: "tur",
      width: 160,
      render: (v: string, _k, sira: number) => (
        <Select
          value={v || "Şube"}
          style={{ width: "100%" }}
          options={birimTurleri.map((t) => ({ value: t.ad, label: t.ad }))}
          onChange={(deger) => {
            const yeni = [...subeler];
            yeni[sira] = { ...yeni[sira], tur: deger };
            setSubeler(yeni);
          }}
        />
      ),
    },
    {
      title: "E-posta",
      dataIndex: "eposta",
      width: 220,
      render: (v: string, _k, sira: number) => (
        <Tooltip title="Günlük okutma raporu her sabah bu adrese, yalnızca bu şubenin verisiyle gönderilir. Birden fazla adres virgülle ayrılabilir. Boşsa şubeye rapor gitmez.">
          <Input
            value={v ?? ""}
            placeholder="sube@bicen.com.tr"
            onChange={(e) => {
              const yeni = [...subeler];
              yeni[sira] = { ...yeni[sira], eposta: e.target.value };
              setSubeler(yeni);
            }}
          />
        </Tooltip>
      ),
    },
    {
      title: "Norm Raporu",
      dataIndex: "normRaporundaGizle",
      width: 110,
      align: "center",
      render: (v: boolean, _k, sira: number) => (
        <Tooltip title="İşaretlenirse bu birim Norm Kadro raporunda hiç görünmez ve toplamlara katılmaz. Kadro ve personel kayıtları etkilenmez.">
          <Checkbox
            checked={!!v}
            onChange={(e) => {
              const yeni = [...subeler];
              yeni[sira] = { ...yeni[sira], normRaporundaGizle: e.target.checked };
              setSubeler(yeni);
            }}
          >
            Gizle
          </Checkbox>
        </Tooltip>
      ),
    },
    {
      title: "",
      width: 60,
      render: (_v, _k, sira: number) => (
        <Button
          type="text"
          danger
          icon={<Trash2 size={15} strokeWidth={2} />}
          onClick={() => setSubeler(subeler.filter((_, i) => i !== sira))}
        />
      ),
    },
  ];

  return (
    <div className="ym-form">
      {ilkYukleme && (
        <div className="ym-yukleniyor">
          <Spin />
        </div>
      )}

      <Form
        style={ilkYukleme ? { display: "none" } : undefined}
        form={form}
        layout="vertical"
        onValuesChange={() => kirliYap()}
      >
        {bolum === "basvuruformu" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Form duyurusu</h3>
            <Form.Item
              name="duyuru"
              label="Form Üzerinde Görünecek Duyuru"
              extra="Boş bırakılırsa duyuru alanı gösterilmez."
            >
              <Input.TextArea rows={2} maxLength={400} placeholder="Örn: Yaz dönemi alımlarımız başlamıştır." />
            </Form.Item>
          </section>
        )}

        {bolum === "mobilmetin" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Doğum günü kutlama metni</h3>
            {/* Kutlamanın sözünü İK yazmalı; yazılıma gömülü bir cümle kurumun
                diliyle uyuşmuyordu. */}
            <Form.Item
              name="dogumGunuMetni"
              label="Doğum günü kutlama metni"
              extra="Personel doğum gününde uygulamayı açtığında gösterilir. Boş bırakılırsa genel bir cümle kullanılır."
            >
              <Input.TextArea
                rows={2}
                placeholder="Doğum gününüz kutlu olsun! Nice mutlu, sağlıklı yıllara."
              />
            </Form.Item>
          </section>
        )}

        {bolum === "birimturleri" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Birim türleri</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Aday önce birimi seçer, ardından yalnızca o birime ait pozisyonlar
              listelenir. Buradaki açıklama ve rozet, aday sayfasının karşılama
              ekranındaki kartlarda görünür. Ok düğmeleriyle sıralamayı
              değiştirebilirsiniz; ancak Şube, Lojistik Depo ve Genel Müdürlük
              kartları karşılama ekranında her zaman bu sırayla gösterilir.
            </Paragraph>

            {birimTurleri.map((t, sira) => (
              <Card size="small" key={sira} style={{ marginBottom: 10 }}>
                <Row gutter={[12, 10]} align="middle">
                  <Col xs={24} md={6}>
                    <Input
                      value={t.ad}
                      placeholder="Birim türü adı"
                      onChange={(e) => {
                        const yeni = [...birimTurleri];
                        yeni[sira] = { ...yeni[sira], ad: e.target.value };
                        setBirimTurleri(yeni);
                      }}
                    />
                  </Col>

                  <Col xs={24} md={13}>
                    <Input
                      value={(t as any).aciklama}
                      placeholder="Karşılama kartındaki açıklama"
                      maxLength={200}
                      onChange={(e) => {
                        const yeni = [...birimTurleri];
                        yeni[sira] = { ...yeni[sira], aciklama: e.target.value } as any;
                        setBirimTurleri(yeni);
                      }}
                    />
                  </Col>

                  <Col xs={22} md={4}>
                    <Input
                      value={(t as any).rozet}
                      placeholder="Rozet"
                      maxLength={40}
                      onChange={(e) => {
                        const yeni = [...birimTurleri];
                        yeni[sira] = { ...yeni[sira], rozet: e.target.value } as any;
                        setBirimTurleri(yeni);
                      }}
                    />
                  </Col>

                  <Col xs={24} md={22}>
                    <Select
                      mode="tags"
                      tokenSeparators={[","]}
                      value={t.bolumler}
                      placeholder="Pozisyonları yazıp Enter tuşuna basınız"
                      style={{ width: "100%" }}
                      onChange={(deger) => {
                        const yeni = [...birimTurleri];
                        yeni[sira] = { ...yeni[sira], bolumler: deger };
                        setBirimTurleri(yeni);
                      }}
                    />
                  </Col>
                  <Col xs={24} md={1}>
                    <Space size={2}>
                      <Button
                        type="text"
                        size="small"
                        disabled={sira === 0}
                        title="Yukarı taşı"
                        icon={<ChevronUp size={15} strokeWidth={2.2} />}
                        onClick={() => {
                          const yeni = [...birimTurleri];
                          [yeni[sira - 1], yeni[sira]] = [yeni[sira], yeni[sira - 1]];
                          setBirimTurleri(yeni);
                        }}
                      />
                      <Button
                        type="text"
                        size="small"
                        disabled={sira === birimTurleri.length - 1}
                        title="Aşağı taşı"
                        icon={<ChevronDown size={15} strokeWidth={2.2} />}
                        onClick={() => {
                          const yeni = [...birimTurleri];
                          [yeni[sira], yeni[sira + 1]] = [yeni[sira + 1], yeni[sira]];
                          setBirimTurleri(yeni);
                        }}
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        title="Sil"
                        icon={<Trash2 size={15} strokeWidth={2} />}
                        onClick={() =>
                          setBirimTurleri(birimTurleri.filter((_, i) => i !== sira))
                        }
                      />
                    </Space>
                  </Col>
                </Row>
              </Card>
            ))}

            <Button
              icon={<Plus size={15} strokeWidth={2} />}
              style={{ marginBottom: 8 }}
              onClick={() =>
                setBirimTurleri([
                  ...birimTurleri,
                  { ad: "", aciklama: "", rozet: "", bolumler: [] },
                ])
              }
            >
              Birim türü ekle
            </Button>
          </section>
        )}

        {bolum === "birimler" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Birim listesi</h3>

            <Tablo
              rowKey={(_k, sira) => String(sira)}
              size="small"
              pagination={false}
              columns={subeSutunlari}
              dataSource={subeler}
              scroll={{ x: 820 }}
              footer={() => (
                <Button
                  icon={<Plus size={15} strokeWidth={2} />}
                  onClick={() =>
                    setSubeler([
                      ...subeler,
                      { kod: "", ad: "", tur: birimTurleri[0]?.ad ?? "Şube" },
                    ])
                  }
                >
                  Birim ekle
                </Button>
              )}
            />
          </section>
        )}

        {bolum === "bolgeler" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Bölge tanımları</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Bölge tanımlayıp altına şubeleri ekleyiniz. Kullanıcılar ekranında bir
              personele bölge seçtiğinizde, o bölgenin şubeleri yetkisine otomatik
              tanımlanır. Bölgeye sonradan şube eklerseniz, bu ekranı kaydettiğinizde
              o bölgedeki tüm kullanıcılar birlikte güncellenir.
            </Paragraph>

            {bolgeler.map((b, sira) => (
              <Card size="small" key={sira} style={{ marginBottom: 10 }}>
                <Row gutter={[12, 10]} align="middle">
                  <Col xs={24} md={6}>
                    <Input
                      value={b.ad}
                      placeholder="Bölge adı (örn: Avrupa Yakası)"
                      maxLength={100}
                      onChange={(e) => {
                        const yeni = [...bolgeler];
                        yeni[sira] = { ...yeni[sira], ad: e.target.value };
                        setBolgeler(yeni);
                      }}
                    />
                  </Col>

                  <Col xs={22} md={17}>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      value={b.subeler}
                      placeholder="Bu bölgeye bağlı şubeleri seçiniz"
                      style={{ width: "100%" }}
                      options={subeler
                        .filter((x) => x.kod)
                        .map((x) => ({
                          value: x.kod,
                          label: `${x.ad || x.kod} · ${x.tur || "Şube"}`,
                        }))}
                      onChange={(deger) => {
                        const yeni = [...bolgeler];
                        yeni[sira] = { ...yeni[sira], subeler: deger };
                        setBolgeler(yeni);
                      }}
                    />
                  </Col>

                  <Col xs={2} md={1}>
                    <Button
                      type="text"
                      danger
                      icon={<Trash2 size={15} strokeWidth={2} />}
                      onClick={() => setBolgeler(bolgeler.filter((_, i) => i !== sira))}
                    />
                  </Col>
                </Row>
              </Card>
            ))}

            <Button
              icon={<Plus size={15} strokeWidth={2} />}
              style={{ marginBottom: 8 }}
              onClick={() => setBolgeler([...bolgeler, { ad: "", subeler: [] }])}
            >
              Bölge ekle
            </Button>
          </section>
        )}

        {bolum === "basvuruformu" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Seçenek listeleri</h3>

            <Row gutter={16}>
              <ListeAlani ad="egitimSeviyeleri" etiket="Eğitim Seviyeleri" />
              <ListeAlani ad="kanGruplari" etiket="Kan Grupları" />
              <ListeAlani ad="askerlikDurumlari" etiket="Askerlik Durumları" />
              <ListeAlani ad="ehliyetSiniflari" etiket="Ehliyet Sınıfları" />
              <ListeAlani ad="srcBelgeleri" etiket="SRC Belgeleri" />
              <ListeAlani ad="bilgisayarProgramlari" etiket="Bilgisayar Programları" />
              <ListeAlani ad="medeniDurumlar" etiket="Medeni Durum" />
              <ListeAlani ad="uyruklar" etiket="Uyruk" />
              <ListeAlani
                ad="engelTurleri"
                etiket="Engel Türleri"
                aciklama="Aday engel durumu bildirdiğinde bu listeden seçim yapar."
              />
              <ListeAlani
                ad="iller"
                etiket="Adres Seçiminde Görünecek İller"
                aciklama="Yalnızca adres verisi tanımlı iller çalışır (varsayılan: İstanbul)."
              />
            </Row>
          </section>
        )}

        {bolum === "gorusme" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Görüşme yeri</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Tüm görüşmeler Genel Müdürlük'te yapıldığı için bu bilgiler hem
              e-posta davetine hem WhatsApp mesajına eklenir. Aday nereye
              geleceğini davetin içinde görür.
            </Paragraph>

            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item name="gorusmeAdresi" label="Genel Müdürlük adresi">
                  <Input.TextArea
                    rows={3}
                    placeholder="Mahalle, cadde, no, ilçe / il"
                  />
                </Form.Item>
              </Col>

              <Col xs={24} md={12}>
                <Form.Item
                  name="gorusmeHaritaAdresi"
                  label="Konum bağlantısı"
                  tooltip="Google Haritalar bağlantısı; davete tıklanabilir olarak konur"
                >
                  <Input placeholder="https://maps.app.goo.gl/..." />
                </Form.Item>
              </Col>
            </Row>
          </section>
        )}

        {bolum === "uyumanket" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Aşama pencereleri</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Çalışma süresi (Personel Listesi'ndeki sayım; giriş günü 0) bu
              aralıktayken kişi Oryantasyon Takip listesinde görünür ve anket
              gönderilebilir. Tek gün istiyorsanız iki değeri aynı yazın.
              Yanındaki sayı, bu değerlerle <b>bugün</b> kaç kişinin
              listeleneceğidir; kaydetmeden görebilirsiniz.
            </Paragraph>

            <Row gutter={[16, 8]}>
              {[
                { kod: "7g", ad: "7. gün", vars: [7, 7] },
                { kod: "2a", ad: "2. ay", vars: [55, 55] },
                { kod: "6a", ad: "6. ay", vars: [170, 180] },
                { kod: "1y", ad: "1. yıl", vars: [355, 365] },
              ].map((a) => {
                const sayim = (pencereSayimi ?? []).find((x) => x.asama === a.kod);

                return (
                  <Col xs={24} md={12} key={a.kod}>
                    <div className="yn-pencere">
                      <div className="yn-pencere-ad">{a.ad}</div>
                      <Form.Item
                        name={["uyumPencereleri", a.kod, "enAz"]}
                        initialValue={a.vars[0]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={0} max={2000} style={{ width: 118 }} addonAfter="gün" />
                      </Form.Item>
                      <span className="yn-pencere-tire">–</span>
                      <Form.Item
                        name={["uyumPencereleri", a.kod, "enFazla"]}
                        initialValue={a.vars[1]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={0} max={2000} style={{ width: 118 }} addonAfter="gün" />
                      </Form.Item>
                      <Tooltip
                        title={
                          sayim && sayim.kisiler?.length > 0 ? (
                            <div style={{ fontSize: 12 }}>
                              {sayim.kisiler.map((k: any) => (
                                <div key={k.personelKodu}>
                                  {k.adSoyad} · {k.sube} · {k.gun}. gün
                                </div>
                              ))}
                              {sayim.adet > sayim.kisiler.length && (
                                <div>… ve {sayim.adet - sayim.kisiler.length} kişi daha</div>
                              )}
                            </div>
                          ) : undefined
                        }
                      >
                        <Tag
                          color={sayim ? (sayim.adet > 0 ? "green" : "default") : "default"}
                          style={{ marginLeft: 8 }}
                        >
                          {pencereSayiliyor && !sayim
                            ? "sayılıyor…"
                            : sayim
                            ? `bugün ${sayim.adet} kişi`
                            : "—"}
                        </Tag>
                      </Tooltip>
                    </div>
                  </Col>
                );
              })}
            </Row>
          </section>
        )}

        {bolum === "uyumanket" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Otomatik gönderim</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Açık olan aşamada anket, o gün pencereye giren personele ve birimin
              yöneticisine kendiliğinden gider (09:00–18:00 arası, saatte bir
              denetlenir). Kapalıyken gönderim Oryantasyon Takip sayfasından elle
              yapılır. Daha önce gönderilmiş kişiye ikinci kez gitmez; elle
              gönderimle çakışmaz.
            </Paragraph>

            <Row gutter={[16, 8]}>
              {[
                { kod: "7g", ad: "7. gün", not: "yukarıdaki pencereye giren gün" },
                { kod: "2a", ad: "2. ay", not: "yukarıdaki pencereye giren gün" },
                { kod: "6a", ad: "6. ay", not: "yukarıdaki pencereye giren gün" },
                { kod: "1y", ad: "1. yıl", not: "yukarıdaki pencereye giren gün" },
              ].map((a) => (
                <Col xs={24} sm={12} md={6} key={a.kod}>
                  <Form.Item
                    name={["uyumOtomatik", a.kod]}
                    valuePropName="checked"
                    label={a.ad}
                    extra={a.not}
                    style={{ marginBottom: 8 }}
                  >
                    <Switch checkedChildren="Otomatik" unCheckedChildren="Elle" />
                  </Form.Item>
                </Col>
              ))}
            </Row>
          </section>
        )}

        {bolum === "uyumanket" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">SMS metinleri</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Her dönem için ayrı metin yazabilirsiniz. Boş bıraktığınız dönemde
              aşağıdaki genel metin, o da boşsa varsayılan metin kullanılır.
              Bağlantının 72 saat (3 gün) geçerli olduğu bilgisi metinde yoksa sona
              kendiliğinden eklenir.
            </Paragraph>

            <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
              Alanlar: <code>{"{ad}"}</code> <code>{"{asama}"}</code>{" "}
              <code>{"{sube}"}</code> <code>{"{link}"}</code>
            </Paragraph>

            <Tabs
              size="small"
              items={[
                { kod: "7g", ad: "7. Gün" },
                { kod: "2a", ad: "2. Ay" },
                { kod: "6a", ad: "6. Ay" },
                { kod: "1y", ad: "1. Yıl" },
              ].map((a) => ({
                key: a.kod,
                label: a.ad,
                children: (
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name={["uyumMesajlari", `calisan${a.kod}`]}
                        label={`Çalışana giden mesaj — ${a.ad}`}
                      >
                        <Input.TextArea
                          rows={4}
                          placeholder={`Merhaba {ad}, Biçen'deki ${a.ad} geribildirim formunuz hazır: {link}`}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item
                        name={["uyumMesajlari", `yonetici${a.kod}`]}
                        label={`Mağaza yöneticisine giden mesaj — ${a.ad}`}
                      >
                        <Input.TextArea
                          rows={4}
                          placeholder={`Merhaba, {sube} mağazasındaki personelin ${a.ad} değerlendirmesi bekliyor: {link}`}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              }))}
            />
          </section>
        )}

        {bolum === "yonetici" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Eşleştirmeler</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Mağazalarda yönetici ünvandan bulunur (Mağaza Müdürü). Genel
              Müdürlük ve Lojistik Depo gibi birimlerde yan yana birçok müdür
              olduğu için hangisinin kimin yöneticisi olduğu ünvandan çıkmaz.
              Burada tanımladıklarınız tahmine üstün gelir.
            </Paragraph>

            <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
              Pozisyon boş bırakılırsa o birimdeki <b>tüm</b> personel için
              geçerli olur. Yönetici, Mikro sicil numarasıyla belirtilir.
            </Paragraph>

            <Form.List name="uyumYoneticiEslesme">
              {(alanlar, { add, remove }) => (
                <>
                  {alanlar.map((alan) => (
                    <Row gutter={8} key={alan.key} style={{ marginBottom: 8 }}>
                      <Col xs={24} md={8}>
                        <Form.Item name={[alan.name, "birim"]} style={{ marginBottom: 0 }}>
                          <Select
                            showSearch
                            placeholder="Birim"
                            onChange={(v) => birimYukle(v)}
                            options={(subeler ?? []).map((b: any) => ({
                              value: b.ad,
                              label: b.ad,
                            }))}
                          />
                        </Form.Item>
                      </Col>

                      <Col xs={24} md={8}>
                        <Form.Item
                          shouldUpdate
                          noStyle
                        >
                          {({ getFieldValue }) => {
                            const birim = getFieldValue([
                              "uyumYoneticiEslesme",
                              alan.name,
                              "birim",
                            ]);

                            const veri = birimVerisi[birim];

                            return (
                              <Form.Item
                                name={[alan.name, "pozisyon"]}
                                style={{ marginBottom: 0 }}
                              >
                                <Select
                                  allowClear
                                  showSearch
                                  placeholder="Pozisyon (boşsa tümü)"
                                  /* Uç bu listeyi "unvanlar" adıyla döndürüyor */
                                  options={(veri?.unvanlar ?? []).map((x: string) => ({
                                    value: x,
                                    label: x,
                                  }))}
                                />
                              </Form.Item>
                            );
                          }}
                        </Form.Item>
                      </Col>

                      <Col xs={20} md={6}>
                        <Form.Item shouldUpdate noStyle>
                          {({ getFieldValue }) => {
                            const birim = getFieldValue([
                              "uyumYoneticiEslesme",
                              alan.name,
                              "birim",
                            ]);

                            const veri = birimVerisi[birim];

                            /* Yalnızca çalışanlar; ayrılmış birini yönetici
                               olarak tanımlamak anlamsız */
                            const kisiler = (veri?.personeller ?? []).filter(
                              (x: any) => x.durum === 1
                            );

                            return (
                              <Form.Item
                                name={[alan.name, "yoneticiKodu"]}
                                style={{ marginBottom: 0 }}
                              >
                                <Select
                                  showSearch
                                  placeholder="Yönetici"
                                  optionFilterProp="label"
                                  options={kisiler.map((x: any) => ({
                                    value: x.personelKodu,
                                    label: `${x.ad} ${x.soyad} — ${x.pozisyon ?? ""}`,
                                  }))}
                                />
                              </Form.Item>
                            );
                          }}
                        </Form.Item>
                      </Col>

                      <Col xs={4} md={2}>
                        <Button
                          danger
                          type="text"
                          icon={<Trash2 size={15} strokeWidth={2} />}
                          onClick={() => remove(alan.name)}
                        />
                      </Col>
                    </Row>
                  ))}

                  <Button
                    onClick={() => add({ birim: "", pozisyon: "", yoneticiKodu: "" })}
                  >
                    Eşleştirme ekle
                  </Button>
                </>
              )}
            </Form.List>
          </section>
        )}

        {bolum === "uyumanket" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Genel metinler</h3>

            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item name="uyumCalisanMesaji" label="Çalışana giden genel mesaj">
                  <Input.TextArea rows={3} />
                </Form.Item>
              </Col>

              <Col xs={24} md={12}>
                <Form.Item name="uyumYoneticiMesaji" label="Yöneticiye giden genel mesaj">
                  <Input.TextArea rows={3} />
                </Form.Item>
              </Col>
            </Row>
          </section>
        )}

        {bolum === "gorusme" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">WhatsApp davet mesajı</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Görüşme talebi oluşturulduktan sonra personelin kendi WhatsApp
              hesabından göndereceği hazır mesaj. Kullanılabilir alanlar:{" "}
              <code>{"{ad}"}</code> <code>{"{tarih}"}</code> <code>{"{saat}"}</code>{" "}
              <code>{"{yer}"}</code> <code>{"{not}"}</code> <code>{"{uzman}"}</code>{" "}
              <code>{"{unvan}"}</code> <code>{"{telefon}"}</code>{" "}
              <code>{"{basvuruNo}"}</code> <code>{"{adres}"}</code>{" "}
              <code>{"{konum}"}</code>
            </Paragraph>

            <Form.Item name="whatsappSablonu">
              <Input.TextArea rows={9} style={{ fontSize: 13.5 }} />
            </Form.Item>
          </section>
        )}

        {bolum === "kvkk" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">KVKK metinleri</h3>

            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              Boş bırakılan metin yerine aday sayfasındaki varsayılan metin
              kullanılır. Metinlerdeki paragraf düzeni aday sayfasına birebir yansır.
            </Paragraph>

            <Form.Item
              name="aydinlatmaMetni"
              label="Aydınlatma Metni"
              extra="İş başvurusunda bulunan adaylar için aydınlatma metni."
            >
              <Input.TextArea rows={8} placeholder="Varsayılan metin kullanılacak" />
            </Form.Item>

            <Form.Item
              name="acikRizaMetni"
              label="Açık Rıza Beyan Formu Giriş Metni"
              extra="Onay maddelerinin üzerinde görünen bilgilendirme paragrafı."
            >
              <Input.TextArea rows={5} placeholder="Varsayılan metin kullanılacak" />
            </Form.Item>
          </section>
        )}

        {bolum === "basvuruformu" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Bölümler ve başvuru kaynağı</h3>

            <Row gutter={16}>
              <Col xs={24}>
                {/* Bizi nereden duydunuz seçenekleri.

                    Liste boş bırakılırsa soru formda hiç görünmüyor. Kaynaklar
                    kampanyaya göre değişiyor (mağaza karekodu, ilan sitesi,
                    sosyal medya) ve koda gömülünce her değişiklikte yeni sürüm
                    gerekiyordu. "Diğer" seçeneği kendiliğinden ekleniyor. */}
                <Form.Item
                  name="basvuruKaynaklari"
                  label="Başvuru kaynağı seçenekleri"
                  extra={
                    "Adaya \"Bizi nereden duydunuz?\" diye sorulur. Her satıra bir " +
                    "seçenek yazınız; boş bırakılırsa soru sorulmaz. \"Diğer\" " +
                    "seçeneği listeye eklenmez, kendiliğinden gösterilir."
                  }
                >
                  <Select
                    mode="tags"
                    style={{ width: "100%" }}
                    placeholder="Mağazada gördüm, Kariyer.net, Tanıdık önerisi…"
                    tokenSeparators={[",", "\n"]}
                  />
                </Form.Item>
              </Col>

              <Col xs={24} md={8}>
                <Form.Item name="isTecrubesiBolumuAcik" valuePropName="checked">
                  <Checkbox>İş tecrübesi bölümü açık</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="sertifikaBolumuAcik" valuePropName="checked">
                  <Checkbox>Sertifika bölümü açık</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="referansBolumuAcik" valuePropName="checked">
                  <Checkbox>Referans bölümü açık</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="epostaZorunlu" valuePropName="checked">
                  <Checkbox>E-posta adresi zorunlu olsun</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="enFazlaSertifika" label="En fazla sertifika sayısı">
                  <InputNumber min={1} max={20} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
          </section>
        )}
        {bolum === "basvuruformu" && (
          <section className="ym-blok">
            <h3 className="ym-blok-bas">Zorunlu referans</h3>
            <div style={{ fontSize: 12.5, color: "#667085", marginBottom: 12, maxWidth: 760 }}>
              Başvuru formunda ve İK'nın <b>İşe al</b> adımında uygulanır. Muaf pozisyonlar yalnızca
              seçilen birim türlerinde geçerlidir (depo ve genel merkezde herkes zorunlu). Üst
              pozisyonlar ve adında anahtar kelime geçenler (şef, müdür…) üst sayıyı ister.
            </div>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item name={["referansKurali", "acik"]} valuePropName="checked">
                  <Checkbox>Zorunlu referans kuralı açık</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name={["referansKurali", "gecerlilikBaslangic"]}
                  label="Bu tarihten itibaren gelen başvurulara"
                  extra="Önceki başvurularda İşe al adımında referans aranmaz."
                  getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
                  normalize={(v) => (v ? dayjs(v).format("YYYY-MM-DD") : null)}
                >
                  <DatePicker format="DD.MM.YYYY" style={{ width: "100%" }} allowClear />
                </Form.Item>
              </Col>
              <Col xs={12} md={8}>
                <Form.Item name={["referansKurali", "varsayilanAdet"]} label="Diğer pozisyonlarda en az">
                  <InputNumber min={0} max={5} addonAfter="referans" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={8}>
                <Form.Item name={["referansKurali", "ustAdet"]} label="Şef ve üstünde en az">
                  <InputNumber min={0} max={5} addonAfter="referans" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={["referansKurali", "muafPozisyonlar"]} label="Referans istenmeyen pozisyonlar">
                  <Select mode="tags" style={{ width: "100%" }} tokenSeparators={[","]} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={["referansKurali", "muafBirimTurleri"]} label="Muafiyetin geçerli olduğu birim türleri">
                  <Select
                    mode="tags"
                    style={{ width: "100%" }}
                    options={birimTurleri.map((t) => ({ value: t.ad, label: t.ad }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name={["referansKurali", "ustPozisyonlar"]} label="Üst pozisyonlar (şef ve üstü)">
                  <Select mode="tags" style={{ width: "100%" }} tokenSeparators={[","]} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name={["referansKurali", "ustAnahtarKelimeler"]}
                  label="Adında geçerse üst sayılır"
                >
                  <Select mode="tags" style={{ width: "100%" }} tokenSeparators={[","]} />
                </Form.Item>
              </Col>
            </Row>
          </section>
        )}
        {bolum === "izinformu" && (
          <>
            <section className="ym-blok">
              <h3 className="ym-blok-bas">Genel merkez</h3>
              <Form.Item
                name="izinFormuIkEposta"
                label="İnsan Kaynakları e-postası"
                extra="Kendi e-postası girilmemiş genel merkez personelinin izin formu ve aşağıda adresi boş kalan birimlerin formu buraya gider. Boşsa ik@bicen.com.tr kullanılır."
              >
                <Input placeholder="ik@bicen.com.tr" style={{ maxWidth: 420 }} />
              </Form.Item>
            </section>

            <PersonelEpostalari />

            <section className="ym-blok">
              <div className="ym-blok-satir">
                <h3 className="ym-blok-bas">Birimlerin izin formu adresi</h3>
                <Tag color={subeler.filter((x) => x.kod && !x.izinFormuEposta?.trim()).length ? "orange" : "green"}>
                  {subeler.filter((x) => x.kod && !x.izinFormuEposta?.trim()).length} birim boş
                </Tag>
                <Button
                  size="small"
                  style={{ marginLeft: "auto" }}
                  disabled={!subeler.some((x) => !x.izinFormuEposta?.trim() && x.eposta?.trim() && (x.tur ?? "Şube") === "Şube")}
                  onClick={() =>
                    setSubeler(
                      subeler.map((x) =>
                        !x.izinFormuEposta?.trim() && x.eposta?.trim() && (x.tur ?? "Şube") === "Şube"
                          ? { ...x, izinFormuEposta: x.eposta.trim() }
                          : x
                      )
                    )
                  }
                >
                  Boş şubelere rapor mailini kopyala
                </Button>
              </div>

              <Paragraph type="secondary" style={{ fontSize: 13 }}>
                Personel uygulamadan izin talep edince doldurulan form bu adrese gider; çıktısı
                alınıp imzalatılır. Şubede şubenin maili, Akçaburgaz depoda depo müdürünün maili
                yazılır. Birden fazla adres virgülle ayrılabilir. Boş bırakılan birimde form
                genel merkez birimiyse İK'ya, değilse portaldaki şube e-postasına, o da yoksa
                İK'ya gider.
              </Paragraph>

              <Tablo
                rowKey={(_k, sira) => String(sira)}
                size="small"
                pagination={false}
                scroll={{ x: 760 }}
                dataSource={subeler.filter((x) => x.kod)}
                columns={[
                  {
                    title: "Birim",
                    dataIndex: "ad",
                    render: (_v: string, k: any) => (
                      <div>
                        <Text strong>{k.ad || k.kod}</Text>
                        {k.ad && k.ad !== k.kod && (
                          <div style={{ fontSize: 11.5, color: "#8a8f98" }}>{k.kod}</div>
                        )}
                      </div>
                    ),
                  },
                  { title: "Tür", dataIndex: "tur", width: 140, render: (v: string) => v || "Şube" },
                  {
                    title: "İzin formu e-postası",
                    key: "izinFormuEposta",
                    width: 300,
                    render: (_: any, k: any) => {
                      const deger: string = k.izinFormuEposta ?? "";
                      const hatali =
                        deger.trim().length > 0 &&
                        deger
                          .split(/[;,\s]+/)
                          .filter(Boolean)
                          .some((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));

                      return (
                        <Input
                          value={deger}
                          status={hatali ? "error" : undefined}
                          placeholder={
                            (k.tur ?? "Şube") === "Şube"
                              ? "sube@bicen.com.tr"
                              : (k.tur ?? "").includes("Depo")
                              ? "depo müdürünün maili"
                              : "boşsa İK"
                          }
                          onChange={(e) =>
                            setSubeler(
                              subeler.map((x) =>
                                x === k ? { ...x, izinFormuEposta: e.target.value } : x
                              )
                            )
                          }
                        />
                      );
                    },
                  },
                  {
                    title: "Form nereye gider",
                    key: "hedef",
                    width: 240,
                    render: (_: any, k: any) => {
                      const deger = (k.izinFormuEposta ?? "").trim();
                      if (deger) return <Tag color="green">{deger}</Tag>;
                      if ((k.tur ?? "").includes("Genel"))
                        return <Tag color="blue">İK · {izinIkEposta?.trim() || "ik@bicen.com.tr"}</Tag>;
                      return (
                        <Tooltip title="Portalda (Şube ve depo) bu birime e-posta yazılıysa oraya, değilse İK'ya gider.">
                          <Tag color="orange">portaldaki adres / İK</Tag>
                        </Tooltip>
                      );
                    },
                  },
                ]}
              />
            </section>
          </>
        )}
      </Form>

      <KaydetCubugu
        acik={kirli}
        yukleniyor={yukleniyor}
        onKaydet={kaydet}
        onVazgec={yukle}
      />
    </div>
  );
}

/* ========================================================================== */
/* 3. Kullanıcılar                                                            */
/* ========================================================================== */

/** Sabit rollerin tek satırlık özeti; kullanıcı formunda ad yanında görünür */
const SABIT_ROL_OZETI: Record<string, string> = {
  Admin: "tam yetki",
  GenelMudurYardimcisi: "onaylar, norm kadro ve skala",
  IKYoneticisi: "tüm bildirimler, kadro önerisi",
  IK: "kendi şubelerinin bildirimleri",
  BolgeKoordinatoru: "tüm bölgeler, salt görüntüleme",
  BolgeMuduru: "kendi bölgesi, salt görüntüleme",
  FotografGorevlisi: "yalnızca personel fotoğrafı",
};

function Kullanicilar() {
  const { message, modal } = AntdApp.useApp();
  const [liste, setListe] = useState<any[]>([]);
  const [subeSecenekleri, setSubeSecenekleri] = useState<
    { kod: string; ad: string; tur: string }[]
  >([]);
  const [bolgeSecenekleri, setBolgeSecenekleri] = useState<
    { ad: string; subeler: string[] }[]
  >([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [acik, setAcik] = useState(false);
  const [form] = Form.useForm();

  /* Rol listesi sunucudan: panelden açılan roller de burada görünmeli,
     yoksa yeni rol tanımlanıyor ama kimseye verilemiyordu. */
  const [rolSecenekleri, setRolSecenekleri] = useState<any[]>([]);

  /* Personel eşleştirmesi (04.10.2026): hesap Mikro'daki personele
     bağlanıyor; bölge müdürünün izin onayı ve ekibi bu kişiden bulunuyor. */
  const [personelSecenek, setPersonelSecenek] = useState<
    { sicil: string; adSoyad: string; pozisyon?: string; isYeri?: string; telefon?: string }[]
  >([]);
  const [personelAraniyor, setPersonelAraniyor] = useState(false);
  const personelZaman = useRef<any>(null);
  const formRol = Form.useWatch("rol", form);

  const personelAra = (q: string) => {
    clearTimeout(personelZaman.current);
    if ((q ?? "").trim().length < 2) return;

    personelZaman.current = setTimeout(async () => {
      setPersonelAraniyor(true);
      try {
        setPersonelSecenek(
          await api.al<any[]>(`/api/Kullanici/PersonelAra?q=${encodeURIComponent(q.trim())}`)
        );
      } catch {
        /* arama sonuçsuz kalır */
      } finally {
        setPersonelAraniyor(false);
      }
    }, 300);
  };

  /* Düzenlenen hesabın kayıtlı personeli seçenekler arasında görünsün */
  const personelSecenekHazirla = (kayit: any) => {
    if (kayit?.sicil)
      setPersonelSecenek([
        {
          sicil: kayit.sicil,
          adSoyad: kayit.personelEslesme?.adSoyad ?? kayit.adSoyad ?? kayit.sicil,
          pozisyon: kayit.personelEslesme?.pozisyon,
        },
      ]);
    else setPersonelSecenek([]);
  };

  const getir = async () => {
    setYukleniyor(true);
    try {
      setListe(await api.al<any[]>("/api/Kullanici/Liste"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();

    api
      .al<any>("/api/Ayar/Form")
      .then((a) => {
        setSubeSecenekleri(a.subeler ?? []);
        setBolgeSecenekleri(a.bolgeler ?? []);
      })
      .catch(() => undefined);

    api
      .al<any>("/api/Ayar/Roller")
      .then((d) => {
        const gelen = d?.roller ?? [];

        setRolSecenekleri(gelen);
        rolAdlariniYaz(gelen);
      })
      .catch(() => undefined);
  }, []);

  const kaydet = async () => {
    try {
      const d = await form.validateFields();

      // Bölgeler sunucuya virgülle ayrılmış tek metin olarak gönderilir
      await api.gonder("/api/Kullanici/Kaydet", {
        ...d,
        bolge: Array.isArray(d.bolge) ? d.bolge.join(",") : d.bolge ?? "",
      });
      message.success("Kullanıcı kaydedildi.");
      setAcik(false);
      form.resetFields();
      getir();
    } catch (hata: any) {
      if (!hata?.errorFields) message.error(hata.message);
    }
  };

  /**
   * Seçilen kullanıcının hesabıyla oturum açar.
   * Kendi oturumu saklanır; şeritteki düğmeyle geri dönülür.
   */
  const kullaniciOl = (kayit: any) => {
    modal.confirm({
      title: "Bu kullanıcı olarak görüntüle",
      width: 460,
      content: (
        <div style={{ fontSize: 13.5 }}>
          <p style={{ marginTop: 4 }}>
            <b>{kayit.adSoyad}</b> ({ROL_ADLARI[kayit.rol] ?? kayit.rol})
            hesabıyla panele gireceksiniz ve onun yetkileriyle işlem
            yapabileceksiniz.
          </p>
          <p style={{ marginBottom: 0 }}>
            Bu oturum <b>bir saat</b> sürer, güvenlik günlüğüne kaydedilir ve
            yaptığınız işlemlerde adınız görünür.
          </p>
        </div>
      ),
      okText: "Devam et",
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          const kendi = oturumOku();

          const yeni = await api.gonder<any>(
            `/api/Auth/KullaniciOl/${kayit.id}`,
            {}
          );

          /* Kendi oturumumuz saklanır ki geri dönebilelim */
          oturumYaz({ ...yeni, oncekiOturum: kendi });

          window.location.reload();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  const sil = (kayit: any) => {
    modal.confirm({
      title: `${kayit.kullaniciAdi} kullanıcısı silinsin mi?`,
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Kullanici/${kayit.id}`);
          message.success("Kullanıcı silindi.");
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  /* Liste süzgeçleri: 30+ kullanıcıda rol ve ad ile bulmak gerekiyor */
  const [kArama, setKArama] = useState("");
  const [kRol, setKRol] = useState<string | undefined>();
  const [kDurum, setKDurum] = useState<"aktif" | "hepsi">("aktif");

  const suzulmus = liste.filter((k: any) => {
    if (kDurum === "aktif" && !k.aktif) return false;
    if (kRol && k.rol !== kRol) return false;

    if (kArama.trim()) {
      const q = kArama.trim().toLocaleLowerCase("tr");
      const m = [k.kullaniciAdi, k.adSoyad, k.unvan, k.eposta, k.telefon, k.bolge, k.subeler]
        .filter(Boolean).join(" ").toLocaleLowerCase("tr");
      if (!m.includes(q)) return false;
    }

    return true;
  });

  const rolSayilari = liste.reduce((t: Record<string, number>, k: any) => {
    t[k.rol] = (t[k.rol] ?? 0) + 1;
    return t;
  }, {});

  const sutunlar: ColumnsType<any> = [
    {
      title: "Kullanıcı",
      dataIndex: "adSoyad",
      sorter: (a: any, b: any) => (a.adSoyad ?? "").localeCompare(b.adSoyad ?? "", "tr"),
      render: (v: string, k: any) => (
        <div>
          <Text strong>{v}</Text>
          <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
            {k.kullaniciAdi}{k.unvan ? ` · ${k.unvan}` : ""}
            {k.mikroKullaniciNo ? (
              <Tooltip title="Mikro kullanıcı numarası: Mikro'ya açılan sicil kartları bu kullanıcı adına işlenir">
                <Tag color="geekblue" style={{ marginInlineStart: 6, fontSize: 10.5, lineHeight: "16px" }}>
                  Mikro {k.mikroKullaniciNo}
                </Tag>
              </Tooltip>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      title: "İletişim",
      key: "iletisim",
      width: 220,
      render: (_: any, k: any) => (
        <div style={{ fontSize: 12.5 }}>
          {k.telefon && <div>{k.telefon}</div>}
          {k.eposta && <div style={{ color: "#6b7280" }}>{k.eposta}</div>}
          {!k.telefon && !k.eposta && <span style={{ color: "#bbb" }}>—</span>}
        </div>
      ),
    },
    {
      title: "Rol",
      dataIndex: "rol",
      width: 175,
      render: (v: string, k: any) => (
        <Space size={4} wrap>
          <Tag
            color={
              v === "Admin"
                ? "red"
                : v === "BolgeMuduru"
                ? "purple"
                : v === "FotografGorevlisi"
                ? "cyan"
                : "green"
            }
            style={{ marginInlineEnd: 0 }}
          >
            {ROL_ADLARI[v] ?? v}
          </Tag>
          {(k.onayYetkisi || v === "Admin") && (
            <Tooltip title="İşe alım onayı verebilir">
              <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
                onay
              </Tag>
            </Tooltip>
          )}
          {/* Bölge müdürünün Mikro'daki karşılığı: mağaza müdürlerinin
              izin talebi bu kişiye gidiyor (04.10.2026) */}
          {v === "BolgeMuduru" && k.personelEslesme && (
            k.personelEslesme.bulundu ? (
              <Tooltip
                title={`Mağaza müdürlerinin izin talepleri bu kişiye gider (Biçen360). Mikro: ${k.personelEslesme.adSoyad} · ${k.personelEslesme.sicil}${k.personelEslesme.pozisyon ? ` · ${k.personelEslesme.pozisyon}` : ""} — ${k.personelEslesme.neyle === "sicil" ? "personel seçimiyle bağlı" : `${k.personelEslesme.neyle} ile eşleşti; kesinleştirmek için Düzenle → Personel (Mikro) alanından seçebilirsiniz`}.`}
              >
                <Tag color="green" style={{ marginInlineEnd: 0 }}>
                  izin onayı · {k.personelEslesme.sicil}
                </Tag>
              </Tooltip>
            ) : (
              <Tooltip title="Bu hesap Mikro'daki bir personelle eşleşmedi; mağaza müdürlerinin izin talebi bu kişiye gidemez. Düzenle → Personel (Mikro) alanından kişiyi seçiniz.">
                <Tag color="red" style={{ marginInlineEnd: 0 }}>
                  Mikro'da eşleşmedi
                </Tag>
              </Tooltip>
            )
          )}
        </Space>
      ),
    },
    {
      title: "Bölge",
      dataIndex: "bolge",
      width: 190,
      render: (v: string) =>
        v ? (
          <Space size={4} wrap>
            {v
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => (
                <Tag key={x} color="blue" style={{ marginInlineEnd: 0 }}>
                  {x}
                </Tag>
              ))}
          </Space>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
    {
      title: "Yetkili Şubeler",
      dataIndex: "subeler",
      ellipsis: true,
      render: (v: string, k) =>
        ["BolgeMuduru", "IK"].includes(k.rol) ? (
          v || <span style={{ color: "#bbb" }}>—</span>
        ) : (
          <span style={{ color: "#bbb" }}>Tümü</span>
        ),
    },
    {
      title: "Durum",
      dataIndex: "aktif",
      width: 90,
      render: (v: boolean) => (v ? <Tag color="green">Aktif</Tag> : <Tag>Pasif</Tag>),
    },
    {
      title: "",
      width: 150,
      render: (_v, kayit) => (
        <Space>
          <Button
            size="small"
            icon={<KeyRound size={14} strokeWidth={2} />}
            onClick={() => {
              form.setFieldsValue({
                ...kayit,
                parola: "",
                bolge: (kayit.bolge ?? "")
                  .split(",")
                  .map((x: string) => x.trim())
                  .filter(Boolean),
                subeler: (kayit.subeler ?? "")
                  .split(",")
                  .map((x: string) => x.trim())
                  .filter(Boolean),
                sicil: kayit.sicil ?? undefined,
              });
              personelSecenekHazirla(kayit);
              setAcik(true);
            }}
          >
            Düzenle
          </Button>

          {/* Kullanıcının ekranını kendi yetkileriyle görüntüleme */}
          {kullaniciOlabilir(oturumOku()) && kayit.aktif && (
            <Tooltip title="Bu kullanıcının hesabıyla görüntüle">
              <Button
                size="small"
                icon={<LogIn size={14} strokeWidth={2} />}
                onClick={() => kullaniciOl(kayit)}
              />
            </Tooltip>
          )}

          <Button
            size="small"
            danger
            icon={<Trash2 size={14} strokeWidth={2} />}
            onClick={() => sil(kayit)}
          />
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <Space wrap style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Space wrap>
          <Input
            allowClear
            value={kArama}
            onChange={(e) => setKArama(e.target.value)}
            placeholder="Ad, kullanıcı adı, e-posta, şube"
            style={{ width: 240 }}
          />
          <Select
            allowClear
            value={kRol}
            onChange={setKRol}
            placeholder="Rol"
            style={{ width: 200 }}
            options={Object.keys(ROL_ADLARI).map((r) => ({
              value: r,
              label: `${ROL_ADLARI[r]}${rolSayilari[r] ? ` (${rolSayilari[r]})` : ""}`,
            }))}
          />
          <Segmented
            value={kDurum}
            onChange={(v) => setKDurum(v as "aktif" | "hepsi")}
            options={[
              { value: "aktif", label: `Aktif (${liste.filter((k: any) => k.aktif).length})` },
              { value: "hepsi", label: `Tümü (${liste.length})` },
            ]}
          />
        </Space>

        <Button
          type="primary"
          icon={<UserPlus size={15} strokeWidth={2} />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ rol: "IK", aktif: true });
            personelSecenekHazirla(null);
            setAcik(true);
          }}
        >
          Yeni kullanıcı
        </Button>
      </Space>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Rolün ne görebildiği <b>Rol Yetkileri</b> sekmesinden, kullanıcının
        hangi şubelerden sorumlu olduğu buradaki kayıttan belirlenir.
        "Hesabıyla görüntüle" ile bir kullanıcının ekranını kendi
        yetkileriyle açıp deneyebilirsiniz.
      </Paragraph>

      <Tablo
        rowKey="id"
        size="small"
        loading={yukleniyor}
        columns={sutunlar}
        dataSource={suzulmus}
        pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: 1100 }}
        rowClassName={(k: any) => (k.aktif ? "" : "kl-pasif")}
      />

      <Modal
        open={acik}
        title="Kullanıcı"
        okText="Kaydet"
        cancelText="Vazgeç"
        onOk={kaydet}
        onCancel={() => setAcik(false)}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>

          <Form.Item
            name="kullaniciAdi"
            label="Kullanıcı Adı"
            rules={[{ required: true, message: "Kullanıcı adı giriniz." }]}
          >
            <Input autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="sicil"
            label="Personel (Mikro)"
            extra={
              formRol === "BolgeMuduru"
                ? "Bölge müdürünü Mikro'daki personel kaydına bağlar: mağaza müdürlerinin izin talepleri Biçen360'ta bu kişiye düşer, ekibi ve puantajı bu hesabın bölgelerinden gelir."
                : "Hesabı Mikro'daki personel kaydına bağlar. İsteğe bağlı."
            }
          >
            <Select
              showSearch
              allowClear
              filterOption={false}
              placeholder="Ad, soyad ya da sicil yazın"
              notFoundContent={personelAraniyor ? <Spin size="small" /> : "En az iki harf yazın"}
              onSearch={personelAra}
              onChange={(v) => {
                const p = personelSecenek.find((x) => x.sicil === v);
                if (!p) return;

                /* Boş alanlar personel kaydından dolsun */
                const d = form.getFieldsValue(["adSoyad", "telefon", "unvan"]);
                form.setFieldsValue({
                  adSoyad: d.adSoyad || p.adSoyad,
                  telefon: d.telefon || p.telefon || undefined,
                  unvan: d.unvan || p.pozisyon || undefined,
                });
              }}
              options={personelSecenek.map((x) => ({
                value: x.sicil,
                label: `${x.adSoyad} · ${x.sicil}${x.pozisyon ? ` · ${x.pozisyon}` : ""}${x.isYeri ? ` (${x.isYeri})` : ""}`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="adSoyad"
            label="Ad Soyad"
            rules={[{ required: true, message: "Ad soyad giriniz." }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="unvan"
            label="Ünvan"
            extra="Görüşme davet mailinde imza olarak görünür."
          >
            <Input placeholder="Örn: İnsan Kaynakları Uzmanı" maxLength={100} />
          </Form.Item>

          <Form.Item name="telefon" label="Cep Telefonu">
            <Input placeholder="0532 000 00 00" maxLength={25} />
          </Form.Item>

          {/* Mikro kullanıcı numarası (09.10.2026): İşe Al ekranından
              açılan sicil kartı ve personel kartından yapılan değişiklikler
              Mikro'da bu kullanıcı adına işlenir. */}
          <Form.Item
            name="mikroKullaniciNo"
            label="Mikro kullanıcı no"
            extra="İK uzmanının Mikro'daki kullanıcı numarası (ör. 130). İşe Al ekranından Mikro'da açılan sicil kartı ve personel kartındaki değişiklikler bu kullanıcı adına kaydedilir. Boşsa bu kullanıcı Mikro'da sicil açamaz."
          >
            <InputNumber min={1} max={99999} precision={0} style={{ width: "100%" }} placeholder="Ör. 130" />
          </Form.Item>

          <Form.Item
            name="bolge"
            label="Bölge"
            extra={
              bolgeSecenekleri.length === 0
                ? "Önce Form Ayarları ekranından bölge tanımlayınız."
                : "Birden fazla bölge seçebilirsiniz; şubeler birleştirilerek yetkiye tanımlanır."
            }
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              placeholder="Bölge seçiniz (birden fazla olabilir)"
              options={bolgeSecenekleri.map((b) => ({
                value: b.ad,
                label: `${b.ad} (${b.subeler?.length ?? 0} şube)`,
              }))}
            />
          </Form.Item>

          <Form.Item name="eposta" label="E-posta" rules={[{ type: "email" }]}>
            <Input />
          </Form.Item>

          <Form.Item name="rol" label="Rol" initialValue="IK">
            <Select
              options={(rolSecenekleri.length > 0
                ? rolSecenekleri
                : Object.keys(ROL_ADLARI).map((k) => ({ kod: k, ad: ROL_ADLARI[k] }))
              ).map((r: any) => ({
                value: r.kod,
                label:
                  r.ad
                  + (SABIT_ROL_OZETI[r.kod]
                    ? ` · ${SABIT_ROL_OZETI[r.kod]}`
                    : r.temel
                      ? ` · ${ROL_ADLARI[r.temel] ?? r.temel} yetkileriyle`
                      : ""),
              }))}
            />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(o, y) => o.rol !== y.rol || o.bolge !== y.bolge}
          >
            {({ getFieldValue }) =>
              getFieldValue("bolge")?.length > 0 ? (
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`Yetkili şubeler ${
                    getFieldValue("bolge").length
                  } bölgeden alınacak`}
                  description={
                    Array.from(
                      new Set(
                        bolgeSecenekleri
                          .filter((b) => getFieldValue("bolge").includes(b.ad))
                          .flatMap((b) => b.subeler ?? [])
                      )
                    )
                      .map(
                        (k) => subeSecenekleri.find((x) => x.kod === k)?.ad ?? k
                      )
                      .join(", ") || "Seçilen bölgelere henüz şube tanımlanmamış."
                  }
                />
              ) : (
                ["BolgeMuduru", "IK"].includes(getFieldValue("rol")) && (
                <Form.Item
                  name="subeler"
                  label="Yetkili Şubeler"
                  rules={[
                    {
                      validator: (_, v) =>
                        v && v.length > 0
                          ? Promise.resolve()
                          : Promise.reject(new Error("En az bir şube seçiniz.")),
                    },
                  ]}
                  extra="Bölge müdürü yalnızca bu şubelerin başvurularını görür ve durum değiştiremez. İK uzmanı ise bu şubelere ait görüşme bildirimlerini alır."
                >
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    placeholder="Şubeleri seçiniz"
                    options={subeSecenekleri.map((x) => ({
                      value: x.kod,
                      label: `${x.ad} · ${x.tur}`,
                    }))}
                  />
                </Form.Item>
                )
              )
            }
          </Form.Item>

          <Form.Item
            name="parola"
            label="Parola"
            extra="En az 8 karakter, harf ve rakam içermeli. Mevcut kullanıcıyı düzenlerken boş bırakırsanız parola değişmez."
            rules={[
              {
                validator: (_, v) => {
                  if (!v) return Promise.resolve();

                  if (v.length < 8)
                    return Promise.reject(
                      new Error("Parola en az 8 karakter olmalıdır.")
                    );

                  if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(v) || !/\d/.test(v))
                    return Promise.reject(
                      new Error("Parola hem harf hem rakam içermelidir.")
                    );

                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Form.Item name="aktif" valuePropName="checked" initialValue={true}>
            <Checkbox>Hesap aktif</Checkbox>
          </Form.Item>

          <Form.Item
            name="onayYetkisi"
            valuePropName="checked"
            initialValue={false}
            extra="Bu kullanıcı, İK tarafından girilen işe alım bilgilerini onaylayabilir. Yöneticiler bu yetkiye zaten sahiptir."
          >
            <Checkbox>İşe alım onaylayabilir</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

/* ========================================================================== */

/* ======================================================================= */
/* Çıkış mülakatı ayarları                                                */
/* ======================================================================= */

/**
 * Çıkış mülakatında sorulacak soruların havuzu ve çıkış nedenleri.
 *
 * Sorular koda gömülü değildir: mülakat açılırken bu havuzdan rastgele
 * seçilir. Havuzu geniş tutmak, her görüşmede farklı soruların sorulmasını
 * ve zamanla daha çok konunun kapsanmasını sağlar.
 */
function CikisMulakatAyari() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [sorular, setSorular] = useState<string[]>([]);
  const [nedenler, setNedenler] = useState<string[]>([]);
  const [puanlamalar, setPuanlamalar] = useState<string[]>([]);
  const [soruSayisi, setSoruSayisi] = useState(5);
  const [anketMesaji, setAnketMesaji] = useState("");

  const getir = async () => {
    setYukleniyor(true);
    try {
      const a = await api.al<any>("/api/CikisMulakat/Ayar");
      setSorular(a.sorular ?? []);
      setNedenler(a.nedenler ?? []);
      setPuanlamalar(a.puanlamalar ?? []);
      setSoruSayisi(a.soruSayisi ?? 5);
      setAnketMesaji(a.anketMesaji ?? "");
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
  }, []);

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      await api.gonder("/api/CikisMulakat/Ayar", {
        sorular: sorular.filter((x) => x.trim()),
        nedenler: nedenler.filter((x) => x.trim()),
        puanlamalar: puanlamalar.filter((x) => x.trim()),
        soruSayisi,
        anketMesaji,
      });
      message.success("Kaydedildi.");
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  /* SMS uzunluğu: Türkçe karakter varsa mesaj 160 yerine 70 karaktere
     düşer (UCS-2 kodlaması). Kullanıcı kaç SMS gideceğini görmeden
     metni uzatırsa maliyet sessizce katlanıyor. */
  const smsOnizleme = (anketMesaji || VARSAYILAN_ANKET_MESAJI)
    .replace("{ad}", "Ayşe")
    .replace("{link}", "kariyer.bicen.com.tr/#/anket/7K3M9P");

  const turkceVar = /[çğıöşüÇĞİÖŞÜ]/.test(smsOnizleme);
  const parcaBoyu = turkceVar ? 70 : 160;
  const parcaSayisi = Math.max(1, Math.ceil(smsOnizleme.length / parcaBoyu));

  return (
    <div style={{ maxWidth: 860 }}>
      {/* ------------------------------------------- anket SMS metni */}
      <Title level={5} style={{ marginTop: 0 }}>
        Anket Davet Mesajı
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Ayrılan personele gönderilen SMS. <b>{"{ad}"}</b> kişinin ilk adıyla,{" "}
        <b>{"{link}"}</b> kişiye özel bağlantıyla değişir. Boş bırakırsanız
        varsayılan metin kullanılır.
      </Paragraph>

      <Input.TextArea
        rows={4}
        value={anketMesaji}
        onChange={(e) => setAnketMesaji(e.target.value)}
        placeholder={VARSAYILAN_ANKET_MESAJI}
        maxLength={480}
      />

      <div
        style={{
          background: "#fbfcfa",
          border: "1px solid #e3e6e1",
          borderRadius: 8,
          padding: "10px 13px",
          marginTop: 8,
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <Text type="secondary">Gidecek mesaj:</Text>
        </div>

        <div style={{ marginBottom: 8 }}>{smsOnizleme}</div>

        <Space size={10} wrap>
          <Tag>{smsOnizleme.length} karakter</Tag>
          <Tag color={parcaSayisi > 1 ? "orange" : "green"}>
            {parcaSayisi} SMS
          </Tag>
          {turkceVar && (
            <Tooltip title="Türkçe karakter içeren mesajlar farklı kodlanır ve tek SMS 160 yerine 70 karakter taşır. Metni kısaltmak ya da Türkçe karakter kullanmamak gönderim sayısını düşürür.">
              <Tag color="orange">Türkçe karakter · 70 karakter sınırı</Tag>
            </Tooltip>
          )}
        </Space>
      </div>

      <Divider />

      <Title level={5} style={{ marginTop: 0 }}>
        Çıkış Mülakatı Soruları
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Mülakat açıldığında bu havuzdan rastgele soru seçilir. Havuzu geniş
        tutarsanız her görüşmede farklı sorular sorulur ve zamanla daha çok
        konu kapsanır. İK uzmanı cevapladığı soruları koruyup diğerlerini
        değiştirebilir.
      </Paragraph>

      <Space style={{ marginBottom: 12 }} wrap>
        <Text style={{ fontSize: 13 }}>Mülakatta gösterilecek soru sayısı:</Text>
        <InputNumber
          min={1}
          max={20}
          value={soruSayisi}
          onChange={(v) => setSoruSayisi(Number(v) || 5)}
        />
        <Button loading={yukleniyor} onClick={getir}>
          Yenile
        </Button>
        <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
          Kaydet
        </Button>
      </Space>

      {sorular.map((soru, sira) => (
        <Row gutter={[8, 8]} key={sira} style={{ marginBottom: 8 }}>
          <Col flex="auto">
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 3 }}
              value={soru}
              onChange={(e) => {
                const yeni = [...sorular];
                yeni[sira] = e.target.value;
                setSorular(yeni);
              }}
            />
          </Col>
          <Col>
            <Button
              danger
              type="text"
              icon={<Trash2 size={15} strokeWidth={2} />}
              onClick={() => setSorular(sorular.filter((_, i) => i !== sira))}
            />
          </Col>
        </Row>
      ))}

      <Button
        icon={<Plus size={15} strokeWidth={2} />}
        onClick={() => setSorular([...sorular, ""])}
      >
        Soru ekle
      </Button>

      <Title level={5} style={{ marginTop: 26 }}>
        Puanlama Başlıkları (1-5)
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Bu başlıklar <b>her mülakatta</b> sorulur; açık uçlu sorular gibi
        rastgele seçilmez. Sebebi karşılaştırılabilirlik: aynı ölçüt her
        görüşmede sorulmazsa şubeler ve dönemler arası ortalama alınamaz.
        Listeyi kısa tutun, uzun listeler görüşmeyi yorar.
      </Paragraph>

      <Select
        mode="tags"
        style={{ width: "100%", marginBottom: 8 }}
        placeholder="Başlık yazıp Enter'a basınız"
        value={puanlamalar}
        onChange={setPuanlamalar}
        options={puanlamalar.map((x) => ({ value: x, label: x }))}
      />

      <Title level={5} style={{ marginTop: 26 }}>
        Çıkış Nedenleri
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Mülakat kaydedilirken seçilen liste. Raporlamada bu nedenlere göre
        gruplama yapılır.
      </Paragraph>

      <Select
        mode="tags"
        style={{ width: "100%" }}
        placeholder="Neden yazıp Enter'a basınız"
        value={nedenler}
        onChange={setNedenler}
        options={nedenler.map((x) => ({ value: x, label: x }))}
      />
    </div>
  );
}

/* ======================================================================= */
/* SMS doğrulama kodu havuzu                                              */
/* ======================================================================= */

/**
 * Başvuru formunda gönderilen SMS doğrulama kodları buradan yüklenir.
 * Sistem kendisi kod üretmez: yalnızca bu havuzdaki kodlar gönderilir,
 * gönderilen kod havuzdan silinir ve bir daha kullanılmaz. Havuz boşsa
 * kod gönderilemez, dolayısıyla yeni başvuru da alınamaz.
 */
function KodHavuzu() {
  const { message, modal } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [isleniyor, setIsleniyor] = useState(false);
  const [durum, setDurum] = useState<{
    adet: number;
    sonYukleme: string | null;
  }>({ adet: 0, sonYukleme: null });

  const dosyaRef = useRef<HTMLInputElement>(null);

  const getir = async () => {
    setYukleniyor(true);
    try {
      setDurum(await api.al("/api/KaraListe/KodHavuzu"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
  }, []);

  const dosyaSecildi = async (olay: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = olay.target.files?.[0];
    if (!dosya) return;

    if (dosya.size > 2 * 1024 * 1024) {
      message.error("Dosya 2 MB'tan büyük olamaz.");
      if (dosyaRef.current) dosyaRef.current.value = "";
      return;
    }

    setIsleniyor(true);

    try {
      const icerik = await dosya.text();

      const sonuc = await api.gonder<any>("/api/KaraListe/KodHavuzu", {
        icerik,
      });

      message.success(
        `${sonuc.eklenen} kod eklendi` +
          (sonuc.atlanan > 0 ? `, ${sonuc.atlanan} tanesi atlandı` : "") +
          `. Havuzda ${sonuc.kalan} kod var.`
      );

      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIsleniyor(false);
      if (dosyaRef.current) dosyaRef.current.value = "";
    }
  };

  const temizle = () => {
    modal.confirm({
      title: "Havuzdaki tüm kodlar silinsin mi?",
      content:
        "Havuz boşalınca yeni doğrulama kodu gönderilemez ve yeni başvuru alınamaz.",
      okText: "Evet, sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const sonuc = await api.sil<any>("/api/KaraListe/KodHavuzu");
          message.success(`${sonuc.silinen} kod silindi.`);
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        SMS Doğrulama Kod Havuzu
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Başvuru formunda adaylara gönderilen doğrulama kodları yalnızca bu
        havuzdan alınır. Gönderilen kod havuzdan silinir, aynı kod ikinci kez
        gönderilmez. Havuz boşsa kod gönderilemez ve yeni başvuru alınamaz.
      </Paragraph>

      <Alert
        type={durum.adet === 0 ? "error" : durum.adet < 50 ? "warning" : "info"}
        showIcon
        style={{ marginBottom: 14 }}
        message={
          durum.adet === 0
            ? "Havuz boş — şu anda yeni başvuru alınamıyor"
            : `Havuzda ${durum.adet} kod var`
        }
        description={
          durum.adet > 0 && durum.adet < 50
            ? "Kodlar azalıyor; yeni bir liste yüklemeniz önerilir."
            : undefined
        }
      />

      <Space wrap>
        <input
          ref={dosyaRef}
          type="file"
          accept=".txt,text/plain"
          style={{ display: "none" }}
          onChange={dosyaSecildi}
        />

        <Button
          type="primary"
          loading={isleniyor}
          onClick={() => dosyaRef.current?.click()}
        >
          TXT dosyası yükle
        </Button>

        <Button loading={yukleniyor} onClick={getir}>
          Yenile
        </Button>

        <Button danger onClick={temizle}>
          Havuzu temizle
        </Button>
      </Space>

      <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 14 }}>
        Dosya biçimi: her satırda bir kod. Virgül, noktalı virgül ve sekme ile
        ayrılmış listeler de kabul edilir. Boş satırlar, tekrar edenler ve
        havuzda zaten bulunan kodlar atlanır. Kod en fazla 20 karakter olabilir.
      </Paragraph>

      <KodSiniri />
    </div>
  );
}

/**
 * Günlük kod sınırına yaklaşan / aşan numaralar.
 *
 * Sınır numara başına 24 saatte 5 istektir. Sınırı aşan aday çoğu zaman
 * gerçekten sıkışmış olur: kod ulaşmamış, numarayı yanlış girip düzeltmiş
 * olabilir. Buradan görüp sayacını sıfırlayabilirsiniz.
 */
function KodSiniri() {
  const { message, modal } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [sinir, setSinir] = useState(5);
  const [liste, setListe] = useState<any[]>([]);

  const getir = async () => {
    setYukleniyor(true);
    try {
      const d = await api.al<any>("/api/KaraListe/KodSiniri");
      setSinir(d.sinir ?? 5);
      setListe(d.liste ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
  }, []);

  const sifirla = (telefon: string) => {
    modal.confirm({
      title: `${telefon} için sayaç sıfırlansın mı?`,
      content:
        "Son 24 saatteki kod istekleri silinir ve numara yeniden kod isteyebilir. " +
        "Adayın elindeki doğrulanmış ve henüz kullanılmamış kod varsa korunur.",
      okText: "Sıfırla",
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.gonder("/api/KaraListe/KodSiniri/Sifirla", { telefon });
          message.success("Sayaç sıfırlandı.");
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  return (
    <div style={{ marginTop: 28 }}>
      <Title level={5} style={{ marginBottom: 4 }}>
        Günlük Kod Sınırı
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Bir numara 24 saat içinde en fazla {sinir} kez kod isteyebilir. Aşağıda
        son 24 saatte {sinir > 3 ? 3 : sinir} ve üzeri istek yapan numaralar
        listelenir.
      </Paragraph>

      <Space style={{ marginBottom: 10 }}>
        <Button size="small" loading={yukleniyor} onClick={getir}>
          Yenile
        </Button>
      </Space>

      <Tablo
        rowKey="telefon"
        size="small"
        loading={yukleniyor}
        dataSource={liste}
        locale={{ emptyText: "Sınıra yaklaşan numara yok." }}
        pagination={false}
        columns={[
          { title: "Telefon", dataIndex: "telefon", width: 130 },
          {
            title: "İstek",
            dataIndex: "istek",
            width: 90,
            align: "center" as const,
            render: (v: number) => (
              <Tag color={v >= sinir ? "red" : "orange"}>
                {v} / {sinir}
              </Tag>
            ),
          },
          {
            title: "Doğrulanan",
            dataIndex: "dogrulanan",
            width: 100,
            align: "center" as const,
            render: (v: number) =>
              v > 0 ? <Tag color="green">{v}</Tag> : <Text type="secondary">—</Text>,
          },
          {
            title: "Son İstek",
            dataIndex: "sonIstek",
            width: 150,
            render: (v: string) =>
              v ? dayjs(v).format("DD.MM.YYYY HH:mm") : "—",
          },
          { title: "IP", dataIndex: "adres", width: 130, ellipsis: true },
          {
            title: "",
            key: "islem",
            width: 110,
            render: (_v: any, k: any) => (
              <Button size="small" onClick={() => sifirla(k.telefon)}>
                Sıfırla
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}

/** Anket davet SMS'inin varsayılan metni; sunucudaki karşılığıyla aynı */
const VARSAYILAN_ANKET_MESAJI =
  "Merhaba {ad}, Biçen'deki deneyiminizi değerlendirmeniz bizim için " +
  "değerli. 2 dakikanızı ayırır mısınız? {link} Yanıtlarınız gizli tutulur, " +
  "üçüncü kişilerle paylaşılmaz.";

/**
 * Menü Sırası
 * ---------------------------------------------------------------------------
 * Sol menüdeki sayfaların sırası. Yalnızca sıra değişir; hangi kullanıcının
 * neyi göreceği rollere bağlı kalır ve buradan etkilenmez.
 *
 * Listede olmayan sayfalar sona eklenir — yeni bir sayfa geldiğinde ayar
 * bozulmasın diye.
 */
/**
 * Rol Yetkileri
 * ---------------------------------------------------------------------------
 * Her rolün hangi menüleri göreceği, hangi alanları görmeyeceği ve
 * düzenleme yapıp yapamayacağı.
 *
 * Maskeleme sunucuda uygulanır: burada bir alanı işaretlemek onu yalnızca
 * ekrandan gizlemekle kalmaz, veriyi sunucudan da göndermez.
 */
/**
 * Menü anahtarları ve okunur adları.
 *
 * App.tsx'teki menü anahtarlarıyla BİREBİR aynı olmalıdır; uyuşmayan bir
 * anahtar sıralamaya da yetkiye de girmez ve sessizce göz ardı edilir.
 * Ön denetim bu uyumu kontrol ediyor.
 */
/** Rol yetkileri ekranında menülerin gruplandığı başlıklar */
const MENU_GRUPLARI: { ad: string; aciklama: string; keys: string[] }[] = [
  { ad: "İşe alım", aciklama: "Başvurudan işe alıma kadar olan süreç",
    keys: ["ozet", "basvurular", "havuz", "takvim", "kadro", "yonetimraporu"] },
  { ad: "Personel", aciklama: "Çalışan personel ve günlük İK işleri",
    keys: ["personeller", "izintalep", "yillikizin", "cikismulakat", "sirkulasyon",
           "mobilduyuru", "haberler", "checklist", "isemri", "vardiyakarekod", "qr", "tahakkuk", "kazankazan"] },
  { ad: "Raporlar ve performans", aciklama: "Analiz ve değerlendirme ekranları",
    keys: ["rapor", "performans", "personelperformansGrup", "kunye", "izinucreti"] },
  { ad: "Yönetim", aciklama: "Ayarlar ve yalnızca yöneticiye açık araçlar",
    keys: ["yonetim", "zeka", "erisim"] },
];

/** Ayarla açılamayan, yalnızca Yönetici rolünde görünen sayfalar */
/* izinucreti: Yıllık İzin Ücretleri — kişi başı net maaş gösteriyor */
const YALNIZ_YONETICI_MENULER = ["zeka", "erisim", "izinucreti"];

/** Rolün ne için var olduğu; ekranda başlığın altında görünür */
const ROL_ACIKLAMALARI: Record<string, string> = {
  GenelMudurYardimcisi: "Tüm bölgeleri görür, işe alım onaylarını verir, norm kadro ve maaş skalasını düzenler.",
  IKYoneticisi: "İK ekibinin yöneticisi: uzmanların işini görür, gönderim ve havuz işlemlerini yapar, form ayarlarını düzenler.",
  IK: "İK uzmanı: kendi şubelerindeki başvuruları yürütür, görüşme ve işe alım yapar.",
  BolgeMuduru: "Kendi bölgesinin özetini ve raporlarını görür; kayıt değiştiremez.",
  BolgeKoordinatoru: "Bölgeler arası koordinasyon: geniş görünüm, sınırlı işlem.",
  FotografGorevlisi: "Yalnızca personel fotoğrafı yükler.",
};

const MENU_TANIMLARI: { key: string; ad: string }[] = [
  /* Özet giriş sayfası: listede yokken bir rol için herhangi bir menü
     seçilince kayboluyordu. Kısıtlama yapılsa bile açık kalması için
     listenin başında duruyor ve "Tümünü seç" ile birlikte işaretleniyor. */
  { key: "ozet", ad: "Özet" },
  { key: "basvurular", ad: "Başvurular" },
  { key: "zeka", ad: "İnceleme" },
  { key: "erisim", ad: "Erişim Denetimi" },
  { key: "yonetimraporu", ad: "Yönetim Raporu" },
  { key: "havuz", ad: "Aday Havuzu" },
  { key: "takvim", ad: "Görüşme Takvimi" },
  { key: "cikismulakat", ad: "Çıkış Mülakatı" },
  { key: "personeller", ad: "Personeller" },
  { key: "izintalep", ad: "Personel Talepleri" },
  { key: "mobilduyuru", ad: "Duyurular" },
  { key: "haberler", ad: "Biçen'den Haberler" },
  { key: "yillikizin", ad: "İzin Yönetimi" },
  { key: "sirkulasyon", ad: "Sirkülasyon" },
  { key: "kadro", ad: "Norm Kadro" },
  { key: "rapor", ad: "Raporlar" },
  { key: "vardiyakarekod", ad: "Vardiya Karekodları" },
  { key: "qr", ad: "QR Kodlar" },
  { key: "tahakkuk", ad: "Tahakkuk" },
  { key: "yonetim", ad: "Yönetim" },
  { key: "performans", ad: "İK Performans" },
  { key: "personelperformansGrup", ad: "Personel Performansı" },
  { key: "checklist", ad: "Kontrol Listeleri" },
  { key: "pusula", ad: "Ücret Pusulaları" },
  { key: "izinduzeni", ad: "İzin Düzeni" },
  { key: "egitim", ad: "Eğitim Dokümanları" },
  { key: "etik", ad: "Etik Hat" },
  { key: "isemri", ad: "İş Emirleri" },
  { key: "kunye", ad: "Künye Analizi" },
  { key: "kazankazan", ad: "Kazan-Kazan (yeni ürün, mağaza havuzu)" },
  { key: "izinucreti", ad: "Yıllık İzin Ücretleri" },
];

/**
 * Mobil Test Numarası
 * ---------------------------------------------------------------------------
 * Test sürecinde tek bir numaradan her personelin kimliğiyle giriş
 * yapabilmek için. Canlıya geçmeden boşaltılmalıdır.
 */
function MobilTest() {
  const { message, modal } = AntdApp.useApp();

  const [numara, setNumara] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = async () => {
    setYukleniyor(true);

    try {
      const d = await api.al<any>("/api/Ayar/FormGenel");
      setNumara(d?.mobilTestTelefon ?? "");
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
  }, []);

  const kaydet = async (deger: string) => {
    setKaydediliyor(true);

    try {
      const d = await api.gonder<any>("/api/Ayar/MobilTestTelefon", { deger });

      message.success(
        d.tanimli
          ? "Test numarası tanımlandı."
          : "Test numarası kaldırıldı."
      );

      setNumara(deger);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const kaydetSor = () => {
    const temiz = numara.replace(/\D/g, "");

    if (temiz.length === 0) {
      kaydet("");
      return;
    }

    modal.confirm({
      title: "Test numarası tanımlansın mı?",
      width: 460,
      content: (
        <Paragraph style={{ fontSize: 13.5, marginBottom: 0 }}>
          <b>{temiz}</b> numarasından <b>her personelin kimlik numarasıyla</b>{" "}
          giriş yapılabilecek ve o kişinin tüm verisi görülebilecek.
          <br />
          <br />
          Kimlik numarası kolay ulaşılabilir bir bilgidir. Test bittiğinde bu
          alanı boşaltınız.
        </Paragraph>
      ),
      okText: "Tanımla",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: () => kaydet(temiz),
    });
  };

  const tanimli = numara.replace(/\D/g, "").length === 10;

  /* Biçen bildirim sesleri (1.6): telefonda deneme */
  const [denemeSicil, setDenemeSicil] = useState("");
  const [deneniyor, setDeneniyor] = useState<string | null>(null);

  const sesDene = async (tur: string) => {
    if (!denemeSicil.trim()) {
      message.warning("Bildirimin gideceği personelin sicilini yazınız.");
      return;
    }

    setDeneniyor(tur);

    try {
      const d = await api.gonder<any>("/api/Ayar/BildirimSesiDene", { sicil: denemeSicil.trim(), tur });

      if (d.sesli) message.success("Deneme bildirimi gönderildi.");
      else
        message.warning(
          `Bildirim gönderildi ama telefondaki uygulama${d.surum ? ` (${d.surum})` : ""} 1.6'dan eski: varsayılan sesle çalar. Uygulamayı güncelleyip bir kez açınız.`,
          6
        );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setDeneniyor(null);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        Mobil Test Numarası
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Bu numaradan her personelin kimlik numarasıyla giriş yapılabilir ve
        cihaz kilidi uygulanmaz. Doğrulama kodu bu numaraya gelir.
        <b> Test sürecinde kullanılır; bittiğinde boşaltınız.</b>
        <br />
        <br />
        Her kullanım güvenlik günlüğüne yazılır — kimin hangi personel adına
        giriş yaptığı Erişim Denetimi ekranından görülebilir.
      </Paragraph>

      {tanimli && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Test numarası etkin"
          description={`${numara} numarasından tüm personel hesaplarına erişilebiliyor. Canlı kullanıma geçtiyseniz bu alanı boşaltınız.`}
        />
      )}

      {yukleniyor ? (
        <Spin />
      ) : (
        <>
          <Text strong style={{ fontSize: 13 }}>
            Telefon numarası
          </Text>

          <Input
            style={{ marginTop: 6, marginBottom: 14 }}
            placeholder="5xxxxxxxxx · kapatmak için boş bırakınız"
            maxLength={10}
            value={numara}
            onChange={(e) => setNumara(e.target.value.replace(/\D/g, ""))}
          />

          <Space>
            <Button
              type="primary"
              danger={numara.replace(/\D/g, "").length === 10}
              loading={kaydediliyor}
              onClick={kaydetSor}
            >
              Kaydet
            </Button>

            {tanimli && (
              <Button
                loading={kaydediliyor}
                onClick={() => {
                  setNumara("");
                  kaydet("");
                }}
              >
                Kaldır
              </Button>
            )}
          </Space>
        </>
      )}

      <Divider />

      <Title level={5} style={{ marginTop: 0 }}>
        Bildirim sesleri
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Biçen360 1.6 ve sonrasında bildirimler "Bi-çen, her za-man ta-ze" melodisiyle çalar.
        Onay isteyen bildirimler onay sesiyle, duyurular ve sabah özeti tam melodiyle, diğerleri
        kısa imzayla gelir. Personel her türün sesini telefon ayarlarından ayrıca kapatabilir.
      </Paragraph>

      {[
        { tur: "kisa", ad: "Kısa imza", alt: "izin, vardiya, Biçen Kart…", dosya: "bicen-taze-kisa.mp3" },
        { tur: "onay", ad: "Onay bekliyor", alt: "onayınızı bekleyen işler", dosya: "bicen-onay-bekliyor.mp3" },
        { tur: "genel", ad: "Tam melodi", alt: "duyurular, sabah özeti", dosya: "bicen-her-zaman-taze.mp3" },
      ].map((x) => (
        <div
          key={x.tur}
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid #eef1ea" }}
        >
          <div style={{ minWidth: 150 }}>
            <Text strong>{x.ad}</Text>
            <div style={{ fontSize: 12, color: "#7b8577" }}>{x.alt}</div>
          </div>
          <audio controls preload="none" src={`${import.meta.env.BASE_URL}sesler/${x.dosya}`} style={{ height: 32, maxWidth: 230 }} />
          <Button size="small" loading={deneniyor === x.tur} onClick={() => sesDene(x.tur)}>
            Telefona gönder
          </Button>
        </div>
      ))}

      <Input
        style={{ marginTop: 10, maxWidth: 260 }}
        placeholder="Deneme için personel sicili"
        value={denemeSicil}
        onChange={(e) => setDenemeSicil(e.target.value)}
      />
    </div>
  );
}

/* ========================================================================== */
/* Rol tanımları                                                              */
/* ========================================================================== */

/**
 * Panelden rol açma penceresi.
 *
 * Her rol bir temel rolün davranışını devralıyor: sunucudaki kurallar
 * (onay verme, bölge sınırı, özel veri görme) rol adına bakıyor ve yeni bir
 * kod bunların hiçbiriyle eşleşmiyor. Temel seçilmeseydi rol hiçbir şey
 * göremeyen boş bir kabuk olurdu.
 */
function RolTanimlari({
  acik,
  kapat,
  bitti,
}: {
  acik: boolean;
  kapat: () => void;
  bitti: () => void;
}) {
  const { message, modal } = AntdApp.useApp();

  const [roller, setRoller] = useState<any[]>([]);
  const [temeller, setTemeller] = useState<any[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = async () => {
    setYukleniyor(true);

    try {
      const d = await api.al<any>("/api/Ayar/Roller");

      setRoller((d?.roller ?? []).filter((r: any) => r.ozel));
      setTemeller(d?.temeller ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    if (acik) getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);

  const guncelle = (sira: number, alan: string, deger: any) =>
    setRoller(roller.map((r, i) => (i === sira ? { ...r, [alan]: deger } : r)));

  /* Kod addan türetiliyor: kullanıcıya iki alan doldurtmak gereksiz ve
     yanlış yazılan bir kod jetonda eşleşmiyor. Türkçe harfler
     karşılıklarına çevriliyor. */
  const kodTuret = (ad: string) => {
    const harf: Record<string, string> = {
      ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
      Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U",
    };

    return (ad ?? "")
      .split("")
      .map((c) => harf[c] ?? c)
      .join("")
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .split(" ")
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join("");
  };

  const ekle = () =>
    setRoller([
      ...roller,
      { kod: "", ad: "", temel: "BolgeMuduru", aciklama: "", ozel: true, yeni: true },
    ]);

  const kaydet = async () => {
    for (const r of roller) {
      if (!(r.ad ?? "").trim()) {
        message.error("Rol adı boş bırakılamaz.");
        return;
      }
    }

    setKaydediliyor(true);

    try {
      const govde = roller.map((r) => ({
        kod: (r.kod || kodTuret(r.ad)).trim(),
        ad: (r.ad ?? "").trim(),
        temel: r.temel,
        aciklama: (r.aciklama ?? "").trim(),
      }));

      await api.gonder("/api/Ayar/Roller", govde);

      rolAdlariniYaz(govde.map((r) => ({ ...r, ozel: true })));

      message.success(
        "Roller kaydedildi. Yetkilerini aşağıdan ayarlayabilirsiniz."
      );

      bitti();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const sil = (sira: number) => {
    const rol = roller[sira];

    modal.confirm({
      title: "Rol silinsin mi?",
      content: `"${rol.ad || rol.kod}" rolü listeden kaldırılacak. `
        + "Bu role atanmış kullanıcı varsa sunucu silmeyi reddeder; "
        + "önce o kullanıcıların rolünü değiştirmeniz gerekir.",
      okText: "Sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: () => setRoller(roller.filter((_, i) => i !== sira)),
    });
  };

  return (
    <Modal
      open={acik}
      onCancel={kapat}
      title="Rolleri Yönet"
      width={820}
      okText="Kaydet"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      onOk={kaydet}
    >
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Temel rol, yeni rolün sunucu tarafındaki davranışını belirler: hangi
        şubeleri görür, kayıt değiştirebilir mi, adayın kimlik ve ücret
        bilgisini görebilir mi. Menü ve alan ayrıntısı Rol Yetkileri'nden
        ayarlanır. Rol kodu kaydedildikten sonra değiştirilemez — kod
        kullanıcıların jetonunda taşınıyor.
      </Paragraph>

      {yukleniyor ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {roller.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 13 }}>
              Henüz özel rol yok. Aşağıdan ekleyebilirsiniz.
            </Text>
          ) : null}

          {roller.map((r, i) => (
            <Card key={i} size="small">
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space wrap style={{ width: "100%" }}>
                  <Input
                    value={r.ad}
                    onChange={(e) => guncelle(i, "ad", e.target.value)}
                    placeholder="Rol adı (ör. Mağaza Müdürü)"
                    style={{ width: 240 }}
                  />

                  <Select
                    value={r.temel}
                    onChange={(v) => guncelle(i, "temel", v)}
                    style={{ width: 230 }}
                    options={temeller.map((t: any) => ({
                      value: t.kod,
                      label: `${t.ad} gibi davransın`,
                    }))}
                  />

                  <Text type="secondary" style={{ fontSize: 12 }}>
                    kod: {r.kod || kodTuret(r.ad) || "—"}
                  </Text>

                  <Button
                    danger
                    size="small"
                    icon={<Trash2 size={14} />}
                    onClick={() => sil(i)}
                  />
                </Space>

                <Input
                  value={r.aciklama}
                  onChange={(e) => guncelle(i, "aciklama", e.target.value)}
                  placeholder="Rolün ne için var olduğu (isteğe bağlı)"
                />
              </Space>
            </Card>
          ))}

          <Button icon={<UserPlus size={15} />} onClick={ekle} block>
            Rol Ekle
          </Button>
        </Space>
      )}
    </Modal>
  );
}

function RolYetkileri() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yetkiler, setYetkiler] = useState<Record<string, any>>({});
  const [seciliRol, setSeciliRol] = useState<string | undefined>();
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [rolPenceresi, setRolPenceresi] = useState(false);

  /* Menü listesi, sıralama ekranıyla aynı kaynaktan gelmeli */
  const MENULER = MENU_TANIMLARI;

  const getir = async () => {
    setYukleniyor(true);

    try {
      const d = await api.al<any>("/api/Ayar/RolYetkileri");

      setVeri(d);
      /* Eski anahtar: Ücret Pusulaları "tahakkuk" adıyla kaydedilmişti */
      const gelen: Record<string, any> = d?.yetkiler ?? {};
      Object.values(gelen).forEach((y: any) => {
        if (Array.isArray(y?.menuler) && y.menuler.includes("tahakkuk"))
          y.menuler = Array.from(new Set(y.menuler.map((k: string) => (k === "tahakkuk" ? "pusula" : k))));
      });
      setYetkiler(gelen);

      if (!seciliRol && d?.roller?.length) setSeciliRol(d.roller[0].kod);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
  }, []);

  const rolAyari = seciliRol
    ? yetkiler[seciliRol] ?? {
        menuler: [],
        saltOkunur: false,
        gizliAlanlar: [],
        gizliSekmeler: [],
      }
    : null;

  const guncelle = (alan: string, deger: any) => {
    if (!seciliRol) return;

    setYetkiler({
      ...yetkiler,
      [seciliRol]: { ...rolAyari, [alan]: deger },
    });
  };

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("/api/Ayar/RolYetkileri", yetkiler);
      message.success("Yetkiler kaydedildi. Açık panellerde birkaç dakika içinde (sekmeye dönüldüğünde hemen) geçerli olur; yeniden giriş gerekmez.");
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const menuAdi = (key: string) => MENULER.find((m) => m.key === key)?.ad ?? sayfaAdi(key);
  const [gorunum, setGorunum] = useState<"rol" | "tablo">("rol");

  const secili = new Set<string>(rolAyari?.menuler ?? []);
  const kisitli = secili.size > 0;

  const grupDegistir = (keys: string[], ac: boolean) => {
    const yeni = new Set(secili);
    keys.forEach((k) => (ac ? yeni.add(k) : yeni.delete(k)));
    guncelle("menuler", TUM_SAYFA_ANAHTARLARI.filter((k) => yeni.has(k)));
  };

  const rolBilgisi = (veri?.roller ?? []).find((r: any) => r.kod === seciliRol);

  /* Açıklama: sabit rollerde koddaki metin, panelden açılanlarda rolü
     tanımlayan kişinin yazdığı satır. */
  const rolAciklamasi =
    (seciliRol ? ROL_ACIKLAMALARI[seciliRol] : "") || rolBilgisi?.aciklama || "";

  return (
    <div style={{ maxWidth: 1000 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        Rol Yetkileri
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Her rol için üç şey belirlenir: hangi menüleri görür, hangi alanlar
        ondan gizlenir, hangi sayfa bölümlerine giremez. Gizlenen alanlar
        sunucudan hiç gönderilmez. Değişiklik açık panellerde birkaç dakika
        içinde kendiliğinden geçerli olur; yeniden giriş gerekmez.
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="Yeni rol açabilirsiniz"
        description={
          <span style={{ fontSize: 12.5 }}>
            Aşağıdaki <b>Rolleri Yönet</b> düğmesiyle kendi rolünüzü
            açabilirsiniz. Her yeni rol, davranışını bir temel rolden
            devralır: veri kapsamı (kendi bölgesi mi, hepsi mi), işlem
            yetkisi ve gizlenen alanlar oradan gelir. Rolü asıl ayıran şey
            bu ekrandaki menü, alan ve sekme seçimleridir. Yönetici rolü
            ne temel alınabilir ne de kısıtlanabilir — yanlış bir ayarla
            herkesin erişimi kesilirse düzeltecek biri kalmalıdır.
          </span>
        }
      />

      <div style={{ marginBottom: 14 }}>
        <Button icon={<ShieldAlert size={15} />} onClick={() => setRolPenceresi(true)}>
          Rolleri Yönet
        </Button>
      </div>

      <RolTanimlari
        acik={rolPenceresi}
        kapat={() => setRolPenceresi(false)}
        bitti={() => {
          setRolPenceresi(false);
          getir();
        }}
      />

      {yukleniyor ? (
        <Spin />
      ) : (
        <>
          <Segmented
            style={{ marginBottom: 12 }}
            value={gorunum}
            onChange={(v) => setGorunum(v as any)}
            options={[
              { label: "Rol bazında", value: "rol" },
              { label: "Sayfa × rol tablosu", value: "tablo" },
            ]}
          />

          {gorunum === "tablo" && (
            <Card
              size="small"
              style={{ marginBottom: 12 }}
              title="Hangi sayfayı hangi rol görür"
              extra={
                <Space>
                  <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
                    Kaydet
                  </Button>
                  <Button onClick={getir}>Geri al</Button>
                </Space>
              }
            >
              <RolYetkiTablosu
                roller={veri?.roller ?? []}
                yetkiler={yetkiler}
                degistir={(rol, menuler) =>
                  setYetkiler((y) => ({
                    ...y,
                    [rol]: { saltOkunur: false, gizliAlanlar: [], gizliSekmeler: [], ...(y[rol] ?? {}), menuler },
                  }))
                }
              />
            </Card>
          )}

          {gorunum === "rol" && (<>
          <div className="ry-roller">
            {(veri?.roller ?? []).map((r: any) => {
              const ay = yetkiler[r.kod] ?? {};
              const menuSayisi = (ay.menuler ?? []).length;

              return (
                <div
                  key={r.kod}
                  className={"ry-rol" + (seciliRol === r.kod ? " ry-rol-secili" : "")}
                  onClick={() => setSeciliRol(r.kod)}
                >
                  <div className="ry-rol-ad">{r.ad}</div>
                  <div className="ry-rol-alt">
                    {menuSayisi > 0 ? `${menuSayisi} menü` : "varsayılan menüler"}
                    {ay.saltOkunur ? " · salt okunur" : ""}
                    {(ay.gizliAlanlar ?? []).length > 0
                      ? ` · ${ay.gizliAlanlar.length} gizli alan`
                      : ""}
                  </div>
                </div>
              );
            })}
          </div>

          {rolAyari && (
            <>
              <Card size="small" style={{ marginBottom: 12 }}>
                <Space align="start" style={{ width: "100%", justifyContent: "space-between" }} wrap>
                  <div>
                    <Text strong style={{ fontSize: 15 }}>{rolBilgisi?.ad ?? seciliRol}</Text>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12.5 }}>
                        {rolAciklamasi}
                        {rolBilgisi?.ozel && rolBilgisi?.temel
                          ? `${rolAciklamasi ? " · " : ""}${
                              ROL_ADLARI[rolBilgisi.temel] ?? rolBilgisi.temel
                            } yetkileriyle`
                          : ""}
                      </Text>
                    </div>
                  </div>
                  <Space>
                    <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
                      Kaydet
                    </Button>
                    <Button onClick={getir}>Geri al</Button>
                  </Space>
                </Space>
              </Card>

              <Card
                size="small"
                style={{ marginBottom: 12 }}
                title={
                  <Space size={8}>
                    <span>Görebileceği menüler</span>
                    <Tag color={kisitli ? "green" : "default"}>
                      {kisitli ? `${secili.size} seçili` : "kısıtlama yok"}
                    </Tag>
                  </Space>
                }
                extra={
                  <Space size={6}>
                    <Button
                      size="small"
                      onClick={() =>
                        guncelle(
                          "menuler",
                          TUM_SAYFA_ANAHTARLARI.filter((k) => !YALNIZ_YONETICI_MENULER.includes(k))
                        )
                      }
                    >
                      Tümünü seç
                    </Button>
                    <Button size="small" onClick={() => guncelle("menuler", [])}>
                      Temizle
                    </Button>
                  </Space>
                }
              >
                <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                  Hiçbiri seçili değilse rol, koddaki varsayılan menülerini
                  görür. Bir menü işaretlediğiniz anda <b>yalnızca
                  işaretlediğiniz menüler</b> görünür; koddaki varsayılanlar
                  devreden çıkar. İnceleme ve Erişim Denetimi yalnızca
                  Yönetici'de açılır, buradan verilemez.
                </Paragraph>

                {SAYFA_GRUPLARI.map((g) => {
                  const grupKeys = g.sayfalar.flatMap((x) => [x.key, ...(x.alt ?? []).map((a) => a.key)]);
                  const seciliSayi = grupKeys.filter((k) => secili.has(k)).length;

                  const kutu = (k: string, ad: string, yalniz: boolean, girinti = false, altlar?: string[]) => {
                    const altSecili = altlar ? altlar.filter((a) => secili.has(a)).length : 0;
                    const acik = secili.has(k) || (!!altlar && altlar.length > 0 && altSecili === altlar.length);
                    return (
                      <label
                        key={k}
                        className={"ry-menu" + (acik ? " ry-menu-secili" : "") + (yalniz ? " ry-menu-pasif" : "")}
                        style={girinti ? { marginLeft: 22 } : undefined}
                      >
                        <Checkbox
                          checked={acik}
                          indeterminate={!!altlar && !secili.has(k) && altSecili > 0 && altSecili < altlar.length}
                          disabled={yalniz}
                          onChange={(e) => grupDegistir(altlar ? [k, ...altlar] : [k], e.target.checked)}
                        />
                        <span>{girinti ? `↳ ${ad}` : ad}</span>
                        {yalniz && <Tag style={{ marginLeft: "auto" }}>yalnızca yönetici</Tag>}
                      </label>
                    );
                  };

                  return (
                    <div className="ry-grup" key={g.ad}>
                      <div className="ry-grup-baslik">
                        <div>
                          <b>{g.ad}</b>
                          <span className="ry-grup-aciklama"> · {g.aciklama}</span>
                        </div>
                        <Space size={4}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {seciliSayi}/{grupKeys.length}
                          </Text>
                          <Button size="small" type="text" onClick={() => grupDegistir(grupKeys.filter((k) => !YALNIZ_YONETICI_MENULER.includes(k)), true)}>
                            hepsi
                          </Button>
                          <Button size="small" type="text" onClick={() => grupDegistir(grupKeys, false)}>
                            hiçbiri
                          </Button>
                        </Space>
                      </div>

                      <div className="ry-menuler">
                        {g.sayfalar.flatMap((x) => [
                          kutu(x.key, x.ad, !!x.yalnizYonetici || YALNIZ_YONETICI_MENULER.includes(x.key), false, x.alt?.map((a) => a.key)),
                          ...(x.alt ?? []).map((a) => kutu(a.key, a.ad, false, true)),
                        ])}
                      </div>
                    </div>
                  );
                })}
              </Card>

              <Row gutter={[12, 12]}>
                <Col xs={24} lg={12}>
                  <Card size="small" title="İşlem yetkisi" style={{ marginBottom: 12 }}>
                    <label className={"ry-menu" + (rolAyari.saltOkunur ? " ry-menu-secili" : "")}>
                      <Checkbox
                        checked={rolAyari.saltOkunur === true}
                        onChange={(e) => guncelle("saltOkunur", e.target.checked)}
                      />
                      <div>
                        <b style={{ fontSize: 13 }}>Yalnızca görüntüleyebilir</b>
                        <div style={{ fontSize: 12, color: "var(--metin-pasif)" }}>
                          Sayfaları açar; kayıt ekleyemez, düzenleyemez, durum
                          değiştiremez.
                        </div>
                      </div>
                    </label>
                  </Card>

                  <Card size="small" title="Gizlenecek alanlar">
                    <Paragraph type="secondary" style={{ fontSize: 12 }}>
                      İşaretlenen alan bu role sunucudan gönderilmez.
                    </Paragraph>
                    <div className="ry-menuler ry-tek">
                      {(veri?.alanlar ?? []).map((al: any) => {
                        const acik = (rolAyari.gizliAlanlar ?? []).includes(al.kod);

                        return (
                          <label key={al.kod} className={"ry-menu" + (acik ? " ry-menu-secili" : "")}>
                            <Checkbox
                              checked={acik}
                              onChange={(e) => {
                                const y = new Set(rolAyari.gizliAlanlar ?? []);
                                if (e.target.checked) y.add(al.kod); else y.delete(al.kod);
                                guncelle("gizliAlanlar", Array.from(y));
                              }}
                            />
                            <div>
                              <b style={{ fontSize: 13 }}>{al.ad}</b>
                              <div style={{ fontSize: 11.5, color: "var(--metin-pasif)" }}>{al.aciklama}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </Card>
                </Col>

                <Col xs={24} lg={12}>
                  <Card size="small" title="Gizlenecek sayfa bölümleri">
                    <Paragraph type="secondary" style={{ fontSize: 12 }}>
                      Menüyü görsün ama içindeki bir bölüme dokunmasın: örneğin
                      Çıkış Mülakatı'nı açsın, anket gönderemesin.
                    </Paragraph>
                    <div className="ry-menuler ry-tek">
                      {(veri?.sekmeler ?? []).map((x: any) => {
                        const acik = (rolAyari.gizliSekmeler ?? []).includes(x.kod);

                        return (
                          <label key={x.kod} className={"ry-menu" + (acik ? " ry-menu-secili" : "")}>
                            <Checkbox
                              checked={acik}
                              onChange={(e) => {
                                const y = new Set(rolAyari.gizliSekmeler ?? []);
                                if (e.target.checked) y.add(x.kod); else y.delete(x.kod);
                                guncelle("gizliSekmeler", Array.from(y));
                              }}
                            />
                            <span style={{ fontSize: 13 }}>{x.ad}</span>
                          </label>
                        );
                      })}
                    </div>
                  </Card>
                </Col>
              </Row>

              <Space style={{ marginTop: 14 }}>
                <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
                  Kaydet
                </Button>
                <Button onClick={getir}>Geri al</Button>
              </Space>
            </>
          )}
          </>)}
        </>
      )}
    </div>
  );
}

function MenuSirasi() {
  const { message } = AntdApp.useApp();

  /* Menü anahtarları ve okunur adları. App.tsx'teki anahtarlarla
     birebir aynı olmalı. */
  const TUMU = MENU_TANIMLARI;


  const [sira, setSira] = useState<string[]>([]);

  /* Alt menü → üst menü eşlemesi */
  const [gruplar, setGruplar] = useState<Record<string, string>>({});
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = async () => {
    setYukleniyor(true);

    try {
      const d = await api.al<any>("/api/Ayar/FormGenel");
      const kayitli: string[] = d?.menuSirasi ?? [];

      /* Kayıtta olmayan sayfalar sona eklenir */
      const eksikler = TUMU.map((x) => x.key).filter(
        (k) => !kayitli.includes(k)
      );

      setSira([...kayitli.filter((k) => TUMU.some((t) => t.key === k)), ...eksikler]);
      setGruplar(d?.menuGruplari ?? {});
    } catch (hata: any) {
      message.error(hata.message);
      setSira(TUMU.map((x) => x.key));
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    getir();
  }, []);

  const tasi = (i: number, yon: -1 | 1) => {
    const hedef = i + yon;
    if (hedef < 0 || hedef >= sira.length) return;

    const yeni = [...sira];
    [yeni[i], yeni[hedef]] = [yeni[hedef], yeni[i]];
    setSira(yeni);
  };

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("/api/Ayar/MenuSirasi", { sira, gruplar });

      message.success(
        "Menü sırası kaydedildi. Sayfayı yenilediğinizde uygulanır."
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        Sol Menü Sırası
      </Title>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Sayfaları yukarı aşağı taşıyarak sıralayın. <b>Üst menü</b> seçerseniz
        o sayfa seçtiğiniz başlığın altına girer ve menü kısalır — örneğin
        Yönetim Raporu ile İK Performans'ı Raporlar altında toplayabilirsiniz.
        Üst başlık yapılan sayfanın kendisi de ilk alt öğe olarak kalır,
        erişilebilirliği kaybolmaz.
        <br />
        <br />
        Bu ayar tüm kullanıcıları etkiler; kimin hangi sayfayı göreceği
        rollere bağlıdır ve buradan değişmez.
      </Paragraph>

      {yukleniyor ? (
        <Spin />
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            {sira.map((k, i) => {
              const bilgi = TUMU.find((t) => t.key === k);

              return (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    border: "1px solid var(--cizgi)",
                    borderRadius: 8,
                    marginBottom: 6,
                    background: "#fff",
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "var(--yesil-acik)",
                      color: "var(--yesil-koyu)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11.5,
                      fontWeight: 700,
                      flex: "0 0 auto",
                    }}
                  >
                    {i + 1}
                  </span>

                  <span
                    style={{
                      flex: 1,
                      fontSize: 13.5,
                      fontWeight: gruplar[k] ? 400 : 600,
                      paddingLeft: gruplar[k] ? 18 : 0,
                      color: gruplar[k] ? "var(--metin-pasif)" : undefined,
                    }}
                  >
                    {gruplar[k] && "↳ "}
                    {bilgi?.ad ?? k}
                  </span>

                  <Select
                    size="small"
                    allowClear
                    style={{ width: 175 }}
                    placeholder="Üst menü yok"
                    value={gruplar[k] || undefined}
                    onChange={(v) => {
                      const yeni = { ...gruplar };

                      if (v) yeni[k] = v;
                      else delete yeni[k];

                      setGruplar(yeni);
                    }}
                    options={sira
                      /* Kendisi ve kendi altındakiler seçilemez:
                         döngü oluşur ve menü çizilemez. */
                      .filter((x) => x !== k && gruplar[x] !== k)
                      .map((x) => ({
                        value: x,
                        label: TUMU.find((t) => t.key === x)?.ad ?? x,
                      }))}
                  />

                  <Space size={4}>
                    <Button
                      size="small"
                      disabled={i === 0}
                      icon={<ArrowUp size={13} strokeWidth={2} />}
                      onClick={() => tasi(i, -1)}
                    />
                    <Button
                      size="small"
                      disabled={i === sira.length - 1}
                      icon={<ArrowDown size={13} strokeWidth={2} />}
                      onClick={() => tasi(i, 1)}
                    />
                  </Space>
                </div>
              );
            })}
          </div>

          <Space>
            <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
              Kaydet
            </Button>
            <Button onClick={getir}>Geri al</Button>
          </Space>
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Ayar merkezi (03.10.2026)                                                  */
/* ========================================================================== */
/*
 * Yönetim eskiden yan yana 15+ sekmeydi; hangi ayarın nerede olduğu
 * aranarak bulunuyordu. Artık:
 *  - solda gruplu gezinme (telefonda açılır düğme),
 *  - üstte arama ("/" tuşu) — "smtp", "kvkk", "whatsapp" gibi kelimelerle de,
 *  - açılışta Genel bakış: kategoriler, dikkat isteyenler, son değişiklikler,
 *  - her ayar sayfasında ortak başlık: açıklama ve son değişikliği yapan,
 *  - form ayarlarında altta "Kaydedilmemiş değişiklik" çubuğu.
 * Ayar ekranlarının içeriği ve yetkileri değişmedi; yalnızca yerleşim.
 */

/** Kaydedilmemiş değişiklik çubuğu: değişiklik olunca alttan çıkar */
function KaydetCubugu({
  acik,
  yukleniyor,
  onKaydet,
  onVazgec,
}: {
  acik: boolean;
  yukleniyor?: boolean;
  onKaydet: () => void;
  onVazgec: () => void;
}) {
  return (
    <div className={"ym-kaydet" + (acik ? " ym-kaydet-acik" : "")} aria-hidden={!acik}>
      <span>Kaydedilmemiş değişiklik var</span>
      <Button size="middle" className="ym-kaydet-vazgec" onClick={onVazgec} disabled={yukleniyor}>
        Vazgeç
      </Button>
      <Button
        type="primary"
        size="middle"
        loading={yukleniyor}
        icon={<Save size={15} strokeWidth={2} />}
        onClick={onKaydet}
      >
        Kaydet
      </Button>
    </div>
  );
}

type AyarOge = {
  k: string;
  ad: string;
  alt: string;
  aciklama?: string;
  /** Arama için ek kelimeler */
  anahtar?: string;
  gorunur: boolean;
  /** Form ayarı bölümü: kaydet çubuğu ve kirli uyarısı */
  form?: FormBolumu;
  ciz?: () => React.ReactNode;
};

type AyarGrup = {
  k: string;
  ad: string;
  ikon: React.ReactNode;
  renk: string;
  ogeler: AyarOge[];
};

type AyarOzeti = {
  bolumSon: Record<string, { kullanici: string; tarih: string; islem: string }>;
  sonDegisiklikler: {
    bolum: string;
    islem: string;
    kullanici: string;
    basarili: boolean;
    tarih: string;
  }[];
  sayilar: Record<string, any>;
  dikkat: { seviye: "hata" | "uyari" | "bilgi"; baslik: string; aciklama: string; bolum: string }[];
};

const YM_SAKLA = "ik_yonetim_bolum";

const zamanYaz = (t?: string) => {
  if (!t) return "";
  const d = dayjs(t);
  if (d.isSame(dayjs(), "day")) return `bugün ${d.format("HH:mm")}`;
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return `dün ${d.format("HH:mm")}`;
  return d.format("DD.MM.YYYY HH:mm");
};

export default function Yonetim() {
  const { modal } = AntdApp.useApp();
  const o = oturumOku();
  const rol = o?.rol ?? "";
  const tam = tamYonetim(o);
  const ik = formAyari(o);

  const [secili, setSecili] = useState<string>(() => {
    try {
      return sessionStorage.getItem(YM_SAKLA) || "ozet";
    } catch {
      return "ozet";
    }
  });
  const [kirli, setKirli] = useState(false);
  const [navAcik, setNavAcik] = useState(false);
  const [ozet, setOzet] = useState<AyarOzeti | null>(null);
  const [arama, setArama] = useState("");
  const [aramaAcik, setAramaAcik] = useState(false);
  const [aramaSira, setAramaSira] = useState(0);
  const aramaRef = useRef<any>(null);
  const icerikRef = useRef<HTMLDivElement>(null);

  const ozetGetir = () =>
    api
      .al<AyarOzeti>("/api/AyarOzet")
      .then(setOzet)
      .catch(() => {
        /* Genel bakış verisi gelmezse sayfalar yine çalışır */
      });

  useEffect(() => {
    ozetGetir();
  }, [secili]);

  const formSayfasi = (bolum: FormBolumu) => () =>
    <FormAyarlari key={bolum} bolum={bolum} onKirli={setKirli} onKaydedildi={ozetGetir} />;

  const TUM_GRUPLAR: AyarGrup[] = [
    {
      k: "kurum",
      ad: "Kurum ve organizasyon",
      ikon: <Building2 size={15} strokeWidth={2} />,
      renk: "yesil",
      ogeler: [
        {
          k: "birimler",
          ad: "Birimler",
          alt: "Şube, genel müdürlük, depo; rapor mailleri",
          aciklama:
            "Şube, Genel Müdürlük ve depo listesi. Rapor maili, günlük okutma raporunun şubeye gideceği adrestir; işaretlenen birimler Norm Kadro raporunda görünmez.",
          anahtar: "şube birim rapor maili norm kadro depo genel müdürlük",
          gorunur: true,
          form: "birimler",
          ciz: formSayfasi("birimler"),
        },
        {
          k: "bolgeler",
          ad: "Bölgeler",
          alt: "Bölgeler ve bağlı şubeler",
          aciklama:
            "Kullanıcıya bölge seçildiğinde o bölgenin şubeleri yetkisine kendiliğinden tanımlanır. Bölgeye şube ekleyip kaydedince o bölgedeki tüm kullanıcılar birlikte güncellenir.",
          anahtar: "bölge bölge müdürü şube yetkisi",
          gorunur: true,
          form: "bolgeler",
          ciz: formSayfasi("bolgeler"),
        },
        {
          k: "birimturleri",
          ad: "Birim türleri ve pozisyonlar",
          alt: "Her birim türündeki pozisyonlar",
          aciklama:
            "Aday önce birim türünü seçer, ardından yalnızca o türe ait pozisyonlar listelenir. Açıklama ve rozet aday sayfasının karşılama kartlarında görünür.",
          anahtar: "pozisyon bölüm kadro birim türü rozet",
          gorunur: true,
          form: "birimturleri",
          ciz: formSayfasi("birimturleri"),
        },
        {
          k: "departman",
          ad: "Departmanlar",
          alt: "Genel merkez ve depo departmanları",
          aciklama: "Genel Müdürlük ve depo departmanları: ekip listesi ve izinde ilk onayı verecek yöneticiler.",
          anahtar: "departman ekip izin onayı",
          gorunur: tam || ik,
          ciz: () => <Departmanlar />,
        },
        {
          k: "yonetici",
          ad: "Yönetici eşleştirmesi",
          alt: "Kimin yöneticisi kim",
          aciklama:
            "Mağazalarda yönetici ünvandan bulunur. Genel Müdürlük ve depo gibi yan yana birçok müdürün olduğu birimlerde burada tanımlanan eşleştirme tahmine üstün gelir.",
          anahtar: "yönetici müdür eşleştirme uyum yöneticisi",
          gorunur: true,
          form: "yonetici",
          ciz: formSayfasi("yonetici"),
        },
        {
          k: "calisma",
          ad: "Çalışma düzeni",
          alt: "Resmi tatiller ve pozisyon grupları",
          aciklama: "Resmi tatiller ve pozisyon grupları; ikisi de yıllık izin hesabını doğrudan etkiler.",
          anahtar: "tatil resmi tatil pozisyon grubu bayram",
          gorunur: tam,
          ciz: () => <CalismaDuzeni />,
        },
      ],
    },
    {
      k: "yetki",
      ad: "Kullanıcılar ve yetki",
      ikon: <ShieldCheck size={15} strokeWidth={2} />,
      renk: "mor",
      ogeler: [
        {
          k: "kullanici",
          ad: "Kullanıcılar",
          alt: "Panel hesapları ve roller",
          aciklama: "Panel kullanıcıları, rolleri, bölge ve yetkili şubeleri.",
          anahtar: "kullanıcı hesap parola şifre sıfırla rol şube yetkisi",
          gorunur: tam,
          ciz: () => <Kullanicilar />,
        },
        {
          k: "rolyetki",
          ad: "Rol yetkileri",
          alt: "Hangi rol neyi görür",
          aciklama: "Rollerin göreceği menüler, gizlenecek alanlar ve sayfa içi sekmeler; panelden açılan özel roller.",
          anahtar: "rol yetki menü gizli alan özel rol",
          gorunur: tam,
          ciz: () => <RolYetkileri />,
        },
        {
          k: "patron",
          ad: "Patron görünümü",
          alt: "Biçen360 yönetim ekranı",
          aciklama: "Biçen360'ta şirket geneli yönetim ekranlarını görecek kişiler.",
          anahtar: "patron biçen360 mobil yönetim",
          gorunur: patronDuzenleyebilir(),
          ciz: () => <PatronGorunumu />,
        },
        {
          k: "hukuk",
          ad: "Hukuk görünümü",
          alt: "Dış danışman ve hukuk ekibi yetkileri",
          aciklama: "Dış hukuk danışmanlarının kimlik ve telefonla tanımlanması (mobil uygulama ve panel girişi), Biçen hukuk ekibi yetkileri.",
          anahtar: "hukuk avukat danışman dava yetki kimlik telefon",
          gorunur: tam || rol === "IKYoneticisi" || rol === "GenelMudurYardimcisi",
          ciz: () => <HukukYetkiYonetimi />,
        },
        {
          k: "gunluk",
          ad: "Güvenlik günlüğü",
          alt: "Girişler, engellemeler, erişim listeleri",
          aciklama: "Girişler ve hassas işlemlerin kaydı; kara liste, izinli ve engelli alanlar.",
          anahtar: "günlük güvenlik kara liste engelli ip log",
          gorunur: tam,
          ciz: () => <GuvenlikGunlugu />,
        },
      ],
    },
    {
      k: "isealim",
      ad: "İşe alım",
      ikon: <UserPlus size={15} strokeWidth={2} />,
      renk: "mavi",
      ogeler: [
        {
          k: "basvuruformu",
          ad: "Başvuru formu",
          alt: "Duyuru, seçenek listeleri, bölümler",
          aciklama:
            "Aday başvuru formunda görünen duyuru, seçenek listeleri, açık bölümler ve \"Bizi nereden duydunuz?\" seçenekleri. Yeni seçeneği yazıp Enter'a basmanız yeterli.",
          anahtar: "duyuru eğitim ehliyet kan grubu askerlik uyruk sertifika referans başvuru kaynağı il medeni engel src",
          gorunur: true,
          form: "basvuruformu",
          ciz: formSayfasi("basvuruformu"),
        },
        {
          k: "kvkk",
          ad: "KVKK metinleri",
          alt: "Aydınlatma ve açık rıza",
          aciklama: "Boş bırakılan metin yerine aday sayfasındaki varsayılan metin kullanılır; paragraf düzeni birebir yansır.",
          anahtar: "kvkk aydınlatma açık rıza metin",
          gorunur: true,
          form: "kvkk",
          ciz: formSayfasi("kvkk"),
        },
        {
          k: "gorusme",
          ad: "Görüşme ve davet",
          alt: "Görüşme yeri, WhatsApp mesajı",
          aciklama: "Görüşme davetine eklenen adres ve konum; personelin WhatsApp'tan göndereceği hazır davet mesajı.",
          anahtar: "whatsapp davet görüşme adres konum harita",
          gorunur: true,
          form: "gorusme",
          ciz: formSayfasi("gorusme"),
        },
        {
          k: "evrak",
          ad: "İşe giriş evrakları",
          alt: "Adaydan istenen evrak listesi",
          aciklama: "İşe alımda yüklenecek evrakların listesi; eksik evrak personel kartında görünür.",
          anahtar: "evrak belge ikametgah işkur sağlık raporu",
          gorunur: evrakTanimDuzenleyebilir(),
          ciz: () => <IseGirisEvrakTanimlari />,
        },
      ],
    },
    {
      k: "kurallar",
      ad: "Kurallar ve onay akışları",
      ikon: <Workflow size={15} strokeWidth={2} />,
      renk: "mor",
      ogeler: [
        {
          k: "akislar",
          ad: "Onay akışları",
          alt: "Avans, izin, fazla mesai, işe alım",
          aciklama:
            "Taleplerin kimden kime gittiğinin özeti. Ayarı olan akışlarda ilgili bölüme geçebilirsiniz.",
          anahtar: "onay akışı sıra kim onaylar bölge müdürü birim yöneticisi gmy ik",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <OnayAkislariOzeti git={git} />,
        },
        {
          k: "avansakis",
          ad: "Avans onay tablosu",
          alt: "Pozisyona göre 1.–5. onay",
          aciklama:
            "Onay sırası: iş yeri ve pozisyona göre 1.–5. onay (mağaza müdürü, bölge müdürü, İK, GMY…). Avans bu sırayla; 23.10.2026'dan beri izin, fazla mesai ve rotasyon da bu sırayla ilerler ve İK'da biter. İK'nın Excel'iyle aynı sütunlar; Excel'e aktarılıp geri yüklenebilir. Kişiler Biçen360'ta İzin Onayları ekranından onaylar.",
          anahtar: "avans onay akışı tablosu sırası gmy genel müdür yardımcısı mağaza müdürü bölge müdürü red ret ik adım excel",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <AvansOnayTablosu />,
        },
        {
          k: "fmakis",
          ad: "Fazla mesai akışı",
          alt: "Kim girerse onay kime, form nereye",
          aciklama:
            "Fazla mesainin onay sırası ve formun gideceği adres: iş yeri, personelin pozisyonu ve fazla mesaiyi giren kişiye göre kurallar. Örn. genel merkezde GMY girerse doğrudan İK; birim yöneticisi girerse GMY, sonra İK. Kural tutmazsa bugünkü akış (şemadaki üst yönetici → İK).",
          anahtar: "fazla mesai onay akışı sırası gmy genel müdür yardımcısı birim yöneticisi ik mail e-posta form kime gider",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <FazlaMesaiKurallari />,
        },
        {
          k: "fmucret",
          ad: "Fazla mesai ücret kuralları",
          alt: "Ücret mi izin mi, çarpan",
          aciklama:
            "Fazla mesainin karşılığı gün türüne göre (normal gün, hafta tatili, resmi tatil, arife): ücret ya da serbest zaman (izin) ve çarpan (×1, ×1,5, ×2…). Tüm personel, iş yeri, pozisyon ya da kişiye özel kural yazılabilir.",
          anahtar: "fazla mesai ücret hesaplama resmi tatil hafta tatili bayram arife izin serbest zaman çarpan 1.5 2 zam",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <FazlaMesaiUcretKurallari />,
        },
        {
          k: "izinonay",
          ad: "İzin onay süreci",
          alt: "İş yeri + pozisyon → 1.–5. onay",
          aciklama:
            "İzin talebinin onay sırası (İK'nın İZİN TALEP ONAY SÜRECİ tablosu, 27.10.2026). Bekleyen talepler de buradan tabloya uydurulup yeni onaylayana bildirilir.",
          anahtar: "izin onay süreci tablosu onaylayan birim yöneticisi pozisyon gmy bekleyen",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <IzinOnaySureci />,
        },
        {
          k: "sureler",
          ad: "Süreler ve sınırlar",
          alt: "Otomatik onay, belge süresi, saatler",
          aciklama:
            "Daha önce kodun içinde sabit duran süreler, saatler ve sınırlar: izin otomatik onay süresi, mazeret belgesi süresi, fazla mesai sınırları, vardiya hatırlatma saatleri, okutma hedefleri, anket süreleri, GMY sicili. Kaydedilen değer en geç bir dakika içinde geçerli olur.",
          anahtar:
            "süre sınır saat otomatik onay 48 mazeret belge fazla mesai 16 saat hatırlatma 08:40 okutma hedef 90 kritik 70 pusula anket gmy sicil davet sms",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <SurelerSinirlar onKirli={setKirli} />,
        },
        {
          k: "listeler",
          ad: "Seçenek listeleri",
          alt: "Mazeret türleri, avans nedenleri, eksik maddeleri",
          aciklama:
            "Formlarda seçilen hazır listeler: mazeret izni türleri (hastane, okul işleri, raporlu…; hangisinde belge istendiği), avans talep nedenleri, eksik evrak maddeleri, mazeret belgesi türleri ve rapor türleri. \"Diğer\" her listede sabit ve açıklaması zorunlu.",
          anahtar: "liste seçenek mazeret türü hastane okul raporlu avans neden eksik madde belge rapor türü diğer",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <SecenekListeleri onKirli={setKirli} />,
        },
        {
          k: "mikrokullanici",
          ad: "Mikro kullanıcı adları",
          alt: "\"Yapan: 130\" yerine ad",
          aciklama:
            "Mikro'da personel kartını değiştiren kullanıcı numara olarak geliyor. Adlar Mikro'nun kullanıcı tablosundan okunuyor; bulunamayan numaraya buradan ad yazılır. Kaydedince eski kayıtlardaki numaralar da ada çevrilir.",
          anahtar: "mikro kullanıcı yapan numara 130 değiştiren şube değişikliği",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <MikroKullaniciAdlari onKirli={setKirli} />,
        },
      ],
    },
    {
      k: "personel",
      ad: "Personel ve izin",
      ikon: <CalendarDays size={15} strokeWidth={2} />,
      renk: "erik",
      ogeler: [
        {
          k: "kiyafetbeden",
          ad: "Kıyafet bedenleri",
          alt: "S, M, L, XL… ve personel bedenleri",
          aciklama:
            "Personel kartında seçilen kıyafet bedeninin seçenekleri. Yeni beden eklenebilir, sırası değiştirilebilir; beden başına çalışan sayısı ve Excel listesi buradan alınır.",
          anahtar: "kıyafet beden tişört üniforma iş elbisesi s m l xl xxl xxxl",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <KiyafetBedenleri />,
        },
        {
          k: "donemseldegerlendirme",
          ad: "Dönemsel değerlendirme",
          alt: "3 ayda bir yönetici değerlendirmesi · sorular",
          aciklama:
            "Mağaza müdürünün (isterseniz müdür yardımcısının) personelini 3 ayda bir Biçen360'tan değerlendirmesi: dönem takvimi, kimlerin değerlendireceği ve pozisyona özel sorular (1–5 puan, açık uçlu, 1–10 genel puan ve açıklaması). Rapor: Personeller › Dönemsel Değerlendirme.",
          anahtar: "dönemsel değerlendirme performans müdür yardımcısı soru puan 3 ay çeyrek yönetici",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <DonemselKurallar />,
        },
        {
          k: "izinkurallari",
          ad: "İzin kuralları",
          alt: "Cumartesi, vardiya planı denetimi",
          aciklama: "Cumartesi kuralı ve mobil izin talebinde vardiya planı denetimi.",
          anahtar: "izin cumartesi vardiya planı talep",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <IzinKurallari />,
        },
        {
          k: "izinturleri",
          ad: "İzin türleri",
          alt: "Yıllık, mazeret, ücretsiz…",
          aciklama: "İzin türlerinin tanımları: gün sayısı, belge gerekliliği, mobilde görünürlük. Daha önce İzin Talepleri sayfasındaydı.",
          anahtar: "izin türü türleri mazeret ücretsiz doğum evlilik ölüm",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => (
            <PencereAcici
              baslik="İzin türleri"
              aciklama="Türler pencerede düzenlenir; kaydedince talep ekranlarında hemen görünür."
              dugme="İzin türlerini aç"
            >
              {(kapat) => <IzinTurleri kapat={kapat} />}
            </PencereAcici>
          ),
        },
        {
          k: "kontenjan",
          ad: "Aylık izin kontenjanı",
          alt: "İzin Yönetimi › Kontenjan",
          aciklama:
            "Aylara göre yıllık izin gün kontenjanı, kişi başı aylık sınır ve dolu ayda davranış. Ayarlar İzin Yönetimi sayfasının Kontenjan sekmesinde.",
          anahtar: "kontenjan aylık izin gün kişi başı",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => (
            <GecisKarti
              baslik="Aylık izin kontenjanı"
              aciklama="Kontenjan planı, kişi başı aylık sınır ve dolu ayda davranış İzin Yönetimi › Kontenjan sekmesinde. Varsayılan olarak kapalı; açıldığında 1 Ocak 2027'den itibaren uygulanır."
              dugme="Kontenjana git"
              onGit={() => sayfayaGit("yillikizin", "sekme:kontenjan")}
            />
          ),
        },
        {
          k: "avanskurallari",
          ad: "Avans kuralları",
          alt: "Üst limit, taksit, kesinti günü",
          aciklama:
            "Mobil avans talebinin kuralları: maaşın yüzdesi olarak üst limit, taksit seçenekleri, yıllık talep hakkı, kesinti günü ve devam eden avans engeli.",
          anahtar: "avans limit taksit kesinti maaş talep",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi"].includes(rol),
          ciz: () => <AvansKurallari />,
        },
        {
          k: "maasskala",
          ad: "Maaş skalası",
          alt: "Pozisyona göre alt/üst sınır",
          aciklama: "İşe alımda girilen ücretin karşılaştırıldığı pozisyon skalaları. Daha önce Personeller sayfasındaydı.",
          anahtar: "maaş skala ücret pozisyon alt üst sınır",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi"].includes(rol),
          ciz: () => <MaasSkala />,
        },
        {
          k: "izinformu",
          ad: "İzin formu e-postaları",
          alt: "Şube, depo ve genel merkez",
          aciklama:
            "İzin talebinde otomatik doldurulan formun gideceği adresler: şube personelinde şubenin maili, Akçaburgaz depoda depo müdürü, genel merkezde İnsan Kaynakları.",
          anahtar: "izin formu mail e-posta şube maili depo müdürü ik imza",
          gorunur: tam || ik,
          form: "izinformu",
          ciz: formSayfasi("izinformu"),
        },
        {
          k: "yolucreti",
          ad: "Yol ücretleri",
          alt: "Şube ve kişi bazında",
          aciklama: "Personel yol ücretleri; Excel ile toplu aktarım ya da kişi bazında düzenleme.",
          anahtar: "yol ücreti excel aktarım",
          gorunur: ["Admin", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <YolUcretleri />,
        },
      ],
    },
    {
      k: "vardiya",
      ad: "Vardiya ve okutma",
      ikon: <ScanLine size={15} strokeWidth={2} />,
      renk: "mavi",
      ogeler: [
        {
          k: "okutmakural",
          ad: "Okutma kuralları",
          alt: "Mesafe, şube ve kişi kuralları",
          aciklama: "Karekod okutmada mesafe sınırı ve şubeye/kişiye özel kurallar. Vardiya Karekod sayfasında da duruyor.",
          anahtar: "okutma kural mesafe metre konum karekod",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => (
            <React.Suspense fallback={<Spin />}>
              <OkutmaKurallari />
            </React.Suspense>
          ),
        },
        {
          k: "uygulamakullanim",
          ad: "Uygulama kullanımı",
          alt: "Biçen360 kurulum ve okutma",
          aciklama: "Personelin Biçen360 kurulum ve kullanım durumu.",
          anahtar: "uygulama kullanım biçen360 kurulum",
          gorunur: ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"].includes(rol),
          ciz: () => <UygulamaKullanimi />,
        },
      ],
    },
    {
      k: "uyum",
      ad: "Uyum ve çıkış",
      ikon: <HeartHandshake size={15} strokeWidth={2} />,
      renk: "turuncu",
      ogeler: [
        {
          k: "uyumanket",
          ad: "İşe uyum anketi",
          alt: "Aşamalar, otomatik gönderim, SMS",
          aciklama:
            "Oryantasyon anketinin aşama pencereleri (7. gün, 2. ay, 6. ay, 1. yıl), otomatik gönderim ve çalışana / yöneticiye giden SMS metinleri.",
          anahtar: "uyum anket oryantasyon pencere aşama sms otomatik",
          gorunur: true,
          form: "uyumanket",
          ciz: formSayfasi("uyumanket"),
        },
        {
          k: "cikis",
          ad: "Çıkış mülakatı",
          alt: "Sorular ve otomatik gönderim",
          aciklama: "Çıkış mülakatı soruları, puanlama ve ayrılma nedenleri.",
          anahtar: "çıkış mülakat ayrılma neden soru",
          gorunur: tam,
          ciz: () => <CikisMulakatAyari />,
        },
        {
          k: "uygulamadavet",
          ad: "Biçen360 kurulum daveti",
          alt: "İşe girene otomatik SMS",
          aciklama:
            "Mikro'da işe girişi yapılan personele Biçen360 uygulamasını kurması için giden SMS: metin, açma/kapama ve son gönderimler.",
          anahtar: "biçen360 uygulama kurulum davet sms işe giriş yeni personel indir",
          gorunur: tam,
          ciz: () => <UygulamaDavetAyari />,
        },
      ],
    },
    {
      k: "iletisim",
      ad: "İletişim",
      ikon: <MessageSquare size={15} strokeWidth={2} />,
      renk: "sari",
      ogeler: [
        {
          k: "mail",
          ad: "Mail ayarları",
          alt: "SMTP, gönderen, test",
          aciklama: "Başvuru bildirimleri ve günlük raporların gönderildiği SMTP hesabı; başvuruların gideceği adresler.",
          anahtar: "mail smtp eposta e-posta şifre parola gönderen test",
          gorunur: tam,
          ciz: () => <MailAyarlari />,
        },
        {
          k: "smskod",
          ad: "SMS kod havuzu",
          alt: "Doğrulama kodu stoku",
          aciklama: "Adaylara gönderilen doğrulama kodlarının havuzu; her başvuruda bir kod harcanır. Havuz boşalırsa başvuru yapılamaz.",
          anahtar: "sms kod doğrulama havuz",
          gorunur: tam,
          ciz: () => <KodHavuzu />,
        },
      ],
    },
    {
      k: "gorunum",
      ad: "Görünüm ve mobil",
      ikon: <Palette size={15} strokeWidth={2} />,
      renk: "gri",
      ogeler: [
        {
          k: "panelgorunum",
          ad: "Panel görünümü",
          alt: "Logo ve başlık",
          aciklama: "Kenar menünün başlığı ve logosu; herkesin panelinde görünür.",
          anahtar: "logo başlık görünüm tema",
          gorunur: gorunumDuzenleyebilir(o),
          ciz: () => <PanelGorunumu />,
        },
        {
          k: "menu",
          ad: "Menü sırası",
          alt: "Kenar menü düzeni",
          aciklama: "Sol menünün sırası ve grupları; tüm kullanıcıları etkiler.",
          anahtar: "menü sıra grup kenar",
          gorunur: tam,
          ciz: () => <MenuSirasi />,
        },
        {
          k: "mobilmetin",
          ad: "Mobil metinler",
          alt: "Doğum günü kutlaması",
          aciklama: "Biçen360'ta personelin gördüğü metinler.",
          anahtar: "doğum günü kutlama mobil metin",
          gorunur: true,
          form: "mobilmetin",
          ciz: formSayfasi("mobilmetin"),
        },
        /* 09.10.2026: kenar menüden buraya taşındı */
        {
          k: "ekibimayar",
          ad: "Ekibim görünürlüğü",
          alt: "Biçen360'ta kim kimi görür",
          aciklama:
            "Biçen360 Ekibim ekranında yöneticilerin hangi personeli göreceği ve onlar için talep (fazla mesai, rotasyon, izin…) oluşturup oluşturamayacağı.",
          anahtar: "ekibim görünürlük ekip yönetici biçen360 kural personel görsün talep",
          gorunur: haberYonetimi(o),
          ciz: () => <EkibimAyar />,
        },
        {
          k: "aydinlatma",
          ad: "Personel aydınlatma metni",
          alt: "Biçen360 KVKK metni",
          aciklama: "Biçen360'ta personelin gördüğü ve onayladığı KVKK aydınlatma metni.",
          anahtar: "aydınlatma kvkk metin personel biçen360 onay",
          gorunur: haberYonetimi(o),
          ciz: () => <Aydinlatma />,
        },
        {
          k: "mobiltest",
          ad: "Mobil test",
          alt: "Test hesabı ve bildirim",
          aciklama: "Biçen360 test telefonu ve deneme bildirimi.",
          anahtar: "mobil test bildirim telefon",
          gorunur: tam,
          ciz: () => <MobilTest />,
        },
        {
          k: "uygulamasurum",
          ad: "Uygulama sürümleri",
          alt: "Biçen360 güncellemesi",
          aciklama: "Personelin kullandığı Biçen360 sürümü; eski sürümdekilere güncelleme hatırlatması.",
          anahtar: "sürüm güncelleme versiyon biçen360 mobil uygulama",
          gorunur: tam || ik,
          ciz: () => <UygulamaSurumleri />,
        },
        {
          k: "yardimvideo",
          ad: "Yardım videoları",
          alt: "Panel ve Biçen360 videoları",
          aciklama: "Yardım ikonundan açılan eğitim videoları. Eğitimler sayfasında da duruyor.",
          anahtar: "yardım video eğitim",
          gorunur: tam || ik,
          ciz: () => <YardimVideolari />,
        },
        {
          k: "sohbetdepolama",
          ad: "Mesajlar depolama",
          alt: "Sohbet boyutları ve sıkıştırma",
          aciklama: "Sohbetlerin kapladığı yer; silinen ekleri temizleme, belgeleri sıkıştırma, eski ekleri kaldırma.",
          anahtar: "sohbet mesaj mesajlaşma depolama sıkıştır boyut dosya video",
          gorunur: tam,
          ciz: () => <SohbetYonetimi />,
        },
      ],
    },
  ];

  const GRUPLAR = TUM_GRUPLAR.map((g) => ({
    ...g,
    ogeler: g.ogeler.filter((x) => x.gorunur),
  })).filter((g) => g.ogeler.length > 0);

  const OGE: Record<string, AyarOge & { grup: AyarGrup }> = {};
  GRUPLAR.forEach((g) => g.ogeler.forEach((x) => (OGE[x.k] = { ...x, grup: g })));

  /* Kayıtlı bölüm artık görünmüyorsa (yetki değişti) Genel bakış */
  const aktif = secili !== "ozet" && OGE[secili] ? secili : "ozet";

  const git = (k: string) => {
    const uygula = () => {
      setKirli(false);
      setSecili(k);
      setNavAcik(false);
      setArama("");
      setAramaAcik(false);
      try {
        sessionStorage.setItem(YM_SAKLA, k);
      } catch {
        /* saklanamazsa yenilemede Genel bakış açılır */
      }
      /* Aşağı kaydırılmışsa yeni sayfanın başına dön */
      requestAnimationFrame(() => {
        const e = icerikRef.current;
        if (e && e.getBoundingClientRect().top < 64)
          e.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    };

    if (k === aktif) return setNavAcik(false);

    if (kirli) {
      modal.confirm({
        title: "Kaydedilmemiş değişiklik var",
        content: "Bu sayfada kaydetmediğiniz değişiklikler kaybolacak. Yine de çıkılsın mı?",
        okText: "Çık",
        cancelText: "Sayfada kal",
        okButtonProps: { danger: true },
        onOk: uygula,
      });
      return;
    }

    uygula();
  };

  /* Tarayıcıdan çıkarken de uyar */
  useEffect(() => {
    if (!kirli) return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [kirli]);

  /* "/" tuşu: ayar araması. Ctrl+K panelin menü aramasında kalıyor. */
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const h = e.target as HTMLElement | null;
      if (h && (h.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(h.tagName))) return;
      e.preventDefault();
      aramaRef.current?.focus();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const q = arama.trim().toLocaleLowerCase("tr");
  const sonuclar = q
    ? Object.values(OGE)
        .map((x) => {
          const ad = x.ad.toLocaleLowerCase("tr");
          const metin = `${x.alt} ${x.grup.ad} ${x.anahtar ?? ""} ${x.aciklama ?? ""}`.toLocaleLowerCase("tr");
          const puan = ad.startsWith(q) ? 3 : ad.includes(q) ? 2 : metin.includes(q) ? 1 : 0;
          return { x, puan };
        })
        .filter((y) => y.puan > 0)
        .sort((a, b) => b.puan - a.puan)
        .slice(0, 8)
        .map((y) => y.x)
    : [];

  const aramaTus = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAramaSira((i) => Math.min(i + 1, sonuclar.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAramaSira((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && sonuclar[aramaSira]) {
      git(sonuclar[aramaSira].k);
      (e.target as HTMLElement).blur();
    } else if (e.key === "Escape") {
      setArama("");
      setAramaAcik(false);
      (e.target as HTMLElement).blur();
    }
  };

  const sayilar = ozet?.sayilar ?? {};
  const gorunenDikkat = (ozet?.dikkat ?? []).filter((d) => OGE[d.bolum]);
  const dikkatSeviyesi = (k: string) =>
    gorunenDikkat.find((d) => d.bolum === k && d.seviye !== "bilgi")?.seviye;

  /* Kategori kartlarında ve menüde öğenin yanındaki kısa durum */
  const durum = (k: string): React.ReactNode => {
    const sv = dikkatSeviyesi(k);
    if (k === "mail" && sv) return <span className={`ym-rozet ym-r-${sv}`}>{sv === "hata" ? "hata" : "dikkat"}</span>;
    if (k === "smskod" && sayilar.smskod != null)
      return <span className={sv ? `ym-rozet ym-r-${sv}` : "ym-sayi"}>{Number(sayilar.smskod).toLocaleString("tr-TR")}</span>;
    if (sv) return <span className={`ym-rozet ym-r-${sv}`}>dikkat</span>;

    const metin: Record<string, string | undefined> = {
      birimler: sayilar.birimler != null ? `${sayilar.birimler}` : undefined,
      bolgeler: sayilar.bolgeler != null ? `${sayilar.bolgeler}` : undefined,
      birimturleri: sayilar.birimturleri != null ? `${sayilar.birimturleri} tür` : undefined,
      departman: sayilar.departman != null ? `${sayilar.departman}` : undefined,
      kullanici: sayilar.kullanici != null ? `${sayilar.kullanici} kişi` : undefined,
      patron: sayilar.patron != null ? `${sayilar.patron} kişi` : undefined,
      evrak: sayilar.evrak != null ? `${sayilar.evrak} evrak` : undefined,
      yonetici: sayilar.yoneticiEslesme ? `${sayilar.yoneticiEslesme}` : undefined,
      uyumanket: sayilar.uyumOtomatik != null ? `${sayilar.uyumOtomatik}/4 otomatik` : undefined,
      rolyetki: sayilar.ozelRol ? `${sayilar.ozelRol} özel rol` : undefined,
    };
    return metin[k] ? <span className="ym-sayi">{metin[k]}</span> : null;
  };

  const navNokta = (k: string) => {
    const sv = dikkatSeviyesi(k);
    return sv ? <span className={`ym-nokta ym-n-${sv}`} title="Dikkat" /> : null;
  };

  const sec = aktif === "ozet" ? null : OGE[aktif];
  const son = sec ? ozet?.bolumSon?.[sec.k] : undefined;

  /* ------------------------------------------------------------ Genel bakış */
  const GenelBakis = (
    <>
      <div className="ym-kategori">
        {GRUPLAR.map((g) => (
          <div key={g.k} className="ym-kat">
            <button type="button" className="ym-kat-bas" onClick={() => git(g.ogeler[0].k)}>
              <i className={`ym-ik ym-${g.renk}`}>{g.ikon}</i>
              <b>{g.ad}</b>
            </button>
            <ul>
              {g.ogeler.map((x) => (
                <li key={x.k}>
                  <button type="button" onClick={() => git(x.k)}>
                    <span>{x.ad}</span>
                    {durum(x.k)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="ym-iki">
        <div className="ym-kart">
          <div className="ym-kart-bas">
            <h3>Dikkat isteyenler</h3>
            {gorunenDikkat.length > 0 && <span className="ym-sayi">{gorunenDikkat.length}</span>}
          </div>
          {!ozet ? (
            <div className="ym-bos">
              <Spin size="small" />
            </div>
          ) : gorunenDikkat.length === 0 ? (
            <div className="ym-bos ym-bos-iyi">
              <ShieldCheck size={18} strokeWidth={2} /> Her şey yolunda görünüyor.
            </div>
          ) : (
            gorunenDikkat.map((d, i) => (
              <div key={i} className="ym-dikkat">
                <i className={`ym-ik ym-d-${d.seviye}`}>
                  {d.seviye === "bilgi" ? <Info size={15} strokeWidth={2} /> : <AlertTriangle size={15} strokeWidth={2} />}
                </i>
                <span>
                  <b>{d.baslik}</b>
                  <small>{d.aciklama}</small>
                </span>
                <Button size="small" onClick={() => git(d.bolum)}>
                  Aç
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="ym-kart">
          <div className="ym-kart-bas">
            <h3>Son değişiklikler</h3>
          </div>
          {(() => {
            const liste = (ozet?.sonDegisiklikler ?? []).filter((x) => OGE[x.bolum] || x.bolum === "form");
            if (!ozet)
              return (
                <div className="ym-bos">
                  <Spin size="small" />
                </div>
              );
            if (liste.length === 0)
              return <div className="ym-bos">Henüz kayıtlı değişiklik yok. Bundan sonra yapılan değişiklikler burada görünür.</div>;
            return liste.slice(0, 8).map((x, i) => (
              <button
                type="button"
                key={i}
                className="ym-iz"
                onClick={() => OGE[x.bolum] && git(x.bolum)}
              >
                <b>{x.kullanici || "—"}</b>
                <span className={x.basarili ? undefined : "ym-iz-hata"}>
                  {x.islem}
                  {OGE[x.bolum] && <small> · {OGE[x.bolum].ad}</small>}
                </span>
                <time>{zamanYaz(x.tarih)}</time>
              </button>
            ));
          })()}
        </div>
      </div>
    </>
  );

  return (
    <div className="ik-icerik">
      <div className="ym">
        <div className="ym-ust">
          <div>
            <h1>Yönetim</h1>
            <p>Sistemin bütün ayarları tek yerde; kategoriye göre gruplu.</p>
          </div>

          <div className="ym-ara">
            <Search size={16} strokeWidth={2} />
            <input
              ref={aramaRef}
              value={arama}
              placeholder="Ayar ara… (SMTP, KVKK, yol ücreti)"
              onChange={(e) => {
                setArama(e.target.value);
                setAramaSira(0);
                setAramaAcik(true);
              }}
              onFocus={() => setAramaAcik(true)}
              onBlur={() => setTimeout(() => setAramaAcik(false), 150)}
              onKeyDown={aramaTus}
              aria-label="Ayar ara"
            />
            <kbd>/</kbd>

            {aramaAcik && q && (
              <div className="ym-ara-sonuc">
                {sonuclar.length === 0 ? (
                  <div className="ym-ara-yok">"{arama}" ile eşleşen ayar yok</div>
                ) : (
                  sonuclar.map((x, i) => (
                    <button
                      type="button"
                      key={x.k}
                      className={i === aramaSira ? "ym-ara-secili" : undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => git(x.k)}
                      onMouseEnter={() => setAramaSira(i)}
                    >
                      <i className={`ym-ik ym-${x.grup.renk}`}>{x.grup.ikon}</i>
                      <span>
                        <b>{x.ad}</b>
                        <small>
                          {x.grup.ad} · {x.alt}
                        </small>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="ym-duzen">
          <nav className={"ym-nav" + (navAcik ? " ym-nav-acik" : "")} aria-label="Ayar bölümleri">
            <button type="button" className="ym-nav-mobil" onClick={() => setNavAcik((x) => !x)}>
              <span>
                <small>{sec ? sec.grup.ad : "Yönetim"}</small>
                {sec ? sec.ad : "Genel bakış"}
              </span>
              <ChevronRight size={16} strokeWidth={2} className="ym-nav-ok" />
            </button>

            <button
              type="button"
              className={"ym-nav-ozet" + (aktif === "ozet" ? " ym-aktif" : "")}
              onClick={() => git("ozet")}
            >
              <LayoutGrid size={16} strokeWidth={2} /> Genel bakış
            </button>

            {GRUPLAR.map((g) => (
              <div key={g.k} className="ym-nav-grup">
                <div className="ym-nav-bas">
                  <i className={`ym-ik ym-${g.renk}`}>{g.ikon}</i>
                  {g.ad}
                </div>
                {g.ogeler.map((x) => (
                  <button
                    type="button"
                    key={x.k}
                    className={"ym-nav-oge" + (aktif === x.k ? " ym-aktif" : "")}
                    onClick={() => git(x.k)}
                  >
                    {x.ad}
                    {navNokta(x.k)}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <main className="ym-icerik" ref={icerikRef}>
            {sec ? (
              <>
                <div className="ym-sayfa-bas">
                  <i className={`ym-ik ym-buyuk ym-${sec.grup.renk}`}>{sec.grup.ikon}</i>
                  <div className="ym-sayfa-metin">
                    <div className="ym-yol">{sec.grup.ad}</div>
                    <h2>{sec.ad}</h2>
                    {sec.aciklama && <p>{sec.aciklama}</p>}
                  </div>
                  <div className="ym-son">
                    <History size={13} strokeWidth={2} /> Son değişiklik
                    <b>{son ? `${son.kullanici || "—"} · ${zamanYaz(son.tarih)}` : "kayıt yok"}</b>
                  </div>
                </div>

                <HataSiniri key={sec.k}>
                  <div className="ym-govde">{sec.ciz?.()}</div>
                </HataSiniri>
              </>
            ) : (
              GenelBakis
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
