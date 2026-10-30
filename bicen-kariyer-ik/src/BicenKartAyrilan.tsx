/**
 * Biçen Kart › Ayrılan Personel
 * ---------------------------------------------------------------------------
 * Personele fiziki kart gönderilmedi; kartlar Biçen360'ta kullanılıyor.
 * İşten ayrılan kişi uygulamaya giremiyor ama kartı ve bakiyesi duruyor.
 * Bu sayfa iki bölüm:
 *
 *  - Gönderim: seçilen ayda çıkışı olan personel (çıkış tarihi gelmiş).
 *    Seçilenlere kişiye özel kart bağlantısı SMS ile gider. Bağlantı ilk
 *    SMS'ten itibaren ayardaki gün kadar (varsayılan 30) geçerli. Kart
 *    eşleşmesi olmayanlar soluk görünür, gönderilemez.
 *  - Takip: bağlantıların akıbeti — açıldı mı, kimlik doğrulandı mı, şifre
 *    belirlendi mi, kart kullanıldı mı, bakiye bitti mi, süre doldu mu.
 *    Satır ve toplu işlemler: tekrar SMS, süreyi uzat, iptal, bakiyeyi sil
 *    (Puan Yönetimi'nin silmesiyle aynı), kartı boşa çıkar, kilidi aç.
 *
 * "Kullandı": gönderimden sonra karta yazılmış alışveriş satırı
 * (PuanHareket.IslemTipi 2). Süre dolunca sunucu kart şifresini kilitler;
 * bakiye silinmez.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Drawer, Dropdown, Input, InputNumber, Modal, Select, Switch, Tooltip, message } from "antd";
import {
  Ban,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  UserCheck,
  UserMinus,
  Copy,
  CreditCard,
  Download,
  Eraser,
  History,
  Info,
  KeyRound,
  Link2Off,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Unlock,
  X,
} from "lucide-react";

import { api } from "./api";
import AyrilanKartTanimla from "./AyrilanKartTanimla";
import { tabloIndir } from "./raporExcel";
import { PersonelAdi } from "./personelKarti";

/* -------------------------------------------------------------------------- */

type Tur = "ayrilan" | "calisan";

interface Baglanti {
  id: number;
  kod: string;
  tur: Tur;
  adres: string;
  ay: string;
  sicil: string;
  adSoyad: string;
  sube: string | null;
  pozisyon: string | null;
  cikisTarihi: string | null;
  telefon: string | null;
  kartNo: string;
  kartSon4: string;
  gonderim: string;
  smsIlk: string | null;
  smsSon: string | null;
  smsSayisi: number;
  smsDurum: string | null;
  smsHata: string | null;
  gonderen: string | null;
  sonGonderen: string | null;
  sonGecerlilik: string;
  kalanGun: number;
  suresiDoldu: boolean;
  ilkAcilis: string | null;
  sonAcilis: string | null;
  acilisSayisi: number;
  kimlikDogrulama: string | null;
  sifreTarihi: string | null;
  sifreGecerli: boolean;
  sifreGecersiz: string | null;
  gonderimBakiye: number | null;
  bakiye: number | null;
  bakiyeCanli: boolean;
  harcanan: number;
  silinen: number;
  kullanimYuzde: number;
  ilkKullanim: string | null;
  sonKullanim: string | null;
  tamamlandi: string | null;
  hataliDeneme: number;
  kilitBitis: string | null;
  kilitli: boolean;
  iptal: boolean;
  birakildi: string | null;
  indirmeSayisi: number;
  uzatmaSayisi: number;
  durum: string;
  durumAdi: string;
}

interface Kisi {
  sicil: string;
  adSoyad: string;
  sube: string;
  pozisyon: string | null;
  cikisTarihi: string | null;
  telefon: string | null;
  telefonGecerli: boolean;
  tcVar: boolean;
  kartNo: string | null;
  kartSon4: string | null;
  eslesmeYok: boolean;
  bakiye: number | null;
  yenidenCalisiyor: boolean;
  engel: string | null;
  link: Baglanti | null;
}

interface ListeVeri {
  ay: string;
  personel: Kisi[];
  subeler?: string[];
  posHatasi: string | null;
  smsEtkin: boolean;
  /** Kartı olmayan ayrılana kart tanımlayabilir (yalnızca Yönetici) */
  kartTanimlayabilir?: boolean;
  ayar: { smsSablonu: string; calisanSmsSablonu: string; gecerlilikGunu: number; baglantiAdresi: string };
  ornekAdres: string;
}

interface TakipVeri {
  ay: string | null;
  tur: "tumu" | Tur;
  turSayilari: { tumu: number; ayrilan: number; calisan: number };
  baglantilar: Baglanti[];
  ozet: {
    toplam: number;
    gonderildi: number;
    acildi: number;
    sifreBelirledi: number;
    kullanmayaBasladi: number;
    tamamlandi: number;
    suresiDoldu: number;
    kullanmadi: number;
    gonderilenBakiye: number;
    harcanan: number;
    kalanBakiye: number;
  };
  durumlar: Record<string, number>;
  durumAdlari: Record<string, string>;
  posHatasi: string | null;
}

/* -------------------------------------------------------------------------- */

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const ayAdi = (y: number, a: number) => `${AYLAR[a - 1]} ${y}`;

