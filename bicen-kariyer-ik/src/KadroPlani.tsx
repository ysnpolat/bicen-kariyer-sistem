/**
 * ---------------------------------------------------------------------------
 * Kadro Planı
 * ---------------------------------------------------------------------------
 * Hangi bölüme kaç kişi alınacağı burada tanımlanır. Durumu "Olumlu" yapılan
 * başvurular Aday Havuzu ekranında bu hedeflere göre gruplanır ve doluluk
 * oranı gösterilir.
 *
 * İK personeli ve yöneticiler kullanabilir.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { normKadroIndir } from "./raporExcel";
import {
  ClipboardList,
  FileDown,
  FileUp,
  Grid3x3,
  LayoutList,
  Map as HaritaIkonu,
  Plus,
  Target,
  Trash2,
  UserCircle2,
} from "lucide-react";

import Tablo from "./Tablo";
import NormRapor from "./NormRapor";
import PersonelResmi from "./PersonelResmi";
import BolgeRapor from "./BolgeRapor";
import IceriAktar from "./IceriAktar";
import MatrisGiris from "./MatrisGiris";
import {
  api,
  kadroDuzenleme,
  kadroOnerme,
  kullaniciKimligi,
  oturumOku,
} from "./api";
import { personelKartiAc, personelKartiAcilabilir } from "./personelKarti";

const { Title, Text, Paragraph } = Typography;

/** Açılır listede "tüm birimler" seçeneğinin değeri */
const TUM_BIRIMLER = "__TUMU__";

/** Ondalık sayıyı Türkçe biçimde yazar: 24.5 → "24,5" */
const ondalik = (deger: number): string =>
  Number.isInteger(deger) ? String(deger) : deger.toFixed(1).replace(".", ",");

/**
 * Yarım kadro farkını güvenli hesaplar.
 *
 * Kadro değerleri 0,5 adımlarla ilerliyor ve JavaScript ondalık çıkarmada
 * küçük sapmalar üretebiliyor: 6 - 5,5 bazen tam 0,5 çıkmıyor. Bu yüzden
 * "6 mevcut / 5,5 norm" satırı fazla yerine "Tam" görünüyordu. Sonuç
 * yarımlığa yuvarlanarak bu sapma ortadan kaldırılır.
 */
const kadroFarki = (mevcut: unknown, norm: unknown): number =>
  Math.round(((Number(mevcut) || 0) - (Number(norm) || 0)) * 2) / 2;

