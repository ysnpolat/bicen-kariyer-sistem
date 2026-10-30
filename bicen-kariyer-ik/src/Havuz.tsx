/**
 * ---------------------------------------------------------------------------
 * Aday Havuzu
 * ---------------------------------------------------------------------------
 * Durumu "Olumlu" yapılan adaylar burada toplanır ve pozisyon bazında
 * gruplanır. Her pozisyon kartı, ihtiyacın bölgelere nasıl dağıldığını
 * gösterir: "Kasiyer · Bakırköy 10 kişi · Küçükçekmece 5 kişi" gibi.
 *
 * Bir bölgeye tıklandığında o bölgedeki adaylar listelenir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Badge,
  Card,
  Checkbox,
  Col,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  Lightbulb,
  Accessibility,
  UserMinus,
  Briefcase,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Copy,
  Search,
  Settings2,
  StickyNote,
  Target,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";

import Tablo from "./Tablo";
import BasvuruDetayModal from "./BasvuruDetayModal";
import { adminMi, api, ikYoneticisiMi, oturumOku } from "./api";
import { RENK } from "./sabitler";

const { Title, Text, Paragraph } = Typography;

interface Not {
  id: number;
  metin: string;
  adSoyad: string;
  kullanici: string;
  tarih: string;
}

interface Aday {
  id: number;
  basvuruNo: string;
  adSoyad: string;
  telefon: string;
  eposta: string;
  subeKodu: string;
  subeAdi: string;
  bolumler: string;
  ilce: string;
  mahalle: string;
  gorusmeTarihi: string | null;
  olusturma: string;
  engelVar?: boolean;
  eskiCalisan?: boolean;
  notlar: Not[];
}

interface Bolge {
  bolge: string;
  ihtiyac: number;
  norm: number;
  mevcutPersonel: number;
  subeler: string[];
  adaylar: Aday[];
}

interface Pozisyon {
  bolum: string;
  toplamIhtiyac: number;
  toplamNorm: number;
  toplamMevcut: number;
  toplamAday: number;
  bolgeler: Bolge[];
}

/** Bölge kartındaki tek bir pozisyon satırı */
interface PozisyonSatiri {
  bolum: string;
  hedef: number;
  hedefTanimsiz?: boolean;
  adaylar: Aday[];
  iseAlinan: number;
}

/** Havuz bölgesi: altında pozisyonlar listelenir */
interface BolgeKarti {
  bolge: string;
  subeler: string[];
  pozisyonlar: PozisyonSatiri[];
  toplamHedef: number;
  toplamAday: number;
  iseAlinan: number;
}

interface Veri {
  toplamOlumlu: number;
  toplamHedef: number;
  toplamIseAlinan: number;
  bolgeTanimiVar: boolean;
  bolgeler: BolgeKarti[];
  digerleri: Aday[];
}

const BOS: Veri = {
  toplamOlumlu: 0,
  toplamHedef: 0,
  toplamIseAlinan: 0,
  bolgeTanimiVar: false,
  bolgeler: [],
  digerleri: [],
};

/** Doluluk oranına göre renk */
const oranRengi = (oran: number) =>
  oran >= 100
    ? "#52c41a"
    : oran >= 60
    ? RENK.yesil
    : oran >= 30
    ? "#faad14"
    : RENK.turuncu;

/* -------------------------------------------------------------------------- */
/* Aday kartı                                                                  */
/* -------------------------------------------------------------------------- */

