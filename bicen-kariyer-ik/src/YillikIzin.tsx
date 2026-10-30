/**
 * İzin Yönetimi (eski adı Yıllık İzin)
 * ---------------------------------------------------------------------------
 * Personelin kalan izin günü ve izin kayıtları.
 *
 * Hak ediş Mikro'da tutulmuyor: sistem devreye girerken her personelin o anki
 * kalan günü elle giriliyor, sonrasında izin girildikçe düşüyor.
 *
 * Gün sayısı 0,5 adımlarla tutulur — personel öğlen çıkıp yarım gün izin
 * kullanabiliyor.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  DatePicker,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CalendarDays,
  Download,
  FileUp,
  RefreshCw,
  Search,
} from "lucide-react";
import dayjs, { Dayjs } from "dayjs";
import { tabloIndir } from "./raporExcel";
import * as XLSX from "xlsx";

import Tablo from "./Tablo";
import IzinPano from "./IzinPano";
import IzinRapor from "./IzinRapor";
import IzinKontenjan from "./IzinKontenjan";
import GorevlendirmeYonetimi from "./GorevlendirmeYonetimi";
import "./IkPerformans.css";
import { api, izinDuzenleme, oturumOku, sekmeGizli } from "./api";
import { bekleyenKayit } from "./gecis";
import { PersonelAdi } from "./personelKarti";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const TURLER = [
  "Yıllık İzin",
  "Saatlik İzin",
  "Mazeret İzni",
  "Ücretsiz İzin",
  "Doğum / Babalık",
  "Evlilik",
  "Ölüm",
  "Raporlu",
];

/** Gün sayısını yazar: 2 → "2", 2.5 → "2,5" */
const gun = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
};

/**
 * Hak ediş bilgileri işe giriş tarihinden hesaplanır.
 *
 * Kural, çizelgenizdeki hesapla aynıdır: hak ediş tarihi, işe giriş
 * gününün İÇİNDE BULUNULAN YILDAKİ karşılığıdır — o tarih geçmiş olsun
 * ya da olmasın. Bitiş bir sonraki yıl dönümü, kıdem yılı ise girişten
 * hak ediş yılına kadar geçen yıl sayısıdır.
 *
 * Çizelgedeki on kayıtla karşılaştırılarak doğrulandı.
 */
/** Türkçe ay adlarından ay numarası */
const AY_NO: Record<string, number> = {
  ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5,
  haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9,
  ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
};

/**
 * "19.Haziran - 25.Haziran" biçimindeki hafta başlığını tarihe çevirir.
 *
 * Çizelgede izinler haftalık sütunlarda tutuluyor; her sütunun değeri o
 * hafta kullanılan gün sayısı. Bu sayede aktarımda gerçek tarihli izin
 * kayıtları oluşturulabiliyor — yoksa yalnızca toplam biliniyordu.
 */
const haftaCozumle = (baslik: string, yil: number) => {
  const m = baslik
    .trim()
    .match(/^(\d{1,2})\.\s*([^\s-]+)\s*-\s*(\d{1,2})\.\s*([^\s-]+)$/);

  if (!m) return null;

  const ay1 = AY_NO[m[2].toLocaleLowerCase("tr")];
  const ay2 = AY_NO[m[4].toLocaleLowerCase("tr")];

  if (!ay1 || !ay2) return null;

  const bas = dayjs(`${yil}-${ay1}-${m[1]}`, "YYYY-M-D");

  /* Yıl sonu haftası bir sonraki yıla taşar: 25.Aralık - 01.Ocak */
  const bitYil = ay2 < ay1 ? yil + 1 : yil;
  const bit = dayjs(`${bitYil}-${ay2}-${m[3]}`, "YYYY-M-D");

  return bas.isValid() && bit.isValid() ? { bas, bit } : null;
};

/**
 * Kıdem ve hak edişin hesaplandığı tarih. Ayrılıp tekrar giren personelde
 * İK bir düzeltme girmişse o (ilk giriş + çalışılmayan ara süre), yoksa
 * Mikro'daki işe giriş tarihi.
 */
const esasTarih = (k: any): string | null =>
  k?.hakedisEsas ?? k?.girisTarihi ?? null;

/** Kıdem metni: "5 yıl 1 ay" */
const kidemMetni = (tarih: string | null) => {
  if (!tarih) return "—";
  const ay = dayjs().diff(dayjs(tarih), "month");
  const yil = Math.floor(ay / 12);
  return yil > 0 ? `${yil} yıl ${ay % 12} ay` : `${Math.max(0, ay)} ay`;
};

/** Ara dönem: ayrılış (son çalışılan gün) ve tekrar giriş */
type AraDonem = { ayrilis: Dayjs | null; donus: Dayjs | null };

/** Çalışılmayan gün: ayrılışın ertesi gününden tekrar girişin önceki gününe */
const araGun = (a: AraDonem) =>
  a.ayrilis && a.donus && a.donus.isAfter(a.ayrilis, "day")
    ? a.donus.diff(a.ayrilis, "day") - 1
    : 0;

/** "9 ay 28 gün" */
const araMetni = (a: AraDonem) => {
  if (!a.ayrilis || !a.donus || !a.donus.isAfter(a.ayrilis, "day")) return "";
  const bas = a.ayrilis.add(1, "day");
  const ay = a.donus.diff(bas, "month");
  const kalan = a.donus.diff(bas.add(ay, "month"), "day");
  return [ay > 0 ? `${ay} ay` : "", kalan > 0 ? `${kalan} gün` : ""]
    .filter(Boolean)
    .join(" ") || "0 gün";
};

const hakEdis = (girisTarihi: string | null) => {
  if (!girisTarihi) return null;

  const giris = dayjs(girisTarihi);
  if (!giris.isValid()) return null;

  const tarih = giris.year(dayjs().year());

  return {
    tarih,
    bitis: tarih.add(1, "year"),
    kidem: tarih.year() - giris.year(),
  };
};

