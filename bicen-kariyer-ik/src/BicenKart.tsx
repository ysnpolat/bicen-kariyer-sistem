/**
 * Biçen Kart
 * ---------------------------------------------------------------------------
 * Personele yüklenen puanların kartı yazarkasa tarafında duruyor. Bu
 * ekran kart işlemlerini karşılıyor: hangi personelin kartı var, kart
 * eşleştirme ve eşleşme kaldırma, şifre sıfırlama, bakiye ve harcama.
 *
 * 28.09.2026: Genius3 kullanılmıyor; kaynak PosbackPromosyon MusteriKart.
 * Eşleştirmede kartın Ad sütununa personelin adı soyadı, CepTel'e cep
 * telefonu yazılıyor. Tasarım panel temasıyla yeniden yapıldı: tek ekran,
 * solda şubeler, sağda personel; arama bütün şubelerde çalışıyor.
 *
 * Kart burada oluşturulmuyor. Kartlar fiziki olarak basılıp sisteme
 * giriliyor; buradan yapılan iş var olan bir kartı personele bağlamak ya
 * da bağı kaldırmak.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Space, Table, Typography, message } from "antd";
import {
  AlertTriangle,
  ArrowUp,
  BarChart3,
  Check,
  Coins,
  CreditCard,
  Download,
  Eye,
  Info,
  KeyRound,
  Layers,
  Link2,
  Link2Off,
  RefreshCw,
  Search,
  ShoppingCart,
  UserMinus,
  X,
} from "lucide-react";

import { tabloIndir } from "./raporExcel";
import { api, oturumOku } from "./api";
import BicenKartPuan, { KartPuanIslemleri } from "./BicenKartPuan";
import BicenKartRapor, { type RaporKart } from "./BicenKartRapor";
import BicenKartBekleyen from "./BicenKartBekleyen";
import BicenKartAyrilan from "./BicenKartAyrilan";
import PrimYukleme from "./PrimYukleme";
import "./BicenKart.css";
import { PersonelAdi } from "./personelKarti";

/* -------------------------------------------------------------------------- */

interface Personel {
  sicil: string;
  /** TC kimlik no; Excel çıktısında sicil yerine. Rol yetkisinde gizliyse maskeli. */
  tc?: string | null;
  adSoyad: string;
  sube: string;
  pozisyon: string | null;
  telefon: string | null;
  kartNo: string | null;
  kartBulunamadi: boolean;
  kartAdi: string | null;
  kartTelefon: string | null;
  mobilKart: boolean;
  sifreVar: boolean;
  bakiye: number | null;
  uyumsuz: boolean;
  /** İleri tarihli işten çıkış tarihi; varsa kart eşleştirilmez. */
  cikisTarihi?: string | null;
  eslestirilemez?: boolean;
}

interface Genel {
  personel: Personel[];
  subeler: { sube: string; personel: number; kartli: number }[];
  posHatasi: string | null;
  bakiyeOkundu: boolean;
}

interface AramaSonucu {
  kartNo: string;
  ad: string;
  telefon: string | null;
  mobilKart: boolean;
  sifreVar: boolean;
  kimde: { sicil: string; adSoyad: string; sube: string | null; aktif: boolean } | null;
}

type Suzgec = "tumu" | "kartli" | "kartsiz" | "sifresiz" | "telefonsuz" | "uyumsuz" | "ayrilacak";

/** "2026-10-15T00:00:00" → 15.10.2026 */
const gunYaz = (t?: string | null) => (t ? new Date(t).toLocaleDateString("tr-TR") : "");

/* -------------------------------------------------------------------------- */

/** 1992055659367382 → 1992 0556 5936 7382 */
const no4 = (d?: string | null) => (d ?? "").replace(/(.{4})/g, "$1 ").trim();

