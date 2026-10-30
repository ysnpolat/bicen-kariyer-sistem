/**
 * ---------------------------------------------------------------------------
 * Yıllık İzin Ücretleri
 * ---------------------------------------------------------------------------
 * Çalışan her personel bugün ayrılsa kullanmadığı yıllık izin için ne
 * kadar ödenir: şirketin izin yükümlülüğü (03.10.2026).
 *
 *   günlük  = net maaş ÷ 30
 *   tutar   = günlük × kalan izin günü
 *   örnek   = 53.000 ÷ 30 = 1.766,67 TL · 1.766,67 × 10 = 17.666,67 TL
 *
 * Net maaş Mikro bordrosundan (içinde bulunulan aya kadarki son tahakkuk,
 * ücret pusulasındaki "Net ödenecek"), gün Yıllık İzin bakiyesinden gelir;
 * hesap sunucuda (api/IzinUcreti). Yuvarlama yalnızca gösterimde; toplamlar
 * yuvarlanmamış tutarlardan.
 *
 * Ücret verisi: YALNIZCA Yönetici rolü görür. Menüde Rol Yetkileri ile
 * başka role açılamaz (App.tsx YALNIZ_YONETICI), sunucu da 403 döner.
 *
 * Görünüm Personeller / Başvurular / İzin Talepleri ile aynı dil; sınıflar
 * "iu-" önekli (IzinUcretleri.css).
 * ---------------------------------------------------------------------------
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Empty, Input, Select, Spin, Table, Tooltip } from "antd";
import type { ColumnsType, SortOrder } from "antd/es/table/interface";
import {
  AlertTriangle,
  Award,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Hourglass,
  Lock,
  RefreshCw,
  Search,
  Store,
  UserX,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { api } from "./api";
import { tabloIndir } from "./raporExcel";
import "./IzinUcretleri.css";

/* ------------------------------------------------------------------ tipler */

type Durum = "tamam" | "bakiyeYok" | "maasYok" | "eksiBakiye";
type Uyari = "bakiyeYok" | "maasYok" | "eksiBakiye";

interface Donem {
  yil: number;
  ay: number;
}

interface Kayit {
  kod: string;
  ad: string;
  sube: string;
  pozisyon: string | null;
  girisTarihi: string | null;
  hakedisEsas: string | null;
  kidemGun: number | null;
  /** Tamamlanmış kıdem yılı (önceki dönemler dahil) */
  kidemYil: number;
  /** Yıllık hak (İş Kanunu md. 53): 1–5 yıl 14, 6–14 yıl 20, 15+ yıl 26 gün; 18 altı / 50 ve üstü en az 20 */
  yillikHak: number;
  yas?: number | null;
  /** Hak yaş istisnasıyla 20 güne çıktı */
  yasIstisnasi?: boolean;
  genelMerkez: boolean;
  /** Maaş kaynağı: personel kartı ücreti ya da son bordro neti */
  maasKaynak: "kart" | "bordro" | null;
  kartUcretiYok: boolean;
  ayrilacak: boolean;
  cikisTarihi: string | null;
  netMaas: number | null;
  maasDonemi: Donem | null;
  maasEslesme: "kod" | "tc" | null;
  gunluk: number | null;
  hakedilen: number | null;
  devir: number;
  kullanilan: number;
  planli: number;
  kalanGun: number | null;
  odenecekGun: number | null;
  tutar: number | null;
  /** Brüt karşılık (İş Kanunu md. 59): son bordronun temel kazancından */
  brutMaas: number | null;
  brutGunluk: number | null;
  brutTutar: number | null;
  bakiyeVar: boolean;
  maasVar: boolean;
  eksiBakiye: boolean;
  durum: Durum;
}

/** 1 yılı dolmamış personel: listede yok, yıl dolum tarihiyle ayrı kartta */
interface YeniPersonel {
  kod: string;
  ad: string;
  sube: string;
  pozisyon: string | null;
  kidemTarihi: string | null;
  kidemGun: number;
  yilDolum: string;
  kalanGun: number;
}

type KidemGrubu = "yeni" | "1_5" | "6_14" | "15";

interface SubeOzeti {
  sube: string;
  kisi: number;
  gun: number;
  tutar: number;
  brutTutar: number;
}

interface Cevap {
  donem: Donem;
  hesapTarihi: string;
  ayGunu: number;
  kayitlar: Kayit[];
  yeniler: YeniPersonel[];
  kurallar: { hak1_5: number; hak6_14: number; hak15: number; yasIstisna: number };
  ozet: {
    toplamTutar: number;
    toplamBrutTutar: number;
    brutYok: number;
    kisi: number;
    odenecekKisi: number;
    toplamGun: number;
    ortalamaGun: number;
    bakiyeYok: number;
    maasYok: number;
    eksiBakiye: number;
    hesaplanamayan: number;
    kartUcretiYok: number;
    kidem: {
      yeni: number;
      yeniBuAy: number;
      yil1_5: number;
      yil6_14: number;
      yil15: number;
      gun1_5: number;
      gun6_14: number;
      gun15: number;
      tutar1_5: number;
      tutar6_14: number;
      tutar15: number;
      yasIstisnasi: number;
    };
    subeler: SubeOzeti[];
  };
  uyarilar?: string[];
}

type SiralamaAlani = "ad" | "sube" | "kidem" | "net" | "gunluk" | "gun" | "tutar";

/* ------------------------------------------------------------ biçimleme */

const AY_ADLARI = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/** 1.766,67 — her zaman iki ondalık */
const para = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 53.000 ya da 53.120,50 — tam sayıda ondalık yazılmaz (kullanıcının yazımı) */
const paraSade = (n: number) =>
  Math.abs(n - Math.round(n)) < 0.005
    ? Math.round(n).toLocaleString("tr-TR")
    : para(n);

/** 10 ya da 10,5 */
const gunYaz = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

/** Büyük tutarlar KPI'da: 1.234.568 TL (kuruş tabloda) */
const tlKisa = (n: number) =>
  n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

const donemAdi = (d: Donem | null | undefined) =>
  d ? `${AY_ADLARI[d.ay - 1] ?? d.ay} ${d.yil}` : "—";

const donemKisa = (d: Donem | null | undefined) =>
  d ? `${(AY_ADLARI[d.ay - 1] ?? String(d.ay)).slice(0, 3)} ${d.yil}` : "—";

const tarihYaz = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("tr-TR");
};

/** Kıdem: esas tarihten bugüne "3 yıl 4 ay" */
const kidemYaz = (esas: string | null, gun: number | null) => {
  if (!esas || gun == null) return "—";
  const b = new Date(esas);
  if (Number.isNaN(b.getTime())) return "—";

  const s = new Date();
  let ay = (s.getFullYear() - b.getFullYear()) * 12 + (s.getMonth() - b.getMonth());
  if (s.getDate() < b.getDate()) ay--;
  if (ay < 1) return `${gun} gün`;

  const yil = Math.floor(ay / 12);
  const kalanAy = ay % 12;

  return [yil > 0 ? `${yil} yıl` : "", kalanAy > 0 ? `${kalanAy} ay` : ""].filter(Boolean).join(" ");
};

/** Türkçe büyük/küçük harf duyarsız arama */
const sade = (s: string | null | undefined) => (s ?? "").toLocaleLowerCase("tr-TR");

const basHarfler = (ad: string) =>
  ad
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toLocaleUpperCase("tr-TR"))
    .join("");

/** Kişiye göre sabit avatar rengi */
const AVATAR = [
  ["#eef6e1", "#3f6507"], ["#e9f0f8", "#1f4f84"], ["#fff0ea", "#a33410"],
  ["#f1ecfb", "#6d4bc2"], ["#fff6dc", "#7a5300"], ["#e3f4f1", "#0f766e"],
];
const avatarRengi = (kod: string) => {
  let h = 0;
  for (const c of kod) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
};

/** Ekranla aynı yuvarlama: gösterilen 1.766,67 × 10 hesabı göze uysun */

/* Dar ekran: tablo yerine kart listesi */
const useDarEkran = (sinir = 640) => {
  const sorgu = `(max-width: ${sinir}px)`;
  const [dar, setDar] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(sorgu).matches : false
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(sorgu);
    const dinle = () => setDar(m.matches);
    dinle();
    m.addEventListener?.("change", dinle);
    return () => m.removeEventListener?.("change", dinle);
  }, [sorgu]);

  return dar;
};