export default function YillikIzin() {
  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  /* Sekmeler: pano, izin girişi ve toplu aktarım ayrı sayfalar gibi
     davranır. Tek listede her şeyi göstermek karmaşık oluyordu. */
  /* Yönetim › Aylık izin kontenjanı "sekme:kontenjan" bırakır (gecis.ts, tek seferlik) */
  const [ilkYuk] = useState(() => bekleyenKayit("yillikizin"));
  const [sekme, setSekme] = useState<
    "pano" | "rapor" | "kontenjan" | "liste" | "cizelge" | "giris" | "aktarim" | "gorevlendirme"
  >(() => (ilkYuk?.startsWith("sekme:") ? (ilkYuk.slice(6) as any) : "pano"));

  /* Pano içindeki alt görünüm */
  const [gorunum, setGorunum] = useState<
    "durum" | "izinde" | "planli" | "donecek" | "izinsiz" | "ayrilan"
  >("durum");
  /* Personel kartındaki "Yıllık İzin'de aç" sicili bırakır; liste o
     kişiye süzülmüş açılır (gecis.ts, tek seferlik). */
  const [arama, setArama] = useState(() => (ilkYuk && !ilkYuk.startsWith("sekme:") ? ilkYuk : ""));
  const [sube, setSube] = useState<string | undefined>();

  const duzenleyebilir = izinDuzenleme(oturumOku());

  /* İzin kaydı penceresi */
  const [izinKisi, setIzinKisi] = useState<any | null>(null);
  const [izinTur, setIzinTur] = useState("Yıllık İzin");
  const [izinSure, setIzinSure] = useState<"tam" | "once" | "sonra">("tam");
  const [izinCikis, setIzinCikis] = useState<Dayjs | null>(null);
  const [izinDonus, setIzinDonus] = useState<Dayjs | null>(null);
  const [izinBaslama, setIzinBaslama] = useState<Dayjs | null>(null);
  const [izinGun, setIzinGun] = useState<number>(1);
  const [izinNot, setIzinNot] = useState("");

  /* Geriye dönük izin: hak ediş tarihinden önceki yıllık izin kalan güne
     zaten dahil; varsayılan olarak hak edişten düşülmez, kullanıcı
     isterse değiştirir. */
  const [izinDussun, setIzinDussun] = useState(true);
  const bakiyeOncesi =
    !!izinKisi?.bakiyeTarihi &&
    !!izinCikis &&
    izinCikis.isBefore(dayjs(izinKisi.bakiyeTarihi), "day");

  useEffect(() => {
    setIzinDussun(!bakiyeOncesi);
  }, [bakiyeOncesi, izinKisi]);

  /* Saatlik izin: personel birkaç saatliğine çıkıp aynı gün dönüyor */
  const [izinBasSaat, setIzinBasSaat] = useState("09:00");
  const [izinBitSaat, setIzinBitSaat] = useState("13:00");

  /* Günlük mesai: saatlik izni güne çevirirken kullanılır */
  const MESAI_SAAT = 8;
  const [izinKaydediliyor, setIzinKaydediliyor] = useState(false);
  const [cakisma, setCakisma] = useState<any[]>([]);

  /* Pano grupları: her biri ayrı kartta, kısa ve okunur. */
  const pano = useMemo(() => {
    const hepsi = veri?.kayitlar ?? [];
    const bugun = dayjs();

    const sirala = (a: any, b: any, alan: string) =>
      dayjs(a[alan]).valueOf() - dayjs(b[alan]).valueOf();

    return {
      izinde: hepsi
        .filter((k: any) => k.izinde)
        .sort((a: any, b: any) => sirala(a, b, "izinDonus")),

      donecek: hepsi
        .filter(
          (k: any) =>
            k.izinde && k.izinDonus &&
            dayjs(k.izinDonus).diff(bugun, "day") <= 7
        )
        .sort((a: any, b: any) => sirala(a, b, "izinDonus")),

      planli: hepsi
        .filter((k: any) => k.planliCikis)
        .sort((a: any, b: any) => sirala(a, b, "planliCikis")),

      izinsiz: hepsi
        .filter(
          (k: any) =>
            k.girildiMi &&
            Number(k.kullanilan) === 0 &&
            Number(k.planli) === 0
        )
        .sort((a: any, b: any) => (b.kalan ?? 0) - (a.kalan ?? 0)),

      /* Kartlardan açılacak listeler: gün toplamı yerine KİŞİ sayısı
         gösterilir, sayıya tıklayınca o kişiler listelenir. */
      hakEdenler: hepsi
        .filter((k: any) => Number(k.hakedilen) > 0)
        .sort((a: any, b: any) => (b.hakedilen ?? 0) - (a.hakedilen ?? 0)),

      kullananlar: hepsi
        .filter((k: any) => Number(k.kullanilan) > 0)
        .sort((a: any, b: any) => (b.kullanilan ?? 0) - (a.kullanilan ?? 0)),

      kalani: hepsi
        .filter((k: any) => Number(k.kalan) > 0)
        .sort((a: any, b: any) => (b.kalan ?? 0) - (a.kalan ?? 0)),

      bakiyesiz: hepsi.filter((k: any) => !k.girildiMi),
    };
  }, [veri]);

  /* Karttan ya da "+N kişi daha" satırından açılan liste */
  const [acikListe, setAcikListe] = useState<{
    baslik: string;
    kisiler: any[];
    sag?: (k: any) => string;
  } | null>(null);

  /* Kişi detayı: hak ediş kırılımı ve izin geçmişi */
  const [detayKisi, setDetayKisi] = useState<any | null>(null);
  const [detay, setDetay] = useState<any>(null);
  const [detayYukleniyor, setDetayYukleniyor] = useState(false);

  /* Hak ediş (kıdem) tarihi düzeltme penceresi */
  const [hdAcik, setHdAcik] = useState(false);
  const [hdMod, setHdMod] = useState<"ara" | "elle">("ara");
  const [hdIlk, setHdIlk] = useState<Dayjs | null>(null);
  const [hdAralar, setHdAralar] = useState<AraDonem[]>([]);
  const [hdElle, setHdElle] = useState<Dayjs | null>(null);
  const [hdAciklama, setHdAciklama] = useState("");
  const [hdKaydediliyor, setHdKaydediliyor] = useState(false);

  const hdToplamGun = hdAralar.reduce((t, a) => t + araGun(a), 0);
  const hdSonuc: Dayjs | null =
    hdMod === "elle" ? hdElle : hdIlk ? hdIlk.add(hdToplamGun, "day") : null;

  /* Ara dönem sırası ve tutarlılığı: ilk girişten sonra, birbirini
     izleyen dönemler */
  const hdSorun = (() => {
    if (hdMod === "elle") return hdElle ? "" : "Hak ediş tarihini seçiniz.";
    if (!hdIlk) return "İlk işe giriş tarihini seçiniz.";
    if (hdAralar.length === 0) return "En az bir ara dönem ekleyiniz.";
    let onceki = hdIlk;
    for (const a of hdAralar) {
      if (!a.ayrilis || !a.donus) return "Ayrılış ve tekrar giriş tarihlerini doldurunuz.";
      if (a.ayrilis.isBefore(onceki, "day"))
        return "Ayrılış tarihi önceki girişten önce olamaz.";
      if (!a.donus.isAfter(a.ayrilis, "day"))
        return "Tekrar giriş, ayrılıştan sonra olmalı.";
      onceki = a.donus;
    }
    return "";
  })();

  const hdAc = () => {
    const d = detay?.hakedis ?? detayKisi?.hakedisDuzeltme;
    let aralar: AraDonem[] = [];
    try {
      aralar = (JSON.parse(d?.araDonemler || "[]") as any[]).map((x) => ({
        ayrilis: x.ayrilis ? dayjs(x.ayrilis) : null,
        donus: x.donus ? dayjs(x.donus) : null,
      }));
    } catch {
      aralar = [];
    }
    const giris = detayKisi?.girisTarihi ? dayjs(detayKisi.girisTarihi) : null;

    setHdMod(d && aralar.length === 0 ? "elle" : "ara");
    setHdIlk(d?.ilkGiris ? dayjs(d.ilkGiris) : null);
    /* Yeni düzeltmede Mikro'daki giriş genellikle tekrar giriş tarihidir */
    setHdAralar(aralar.length ? aralar : [{ ayrilis: null, donus: giris }]);
    setHdElle(d?.tarih ? dayjs(d.tarih) : giris);
    setHdAciklama(d?.aciklama ?? "");
    setHdAcik(true);
  };

  /* Bordrodaki bütün girişlerden doldurur (05.10.2026): aynı T.C. ile
     açılmış kartların giriş ve çıkış tarihleri */
  const [hdBordroYukleniyor, setHdBordroYukleniyor] = useState(false);

  const hdBordrodanGetir = async () => {
    if (!detayKisi) return;
    setHdBordroYukleniyor(true);
    try {
      const d = await api.al<any>(
        `/api/Izin/KidemBordro/${encodeURIComponent(detayKisi.personelKodu)}`
      );

      if (!d?.bulundu) {
        message.info(d?.sebep ?? "Bordroda kayıt bulunamadı.");
        return;
      }

      setHdMod("ara");
      setHdIlk(dayjs(d.ilkGiris));

      const aralar = (d.aralar ?? []).map((a: any) => ({
        ayrilis: dayjs(a.ayrilis),
        donus: dayjs(a.donus),
      }));

      if (aralar.length === 0) {
        message.info(
          `Bordroda ${d.donemler?.length ?? 1} giriş var, aralarında çalışılmayan süre yok. Düzeltme gerekmiyor.`
        );
        setHdAralar([{ ayrilis: null, donus: null }]);
        return;
      }

      setHdAralar(aralar);
      message.success(
        `Bordrodan getirildi: ${d.donemler?.length ?? 0} giriş, ${aralar.length} ara dönem, ${d.bosGun} gün.`
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setHdBordroYukleniyor(false);
    }
  };

  const hdKaydet = async () => {
    if (hdSorun || !hdSonuc || !detayKisi) return;
    setHdKaydediliyor(true);
    try {
      await api.gonder("/api/Izin/HakEdisTarihi", {
        personelKodu: detayKisi.personelKodu,
        adSoyad: detayKisi.adSoyad,
        hakedisTarihi: hdSonuc.format("YYYY-MM-DD"),
        ilkGiris: hdMod === "ara" && hdIlk ? hdIlk.format("YYYY-MM-DD") : null,
        araDonemler:
          hdMod === "ara"
            ? JSON.stringify(
                hdAralar.map((a) => ({
                  ayrilis: a.ayrilis?.format("YYYY-MM-DD"),
                  donus: a.donus?.format("YYYY-MM-DD"),
                }))
              )
            : null,
        aciklama: hdAciklama,
      });
      message.success("Hak ediş tarihi güncellendi.");
      setHdAcik(false);
      const esas = hdSonuc.format("YYYY-MM-DD");
      const guncel = {
        ...detayKisi,
        hakedisEsas: esas,
        hakedisDuzeltme: { tarih: esas },
      };
      detayAc(guncel);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setHdKaydediliyor(false);
    }
  };

  const hdKaldir = () => {
    if (!detayKisi) return;
    modal.confirm({
      title: "Hak ediş düzeltmesi kaldırılsın mı?",
      content: "Kıdem ve hak ediş yeniden Mikro'daki işe giriş tarihinden hesaplanır.",
      okText: "Kaldır",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(
            `/api/Izin/HakEdisTarihi/${encodeURIComponent(detayKisi.personelKodu)}`
          );
          message.success("Düzeltme kaldırıldı.");
          setHdAcik(false);
          detayAc({ ...detayKisi, hakedisEsas: detayKisi.girisTarihi, hakedisDuzeltme: null });
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  const detayAc = async (k: any) => {
    setDetayKisi(k);
    setDetay(null);
    setDetayYukleniyor(true);

    try {
      setDetay(
        await api.al<any>(`/api/Izin/Gecmis/${encodeURIComponent(k.personelKodu)}`)
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setDetayYukleniyor(false);
    }
  };

  /* Rapor ve kontenjan çekmecesinden kişinin izin kartı */
  const kisiyiAc = (sicil: string) => {
    const k = (veri?.kayitlar ?? []).find((x: any) => String(x.personelKodu ?? "").trim() === String(sicil).trim());
    detayAc(k ?? { personelKodu: sicil });
  };

  const izinSil = (kayit: any) => {
    modal.confirm({
      title: "İzin kaydı silinsin mi?",
      content: `${dayjs(kayit.cikisTarihi).format("DD.MM.YYYY")} · ${gun(
        kayit.gun
      )} gün · ${kayit.tur}`,
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Izin/${kayit.id}`);
          message.success("İzin kaydı silindi.");
          detayAc(detayKisi);
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  /* Hak ediş düzenleme */
  const [bakiyeler, setBakiyeler] = useState<Record<string, number | null>>({});

  /* Excel aktarımı */
  const [aktarAcik, setAktarAcik] = useState(false);
  const [aktarSatirlar, setAktarSatirlar] = useState<any[]>([]);

  /* Çizelgenin yılı: haftalık başlıklarda yıl yok ("19.Haziran -
     25.Haziran"), dosya adından ya da sayfa adından bulunur; bulunamazsa
     bu yıl. Kullanıcı değiştirebilir — 2026 çizelgesi 2025 sonunda da
     yüklenebiliyor. */
  const [aktarYili, setAktarYili] = useState<number>(dayjs().year());
  const [aktarKaynak, setAktarKaynak] = useState<string>("");

  /* Yıllık çizelge: Excel'deki haftalık yapının karşılığı */
  const [cizelge, setCizelge] = useState<any>(null);
  const [cizelgeYukleniyor, setCizelgeYukleniyor] = useState(false);
  const [cizelgeYili, setCizelgeYili] = useState<number>(dayjs().year());
  const [cizelgeGorunum, setCizelgeGorunum] = useState<"hafta" | "sube" | "ay">("hafta");
  const [cizelgeSube, setCizelgeSube] = useState<string | undefined>();
  const [cizelgeArama, setCizelgeArama] = useState("");
  const [cizelgeSayfa, setCizelgeSayfa] = useState(1);
  const [yalnizIzinli, setYalnizIzinli] = useState(false);

  const cizelgeGetir = useCallback(async (yil: number) => {
    setCizelgeYukleniyor(true);
    try {
      setCizelge(await api.al<any>(`/api/Izin/Cizelge?yil=${yil}&ayrilanlar=true`));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setCizelgeYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    if (sekme === "cizelge") cizelgeGetir(cizelgeYili);
  }, [sekme, cizelgeYili, cizelgeGetir]);

  /* Aktarım eşleştirmesi için TÜM personel (ayrılanlar dahil). Ekrandaki
     liste süzülmüş olabiliyor; onunla eşleştirmek, çizelgedeki ayrılmış
     personeli "bulunamadı" gösteriyordu. */
  const [tumPersonel, setTumPersonel] = useState<any[]>([]);

  useEffect(() => {
    if (!aktarAcik || tumPersonel.length > 0) return;

    api
      .al<any>("/api/Izin/Durum?tumu=true")
      .then((d) => setTumPersonel(d.kayitlar ?? []))
      .catch(() => setTumPersonel(veri?.kayitlar ?? []));
  }, [aktarAcik, tumPersonel.length, veri]);
  const [aktariliyor, setAktariliyor] = useState(false);

  /* Önizleme süzgeci: yüzlerce satırda sorunlu/uyarılı olanı bulmak için */
  const [aktarSuzgec, setAktarSuzgec] = useState<"hepsi" | "uyari" | "sorun" | "temiz">("hepsi");

  /* Şablon, elinizdeki izin çizelgesinin sütun düzenine göre üretilir:
     PER-KOD, ADI SOYADI, HAKEDİLEN İZİN, GEÇMİŞ YILLARDAN DEVİR,
     KULLANILAN İZİN. Çizelgeden kopyalayıp yapıştırmak yeterli. */
  /* Listeyi çizelgenizle aynı sütunlarla, biçimli .xlsx olarak dışa aktarır */
  const listeIndir = () => {
    tabloIndir({
      baslik: `${cizelgeYili} Yıllık İzin Çizelgesi`,
      altBaslik: `${liste.length} personel`,
      sayfaAdi: "Yıllık İzin",
      dosyaAdi: "yillik-izin",
      grupSutunu: 0,
      genelToplam: true,
      sutunlar: [
        { ad: "MAĞAZA", genislik: 24 },
        { ad: "ADI SOYADI", genislik: 28 },
        { ad: "PER-KOD", genislik: 10 },
        { ad: "TC KİMLİK NO", genislik: 14 },
        { ad: "İŞE GİRİŞ TARİHİ", tip: "tarih" },
        { ad: "YILLIK İZİN HAKEDİŞ TARİHİ", tip: "tarih", genislik: 16 },
        { ad: "HAKEDİŞ BİTİŞ TARİHİ", tip: "tarih", genislik: 16 },
        { ad: "KIDEM YILI", tip: "sayi", toplam: false },
        { ad: "HAKEDİLEN İZİN", tip: "ondalik" },
        { ad: "GEÇMİŞ YILLARDAN DEVİR İZİNİ", tip: "ondalik", genislik: 16 },
        { ad: "KULLANILAN İZİN/PLANLANAN İZİN", tip: "ondalik", genislik: 18, veriCubugu: true },
        { ad: "KALAN İZİN", tip: "ondalik", renkOlcegi: true },
      ],
      satirlar: liste.map((k: any) => {
        const h = hakEdis(esasTarih(k));

        return [
          k.subeAdi ?? "", k.adSoyad ?? "", k.personelKodu ?? "", k.kimlikNo ?? "",
          k.girisTarihi ?? null, h ? h.tarih.toDate() : null, h ? h.bitis.toDate() : null,
          h ? h.kidem : null, k.hakedilen ?? null, k.devir ?? null,
          Number(k.kullanilan ?? 0) + Number(k.planli ?? 0), k.kalan ?? null,
        ];
      }),
    });
  };

  const sablonIndir = () => {
    const satirlar = (veri?.kayitlar ?? []).map(
      (k: any) => `${k.kimlikNo ?? ""};${k.personelKodu};${k.adSoyad};;;`
    );

    const metin =
      "\uFEFFTC KIMLIK NO;PER-KOD;ADI SOYADI;HAKEDILEN IZIN;" +
      "GECMIS YILLARDAN DEVIR;KULLANILAN IZIN\n" +
      satirlar.join("\n");

    const bag = document.createElement("a");
    bag.href = URL.createObjectURL(
      new Blob([metin], { type: "text/csv;charset=utf-8" })
    );
    bag.download = `izin-bakiye-sablon-${dayjs().format("YYYY-MM-DD")}.csv`;
    bag.click();
    URL.revokeObjectURL(bag.href);
  };

  /* Metni satırlara ayırıp eşleştirir. Hem dosyadan hem yapıştırmadan
     gelen veri buradan geçer. */
  const metniIsle = (metin: string) => {
    const temiz = metin.replace(/^\uFEFF/, "");
    const satirlar = temiz.split(/\r?\n/).filter((x) => x.trim());

    if (satirlar.length === 0) {
      message.warning("Dosya boş görünüyor.");
      return;
    }

    const sayiOku = (h: string): number => {
      let t = (h ?? "").trim().replace(/[−–]/g, "-").replace(/\./g, "").replace(",", ".");
      /* Muhasebe biçimi: (20) = -20 */
      if (/^\(.*\)$/.test(t)) t = "-" + t.slice(1, -1);
      return t === "" ? 0 : Number(t);
    };

    /* Ayraç kendiliğinden bulunur: Türkçe Excel noktalı virgül, İngilizce
       virgül, Excel'den kopyalanan veri sekme kullanır. */
    const ilk = satirlar[0];
    const ayrac =
      ilk.includes("\t") ? "\t" : ilk.includes(";") ? ";" : ",";

    /* Başlık satırı aranır; bulunamazsa ilk satır veri kabul edilir.
       Çizelgede üstte özet blokları var, onları atlamak gerekiyor. */
    const basIndeksi = satirlar.findIndex((x) =>
      x.toLocaleUpperCase("tr").replace(/\s/g, "").includes("PER-KOD")
    );

    const veriler = satirlar
      .slice(basIndeksi >= 0 ? basIndeksi + 1 : 0)
      .map((satir) => {
        const p = satir.split(ayrac);

        const kod = (p[0] ?? "").trim().replace(/^"|"$/g, "");
        const ad = (p[1] ?? "").trim().replace(/^"|"$/g, "");
        const hakedilen = sayiOku(p[2]);
        const devir = sayiOku(p[3]);
        const kullanilan = sayiOku(p[4]);

        const kisi = (veri?.kayitlar ?? []).find(
          (k: any) =>
            String(k.personelKodu ?? "").trim().toLowerCase() ===
            kod.toLowerCase()
        );

        return {
          kod,
          dosyaAdi: ad,
          kisi,
          hakedilen,
          devir,
          kullanilan,
          kalan: hakedilen + devir - kullanilan,
          sorun:
            !kod ? "sicil boş"
            : !kisi ? "sicil bulunamadı"
            : !Number.isFinite(hakedilen) ? "hak ediş okunamadı"
            : hakedilen < -400 || hakedilen > 400 ? "hak ediş geçersiz"
            : null,
        };
      })
      .filter((x) => x.kod && /\d/.test(x.kod));

    if (veriler.length === 0) {
      message.error(
        "Satır okunamadı. Sütun sırası PER-KOD, ADI SOYADI, HAKEDİLEN, DEVİR, KULLANILAN olmalı."
      );
      return;
    }

    /* Aynı sicil birden çok kez geçerse ilki alınır */
    const gorulen = new Set<string>();

    veriler.forEach((v) => {
      if (v.sorun) return;

      if (gorulen.has(v.kod.toLowerCase())) {
        v.sorun = "aynı sicil birden fazla kez";
        return;
      }

      gorulen.add(v.kod.toLowerCase());
    });

    setAktarSatirlar(veriler);

    const gecerli = veriler.filter((x) => !x.sorun).length;

    message.success(
      `${veriler.length} satır okundu · ${gecerli} tanesi eşleşti.`
    );
  };

  const dosyaOku = (dosya: File) => {
    /* Çizelge hücre dizisi olarak çözümlenir: Excel (xlsb/xlsx/xls) SheetJS
       ile doğrudan okunur, CSV ayraçtan bölünür. Eskiden yalnızca CSV
       okunuyordu; çizelge .xlsb olduğu için önce Excel'de dönüştürmek
       gerekiyordu ve Türkçe karakter/ayraç sorunları veriyi bozuyordu. */
    const cozumle = (hucreler: string[][], yil: number) => {
      const satirlar = hucreler.filter((r) => r.some((x) => String(x ?? "").trim()));

      if (satirlar.length === 0) {
        message.error("Dosya boş görünüyor.");
        return;
      }

      const sayiOku = (h: string): number => {
        let t = (h ?? "").trim().replace(/\s/g, "").replace(/[−–]/g, "-");
        if (t === "" || t === "-") return 0;

        /* Eksi hak ediş: -20, (20) ya da 20- biçimleri */
        if (/^\(.*\)$/.test(t)) t = "-" + t.slice(1, -1);
        if (/^[\d.,]+-$/.test(t)) t = "-" + t.slice(0, -1);

        /* 1.234,5 → 1234.5 · 1,5 → 1.5 · 12 → 12 */
        const duz = t.includes(",")
          ? t.replace(/\./g, "").replace(",", ".")
          : t;

        const n = Number(duz);
        return Number.isFinite(n) ? n : NaN;
      };

      let basIndeksi = satirlar.findIndex((r) =>
        r.some((x) => String(x ?? "").toLocaleUpperCase("tr").includes("PER-KOD"))
      );

      /* Sicilsiz liste: yalnızca MAĞAZA · ADI SOYADI · KALAN YILLIK İZİN.
         Kişi ad soyad ve mağazadan bulunur. */
      if (basIndeksi < 0)
        basIndeksi = satirlar.findIndex((r) =>
          r.some((x) => /ADI\s*SOYADI|AD\s*SOYAD/.test(String(x ?? "").toLocaleUpperCase("tr")))
        );

      if (basIndeksi < 0) {
        message.error("Başlık satırı bulunamadı. Dosyada PER-KOD ya da ADI SOYADI sütunu olmalı.");
        return;
      }

      /* Sütunlar konuma göre değil BAŞLIK ADINA göre bulunur. Çizelgede
         başta boş bir sütun ve MAĞAZA sütunu var; sabit konum kullanınca
         her şey kayıyordu. Başlıktan aramak, sütun sırası değişse de
         çalışır. */
      const basliklar = satirlar[basIndeksi].map((x) =>
        String(x ?? "").replace(/^"|"$/g, "").trim().toLocaleUpperCase("tr")
      );

      /* Önce tam eşleşme, sonra içerme. Çizelgede "KULLANILAN" başlıklı
         iki tür sütun var: kişi satırındaki "KULLANILAN İZİN/PLANLANAN
         İZİN" (ikisinin toplamı) ve sağdaki "KULLANILAN". İçerme
         aramasında ilkine takılıyor, kullanılan ile planlanan toplanıp
         tek sayı olarak geliyordu. */
      const sutunBul = (...adaylar: string[]): number => {
        for (const aday of adaylar) {
          const tam = basliklar.findIndex((b) => b === aday);
          if (tam >= 0) return tam;
        }
        for (const aday of adaylar) {
          const i = basliklar.findIndex((b) => b.includes(aday));
          if (i >= 0) return i;
        }
        return -1;
      };

      const iKimlik = sutunBul("TC KİMLİK NO", "TC KİMLİK", "TC KIMLIK", "T.C. KİMLİK", "KİMLİK NO", "KIMLIK NO");
      const iKod = sutunBul("PER-KOD", "PERKOD", "SİCİL", "SICIL");
      const iAd = sutunBul("ADI SOYADI", "AD SOYAD", "ADI-SOYADI");
      const iHak = sutunBul("HAKEDİLEN İZİN", "HAKEDİLEN", "HAKEDILEN", "HAK EDİLEN");
      const iDevir = sutunBul("GEÇMİŞ YILLARDAN DEVİR İZİNİ", "DEVİR", "DEVIR");
      const iKullanilanPlanlanan = sutunBul("KULLANILAN İZİN/PLANLANAN İZİN");
      const iKullanilan = sutunBul("KULLANILAN");
      const iPlanlanmis = sutunBul("PLANLANMIŞ", "PLANLANMIS");
      const iKalanDosya = sutunBul("KALAN İZİN", "KALAN");
      const iSube = sutunBul("MAĞAZA", "MAGAZA", "ŞUBE", "SUBE");
      const iGorev = sutunBul("GÖREVİ", "GOREVI", "GÖREV", "POZİSYON");
      const iGiris = sutunBul("İŞE GİRİŞ TARİHİ", "İŞE GİRİŞ", "GİRİŞ TARİHİ");
      const iKidem = sutunBul("KIDEM YILI", "KIDEM");

      /* Excel seri tarihi (45714 gibi) ya da gg.aa.yyyy metni */
      const tarihOku = (h: string): any => {
        const t = (h ?? "").trim();
        if (!t) return null;

        if (/^\d+(\.\d+)?$/.test(t)) {
          const n = Number(t);
          if (n > 20000 && n < 80000)
            return dayjs("1899-12-30").add(Math.floor(n), "day");
        }

        const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
        if (m) return dayjs(`${m[3]}-${m[2]}-${m[1]}`, "YYYY-M-D");

        const d = dayjs(t);
        return d.isValid() ? d : null;
      };

      /* Haftalık izin sütunları: "19.Haziran - 25.Haziran" gibi başlıklar.
         Değerleri o hafta kullanılan gün sayısıdır ve gerçek tarihli izin
         kaydına dönüştürülür. Yıl başlıkta yok; dosyadan bulunan ya da
         kullanıcının seçtiği yıl kullanılır. */
      const haftalar = basliklar
        .map((b, i) => ({ i, hafta: haftaCozumle(b, yil) }))
        .filter((x) => x.hafta !== null) as { i: number; hafta: any }[];

      /* Ad ile eşleştirme: kimlik ve sicil sütunu yoksa */
      const adIle = iKimlik < 0 && iKod < 0;

      if (adIle && iAd < 0) {
        message.error(
          "Eşleştirme sütunu bulunamadı: TC KİMLİK NO, PER-KOD ya da ADI SOYADI olmalı."
        );
        return;
      }

      /* Yalnızca kalan izin verilmişse: kalan gün açılış hak edişi olarak
         yazılır (hak ediş = kalan, devir ve kullanılan 0). */
      const yalnizKalan = iHak < 0 && iKalanDosya >= 0;

      if (iHak < 0 && !yalnizKalan) {
        message.error("HAKEDİLEN İZİN ya da KALAN İZİN sütunu bulunamadı.");
        return;
      }

      /* Ad karşılaştırması: Türkçe harfler sadeleşir, boşluklar tekleşir */
      const sade = (t: string) =>
        String(t ?? "")
          .toLocaleUpperCase("tr")
          .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
          .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C").replace(/Â/g, "A")
          .replace(/[^A-Z0-9 ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const kelimeler = (t: string) => sade(t).split(" ").filter(Boolean);
      const siraliAd = (t: string) => [...kelimeler(t)].sort().join(" ");
      const basSon = (t: string) => { const k = kelimeler(t); return k.length ? `${k[0]} ${k[k.length - 1]}` : ""; };
      const subeUyar = (dosya: string, sistem: string) => {
        const a = sade(dosya), b = sade(sistem);
        return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
      };

      const veriSatirlari = satirlar.slice(basIndeksi + 1);

      const bugun = dayjs().startOf("day");

      const veriler = veriSatirlari
        .map((satir) => {
          const p = satir.map((x) => String(x ?? "").replace(/^"|"$/g, ""));

          const al = (i: number) => (i >= 0 ? (p[i] ?? "") : "");

          /* Eşleştirme kimlik numarasıyla: sicil numarası
             değiştirilebiliyor, kimlik numarası kişiye sabit. Kimlik
             yoksa sicile düşülür. */
          const kimlik = al(iKimlik).replace(/\D/g, "");
          const kod = al(iKod).trim();
          const ad = al(iAd).trim();
          const hakedilen = yalnizKalan ? sayiOku(al(iKalanDosya)) : sayiOku(al(iHak));
          const devir = sayiOku(al(iDevir));

          /* Dosyadaki toplamlar: haftalık sütunlardan hesaplananla
             karşılaştırılır; tutmuyorsa satır uyarı alır. */
          const dosyaKullanilanPlanlanan =
            iKullanilanPlanlanan >= 0 ? sayiOku(al(iKullanilanPlanlanan)) : NaN;
          const dosyaKullanilan = sayiOku(al(iKullanilan));
          const dosyaPlanlanmis = iPlanlanmis >= 0 ? sayiOku(al(iPlanlanmis)) : NaN;
          const dosyaKalan = iKalanDosya >= 0 ? sayiOku(al(iKalanDosya)) : NaN;
          const dosyaGiris = iGiris >= 0 ? tarihOku(al(iGiris)) : null;
          const dosyaKidem = iKidem >= 0 ? sayiOku(al(iKidem)) : NaN;

          const kaynak = tumPersonel.length > 0 ? tumPersonel : (veri?.kayitlar ?? []);

          /* Aynı kişinin Mikro'da birden çok kaydı olabilir: işten çıkıp
             yeniden girenler yeni sicil alıyor ve eski kayıt da duruyor.
             Kimliğe göre ilk bulunan kayıt alınınca hak ediş ayrılmış eski
             sicile yazılıyor, çalışan kişi "girilmedi" görünüyordu.
             Adaylar arasından önce çalışan, sonra dosyadaki sicille aynı
             olan, sonra en son işe giren seçilir. */
          const kimlikAdaylari =
            kimlik.length === 11
              ? kaynak.filter(
                  (k: any) =>
                    String(k.kimlikNo ?? "").replace(/\D/g, "") === kimlik
                )
              : [];

          const sicilAdaylari = kod
            ? kaynak.filter(
                (k: any) =>
                  String(k.personelKodu ?? "").trim().toLowerCase() ===
                  kod.toLowerCase()
              )
            : [];

          const oncelikle = (liste: any[]) =>
            [...liste].sort((a, b) => {
              if (!!a.ayrildi !== !!b.ayrildi) return a.ayrildi ? 1 : -1;

              const aKod = String(a.personelKodu ?? "").trim().toLowerCase() === kod.toLowerCase();
              const bKod = String(b.personelKodu ?? "").trim().toLowerCase() === kod.toLowerCase();
              if (aKod !== bKod) return aKod ? -1 : 1;

              return dayjs(b.girisTarihi ?? 0).valueOf() - dayjs(a.girisTarihi ?? 0).valueOf();
            })[0];

          /* Ad ile eşleştirme: önce birebir ad, sonra kelime sırası farklı,
             sonra ilk ad + soyad (ikinci ad yazılmamışsa). Aynı adda birden
             çok çalışan varsa mağaza ile ayrılır. */
          let adSorunu: string | null = null;
          let adUyarisi: string | null = null;
          let adKisi: any = undefined;

          if (adIle && ad) {
            const calisanlar = kaynak.filter((k: any) => !k.ayrildi);
            const dosyaSubesi = al(iSube).trim();

            const dene = (f: (k: any) => boolean) => calisanlar.filter(f);
            let adaylar = dene((k) => sade(k.adSoyad) === sade(ad));
            if (adaylar.length === 0) {
              adaylar = dene((k) => siraliAd(k.adSoyad) === siraliAd(ad));
              if (adaylar.length) adUyarisi = "ad sırası farklı";
            }
            if (adaylar.length === 0 && kelimeler(ad).length >= 2) {
              adaylar = dene((k) => basSon(k.adSoyad) === basSon(ad));
              if (adaylar.length) adUyarisi = "ikinci ad farklı";
            }

            if (adaylar.length > 1 && dosyaSubesi) {
              const subede = adaylar.filter((k: any) => subeUyar(dosyaSubesi, k.subeAdi));
              if (subede.length > 0) adaylar = subede;
            }

            if (adaylar.length === 1) {
              adKisi = adaylar[0];
              if (dosyaSubesi && !subeUyar(dosyaSubesi, adKisi.subeAdi))
                adUyarisi = [adUyarisi, `mağaza farklı (sistemde ${adKisi.subeAdi || "—"})`].filter(Boolean).join(" · ");
            } else if (adaylar.length > 1) {
              adSorunu = `aynı adda ${adaylar.length} personel`;
            } else {
              const ayrilmis = kaynak.some((k: any) => k.ayrildi && sade(k.adSoyad) === sade(ad));
              adSorunu = ayrilmis ? "yalnızca ayrılmış kaydı var" : "personel bulunamadı";
            }
          }

          const kisi =
            (kimlikAdaylari.length > 0 ? oncelikle(kimlikAdaylari) : undefined) ??
            (sicilAdaylari.length > 0 ? oncelikle(sicilAdaylari) : undefined) ??
            adKisi;

          /* Dosyadaki sicil ile sistemdeki sicil farklıysa söylenmeli:
             hak ediş sistemdeki sicile yazılır */
          const sicilFarkli =
            !!kisi && !!kod &&
            String(kisi.personelKodu ?? "").trim().toLowerCase() !== kod.toLowerCase();

          /* O kişinin hangi haftada kaç gün izin kullandığı.

             Çizelgede izin, başladığı haftanın hücresine toplu yazılıyor:
             14 günlük izin tek hücrede "14" olarak duruyor, ardışık
             haftalara 7-7 bölünmüş de olabiliyor. İkisi de aynı izin.
             Bu yüzden hücre değeri haftanın gün sayısını aşıyorsa izin
             o kadar gün sürer; ardışık haftalar tek kayda birleştirilir.
             Önceden her hücre ayrı bir haftalık kayıt oluyor ve 14 günlük
             izin 7 günde biten bir kayıt olarak görünüyordu. */
          const hamHaftalar = haftalar
            .map((h) => ({
              bas: h.hafta.bas,
              bit: h.hafta.bit,
              gun: sayiOku(al(h.i)),
            }))
            .filter((x) => Number.isFinite(x.gun) && x.gun > 0);

          const izinler: { bas: any; bit: any; gun: number; parca: number }[] = [];

          hamHaftalar.forEach((h) => {
            const son = izinler[izinler.length - 1];

            /* Önceki iznin bitişi bu haftanın hemen öncesine (ya da
               içine) düşüyorsa aynı iznin devamıdır */
            if (son && !son.bit.add(1, "day").isBefore(h.bas)) {
              son.gun += h.gun;
              son.bit = son.bas.add(Math.max(0, Math.ceil(son.gun) - 1), "day");
              son.parca += 1;
              return;
            }

            izinler.push({
              bas: h.bas,
              bit: h.bas.add(Math.max(0, Math.ceil(h.gun) - 1), "day"),
              gun: h.gun,
              parca: 1,
            });
          });

          /* Bugünden sonra başlayanlar plan, öncekiler kullanım. Dosyada
             ikisi tek sütunda toplanıyor; sistem ayırıyor. */
          const planli = izinler
            .filter((x) => x.bas.isAfter(bugun))
            .reduce((t, x) => t + x.gun, 0);

          const haftaToplami = izinler.reduce((t, x) => t + x.gun, 0);
          const kullanilan = haftaToplami - planli;

          /* Dosyadaki toplamla haftalıkların toplamı tutmalı; tutmuyorsa
             çizelgede elle düzeltilmiş bir toplam var demektir. */
          const dosyaToplam = Number.isFinite(dosyaKullanilanPlanlanan)
            ? dosyaKullanilanPlanlanan
            : Number.isFinite(dosyaKullanilan) ? dosyaKullanilan : NaN;

          const toplamFarki =
            Number.isFinite(dosyaToplam) && haftalar.length > 0
              ? Math.round((haftaToplami - dosyaToplam) * 10) / 10
              : 0;

          const hesapKalan = hakedilen + devir - haftaToplami;

          const kalanFarki = Number.isFinite(dosyaKalan)
            ? Math.round((hesapKalan - dosyaKalan) * 10) / 10
            : 0;

          const uyarilar: string[] = [];

          if (toplamFarki !== 0)
            uyarilar.push(`haftalık toplam ${gun(haftaToplami)}, dosyadaki toplam ${gun(dosyaToplam)}`);

          if (kalanFarki !== 0)
            uyarilar.push(`hesaplanan kalan ${gun(hesapKalan)}, dosyadaki kalan ${gun(dosyaKalan)}`);

          if (hesapKalan < 0)
            uyarilar.push(`eksi hak ediş (${gun(hesapKalan)} gün) · avans izin olarak yazılacak`);

          if (sicilFarkli)
            uyarilar.push(`dosyadaki sicil ${kod}, sistemde ${kisi.personelKodu} (kimlikle eşleşti)`);

          if (kisi?.ayrildi && kimlikAdaylari.length + sicilAdaylari.length > 1)
            uyarilar.push("kişinin birden çok kaydı var, ayrılmış kayıt seçildi");

          if (adUyarisi) uyarilar.push(`adla eşleşti · ${adUyarisi}`);

          return {
            kimlik,
            izinler,
            planli,
            haftaToplami,
            dosyaToplam,
            dosyaKalan,
            dosyaPlanlanmis,
            dosyaGiris,
            dosyaKidem,
            uyarilar,
            dosyaSube: al(iSube).trim(),
            dosyaGorev: iGorev >= 0 ? al(iGorev).trim() : "",
            kod: kisi?.personelKodu ?? kod,
            dosyaKod: kod,
            dosyaAdi: ad,
            kisi,
            /* Kimlikle mi sicille mi eşleşti: önizlemede gösterilir */
            eslesmeTuru:
              !kisi ? null
              : adKisi && kisi === adKisi ? "ad"
              : kimlik.length === 11 &&
                String(kisi.kimlikNo ?? "").replace(/\D/g, "") === kimlik
                ? "kimlik"
                : "sicil",
            hakedilen,
            devir,
            kullanilan,
            kalan: hesapKalan,
            sorun:
              yalnizKalan && al(iKalanDosya).trim() === "" ? "kalan izin boş"
              : adIle && !kisi ? (adSorunu ?? "personel bulunamadı")
              : !adIle && !kimlik && !kod ? "kimlik ve sicil boş"
              : !kisi ? "personel bulunamadı"
              : !Number.isFinite(hakedilen) ? "hak ediş okunamadı"
              : hakedilen < -400 || hakedilen > 400 ? "hak ediş geçersiz"
              : null,
          };
        })
        .filter((x) => x.kimlik || x.dosyaKod || (adIle && x.dosyaAdi));

      if (veriler.length === 0) {
        message.error("Okunacak satır bulunamadı.");
        return;
      }

      const gorulen = new Set<string>();

      veriler.forEach((v) => {
        if (v.sorun) return;

        const anahtar = String(v.kisi?.personelKodu || v.kimlik || v.dosyaKod).toLowerCase();

        if (gorulen.has(anahtar)) {
          v.sorun = "aynı kişi birden fazla kez";
          return;
        }

        gorulen.add(anahtar);
      });

      setAktarSatirlar(veriler);

      const gecerli = veriler.filter((x) => !x.sorun).length;

      message.success(
        `${veriler.length} satır okundu, ${gecerli} tanesi aktarılabilir.`
      );
    };

    /* Yıl: önce dosya adı ("2026 - BİÇEN YILLIK İZİN"), sonra sayfa adı,
       sonra ilk satırlardaki bir 20xx değeri. Bulunamazsa seçili yıl. */
    const yilBul = (...kaynaklar: string[]): number | null => {
      for (const k of kaynaklar) {
        const m = String(k ?? "").match(/\b(20\d{2})\b/);
        if (m) return Number(m[1]);
      }
      return null;
    };

    const okuyucu = new FileReader();

    okuyucu.onerror = () => message.error("Dosya okunamadı.");

    okuyucu.onload = () => {
      try {
        const veri = okuyucu.result as ArrayBuffer;

        /* CSV'de Türkçe Windows ANSI (1254) kaydeder; SheetJS codepage
           verilince doğru okur. Excel biçimlerinde kodlama sorunu yok. */
        const csvMi = /\.(csv|txt)$/i.test(dosya.name);

        const kitap = XLSX.read(veri, {
          type: "array",
          cellDates: false,
          raw: true,
          ...(csvMi ? { codepage: 1254 } : {}),
        });

        /* Çizelge çok sayfalı: "ÖZET ŞUBELER", "2026-YILLIK İZİN",
           "ŞUBELER", "TÜM PERSONELLER". PER-KOD başlığı olan sayfa
           aranır; bulunamazsa ilk sayfa. */
        let sayfaAdi = kitap.SheetNames[0];
        let hucreler: string[][] = [];

        for (const ad of kitap.SheetNames) {
          const h = XLSX.utils.sheet_to_json<any[]>(kitap.Sheets[ad], {
            header: 1,
            raw: true,
            defval: "",
            blankrows: false,
          }) as any[][];

          const var_ = h.slice(0, 40).some((r) =>
            (r ?? []).some((x) => String(x ?? "").toLocaleUpperCase("tr").includes("PER-KOD"))
          );

          /* PER-KOD'lu sayfa yoksa ADI SOYADI başlıklı ilk sayfa */
          const adli = h.slice(0, 40).some((r) =>
            (r ?? []).some((x) => /ADI\s*SOYADI/.test(String(x ?? "").toLocaleUpperCase("tr")))
          );

          if (!var_ && adli && hucreler.length === 0) hucreler = h;

          if (var_) {
            sayfaAdi = ad;
            hucreler = h;
            break;
          }

          if (ad === kitap.SheetNames[0]) hucreler = h;
        }

        const bulunanYil =
          yilBul(dosya.name, sayfaAdi) ??
          yilBul(...hucreler.slice(0, 12).flat().map((x) => String(x ?? "")));

        const yil = bulunanYil ?? aktarYili;

        setAktarYili(yil);
        setAktarKaynak(`${dosya.name} · ${sayfaAdi}`);

        cozumle(
          hucreler.map((r) => (r ?? []).map((x) => (x == null ? "" : String(x)))),
          yil
        );
      } catch (hata: any) {
        message.error(`Dosya çözümlenemedi: ${hata?.message ?? hata}`);
      }
    };

    okuyucu.readAsArrayBuffer(dosya);
  };

  const aktarUygula = async () => {
    const gecerli = aktarSatirlar.filter((x) => !x.sorun);

    if (gecerli.length === 0) {
      message.warning("Aktarılabilecek satır yok.");
      return;
    }

    setAktariliyor(true);

    try {
      const d = await api.gonder<any>(
        "/api/Izin/BakiyeToplu",
        gecerli.map((x) => ({
          personelKodu: x.kod,
          adSoyad: x.kisi?.adSoyad ?? x.dosyaAdi,
          subeAdi: x.kisi?.subeAdi || x.dosyaSube || null,
          gorev: x.kisi?.gorev || x.dosyaGorev || null,
          baslangic: x.hakedilen,
          devir: x.devir,
          /* Haftalık sütun yoksa yalnızca toplam gider; varsa sunucu
             tarihli kayıtlardan hesaplar ve bu alanı yok sayar */
          kullanilan: x.haftaToplami,

          /* Haftalık sütunlardan çıkarılan gerçek tarihli izinler;
             ardışık haftalar tek kayda birleştirilmiş hâlde */
          izinler: (x.izinler ?? []).map((i: any) => ({
            cikisTarihi: i.bas.format("YYYY-MM-DD"),
            donusTarihi: i.bit.format("YYYY-MM-DD"),
            gun: i.gun,
          })),
        }))
      );

      message.success(`${d.yazilan} personelin hak edişi kaydedildi.`);
      setAktarAcik(false);
      setAktarSatirlar([]);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setAktariliyor(false);
    }
  };

  const getir = useCallback(async (ayrilanMi = false) => {
    setYukleniyor(true);

    try {
      setVeri(
        await api.al<any>(`/api/Izin/Durum?ayrilanlar=${ayrilanMi}`)
      );
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir(gorunum === "ayrilan");
  }, [getir, gorunum]);

  const subeler = useMemo(
    () =>
      [
        ...new Set(
          (veri?.kayitlar ?? []).map((k: any) => k.subeAdi).filter(Boolean)
        ),
      ].sort((a: any, b: any) => a.localeCompare(b, "tr")) as string[],
    [veri]
  );

  /* Pano: yalnızca arama ve şube süzgeci (alt görünüm süzgeci panoyu etkilemez) */
  const panoKisileri = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    return (veri?.kayitlar ?? []).filter(
      (k: any) =>
        (!sube || k.subeAdi === sube) &&
        (!q || `${k.adSoyad} ${k.personelKodu} ${k.gorev ?? ""} ${k.subeAdi ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [veri, arama, sube]);

  /* Başlıktaki "+ İzin gir": önce personel seçilir */
  const [kisiSecAcik, setKisiSecAcik] = useState(false);
  const [secilenKod, setSecilenKod] = useState<string | undefined>();

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");

    return (veri?.kayitlar ?? []).filter((k: any) => {
      if (sube && k.subeAdi !== sube) return false;
      if (gorunum === "izinde" && !k.izinde) return false;

      /* Planlı: gelecekte izne çıkacaklar */
      if (gorunum === "planli" && !k.planliCikis) return false;

      /* Dönecek: yedi gün içinde izni biten personel */
      if (gorunum === "donecek") {
        if (!k.izinde || !k.izinDonus) return false;
        if (dayjs(k.izinDonus).diff(dayjs(), "day") > 7) return false;
      }

      /* Bu yıl hiç izin kullanmamış olanlar */
      if (gorunum === "izinsiz") {
        if (!k.girildiMi) return false;
        if (Number(k.kullanilan) > 0 || Number(k.planli) > 0) return false;
      }

      if (q) {
        const metin = `${k.adSoyad} ${k.personelKodu} ${k.gorev ?? ""}`;
        if (!metin.toLocaleLowerCase("tr").includes(q)) return false;
      }

      return true;
    });
  }, [veri, arama, sube, gorunum]);

  /* İzin girişi şube şube açılır: 870 kişilik düz liste içinde kişi
     aramak zor, oysa İK genelde bir şubenin izinlerini birlikte giriyor. */
  const subeGruplari = useMemo(() => {
    const harita = new Map<string, any[]>();

    liste.forEach((k: any) => {
      const ad = k.subeAdi || "Belirtilmemiş";
      if (!harita.has(ad)) harita.set(ad, []);
      harita.get(ad)!.push(k);
    });

    return [...harita.entries()]
      .map(([subeAdi, kisiler]) => ({
        subeAdi,
        kisiler: kisiler.sort((a, b) =>
          String(a.adSoyad).localeCompare(String(b.adSoyad), "tr")
        ),
        kisi: kisiler.length,
        izinde: kisiler.filter((k) => k.izinde).length,
        bakiyesiz: kisiler.filter((k) => !k.girildiMi).length,
        kalan: kisiler.reduce((t, k) => t + (Number(k.kalan) || 0), 0),
      }))
      .sort((a, b) => a.subeAdi.localeCompare(b.subeAdi, "tr"));
  }, [liste]);


  /* Saatlik izinde süre saat farkından hesaplanır ve güne çevrilir */
  const saatFarki = useMemo(() => {
    const [b1, b2] = izinBasSaat.split(":").map(Number);
    const [s1, s2] = izinBitSaat.split(":").map(Number);

    if ([b1, b2, s1, s2].some((x) => !Number.isFinite(x))) return 0;

    const fark = (s1 * 60 + s2 - (b1 * 60 + b2)) / 60;

    return fark > 0 ? Math.round(fark * 100) / 100 : 0;
  }, [izinBasSaat, izinBitSaat]);

  useEffect(() => {
    if (izinTur !== "Saatlik İzin") return;

    /* Saatlik izin aynı gün başlar ve biter */
    if (izinCikis) setIzinDonus(izinCikis);

    /* Gün karşılığı kayıt için tutulur ama hak edişten düşmez.
       Sıfır olamaz: sunucu sıfır gün kabul etmiyor. */
    const karsilik = Math.round((saatFarki / MESAI_SAAT) * 100) / 100;

    setIzinGun(karsilik > 0 ? karsilik : 0.5);
  }, [izinTur, saatFarki, izinCikis]);

  /* Tarih değişince gün sayısı önerilir; kullanıcı değiştirebilir */
  /* Hak edişten düşülmeyen günler; kullanıcı neyin sayılmadığını görsün */
  const [dusulmeyenler, setDusulmeyenler] = useState<string[]>([]);
  /* Cumartesi kuralı açıklamaları (Yönetim → İzin Kuralları) */
  const [gunNotlari, setGunNotlari] = useState<string[]>([]);
  const [gunHesaplaniyor, setGunHesaplaniyor] = useState(false);

  useEffect(() => {
    if (!izinCikis || !izinDonus) return;

    if (izinTur === "Saatlik İzin") return;

    if (izinSure !== "tam") {
      setIzinGun(0.5);
      setDusulmeyenler([]);
      setGunNotlari([]);
      return;
    }

    let iptal = false;

    /* Gün sayısı sunucuda hesaplanıyor: resmi tatiller ve personelin
       haftalık izin günü (vardiya planı, yoksa sabit günü, yoksa pozisyon
       grubunun günleri) hak edişten
       düşülmemeli. Takvim farkı almak, bayrama denk gelen bir izinde
       personelin hak etmediği günleri yiyordu.

       Sunucuya ulaşılamazsa takvim farkına düşülüyor; izin kaydının hiç
       açılamamasındansa. */
    setGunHesaplaniyor(true);

    api
      .al<{ gun: number; dusulmeyenler: string[]; notlar?: string[] }>(
        `/api/Izin/GunHesabi?cikis=${izinCikis.format("YYYY-MM-DD")}` +
          `&donus=${izinDonus.format("YYYY-MM-DD")}` +
          `&pozisyon=${encodeURIComponent(izinKisi?.gorev ?? "")}` +
          `&personelKodu=${encodeURIComponent(izinKisi?.personelKodu ?? "")}`
      )
      .then((c) => {
        if (iptal) return;

        setIzinGun(c.gun);
        setDusulmeyenler(c.dusulmeyenler ?? []);
        setGunNotlari(c.notlar ?? []);
      })
      .catch(() => {
        if (iptal) return;

        setIzinGun(Math.max(1, izinDonus.diff(izinCikis, "day") + 1));
        setDusulmeyenler([]);
        setGunNotlari([]);
      })
      .finally(() => !iptal && setGunHesaplaniyor(false));

    return () => {
      iptal = true;
    };
  }, [izinCikis, izinDonus, izinSure, izinTur, izinKisi]);

  /* Yarım günde çıkış ve dönüş aynı gün olmalı */
  useEffect(() => {
    if (izinSure !== "tam" && izinCikis) setIzinDonus(izinCikis);
  }, [izinSure, izinCikis]);

  /* Çakışma kontrolü */
  useEffect(() => {
    if (!izinKisi?.subeAdi || !izinCikis || !izinDonus) {
      setCakisma([]);
      return;
    }

    const sorgu = new URLSearchParams({
      sube: izinKisi.subeAdi,
      bas: izinCikis.format("YYYY-MM-DD"),
      bit: izinDonus.format("YYYY-MM-DD"),
      haric: izinKisi.personelKodu ?? "",
    });

    api
      .al<any>(`/api/Izin/Cakisma?${sorgu}`)
      .then((d) => setCakisma(d.kayitlar ?? []))
      .catch(() => setCakisma([]));
  }, [izinKisi, izinCikis, izinDonus]);

  const izinAc = (k: any) => {
    setIzinKisi(k);
    setIzinTur("Yıllık İzin");
    setIzinSure("tam");
    setIzinCikis(dayjs());
    setIzinDonus(dayjs());
    setIzinBaslama(dayjs().add(1, "day"));
    setIzinGun(1);
    setIzinNot("");
  };

  const izinKaydet = async () => {
    if (!izinKisi || !izinCikis || !izinDonus) return;

    setIzinKaydediliyor(true);

    try {
      const sonuc = await api.gonder<any>("/api/Izin", {
        personelKodu: izinKisi.personelKodu,
        adSoyad: izinKisi.adSoyad,
        subeAdi: izinKisi.subeAdi,
        gorev: izinKisi.gorev,
        tur: izinTur,
        cikisTarihi: izinCikis.format("YYYY-MM-DD"),
        donusTarihi: izinDonus.format("YYYY-MM-DD"),
        baslamaTarihi: izinBaslama?.format("YYYY-MM-DD") ?? null,
        gun: izinGun,
        baslangicSaat: izinTur === "Saatlik İzin" ? izinBasSaat : null,
        bitisSaat: izinTur === "Saatlik İzin" ? izinBitSaat : null,
        saat: izinTur === "Saatlik İzin" ? saatFarki : null,
        yarimGun:
          izinSure === "once" ? "Öğleden önce"
          : izinSure === "sonra" ? "Öğleden sonra"
          : null,
        aciklama: izinNot || null,
        bakiyedenDussun: izinTur === "Yıllık İzin" ? izinDussun : null,
      });

      /* 26.10.2026: personele bildirim gitti, form şubeye / kendi mailine */
      const hedef = sonuc?.bildirim?.hedef as string | undefined;
      const formNotu =
        hedef === "kisisel" ? " İzin formu personelin e-postasına gönderiliyor."
        : hedef === "sube" ? " İzin formu mağazanın e-postasına gönderiliyor."
        : hedef === "merkez" ? " İzin formu İK e-postasına gönderiliyor."
        : hedef === "depo" ? " İzin formu depo müdürüne gönderiliyor."
        : "";
      message.success(
        (izinTur === "Yıllık İzin" && !izinDussun
          ? "İzin kaydedildi (bakiyeden düşülmedi)."
          : "İzin kaydedildi.")
          + (sonuc?.bildirim ? " Personele bildirim gönderildi." + formNotu : ""),
        6
      );
      setIzinKisi(null);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIzinKaydediliyor(false);
    }
  };

  const bakiyeKaydet = async (k: any) => {
    const deger = bakiyeler[k.personelKodu];

    if (deger === null || deger === undefined) {
      message.warning("Gün sayısı giriniz.");
      return;
    }

    try {
      await api.gonder("/api/Izin/Bakiye", {
        personelKodu: k.personelKodu,
        adSoyad: k.adSoyad,
        baslangic: deger,
      });

      message.success(`${k.adSoyad} · ${gun(deger)} gün kaydedildi.`);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  return (
    <div className="ik-icerik ip">
      <Row gutter={[12, 12]} align="bottom" style={{ marginBottom: 12 }}>
        <Col xs={24} xl={7}>
          <div className="ip-baslik" style={{ margin: 0 }}>
            <div>
              <h2>
                <i><CalendarDays size={17} strokeWidth={2.2} /></i>İzin Yönetimi
              </h2>
              <p>
                {dayjs().year()} izin dönemi · {panoKisileri.length} personel
                {sube ? ` · ${sube}` : ""} · {dayjs().format("DD MMMM YYYY dddd")}
              </p>
            </div>
          </div>
        </Col>

        <Col xs={24} xl={17} style={{ textAlign: "right" }}>
          <Space wrap>
            <Input
              allowClear
              prefix={<Search size={14} strokeWidth={2} />}
              placeholder="Ad, sicil veya görev"
              style={{ width: 180 }}
              value={arama}
              onChange={(e) => setArama(e.target.value)}
            />

            <Select
              allowClear
              showSearch
              style={{ width: 170 }}
              placeholder="Şube"
              value={sube}
              onChange={setSube}
              options={subeler.map((x) => ({ value: x, label: x }))}
            />

            {duzenleyebilir && (
              <Button
                icon={<FileUp size={15} strokeWidth={2} />}
                onClick={() => setAktarAcik(true)}
              >
                Excel'den aktar
              </Button>
            )}

            <Button
              icon={<RefreshCw size={15} strokeWidth={2} />}
              loading={yukleniyor}
              onClick={() => getir(gorunum === "ayrilan")}
            >
              Yenile
            </Button>

            <Button icon={<Download size={15} strokeWidth={2} />} onClick={listeIndir}>
              Excel
            </Button>

            {duzenleyebilir && (
              <Button type="primary" onClick={() => setKisiSecAcik(true)}>
                ＋ İzin gir
              </Button>
            )}
          </Space>
        </Col>
      </Row>

      {/* ------------------------------------------------- sekmeler */}
      <div className="yp-sekmeler">
        {[
          { label: "Pano", value: "pano" },
          { label: "Rapor", value: "rapor" },
          { label: "Kontenjan", value: "kontenjan" },
          { label: "Tüm Personel", value: "liste", sayi: (veri?.kayitlar ?? []).length },
          { label: "Yıllık Çizelge", value: "cizelge" },
          ...(sekmeGizli(oturumOku(), "yillikizin.gorevlendirme")
            ? []
            : [{ label: "Görevlendirme", value: "gorevlendirme" }]),
          ...(sekmeGizli(oturumOku(), "yillikizin.giris")
            ? []
            : [{ label: "İzin Girişi", value: "giris" }]),
          ...(sekmeGizli(oturumOku(), "yillikizin.aktarim")
            ? []
            : [{ label: "Toplu Aktarım", value: "aktarim", sayi: pano.bakiyesiz.length || undefined }]),
        ].map((x: any) => (
          <button
            key={x.value}
            className={sekme === x.value ? "acik" : ""}
            onClick={() => setSekme(x.value)}
          >
            {x.label}
            {x.sayi ? <em>{x.sayi}</em> : null}
          </button>
        ))}
      </div>

      {yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <Spin />
        </div>
      ) : (
        <>
          {sekme === "rapor" ? (
            <IzinRapor onKisiAc={kisiyiAc} />
          ) : sekme === "kontenjan" ? (
            <IzinKontenjan onKisiAc={kisiyiAc} />
          ) : sekme === "gorevlendirme" ? (
            <GorevlendirmeYonetimi />
          ) : sekme === "pano" ? (
            /* ================================================== PANO */
            <IzinPano
              kisiler={panoKisileri}
              surum={veri}
              onKisi={detayAc}
              onListe={setAcikListe}
            />
          ) : sekme === "cizelge" ? (
            /* ---------------------------------------- yıllık çizelge */
            (() => {
              const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem",
                             "Ağu", "Eyl", "Eki", "Kas", "Ara"];

              const haftalar: any[] = cizelge?.haftalar ?? [];
              const subeler: any[] = cizelge?.subeler ?? [];

              const subeSecenekleri = subeler.map((x) => ({ value: x.sube, label: x.sube }));

              const q = cizelgeArama.trim().toLocaleLowerCase("tr");

              const kisiler: any[] = (cizelge?.kisiler ?? []).filter((k: any) => {
                if (cizelgeSube && k.subeAdi !== cizelgeSube) return false;
                if (yalnizIzinli && !(k.haftalar ?? []).some((x: number) => x > 0)) return false;
                if (q && !`${k.adSoyad} ${k.personelKodu} ${k.subeAdi} ${k.gorev}`
                      .toLocaleLowerCase("tr").includes(q)) return false;
                return true;
              });

              const SAYFA = 40;
              const sayfaSayisi = Math.max(1, Math.ceil(kisiler.length / SAYFA));
              const sayfa = Math.min(cizelgeSayfa, sayfaSayisi);
              const gorunen = kisiler.slice((sayfa - 1) * SAYFA, sayfa * SAYFA);

              /* Ay başlıkları: haftalar başladığı aya göre gruplanır */
              const ayGruplari: { ay: number; adet: number }[] = [];
              haftalar.forEach((h) => {
                const son = ayGruplari[ayGruplari.length - 1];
                if (son && son.ay === h.ay) son.adet++;
                else ayGruplari.push({ ay: h.ay, adet: 1 });
              });

              /* Hafta toplamları: Excel'in üstteki toplam satırı */
              const haftaToplam = haftalar.map((_, i) =>
                kisiler.reduce((t, k) => t + (Number(k.haftalar?.[i]) || 0), 0)
              );

              const bugunHafta = cizelge?.bugunHafta ?? -1;

              const hucreSinifi = (v: number, plan: boolean) =>
                v <= 0 ? "" : plan ? " yc-plan" : v >= 5 ? " yc-koyu" : " yc-acik";

              const toplamlar = {
                hak: kisiler.reduce((t, k) => t + (Number(k.hakedilen) || 0) + (Number(k.devir) || 0), 0),
                kul: kisiler.reduce((t, k) => t + (Number(k.kullanilan) || 0), 0),
                pla: kisiler.reduce((t, k) => t + (Number(k.planli) || 0), 0),
                kal: kisiler.reduce((t, k) => t + (Number(k.kalan) || 0), 0),
                bakiyesiz: kisiler.filter((k) => !k.girildiMi).length,
              };

              return (
                <Card size="small" className="iz-bolum" title={`${cizelgeYili} Yıllık İzin Çizelgesi`}
                  extra={
                    <Space wrap>
                      <Select
                        size="small"
                        value={cizelgeYili}
                        onChange={(v) => { setCizelgeYili(v); setCizelgeSayfa(1); }}
                        style={{ width: 90 }}
                        options={[-1, 0, 1].map((f) => ({ value: dayjs().year() + f, label: String(dayjs().year() + f) }))}
                      />
                      <Button size="small" icon={<RefreshCw size={13} strokeWidth={2} />}
                        loading={cizelgeYukleniyor} onClick={() => cizelgeGetir(cizelgeYili)}>
                        Yenile
                      </Button>
                    </Space>
                  }
                >
                  {/* ------------------------------------- özet kutuları */}
                  <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
                    {[
                      { et: "Personel", dg: kisiler.length, ip: cizelgeSube ?? "tüm şubeler", renk: "#1a4d80" },
                      { et: "Toplam hak", dg: gun(toplamlar.hak), ip: "hak ediş + devir", renk: "#722ed1" },
                      { et: "Kullanılan", dg: gun(toplamlar.kul), ip: "bugüne kadar", renk: "#5f8c10" },
                      { et: "Planlanmış", dg: gun(toplamlar.pla), ip: "bugünden sonra", renk: "#d48806" },
                      { et: "Kalan", dg: gun(toplamlar.kal), ip: "gün", renk: "#e8481c" },
                      { et: "Hak edişi girilmemiş", dg: toplamlar.bakiyesiz, ip: "kişi", renk: "#8a8f98" },
                    ].map((k) => (
                      <Col flex="1 1 130px" key={k.et}>
                        <div className="yc-kutu" style={{ borderLeftColor: k.renk }}>
                          <div className="yc-et">{k.et}</div>
                          <div className="yc-dg" style={{ color: k.renk }}>{k.dg}</div>
                          <div className="yc-ip">{k.ip}</div>
                        </div>
                      </Col>
                    ))}
                  </Row>

                  {/* -------------------------------------- süzgeçler */}
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Segmented
                      value={cizelgeGorunum}
                      onChange={(v) => setCizelgeGorunum(v as any)}
                      options={[
                        { label: "Haftalık çizelge", value: "hafta" },
                        { label: "Şube özeti", value: "sube" },
                        { label: "Aylık plan", value: "ay" },
                      ]}
                    />
                    <Select
                      allowClear
                      showSearch
                      placeholder="Şube"
                      value={cizelgeSube}
                      onChange={(v) => { setCizelgeSube(v); setCizelgeSayfa(1); }}
                      style={{ width: 200 }}
                      options={subeSecenekleri}
                    />
                    <Input
                      allowClear
                      value={cizelgeArama}
                      onChange={(e) => { setCizelgeArama(e.target.value); setCizelgeSayfa(1); }}
                      placeholder="Ad, sicil, görev"
                      prefix={<Search size={14} />}
                      style={{ width: 200 }}
                    />
                    <Button
                      size="small"
                      type={yalnizIzinli ? "primary" : "default"}
                      onClick={() => { setYalnizIzinli((o) => !o); setCizelgeSayfa(1); }}
                    >
                      Yalnızca izni olanlar
                    </Button>
                  </Space>

                  {cizelgeYukleniyor && !cizelge ? (
                    <div style={{ textAlign: "center", padding: "50px 0" }}><Spin /></div>
                  ) : cizelgeGorunum === "sube" ? (
                    /* ------------------------------------ şube özeti */
                    <Tablo
                      rowKey="sube"
                      size="small"
                      dataSource={subeler.filter((x) => !cizelgeSube || x.sube === cizelgeSube)}
                      pagination={false}
                      onRow={(x: any) => ({
                        onClick: () => { setCizelgeSube(x.sube); setCizelgeGorunum("hafta"); setCizelgeSayfa(1); },
                        style: { cursor: "pointer" },
                      })}
                      summary={() => {
                        const t = subeler.reduce((a, x) => ({
                          kisi: a.kisi + x.kisi, toplam: a.toplam + Number(x.toplam),
                          kul: a.kul + Number(x.kullanilan), pla: a.pla + Number(x.planli),
                          kal: a.kal + Number(x.kalan) }), { kisi: 0, toplam: 0, kul: 0, pla: 0, kal: 0 });
                        return (
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0}><b>Toplam</b></Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right"><b>{t.kisi}</b></Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right"><b>{gun(t.toplam)}</b></Table.Summary.Cell>
                            <Table.Summary.Cell index={3} align="right"><b>{gun(t.kul)}</b></Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right"><b>{gun(t.pla)}</b></Table.Summary.Cell>
                            <Table.Summary.Cell index={5} align="right"><b>{gun(t.kal)}</b></Table.Summary.Cell>
                            <Table.Summary.Cell index={6} align="right">
                              <b>{t.toplam > 0 ? `%${Math.round((t.kul + t.pla) * 100 / t.toplam)}` : "—"}</b>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={7} />
                          </Table.Summary.Row>
                        );
                      }}
                      columns={[
                        { title: "Şube", dataIndex: "sube" },
                        { title: "Personel", dataIndex: "kisi", align: "right", width: 90,
                          render: (v: number, x: any) => (
                            <Tooltip title={`${x.girilen} kişinin hak edişi girilmiş`}><span>{v}</span></Tooltip>) },
                        { title: "Toplam izin", dataIndex: "toplam", align: "right", width: 110, render: (v: number) => gun(v) },
                        { title: "Kullanılan", dataIndex: "kullanilan", align: "right", width: 110,
                          sorter: (a: any, b: any) => a.kullanilan - b.kullanilan, render: (v: number) => gun(v) },
                        { title: "Planlanmış", dataIndex: "planli", align: "right", width: 110,
                          render: (v: number) => <span style={{ color: v > 0 ? "#722ed1" : undefined }}>{gun(v)}</span> },
                        { title: "Kalan", dataIndex: "kalan", align: "right", width: 100,
                          sorter: (a: any, b: any) => a.kalan - b.kalan,
                          render: (v: number) => <b style={{ color: v < 0 ? "#cf1322" : "#e8481c" }}>{gun(v)}</b> },
                        { title: "Kullanım %", dataIndex: "kullanimOrani", align: "right", width: 100,
                          sorter: (a: any, b: any) => (a.kullanimOrani ?? -1) - (b.kullanimOrani ?? -1),
                          render: (v: number | null) => v == null ? "—" : `%${v}` },
                        { title: "", width: 160, render: (_: any, x: any) => (
                            <div className="pt-cubuk">
                              <i style={{ width: `${Math.min(100, x.kullanimOrani ?? 0)}%`,
                                background: (x.kullanimOrani ?? 0) > 100 ? "#E8481C" : (x.kullanimOrani ?? 0) >= 70 ? "#7CB518" : "#d48806" }} />
                            </div>) },
                      ]}
                    />
                  ) : cizelgeGorunum === "ay" ? (
                    /* ------------------------------------- aylık plan */
                    <div className="yc-kaydir">
                      <table className="yc-tablo">
                        <thead>
                          <tr>
                            <th className="yc-sabit" rowSpan={2}>Şube</th>
                            {AYLAR.map((a) => <th key={a} colSpan={2} className="yc-ay">{a}</th>)}
                            <th colSpan={2} className="yc-ay">Yıl</th>
                          </tr>
                          <tr>
                            {[...AYLAR, "Yıl"].map((a) => (
                              <React.Fragment key={a}>
                                <th className="yc-alt">Kul.</th>
                                <th className="yc-alt">Plan</th>
                              </React.Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {subeler.filter((x) => !cizelgeSube || x.sube === cizelgeSube).map((x: any) => {
                            const yilKul = x.aylar.reduce((t: number, a: any) => t + Number(a.kullanim), 0);
                            const yilPlan = x.aylar.reduce((t: number, a: any) => t + Number(a.plan), 0);
                            return (
                              <tr key={x.sube} onClick={() => { setCizelgeSube(x.sube); setCizelgeGorunum("hafta"); setCizelgeSayfa(1); }}
                                style={{ cursor: "pointer" }}>
                                <td className="yc-sabit yc-ad">{x.sube}</td>
                                {x.aylar.map((a: any) => (
                                  <React.Fragment key={a.ay}>
                                    <td className={"yc-h" + (Number(a.kullanim) > 0 ? " yc-acik" : "")}>{Number(a.kullanim) > 0 ? gun(a.kullanim) : ""}</td>
                                    <td className={"yc-h" + (Number(a.plan) > 0 ? " yc-plan" : "")}>{Number(a.plan) > 0 ? gun(a.plan) : ""}</td>
                                  </React.Fragment>
                                ))}
                                <td className="yc-h yc-toplam">{gun(yilKul)}</td>
                                <td className="yc-h yc-toplam" style={{ color: "#722ed1" }}>{gun(yilPlan)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    /* ------------------------------- haftalık çizelge */
                    <>
                      <div className="yc-kaydir">
                        <table className="yc-tablo">
                          <thead>
                            <tr>
                              <th className="yc-sabit yc-ad" rowSpan={2}>Personel</th>
                              <th className="yc-sabit2" rowSpan={2}>Hak</th>
                              <th className="yc-sabit3" rowSpan={2}>Devir</th>
                              <th className="yc-sabit4" rowSpan={2}>Kul.</th>
                              <th className="yc-sabit5" rowSpan={2}>Kalan</th>
                              {ayGruplari.map((g, i) => (
                                <th key={i} colSpan={g.adet} className="yc-ay">{AYLAR[g.ay - 1]}</th>
                              ))}
                            </tr>
                            <tr>
                              {haftalar.map((h, i) => (
                                <th key={h.no} className={"yc-alt" + (i === bugunHafta ? " yc-bugun" : "")}
                                  title={`${h.no}. hafta · ${dayjs(h.bas).format("DD.MM")} – ${dayjs(h.bit).format("DD.MM")}`}>
                                  {dayjs(h.bas).format("DD")}
                                </th>
                              ))}
                            </tr>
                            <tr className="yc-toplam-satir">
                              <th className="yc-sabit yc-ad">Toplam ({kisiler.length})</th>
                              <th className="yc-sabit2">{gun(toplamlar.hak)}</th>
                              <th className="yc-sabit3"></th>
                              <th className="yc-sabit4">{gun(toplamlar.kul + toplamlar.pla)}</th>
                              <th className="yc-sabit5">{gun(toplamlar.kal)}</th>
                              {haftaToplam.map((t, i) => (
                                <th key={i} className={"yc-alt" + (i === bugunHafta ? " yc-bugun" : "")}>{t > 0 ? gun(t) : ""}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {gorunen.length === 0 ? (
                              <tr><td colSpan={5 + haftalar.length} style={{ padding: 30, textAlign: "center", color: "#8a8f98" }}>
                                Süzgece uyan personel yok.</td></tr>
                            ) : gorunen.map((k: any) => (
                              <tr key={k.personelKodu} className={k.ayrildi ? "yc-ayrilan" : ""}
                                onClick={() => k.girildiMi && detayAc(k)} style={{ cursor: k.girildiMi ? "pointer" : "default" }}>
                                <td className="yc-sabit yc-ad">
                                  <b><PersonelAdi kod={k.personelKodu}>{k.adSoyad}</PersonelAdi></b>
                                  <i>{[k.subeAdi, k.gorev].filter(Boolean).join(" · ")}{k.ayrildi ? " · ayrıldı" : ""}</i>
                                </td>
                                <td className="yc-sabit2">{k.girildiMi ? gun(k.hakedilen) : <span className="yc-yok">—</span>}</td>
                                <td className="yc-sabit3">{Number(k.devir) > 0 ? gun(k.devir) : ""}</td>
                                <td className="yc-sabit4">{gun(Number(k.kullanilan) + Number(k.planli))}</td>
                                <td className="yc-sabit5" style={{ color: k.kalan == null ? undefined : k.kalan < 0 ? "#cf1322" : "#e8481c", fontWeight: 700 }}>
                                  {k.kalan == null ? <span className="yc-yok">—</span> : gun(k.kalan)}
                                </td>
                                {(k.haftalar ?? []).map((v: number, i: number) => (
                                  <td key={i} className={"yc-h" + hucreSinifi(Number(v), !!k.planHaftalari?.[i]) + (i === bugunHafta ? " yc-bugun" : "")}>
                                    {Number(v) > 0 ? gun(v) : ""}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <Space wrap style={{ marginTop: 10, width: "100%", justifyContent: "space-between" }}>
                        <Space size={12} wrap>
                          <Text type="secondary" style={{ fontSize: 12 }}><span className="yc-ornek yc-acik" /> kullanılan</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}><span className="yc-ornek yc-koyu" /> 5 gün ve üzeri</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}><span className="yc-ornek yc-plan" /> planlı (bugünden sonra)</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}><span className="yc-ornek yc-bugun-ornek" /> bu hafta</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>Satıra tıklayınca kişinin izin geçmişi açılır.</Text>
                        </Space>
                        {sayfaSayisi > 1 && (
                          <Space size={6}>
                            <Button size="small" disabled={sayfa <= 1} onClick={() => setCizelgeSayfa(sayfa - 1)}>‹</Button>
                            <Text style={{ fontSize: 12.5 }}>{sayfa} / {sayfaSayisi}</Text>
                            <Button size="small" disabled={sayfa >= sayfaSayisi} onClick={() => setCizelgeSayfa(sayfa + 1)}>›</Button>
                          </Space>
                        )}
                      </Space>
                    </>
                  )}
                </Card>
              );
            })()
          ) : sekme === "giris" ? (
            /* ------------------------------------------ izin girişi */
            <Card size="small" className="iz-bolum" title="İzin Girişi">
              <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                Şubeye tıklayıp personeli açın, ardından kişiye tıklayarak
                izin girin. Hak edişi girilmemiş personele izin kaydedilemez.
              </Paragraph>

              {subeGruplari.length === 0 ? (
                <Empty description="Personel bulunamadı." />
              ) : (
                <Collapse
                  accordion
                  items={subeGruplari.map((g) => ({
                    key: g.subeAdi,
                    label: (
                      <Row align="middle" gutter={[8, 4]} style={{ width: "100%" }}>
                        <Col flex="auto">
                          <b style={{ fontSize: 13.5 }}>{g.subeAdi}</b>
                        </Col>
                        <Col>
                          <Space size={6} wrap>
                            <Tag>{g.kisi} kişi</Tag>

                            {g.izinde > 0 && (
                              <Tooltip title="Şu an izinde olan personel">
                                <Tag color="blue">{g.izinde} izinde</Tag>
                              </Tooltip>
                            )}

                            {g.bakiyesiz > 0 && (
                              <Tooltip title="İzin hak edişi girilmemiş personel">
                                <Tag color="orange">
                                  {g.bakiyesiz} hak edişi girilmemiş
                                </Tag>
                              </Tooltip>
                            )}

                            <Tooltip title="Şubedeki toplam kalan izin günü">
                              <Tag color="green">{gun(g.kalan)} gün</Tag>
                            </Tooltip>
                          </Space>
                        </Col>
                      </Row>
                    ),
                    children: (
                      <Tablo
                        rowKey="personelKodu"
                        size="small"
                        dataSource={g.kisiler}
                        pagination={false}
                        rowClassName={(k: any) =>
                          k.girildiMi ? "rp-tiklanabilir" : ""
                        }
                        onRow={(k: any) => ({
                          onClick: () => {
                            if (!k.girildiMi) {
                              message.warning(
                                "Bu personelin izin hak edişi girilmemiş. Toplu Aktarım sekmesinden girebilirsiniz."
                              );
                              return;
                            }
                            izinAc(k);
                          },
                        })}
                        columns={[
                          {
                            title: "Personel",
                            dataIndex: "adSoyad",
                            width: 210,
                            render: (v: string, k: any) => (
                              <div>
                                <b><PersonelAdi kod={k.personelKodu}>{v}</PersonelAdi></b>
                                <div>
                                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                                    {k.personelKodu} · {k.gorev}
                                  </Text>
                                </div>
                              </div>
                            ),
                          },
                          {
                            title: "Kalan İzin",
                            dataIndex: "kalan",
                            width: 110,
                            align: "right" as const,
                            render: (v: number | null) =>
                              v === null ? (
                                <Text type="secondary">hak ediş yok</Text>
                              ) : (
                                <b
                                  style={{
                                    color:
                                      v <= 0 ? "#cf1322"
                                      : v <= 3 ? "#d46b08"
                                      : "#5f8c10",
                                  }}
                                >
                                  {gun(v)}
                                </b>
                              ),
                          },
                          {
                            title: "Durum",
                            key: "durum",
                            width: 140,
                            render: (_v: any, k: any) =>
                              k.izinde ? (
                                <Tooltip
                                  title={`${dayjs(k.izinCikis).format(
                                    "DD.MM"
                                  )} – ${dayjs(k.izinDonus).format("DD.MM.YYYY")}`}
                                >
                                  <Tag color="blue">izinde</Tag>
                                </Tooltip>
                              ) : k.planliCikis ? (
                                <Tag color="purple">
                                  {dayjs(k.planliCikis).format("DD.MM")} planlı
                                </Tag>
                              ) : (
                                <Text type="secondary">—</Text>
                              ),
                          },
                          {
                            title: "",
                            key: "islem",
                            width: 105,
                            align: "right" as const,
                            render: (_v: any, k: any) =>
                              k.girildiMi && duzenleyebilir ? (
                                <Button size="small" type="primary">
                                  İzin gir
                                </Button>
                              ) : null,
                          },
                        ]}
                      />
                    ),
                  }))}
                />
              )}
            </Card>
          ) : sekme === "aktarim" ? (
            /* ---------------------------------------- toplu aktarım */
            <Card size="small" className="iz-bolum iz-koyu" title="Toplu Aktarım">
              <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                Yıllık izin çizelgenizi olduğu gibi yükleyin (<b>.xlsb</b>,
                .xlsx ya da CSV). "YILLIK İZİN" sayfası, başlık satırı ve
                üstteki özet blokları kendiliğinden bulunur; sütunlar
                çizelgedeki adlarıyla eşleştirilir. Haftalık sütunlardaki
                günler tarihli izin kayıtlarına çevrilir: bugünden önceki
                haftalar kullanılan, sonrakiler planlı sayılır. Aktarım
                tekrarlanabilir; önceki çizelge kayıtlarının üzerine yazar,
                elle girilen izinlere dokunmaz.
              </Paragraph>

              <Space wrap style={{ marginBottom: 14 }}>
                <Button onClick={sablonIndir}>Şablonu indir</Button>
                <Button type="primary" onClick={() => setAktarAcik(true)}>
                  Dosya yükle
                </Button>
              </Space>

              <div className="iz-kutular">
                <div className="iz-kutu">
                  <span>Toplam Personel</span>
                  <b>{veri?.toplam ?? 0}</b>
                </div>
                <div className="iz-kutu iz-k-mor">
                  <span>Hak Edişi Girilen</span>
                  <b style={{ color: "#5f8c10" }}>{veri?.girilen ?? 0}</b>
                </div>
                <div className="iz-kutu iz-k-turuncu">
                  <span>Girilmemiş</span>
                  <b style={{ color: "#e8481c" }}>
                    {(veri?.toplam ?? 0) - (veri?.girilen ?? 0)}
                  </b>
                </div>
              </div>
            </Card>
          ) : sekme === "liste" ? (
          <Card
            size="small"
            className={`iz-bolum ${
              gorunum === "izinde" ? "iz-mavi"
              : gorunum === "donecek" ? "iz-turuncu"
              : gorunum === "ayrilan" ? "iz-koyu"
              : ""
            }`}
            title={
              gorunum === "izinde" ? "Şu An İzinde Olanlar"
              : gorunum === "planli" ? "Planlanmış İzinler"
              : gorunum === "donecek" ? "Bir Hafta İçinde Dönecekler"
              : gorunum === "izinsiz" ? "Bu Yıl Hiç İzin Kullanmayanlar"
              : gorunum === "ayrilan" ? "Ayrılan Personel"
              : "İzin Durumu"
            }
            extra={
              sekme === "liste" ? (
                <Button
                  size="small"
                  icon={<Download size={14} strokeWidth={2} />}
                  onClick={listeIndir}
                >
                  Excel'e aktar
                </Button>
              ) : undefined
            }
          >
            {gorunum === "ayrilan" && (
              <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                İşten ayrılmış personel. Kalan izin günü, ayrılırken ödenmesi
                gereken tutarın karşılığıdır; kayıt bu yüzden saklanır.
              </Paragraph>
            )}

            {gorunum === "izinsiz" && (
              <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                Hak edişi girilmiş olduğu hâlde bu yıl hiç izin kullanmamış ve
                planlamamış personel. Kullanılmayan izin bir sonraki yıla
                devreder ve ayrılma durumunda ödenir.
              </Paragraph>
            )}

            <Row align="middle" gutter={[10, 10]} style={{ marginBottom: 10 }}>
              <Col flex="auto">
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  {liste.length} personel
                </Text>
              </Col>
              <Col>
                <Segmented
                  value={gorunum}
                  onChange={(v) => setGorunum(v as any)}
                  options={[
                    { label: "Tümü", value: "durum" },
                    { label: "İzinde", value: "izinde" },
                    { label: "Planlı", value: "planli" },
                    { label: "Dönecekler", value: "donecek" },
                    { label: "İzin kullanmayanlar", value: "izinsiz" },
                    { label: "Ayrılanlar", value: "ayrilan" },
                  ]}
                />
              </Col>
            </Row>

            <Tablo
              rowKey="personelKodu"
              size="small"
              loading={yukleniyor}
              dataSource={liste}
              pagination={{ pageSize: 25, showSizeChanger: false }}
              scroll={{ x: 1620 }}
              locale={{ emptyText: "Kayıt bulunamadı." }}
              rowClassName={(k: any) => (k.girildiMi ? "rp-tiklanabilir" : "")}
              onRow={(k: any) => ({
                onClick: (e: any) => {
                  /* Düğme ya da giriş kutusuna tıklanmışsa detay açılmaz */
                  if ((e.target as HTMLElement).closest("button, input")) return;
                  if (k.girildiMi) detayAc(k);
                },
              })}
              columns={[
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  width: 195,
                  render: (v: string, k: any) => (
                    <div>
                      <b><PersonelAdi kod={k.personelKodu}>{v}</PersonelAdi></b>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11.5 }}>
                          {k.personelKodu} · {k.gorev}
                        </Text>
                      </div>
                    </div>
                  ),
                },
                { title: "Şube", dataIndex: "subeAdi", width: 140, ellipsis: true },
                {
                  title: "TC Kimlik",
                  dataIndex: "kimlikNo",
                  width: 120,
                  render: (v: string) => v || "—",
                },
                {
                  title: "İşe Giriş",
                  dataIndex: "girisTarihi",
                  width: 110,
                  sorter: (a: any, b: any) =>
                    dayjs(a.girisTarihi).valueOf() - dayjs(b.girisTarihi).valueOf(),
                  render: (v: string) =>
                    v ? dayjs(v).format("DD.MM.YYYY") : "—",
                },
                {
                  title: "Hak Ediş",
                  key: "hakEdisTarihi",
                  width: 110,
                  render: (_v: any, k: any) => {
                    const h = hakEdis(esasTarih(k));
                    if (!h) return "—";
                    return k.hakedisDuzeltme ? (
                      <Tooltip title={`Elle düzeltildi · esas tarih ${dayjs(k.hakedisEsas).format("DD.MM.YYYY")}`}>
                        <span style={{ color: "#722ed1", fontWeight: 600 }}>
                          {h.tarih.format("DD.MM.YYYY")} ✎
                        </span>
                      </Tooltip>
                    ) : (
                      h.tarih.format("DD.MM.YYYY")
                    );
                  },
                },
                {
                  title: "Hak Ediş Bitiş",
                  key: "hakEdisBitis",
                  width: 120,
                  render: (_v: any, k: any) => {
                    const h = hakEdis(esasTarih(k));
                    return h ? h.bitis.format("DD.MM.YYYY") : "—";
                  },
                },
                {
                  title: "Kıdem",
                  key: "kidem",
                  width: 85,
                  align: "center" as const,
                  sorter: (a: any, b: any) =>
                    (hakEdis(esasTarih(a))?.kidem ?? 0) -
                    (hakEdis(esasTarih(b))?.kidem ?? 0),
                  render: (_v: any, k: any) => {
                    const h = hakEdis(esasTarih(k));
                    return h ? `${h.kidem} yıl` : "—";
                  },
                },
                {
                  title: "Hak Edilen",
                  dataIndex: "hakedilen",
                  width: 110,
                  align: "right" as const,
                  render: (v: number | null) =>
                    v === null ? (
                      <Text type="secondary">girilmedi</Text>
                    ) : (
                      gun(v)
                    ),
                },
                {
                  title: "Devir",
                  dataIndex: "devir",
                  width: 95,
                  align: "right" as const,
                  render: (v: number, k: any) =>
                    !k.girildiMi ? "—"
                    : v > 0 ? <span style={{ color: "#722ed1" }}>{gun(v)}</span>
                    : "—",
                },
                {
                  title: "Kullanılan / Planlı",
                  key: "kullanim",
                  width: 155,
                  align: "right" as const,
                  render: (_v: any, k: any) => {
                    if (!k.girildiMi) return "—";

                    return (
                      <span>
                        <b>{gun(k.kullanilan)}</b>
                        <Text type="secondary"> / </Text>
                        <span style={{ color: "#1a4d80" }}>{gun(k.planli)}</span>
                      </span>
                    );
                  },
                },
                {
                  title: "Kalan İzin",
                  dataIndex: "kalan",
                  width: 95,
                  align: "right" as const,
                  sorter: (a: any, b: any) => (a.kalan ?? 0) - (b.kalan ?? 0),
                  render: (v: number | null) =>
                    v === null ? (
                      <Text type="secondary">—</Text>
                    ) : (
                      <b
                        style={{
                          color: v <= 0 ? "#cf1322" : v <= 3 ? "#d46b08" : "#5f8c10",
                        }}
                      >
                        {gun(v)}
                      </b>
                    ),
                },
                {
                  title: "Durum",
                  key: "durum",
                  width: 175,
                  render: (_v: any, k: any) => {
                    if (!k.izinde) {
                      /* İzinde değil ama planlı izni varsa gösterilir:
                         planlama yaparken kimin ne zaman çıkacağını
                         bilmek gerekiyor. */
                      if (k.planliCikis)
                        return (
                          <Tooltip
                            title={`${dayjs(k.planliCikis).format(
                              "DD.MM"
                            )} – ${dayjs(k.planliDonus).format("DD.MM.YYYY")}`}
                          >
                            <Tag color="purple">
                              {dayjs(k.planliCikis).diff(dayjs(), "day")} gün
                              sonra
                            </Tag>
                          </Tooltip>
                        );

                      return <Text type="secondary">—</Text>;
                    }

                    const kalanGun = dayjs(k.izinDonus).diff(dayjs(), "day");

                    return (
                      <Tooltip
                        title={`${dayjs(k.izinCikis).format("DD.MM")} – ${dayjs(
                          k.izinDonus
                        ).format("DD.MM.YYYY")}`}
                      >
                        <Tag color={kalanGun <= 1 ? "orange" : "blue"}>
                          {kalanGun <= 0
                            ? "bugün dönüyor"
                            : `izinde · ${kalanGun} gün`}
                        </Tag>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: "",
                  key: "islem",
                  width: 210,
                  align: "right" as const,
                  render: (_v: any, k: any) =>
                    !duzenleyebilir ? null : !k.girildiMi ? (
                      <Space size={6}>
                        <InputNumber
                          size="small"
                          min={-400}
                          max={400}
                          step={0.5}
                          style={{ width: 80 }}
                          placeholder="gün"
                          value={bakiyeler[k.personelKodu]}
                          onChange={(v) =>
                            setBakiyeler({ ...bakiyeler, [k.personelKodu]: v })
                          }
                        />
                        <Button size="small" onClick={() => bakiyeKaydet(k)}>
                          Kaydet
                        </Button>
                      </Space>
                    ) : (
                      <Space size={6}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<CalendarDays size={13} strokeWidth={2} />}
                          onClick={() => izinAc(k)}
                        >
                          İzin gir
                        </Button>
                      </Space>
                    ),
                },
              ]}
            />
          </Card>
          ) : null}
        </>
      )}

      {/* ------------------------------------------ izin için personel seçimi */}
      <Modal
        open={kisiSecAcik}
        title="İzin gir · personel seçin"
        okText="Devam"
        cancelText="Vazgeç"
        okButtonProps={{ disabled: !secilenKod }}
        onCancel={() => setKisiSecAcik(false)}
        onOk={() => {
          const k = (veri?.kayitlar ?? []).find((x: any) => x.personelKodu === secilenKod);
          setKisiSecAcik(false);
          setSecilenKod(undefined);
          if (k) izinAc(k);
        }}
      >
        <Select
          showSearch
          autoFocus
          style={{ width: "100%" }}
          placeholder="Ad, sicil veya şube yazın"
          value={secilenKod}
          onChange={setSecilenKod}
          optionFilterProp="label"
          options={(veri?.kayitlar ?? [])
            .filter((k: any) => k.girildiMi)
            .map((k: any) => ({
              value: k.personelKodu,
              label: `${k.adSoyad} · ${k.subeAdi ?? ""} · ${k.personelKodu} · ${gun(k.kalan)} gün kalan`,
            }))}
        />
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
          Hak edişi girilmemiş personel listede yer almaz; önce hak edişini giriniz.
        </div>
      </Modal>

      {/* --------------------------------------------- karttan açılan liste */}
      <Modal
        open={!!acikListe}
        onCancel={() => setAcikListe(null)}
        footer={null}
        width={560}
        title={
          acikListe && (
            <Space size={8}>
              <Text strong>{acikListe.baslik}</Text>
              <Tag>{acikListe.kisiler.length} kişi</Tag>
            </Space>
          )
        }
      >
        {acikListe && (
          <div
            className="iz-pano-liste"
            style={{ maxHeight: "60vh", overflowY: "auto", marginTop: 8 }}
          >
            {acikListe.kisiler.map((k: any) => (
              <div
                key={k.personelKodu}
                className="iz-pano-satir"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setAcikListe(null);
                  detayAc(k);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setAcikListe(null);
                    detayAc(k);
                  }
                }}
              >
                <span className="iz-pano-harf">
                  <img
                    src={api.resimAdresi(k.personelKodu)}
                    alt=""
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  {String(k.adSoyad ?? "")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((x: string) => x[0])
                    .join("")}
                </span>

                <span className="iz-pano-ad">
                  <PersonelAdi kod={k.personelKodu}>{k.adSoyad}</PersonelAdi>
                  <i>
                    {k.gorev} · {k.subeAdi}
                  </i>
                </span>

                <span className="iz-pano-sag">
                  <b style={{ color: "var(--yesil-koyu)" }}>
                    {acikListe.sag ? acikListe.sag(k) : ""}
                  </b>
                  {k.kalan !== null && <i>{gun(k.kalan)} gün kalan</i>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------ kişi detayı */}
      {/* ------------------------------ hak ediş tarihi düzeltme */}
      <Modal
        open={hdAcik}
        onCancel={() => setHdAcik(false)}
        title={`Hak ediş tarihi · ${detayKisi?.adSoyad ?? ""}`}
        width={620}
        destroyOnClose
        footer={
          <div style={{ display: "flex", gap: 8 }}>
            {(detay?.hakedis ?? detayKisi?.hakedisDuzeltme) && (
              <Button danger onClick={hdKaldir}>
                Düzeltmeyi kaldır
              </Button>
            )}
            <span style={{ flex: 1 }} />
            <Button onClick={() => setHdAcik(false)}>Vazgeç</Button>
            <Button
              type="primary"
              loading={hdKaydediliyor}
              disabled={!!hdSorun}
              onClick={hdKaydet}
            >
              Kaydet
            </Button>
          </div>
        }
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Ayrılıp tekrar işe giren personelde önceki çalışma süresi kıdeme
          sayılır. Çalışılmayan ara süre ilk işe giriş tarihine eklenir;
          kıdem ve yıllık hak ediş bu yeni tarihten hesaplanır. Sistem bunu
          her sabah bordrodaki bütün girişlerden kendiliğinden hesaplar;
          burada kaydedilen tarih İK düzeltmesi olur ve otomatik hesap ona
          dokunmaz.
        </Paragraph>

        {(detay?.hakedis ?? detayKisi?.hakedisDuzeltme)?.kaynak === "bordro" && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Bu tarih bordrodan otomatik hesaplandı."
          />
        )}

        <Button
          block
          loading={hdBordroYukleniyor}
          onClick={hdBordrodanGetir}
          style={{ marginBottom: 12 }}
        >
          Bordrodan getir (bütün giriş ve çıkışlar)
        </Button>

        <Segmented
          block
          value={hdMod}
          onChange={(v) => setHdMod(v as "ara" | "elle")}
          options={[
            { label: "Ara dönemden hesapla", value: "ara" },
            { label: "Tarihi elle gir", value: "elle" },
          ]}
          style={{ marginBottom: 14 }}
        />

        {hdMod === "ara" ? (
          <>
            <Text type="secondary" style={{ fontSize: 12 }}>
              İlk işe giriş tarihi
            </Text>
            <DatePicker
              style={{ width: "100%", marginBottom: 12 }}
              format="DD.MM.YYYY"
              value={hdIlk}
              onChange={setHdIlk}
              placeholder="Örn. 02.06.2024"
            />

            {hdAralar.map((a, i) => (
              <div className="hd-ara" key={i}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    İşten ayrılış (son çalıştığı gün)
                  </Text>
                  <DatePicker
                    style={{ width: "100%" }}
                    format="DD.MM.YYYY"
                    value={a.ayrilis}
                    onChange={(v) =>
                      setHdAralar(hdAralar.map((x, j) => (j === i ? { ...x, ayrilis: v } : x)))
                    }
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Tekrar işe giriş
                  </Text>
                  <DatePicker
                    style={{ width: "100%" }}
                    format="DD.MM.YYYY"
                    value={a.donus}
                    onChange={(v) =>
                      setHdAralar(hdAralar.map((x, j) => (j === i ? { ...x, donus: v } : x)))
                    }
                  />
                </div>
                <div className="hd-ara-sonuc">
                  {araGun(a) > 0 ? (
                    <>
                      <b>+{araMetni(a)}</b>
                      <small>{araGun(a)} gün</small>
                    </>
                  ) : (
                    <small>—</small>
                  )}
                </div>
                {hdAralar.length > 1 && (
                  <Button
                    type="text"
                    danger
                    size="small"
                    onClick={() => setHdAralar(hdAralar.filter((_, j) => j !== i))}
                  >
                    Sil
                  </Button>
                )}
              </div>
            ))}

            <Button
              type="dashed"
              block
              size="small"
              style={{ marginBottom: 12 }}
              onClick={() => setHdAralar([...hdAralar, { ayrilis: null, donus: null }])}
            >
              + Ara dönem ekle (birden fazla kez ayrılıp döndüyse)
            </Button>
          </>
        ) : (
          <>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Hak ediş esas tarihi
            </Text>
            <DatePicker
              style={{ width: "100%", marginBottom: 12 }}
              format="DD.MM.YYYY"
              value={hdElle}
              onChange={setHdElle}
            />
          </>
        )}

        <Text type="secondary" style={{ fontSize: 12 }}>
          Açıklama (isteğe bağlı)
        </Text>
        <Input
          value={hdAciklama}
          onChange={(e) => setHdAciklama(e.target.value)}
          maxLength={300}
          placeholder="Örn. 03.2025'te ayrıldı, 01.2026'da tekrar başladı"
          style={{ marginBottom: 14 }}
        />

        {hdSorun ? (
          <Alert type="info" showIcon message={hdSorun} />
        ) : (
          hdSonuc && (
            <div className="hd-sonuc">
              <div>
                <span>Yeni hak ediş esas tarihi</span>
                <b>{hdSonuc.format("DD.MM.YYYY")}</b>
                {hdMod === "ara" && hdIlk && (
                  <small>
                    {hdIlk.format("DD.MM.YYYY")} + {hdToplamGun} gün çalışılmayan süre
                  </small>
                )}
              </div>
              <div>
                <span>Kıdem</span>
                <b>{kidemMetni(hdSonuc.format("YYYY-MM-DD"))}</b>
              </div>
              <div>
                <span>Bu yılki hak ediş</span>
                <b>{hakEdis(hdSonuc.format("YYYY-MM-DD"))?.tarih.format("DD.MM.YYYY")}</b>
              </div>
            </div>
          )
        )}
      </Modal>

      <Drawer
        open={!!detayKisi}
        onClose={() => setDetayKisi(null)}
        width="min(760px, 96vw)"
        title={
          detayKisi && (
            <Space size={8} wrap>
              <Text strong><PersonelAdi kod={detayKisi.personelKodu}>{detayKisi.adSoyad}</PersonelAdi></Text>
              {detayKisi.gorev && <Tag color="green">{detayKisi.gorev}</Tag>}
              {detayKisi.subeAdi && <Tag>{detayKisi.subeAdi}</Tag>}
            </Space>
          )
        }
        extra={
          duzenleyebilir &&
          detayKisi && (
            <Button
              type="primary"
              size="small"
              icon={<CalendarDays size={14} strokeWidth={2} />}
              onClick={() => {
                setDetayKisi(null);
                izinAc(detayKisi);
              }}
            >
              İzin gir
            </Button>
          )
        }
      >
        {detayYukleniyor ? (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <Spin />
          </div>
        ) : (
          detayKisi && (
            <>
              {/* ------------------------------------------- künye */}
              <div className="iz-kisi">
                <Avatar
                  size={48}
                  src={api.resimAdresi(detayKisi.personelKodu)}
                  style={{
                    background: "var(--yesil-acik)",
                    color: "var(--yesil-koyu)",
                    fontWeight: 700,
                    flex: "0 0 auto",
                  }}
                >
                  {String(detayKisi.adSoyad ?? "")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((x: string) => x[0])
                    .join("")}
                </Avatar>

                <div className="iz-kisi-govde">
                  <p className="iz-kisi-ad"><PersonelAdi kod={detayKisi.personelKodu}>{detayKisi.adSoyad}</PersonelAdi></p>

                  <Space size={6} wrap style={{ marginBottom: 4 }}>
                    {detayKisi.gorev && <Tag color="green">{detayKisi.gorev}</Tag>}
                    {detayKisi.subeAdi && <Tag>{detayKisi.subeAdi}</Tag>}
                    {detayKisi.izinde && <Tag color="orange">İzinde</Tag>}
                  </Space>

                  <div className="iz-kisi-meta">
                    <span>Sicil {detayKisi.personelKodu}</span>
                    {detayKisi.kimlikNo && <span>{detayKisi.kimlikNo}</span>}
                    {detayKisi.girisTarihi && (
                      <span>
                        İşe giriş{" "}
                        {dayjs(detayKisi.girisTarihi).format("DD.MM.YYYY")}
                      </span>
                    )}
                    {esasTarih(detayKisi) && (
                      <span>Kıdem {kidemMetni(esasTarih(detayKisi))}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* ------------------------------------------- kutular */}
              <div className="iz-kutular">
                <div className="iz-kutu">
                  <span>Hak Edilen</span>
                  <b>{gun(detayKisi.hakedilen)}</b>
                </div>
                <div className="iz-kutu iz-k-mor">
                  <span>Devir</span>
                  <b style={{ color: "#722ed1" }}>{gun(detayKisi.devir)}</b>
                </div>
                <div className="iz-kutu iz-k-koyu">
                  <span>Kullanılan</span>
                  <b>{gun(detayKisi.kullanilan)}</b>
                </div>
                <div className="iz-kutu iz-k-mavi">
                  <span>Planlı</span>
                  <b style={{ color: "#1a4d80" }}>{gun(detayKisi.planli)}</b>
                </div>
                <div className="iz-kutu iz-k-turuncu">
                  <span>Kalan İzin</span>
                  <b
                    style={{
                      color:
                        (detayKisi.kalan ?? 0) <= 0 ? "#cf1322"
                        : (detayKisi.kalan ?? 0) <= 3 ? "#d46b08"
                        : "#5f8c10",
                    }}
                  >
                    {gun(detayKisi.kalan)}
                  </b>
                </div>
              </div>

              {/* ------------------------------ kıdem / hak ediş tarihi */}
              {(() => {
                const esas = esasTarih(detayKisi);
                const h = hakEdis(esas);
                const d = detay?.hakedis ?? detayKisi.hakedisDuzeltme;
                let aralar: any[] = [];
                try {
                  aralar = JSON.parse(d?.araDonemler || "[]");
                } catch {
                  aralar = [];
                }
                /* Sonraki hak ediş: bu yılki yıl dönümü geçtiyse gelecek yıl */
                const sonraki = h
                  ? h.tarih.isBefore(dayjs(), "day")
                    ? h.tarih.add(1, "year")
                    : h.tarih
                  : null;

                return (
                  <div className={`hd-kart${d ? " duzeltildi" : ""}`}>
                    <div className="hd-kart-ust">
                      <b>Kıdem ve hak ediş tarihi</b>
                      {d && <Tag color="purple" style={{ marginInlineEnd: 0 }}>Elle düzeltildi</Tag>}
                      {duzenleyebilir && (
                        <Button size="small" style={{ marginLeft: "auto" }} onClick={hdAc}>
                          {d ? "Düzenle" : "Hak ediş tarihini düzenle"}
                        </Button>
                      )}
                    </div>

                    <div className="hd-izgara">
                      <div>
                        <span>İşe giriş (Mikro)</span>
                        <b>
                          {detayKisi.girisTarihi
                            ? dayjs(detayKisi.girisTarihi).format("DD.MM.YYYY")
                            : "—"}
                        </b>
                      </div>
                      <div>
                        <span>Hak ediş esas tarihi</span>
                        <b style={d ? { color: "#722ed1" } : undefined}>
                          {esas ? dayjs(esas).format("DD.MM.YYYY") : "—"}
                        </b>
                      </div>
                      <div>
                        <span>Kıdem</span>
                        <b>{kidemMetni(esas)}</b>
                      </div>
                      <div>
                        <span>Sonraki hak ediş</span>
                        <b>{sonraki ? sonraki.format("DD.MM.YYYY") : "—"}</b>
                      </div>
                    </div>

                    {d && (aralar.length > 0 || d.aciklama) && (
                      <div className="hd-not">
                        {d.ilkGiris && <>İlk giriş {dayjs(d.ilkGiris).format("DD.MM.YYYY")}</>}
                        {aralar.map((a: any, i: number) => {
                          const ad: AraDonem = {
                            ayrilis: a.ayrilis ? dayjs(a.ayrilis) : null,
                            donus: a.donus ? dayjs(a.donus) : null,
                          };
                          return (
                            <span key={i}>
                              {" · "}ayrılış {ad.ayrilis?.format("DD.MM.YYYY")} → dönüş{" "}
                              {ad.donus?.format("DD.MM.YYYY")} ({araMetni(ad)} çalışılmadı)
                            </span>
                          );
                        })}
                        {d.aciklama && <div>{d.aciklama}</div>}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* -------------------------------------- hak ediş düzenle */}
              {duzenleyebilir && (
                <Card size="small" style={{ marginBottom: 14 }}>
                  <Row gutter={[10, 10]} align="bottom">
                    <Col xs={12} md={7}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Hak edilen izin
                      </Text>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={-400}
                        max={400}
                        step={0.5}
                        value={
                          bakiyeler[`h-${detayKisi.personelKodu}`] ??
                          detayKisi.hakedilen
                        }
                        onChange={(v) =>
                          setBakiyeler({
                            ...bakiyeler,
                            [`h-${detayKisi.personelKodu}`]: v,
                          })
                        }
                      />
                    </Col>

                    <Col xs={12} md={7}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Geçmişten devir
                      </Text>
                      <InputNumber
                        style={{ width: "100%" }}
                        min={-400}
                        max={400}
                        step={0.5}
                        value={
                          bakiyeler[`d-${detayKisi.personelKodu}`] ??
                          detayKisi.devir
                        }
                        onChange={(v) =>
                          setBakiyeler({
                            ...bakiyeler,
                            [`d-${detayKisi.personelKodu}`]: v,
                          })
                        }
                      />
                    </Col>

                    <Col xs={24} md={10}>
                      <Button
                        block
                        onClick={async () => {
                          try {
                            await api.gonder("/api/Izin/Bakiye", {
                              personelKodu: detayKisi.personelKodu,
                              adSoyad: detayKisi.adSoyad,
                              baslangic:
                                bakiyeler[`h-${detayKisi.personelKodu}`] ??
                                detayKisi.hakedilen,
                              devir:
                                bakiyeler[`d-${detayKisi.personelKodu}`] ??
                                detayKisi.devir,
                            });

                            message.success("Hak ediş güncellendi.");
                            setDetayKisi(null);
                            getir();
                          } catch (hata: any) {
                            message.error(hata.message);
                          }
                        }}
                      >
                        Bakiyeyi güncelle
                      </Button>
                    </Col>
                  </Row>
                </Card>
              )}

              {/* ------------------------------------------- geçmiş */}
              <Card size="small" className="iz-bolum" title="İzin Geçmişi">
                {(detay?.kayitlar ?? []).length === 0 ? (
                  <Empty description="Henüz izin kaydı yok." />
                ) : (
                  <Tablo
                    rowKey="id"
                    size="small"
                    dataSource={detay.kayitlar}
                    pagination={false}
                    scroll={{ y: 300 }}
                    columns={[
                      {
                        title: "Çıkış",
                        dataIndex: "cikisTarihi",
                        width: 105,
                        render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
                      },
                      {
                        title: "Dönüş",
                        dataIndex: "donusTarihi",
                        width: 105,
                        render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
                      },
                      {
                        title: "İşe Başlama",
                        dataIndex: "baslamaTarihi",
                        width: 115,
                        render: (v: string) =>
                          v ? dayjs(v).format("DD.MM.YYYY") : "—",
                      },
                      {
                        title: "Gün",
                        dataIndex: "gun",
                        width: 70,
                        align: "right" as const,
                        render: (v: number) => <b>{gun(v)}</b>,
                      },
                      {
                        title: "Tür",
                        dataIndex: "tur",
                        width: 150,
                        render: (v: string, k: any) => (
                          <span>
                            <Tag color={k.bakiyedenDuser ? "green" : undefined}>
                              {v}
                            </Tag>
                            {v === "Yıllık İzin" && !k.bakiyedenDuser && (
                              <Tooltip title="Geriye dönük kayıt; kalan izinden düşülmedi">
                                <Tag color="gold">hak edişten düşmedi</Tag>
                              </Tooltip>
                            )}
                            {k.baslangicSaat && (
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {k.baslangicSaat}–{k.bitisSaat}
                                {k.saat ? ` · ${k.saat} saat` : ""}
                              </Text>
                            )}
                            {k.yarimGun && (
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {k.yarimGun}
                              </Text>
                            )}
                          </span>
                        ),
                      },
                      {
                        title: "Giren",
                        dataIndex: "giren",
                        ellipsis: true,
                        render: (v: string) => v || "—",
                      },
                      ...(duzenleyebilir
                        ? [
                            {
                              title: "",
                              key: "sil",
                              width: 70,
                              align: "right" as const,
                              render: (_v: any, k: any) => (
                                <Button
                                  size="small"
                                  danger
                                  onClick={() => izinSil(k)}
                                >
                                  Sil
                                </Button>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </Card>
            </>
          )
        )}
      </Drawer>

      {/* ------------------------------------------------ Excel aktarımı */}
      <Modal
        open={aktarAcik}
        onCancel={() => {
          setAktarAcik(false);
          setAktarSatirlar([]);
        }}
        onOk={aktarUygula}
        okText={`Aktar (${aktarSatirlar.filter((x) => !x.sorun).length})`}
        cancelText="Vazgeç"
        confirmLoading={aktariliyor}
        okButtonProps={{
          disabled: aktarSatirlar.filter((x) => !x.sorun).length === 0,
        }}
        width="min(1100px, 96vw)"
        title="Excel'den izin hak edişi aktar"
      >
        <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 12 }}>
          <b>Yıllık izin çizelgenizi olduğu gibi yükleyin</b> — .xlsb, .xlsx,
          .xls ya da CSV; dönüştürmeye gerek yok. Çok sayfalı dosyada
          PER-KOD başlığı olan sayfa kendiliğinden bulunur, üstteki özet
          blokları atlanır. Okunanlar: HAKEDİLEN İZİN, GEÇMİŞ YILLARDAN
          DEVİR ve haftalık sütunlar ("19.Haziran - 25.Haziran" gibi) —
          haftalar tarihli izin kaydına dönüşür; bugünden sonrakiler planlı
          sayılır. Eşleştirme <b>TC kimlik numarasıyla</b> yapılır; kimlik
          sütunu yoksa sicil kullanılır, ada bakılmaz. <b>Ayrılmış personelin
          hak edişi de aktarılır</b>; onlar "Ayrılanlar" sekmesinde görünür.
          <br />
          <b>Sicilsiz liste de olur:</b> yalnızca MAĞAZA · ADI SOYADI · KALAN
          YILLIK İZİN sütunları varsa kişi ad soyaddan bulunur (aynı adda iki
          çalışan varsa mağazadan ayrılır) ve kalan gün açılış hak edişi olarak
          yazılır. Eşleşmeyen satırda kişiyi listeden elle seçebilirsiniz.
        </Paragraph>

        <Space wrap style={{ marginBottom: 14 }}>
          <Button onClick={sablonIndir}>Şablonu indir</Button>

          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12.5 }}>Çizelge yılı</Text>
            <Select
              size="small"
              value={aktarYili}
              onChange={(v) => {
                setAktarYili(v);
                /* Haftalar yıla bağlı; yıl değişince dosya yeniden
                   seçilmeli, eski önizleme yanıltmasın */
                if (aktarSatirlar.length > 0) {
                  setAktarSatirlar([]);
                  message.info("Yıl değişti; dosyayı yeniden seçiniz.");
                }
              }}
              style={{ width: 90 }}
              options={[-1, 0, 1].map((f) => {
                const y = dayjs().year() + f;
                return { value: y, label: String(y) };
              })}
            />
          </Space>

          <Button
            onClick={() => document.getElementById("izin-dosya")?.click()}
          >
            Dosya seç
          </Button>

          {/* Her dosya kabul edilir; Excel ise açıklayıcı uyarı verilir.
              Kısıtlı bir accept, kullanıcının dosyayı seçememesine ve
              hiçbir şey olmamasına yol açıyordu. */}
          <input
            id="izin-dosya"
            type="file"
            accept=".xlsb,.xlsx,.xlsm,.xls,.csv,.txt"
            style={{ display: "none" }}
            onChange={(e) => {
              const d = e.target.files?.[0];
              if (d) dosyaOku(d);
              e.target.value = "";
            }}
          />

          {aktarSatirlar.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {aktarKaynak && <>{aktarKaynak} · </>}
              {aktarSatirlar.length} satır okundu ·{" "}
              <b style={{ color: "#5f8c10" }}>
                {aktarSatirlar.filter((x) => !x.sorun).length} aktarılacak
              </b>
              {aktarSatirlar.some((x) => x.sorun) && (
                <>
                  {" · "}
                  <b style={{ color: "#cf1322" }}>
                    {aktarSatirlar.filter((x) => x.sorun).length} atlanacak
                  </b>
                </>
              )}
            </Text>
          )}
        </Space>

        {aktarSatirlar.length === 0 && (
          <div style={{ marginBottom: 14 }}>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Ya da çizelgedeki satırları kopyalayıp buraya yapıştırın —
              dosya kaydetmeye gerek kalmaz.
            </Text>

            <TextArea
              rows={5}
              style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12 }}
              placeholder={
                "Excel'de satırları seçip kopyalayın (Ctrl+C), buraya yapıştırın (Ctrl+V).\n\n" +
                "13310\tBERK GÖKSEL AKBAŞ\t14\t\t11\n" +
                "11033\tAYDIN OLAM\t14\t\t14"
              }
              onChange={(e) => {
                const metin = e.target.value;
                if (metin.trim().split(/\r?\n/).length >= 1 && metin.includes("\t"))
                  metniIsle(metin);
              }}
            />
          </div>
        )}

        {aktarSatirlar.length > 0 && (() => {
          const sorunlu = aktarSatirlar.filter((x) => x.sorun);
          const uyarili = aktarSatirlar.filter((x) => !x.sorun && (x.uyarilar ?? []).length > 0);
          const temiz = aktarSatirlar.filter((x) => !x.sorun && (x.uyarilar ?? []).length === 0);

          const gosterilen =
            aktarSuzgec === "sorun" ? sorunlu
            : aktarSuzgec === "uyari" ? uyarili
            : aktarSatirlar;

          const bulunamayan = sorunlu.filter((x) => x.sorun === "personel bulunamadı").length;

          return (
            <>
              {/* ------------------------------------------ özet şeridi */}
              <div className="iz-kutular" style={{ marginBottom: 10 }}>
                <div
                  className={"iz-kutu iz-tik" + (aktarSuzgec === "hepsi" ? " iz-kutu-secili" : "")}
                  onClick={() => setAktarSuzgec("hepsi")}
                >
                  <span>Okunan satır</span>
                  <b>{aktarSatirlar.length}</b>
                </div>
                <div
                  className={"iz-kutu iz-k-mor iz-tik" + (aktarSuzgec === "temiz" ? " iz-kutu-secili" : "")}
                  onClick={() => setAktarSuzgec("hepsi")}
                >
                  <span>Aktarılacak</span>
                  <b style={{ color: "#5f8c10" }}>{temiz.length + uyarili.length}</b>
                </div>
                <div
                  className={"iz-kutu iz-k-turuncu iz-tik" + (aktarSuzgec === "uyari" ? " iz-kutu-secili" : "")}
                  onClick={() => setAktarSuzgec(aktarSuzgec === "uyari" ? "hepsi" : "uyari")}
                >
                  <span>Uyarılı</span>
                  <b style={{ color: "#d48806" }}>{uyarili.length}</b>
                </div>
                <div
                  className={"iz-kutu iz-tik" + (aktarSuzgec === "sorun" ? " iz-kutu-secili" : "")}
                  onClick={() => setAktarSuzgec(aktarSuzgec === "sorun" ? "hepsi" : "sorun")}
                >
                  <span>Atlanacak</span>
                  <b style={{ color: "#cf1322" }}>{sorunlu.length}</b>
                </div>
              </div>

              {bulunamayan > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 10 }}
                  message={`${bulunamayan} kişi Mikro'da bulunamadı`}
                  description="Çizelgedeki TC kimlik ya da sicil numarası Mikro'daki kayıtla eşleşmiyor. Bu satırlar aktarılmaz; çizelgedeki numarayı düzeltip dosyayı yeniden seçin."
                />
              )}

              {uyarili.length > 0 && aktarSuzgec !== "uyari" && (
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                  Uyarılı satırlar yine aktarılır; uyarı, dosyadaki toplamla
                  haftalık sütunların tutmadığını söyler. Doğru olan haftalık
                  sütunlardır — izin kayıtları oradan üretilir.
                </Text>
              )}

              <Tablo
                rowKey={(k: any, i?: number) => `${k.kod}-${i}`}
                size="small"
                dataSource={gosterilen}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                rowClassName={(k: any) =>
                  k.sorun ? "iz-sorunlu" : (k.uyarilar ?? []).length > 0 ? "iz-uyarili" : ""
                }
                expandable={{
                  rowExpandable: (k: any) => (k.izinler ?? []).length > 0,
                  expandedRowRender: (k: any) => (
                    <div style={{ padding: "4px 8px" }}>
                      <Text strong style={{ fontSize: 12.5 }}>
                        Haftalık sütunlardan üretilen izin kayıtları
                      </Text>
                      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {k.izinler.map((i: any, n: number) => (
                          <Tag
                            key={n}
                            color={i.bas.isAfter(dayjs().startOf("day")) ? "purple" : "green"}
                          >
                            {i.bas.format("DD.MM")} – {i.bit.format("DD.MM.YYYY")} · {gun(i.gun)} gün
                            {i.parca > 1 ? ` (${i.parca} hafta birleşti)` : ""}
                          </Tag>
                        ))}
                      </div>
                      {k.dosyaGiris && (
                        <Text type="secondary" style={{ fontSize: 11.5, display: "block", marginTop: 6 }}>
                          Dosyadaki işe giriş: {k.dosyaGiris.format("DD.MM.YYYY")}
                          {Number.isFinite(k.dosyaKidem) ? ` · kıdem ${Math.floor(k.dosyaKidem)} yıl` : ""}
                        </Text>
                      )}
                    </div>
                  ),
                }}
                columns={[
                  {
                    title: "Mağaza",
                    dataIndex: "dosyaSube",
                    width: 120,
                    render: (v: string, k: any) => (
                      <span className="iz-kirp">{k.kisi?.subeAdi || v || "—"}</span>
                    ),
                  },
                  {
                    /* Genişlik verilmek zorunda: ellipsis'li sütunlar tabloyu
                       sabit düzene alıyor, sabit genişliklerin toplamı
                       kabı aşınca genişliği olmayan bu sütun sıfıra
                       iniyordu ve adlar görünmüyordu. */
                    title: "Personel",
                    key: "kisi",
                    width: 240,
                    render: (_v: any, k: any) => (
                      <div style={{ minWidth: 0 }}>
                        <Text strong className="iz-kirp"><PersonelAdi kod={k.kisi?.personelKodu}>{k.kisi?.adSoyad || k.dosyaAdi || "—"}</PersonelAdi></Text>
                        <div style={{ fontSize: 11.5, color: "#8a8f98" }}>
                          {k.kimlik || k.dosyaKod || "—"}
                          {k.kisi && ` · sicil ${k.kisi.personelKodu}`}
                          {k.kisi && k.eslesmeTuru === "sicil" && " · sicille eşleşti"}
                          {k.kisi && k.eslesmeTuru === "ad" && " · adla eşleşti"}
                          {k.kisi && k.eslesmeTuru === "elle" && " · elle seçildi"}
                          {k.kisi && k.kisi.adSoyad !== k.dosyaAdi && k.dosyaAdi
                            ? ` · dosyada: ${k.dosyaAdi}` : ""}
                        </div>
                        {k.kisi?.ayrildi && <Tag color="orange">ayrıldı</Tag>}
                        {(!k.kisi || k.eslesmeTuru === "elle" || /aynı adda|bulunamadı|ayrılmış/.test(k.sorun ?? "")) && (
                          <Select
                            size="small"
                            showSearch
                            allowClear
                            placeholder="Personeli elle seçin"
                            style={{ width: "100%", marginTop: 4 }}
                            optionFilterProp="label"
                            value={k.eslesmeTuru === "elle" ? k.kisi?.personelKodu : undefined}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(kod) => {
                              const havuz = tumPersonel.length > 0 ? tumPersonel : (veri?.kayitlar ?? []);
                              const secilen = havuz.find((x: any) => x.personelKodu === kod);
                              setAktarSatirlar((onceki) =>
                                onceki.map((x) =>
                                  x !== k ? x
                                  : secilen
                                    ? { ...x, kisi: secilen, kod: secilen.personelKodu, eslesmeTuru: "elle", sorun: null }
                                    : { ...x, kisi: undefined, kod: x.dosyaKod, eslesmeTuru: null, sorun: "personel bulunamadı" }
                                )
                              );
                            }}
                            options={(tumPersonel.length > 0 ? tumPersonel : (veri?.kayitlar ?? []))
                              .filter((x: any) => !x.ayrildi)
                              .map((x: any) => ({
                                value: x.personelKodu,
                                label: `${x.adSoyad} · ${x.subeAdi ?? ""} · ${x.personelKodu}`,
                              }))}
                          />
                        )}
                      </div>
                    ),
                  },
                  {
                    title: "Hak ediş",
                    dataIndex: "hakedilen",
                    width: 80,
                    align: "right" as const,
                    render: (v: number) => gun(v),
                  },
                  {
                    title: "Devir",
                    dataIndex: "devir",
                    width: 70,
                    align: "right" as const,
                    render: (v: number) =>
                      v > 0 ? <span style={{ color: "#722ed1" }}>{gun(v)}</span> : "—",
                  },
                  {
                    title: "Kullanılan",
                    dataIndex: "kullanilan",
                    width: 90,
                    align: "right" as const,
                    render: (v: number) => (v > 0 ? gun(v) : "—"),
                  },
                  {
                    title: "Planlı",
                    dataIndex: "planli",
                    width: 80,
                    align: "right" as const,
                    render: (v: number) =>
                      v > 0 ? (
                        <Tooltip title="Bugünden sonraki haftalara yazılmış gün">
                          <span style={{ color: "#722ed1" }}>{gun(v)}</span>
                        </Tooltip>
                      ) : "—",
                  },
                  {
                    title: "Kalan",
                    key: "kalan",
                    width: 110,
                    align: "right" as const,
                    render: (_v: any, k: any) => (
                      <div>
                        <b style={{ color: k.kalan < 0 ? "#cf1322" : "#5f8c10" }}>{gun(k.kalan)}</b>
                        {Number.isFinite(k.dosyaKalan) && k.dosyaKalan !== k.kalan && (
                          <div style={{ fontSize: 11, color: "#d48806" }}>
                            dosyada {gun(k.dosyaKalan)}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: "İzin",
                    key: "izin",
                    width: 60,
                    align: "right" as const,
                    render: (_v: any, k: any) =>
                      (k.izinler ?? []).length > 0 ? (
                        <Tooltip title="Üretilecek izin kaydı sayısı; satırı açınca tarihler görünür">
                          <span>{k.izinler.length}</span>
                        </Tooltip>
                      ) : (
                        <Text type="secondary">—</Text>
                      ),
                  },
                  {
                    title: "Durum",
                    key: "durum",
                    width: 190,
                    render: (_v: any, k: any) =>
                      k.sorun ? (
                        <Tag color="red">{k.sorun}</Tag>
                      ) : (k.uyarilar ?? []).length > 0 ? (
                        <Tooltip title={k.uyarilar.join(" · ")}>
                          <Tag color="orange">uyarı · {k.uyarilar.length}</Tag>
                        </Tooltip>
                      ) : (
                        <Tag color="green">eşleşti</Tag>
                      ),
                  },
                ]}
              />
            </>
          );
        })()}
      </Modal>

      {/* ------------------------------------------------ izin kaydı */}
      <Modal
        open={!!izinKisi}
        onCancel={() => setIzinKisi(null)}
        onOk={izinKaydet}
        okText="Kaydet"
        cancelText="Vazgeç"
        confirmLoading={izinKaydediliyor}
        width={620}
        title="Yeni İzin Kaydı"
        className="iz-bolum"
      >
        {/* --------------------------------------------- kişi künyesi */}
        {izinKisi && (
          <div className="iz-kisi">
            <Avatar
              size={48}
              src={api.resimAdresi(izinKisi.personelKodu)}
              style={{
                background: "var(--yesil-acik)",
                color: "var(--yesil-koyu)",
                fontWeight: 700,
                flex: "0 0 auto",
              }}
            >
              {String(izinKisi.adSoyad ?? "")
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((x: string) => x[0])
                .join("")}
            </Avatar>

            <div className="iz-kisi-govde">
              <p className="iz-kisi-ad"><PersonelAdi kod={izinKisi.personelKodu}>{izinKisi.adSoyad}</PersonelAdi></p>
              <Space size={6} wrap style={{ marginBottom: 4 }}>
                {izinKisi.gorev && <Tag color="green">{izinKisi.gorev}</Tag>}
                {izinKisi.subeAdi && <Tag>{izinKisi.subeAdi}</Tag>}
              </Space>
              <div className="iz-kisi-meta">
                <span>Sicil {izinKisi.personelKodu}</span>
                {izinKisi.girisTarihi && (
                  <span>
                    İşe giriş {dayjs(izinKisi.girisTarihi).format("DD.MM.YYYY")}
                  </span>
                )}
                {esasTarih(izinKisi) && (
                  <span>Kıdem {kidemMetni(esasTarih(izinKisi))}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --------------------------------------------- hak ediş kutuları */}
        {izinKisi && (
          <div className="iz-kutular">
            <div className="iz-kutu">
              <span>Hak Edilen</span>
              <b>{gun(izinKisi.hakedilen)}</b>
            </div>
            <div className="iz-kutu iz-k-mor">
              <span>Devir</span>
              <b style={{ color: "#722ed1" }}>{gun(izinKisi.devir)}</b>
            </div>
            <div className="iz-kutu">
              <span>Kullanılan</span>
              <b>{gun(izinKisi.kullanilan)}</b>
            </div>
            <div className="iz-kutu iz-k-mavi">
              <span>Planlı</span>
              <b style={{ color: "#1a4d80" }}>{gun(izinKisi.planli)}</b>
            </div>
            <div className="iz-kutu iz-k-turuncu">
              <span>Kalan</span>
              <b
                style={{
                  color:
                    (izinKisi.kalan ?? 0) <= 0 ? "#cf1322"
                    : (izinKisi.kalan ?? 0) <= 3 ? "#d46b08"
                    : "#5f8c10",
                }}
              >
                {gun(izinKisi.kalan)}
              </b>
            </div>
            <div className="iz-kutu">
              <span>Bu izin</span>
              <b style={{ color: "#5f8c10" }}>
                {gunHesaplaniyor ? "…" : gun(izinGun)}
              </b>
            </div>
          </div>
        )}

        {/* Düşülmeyen günler: sayının neden takvim farkından küçük olduğu
            görünmezse kullanıcı hesabı yanlış sanıyordu. */}
        {dusulmeyenler.length > 0 && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${dusulmeyenler.length} gün hak edişten düşülmedi`}
            description={
              <div style={{ fontSize: 12.5, maxHeight: 120, overflowY: "auto" }}>
                {dusulmeyenler.map((x) => (
                  <div key={x}>{x}</div>
                ))}
              </div>
            }
          />
        )}

        {gunNotlari.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Cumartesi kuralı"
            description={
              <div style={{ fontSize: 12.5 }}>
                {gunNotlari.map((x) => (
                  <div key={x}>{x}</div>
                ))}
              </div>
            }
          />
        )}

        <Row gutter={[10, 10]}>
          <Col xs={24} md={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              İzin türü
            </Text>
            <Select
              style={{ width: "100%" }}
              value={izinTur}
              onChange={setIzinTur}
              options={TURLER.map((t) => ({ value: t, label: t }))}
            />
          </Col>

          {/* Saatlik izinde tam/yarım gün seçimi anlamsız */}
          {izinTur !== "Saatlik İzin" && (
            <Col xs={24} md={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Süre
              </Text>
              <Select
                style={{ width: "100%" }}
                value={izinSure}
                onChange={(v) => setIzinSure(v)}
                options={[
                  { value: "tam", label: "Tam gün" },
                  { value: "once", label: "Yarım gün · öğleden önce" },
                  { value: "sonra", label: "Yarım gün · öğleden sonra" },
                ]}
              />
            </Col>
          )}

          {izinTur === "Saatlik İzin" && (
            <>
              <Col xs={12} md={6}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Çıkış saati
                </Text>
                <Input
                  type="time"
                  value={izinBasSaat}
                  onChange={(e) => setIzinBasSaat(e.target.value)}
                />
              </Col>

              <Col xs={12} md={6}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Dönüş saati
                </Text>
                <Input
                  type="time"
                  value={izinBitSaat}
                  onChange={(e) => setIzinBitSaat(e.target.value)}
                />
              </Col>
            </>
          )}

          <Col xs={12} md={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              İzine çıkış
            </Text>
            <DatePicker
              style={{ width: "100%" }}
              format="DD.MM.YYYY"
              value={izinCikis}
              onChange={setIzinCikis}
            />
          </Col>

          <Col xs={12} md={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              İzinden dönüş
            </Text>
            <DatePicker
              style={{ width: "100%" }}
              format="DD.MM.YYYY"
              value={izinDonus}
              disabled={izinSure !== "tam" || izinTur === "Saatlik İzin"}
              onChange={setIzinDonus}
            />
          </Col>

          <Col xs={12} md={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              İşe başlama
            </Text>
            <DatePicker
              style={{ width: "100%" }}
              format="DD.MM.YYYY"
              value={izinBaslama}
              onChange={setIzinBaslama}
            />
          </Col>

          {izinTur !== "Saatlik İzin" && (
          <Col xs={12} md={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              İzin günü
            </Text>
            <InputNumber
              style={{ width: "100%" }}
              min={0.5}
              step={0.5}
              value={izinGun}
              onChange={(v) => setIzinGun(Number(v) || 0.5)}
            />
          </Col>
          )}

          <Col xs={24} md={16}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Açıklama
            </Text>
            <Input
              value={izinNot}
              onChange={(e) => setIzinNot(e.target.value)}
              placeholder="İsteğe bağlı"
            />
          </Col>
        </Row>

        {/* ------------------------------------------- takvim şeridi */}
        {izinCikis && izinDonus && (
          <div style={{ marginTop: 14 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {izinCikis.format("MMMM YYYY")}
            </Text>

            {(() => {
              /* Ayın günleri; izin aralığı yeşil, pazarlar gri. Seçilen
                 tarihlerin takvimde nereye denk geldiğini görmek,
                 yanlış tarih girişini önlüyor. */
              const ayBasi = izinCikis.startOf("month");
              const gunSayisi = ayBasi.daysInMonth();

              return (
                <>
                  <div className="iz-serit">
                    {Array.from({ length: gunSayisi }, (_v, i) => {
                      const g = ayBasi.add(i, "day");

                      const izinli =
                        !g.isBefore(izinCikis, "day") &&
                        !g.isAfter(izinDonus, "day");

                      return (
                        <i
                          key={i}
                          className={
                            izinli ? "iz-izinli"
                            : g.day() === 0 ? "iz-hafta"
                            : undefined
                          }
                        />
                      );
                    })}
                  </div>

                  <div className="iz-serit-gun">
                    {Array.from({ length: gunSayisi }, (_v, i) => (
                      <span key={i}>{i + 1}</span>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {izinTur === "Yıllık İzin" && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: izinDussun ? "#f2f9e8" : "#fff8e6",
              border: `1px solid ${izinDussun ? "#d9ecbc" : "#f1d9a6"}`,
            }}
          >
            <Checkbox checked={izinDussun} onChange={(e) => setIzinDussun(e.target.checked)}>
              <b>Kalan izinden düşülsün</b>
            </Checkbox>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, marginLeft: 24 }}>
              {bakiyeOncesi
                ? `Bu izin, hak edişin girildiği ${dayjs(izinKisi.bakiyeTarihi).format("DD.MM.YYYY")} tarihinden önce. Aktarılan kalan izne zaten dahilse işaretlemeyin; kayıt geçmişte görünür, kalan gün değişmez.`
                : izinDussun
                ? "İzin günü kalan yıllık izinden düşülecek."
                : "Kayıt geçmişte görünür ama kalan izin değişmez."}
            </div>
          </div>
        )}

        {izinTur === "Saatlik İzin" && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message={`${saatFarki} saat izin`}
            description="Saatlik izin yıllık izin hak edişinden düşmez; yalnızca kayda geçer."
          />
        )}

        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
          Gün sayısı tarih farkından önerilir; hafta tatili ve resmî tatiller
          düşülmez. Yarım gün kullanımında ya da tatile denk gelen izinlerde
          sayıyı elle değiştirebilirsiniz.
        </Paragraph>

        {cakisma.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`Aynı şubede ${cakisma.length} kişi daha izinde olacak`}
            description={
              <div style={{ fontSize: 12.5 }}>
                {cakisma.slice(0, 5).map((c: any, i: number) => (
                  <div key={i}>
                    {c.adSoyad} · {c.gorev} ·{" "}
                    {dayjs(c.cikisTarihi).format("DD.MM")} –{" "}
                    {dayjs(c.donusTarihi).format("DD.MM")}
                  </div>
                ))}
                {cakisma.length > 5 && <div>+{cakisma.length - 5} kişi daha</div>}
              </div>
            }
          />
        )}
      </Modal>
    </div>
  );
}