const tl = (d?: number | null) =>
  (d ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

/** 5321234567 → 0532 123 45 67 */
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

const kucuk = (s: string) => (s ?? "").toLocaleLowerCase("tr-TR");
const ust = (s: string) => (s ?? "").toLocaleUpperCase("tr-TR");

/** MusteriKart.Ad 30 hane: yazılacak ad önizlemede de kırpılmış görünsün */
const kartAdi = (ad: string) => ust(ad).slice(0, 30).trim();

const oranRengi = (o: number) =>
  o >= 90 ? { yazi: "var(--bk-yesilKoyu)", serit: "var(--bk-yesil)" }
  : o >= 60 ? { yazi: "var(--bk-sari)", serit: "#e0a73a" }
  : { yazi: "var(--bk-turuncu)", serit: "var(--bk-turuncu)" };

const SAYFA = 200;

/* ========================================================================== */

export default function BicenKart() {
  const [veri, setVeri] = useState<Genel | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");

  const [secSube, setSecSube] = useState<string | null>(null);
  const [subeAra, setSubeAra] = useState("");
  const [kisiAra, setKisiAra] = useState("");
  const [suzgec, setSuzgec] = useState<Suzgec>("tumu");
  const [gosterilen, setGosterilen] = useState(SAYFA);

  const [ayrintiKisi, setAyrintiKisi] = useState<Personel | null>(null);
  const [esleKisi, setEsleKisi] = useState<Personel | null>(null);
  const [kaldirKisi, setKaldirKisi] = useState<Personel | null>(null);
  const [toplu, setToplu] = useState(false);
  const [esitleniyor, setEsitleniyor] = useState(false);
  const [gorunum, setGorunum] = useState<"kartlar" | "puan" | "rapor" | "ayrilan" | "prim">("kartlar");

  const getir = useCallback(async (sessiz = false) => {
    if (!sessiz) setYukleniyor(true);

    try {
      setVeri(await api.al<Genel>("/api/BicenKart/Genel?bakiye=true"));
      setHata("");
    } catch (h: any) {
      setHata(h?.message ?? "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Esc bütün katmanları kapatır */
  useEffect(() => {
    const dinle = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAyrintiKisi(null);
      setEsleKisi(null);
      setKaldirKisi(null);
    };

    document.addEventListener("keydown", dinle);
    return () => document.removeEventListener("keydown", dinle);
  }, []);

  useEffect(() => setGosterilen(SAYFA), [secSube, kisiAra, suzgec]);

  const personel = veri?.personel ?? [];

  /* ------------------------------------------------------------ özet */
  const ozet = useMemo(() => {
    const kartli = personel.filter((p) => p.kartNo).length;

    return {
      toplam: personel.length,
      kartli,
      oran: personel.length ? Math.round((kartli / personel.length) * 100) : 0,
      kartsiz: personel.length - kartli,
      kartsizTelefonsuz: personel.filter((p) => !p.kartNo && !p.telefon).length,
      bakiye: personel.reduce((t, p) => t + (p.bakiye ?? 0), 0),
      uyumsuz: personel.filter((p) => p.uyumsuz || p.kartBulunamadi).length,
    };
  }, [personel]);

  /* ---------------------------------------------------------- şubeler */
  const subeler = useMemo(() => {
    const q = kucuk(subeAra.trim());
    return (veri?.subeler ?? []).filter((s) => !q || kucuk(s.sube).includes(q));
  }, [veri, subeAra]);

  /* ------------------------------------------------------------ liste */
  const subedekiler = useMemo(
    () => personel.filter((p) => !secSube || p.sube === secSube),
    [personel, secSube]
  );

  const sayilar = useMemo(
    () => ({
      tumu: subedekiler.length,
      kartli: subedekiler.filter((p) => p.kartNo).length,
      kartsiz: subedekiler.filter((p) => !p.kartNo).length,
      sifresiz: subedekiler.filter((p) => p.kartNo && !p.sifreVar).length,
      telefonsuz: subedekiler.filter((p) => !p.telefon).length,
      uyumsuz: subedekiler.filter((p) => p.uyumsuz || p.kartBulunamadi).length,
      ayrilacak: subedekiler.filter((p) => p.eslestirilemez).length,
    }),
    [subedekiler]
  );

  const liste = useMemo(() => {
    const ara = kucuk(kisiAra.trim());
    const rakam = ara.replace(/\s/g, "");

    return subedekiler
      .filter(
        (p) =>
          !ara ||
          kucuk(p.adSoyad).includes(ara) ||
          (rakam.length > 0 && /^\d+$/.test(rakam) &&
            ((p.sicil ?? "").includes(rakam) ||
              (p.telefon ?? "").includes(rakam.replace(/^0/, "")) ||
              (p.kartNo ?? "").includes(rakam)))
      )
      .filter((p) =>
        suzgec === "kartli" ? !!p.kartNo
        : suzgec === "kartsiz" ? !p.kartNo
        : suzgec === "sifresiz" ? !!p.kartNo && !p.sifreVar
        : suzgec === "telefonsuz" ? !p.telefon
        : suzgec === "uyumsuz" ? p.uyumsuz || p.kartBulunamadi
        : suzgec === "ayrilacak" ? !!p.eslestirilemez
        : true
      );
  }, [subedekiler, kisiAra, suzgec]);

  /* ---------------------------------------------------------- işlemler */

  const excel = async () => {
    try {
      await tabloIndir({
        baslik: "Biçen Kart · personel kartları",
        altBaslik: `${secSube ?? "Tüm şubeler"} · ${new Date().toLocaleDateString("tr-TR")}`,
        sayfaAdi: "Biçen Kart",
        dosyaAdi: `bicen-kart-${new Date().toISOString().slice(0, 10)}.xlsx`,
        sutunlar: [
          /* Sicil yerine TC kimlik no isteniyor */
          { ad: "TC Kimlik No", genislik: 14 },
          { ad: "Ad soyad", genislik: 26 },
          { ad: "Şube", genislik: 22 },
          { ad: "Görev", genislik: 22 },
          { ad: "Telefon", genislik: 15 },
          { ad: "Kart no", genislik: 22 },
          { ad: "Kart türü", genislik: 12 },
          { ad: "Şifre", genislik: 10 },
          { ad: "Bakiye", tip: "para", genislik: 14 },
        ],
        satirlar: liste.map((p) => [
          p.tc ?? "",
          p.adSoyad,
          p.sube,
          p.pozisyon ?? "",
          telYaz(p.telefon),
          no4(p.kartNo),
          p.kartNo ? (p.mobilKart ? "Mobil" : "Fiziki") : "Kart yok",
          p.kartNo ? (p.sifreVar ? "Var" : "Yok") : "",
          p.bakiye ?? null,
        ]),
        genelToplam: true,
      });
    } catch (h: any) {
      message.error(h?.message ?? "Excel oluşturulamadı.");
    }
  };

  const esitle = () => {
    Modal.confirm({
      title: "Kart bilgileri eşitlensin mi?",
      width: 480,
      content: (
        <Typography.Paragraph style={{ marginTop: 8 }}>
          {secSube ? <b>{secSube}</b> : "Bütün şubelerdeki"} eşleşmiş kartların MusteriKart kaydına
          personelin <b>adı soyadı</b> (Ad), <b>cep telefonu</b> (CepTel) yazılır ve kart mobil karta
          çevrilir. Bakiye ve hareketler değişmez.
        </Typography.Paragraph>
      ),
      okText: "Eşitle",
      cancelText: "Vazgeç",
      onOk: async () => {
        setEsitleniyor(true);

        try {
          const c = await api.gonder<any>(
            `/api/BicenKart/BilgiEsitle${secSube ? `?sube=${encodeURIComponent(secSube)}` : ""}`
          );

          if (c.bulunamayan > 0) {
            Modal.warning({
              title: `${c.yazilan} kart eşitlendi, ${c.bulunamayan} kart bulunamadı`,
              width: 620,
              content: (
                <Table
                  size="small"
                  rowKey="kartNo"
                  pagination={false}
                  dataSource={c.sonuclar ?? []}
                  columns={[
                    { title: "Kart no", dataIndex: "kartNo", render: (d: string) => no4(d) },
                    { title: "Personel", dataIndex: "adSoyad" },
                    { title: "Sebep", dataIndex: "hata" },
                  ]}
                />
              ),
            });
          } else {
            message.success(`${c.yazilan} kartın bilgisi MusteriKart'ta güncellendi.`);
          }

          getir(true);
        } catch (h: any) {
          message.error(h?.message ?? "Eşitlenemedi.");
        } finally {
          setEsitleniyor(false);
        }
      },
    });
  };

  const topluAc = () => {
    if (!secSube) {
      message.info("Toplu eşleştirme için önce soldan bir şube seçin.");
      return;
    }

    setToplu(true);
  };

  /* ------------------------------------------------------------ çizim */

  const ustSekme = (
    <div className="bk-usekme">
      <button className={gorunum === "kartlar" ? "acik" : ""} onClick={() => setGorunum("kartlar")}>
        <CreditCard size={15} /> Kartlar
      </button>
      <button className={gorunum === "puan" ? "acik" : ""} onClick={() => setGorunum("puan")}>
        <Coins size={15} /> Puan Yönetimi
      </button>
      <button className={gorunum === "rapor" ? "acik" : ""} onClick={() => setGorunum("rapor")}>
        <BarChart3 size={15} /> Kart raporları
      </button>
      <button className={gorunum === "ayrilan" ? "acik" : ""} onClick={() => setGorunum("ayrilan")}>
        <UserMinus size={15} /> Kart Bağlantıları
      </button>
      <button className={gorunum === "prim" ? "acik" : ""} onClick={() => setGorunum("prim")}>
        <Coins size={15} /> Prim Yükleme
      </button>
    </div>
  );

  /* Rapordan tıklanan kart: listedeki personel kaydıyla açılıyor; listede
     yoksa (ayrılmış personel) rapordaki bilgilerle */
  const raporKartiAc = (r: RaporKart) => {
    const p = personel.find((x) => x.kartNo === r.kartNo);

    setAyrintiKisi(
      p ?? {
        sicil: r.sicil ?? "",
        adSoyad: r.adSoyad ?? no4(r.kartNo),
        sube: r.sube ?? "",
        pozisyon: null,
        telefon: null,
        kartNo: r.kartNo,
        kartBulunamadi: false,
        kartAdi: null,
        kartTelefon: null,
        mobilKart: false,
        sifreVar: false,
        bakiye: null,
        uyumsuz: false,
      }
    );
  };

  /* Kart ayrıntısı ve eşleşme kaldırma üç görünümde de açılabiliyor */
  const ayrintiKatmani = (
    <>
      <Ayrinti
        kisi={ayrintiKisi}
        kapat={() => setAyrintiKisi(null)}
        kaldir={(p) => {
          setAyrintiKisi(null);
          setKaldirKisi(p);
        }}
        degisti={() => getir(true)}
      />

      <Kaldir
        kisi={kaldirKisi}
        kapat={() => setKaldirKisi(null)}
        bitti={() => {
          setKaldirKisi(null);
          getir(true);
        }}
      />
    </>
  );

  /* Kart raporları */
  if (gorunum === "rapor")
    return (
      <div className="bk">
        <div className="bk-baslik">
          <div>
            <h2>
              <CreditCard size={22} color="var(--bk-yesilKoyu)" />
              Biçen Kart
            </h2>
            <p>Kart raporları: bakiyeler, şubelere göre harcama, aylık hareket · bakiye Posback hesabıyla</p>
          </div>
        </div>
        {ustSekme}
        <BicenKartBekleyen git={setGorunum} />
        <BicenKartRapor kartAc={raporKartiAc} />
        {ayrintiKatmani}
      </div>
    );

  /* Ayrılan personel kartları: SMS bağlantısı ve kullanım takibi */
  if (gorunum === "ayrilan")
    return (
      <div className="bk">
        <div className="bk-baslik">
          <div>
            <h2>
              <CreditCard size={22} color="var(--bk-yesilKoyu)" />
              Biçen Kart
            </h2>
            <p>Ayrılan ve çalışan personele SMS ile kişiye özel kart bağlantısı · kullanım takibi</p>
          </div>
        </div>
        {ustSekme}
        <BicenKartAyrilan />
      </div>
    );

  /* Prim hak edişi yüklemesi (21.10.2026) */
  if (gorunum === "prim")
    return (
      <div className="bk">
        <div className="bk-baslik">
          <div>
            <h2>
              <CreditCard size={22} color="var(--bk-yesilKoyu)" />
              Biçen Kart
            </h2>
            <p>Prim hak edişini dönem seçerek kartlara yükleyin · Admin onaylı · ayrılan personele otomatik kart bağlantısı</p>
          </div>
        </div>
        {ustSekme}
        <div className="bk-panel" style={{ padding: 14 }}>
          <PrimYukleme />
        </div>
      </div>
    );

  /* Puan Yönetimi kart listesinden bağımsız: liste alınamasa da açılır */
  if (gorunum === "puan")
    return (
      <div className="bk">
        <div className="bk-baslik">
          <div>
            <h2>
              <CreditCard size={22} color="var(--bk-yesilKoyu)" />
              Biçen Kart
            </h2>
            <p>Puan yükleme (Admin onaylı), transfer ve bakiye silme · kaynak: PosbackPromosyon PuanHareket</p>
          </div>
        </div>
        {ustSekme}
        <BicenKartPuan />
        {ayrintiKatmani}
      </div>
    );

  if (yukleniyor && !veri)
    return (
      <div className="bk">
        {ustSekme}
        <div className="bk-panel bk-yukleniyor">Kartlar yükleniyor…</div>
      </div>
    );

  if (hata && !veri)
    return (
      <div className="bk">
        {ustSekme}
        <Alert type="error" showIcon message="Biçen Kart listesi alınamadı" description={hata} />
        <Button style={{ marginTop: 12 }} onClick={() => getir()}>
          Yeniden dene
        </Button>
      </div>
    );

  const tumSubelerOran = ozet.oran;

  return (
    <div className="bk">
      <div className="bk-baslik">
        <div>
          <h2>
            <CreditCard size={22} color="var(--bk-yesilKoyu)" />
            Biçen Kart
          </h2>
          <p>Personel kartları, bakiyeler ve eşleştirme · kaynak: PosbackPromosyon MusteriKart</p>
        </div>
        <div className="bk-dugmeler">
          <button className="bk-d" onClick={excel}>
            <Download size={15} />
            Excel'e aktar
          </button>
          <button className="bk-d" onClick={esitle} disabled={esitleniyor}>
            <RefreshCw size={15} className={esitleniyor ? "bk-donen" : undefined} />
            Kart bilgilerini eşitle
          </button>
          <button className="bk-d birincil" onClick={topluAc}>
            <Layers size={15} />
            Toplu eşleştir
          </button>
        </div>
      </div>

      {ustSekme}

      <KasaDogrulama yenile={() => getir(true)} />

      {veri?.posHatasi && (
        <Alert
          style={{ marginBottom: 14 }}
          type="warning"
          showIcon
          message="Kart veritabanına ulaşılamadı"
          description={`Eşleşmeler gösteriliyor; bakiye ve şifre bilgisi okunamadı. ${veri.posHatasi}`}
        />
      )}

      {/* ------------------------------------------------------------ özet */}
      <div className="bk-ozet">
        <div className="bk-kutu">
          <small>Personel</small>
          <div className="sayi">{ozet.toplam}</div>
          <div className="alt">{veri?.subeler?.length ?? 0} şube</div>
        </div>
        <div className="bk-kutu">
          <small>Kartı eşleşmiş</small>
          <div className="sayi" style={{ color: "var(--bk-yesilKoyu)" }}>
            {ozet.kartli} <span>%{ozet.oran}</span>
          </div>
          <div className="bk-serit">
            <i style={{ width: `${ozet.oran}%` }} />
          </div>
        </div>
        <div className="bk-kutu">
          <small>Kartsız</small>
          <div className="sayi" style={{ color: "var(--bk-turuncu)" }}>
            {ozet.kartsiz}
          </div>
          <div className="alt">{ozet.kartsizTelefonsuz} kişinin telefonu da yok</div>
        </div>
        <div className="bk-kutu">
          <small>Toplam bakiye</small>
          <div className="sayi">{veri?.bakiyeOkundu ? tl(ozet.bakiye) : "—"}</div>
          <div className="alt">
            {ozet.uyumsuz > 0 ? `${ozet.uyumsuz} kartın kaydı personelle uyuşmuyor` : "eşleşmiş kartlarda"}
          </div>
        </div>
      </div>

      <div className="bk-govde">
        {/* --------------------------------------------------------- şubeler */}
        <section className="bk-panel bk-subeler">
          <div className="ara">
            <label className="bk-girdi">
              <Search size={15} />
              <input value={subeAra} onChange={(e) => setSubeAra(e.target.value)} placeholder="Şube ara" />
            </label>
          </div>
          <div className="bk-subeListe">
            {!subeAra.trim() && (
              <SubeSatiri
                ad="Tüm şubeler"
                toplam={ozet.toplam}
                kartli={ozet.kartli}
                oran={tumSubelerOran}
                secili={secSube === null}
                sec={() => setSecSube(null)}
              />
            )}
            {subeler.map((s) => (
              <SubeSatiri
                key={s.sube}
                ad={s.sube}
                toplam={s.personel}
                kartli={s.kartli}
                oran={s.personel ? Math.round((s.kartli / s.personel) * 100) : 0}
                secili={secSube === s.sube}
                sec={() => setSecSube(s.sube)}
              />
            ))}
            {subeler.length === 0 && subeAra.trim() && <div className="bk-bos">Şube bulunamadı.</div>}
          </div>
        </section>

        {/* ------------------------------------------------------- personel */}
        <section className="bk-panel">
          <div className="bk-listeUst">
            <h3>
              {secSube ?? "Tüm şubeler"}
              <span>{liste.length} kişi</span>
            </h3>
            <label className="bk-girdi" style={{ width: "min(340px, 100%)" }}>
              <Search size={15} />
              <input
                value={kisiAra}
                onChange={(e) => setKisiAra(e.target.value)}
                placeholder="Ad, sicil, telefon ya da kart no"
              />
              {kisiAra && (
                <button className="bk-d hayalet kucuk" style={{ padding: 0, height: 22 }} onClick={() => setKisiAra("")}>
                  <X size={14} />
                </button>
              )}
            </label>
          </div>

          <div className="bk-suzgec">
            {(
              [
                ["tumu", "Tümü"],
                ["kartli", "Kartlı"],
                ["kartsiz", "Kartsız"],
                ["sifresiz", "Şifresiz"],
                ["telefonsuz", "Telefonsuz"],
                ...(sayilar.uyumsuz > 0 ? [["uyumsuz", "Kaydı uyuşmayan"]] : []),
                ...(sayilar.ayrilacak > 0 ? [["ayrilacak", "Çıkışı girilmiş"]] : []),
              ] as [Suzgec, string][]
            ).map(([k, a]) => (
              <button key={k} className={`bk-cip ${suzgec === k ? "acik" : ""}`} onClick={() => setSuzgec(k)}>
                {a}
                <b>{sayilar[k]}</b>
              </button>
            ))}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="bk-tablo">
              <thead>
                <tr>
                  <th>Personel</th>
                  <th>Kart no</th>
                  <th className="bk-sag">Bakiye</th>
                  <th className="bk-gizMobil">Telefon</th>
                  <th className="bk-gizMobil">Şifre</th>
                  <th className="bk-sag">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {liste.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="bk-bos">Bu ölçütlere uyan personel yok.</div>
                    </td>
                  </tr>
                ) : (
                  liste.slice(0, gosterilen).map((p) => (
                    <tr
                      key={p.sicil}
                      className={p.kartNo ? "tiklanir" : undefined}
                      onClick={() => p.kartNo && setAyrintiKisi(p)}
                    >
                      <td>
                        <div className="bk-kisi">
                          <span className={`bk-bas ${p.kartNo ? "" : "soluk"}`}>{bas(p.adSoyad)}</span>
                          <div style={{ minWidth: 0 }}>
                            <b><PersonelAdi kod={p.sicil}>{p.adSoyad}</PersonelAdi></b>
                            <small>
                              {p.sicil}
                              {p.pozisyon ? ` · ${p.pozisyon}` : ""}
                              {secSube ? "" : ` · ${p.sube}`}
                            </small>
                            {p.eslestirilemez && (
                              <span
                                className="bk-rozet bk-r-kirmizi"
                                style={{ marginTop: 4, display: "inline-block" }}
                                title="İleri tarihli işten çıkış tarihi girilmiş; kart eşleştirilemez."
                              >
                                Çıkış {gunYaz(p.cikisTarihi)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {p.kartNo ? (
                          <>
                            <span className="bk-no">{no4(p.kartNo)}</span>
                            {p.kartBulunamadi ? (
                              <div>
                                <span className="bk-rozet bk-r-kirmizi" title="Bu numara MusteriKart'ta yok">
                                  MusteriKart'ta yok
                                </span>
                              </div>
                            ) : p.uyumsuz ? (
                              <div>
                                <span
                                  className="bk-rozet bk-r-sari"
                                  title={`Kartta: ${p.kartAdi || "—"} · ${telYaz(p.kartTelefon) || "telefon yok"}${
                                    p.mobilKart ? "" : " · fiziki kart"
                                  }`}
                                >
                                  Kart kaydı farklı
                                </span>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="bk-rozet bk-r-turuncu">Kart yok</span>
                        )}
                      </td>
                      <td className="bk-sag">
                        {p.kartNo && p.bakiye !== null ? (
                          <span
                            className="bk-para"
                            style={{ color: (p.bakiye ?? 0) > 0 ? "var(--bk-yesilKoyu)" : "var(--bk-pasif)" }}
                          >
                            {tl(p.bakiye)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--bk-soluk)" }}>—</span>
                        )}
                      </td>
                      <td className="bk-gizMobil">
                        {p.telefon ? (
                          <span style={{ whiteSpace: "nowrap" }}>{telYaz(p.telefon)}</span>
                        ) : (
                          <span className="bk-rozet bk-r-sari">Telefon yok</span>
                        )}
                      </td>
                      <td className="bk-gizMobil">
                        {!p.kartNo ? (
                          <span style={{ color: "var(--bk-soluk)" }}>—</span>
                        ) : p.sifreVar ? (
                          <span className="bk-rozet bk-r-yesil">Var</span>
                        ) : (
                          <span className="bk-rozet bk-r-gri">Yok</span>
                        )}
                      </td>
                      <td className="bk-sag">
                        <div className="bk-islemler" onClick={(e) => e.stopPropagation()}>
                          {p.kartNo ? (
                            <>
                              <button className="bk-d kucuk" onClick={() => setAyrintiKisi(p)}>
                                <Eye size={14} />
                                Ayrıntı
                              </button>
                              <button className="bk-d kucuk tehlike" onClick={() => setKaldirKisi(p)}>
                                <Link2Off size={14} />
                                Kaldır
                              </button>
                            </>
                          ) : p.eslestirilemez ? (
                            <button
                              className="bk-d kucuk"
                              disabled
                              title={`Çıkış tarihi ${gunYaz(p.cikisTarihi)} olarak girilmiş; bu personele kart eşleştirilemez.`}
                            >
                              <Link2Off size={14} />
                              Eşleştirilemez
                            </button>
                          ) : (
                            <button className="bk-d kucuk birincil" onClick={() => setEsleKisi(p)}>
                              <Link2 size={14} />
                              Kart eşleştir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {liste.length > gosterilen && (
            <div className="bk-dahaFazla">
              <button className="bk-d" onClick={() => setGosterilen((g) => g + SAYFA)}>
                {liste.length - gosterilen} kişi daha göster
              </button>
            </div>
          )}
        </section>
      </div>

      {/* -------------------------------------------------------- katmanlar */}
      {ayrintiKatmani}

      <Eslestir
        kisi={esleKisi}
        personel={personel}
        kapat={() => setEsleKisi(null)}
        bitti={() => {
          setEsleKisi(null);
          getir(true);
        }}
      />

      {toplu && secSube && (
        <TopluEslesme
          sube={secSube}
          kapat={() => setToplu(false)}
          bitti={() => {
            setToplu(false);
            getir(true);
          }}
        />
      )}
    </div>
  );
}

/* ========================================================================== */

function SubeSatiri({
  ad,
  toplam,
  kartli,
  oran,
  secili,
  sec,
}: {
  ad: string;
  toplam: number;
  kartli: number;
  oran: number;
  secili: boolean;
  sec: () => void;
}) {
  const r = oranRengi(oran);

  return (
    <button className={`bk-sube ${secili ? "secili" : ""}`} onClick={sec}>
      <div className="s1">
        <b>{ad}</b>
        <span style={{ color: r.yazi }}>%{oran}</span>
      </div>
      <div className="s2">
        {toplam} personel · {toplam - kartli} kartsız
      </div>
      <div className="bk-serit">
        <i style={{ width: `${oran}%`, background: r.serit }} />
      </div>
    </button>
  );
}

/* ========================================================================== */
/* Ayrıntı çekmecesi                                                          */
/* ========================================================================== */

function Ayrinti({
  kisi,
  kapat,
  kaldir,
  degisti,
}: {
  kisi: Personel | null;
  kapat: () => void;
  kaldir: (p: Personel) => void;
  degisti: () => void;
}) {
  const [veri, setVeri] = useState<any>(null);
  const [hata, setHata] = useState("");
  const [sifreIsleniyor, setSifreIsleniyor] = useState(false);

  useEffect(() => {
    if (!kisi?.kartNo) return;

    setVeri(null);
    setHata("");

    api
      .al<any>(`/api/BicenKart/Kart/${encodeURIComponent(kisi.kartNo)}?gun=180`)
      .then(setVeri)
      .catch((h) => setHata(h?.message ?? "Kart bilgisi alınamadı."));
  }, [kisi]);

  const acik = !!kisi;
  const kart = veri?.kart;
  const hareketler: any[] = veri?.hareketler ?? [];
  const harcama = hareketler.filter((h) => h.tip === 2).reduce((t, h) => t + Number(h.tutar ?? 0), 0);
  const subeler: any[] = veri?.subeler ?? [];
  const enCok = Math.max(1, ...subeler.map((s) => Number(s.tutar ?? 0)));

  const sifreSifirla = () => {
    if (!kisi?.kartNo) return;

    Modal.confirm({
      title: "Kart şifresi sıfırlansın mı?",
      content: `${kisi.adSoyad} uygulamadan yeni şifre belirleyene kadar kartla şifreli ödeme yapamaz.`,
      okText: "Sıfırla",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        setSifreIsleniyor(true);

        try {
          await api.gonder("/api/BicenKart/Sifre", { kartNo: kisi.kartNo, sifre: "" });
          message.success(`${kisi.adSoyad} için kart şifresi sıfırlandı.`);
          setVeri((v: any) => (v ? { ...v, kart: { ...v.kart, sifreVar: false } } : v));
          degisti();
        } catch (h: any) {
          message.error(h?.message ?? "Şifre sıfırlanamadı.");
        } finally {
          setSifreIsleniyor(false);
        }
      },
    });
  };

  return (
    <div className="bk-katman">
      <div className={`bk-perde ${acik ? "acik" : ""}`} onClick={kapat} />

      <aside className={`bk-cekmece ${acik ? "acik" : ""}`} aria-hidden={!acik}>
        {kisi && (
          <>
            <div className="bk-cUst">
              <span className="bk-bas">{bas(kisi.adSoyad)}</span>
              <div>
                <b><PersonelAdi kod={kisi.sicil}>{kisi.adSoyad}</PersonelAdi></b>
                <small>
                  {kisi.sicil}
                  {kisi.pozisyon ? ` · ${kisi.pozisyon}` : ""} · {kisi.sube}
                </small>
              </div>
              <button className="bk-d hayalet kucuk" onClick={kapat} aria-label="Kapat">
                <X size={16} />
              </button>
            </div>

            <div className="bk-cGovde">
              {hata ? (
                <Alert type="error" showIcon message="Kart bilgisi alınamadı" description={hata} />
              ) : !veri ? (
                <div className="bk-bos">Kart bilgisi yükleniyor…</div>
              ) : (
                <>
                  <div className={`bk-kartGorsel ${kart?.mobilKart ? "" : "fiziki"}`}>
                    <div className="ust1">
                      <div className="logo">
                        biçen<span>kart</span>
                      </div>
                      <span className="tip">{kart?.mobilKart ? "MOBİL" : "FİZİKİ"}</span>
                    </div>
                    <div className="cip2" />
                    <div className="kno">{no4(kart?.kartNo)}</div>
                    <div className="sahip">
                      <div style={{ minWidth: 0 }}>
                        <small>KART SAHİBİ</small>
                        <b>{kart?.ad || kisi.adSoyad.toLocaleUpperCase("tr-TR")}</b>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <small>BAKİYE</small>
                        <b>{tl(kart?.bakiye)}</b>
                      </div>
                    </div>
                  </div>

                  <div className="bk-ucl">
                    <div>
                      <small>Bakiye</small>
                      <b style={{ color: "var(--bk-yesilKoyu)" }}>{tl(kart?.bakiye)}</b>
                    </div>
                    <div>
                      <small>Son 180 gün harcama</small>
                      <b>{tl(harcama)}</b>
                    </div>
                    <div>
                      <small>İşlem</small>
                      <b>{hareketler.length}</b>
                    </div>
                  </div>

                  <div className="bk-bolum">Kart kaydı (MusteriKart)</div>
                  <dl className="bk-bilgi">
                    <dt>Ad</dt>
                    <dd>{kart?.ad || "—"}</dd>
                    <dt>CepTel</dt>
                    <dd>
                      {kart?.telefon ? telYaz(kart.telefon) : <span className="bk-rozet bk-r-sari">Telefon yok</span>}
                    </dd>
                    <dt>Kart türü</dt>
                    <dd>{kart?.mobilKart ? `Mobil kart (grup ${kart?.grupNo ?? 608})` : "Fiziki kart"}</dd>
                    <dt>Şifre</dt>
                    <dd>
                      {kart?.sifreVar ? (
                        <span className="bk-rozet bk-r-yesil">Belirlenmiş</span>
                      ) : (
                        <span className="bk-rozet bk-r-gri">Belirlenmemiş</span>
                      )}
                    </dd>
                    {veri?.kimde?.eslesme && (
                      <>
                        <dt>Eşleştirme</dt>
                        <dd>{new Date(veri.kimde.eslesme).toLocaleDateString("tr-TR")}</dd>
                      </>
                    )}
                  </dl>

                  {kisi.eslestirilemez && (
                    <div className="bk-uyari bk-u-turuncu" style={{ marginTop: 12 }}>
                      <AlertTriangle size={16} color="var(--bk-turuncu)" />
                      <span>
                        Personelin çıkış tarihi <b>{gunYaz(kisi.cikisTarihi)}</b> olarak girilmiş. Kart yeni
                        personele verilecekse eşleştirmeyi kaldırabilirsiniz; bu personele yeni kart eşleştirilemez.
                      </span>
                    </div>
                  )}

                  {kisi.uyumsuz && (
                    <div className="bk-uyari bk-u-turuncu" style={{ marginTop: 12 }}>
                      <AlertTriangle size={16} color="var(--bk-turuncu)" />
                      <span>
                        Kart kaydı personel bilgisiyle uyuşmuyor. Üstteki <b>Kart bilgilerini eşitle</b> düğmesi
                        adı ve telefonu MusteriKart'a yeniden yazar.
                      </span>
                    </div>
                  )}

                  {(kart?.kartNo || kisi.kartNo) && (
                    <>
                      <div className="bk-bolum">Puan işlemleri (yükleme · transfer · silme)</div>
                      <KartPuanIslemleri kartNo={(kart?.kartNo || kisi.kartNo) as string} />
                    </>
                  )}

                  <div className="bk-bolum">Şubelere göre harcama</div>
                  {subeler.length === 0 ? (
                    <div style={{ color: "var(--bk-pasif)", fontSize: 13 }}>Son 180 günde harcama yok.</div>
                  ) : (
                    subeler.map((s, i) => (
                      <div className="bk-subeCubuk" key={i}>
                        <span title={s.subeAdi}>{s.subeAdi ?? `Şube ${s.subeId}`}</span>
                        <div className="bk-serit">
                          <i style={{ width: `${(Number(s.tutar) / enCok) * 100}%` }} />
                        </div>
                        <span className="bk-para bk-sag">{tl(Number(s.tutar))}</span>
                      </div>
                    ))
                  )}

                  <div className="bk-bolum">Hareketler</div>
                  {hareketler.length === 0 ? (
                    <div style={{ color: "var(--bk-pasif)", fontSize: 13 }}>Son 180 günde hareket yok.</div>
                  ) : (
                    hareketler.map((h, i) => {
                      /* Silme (6) Puan kadar düşüyor (Posback'in hesabı); yalnızca 5 sıfırlama */
                      const harcamaMi = h.tip === 2 || h.tip === 6;
                      const sifirMi = h.tip === 5;
                      const renk = harcamaMi ? "var(--bk-turuncu)" : sifirMi ? "var(--bk-pasif)" : "var(--bk-yesilKoyu)";

                      return (
                        <div className="bk-hareket" key={i}>
                          <span
                            className="bk-hIkon"
                            style={{
                              background: harcamaMi ? "var(--bk-turuncuAcik)" : sifirMi ? "#f1f2ef" : "var(--bk-yesilAcik)",
                              color: renk,
                            }}
                          >
                            {harcamaMi ? <ShoppingCart size={15} /> : <ArrowUp size={15} />}
                          </span>
                          <div>
                            <b>
                              {h.islem}
                              {h.subeAdi ? ` · ${h.subeAdi}` : ""}
                            </b>
                            <small>
                              {new Date(h.tarih).toLocaleString("tr-TR", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {h.belgeNo ? ` · ${h.belgeNo}` : ""}
                            </small>
                          </div>
                          <span className="bk-hTutar" style={{ color: renk }}>
                            {sifirMi ? "" : harcamaMi ? "−" : "+"}
                            {tl(Number(h.tutar))}
                          </span>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>

            <div className="bk-cAlt">
              <button className="bk-d tehlike" onClick={() => kaldir(kisi)}>
                <Link2Off size={14} />
                Eşleşmeyi kaldır
              </button>
              <button
                className="bk-d"
                disabled={!kart?.sifreVar || sifreIsleniyor}
                onClick={sifreSifirla}
                title={kart?.sifreVar ? undefined : "Kartın şifresi yok"}
              >
                <KeyRound size={14} />
                {kart?.sifreVar ? "Şifreyi sıfırla" : "Şifre yok"}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/* ========================================================================== */
/* Kart eşleştirme                                                            */
/* ========================================================================== */

export function Eslestir({
  kisi,
  personel,
  kapat,
  bitti,
}: {
  kisi: Personel | null;
  personel: Personel[];
  kapat: () => void;
  bitti: () => void;
}) {
  const [ara, setAra] = useState("");
  const [sonuclar, setSonuclar] = useState<AramaSonucu[] | null>(null);
  const [araniyor, setAraniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [secili, setSecili] = useState<AramaSonucu | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const girdiRef = useRef<HTMLInputElement>(null);
  const sayac = useRef(0);

  useEffect(() => {
    if (!kisi) return;

    setAra("");
    setSonuclar(null);
    setSecili(null);
    setHata("");
    setTimeout(() => girdiRef.current?.focus(), 80);
  }, [kisi]);

  /* Yazdıkça ara: 350 ms bekleyip MusteriKart'ta arar */
  useEffect(() => {
    const q = ara.replace(/\D/g, "");

    if (q.length < 4) {
      setSonuclar(null);
      setHata("");
      return;
    }

    const bu = ++sayac.current;

    const z = setTimeout(async () => {
      setAraniyor(true);

      try {
        const c = await api.al<{ kayitlar: AramaSonucu[] }>(
          `/api/BicenKart/Ara?kartNo=${encodeURIComponent(q)}`
        );
        if (bu === sayac.current) {
          setSonuclar(c.kayitlar ?? []);
          setHata("");
        }
      } catch (h: any) {
        if (bu === sayac.current) setHata(h?.message ?? "Aranamadı.");
      } finally {
        if (bu === sayac.current) setAraniyor(false);
      }
    }, 350);

    return () => clearTimeout(z);
  }, [ara]);

  const acik = !!kisi;
  const q = ara.replace(/\D/g, "");

  const vurgula = (kartNo: string) => {
    const bicimli = no4(kartNo);
    if (q.length < 4) return bicimli;

    const desen = new RegExp(q.split("").join("\\s?"));
    const m = bicimli.match(desen);

    if (!m || m.index === undefined) return bicimli;

    return (
      <>
        {bicimli.slice(0, m.index)}
        <mark>{m[0]}</mark>
        {bicimli.slice(m.index + m[0].length)}
      </>
    );
  };

  const kaydet = async () => {
    if (!kisi || !secili) return;

    setKaydediliyor(true);

    try {
      const c = await api.gonder<any>("/api/BicenKart/Esle", {
        personelKodu: kisi.sicil,
        kartNo: secili.kartNo,
      });

      message.success(
        `${no4(secili.kartNo)} numaralı kart ${kisi.adSoyad} kişisine eşleştirildi.` +
          (c?.birakilanKart ? ` Önceki kartı (${no4(c.birakilanKart)}) boşa çıkarıldı.` : "")
      );
      bitti();
    } catch (h: any) {
      message.error(h?.message ?? "Eşleştirilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const yeniAd = kisi ? kartAdi(kisi.adSoyad) : "";
  const kimdeKisi = secili?.kimde
    ? personel.find((p) => p.sicil?.trim() === secili.kimde?.sicil?.trim())
    : null;

  return (
    <div className="bk-katman">
      <div className={`bk-perde ${acik ? "acik" : ""}`} onClick={kapat} />

      <div className={`bk-pencere ${acik ? "acik" : ""}`} role="dialog" aria-hidden={!acik}>
        {kisi && (
          <>
            <div className="bk-pUst">
              <b>Kart eşleştir · <PersonelAdi kod={kisi.sicil}>{kisi.adSoyad}</PersonelAdi></b>
              <button className="bk-d hayalet kucuk" onClick={kapat} aria-label="Kapat">
                <X size={16} />
              </button>
            </div>

            <div className="bk-pGovde">
              {!secili ? (
                <>
                  <div className="bk-uyari bk-u-bilgi">
                    <Info size={16} color="var(--bk-yesilKoyu)" />
                    <span>
                      Kart <b>PosbackPromosyon MusteriKart</b>'ta aranır. Seçtiğiniz kartın <b>Ad</b> alanına
                      personelin adı soyadı, <b>CepTel</b> alanına telefonu yazılır ve kart mobil karta çevrilir.
                    </span>
                  </div>

                  <label className="bk-girdi" style={{ marginTop: 12, height: 40 }}>
                    <Search size={15} />
                    <input
                      ref={girdiRef}
                      inputMode="numeric"
                      autoComplete="off"
                      value={ara}
                      onChange={(e) => setAra(e.target.value)}
                      placeholder="Kart numarasının en az 4 hanesi"
                    />
                    {araniyor && <RefreshCw size={14} className="bk-donen" />}
                  </label>

                  {q.length < 4 ? (
                    <div className="bk-bos" style={{ padding: "22px 0 10px" }}>
                      Kart numarasının bir kısmını ya da tamamını yazın.
                    </div>
                  ) : hata ? (
                    <div className="bk-uyari bk-u-kirmizi" style={{ marginTop: 12 }}>
                      <AlertTriangle size={16} color="var(--bk-kirmizi)" />
                      <span>{hata}</span>
                    </div>
                  ) : sonuclar === null ? (
                    <div className="bk-bos" style={{ padding: "22px 0 10px" }}>
                      Aranıyor…
                    </div>
                  ) : sonuclar.length === 0 ? (
                    <div className="bk-uyari bk-u-turuncu" style={{ marginTop: 12 }}>
                      <AlertTriangle size={16} color="var(--bk-turuncu)" />
                      <span>
                        Bu numarayla MusteriKart'ta kart bulunamadı. Numarayı kontrol edin; kart kasadan hiç
                        okutulmadıysa kaydı olmayabilir.
                      </span>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: "var(--bk-pasif)", margin: "12px 0 2px" }}>
                        {sonuclar.length} kart bulundu{sonuclar.length === 20 ? " (ilk 20)" : ""}
                      </div>
                      {sonuclar.map((k) => {
                        const kendisi = k.kimde?.sicil?.trim() === kisi.sicil?.trim();

                        return (
                          <button
                            key={k.kartNo}
                            className={`bk-sonuc ${kendisi ? "pasif" : ""}`}
                            disabled={kendisi}
                            onClick={() => setSecili(k)}
                          >
                            <span className={`bk-miniKart ${k.mobilKart ? "" : "fiziki"}`} />
                            <div className="orta">
                              <b className="bk-no">{vurgula(k.kartNo)}</b>
                              <small>
                                {k.ad || "—"}
                                {k.telefon ? ` · ${telYaz(k.telefon)}` : " · telefon yok"}
                              </small>
                            </div>
                            {kendisi ? (
                              <span className="bk-rozet bk-r-gri">Zaten bu personelde</span>
                            ) : k.kimde ? (
                              <span className="bk-rozet bk-r-turuncu">{k.kimde.adSoyad} kişisinde</span>
                            ) : (
                              <span className="bk-rozet bk-r-yesil">Boşta</span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="bk-sonuc duz" style={{ marginTop: 0 }}>
                    <span className={`bk-miniKart ${secili.mobilKart ? "" : "fiziki"}`} />
                    <div className="orta">
                      <b className="bk-no">{no4(secili.kartNo)}</b>
                      <small>seçilen kart</small>
                    </div>
                    <button className="bk-d kucuk hayalet" onClick={() => setSecili(null)}>
                      Değiştir
                    </button>
                  </div>

                  {secili.kimde && (
                    <div className="bk-uyari bk-u-turuncu" style={{ marginTop: 10 }}>
                      <AlertTriangle size={16} color="var(--bk-turuncu)" />
                      <span>
                        Bu kart şu an <b><PersonelAdi kod={secili.kimde.sicil}>{secili.kimde.adSoyad}</PersonelAdi></b>
                        {secili.kimde.sube ? ` (${secili.kimde.sube})` : ""} personelinde. Onaylarsanız ondan
                        alınıp <b><PersonelAdi kod={kisi.sicil}>{kisi.adSoyad}</PersonelAdi></b> kişisine bağlanır; {secili.kimde.adSoyad} kartsız kalır
                        {kimdeKisi?.bakiye ? ` ve kartta ${tl(kimdeKisi.bakiye)} bakiye var` : ""}.
                      </span>
                    </div>
                  )}

                  {kisi.kartNo && (
                    <div className="bk-uyari bk-u-turuncu" style={{ marginTop: 10 }}>
                      <AlertTriangle size={16} color="var(--bk-turuncu)" />
                      <span>
                        Personelin şu anki kartı ({no4(kisi.kartNo)}) boşa çıkarılır.
                      </span>
                    </div>
                  )}

                  <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 14 }}>MusteriKart'a yazılacaklar</div>
                  <table className="bk-fark">
                    <thead>
                      <tr>
                        <th>Alan</th>
                        <th>Şimdi</th>
                        <th>Yeni</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <b>Ad</b>
                        </td>
                        <td className={secili.ad === yeniAd ? "" : "eski"}>{secili.ad || "—"}</td>
                        <td className="yeni">{yeniAd}</td>
                      </tr>
                      <tr>
                        <td>
                          <b>CepTel</b>
                        </td>
                        {kisi.telefon ? (
                          <>
                            <td className={secili.telefon === kisi.telefon ? "" : "eski"}>
                              {secili.telefon ? telYaz(secili.telefon) : "—"}
                            </td>
                            <td className="yeni">{telYaz(kisi.telefon)}</td>
                          </>
                        ) : (
                          <>
                            <td>{secili.telefon ? telYaz(secili.telefon) : "—"}</td>
                            <td style={{ color: "var(--bk-sari)", fontWeight: 600 }}>
                              değişmez · Mikro'da telefon yok
                            </td>
                          </>
                        )}
                      </tr>
                      <tr>
                        <td>
                          <b>Kart türü</b>
                        </td>
                        <td className={secili.mobilKart ? "" : "eski"}>
                          {secili.mobilKart ? "Mobil kart" : "Fiziki kart"}
                        </td>
                        <td className="yeni">Mobil kart (608)</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
            </div>

            <div className="bk-pAlt">
              {!secili ? (
                <button className="bk-d" onClick={kapat}>
                  Vazgeç
                </button>
              ) : (
                <>
                  <button className="bk-d" onClick={() => setSecili(null)} disabled={kaydediliyor}>
                    Geri
                  </button>
                  <button className="bk-d birincil" onClick={kaydet} disabled={kaydediliyor}>
                    <Link2 size={14} />
                    {kaydediliyor ? "Eşleştiriliyor…" : "Eşleştir"}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Eşleşme kaldırma                                                           */
/* ========================================================================== */

function Kaldir({ kisi, kapat, bitti }: { kisi: Personel | null; kapat: () => void; bitti: () => void }) {
  const [isleniyor, setIsleniyor] = useState(false);
  const acik = !!kisi;

  const onayla = async () => {
    if (!kisi?.kartNo) return;

    setIsleniyor(true);

    try {
      await api.gonder("/api/BicenKart/EslesmeKaldir", { kartNo: kisi.kartNo, personelKodu: kisi.sicil });
      message.success(`${kisi.adSoyad} ile kartın eşleşmesi kaldırıldı.`);
      bitti();
    } catch (h: any) {
      message.error(h?.message ?? "Eşleşme kaldırılamadı.");
    } finally {
      setIsleniyor(false);
    }
  };

  return (
    <div className="bk-katman">
      <div className={`bk-perde ${acik ? "acik" : ""}`} onClick={kapat} />

      <div className={`bk-pencere dar ${acik ? "acik" : ""}`} role="dialog" aria-hidden={!acik}>
        {kisi && (
          <>
            <div className="bk-pUst">
              <b>Eşleşme kaldırılsın mı?</b>
              <button className="bk-d hayalet kucuk" onClick={kapat} aria-label="Kapat">
                <X size={16} />
              </button>
            </div>

            <div className="bk-pGovde">
              <div className="bk-sonuc duz" style={{ marginTop: 0 }}>
                <span className={`bk-miniKart ${kisi.mobilKart ? "" : "fiziki"}`} />
                <div className="orta">
                  <b><PersonelAdi kod={kisi.sicil}>{kisi.adSoyad}</PersonelAdi></b>
                  <small className="bk-no">{no4(kisi.kartNo)}</small>
                </div>
                {kisi.bakiye !== null && (
                  <span className="bk-para" style={{ color: "var(--bk-yesilKoyu)" }}>
                    {tl(kisi.bakiye)}
                  </span>
                )}
              </div>

              <ul className="bk-maddeler">
                <li>
                  <Link2Off size={15} color="var(--bk-turuncu)" />
                  <span>
                    Kart bu personelden ayrılır; personel panelde <b>kartsız</b> görünür ve uygulamadan kartı
                    göremez.
                  </span>
                </li>
                <li>
                  <CreditCard size={15} color="var(--bk-pasif)" />
                  <span>
                    MusteriKart'ta kart boşa çıkar: Ad "BİÇEN KART" olur, telefon ve şifre silinir, kart fiziki
                    karta döner. Kart başka bir personele yeniden eşleştirilebilir.
                  </span>
                </li>
                <li>
                  <Check size={15} color="var(--bk-yesilKoyu)" />
                  <span>
                    Bakiye ve hareket geçmişi <b>silinmez</b>, kartta kalır.
                  </span>
                </li>
              </ul>

              {(kisi.bakiye ?? 0) > 0 && (
                <div className="bk-uyari bk-u-turuncu" style={{ marginTop: 8 }}>
                  <AlertTriangle size={16} color="var(--bk-turuncu)" />
                  <span>
                    Kartta <b>{tl(kisi.bakiye)}</b> bakiye var. Kart kime eşleştirilirse bakiye onunla gider.
                  </span>
                </div>
              )}
            </div>

            <div className="bk-pAlt">
              <button className="bk-d" onClick={kapat} disabled={isleniyor}>
                Vazgeç
              </button>
              <button className="bk-d tehlikeDolu" onClick={onayla} disabled={isleniyor}>
                <Link2Off size={14} />
                {isleniyor ? "Kaldırılıyor…" : "Eşleşmeyi kaldır"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Toplu eşleştirme                                                           */
/* ========================================================================== */

/** Elde duran sıfır kartları şubedeki kartsız personele sırayla bağlar. */
function TopluEslesme({ sube, kapat, bitti }: any) {
  const [metin, setMetin] = useState("");
  const [onizleme, setOnizleme] = useState<any>(null);
  const [hatalar, setHatalar] = useState<any[]>([]);
  const [calisiyor, setCalisiyor] = useState(false);

  const kartlar = metin
    .split(/[\n,;\t ]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const dene = async () => {
    setCalisiyor(true);

    try {
      setOnizleme(await api.gonder<any>("/api/BicenKart/TopluEsle", { sube, kartlar, deneme: true }));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setCalisiyor(false);
    }
  };

  const uygula = async () => {
    setCalisiyor(true);

    try {
      const c = await api.gonder<any>("/api/BicenKart/TopluEsle", { sube, kartlar, deneme: false });

      if (c.yazilan > 0) message.success(`${c.yazilan} kart eşleştirildi.`);

      /* Sorun çıkan kartlar sebebiyle ekranda kalıyor: mesaj kutusu
         kapanınca neyin yanlış olduğu kaybolmasın. */
      if (c.hatalar?.length) {
        setHatalar(c.hatalar);
        message.warning(`${c.hatalar.length} kartta sorun oldu; sebepleri aşağıda.`);
      } else {
        bitti();
      }
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Modal
      open
      width={720}
      title={`${sube} · toplu kart eşleştirme`}
      onCancel={kapat}
      footer={
        <Space>
          <Button onClick={kapat}>Vazgeç</Button>
          <Button onClick={dene} loading={calisiyor} disabled={kartlar.length === 0}>
            Önizle
          </Button>
          <Button type="primary" onClick={uygula} loading={calisiyor} disabled={!onizleme?.eslesmeler?.length}>
            Eşleştir ({onizleme?.eslesmeler?.length ?? 0})
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Kart numaralarını alt alta yapıştırın"
        description="Kartlar şubedeki kartsız personele ada göre sırayla bağlanır. Kartı olan personel atlanır, mevcut eşleşme bozulmaz. Telefon numarası gerekmiyor. Önce Önizle deyip hangi kartın kime gideceğini görün."
      />

      <Input.TextArea
        rows={6}
        value={metin}
        onChange={(e) => {
          setMetin(e.target.value);
          setOnizleme(null);
        }}
        placeholder={"9780000000001\n9780000000002\n9780000000003"}
      />

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {kartlar.length} kart numarası okundu
      </Typography.Text>

      {onizleme && (
        <>
          <Table
            style={{ marginTop: 12 }}
            rowKey="kartNo"
            size="small"
            pagination={false}
            dataSource={onizleme.eslesmeler}
            columns={[
              { title: "Kart no", dataIndex: "kartNo", width: 170 },
              {
                title: "Personel",
                render: (_: unknown, k: any) => (
                  <>
                    <b><PersonelAdi kod={k.sicil}>{k.adSoyad}</PersonelAdi></b>
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>
                      {k.sicil} · {k.pozisyon}
                    </div>
                  </>
                ),
              },
              { title: "Telefon", dataIndex: "telefon", width: 130 },
            ]}
          />

          {(onizleme.kalanKart > 0 || onizleme.kalanPersonel > 0) && (
            <Alert
              style={{ marginTop: 10 }}
              type="warning"
              showIcon
              message={
                onizleme.kalanKart > 0
                  ? `${onizleme.kalanKart} kart eşleşmeden kaldı — şubede o kadar kartsız personel yok`
                  : `${onizleme.kalanPersonel} personel kartsız kaldı — o kadar kart numarası girilmedi`
              }
            />
          )}

          {hatalar.length > 0 && (
            <Table
              style={{ marginTop: 12 }}
              rowKey="kartNo"
              size="small"
              pagination={false}
              dataSource={hatalar}
              columns={[
                { title: "Kart no", dataIndex: "kartNo", width: 160 },
                { title: "Personel", dataIndex: "adSoyad", width: 200 },
                { title: "Sebep", dataIndex: "hata" },
              ]}
            />
          )}

          {onizleme.atlanan?.length > 0 && (
            <Alert
              style={{ marginTop: 10 }}
              type="info"
              showIcon
              message={`${onizleme.atlanan.length} personel atlandı`}
              description={onizleme.atlanan
                .map((a: any) => `${a.adSoyad} (${a.sebep})`)
                .join(", ")}
            />
          )}
        </>
      )}
    </Modal>
  );
}

/* ========================================================================== */
/* Kasa doğrulaması (05.10.2026)                                              */
/* ========================================================================== */
/*
 * Kural: mobil kart (GrupNo 608) kasada uygulamadaki ödeme koduyla, fiziki
 * kart kart şifresiyle kullanılır. Önceden mobil kartlarda da şifre
 * isteniyordu; ayarı kurala uymayan personel kartı varsa bu şerit çıkar.
 */
function KasaDogrulama({ yenile }: { yenile: () => void }) {
  const [d, setD] = useState<{ toplam: number; mobilSifreli: number; fizikiSifresiz: number } | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);
  const rol = oturumOku()?.rol ?? "";
  const yetkili = ["Admin", "IKYoneticisi"].includes(rol);

  const getir = () =>
    api
      .al<any>("/api/BicenKart/KasaDogrulama")
      .then(setD)
      .catch(() => setD(null));

  useEffect(() => {
    getir();
  }, []);

  if (!d || d.mobilSifreli + d.fizikiSifresiz === 0) return null;

  const duzelt = () =>
    Modal.confirm({
      title: "Kasa doğrulaması düzeltilsin mi?",
      width: 480,
      content: (
        <div style={{ fontSize: 13.5 }}>
          <p style={{ marginTop: 4 }}>
            <b>{d.mobilSifreli}</b> mobil kartta kasa artık şifre değil, Biçen360'taki{" "}
            <b>ödeme kodunu</b> soracak.
          </p>
          {d.fizikiSifresiz > 0 && (
            <p>
              <b>{d.fizikiSifresiz}</b> fiziki kartta kasa <b>kart şifresini</b> soracak.
            </p>
          )}
          <p style={{ marginBottom: 0, color: "#7b8577" }}>
            Yalnızca personel kartları değişir; ayrılan personel bağlantısı gönderilmiş kartlar
            şifreyle kalır. Önce bir kartla kasada denemeniz önerilir.
          </p>
        </div>
      ),
      okText: "Düzelt",
      cancelText: "Vazgeç",
      onOk: async () => {
        setCalisiyor(true);
        try {
          const r = await api.gonder<any>("/api/BicenKart/KasaDogrulamaEsitle", {});
          message.success(`${r.mobil} mobil kart ödeme koduna, ${r.fiziki} fiziki kart şifreye alındı.`);
          getir();
          yenile();
        } catch (h: any) {
          message.error(h?.message ?? "Düzeltilemedi.");
        } finally {
          setCalisiyor(false);
        }
      },
    });

  return (
    <Alert
      style={{ marginBottom: 14 }}
      type="warning"
      showIcon
      message="Kasada mobil kartlardan da şifre isteniyor"
      description={
        <span>
          Kural: mobil kart Biçen360'taki <b>ödeme koduyla</b>, fiziki kart <b>kart şifresiyle</b>{" "}
          kullanılır. {d.mobilSifreli > 0 && <><b>{d.mobilSifreli}</b> mobil kartta kasa hâlâ şifre soruyor. </>}
          {d.fizikiSifresiz > 0 && <><b>{d.fizikiSifresiz}</b> fiziki kartta şifre sorulmuyor. </>}
          Yeni eşleştirmelerde ve personel tercih değiştirdiğinde ayar kendiliğinden doğru yazılıyor.
        </span>
      }
      action={
        yetkili ? (
          <Button size="small" type="primary" loading={calisiyor} onClick={duzelt}>
            Düzelt
          </Button>
        ) : undefined
      }
    />
  );
}
