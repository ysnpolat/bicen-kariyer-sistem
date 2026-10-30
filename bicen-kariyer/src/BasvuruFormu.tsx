/**
 * ---------------------------------------------------------------------------
 * Biçen Market - İş Başvuru Formu
 * ---------------------------------------------------------------------------
 * Basılı BİK-001 (Rev. 4 / 29.5.2017) formunun dijital karşılığıdır.
 * Bölüm sırası ve alan adları basılı form ile birebir aynıdır.
 * Ek olarak: Kan Grubu ve Çalışmak İstediğiniz Şube alanları eklenmiştir.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Result,
  Row,
  Select,
  Space,
  Steps,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  Briefcase,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardList,
  Contact,
  ChevronLeft,
  GraduationCap,
  ScrollText,
  FileSignature,
  Mail,
  Accessibility,
  Award,
  MapPin,
  Plus,
  Printer,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  ASKERLIK_DURUMLARI,
  AYARLAR,
  BIRIM_TURLERI,
  birimBolumleri,
  ENGEL_TURLERI,
  ILLER,
  BILGISAYAR_PROGRAMLARI,
  EGITIM_SEVIYELERI,
  EHLIYET_SINIFLARI,
  KAN_GRUPLARI,
  KVKK_METNI,
  MEDENI_DURUMLAR,
  RENK,
  SRC_BELGELERI,
  SUBELER,
  TAAHHUT_METNI,
  UYRUKLAR,
} from "./sabitler";
import FormOnizleme from "./FormOnizleme";
import FotografAlani from "./FotografAlani";
import { FORM_DURUMU, gerekenReferans, referansGecerli } from "./ayarYukle";
import { ilceleriGetir, mahalleleriGetir } from "./adresVerisi";
import {
  ACIK_RIZA_BASLIK,
  ACIK_RIZA_MADDELERI,
  AYDINLATMA_BASLIK,
  RIZA_SECENEKLERI,
} from "./kvkkMetinleri";
import SertifikaAlani from "./SertifikaAlani";
import { basvuruKaydet } from "./depo";
import type { BasvuruDto } from "./tipler";
import {
  adresiDuzelt,
  ayMetin,
  basvuruNoUret,
  kirp,
  sadeceRakam,
  tarihMetin,
  tcKimlikGecerliMi,
} from "./yardimcilar";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

/* -------------------------------------------------------------------------- */
/* Adım bazlı doğrulanacak alanlar                                             */
/* -------------------------------------------------------------------------- */

const ADIM_ALANLARI: string[][] = [
  [
    // 1. Adım: birim ve pozisyon seçimi + kişisel bilgiler
    "subeKodu", "bolumler",
    "fotograf",
    "ad", "soyad", "medeniDurum", "cocukSayisi", "dogumTarihi", "dogumYeri",
    "uyruk", "uyrukUlke", "tcKimlikNo", "kanGrubu", "cepTel1", "cepTel2", "email",
    "il", "ilce", "mahalle", "caddeSokak", "binaNo", "daireNo", "evAdresi",
    "engelDurumuVarMi", "engelTurleri", "engelOrani", "engelRaporuVarMi",
    "engelAciklama",
  ],
  /* Tecrübe ile başvuru bilgileri tek adımda: ikisi de "geçmişin ve
     beklentin" sorusunun parçası ve ayrı sayfalarda dururken aday iki kez
     "İleri" basmak zorunda kalıyordu. Kısa olan tecrübe adımı tek başına
     neredeyse boş bir sayfaydı. */
  [
    "isTecrubesi", "sertifikalar",
    // 3. Adım: başvuru içeriği + eğitim ve diğer bilgiler
    "oncedenBasvurduMu", "oncekiBasvuruAciklama", "oncedenCalistiMi",
    "oncekiCalismaAciklama", "halenCalisiyorMu", "halenCalistigiYer",
    "talepEdilenNetUcret", "iseBaslamaTarihi",
    "askerlikDurumu", "ehliyetVarMi", "ehliyetSinifi", "ticariTasitBelgesiVarMi",
    "srcBelgeleri", "egitimSeviyesi", "mezunOkul", "bilgisayarBilgisi",
    "bilgisayarDiger",
  ],
  [
    "referanslar", "taahhutOnay", "aydinlatmaOnay", "kvkkOnay",
    "rizaIsleme", "rizaReferans", "rizaYetkiliMerci", "rizaBeyanPaylasim",

    /* Kaynak sorusu onay adımında görünüyor; doğrulama hatası doğru
       sayfaya götürsün diye burada tanımlı. */
    "kaynak", "kaynakDetay",
  ],
];

const ADIM_BASLIKLARI = ["Kişisel", "Tecrübe ve Başvuru", "Onay"];

const alaninAdimi = (alan: string): number => {
  const bulunan = ADIM_ALANLARI.findIndex((liste) => liste.includes(alan));
  return bulunan === -1 ? 0 : bulunan;
};

/* -------------------------------------------------------------------------- */
/* Yardımcı bileşenler                                                         */
/* -------------------------------------------------------------------------- */

function BolumBasligi({
  ikon,
  metin,
  aciklama,
}: {
  ikon: React.ReactNode;
  metin: string;
  aciklama?: string;
}) {
  return (
    <div className="bsv-bolum-basligi">
      <span className="bsv-bolum-ikon">{ikon}</span>
      <span className="bsv-bolum-metin">{metin}</span>
      {aciklama && <span className="bsv-bolum-aciklama">{aciklama}</span>}
    </div>
  );
}

/**
 * Evet / Hayır seçimi.
 * Form.Item alt bileşene value ve onChange geçirdiği için bu prop'ların
 * Radio.Group'a aktarılması zorunludur. Aksi hâlde seçim görsel olarak
 * değişir ama form değeri güncellenmez.
 */
function EvetHayir({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (olay: any) => void;
}) {
  return (
    <Radio.Group
      buttonStyle="solid"
      className="bsv-evet-hayir"
      value={value}
      onChange={onChange}
    >
      <Radio.Button value="Evet">Evet</Radio.Button>
      <Radio.Button value="Hayır">Hayır</Radio.Button>
    </Radio.Group>
  );
}

/* -------------------------------------------------------------------------- */
/* Ana bileşen                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sayfayı başa kaydırır.
 *
 * Çizimden sonra yapılır: React durum değişikliğini işlerken kaydırma
 * çağrılırsa tarayıcı eski yüksekliğe göre hareket ediyor ve yeni adım
 * ekranın ortasında açılmış görünüyor. Mobilde adres çubuğu yüksekliği
 * de değiştirdiği için sorun orada belirginleşiyor.
 */
const basaKaydir = () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  });
};

