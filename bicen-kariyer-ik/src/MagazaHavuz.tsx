/**
 * ---------------------------------------------------------------------------
 * Mağaza Havuzu (19.10.2026)
 * ---------------------------------------------------------------------------
 * Satınalma'nın belirlediği ürün başı tutarlarla şubelerin biriktirdiği
 * havuz. İK kampanyayı girer (ürün stok kodları, adet/kg başı tutar,
 * tarih aralığı, varsa bölge payı); şube satış miktarları Mikro'dan
 * hesaplanır, gerekirse elle düzeltilir ve kampanya kesinleştirilir.
 * Kesin kampanyaların net tutarı şube havuzuna girer; piknik, sinema,
 * alışveriş sepeti gibi kullanımlar havuzdan düşülür.
 * Önceki Excel'den devreden tutarlar "Açılış bakiyesi" olarak girilir.
 *
 * Görünüm (19.10.2026, 2. sürüm): yeşil başlık bandında kalan havuz ve
 * özet, şubeler kart ızgarası (liste görünümü de var), kampanyalar kart
 * satırları; çekmecelerde özet kutuları. Stil MagazaHavuz.css ("mh-").
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import {
  ArrowDownCircle,
  CreditCard,
  FileSpreadsheet,
  MapPinned,
  Calculator,
  CheckCircle2,
  Clock3,
  Download,
  LayoutGrid,
  List,
  Megaphone,
  Squirrel,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Store,
  Tags,
  Trash2,
  Undo2,
  Wallet,
} from "lucide-react";

import * as XLSX from "xlsx";

import { api, oturumOku } from "./api";
import { tabloIndir } from "./raporExcel";
import "./MagazaHavuz.css";

const { RangePicker } = DatePicker;

/* -------------------------------------------------------------------------- */