const tl = (d?: number | null) =>
  (d ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

const gun = (t?: string | null) => (t ? new Date(t).toLocaleDateString("tr-TR") : "");

const gunSaat = (t?: string | null) =>
  t
    ? `${new Date(t).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })} ${new Date(t).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "";

const telYaz = (t?: string | null) =>
  t && t.length === 10 ? `0${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6, 8)} ${t.slice(8)}` : t ?? "";

const bas = (ad: string) =>
  (ad ?? "")
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr-TR");

const kucuk = (s?: string | null) => (s ?? "").toLocaleLowerCase("tr-TR");

/** Durum çipinin rengi */
const DURUM_RENK: Record<string, string> = {
  gonderilmedi: "bk-r-gri",
  smsHata: "bk-r-kirmizi",
  acilmadi: "bk-r-gri",
  acildi: "bk-r-mavi",
  dogrulandi: "bk-r-mavi",
  sifre: "bk-r-mor",
  kullaniyor: "bk-r-yesil",
  tamamlandi: "bk-r-koyu",
  silindi: "bk-r-gri",
  sureDoldu: "bk-r-turuncu",
  sureDolduKismen: "bk-r-sari",
  kilitli: "bk-r-kirmizi",
  iptal: "bk-r-gri",
  birakildi: "bk-r-gri",
};

const TAKIP_SIRA = [
  "acilmadi",
  "acildi",
  "dogrulandi",
  "sifre",
  "kullaniyor",
  "tamamlandi",
  "sureDoldu",
  "sureDolduKismen",
  "kilitli",
  "smsHata",
  "silindi",
  "iptal",
  "birakildi",
];

/** SMS önizlemesi: sunucudaki kalıp doldurmanın aynısı (yaklaşık). */
const smsOnizle = (kalip: string, adSoyad: string, bakiye: number, adres: string, gunSayisi: number) => {
  const ilk = (adSoyad ?? "").split(" ").filter(Boolean)[0] ?? "";
  const ad = ilk ? ilk[0].toLocaleUpperCase("tr-TR") + ilk.slice(1).toLocaleLowerCase("tr-TR") : "";
  const son = new Date(Date.now() + gunSayisi * 864e5).toLocaleDateString("tr-TR");
  const tutar = bakiye % 1 === 0 ? bakiye.toLocaleString("tr-TR") : bakiye.toLocaleString("tr-TR", { minimumFractionDigits: 2 });

  let m = kalip
    .split("{ad}").join(ad)
    .split("{bakiye}").join(tutar)
    .split("{link}").join(adres)
    .split("{gun}").join(String(gunSayisi))
    .split("{tarih}").join(son);

  if (!kalip.includes("{link}")) m += " " + adres;

  return m;
};

/* ========================================================================== */

export default function BicenKartAyrilan() {
  const bugun = new Date();
  const [yil, setYil] = useState(bugun.getFullYear());
  const [ay, setAy] = useState(bugun.getMonth() + 1);
  const [bolum, setBolum] = useState<"gonderim" | "takip">("gonderim");
  const [kaynak, setKaynak] = useState<Tur>("ayrilan");

  const ayKaydir = (n: number) => {
    let a = ay + n;
    let y = yil;

    if (a < 1) { a = 12; y--; }
    if (a > 12) { a = 1; y++; }

    setAy(a);
    setYil(y);
  };

  const ayVar = yil < bugun.getFullYear() || (yil === bugun.getFullYear() && ay < bugun.getMonth() + 1);

  const ayListesi = useMemo(() => {
    const l: { value: string; label: string }[] = [];
    const d = new Date(bugun.getFullYear(), bugun.getMonth(), 1);

    for (let i = 0; i < 24; i++) {
      l.push({ value: `${d.getFullYear()}-${d.getMonth() + 1}`, label: ayAdi(d.getFullYear(), d.getMonth() + 1) });
      d.setMonth(d.getMonth() - 1);
    }

    return l;
  }, []);

  const [ayarAcik, setAyarAcik] = useState(false);

  return (
    <div className="bk-ay">
      <div className="bk-ay-arac">
        {bolum === "gonderim" && (
          <div className="bk-ay-bolum bk-ay-kaynak" role="tablist" aria-label="Gönderilecek personel">
            <button className={kaynak === "ayrilan" ? "acik" : ""} onClick={() => setKaynak("ayrilan")}>
              <UserMinus size={14} /> Ayrılan personel (ay)
            </button>
            <button className={kaynak === "calisan" ? "acik" : ""} onClick={() => setKaynak("calisan")}>
              <UserCheck size={14} /> Çalışan personel
            </button>
          </div>
        )}

        {!(bolum === "gonderim" && kaynak === "calisan") && (
        <div className="bk-ay-donem">
          <button className="bk-d hayalet kucuk" onClick={() => ayKaydir(-1)} title="Önceki ay">
            <ChevronLeft size={16} />
          </button>
          <Select
            value={`${yil}-${ay}`}
            options={ayListesi}
            style={{ width: 150 }}
            onChange={(v: string) => {
              const [y, a] = v.split("-").map(Number);
              setYil(y);
              setAy(a);
            }}
          />
          <button className="bk-d hayalet kucuk" onClick={() => ayKaydir(1)} disabled={!ayVar} title="Sonraki ay">
            <ChevronRight size={16} />
          </button>
        </div>
        )}

        <div className="bk-ay-bolum bk-ay-sag" role="tablist">
          <button className={bolum === "gonderim" ? "acik" : ""} onClick={() => setBolum("gonderim")}>
            <Send size={14} /> Gönderim
          </button>
          <button className={bolum === "takip" ? "acik" : ""} onClick={() => setBolum("takip")}>
            <History size={14} /> Kullanım takibi
          </button>
        </div>

        <button className="bk-d" onClick={() => setAyarAcik(true)}>
          <Settings2 size={15} /> SMS ve süre ayarı
        </button>
      </div>

      {bolum === "gonderim" ? (
        <Gonderim key={kaynak} kaynak={kaynak} yil={yil} ay={ay} takibeGec={() => setBolum("takip")} />
      ) : (
        <Takip yil={yil} ay={ay} />
      )}

      <AyarPenceresi acik={ayarAcik} kapat={() => setAyarAcik(false)} />
    </div>
  );
}

/** Çalışan personelin satırlarında yıkıcı işlem öncesi uyarı */
function CalisanUyarisi({ liste }: { liste: Baglanti[] }) {
  const calisanlar = liste.filter((b) => b.tur === "calisan");

  if (calisanlar.length === 0) return null;

  return (
    <div className="bk-uyari bk-u-kirmizi bk-ay-calisanUyari">
      <AlertTriangle size={16} style={{ color: "#cf1322", marginTop: 2 }} />
      <div>
        <b>Personel hâlâ çalışıyor.</b>{" "}
        {calisanlar.length === 1 ? calisanlar[0].adSoyad : `${calisanlar.length} kişi (${calisanlar.map((b) => b.adSoyad).slice(0, 3).join(", ")}${calisanlar.length > 3 ? "…" : ""})`}{" "}
        kartını Biçen360'ta kullanıyor. Bu işlem uygulamadaki kartını da etkiler.
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Gönderim                                                                   */
/* ========================================================================== */

type GSuzgec = "tumu" | "gonderilebilir" | "gonderildi" | "gonderilemez";

/** Kart numarası tam ve dörderli: 6034 1122 0045 7781 (İK panelinde tamamı görünür) */
const kartYaz = (no?: string | null, son4?: string | null) =>
  no ? no.trim().replace(/(.{4})/g, "$1 ").trim() : son4 ? `•••• ${son4}` : "";

function Gonderim({ kaynak, yil, ay, takibeGec }: { kaynak: Tur; yil: number; ay: number; takibeGec: () => void }) {
  const calisanMod = kaynak === "calisan";
  const [sube, setSube] = useState<string | undefined>(undefined);
  const [veri, setVeri] = useState<ListeVeri | null>(null);
  /* Ayrılana kart tanımlama (yalnızca Yönetici): sicil boşsa kişi aranarak açılır */
  const [kartCekmece, setKartCekmece] = useState<{ acik: boolean; sicil: string | null }>({ acik: false, sicil: null });
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [ara, setAra] = useState("");
  const [suzgec, setSuzgec] = useState<GSuzgec>("tumu");
  const [secili, setSecili] = useState<string[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [onay, setOnay] = useState<{ tekrar: boolean; kisiler: Kisi[] } | null>(null);
  const [sonuc, setSonuc] = useState<any>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setVeri(
        await api.al<ListeVeri>(
          calisanMod ? "/api/BicenKart/Ayrilan/Calisan" : `/api/BicenKart/Ayrilan/Liste?yil=${yil}&ay=${ay}`
        )
      );
      setHata("");
    } catch (h: any) {
      setHata(h?.message ?? "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [yil, ay, calisanMod]);

  useEffect(() => {
    setSecili([]);
    getir();
  }, [getir]);

  /* Şube süzgeci (çalışan modunda) listenin kendisini daraltıyor */
  const kisiler = (veri?.personel ?? []).filter((k) => !calisanMod || !sube || k.sube === sube);

  /** Gönderilmiş ve süresi içinde (yeniden gönderim yalnızca "Tekrar") */
  const gitti = (k: Kisi) => !!k.link && !k.link.iptal && !k.link.birakildi && !!k.link.smsIlk;

  const sayilar = useMemo(
    () => ({
      tumu: kisiler.length,
      gonderilebilir: kisiler.filter((k) => !k.engel && !gitti(k)).length,
      gonderildi: kisiler.filter(gitti).length,
      gonderilemez: kisiler.filter((k) => !!k.engel).length,
    }),
    [kisiler]
  );

  const liste = useMemo(() => {
    const q = kucuk(ara.trim());

    return kisiler
      .filter(
        (k) =>
          !q ||
          kucuk(k.adSoyad).includes(q) ||
          k.sicil.includes(q) ||
          kucuk(k.sube).includes(q) ||
          ((k.kartNo ?? "") + (k.kartSon4 ?? "")).includes(q.replace(/\s/g, ""))
      )
      .filter((k) =>
        suzgec === "gonderilebilir" ? !k.engel && !gitti(k)
        : suzgec === "gonderildi" ? gitti(k)
        : suzgec === "gonderilemez" ? !!k.engel
        : true
      );
  }, [kisiler, ara, suzgec]);

  const secilebilir = (k: Kisi) => !k.engel;
  const secilenler = kisiler.filter((k) => secili.includes(k.sicil));
  const yeniSecilen = secilenler.filter((k) => !gitti(k));
  const tekrarSecilen = secilenler.filter((k) => gitti(k) && !k.link?.suresiDoldu);

  const tumunuSec = (ac: boolean) => {
    const adaylar = liste.filter(secilebilir).map((k) => k.sicil);
    setSecili((s) => (ac ? Array.from(new Set([...s, ...adaylar])) : s.filter((x) => !adaylar.includes(x))));
  };

  const hepsiSecili = liste.filter(secilebilir).length > 0 && liste.filter(secilebilir).every((k) => secili.includes(k.sicil));

  const gonder = async (tekrar: boolean, hedef: Kisi[]) => {
    setGonderiliyor(true);

    try {
      const c = await api.gonder<any>("/api/BicenKart/Ayrilan/Gonder", {
        siciller: hedef.map((k) => k.sicil),
        tekrar,
        tur: kaynak,
      });

      setSonuc(c);
      setOnay(null);
      setSecili([]);
      getir();
    } catch (h: any) {
      message.error(h?.message ?? "Gönderilemedi.");
    } finally {
      setGonderiliyor(false);
    }
  };

  const excel = async () => {
    try {
      await tabloIndir({
        baslik: calisanMod ? "Biçen Kart · çalışan personel" : "Biçen Kart · ayrılan personel",
        altBaslik: `${calisanMod ? (sube ?? "Tüm şubeler") : ayAdi(yil, ay)} · ${new Date().toLocaleDateString("tr-TR")}`,
        sayfaAdi: calisanMod ? "Çalışan personel" : "Ayrılan personel",
        dosyaAdi: calisanMod
          ? `calisan-personel-kart-${new Date().toISOString().slice(0, 10)}.xlsx`
          : `ayrilan-personel-kart-${yil}-${String(ay).padStart(2, "0")}.xlsx`,
        sutunlar: [
          { ad: "Sicil", genislik: 10 },
          { ad: "Ad soyad", genislik: 26 },
          { ad: "Şube", genislik: 22 },
          { ad: "Çıkış", tip: "tarih" },
          { ad: "Telefon", genislik: 15 },
          { ad: "Kart no", genislik: 20 },
          { ad: "Bakiye", tip: "para", genislik: 14 },
          { ad: "Durum", genislik: 28 },
          { ad: "SMS", tip: "tarihSaat" },
          { ad: "Son geçerlilik", tip: "tarih" },
        ],
        satirlar: liste.map((k) => [
          k.sicil,
          k.adSoyad,
          k.sube,
          k.cikisTarihi,
          telYaz(k.telefon),
          k.kartNo ? k.kartNo.trim() : "",
          k.bakiye,
          k.engel ?? k.link?.durumAdi ?? "Gönderilmedi",
          k.link?.smsIlk ?? null,
          k.link?.sonGecerlilik ?? null,
        ]),
        genelToplam: true,
      });
    } catch (h: any) {
      message.error(h?.message ?? "Excel oluşturulamadı.");
    }
  };

  if (yukleniyor && !veri)
    return <div className="bk-panel bk-yukleniyor">{calisanMod ? "Çalışan personel" : "Ayrılan personel"} yükleniyor…</div>;

  if (hata && !veri)
    return (
      <Alert
        type="error"
        showIcon
        message="Liste alınamadı"
        description={hata}
        action={<button className="bk-d kucuk" onClick={getir}>Yeniden dene</button>}
      />
    );

  const toplamBakiye = kisiler.filter((k) => !k.engel).reduce((t, k) => t + (k.bakiye ?? 0), 0);
  const ornek = yeniSecilen[0] ?? tekrarSecilen[0] ?? secilenler[0];

  return (
    <>
      {/* Ayrılan personele kart tanımlama: yalnızca Yönetici; sunucu da denetliyor */}
      <AyrilanKartTanimla
        acik={kartCekmece.acik}
        sicil={kartCekmece.sicil}
        kapat={() => setKartCekmece({ acik: false, sicil: null })}
        degisti={getir}
      />
      {veri?.posHatasi && (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message="Kart veritabanına ulaşılamadı"
          description={`Bakiyeler okunamadı; gönderim yapılamaz. ${veri.posHatasi}`}
        />
      )}

      {veri && !veri.smsEtkin && (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message="SMS servisi kapalı"
          description="Bağlantılar oluşturulur ama SMS gitmez; satırlar 'SMS başarısız' görünür. Bağlantı adresini Kullanım takibi'nden kopyalayabilirsiniz."
        />
      )}

      {calisanMod && (
        <div className="bk-uyari bk-u-bilgi" style={{ marginBottom: 12 }}>
          <Info size={16} style={{ marginTop: 2, color: "var(--bk-yesilKoyu)" }} />
          <div>
            Çalışan personel kartını Biçen360'ta kullanmaya devam eder. Bağlantının süresi dolunca ya da bakiye bitince
            yalnızca bağlantı kartı göstermez; <b>kart şifresine dokunulmaz</b>, hiçbir şey boşa çıkarılmaz.
          </div>
        </div>
      )}

      <div className="bk-ozet">
        <div className="bk-kutu">
          <small>{calisanMod ? "Kartı eşleşmiş çalışan" : `${ayAdi(yil, ay)} ayrılan`}</small>
          <div className="sayi">{kisiler.length}</div>
          <div className="alt">{calisanMod ? (sube ? sube : "tüm şubeler") : "çıkış tarihi gelmiş personel"}</div>
        </div>
        <div className="bk-kutu">
          <small>Gönderilebilir</small>
          <div className="sayi" style={{ color: "var(--bk-yesilKoyu)" }}>{sayilar.gonderilebilir}</div>
          <div className="alt">kart eşleşmiş, bakiyeli, telefonu ve TC'si kayıtlı</div>
        </div>
        <div className="bk-kutu">
          <small>Gönderildi</small>
          <div className="sayi">{sayilar.gonderildi}</div>
          <div className="alt">
            <button className="bk-ay-link" onClick={takibeGec}>Kullanım takibine git →</button>
          </div>
        </div>
        <div className="bk-kutu">
          <small>Kartlardaki bakiye</small>
          <div className="sayi">{tl(toplamBakiye)}</div>
          <div className="alt">{sayilar.gonderilemez} kişi gönderilemez</div>
        </div>
      </div>

      <section className="bk-panel">
        <div className="bk-listeUst">
          <h3>
            {calisanMod ? "Çalışan personel" : ayAdi(yil, ay)}
            <span>{liste.length} kişi</span>
          </h3>
          <div className="bk-dugmeler">
            {calisanMod && (
              <Select
                allowClear
                showSearch
                placeholder="Tüm şubeler"
                value={sube}
                onChange={(v?: string) => {
                  setSube(v);
                  setSecili([]);
                }}
                options={(veri?.subeler ?? []).map((x) => ({ value: x, label: x }))}
                style={{ width: 190 }}
              />
            )}
            <label className="bk-girdi">
              <Search size={15} />
              <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Ad, sicil, şube, kart no" />
              {ara && (
                <button className="bk-d hayalet kucuk" style={{ padding: 0, height: 22 }} onClick={() => setAra("")}>
                  <X size={14} />
                </button>
              )}
            </label>
            {veri?.kartTanimlayabilir && !calisanMod && (
              <button className="bk-d bk-ay-kartDugme" onClick={() => setKartCekmece({ acik: true, sicil: null })}>
                <CreditCard size={15} /> Kart tanımla
              </button>
            )}
            <button className="bk-d" onClick={excel}>
              <Download size={15} /> Excel
            </button>
            <button className="bk-d" onClick={getir} disabled={yukleniyor}>
              <RefreshCw size={15} className={yukleniyor ? "bk-donen" : undefined} />
            </button>
          </div>
        </div>

        <div className="bk-suzgec">
          {(
            [
              ["tumu", "Tümü"],
              ["gonderilebilir", "Gönderilebilir"],
              ["gonderildi", "Gönderildi"],
              ["gonderilemez", "Gönderilemez"],
            ] as [GSuzgec, string][]
          ).map(([k, a]) => (
            <button key={k} className={`bk-cip ${suzgec === k ? "acik" : ""}`} onClick={() => setSuzgec(k)}>
              {a}
              <b>{sayilar[k]}</b>
            </button>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="bk-tablo bk-ay-tablo">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="bk-ay-kutu"
                    checked={hepsiSecili}
                    onChange={(e) => tumunuSec(e.target.checked)}
                    aria-label="Tümünü seç"
                  />
                </th>
                <th>Personel</th>
                {!calisanMod && <th>Çıkış</th>}
                <th>Telefon</th>
                <th>Kart</th>
                <th className="bk-sag">Bakiye</th>
                <th>Gönderim durumu</th>
              </tr>
            </thead>
            <tbody>
              {liste.length === 0 ? (
                <tr>
                  <td colSpan={calisanMod ? 6 : 7}>
                    <div className="bk-bos">
                      {kisiler.length === 0
                        ? calisanMod
                          ? "Kart eşleşmesi olan çalışan personel yok."
                          : `${ayAdi(yil, ay)} içinde çıkış tarihi gelmiş personel yok.`
                        : "Bu ölçütlere uyan personel yok."}
                    </div>
                  </td>
                </tr>
              ) : (
                liste.map((k) => {
                  const sec = secili.includes(k.sicil);

                  return (
                    <tr
                      key={k.sicil}
                      className={`${k.engel ? "bk-ay-soluk" : "tiklanir"} ${sec ? "bk-ay-secili" : ""}`}
                      onClick={() =>
                        !k.engel && setSecili((s) => (sec ? s.filter((x) => x !== k.sicil) : [...s, k.sicil]))
                      }
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="bk-ay-kutu"
                          disabled={!!k.engel}
                          checked={sec}
                          onChange={() => setSecili((s) => (sec ? s.filter((x) => x !== k.sicil) : [...s, k.sicil]))}
                          aria-label={`${k.adSoyad} seç`}
                        />
                      </td>
                      <td>
                        <div className="bk-kisi">
                          <span className={`bk-bas ${k.engel ? "soluk" : ""}`}>{bas(k.adSoyad)}</span>
                          <div style={{ minWidth: 0 }}>
                            <b><PersonelAdi kod={k.sicil}>{k.adSoyad}</PersonelAdi></b>
                            <small>
                              {k.sicil}
                              {k.pozisyon ? ` · ${k.pozisyon}` : ""} · {k.sube}
                            </small>
                          </div>
                        </div>
                      </td>
                      {!calisanMod && <td style={{ whiteSpace: "nowrap" }}>{gun(k.cikisTarihi)}</td>}
                      <td style={{ whiteSpace: "nowrap" }}>
                        {k.telefon ? telYaz(k.telefon) : <span className="bk-rozet bk-r-sari">Telefon yok</span>}
                      </td>
                      <td>
                        {k.kartNo || k.kartSon4 ? (
                          <span className="bk-ay-kartHucre">
                            <span className="bk-no">{kartYaz(k.kartNo, k.kartSon4)}</span>
                            {veri?.kartTanimlayabilir && !calisanMod && (
                              <button
                                type="button"
                                className="bk-ay-degistir"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setKartCekmece({ acik: true, sicil: k.sicil });
                                }}
                              >
                                Değiştir
                              </button>
                            )}
                          </span>
                        ) : veri?.kartTanimlayabilir && !calisanMod ? (
                          <button
                            type="button"
                            className="bk-ay-tanimla"
                            onClick={(e) => {
                              e.stopPropagation();
                              setKartCekmece({ acik: true, sicil: k.sicil });
                            }}
                          >
                            + Kart tanımla
                          </button>
                        ) : (
                          <span className="bk-ay-yok">kart eşleşmesi yok</span>
                        )}
                      </td>
                      <td className="bk-sag">
                        {k.bakiye === null ? (
                          <span style={{ color: "var(--bk-soluk)" }}>—</span>
                        ) : (
                          <span className="bk-para" style={{ color: k.bakiye > 0 ? "var(--bk-yesilKoyu)" : "var(--bk-pasif)" }}>
                            {tl(k.bakiye)}
                          </span>
                        )}
                      </td>
                      <td>
                        {k.engel && !k.link ? (
                          <span className="bk-rozet bk-r-gri">{k.engel}</span>
                        ) : k.link ? (
                          <div className="bk-ay-durumHucre">
                            <span className={`bk-rozet ${DURUM_RENK[k.link.durum] ?? "bk-r-gri"}`}>{k.link.durumAdi}</span>
                            <small>
                              {k.link.smsIlk
                                ? `${gunSaat(k.link.smsIlk)} · ${k.link.suresiDoldu ? "süresi doldu" : `${k.link.kalanGun} gün kaldı`}`
                                : k.link.smsHata
                                  ? k.link.smsHata
                                  : ""}
                            </small>
                          </div>
                        ) : (
                          <span className="bk-rozet bk-r-gri">Gönderilmedi</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Seçim çubuğu */}
      <div className={`bk-ay-secimCubugu ${secilenler.length > 0 ? "acik" : ""}`}>
        <div>
          <b>{secilenler.length} kişi seçildi</b>
          <small>
            {tl(secilenler.reduce((t, k) => t + (k.bakiye ?? 0), 0))} bakiye
            {tekrarSecilen.length > 0 ? ` · ${tekrarSecilen.length} kişiye daha önce gönderildi` : ""}
          </small>
        </div>
        <div className="bk-dugmeler">
          <button className="bk-d hayalet" onClick={() => setSecili([])}>Seçimi kaldır</button>
          {tekrarSecilen.length > 0 && (
            <button className="bk-d" onClick={() => setOnay({ tekrar: true, kisiler: tekrarSecilen })}>
              <RefreshCw size={15} /> Tekrar gönder ({tekrarSecilen.length})
            </button>
          )}
          <button
            className="bk-d birincil"
            disabled={yeniSecilen.length === 0}
            onClick={() => setOnay({ tekrar: false, kisiler: yeniSecilen })}
          >
            <Send size={15} /> SMS gönder ({yeniSecilen.length})
          </button>
        </div>
      </div>

      {/* Onay ve önizleme */}
      <Modal
        open={!!onay}
        title={onay?.tekrar ? "Bağlantı tekrar gönderilsin mi?" : "Kart bağlantısı SMS ile gönderilsin mi?"}
        okText={onay?.tekrar ? "Tekrar gönder" : "Gönder"}
        cancelText="Vazgeç"
        confirmLoading={gonderiliyor}
        onOk={() => onay && gonder(onay.tekrar, onay.kisiler)}
        onCancel={() => setOnay(null)}
        width={560}
      >
        {onay && veri && (
          <>
            <p style={{ marginTop: 4 }}>
              {calisanMod && <span className="bk-rozet bk-r-mavi" style={{ marginRight: 6 }}>Çalışan personel</span>}
              <b>{onay.kisiler.length} kişiye</b>{" "}
              {onay.tekrar
                ? "var olan bağlantıları yeniden gönderilecek. Geçerlilik süresi değişmez."
                : `kişiye özel kart bağlantısı gönderilecek. Bağlantı ilk SMS'ten itibaren ${veri.ayar.gecerlilikGunu} gün geçerli.`}
            </p>
            {ornek && (
              <div className="bk-ay-sms">
                <small>Örnek SMS · {ornek.adSoyad}</small>
                <div>
                  {smsOnizle(
                    calisanMod ? veri.ayar.calisanSmsSablonu : veri.ayar.smsSablonu,
                    ornek.adSoyad,
                    ornek.bakiye ?? 0,
                    veri.ornekAdres.replace("ABCD23456789", "XXXXXXXXXXXX"),
                    onay.tekrar ? ornek.link?.kalanGun ?? veri.ayar.gecerlilikGunu : veri.ayar.gecerlilikGunu
                  )}
                </div>
              </div>
            )}
            <p style={{ color: "var(--bk-pasif, #6b7280)", fontSize: 12.5, marginBottom: 0 }}>
              Kişi bağlantıyı açınca TC kimlik numarasıyla doğrular, kart şifresini belirler; kart numarası ve
              barkod ancak ondan sonra görünür.
            </p>
          </>
        )}
      </Modal>

      <SonucPenceresi sonuc={sonuc} kapat={() => setSonuc(null)} />
    </>
  );
}