/* ================================================================ sayfa */

export default function IzinUcretleri() {
  const [veri, setVeri] = useState<Cevap | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);

  const [arama, setArama] = useState("");
  const [sube, setSube] = useState<string | undefined>();
  const [yalnizOdenecek, setYalnizOdenecek] = useState(false);
  const [uyari, setUyari] = useState<Uyari | null>(null);
  const [tumSubeler, setTumSubeler] = useState(false);
  const [kidemGrup, setKidemGrup] = useState<KidemGrubu | null>(null);

  const [siralama, setSiralama] = useState<{ alan: SiralamaAlani; yon: "artan" | "azalan" }>({
    alan: "tutar",
    yon: "azalan",
  });

  const [acikSatirlar, setAcikSatirlar] = useState<string[]>([]);
  const [kartSiniri, setKartSiniri] = useState(30);

  const dar = useDarEkran();

  const getir = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);

    try {
      setVeri(await api.al<Cevap>("/api/IzinUcreti"));
    } catch (e: any) {
      setHata(e?.message ?? "İzin ücretleri alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const kayitlar = veri?.kayitlar ?? [];
  const ozet = veri?.ozet;
  const donem = veri?.donem;

  /* ------------------------------------------------------------ süzgeç */
  const suzulen = useMemo(() => {
    const a = sade(arama.trim());

    const liste = kayitlar.filter((k) => {
      if (sube && k.sube !== sube) return false;
      if (yalnizOdenecek && !(k.tutar != null && k.tutar > 0)) return false;
      if (uyari === "bakiyeYok" && k.bakiyeVar) return false;
      if (uyari === "maasYok" && k.maasVar) return false;
      if (uyari === "eksiBakiye" && !k.eksiBakiye) return false;
      if (kidemGrup === "1_5" && !(k.kidemYil >= 1 && k.kidemYil <= 5)) return false;
      if (kidemGrup === "6_14" && !(k.kidemYil >= 6 && k.kidemYil < 15)) return false;
      if (kidemGrup === "15" && !(k.kidemYil >= 15)) return false;

      if (a) {
        const metin = sade(`${k.ad} ${k.kod} ${k.sube} ${k.pozisyon ?? ""}`);
        if (!metin.includes(a)) return false;
      }

      return true;
    });

    /* Boş değerler yöne bakılmadan sona: "maaş bulunamadı" satırları
       en yüksek tutarların arasına karışmasın */
    const deger = (k: Kayit): number | string | null => {
      switch (siralama.alan) {
        case "ad": return sade(k.ad);
        case "sube": return sade(`${k.sube} ${k.pozisyon ?? ""}`);
        case "kidem": return k.kidemGun;
        case "net": return k.netMaas;
        case "gunluk": return k.gunluk;
        case "gun": return k.kalanGun;
        case "tutar": return k.tutar;
      }
    };

    const carpan = siralama.yon === "artan" ? 1 : -1;

    return [...liste].sort((x, y) => {
      const a1 = deger(x);
      const b1 = deger(y);

      if (a1 == null && b1 == null) return x.ad.localeCompare(y.ad, "tr");
      if (a1 == null) return 1;
      if (b1 == null) return -1;

      const fark =
        typeof a1 === "string"
          ? a1.localeCompare(String(b1), "tr")
          : (a1 as number) - (b1 as number);

      return fark !== 0 ? fark * carpan : x.ad.localeCompare(y.ad, "tr");
    });
  }, [kayitlar, arama, sube, yalnizOdenecek, uyari, siralama, kidemGrup]);

  /* Süzgeç değişince kart listesi baştan */
  useEffect(() => setKartSiniri(30), [arama, sube, yalnizOdenecek, uyari, siralama, kidemGrup]);

  /* 1 yılı dolmamışlar: şube ve arama süzgeci onlara da uygulanıyor */
  const yeniler = useMemo(() => {
    const a = sade(arama.trim());

    return (veri?.yeniler ?? []).filter(
      (y) =>
        (!sube || y.sube === sube) &&
        (!a || sade(`${y.ad} ${y.kod} ${y.sube} ${y.pozisyon ?? ""}`).includes(a))
    );
  }, [veri, sube, arama]);

  const suzulenToplam = useMemo(
    () => suzulen.reduce((t, k) => t + (k.tutar ?? 0), 0),
    [suzulen]
  );
  const suzulenGun = useMemo(
    () => suzulen.reduce((t, k) => t + (k.odenecekGun ?? 0), 0),
    [suzulen]
  );

  const subeSecenekleri = useMemo(
    () =>
      [...new Set(kayitlar.map((k) => k.sube))]
        .sort((a, b) => a.localeCompare(b, "tr"))
        .map((s) => ({ value: s, label: s })),
    [kayitlar]
  );

  const filtreVar = !!(arama || sube || yalnizOdenecek || uyari || kidemGrup);

  const temizle = () => {
    setArama("");
    setSube(undefined);
    setYalnizOdenecek(false);
    setUyari(null);
    setKidemGrup(null);
  };

  /* Maaş dönemi bu aydan iki ay ya da daha eski: muhtemelen bordrosu
     kesilmiş (ücretsiz izin, rapor) — rakam güncel olmayabilir. */
  const eskiDonem = (d: Donem | null) =>
    !!(d && donem && donem.yil * 12 + donem.ay - (d.yil * 12 + d.ay) >= 2);

  /* ------------------------------------------------------------- Excel */
  const excel = () => {
    if (!veri) return;

    const altParcalar = [
      `${suzulen.length} kişi`,
      `Hesap: ${new Date(veri.hesapTarihi).toLocaleString("tr-TR")}`,
      `Maaş: genel merkez ${donemAdi(veri.donem)} ve öncesindeki son bordro, diğer birimler personel kartı ücreti`,
      "1 yılı dolmamış personel listede yok",
      "Günlük = net ÷ 30 · Tutar = günlük × kalan gün · Brüt = son bordro temel kazancı ÷ kazanç günü × kalan gün",
    ];
    if (sube) altParcalar.push(`Şube: ${sube}`);
    if (arama) altParcalar.push(`Arama: "${arama}"`);

    const durumAdi: Record<Durum, string> = {
      tamam: "",
      bakiyeYok: "Hak ediş girilmemiş",
      maasYok: "Maaş bulunamadı",
      eksiBakiye: "Eksi bakiye",
    };

    tabloIndir({
      baslik: "Yıllık İzin Ücretleri",
      altBaslik: altParcalar.join(" · "),
      sayfaAdi: "İzin Ücretleri",
      dosyaAdi: "yillik-izin-ucretleri",
      grupSutunu: 0,
      genelToplam: true,
      sutunlar: [
        { ad: "ŞUBE", genislik: 24 },
        { ad: "SİCİL", genislik: 10 },
        { ad: "AD SOYAD", genislik: 26 },
        { ad: "ÜNVAN", genislik: 22 },
        { ad: "KIDEM ESAS", tip: "tarih" },
        { ad: "KIDEM (GÜN)", tip: "sayi", toplam: false },
        { ad: "KIDEM (YIL)", tip: "sayi", toplam: false },
        { ad: "YILLIK HAK", tip: "sayi", toplam: false },
        { ad: "MAAŞ KAYNAĞI", genislik: 16 },
        { ad: "NET MAAŞ", tip: "para", genislik: 14, toplam: false },
        { ad: "MAAŞ DÖNEMİ", genislik: 13 },
        { ad: "GÜNLÜK (NET÷30)", tip: "para", genislik: 14, toplam: false },
        { ad: "HAK EDİLEN", tip: "ondalik" },
        { ad: "DEVİR", tip: "ondalik" },
        { ad: "KULLANILAN", tip: "ondalik" },
        { ad: "PLANLI", tip: "ondalik" },
        { ad: "ÖDENECEK GÜN", tip: "ondalik" },
        { ad: "ÖDENECEK TUTAR (NET)", tip: "para", genislik: 16, veriCubugu: true },
        { ad: "BRÜT MAAŞ", tip: "para", genislik: 14, toplam: false },
        { ad: "BRÜT GÜNLÜK", tip: "para", genislik: 14, toplam: false },
        { ad: "ÖDENECEK TUTAR (BRÜT)", tip: "para", genislik: 18 },
        { ad: "DURUM", genislik: 18 },
      ],
      satirlar: suzulen.map((k) => [
        k.sube,
        k.kod,
        k.ad,
        k.pozisyon ?? "",
        k.hakedisEsas,
        k.kidemGun,
        k.kidemYil,
        k.yillikHak,
        k.maasKaynak === "kart" ? "Personel kartı" : k.maasKaynak === "bordro" ? "Bordro" : "",
        k.netMaas,
        k.maasDonemi ? `${String(k.maasDonemi.ay).padStart(2, "0")}.${k.maasDonemi.yil}` : "",
        k.gunluk,
        k.hakedilen,
        k.bakiyeVar ? k.devir : null,
        k.bakiyeVar ? k.kullanilan : null,
        k.planli,
        k.odenecekGun,
        k.tutar,
        k.brutMaas,
        k.brutGunluk,
        k.brutTutar,
        durumAdi[k.durum],
      ]),
    }).catch(() => undefined);
  };

  /* --------------------------------------------------- hesap adımları */
  const hesapAdimlari = (k: Kayit): ReactNode => {
    const gunluk = k.gunluk;

    return (
      <div className="iu-adimlar">
        <div className="iu-adim">
          <span className="iu-adim-no">1</span>
          <div>
            <b>Net maaş</b>
            {k.maasKaynak === "kart" ? (
              <p>
                <span className="iu-kod">{para(k.netMaas)} TL</span> · personel kartındaki ücret (genel merkez
                dışı birimlerde esas)
              </p>
            ) : k.netMaas != null ? (
              <p>
                <span className="iu-kod">{para(k.netMaas)} TL</span> · {donemAdi(k.maasDonemi)} bordrosu
                (ücret pusulasındaki Net ödenecek)
                {k.maasEslesme === "tc" && " · sicil kodu tutmadığı için T.C. kimlik no ile eşleşti"}
                {k.genelMerkez ? " · genel merkez: bordro esas" : k.kartUcretiYok ? (
                  <span className="iu-uyari-yazi"> · personel kartında ücret yok, bordro kullanıldı</span>
                ) : null}
                {eskiDonem(k.maasDonemi) && (
                  <span className="iu-uyari-yazi"> · son bordro {donemAdi(k.maasDonemi)}, güncel olmayabilir</span>
                )}
              </p>
            ) : (
              <p className="iu-uyari-yazi">
                {donemAdi(donem)} ya da önceki aylarda bu personel için tahakkuk bulunamadı.
              </p>
            )}
          </div>
        </div>

        <div className="iu-adim">
          <span className="iu-adim-no">2</span>
          <div>
            <b>Günlük ücret</b>
            {k.netMaas != null && gunluk != null ? (
              <p>
                <span className="iu-kod">
                  {paraSade(k.netMaas)} ÷ 30 = {para(gunluk)} TL
                </span>
              </p>
            ) : (
              <p className="iu-soluk">Net maaş olmadan hesaplanamaz.</p>
            )}
          </div>
        </div>

        <div className="iu-adim">
          <span className="iu-adim-no">3</span>
          <div>
            <b>Kalan izin günü</b>
            {k.bakiyeVar ? (
              <p>
                <span className="iu-kod">
                  hak edilen {gunYaz(k.hakedilen)} + devir {gunYaz(k.devir)} − kullanılan{" "}
                  {gunYaz(k.kullanilan)} = {gunYaz(k.kalanGun)} gün
                </span>{" "}
                · kıdem {k.kidemYil} yıl, yıllık hak {k.yillikHak} gün
                {k.yasIstisnasi ? ` (yaş ${k.yas} · en az 20 gün)` : ""}
                {k.planli > 0 && (
                  <> · planlı {gunYaz(k.planli)} gün henüz kullanılmadığı için düşülmedi</>
                )}
                {k.eksiBakiye && (
                  <span className="iu-kirmizi-yazi"> · eksi bakiye: ödenecek gün 0 sayıldı</span>
                )}
              </p>
            ) : (
              <p className="iu-uyari-yazi">
                İzin hak edişi girilmemiş. İzin Yönetimi ekranından hak ediş girilince hesaplanır.
              </p>
            )}
          </div>
        </div>

        <div className="iu-adim iu-adim-son">
          <span className="iu-adim-no">=</span>
          <div>
            <b>Ödenecek tutar</b>
            {k.tutar != null ? (
              <p>
                <span className="iu-kod">
                  {gunluk != null
                    ? `${para(gunluk)} × ${gunYaz(k.odenecekGun)} = ${para(k.tutar)} TL`
                    : `${gunYaz(k.odenecekGun)} gün = ${para(k.tutar)} TL`}
                </span>
              </p>
            ) : (
              <p className="iu-soluk">Hesaplanamadı.</p>
            )}
          </div>
        </div>

        <div className="iu-adim iu-adim-brut">
          <span className="iu-adim-no">B</span>
          <div>
            <b>Brüt karşılık</b>
            {k.brutTutar != null && k.brutGunluk != null ? (
              <p>
                <span className="iu-kod">
                  {para(k.brutGunluk)} × {gunYaz(k.odenecekGun)} = {para(k.brutTutar)} TL
                </span>{" "}
                · aylık brüt {para(k.brutMaas)} TL ({donemAdi(k.maasDonemi)} bordrosunun temel kazancı;
                fazla mesai ve sosyal yardımlar hariç). İş Kanunu'na göre izin ücreti son brüt ücretten ödenir.
              </p>
            ) : (
              <p className="iu-soluk">
                {k.tutar == null ? "Hesaplanamadı." : "Bordroda brüt kazanç kalemi bulunamadı."}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------ tablo hücreleri */
  const kisiHucresi = (k: Kayit) => {
    const [zemin, yazi] = avatarRengi(k.kod);

    return (
      <div className="iu-kisi">
        <span className="iu-av" style={{ background: zemin, color: yazi }}>
          {basHarfler(k.ad)}
        </span>
        <div className="iu-kisi-metin">
          <b title={k.ad}>{k.ad}</b>
          <small>
            {k.kod}
            {k.ayrilacak && (
              <Tooltip title={`Çıkış tarihi: ${tarihYaz(k.cikisTarihi)}`}>
                <span className="iu-e iu-e-turuncu iu-e-mini">ayrılacak</span>
              </Tooltip>
            )}
          </small>
        </div>
      </div>
    );
  };

  const gunHucresi = (k: Kayit) => {
    if (!k.bakiyeVar)
      return <span className="iu-e iu-e-sari">hak ediş girilmemiş</span>;

    /* "20/15": toplam hak (hak edilen + devir) / kalan; altında kullanılan */
    const toplamHak = (k.hakedilen ?? 0) + (k.devir ?? 0);

    return (
      <div className="iu-gun">
        <b className={k.eksiBakiye ? "iu-kirmizi-yazi" : undefined}>
          <span className="iu-gun-hak">{gunYaz(toplamHak)}</span>
          <span className="iu-gun-bolu">/</span>
          {k.eksiBakiye ? `${gunYaz(k.kalanGun)} → 0` : gunYaz(k.odenecekGun)}
        </b>
        <small>
          {k.eksiBakiye
            ? "eksi bakiye"
            : `kalan · ${gunYaz(k.kullanilan)} kullanıldı${k.planli > 0 ? ` · planlı ${gunYaz(k.planli)}` : ""}`}
        </small>
      </div>
    );
  };

  const tutarHucresi = (k: Kayit) => {
    if (k.tutar == null)
      return k.durum === "maasYok" ? (
        <span className="iu-e iu-e-kirmizi">maaş bulunamadı</span>
      ) : (
        <span className="iu-soluk">—</span>
      );

    return (
      <div className="iu-iki iu-sag">
        <span className={`iu-tutar${k.tutar === 0 ? " iu-sifir" : ""}`}>
          {para(k.tutar)} <i>TL</i>
        </span>
        <small className="iu-brut">
          {k.brutTutar != null ? <>brüt {para(k.brutTutar)} TL</> : "brüt —"}
        </small>
      </div>
    );
  };

  const sutunSirasi = (alan: SiralamaAlani): SortOrder =>
    siralama.alan === alan ? (siralama.yon === "artan" ? "ascend" : "descend") : null;

  const sutunlar: ColumnsType<Kayit> = [
    {
      key: "ad",
      title: "Personel",
      sorter: true,
      sortOrder: sutunSirasi("ad"),
      width: 240,
      render: (_, k) => kisiHucresi(k),
    },
    {
      key: "sube",
      title: "Şube · Ünvan",
      sorter: true,
      sortOrder: sutunSirasi("sube"),
      width: 210,
      render: (_, k) => (
        <div className="iu-iki">
          <b>{k.sube}</b>
          <small>{k.pozisyon ?? "—"}</small>
        </div>
      ),
    },
    {
      key: "kidem",
      title: "Kıdem",
      sorter: true,
      sortOrder: sutunSirasi("kidem"),
      width: 130,
      render: (_, k) => (
        <div className="iu-iki">
          <b>{k.kidemYil} yıl</b>
          <small>
            {k.yillikHak} gün hak · {tarihYaz(k.hakedisEsas)}
          </small>
        </div>
      ),
    },
    {
      key: "net",
      title: "Net maaş",
      sorter: true,
      sortOrder: sutunSirasi("net"),
      align: "right",
      width: 140,
      render: (_, k) =>
        k.netMaas == null ? (
          <span className="iu-soluk">—</span>
        ) : (
          <div className="iu-iki iu-sag">
            <b className="iu-rakam">{para(k.netMaas)}</b>
            <small className={k.maasKaynak === "bordro" && eskiDonem(k.maasDonemi) ? "iu-uyari-yazi" : undefined}>
              {k.maasKaynak === "kart" ? "personel kartı" : `bordro · ${donemKisa(k.maasDonemi)}`}
              {k.maasEslesme === "tc" && (
                <Tooltip title="Sicil kodu bordroda tutmadı; T.C. kimlik no ile eşleşti">
                  <span className="iu-tc">TC</span>
                </Tooltip>
              )}
            </small>
          </div>
        ),
    },
    {
      key: "gunluk",
      title: "Günlük",
      sorter: true,
      sortOrder: sutunSirasi("gunluk"),
      align: "right",
      width: 110,
      render: (_, k) =>
        k.gunluk == null ? <span className="iu-soluk">—</span> : <span className="iu-rakam">{para(k.gunluk)}</span>,
    },
    {
      key: "gun",
      title: "İzin (hak/kalan)",
      sorter: true,
      sortOrder: sutunSirasi("gun"),
      align: "right",
      width: 130,
      render: (_, k) => gunHucresi(k),
    },
    {
      key: "tutar",
      title: "Ödenecek tutar (net · brüt)",
      sorter: true,
      sortOrder: sutunSirasi("tutar"),
      align: "right",
      width: 170,
      render: (_, k) => tutarHucresi(k),
    },
  ];

  /* ------------------------------------------------------------ özet */
  const enYuksekSube = ozet?.subeler?.[0];
  const subeMax = Math.max(1, ...(ozet?.subeler ?? []).map((s) => s.tutar));
  const gorunenSubeler = tumSubeler ? ozet?.subeler ?? [] : (ozet?.subeler ?? []).slice(0, 8);


  const uyariSatirlari: { anahtar: Uyari; ad: string; aciklama: string; sayi: number; renk: string; ikon: ReactNode }[] = [
    {
      anahtar: "bakiyeYok",
      ad: "Hak ediş girilmemiş",
      aciklama: "İzin Yönetimi'nde hak ediş girilmemiş; tutar hesaplanamadı.",
      sayi: ozet?.bakiyeYok ?? 0,
      renk: "sari",
      ikon: <CalendarClock size={16} strokeWidth={2} />,
    },
    {
      anahtar: "maasYok",
      ad: "Maaş bulunamadı",
      aciklama: `${donemAdi(donem)} ve öncesinde net maaşlı bordro yok.`,
      sayi: ozet?.maasYok ?? 0,
      renk: "kirmizi",
      ikon: <UserX size={16} strokeWidth={2} />,
    },
    {
      anahtar: "eksiBakiye",
      ad: "Eksi bakiye",
      aciklama: "Hakkından fazla izin kullanmış; ödenecek gün 0 sayıldı.",
      sayi: ozet?.eksiBakiye ?? 0,
      renk: "turuncu",
      ikon: <AlertTriangle size={16} strokeWidth={2} />,
    },
  ];

  const kural = veri?.kurallar ?? { hak1_5: 14, hak6_14: 20, hak15: 26, yasIstisna: 20 };
  const kd = ozet?.kidem;

  const kidemSatirlari: { anahtar: KidemGrubu; ad: string; hak?: string; alt: string; sayi: number; ikon: ReactNode }[] = [
    {
      anahtar: "yeni",
      ad: "1 yılı dolmamış",
      alt:
        yeniler.length === 0
          ? "Yok."
          : `İzin hakkı yok · ${(veri?.yeniler ?? []).filter((y) => y.kalanGun <= 31).length} kişinin yılı bu ay doluyor`,
      sayi: sube || arama ? yeniler.length : kd?.yeni ?? 0,
      ikon: <Hourglass size={16} strokeWidth={2} />,
    },
    {
      anahtar: "1_5",
      ad: "1–5 yıl",
      hak: `${kural.hak1_5} gün`,
      alt: kd ? `${gunYaz(kd.gun1_5)} gün kalan · ${tlKisa(kd.tutar1_5)} TL` : "—",
      sayi: kd?.yil1_5 ?? 0,
      ikon: <CalendarClock size={16} strokeWidth={2} />,
    },
    {
      anahtar: "6_14",
      ad: "6–14 yıl",
      hak: `${kural.hak6_14} gün`,
      alt: kd ? `${gunYaz(kd.gun6_14)} gün kalan · ${tlKisa(kd.tutar6_14)} TL` : "—",
      sayi: kd?.yil6_14 ?? 0,
      ikon: <Award size={16} strokeWidth={2} />,
    },
    {
      anahtar: "15",
      ad: "15 yıl ve üzeri",
      hak: `${kural.hak15} gün`,
      alt: kd ? `${gunYaz(kd.gun15)} gün kalan · ${tlKisa(kd.tutar15)} TL` : "—",
      sayi: kd?.yil15 ?? 0,
      ikon: <Award size={16} strokeWidth={2} />,
    },
  ];

  /* ============================================================ çizim */
  return (
    <div className="iu">
      {/* ------------------------------------------------------- başlık */}
      <div className="iu-baslik">
        <div>
          <h1>Yıllık İzin Ücretleri</h1>
          <p>
            Çalışan personel bugün ayrılsa kullanmadığı yıllık izin için ödenecek tutar. Maaş genel merkezde
            bordrodan, diğer birimlerde personel kartından; kalan gün Yıllık İzin bakiyesinden. 1 yılı dolmamış
            personel listede yer almaz.
          </p>
        </div>

        <div className="iu-baslik-sag">
          <Tooltip title="Ücret verisi: bu sayfa yalnızca Yönetici rolüne açıktır ve her görüntüleme güvenlik günlüğüne yazılır.">
            <span className="iu-kilit">
              <Lock size={13} strokeWidth={2.2} />
              Yalnızca Yönetici
            </span>
          </Tooltip>

          <button type="button" className="iu-btn" onClick={getir} disabled={yukleniyor}>
            <RefreshCw size={15} strokeWidth={2} className={yukleniyor ? "iu-donen" : undefined} />
            Yenile
          </button>

          <button type="button" className="iu-btn" onClick={excel} disabled={!veri || suzulen.length === 0}>
            <Download size={15} strokeWidth={2} />
            Excel
          </button>
        </div>
      </div>

      {hata && (
        <Alert
          type="error"
          showIcon
          className="iu-alert"
          message="İzin ücretleri alınamadı"
          description={<span style={{ whiteSpace: "pre-wrap" }}>{hata}</span>}
        />
      )}

      {(veri?.uyarilar ?? []).map((u) => (
        <Alert key={u} type="warning" showIcon className="iu-alert" message={u} />
      ))}

      {/* ---------------------------------------------------------- KPI */}
      <div className="iu-kpi">
        <div className="iu-k iu-k-ana">
          <div className="iu-k-ust">
            <span className="iu-k-ik iu-ik-yesil"><Wallet size={16} strokeWidth={2} /></span>
            Toplam yükümlülük
          </div>
          <div className="iu-k-sayi">
            {yukleniyor && !veri ? <Spin size="small" /> : <>{tlKisa(ozet?.toplamTutar ?? 0)} <i>TL</i></>}
          </div>
          <div className="iu-k-alt">
            net · <b>{(ozet?.odenecekKisi ?? 0).toLocaleString("tr-TR")}</b> kişiye ·{" "}
            {para(ozet?.toplamTutar ?? 0)} TL
          </div>
          <div className="iu-k-brut">
            Brüt karşılık <b>{para(ozet?.toplamBrutTutar ?? 0)} TL</b>
            {(ozet?.brutYok ?? 0) > 0 && <span> · {ozet!.brutYok} kişide brüt yok</span>}
          </div>
        </div>

        <div className="iu-k">
          <div className="iu-k-ust">
            <span className="iu-k-ik iu-ik-mavi"><Users size={16} strokeWidth={2} /></span>
            Çalışan personel
          </div>
          <div className="iu-k-sayi">
            {yukleniyor && !veri ? <Spin size="small" /> : (ozet?.kisi ?? 0).toLocaleString("tr-TR")}
          </div>
          <div className="iu-k-alt">
            {(ozet?.hesaplanamayan ?? 0) > 0 ? (
              <span className="iu-uyari-yazi">
                <b>{ozet!.hesaplanamayan.toLocaleString("tr-TR")}</b> kişi hesaplanamadı
              </span>
            ) : (
              "hepsi hesaplandı"
            )}
          </div>
        </div>

        <div className="iu-k">
          <div className="iu-k-ust">
            <span className="iu-k-ik iu-ik-mor"><CalendarClock size={16} strokeWidth={2} /></span>
            Ortalama kalan gün
          </div>
          <div className="iu-k-sayi">
            {yukleniyor && !veri ? <Spin size="small" /> : <>{gunYaz(ozet?.ortalamaGun ?? 0)} <i>gün</i></>}
          </div>
          <div className="iu-k-alt">
            toplam <b>{gunYaz(ozet?.toplamGun ?? 0)}</b> gün
          </div>
        </div>

        <button
          type="button"
          className={`iu-k iu-k-tik${enYuksekSube && sube === enYuksekSube.sube ? " iu-secili" : ""}`}
          disabled={!enYuksekSube}
          onClick={() => enYuksekSube && setSube(sube === enYuksekSube.sube ? undefined : enYuksekSube.sube)}
          title="Tabloyu bu şubeye süz"
        >
          <div className="iu-k-ust">
            <span className="iu-k-ik iu-ik-turuncu"><Store size={16} strokeWidth={2} /></span>
            En yüksek şube
          </div>
          <div className="iu-k-sayi iu-k-sube" title={enYuksekSube?.sube}>
            {yukleniyor && !veri ? <Spin size="small" /> : enYuksekSube?.sube ?? "—"}
          </div>
          <div className="iu-k-alt">
            {enYuksekSube ? (
              <>
                <b>{para(enYuksekSube.tutar)} TL</b> · {enYuksekSube.kisi} kişi
              </>
            ) : (
              "—"
            )}
          </div>
        </button>
      </div>

      {/* ----------------------------------------------- hesap · uyarı · şube */}
      <div className="iu-orta">
        <section className="iu-kart iu-uyarilar">
          <div className="iu-kart-bas">
            <span className="iu-kart-ik iu-ik-sari"><AlertTriangle size={15} strokeWidth={2} /></span>
            <h3>Kontrol edilecekler</h3>
            {uyari && (
              <button type="button" className="iu-baglanti" onClick={() => setUyari(null)}>
                Süzgeci kaldır
              </button>
            )}
          </div>

          <div className="iu-uyari-liste">
            {uyariSatirlari.map((u) => (
              <button
                key={u.anahtar}
                type="button"
                className={`iu-uyari iu-uyari-${u.renk}${uyari === u.anahtar ? " iu-secili" : ""}`}
                disabled={u.sayi === 0}
                aria-pressed={uyari === u.anahtar}
                onClick={() => setUyari(uyari === u.anahtar ? null : u.anahtar)}
              >
                <span className="iu-uyari-ik">{u.sayi === 0 ? <CheckCircle2 size={16} strokeWidth={2} /> : u.ikon}</span>
                <span className="iu-uyari-metin">
                  <b>{u.ad}</b>
                  <small>{u.sayi === 0 ? "Sorun yok." : u.aciklama}</small>
                </span>
                <span className="iu-uyari-sayi">{u.sayi.toLocaleString("tr-TR")}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="iu-kart iu-subeler">
          <div className="iu-kart-bas">
            <span className="iu-kart-ik iu-ik-turuncu"><Store size={15} strokeWidth={2} /></span>
            <h3>Şubelere göre</h3>
            <span className="iu-kart-not">{(ozet?.subeler ?? []).length} şube</span>
          </div>

          {(ozet?.subeler ?? []).length === 0 ? (
            <div className="iu-bos-kucuk">{yukleniyor ? <Spin size="small" /> : "Veri yok"}</div>
          ) : (
            <div className="iu-cubuklar">
              {gorunenSubeler.map((s) => (
                <button
                  key={s.sube}
                  type="button"
                  className={`iu-cubuk${sube === s.sube ? " iu-secili" : ""}`}
                  onClick={() => setSube(sube === s.sube ? undefined : s.sube)}
                  aria-pressed={sube === s.sube}
                >
                  <span className="iu-cubuk-ad" title={s.sube}>{s.sube}</span>
                  <span className="iu-cubuk-tutar">{tlKisa(s.tutar)} TL</span>
                  <span className="iu-cubuk-iz">
                    <span style={{ width: `${Math.max(2, (s.tutar / subeMax) * 100)}%` }} />
                  </span>
                  <span className="iu-cubuk-alt">
                    {s.kisi} kişi · {gunYaz(s.gun)} gün
                  </span>
                </button>
              ))}

              {(ozet?.subeler ?? []).length > 8 && (
                <button type="button" className="iu-baglanti iu-tumu" onClick={() => setTumSubeler(!tumSubeler)}>
                  {tumSubeler ? "Daha az göster" : `Tümünü göster (${ozet!.subeler.length})`}
                  <ChevronDown size={14} strokeWidth={2} style={{ transform: tumSubeler ? "rotate(180deg)" : undefined }} />
                </button>
              )}
            </div>
          )}
        </section>

        <section className="iu-kart iu-kidemler">
          <div className="iu-kart-bas">
            <span className="iu-kart-ik iu-ik-mor"><Award size={15} strokeWidth={2} /></span>
            <h3>Kıdeme göre</h3>
            {kidemGrup && (
              <button type="button" className="iu-baglanti" onClick={() => setKidemGrup(null)}>
                Süzgeci kaldır
              </button>
            )}
          </div>

          <div className="iu-uyari-liste">
            {kidemSatirlari.map((g) => (
              <button
                key={g.anahtar}
                type="button"
                className={`iu-uyari iu-kidem iu-kidem-${g.anahtar}${kidemGrup === g.anahtar ? " iu-secili" : ""}`}
                disabled={g.sayi === 0}
                aria-pressed={kidemGrup === g.anahtar}
                onClick={() => setKidemGrup(kidemGrup === g.anahtar ? null : g.anahtar)}
              >
                <span className="iu-uyari-ik">{g.ikon}</span>
                <span className="iu-uyari-metin">
                  <b>
                    {g.ad} {g.hak && <span className="iu-kidem-hak">{g.hak}</span>}
                  </b>
                  <small>{g.alt}</small>
                </span>
                <span className="iu-uyari-sayi">{g.sayi.toLocaleString("tr-TR")}</span>
              </button>
            ))}
          </div>

          <p className="iu-kidem-not">
            İş Kanunu md. 53 · 18 yaşından küçük ve 50 yaş ve üzeri çalışanda en az {kural.yasIstisna} gün
            {kd?.yasIstisnasi ? ` · ${kd.yasIstisnasi.toLocaleString("tr-TR")} kişi` : ""}
          </p>
        </section>
      </div>

      {/* --------------------------------------- 1 yılı dolmamış personel */}
      {kidemGrup === "yeni" && (
        <section className="iu-kart iu-liste iu-yeniler">
          <div className="iu-kart-bas">
            <span className="iu-kart-ik iu-ik-mavi"><Hourglass size={15} strokeWidth={2} /></span>
            <h3>1 yılı dolmamış personel</h3>
            <span className="iu-kart-not">
              {yeniler.length.toLocaleString("tr-TR")} kişi · yıllık izin hakkı henüz yok; ücret listesinde ve
              kontrol edilecekler'de yer almaz · 1. yıl dolduğu gün {kural.hak1_5} gün (18 yaş altı ve 50 yaş üstünde {kural.yasIstisna} gün) bakiyeye otomatik yüklenir
            </span>
            <button type="button" className="iu-baglanti" onClick={() => setKidemGrup(null)}>
              Ücret listesine dön
            </button>
          </div>

          {yeniler.length === 0 ? (
            <div className="iu-bos">
              <Empty description="Bu süzgeçte 1 yılı dolmamış personel yok" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div className="iu-yeni-tablo">
              <table>
                <thead>
                  <tr>
                    <th>Personel</th>
                    <th>Şube · Ünvan</th>
                    <th>Başlangıç</th>
                    <th>Çalışma süresi</th>
                    <th>1. yıl doluyor</th>
                    <th className="iu-sag">İlerleme</th>
                  </tr>
                </thead>
                <tbody>
                  {yeniler.map((y) => {
                    const [zemin, yazi] = avatarRengi(y.kod);
                    const oran = Math.min(1, Math.max(0, y.kidemGun / 365));

                    return (
                      <tr key={y.kod}>
                        <td>
                          <div className="iu-kisi">
                            <span className="iu-av" style={{ background: zemin, color: yazi }}>
                              {basHarfler(y.ad)}
                            </span>
                            <div className="iu-kisi-metin">
                              <b title={y.ad}>{y.ad}</b>
                              <small>{y.kod}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="iu-iki">
                            <b>{y.sube}</b>
                            <small>{y.pozisyon ?? "—"}</small>
                          </div>
                        </td>
                        <td>{tarihYaz(y.kidemTarihi)}</td>
                        <td>{kidemYaz(y.kidemTarihi, y.kidemGun)}</td>
                        <td>
                          <div className="iu-iki">
                            <b>{tarihYaz(y.yilDolum)}</b>
                            <small className={y.kalanGun <= 31 ? "iu-yesil-yazi" : undefined}>
                              {y.kalanGun === 0 ? "bugün" : `${y.kalanGun.toLocaleString("tr-TR")} gün sonra`}
                            </small>
                          </div>
                        </td>
                        <td className="iu-sag">
                          <span className="iu-ilerleme" title={`%${Math.round(oran * 100)}`}>
                            <span style={{ width: `${Math.max(3, oran * 100)}%` }} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------- liste */}
      <section className="iu-kart iu-liste" hidden={kidemGrup === "yeni"}>
        <div className="iu-arac">
          <Input
            className="iu-ara"
            allowClear
            placeholder="Ad, sicil, şube ya da ünvan ara"
            prefix={<Search size={15} strokeWidth={2} color="#9AA3AF" />}
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />

          <Select
            className="iu-sec"
            allowClear
            showSearch
            placeholder="Tüm şubeler"
            value={sube}
            onChange={setSube}
            options={subeSecenekleri}
            popupMatchSelectWidth={false}
          />

          <button
            type="button"
            className={`iu-cip${yalnizOdenecek ? " iu-acik" : ""}`}
            aria-pressed={yalnizOdenecek}
            onClick={() => setYalnizOdenecek(!yalnizOdenecek)}
          >
            <Wallet size={14} strokeWidth={2} />
            Yalnızca ödenecek tutarı olanlar
          </button>

          {uyari && (
            <span className="iu-cip iu-acik iu-cip-sabit">
              {uyariSatirlari.find((u) => u.anahtar === uyari)?.ad}
              <button type="button" aria-label="Süzgeci kaldır" onClick={() => setUyari(null)}>
                <X size={13} strokeWidth={2.4} />
              </button>
            </span>
          )}

          {kidemGrup && kidemGrup !== "yeni" && (
            <span className="iu-cip iu-acik iu-cip-sabit">
              {kidemGrup === "1_5" ? "Kıdem 1–5 yıl" : kidemGrup === "6_14" ? "Kıdem 6–14 yıl" : "Kıdem 15 yıl ve üzeri"}
              <button type="button" aria-label="Süzgeci kaldır" onClick={() => setKidemGrup(null)}>
                <X size={13} strokeWidth={2.4} />
              </button>
            </span>
          )}

          {filtreVar && (
            <button type="button" className="iu-baglanti" onClick={temizle}>
              Temizle
            </button>
          )}

          <span className="iu-sayac">
            <b>{suzulen.length.toLocaleString("tr-TR")}</b> kişi · <b>{gunYaz(suzulenGun)}</b> gün ·{" "}
            <b>{para(suzulenToplam)} TL</b>
          </span>
        </div>

        {dar ? (
          /* ------------------------------------------- telefon: kartlar */
          <div className="iu-kartlar">
            {suzulen.length === 0 ? (
              <div className="iu-bos">
                {yukleniyor ? <Spin /> : <Empty description="Kayıt yok" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </div>
            ) : (
              <>
                <div className="iu-mobil-sirala">
                  <span>Sırala</span>
                  <Select
                    size="small"
                    value={`${siralama.alan}:${siralama.yon}`}
                    onChange={(v: string) => {
                      const [alan, yon] = v.split(":") as [SiralamaAlani, "artan" | "azalan"];
                      setSiralama({ alan, yon });
                    }}
                    options={[
                      { value: "tutar:azalan", label: "Tutar (yüksekten)" },
                      { value: "tutar:artan", label: "Tutar (düşükten)" },
                      { value: "gun:azalan", label: "Kalan gün (çoktan)" },
                      { value: "net:azalan", label: "Net maaş (yüksekten)" },
                      { value: "kidem:azalan", label: "Kıdem (eskiden)" },
                      { value: "ad:artan", label: "Ad (A→Z)" },
                    ]}
                    popupMatchSelectWidth={false}
                  />
                </div>

                {suzulen.slice(0, kartSiniri).map((k) => {
                  const acik = acikSatirlar.includes(k.kod);

                  return (
                    <div key={k.kod} className={`iu-mkart${acik ? " iu-acik" : ""}`}>
                      <button
                        type="button"
                        className="iu-mkart-bas"
                        onClick={() =>
                          setAcikSatirlar(acik ? acikSatirlar.filter((x) => x !== k.kod) : [...acikSatirlar, k.kod])
                        }
                        aria-expanded={acik}
                      >
                        {kisiHucresi(k)}
                        <span className="iu-mkart-sag">
                          {tutarHucresi(k)}
                          <ChevronRight size={16} strokeWidth={2} className="iu-ok" />
                        </span>
                      </button>

                      <div className="iu-mkart-satir">
                        <span>{k.sube}</span>
                        <span>
                          {k.bakiyeVar ? (
                            <>
                              <b>
                                {gunYaz((k.hakedilen ?? 0) + (k.devir ?? 0))}/
                                {k.eksiBakiye ? `${gunYaz(k.kalanGun)} → 0` : gunYaz(k.odenecekGun)}
                              </b>{" "}
                              kalan
                              {k.planli > 0 && <> · planlı {gunYaz(k.planli)}</>}
                            </>
                          ) : (
                            <span className="iu-uyari-yazi">hak ediş girilmemiş</span>
                          )}
                          {k.gunluk != null && <> · {para(k.gunluk)} TL/gün</>}
                        </span>
                      </div>

                      {acik && <div className="iu-mkart-detay">{hesapAdimlari(k)}</div>}
                    </div>
                  );
                })}

                {suzulen.length > kartSiniri && (
                  <button type="button" className="iu-btn iu-daha" onClick={() => setKartSiniri(kartSiniri + 30)}>
                    Daha fazla göster ({(suzulen.length - kartSiniri).toLocaleString("tr-TR")} kaldı)
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          /* -------------------------------------------- geniş: tablo */
          <Table<Kayit>
            className="iu-tablo"
            rowKey="kod"
            size="middle"
            loading={yukleniyor && !veri}
            columns={sutunlar}
            dataSource={suzulen}
            scroll={{ x: 1120 }}
            showSorterTooltip={false}
            sortDirections={["descend", "ascend"]}
            onChange={(_, __, s: any) => {
              const tek = Array.isArray(s) ? s[0] : s;
              if (!tek?.order) {
                setSiralama({ alan: "tutar", yon: "azalan" });
                return;
              }
              setSiralama({ alan: tek.columnKey as SiralamaAlani, yon: tek.order === "ascend" ? "artan" : "azalan" });
            }}
            rowClassName={(k) =>
              k.durum === "tamam" ? "" : `iu-satir-${k.durum}`
            }
            expandable={{
              expandedRowRender: (k) => hesapAdimlari(k),
              expandRowByClick: true,
              expandedRowKeys: acikSatirlar,
              onExpandedRowsChange: (k) => setAcikSatirlar(k as string[]),
              expandIcon: ({ expanded, onExpand, record }) => (
                <button
                  type="button"
                  className={`iu-genislet${expanded ? " iu-acik" : ""}`}
                  aria-label={expanded ? "Hesabı gizle" : "Hesabı göster"}
                  onClick={(e) => onExpand(record, e)}
                >
                  <ChevronRight size={15} strokeWidth={2} />
                </button>
              ),
            }}
            pagination={{
              defaultPageSize: 50,
              pageSizeOptions: [25, 50, 100, 200],
              showSizeChanger: true,
              showTotal: (t, [a, b]) => `${a}–${b} / ${t.toLocaleString("tr-TR")} kişi`,
            }}
            locale={{
              emptyText: <Empty description={filtreVar ? "Süzgece uyan kayıt yok" : "Kayıt yok"} image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
            summary={() =>
              suzulen.length === 0 ? null : (
                <Table.Summary>
                  <Table.Summary.Row className="iu-toplam">
                    <Table.Summary.Cell index={0} colSpan={6}>
                      {filtreVar ? "Süzülen toplam" : "Genel toplam"} · {suzulen.length.toLocaleString("tr-TR")} kişi
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="right">
                      {gunYaz(suzulenGun)} gün
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="right">
                      <span className="iu-tutar">{para(suzulenToplam)} <i>TL</i></span>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )
            }
          />
        )}

        {veri && (
          <div className="iu-alt-not" data-not="ana">
            Hesap {new Date(veri.hesapTarihi).toLocaleString("tr-TR")} · genel merkez: {donemAdi(veri.donem)} ve
            öncesindeki son bordro, diğer birimler: personel kartı ücreti · kıdem önceki dönemler dahil · sunucu bir
            dakika önbellekte tutar
          </div>
        )}
      </section>

      <IzinMaliyetRaporu kayitlar={kayitlar} />
    </div>
  );
}

/* ========================================================== maliyet raporu */

interface MaliyetSube {
  sube: string;
  tutar: number[];
  gun: number[];
  kisi: number[];
  bugunKisi: number;
  bugunGun: number;
  bugunTutar: number;
}

interface MaliyetCevap {
  yil: number;
  buAy: number;
  canliAy: number | null;
  subeler: MaliyetSube[];
  aylikTutar: number[];
  aylikGun: number[];
  aylikKisi: number[];
  bugunTutar: number;
  bugunGun: number;
  bugunKisi: number;
}

const AY_KISA = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];

const buyukHarf = (s: string | null | undefined) => (s ?? "").trim().toLocaleUpperCase("tr-TR");

/**
 * Yıllık izin maliyet raporu: şubenin kalan yıllık izin yükü — çalışanlar
 * bugün ayrılsa kalan izinleri için ödenecek NET tutar (yukarıdaki listenin
 * aynı hesabı). Aylık sütunlar o ayın anlık görüntüsü; içinde bulunulan ay
 * canlı. Şubeye tıklayınca personeli ve kişi başı kalan izin ile ödenecek
 * tutar açılıyor.
 */
function IzinMaliyetRaporu({ kayitlar }: { kayitlar: Kayit[] }) {
  const buYil = new Date().getFullYear();
  const [yil, setYil] = useState(buYil);
  const [veri, setVeri] = useState<MaliyetCevap | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [tumAylar, setTumAylar] = useState(false);
  const [acik, setAcik] = useState<string | null>(null);

  useEffect(() => {
    let iptal = false;

    setYukleniyor(true);
    setHata(null);

    api
      .al<MaliyetCevap>(`/api/IzinUcreti/Maliyet?yil=${yil}`)
      .then((v) => !iptal && setVeri(v))
      .catch((e: any) => !iptal && setHata(e?.message ?? "Maliyet raporu alınamadı."))
      .finally(() => !iptal && setYukleniyor(false));

    return () => {
      iptal = true;
    };
  }, [yil]);

  /* Şube → personel (kalan izin listesindeki kişiler) */
  const subePersoneli = useMemo(() => {
    const m = new Map<string, Kayit[]>();

    for (const k of kayitlar) {
      const anahtar = buyukHarf(k.sube);
      const l = m.get(anahtar) ?? [];
      l.push(k);
      m.set(anahtar, l);
    }

    for (const l of m.values()) l.sort((x, y) => (y.tutar ?? -1) - (x.tutar ?? -1));

    return m;
  }, [kayitlar]);

  /* Gösterilen aylar: ilk anlık görüntüden içinde bulunulan aya */
  const aylar = useMemo(() => {
    if (!veri) return [] as number[];

    const dolu = (i: number) => veri.aylikKisi[i] > 0 || veri.aylikTutar[i] !== 0;
    const ilk = Array.from({ length: 12 }, (_, i) => i).find(dolu) ?? veri.buAy - 1;
    const bas = tumAylar ? 0 : Math.min(ilk, veri.buAy - 1);
    const bit = tumAylar ? 12 : veri.buAy;

    return Array.from({ length: Math.max(0, bit - bas) }, (_, i) => bas + i);
  }, [veri, tumAylar]);

  /* Ay başına eşikler: verili şubelerin üçte biri ve üçte ikisi */
  const esikler = useMemo(() => {
    const e: Record<number, [number, number]> = {};

    for (const a of aylar) {
      const d = (veri?.subeler ?? []).map((s) => s.tutar[a]).filter((x) => x > 0).sort((x, y) => x - y);

      e[a] = d.length ? [d[Math.floor(d.length / 3)], d[Math.floor((d.length * 2) / 3)]] : [0, 0];
    }

    return e;
  }, [veri, aylar]);

  const renk = (a: number, v: number) => {
    if (!(v > 0)) return "";
    const [e1, e2] = esikler[a] ?? [0, 0];
    return v <= e1 ? "iu-m-yesil" : v <= e2 ? "iu-m-sari" : "iu-m-kirmizi";
  };

  const sutunSayisi = 1 + aylar.length * 2 + 3;

  const excel = () => {
    if (!veri) return;

    tabloIndir({
      baslik: `Yıllık İzin Maliyet Raporu · ${veri.yil}`,
      altBaslik:
        "Şubenin kalan yıllık izin yükü: çalışanlar bugün ayrılsa kalan izinleri için ödenecek net tutar · aylık sütunlar o ayın anlık görüntüsü · 1 yılı dolmamışlar hariç",
      sayfaAdi: `Maliyet ${veri.yil}`,
      dosyaAdi: `yillik-izin-maliyet-${veri.yil}`,
      genelToplam: true,
      sutunlar: [
        { ad: "ŞUBE", genislik: 24 },
        ...aylar.flatMap((a) => [
          { ad: `${AY_KISA[a]} TUTAR`, tip: "para" as const, genislik: 15 },
          { ad: `${AY_KISA[a]} GÜN`, tip: "ondalik" as const, genislik: 9 },
        ]),
        { ad: "BUGÜN KİŞİ", tip: "sayi", genislik: 10 },
        { ad: "BUGÜN KALAN GÜN", tip: "ondalik", genislik: 12 },
        { ad: "BUGÜN ÖDENECEK (NET)", tip: "para", genislik: 18, veriCubugu: true },
      ],
      satirlar: veri.subeler.map((s) => [
        s.sube,
        ...aylar.flatMap((a) => [s.tutar[a] || null, s.gun[a] || null]),
        s.bugunKisi,
        s.bugunGun,
        s.bugunTutar,
      ]),
    }).catch(() => undefined);
  };

  return (
    <section className="iu-kart iu-maliyet">
      <div className="iu-kart-bas">
        <span className="iu-kart-ik iu-ik-turuncu"><BarChart3 size={15} strokeWidth={2} /></span>
        <h3>Yıllık izin maliyet raporu</h3>
        <span className="iu-kart-not">
          Şubelerin kalan yıllık izin günü ve personel bugün ayrılsa ödenecek net tutar · şubeye tıklayınca personel
        </span>

        <div className="iu-maliyet-arac">
          <Select
            size="small"
            value={yil}
            onChange={setYil}
            options={[buYil, buYil - 1, buYil - 2].map((y) => ({ value: y, label: String(y) }))}
          />
          <button type="button" className="iu-baglanti" onClick={() => setTumAylar(!tumAylar)}>
            {tumAylar ? "Yalnızca verili aylar" : "Tüm yıl"}
          </button>
          <button type="button" className="iu-btn" onClick={excel} disabled={!veri || veri.subeler.length === 0}>
            <Download size={15} strokeWidth={2} />
            Excel
          </button>
        </div>
      </div>

      {hata && <Alert type="error" showIcon className="iu-alert" message={hata} />}

      {yukleniyor && !veri ? (
        <div className="iu-bos-kucuk"><Spin size="small" /></div>
      ) : !veri || veri.subeler.length === 0 ? (
        <div className="iu-bos">
          <Empty description={`${yil} için kayıt yok`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <>
          <div className="iu-maliyet-kap">
            <table className="iu-maliyet-tablo">
              <thead>
                <tr>
                  <th rowSpan={2} className="iu-m-sube">Şube</th>
                  {aylar.map((a) => (
                    <th key={a} colSpan={2} className="iu-m-ay">
                      {AY_KISA[a]}
                      {veri.canliAy === a + 1 && <span className="iu-m-canli">canlı</span>}
                    </th>
                  ))}
                  <th colSpan={3} className="iu-m-ay iu-m-top">BUGÜN</th>
                </tr>
                <tr>
                  {aylar.map((a) => (
                    <Fragment key={a}>
                      <th className="iu-m-alt">Tutar</th>
                      <th className="iu-m-alt iu-m-gun">Gün</th>
                    </Fragment>
                  ))}
                  <th className="iu-m-alt iu-m-top iu-m-gun">Kişi</th>
                  <th className="iu-m-alt iu-m-top iu-m-gun">Kalan gün</th>
                  <th className="iu-m-alt iu-m-top">Ödenecek (net)</th>
                </tr>
              </thead>
              <tbody>
                {veri.subeler.map((s) => {
                  const ac = acik === s.sube;
                  const kisiler = subePersoneli.get(s.sube) ?? [];

                  return (
                    <Fragment key={s.sube}>
                      <tr
                        className={`iu-m-satir${ac ? " iu-m-acik" : ""}`}
                        onClick={() => setAcik(ac ? null : s.sube)}
                        aria-expanded={ac}
                      >
                        <th className="iu-m-sube" scope="row">
                          <span className="iu-m-ok">
                            <ChevronRight size={14} strokeWidth={2.4} />
                          </span>
                          {s.sube}
                        </th>
                        {aylar.map((a) => (
                          <Fragment key={a}>
                            <td className={`iu-m-tutar ${renk(a, s.tutar[a])}`}>
                              {s.tutar[a] > 0 ? <>₺ {para(s.tutar[a])}</> : ""}
                            </td>
                            <td className="iu-m-gun">{s.gun[a] ? gunYaz(s.gun[a]) : ""}</td>
                          </Fragment>
                        ))}
                        <td className="iu-m-gun iu-m-top">{s.bugunKisi || ""}</td>
                        <td className="iu-m-gun iu-m-top">{gunYaz(s.bugunGun)}</td>
                        <td className="iu-m-tutar iu-m-top">₺ {para(s.bugunTutar)}</td>
                      </tr>

                      {ac && (
                        <tr className="iu-m-detay">
                          <td colSpan={sutunSayisi}>
                            {kisiler.length === 0 ? (
                              <span className="iu-soluk">Bu şubede bugün kalan izni hesaplanan personel yok.</span>
                            ) : (
                              <table className="iu-m-kisiler">
                                <thead>
                                  <tr>
                                    <th>Personel</th>
                                    <th>Ünvan</th>
                                    <th>Kıdem</th>
                                    <th className="iu-sag">İzin (hak/kalan)</th>
                                    <th className="iu-sag">Net maaş</th>
                                    <th className="iu-sag">Günlük</th>
                                    <th className="iu-sag">Ayrılırsa ödenecek (net)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {kisiler.map((k) => (
                                    <tr key={k.kod}>
                                      <td>
                                        <b>{k.ad}</b> <small className="iu-soluk">{k.kod}</small>
                                      </td>
                                      <td>{k.pozisyon ?? "—"}</td>
                                      <td>
                                        {k.kidemYil} yıl <small className="iu-soluk">· {k.yillikHak} gün hak{k.yasIstisnasi ? " · yaş" : ""}</small>
                                      </td>
                                      <td className="iu-sag">
                                        {k.bakiyeVar ? (
                                          <>
                                            <span className="iu-soluk">{gunYaz((k.hakedilen ?? 0) + (k.devir ?? 0))}/</span>
                                            <b className={k.eksiBakiye ? "iu-kirmizi-yazi" : undefined}>
                                              {k.eksiBakiye ? `${gunYaz(k.kalanGun)} → 0` : gunYaz(k.odenecekGun)}
                                            </b>
                                          </>
                                        ) : (
                                          <span className="iu-e iu-e-sari">hak ediş girilmemiş</span>
                                        )}
                                      </td>
                                      <td className="iu-sag">{para(k.netMaas)}</td>
                                      <td className="iu-sag">{para(k.gunluk)}</td>
                                      <td className="iu-sag">
                                        <b>{k.tutar != null ? `₺ ${para(k.tutar)}` : "—"}</b>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr>
                                    <td colSpan={3}>{kisiler.length} kişi</td>
                                    <td className="iu-sag">
                                      <b>{gunYaz(kisiler.reduce((t, k) => t + (k.odenecekGun ?? 0), 0))} gün</b>
                                    </td>
                                    <td colSpan={2} />
                                    <td className="iu-sag">
                                      <b>₺ {para(kisiler.reduce((t, k) => t + (k.tutar ?? 0), 0))}</b>
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th className="iu-m-sube" scope="row">Genel Toplam</th>
                  {aylar.map((a) => (
                    <Fragment key={a}>
                      <td className="iu-m-tutar">{veri.aylikTutar[a] > 0 ? <>₺ {para(veri.aylikTutar[a])}</> : ""}</td>
                      <td className="iu-m-gun">{veri.aylikGun[a] ? gunYaz(veri.aylikGun[a]) : ""}</td>
                    </Fragment>
                  ))}
                  <td className="iu-m-gun iu-m-top">{veri.bugunKisi}</td>
                  <td className="iu-m-gun iu-m-top">{gunYaz(veri.bugunGun)}</td>
                  <td className="iu-m-tutar iu-m-top">₺ {para(veri.bugunTutar)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="iu-maliyet-alt">
            <span className="iu-m-lejant"><i className="iu-m-yesil" />ayın düşük üçte biri</span>
            <span className="iu-m-lejant"><i className="iu-m-sari" />orta</span>
            <span className="iu-m-lejant"><i className="iu-m-kirmizi" />en yüksek üçte biri</span>
            <span>
              Tutar = kalan izin günü × günlük net ücret (genel merkez bordro neti, diğer birimler personel kartı
              ücreti ÷ 30); 1 yılı dolmamışlar hariç. Aylık sütunlar o ayın son hesabıdır; kalan izin geriye dönük
              bilinmediği için ilk sütun raporun ilk açıldığı ay.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