function AdayKarti({
  aday,
  ac,
  cikar,
}: {
  aday: Aday;
  ac: (id: number) => void;
  cikar?: (aday: Aday) => void;
}) {
  return (
    <div className="hv-aday">
      <div className="hv-aday-ust">
        <div>
          <Text strong style={{ fontSize: 14 }}>
            {aday.adSoyad}

            {/* Havuzda ne kadar beklediği: uzman önce kimi arayacağını
                buna göre seçiyor. 60 günü geçenler sararır. */}
            {(() => {
              const g = dayjs().diff(dayjs(aday.olusturma), "day");

              return (
                <Tooltip title={`Havuza giriş: ${dayjs(aday.olusturma).format("DD.MM.YYYY")}`}>
                  <Tag
                    color={g >= 90 ? "red" : g >= 60 ? "orange" : "default"}
                    style={{ marginInlineStart: 8, marginInlineEnd: 0 }}
                  >
                    {g === 0 ? "bugün" : `${g} gün`}
                  </Tag>
                </Tooltip>
              );
            })()}

            {aday.engelVar && (
              <Tooltip title="Aday formda engel durumu belirtmiş">
                <Tag color="blue" style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
                  <Accessibility size={11} strokeWidth={2.4} />
                </Tag>
              </Tooltip>
            )}

            {aday.eskiCalisan && (
              <Tooltip title="Daha önce çalışıp ayrılmış">
                <Tag color="geekblue" style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
                  <Briefcase size={11} strokeWidth={2.4} /> eski çalışan
                </Tag>
              </Tooltip>
            )}
          </Text>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            {aday.basvuruNo}
          </Text>
          <div className="hv-aday-sube">
            <Building2 size={13} strokeWidth={2} />
            <span>{aday.subeAdi || "Birim belirtilmemiş"}</span>
          </div>
        </div>

        <Space size={6}>
          <Button
            size="small"
            icon={<FileText size={14} strokeWidth={2} />}
            onClick={() => ac(aday.id)}
          >
            İncele
          </Button>

          {/* Havuzdan çıkarma: ulaşılamayan ya da vazgeçen aday havuzda
              kaldıkça doluluk oranı gerçeğin üstünde görünüyor. */}
          {cikar && (
            <Tooltip title="Havuzdan çıkar">
              <Button
                size="small"
                danger
                type="text"
                icon={<UserMinus size={14} strokeWidth={2} />}
                onClick={() => cikar(aday)}
              />
            </Tooltip>
          )}
        </Space>
      </div>

      <div className="hv-aday-bilgi">
        <span>
          <Phone size={13} strokeWidth={2} /> {aday.telefon || "—"}
        </span>
        {aday.eposta && (
          <span>
            <Mail size={13} strokeWidth={2} /> {aday.eposta}
          </span>
        )}
        {(aday.ilce || aday.mahalle) && (
          <span>
            <MapPin size={13} strokeWidth={2} />{" "}
            {[aday.mahalle, aday.ilce].filter(Boolean).join(" · ")}
          </span>
        )}
        {aday.gorusmeTarihi && (
          <span>
            <CalendarClock size={13} strokeWidth={2} />{" "}
            {dayjs(aday.gorusmeTarihi).format("DD.MM.YYYY HH:mm")}
          </span>
        )}
      </div>

      <div className="hv-aday-bolumler">
        {(aday.bolumler || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((b) => (
            <Tag key={b} color="green">
              {b}
            </Tag>
          ))}
      </div>

      {aday.notlar?.length > 0 && (
        <div className="hv-notlar">
          <div className="hv-notlar-baslik">
            <StickyNote size={13} strokeWidth={2} />
            <span>İK notları</span>
          </div>
          {aday.notlar.map((n) => (
            <div key={n.id} className="hv-not">
              <div className="hv-not-ust">
                <Text strong style={{ fontSize: 12 }}>
                  {n.adSoyad || n.kullanici}
                </Text>
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  {dayjs(n.tarih).format("DD.MM.YYYY HH:mm")}
                </Text>
              </div>
              <div className="hv-not-metin">{n.metin}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Havuz                                                                       */
/* -------------------------------------------------------------------------- */

export default function Havuz() {
  /* Açık pozisyonlar için havuz ve rotasyon önerileri */
  const [oneriler, setOneriler] = useState<any[]>([]);
  const [oneriAcik, setOneriAcik] = useState(true);

  /* Öneri grupları Form Ayarları'nda saklanır; havuz penceresinden
     düzenlenir çünkü kullanıldığı yer burası. */
  const [oneriGruplari, setOneriGruplari] = useState<any[]>([]);

  /* Öneri listesi süzgeçleri: 34 mağaza × pozisyon sayısı kadar satır
     olabiliyor; süzmeden bakılmıyordu. */
  const [oneriArama, setOneriArama] = useState("");
  const [oneriKaynak, setOneriKaynak] = useState<"hepsi" | "aday" | "rotasyon">("hepsi");
  const [oneriBolum, setOneriBolum] = useState<string | undefined>();

  /* Seçili açık pozisyon: adaylar ve rotasyon seçenekleri çekmecede */
  const [oneriDetay, setOneriDetay] = useState<any>(null);

  /* Aday durumu buradan ilerletilebilir; uzman başvurular sayfasına gidip
     aramak zorunda kalmasın. Anahtar "adayId|durum": aynı anda tek işlem. */
  const [durumIsleniyor, setDurumIsleniyor] = useState("");

  const onerileriYenile = () =>
    api
      .al<any>("/api/Havuz/Oneriler")
      .then((d) => setOneriler(d?.oneriler ?? []))
      .catch(() => undefined);

  const adayDurumuDegistir = async (aday: any, yeniDurum: string) => {
    setDurumIsleniyor(`${aday.id}|${yeniDurum}`);

    try {
      await api.gonder(`/api/Basvuru/${aday.id}/Durum`, {
        durum: yeniDurum,
        aciklama:
          `Aday havuzu önerisinden ${yeniDurum} durumuna alındı` +
          (oneriDetay ? ` (${oneriDetay.subeAdi} · ${oneriDetay.bolum})` : ""),
      });

      message.success(`${aday.adSoyad} "${yeniDurum}" durumuna alındı.`);

      /* Durum değişince aday havuzdan düşer; açık çekmece de tazelensin */
      const d = await api.al<any>("/api/Havuz/Oneriler").catch(() => null);
      const liste = d?.oneriler ?? [];

      setOneriler(liste);

      if (oneriDetay)
        setOneriDetay(
          liste.find(
            (o: any) =>
              o.subeKodu === oneriDetay.subeKodu && o.bolum === oneriDetay.bolum
          ) ?? null
        );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setDurumIsleniyor("");
    }
  };

  useEffect(() => {
    onerileriYenile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<Veri>(BOS);
  const [arama, setArama] = useState("");
  const [siralama, setSiralama] = useState<"ihtiyac" | "aday" | "ad">("ihtiyac");

  const [acikBasvuru, setAcikBasvuru] = useState<number | null>(null);

  /* Özet kartına tıklanınca açılan liste */
  const [ozetListe, setOzetListe] = useState<{
    baslik: string;
    adaylar: Aday[];
  } | null>(null);

  /* Çekmece iki aşamalı: önce bölgenin pozisyonları, sonra o pozisyonun adayları */
  const [secili, setSecili] = useState<BolgeKarti | null>(null);
  const [seciliPozisyon, setSeciliPozisyon] = useState<PozisyonSatiri | null>(
    null
  );

  /* Bölge düzenleme (yalnızca yönetici) */
  const yonetici = adminMi(oturumOku());
  const [duzenleAcik, setDuzenleAcik] = useState(false);

  /* Hedef kopyalama */
  const [kaynakBolge, setKaynakBolge] = useState<string | undefined>();
  const [hedefBolgeler, setHedefBolgeler] = useState<string[]>([]);
  const [uzerineYaz, setUzerineYaz] = useState(false);
  const [kopyalaniyor, setKopyalaniyor] = useState(false);
  const [duzenleYukleniyor, setDuzenleYukleniyor] = useState(false);
  const [ayarlar, setAyarlar] = useState<any>(null);
  const [bolgeTanimlari, setBolgeTanimlari] = useState<
    { ad: string; subeler: string[] }[]
  >([]);

  /* Yalnızca "kopyala" kolaylığı için tutulur; havuz bunları kullanmaz */
  const [sirketBolgeleri, setSirketBolgeleri] = useState<
    { ad: string; subeler: string[] }[]
  >([]);
  const [ihtiyaclar, setIhtiyaclar] = useState<
    { bolge: string; bolum: string; ihtiyac: number }[]
  >([]);
  const [pozisyonSecenekleri, setPozisyonSecenekleri] = useState<string[]>([]);
  const [birimler, setBirimler] = useState<
    { kod: string; ad: string; tur?: string }[]
  >([]);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<Veri>("/api/Havuz"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /** Bölge düzenleme penceresini açar ve mevcut tanımları yükler */
  /* Havuzdan çıkarma penceresi: aday seçilen durumla başvurulara döner.
     Yalnızca İK yöneticisi ve yönetici yapabilir; uzman düğmeyi görmez. */
  const cikarabilir = ikYoneticisiMi(oturumOku());
  const [cikarilan, setCikarilan] = useState<Aday | null>(null);
  const [cikisDurum, setCikisDurum] = useState<string>();
  const [cikisNot, setCikisNot] = useState("");

  const cikarmaAc = (aday: Aday) => {
    setCikarilan(aday);
    setCikisDurum(undefined);
    setCikisNot("");
  };

  const cikarmayiOnayla = async () => {
    if (!cikisDurum) {
      message.warning("Adayın döneceği durumu seçiniz.");
      return;
    }

    if (cikisNot.trim().length < 3) {
      message.warning("Not zorunludur; neden havuzdan çıkarıldığını yazınız.");
      return;
    }

    try {
      await api.gonder(`/api/Havuz/Cikar/${cikarilan!.id}`, {
        durum: cikisDurum,
        not: cikisNot.trim(),
      });

      message.success(`${cikarilan!.adSoyad} "${cikisDurum}" durumuyla başvurulara döndü.`);
      setCikarilan(null);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const duzenlemeAc = async () => {
    setDuzenleAcik(true);
    setDuzenleYukleniyor(true);

    try {
      const [a, ih, bg] = await Promise.all([
        api.al<any>("/api/Ayar/Form"),
        api.al<any[]>("/api/Havuz/Ihtiyac"),
        api.al<any>("/api/Havuz/Bolgeler"),
      ]);

      setAyarlar(a);
      setOneriGruplari(a.oneriGruplari ?? []);

      /* Havuz bölgeleri şirket bölgelerinden bağımsızdır; boş başlar */
      setBolgeTanimlari(bg?.bolgeler ?? []);
      setSirketBolgeleri(bg?.sirketBolgeleri ?? []);
      setBirimler(a.subeler ?? []);
      setPozisyonSecenekleri(a.bolumler ?? []);
      setIhtiyaclar(
        (ih ?? []).map((x) => ({
          bolge: x.bolge,
          bolum: x.bolum,
          ihtiyac: x.ihtiyac,
        }))
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setDuzenleYukleniyor(false);
    }
  };

  /** Bölge tanımlarını kaydeder ve havuzu tazeler */
  /** Bir bölgenin hedeflerini seçilen bölgelere aktarır */
  const hedefleriKopyala = async () => {
    if (!kaynakBolge) {
      message.error("Kaynak bölge seçiniz.");
      return;
    }

    if (hedefBolgeler.length === 0) {
      message.error("En az bir hedef bölge seçiniz.");
      return;
    }

    setKopyalaniyor(true);

    try {
      const sonuc = await api.gonder<any>("/api/Havuz/IhtiyacKopyala", {
        kaynakBolge,
        hedefBolgeler,
        uzerine: uzerineYaz,
      });

      const parcalar = [
        sonuc.eklenen > 0 && `${sonuc.eklenen} yeni`,
        sonuc.guncellenen > 0 && `${sonuc.guncellenen} güncellendi`,
        sonuc.atlanan > 0 && `${sonuc.atlanan} atlandı`,
      ].filter(Boolean);

      message.success(
        `${sonuc.bolgeSayisi} bölgeye kopyalandı · ${parcalar.join(", ")}`
      );

      setHedefBolgeler([]);
      await getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setKopyalaniyor(false);
    }
  };

  const bolgeleriKaydet = async () => {
    setDuzenleYukleniyor(true);
    try {
      /* Havuz bölgeleri şirket bölgelerinden ayrı tutulur; Form Ayarları
         etkilenmez. */
      await api.gonder(
        "/api/Havuz/Bolgeler",
        bolgeTanimlari.filter((x) => x.ad?.trim())
      );

      await api.gonder(
        "/api/Havuz/Ihtiyac",
        ihtiyaclar.filter((x) => x.bolge && x.bolum)
      );

      /* Öneri grupları Form Ayarları'nda tutulduğu için mevcut ayarların
         üzerine yalnızca bu alan yazılır. */
      await api.gonder("/api/Ayar/Form", {
        ...ayarlar,
        oneriGruplari: oneriGruplari.filter(
          (x) => x.ad?.trim() && (x.subeler ?? []).length > 0
        ),
      });

      message.success("Havuz bölgeleri ve ihtiyaçlar kaydedildi.");
      setDuzenleAcik(false);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setDuzenleYukleniyor(false);
    }
  };

  /* Havuzdaki tüm adaylar; özet kartı için benzersizleştirilir */
  const tumAdaylar = useMemo(() => {
    const harita = new Map<number, Aday>();

    veri.bolgeler.forEach((b) =>
      b.pozisyonlar.forEach((p) =>
        p.adaylar.forEach((a) => harita.set(a.id, a))
      )
    );

    (veri.digerleri ?? []).forEach((a) => harita.set(a.id, a));

    return Array.from(harita.values());
  }, [veri]);

  /* Arama hem bölge hem pozisyon adında yapılır; eşleşen pozisyonlar
     bölge kartı içinde süzülür. */
  const bolgeler = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    let liste = veri.bolgeler.map((b) => ({ ...b }));

    if (q) {
      liste = liste
        .map((b) => {
          const bolgeUyar = b.bolge.toLocaleLowerCase("tr").includes(q);

          return {
            ...b,
            pozisyonlar: bolgeUyar
              ? b.pozisyonlar
              : b.pozisyonlar.filter((p) =>
                  p.bolum.toLocaleLowerCase("tr").includes(q)
                ),
          };
        })
        .filter((b) => b.pozisyonlar.length > 0);
    }

    if (siralama === "aday") {
      return liste.sort((a, b) => b.toplamAday - a.toplamAday);
    }
    if (siralama === "ad") {
      return liste.sort((a, b) => a.bolge.localeCompare(b.bolge, "tr"));
    }
    return liste.sort((a, b) => b.toplamHedef - a.toplamHedef);
  }, [veri.bolgeler, arama, siralama]);

  const doluluk =
    veri.toplamHedef > 0
      ? Math.round((veri.toplamOlumlu / veri.toplamHedef) * 100)
      : 0;

  /* Süzülmüş öneriler; sıralama eksik sayısına göre, en çok eksik üstte */
  const suzulmusOneriler = oneriler.filter((o: any) => {
    if (oneriKaynak === "aday" && (o.adaylar ?? []).length === 0) return false;
    if (oneriKaynak === "rotasyon" && (o.rotasyon ?? []).length === 0) return false;
    if (oneriBolum && o.bolum !== oneriBolum) return false;

    if (oneriArama.trim()) {
      const q = oneriArama.trim().toLocaleLowerCase("tr");

      const metin = [
        o.subeAdi,
        o.bolum,
        o.bolge,
        ...(o.adaylar ?? []).map((a: any) => a.adSoyad),
        ...(o.rotasyon ?? []).map((r: any) => r.subeAdi),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr");

      if (!metin.includes(q)) return false;
    }

    return true;
  });

  const oneriBolumleri = Array.from(
    new Set(oneriler.map((o: any) => o.bolum).filter(Boolean))
  ).sort((a: any, b: any) => String(a).localeCompare(String(b), "tr"));

  const oneriOzeti = {
    pozisyon: oneriler.length,
    eksik: oneriler.reduce((t: number, o: any) => t + Number(o.acik ?? 0), 0),
    adayli: oneriler.filter((o: any) => (o.adaylar ?? []).length > 0).length,
    rotasyonlu: oneriler.filter((o: any) => (o.rotasyon ?? []).length > 0).length,
  };

  const onerilerGorunumu = (
    <div>
      {/* ------------------------------------------------- özet şeridi */}
      <Row gutter={[10, 10]}>
        <Col flex="1 1 150px">
          <div className="hv-kutu">
            <div className="hv-et">Açık pozisyon</div>
            <div className="hv-dg">{oneriOzeti.pozisyon}</div>
            <div className="hv-ip">öneri üretilebilen</div>
          </div>
        </Col>
        <Col flex="1 1 150px">
          <div className="hv-kutu hv-kirmizi">
            <div className="hv-et">Eksik kişi</div>
            <div className="hv-dg" style={{ color: "#E8481C" }}>
              {oneriOzeti.eksik}
            </div>
            <div className="hv-ip">norm ile mevcut farkı</div>
          </div>
        </Col>
        <Col flex="1 1 150px">
          <div
            className="hv-kutu hv-yesil hv-tik"
            onClick={() => setOneriKaynak(oneriKaynak === "aday" ? "hepsi" : "aday")}
          >
            <div className="hv-et">Havuzdan aday var</div>
            <div className="hv-dg" style={{ color: "#5c8a12" }}>
              {oneriOzeti.adayli}
            </div>
            <div className="hv-ip">pozisyon · süzmek için tıklayın</div>
          </div>
        </Col>
        <Col flex="1 1 150px">
          <div
            className="hv-kutu hv-mor hv-tik"
            onClick={() =>
              setOneriKaynak(oneriKaynak === "rotasyon" ? "hepsi" : "rotasyon")
            }
          >
            <div className="hv-et">Rotasyonla kapanabilir</div>
            <div className="hv-dg" style={{ color: "#531dab" }}>
              {oneriOzeti.rotasyonlu}
            </div>
            <div className="hv-ip">işe alım yapmadan</div>
          </div>
        </Col>
      </Row>

      {/* ------------------------------------------------- süzgeçler */}
      <Space wrap style={{ marginTop: 12 }}>
        <Input
          allowClear
          value={oneriArama}
          onChange={(e) => setOneriArama(e.target.value)}
          placeholder="Mağaza, pozisyon, aday adı"
          prefix={<Search size={14} />}
          style={{ width: 240 }}
        />

        <Select
          allowClear
          value={oneriBolum}
          onChange={setOneriBolum}
          placeholder="Pozisyon"
          style={{ width: 180 }}
          options={oneriBolumleri.map((b: any) => ({ value: b, label: b }))}
        />

        <Select
          value={oneriKaynak}
          onChange={setOneriKaynak}
          style={{ width: 200 }}
          options={[
            { value: "hepsi", label: "Tüm öneriler" },
            { value: "aday", label: "Havuzdan aday olanlar" },
            { value: "rotasyon", label: "Rotasyon önerisi olanlar" },
          ]}
        />

        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {suzulmusOneriler.length} / {oneriler.length} pozisyon
        </Text>
      </Space>

      {/* ------------------------------------------------- ana tablo */}
      <Table
        size="small"
        rowKey={(o: any) => `${o.subeKodu}|${o.bolum}`}
        style={{ marginTop: 12 }}
        dataSource={suzulmusOneriler}
        pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{
          emptyText: (
            <Empty
              description={
                oneriler.length === 0
                  ? "Şu anda önerilecek bir eşleşme yok."
                  : "Süzgece uyan öneri yok."
              }
            />
          ),
        }}
        onRow={(o: any) => ({
          onClick: () => setOneriDetay(o),
          style: { cursor: "pointer" },
        })}
        columns={[
          {
            title: "Mağaza",
            dataIndex: "subeAdi",
            render: (v: string, o: any) => (
              <div>
                <Text strong>{v}</Text>
                {o.bolge && (
                  <div style={{ fontSize: 11.5, color: "#8a8f98" }}>{o.bolge}</div>
                )}
              </div>
            ),
          },
          {
            title: "Pozisyon",
            dataIndex: "bolum",
            width: 170,
            render: (v: string) => <Tag color="blue">{v}</Tag>,
          },
          {
            title: "Eksik",
            dataIndex: "acik",
            width: 140,
            sorter: (a: any, b: any) => Number(a.acik) - Number(b.acik),
            defaultSortOrder: "descend",
            render: (v: number, o: any) => (
              <div>
                <Tag color="red">{Number(v)} kişi</Tag>
                <div style={{ fontSize: 11.5, color: "#8a8f98", marginTop: 3 }}>
                  norm {Number(o.norm)} · mevcut {Number(o.mevcut)}
                </div>
              </div>
            ),
          },
          {
            title: "Havuzdan aday",
            key: "aday",
            render: (_: any, o: any) => {
              const liste = o.adaylar ?? [];

              if (liste.length === 0) return <Text type="secondary">—</Text>;

              /* İlk iki ad görünsün; gerisi sayı. Aynı şubeye başvuran
                 önce gelir, yeşil nokta onu işaretler. */
              return (
                <div>
                  {liste.slice(0, 2).map((a: any) => (
                    <div key={a.id} style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                      <span
                        className="hv-nokta"
                        style={{
                          background: a.ayniSube
                            ? "#7CB518"
                            : a.ayniBolge
                            ? "#1677ff"
                            : "#cfd4cb",
                        }}
                      />
                      {a.adSoyad}
                    </div>
                  ))}
                  {liste.length > 2 && (
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      +{liste.length - 2} aday daha
                    </Text>
                  )}
                </div>
              );
            },
          },
          {
            title: "Rotasyon",
            key: "rotasyon",
            width: 210,
            render: (_: any, o: any) => {
              const liste = o.rotasyon ?? [];

              if (liste.length === 0) return <Text type="secondary">—</Text>;

              return (
                <div>
                  <Tag color="purple">
                    {liste[0].subeAdi} · +{Number(liste[0].fazla)}
                  </Tag>
                  {liste.length > 1 && (
                    <div style={{ fontSize: 11.5, color: "#8a8f98", marginTop: 3 }}>
                      +{liste.length - 1} mağaza daha
                    </div>
                  )}
                </div>
              );
            },
          },
          {
            title: "",
            key: "islem",
            width: 90,
            align: "right",
            render: (_: any, o: any) => (
              <Button size="small" onClick={() => setOneriDetay(o)}>
                İncele
              </Button>
            ),
          },
        ]}
      />

      <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 10 }}>
        Yeşil nokta aynı şubeye, mavi nokta aynı bölgeye/öneri grubuna başvuran
        adaydır. Öneri karar değil hatırlatmadır; norm kadrosu eksik olan her
        pozisyon için havuz ve komşu mağazalar taranır.
      </Text>
    </div>
  );

  /* ------------------------------------------------ öneri ayrıntı çekmecesi */
  const oneriCekmecesi = (
    <Drawer
      open={!!oneriDetay}
      onClose={() => setOneriDetay(null)}
      width="min(760px, 96vw)"
      title={
        oneriDetay ? (
          <Space size={8} wrap>
            <Text strong>{oneriDetay.subeAdi}</Text>
            <Tag color="blue">{oneriDetay.bolum}</Tag>
            <Tag color="red">{Number(oneriDetay.acik)} kişi eksik</Tag>
            {oneriDetay.bolge && <Tag>{oneriDetay.bolge}</Tag>}
          </Space>
        ) : (
          ""
        )
      }
    >
      {oneriDetay && (
        <>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Norm {Number(oneriDetay.norm)}, mevcut {Number(oneriDetay.mevcut)}.
            Aşağıdaki iki seçenekten biri açığı kapatabilir; ikisi de yoksa
            ilan gerekir.
          </Text>

          {/* ------------------------------------------ havuzdaki adaylar */}
          <Card size="small" style={{ marginTop: 14 }}>
            <Text strong style={{ fontSize: 13.5 }}>
              Havuzdaki uygun adaylar
            </Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Bu pozisyona başvurmuş, olumlu işaretli ve hâlâ havuzda olan
                adaylar. Durum değişikliği başvuru kaydına işlenir; aday
                havuzdan düşünce liste kendiliğinden tazelenir.
              </Text>
            </div>

            <Table
              size="small"
              rowKey="id"
              style={{ marginTop: 10 }}
              dataSource={oneriDetay.adaylar ?? []}
              pagination={false}
              locale={{ emptyText: "Havuzda bu pozisyona uygun aday yok." }}
              columns={[
                {
                  title: "Aday",
                  dataIndex: "adSoyad",
                  render: (v: string, a: any) => (
                    <div>
                      <Text strong>{v}</Text>
                      <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
                        {a.subeAdi || "—"}
                        {a.ilce ? ` · ${a.ilce}` : ""}
                        {" · "}havuzda {dayjs().diff(dayjs(a.olusturma), "day")} gün
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Yakınlık",
                  key: "yakinlik",
                  width: 110,
                  render: (_: any, a: any) =>
                    a.ayniSube ? (
                      <Tag color="green">aynı şube</Tag>
                    ) : a.ayniBolge ? (
                      <Tag color="blue">aynı bölge</Tag>
                    ) : (
                      <Tag>başka bölge</Tag>
                    ),
                },
                {
                  title: "Telefon",
                  dataIndex: "telefon",
                  width: 130,
                  render: (v: string) =>
                    v ? <a href={`tel:${v}`}>{v}</a> : <Text type="secondary">—</Text>,
                },
                {
                  title: "İşlem",
                  key: "islem",
                  width: 250,
                  render: (_: any, a: any) => (
                    <Space size={4} wrap>
                      {[
                        { ad: "Görüşme Talebi", kisa: "Görüşme" },
                        { ad: "Evrak Hazırlanıyor", kisa: "Evrak" },
                        { ad: "İşe Alındı", kisa: "İşe al" },
                      ].map((d) => (
                        <Popconfirm
                          key={d.ad}
                          title={`${a.adSoyad}`}
                          description={`"${d.ad}" durumuna alınsın mı?`}
                          okText="Evet"
                          cancelText="Vazgeç"
                          onConfirm={() => adayDurumuDegistir(a, d.ad)}
                        >
                          <Button
                            size="small"
                            type={d.ad === "İşe Alındı" ? "primary" : "default"}
                            loading={durumIsleniyor === `${a.id}|${d.ad}`}
                            disabled={
                              durumIsleniyor !== "" &&
                              durumIsleniyor !== `${a.id}|${d.ad}`
                            }
                          >
                            {d.kisa}
                          </Button>
                        </Popconfirm>
                      ))}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>

          {/* -------------------------------------------------- rotasyon */}
          <Card size="small" style={{ marginTop: 12 }}>
            <Text strong style={{ fontSize: 13.5 }}>
              Rotasyon seçenekleri
            </Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Aynı bölgede ya da öneri grubunda bu pozisyonda fazlası olan
                mağazalar. İşe alım yapmadan kaydırma değerlendirilebilir;
                kararı bölge müdürü verir.
              </Text>
            </div>

            <Table
              size="small"
              rowKey="subeAdi"
              style={{ marginTop: 10 }}
              dataSource={oneriDetay.rotasyon ?? []}
              pagination={false}
              locale={{ emptyText: "Bu pozisyonda fazlası olan komşu mağaza yok." }}
              columns={[
                { title: "Mağaza", dataIndex: "subeAdi" },
                {
                  title: "Fazla personel",
                  dataIndex: "fazla",
                  align: "right",
                  width: 140,
                  render: (v: number) => <Tag color="purple">+{Number(v)}</Tag>,
                },
                {
                  title: "Karşılar",
                  key: "karsilar",
                  align: "right",
                  width: 120,
                  render: (_: any, r: any) => {
                    const oran = Math.min(
                      100,
                      Math.round((Number(r.fazla) / Math.max(1, Number(oneriDetay.acik))) * 100)
                    );

                    return (
                      <Tooltip title="Bu mağazanın fazlası açığın ne kadarını kapatır">
                        <span style={{ color: oran >= 100 ? "#5c8a12" : undefined }}>
                          %{oran}
                        </span>
                      </Tooltip>
                    );
                  },
                },
              ]}
            />
          </Card>
        </>
      )}
    </Drawer>
  );


  return (
    <div className="ik-icerik">
      {/* ------------------------------------------------------- öneriler
          Sayfanın en üstünde: uzman havuzu açtığında önce hangi açık
          pozisyona kimi önerebileceğini görsün. */}
      {oneriler.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 14, borderLeft: "4px solid #7CB518" }}
        >
          <Space
            align="center"
            style={{ width: "100%", justifyContent: "space-between" }}
          >
            <Space size={8}>
              <Lightbulb size={17} strokeWidth={2} color="#5c8a12" />
              <Text strong style={{ fontSize: 14 }}>
                Açık pozisyonlar için öneriler
              </Text>
              <Badge count={oneriler.length} color="#7CB518" />
            </Space>

            <Button size="small" type="text" onClick={() => setOneriAcik((o) => !o)}>
              {oneriAcik ? "Gizle" : "Göster"}
            </Button>
          </Space>

          {oneriAcik && <div style={{ marginTop: 12 }}>{onerilerGorunumu}</div>}
        </Card>
      )}

      {oneriCekmecesi}

      {/* ------------------------------------------------------------ özet */}
      <Row gutter={[12, 12]} className="ik-ozet">
        <Col xs={12} md={5}>
          <Card
            size="small"
            className="hv-ozet-kart bs-kart"
            onClick={() =>
              setOzetListe({
                baslik: "Havuzda bekleyen adaylar",
                adaylar: tumAdaylar,
              })
            }
          >
            <Statistic
              title="Havuzdaki Aday"
              value={veri.toplamOlumlu}
              prefix={<Users size={16} strokeWidth={2} />}
            />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              listeyi görmek için tıklayınız
            </Text>
          </Card>
        </Col>

        <Col xs={12} md={5}>
          <Card size="small" className="hv-ozet-kart">
            <Statistic
              title="Havuz Hedefi"
              value={veri.toplamHedef}
              prefix={<Target size={16} strokeWidth={2} />}
            />
          </Card>
        </Col>

        <Col xs={12} md={5}>
          <Card size="small" className="hv-ozet-kart">
            <Statistic
              title="İşe Alınan"
              value={veri.toplamIseAlinan}
              prefix={<UserCheck size={16} strokeWidth={2} />}
              valueStyle={{ color: "#08979c" }}
            />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              son 90 gün
            </Text>
          </Card>
        </Col>

        <Col xs={24} md={9}>
          <Card size="small" className="hv-ozet-kart">
            <Text type="secondary" style={{ fontSize: 13 }}>
              Havuz doluluğu
            </Text>
            <Progress
              percent={Math.min(100, doluluk)}
              strokeColor={oranRengi(doluluk)}
              format={() =>
                veri.toplamHedef > 0
                  ? `${veri.toplamOlumlu} / ${veri.toplamHedef}`
                  : `${veri.toplamOlumlu} aday`
              }
            />
          </Card>
        </Col>

        <Col xs={16} md={5}>
          <Card size="small" className="hv-ozet-kart hv-filtre-kart">
            <Input
              allowClear
              size="small"
              placeholder="Bölge veya pozisyon ara"
              prefix={<Search size={14} strokeWidth={2} color="#9AA3AF" />}
              value={arama}
              onChange={(e) => setArama(e.target.value)}
            />
            <Select
              size="small"
              style={{ width: "100%", marginTop: 6 }}
              value={siralama}
              onChange={setSiralama}
              options={[
                { value: "ihtiyac", label: "Hedefe göre" },
                { value: "aday", label: "Aday sayısına göre" },
                { value: "ad", label: "Ada göre" },
              ]}
            />
          </Card>
        </Col>

        <Col xs={8} md={2}>
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Button
              block
              className="hv-yenile"
              loading={yukleniyor}
              icon={<RefreshCw size={15} strokeWidth={2} />}
              onClick={getir}
              title="Yenile"
            />

            {yonetici && (
              <Button
                block
                icon={<Settings2 size={15} strokeWidth={2} />}
                onClick={duzenlemeAc}
                title="Bölgeleri düzenle"
              >
                Bölgeler
              </Button>
            )}
          </Space>
        </Col>
      </Row>

      {/* Havuz bölgeleri tanımlı değilse yönetici yönlendirilir */}
      {!yukleniyor && !veri.bolgeTanimiVar && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message="Havuz bölgeleri henüz tanımlanmamış"
          description={
            <span>
              Aday Havuzu kendi bölge tanımlarını kullanır; şirketin yönetsel
              bölgeleri buraya yansımaz. Bölgelerinizi oluşturana kadar adaylar
              pozisyon kartlarında görünmez.
            </span>
          }
          action={
            yonetici && (
              <Button size="small" type="primary" onClick={duzenlemeAc}>
                Bölge tanımla
              </Button>
            )
          }
        />
      )}

      {/* ------------------------------------------------------------ bölgeler */}
      {bolgeler.length === 0 && !yukleniyor && (
        <Card>
          <Empty
            description={
              <span>
                Gösterilecek pozisyon bulunamadı.
                <br />
                <Text type="secondary" style={{ fontSize: 13 }}>
                  Norm Kadro ekranından açık pozisyonları tanımlayınız.
                </Text>
              </span>
            }
          />
        </Card>
      )}

      <Row gutter={[14, 14]}>
        {bolgeler.map((b) => {
          /* Hedefi tanımlı pozisyonlar üzerinden doluluk */
          const oran =
            b.toplamHedef > 0
              ? Math.round((b.toplamAday / b.toplamHedef) * 100)
              : 0;

          const tanimsizSayi = b.pozisyonlar.filter(
            (p) => p.hedefTanimsiz
          ).length;

          return (
            <Col xs={24} sm={12} xl={8} key={b.bolge}>
              <button className="hv-bolge-kart" onClick={() => setSecili(b)}>
                <div className="hv-bolge-ust">
                  <span className="hv-bolge-ad">
                    <MapPin size={15} strokeWidth={2.2} />
                    {b.bolge}
                  </span>

                  <span
                    className="hv-bolge-sayi"
                    style={{ color: oranRengi(oran) }}
                  >
                    {b.toplamAday}
                    {b.toplamHedef > 0 && (
                      <i className="hv-bolge-hedef">/ {b.toplamHedef}</i>
                    )}
                  </span>
                </div>

                <div className="hv-bolge-alt">
                  {b.pozisyonlar.length} pozisyon · {b.subeler.length} birim
                  {b.iseAlinan > 0 && ` · ${b.iseAlinan} işe alındı`}
                </div>

                {b.toplamHedef > 0 && (
                  <div className="hv-bolge-cubuk">
                    <span
                      style={{
                        width: `${Math.min(100, oran)}%`,
                        background: oranRengi(oran),
                      }}
                    />
                  </div>
                )}

                <div className="hv-bolge-etiketler">
                  {b.pozisyonlar.slice(0, 4).map((p) => (
                    <span
                      key={p.bolum}
                      className={`hv-bolge-etiket${
                        p.hedefTanimsiz ? " hv-bolge-etiket-tanimsiz" : ""
                      }`}
                    >
                      {p.bolum}
                      <b>{p.adaylar.length}</b>
                    </span>
                  ))}

                  {b.pozisyonlar.length > 4 && (
                    <span className="hv-bolge-etiket hv-bolge-etiket-fazla">
                      +{b.pozisyonlar.length - 4}
                    </span>
                  )}
                </div>

                {tanimsizSayi > 0 && (
                  <div className="hv-bolge-uyari">
                    {tanimsizSayi} pozisyonda havuz hedefi tanımlı değil
                  </div>
                )}

                <span className="hv-bolge-ok">
                  Pozisyonları gör
                  <ChevronRight size={15} strokeWidth={2.2} />
                </span>
              </button>
            </Col>
          );
        })}
      </Row>

      {/* ------------------------------------------------ özet listesi */}
      {/* ------------------------------------------ havuzdan çıkarma */}
      <Modal
        open={!!cikarilan}
        title="Havuzdan çıkar"
        okText="Çıkar"
        cancelText="Vazgeç"
        onOk={cikarmayiOnayla}
        onCancel={() => setCikarilan(null)}
        width={460}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          <b>{cikarilan?.adSoyad}</b> havuzdan düşecek ve Başvurular
          sayfasına seçtiğiniz durumla dönecek. Onu olumlu bulan uzman
          başvuruda "havuzdan döndü" rozetini ve notunuzu görür.
        </Text>

        <div style={{ marginTop: 14 }}>
          <Text strong style={{ fontSize: 13 }}>Döneceği durum</Text>
          <Select
            style={{ width: "100%", marginTop: 6 }}
            placeholder="Seçiniz"
            value={cikisDurum}
            onChange={setCikisDurum}
            options={[
              "Yeni",
              "İncelendi",
              "Değerlendirmede",
              "Görüşme Talebi",
              "Olumsuz",
            ].map((d) => ({ value: d, label: d }))}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <Text strong style={{ fontSize: 13 }}>
            Not <span style={{ color: "#E8481C" }}>(zorunlu)</span>
          </Text>
          <Input.TextArea
            rows={3}
            style={{ marginTop: 6 }}
            value={cikisNot}
            onChange={(e) => setCikisNot(e.target.value)}
            placeholder="Neden havuzdan çıkarılıyor; uzmanın bilmesi gereken"
            maxLength={500}
          />
        </div>
      </Modal>

      <Drawer
        open={!!ozetListe}
        onClose={() => setOzetListe(null)}
        width="min(720px, 96vw)"
        className="rp-cekmece"
        title={
          ozetListe && (
            <Space wrap size={8}>
              <Text strong>{ozetListe.baslik}</Text>
              <Tag color="blue">{ozetListe.adaylar.length} aday</Tag>
            </Space>
          )
        }
      >
        {ozetListe &&
          (ozetListe.adaylar.length === 0 ? (
            <Empty description="Listelenecek aday bulunmuyor." />
          ) : (
            <div className="hv-aday-liste hv-cekmece-liste">
              {ozetListe.adaylar.map((a) => (
                <AdayKarti key={a.id} aday={a} ac={setAcikBasvuru} cikar={cikarabilir ? cikarmaAc : undefined} />
              ))}
            </div>
          ))}
      </Drawer>

      {/* --------------------------------------------------- eşleşmeyenler */}
      {veri.digerleri.length > 0 && (
        <Card size="small" className="hv-diger">
          <Title level={5} style={{ marginTop: 0 }}>
            Bölgesi Belirlenemeyen Adaylar ({veri.digerleri.length})
          </Title>

          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 14 }}
            message="Bu adaylar hiçbir bölge kartında görünmüyor"
            description={
              <span>
                Başvurdukları mağaza, tanımlı havuz bölgelerinden hiçbirine
                bağlı değil. Havuz penceresindeki <b>Havuz Bölgeleri</b>
                sekmesinden ilgili mağazayı bir bölgeye eklediğinizde bu adaylar
                o bölgede listelenir.
              </span>
            }
            action={
              yonetici && (
                <Button size="small" type="primary" onClick={duzenlemeAc}>
                  Bölge tanımla
                </Button>
              )
            }
          />

          {/* Hangi mağazalardan geldikleri özetlenir */}
          <div className="hv-eksik-subeler">
            {Array.from(
              new Set(veri.digerleri.map((a) => a.subeAdi).filter(Boolean))
            ).map((sube) => (
              <Tag key={sube} color="orange">
                {sube} ·{" "}
                {veri.digerleri.filter((a) => a.subeAdi === sube).length}
              </Tag>
            ))}
          </div>

          <div className="hv-aday-liste">
            {veri.digerleri.map((a) => (
              <AdayKarti key={a.id} aday={a} ac={setAcikBasvuru} cikar={cikarabilir ? cikarmaAc : undefined} />
            ))}
          </div>
        </Card>
      )}

      {/* -------------------------------------------------- bölge çekmecesi */}
      <Drawer
        open={!!secili}
        onClose={() => {
          setSecili(null);
          setSeciliPozisyon(null);
        }}
        width="min(820px, 96vw)"
        className="rp-cekmece"
        title={
          secili && (
            <div>
              <Space wrap size={8}>
                {seciliPozisyon && (
                  <Button
                    size="small"
                    type="text"
                    icon={<ChevronLeft size={16} strokeWidth={2.2} />}
                    onClick={() => setSeciliPozisyon(null)}
                  >
                    Geri
                  </Button>
                )}

                <Text strong>
                  {seciliPozisyon ? seciliPozisyon.bolum : secili.bolge}
                </Text>

                {seciliPozisyon ? (
                  <>
                    <Tag color="blue">{secili.bolge}</Tag>
                    <Tag
                      color={
                        seciliPozisyon.hedefTanimsiz
                          ? "purple"
                          : seciliPozisyon.adaylar.length >= seciliPozisyon.hedef
                          ? "green"
                          : "orange"
                      }
                    >
                      {seciliPozisyon.hedefTanimsiz
                        ? `${seciliPozisyon.adaylar.length} aday · hedef tanımsız`
                        : `Havuzda ${seciliPozisyon.adaylar.length} / ${seciliPozisyon.hedef}`}
                    </Tag>
                    {seciliPozisyon.iseAlinan > 0 && (
                      <Tag color="cyan">
                        {seciliPozisyon.iseAlinan} işe alındı
                      </Tag>
                    )}
                  </>
                ) : (
                  <Tag color="blue">
                    {secili.pozisyonlar.length} pozisyon · {secili.toplamAday} aday
                  </Tag>
                )}
              </Space>

              <div className="hv-cekmece-alt">
                {secili.subeler.length > 0
                  ? secili.subeler.join(", ")
                  : "Bu bölgeye mağaza tanımlanmamış"}
              </div>
            </div>
          )
        }
      >
        {/* ---------------------------------------------- pozisyon listesi */}
        {secili && !seciliPozisyon && (
          <div className="hv-poz-liste">
            {secili.pozisyonlar.length === 0 ? (
              <Empty description="Bu bölgede pozisyon bulunmuyor." />
            ) : (
              secili.pozisyonlar.map((p) => {
                const pOran =
                  p.hedef > 0
                    ? Math.round((p.adaylar.length / p.hedef) * 100)
                    : 0;

                const durum = p.hedefTanimsiz
                  ? "tanimsiz"
                  : p.adaylar.length === 0
                  ? "bos"
                  : pOran >= 100
                  ? "dolu"
                  : "eksik";

                return (
                  <button
                    key={p.bolum}
                    className={`hv-poz hv-poz-${durum}`}
                    onClick={() => setSeciliPozisyon(p)}
                  >
                    <span className="hv-poz-ad">
                      {p.bolum}
                      {p.hedefTanimsiz && (
                        <Tooltip title="Bu pozisyon için havuz hedefi tanımlanmamış; aday geldiği için listeye eklendi.">
                          <i className="hv-poz-uyari">hedef tanımsız</i>
                        </Tooltip>
                      )}
                      {p.iseAlinan > 0 && (
                        <i className="hv-poz-alinan">
                          {p.iseAlinan} kişi işe alındı
                        </i>
                      )}
                    </span>

                    <span className="hv-poz-cubuk">
                      <span
                        className="hv-poz-dolu"
                        style={{
                          width: `${Math.min(100, pOran)}%`,
                          background: oranRengi(pOran),
                        }}
                      />
                    </span>

                    <span className="hv-poz-sayi">
                      <b style={{ color: oranRengi(pOran) }}>
                        {p.adaylar.length}
                      </b>
                      <i>{p.hedefTanimsiz ? "aday" : `/ ${p.hedef}`}</i>
                    </span>

                    <ChevronRight size={16} strokeWidth={2} className="hv-poz-ok" />
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* -------------------------------------------------- aday listesi */}
        {secili &&
          seciliPozisyon &&
          (seciliPozisyon.adaylar.length === 0 ? (
            <Alert
              type="info"
              showIcon
              message="Bu pozisyon için havuzda bekleyen aday bulunmuyor."
              description="Başvurular ekranından uygun adayları olumlu olarak işaretlediğinizde burada görünürler."
            />
          ) : (
            <div className="hv-aday-liste hv-cekmece-liste">
              {seciliPozisyon.adaylar.map((a) => (
                <AdayKarti key={a.id} aday={a} ac={setAcikBasvuru} cikar={cikarabilir ? cikarmaAc : undefined} />
              ))}
            </div>
          ))}
      </Drawer>

      {/* ------------------------------------------------- bölge düzenleme */}
      <Drawer
        open={duzenleAcik}
        onClose={() => setDuzenleAcik(false)}
        width={760}
        className="rp-cekmece"
        title={
          <Space size={8}>
            <Settings2 size={16} strokeWidth={2} />
            <Text strong>Bölge Tanımları</Text>
          </Space>
        }
        footer={
          <Space style={{ float: "right" }}>
            <Button onClick={() => setDuzenleAcik(false)}>Vazgeç</Button>
            <Button
              type="primary"
              loading={duzenleYukleniyor}
              onClick={bolgeleriKaydet}
            >
              Kaydet
            </Button>
          </Space>
        }
      >
        {duzenleYukleniyor && !ayarlar ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : (
          <Tabs
            defaultActiveKey="ihtiyac"
            items={[
              /* ------------------------------------------- ihtiyaç tanımları */
              {
                key: "ihtiyac",
                label: (
                  <Space size={6}>
                    <Target size={15} strokeWidth={2} />
                    Pozisyon İhtiyaçları
                  </Space>
                ),
                children: (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 14 }}
                      message="Havuz ihtiyaçları burada belirlenir"
                      description="Norm Kadro ekranından bağımsızdır. Hangi bölgede hangi pozisyondan kaç kişiye ihtiyaç olduğunu buradan giriniz; havuz kartları bu sayılara göre oluşur."
                    />

                    <Tablo
                      rowKey={(_k, sira) => String(sira)}
                      size="small"
                      pagination={false}
                      dataSource={ihtiyaclar}
                      scroll={{ y: "calc(100vh - 400px)" }}
                      columns={[
                        {
                          title: "Bölge",
                          dataIndex: "bolge",
                          width: 200,
                          render: (v: string, _k, sira: number) => (
                            <Select
                              value={v || undefined}
                              size="small"
                              showSearch
                              placeholder="Bölge seçiniz"
                              style={{ width: "100%" }}
                              options={bolgeTanimlari
                                .filter((b) => b.ad)
                                .map((b) => ({ value: b.ad, label: b.ad }))}
                              onChange={(deger) => {
                                const yeni = [...ihtiyaclar];
                                yeni[sira] = { ...yeni[sira], bolge: deger };
                                setIhtiyaclar(yeni);
                              }}
                            />
                          ),
                        },
                        {
                          title: "Pozisyon",
                          dataIndex: "bolum",
                          render: (v: string, _k, sira: number) => (
                            <Select
                              value={v || undefined}
                              size="small"
                              showSearch
                              placeholder="Pozisyon seçiniz"
                              style={{ width: "100%" }}
                              options={pozisyonSecenekleri.map((b) => ({
                                value: b,
                                label: b,
                              }))}
                              onChange={(deger) => {
                                const yeni = [...ihtiyaclar];
                                yeni[sira] = { ...yeni[sira], bolum: deger };
                                setIhtiyaclar(yeni);
                              }}
                            />
                          ),
                        },
                        {
                          title: "İhtiyaç",
                          dataIndex: "ihtiyac",
                          width: 110,
                          align: "center",
                          render: (v: number, _k, sira: number) => (
                            <InputNumber
                              min={0}
                              max={999}
                              value={v}
                              size="small"
                              style={{ width: "100%" }}
                              onChange={(deger) => {
                                const yeni = [...ihtiyaclar];
                                yeni[sira] = {
                                  ...yeni[sira],
                                  ihtiyac: Number(deger) || 0,
                                };
                                setIhtiyaclar(yeni);
                              }}
                            />
                          ),
                        },
                        {
                          title: "",
                          width: 50,
                          render: (_v, _k, sira: number) => (
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<Trash2 size={14} strokeWidth={2} />}
                              onClick={() =>
                                setIhtiyaclar(ihtiyaclar.filter((_x, i) => i !== sira))
                              }
                            />
                          ),
                        },
                      ]}
                    />

                    <Button
                      icon={<Plus size={15} strokeWidth={2} />}
                      style={{ marginTop: 12 }}
                      onClick={() =>
                        setIhtiyaclar([
                          ...ihtiyaclar,
                          { bolge: "", bolum: "", ihtiyac: 1 },
                        ])
                      }
                    >
                      Satır ekle
                    </Button>
                  </>
                ),
              },

              /* --------------------------------------------- öneri grupları */
              {
                key: "oneriGrup",
                label: (
                  <Space size={6}>
                    <Lightbulb size={15} strokeWidth={2} />
                    Öneri Grupları
                  </Space>
                ),
                children: (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="Öneri grubu nedir?"
                      description="Birbirine aday önerilebilecek mağazalar. Bölge tanımı yönetsel bir yapıdır; aday önerisi ise ulaşım mesafesine göre anlamlıdır. Sefaköy'e başvuran biri Tevfikbey'de çalışabilir ama aynı bölgedeki uzak bir mağazaya gidemez. Grup tanımlanmayan mağazalarda bölge tanımı kullanılır."
                    />

                    {oneriGruplari.map((g: any, i: number) => (
                      <Card size="small" key={i} style={{ marginBottom: 10 }}>
                        <Row gutter={8}>
                          <Col xs={24} md={7}>
                            <Input
                              value={g.ad}
                              placeholder="Grup adı (ör. Küçükçekmece Hattı)"
                              onChange={(e) =>
                                setOneriGruplari((o: any[]) =>
                                  o.map((x, k) =>
                                    k === i ? { ...x, ad: e.target.value } : x
                                  )
                                )
                              }
                            />
                          </Col>

                          <Col xs={22} md={15}>
                            <Select
                              mode="multiple"
                              allowClear
                              style={{ width: "100%" }}
                              placeholder="Mağazalar"
                              value={g.subeler ?? []}
                              onChange={(v) =>
                                setOneriGruplari((o: any[]) =>
                                  o.map((x, k) => (k === i ? { ...x, subeler: v } : x))
                                )
                              }
                              options={(birimler ?? []).map((x: any) => ({
                                value: x.kod,
                                label: x.ad,
                              }))}
                            />
                          </Col>

                          <Col xs={2} md={2}>
                            <Button
                              danger
                              type="text"
                              icon={<Trash2 size={15} strokeWidth={2} />}
                              onClick={() =>
                                setOneriGruplari((o: any[]) =>
                                  o.filter((_, k) => k !== i)
                                )
                              }
                            />
                          </Col>
                        </Row>
                      </Card>
                    ))}

                    <Button
                      onClick={() =>
                        setOneriGruplari((o: any[]) => [
                          ...o,
                          { ad: "", subeler: [] },
                        ])
                      }
                    >
                      Grup ekle
                    </Button>
                  </>
                ),
              },

              /* ------------------------------------------------- bölgeler */
              {
                key: "bolge",
                label: (
                  <Space size={6}>
                    <MapPin size={15} strokeWidth={2} />
                    Havuz Bölgeleri
                  </Space>
                ),
                children: (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 14 }}
                      message="Bu bölgeler yalnızca Aday Havuzu'nda geçerlidir"
                      description={
                        <span>
                          Şirketin yönetsel bölgelerinden (1. Bölge, 2. Bölge…)
                          tamamen bağımsızdır ve onları etkilemez. Adayların
                          oturduğu yere göre serbestçe gruplayabilirsiniz:
                          <b> Küçükçekmece tarafı</b>, <b>Esenyurt tarafı</b> gibi.
                          Bir bölgeye eklediğiniz mağazalara başvuran olumlu
                          adaylar o bölgede listelenir.
                        </span>
                      }
                    />

                    {bolgeTanimlari.length === 0 && (
                      <div className="hv-bos-bolge">
                        <MapPin size={26} strokeWidth={1.6} />
                        <b>Henüz havuz bölgesi tanımlanmamış</b>
                        <span>
                          Aşağıdaki düğmeyle ilk bölgenizi oluşturabilir, dilerseniz
                          şirket bölgelerini başlangıç noktası olarak
                          kopyalayabilirsiniz.
                        </span>

                        {sirketBolgeleri.length > 0 && (
                          <Button
                            size="small"
                            icon={<Copy size={14} strokeWidth={2} />}
                            onClick={() =>
                              setBolgeTanimlari(
                                sirketBolgeleri.map((b) => ({
                                  ad: b.ad,
                                  subeler: [...(b.subeler ?? [])],
                                }))
                              )
                            }
                          >
                            Şirket bölgelerinden kopyala ({sirketBolgeleri.length})
                          </Button>
                        )}
                      </div>
                    )}

                    {bolgeTanimlari.map((b, sira) => (
                      <Card size="small" key={sira} style={{ marginBottom: 10 }}>
                        <Row gutter={[10, 10]} align="middle">
                          <Col xs={24} md={7}>
                            <Input
                              value={b.ad}
                              placeholder="Bölge adı (örn: Bakırköy Bölgesi)"
                              maxLength={100}
                              onChange={(e) => {
                                const yeni = [...bolgeTanimlari];
                                yeni[sira] = { ...yeni[sira], ad: e.target.value };
                                setBolgeTanimlari(yeni);
                              }}
                            />
                          </Col>

                          <Col xs={22} md={16}>
                            <Select
                              mode="multiple"
                              allowClear
                              showSearch
                              optionFilterProp="label"
                              value={b.subeler}
                              placeholder="Bu bölgeye bağlı mağazaları seçiniz"
                              style={{ width: "100%" }}
                              maxTagCount="responsive"
                              options={birimler
                                .filter((x) => x.kod)
                                .map((x) => ({
                                  value: x.kod,
                                  label: `${x.ad || x.kod}${x.tur ? ` · ${x.tur}` : ""}`,
                                }))}
                              onChange={(deger) => {
                                const yeni = [...bolgeTanimlari];
                                yeni[sira] = { ...yeni[sira], subeler: deger };
                                setBolgeTanimlari(yeni);
                              }}
                            />
                          </Col>

                          <Col xs={2} md={1}>
                            <Button
                              type="text"
                              danger
                              icon={<Trash2 size={15} strokeWidth={2} />}
                              onClick={() =>
                                setBolgeTanimlari(
                                  bolgeTanimlari.filter((_x, i) => i !== sira)
                                )
                              }
                            />
                          </Col>
                        </Row>
                      </Card>
                    ))}

                    <Button
                      icon={<Plus size={15} strokeWidth={2} />}
                      onClick={() =>
                        setBolgeTanimlari([...bolgeTanimlari, { ad: "", subeler: [] }])
                      }
                    >
                      Bölge ekle
                    </Button>
                  </>
                ),
              },

              /* ------------------------------------------- hedef kopyalama */
              {
                key: "kopyala",
                label: (
                  <Space size={6}>
                    <Copy size={15} strokeWidth={2} />
                    Hedefleri Kopyala
                  </Space>
                ),
                children: (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="Bir bölgenin hedeflerini diğerlerine aktarın"
                      description="Aynı pozisyon yapısı birden çok bölgede geçerliyse hedefleri tek tek girmek yerine buradan kopyalayabilirsiniz. Kaynak bölgedeki tüm pozisyon hedefleri seçtiğiniz bölgelere aktarılır."
                    />

                    <div style={{ maxWidth: 520 }}>
                      <Text strong style={{ fontSize: 13 }}>
                        Kaynak bölge
                      </Text>
                      <Select
                        showSearch
                        placeholder="Hedefleri kopyalanacak bölge"
                        style={{ width: "100%", margin: "6px 0 16px" }}
                        value={kaynakBolge}
                        onChange={setKaynakBolge}
                        options={bolgeTanimlari
                          .filter((b) => b.ad?.trim())
                          .map((b) => {
                            const adet = ihtiyaclar.filter(
                              (i) => i.bolge === b.ad && i.ihtiyac > 0
                            ).length;

                            return {
                              value: b.ad,
                              label: `${b.ad} · ${adet} pozisyon`,
                              disabled: adet === 0,
                            };
                          })}
                      />

                      <Text strong style={{ fontSize: 13 }}>
                        Hedef bölgeler
                      </Text>
                      <Select
                        mode="multiple"
                        allowClear
                        placeholder="Kopyalanacak bölgeleri seçiniz"
                        style={{ width: "100%", margin: "6px 0 8px" }}
                        value={hedefBolgeler}
                        onChange={setHedefBolgeler}
                        options={bolgeTanimlari
                          .filter((b) => b.ad?.trim() && b.ad !== kaynakBolge)
                          .map((b) => ({ value: b.ad, label: b.ad }))}
                      />

                      <Button
                        size="small"
                        type="link"
                        style={{ padding: 0, marginBottom: 16 }}
                        onClick={() =>
                          setHedefBolgeler(
                            bolgeTanimlari
                              .filter((b) => b.ad?.trim() && b.ad !== kaynakBolge)
                              .map((b) => b.ad)
                          )
                        }
                      >
                        Tümünü seç
                      </Button>

                      <Checkbox
                        checked={uzerineYaz}
                        onChange={(e) => setUzerineYaz(e.target.checked)}
                        style={{ display: "block", marginBottom: 4 }}
                      >
                        Mevcut hedeflerin üzerine yaz
                      </Checkbox>

                      <Paragraph
                        type="secondary"
                        style={{ fontSize: 12, marginBottom: 18 }}
                      >
                        İşaretlenmezse hedef bölgede zaten tanımlı olan
                        pozisyonlara dokunulmaz, yalnızca eksikler eklenir.
                      </Paragraph>

                      <Button
                        type="primary"
                        loading={kopyalaniyor}
                        icon={<Copy size={15} strokeWidth={2} />}
                        onClick={hedefleriKopyala}
                      >
                        {hedefBolgeler.length > 0
                          ? `${hedefBolgeler.length} bölgeye kopyala`
                          : "Kopyala"}
                      </Button>
                    </div>
                  </>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      {/* --------------------------------------------------- başvuru detayı */}
      <BasvuruDetayModal
        basvuruId={acikBasvuru}
        kapat={() => setAcikBasvuru(null)}
      />
    </div>
  );
}