export default function BasvuruFormu({
  secilenBirim,
  secilenTur,
  birimiDegistir,
  taslak,
  sorgulamayaGit,
}: {
  /** Karşılama ekranında birim doğrudan belirlendiyse kodu (Genel Müdürlük, Depo) */
  secilenBirim: string;
  /** Seçilen birim türü. Şube gibi çok birimli türlerde seçim formda yapılır. */
  secilenTur: string;
  /** Birim değiştirilirken doldurulmuş bilgiler saklanır */
  birimiDegistir: (taslak: Record<string, unknown>) => void;
  /** Karşılamaya dönülüp geri gelindiğinde bilgiler geri yüklenir */
  taslak?: Record<string, unknown> | null;
  sorgulamayaGit: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  const [adim, setAdim] = useState(0);


  /* Form ilk yüklendiğinde damgalanır; sunucudaki hız denetimi bunu
     kullanır. useRef: yeniden çizimlerde değişmemesi gerekir. */
  const formAcilisRef = useRef(new Date().toISOString());

  /* E-posta doğrulama jetonu; başvuruyla birlikte gönderilir */
  const [yukleniyor, setYukleniyor] = useState(false);
  const [tamamlandi, setTamamlandi] = useState(false);
  const [basvuruNo, setBasvuruNo] = useState("");
  const [sonBasvuru, setSonBasvuru] = useState<BasvuruDto | null>(null);
  const [logoHata, setLogoHata] = useState(false);

  const medeniDurum = Form.useWatch("medeniDurum", form);
  const uyruk = Form.useWatch("uyruk", form);
  const yabanciMi = uyruk === "Yabancı Uyruklu";
  const il = Form.useWatch("il", form);
  const ilce = Form.useWatch("ilce", form);
  const engelVarMi = Form.useWatch("engelDurumuVarMi", form) === "Evet";
  /** Birim formda seçiliyorsa (şube) form değerinden okunur */
  const formBirimi = Form.useWatch("subeKodu", form);
  const subeKodu = secilenBirim || formBirimi;

  /** Seçilen türe ait birimler; yalnızca çok birimli türlerde listelenir */
  const turBirimleri = useMemo(
    () => SUBELER.filter((x) => (x.tur || "Şube") === secilenTur),
    [secilenTur]
  );

  /** Pozisyonlar birim türünden gelir; birim seçilmeden de gösterilebilir */
  const turBolumleri = useMemo(
    () => BIRIM_TURLERI.find((x) => x.ad === secilenTur)?.bolumler ?? [],
    [secilenTur]
  );

  const seciliBirim = useMemo(
    () => SUBELER.find((x) => x.kod === subeKodu),
    [subeKodu]
  );

  const seciliBolumler = turBolumleri.length > 0
    ? turBolumleri
    : birimBolumleri(subeKodu);
  const ehliyetVarMi = Form.useWatch("ehliyetVarMi", form);

  /* Zorunlu referans (21.10.2026): şef ve üstü 2, depo / genel merkez ve
     diğer pozisyonlar 1; şubede kasiyer, reyoner, tandolya, temizlik yok */
  const secilenPozisyonlar = Form.useWatch("bolumler", form) as string[] | undefined;
  const referansGereken = gerekenReferans(
    FORM_DURUMU.referansKurali,
    seciliBirim?.tur ?? secilenTur,
    secilenPozisyonlar
  );

  useEffect(() => {
    if (referansGereken <= 0) return;
    const mevcut: any[] = form.getFieldValue("referanslar") ?? [];
    if (mevcut.length < referansGereken)
      form.setFieldValue("referanslar", [
        ...mevcut,
        ...Array.from({ length: referansGereken - mevcut.length }, () => ({})),
      ]);
  }, [referansGereken]);
  const ticariBelge = Form.useWatch("ticariTasitBelgesiVarMi", form);
  const bilgisayarBilgisi = Form.useWatch("bilgisayarBilgisi", form);

  /* "Diğer" seçilince açıklama kutusu açılıyor */
  const kaynakSecimi = Form.useWatch("kaynak", form);
  const oncedenBasvurduMu = Form.useWatch("oncedenBasvurduMu", form);
  const oncedenCalistiMi = Form.useWatch("oncedenCalistiMi", form);
  const halenCalisiyorMu = Form.useWatch("halenCalisiyorMu", form);
  const ad = Form.useWatch("ad", form);
  const soyad = Form.useWatch("soyad", form);

  /* QR adresindeki ?sube= parametresi */
  const qrSubeKodu = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return (p.get("sube") ?? "").trim().toUpperCase();
  }, []);

  /* Birim karşılama ekranında (veya QR ile) belirlenir; formda seçilmez */
  useEffect(() => {
    if (secilenBirim) form.setFieldValue("subeKodu", secilenBirim);
  }, [secilenBirim, form]);

  /* ------------------------------------------------------ taslak saklama */
  /*
   * Form doldurulurken girilen bilgiler tarayıcıda saklanır. Sayfa
   * kapansa, yenilense veya telefon uygulamayı arka plana atsa bile
   * aday kaldığı yerden devam eder.
   *
   * Fotoğraf saklanmaz: hem yer kaplar hem de tarayıcı sınırını aşabilir.
   * Başvuru gönderildiğinde taslak silinir.
   */
  const TASLAK_ANAHTARI = "bicen-basvuru-taslak";

  useEffect(() => {
    if (taslak) return; // Karşılamadan gelen taslak önceliklidir

    try {
      const kayitli = window.localStorage.getItem(TASLAK_ANAHTARI);
      if (!kayitli) return;

      const veri = JSON.parse(kayitli);
      if (!veri?.degerler) return;

      // Tarih alanları metin olarak saklandığı için geri çevrilir
      ["dogumTarihi", "iseBaslamaTarihi"].forEach((alan) => {
        if (veri.degerler[alan]) veri.degerler[alan] = dayjs(veri.degerler[alan]);
      });

      form.setFieldsValue(veri.degerler);
      if (typeof veri.adim === "number") setAdim(veri.adim);

      message.info({
        content: "Daha önce doldurduğunuz bilgiler geri yüklendi.",
        duration: 4,
      });
    } catch {
      // Bozuk kayıt varsa yok sayılır
      window.localStorage.removeItem(TASLAK_ANAHTARI);
    }
    // Yalnızca ilk açılışta çalışır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Girilen bilgileri tarayıcıya yazar (fotoğraf hariç) */
  const taslagiYaz = (yeniAdim = adim) => {
    try {
      const degerler = { ...form.getFieldsValue(true) };
      delete degerler.fotograf;

      window.localStorage.setItem(
        TASLAK_ANAHTARI,
        JSON.stringify({ adim: yeniAdim, degerler, zaman: Date.now() })
      );
    } catch {
      // Depolama dolu veya kapalıysa sessizce geçilir
    }
  };

  const taslagiSil = () => {
    try {
      window.localStorage.removeItem(TASLAK_ANAHTARI);
    } catch {
      // yok sayılır
    }
  };

  /* Telefonun geri tuşu formu kapatmasın, bir önceki adıma dönsün.
     Her adım tarayıcı geçmişine yazılır; geri tuşu adımı geri alır. */
  useEffect(() => {
    window.history.pushState({ bsvAdim: adim }, "");

    const geriTusu = () => {
      setAdim((o) => {
        if (o > 0) {
          basaKaydir();
          return o - 1;
        }
        return o;
      });
    };

    window.addEventListener("popstate", geriTusu);
    return () => window.removeEventListener("popstate", geriTusu);
  }, [adim]);

  /* ------------------------------------------------------------ adım geçişi */
  /**
   * Eksik alana götürür.
   *
   * Yalnızca "zorunlu alanları doldurunuz" demek yetmiyordu: form uzun,
   * aday hangi alanın eksik olduğunu aramak zorunda kalıyor ve çoğu
   * yarıda bırakıyordu. Alan ekranın ortasına kaydırılıp odaklanıyor,
   * uyarıda da adı yazıyor.
   */
  const eksigeGit = (hata: any) => {
    const alan = hata?.errorFields?.[0];

    if (!alan) {
      message.error("Lütfen zorunlu alanları eksiksiz doldurunuz.");
      return;
    }

    const ad = alan.name?.[0];

    if (typeof ad === "string") {
      const hedefAdim = alaninAdimi(ad);

      /* Alan başka adımdaysa önce o adıma geçilmeli, yoksa kaydırma
         görünmeyen bir alanı arıyor. */
      if (hedefAdim !== adim) setAdim(hedefAdim);

      /* Adım değişimi çizildikten sonra kaydırılıyor */
      setTimeout(() => {
        form.scrollToField(alan.name, {
          behavior: "smooth",
          block: "center",
        });

        form.getFieldInstance?.(alan.name)?.focus?.();
      }, hedefAdim !== adim ? 250 : 0);
    }

    message.error(alan.errors?.[0] ?? "Lütfen zorunlu alanları eksiksiz doldurunuz.");
  };

  const ileri = async () => {
    try {
      await form.validateFields(ADIM_ALANLARI[adim]);

      /* Son adım numarası adım listesinden geliyor: sabit yazıldığında
         adım birleştirince güncellemek unutuluyordu. */
      const sonraki = Math.min(ADIM_ALANLARI.length - 1, adim + 1);
      taslagiYaz(sonraki);
      setAdim(sonraki);
      basaKaydir();
    } catch (hata: any) {
      eksigeGit(hata);
    }
  };

  const geri = () => {
    const onceki = Math.max(0, adim - 1);
    taslagiYaz(onceki);
    setAdim(onceki);
    basaKaydir();
  };

  /* ---------------------------------------------------------------- gönderim */
  const gonder = async () => {
    let d: any;
    try {
      d = await form.validateFields();
    } catch (hata: any) {
      eksigeGit(hata);
      return;
    }

    setYukleniyor(true);
    try {
      const sube = SUBELER.find((s) => s.kod === d.subeKodu);
      const yeniNo = basvuruNoUret();

      const veri: BasvuruDto = {
        fotograf: d.fotograf ?? null,
        ad: kirp(d.ad),
        soyad: kirp(d.soyad),
        medeniDurum: d.medeniDurum,
        cocukSayisi: Number(d.cocukSayisi ?? 0),
        dogumTarihi: tarihMetin(d.dogumTarihi),
        dogumYeri: kirp(d.dogumYeri),
        uyruk: d.uyruk ?? "T.C.",
        uyrukUlke: d.uyruk === "Yabancı Uyruklu" ? kirp(d.uyrukUlke) : "",
        tcKimlikNo: kirp(d.tcKimlikNo).toUpperCase(),
        kanGrubu: d.kanGrubu ?? "",
        cepTel1: d.cepTel1 ? `0${d.cepTel1}` : "",
        cepTel2: d.cepTel2 ? `0${d.cepTel2}` : "",
        il: d.il ?? "",
        ilce: d.ilce ?? "",
        mahalle: d.mahalle ?? "",
        caddeSokak: kirp(d.caddeSokak),
        binaNo: kirp(d.binaNo),
        daireNo: kirp(d.daireNo),
        evAdresi: kirp(d.evAdresi),

        engelDurumuVarMi: d.engelDurumuVarMi ?? "Hayır",
        engelTurleri: d.engelDurumuVarMi === "Evet" ? (d.engelTurleri ?? []) : [],
        engelOrani:
          d.engelDurumuVarMi === "Evet" && d.engelOrani ? Number(d.engelOrani) : null,
        engelRaporuVarMi: d.engelDurumuVarMi === "Evet" ? (d.engelRaporuVarMi ?? "") : "",
        engelAciklama: d.engelDurumuVarMi === "Evet" ? kirp(d.engelAciklama) : "",
        email: kirp(d.email),
        askerlikDurumu: d.askerlikDurumu ?? "",
        ehliyetVarMi: d.ehliyetVarMi,
        ehliyetSinifi: d.ehliyetVarMi === "Evet" ? (d.ehliyetSinifi ?? []).join(", ") : "",
        ticariTasitBelgesiVarMi: d.ticariTasitBelgesiVarMi,
        srcBelgeleri: d.ticariTasitBelgesiVarMi === "Evet" ? (d.srcBelgeleri ?? []) : [],
        egitimSeviyesi: d.egitimSeviyesi,
        mezunOkul: kirp(d.mezunOkul),
        bilgisayarBilgisi: d.bilgisayarBilgisi ?? [],
        bilgisayarDiger: kirp(d.bilgisayarDiger),
        kaynak: kirp(d.kaynak),
        kaynakDetay: kirp(d.kaynakDetay),

        isTecrubesi: (d.isTecrubesi ?? [])
          .filter((t: any) => t && kirp(t.isyeriAdi))
          .map((t: any) => ({
            isyeriAdi: kirp(t.isyeriAdi),
            gorev: kirp(t.gorev),
            netUcret: kirp(t.netUcret),
            iseGirisTarihi: ayMetin(t.iseGirisTarihi),
            istenCikisTarihi: ayMetin(t.istenCikisTarihi),
            ayrilmaSebebi: kirp(t.ayrilmaSebebi),
          })),

        sertifikalar: (d.sertifikalar ?? [])
          .filter((c: any) => c && kirp(c.ad))
          .map((c: any) => ({
            ad: kirp(c.ad),
            kurum: kirp(c.kurum),
            tarih: kirp(c.tarih),
            link: c.link ? adresiDuzelt(String(c.link)) : "",
            gorsel: c.gorsel ?? null,
          })),

        oncedenBasvurduMu: d.oncedenBasvurduMu,
        oncekiBasvuruAciklama: kirp(d.oncekiBasvuruAciklama),
        oncedenCalistiMi: d.oncedenCalistiMi,
        oncekiCalismaAciklama: kirp(d.oncekiCalismaAciklama),
        halenCalisiyorMu: d.halenCalisiyorMu,
        halenCalistigiYer: kirp(d.halenCalistigiYer),
        talepEdilenNetUcret: kirp(d.talepEdilenNetUcret),
        iseBaslamaTarihi: tarihMetin(d.iseBaslamaTarihi),

        bolumler: d.bolumler ?? [],
        subeKodu: d.subeKodu,
        subeAdi: sube?.ad ?? d.subeKodu,
        birimTuru: sube?.tur ?? secilenTur ?? "Şube",
        // Başvuru anında sunulan pozisyon listesi; önizleme bunu kullanır
        bolumSecenekleri: seciliBolumler,

        referanslar: (d.referanslar ?? [])
          .filter((r: any) => r && kirp(r.adSoyad))
          .map((r: any) => ({
            adSoyad: kirp(r.adSoyad),
            calistigiYer: kirp(r.calistigiYer),
            gorev: kirp(r.gorev),
            telefon: kirp(r.telefon),
          })),

        /* SMS doğrulaması kaldırıldı; alan uyumluluk için boş gider */
        dogrulamaJetonu: null,
        /* Formun açıldığı an; sunucu, gönderim ile arasındaki süreye
           bakarak otomatik araçları eler (bkz. FormSuresi:EnAzSaniye). */
        formAcilisZamani: formAcilisRef.current,
        taahhutOnay: !!d.taahhutOnay,
        kvkkOnay: !!d.kvkkOnay,
        aydinlatmaOnay: !!d.aydinlatmaOnay,
        rizaIsleme: d.rizaIsleme ?? "",
        rizaReferans: d.rizaReferans ?? "",
        rizaYetkiliMerci: d.rizaYetkiliMerci ?? "",
        rizaBeyanPaylasim: d.rizaBeyanPaylasim ?? "",
        adayAdSoyad: `${kirp(d.ad)} ${kirp(d.soyad)}`,
        beyanTarihi: dayjs().format("DD.MM.YYYY"),

        basvuruNo: yeniNo,
        gonderimZamani: dayjs().format("DD.MM.YYYY HH:mm:ss"),
        qrSubeKodu: qrSubeKodu,
      };

      const kayit = await basvuruKaydet(veri);
      setBasvuruNo(kayit.basvuruNo);
      setSonBasvuru(kayit);

      setTamamlandi(true);
      taslagiSil();
      basaKaydir();
    } catch (hata: any) {
      message.error(hata?.message ?? "Başvuru gönderilirken bir sorun oluştu.");
    } finally {
      setYukleniyor(false);
    }
  };

  const yeniBasvuru = () => {
    taslagiSil();
    form.resetFields();
    setAdim(0);
    setBasvuruNo("");
    setSonBasvuru(null);
    setTamamlandi(false);
  };

  /* ----------------------------------------------------------- marka başlığı */
  const Baslik = (
    <div className="bsv-ust">
      {logoHata ? (
        <div className="bsv-yazi-logo">
          bi<span>ç</span>en
        </div>
      ) : (
        <img
          src={AYARLAR.logoYolu}
          alt="Biçen Market"
          className="bsv-logo"
          onError={() => setLogoHata(true)}
        />
      )}
      <Title level={3} className="bsv-ust-baslik">
        İŞ BAŞVURU FORMU
      </Title>
      <Text className="bsv-dokuman-no">Doküman No: {AYARLAR.dokumanNo}</Text>
      {!tamamlandi && (
        <Button
          type="link"
          className="bsv-sorgu-link"
          icon={<Search size={15} strokeWidth={2} />}
          onClick={sorgulamayaGit}
        >
          Daha önce başvurdum, başvurumu görüntüle
        </Button>
      )}
    </div>
  );

  /* ------------------------------------------------------------ başarı ekranı */
  if (tamamlandi && sonBasvuru) {
    return (
      <div className="bsv-sayfa">
        <div className="bsv-kapsayici">
          <div className="bsv-yazdirilamaz">
            {Baslik}

            <Card className="bsv-kart" variant="borderless">
              <Result
                icon={<CheckCircle2 size={72} strokeWidth={2} color={RENK.yesil} />}
                title="Başvurunuz bize ulaştı"
                subTitle={
                  <Space direction="vertical" size={6} style={{ marginTop: 8 }}>
                    <Text>
                      Başvuru numaranız: <Text strong>{basvuruNo}</Text>
                    </Text>
                    <Text type="secondary">
                      İnsan Kaynakları ekibimiz başvurunuzu değerlendirecek, uygun bir
                      pozisyon oluştuğunda sizinle iletişime geçecektir. Formunuzun
                      doldurulmuş hâlini aşağıda görebilirsiniz.
                    </Text>
                  </Space>
                }
                extra={
                  <Row gutter={[10, 10]} justify="center" className="bsv-basari-butonlar">
                    <Col xs={24} sm={8}>
                      <Button
                        block
                        size="large"
                        className="bsv-ana-btn"
                        icon={<Printer size={17} strokeWidth={2} />}
                        onClick={() => window.print()}
                      >
                        Yazdır / PDF
                      </Button>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Button
                        block
                        size="large"
                        icon={<Search size={17} strokeWidth={2} />}
                        onClick={sorgulamayaGit}
                      >
                        Başvurularım
                      </Button>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Button block size="large" onClick={yeniBasvuru}>
                        Yeni başvuru
                      </Button>
                    </Col>
                  </Row>
                }
              />
            </Card>

            <div className="bsv-onizleme-baslik">Doldurduğunuz form</div>
          </div>

          <Card className="bsv-kart bsv-onizleme-kart" variant="borderless">
            <FormOnizleme basvuru={sonBasvuru} />
          </Card>

          <div className="bsv-yazdirilamaz">
            <AltBilgi />
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- form ekranı */
  return (
    <div className="bsv-sayfa">
      <div className="bsv-kapsayici">
        {Baslik}

        <Card className="bsv-kart" variant="borderless">
          {FORM_DURUMU.duyuru && (
            <Alert
              type="info"
              showIcon
              className="bsv-duyuru"
              message={FORM_DURUMU.duyuru}
            />
          )}

          {/* Bal küpü: ekranda görünmez, ekran okuyucudan da gizlidir.
              Otomatik form dolduran araçlar bu alanı doldurduğunda başvuru
              incelemeye alınır.

              ÖNEMLİ: Alan adı "websitesi" idi; tarayıcıların otomatik
              doldurma (autofill) özelliği bu adı tanıyıp gerçek kullanıcının
              kayıtlı adres bilgisini dolduruyordu. Sonuç tam tersiydi:
              otomatik doldurması olan gerçek adaylar yakalanıyor, alanı
              programatik dolduran botlar boş bırakıp geçiyordu.

              Düzeltme: autofill'in tanımadığı bir ad kullanılır, sahte bir
              alan adı ("form_alan_dogrula") ile karıştırılır ve
              autoComplete="new-password" ile tarayıcıya "bu bir kayıtlı
              alan değil" sinyali verilir — bu, autofill'i kapatmanın en
              güvenilir yoludur. */}
          <div aria-hidden="true" className="bsv-balkupu-kutu">
            <Form.Item name="form_alan_dogrula" noStyle>
              <input
                type="text"
                tabIndex={-1}
                autoComplete="new-password"
                name="form_alan_dogrula_x"
                aria-hidden="true"
              />
            </Form.Item>
          </div>

          <div className="bsv-adim-satiri">
            {adim > 0 && (
              <Button
                size="small"
                className="bsv-geri-ust"
                icon={<ChevronLeft size={16} strokeWidth={2.2} />}
                onClick={geri}
              >
                Geri
              </Button>
            )}

            <Steps
              current={adim}
              responsive={false}
              size="small"
              className="bsv-adimlar"
              items={ADIM_BASLIKLARI.map((b) => ({ title: b }))}
            />
          </div>

          <Form
            form={form}
            layout="vertical"
            requiredMark="optional"
            scrollToFirstError
            onValuesChange={(degisen) => {
              if ("uyruk" in degisen) {
                form.setFieldValue("tcKimlikNo", undefined);
              }
              if ("il" in degisen) {
                form.setFieldsValue({ ilce: undefined, mahalle: undefined });
              }
              if ("ilce" in degisen) {
                form.setFieldValue("mahalle", undefined);
              }
              if ("subeKodu" in degisen) {
                // Birim değişince önceki pozisyon seçimleri geçersiz olur
                form.setFieldValue("bolumler", []);
              }
            }}
            initialValues={{
              ...(taslak ?? {}),
              subeKodu: secilenBirim,
              uyruk: "T.C.",
              il: ILLER[0],
              engelDurumuVarMi: "Hayır",
              engelRaporuVarMi: "Hayır",
              medeniDurum: "Bekar",
              cocukSayisi: 0,
              ehliyetVarMi: "Hayır",
              ticariTasitBelgesiVarMi: "Hayır",
              oncedenBasvurduMu: "Hayır",
              oncedenCalistiMi: "Hayır",
              halenCalisiyorMu: "Hayır",
              isTecrubesi: [{}],
              sertifikalar: [],
              referanslar: [{}],
              bolumler: [],
              bilgisayarBilgisi: [],
            }}
          >
            {/* ======================================================== ADIM 1 */}
            <div style={{ display: adim === 0 ? "block" : "none" }}>
              <BolumBasligi
                ikon={<Building2 size={16} strokeWidth={2} />}
                metin="BAŞVURDUĞUNUZ BİRİM"
              />

              <div className="bsv-birim-ozet">
                <div className="bsv-birim-bilgi">
                  <Building2 size={20} strokeWidth={2} />
                  <div>
                    <div className="bsv-birim-ad">
                      {secilenBirim ? seciliBirim?.ad ?? "—" : secilenTur}
                    </div>
                    <div className="bsv-birim-tur">
                      {secilenBirim
                        ? seciliBirim?.tur ?? ""
                        : "Aşağıdan çalışmak istediğiniz yeri seçiniz"}
                    </div>
                  </div>
                </div>

                <Button
                  size="small"
                  onClick={() => birimiDegistir(form.getFieldsValue(true))}
                >
                  Değiştir
                </Button>
              </div>

              {secilenBirim ? (
                <Form.Item name="subeKodu" hidden>
                  <Input />
                </Form.Item>
              ) : (
                <Form.Item
                  name="subeKodu"
                  label={`Çalışmak istediğiniz ${secilenTur.toLocaleLowerCase("tr")}`}
                  rules={[{ required: true, message: "Bir birim seçiniz." }]}
                >
                  <Select
                    virtual={false}
                    placeholder="Seçiniz"
                    showSearch
                    optionFilterProp="label"
                    options={turBirimleri.map((x) => ({ value: x.kod, label: x.ad }))}
                  />
                </Form.Item>
              )}

              {seciliBolumler.length > 0 && (
                <>
                  <BolumBasligi
                    ikon={<Briefcase size={16} strokeWidth={2} />}
                    metin={`${(secilenTur || seciliBirim?.tur || "").toLocaleUpperCase("tr")} POZİSYONLARI`}
                    aciklama="Birden fazla seçebilirsiniz"
                  />

                  <Form.Item
                    name="bolumler"
                    rules={[
                      {
                        validator: (_, v) =>
                          v && v.length > 0
                            ? Promise.resolve()
                            : Promise.reject(new Error("En az bir pozisyon seçiniz.")),
                      },
                    ]}
                  >
                    <Checkbox.Group className="bsv-kutu-grup">
                      <Row gutter={[8, 8]}>
                        {seciliBolumler.map((b) => (
                          <Col xs={12} sm={8} md={6} key={b}>
                            <Checkbox value={b} className="bsv-kutu">
                              {b}
                            </Checkbox>
                          </Col>
                        ))}
                      </Row>
                    </Checkbox.Group>
                  </Form.Item>
                </>
              )}
              <BolumBasligi
                ikon={<Camera size={16} strokeWidth={2} />}
                metin="FOTOĞRAFINIZ"
                aciklama="Kamera ile çekebilir veya galerinizden seçebilirsiniz"
              />

              <Form.Item
                name="fotograf"
                rules={[
                  {
                    validator: (_, v) =>
                      v?.base64
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error("Fotoğrafınızı eklemeniz gerekmektedir.")
                          ),
                  },
                ]}
              >
                <FotografAlani />
              </Form.Item>

              <BolumBasligi
                ikon={<UserRound size={16} strokeWidth={2} />}
                metin="KİŞİSEL BİLGİLER"
              />

              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="ad"
                    label="Adınız"
                    rules={[{ required: true, message: "Adınızı giriniz." }]}
                  >
                    <Input placeholder="Adınız" maxLength={50} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="soyad"
                    label="Soyadınız"
                    rules={[{ required: true, message: "Soyadınızı giriniz." }]}
                  >
                    <Input placeholder="Soyadınız" maxLength={50} />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="medeniDurum"
                    label="Medeni Durum"
                    rules={[{ required: true }]}
                  >
                    <Radio.Group buttonStyle="solid">
                      {MEDENI_DURUMLAR.map((m) => (
                        <Radio.Button key={m} value={m}>
                          {m}
                        </Radio.Button>
                      ))}
                    </Radio.Group>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name="cocukSayisi" label="Çocuk Sayısı">
                    <InputNumber
                      min={0}
                      max={15}
                      style={{ width: "100%" }}
                      placeholder="0"
                      disabled={medeniDurum === "Bekar"}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="dogumTarihi"
                    label="Doğum Tarihi"
                    rules={[{ required: true, message: "Doğum tarihinizi seçiniz." }]}
                  >
                    <DatePicker
                      style={{ width: "100%" }}
                      format="DD.MM.YYYY"
                      placeholder="GG.AA.YYYY"
                      inputReadOnly
                      suffixIcon={<CalendarDays size={16} strokeWidth={2} />}
                      disabledDate={(g) =>
                        !!g &&
                        (g.isAfter(dayjs().subtract(16, "year")) ||
                          g.isBefore(dayjs().subtract(70, "year")))
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="dogumYeri"
                    label="Doğum Yeri"
                    rules={[{ required: true, message: "Doğum yerinizi giriniz." }]}
                  >
                    <Input placeholder="Örn: Bursa" maxLength={50} />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item name="uyruk" label="Uyruk" rules={[{ required: true }]}>
                    <Radio.Group buttonStyle="solid" className="bsv-evet-hayir">
                      {UYRUKLAR.map((u) => (
                        <Radio.Button key={u} value={u}>
                          {u}
                        </Radio.Button>
                      ))}
                    </Radio.Group>
                  </Form.Item>
                </Col>

                {yabanciMi && (
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="uyrukUlke"
                      label="Uyruğunuz (Ülke)"
                      rules={[{ required: true, message: "Uyruğunuzu giriniz." }]}
                    >
                      <Input placeholder="Örn: Azerbaycan" maxLength={40} />
                    </Form.Item>
                  </Col>
                )}

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="tcKimlikNo"
                    label={yabanciMi ? "Yabancı Kimlik / Pasaport No" : "T.C. Kimlik No"}
                    validateFirst
                    rules={
                      yabanciMi
                        ? [
                            { required: true, message: "Kimlik veya pasaport numaranızı giriniz." },
                            {
                              pattern: /^[A-Za-z0-9]{6,20}$/,
                              message: "6-20 karakter, yalnızca harf ve rakam giriniz.",
                            },
                          ]
                        : [
                            { required: true, message: "T.C. Kimlik numaranızı giriniz." },
                            {
                              pattern: /^[1-9][0-9]{10}$/,
                              message: "11 haneli olmalı ve 0 ile başlayamaz.",
                            },
                            {
                              /* Sunucu da aynı denetimi yapıyor; uyarı yerine
                                 engelleyerek kullanıcıyı orada hata almaktan
                                 kurtarıyoruz. */
                              validator: (_, v) =>
                                !v || tcKimlikGecerliMi(String(v))
                                  ? Promise.resolve()
                                  : Promise.reject(
                                      new Error(
                                        "Girdiğiniz kimlik numarası geçerli değil. Lütfen kontrol ediniz."
                                      )
                                    ),
                            },
                          ]
                    }
                  >
                    <Input
                      placeholder={
                        yabanciMi ? "Kimlik veya pasaport numaranız" : "11 haneli kimlik numaranız"
                      }
                      maxLength={yabanciMi ? 20 : 11}
                      inputMode={yabanciMi ? "text" : "numeric"}
                      onKeyPress={yabanciMi ? undefined : sadeceRakam}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="kanGrubu"
                    label="Kan Grubu"
                    rules={[{ required: true, message: "Kan grubunuzu seçiniz." }]}
                  >
                    <Select
                      virtual={false}
                      placeholder="Seçiniz"
                      options={KAN_GRUPLARI.map((k) => ({ value: k, label: k }))}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="cepTel1"
                    label="Cep Telefonu - 1"
                    rules={[
                      { required: true, message: "Telefon numaranızı giriniz." },
                      { pattern: /^5[0-9]{9}$/, message: "5XXXXXXXXX biçiminde giriniz." },
                    ]}
                  >
                    <Input
                      addonBefore="+90"
                      placeholder="5XXXXXXXXX"
                      maxLength={10}
                      inputMode="numeric"
                      onKeyPress={sadeceRakam}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="cepTel2"
                    label="Cep Telefonu - 2"
                    rules={[
                      { pattern: /^5[0-9]{9}$/, message: "5XXXXXXXXX biçiminde giriniz." },
                    ]}
                  >
                    <Input
                      addonBefore="+90"
                      placeholder="İkinci numara (varsa)"
                      maxLength={10}
                      inputMode="numeric"
                      onKeyPress={sadeceRakam}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24}>
                  <Form.Item
                    name="email"
                    label="E-Posta Adresiniz"
                    extra="Başvurunuzla ilgili bilgilendirmeler bu adrese gönderilir."
                    rules={[
                      { type: "email", message: "Geçerli bir e-posta adresi giriniz." },
                      ...(FORM_DURUMU.epostaZorunlu
                        ? [{ required: true, message: "E-posta adresinizi giriniz." }]
                        : []),
                    ]}
                  >
                    <Input
                      placeholder="ornek@eposta.com"
                      prefix={<Mail size={16} strokeWidth={2} color={RENK.metinPasif} />}
                    />
                  </Form.Item>
                </Col>

              </Row>

              <BolumBasligi
                ikon={<MapPin size={16} strokeWidth={2} />}
                metin="İKAMET ADRESİ"
                aciklama="İl, ilçe ve mahalle seçimi zorunludur"
              />

              <Row gutter={16}>
                <Col xs={24} sm={8}>
                  <Form.Item
                    name="il"
                    label="İl"
                    rules={[{ required: true, message: "İl seçiniz." }]}
                  >
                    <Select
                      virtual={false}
                      placeholder="Seçiniz"
                      showSearch
                      optionFilterProp="label"
                      options={ILLER.map((x) => ({ value: x, label: x }))}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={8}>
                  <Form.Item
                    name="ilce"
                    label="İlçe"
                    rules={[{ required: true, message: "İlçe seçiniz." }]}
                  >
                    <Select
                      virtual={false}
                      placeholder={il ? "Seçiniz" : "Önce il seçiniz"}
                      disabled={!il}
                      showSearch
                      optionFilterProp="label"
                      options={ilceleriGetir(il).map((x) => ({ value: x, label: x }))}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={8}>
                  <Form.Item
                    name="mahalle"
                    label="Mahalle / Semt"
                    rules={[{ required: true, message: "Mahalle seçiniz." }]}
                  >
                    <Select
                      virtual={false}
                      placeholder={ilce ? "Seçiniz" : "Önce ilçe seçiniz"}
                      disabled={!ilce}
                      showSearch
                      optionFilterProp="label"
                      options={mahalleleriGetir(il, ilce).map((x) => ({
                        value: x,
                        label: x,
                      }))}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="caddeSokak"
                    label="Cadde / Sokak"
                    rules={[{ required: true, message: "Cadde veya sokak adını giriniz." }]}
                  >
                    <Input placeholder="Örn: Belediye Cad. / 15. Sokak" maxLength={120} />
                  </Form.Item>
                </Col>

                <Col xs={12} sm={6}>
                  <Form.Item
                    name="binaNo"
                    label="Bina No"
                    rules={[{ required: true, message: "Bina numarasını giriniz." }]}
                  >
                    <Input placeholder="Örn: 12/A" maxLength={20} />
                  </Form.Item>
                </Col>

                <Col xs={12} sm={6}>
                  <Form.Item name="daireNo" label="Daire No">
                    <Input placeholder="Örn: 5" maxLength={20} />
                  </Form.Item>
                </Col>

                <Col xs={24}>
                  <Form.Item
                    name="evAdresi"
                    label="Adres Açıklaması"
                    extra="Site adı, blok, kat gibi ek bilgileri buraya yazabilirsiniz."
                  >
                    <TextArea
                      rows={2}
                      placeholder="Örn: Yeşil Vadi Sitesi B Blok, 3. kat"
                      maxLength={250}
                      showCount
                    />
                  </Form.Item>
                </Col>
              </Row>

              <BolumBasligi
                ikon={<Accessibility size={16} strokeWidth={2} />}
                metin="ENGEL DURUMU"
                aciklama="Bu bilgiler yalnızca yasal yükümlülükler ve uygun görev planlaması için istenmektedir"
              />

              <Row gutter={16}>
                <Col xs={24} sm={engelVarMi ? 12 : 24}>
                  <Form.Item
                    name="engelDurumuVarMi"
                    label="Engel durumunuz var mı?"
                    rules={[{ required: true }]}
                  >
                    <EvetHayir />
                  </Form.Item>
                </Col>

                {engelVarMi && (
                  <>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="engelTurleri"
                        label="Engel Türü"
                        rules={[{ required: true, message: "Engel türünü seçiniz." }]}
                      >
                        <Select
                          virtual={false}
                          mode="multiple"
                          placeholder="Seçiniz"
                          options={ENGEL_TURLERI.map((x) => ({ value: x, label: x }))}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={12} sm={6}>
                      <Form.Item
                        name="engelOrani"
                        label="Engel Oranı (%)"
                        rules={[{ required: true, message: "Engel oranını giriniz." }]}
                      >
                        <InputNumber
                          min={1}
                          max={100}
                          style={{ width: "100%" }}
                          placeholder="Örn: 40"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={12} sm={6}>
                      <Form.Item
                        name="engelRaporuVarMi"
                        label="Sağlık Kurulu Raporu"
                        rules={[{ required: true }]}
                      >
                        <Select
                          virtual={false}
                          options={[
                            { value: "Evet", label: "Var" },
                            { value: "Hayır", label: "Yok" },
                          ]}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="engelAciklama"
                        label="Açıklama / Özel Gereksinim"
                        extra="Çalışma ortamında ihtiyaç duyduğunuz düzenlemeleri yazabilirsiniz."
                      >
                        <Input placeholder="İsteğe bağlı" maxLength={200} />
                      </Form.Item>
                    </Col>
                  </>
                )}
              </Row>

            </div>

            {/* ======================================================== ADIM 2 */}
            {/* Tecrübe ve başvuru aynı adımda; iki bölüm alt alta akıyor */}
            <div style={{ display: adim === 1 ? "block" : "none" }}>
              {FORM_DURUMU.isTecrubesiBolumuAcik && (
              <>
              <BolumBasligi
                ikon={<Briefcase size={16} strokeWidth={2} />}
                metin="İŞ TECRÜBENİZ"
                aciklama="En son çalıştığınız yerden başlayarak sıralayınız"
              />

              <Form.List name="isTecrubesi">
                {(satirlar, { add, remove }) => (
                  <div className="bsv-liste">
                    {satirlar.map((satir, sira) => (
                      <div key={satir.key} className="bsv-liste-kutu">
                        <div className="bsv-liste-ust">
                          <span className="bsv-liste-no">{sira + 1}</span>
                          <Text strong>İş Yeri</Text>
                          {satirlar.length > 1 && (
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<Trash2 size={15} strokeWidth={2} />}
                              onClick={() => remove(satir.name)}
                            >
                              Kaldır
                            </Button>
                          )}
                        </div>

                        <Row gutter={12}>
                          <Col xs={24} sm={12}>
                            <Form.Item name={[satir.name, "isyeriAdi"]} label="İşyerinin Adı">
                              <Input placeholder="Firma adı" maxLength={100} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12}>
                            <Form.Item name={[satir.name, "gorev"]} label="Göreviniz">
                              <Input placeholder="Örn: Kasiyer" maxLength={80} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12}>
                            <Form.Item name={[satir.name, "netUcret"]} label="Net Ücretiniz">
                              <Input placeholder="Örn: 30.000 ₺" maxLength={30} />
                            </Form.Item>
                          </Col>
                          <Col xs={12} sm={6}>
                            <Form.Item name={[satir.name, "iseGirisTarihi"]} label="İşe Giriş">
                              <DatePicker
                                style={{ width: "100%" }}
                                picker="month"
                                format="MM.YYYY"
                                placeholder="AA.YYYY"
                                inputReadOnly
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={12} sm={6}>
                            <Form.Item name={[satir.name, "istenCikisTarihi"]} label="İşten Çıkış">
                              <DatePicker
                                style={{ width: "100%" }}
                                picker="month"
                                format="MM.YYYY"
                                placeholder="AA.YYYY"
                                inputReadOnly
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24}>
                            <Form.Item
                              name={[satir.name, "ayrilmaSebebi"]}
                              label="İşten Ayrılma Sebebiniz"
                            >
                              <Input placeholder="Örn: Kendi isteğiyle" maxLength={120} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </div>
                    ))}

                    <Button
                      block
                      onClick={() => add()}
                      icon={<Plus size={17} strokeWidth={2} />}
                      className="bsv-ekle-btn"
                    >
                      Yeni iş yeri ekle
                    </Button>

                    <Text type="secondary" className="bsv-ipucu">
                      İş tecrübeniz yoksa bu bölümü boş bırakıp devam edebilirsiniz.
                    </Text>
                  </div>
                )}
              </Form.List>
              </>
              )}

              {FORM_DURUMU.sertifikaBolumuAcik && (
                <>
                  <BolumBasligi
                    ikon={<Award size={16} strokeWidth={2} />}
                    metin="SERTİFİKA VE BELGELERİNİZ"
                    aciklama="Bağlantı olarak ekleyebilir veya fotoğrafını yükleyebilirsiniz"
                  />

                  <SertifikaAlani />
                </>
              )}
            </div>

            {/* ======================================================== ADIM 3 */}
            <div style={{ display: adim === 1 ? "block" : "none" }}>
              <BolumBasligi
                ikon={<GraduationCap size={16} strokeWidth={2} />}
                metin="EĞİTİM VE DİĞER BİLGİLER"
              />

              <Row gutter={16}>

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="askerlikDurumu"
                    label="Askerlik Durumunuz"
                    rules={[{ required: true, message: "Askerlik durumunuzu seçiniz." }]}
                  >
                    <Select
                      virtual={false}
                      placeholder="Seçiniz"
                      options={ASKERLIK_DURUMLARI.map((a) => ({ value: a, label: a }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="egitimSeviyesi"
                    label="Eğitim Seviyeniz"
                    rules={[{ required: true, message: "Eğitim seviyenizi seçiniz." }]}
                  >
                    <Select
                      virtual={false}
                      placeholder="Seçiniz"
                      options={EGITIM_SEVIYELERI.map((e) => ({ value: e, label: e }))}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24}>
                  <Form.Item name="mezunOkul" label="Mezun Olduğunuz Okul / Bölüm">
                    <Input placeholder="Okul ve bölüm adı" maxLength={140} />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={ehliyetVarMi === "Evet" ? 12 : 24}>
                  <Form.Item
                    name="ehliyetVarMi"
                    label="Ehliyetiniz var mı?"
                    rules={[{ required: true }]}
                  >
                    <EvetHayir />
                  </Form.Item>
                </Col>
                {ehliyetVarMi === "Evet" && (
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="ehliyetSinifi"
                      label="Ehliyet Sınıfı"
                      rules={[{ required: true, message: "Ehliyet sınıfını seçiniz." }]}
                    >
                      <Select
                        virtual={false}
                        mode="multiple"
                        placeholder="Seçiniz"
                        options={EHLIYET_SINIFLARI.map((s) => ({ value: s, label: s }))}
                      />
                    </Form.Item>
                  </Col>
                )}

                <Col xs={24} sm={ticariBelge === "Evet" ? 12 : 24}>
                  <Form.Item
                    name="ticariTasitBelgesiVarMi"
                    label="Ticari taşıt kullanma belgeniz var mı?"
                    rules={[{ required: true }]}
                  >
                    <EvetHayir />
                  </Form.Item>
                </Col>
                {ticariBelge === "Evet" && (
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="srcBelgeleri"
                      label="SRC Belgeleriniz"
                      rules={[{ required: true, message: "En az bir belge seçiniz." }]}
                    >
                      <Select
                        virtual={false}
                        mode="multiple"
                        placeholder="Seçiniz"
                        options={SRC_BELGELERI.map((s) => ({ value: s, label: s }))}
                      />
                    </Form.Item>
                  </Col>
                )}

                <Col xs={24}>
                  <Form.Item name="bilgisayarBilgisi" label="Bilgisayar Program Bilginiz">
                    <Checkbox.Group className="bsv-kutu-grup">
                      <Row gutter={[8, 8]}>
                        {BILGISAYAR_PROGRAMLARI.map((p) => (
                          <Col xs={12} sm={6} key={p}>
                            <Checkbox value={p} className="bsv-kutu">
                              {p}
                            </Checkbox>
                          </Col>
                        ))}
                      </Row>
                    </Checkbox.Group>
                  </Form.Item>
                </Col>

                {(bilgisayarBilgisi ?? []).includes("Diğer") && (
                  <Col xs={24}>
                    <Form.Item
                      name="bilgisayarDiger"
                      label="Diğer program bilgileriniz"
                      rules={[{ required: true, message: "Program adlarını yazınız." }]}
                    >
                      <Input placeholder="Örn: Mikro, Logo, AutoCAD" maxLength={120} />
                    </Form.Item>
                  </Col>
                )}
              </Row>
              <BolumBasligi
                ikon={<ClipboardList size={16} strokeWidth={2} />}
                metin="FİRMA BAŞVURU İÇERİĞİ"
              />

              <Row gutter={16}>
                <Col xs={24} sm={oncedenBasvurduMu === "Evet" ? 12 : 24}>
                  <Form.Item
                    name="oncedenBasvurduMu"
                    label="Daha önce firmamıza başvurdunuz mu?"
                    rules={[{ required: true }]}
                  >
                    <EvetHayir />
                  </Form.Item>
                </Col>
                {oncedenBasvurduMu === "Evet" && (
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="oncekiBasvuruAciklama"
                      label="Ne zaman / hangi bölüme?"
                      rules={[{ required: true, message: "Kısaca açıklayınız." }]}
                    >
                      <Input placeholder="Örn: 2024 - Kasiyer" maxLength={120} />
                    </Form.Item>
                  </Col>
                )}

                <Col xs={24} sm={oncedenCalistiMi === "Evet" ? 12 : 24}>
                  <Form.Item
                    name="oncedenCalistiMi"
                    label="Daha önce firmamızda çalıştınız mı?"
                    rules={[{ required: true }]}
                  >
                    <EvetHayir />
                  </Form.Item>
                </Col>
                {oncedenCalistiMi === "Evet" && (
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="oncekiCalismaAciklama"
                      label="Hangi şube / dönem?"
                      rules={[{ required: true, message: "Kısaca açıklayınız." }]}
                    >
                      <Input placeholder="Örn: Sefaköy - 2022/2023" maxLength={120} />
                    </Form.Item>
                  </Col>
                )}

                <Col xs={24} sm={halenCalisiyorMu === "Evet" ? 12 : 24}>
                  <Form.Item
                    name="halenCalisiyorMu"
                    label="Şu an herhangi bir işyerinde çalışıyor musunuz?"
                    rules={[{ required: true }]}
                  >
                    <EvetHayir />
                  </Form.Item>
                </Col>
                {halenCalisiyorMu === "Evet" && (
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="halenCalistigiYer"
                      label="Çalıştığınız işyeri"
                      rules={[{ required: true, message: "İşyeri adını yazınız." }]}
                    >
                      <Input placeholder="Firma adı" maxLength={120} />
                    </Form.Item>
                  </Col>
                )}

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="talepEdilenNetUcret"
                    label="Talep ettiğiniz net ücret"
                    rules={[{ required: true, message: "Ücret beklentinizi giriniz." }]}
                  >
                    <Input placeholder="Örn: 32.000 ₺" maxLength={30} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="iseBaslamaTarihi"
                    label="İşe başlayabileceğiniz tarih"
                    rules={[{ required: true, message: "Tarih seçiniz." }]}
                  >
                    <DatePicker
                      style={{ width: "100%" }}
                      format="DD.MM.YYYY"
                      placeholder="GG.AA.YYYY"
                      inputReadOnly
                      suffixIcon={<CalendarDays size={16} strokeWidth={2} />}
                      disabledDate={(g) => !!g && g.isBefore(dayjs().startOf("day"))}
                    />
                  </Form.Item>
                </Col>
              </Row>

            </div>

            {/* ======================================================== ADIM 4 */}
            <div style={{ display: adim === 2 ? "block" : "none" }}>
              {(FORM_DURUMU.referansBolumuAcik || referansGereken > 0) && (
              <>
              <BolumBasligi
                ikon={<Contact size={16} strokeWidth={2} />}
                metin="REFERANSLARINIZ"
                aciklama="Daha önce beraber veya bağlı çalıştığınız kişileri yazmanız önemle rica olunur"
              />

              {referansGereken > 0 && (
                <div className="bsv-referans-uyari">
                  Başvurduğunuz pozisyon için <b>en az {referansGereken} referans</b> zorunludur.
                  Ad soyad ve telefon numarası eksiksiz olmalıdır.
                </div>
              )}

              <Form.List
                name="referanslar"
                rules={[
                  {
                    validator: async (_, deger: any[]) => {
                      if (referansGereken <= 0) return;
                      const gecerli = (deger ?? []).filter(referansGecerli).length;
                      if (gecerli < referansGereken)
                        throw new Error(
                          `Bu pozisyon için en az ${referansGereken} referans (ad soyad ve telefon) giriniz.`
                        );
                    },
                  },
                ]}
              >
                {(satirlar, { add, remove }, { errors }) => (
                  <div className="bsv-liste">
                    {satirlar.map((satir, sira) => (
                      <div key={satir.key} className="bsv-liste-kutu">
                        <div className="bsv-liste-ust">
                          <span className="bsv-liste-no">{sira + 1}</span>
                          <Text strong>Referans</Text>
                          {satirlar.length > Math.max(1, referansGereken) && (
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<Trash2 size={15} strokeWidth={2} />}
                              onClick={() => remove(satir.name)}
                            >
                              Kaldır
                            </Button>
                          )}
                        </div>

                        <Row gutter={12}>
                          <Col xs={24} sm={12}>
                            <Form.Item
                              name={[satir.name, "adSoyad"]}
                              label="Adı, Soyadı"
                              rules={sira < referansGereken ? [{ required: true, min: 3, message: "Referansın adını soyadını yazınız." }] : []}
                            >
                              <Input placeholder="Ad Soyad" maxLength={80} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12}>
                            <Form.Item name={[satir.name, "calistigiYer"]} label="Çalıştığı Yer">
                              <Input placeholder="Firma / kurum" maxLength={100} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12}>
                            <Form.Item name={[satir.name, "gorev"]} label="Görevi">
                              <Input placeholder="Örn: Mağaza Müdürü" maxLength={80} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12}>
                            <Form.Item
                              name={[satir.name, "telefon"]}
                              label="Telefon Numarası"
                              rules={[
                                ...(sira < referansGereken
                                  ? [{ required: true, message: "Referansın telefonunu yazınız." }]
                                  : []),
                                {
                                  pattern: /^[0-9\s]{10,15}$/,
                                  message: "Geçerli bir numara giriniz.",
                                },
                              ]}
                            >
                              <Input
                                placeholder="05XX XXX XX XX"
                                maxLength={15}
                                inputMode="numeric"
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </div>
                    ))}

                    <Button
                      block
                      onClick={() => add()}
                      icon={<Plus size={17} strokeWidth={2} />}
                      className="bsv-ekle-btn"
                    >
                      Yeni referans ekle
                    </Button>
                    <Form.ErrorList errors={errors} />
                  </div>
                )}
              </Form.List>
              </>
              )}

              <BolumBasligi
                ikon={<FileSignature size={16} strokeWidth={2} />}
                metin="BEYAN VE TAAHHÜT"
              />

              <div className="bsv-taahhut">
                <Paragraph className="bsv-taahhut-metin">{TAAHHUT_METNI}</Paragraph>

                <Form.Item
                  name="taahhutOnay"
                  valuePropName="checked"
                  rules={[
                    {
                      validator: (_, v) =>
                        v
                          ? Promise.resolve()
                          : Promise.reject(new Error("Taahhüt metnini onaylamanız gerekmektedir.")),
                    },
                  ]}
                  style={{ marginBottom: 0 }}
                >
                  <Checkbox>
                    <Text strong style={{ fontSize: 13.5 }}>
                      Okudum, kabul ve taahhüt ediyorum.
                    </Text>
                  </Checkbox>
                </Form.Item>
              </div>

              {/* ------------------------------------------ aydınlatma metni */}
              <BolumBasligi
                ikon={<ScrollText size={16} strokeWidth={2} />}
                metin={AYDINLATMA_BASLIK}
              />

              <div className="bsv-kvkk-kutu">
                <div className="bsv-kvkk-metin">{FORM_DURUMU.aydinlatmaMetni}</div>
              </div>

              <Form.Item
                name="aydinlatmaOnay"
                valuePropName="checked"
                rules={[
                  {
                    validator: (_, v) =>
                      v
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error("Aydınlatma metnini onaylamanız gerekmektedir.")
                          ),
                  },
                ]}
                className="bsv-onay-satiri"
              >
                <Checkbox>
                  <Text strong style={{ fontSize: 13.5 }}>
                    Okudum, anladım · onay veriyorum
                  </Text>
                </Checkbox>
              </Form.Item>

              {/* -------------------------------------- açık rıza beyan formu */}
              <BolumBasligi
                ikon={<FileSignature size={16} strokeWidth={2} />}
                metin={ACIK_RIZA_BASLIK}
                aciklama="Her madde için ayrı ayrı tercih belirtiniz"
              />

              <div className="bsv-kvkk-kutu">
                <div className="bsv-kvkk-metin">{FORM_DURUMU.acikRizaMetni}</div>
              </div>

              {ACIK_RIZA_MADDELERI.map((madde, sira) => (
                <div className="bsv-riza-madde" key={madde.anahtar}>
                  <div className="bsv-riza-metin">
                    <span className="bsv-riza-no">{sira + 1}</span>
                    {madde.metin}
                  </div>
                  <Form.Item
                    name={madde.anahtar}
                    rules={[{ required: true, message: "Tercihinizi belirtiniz." }]}
                    style={{ marginBottom: 0, marginTop: 10 }}
                  >
                    <Radio.Group buttonStyle="solid" className="bsv-riza-secim">
                      {RIZA_SECENEKLERI.map((secenek) => (
                        <Radio.Button key={secenek} value={secenek}>
                          {secenek}
                        </Radio.Button>
                      ))}
                    </Radio.Group>
                  </Form.Item>
                </div>
              ))}

              {/* Bizi nereden duydunuz.

                  Onay adımının başında: aday formu doldurmuş, son
                  sayfada tek bir soru cevaplaması kolay. Liste panelden
                  yönetiliyor ve boşsa alan hiç görünmüyor. */}
              {FORM_DURUMU.basvuruKaynaklari.length > 0 && (
                <div className="bsv-kaynak">
                  <div className="bsv-kaynak-baslik">
                    Bizi nereden duydunuz?
                  </div>

                  <Form.Item
                    name="kaynak"
                    rules={[{ required: true, message: "Lütfen seçiniz." }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Radio.Group className="bsv-kaynak-secim">
                      {FORM_DURUMU.basvuruKaynaklari.map((x) => (
                        <Radio.Button key={x} value={x}>
                          {x}
                        </Radio.Button>
                      ))}
                      <Radio.Button value="Diğer">Diğer</Radio.Button>
                    </Radio.Group>
                  </Form.Item>

                  {kaynakSecimi === "Diğer" && (
                    <Form.Item
                      name="kaynakDetay"
                      rules={[{ required: true, message: "Kısaca yazınız." }]}
                      style={{ marginBottom: 0, marginTop: 10 }}
                    >
                      <Input
                        placeholder="Nereden duyduğunuzu kısaca yazınız"
                        maxLength={300}
                      />
                    </Form.Item>
                  )}
                </div>
              )}

              <div className="bsv-taahhut" style={{ marginTop: 14 }}>
                <Form.Item
                  name="kvkkOnay"
                  valuePropName="checked"
                  rules={[
                    {
                      validator: (_, v) =>
                        v
                          ? Promise.resolve()
                          : Promise.reject(new Error("KVKK onayı vermeniz gerekmektedir.")),
                    },
                  ]}
                  style={{ marginBottom: 0 }}
                >
                  <Checkbox>
                    <Text style={{ fontSize: 13 }}>{KVKK_METNI}</Text>
                  </Checkbox>
                </Form.Item>
              </div>

              <div className="bsv-imza">
                <div className="bsv-imza-kutu">
                  <span className="bsv-imza-etiket">Adayın Adı - Soyadı</span>
                  <span className="bsv-imza-deger">
                    {`${ad ?? ""} ${soyad ?? ""}`.trim() || "—"}
                  </span>
                </div>
                <div className="bsv-imza-kutu">
                  <span className="bsv-imza-etiket">Tarih</span>
                  <span className="bsv-imza-deger">{dayjs().format("DD.MM.YYYY")}</span>
                </div>
              </div>
            </div>

            {/* ====================================================== BUTONLAR */}
            {/* Güvenlik doğrulaması (Cloudflare Turnstile) kaldırıldı:
                yüklenmediğinde ya da takıldığında başvuru hiç
                gönderilemiyor, aday sebebini anlamıyordu. Sunucu tarafındaki
                hız sınırı, ülke kısıtı, kimlik algoritması ve tekrar
                başvuru engeli yerinde duruyor. */}

            <Row gutter={12} className="bsv-butonlar">
              {adim > 0 && (
                <Col xs={10} sm={8}>
                  <Button block size="large" onClick={geri} disabled={yukleniyor}>
                    Geri
                  </Button>
                </Col>
              )}
              <Col xs={adim > 0 ? 14 : 24} sm={adim > 0 ? 16 : 24}>
                {adim < ADIM_ALANLARI.length - 1 ? (
                  <Button block size="large" className="bsv-ana-btn" onClick={ileri}>
                    Devam et
                  </Button>
                ) : (
                  <Button
                    block
                    size="large"
                    className="bsv-ana-btn"
                    loading={yukleniyor}
                    onClick={gonder}
                    icon={!yukleniyor ? <Send size={17} strokeWidth={2} /> : undefined}
                  >
                    Başvuruyu gönder
                  </Button>
                )}
              </Col>
            </Row>
          </Form>
        </Card>

        <AltBilgi />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alt bilgi                                                                   */
/* -------------------------------------------------------------------------- */

function AltBilgi() {
  return (
    <div className="bsv-alt">
      <div className="bsv-alt-satir">
        <ShieldCheck size={14} strokeWidth={2} />
        <span>Bilgileriniz yalnızca işe alım süreçlerinde kullanılır.</span>
      </div>
      <div className="bsv-alt-kunye">
        Dok. Kodu: {AYARLAR.dokKodu} · Rev. No: {AYARLAR.revNo} · Rev. Tar:{" "}
        {AYARLAR.revTarih}
      </div>
      <div className="bsv-alt-marka">Biçen Market · İnsan Kaynakları</div>
    </div>
  );
}