const para = (v: number | null | undefined) =>
  `${(v ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
/** Başlıkta büyük yazı: kuruşsuz */
const paraKisa = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const sayi = (v: number | null | undefined) => (v ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const tarih = (v: string | null | undefined) => (v ? dayjs(v).format("DD.MM.YYYY") : "—");

const TUR: Record<string, { ad: string; renk: string; zemin: string; ikon: ReactNode }> = {
  kullanim: { ad: "Kullanım", renk: "#c62828", zemin: "#fdecec", ikon: <ArrowDownCircle size={15} /> },
  acilis: { ad: "Açılış bakiyesi", renk: "#3f6507", zemin: "#eef6e1", ikon: <Squirrel size={15} /> },
  duzeltme: { ad: "Düzeltme", renk: "#2e6aa8", zemin: "#e9f0f8", ikon: <SlidersHorizontal size={15} /> },
};

const geriAlabilir = () => ["Admin", "IKYoneticisi", "GenelMudurYardimcisi"].includes(oturumOku()?.rol ?? "");

interface SubeOzet {
  kod: string;
  ad: string;
  hakedis: number;
  kampanyaSayisi: number;
  acilis: number;
  duzeltme: number;
  toplam: number;
  kullanim: number;
  kalan: number;
  bekleyen: number;
  sonKullanim: string | null;
  /** Biçen Kart'a dağıtım için Admin onayı bekleyen tutar */
  dagitimOnayda?: number;
}

interface BolgeOzet extends SubeOzet {
  subeSayisi: number;
}

interface Ozet {
  subeler: SubeOzet[];
  /** Bölge müdürü havuzları: şubelerinin bölge payı */
  bolgeler?: BolgeOzet[];
  toplam: number;
  kullanim: number;
  kalan: number;
  bekleyen: number;
}

interface KampanyaSatiri {
  id: number;
  ad: string;
  stokKodlari: string[];
  birimTutar: number;
  bolgePayi: number;
  bas: string;
  bit: string;
  durum: "taslak" | "kesin";
  aciklama: string | null;
  hesaplama: string | null;
  olusturan: string | null;
  kesinlestiren: string | null;
  kesinlesme: string | null;
  hesapKaynagi?: string | null;
  miktar: number;
  brut: number;
  net: number;
  subeSayisi: number;
}

interface Hakedis {
  kampanyaId: number;
  subeKodu: string;
  subeAdi: string;
  miktar: number;
  brut: number;
  bolgePayi: number;
  net: number;
  elle: boolean;
}

const hataMetni = (e: any, yedek: string) => e?.message || e?.hata || yedek;

/** Kullanılan / kalan oranı çubuğu */
function Cubuk({ toplam, kullanim, hero }: { toplam: number; kullanim: number; hero?: boolean }) {
  const t = Math.max(toplam, 0);
  const k = t > 0 ? Math.min(100, (kullanim / t) * 100) : 0;
  return (
    <div className={hero ? "mh-hero-cubuk" : "mh-cubuk"}>
      <i className="mh-c-kalan" style={{ width: `${t > 0 ? 100 - k : 0}%` }} />
      <i className="mh-c-kullanim" style={{ width: `${k}%` }} />
    </div>
  );
}

/* ========================================================================== */

export default function MagazaHavuz() {
  const { message } = AntdApp.useApp();
  const [sekme, setSekme] = useState<"havuz" | "kampanya">("havuz");
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [kampanyalar, setKampanyalar] = useState<KampanyaSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);

  /* Pencereler sayfa düzeyinde: başlıktaki düğmeler de açabilsin */
  const [hareketAcik, setHareketAcik] = useState<{ sube?: string; tur: string } | null>(null);
  const [kampanyaFormu, setKampanyaFormu] = useState<KampanyaSatiri | "yeni" | null>(null);
  const [acikKampanya, setAcikKampanya] = useState<number | null>(null);
  const [acikSube, setAcikSube] = useState<string | null>(null);

  const getir = useCallback(() => {
    setYukleniyor(true);
    Promise.all([
      api.al<Ozet>("/api/MagazaHavuz/Ozet").then(setOzet),
      api.al<KampanyaSatiri[]>("/api/MagazaHavuz/Kampanyalar").then(setKampanyalar),
    ])
      .catch((e) => message.error(hataMetni(e, "Havuz bilgisi alınamadı")))
      .finally(() => setYukleniyor(false));
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const bekleyenKampanya = kampanyalar.filter((k) => k.durum === "taslak").length;
  const kullanimOrani = ozet && ozet.toplam > 0 ? Math.round((ozet.kullanim / ozet.toplam) * 100) : 0;
  const acikSubeOzet =
    ozet?.subeler.find((s) => s.kod === acikSube) ??
    (ozet?.bolgeler ?? []).find((s) => s.kod === acikSube) ??
    null;
  const [devirAcik, setDevirAcik] = useState(false);
  const [dagitimSube, setDagitimSube] = useState<SubeOzet | null>(null);

  return (
    <div className="mh">
      {/* ------------------------------------------------------------ başlık */}
      <section className="mh-hero">
        <Squirrel className="mh-hero-desen" size={260} strokeWidth={1.2} />

        <div className="mh-hero-ust">
          <div className="mh-hero-baslik">
            <div className="mh-hero-ikon">
              <Squirrel size={24} strokeWidth={2} />
            </div>
            <div>
              <h2>Mağaza Havuzu</h2>
              <div className="mh-hero-alt">
                Kampanya ürünlerinin satışından şubelere biriken tutar. Havuz şubenin bütün çalışanlarınındır;
                piknik, sinema, alışveriş sepeti gibi organizasyonlarda kullanılır.
              </div>
            </div>
          </div>

          <div className="mh-hero-arac">
            <Button className="mh-btn-cam" icon={<Wallet size={15} />} onClick={() => setHareketAcik({ tur: "kullanim" })}>
              Kullanım ekle
            </Button>
            <Button className="mh-btn-beyaz" icon={<Plus size={15} />} onClick={() => setKampanyaFormu("yeni")}>
              Yeni kampanya
            </Button>
          </div>
        </div>

        <div className="mh-hero-govde">
          <div>
            <div className="mh-kalan-etiket">Şubelerin kullanabileceği</div>
            <div className="mh-kalan">
              {ozet ? paraKisa(ozet.kalan) : "—"}
              <small>₺</small>
            </div>
            <div className="mh-kalan-not">
              {ozet ? `${ozet.subeler.filter((s) => s.kalan > 0).length} şubede birikmiş tutar var` : " "}
            </div>
          </div>

          <div className="mh-hero-istat">
            <div>
              <span>Toplam birikmiş</span>
              <b>{para(ozet?.toplam)}</b>
            </div>
            <div>
              <span>Kullanılan · %{kullanimOrani}</span>
              <b>{para(ozet?.kullanim)}</b>
            </div>
            <Tooltip title="Kesinleşmemiş kampanyalardan gelecek tutar">
              <div>
                <span>Onay bekleyen</span>
                <b>{para(ozet?.bekleyen)}</b>
              </div>
            </Tooltip>
          </div>

          {ozet && ozet.toplam > 0 && (
            <>
              <Cubuk toplam={ozet.toplam} kullanim={ozet.kullanim} hero />
              <div className="mh-hero-lejant">
                <span>
                  <i style={{ background: "#b9e66b" }} />
                  Kalan
                </span>
                <span>
                  <i style={{ background: "rgba(255,255,255,.55)" }} />
                  Kullanılan
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ sekmeler */}
      <div className="mh-sekmeler">
        <button type="button" className={sekme === "havuz" ? "mh-aktif" : undefined} onClick={() => setSekme("havuz")}>
          <Store size={15} /> Şube havuzları
        </button>
        <button
          type="button"
          className={sekme === "kampanya" ? "mh-aktif" : undefined}
          onClick={() => setSekme("kampanya")}
        >
          <Megaphone size={15} /> Kampanyalar
          {bekleyenKampanya > 0 && <em>{bekleyenKampanya}</em>}
        </button>
      </div>

      {sekme === "havuz" ? (
        <SubeHavuzlari
          ozet={ozet}
          yukleniyor={yukleniyor}
          yenile={getir}
          ac={setAcikSube}
          hareket={(sube, tur) => setHareketAcik({ sube, tur })}
          devir={() => setDevirAcik(true)}
          dagit={setDagitimSube}
        />
      ) : (
        <Kampanyalar
          liste={kampanyalar}
          yukleniyor={yukleniyor}
          yenile={getir}
          ac={setAcikKampanya}
          yeni={() => setKampanyaFormu("yeni")}
        />
      )}

      <HareketPenceresi
        acik={hareketAcik}
        subeler={ozet?.subeler ?? []}
        bolgeler={ozet?.bolgeler ?? []}
        kapat={(degisti) => {
          setHareketAcik(null);
          if (degisti) getir();
        }}
      />

      <DagitimPenceresi
        sube={dagitimSube}
        kapat={(degisti) => {
          setDagitimSube(null);
          if (degisti) getir();
        }}
      />

      <DevirPenceresi
        acik={devirAcik}
        kapat={(degisti) => {
          setDevirAcik(false);
          if (degisti) getir();
        }}
      />

      <SubeAyrintisi
        sube={acikSubeOzet}
        kapat={() => setAcikSube(null)}
        degisti={getir}
        hareketEkle={(tur) => acikSubeOzet && setHareketAcik({ sube: acikSubeOzet.kod, tur })}
        dagit={() => acikSubeOzet && setDagitimSube(acikSubeOzet)}
      />

      <KampanyaFormu
        kayit={kampanyaFormu}
        kapat={(id) => {
          setKampanyaFormu(null);
          if (id) {
            getir();
            setSekme("kampanya");
            setAcikKampanya(id);
          }
        }}
      />

      <KampanyaAyrintisi
        id={acikKampanya}
        kapat={() => setAcikKampanya(null)}
        degisti={getir}
        duzenle={(k) => setKampanyaFormu(k)}
      />
    </div>
  );
}

/* ========================================================================== */
/* Şube havuzları                                                             */
/* ========================================================================== */

function SubeHavuzlari({
  ozet,
  yukleniyor,
  yenile,
  ac,
  hareket,
  devir,
  dagit,
}: {
  ozet: Ozet | null;
  yukleniyor: boolean;
  yenile: () => void;
  ac: (kod: string) => void;
  hareket: (sube: string | undefined, tur: string) => void;
  devir: () => void;
  dagit: (s: SubeOzet) => void;
}) {
  const [arama, setArama] = useState("");
  const [siralama, setSiralama] = useState<"kalan" | "ad" | "kullanim">("kalan");
  const [gorunum, setGorunum] = useState<"kart" | "liste">("kart");
  const [sadeceDolu, setSadeceDolu] = useState(false);

  const satirlar = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    const l = (ozet?.subeler ?? []).filter(
      (s) => (!q || s.ad.toLocaleLowerCase("tr").includes(q)) && (!sadeceDolu || s.toplam !== 0 || s.bekleyen !== 0)
    );
    return [...l].sort((a, b) =>
      siralama === "ad" ? a.ad.localeCompare(b.ad, "tr") : siralama === "kullanim" ? b.kullanim - a.kullanim : b.kalan - a.kalan
    );
  }, [ozet, arama, siralama, sadeceDolu]);

  const excel = () =>
    tabloIndir({
      baslik: "Mağaza Havuz Tutarları",
      altBaslik: dayjs().format("DD.MM.YYYY"),
      sayfaAdi: "Havuz",
      dosyaAdi: "magaza-havuz",
      genelToplam: true,
      sutunlar: [
        { ad: "Şube", genislik: 24 },
        { ad: "Kampanya Hakedişi", tip: "para" },
        { ad: "Açılış / Düzeltme", tip: "para" },
        { ad: "Toplam Havuz", tip: "para" },
        { ad: "Kullanılan", tip: "para" },
        { ad: "Kalan", tip: "para", veriCubugu: true },
        { ad: "Onay Bekleyen", tip: "para" },
        { ad: "Son Kullanım", tip: "tarih", toplam: false },
      ],
      satirlar: satirlar.map((s) => [
        s.ad,
        s.hakedis,
        s.acilis + s.duzeltme,
        s.toplam,
        s.kullanim,
        s.kalan,
        s.bekleyen,
        s.sonKullanim ? dayjs(s.sonKullanim).toDate() : null,
      ]),
    });

  const sutunlar: ColumnsType<SubeOzet> = [
    { title: "Şube", dataIndex: "ad", render: (v: string) => <b>{v}</b> },
    {
      title: "Kampanya",
      dataIndex: "hakedis",
      align: "right",
      render: (v: number, s) => (
        <span className="mh-sayi">
          {para(v)}
          {s.kampanyaSayisi > 0 && <div style={{ fontSize: 11.5, color: "#7b8577" }}>{s.kampanyaSayisi} kampanya</div>}
        </span>
      ),
    },
    {
      title: "Açılış / düzeltme",
      align: "right",
      responsive: ["lg"],
      render: (_: any, s) => <span className="mh-sayi">{s.acilis + s.duzeltme !== 0 ? para(s.acilis + s.duzeltme) : "—"}</span>,
    },
    {
      title: "Kullanılan",
      dataIndex: "kullanim",
      align: "right",
      render: (v: number, s) => (
        <span className="mh-sayi">
          {v > 0 ? para(v) : "—"}
          {s.sonKullanim && <div style={{ fontSize: 11.5, color: "#7b8577" }}>son {tarih(s.sonKullanim)}</div>}
        </span>
      ),
    },
    {
      title: "Kalan",
      dataIndex: "kalan",
      align: "right",
      render: (v: number) => (
        <b className="mh-sayi" style={{ fontSize: 15, color: v > 0 ? "#3f6507" : v < 0 ? "#c62828" : "#7b8577" }}>
          {para(v)}
        </b>
      ),
    },
    {
      title: "Onay bekleyen",
      dataIndex: "bekleyen",
      align: "right",
      responsive: ["md"],
      render: (v: number) => (v > 0 ? <span className="mh-bekleyen">+{para(v)}</span> : "—"),
    },
    {
      title: "",
      width: 110,
      render: (_: any, s) => (
        <Button
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            hareket(s.kod, "kullanim");
          }}
        >
          Kullanım
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="mh-arac">
        <Input
          allowClear
          prefix={<Search size={15} color="#9AA3AF" />}
          placeholder="Şube ara"
          style={{ width: 220 }}
          value={arama}
          onChange={(e) => setArama(e.target.value)}
        />
        <Select
          value={siralama}
          onChange={setSiralama}
          style={{ width: 190 }}
          options={[
            { value: "kalan", label: "Kalan tutar (çoktan aza)" },
            { value: "kullanim", label: "Kullanılan (çoktan aza)" },
            { value: "ad", label: "Şube adı (A–Z)" },
          ]}
        />
        <div className="mh-cipler">
          <button type="button" className={`mh-cip${!sadeceDolu ? " mh-aktif" : ""}`} onClick={() => setSadeceDolu(false)}>
            Tümü <b>{ozet?.subeler.length ?? 0}</b>
          </button>
          <button type="button" className={`mh-cip${sadeceDolu ? " mh-aktif" : ""}`} onClick={() => setSadeceDolu(true)}>
            Havuzu olanlar <b>{ozet?.subeler.filter((s) => s.toplam !== 0 || s.bekleyen !== 0).length ?? 0}</b>
          </button>
        </div>

        <div className="mh-arac-sag">
          <Segmented
            value={gorunum}
            onChange={(v) => setGorunum(v as any)}
            options={[
              { value: "kart", icon: <LayoutGrid size={14} style={{ verticalAlign: -2 }} />, label: "Kart" },
              { value: "liste", icon: <List size={14} style={{ verticalAlign: -2 }} />, label: "Liste" },
            ]}
          />
          <Button icon={<FileSpreadsheet size={15} />} onClick={devir}>
            Excel'den aktar
          </Button>
          <Button icon={<Squirrel size={15} />} onClick={() => hareket(undefined, "acilis")}>
            Açılış bakiyesi
          </Button>
          <Tooltip title="Yenile">
            <Button icon={<RefreshCw size={15} />} onClick={yenile} />
          </Tooltip>
          <Button icon={<Download size={15} />} onClick={excel} disabled={!ozet}>
            Excel
          </Button>
        </div>
      </div>

      {(ozet?.bolgeler ?? []).length > 0 && (
        <div className="mh-bolgeler">
          <div className="mh-bolgeler-bas">
            <MapPinned size={15} /> Bölge havuzları
            <small>kampanyalardaki bölge payı · bölge müdürü organizasyonları</small>
          </div>
          <div className="mh-bolge-izgara">
            {(ozet?.bolgeler ?? []).map((b) => (
              <div key={b.kod} className="mh-bolge" onClick={() => ac(b.kod)}>
                <div className="mh-bolge-ad">
                  {b.ad}
                  <small>{b.subeSayisi} şube</small>
                </div>
                <div className="mh-bolge-kalan">{para(b.kalan)}</div>
                <Cubuk toplam={b.toplam} kullanim={b.kullanim} />
                <div className="mh-bolge-alt">
                  <span>Birikmiş {para(b.toplam)}</span>
                  <span>Kullanılan {b.kullanim > 0 ? para(b.kullanim) : "—"}</span>
                </div>
                {/* 26.10.2026: bölge havuzu bölge müdürünün hak edişi; yalnız bölge müdürünün kartına aktarılır */}
                <div className="mh-sube-dip" style={{ marginTop: 8 }}>
                  {(b.dagitimOnayda ?? 0) > 0 ? (
                    <Tooltip title={`${para(b.dagitimOnayda ?? 0)} Biçen Kart'a yükleme için admin onayında`}>
                      <span className="mh-bekleyen" style={{ background: "#e9f0f8", color: "#2e6aa8" }}>
                        {para(b.dagitimOnayda ?? 0)} onayda
                      </span>
                    </Tooltip>
                  ) : (
                    <span />
                  )}
                  <Tooltip title="Bölge havuzu bölge müdürünün hak edişidir; yalnız bölge müdürünün Biçen Kart'ına aktarılır">
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<CreditCard size={13} />}
                      disabled={b.kalan - (b.dagitimOnayda ?? 0) <= 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        dagit(b);
                      }}
                    >
                      Biçen Kart'a yatır
                    </Button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!ozet && yukleniyor ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin />
        </div>
      ) : satirlar.length === 0 ? (
        <div className="mh-bos">
          <div className="mh-bos-ikon">
            <Store size={30} />
          </div>
          <b>{sadeceDolu ? "Henüz havuzu olan şube yok" : "Şube bulunamadı"}</b>
          <p>
            Kampanya kesinleşince ya da açılış bakiyesi girilince şubeler burada görünür. Mevcut Excel'deki tutarları
            "Açılış bakiyesi" ile aktarabilirsiniz.
          </p>
        </div>
      ) : gorunum === "kart" ? (
        <div className="mh-izgara">
          {satirlar.map((s, i) => (
            <div key={s.kod} className="mh-sube" onClick={() => ac(s.kod)}>
              <div className="mh-sube-ust">
                <span className="mh-sube-sira">{siralama === "ad" ? s.ad.slice(0, 2) : i + 1}</span>
                <span className="mh-sube-ad" title={s.ad}>
                  {s.ad}
                </span>
              </div>

              <div className={`mh-sube-kalan${s.kalan === 0 ? " mh-sifir" : s.kalan < 0 ? " mh-eksi" : ""}`}>
                {para(s.kalan)}
                <small>kalan havuz</small>
              </div>

              <Cubuk toplam={s.toplam} kullanim={s.kullanim} />

              <div className="mh-sube-alt">
                <span>
                  Birikmiş
                  <b>{para(s.toplam)}</b>
                </span>
                <span className="mh-sube-alt-sag">
                  Kullanılan
                  <b>{s.kullanim > 0 ? para(s.kullanim) : "—"}</b>
                </span>
              </div>

              <div className="mh-sube-dip">
                {(s.dagitimOnayda ?? 0) > 0 ? (
                  <Tooltip title="Biçen Kart'a dağıtım Admin onayında">
                    <span className="mh-bekleyen" style={{ background: "#e9f0f8", color: "#2e6aa8" }}>
                      {para(s.dagitimOnayda)} kartlara onayda
                    </span>
                  </Tooltip>
                ) : s.bekleyen > 0 ? (
                  <Tooltip title="Kesinleşmemiş kampanyalardan">
                    <span className="mh-bekleyen">+{para(s.bekleyen)} bekliyor</span>
                  </Tooltip>
                ) : (
                  <span style={{ fontSize: 12, color: "#7b8577" }}>
                    {s.kampanyaSayisi > 0 ? `${s.kampanyaSayisi} kampanya` : s.sonKullanim ? `son kullanım ${tarih(s.sonKullanim)}` : ""}
                  </span>
                )}
                <Space size={4}>
                  <Tooltip title="Havuzu personelin Biçen Kart'larına eşit böl">
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<CreditCard size={13} />}
                      disabled={s.kalan - (s.dagitimOnayda ?? 0) <= 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        dagit(s);
                      }}
                    >
                      Kartlara
                    </Button>
                  </Tooltip>
                  <Tooltip title="Kullanım ekle (organizasyon)">
                    <Button
                      size="small"
                      icon={<Wallet size={13} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        hareket(s.kod, "kullanim");
                      }}
                    />
                  </Tooltip>
                </Space>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mh-kutu">
          <Table
            size="middle"
            rowKey="kod"
            loading={yukleniyor}
            columns={sutunlar}
            dataSource={satirlar}
            pagination={false}
            scroll={{ x: true }}
            onRow={(s) => ({ onClick: () => ac(s.kod), style: { cursor: "pointer" } })}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <b>Toplam</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <b className="mh-sayi">{para(satirlar.reduce((a, s) => a + s.hakedis, 0))}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <span className="mh-sayi">{para(satirlar.reduce((a, s) => a + s.acilis + s.duzeltme, 0))}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  <b className="mh-sayi">{para(satirlar.reduce((a, s) => a + s.kullanim, 0))}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <b className="mh-sayi">{para(satirlar.reduce((a, s) => a + s.kalan, 0))}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <span className="mh-sayi">{para(satirlar.reduce((a, s) => a + s.bekleyen, 0))}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} />
              </Table.Summary.Row>
            )}
          />
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function HareketPenceresi({
  acik,
  subeler,
  bolgeler,
  kapat,
}: {
  acik: { sube?: string; tur: string } | null;
  subeler: SubeOzet[];
  bolgeler: SubeOzet[];
  kapat: (degisti: boolean) => void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [tur, setTur] = useState("kullanim");

  useEffect(() => {
    if (!acik) return;
    setTur(acik.tur);
    form.setFieldsValue({ subeKodu: acik.sube, tarih: dayjs(), tutar: null, aciklama: "" });
  }, [acik, form]);

  const subeKodu = Form.useWatch("subeKodu", form);
  const kalan = [...subeler, ...bolgeler].find((s) => s.kod === subeKodu)?.kalan;

  const kaydet = async () => {
    const v = await form.validateFields();
    setKaydediliyor(true);
    try {
      await api.gonder("/api/MagazaHavuz/Hareket", { ...v, tur, tarih: (v.tarih as Dayjs).format("YYYY-MM-DD") });
      message.success("Kaydedildi");
      kapat(true);
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    } finally {
      setKaydediliyor(false);
    }
  };

  const secenekler = [
    { k: "kullanim", ad: "Kullanım", alt: "Organizasyon, havuzdan düşer" },
    { k: "acilis", ad: "Açılış bakiyesi", alt: "Excel'den devreden tutar" },
    { k: "duzeltme", ad: "Düzeltme", alt: "Artı ya da eksi" },
  ];

  return (
    <Modal
      open={!!acik}
      wrapClassName="mh-pencere"
      title="Havuz hareketi"
      okText="Kaydet"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      onOk={kaydet}
      onCancel={() => kapat(false)}
      width={560}
      destroyOnClose
    >
      <div className="mh-tur-sec" style={{ marginBottom: 16 }}>
        {secenekler.map((x) => (
          <button key={x.k} type="button" className={tur === x.k ? "mh-aktif" : undefined} onClick={() => setTur(x.k)}>
            <b style={{ color: TUR[x.k].renk, display: "flex", alignItems: "center", gap: 6 }}>
              {TUR[x.k].ikon} {x.ad}
            </b>
            <small>{x.alt}</small>
          </button>
        ))}
      </div>

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="subeKodu" label="Havuz" rules={[{ required: true, message: "Şube ya da bölge seçin" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Şube ya da bölge seçin"
            options={[
              { label: "Şubeler", options: subeler.map((s) => ({ value: s.kod, label: s.ad })) },
              ...(bolgeler.length
                ? [{ label: "Bölge havuzları", options: bolgeler.map((s) => ({ value: s.kod, label: `${s.ad} (bölge)` })) }]
                : []),
            ]}
          />
        </Form.Item>

        {tur === "kullanim" && kalan != null && (
          <Alert
            type={kalan > 0 ? "success" : "warning"}
            showIcon
            style={{ marginBottom: 14, borderRadius: 12 }}
            message={
              <span>
                Kalan havuz: <b className="mh-sayi">{para(kalan)}</b>
              </span>
            }
          />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
          <Form.Item name="tutar" label={tur === "duzeltme" ? "Tutar (eksi olabilir)" : "Tutar"} rules={[{ required: true, message: "Tutar girin" }]}>
            <InputNumber
              style={{ width: "100%" }}
              min={tur === "duzeltme" ? -10_000_000 : 0.01}
              max={10_000_000}
              precision={2}
              decimalSeparator=","
              addonAfter="₺"
              size="large"
            />
          </Form.Item>
          <Form.Item name="tarih" label="Tarih" rules={[{ required: true }]}>
            <DatePicker format="DD.MM.YYYY" allowClear={false} style={{ width: "100%" }} size="large" />
          </Form.Item>
        </div>

        <Form.Item name="aciklama" label="Açıklama" rules={tur === "kullanim" ? [{ required: true, message: "Ne için kullanıldı?" }] : []}>
          <Input.TextArea
            rows={2}
            maxLength={500}
            placeholder={tur === "kullanim" ? "ör. Piknik organizasyonu, 24 kişi" : tur === "acilis" ? "ör. Ekim 2026 Excel raporundan devreden" : "Düzeltme sebebi"}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function SubeAyrintisi({
  sube,
  kapat,
  degisti,
  hareketEkle,
  dagit,
}: {
  sube: SubeOzet | null;
  kapat: () => void;
  degisti: () => void;
  hareketEkle: (tur: string) => void;
  dagit: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<{ kampanyalar: any[]; hareketler: any[] } | null>(null);
  const kod = sube?.kod;

  const getir = useCallback(() => {
    if (!kod) return;
    api
      .al<any>(`/api/MagazaHavuz/Sube/${encodeURIComponent(kod)}`)
      .then(setVeri)
      .catch((e) => message.error(hataMetni(e, "Ayrıntı alınamadı")));
  }, [kod, message]);

  useEffect(() => {
    setVeri(null);
    getir();
  }, [getir, sube?.toplam, sube?.kullanim]);

  const sil = async (id: number) => {
    try {
      await api.sil(`/api/MagazaHavuz/Hareket/${id}`);
      message.success("Silindi");
      degisti();
    } catch (e: any) {
      message.error(hataMetni(e, "Silinemedi"));
    }
  };

  const enBuyuk = Math.max(1, ...(veri?.kampanyalar ?? []).map((k: any) => k.net));

  return (
    <Drawer
      open={!!sube}
      onClose={kapat}
      width={760}
      rootClassName="mh-cekmece"
      title={
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mh-kampanya-ikon" style={{ width: 36, height: 36, borderRadius: 10 }}>
            <Store size={18} />
          </span>
          <span>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{sube?.ad}</div>
            <div style={{ fontSize: 12, color: "#7b8577", fontWeight: 500 }}>
              {sube?.kod.startsWith("BOLGE:") ? "Bölge havuzu · şubelerindeki kampanyaların bölge payı" : "Şube havuzu"}
            </div>
          </span>
        </span>
      }
      extra={
        <Space>
          <Button onClick={() => hareketEkle("duzeltme")}>Düzeltme</Button>
          {sube && (
            <Button icon={<CreditCard size={14} />} disabled={sube.kalan - (sube.dagitimOnayda ?? 0) <= 0} onClick={dagit}>
              Biçen Kart'a dağıt
            </Button>
          )}
          <Button type="primary" icon={<Wallet size={14} />} onClick={() => hareketEkle("kullanim")}>
            Kullanım ekle
          </Button>
        </Space>
      }
    >
      {sube && (
        <div className="mh-cekmece-ozet">
          <div>
            <span>Kalan</span>
            <b style={{ color: sube.kalan >= 0 ? "#3f6507" : "#c62828" }}>{para(sube.kalan)}</b>
          </div>
          <div>
            <span>Birikmiş</span>
            <b>{para(sube.toplam)}</b>
          </div>
          <div>
            <span>Kullanılan</span>
            <b style={{ color: "#c62828" }}>{para(sube.kullanim)}</b>
          </div>
          {sube.bekleyen > 0 && (
            <div>
              <span>Onay bekleyen</span>
              <b style={{ color: "#b77a00" }}>+{para(sube.bekleyen)}</b>
            </div>
          )}
        </div>
      )}

      {!veri ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <>
          <div className="mh-bolum">
            <div className="mh-bolum-bas">
              <span>
                Kampanyalardan gelen<small>{veri.kampanyalar.length} kampanya</small>
              </span>
            </div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={veri.kampanyalar}
              locale={{ emptyText: "Bu şubeye kampanya hakedişi yok" }}
              columns={[
                {
                  title: "Kampanya",
                  dataIndex: "ad",
                  render: (v: string, k: any) => (
                    <span>
                      <b>{v}</b>{" "}
                      {k.durum !== "kesin" && <span className="mh-bekleyen">onay bekliyor</span>}
                      <div style={{ fontSize: 11.5, color: "#7b8577" }}>
                        {tarih(k.bas)} – {tarih(k.bit)} · {para(k.birimTutar)} / birim
                      </div>
                    </span>
                  ),
                },
                { title: "Satış", dataIndex: "miktar", align: "right", width: 90, render: (v: number) => <span className="mh-sayi">{sayi(v)}</span> },
                {
                  title: "Havuza",
                  dataIndex: "net",
                  align: "right",
                  width: 210,
                  render: (v: number) => (
                    <div className="mh-satir-cubuk">
                      <i style={{ width: `${(v / enBuyuk) * 70}px` }} />
                      <b className="mh-sayi">{para(v)}</b>
                    </div>
                  ),
                },
              ]}
            />
          </div>

          <div className="mh-bolum">
            <div className="mh-bolum-bas">
              <span>
                Hareketler<small>{veri.hareketler.length} kayıt</small>
              </span>
            </div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={veri.hareketler}
              locale={{ emptyText: "Kullanım ya da açılış kaydı yok" }}
              columns={[
                {
                  title: "Tür",
                  dataIndex: "tur",
                  width: 170,
                  render: (t: string, h: any) => (
                    <span className="mh-hareket-tur" style={{ color: TUR[t]?.renk }}>
                      <i style={{ background: TUR[t]?.zemin }}>{TUR[t]?.ikon}</i>
                      <span>
                        {TUR[t]?.ad ?? t}
                        <div style={{ fontSize: 11.5, color: "#7b8577", fontWeight: 500 }}>{tarih(h.tarih)}</div>
                      </span>
                    </span>
                  ),
                },
                {
                  title: "Açıklama",
                  dataIndex: "aciklama",
                  render: (v: string, h: any) => (
                    <span>
                      {v || "—"}
                      <div style={{ fontSize: 11.5, color: "#7b8577" }}>{h.kaydeden}</div>
                    </span>
                  ),
                },
                {
                  title: "Tutar",
                  dataIndex: "tutar",
                  align: "right",
                  width: 140,
                  render: (v: number, h: any) => (
                    <b className="mh-sayi" style={{ color: h.tur === "kullanim" ? "#c62828" : h.tur === "acilis" ? "#3f6507" : undefined }}>
                      {h.tur === "kullanim" ? "−" : h.tur === "acilis" ? "+" : v > 0 ? "+" : ""}
                      {para(v)}
                    </b>
                  ),
                },
                ...(geriAlabilir()
                  ? [
                      {
                        title: "",
                        width: 44,
                        render: (_: any, h: any) => (
                          <Popconfirm title="Hareket silinsin mi?" okText="Sil" cancelText="Vazgeç" onConfirm={() => sil(h.id)}>
                            <Button size="small" type="text" danger icon={<Trash2 size={14} />} />
                          </Popconfirm>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </>
      )}
    </Drawer>
  );
}

/* ========================================================================== */
/* Kampanyalar                                                                */
/* ========================================================================== */

function Kampanyalar({
  liste,
  yukleniyor,
  yenile,
  ac,
  yeni,
}: {
  liste: KampanyaSatiri[];
  yukleniyor: boolean;
  yenile: () => void;
  ac: (id: number) => void;
  yeni: () => void;
}) {
  const [durum, setDurum] = useState<"" | "taslak" | "kesin">("");
  const [arama, setArama] = useState("");

  const q = arama.trim().toLocaleLowerCase("tr");
  const satirlar = liste.filter((k) => (!durum || k.durum === durum) && (!q || k.ad.toLocaleLowerCase("tr").includes(q)));
  const sayi_ = (d: string) => liste.filter((k) => !d || k.durum === d).length;

  return (
    <>
      <div className="mh-arac">
        <Input
          allowClear
          prefix={<Search size={15} color="#9AA3AF" />}
          placeholder="Kampanya ara"
          style={{ width: 220 }}
          value={arama}
          onChange={(e) => setArama(e.target.value)}
        />
        <div className="mh-cipler">
          {(
            [
              ["", "Tümü"],
              ["taslak", "Onay bekleyen"],
              ["kesin", "Kesinleşen"],
            ] as const
          ).map(([d, ad]) => (
            <button key={d} type="button" className={`mh-cip${durum === d ? " mh-aktif" : ""}`} onClick={() => setDurum(d)}>
              {ad} <b>{sayi_(d)}</b>
            </button>
          ))}
        </div>
        <div className="mh-arac-sag">
          <Tooltip title="Yenile">
            <Button icon={<RefreshCw size={15} />} onClick={yenile} />
          </Tooltip>
          <Button type="primary" icon={<Plus size={15} />} onClick={yeni}>
            Yeni kampanya
          </Button>
        </div>
      </div>

      {yukleniyor && liste.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Spin />
        </div>
      ) : satirlar.length === 0 ? (
        <div className="mh-bos">
          <div className="mh-bos-ikon">
            <Megaphone size={30} />
          </div>
          <b>{liste.length === 0 ? "Henüz kampanya yok" : "Bu süzgeçte kampanya yok"}</b>
          <p>
            Satınalma'nın bildirdiği ürünü, adet başı tutarı ve satış dönemini girin; şube satışları Mikro'dan
            hesaplanır, kesinleşince havuzlara eklenir.
          </p>
          <Button type="primary" icon={<Plus size={15} />} onClick={yeni}>
            Yeni kampanya
          </Button>
        </div>
      ) : (
        <div className="mh-kampanyalar">
          {satirlar.map((k) => {
            const kesin = k.durum === "kesin";
            return (
              <div key={k.id} className="mh-kampanya" onClick={() => ac(k.id)}>
                <div className={`mh-kampanya-ikon${kesin ? "" : " mh-taslak"}`}>
                  <Tags size={22} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="mh-kampanya-ad" title={k.ad}>
                    {k.ad}
                  </div>
                  <div className="mh-kampanya-alt">
                    {tarih(k.bas)} – {tarih(k.bit)} · {k.stokKodlari.length ? `${k.stokKodlari.length} ürün` : "ürün girilmedi"}
                    {k.aciklama ? ` · ${k.aciklama}` : ""}
                  </div>
                </div>
                <div className="mh-deger">
                  <span>Birim tutar</span>
                  <b>{para(k.birimTutar)}</b>
                  {k.bolgePayi > 0 && <small>bölge payı %{k.bolgePayi}</small>}
                </div>
                <div className="mh-deger">
                  <span>Satış</span>
                  <b>{sayi(k.miktar)}</b>
                  <small>{k.subeSayisi} şube</small>
                </div>
                <div className="mh-deger mh-vurgu">
                  <span>Havuza</span>
                  <b>{para(k.net)}</b>
                </div>
                {kesin ? (
                  <span className="mh-durum mh-kesin">
                    <CheckCircle2 size={13} /> Kesinleşti
                  </span>
                ) : k.hesaplama ? (
                  <span className="mh-durum mh-bekliyor">
                    <Clock3 size={13} /> Onay bekliyor
                  </span>
                ) : (
                  <span className="mh-durum mh-hesaplanmadi">
                    <Calculator size={13} /> Hesaplanmadı
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function StokSecici({ value, onChange }: { value?: string[]; onChange?: (v: string[]) => void }) {
  const [secenek, setSecenek] = useState<{ kod: string; ad: string; birim?: string }[]>([]);
  const [adlar, setAdlar] = useState<Record<string, string>>({});
  const [araniyor, setAraniyor] = useState(false);
  const zaman = useRef<number>();

  /* Kayıtlı kodların adları */
  useEffect(() => {
    const eksik = (value ?? []).filter((k) => !adlar[k]);
    if (eksik.length === 0) return;
    api
      .gonder<{ kod: string; ad: string }[]>("/api/MagazaHavuz/StokAdlari", eksik)
      .then((l) => setAdlar((a) => ({ ...a, ...Object.fromEntries(l.map((x) => [x.kod, x.ad])) })))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const ara = (q: string) => {
    window.clearTimeout(zaman.current);
    if (q.trim().length < 2) return setSecenek([]);
    zaman.current = window.setTimeout(async () => {
      setAraniyor(true);
      try {
        const l = await api.al<{ kod: string; ad: string; birim?: string }[]>(`/api/MagazaHavuz/Stok?q=${encodeURIComponent(q.trim())}`);
        setSecenek(l);
        setAdlar((a) => ({ ...a, ...Object.fromEntries(l.map((x) => [x.kod, x.ad])) }));
      } catch {
        setSecenek([]);
      } finally {
        setAraniyor(false);
      }
    }, 300);
  };

  return (
    <Select
      mode="multiple"
      size="large"
      value={value}
      onChange={onChange}
      filterOption={false}
      onSearch={ara}
      loading={araniyor}
      placeholder="Stok kodu ya da ürün adı yazın (ör. ETI BROWNI)"
      notFoundContent={araniyor ? <Spin size="small" /> : null}
      options={[
        ...secenek.map((s) => ({ value: s.kod, label: `${s.ad} · ${s.kod}${s.birim ? ` (${s.birim})` : ""}` })),
        ...(value ?? [])
          .filter((k) => !secenek.some((s) => s.kod === k))
          .map((k) => ({ value: k, label: adlar[k] ? `${adlar[k]} · ${k}` : k })),
      ]}
    />
  );
}

function KampanyaFormu({ kayit, kapat }: { kayit: KampanyaSatiri | "yeni" | null; kapat: (id?: number) => void }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    if (!kayit) return;
    if (kayit === "yeni")
      form.setFieldsValue({
        ad: "",
        stokKodlari: [],
        birimTutar: null,
        bolgePayi: 0,
        aralik: [dayjs().startOf("month"), dayjs().endOf("month")],
        aciklama: "",
      });
    else
      form.setFieldsValue({
        ad: kayit.ad,
        stokKodlari: kayit.stokKodlari,
        birimTutar: kayit.birimTutar,
        bolgePayi: kayit.bolgePayi,
        aralik: [dayjs(kayit.bas), dayjs(kayit.bit)],
        aciklama: kayit.aciklama ?? "",
      });
  }, [kayit, form]);

  const kaydet = async () => {
    const v = await form.validateFields();
    const govde = {
      ad: v.ad,
      stokKodlari: v.stokKodlari ?? [],
      birimTutar: v.birimTutar,
      bolgePayi: v.bolgePayi ?? 0,
      bas: (v.aralik[0] as Dayjs).format("YYYY-MM-DD"),
      bit: (v.aralik[1] as Dayjs).format("YYYY-MM-DD"),
      aciklama: v.aciklama,
    };
    setKaydediliyor(true);
    try {
      const s = await api.gonder<{ id: number }>(
        kayit === "yeni" ? "/api/MagazaHavuz/Kampanya" : `/api/MagazaHavuz/Kampanya/${(kayit as KampanyaSatiri).id}`,
        govde
      );
      message.success("Kampanya kaydedildi");
      kapat(s.id);
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open={!!kayit}
      wrapClassName="mh-pencere"
      title={
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mh-kampanya-ikon" style={{ width: 34, height: 34, borderRadius: 10, background: "#eef6e1", color: "#3f6507", display: "grid", placeItems: "center" }}>
            <Tags size={17} />
          </span>
          {kayit === "yeni" ? "Yeni havuz kampanyası" : "Kampanyayı düzenle"}
        </span>
      }
      okText="Kaydet"
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      onOk={kaydet}
      onCancel={() => kapat()}
      width={660}
      destroyOnClose
    >
      <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }}>
        <Form.Item name="ad" label="Kampanya adı" rules={[{ required: true, message: "Ad girin" }]}>
          <Input size="large" maxLength={150} placeholder="ör. Eti Browni Intense · adet başı 4 TL" />
        </Form.Item>
        <Form.Item
          name="stokKodlari"
          label="Ürünler"
          extra="Satış miktarı bu ürünlerden Mikro'dan hesaplanır. Ürün eklemezseniz şube miktarlarını elle girersiniz."
        >
          <StokSecici />
        </Form.Item>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.8fr)", gap: 12 }}>
          <Form.Item name="birimTutar" label="Adet / kg başı tutar" rules={[{ required: true, message: "Tutar girin" }]} extra="Satınalma'nın belirlediği">
            <InputNumber size="large" min={0.0001} max={100000} precision={4} decimalSeparator="," addonAfter="₺" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="bolgePayi" label="Bölge payı" extra="Varsa; havuza girenden düşülür">
            <InputNumber size="large" min={0} max={100} precision={2} decimalSeparator="," addonAfter="%" style={{ width: "100%" }} />
          </Form.Item>
        </div>
        <Form.Item name="aralik" label="Satış dönemi" rules={[{ required: true, message: "Tarih seçin" }]}>
          <RangePicker size="large" format="DD.MM.YYYY" allowClear={false} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="aciklama" label="Açıklama">
          <Input.TextArea rows={2} maxLength={500} placeholder="ör. Satınalma bildirimi 15.10.2026" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function KampanyaAyrintisi({
  id,
  kapat,
  degisti,
  duzenle,
}: {
  id: number | null;
  kapat: () => void;
  degisti: () => void;
  duzenle: (k: KampanyaSatiri) => void;
}) {
  const { message, modal } = AntdApp.useApp();
  const [veri, setVeri] = useState<{ kampanya: KampanyaSatiri; satirlar: Hakedis[] } | null>(null);
  const [islem, setIslem] = useState("");
  const [sadeceSatis, setSadeceSatis] = useState(true);

  const getir = useCallback(() => {
    if (!id) return;
    api
      .al<any>(`/api/MagazaHavuz/Kampanya/${id}`)
      .then(setVeri)
      .catch((e) => message.error(hataMetni(e, "Kampanya alınamadı")));
  }, [id, message]);

  useEffect(() => {
    setVeri(null);
    getir();
  }, [getir]);

  const k = veri?.kampanya;
  const kesin = k?.durum === "kesin";

  const calistir = async (ad: string, yol: string, basari: string) => {
    setIslem(ad);
    try {
      const s = await api.gonder<any>(yol);
      message.success(basari);
      if (s?.eslesmeyen?.length)
        modal.warning({
          title: "Bazı Mikro depoları şubeyle eşleşmedi",
          content: (
            <div>
              {s.eslesmeyen.map((x: any) => (
                <div key={x.depo}>
                  Depo {x.depo} {x.ad} · {sayi(x.miktar)}
                </div>
              ))}
              <div style={{ marginTop: 8, color: "#667085" }}>
                Bu depoların satışı havuza eklenmedi. Gerekirse şube satırını elle düzeltin.
              </div>
            </div>
          ),
        });
      getir();
      degisti();
    } catch (e: any) {
      message.error(hataMetni(e, "İşlem yapılamadı"));
    } finally {
      setIslem("");
    }
  };

  const dosyaRef = useRef<HTMLInputElement>(null);

  const excelAktar = async (f: File) => {
    try {
      const { satirlar: excel, urunler } = subeSatisExceliniCoz(XLSX.read(await f.arrayBuffer(), { type: "array" }));
      if (!excel.length) {
        message.error("Excel'de şube satış miktarı bulunamadı ('<ŞUBE> satış miktarı' ya da Şube/Miktar sütunları).");
        return;
      }
      setIslem("excel");
      const o = await api.gonder<any>(`/api/MagazaHavuz/Kampanya/${id}/MiktarAktar`, { satirlar: excel, onizleme: true });
      setIslem("");
      const elle: Record<string, string> = {};
      modal.confirm({
        width: 680,
        title: `${f.name} · ${o.satirlar.length} şube`,
        okText: "Şubelere yaz",
        cancelText: "Vazgeç",
        content: (
          <div style={{ display: "grid", gap: 10 }}>
            {urunler.length > 0 && (
              <div style={{ fontSize: 12, color: "#667085" }}>Ürün: {urunler.slice(0, 5).join(" · ")}{urunler.length > 5 ? ` (+${urunler.length - 5})` : ""}</div>
            )}
            <div>
              Toplam <b>{sayi(o.toplamMiktar)}</b> adet × {para(k?.birimTutar)}
              {k?.bolgePayi ? ` (bölge payı %${k.bolgePayi} düşülür)` : ""} = <b>{para(o.toplamNet)}</b> şube havuzlarına
            </div>
            <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid #eef0ea", borderRadius: 10 }}>
              <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
                <tbody>
                  {o.satirlar.filter((x: any) => x.miktar > 0).map((x: any) => (
                    <tr key={x.subeKodu} style={{ borderBottom: "1px solid #f3f4f0" }}>
                      <td style={{ padding: "4px 8px" }}>{x.subeAdi}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{sayi(x.miktar)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{para(x.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {o.eslesmeyen.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="Şubeyle eşleşmeyen satışlar · şubesini seçin, seçilmeyen yazılmaz"
                description={
                  <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                    {o.eslesmeyen.map((x: any) => (
                      <div key={x.ad} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 200px", gap: 8, alignItems: "center" }}>
                        <span>{x.ad}</span>
                        <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{sayi(x.miktar)}</span>
                        <Select
                          size="small"
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          placeholder="Şube seçin"
                          onChange={(v) => {
                            if (v) elle[x.ad] = v;
                            else delete elle[x.ad];
                          }}
                          options={(veri?.satirlar ?? []).map((h) => ({ value: h.subeKodu, label: h.subeAdi }))}
                        />
                      </div>
                    ))}
                  </div>
                }
              />
            )}
            <div style={{ fontSize: 12, color: "#667085" }}>
              Satırlar elle girilmiş sayılır; Excel'de olmayan şubelere dokunulmaz. Kontrol edip kesinleştirin.
            </div>
          </div>
        ),
        onOk: async () => {
          try {
            await api.gonder(`/api/MagazaHavuz/Kampanya/${id}/MiktarAktar`, {
              satirlar: excel.map((x) => (elle[x.ad] ? { ...x, subeKodu: elle[x.ad] } : x)),
              onizleme: false,
            });
            message.success("Şube miktarları yazıldı");
            getir();
            degisti();
          } catch (e: any) {
            message.error(hataMetni(e, "Yazılamadı"));
          }
        },
      });
    } catch (e: any) {
      setIslem("");
      message.error(hataMetni(e, "Excel okunamadı"));
    }
  };

  const satirKaydet = async (s: Hakedis, miktar: number | null) => {
    if (miktar == null || miktar === s.miktar) return;
    try {
      await api.gonder(`/api/MagazaHavuz/Kampanya/${id}/Satir`, { subeKodu: s.subeKodu, miktar });
      getir();
      degisti();
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    }
  };

  const satirlar = (veri?.satirlar ?? []).filter((s) => !sadeceSatis || s.miktar !== 0 || s.elle);
  const toplam = (f: keyof Hakedis) => (veri?.satirlar ?? []).reduce((a, s) => a + (s[f] as number), 0);
  const enBuyuk = Math.max(1, ...(veri?.satirlar ?? []).map((s) => s.net));

  const excel = () =>
    k &&
    tabloIndir({
      baslik: `Havuz kampanyası · ${k.ad}`,
      altBaslik: `${tarih(k.bas)} – ${tarih(k.bit)} · ${para(k.birimTutar)} / birim${k.bolgePayi ? ` · bölge payı %${k.bolgePayi}` : ""}`,
      sayfaAdi: "Kampanya",
      dosyaAdi: `havuz-${k.ad}`.replace(/[^\p{L}\p{N}-]+/gu, "-").slice(0, 60),
      genelToplam: true,
      sutunlar: [
        { ad: "Şube", genislik: 24 },
        { ad: "Satış Miktarı", tip: "ondalik" },
        { ad: "Brüt Tutar", tip: "para" },
        { ad: "Bölge Payı", tip: "para" },
        { ad: "Havuza Giren", tip: "para", veriCubugu: true },
        { ad: "Elle Düzeltildi", genislik: 12 },
      ],
      satirlar: (veri?.satirlar ?? []).map((s) => [s.subeAdi, s.miktar, s.brut, s.bolgePayi, s.net, s.elle ? "Evet" : ""]),
    });

  return (
    <Drawer
      open={id != null}
      onClose={kapat}
      width={820}
      rootClassName="mh-cekmece"
      title={
        k && (
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={`mh-kampanya-ikon${kesin ? "" : " mh-taslak"}`} style={{ width: 38, height: 38, borderRadius: 11 }}>
              <Tags size={19} />
            </span>
            <span style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{k.ad}</div>
              <div style={{ fontSize: 12, color: "#7b8577", fontWeight: 500 }}>
                {tarih(k.bas)} – {tarih(k.bit)}
              </div>
            </span>
          </span>
        )
      }
      extra={
        k && (
          <Space wrap>
            {!kesin && (
              <>
                <Button onClick={() => duzenle(k)}>Düzenle</Button>
                <Popconfirm
                  title="Kampanya silinsin mi?"
                  okText="Sil"
                  cancelText="Vazgeç"
                  onConfirm={async () => {
                    try {
                      await api.sil(`/api/MagazaHavuz/Kampanya/${k.id}`);
                      message.success("Silindi");
                      degisti();
                      kapat();
                    } catch (e: any) {
                      message.error(hataMetni(e, "Silinemedi"));
                    }
                  }}
                >
                  <Button danger icon={<Trash2 size={14} />} />
                </Popconfirm>
              </>
            )}
            <Button icon={<Download size={14} />} onClick={excel}>
              Excel
            </Button>
          </Space>
        )
      }
    >
      {!veri || !k ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <>
          <div className="mh-cekmece-ozet">
            <div>
              <span>Havuza giren</span>
              <b style={{ color: "#3f6507" }}>{para(toplam("net"))}</b>
            </div>
            <div>
              <span>Satış</span>
              <b>{sayi(toplam("miktar"))}</b>
            </div>
            <div>
              <span>Birim tutar</span>
              <b>{para(k.birimTutar)}</b>
            </div>
            <div>
              <span>Şube</span>
              <b>{(veri.satirlar ?? []).filter((s) => s.net !== 0).length}</b>
            </div>
          </div>

          <div className="mh-bilgi-satiri">
            <span>
              Ürün: <b>{k.stokKodlari.length || "girilmedi"}</b>
            </span>
            {k.bolgePayi > 0 && (
              <span>
                Bölge payı: <b>%{k.bolgePayi}</b> · {para(toplam("bolgePayi"))}
              </span>
            )}
            {k.hesaplama && <span>Son hesaplama: {dayjs(k.hesaplama).format("DD.MM.YYYY HH:mm")}</span>}
            {k.olusturan && <span>Giren: {k.olusturan}</span>}
            {k.aciklama && <span>{k.aciklama}</span>}
          </div>

          {kesin ? (
            <Alert
              type="success"
              showIcon
              style={{ borderRadius: 14, marginBottom: 14 }}
              message={`Kesinleşti · ${k.kesinlestiren ?? ""} · ${tarih(k.kesinlesme)}`}
              description="Tutarlar şube havuzlarına eklendi."
              action={
                geriAlabilir() && (
                  <Popconfirm
                    title="Kesinleştirme geri alınsın mı? Tutarlar havuzlardan çıkar."
                    okText="Geri al"
                    cancelText="Vazgeç"
                    onConfirm={() => calistir("geri", `/api/MagazaHavuz/Kampanya/${k.id}/GeriAl`, "Geri alındı")}
                  >
                    <Button size="small" icon={<Undo2 size={14} />} loading={islem === "geri"}>
                      Geri al
                    </Button>
                  </Popconfirm>
                )
              }
            />
          ) : (
            <div className="mh-adimlar">
              <Tooltip
                title={
                  k.hesapKaynagi === "satinalma"
                    ? "Hakedişi satınalma hesaplıyor; satırları elle düzeltebilirsiniz"
                    : k.stokKodlari.length
                      ? ""
                      : "Ürün girilmediği için miktarlar elle girilir"
                }
              >
                <Button
                  icon={<Calculator size={15} />}
                  loading={islem === "hesapla"}
                  disabled={k.stokKodlari.length === 0 || k.hesapKaynagi === "satinalma"}
                  onClick={() => calistir("hesapla", `/api/MagazaHavuz/Kampanya/${k.id}/Hesapla`, "Mikro'dan hesaplandı")}
                >
                  1 · Mikro'dan hesapla
                </Button>
              </Tooltip>
              <input
                ref={dosyaRef}
                type="file"
                accept=".xls,.xlsx"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) excelAktar(f);
                }}
              />
              <Tooltip title="Mikro şube bazlı satış raporu ya da Şube / Miktar listesi">
                <Button icon={<FileSpreadsheet size={15} />} loading={islem === "excel"} onClick={() => dosyaRef.current?.click()}>
                  ya da Excel'den şube satışları
                </Button>
              </Tooltip>
              <Popconfirm
                title="Kampanya kesinleştirilsin mi? Tutarlar şube havuzlarına eklenir."
                okText="Kesinleştir"
                cancelText="Vazgeç"
                onConfirm={() => calistir("kesin", `/api/MagazaHavuz/Kampanya/${k.id}/Kesinlestir`, "Kesinleştirildi")}
              >
                <Button type="primary" icon={<CheckCircle2 size={15} />} loading={islem === "kesin"} disabled={toplam("net") <= 0}>
                  2 · Kesinleştir
                </Button>
              </Popconfirm>
              <span style={{ fontSize: 12, color: "#7b8577", flex: "1 1 200px" }}>
                Miktara tıklayıp düzeltebilirsiniz; elle düzeltilen satır yeniden hesaplamada korunur.
              </span>
            </div>
          )}

          <div className="mh-bolum">
            <div className="mh-bolum-bas">
              <span>
                Şube hakedişleri<small>{satirlar.length} şube</small>
              </span>
              <Segmented
                size="small"
                value={sadeceSatis ? "satis" : "tumu"}
                onChange={(v) => setSadeceSatis(v === "satis")}
                options={[
                  { value: "satis", label: "Satışı olanlar" },
                  { value: "tumu", label: "Tüm şubeler" },
                ]}
              />
            </div>
            <Table
              size="small"
              rowKey="subeKodu"
              pagination={false}
              dataSource={satirlar}
              locale={{
                emptyText: k.stokKodlari.length
                  ? "Henüz hesaplanmadı. 'Mikro'dan hesapla'ya basın."
                  : "Ürün girilmedi; 'Tüm şubeler'i seçip miktarları elle girin.",
              }}
              columns={[
                {
                  title: "Şube",
                  dataIndex: "subeAdi",
                  render: (v: string, s) => (
                    <span>
                      <b>{v}</b>{" "}
                      {s.elle && (
                        <span className="mh-bekleyen" style={{ background: "#e9f0f8", color: "#2e6aa8" }}>
                          elle
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  title: "Satış",
                  dataIndex: "miktar",
                  align: "right",
                  width: 140,
                  render: (v: number, s) =>
                    kesin ? (
                      <span className="mh-sayi">{sayi(v)}</span>
                    ) : (
                      <InputNumber
                        key={`${s.subeKodu}-${v}`}
                        size="small"
                        min={0}
                        decimalSeparator=","
                        defaultValue={v}
                        style={{ width: 115 }}
                        onBlur={(e) => {
                          const n = Number(String(e.target.value).replace(/\./g, "").replace(",", "."));
                          satirKaydet(s, Number.isFinite(n) ? n : null);
                        }}
                        onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                      />
                    ),
                },
                ...(k.bolgePayi > 0
                  ? [
                      { title: "Brüt", dataIndex: "brut", align: "right" as const, render: (v: number) => <span className="mh-sayi">{para(v)}</span> },
                      { title: "Bölge payı", dataIndex: "bolgePayi", align: "right" as const, render: (v: number) => <span className="mh-sayi">{para(v)}</span> },
                    ]
                  : []),
                {
                  title: "Havuza",
                  dataIndex: "net",
                  align: "right",
                  width: 230,
                  render: (v: number) => (
                    <div className="mh-satir-cubuk">
                      <i style={{ width: `${(Math.max(v, 0) / enBuyuk) * 80}px` }} />
                      <b className="mh-sayi">{para(v)}</b>
                    </div>
                  ),
                },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <b>Toplam</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <b className="mh-sayi">{sayi(toplam("miktar"))}</b>
                  </Table.Summary.Cell>
                  {k.bolgePayi > 0 && (
                    <>
                      <Table.Summary.Cell index={2} align="right">
                        <span className="mh-sayi">{para(toplam("brut"))}</span>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <span className="mh-sayi">{para(toplam("bolgePayi"))}</span>
                      </Table.Summary.Cell>
                    </>
                  )}
                  <Table.Summary.Cell index={4} align="right">
                    <b className="mh-sayi" style={{ color: "#3f6507" }}>
                      {para(toplam("net"))}
                    </b>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </div>
        </>
      )}
    </Drawer>
  );
}

/* ========================================================================== */
/* Excel devri                                                                */
/* ========================================================================== */

/** Türkçe karakterleri sadeleştirip büyük harfe çevirir (sayfa ve başlık eşleştirmesi) */
const sade = (v: unknown) =>
  String(v ?? "")
    .toLocaleUpperCase("tr")
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/[^A-Z0-9]/g, "");

interface DevirVerisi {
  kampanyalar: { ad: string; satirlar: { sube: string; miktar: number; bolge: number; net: number }[] }[];
  odemeler: { ad: string; tutar: number; satir: number }[];
  bolgeEk: { ad: string; tutar: number; satir: number }[];
  ozetKalan: { ad: string; tutar: number; satir: number }[];
  bolgeOzetKalan: { ad: string; tutar: number; satir: number }[];
  subeBolge: { sube: string; mudur: string }[];
}

/**
 * "MAĞAZA HAVUZ RAPORU" Excel'ini çözer.
 * BİRİKEN KAMPANYALAR: "ŞUBE" başlık satırı; başlığı "SATIŞ…" ile başlayan
 * her sütun bir kampanya bloğu: miktar, (tutar), bölge payı, şubeye kalan
 * (blok içinde +2 ve +3). Kampanya adı bir üst satırda. Hata hücreleri
 * (#N/A) sıfır sayılır.
 */
/**
 * Şube satış miktarı Excel'i. İki biçim:
 *  - Mikro şube bazlı satış raporu: "<ŞUBE> satış miktarı" sütunları, her
 *    ürün bir satır (stok kodu boş satırlar — ara toplam — sayılmaz).
 *  - Liste: "Şube"/"Depo" ve "Miktar" sütunları.
 */
function subeSatisExceliniCoz(wb: XLSX.WorkBook): { satirlar: { ad: string; miktar: number }[]; urunler: string[] } {
  const kucuk = (v: any) => String(v ?? "").trim().toLocaleLowerCase("tr");
  const sayiyaCevir = (v: any) => {
    if (typeof v === "number") return v;
    const t = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  };
  const toplam = new Map<string, number>();
  const urunler: string[] = [];

  for (const ad of wb.SheetNames) {
    const r: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[ad], { header: 1, defval: null });
    const bi = r.findIndex((x) => (x ?? []).some((h) => / satış miktarı$/.test(kucuk(h)) || ["şube", "depo", "şube adı", "depo adı"].includes(kucuk(h))));
    if (bi < 0) continue;
    const bas = r[bi].map(kucuk);
    const stokSut = bas.findIndex((h) => h === "stok kodu");
    const isimSut = bas.findIndex((h) => h === "stok ismi" || h === "stok adı");
    const veri = r.slice(bi + 1).filter((x) => x && (stokSut < 0 || String(x[stokSut] ?? "").trim() !== ""));

    const genis = bas.map((h, i) => [h, i] as const).filter(([h]) => / satış miktarı$/.test(h));
    if (genis.length) {
      for (const x of veri) {
        if (stokSut >= 0) urunler.push(`${String(x[stokSut]).trim()}${isimSut >= 0 && x[isimSut] ? " · " + String(x[isimSut]).trim() : ""}`);
        for (const [, i] of genis) {
          const sube = String(r[bi][i]).trim().replace(/ satış miktarı$/i, "").trim();
          toplam.set(sube, (toplam.get(sube) ?? 0) + sayiyaCevir(x[i]));
        }
      }
      continue;
    }

    const subeSut = bas.findIndex((h) => ["şube", "depo", "şube adı", "depo adı"].includes(h));
    const miktarSut = bas.findIndex((h) => h.includes("miktar"));
    if (subeSut < 0 || miktarSut < 0) continue;
    for (const x of veri) {
      const sube = String(x[subeSut] ?? "").trim();
      if (!sube || /toplam/i.test(sube)) continue;
      toplam.set(sube, (toplam.get(sube) ?? 0) + sayiyaCevir(x[miktarSut]));
    }
  }

  return { satirlar: [...toplam].map(([ad, miktar]) => ({ ad, miktar })), urunler };
}

function havuzExceliniCoz(wb: XLSX.WorkBook): DevirVerisi {
  const sayfa = (ad: string) => {
    const n = wb.SheetNames.find((x) => sade(x) === sade(ad));
    return n ? wb.Sheets[n] : null;
  };
  const h = (ws: XLSX.WorkSheet, r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })];
  const sayi = (ws: XLSX.WorkSheet, r: number, c: number) => {
    const x = h(ws, r, c);
    return x && x.t === "n" && Number.isFinite(x.v) ? (x.v as number) : 0;
  };
  const yazi = (ws: XLSX.WorkSheet, r: number, c: number) => {
    const x = h(ws, r, c);
    return x && x.t !== "e" && x.v != null ? String(x.v).trim() : "";
  };

  const sonuc: DevirVerisi = { kampanyalar: [], odemeler: [], bolgeEk: [], ozetKalan: [], bolgeOzetKalan: [], subeBolge: [] };

  /* ---- birikenler */
  const bk = sayfa("BİRİKEN KAMPANYALAR");
  if (!bk) throw new Error("'BİRİKEN KAMPANYALAR' sayfası bulunamadı.");
  const ar = XLSX.utils.decode_range(bk["!ref"] ?? "A1");
  let bas = -1;
  for (let r = ar.s.r; r <= Math.min(ar.e.r, 8) && bas < 0; r++)
    if (sade(yazi(bk, r, 1)) === "SUBE") bas = r;
  if (bas < 0) throw new Error("'BİRİKEN KAMPANYALAR' sayfasında 'ŞUBE' başlığı bulunamadı.");

  const veriSatirlari: number[] = [];
  for (let r = bas + 1; r <= ar.e.r; r++) if (yazi(bk, r, 1)) veriSatirlari.push(r);

  for (const r of veriSatirlari) sonuc.subeBolge.push({ sube: yazi(bk, r, 1), mudur: yazi(bk, r, 2) });

  for (let c = 2; c <= ar.e.c; c++) {
    if (!sade(yazi(bk, bas, c)).startsWith("SATIS")) continue;
    let ad = yazi(bk, bas - 1, c);
    for (let cc = c - 1; !ad && cc >= c - 3 && cc >= 0; cc--) ad = yazi(bk, bas - 1, cc);
    sonuc.kampanyalar.push({
      ad: ad || `Kampanya ${sonuc.kampanyalar.length + 1}`,
      satirlar: veriSatirlari.map((r) => ({
        sube: yazi(bk, r, 1),
        miktar: sayi(bk, r, c),
        bolge: sayi(bk, r, c + 2),
        net: sayi(bk, r, c + 3),
      })),
    });
  }

  /* ---- ödenenler */
  const od = sayfa("ÖDENENLER");
  if (od) {
    const o = XLSX.utils.decode_range(od["!ref"] ?? "A1");
    for (let r = o.s.r; r <= o.e.r; r++) {
      const ad = yazi(od, r, 0);
      const t = sayi(od, r, 1);
      if (ad && t) sonuc.odemeler.push({ ad, tutar: t, satir: r + 1 });
    }
  }

  /* ---- özet: şube kalanları, sonra bölge bölümü */
  const oz = sayfa("ÖZET");
  if (oz) {
    const o = XLSX.utils.decode_range(oz["!ref"] ?? "A1");
    let bolge = false;
    for (let r = o.s.r; r <= o.e.r; r++) {
      const a0 = sade(yazi(oz, r, 0));
      if (a0.includes("BOLGE")) bolge = true;
      const ad = yazi(oz, r, 1);
      if (!ad || sade(ad) === "SUBE") continue;
      const kalan = sayi(oz, r, 3);
      if (bolge) {
        sonuc.bolgeOzetKalan.push({ ad, tutar: kalan, satir: r + 1 });
        const ek = sayi(oz, r, 4);
        if (ek) sonuc.bolgeEk.push({ ad, tutar: ek, satir: r + 1 });
      } else sonuc.ozetKalan.push({ ad, tutar: kalan, satir: r + 1 });
    }
  }

  return sonuc;
}

function DevirPenceresi({ acik, kapat }: { acik: boolean; kapat: (degisti: boolean) => void }) {
  const { message } = AntdApp.useApp();
  const [dosyaAdi, setDosyaAdi] = useState("");
  const [veri, setVeri] = useState<DevirVerisi | null>(null);
  const [onizleme, setOnizleme] = useState<any>(null);
  const [atlanan, setAtlanan] = useState<number[]>([]);
  /* Kapalı şubeye ait olup kullanıcının yine de dahil ettiği ödemeler */
  const [dahil, setDahil] = useState<number[]>([]);
  const [tarih_, setTarih] = useState<Dayjs>(dayjs());
  const [calisiyor, setCalisiyor] = useState(false);
  const [sadeceFark, setSadeceFark] = useState(true);
  const girdi = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (acik) return;
    setDosyaAdi("");
    setVeri(null);
    setOnizleme(null);
    setAtlanan([]);
    setDahil([]);
  }, [acik]);

  const govde = (v: DevirVerisi, atla: number[], dhl: number[]) => ({
    ...v,
    tarih: tarih_.format("YYYY-MM-DD"),
    atlananOdemeler: atla,
    dahilOdemeler: dhl,
  });

  const onizle = async (v: DevirVerisi, atla: number[], dhl: number[] = dahil) => {
    setCalisiyor(true);
    try {
      setOnizleme(await api.gonder<any>("/api/MagazaHavuz/Devir?onizleme=true", govde(v, atla, dhl)));
    } catch (e: any) {
      message.error(hataMetni(e, "Önizleme alınamadı"));
    } finally {
      setCalisiyor(false);
    }
  };

  const dosyaSec = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const v = havuzExceliniCoz(wb);
      setDosyaAdi(f.name);
      setVeri(v);
      setAtlanan([]);
      setDahil([]);
      await onizle(v, [], []);
    } catch (e: any) {
      message.error(hataMetni(e, "Excel okunamadı"));
    }
  };

  const atlaDegistir = (satir: number, atla: boolean) => {
    const yeni = atla ? [...atlanan, satir] : atlanan.filter((x) => x !== satir);
    const yeniDahil = atla ? dahil.filter((x) => x !== satir) : [...dahil, satir];
    setAtlanan(yeni);
    setDahil(yeniDahil);
    if (veri) onizle(veri, yeni, yeniDahil);
  };

  const aktar = async () => {
    if (!veri) return;
    setCalisiyor(true);
    try {
      const s = await api.gonder<any>("/api/MagazaHavuz/Devir?onizleme=false", govde(veri, atlanan, dahil));
      message.success(`${s.kampanya} kampanya ve ${s.hareket} hareket aktarıldı`);
      kapat(true);
    } catch (e: any) {
      message.error(hataMetni(e, "Aktarılamadı"));
    } finally {
      setCalisiyor(false);
    }
  };

  const o = onizleme;
  const farklar = (o?.karsilastirma ?? []).filter((x: any) => !sadeceFark || x.sistem == null || Math.abs(x.fark ?? 0) >= 0.01);
  const farkSayisi = (o?.karsilastirma ?? []).filter((x: any) => x.sistem == null || Math.abs(x.fark ?? 0) >= 0.01).length;

  return (
    <Modal
      open={acik}
      wrapClassName="mh-pencere"
      width={980}
      title={
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mh-kampanya-ikon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <FileSpreadsheet size={17} />
          </span>
          Excel'den aktar · Mağaza Havuz Raporu
        </span>
      }
      onCancel={() => kapat(false)}
      footer={
        <Space>
          <Button onClick={() => kapat(false)}>Vazgeç</Button>
          <Popconfirm
            title="Kampanyalar kesinleşmiş olarak, ödemeler kullanım olarak aktarılsın mı?"
            okText="Aktar"
            cancelText="Vazgeç"
            onConfirm={aktar}
            disabled={!o || o.oncekiDevir > 0}
          >
            <Button type="primary" loading={calisiyor} disabled={!o || o.oncekiDevir > 0}>
              Aktar
            </Button>
          </Popconfirm>
        </Space>
      }
      destroyOnClose
    >
      <input
        ref={girdi}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) dosyaSec(f);
          e.target.value = "";
        }}
      />

      <div className="mh-devir-ust">
        <button type="button" className="mh-devir-dosya" onClick={() => girdi.current?.click()}>
          <FileSpreadsheet size={22} />
          <span>
            <b>{dosyaAdi || "Excel dosyasını seçin"}</b>
            <small>
              {dosyaAdi
                ? `${veri?.kampanyalar.length ?? 0} kampanya · ${veri?.odemeler.length ?? 0} ödeme satırı okundu`
                : "BİRİKEN KAMPANYALAR, ÖDENENLER ve ÖZET sayfaları okunur"}
            </small>
          </span>
        </button>
        <div>
          <div style={{ fontSize: 12, color: "#7b8577", marginBottom: 4 }}>Devir tarihi</div>
          <DatePicker
            value={tarih_}
            format="DD.MM.YYYY"
            allowClear={false}
            onChange={(d) => d && setTarih(d)}
          />
        </div>
      </div>

      {calisiyor && !o && (
        <div style={{ textAlign: "center", padding: 30 }}>
          <Spin />
        </div>
      )}

      {o && (
        <Spin spinning={calisiyor}>
          {o.oncekiDevir > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ borderRadius: 12, marginBottom: 12 }}
              message="Excel devri daha önce yapılmış"
              description="Tekrar aktarmak için önce 'Excel devri' açıklamalı kampanyaların kesinleştirmesini geri alıp silin."
            />
          )}

          <div className="mh-cekmece-ozet" style={{ marginTop: 4 }}>
            <div>
              <span>Kampanya</span>
              <b>{o.kampanyalar.length}</b>
            </div>
            <div>
              <span>Şubelere kalan</span>
              <b style={{ color: "#3f6507" }}>{para(o.kampanyalar.reduce((a: number, k: any) => a + k.net, 0))}</b>
            </div>
            <div>
              <span>Bölge payı</span>
              <b>{para(o.kampanyalar.reduce((a: number, k: any) => a + k.bolge, 0))}</b>
            </div>
            <div>
              <span>Ödenen (aktarılacak)</span>
              <b style={{ color: "#c62828" }}>
                {para(o.odemeler.filter((x: any) => x.kod && !x.atla).reduce((a: number, x: any) => a + x.tutar, 0))}
              </b>
            </div>
          </div>

          {(o.kapaliSubeler ?? []).length > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ borderRadius: 12, marginBottom: 12 }}
              message={`Kapalı şube sayıldı: ${o.kapaliSubeler.join(", ")}`}
              description="Excel'de değerleri boş ya da #N/A olduğu için aktarılmıyor; adlarına olan ödemeler de atlandı."
            />
          )}

          {o.eslesmeyenSube.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ borderRadius: 12, marginBottom: 12 }}
              message={`Sistemde bulunamayan şube: ${o.eslesmeyenSube.join(", ")}`}
              description="Bu şubelerin satırları aktarılmaz. Gerekirse Yönetim › Birimler'de şube adını kontrol edin."
            />
          )}

          <div className="mh-bolum">
            <div className="mh-bolum-bas">
              <span>
                Excel'deki kalan ile karşılaştırma
                <small>{farkSayisi ? `${farkSayisi} satırda fark var` : "bütün kalanlar tutuyor"}</small>
              </span>
              <Segmented
                size="small"
                value={sadeceFark ? "fark" : "tumu"}
                onChange={(v) => setSadeceFark(v === "fark")}
                options={[
                  { value: "fark", label: "Farklı olanlar" },
                  { value: "tumu", label: "Tümü" },
                ]}
              />
            </div>
            <Table
              size="small"
              rowKey={(x: any) => x.excelAd}
              pagination={false}
              scroll={{ y: 260 }}
              dataSource={farklar}
              locale={{ emptyText: "Aktarım sonrası kalanlar Excel'deki ÖZET ile aynı" }}
              columns={[
                {
                  title: "Excel",
                  dataIndex: "excelAd",
                  render: (v: string, x: any) => (
                    <span>
                      <b>{v}</b>
                      <div style={{ fontSize: 11.5, color: x.sistemAd ? "#7b8577" : "#c62828" }}>
                        {x.sistemAd ? `→ ${x.sistemAd}` : "sistemde bulunamadı"}
                      </div>
                    </span>
                  ),
                },
                { title: "Excel kalan", dataIndex: "excel", align: "right", render: (v: number) => <span className="mh-sayi">{para(v)}</span> },
                {
                  title: "Sistemde olacak",
                  dataIndex: "sistem",
                  align: "right",
                  render: (v: number | null) => <span className="mh-sayi">{v == null ? "—" : para(v)}</span>,
                },
                {
                  title: "Fark",
                  dataIndex: "fark",
                  align: "right",
                  render: (v: number | null) =>
                    v == null ? "—" : Math.abs(v) < 0.01 ? (
                      <CheckCircle2 size={15} color="#5f8c10" />
                    ) : (
                      <b className="mh-sayi" style={{ color: "#c62828" }}>
                        {v > 0 ? "+" : ""}
                        {para(v)}
                      </b>
                    ),
                },
              ]}
            />
          </div>

          <div className="mh-bolum" style={{ marginBottom: 0 }}>
            <div className="mh-bolum-bas">
              <span>
                Ödenenler<small>işaretini kaldırdığınız satır aktarılmaz</small>
              </span>
            </div>
            <Table
              size="small"
              rowKey="satir"
              pagination={false}
              scroll={{ y: 260 }}
              dataSource={o.odemeler}
              columns={[
                {
                  title: "",
                  width: 44,
                  render: (_: any, x: any) => (
                    <input
                      type="checkbox"
                      checked={!x.atla && !!x.kod}
                      disabled={!x.kod}
                      onChange={(e) => atlaDegistir(x.satir, !e.target.checked)}
                    />
                  ),
                },
                { title: "Satır", dataIndex: "satir", width: 60 },
                {
                  title: "Excel",
                  dataIndex: "excelAd",
                  render: (v: string, x: any) => (
                    <span>
                      <b>{v}</b>
                      <div style={{ fontSize: 11.5, color: x.kapali ? "#b77a00" : x.kod ? "#7b8577" : "#c62828" }}>
                        {x.kapali
                          ? "kapalı şube, aktarılmaz"
                          : x.kod
                            ? `→ ${x.sistemAd}`
                            : "eşleşmedi, aktarılmaz"}
                      </div>
                    </span>
                  ),
                },
                {
                  title: "Tutar",
                  dataIndex: "tutar",
                  align: "right",
                  render: (v: number, x: any) => (
                    <b className="mh-sayi" style={{ color: x.kod && !x.atla ? "#c62828" : "#98a2b3" }}>
                      {para(v)}
                    </b>
                  ),
                },
              ]}
            />
          </div>
        </Spin>
      )}
    </Modal>
  );
}

/* ========================================================================== */
/* Biçen Kart'a dağıtım                                                       */
/* ========================================================================== */

interface DagitimKisi {
  sicil: string;
  adSoyad: string;
  pozisyon: string | null;
  sube?: string | null;
  giris: string | null;
  kartNo: string | null;
  kartVar: boolean;
}

function DagitimPenceresi({ sube, kapat }: { sube: SubeOzet | null; kapat: (degisti: boolean) => void }) {
  const { message, modal } = AntdApp.useApp();
  const [veri, setVeri] = useState<{ kullanilabilir: number; bekleyenTalep: number | null; kisiler: DagitimKisi[] } | null>(null);
  const [haric, setHaric] = useState<string[]>([]);
  const [tutar, setTutar] = useState<number | null>(null);
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    setVeri(null);
    setHaric([]);
    setAciklama("");
    if (!sube) return;
    api
      .al<any>(`/api/MagazaHavuz/Dagitim/${encodeURIComponent(sube.kod)}`)
      .then((v) => {
        setVeri(v);
        setTutar(Math.max(0, Math.floor(v.kullanilabilir * 100) / 100));
      })
      .catch((e) => message.error(hataMetni(e, "Personel listesi alınamadı")));
  }, [sube, message]);

  /* 26.10.2026: bölge havuzu yalnız bölge müdürünün kartına */
  const bolgeHavuzu = (sube?.kod ?? "").toUpperCase().startsWith("BOLGE:");
  const alanlar = (veri?.kisiler ?? []).filter((k) => k.kartVar && !haric.includes(k.sicil));
  const kartsiz = (veri?.kisiler ?? []).filter((k) => !k.kartVar);
  const kisiBasi = alanlar.length && tutar ? Math.floor((tutar / alanlar.length) * 100) / 100 : 0;
  const toplam = Math.round(kisiBasi * alanlar.length * 100) / 100;

  const gonder = async () => {
    setGonderiliyor(true);
    try {
      const s = await api.gonder<any>(`/api/MagazaHavuz/Dagitim/${encodeURIComponent(sube!.kod)}`, {
        tutar,
        haric,
        aciklama: aciklama.trim() || undefined,
      });
      modal.success({
        title: "Admin onayına gönderildi",
        content: `${s.kisi} kişi × ${para(s.kisiBasi)} = ${para(s.toplam)} · puan talebi #${s.id}. Onaylanınca kartlara yüklenir ve tutar havuzdan düşer.`,
      });
      kapat(true);
    } catch (e: any) {
      message.error(hataMetni(e, "Gönderilemedi"));
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      open={!!sube}
      wrapClassName="mh-pencere"
      width={720}
      title={
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mh-kampanya-ikon" style={{ width: 34, height: 34, borderRadius: 10 }}>
            <CreditCard size={17} />
          </span>
          <span>
            Biçen Kart'a dağıt
            <div style={{ fontSize: 12, color: "#7b8577", fontWeight: 500 }}>{sube?.ad}</div>
          </span>
        </span>
      }
      onCancel={() => kapat(false)}
      footer={
        <Space>
          <Button onClick={() => kapat(false)}>Vazgeç</Button>
          <Popconfirm
            title={bolgeHavuzu
              ? `${alanlar.map((k) => k.adSoyad).join(", ")} kartına ${para(toplam)} yüklensin mi? Admin onayından sonra karta geçer.`
              : `${alanlar.length} kişiye ${para(kisiBasi)} yüklensin mi? Admin onayından sonra kartlara geçer.`}
            okText="Onaya gönder"
            cancelText="Vazgeç"
            onConfirm={gonder}
            disabled={!veri || !!veri.bekleyenTalep || kisiBasi <= 0}
          >
            <Button type="primary" loading={gonderiliyor} disabled={!veri || !!veri.bekleyenTalep || kisiBasi <= 0}>
              Onaya gönder
            </Button>
          </Popconfirm>
        </Space>
      }
      destroyOnClose
    >
      {!veri ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <>
          {veri.bekleyenTalep && (
            <Alert
              type="warning"
              showIcon
              style={{ borderRadius: 12, marginBottom: 12 }}
              message={`Bu şubenin onay bekleyen bir dağıtımı var (puan talebi #${veri.bekleyenTalep}).`}
              description="Önce o talep onaylanmalı ya da reddedilmeli."
            />
          )}

          {bolgeHavuzu && (
            <Alert
              type="info"
              showIcon
              style={{ borderRadius: 12, marginBottom: 12 }}
              message="Bölge havuzu bölge müdürünün hak edişidir."
              description="Bakiye yalnız bölge müdürünün Biçen Kart'ına aktarılır; şube personeli bu havuzdan pay almaz."
            />
          )}

          <div className="mh-cekmece-ozet">
            <div>
              <span>Havuzda</span>
              <b style={{ color: "#3f6507" }}>{para(veri.kullanilabilir)}</b>
            </div>
            <div>
              <span>{bolgeHavuzu ? "Bölge müdürü" : "Kişi"}</span>
              <b>{alanlar.length}</b>
            </div>
            <div>
              <span>Kişi başı</span>
              <b style={{ color: "#2e6aa8" }}>{para(kisiBasi)}</b>
            </div>
            <div>
              <span>Kartlara toplam</span>
              <b>{para(toplam)}</b>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#7b8577", marginBottom: 4 }}>Dağıtılacak tutar</div>
              <InputNumber
                size="large"
                style={{ width: "100%" }}
                min={0.01}
                max={Math.max(0.01, veri.kullanilabilir)}
                precision={2}
                decimalSeparator=","
                addonAfter="₺"
                value={tutar ?? undefined}
                onChange={(v) => setTutar(v as number)}
              />
              {tutar != null && toplam < tutar && (
                <div style={{ fontSize: 11.5, color: "#7b8577", marginTop: 4 }}>
                  {para(Math.round((tutar - toplam) * 100) / 100)} kuruş farkı havuzda kalır
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#7b8577", marginBottom: 4 }}>Açıklama (onayda ve kartta görünür)</div>
              <Input
                size="large"
                maxLength={300}
                value={aciklama}
                onChange={(e) => setAciklama(e.target.value)}
                placeholder={`Mağaza havuzu · ${sube?.ad ?? ""}`}
              />
            </div>
          </div>

          {kartsiz.length > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ borderRadius: 12, marginBottom: 12 }}
              message={`${kartsiz.length} personelin Biçen Kart'ı tanımlı değil; bölüşüme girmiyor.`}
              description={kartsiz.map((k) => k.adSoyad).join(", ")}
            />
          )}

          <div className="mh-bolum" style={{ marginBottom: 0 }}>
            <div className="mh-bolum-bas">
              <span>
                {bolgeHavuzu ? "Bölge müdürü" : "Şubede çalışan personel"}<small>{bolgeHavuzu ? "bakiye yalnız bu karta yüklenir" : "işaretini kaldırdığınız kişi pay almaz"}</small>
              </span>
            </div>
            <Table
              size="small"
              rowKey="sicil"
              pagination={false}
              scroll={{ y: 320 }}
              dataSource={veri.kisiler}
              columns={[
                {
                  title: "",
                  width: 44,
                  render: (_: any, k: DagitimKisi) => (
                    <input
                      type="checkbox"
                      disabled={!k.kartVar}
                      checked={k.kartVar && !haric.includes(k.sicil)}
                      onChange={(e) =>
                        setHaric((h) => (e.target.checked ? h.filter((x) => x !== k.sicil) : [...h, k.sicil]))
                      }
                    />
                  ),
                },
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  render: (v: string, k: DagitimKisi) => (
                    <span>
                      <b>{v}</b>
                      <div style={{ fontSize: 11.5, color: "#7b8577" }}>
                        {k.sicil} · {k.pozisyon ?? ""}
                        {sube?.kod.startsWith("BOLGE:") && k.sube ? ` · ${k.sube}` : ""}
                        {k.giris ? ` · ${tarih(k.giris)} girişli` : ""}
                      </div>
                    </span>
                  ),
                },
                {
                  title: "Kart",
                  dataIndex: "kartNo",
                  width: 170,
                  render: (v: string | null, k: DagitimKisi) =>
                    k.kartVar ? (
                      <span className="mh-sayi" style={{ fontFamily: "Consolas, monospace", fontSize: 12 }}>
                        •••• {String(v).slice(-4)}
                      </span>
                    ) : (
                      <span className="mh-bekleyen" style={{ background: "#fdecec", color: "#c62828" }}>
                        kart yok
                      </span>
                    ),
                },
                {
                  title: "Pay",
                  width: 110,
                  align: "right" as const,
                  render: (_: any, k: DagitimKisi) =>
                    k.kartVar && !haric.includes(k.sicil) ? (
                      <b className="mh-sayi" style={{ color: "#2e6aa8" }}>
                        {para(kisiBasi)}
                      </b>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