function SonucPenceresi({ sonuc, kapat }: { sonuc: any; kapat: () => void }) {
  if (!sonuc) return null;

  const g = sonuc.gonderilen ?? [];
  const a = sonuc.atlanan ?? [];
  const h = sonuc.hatalar ?? [];

  return (
    <Modal open title="Gönderim sonucu" onCancel={kapat} onOk={kapat} okText="Tamam" cancelButtonProps={{ style: { display: "none" } }} width={600}>
      <div className="bk-ay-sonuc">
        <div className="yesil">
          <b>{g.length}</b> SMS gönderildi
        </div>
        <div className="sari">
          <b>{a.length}</b> atlandı
        </div>
        <div className="kirmizi">
          <b>{h.length}</b> hata
        </div>
      </div>

      {h.length > 0 && (
        <>
          <h4 className="bk-ay-altBaslik">SMS gönderilemeyenler</h4>
          <ul className="bk-ay-liste">
            {h.map((x: any, i: number) => (
              <li key={i}>
                <b><PersonelAdi kod={x.sicil}>{x.adSoyad}</PersonelAdi></b> <span>{x.hata}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {a.length > 0 && (
        <>
          <h4 className="bk-ay-altBaslik">Atlananlar</h4>
          <ul className="bk-ay-liste">
            {a.map((x: any, i: number) => (
              <li key={i}>
                <b><PersonelAdi kod={x.sicil}>{x.adSoyad}</PersonelAdi></b> <span>{x.sebep}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

/* ========================================================================== */
/* Takip                                                                      */
/* ========================================================================== */

function Takip({ yil, ay }: { yil: number; ay: number }) {
  const [tumAylar, setTumAylar] = useState(false);
  const [tur, setTur] = useState<"tumu" | Tur>("tumu");
  const [veri, setVeri] = useState<TakipVeri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [ara, setAra] = useState("");
  const [durum, setDurum] = useState<string>("tumu");
  const [secili, setSecili] = useState<number[]>([]);
  const [gecmis, setGecmis] = useState<Baglanti | null>(null);
  const [uzat, setUzat] = useState<Baglanti[] | null>(null);
  const [sil, setSil] = useState<Baglanti[] | null>(null);
  const [islem, setIslem] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const q = new URLSearchParams();
      if (!tumAylar) {
        q.set("yil", String(yil));
        q.set("ay", String(ay));
      }
      if (tur !== "tumu") q.set("tur", tur);
      const qs = q.toString();
      setVeri(await api.al<TakipVeri>(`/api/BicenKart/Ayrilan/Takip${qs ? `?${qs}` : ""}`));
      setHata("");
    } catch (h: any) {
      setHata(h?.message ?? "Takip listesi alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [yil, ay, tumAylar, tur]);

  useEffect(() => {
    setSecili([]);
    getir();
  }, [getir]);

  const satirlar = veri?.baglantilar ?? [];

  const liste = useMemo(() => {
    const q = kucuk(ara.trim());

    return satirlar
      .filter((b) => durum === "tumu" || b.durum === durum)
      .filter(
        (b) =>
          !q ||
          kucuk(b.adSoyad).includes(q) ||
          b.sicil.includes(q) ||
          kucuk(b.sube).includes(q) ||
          ((b.kartNo ?? "") + b.kartSon4).includes(q.replace(/\s/g, ""))
      );
  }, [satirlar, durum, ara]);

  const secilenler = satirlar.filter((b) => secili.includes(b.id));

  const hepsiSecili = liste.length > 0 && liste.every((b) => secili.includes(b.id));

  /* ----------------------------------------------------------- işlemler */

  const istek = async (yol: string, govde: any, basari: (c: any) => string) => {
    setIslem(true);

    try {
      const c = await api.gonder<any>(yol, govde);
      const uyari = [...(c.atlanan ?? []), ...(c.hatalar ?? []), ...(c.uyarilar ?? [])];

      message.success(basari(c));

      if (uyari.length > 0)
        Modal.warning({
          title: "Bazı satırlar işlenmedi",
          width: 560,
          content: (
            <ul className="bk-ay-liste">
              {uyari.map((x: any, i: number) => (
                <li key={i}>
                  <b>{x.adSoyad}</b> <span>{x.sebep ?? x.hata ?? x.uyari}</span>
                </li>
              ))}
            </ul>
          ),
        });

      setSecili([]);
      getir();
      return true;
    } catch (h: any) {
      message.error(h?.message ?? "İşlem yapılamadı.");
      return false;
    } finally {
      setIslem(false);
    }
  };

  const tekrarSms = (l: Baglanti[]) => {
    const uygun = l.filter((b) => !b.iptal && !b.birakildi && !b.suresiDoldu);

    if (uygun.length === 0) {
      message.info("Seçilenlerde tekrar gönderilebilecek bağlantı yok (süresi dolmuşsa önce süreyi uzatın).");
      return;
    }

    Modal.confirm({
      title: `${uygun.length} kişiye bağlantı tekrar gönderilsin mi?`,
      content: "Aynı bağlantı yeniden SMS ile gider. Geçerlilik süresi değişmez.",
      okText: "Tekrar gönder",
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          const c = await api.gonder<any>("/api/BicenKart/Ayrilan/Gonder", {
            siciller: Array.from(new Set(uygun.map((b) => b.sicil))),
            tekrar: true,
          });

          const hatali = [...(c.hatalar ?? []), ...(c.atlanan ?? [])];

          if (hatali.length === 0) message.success(`${c.gonderilen?.length ?? 0} SMS gönderildi.`);
          else
            Modal.warning({
              title: `${c.gonderilen?.length ?? 0} SMS gönderildi, ${hatali.length} kişi işlenmedi`,
              width: 560,
              content: (
                <ul className="bk-ay-liste">
                  {hatali.map((x: any, i: number) => (
                    <li key={i}>
                      <b>{x.adSoyad}</b> <span>{x.hata ?? x.sebep}</span>
                    </li>
                  ))}
                </ul>
              ),
            });

          setSecili([]);
          getir();
        } catch (h: any) {
          message.error(h?.message ?? "Gönderilemedi.");
        }
      },
    });
  };

  const iptalEt = (l: Baglanti[]) => {
    const uygun = l.filter((b) => !b.iptal);

    if (uygun.length === 0) return;

    let sifreSifirla = true;
    const ayrilanVar = uygun.some((b) => b.tur !== "calisan");

    Modal.confirm({
      title: `${uygun.length} bağlantı iptal edilsin mi?`,
      width: 500,
      content: (
        <div>
          <p>Bağlantı artık açılmaz; kişi "bağlantı iptal edildi" görür. Bakiye kartta kalır.</p>
          {uygun.some((b) => b.tur === "calisan") && (
            <p style={{ color: "#6b7280", fontSize: 12.5 }}>
              Çalışan personelin kart şifresine dokunulmaz; kartını Biçen360'ta kullanmaya devam eder.
            </p>
          )}
          {ayrilanVar && (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" defaultChecked onChange={(e) => (sifreSifirla = e.target.checked)} style={{ marginTop: 4 }} />
            <span>
              Ayrılan personelin kart şifresini de geçersiz kıl <small style={{ color: "#6b7280" }}>(önerilir: kişi kart numarasını bilse bile kasada harcama onaylanamaz)</small>
            </span>
          </label>
          )}
        </div>
      ),
      okText: "İptal et",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: () =>
        istek("/api/BicenKart/Ayrilan/Iptal", { idler: uygun.map((b) => b.id), sifreSifirla: ayrilanVar && sifreSifirla }, (c) =>
          `${c.iptal} bağlantı iptal edildi${c.sifreKilit ? `, ${c.sifreKilit} kartın şifresi kilitlendi` : ""}.`
        ),
    });
  };

  const kartBirak = (l: Baglanti[]) => {
    const uygun = l.filter((b) => !b.birakildi);

    if (uygun.length === 0) return;

    Modal.confirm({
      title: `${uygun.length} kart boşa çıkarılsın mı?`,
      width: 520,
      content: (
        <div>
          <CalisanUyarisi liste={uygun} />
          <p>
            Kart eşleşmesi silinir; MusteriKart'ta ad <b>BİÇEN KART</b> olur, telefon ve şifre temizlenir. Kart başka
            bir personele verilebilir. Bağlantı "kart boşa çıkarıldı" olur.
          </p>
          <p style={{ marginBottom: 0 }}>
            Kartta kalan bakiye: <b>{tl(uygun.reduce((t, b) => t + (b.bakiye ?? 0), 0))}</b> — silinmez; yeni sahibine
            geçmemesi için önce "Bakiyeyi sil" kullanabilirsiniz.
          </p>
        </div>
      ),
      okText: "Kartı boşa çıkar",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: () =>
        istek("/api/BicenKart/Ayrilan/KartBirak", { idler: uygun.map((b) => b.id) }, (c) => `${c.birakilan?.length ?? 0} kart boşa çıkarıldı.`),
    });
  };

  const kilitAc = (l: Baglanti[]) =>
    istek("/api/BicenKart/Ayrilan/KilitAc", { idler: l.map((b) => b.id) }, (c) => `${c.acilan} bağlantının kilidi açıldı.`);

  const kopyala = async (b: Baglanti) => {
    try {
      await navigator.clipboard.writeText(b.adres);
      message.success("Bağlantı kopyalandı.");
    } catch {
      Modal.info({ title: "Bağlantı adresi", content: <code style={{ wordBreak: "break-all" }}>{b.adres}</code> });
    }
  };

  const excel = async () => {
    try {
      await tabloIndir({
        baslik: "Biçen Kart · ayrılan personel kullanım takibi",
        altBaslik: `${tumAylar ? "Tüm aylar" : ayAdi(yil, ay)}${tur !== "tumu" ? ` · ${tur === "calisan" ? "Çalışan" : "Ayrılan"}` : ""} · ${new Date().toLocaleDateString("tr-TR")}`,
        sayfaAdi: "Kullanım takibi",
        dosyaAdi: `ayrilan-kart-takip-${tumAylar ? "tum" : `${yil}-${String(ay).padStart(2, "0")}`}.xlsx`,
        sutunlar: [
          { ad: "Sicil", genislik: 10 },
          { ad: "Ad soyad", genislik: 26 },
          { ad: "Şube", genislik: 22 },
          { ad: "Çıkış", tip: "tarih" },
          { ad: "Gönderim", tip: "tarihSaat" },
          { ad: "Gönderen", genislik: 16 },
          { ad: "Son geçerlilik", tip: "tarih" },
          { ad: "Kalan gün", tip: "sayi", toplam: false },
          { ad: "İlk açılış", tip: "tarihSaat" },
          { ad: "Şifre", tip: "tarihSaat" },
          { ad: "Gönderimdeki bakiye", tip: "para" },
          { ad: "Şimdiki bakiye", tip: "para" },
          { ad: "Harcanan", tip: "para" },
          { ad: "Kullanım %", tip: "sayi", toplam: false },
          { ad: "Son kullanım", tip: "tarihSaat" },
          { ad: "Tür", genislik: 10 },
          { ad: "Durum", genislik: 28 },
        ],
        satirlar: liste.map((b) => [
          b.sicil,
          b.adSoyad,
          b.sube ?? "",
          b.cikisTarihi,
          b.smsIlk ?? b.gonderim,
          b.gonderen ?? "",
          b.sonGecerlilik,
          b.kalanGun,
          b.ilkAcilis,
          b.sifreTarihi,
          b.gonderimBakiye,
          b.bakiye,
          b.harcanan,
          b.kullanimYuzde,
          b.sonKullanim,
          b.durumAdi,
          b.tur === "calisan" ? "Çalışan" : "Ayrılan",
        ]),
        genelToplam: true,
      });
    } catch (h: any) {
      message.error(h?.message ?? "Excel oluşturulamadı.");
    }
  };

  /* ------------------------------------------------------------- çizim */

  if (yukleniyor && !veri) return <div className="bk-panel bk-yukleniyor">Takip listesi yükleniyor…</div>;

  if (hata && !veri)
    return <Alert type="error" showIcon message="Takip listesi alınamadı" description={hata} />;

  const o = veri?.ozet;
  const durumlar = veri?.durumlar ?? {};
  const adlar = veri?.durumAdlari ?? {};

  const kpi: { ad: string; sayi: number; alt: string; renk?: string; suz?: string }[] = o
    ? [
        { ad: "Gönderildi", sayi: o.gonderildi, alt: `${tl(o.gonderilenBakiye)} bakiye` },
        { ad: "Açıldı", sayi: o.acildi, alt: o.gonderildi ? `%${Math.round((o.acildi / o.gonderildi) * 100)}` : "—" },
        { ad: "Şifre belirledi", sayi: o.sifreBelirledi, alt: "kart numarasını gördü", renk: "#6d4bc2", suz: "sifre" },
        { ad: "Kullanmaya başladı", sayi: o.kullanmayaBasladi, alt: `${tl(o.harcanan)} harcandı`, renk: "var(--bk-yesilKoyu)", suz: "kullaniyor" },
        { ad: "Bakiyesi bitti", sayi: o.tamamlandi, alt: "tamamlandı", renk: "#2f5d0a", suz: "tamamlandi" },
        { ad: "Süresi doldu", sayi: o.suresiDoldu, alt: tur === "calisan" ? "bağlantı kapandı" : tur === "ayrilan" ? "şifresi kilitlendi" : "bağlantı kapandı", renk: "var(--bk-turuncu)", suz: "sureDoldu" },
        { ad: "Kullanmadı", sayi: o.kullanmadi, alt: `${tl(o.kalanBakiye)} kartlarda`, renk: "var(--bk-pasif)" },
      ]
    : [];

  return (
    <>
      {veri?.posHatasi && (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message="Kart veritabanına ulaşılamadı"
          description={`Son bilinen bakiyeler gösteriliyor. ${veri.posHatasi}`}
        />
      )}

      <div className="bk-ay-kpi">
        {kpi.map((k) => (
          <button
            key={k.ad}
            className={`bk-kutu ${k.suz && durum === k.suz ? "secili" : ""}`}
            onClick={() => k.suz && setDurum(durum === k.suz ? "tumu" : k.suz)}
            disabled={!k.suz}
          >
            <small>{k.ad}</small>
            <div className="sayi" style={k.renk ? { color: k.renk } : undefined}>
              {k.sayi}
            </div>
            <div className="alt">{k.alt}</div>
          </button>
        ))}
      </div>

      <section className="bk-panel">
        <div className="bk-listeUst">
          <h3>
            {tumAylar ? "Tüm aylar" : ayAdi(yil, ay)}
            {tur !== "tumu" ? ` · ${tur === "calisan" ? "Çalışan" : "Ayrılan"}` : ""}
            <span>{liste.length} bağlantı</span>
          </h3>
          <div className="bk-dugmeler">
            <label className="bk-ay-anahtar">
              <input type="checkbox" checked={tumAylar} onChange={(e) => setTumAylar(e.target.checked)} />
              Tüm aylar
            </label>
            <label className="bk-girdi">
              <Search size={15} />
              <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Ad, sicil, şube, kart no" />
            </label>
            <button className="bk-d" onClick={excel}>
              <Download size={15} /> Excel
            </button>
            <button className="bk-d" onClick={getir} disabled={yukleniyor}>
              <RefreshCw size={15} className={yukleniyor ? "bk-donen" : undefined} />
            </button>
          </div>
        </div>

        <div className="bk-suzgec bk-ay-turSuzgec">
          <span className="bk-ay-suzgecAd">Tür</span>
          {(
            [
              ["tumu", "Tümü"],
              ["ayrilan", "Ayrılan"],
              ["calisan", "Çalışan"],
            ] as ["tumu" | Tur, string][]
          ).map(([k, a]) => (
            <button
              key={k}
              className={`bk-cip ${tur === k ? "acik" : ""}`}
              onClick={() => {
                setTur(k);
                setDurum("tumu");
              }}
            >
              {a}
              <b>{veri?.turSayilari?.[k] ?? 0}</b>
            </button>
          ))}
        </div>

        <div className="bk-suzgec">
          <span className="bk-ay-suzgecAd">Durum</span>
          <button className={`bk-cip ${durum === "tumu" ? "acik" : ""}`} onClick={() => setDurum("tumu")}>
            Tümü <b>{satirlar.length}</b>
          </button>
          {TAKIP_SIRA.filter((d) => (durumlar[d] ?? 0) > 0).map((d) => (
            <button key={d} className={`bk-cip ${durum === d ? "acik" : ""}`} onClick={() => setDurum(d)}>
              <i className={`bk-ay-nokta ${DURUM_RENK[d]}`} />
              {adlar[d] ?? d}
              <b>{durumlar[d]}</b>
            </button>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="bk-tablo bk-ay-tablo bk-ay-takip">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="bk-ay-kutu"
                    checked={hepsiSecili}
                    onChange={(e) =>
                      setSecili((s) =>
                        e.target.checked
                          ? Array.from(new Set([...s, ...liste.map((b) => b.id)]))
                          : s.filter((x) => !liste.some((b) => b.id === x))
                      )
                    }
                    aria-label="Tümünü seç"
                  />
                </th>
                <th>Personel</th>
                <th>Çıkış</th>
                <th>Gönderim</th>
                <th>Son geçerlilik</th>
                <th>İlk açılış</th>
                <th>Şifre</th>
                <th style={{ minWidth: 170 }}>Bakiye (gönderim → şimdi)</th>
                <th>Son kullanım</th>
                <th>Durum</th>
                <th className="bk-sag"></th>
              </tr>
            </thead>
            <tbody>
              {liste.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <div className="bk-bos">
                      {satirlar.length === 0
                        ? "Bu dönemde gönderilmiş bağlantı yok. Gönderim sekmesinden SMS gönderebilirsiniz."
                        : "Bu ölçütlere uyan bağlantı yok."}
                    </div>
                  </td>
                </tr>
              ) : (
                liste.map((b) => {
                  const sec = secili.includes(b.id);
                  const kapali = b.iptal || !!b.birakildi;

                  return (
                    <tr key={b.id} className={`${sec ? "bk-ay-secili" : ""} ${kapali ? "bk-ay-soluk" : ""}`}>
                      <td>
                        <input
                          type="checkbox"
                          className="bk-ay-kutu"
                          checked={sec}
                          onChange={() => setSecili((s) => (sec ? s.filter((x) => x !== b.id) : [...s, b.id]))}
                          aria-label={`${b.adSoyad} seç`}
                        />
                      </td>
                      <td>
                        <div className="bk-kisi">
                          <span className="bk-bas">{bas(b.adSoyad)}</span>
                          <div style={{ minWidth: 0 }}>
                            <b><PersonelAdi kod={b.sicil}>{b.adSoyad}</PersonelAdi></b>
                            <small>
                              {b.sube}
                              <span className={`bk-ay-tur ${b.tur === "calisan" ? "calisan" : ""}`}>
                                {b.tur === "calisan" ? "Çalışan" : "Ayrılan"}
                              </span>
                            </small>
                            <small className="bk-no" style={{ fontSize: 11.5, display: "block" }}>{kartYaz(b.kartNo, b.kartSon4)}</small>
                          </div>
                        </div>
                      </td>
                      <td className="bk-ay-tarih">{b.tur === "calisan" && !b.cikisTarihi ? <span className="bk-ay-tire">çalışıyor</span> : gun(b.cikisTarihi)}</td>
                      <td className="bk-ay-tarih">
                        {b.smsIlk ? (
                          <>
                            {gunSaat(b.smsIlk)}
                            <small>
                              {b.gonderen}
                              {b.smsSayisi > 1 ? ` · ${b.smsSayisi} SMS` : ""}
                            </small>
                          </>
                        ) : (
                          <Tooltip title={b.smsHata}>
                            <span className="bk-rozet bk-r-kirmizi bk-ay-tekSatir">SMS gitmedi</span>
                          </Tooltip>
                        )}
                      </td>
                      <td className="bk-ay-tarih">
                        {gun(b.sonGecerlilik)}
                        <small>
                          {b.suresiDoldu ? (
                            <span style={{ color: "var(--bk-turuncu)" }}>süresi doldu</span>
                          ) : (
                            <span className={b.kalanGun <= 5 ? "bk-ay-az" : undefined}>{b.kalanGun} gün kaldı</span>
                          )}
                          {b.uzatmaSayisi > 0 ? ` · ${b.uzatmaSayisi}× uzatıldı` : ""}
                        </small>
                      </td>
                      <td className="bk-ay-tarih">
                        {b.ilkAcilis ? (
                          <>
                            {gunSaat(b.ilkAcilis)}
                            <small>{b.kimlikDogrulama ? "kimlik doğrulandı" : "kimlik bekleniyor"}</small>
                          </>
                        ) : (
                          <span className="bk-ay-tire">—</span>
                        )}
                      </td>
                      <td className="bk-ay-tarih">
                        {b.sifreTarihi ? (
                          <>
                            {gunSaat(b.sifreTarihi)}
                            {!b.sifreGecerli && <small style={{ color: "var(--bk-turuncu)" }}>kilitlendi</small>}
                          </>
                        ) : (
                          <span className="bk-ay-tire">—</span>
                        )}
                      </td>
                      <td>
                        <div className="bk-ay-bakiye">
                          <span>{tl(b.gonderimBakiye)}</span>
                          <i>→</i>
                          <b style={{ color: (b.bakiye ?? 0) > 0 ? "var(--bk-metin)" : "var(--bk-pasif)" }}>{tl(b.bakiye)}</b>
                        </div>
                        <Tooltip title={`Harcanan ${tl(b.harcanan)}${b.silinen ? ` · silinen ${tl(b.silinen)}` : ""}`}>
                          <div className="bk-ay-kullanim">
                            <div className="bk-serit">
                              <i style={{ width: `${b.kullanimYuzde}%` }} />
                            </div>
                            <small>%{b.kullanimYuzde}</small>
                          </div>
                        </Tooltip>
                      </td>
                      <td className="bk-ay-tarih">
                        {b.sonKullanim ? gunSaat(b.sonKullanim) : <span className="bk-ay-tire">—</span>}
                      </td>
                      <td>
                        <span className={`bk-rozet ${DURUM_RENK[b.durum] ?? "bk-r-gri"}`}>{b.durumAdi}</span>
                        {b.kilitli && (
                          <small className="bk-ay-altYazi">{b.kilitBitis && new Date(b.kilitBitis).getFullYear() < 9000 ? `${gunSaat(b.kilitBitis)}'e kadar` : "panelden açılmalı"}</small>
                        )}
                      </td>
                      <td className="bk-sag">
                        <SatirIslemleri
                          b={b}
                          gecmis={() => setGecmis(b)}
                          kopyala={() => kopyala(b)}
                          tekrar={() => tekrarSms([b])}
                          uzat={() => setUzat([b])}
                          kilitAc={() => kilitAc([b])}
                          sil={() => setSil([b])}
                          iptal={() => iptalEt([b])}
                          birak={() => kartBirak([b])}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Toplu işlem çubuğu */}
      <div className={`bk-ay-secimCubugu ${secilenler.length > 0 ? "acik" : ""}`}>
        <div>
          <b>{secilenler.length} bağlantı seçildi</b>
          <small>{tl(secilenler.reduce((t, b) => t + (b.bakiye ?? 0), 0))} kartlarda</small>
        </div>
        <div className="bk-dugmeler">
          <button className="bk-d hayalet" onClick={() => setSecili([])}>Seçimi kaldır</button>
          <button className="bk-d" disabled={islem} onClick={() => tekrarSms(secilenler)}>
            <Send size={15} /> Tekrar SMS
          </button>
          <button className="bk-d" disabled={islem} onClick={() => setUzat(secilenler)}>
            <Clock size={15} /> Süreyi uzat
          </button>
          <button className="bk-d" disabled={islem} onClick={() => iptalEt(secilenler)}>
            <Ban size={15} /> İptal et
          </button>
          <button className="bk-d tehlike" disabled={islem} onClick={() => setSil(secilenler)}>
            <Eraser size={15} /> Bakiyeyi sil
          </button>
          <button className="bk-d tehlike" disabled={islem} onClick={() => kartBirak(secilenler)}>
            <Link2Off size={15} /> Kartı boşa çıkar
          </button>
        </div>
      </div>

      <UzatPenceresi
        liste={uzat}
        kapat={() => setUzat(null)}
        uzat={async (g) => {
          if (!uzat) return;
          const tamam = await istek("/api/BicenKart/Ayrilan/Uzat", { idler: uzat.map((b) => b.id), gun: g }, (c) =>
            `${c.uzatilan} bağlantının süresi ${g} gün uzatıldı.`
          );
          if (tamam) setUzat(null);
        }}
      />

      <SilPenceresi
        liste={sil}
        kapat={() => setSil(null)}
        sil={async (sebep) => {
          if (!sil) return;
          const tamam = await istek("/api/BicenKart/Ayrilan/BakiyeSil", { idler: sil.map((b) => b.id), sebep }, (c) =>
            `${c.silinen?.length ?? 0} kartın bakiyesi silindi (${tl((c.silinen ?? []).reduce((t: number, x: any) => t + (x.tutar ?? 0), 0))}).`
          );
          if (tamam) setSil(null);
        }}
      />

      <GecmisCekmecesi b={gecmis} kapat={() => setGecmis(null)} />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function SatirIslemleri(p: {
  b: Baglanti;
  gecmis: () => void;
  kopyala: () => void;
  tekrar: () => void;
  uzat: () => void;
  kilitAc: () => void;
  sil: () => void;
  iptal: () => void;
  birak: () => void;
}) {
  const { b } = p;
  const kapali = b.iptal || !!b.birakildi;

  const ogeler = [
    { key: "gecmis", icon: <History size={14} />, label: "Geçmiş", onClick: p.gecmis },
    { key: "kopyala", icon: <Copy size={14} />, label: "Bağlantıyı kopyala", onClick: p.kopyala, disabled: kapali },
    { type: "divider" as const },
    { key: "tekrar", icon: <Send size={14} />, label: "Tekrar SMS", onClick: p.tekrar, disabled: kapali || b.suresiDoldu },
    { key: "uzat", icon: <Clock size={14} />, label: "Süreyi uzat", onClick: p.uzat, disabled: kapali },
    ...(b.kilitli || b.hataliDeneme > 0
      ? [{ key: "kilit", icon: <Unlock size={14} />, label: "Kilidi aç", onClick: p.kilitAc }]
      : []),
    { type: "divider" as const },
    { key: "sil", icon: <Eraser size={14} />, label: "Bakiyeyi sil", onClick: p.sil, danger: true, disabled: !!b.birakildi || (b.bakiye ?? 0) <= 0 },
    { key: "iptal", icon: <Ban size={14} />, label: "Bağlantıyı iptal et", onClick: p.iptal, danger: true, disabled: b.iptal },
    { key: "birak", icon: <Link2Off size={14} />, label: "Kartı boşa çıkar", onClick: p.birak, danger: true, disabled: !!b.birakildi },
  ];

  return (
    <Dropdown menu={{ items: ogeler }} trigger={["click"]} placement="bottomRight">
      <button className="bk-d kucuk" aria-label="İşlemler" title="İşlemler">
        <MoreHorizontal size={16} />
      </button>
    </Dropdown>
  );
}

function UzatPenceresi({ liste, kapat, uzat }: { liste: Baglanti[] | null; kapat: () => void; uzat: (gun: number) => void }) {
  const [g, setG] = useState(7);
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => setG(7), [liste]);

  return (
    <Modal
      open={!!liste}
      title={`Süreyi uzat · ${liste?.length ?? 0} bağlantı`}
      okText={`${g} gün uzat`}
      cancelText="Vazgeç"
      confirmLoading={isleniyor}
      onCancel={kapat}
      onOk={async () => {
        setIsleniyor(true);
        await uzat(g);
        setIsleniyor(false);
      }}
    >
      <p>
        Süresi devam edenlerde bitiş tarihine, süresi dolmuş olanlarda bugüne eklenir. Süre dolunca kart şifresi
        kilitlenmişse kişi bağlantıdan TC ile yeniden doğrulayıp yeni şifre belirler.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {[7, 15, 30].map((n) => (
          <button key={n} className={`bk-cip ${g === n ? "acik" : ""}`} onClick={() => setG(n)}>
            +{n} gün
          </button>
        ))}
        <InputNumber min={1} max={90} value={g} onChange={(v) => setG(Number(v) || 1)} addonAfter="gün" style={{ width: 130 }} />
      </div>
    </Modal>
  );
}

function SilPenceresi({ liste, kapat, sil }: { liste: Baglanti[] | null; kapat: () => void; sil: (sebep: string) => void }) {
  const [sebep, setSebep] = useState("");
  const [onay, setOnay] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    setSebep("");
    setOnay("");
  }, [liste]);

  const toplam = (liste ?? []).reduce((t, b) => t + (b.bakiye ?? 0), 0);

  return (
    <Modal
      open={!!liste}
      title={<span style={{ color: "#cf1322" }}>Bakiye silinsin mi?</span>}
      okText="Bakiyeyi sil"
      okButtonProps={{ danger: true, disabled: sebep.trim().length < 3 || onay.trim().toLocaleUpperCase("tr-TR") !== "SİL" }}
      cancelText="Vazgeç"
      confirmLoading={isleniyor}
      onCancel={kapat}
      onOk={async () => {
        setIsleniyor(true);
        await sil(sebep.trim());
        setIsleniyor(false);
      }}
      width={520}
    >
      <CalisanUyarisi liste={liste ?? []} />
      <p>
        <b>{liste?.length ?? 0} kartta</b> kalan bakiyenin tamamı silinecek: toplam <b>{tl(toplam)}</b>. İşlem Puan
        Yönetimi'ndeki silmeyle aynıdır (Posback'e silme satırı yazılır, işlem geçmişine kaydedilir) ve geri alınamaz.
      </p>
      <label className="bk-ay-etiket">Silme sebebi</label>
      <Input.TextArea
        rows={2}
        value={sebep}
        onChange={(e) => setSebep(e.target.value)}
        placeholder="Ör. Kullanım süresi doldu, bakiye kullanılmadı"
        maxLength={300}
      />
      <label className="bk-ay-etiket" style={{ marginTop: 10 }}>
        Onay için <b>SİL</b> yazın
      </label>
      <Input value={onay} onChange={(e) => setOnay(e.target.value)} style={{ width: 140 }} />
    </Modal>
  );
}

const OLAY_ADI: Record<string, string> = {
  olusturuldu: "Bağlantı oluşturuldu",
  sms: "SMS gönderildi",
  sms_tekrar: "SMS tekrar gönderildi",
  sms_hata: "SMS gönderilemedi",
  acildi: "İlk açılış",
  kimlik: "Kimlik doğrulandı",
  tc_hatali: "Hatalı TC",
  kilit: "Kilitlendi",
  kilit_acildi: "Kilit açıldı",
  cihaz: "Yeni cihaz",
  cihaz_cikis: "Cihazdan çıkış",
  sifre: "Şifre belirlendi",
  sifre_degisti: "Şifre değişti",
  sifre_sifirlandi: "Eski şifre sıfırlandı",
  sifre_sifirlanamadi: "Eski şifre sıfırlanamadı",
  sifre_kilit: "Şifre kilitlendi",
  sifre_kilit_hata: "Şifre kilitlenemedi",
  gorsel: "Görsel indirildi",
  uzatildi: "Süre uzatıldı",
  iptal: "İptal edildi",
  kart_birakildi: "Kart boşa çıkarıldı",
  bakiye_silindi: "Bakiye silindi",
  suresi_doldu: "Süresi doldu",
};

function GecmisCekmecesi({ b, kapat }: { b: Baglanti | null; kapat: () => void }) {
  const [veri, setVeri] = useState<{ olaylar: any[]; cihazlar: any[] } | null>(null);

  useEffect(() => {
    if (!b) return;

    setVeri(null);
    api
      .al<{ olaylar: any[]; cihazlar: any[] }>(`/api/BicenKart/Ayrilan/${b.id}/Gecmis`)
      .then(setVeri)
      .catch((h) => message.error(h?.message ?? "Geçmiş alınamadı."));
  }, [b]);

  return (
    <Drawer open={!!b} onClose={kapat} width={460} title={b ? <><PersonelAdi kod={b.sicil}>{b.adSoyad}</PersonelAdi> · bağlantı geçmişi</> : ""}>
      {b && (
        <div className="bk-ay-gecmis">
          <dl className="bk-ay-bilgi">
            <dt>Kart</dt>
            <dd className="bk-no">{kartYaz(b.kartNo, b.kartSon4)}</dd>
            <dt>Telefon</dt>
            <dd>{telYaz(b.telefon)}</dd>
            <dt>Geçerlilik</dt>
            <dd>{gun(b.sonGecerlilik)} ({b.suresiDoldu ? "doldu" : `${b.kalanGun} gün`})</dd>
            <dt>Açılış</dt>
            <dd>{b.acilisSayisi} kez</dd>
            <dt>İndirme</dt>
            <dd>{b.indirmeSayisi} kez</dd>
            {b.smsHata && (
              <>
                <dt>Son SMS hatası</dt>
                <dd style={{ color: "#cf1322" }}>{b.smsHata}</dd>
              </>
            )}
          </dl>

          {!veri ? (
            <div className="bk-bos">Yükleniyor…</div>
          ) : (
            <>
              <h4 className="bk-ay-altBaslik">Olaylar</h4>
              <ul className="bk-ay-olaylar">
                {veri.olaylar.map((o, i) => (
                  <li key={i} className={`t-${o.tur}`}>
                    <i />
                    <div>
                      <b>{OLAY_ADI[o.tur] ?? o.tur}</b>
                      <span>{o.aciklama}</span>
                      <small>
                        {new Date(o.zaman).toLocaleString("tr-TR")}
                        {o.yapan ? ` · ${o.yapan}` : ""}
                        {o.ip ? ` · ${o.ip}` : ""}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>

              {veri.cihazlar.length > 0 && (
                <>
                  <h4 className="bk-ay-altBaslik">Tanınan cihazlar</h4>
                  <ul className="bk-ay-liste">
                    {veri.cihazlar.map((c, i) => (
                      <li key={i}>
                        <b>
                          <KeyRound size={13} /> {new Date(c.olusturma).toLocaleString("tr-TR")}
                        </b>
                        <span>
                          {c.iptal ? "kapatıldı" : `geçerli: ${gun(c.gecerlilik)}`} · {c.kullanimSayisi} kullanım ·{" "}
                          {(c.tarayici ?? "").slice(0, 60)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

function AyarPenceresi({ acik, kapat }: { acik: boolean; kapat: () => void }) {
  const [ayar, setAyar] = useState<{
    smsSablonu: string;
    calisanSmsSablonu: string;
    gecerlilikGunu: number;
    baglantiAdresi: string;
    otomatikGonder: boolean;
    otomatikGeriGun: number;
    otomatikSaatBas: number;
    otomatikSaatBit: number;
  } | null>(null);
  const [varsayilan, setVarsayilan] = useState("");
  const [varsayilanCalisan, setVarsayilanCalisan] = useState("");
  const [sablonTuru, setSablonTuru] = useState<Tur>("ayrilan");
  const [ornek, setOrnek] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    if (!acik) return;

    api
      .al<any>("/api/BicenKart/Ayrilan/Ayar")
      .then((a) => {
        setAyar({
          smsSablonu: a.smsSablonu,
          calisanSmsSablonu: a.calisanSmsSablonu ?? a.varsayilanCalisanSablon ?? "",
          gecerlilikGunu: a.gecerlilikGunu,
          baglantiAdresi: a.baglantiAdresi ?? "",
          otomatikGonder: a.otomatikGonder ?? true,
          otomatikGeriGun: a.otomatikGeriGun ?? 7,
          otomatikSaatBas: a.otomatikSaatBas ?? 10,
          otomatikSaatBit: a.otomatikSaatBit ?? 19,
        });
        setVarsayilan(a.varsayilanSablon);
        setVarsayilanCalisan(a.varsayilanCalisanSablon ?? "");
        setOrnek(a.ornekAdres);
      })
      .catch((h) => message.error(h?.message ?? "Ayar alınamadı."));
  }, [acik]);

  const kaydet = async () => {
    if (!ayar) return;

    setKaydediliyor(true);

    try {
      const a = await api.gonder<any>("/api/BicenKart/Ayrilan/Ayar", ayar);
      setOrnek(a.ornekAdres);
      message.success("Ayar kaydedildi.");
      kapat();
    } catch (h: any) {
      message.error(h?.message ?? "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const alan = sablonTuru === "calisan" ? "calisanSmsSablonu" : "smsSablonu";
  const onizleme = ayar ? smsOnizle(ayar[alan], "AYŞE YILMAZ", 1840, ornek || "https://kariyer.bicen.com.tr/#/kart/ABCD23456789", ayar.gecerlilikGunu) : "";

  return (
    <Modal
      open={acik}
      title="SMS ve süre ayarı"
      okText="Kaydet"
      cancelText="Vazgeç"
      onOk={kaydet}
      confirmLoading={kaydediliyor}
      onCancel={kapat}
      width={600}
    >
      {!ayar ? (
        <div className="bk-bos">Yükleniyor…</div>
      ) : (
        <>
          <div className="bk-ay-sablonUst">
            <label className="bk-ay-etiket" style={{ margin: 0 }}>SMS metni</label>
            <div className="bk-ay-bolum bk-ay-kucukSekme">
              <button className={sablonTuru === "ayrilan" ? "acik" : ""} onClick={() => setSablonTuru("ayrilan")}>
                Ayrılan personel
              </button>
              <button className={sablonTuru === "calisan" ? "acik" : ""} onClick={() => setSablonTuru("calisan")}>
                Çalışan personel
              </button>
            </div>
          </div>
          <Input.TextArea
            rows={4}
            value={ayar[alan]}
            maxLength={480}
            onChange={(e) => setAyar({ ...ayar, [alan]: e.target.value })}
          />
          <div className="bk-ay-ipucu">
            Yer tutucular: <code>{"{ad}"}</code> ilk ad, <code>{"{bakiye}"}</code> TL, <code>{"{link}"}</code> bağlantı
            (zorunlu), <code>{"{gun}"}</code> geçerlilik günü, <code>{"{tarih}"}</code> son geçerlilik tarihi.{" "}
            <button
              className="bk-ay-link"
              onClick={() => setAyar({ ...ayar, [alan]: sablonTuru === "calisan" ? varsayilanCalisan : varsayilan })}
            >
              Varsayılana dön
            </button>
          </div>

          <div className="bk-ay-sms" style={{ marginTop: 10 }}>
            <small>Önizleme · {onizleme.length} karakter</small>
            <div>{onizleme}</div>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
            <div>
              <label className="bk-ay-etiket">Geçerlilik süresi</label>
              <InputNumber
                min={1}
                max={365}
                value={ayar.gecerlilikGunu}
                onChange={(v) => setAyar({ ...ayar, gecerlilikGunu: Number(v) || 30 })}
                addonAfter="gün"
                style={{ width: 140 }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="bk-ay-etiket">Bağlantı adresi (kök)</label>
              <Input
                value={ayar.baglantiAdresi}
                placeholder="Boşsa Form Ayarları'ndaki anket adresi"
                onChange={(e) => setAyar({ ...ayar, baglantiAdresi: e.target.value })}
              />
            </div>
          </div>
          <div className="bk-ay-ipucu">
            Örnek bağlantı: <code>{ornek}</code>. Süre ilk başarılı SMS'ten itibaren sayılır; değişiklik yalnızca yeni
            gönderimlere uygulanır.
          </div>

          {/* 27.10.2026: işten ayrılana bağlantı SMS'i kendiliğinden */}
          <div style={{ marginTop: 16, padding: 12, border: "1px solid #e6e9e3", borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Switch checked={ayar.otomatikGonder} onChange={(v) => setAyar({ ...ayar, otomatikGonder: v })} />
              <b>İşten ayrılana otomatik gönder</b>
            </div>
            {ayar.otomatikGonder ? (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
                <div>
                  <label className="bk-ay-etiket">Çıkışı son</label>
                  <InputNumber
                    min={1}
                    max={30}
                    value={ayar.otomatikGeriGun}
                    onChange={(v) => setAyar({ ...ayar, otomatikGeriGun: Number(v) || 7 })}
                    addonAfter="gün"
                    style={{ width: 140 }}
                  />
                </div>
                <div>
                  <label className="bk-ay-etiket">Gönderim saatleri</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <InputNumber min={0} max={23} value={ayar.otomatikSaatBas} onChange={(v) => setAyar({ ...ayar, otomatikSaatBas: Number(v ?? 10) })} style={{ width: 70 }} />
                    <span>–</span>
                    <InputNumber min={1} max={24} value={ayar.otomatikSaatBit} onChange={(v) => setAyar({ ...ayar, otomatikSaatBit: Number(v ?? 19) })} style={{ width: 70 }} />
                    <span>arası</span>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="bk-ay-ipucu" style={{ marginTop: 8 }}>
              Çıkış tarihi gelen personele saat başı kontrolle, ayrılan SMS metniyle bağlantı gider. Yalnız çıkışı son
              {" "}{ayar.otomatikGeriGun} gün içinde olan ve adına daha önce bağlantı açılmamış kişilere; kart eşleşmesi, cep telefonu,
              TC ve bakiye yoksa gönderilmez (bakiye sonradan yüklenirse süre içinde gider). İptal ettiğiniz bağlantı yeniden gönderilmez.
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