export default function KadroPlani() {
  const { message, modal } = AntdApp.useApp();

  /* Norm kadro üzerinde düzenleme yetkisi:
     - Yönetici ve genel müdür yardımcısı doğrudan uygular
     - İK yöneticisinin değişiklikleri onaya gider
     - Bölge müdürü ve koordinatör yalnızca görüntüler */
  const oturum = oturumOku();
  const yonetici = kadroDuzenleme(oturum) || kadroOnerme(oturum);

  /* Sistem yöneticisi dışındakilerin değişiklikleri onaya gider ve
     onaylanana kadar uygulanmaz. Bunu kaydettikten sonra öğrenmek geç:
     kullanıcı normun değiştiğini sanıp rapora bakabiliyor. */
  const onayaGider = yonetici && kullaniciKimligi(oturum) !== 1;
  const [matrisAcik, setMatrisAcik] = useState(false);
  const [aktarAcik, setAktarAcik] = useState(false);

  /* Bir pozisyona tıklandığında o birimdeki personel listesi */
  const [personel, setPersonel] = useState<{
    sube: string;
    pozisyon: string;
    liste: any[];
    birimEslesti?: boolean;
    isGruplari?: string[];
  } | null>(null);
  const [personelYukleniyor, setPersonelYukleniyor] = useState(false);
  const [personelDetay, setPersonelDetay] = useState<any>(null);
  const [personelDetayYukleniyor, setPersonelDetayYukleniyor] = useState(false);
  const [ayrilanlar, setAyrilanlar] = useState(false);

  const [liste, setListe] = useState<any[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [acik, setAcik] = useState(false);
  const [form] = Form.useForm();
  const [secenekler, setSecenekler] = useState<{
    bolumler: string[];
    subeler: { kod: string; ad: string; tur?: string }[];
    bolgeler: { ad: string; subeler: string[] }[];
    birimTurleri: { ad: string; bolumler: string[] }[];
  }>({ bolumler: [], subeler: [], bolgeler: [], birimTurleri: [] });

  /* Filtreler */
  const [bolgeFiltre, setBolgeFiltre] = useState<string | undefined>();
  const [subeFiltre, setSubeFiltre] = useState<string | undefined>();
  const [bolumFiltre, setBolumFiltre] = useState<string | undefined>();

  /* Şube bazlı toplu düzenleme çekmecesi */
  const [toplu, setToplu] = useState<{
    subeKodu: string;
    subeAdi: string;
    satirlar: {
      bolum: string;
      norm: number;
      mevcut: number;
      engelli: number;
      aciklama: string;
      /** Çekmece açıldığındaki değerler: yalnızca değişen satırlar gönderilir */
      ilkNorm: number;
      ilkAciklama: string;
    }[];
  } | null>(null);
  const [topluYukleniyor, setTopluYukleniyor] = useState(false);

  const getir = async () => {
    setYukleniyor(true);
    try {
      setListe(await api.al<any[]>("/api/Havuz/Kadro"));
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
      .then((a) =>
        setSecenekler({
          bolumler: a.bolumler ?? [],
          /* Yönetim → Şubeler'de "Norm raporunda gizle" işaretli birimler
             bu ekranda hiç görünmez; şube seçim listesinden de çıkarılır
             ki gizli bir birime yeni kadro açılmasın. */
          subeler: (a.subeler ?? []).filter((x: any) => !x.normRaporundaGizle),
          bolgeler: a.bolgeler ?? [],
          birimTurleri: a.birimTurleri ?? [],
        })
      )
      .catch(() => undefined);
  }, []);

  const kaydet = async () => {
    try {
      const d = await form.validateFields();

      // "Tüm Birimler" seçimi boş şube koduna karşılık gelir
      const subeKodu = d.subeKodu === TUM_BIRIMLER ? "" : d.subeKodu;
      const sube = secenekler.subeler.find((x) => x.kod === subeKodu);

      await api.gonder("/api/Havuz/Kadro", {
        ...d,
        subeKodu,
        subeAdi: sube?.ad ?? null,
      });

      message.success("Kadro kaydedildi.");
      setAcik(false);
      form.resetFields();
      getir();
    } catch (hata: any) {
      if (!hata?.errorFields) message.error(hata.message);
    }
  };

  const sil = (kayit: any) => {
    modal.confirm({
      title: `"${kayit.bolum}" kadrosu silinsin mi?`,
      content: "Havuzdaki adaylar silinmez, yalnızca hedef tanımı kaldırılır.",
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Havuz/Kadro/${kayit.id}`);
          message.success("Kadro silindi.");
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  /* Filtre uygulanmış liste. "Tüm Birimler" kadroları her filtrede görünür,
     çünkü bunlar bütün birimler için geçerlidir. */
  const suzulmus = liste.filter((k) => {
    if (bolumFiltre && k.bolum !== bolumFiltre) return false;

    if (subeFiltre) {
      if (k.subeKodu && k.subeKodu !== subeFiltre) return false;
    }

    if (bolgeFiltre) {
      const bolgeSubeleri =
        secenekler.bolgeler.find((b) => b.ad === bolgeFiltre)?.subeler ?? [];
      if (k.subeKodu && !bolgeSubeleri.includes(k.subeKodu)) return false;
    }

    return true;
  });

  const aktifler = suzulmus.filter((x) => x.aktif);

  /* Kayıtlar birim bazında gruplanır; liste birim satırlarından oluşur */
  const gruplar = useMemo(() => {
    const harita = new Map<string, any>();

    suzulmus.forEach((k) => {
      const anahtar = k.subeKodu || TUM_BIRIMLER;

      if (!harita.has(anahtar)) {
        harita.set(anahtar, {
          anahtar,
          subeKodu: k.subeKodu,
          subeAdi: k.subeAdi || k.subeKodu || "Tüm Birimler",
          bolge:
            secenekler.bolgeler.find((b) =>
              (b.subeler ?? []).includes(k.subeKodu ?? "")
            )?.ad ?? "",
          satirlar: [],
          norm: 0,
          mevcut: 0,
          engelli: 0,
          raporlu: 0,
          raporlular: [],
          pozEksik: 0,
          pozFazla: 0,
        });
      }

      const grup = harita.get(anahtar);
      grup.satirlar.push(k);
      grup.norm += k.norm ?? 0;
      grup.mevcut += k.mevcut ?? 0;
      grup.engelli += k.engelli ?? 0;

      /* Raporlu kişiler yalnızca aktif satırlara yazılıyor (sunucu) */
      grup.raporlu += k.raporlu ?? 0;
      grup.raporlular.push(...(k.raporlular ?? []));

      /* Pasif satırlar toplamlara girmez: Şube Raporu da yalnızca aktif
         kadroları sayıyor, buradaki fark bundan kaynaklanıyordu. */
      if (k.aktif === false) return;

      /* Eksik ve fazla POZİSYON bazında toplanır. Şube toplamından
         çıkarılan net sayı bilgi gizliyor: iki fazla bir eksiği götürüp
         "+1" gösteriyor, oysa hem alınacak hem fazlalık var. Şube Raporu
         da bu ikisini ayrı sütunlarda gösteriyor. */
      const satirFarki = kadroFarki(k.mevcut, k.norm);

      grup.pozEksik += Math.max(0, -satirFarki);
      grup.pozFazla += Math.max(0, satirFarki);
    });

    return Array.from(harita.values()).sort((a, b) =>
      a.subeAdi.localeCompare(b.subeAdi, "tr")
    );
  }, [suzulmus, secenekler.bolgeler]);
  const toplamNorm = aktifler.reduce((t, x) => t + (x.norm ?? 0), 0);
  const toplamMevcut = aktifler.reduce((t, x) => t + (x.mevcut ?? 0), 0);
  /* Eksik ve fazla, Şube Raporu ile BİREBİR aynı yöntemle hesaplanır:
     her şube için önce norm eksi mevcut bulunur, sonra eksi kalanlar
     Eksik'e, artı kalanlar Fazla'ya yazılır.

     İki eleme Şube Raporu'ndan alındı ve buradaki farkın sebebiydi:
     pasif kadro satırları ve şube kodu olmayan ("Tüm Birimler") kayıtlar
     hesaba girmez. */
  const raporGruplari = useMemo(
    () =>
      gruplar.filter(
        (g) => g.subeKodu && String(g.subeKodu).trim().length > 0
      ),
    [gruplar]
  );

  /* Kartlar POZİSYON bazında toplanır: ekranda hangi pozisyonda kaç
     eksik/fazla görünüyorsa onların toplamı. Şube net farkı kullanılırsa
     bir şubedeki fazla aynı şubedeki eksiği götürüyor ve kartlar
     satırlarla tutmuyordu. Şube Raporu da bu yöntemi kullanır. */
  const toplamHedef = raporGruplari.reduce(
    (t, g) => t + (g.pozEksik ?? 0),
    0
  );

  const toplamFazla = raporGruplari.reduce(
    (t, g) => t + (g.pozFazla ?? 0),
    0
  );

  const toplamEngelli = raporGruplari.reduce(
    (t, g) => t + (g.engelli ?? 0),
    0
  );

  /* Bugün raporlu çalışan (kişi). Mevcuda dahil; engelli gibi bilgi. */
  const toplamRaporlu = raporGruplari.reduce(
    (t, g) => t + (g.raporlu ?? 0),
    0
  );

  /** Raporlu hücresi: sayı + ad ve bitiş tarihleri ipucunda */
  const raporluHucre = (v: number, k: any) =>
    v > 0 ? (
      <Tooltip
        title={
          <div style={{ whiteSpace: "pre-line" }}>
            {`Bugün raporlu · bitiş tarihi\n${(k.raporlular ?? []).join("\n")}\n\nMevcut sayısına dahil.`}
          </div>
        }
      >
        <Tag color="magenta">{v}</Tag>
      </Tooltip>
    ) : (
      <span style={{ color: "#bbb" }}>—</span>
    );

  /**
   * Norm kadroyu Excel'e aktarır (raporExcel.normKadroIndir): birim ×
   * pozisyon çapraz tabloları, özet, düz veri ve gerçek PivotTable.
   *
   * Önceki sürüm HTML'i .xls uzantısıyla veriyordu; Excel "dosya biçimi
   * ve uzantısı eşleşmiyor" uyarısı çıkarıyordu.
   */
  const [pivotHazirlaniyor, setPivotHazirlaniyor] = useState(false);

  const pivotAktar = async () => {
    if (raporGruplari.length === 0) {
      message.info("Dışa aktarılacak kayıt yok.");
      return;
    }

    setPivotHazirlaniyor(true);

    try {
      /* Çalışanlar pivotta pozisyonun altında ad ad listelensin */
      const p = await api
        .al<any>("/api/Personel?durum=calisan")
        .catch(() => ({ personeller: [] }));

      const personeller = (p?.personeller ?? []).map((x: any) => ({
        personelKodu: x.personelKodu,
        adSoyad: `${x.ad ?? ""} ${x.soyad ?? ""}`.trim(),
        sube: x.sube || x.isGrubu,
        pozisyon: x.pozisyon,
        girisTarihi: x.girisTarihi,
        kimlikNo: x.kimlikNo,
        engelli: !!x.engelli,
        telefon: x.telefon,
        calismaGunu: x.calismaGunu,
      }));

      await normKadroIndir(raporGruplari as any, personeller);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setPivotHazirlaniyor(false);
    }
  };

  const pozisyonSutunlari: ColumnsType<any> = [
    {
      title: "Pozisyon",
      dataIndex: "bolum",
      width: 190,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: "Norm Kadro",
      dataIndex: "norm",
      width: 110,
      align: "center",
      render: (v: number) =>
        v ? <b>{ondalik(v)}</b> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "Mevcut",
      dataIndex: "mevcut",
      width: 95,
      align: "center",
      render: (v: number) => ondalik(v ?? 0),
    },
    {
      title: "İhtiyaç / Fazla",
      key: "ihtiyacFazla",
      width: 125,
      align: "center",
      render: (_v: number, k: any) => {
        /* Bu sütun hem şube satırlarında hem içerideki pozisyon
           satırlarında kullanılıyor; ikisi farklı hesaplanır.

           Şube satırında eksik ve fazla ayrı ayrı toplanmıştır ve ikisi
           birden görünebilir. Pozisyon satırında ise tek bir fark vardır.
           Ayrımı yapmadan pozEksik/pozFazla okunduğunda pozisyon
           satırlarında bu alanlar bulunmadığı için her satır "Tam"
           görünüyordu. */
        const subeSatiri = Array.isArray(k.satirlar);

        if (!subeSatiri) {
          if ((k.norm ?? 0) === 0 && (k.mevcut ?? 0) === 0)
            return (
              <Tooltip title="Norm girilmemiş, çalışan da yok.">
                <span style={{ color: "#bbb" }}>norm yok</span>
              </Tooltip>
            );

          const fark = kadroFarki(k.mevcut, k.norm);

          if (fark > 0) return <Tag color="red">+{ondalik(fark)} fazla</Tag>;
          if (fark < 0) return <Tag>{ondalik(-fark)} eksik</Tag>;

          return <Tag color="green">Tam</Tag>;
        }

        const eksik = Number(k.pozEksik ?? 0);
        const fazla = Number(k.pozFazla ?? 0);

        if (eksik === 0 && fazla === 0)
          return <Tag color="green">Tam</Tag>;

        return (
          <Space size={4} wrap>
            {eksik > 0 && <Tag>{ondalik(eksik)} eksik</Tag>}
            {fazla > 0 && <Tag color="red">+{ondalik(fazla)} fazla</Tag>}
          </Space>
        );
      },
    },
    {
      title: "Süre",
      dataIndex: "eksikGun",
      width: 80,
      align: "center",
      render: (v: number, k) =>
        k.hedef > 0 && v > 0 ? (
          <Tooltip title="Bu pozisyonun kaç gündür açık olduğu">
            <Tag color={v > 30 ? "red" : v > 7 ? "orange" : "gold"}>{v} gün</Tag>
          </Tooltip>
        ) : (
          <span style={{ color: "#bbb" }}>—</span>
        ),
    },
    {
      title: "Engelli",
      dataIndex: "engelli",
      width: 90,
      align: "center",
      render: (v: number) =>
        v > 0 ? <Tag color="orange">{v}</Tag> : <span style={{ color: "#bbb" }}>—</span>,
    },
    {
      title: "Raporlu",
      dataIndex: "raporlu",
      width: 85,
      align: "center",
      render: raporluHucre,
    },
    { title: "Açıklama", dataIndex: "aciklama", ellipsis: true },
    {
      title: "Durum",
      dataIndex: "aktif",
      width: 80,
      align: "center",
      render: (v: boolean) => (v ? <Tag color="green">Aktif</Tag> : <Tag>Pasif</Tag>),
    },
    {
      title: "",
      width: 150,
      hidden: !yonetici,
      render: (_v, kayit) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              form.setFieldsValue({
                ...kayit,
                subeKodu: kayit.subeKodu || TUM_BIRIMLER,
              });
              setAcik(true);
            }}
          >
            Düzenle
          </Button>
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

  /* -------------------------------------------------- toplu düzenleme */

  /** Seçilen birim ve pozisyondaki personeli getirir */
  const personelAc = async (
    subeAdi: string,
    pozisyon: string,
    ayrilanDahil = ayrilanlar
  ) => {
    setPersonel({ sube: subeAdi, pozisyon, liste: [] });
    setPersonelYukleniyor(true);

    try {
      const sorgu = new URLSearchParams({ sube: subeAdi, pozisyon });
      if (ayrilanDahil) sorgu.set("ayrilanlar", "true");

      const sonuc = await api.al<any>(`/api/Personel/Birim?${sorgu.toString()}`);

      setPersonel({
        sube: subeAdi,
        pozisyon,
        liste: sonuc.personeller ?? [],
        birimEslesti: sonuc.birimEslesti,
        isGruplari: sonuc.isGruplari ?? [],
      });
    } catch (hata: any) {
      message.error(hata.message);
      setPersonel({ sube: subeAdi, pozisyon, liste: [] });
    } finally {
      setPersonelYukleniyor(false);
    }
  };

  /** Personel satırına tıklanınca ayrıntıları açar */
  const personelDetayAc = async (kod: string) => {
    if (!kod) return;

    /* 09.10.2026: Personeller sayfasındaki personel kartı (her sayfada aynı
       kart). Rol o sayfayı görmüyorsa eski ayrıntı penceresi açılır. */
    if (personelKartiAcilabilir()) {
      personelKartiAc(kod);
      return;
    }

    setPersonelDetay({ kisi: null });
    setPersonelDetayYukleniyor(true);

    try {
      setPersonelDetay(
        await api.al<any>(`/api/Personel/Detay?kod=${encodeURIComponent(kod)}`)
      );
    } catch (hata: any) {
      message.error(hata.message);
      setPersonelDetay(null);
    } finally {
      setPersonelDetayYukleniyor(false);
    }
  };

  const topluAc = (subeKodu: string) => {
    const sube = secenekler.subeler.find((x) => x.kod === subeKodu);
    const tur = sube?.tur ?? "Şube";

    const pozisyonlar =
      secenekler.birimTurleri.find((t) => t.ad === tur)?.bolumler ?? [];

    /* Ayarlarda tanımlı pozisyonlara ek olarak, bu şubede hâlihazırda
       kadro kaydı bulunan bölümler de listeye alınır. Otomatik açılan
       satırlar (personel bulunduğu için oluşturulanlar) ayar listesinde
       yer almadığı için önceden toplu düzenlemede görünmüyordu.

       Pozisyonlar büyük/küçük harf ve baştaki/sondaki boşluk gözetmeden
       tek satıra toplanıyor. Önceden ayardaki "KASİYER" ile kayıttaki
       "Kasiyer " iki ayrı satır oluyor, normu 0 görünen satır sunucuda
       gerçek kayıtla eşleşip hiçbir şey değiştirilmeden kaydedildiğinde
       normu değiştirilmiş gibi onaya gidiyordu (29.09.2026). */
    const anahtar = (b: string) => (b ?? "").trim().toLocaleUpperCase("tr-TR");

    const gruplar = new Map<string, { ad: string; kayitlar: any[] }>();

    liste
      .filter((k) => (k.subeKodu ?? "") === subeKodu)
      .forEach((k) => {
        const a = anahtar(k.bolum);
        const g = gruplar.get(a) ?? { ad: (k.bolum ?? "").trim(), kayitlar: [] as any[] };
        g.kayitlar.push(k);
        gruplar.set(a, g);
      });

    pozisyonlar.forEach((p) => {
      const a = anahtar(p);
      if (!gruplar.has(a)) gruplar.set(a, { ad: p.trim(), kayitlar: [] as any[] });
    });

    /* Aynı pozisyon için birden fazla kayıt varsa rapor gibi toplanıyor;
       sunucu da karşılaştırmayı toplamla yapıyor */
    const topla = (l: any[], alan: string) => l.reduce((t, k) => t + Number(k?.[alan] ?? 0), 0);

    const satirlar = [...gruplar.values()]
      .sort((a, b) => a.ad.localeCompare(b.ad, "tr"))
      .map(({ ad, kayitlar }) => {
        const norm = topla(kayitlar, "norm");
        const aciklama = kayitlar.find((k) => k.aciklama)?.aciklama ?? "";

        return {
          bolum: ad,
          norm,
          mevcut: topla(kayitlar, "mevcut"),
          engelli: topla(kayitlar, "engelli"),
          aciklama,
          ilkNorm: norm,
          ilkAciklama: aciklama,
        };
      });

    setToplu({ subeKodu, subeAdi: sube?.ad ?? subeKodu, satirlar });
  };

  const topluKaydet = async () => {
    if (!toplu) return;

    /* Yalnızca değiştirilen satırlar gönderiliyor: hiçbir şeye
       dokunmadan kaydedince onaya hiçbir şey gitmemeli */
    const degisenler = toplu.satirlar.filter(
      (x) =>
        Number(x.norm ?? 0) !== Number(x.ilkNorm ?? 0) ||
        (x.aciklama ?? "").trim() !== (x.ilkAciklama ?? "").trim()
    );

    if (degisenler.length === 0) {
      message.info("Hiçbir değişiklik yapılmadı.");
      setToplu(null);
      return;
    }

    /* Gönderilmeden önce neyin değişeceği gösteriliyor: kullanıcı yalnızca
       dokunduğu pozisyonların gittiğini görsün */
    const devam = await new Promise<boolean>((sonuc) =>
      modal.confirm({
        title: `${degisenler.length} pozisyon kaydedilsin mi?`,
        okText: "Kaydet",
        cancelText: "Vazgeç",
        content: (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {degisenler.map((x) => (
              <li key={x.bolum}>
                <b>{x.bolum}</b>
                {Number(x.norm) !== Number(x.ilkNorm)
                  ? `: norm ${ondalik(x.ilkNorm)} → ${ondalik(x.norm)}`
                  : ": açıklama değişti"}
              </li>
            ))}
          </ul>
        ),
        onOk: () => sonuc(true),
        onCancel: () => sonuc(false),
      })
    );

    if (!devam) return;

    setTopluYukleniyor(true);
    try {
      const sonuc = await api.gonder<any>(
        "/api/Havuz/KadroToplu",
        degisenler.map(({ ilkNorm, ilkAciklama, ...x }) => ({
          ...x,
          subeKodu: toplu.subeKodu,
          subeAdi: toplu.subeAdi,
        }))
      );

      /* Sistem yöneticisi dışındaki değişiklikler uygulanmaz, onaya
         gider. Kullanıcı "kaydedildi" görüp normun değiştiğini
         sanmamalı; bu yüzden ayrı ve kalıcı bir pencere gösterilir. */
      if (sonuc?.onayaGonderildi > 0) {
        modal.info({
          title: "Onaya gönderildi",
          okText: "Anladım",
          content: (
            <div>
              <p style={{ marginTop: 0 }}>
                <b>{sonuc.onayaGonderildi} norm değişikliği</b> yetkili
                onayına gönderildi.
              </p>
              <p style={{ marginBottom: 0 }}>
                Norm kadro <b>henüz güncellenmedi</b>. Onay verildiğinde
                değişiklikler uygulanacak ve size bildirim gelecek.
              </p>
            </div>
          ),
        });
      } else if (sonuc?.degisiklikYok) {
        message.info("Norm değerlerinde değişiklik yok.");
      } else {
        message.success(`${toplu.subeAdi} kadroları kaydedildi.`);
      }

      setToplu(null);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setTopluYukleniyor(false);
    }
  };

  return (
    <div className="ik-icerik">
      {onayaGider && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Değişiklikleriniz onaya gönderilir"
          description="Norm sayısında yaptığınız değişiklikler kaydedildikten sonra yetkili onayına düşer. Onaylandığında ya da reddedildiğinde bildirim alırsınız."
        />
      )}

      <Card>
        <Tabs
          defaultActiveKey="duzenleme"
          destroyInactiveTabPane
          items={[
            {
              key: "duzenleme",
              label: (
                <Space size={6}>
                  <Target size={15} strokeWidth={2} />
                  Kadro Düzenleme
                </Space>
              ),
              children: <div className="kp-sekme">
        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 14 }}>
          <Col xs={24} md={9}>
            <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>
              <Space size={8}>
                <Target size={18} strokeWidth={2} />
                Şube Norm Kadro ve İhtiyaçlar
              </Space>
            </Title>
            {onayaGider && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 10 }}
                message="Norm değişiklikleriniz onaya gider"
                description="Kaydettiğinizde norm kadro hemen güncellenmez; yetkili onayladıktan sonra uygulanır ve size bildirim gelir."
              />
            )}

            <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
              Her birim için pozisyon bazında norm kadroyu ve mevcut personel
              sayısını giriniz; ihtiyaç otomatik hesaplanır. Örneğin Atakent
              şubesinde 6 kasiyer normu ve 4 mevcut personel varsa 2 kasiyer
              ihtiyacı görünür. Bu bilgiler Aday Havuzu ve Raporlar ekranlarına
              yansır.
            </Paragraph>
          </Col>

          {/* Özet kartları: altı kart başlık sütununun yanında eşit dağılır */}
          <Col xs={24} md={15}><Row gutter={[12, 12]}>
          <Col xs={8} md={4}>
            <Card size="small" style={{ textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Norm
              </Text>
              <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.2 }}>
                {ondalik(toplamNorm)}
              </div>
            </Card>
          </Col>

          <Col xs={8} md={4}>
            <Card size="small" style={{ textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Mevcut
              </Text>
              <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.2 }}>
                {ondalik(toplamMevcut)}
              </div>
            </Card>
          </Col>

          <Col xs={8} md={4}>
            <Card size="small" style={{ textAlign: "center", borderColor: "#ffd591" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Eksik
              </Text>
              <div
                style={{
                  fontSize: 21,
                  fontWeight: 800,
                  lineHeight: 1.2,
                  color: "#d46b08",
                }}
              >
                {ondalik(toplamHedef)}
              </div>
            </Card>
          </Col>

          <Col xs={8} md={4}>
            <Card size="small" style={{ textAlign: "center", borderColor: "#ffa39e" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Fazla
              </Text>
              <div
                style={{
                  fontSize: 21,
                  fontWeight: 800,
                  lineHeight: 1.2,
                  color: "#cf1322",
                }}
              >
                {ondalik(toplamFazla)}
              </div>
            </Card>
          </Col>

          <Col xs={8} md={4}>
            <Card size="small" style={{ textAlign: "center", borderColor: "#ffd591" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Engelli
              </Text>
              <div
                style={{
                  fontSize: 21,
                  fontWeight: 800,
                  lineHeight: 1.2,
                  color: "#d46b08",
                }}
              >
                {ondalik(toplamEngelli)}
              </div>
            </Card>
          </Col>

          <Col xs={8} md={4}>
            <Tooltip title="Bugün sağlık raporlu çalışan. Mevcut sayısına dahildir; eksik ve fazlayı değiştirmez.">
              <Card size="small" style={{ textAlign: "center", borderColor: "#f1c4e2" }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Raporlu
                </Text>
                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    color: "#a0277d",
                  }}
                >
                  {toplamRaporlu}
                </div>
              </Card>
            </Tooltip>
          </Col>

          </Row></Col>
          <Col xs={24}>
            <Space size={6} wrap style={{ marginTop: 6 }}>
              {yonetici && (
                <>
                  <Button
                    icon={<FileDown size={15} strokeWidth={2} />}
                    onClick={pivotAktar}
                    loading={pivotHazirlaniyor}
                    title="Birim × pozisyon çapraz tabloları, özet ve çalışan adlarına inen PivotTable"
                  >
                    Pivot olarak indir
                  </Button>

                  <Button
                    type="primary"
                    icon={<FileUp size={15} strokeWidth={2} />}
                    onClick={() => setAktarAcik(true)}
                  >
                    Excel'den içeri aktar
                  </Button>

                  <Button
                    icon={<Grid3x3 size={15} strokeWidth={2} />}
                    onClick={() => setMatrisAcik(true)}
                  >
                    Excel görünümünde gir
                  </Button>

                  <Button
                    icon={<LayoutList size={15} strokeWidth={2} />}
                    disabled={!subeFiltre}
                    title={
                      subeFiltre
                        ? undefined
                        : "Önce yukarıdan bir birim seçiniz"
                    }
                    onClick={() => subeFiltre && topluAc(subeFiltre)}
                  >
                    Şubeyi toplu düzenle
                  </Button>
                </>
              )}

              <Button
                icon={<Plus size={15} strokeWidth={2} />}
                disabled={!yonetici}
                onClick={() => {
                  form.resetFields();
                  form.setFieldsValue({
                    norm: 1,
                    mevcut: 0,
                    engelli: 0,
                    hedef: 1,
                    aktif: true,
                    subeKodu: subeFiltre || TUM_BIRIMLER,
                  });
                  setAcik(true);
                }}
              >
                Yeni kadro
              </Button>
            </Space>
          </Col>
        </Row>

        {!yonetici && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Norm kadro bilgilerini yalnızca yöneticiler düzenleyebilir."
            description="Bu ekranda mevcut kadro durumunu görüntüleyebilir, Şube Raporu sekmesinden dökümü alabilirsiniz."
          />
        )}

        <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={6}>
            <Select
              allowClear
              showSearch
              placeholder="Bölgeye göre filtrele"
              style={{ width: "100%" }}
              value={bolgeFiltre}
              onChange={(v) => {
                setBolgeFiltre(v);
                setSubeFiltre(undefined);
              }}
              options={secenekler.bolgeler.map((b) => ({
                value: b.ad,
                label: `${b.ad} (${b.subeler?.length ?? 0} birim)`,
              }))}
            />
          </Col>

          <Col xs={24} md={6}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Birime göre filtrele"
              style={{ width: "100%" }}
              value={subeFiltre}
              onChange={setSubeFiltre}
              options={secenekler.subeler
                .filter((x) => {
                  if (!bolgeFiltre) return true;
                  const kodlar =
                    secenekler.bolgeler.find((b) => b.ad === bolgeFiltre)?.subeler ?? [];
                  return kodlar.includes(x.kod);
                })
                .map((x) => ({
                  value: x.kod,
                  label: `${x.ad}${x.tur ? ` · ${x.tur}` : ""}`,
                }))}
            />
          </Col>

          <Col xs={24} md={6}>
            <Select
              allowClear
              showSearch
              placeholder="Pozisyona göre filtrele"
              style={{ width: "100%" }}
              value={bolumFiltre}
              onChange={setBolumFiltre}
              options={secenekler.bolumler.map((b) => ({ value: b, label: b }))}
            />
          </Col>

          <Col xs={24} md={6}>
            <Space>
              <Button
                disabled={!bolgeFiltre && !subeFiltre && !bolumFiltre}
                onClick={() => {
                  setBolgeFiltre(undefined);
                  setSubeFiltre(undefined);
                  setBolumFiltre(undefined);
                }}
              >
                Filtreyi temizle
              </Button>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {suzulmus.length} kayıt
              </Text>
            </Space>
          </Col>
        </Row>

        <Tablo
          rowKey="anahtar"
          size="small"
          loading={yukleniyor}
          dataSource={gruplar}
          pagination={false}
          scroll={{ x: 900 }}
          rowClassName="kp-birim-satir"
          expandable={{
            expandedRowRender: (grup: any) => (
              <Tablo
                rowKey="id"
                size="small"
                columns={pozisyonSutunlari}
                dataSource={grup.satirlar}
                pagination={false}
                className="kp-ic-tablo"
                rowClassName="kp-pozisyon-satir"
                onRow={(kayit: any) => ({
                  onClick: () =>
                    kayit.subeKodu &&
                    personelAc(grup.subeAdi, kayit.bolum),
                })}
              />
            ),
            rowExpandable: (grup: any) => grup.satirlar.length > 0,
          }}
          columns={[
            {
              title: "Birim",
              dataIndex: "subeAdi",
              render: (v: string, k: any) => (
                <div>
                  {/* Şube adına tıklayınca o birimin personeli listelenir */}
                  <Button
                    type="link"
                    style={{ padding: 0, height: "auto", fontSize: 14, fontWeight: 600 }}
                    onClick={() => personelAc(k.subeAdi, "")}
                  >
                    {v}
                  </Button>
                  {k.bolge && (
                    <div style={{ fontSize: 11.5, color: "#8a8f98" }}>{k.bolge}</div>
                  )}
                </div>
              ),
            },
            {
              title: "Pozisyon",
              key: "adet",
              width: 110,
              align: "center",
              render: (_v, k: any) => <Tag>{k.satirlar.length}</Tag>,
            },
            {
              title: "Norm",
              dataIndex: "norm",
              width: 100,
              align: "center",
              sorter: (a: any, b: any) => a.norm - b.norm,
              render: (v: number) =>
                v ? <b>{ondalik(v)}</b> : <span style={{ color: "#bbb" }}>—</span>,
            },
            {
              title: "Mevcut",
              dataIndex: "mevcut",
              width: 100,
              align: "center",
              render: (v: number) => ondalik(v) || "—",
            },
            {
              title: "İhtiyaç / Fazla",
              dataIndex: "hedef",
              width: 130,
              align: "center",
              sorter: (a: any, b: any) =>
                (a.mevcut - a.norm) - (b.mevcut - b.norm),
              render: (v: number, k: any) => {
                /* Norm girilmemiş ve kimse çalışmıyorsa ölçecek bir şey
                   yoktur. Ama normu olmayan bir pozisyonda çalışan varsa
                   o fazladır: kadro tanımlanmamış bir yerde personel
                   duruyor demektir ve şube farkında da öyle sayılıyor. */
                if ((k.norm ?? 0) === 0 && (k.mevcut ?? 0) === 0)
                  return (
                    <Tooltip title="Norm girilmemiş, çalışan da yok.">
                      <span style={{ color: "#bbb" }}>norm yok</span>
                    </Tooltip>
                  );

                /* Eksik ve fazla aynı farktan türer; "hedef" kolonuna
                   bakılmaz (bkz. şube toplamındaki açıklama). */
                const fark = kadroFarki(k.mevcut, k.norm);

                if (fark > 0)
                  return <Tag color="red">+{ondalik(fark)} fazla</Tag>;

                if (fark < 0)
                  return <Tag>{ondalik(-fark)} eksik</Tag>;

                return <Tag color="green">Tam</Tag>;
              },
            },
            {
              title: "Engelli",
              dataIndex: "engelli",
              width: 95,
              align: "center",
              render: (v: number) =>
                v > 0 ? (
                  <Tag color="orange">{ondalik(v)}</Tag>
                ) : (
                  <span style={{ color: "#bbb" }}>—</span>
                ),
            },
            {
              title: "Raporlu",
              dataIndex: "raporlu",
              width: 95,
              align: "center",
              sorter: (a: any, b: any) => (a.raporlu ?? 0) - (b.raporlu ?? 0),
              render: raporluHucre,
            },
            {
              title: "",
              width: 150,
              hidden: !yonetici,
              render: (_v, k: any) =>
                k.subeKodu ? (
                  <Button
                    size="small"
                    icon={<LayoutList size={14} strokeWidth={2} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      topluAc(k.subeKodu);
                    }}
                  >
                    Toplu düzenle
                  </Button>
                ) : null,
            },
          ]}
        />
              </div>,
            },
            {
              key: "rapor",
              label: (
                <Space size={6}>
                  <ClipboardList size={15} strokeWidth={2} />
                  Şube Raporu
                </Space>
              ),
              children: <NormRapor />,
            },
            {
              key: "bolge",
              label: (
                <Space size={6}>
                  <HaritaIkonu size={15} strokeWidth={2} />
                  Bölge Raporu
                </Space>
              ),
              children: <BolgeRapor />,
            },
          ]}
        />
      </Card>

      {/* ------------------------------------------------- personel detayı */}
      <Drawer
        open={!!personelDetay}
        onClose={() => setPersonelDetay(null)}
        width="min(1020px, 96vw)"
        className="rp-cekmece"
        title={
          personelDetay?.kisi ? (
            <Space wrap size={8}>
              <Text strong>
                {personelDetay.kisi.ad} {personelDetay.kisi.soyad}
              </Text>
              {personelDetay.kisi.durum === 1 ? (
                <Tag color="green">Çalışıyor</Tag>
              ) : (
                <Tag color="red">Ayrıldı</Tag>
              )}
              {personelDetay.calismaSayisi > 1 && (
                <Tag color="purple">{personelDetay.calismaSayisi}. kez çalışıyor</Tag>
              )}
            </Space>
          ) : (
            "Personel"
          )
        }
      >
        {personelDetayYukleniyor ? (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <Spin />
          </div>
        ) : (
          personelDetay?.kisi && (
            <>
              <div className="pd-ust">
                <div className="pd-resim">
                  {personelDetay.resim ? (
                    <img src={personelDetay.resim} alt={personelDetay.kisi.ad} />
                  ) : (
                    <div className="pd-resim-yok">
                      <UserCircle2 size={44} strokeWidth={1.4} />
                      <span>Fotoğraf yok</span>
                    </div>
                  )}
                </div>

                <div className="pd-bilgi">
                  <div>
                    <span>Personel Kodu</span>
                    <b>{personelDetay.kisi.personelKodu || "—"}</b>
                  </div>
                  <div>
                    <span>Kimlik No</span>
                    <b>{personelDetay.kisi.kimlikNo || "—"}</b>
                  </div>
                  <div>
                    <span>Telefon</span>
                    <b>{personelDetay.kisi.telefon || "—"}</b>
                  </div>
                  <div>
                    <span>İş Grubu</span>
                    <b>{personelDetay.kisi.isGrubu || "—"}</b>
                  </div>
                  <div>
                    <span>Ünvan</span>
                    <b>{personelDetay.kisi.pozisyon || "—"}</b>
                  </div>
                  <div>
                    <span>İşe Giriş</span>
                    <b>
                      {personelDetay.kisi.girisTarihi
                        ? dayjs(personelDetay.kisi.girisTarihi).format("DD.MM.YYYY")
                        : "—"}
                    </b>
                  </div>
                </div>
              </div>

              {(personelDetay.gecmis ?? []).some((g: any) => g.cikisTarihi) && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 14 }}
                  message="İşten ayrılma kayıtları"
                  description={
                    <div className="pd-cikislar">
                      {(personelDetay.gecmis ?? [])
                        .filter((g: any) => g.cikisTarihi)
                        .map((g: any, i: number) => (
                          <div className="pd-cikis" key={i}>
                            <b>{dayjs(g.cikisTarihi).format("DD.MM.YYYY")}</b>
                            <span>
                              {g.isGrubu}
                              {g.pozisyon ? ` · ${g.pozisyon}` : ""}
                            </span>
                            {g.cikisSebebi ? (
                              <Tag color="red">{g.cikisSebebi}</Tag>
                            ) : (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                sebep belirtilmemiş
                              </Text>
                            )}
                          </div>
                        ))}
                    </div>
                  }
                />
              )}

              {personelDetay.ekBilgiler?.length > 0 && (
                <>
                  <Title level={5} style={{ marginTop: 18 }}>
                    Personel Kartı Bilgileri
                  </Title>

                  <div className="pd-ek">
                    {personelDetay.ekBilgiler.map((b: any, i: number) => (
                      <div className="pd-ek-satir" key={i}>
                        <span>{b.alan}</span>
                        <b>{b.deger}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )
        )}
      </Drawer>

      {/* -------------------------------------------- birimdeki personeller */}
      <Drawer
        open={!!personel}
        onClose={() => setPersonel(null)}
        width="min(760px, 96vw)"
        className="rp-cekmece"
        title={
          personel && (
            <div>
              <Space wrap size={8}>
                <Text strong>{personel.sube}</Text>
                {personel.pozisyon ? (
                  <Tag color="blue">{personel.pozisyon}</Tag>
                ) : (
                  <Tag>Tüm pozisyonlar</Tag>
                )}
                <Tag>{personel.liste.length} kişi</Tag>
              </Space>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 400,
                  color: "#8a8f98",
                  marginTop: 4,
                }}
              >
                Personel bilgileri Mikro veritabanından okunur.
              </div>
            </div>
          )
        }
        extra={
          <Checkbox
            checked={ayrilanlar}
            onChange={(e) => {
              setAyrilanlar(e.target.checked);
              if (personel) {
                personelAc(personel.sube, personel.pozisyon, e.target.checked);
              }
            }}
          >
            Ayrılanlar dâhil
          </Checkbox>
        }
      >
        {personelYukleniyor ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : personel?.liste.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message={
              personel?.birimEslesti
                ? "Bu pozisyonda personel bulunamadı"
                : "Bu birim personel kaynağında eşleşmedi"
            }
            description={
              <div>
                {personel?.birimEslesti ? (
                  <span>
                    <b>{personel.sube}</b> biriminde <b>{personel.pozisyon}</b>{" "}
                    ünvanıyla çalışan bulunamadı. Mikro'daki ünvan adı farklı
                    yazılmış olabilir.
                  </span>
                ) : (
                  <span>
                    Mikro'da <b>{personel?.sube}</b> adında bir iş grubu
                    bulunamadı. Aşağıdan doğru iş grubunu seçerek personeli
                    görebilirsiniz.
                  </span>
                )}

                {personel?.isGruplari && personel.isGruplari.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12.5 }}>
                      Personel kaynağındaki iş grupları
                    </Text>
                    <Select
                      showSearch
                      allowClear
                      placeholder="İş grubu seçiniz"
                      style={{ width: "100%", marginTop: 6 }}
                      options={personel.isGruplari.map((x) => ({
                        value: x,
                        label: x,
                      }))}
                      onChange={(v) =>
                        v && personelAc(v, personel.pozisyon, ayrilanlar)
                      }
                    />

                    <Button
                      size="small"
                      style={{ marginTop: 8 }}
                      onClick={() => personelAc(personel.sube, "", ayrilanlar)}
                    >
                      Bu birimdeki tüm personeli göster
                    </Button>
                  </div>
                )}
              </div>
            }
          />
        ) : (
          <Tablo
            rowKey="personelKodu"
            size="small"
            pagination={false}
            dataSource={personel?.liste ?? []}
            scroll={{ x: 720 }}
            rowClassName={(k: any) =>
              `pr-tiklanabilir${k.durum === 1 ? "" : " pr-ayrilan"}`
            }
            onRow={(k: any) => ({
              onClick: () => personelDetayAc(k.personelKodu),
            })}
            columns={[
              {
                title: "Personel",
                key: "ad",
                width: 250,
                render: (_v, k: any) => (
                  <div className="pr-kisi">
                    <PersonelResmi kod={k.personelKodu} ad={k.ad} />

                    <div className="pr-kisi-metin">
                      <Text strong>
                        {k.ad} {k.soyad}
                      </Text>
                      <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
                        {k.personelKodu}
                      </div>
                    </div>
                  </div>
                ),
              },
              { title: "Telefon", dataIndex: "telefon", width: 125 },
              { title: "Ünvan", dataIndex: "pozisyon", width: 170, ellipsis: true },
              {
                title: "İşe Giriş",
                dataIndex: "girisTarihi",
                width: 115,
                render: (v: string) =>
                  v ? dayjs(v).format("DD.MM.YYYY") : "—",
              },
              {
                title: "Durum",
                dataIndex: "durum",
                width: 135,
                render: (v: number, k: any) =>
                  v === 1 ? (
                    <Tag color="green">Çalışıyor</Tag>
                  ) : (
                    <Space size={4} wrap>
                      <Tag color="red">Ayrıldı</Tag>
                      {k.cikisTarihi && (
                        <Text type="secondary" style={{ fontSize: 11.5 }}>
                          {dayjs(k.cikisTarihi).format("DD.MM.YYYY")}
                        </Text>
                      )}
                    </Space>
                  ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* ------------------------------------------------ Excel'den aktarma */}
      <IceriAktar
        acik={aktarAcik}
        kapat={() => setAktarAcik(false)}
        kadrolar={liste}
        birimler={secenekler.subeler}
        birimTurleri={secenekler.birimTurleri}
        kaydedildi={getir}
      />

      {/* ------------------------------------------ Excel benzeri matris girişi */}
      <MatrisGiris
        acik={matrisAcik}
        kapat={() => setMatrisAcik(false)}
        kadrolar={liste}
        birimler={secenekler.subeler}
        birimTurleri={secenekler.birimTurleri}
        bolgeler={secenekler.bolgeler}
        kaydedildi={getir}
      />

      {/* ------------------------------------------- şube bazlı toplu düzenleme */}
      <Drawer
        open={!!toplu}
        onClose={() => setToplu(null)}
        width={860}
        className="rp-cekmece"
        title={
          toplu && (
            <Space wrap size={8}>
              <Text strong>{toplu.subeAdi}</Text>
              <Tag color="blue">{toplu.satirlar.length} pozisyon</Tag>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Tüm pozisyonları tek ekranda düzenleyin
              </Text>
            </Space>
          )
        }
        footer={
          <Space style={{ float: "right" }}>
            <Button onClick={() => setToplu(null)}>Vazgeç</Button>
            <Button type="primary" loading={topluYukleniyor} onClick={topluKaydet}>
              Tümünü kaydet
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="Norm sayısını giriniz; mevcut Personeller sayfasından otomatik gelir, ihtiyaç bunlardan hesaplanır."
          description="Normu sıfır bırakılan ve mevcudu da 0 olan pozisyonlar kaydedilmez, varsa kaydı silinir."
        />

        {toplu && (
          <Tablo
            rowKey="bolum"
            size="small"
            pagination={false}
            dataSource={toplu.satirlar}
            scroll={{ y: "calc(100vh - 340px)" }}
            columns={[
              {
                title: "Pozisyon",
                dataIndex: "bolum",
                width: 190,
                render: (v: string) => <Text strong>{v}</Text>,
              },
              {
                title: "Norm",
                dataIndex: "norm",
                width: 105,
                align: "center",
                render: (v: number, _k, sira: number) => (
                  <InputNumber
                    min={0}
                    max={999}
                    step={0.5}
                    decimalSeparator=","
                    value={v}
                    size="small"
                    style={{ width: "100%" }}
                    onChange={(deger) => {
                      const yeni = [...toplu.satirlar];
                      yeni[sira] = { ...yeni[sira], norm: Number(deger) || 0 };
                      setToplu({ ...toplu, satirlar: yeni });
                    }}
                  />
                ),
              },
              {
                title: "Mevcut",
                dataIndex: "mevcut",
                width: 105,
                align: "center",
                render: (v: number) => (
                  <Tooltip title="Personeller sayfasından otomatik hesaplanır, buradan değiştirilemez.">
                    <b>{ondalik(v)}</b>
                  </Tooltip>
                ),
              },
              {
                title: "İhtiyaç / Fazla",
                key: "ihtiyac",
                width: 120,
                align: "center",
                render: (_v, k) => {
                  /* Diğer tablolarla aynı okuma: fazla kırmızı, eksik gri.
                     Norm girilmemişse ölçüm yapılmaz. */
                  if (Number(k.norm ?? 0) === 0 && Number(k.mevcut ?? 0) === 0)
                    return <span style={{ color: "#bbb" }}>norm yok</span>;

                  const fark = kadroFarki(k.mevcut, k.norm);
                  if (fark > 0)
                    return <Tag color="red">+{ondalik(fark)} fazla</Tag>;
                  if (fark < 0) return <Tag>{ondalik(-fark)} eksik</Tag>;
                  return <Tag color="green">Tam</Tag>;
                },
              },
              {
                title: "Engelli",
                dataIndex: "engelli",
                width: 100,
                align: "center",
                render: (v: number) => (
                  <Tooltip title="Personel kaydındaki engellilik derecesinden otomatik hesaplanır.">
                    {v > 0 ? (
                      <Tag color="orange">{ondalik(v)}</Tag>
                    ) : (
                      <span style={{ color: "#bbb" }}>—</span>
                    )}
                  </Tooltip>
                ),
              },
              {
                title: "Açıklama",
                dataIndex: "aciklama",
                render: (v: string, _k, sira: number) => (
                  <Input
                    value={v}
                    size="small"
                    placeholder="İsteğe bağlı"
                    maxLength={300}
                    onChange={(e) => {
                      const yeni = [...toplu.satirlar];
                      yeni[sira] = { ...yeni[sira], aciklama: e.target.value };
                      setToplu({ ...toplu, satirlar: yeni });
                    }}
                  />
                ),
              },
            ]}
          />
        )}
      </Drawer>

      <Modal
        open={acik}
        title="Kadro Tanımı"
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
            name="bolum"
            label="Bölüm"
            rules={[{ required: true, message: "Bölüm seçiniz." }]}
          >
            <Select
              showSearch
              placeholder="Örn: Kasiyer"
              options={secenekler.bolumler.map((b) => ({ value: b, label: b }))}
            />
          </Form.Item>

          <Form.Item
            name="subeKodu"
            label="Birim"
            rules={[{ required: true, message: "Birim seçiniz." }]}
            extra='"Tüm Birimler" seçilirse hedef bütün şube ve birimler için geçerli olur.'
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Seçiniz"
              options={[
                { value: TUM_BIRIMLER, label: "Tüm Birimler" },
                ...secenekler.subeler.map((x) => ({
                  value: x.kod,
                  label: `${x.ad || x.kod}${x.tur ? ` · ${x.tur}` : ""}`,
                })),
              ]}
            />
          </Form.Item>

          <Row gutter={12}>
            <Col xs={8}>
              <Form.Item
                name="norm"
                label="Norm Kadro"
                extra="Olması gereken"
              >
                <InputNumber min={0} max={9999} style={{ width: "100%" }} />
              </Form.Item>
            </Col>

            <Col xs={8}>
              <Form.Item
                name="mevcut"
                label="Mevcut"
                extra="Personeller sayfasından otomatik hesaplanır."
              >
                <InputNumber
                  disabled
                  step={0.5}
                  decimalSeparator=","
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>

            <Col xs={8}>
              <Form.Item
                name="hedef"
                label="İhtiyaç"
                extra="Norm girilirse hesaplanır"
              >
                <InputNumber
                  min={0}
                  max={9999}
                  step={0.5}
                  decimalSeparator=","
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="engelli"
            label="Engelli Çalışan"
            extra="Personel kaydındaki engellilik derecesinden otomatik gelir."
          >
            <InputNumber
              disabled
              step={0.5}
              decimalSeparator=","
              style={{ width: "100%" }}
            />
          </Form.Item>

          <Form.Item name="aciklama" label="Açıklama">
            <Input placeholder="Örn: PART ENGELLİ, tadolya + manav" maxLength={300} />
          </Form.Item>

          <Form.Item name="aktif" valuePropName="checked" initialValue={true}>
            <Checkbox>Aktif</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
