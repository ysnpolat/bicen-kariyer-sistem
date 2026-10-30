/**
 * Dönemsel personel değerlendirmesi (20.10.2026)
 * ---------------------------------------------------------------------------
 * Mağaza müdürü (açılırsa müdür yardımcısı da) 3 ayda bir şubesindeki
 * personeli Biçen360'tan değerlendirir: pozisyona özel 1–5 puanlı ve açık
 * uçlu sorular, sonda 1–10 genel puan.
 *
 *  - default (Personeller › Dönemsel Değerlendirme): rapor. Genel ve şube
 *    ortalamaları → şubenin personeli → personelin değerlendirmesi ve
 *    önceki dönemle soru soru karşılaştırma.
 *  - DonemselKurallar (Yönetim › Personel ve izin): dönem takvimi, kimlerin
 *    değerlendireceği ve pozisyon soru setleri.
 *  - DonemselKarne: oryantasyon karnesindeki dönemsel satırları.
 *
 * Oryantasyon takipten ayrıdır; "değerlendirme" kelimesi yalnızca burada
 * kullanılır. Sınıflar "dd-".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Switch,
  Tooltip,
} from "antd";
import dayjs from "dayjs";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarRange,
  Download,
  GripVertical,
  Lock,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Users,
  Warehouse,
  Network,
} from "lucide-react";
import { api, oturumOku } from "./api";
import { tabloIndir } from "./raporExcel";
import "./DonemselDegerlendirme.css";
import DonemselRapor from "./DonemselRapor";

/* -------------------------------------------------------------------------- */

const v1 = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hataMetni = (e: any, yedek: string) => e?.message || e?.hata || yedek;
const puanRengi = (p: number | null | undefined) =>
  p == null ? "#9aa39a" : p >= 8 ? "#4d7a0c" : p >= 6.5 ? "#6aa312" : p >= 5 ? "#b07f06" : "#d0421a";
const kuralDuzenler = () => ["Admin", "GenelMudurYardimcisi", "IKYoneticisi"].includes(oturumOku()?.rol ?? "");
const AY_ADI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const AVATAR = [
  ["#e8f4fb", "#1d8cc9"],
  ["#f2f9e8", "#5f8c10"],
  ["#fdeee8", "#e8481c"],
  ["#fff6dc", "#8a6500"],
  ["#f3edfb", "#7c4dbe"],
  ["#e6f6f3", "#0f766e"],
];
const basHarf = (ad?: string | null) =>
  (ad ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");

export function Fark({ simdi, once, ondalik }: { simdi?: number | null; once?: number | null; ondalik?: boolean }) {
  if (simdi == null || once == null) return <span className="dd-fark dd-fark-yok">{once == null && simdi != null ? "ilk" : ""}</span>;
  const f = Number(simdi) - Number(once);
  const esik = ondalik ? 0.05 : 0.5;
  if (Math.abs(f) < esik) return <span className="dd-fark dd-fark-ayni">=</span>;
  const t = ondalik ? v1(Math.abs(f)) : Math.round(Math.abs(f));
  return f > 0 ? <span className="dd-fark dd-fark-art">▲ {t}</span> : <span className="dd-fark dd-fark-dus">▼ {t}</span>;
}

/* ========================================================================== */
/* Rapor                                                                      */
/* ========================================================================== */

interface SubeSatir {
  sube: string;
  ortalama: number | null;
  soruOrt: number | null;
  onceki: number | null;
  yapilan: number;
  kadro: number;
}

interface RaporVeri {
  donem: string | null;
  donemAdi?: string;
  onceki?: string | null;
  oncekiAdi?: string | null;
  acik?: boolean;
  kapsam?: string;
  kapsamlar?: { kod: string; ad: string }[];
  genel?: {
    ortalama: number | null;
    onceki: number | null;
    soruOrt: number | null;
    oncekiSoruOrt: number | null;
    yapilan: number;
    kadro: number;
  };
  enDusuk?: { soru: string; ortalama: number; adet: number }[];
  pozisyonlar?: string[];
  subeler: SubeSatir[];
}

export default function DonemselDegerlendirme() {
  const { message } = AntdApp.useApp();
  const [donemler, setDonemler] = useState<{ kod: string; ad: string }[]>([]);
  const [donem, setDonem] = useState<string | undefined>();
  const [pozisyon, setPozisyon] = useState<string | undefined>();
  const [kapsam, setKapsam] = useState("sube");
  const [veri, setVeri] = useState<RaporVeri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [sube, setSube] = useState<string | null>(null);
  const [kisi, setKisi] = useState<{ kod: string; adSoyad: string; i: number } | null>(null);
  /* 24.10.2026: şube kartları ya da rapor ve analiz */
  const [gorunum, setGorunum] = useState<"subeler" | "rapor">("subeler");

  useEffect(() => {
    api
      .al<{ acik: string | null; donemler: { kod: string; ad: string }[] }>("/api/DonemselDegerlendirme/Donemler")
      .then((d) => {
        setDonemler(d.donemler ?? []);
        setDonem((x) => x ?? d.acik ?? d.donemler?.[0]?.kod);
      })
      .catch((e) => message.error(hataMetni(e, "Dönemler alınamadı")));
  }, [message]);

  const getir = useCallback(() => {
    if (!donem) return;
    setYukleniyor(true);
    const q = new URLSearchParams({ donem, kapsam });
    if (pozisyon) q.set("pozisyon", pozisyon);
    api
      .al<RaporVeri>(`/api/DonemselDegerlendirme/Rapor?${q}`)
      .then(setVeri)
      .catch((e) => message.error(hataMetni(e, "Rapor alınamadı")))
      .finally(() => setYukleniyor(false));
  }, [donem, pozisyon, kapsam, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kapsamAdi = veri?.kapsamlar?.find((k) => k.kod === kapsam)?.ad;

  const excel = () => {
    if (!veri) return;
    tabloIndir({
      baslik: `Dönemsel değerlendirme · ${veri.donemAdi}`,
      altBaslik: [kapsamAdi, pozisyon ? `Pozisyon: ${pozisyon}` : "Tüm pozisyonlar"].filter(Boolean).join(" · "),
      sayfaAdi: "Şubeler",
      dosyaAdi: `donemsel-degerlendirme-${veri.donem}`,
      sutunlar: [
        { ad: "Şube", genislik: 24 },
        { ad: "Genel Puan Ort.", tip: "ondalik", toplam: false },
        { ad: `Önceki (${veri.oncekiAdi ?? "—"})`, tip: "ondalik", toplam: false },
        { ad: "Soru Ort. (1–5)", tip: "ondalik", toplam: false },
        { ad: "Değerlendirilen", tip: "sayi" },
        { ad: "Kadro", tip: "sayi" },
      ],
      satirlar: veri.subeler.map((s) => [s.sube, s.ortalama, s.onceki, s.soruOrt, s.yapilan, s.kadro]),
    });
  };

  if (!donem && donemler.length === 0)
    return (
      <div className="dd">
        <Bos metin="Henüz dönemsel değerlendirme yok. Yönetim › Personel ve izin › Dönemsel değerlendirme'den dönemi açabilirsiniz." />
      </div>
    );

  return (
    <div className="dd">
      <div className="dd-ust">
        <div className="dd-ust-baslik">
          {sube ? (
            <button type="button" className="dd-geri" onClick={() => setSube(null)}>
              <ArrowLeft size={15} /> Şubeler
            </button>
          ) : (
            <span className="dd-ust-ikon">
              <Star size={19} />
            </span>
          )}
          <div>
            <h2>{sube ?? "Dönemsel değerlendirme"}</h2>
            <span>
              {veri?.donemAdi ?? "—"}
              {veri?.acik ? " · açık dönem" : ""}
              {veri?.oncekiAdi ? ` · önceki: ${veri.oncekiAdi}` : ""}
            </span>
          </div>
        </div>
        <div className="dd-arac">
          {!sube && (
            <Segmented
              value={gorunum}
              onChange={(v) => setGorunum(v as "subeler" | "rapor")}
              options={[
                { value: "subeler", label: "Şubeler" },
                { value: "rapor", label: "Rapor ve analiz" },
              ]}
            />
          )}
          <Select
            value={donem}
            onChange={(v) => {
              setDonem(v);
              setSube(null);
            }}
            options={donemler.map((d) => ({ value: d.kod, label: d.ad }))}
            style={{ width: 150 }}
          />
          {(veri?.kapsamlar?.length ?? 0) > 1 && (
            <Select
              value={kapsam}
              onChange={(v) => {
                setKapsam(v);
                setSube(null);
                setPozisyon(undefined);
              }}
              options={veri!.kapsamlar!.map((k) => ({ value: k.kod, label: k.ad }))}
              style={{ width: 190 }}
            />
          )}
          {!sube && (
            <Select
              allowClear
              placeholder="Tüm pozisyonlar"
              value={pozisyon}
              onChange={setPozisyon}
              options={(veri?.pozisyonlar ?? []).map((p) => ({ value: p, label: p }))}
              style={{ width: 180 }}
            />
          )}
          <Tooltip title="Yenile">
            <Button icon={<RefreshCw size={15} />} onClick={getir} />
          </Tooltip>
          {!sube && gorunum === "subeler" && (
            <Button icon={<Download size={15} />} onClick={excel} disabled={!veri?.subeler?.length}>
              Excel
            </Button>
          )}
        </div>
      </div>

      {yukleniyor && !veri ? (
        <div className="dd-yukleniyor">
          <Spin />
        </div>
      ) : !veri ? null : sube ? (
        <SubeAyrinti donem={veri.donem!} sube={sube} kapsam={kapsam} genel={veri.genel?.ortalama ?? null} ac={(k) => setKisi(k)} />
      ) : gorunum === "rapor" && veri.donem ? (
        <DonemselRapor donem={veri.donem} kapsam={kapsam} pozisyon={pozisyon} sec={setSube}
          ac={(k) => setKisi({ kod: k.kod, adSoyad: k.adSoyad, i: Date.now() })} />
      ) : (
        <GenelGorunum veri={veri} sec={setSube} />
      )}

      <KisiCekmecesi kisi={kisi} donem={veri?.donem ?? null} kapat={() => setKisi(null)} />
    </div>
  );
}

function Bos({ metin }: { metin: string }) {
  return (
    <div className="dd-bos">
      <Empty description={metin} image={Empty.PRESENTED_IMAGE_SIMPLE} />
    </div>
  );
}

function GenelGorunum({ veri, sec }: { veri: RaporVeri; sec: (s: string) => void }) {
  const g = veri.genel;
  const enDusuk = veri.enDusuk?.[0];
  return (
    <>
      <div className="dd-kpi">
        <div>
          <span>Genel ortalama</span>
          <b style={{ color: puanRengi(g?.ortalama) }}>
            {v1(g?.ortalama)}
            <small>/10</small>
          </b>
          <small>
            {veri.oncekiAdi ?? "Önceki"} {v1(g?.onceki)} <Fark simdi={g?.ortalama} once={g?.onceki} ondalik />
          </small>
        </div>
        <div>
          <span>Tamamlanma</span>
          <b>%{g?.kadro ? Math.round(((g?.yapilan ?? 0) / g.kadro) * 100) : 0}</b>
          <small>
            {g?.yapilan ?? 0} / {g?.kadro ?? 0} personel
          </small>
        </div>
        <div>
          <span>Soru ortalaması</span>
          <b>
            {v1(g?.soruOrt)}
            <small>/5</small>
          </b>
          <small>
            {veri.oncekiAdi ?? "Önceki"} {v1(g?.oncekiSoruOrt)}
          </small>
        </div>
        <div>
          <span>En düşük konu</span>
          {enDusuk ? (
            <>
              <b className="dd-kpi-metin">{enDusuk.soru}</b>
              <small>
                {v1(enDusuk.ortalama)}/5 · {enDusuk.adet} değerlendirme
              </small>
            </>
          ) : (
            <b className="dd-kpi-metin">—</b>
          )}
        </div>
      </div>

      {(veri.enDusuk?.length ?? 0) > 1 && (
        <div className="dd-konular">
          <span>Gelişmesi gereken konular:</span>
          {veri.enDusuk!.map((x) => (
            <em key={x.soru}>
              {x.soru} <b>{v1(x.ortalama)}</b>
            </em>
          ))}
        </div>
      )}

      {veri.subeler.length === 0 ? (
        <Bos metin="Bu dönemde değerlendirme yok." />
      ) : (
        <div className="dd-subeler">
          {veri.subeler.map((s, i) => (
            <button key={s.sube} type="button" className="dd-sube" onClick={() => sec(s.sube)}>
              <div className="dd-sube-ust">
                <div>
                  <small>#{s.ortalama == null ? "—" : i + 1}</small>
                  <b>{s.sube}</b>
                </div>
                <div className="dd-sube-puan" style={{ color: puanRengi(s.ortalama) }}>
                  {v1(s.ortalama)}
                  <small>/10</small>
                </div>
              </div>
              <div className="dd-cubuk">
                <i style={{ width: `${(s.ortalama ?? 0) * 10}%`, background: puanRengi(s.ortalama) }} />
              </div>
              <div className="dd-sube-alt">
                <span>
                  {s.yapilan}/{s.kadro} değerlendirildi
                </span>
                <Fark simdi={s.ortalama} once={s.onceki} ondalik />
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SubeAyrinti({
  donem,
  sube,
  kapsam,
  genel,
  ac,
}: {
  donem: string;
  sube: string;
  kapsam: string;
  genel: number | null;
  ac: (k: { kod: string; adSoyad: string; i: number }) => void;
}) {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<any>(null);

  useEffect(() => {
    setVeri(null);
    api
      .al<any>(`/api/DonemselDegerlendirme/Rapor/Sube?donem=${donem}&sube=${encodeURIComponent(sube)}&kapsam=${kapsam}`)
      .then(setVeri)
      .catch((e) => message.error(hataMetni(e, "Şube alınamadı")));
  }, [donem, sube, kapsam, message]);

  if (!veri)
    return (
      <div className="dd-yukleniyor">
        <Spin />
      </div>
    );

  const kisiler: any[] = veri.kisiler ?? [];
  const yapilan = kisiler.filter((k) => k.puan != null);
  const ort = yapilan.length ? yapilan.reduce((a, k) => a + k.puan, 0) / yapilan.length : null;
  const oncekiler = yapilan.filter((k) => k.oncekiPuan != null);
  const oncekiOrt = oncekiler.length ? oncekiler.reduce((a, k) => a + k.oncekiPuan, 0) / oncekiler.length : null;

  const excel = () =>
    tabloIndir({
      baslik: `${sube} · ${veri.donemAdi}`,
      altBaslik: "Dönemsel değerlendirme",
      sayfaAdi: "Personel",
      dosyaAdi: `donemsel-${sube}-${donem}`.replace(/[^\p{L}\p{N}-]+/gu, "-"),
      sutunlar: [
        { ad: "Personel", genislik: 24 },
        { ad: "Pozisyon", genislik: 18 },
        { ad: "Değerlendiren", genislik: 22 },
        { ad: "Genel (1–10)", tip: "sayi", toplam: false },
        { ad: "Önceki", tip: "sayi", toplam: false },
        { ad: "Soru Ort. (1–5)", tip: "ondalik", toplam: false },
      ],
      satirlar: kisiler.map((k) => [k.adSoyad, k.pozisyon, k.degerlendiren ?? "Bekliyor", k.puan, k.oncekiPuan, k.soruOrt]),
    });

  return (
    <>
      <div className="dd-kpi">
        <div>
          <span>Şube ortalaması</span>
          <b style={{ color: puanRengi(ort) }}>
            {v1(ort)}
            <small>/10</small>
          </b>
          <small>
            önceki {v1(oncekiOrt)} <Fark simdi={ort} once={oncekiOrt} ondalik />
          </small>
        </div>
        <div>
          <span>Biçen geneline göre</span>
          <b>
            <Fark simdi={ort} once={genel} ondalik />
          </b>
          <small>genel ortalama {v1(genel)}</small>
        </div>
        <div>
          <span>Yükselen</span>
          <b style={{ color: "#4d7a0c" }}>{yapilan.filter((k) => k.oncekiPuan != null && k.puan > k.oncekiPuan).length}</b>
          <small>personel</small>
        </div>
        <div>
          <span>Düşen</span>
          <b style={{ color: "#d0421a" }}>{yapilan.filter((k) => k.oncekiPuan != null && k.puan < k.oncekiPuan).length}</b>
          <small>personel · görüşme önerilir</small>
        </div>
      </div>

      <div className="dd-tablo-kap">
        <div className="dd-tablo-bas">
          <b>
            <Users size={15} /> {kisiler.length} personel · {yapilan.length} değerlendirildi
          </b>
          <Button size="small" icon={<Download size={14} />} onClick={excel}>
            Excel
          </Button>
        </div>
        <table className="dd-tablo">
          <thead>
            <tr>
              <th>Personel</th>
              <th>Pozisyon</th>
              <th>Değerlendiren</th>
              <th className="sag">Genel</th>
              <th className="sag">Önceki</th>
              <th>Fark</th>
              <th className="sag">Soru ort.</th>
            </tr>
          </thead>
          <tbody>
            {kisiler.map((k, i) => {
              const [z, r] = AVATAR[i % AVATAR.length];
              return (
                <tr key={k.kod} onClick={() => ac({ kod: k.kod, adSoyad: k.adSoyad, i })}>
                  <td>
                    <span className="dd-kisi">
                      <span className="dd-avatar" style={{ background: z, color: r }}>
                        {basHarf(k.adSoyad)}
                      </span>
                      <b>{k.adSoyad}</b>
                    </span>
                  </td>
                  <td>{k.pozisyon}</td>
                  <td className="dd-soluk">{k.degerlendiren ?? "—"}</td>
                  <td className="sag">
                    {k.puan == null ? (
                      <span className="dd-bekliyor">Bekliyor</span>
                    ) : (
                      <span className="dd-hap" style={{ background: puanRengi(k.puan) }}>
                        {k.puan}
                      </span>
                    )}
                  </td>
                  <td className="sag dd-rakam">
                    <Tooltip title={k.oncekiDonemAdi}>{k.oncekiPuan ?? "—"}</Tooltip>
                  </td>
                  <td>{k.puan != null && <Fark simdi={k.puan} once={k.oncekiPuan} />}</td>
                  <td className="sag dd-rakam">{v1(k.soruOrt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- kişi çekmecesi */

interface Kayit {
  donem: string;
  donemAdi: string;
  pozisyon: string;
  sube: string;
  genelPuan: number;
  soruOrt: number | null;
  genelAciklama?: string | null;
  degerlendiren: string;
  degerlendirenGorev: string;
  tarih: string;
  cevaplar: { soruId: number; soru: string; tur: string; puan: number | null; metin: string | null }[];
}

function KisiCekmecesi({
  kisi,
  donem,
  kapat,
}: {
  kisi: { kod: string; adSoyad: string; i: number } | null;
  donem: string | null;
  kapat: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [kayitlar, setKayitlar] = useState<Kayit[] | null>(null);

  useEffect(() => {
    setKayitlar(null);
    if (!kisi) return;
    api
      .al<Kayit[]>(`/api/DonemselDegerlendirme/Personel/${encodeURIComponent(kisi.kod)}`)
      .then(setKayitlar)
      .catch((e) => message.error(hataMetni(e, "Değerlendirmeler alınamadı")));
  }, [kisi, message]);

  const [z, r] = AVATAR[(kisi?.i ?? 0) % AVATAR.length];

  return (
    <Drawer
      open={!!kisi}
      onClose={kapat}
      width={760}
      rootClassName="dd-cekmece"
      title={
        kisi && (
          <span className="dd-kisi">
            <span className="dd-avatar" style={{ background: z, color: r, width: 40, height: 40 }}>
              {basHarf(kisi.adSoyad)}
            </span>
            <span>
              <b style={{ fontSize: 16 }}>{kisi.adSoyad}</b>
              <div className="dd-soluk" style={{ fontSize: 12.5, fontWeight: 500 }}>
                {kayitlar?.length ? `${kayitlar[kayitlar.length - 1].pozisyon} · ${kayitlar[kayitlar.length - 1].sube}` : ""}
              </div>
            </span>
          </span>
        )
      }
    >
      {!kayitlar ? (
        <Spin />
      ) : (
        <KisiDegerlendirmesi kayitlar={kayitlar} donem={donem} />
      )}
    </Drawer>
  );
}

/** Seçili dönemin değerlendirmesi ve bir öncekiyle karşılaştırma (karnede de kullanılır). */
export function KisiDegerlendirmesi({ kayitlar, donem }: { kayitlar: Kayit[]; donem?: string | null }) {
  const [secili, setSecili] = useState<string | null>(null);
  const sira = useMemo(() => {
    const hedef = secili ?? donem;
    const i = hedef ? kayitlar.findIndex((k) => k.donem === hedef) : -1;
    return i >= 0 ? i : kayitlar.length - 1;
  }, [kayitlar, donem, secili]);

  if (kayitlar.length === 0)
    return <Bos metin={donem ? "Bu dönem henüz değerlendirilmedi; önceki değerlendirmesi de yok." : "Dönemsel değerlendirmesi yok."} />;

  const simdi = kayitlar[sira];
  const once = sira > 0 ? kayitlar[sira - 1] : null;
  const bekliyor = donem && !kayitlar.some((k) => k.donem === donem) && !secili;

  /* Soru eşleşmesi kimlikle; soru değiştiyse metinle */
  const oncekiCevap = (c: Kayit["cevaplar"][number]) =>
    once?.cevaplar.find((x) => x.soruId === c.soruId) ?? once?.cevaplar.find((x) => x.soru === c.soru);

  /* Geçmiş grafiği */
  const W = 680,
    H = 130,
    P = 62;
  const adim = (W - P * 2) / Math.max(1, kayitlar.length - 1);
  const nok = kayitlar.map((k, i) => [kayitlar.length === 1 ? W / 2 : P + i * adim, H - 22 - ((k.genelPuan - 1) / 9) * (H - 44)] as const);

  return (
    <div className="dd-kd">
      {bekliyor && <Alert type="warning" showIcon message="Bu dönem henüz değerlendirilmedi. Aşağıda son değerlendirmesi görünüyor." />}

      <div className="dd-iki">
        <div>
          <span>{simdi.donemAdi} · genel puan</span>
          <b style={{ color: puanRengi(simdi.genelPuan) }}>
            {simdi.genelPuan}
            <small>/10</small>
          </b>
          <small>
            {simdi.degerlendiren} · {simdi.degerlendirenGorev} · {dayjs(simdi.tarih).format("DD.MM.YYYY")}
          </small>
        </div>
        <div>
          <span>{once ? `${once.donemAdi} · önceki` : "Önceki dönem"}</span>
          <b className="dd-mor">
            {once?.genelPuan ?? "—"}
            {once && <small>/10</small>}
          </b>
          <small>
            {once ? (
              <>
                <Fark simdi={simdi.genelPuan} once={once.genelPuan} /> soru ort. {v1(once.soruOrt)} → {v1(simdi.soruOrt)}
              </>
            ) : (
              "İlk dönemsel değerlendirmesi"
            )}
          </small>
        </div>
      </div>

      <div className="dd-kutu">
        <h5>Puanın açıklaması</h5>
        <div className="dd-cevap">
          <div className="dd-c-simdi">
            <small>{simdi.donemAdi.toLocaleUpperCase("tr")}</small>
            {simdi.genelAciklama || <span className="dd-soluk">Yazılmamış</span>}
          </div>
          {once && (
            <div className="dd-c-once">
              <small>{once.donemAdi.toLocaleUpperCase("tr")}</small>
              {once.genelAciklama || <span className="dd-soluk">Yazılmamış</span>}
            </div>
          )}
        </div>
      </div>

      {kayitlar.length > 1 && (
        <div className="dd-kutu">
          <h5>Genel puan geçmişi</h5>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Genel puan geçmişi">
            {[1, 5, 10].map((v) => {
              const y = H - 22 - ((v - 1) / 9) * (H - 44);
              return (
                <g key={v}>
                  <line x1={P} x2={W - P} y1={y} y2={y} stroke="#eef0ea" />
                  <text x={4} y={y + 4} fontSize={10} fill="#9aa39a">
                    {v}
                  </text>
                </g>
              );
            })}
            <path d={nok.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")} fill="none" stroke="#7cb518" strokeWidth={2.5} />
            {nok.map((p, i) => (
              <g key={i} style={{ cursor: "pointer" }} onClick={() => setSecili(kayitlar[i].donem)}>
                <circle cx={p[0]} cy={p[1]} r={i === sira ? 7 : 5} fill={i === sira ? "#7cb518" : "#fff"} stroke="#7cb518" strokeWidth={2.5} />
                <text x={p[0]} y={p[1] - 11} textAnchor="middle" fontSize={12} fontWeight={800} fill="#1f2933">
                  {kayitlar[i].genelPuan}
                </text>
                <text x={p[0]} y={H - 4} textAnchor="middle" fontSize={11} fill="#6b7280">
                  {kayitlar[i].donemAdi}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}

      <div className="dd-lejant">
        <span>
          <i style={{ background: "#7cb518" }} />
          {simdi.donemAdi}
        </span>
        {once && (
          <span>
            <i style={{ background: "#fff", boxShadow: "inset 0 0 0 2px #7c4dbe" }} />
            {once.donemAdi}
          </span>
        )}
      </div>

      <div className="dd-kutu dd-karsi">
        {simdi.cevaplar
          .filter((c) => c.tur === "olcek")
          .map((c) => {
            const o = oncekiCevap(c);
            return (
              <div key={c.soruId} className="dd-karsi-satir">
                <span className="ad">{c.soru}</span>
                <span className="dd-nokta">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <i key={n} className={`${c.puan === n ? "simdi" : ""} ${o?.puan === n ? "once" : ""}`}>
                      {n}
                    </i>
                  ))}
                </span>
                <span>{o?.puan != null && c.puan != null ? <Fark simdi={c.puan} once={o.puan} /> : <span className="dd-fark dd-fark-yok">{o ? "" : "yeni"}</span>}</span>
              </div>
            );
          })}
      </div>

      {simdi.cevaplar
        .filter((c) => c.tur === "acik")
        .map((c) => {
          const o = oncekiCevap(c);
          return (
            <div key={c.soruId} className="dd-kutu">
              <h5>{c.soru}</h5>
              <div className="dd-cevap">
                <div className="dd-c-simdi">
                  <small>{simdi.donemAdi.toLocaleUpperCase("tr")}</small>
                  {c.metin || <span className="dd-soluk">Yazılmamış</span>}
                </div>
                {once && (
                  <div className="dd-c-once">
                    <small>{once.donemAdi.toLocaleUpperCase("tr")}</small>
                    {o?.metin || <span className="dd-soluk">Yazılmamış</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}

/* ========================================================================== */
/* Karne (oryantasyon takip)                                                  */
/* ========================================================================== */

/** Oryantasyon karnesinde: tek zaman çizgisi (mavi oryantasyon, yeşil dönemsel). */
export function DonemselKarne({
  kod,
  oryantasyon,
}: {
  kod: string | null | undefined;
  oryantasyon: { ad: string; tarih?: string | null; calisan?: number | null; yonetici?: number | null }[];
}) {
  const [kayitlar, setKayitlar] = useState<Kayit[] | null>(null);
  const [acik, setAcik] = useState(false);

  useEffect(() => {
    setKayitlar(null);
    if (!kod) return;
    api
      .al<Kayit[]>(`/api/DonemselDegerlendirme/Personel/${encodeURIComponent(kod)}`)
      .then(setKayitlar)
      .catch(() => setKayitlar([]));
  }, [kod]);

  const olaylar = [
    ...oryantasyon.map((o) => ({
      tur: "ory" as const,
      zaman: o.tarih ? dayjs(o.tarih).valueOf() : 0,
      ad: `${o.ad} oryantasyon`,
      alt: `${o.tarih ? dayjs(o.tarih).format("DD.MM.YYYY") + " · " : ""}Çalışan ${v1(o.calisan)}/5 · Yönetici formu ${v1(o.yonetici)}/5`,
    })),
    ...(kayitlar ?? []).map((k, i, l) => ({
      tur: "don" as const,
      zaman: dayjs(k.tarih).valueOf(),
      ad: `${k.donemAdi} dönemi`,
      alt: `${dayjs(k.tarih).format("DD.MM.YYYY")} · ${k.degerlendiren} · Genel ${k.genelPuan}/10${k.soruOrt != null ? ` · Sorular ${v1(k.soruOrt)}/5` : ""}`,
      fark: i > 0 ? <Fark simdi={k.genelPuan} once={l[i - 1].genelPuan} /> : null,
    })),
  ].sort((a, b) => a.zaman - b.zaman);

  return (
    <div className="ot-ck-bolum dd-karne">
      <h4>
        Oryantasyon ve dönemsel değerlendirme <span className="ot-yeni">YENİ</span>
      </h4>
      <div className="dd-lejant">
        <span>
          <i style={{ background: "#1d8cc9" }} />
          Oryantasyon (ilk yıl)
        </span>
        <span>
          <i style={{ background: "#7cb518" }} />
          Dönemsel değerlendirme (yönetici)
        </span>
      </div>
      {kayitlar == null ? (
        <Spin size="small" />
      ) : olaylar.length === 0 ? (
        <div className="dd-soluk" style={{ fontSize: 13 }}>
          Henüz kayıt yok.
        </div>
      ) : (
        <div className="dd-zaman">
          {olaylar.map((o, i) => (
            <div key={i} className={`dd-olay dd-olay-${o.tur}`}>
              <div className="dd-olay-kutu">
                <div className="dd-olay-ust">
                  <b>{o.ad}</b>
                  <span className={`dd-etiket dd-etiket-${o.tur}`}>{o.tur === "ory" ? "Oryantasyon" : "Dönemsel"}</span>
                </div>
                <small>
                  {o.alt} {"fark" in o ? o.fark : null}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
      {(kayitlar?.length ?? 0) > 0 && (
        <>
          <Button size="small" style={{ marginTop: 8 }} onClick={() => setAcik((x) => !x)}>
            {acik ? "Değerlendirme ayrıntısını gizle" : "Son dönemsel değerlendirmeyi aç"}
          </Button>
          {acik && (
            <div style={{ marginTop: 10 }}>
              <KisiDegerlendirmesi kayitlar={kayitlar!} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Yönetim › kurallar ve sorular                                              */
/* ========================================================================== */

interface Ayar {
  acik: boolean;
  aylar: number[];
  basGun: number;
  bitGun: number;
  mudurDegerlendirir: boolean;
  yardimciDegerlendirir: boolean;
  yardimciDegerlendirilir?: boolean;
  olcekEtiketleri?: string[];
  enAzKidemGun: number;
  hatirlatmaGunleri: number[];
  elleDonem?: string | null;
  elleBitis?: string | null;
  magazaMuduruKademesi?: boolean;
  bolgeMuduruKademesi?: boolean;
  bolgeMuduruDegerlendiren?: string | null;
  depoKademesi?: boolean;
  depoMuduruKademesi?: boolean;
  depoMuduruDegerlendiren?: string | null;
  setEslesme?: Record<string, string>;
}

interface KademeOzet {
  kod: string;
  ad: string;
  degerlendiren: string;
  kisi: number;
  eksik: number;
  degerlendirenler: string[];
  degerlendirenSayi: number;
}

const KADEME_ALAN: Record<string, { acik: keyof Ayar; sicil?: keyof Ayar; ikon: "magaza" | "depo" }> = {
  magazaMuduru: { acik: "magazaMuduruKademesi", ikon: "magaza" },
  bolgeMuduru: { acik: "bolgeMuduruKademesi", sicil: "bolgeMuduruDegerlendiren", ikon: "magaza" },
  depo: { acik: "depoKademesi", ikon: "depo" },
  depoMuduru: { acik: "depoMuduruKademesi", sicil: "depoMuduruDegerlendiren", ikon: "depo" },
};

interface Soru {
  id?: number;
  tur: "olcek" | "acik";
  metin: string;
  zorunlu: boolean;
}

export function DonemselKurallar() {
  const { message } = AntdApp.useApp();
  const [ayar, setAyar] = useState<Ayar | null>(null);
  const [acikDonem, setAcikDonem] = useState<any>(null);
  const [sonraki, setSonraki] = useState<string | null>(null);
  const [kademeler, setKademeler] = useState<KademeOzet[]>([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [elleBitis, setElleBitis] = useState(dayjs().add(10, "day"));
  const duzenler = kuralDuzenler();

  useEffect(() => {
    api
      .al<any>("/api/DonemselDegerlendirme/Ayar")
      .then((d) => {
        setAyar(d.ayar);
        setAcikDonem(d.acikDonem);
        setSonraki(d.sonrakiDonem);
        setKademeler(d.kademeler ?? []);
      })
      .catch((e) => message.error(hataMetni(e, "Ayar alınamadı")));
  }, [message]);

  const kaydet = async (yeni: Ayar, basari = "Kaydedildi") => {
    setKaydediliyor(true);
    try {
      const d = await api.gonder<any>("/api/DonemselDegerlendirme/Ayar", yeni);
      setAyar(d.ayar);
      setAcikDonem(d.acikDonem);
      if (d.kademeler) setKademeler(d.kademeler);
      message.success(basari);
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    } finally {
      setKaydediliyor(false);
    }
  };

  if (!ayar)
    return (
      <div className="dd-yukleniyor">
        <Spin />
      </div>
    );

  const degis = (p: Partial<Ayar>) => kaydet({ ...ayar, ...p });

  return (
    <div className="dd dd-kurallar">
      {acikDonem ? (
        <Alert
          type="success"
          showIcon
          message={`${acikDonem.ad} dönemi açık · son gün ${dayjs(acikDonem.bitis).format("DD.MM.YYYY")}`}
          description="Değerlendirenler Biçen360 › Diğer › Ekip değerlendirmesi'nden ve ana sayfadaki karttan değerlendiriyor."
          action={
            ayar.elleDonem && duzenler ? (
              <Popconfirm title="Elle açılan dönem kapatılsın mı?" okText="Kapat" cancelText="Vazgeç" onConfirm={() => degis({ elleDonem: null, elleBitis: null })}>
                <Button size="small">Dönemi kapat</Button>
              </Popconfirm>
            ) : undefined
          }
        />
      ) : (
        <Alert
          type="info"
          showIcon
          message={`Şu an açık dönem yok${sonraki ? ` · sonraki dönem ${dayjs(sonraki).format("DD.MM.YYYY")}` : ""}`}
          description={
            duzenler && (
              <div className="dd-elle">
                <span>Takvimi beklemeden bu ayın dönemini şimdi açın:</span>
                <DatePicker value={elleBitis} onChange={(v) => v && setElleBitis(v)} format="DD.MM.YYYY" allowClear={false} />
                <span>tarihine kadar</span>
                <Button
                  type="primary"
                  size="small"
                  loading={kaydediliyor}
                  onClick={() =>
                    degis({ acik: true, elleDonem: dayjs().format("YYYY-MM"), elleBitis: elleBitis.format("YYYY-MM-DD") })
                  }
                >
                  {AY_ADI[dayjs().month()]} dönemini aç
                </Button>
              </div>
            )
          }
        />
      )}

      <div className="dd-kural-izgara">
        <div className="dd-kural">
          <h4>
            <CalendarRange size={15} /> Dönem takvimi
          </h4>
          <div className="dd-satir">
            <span>Sistem açık</span>
            <Switch checked={ayar.acik} disabled={!duzenler} loading={kaydediliyor} onChange={(v) => degis({ acik: v })} />
          </div>
          <div className="dd-aylar">
            {AYLAR.map((a, i) => (
              <button
                key={a}
                type="button"
                disabled={!duzenler}
                className={ayar.aylar.includes(i + 1) ? "secili" : ""}
                onClick={() =>
                  degis({
                    aylar: ayar.aylar.includes(i + 1) ? ayar.aylar.filter((x) => x !== i + 1) : [...ayar.aylar, i + 1].sort((x, y) => x - y),
                  })
                }
              >
                {a}
              </button>
            ))}
          </div>
          <div className="dd-satir">
            <span>Doldurma süresi (ayın günleri)</span>
            <span className="dd-ikili">
              <InputNumber size="small" min={1} max={28} value={ayar.basGun} disabled={!duzenler} onChange={(v) => v && degis({ basGun: v })} />
              –
              <InputNumber size="small" min={1} max={31} value={ayar.bitGun} disabled={!duzenler} onChange={(v) => v && degis({ bitGun: v })} />
            </span>
          </div>
          <div className="dd-satir">
            <span>Hatırlatma (dönemin kaçıncı günü)</span>
            <Select
              mode="multiple"
              size="small"
              style={{ minWidth: 120 }}
              value={ayar.hatirlatmaGunleri}
              disabled={!duzenler}
              onChange={(v) => degis({ hatirlatmaGunleri: v })}
              options={Array.from({ length: 30 }, (_, i) => i + 2).map((g) => ({ value: g, label: `${g}. gün` }))}
            />
          </div>
          <small>Açılışta, hatırlatma günlerinde ve son gün, değerlendirmesi biten olmayan müdüre bildirim gider.</small>
        </div>

        <div className="dd-kural">
          <h4>
            <Users size={15} /> Kimler değerlendirir
          </h4>
          <div className="dd-satir">
            <span>Mağaza müdürü</span>
            <Switch checked={ayar.mudurDegerlendirir} disabled={!duzenler} onChange={(v) => degis({ mudurDegerlendirir: v })} />
          </div>
          <div className="dd-satir">
            <span>Mağaza müdür yardımcısı</span>
            <Switch checked={ayar.yardimciDegerlendirir} disabled={!duzenler} onChange={(v) => degis({ yardimciDegerlendirir: v })} />
          </div>
          <small>
            Yardımcı açıldığında müdürle aynı listeyi görür. Bir personel dönemde bir kez değerlendirilir; kim doldurduysa raporda
            adı yazar, dönem bitene kadar düzeltilebilir.
          </small>
        </div>

        <div className="dd-kural">
          <h4>
            <Star size={15} /> Kimler değerlendirilir
          </h4>
          <div className="dd-satir">
            <span>Şubedeki aktif personel</span>
            <b>Evet</b>
          </div>
          <div className="dd-satir">
            <span>Mağaza müdürü</span>
            <b>Hariç</b>
          </div>
          <div className="dd-satir">
            <span>Müdür yardımcıları</span>
            <Switch
              checked={ayar.yardimciDegerlendirilir ?? true}
              disabled={!duzenler}
              onChange={(v) => degis({ yardimciDegerlendirilir: v })}
            />
          </div>
          <div className="dd-satir">
            <span>En az kıdem (gün)</span>
            <InputNumber size="small" min={0} max={365} value={ayar.enAzKidemGun} disabled={!duzenler} onChange={(v) => v != null && degis({ enAzKidemGun: v })} />
          </div>
          <small>
            Müdür yardımcısını mağaza müdürü değerlendirir; yardımcı değerlendirme yapıyorsa kendisini ve diğer yardımcıları görmez.
            Kıdemi dolmayan yeni personeli oryantasyonun 7. gün ve 2. ay yönetici formu kapsar.
          </small>
        </div>

        <div className="dd-kural">
          <h4>
            <Star size={15} /> Puan etiketleri (1–5)
          </h4>
          {(ayar.olcekEtiketleri?.length === 5 ? ayar.olcekEtiketleri : ["Hiçbir zaman", "Nadiren", "Bazen", "Çoğunlukla", "Her zaman"]).map(
            (e, i, l) => (
              <div key={i} className="dd-satir">
                <span>{i + 1}</span>
                <Input
                  size="small"
                  defaultValue={e}
                  maxLength={30}
                  disabled={!duzenler}
                  style={{ width: 170 }}
                  onBlur={(ev) => {
                    const v = ev.target.value.trim();
                    if (!v || v === e) return;
                    const yeni = [...l];
                    yeni[i] = v;
                    degis({ olcekEtiketleri: yeni });
                  }}
                />
              </div>
            )
          )}
          <small>Sorular "…yapar mı?" diye sorulduğu için sıklık etiketleri kullanılıyor. Biçen360 formunda görünür.</small>
        </div>
      </div>

      <div className="dd-kademe">
        <h4>
          <Network size={15} /> Değerlendirme kademeleri
        </h4>
        <small>
          Değerlendiren, kişinin izin onay tablosundaki 1. onaylayanıdır. Satış ve depo GMY için sicil yazarsanız o kişi değerlendirir.
          Kapalı kademe değerlendirilmez; açmadan önce kimin kimi göreceğini buradan kontrol edin.
        </small>
        <div className="dd-kademe-satir dd-kademe-sabit">
          <span className="dd-kademe-ikon">
            <Users size={15} />
          </span>
          <div>
            <b>Şube personeli</b>
            <span>← Mağaza müdürü (yukarıdaki ayarlarla)</span>
          </div>
          <Switch checked={ayar.acik && ayar.mudurDegerlendirir} disabled />
        </div>
        {kademeler.map((k) => {
          const alan = KADEME_ALAN[k.kod];
          if (!alan) return null;
          const acik = !!ayar[alan.acik];
          return (
            <div key={k.kod} className={`dd-kademe-satir${acik ? "" : " kapali"}`}>
              <span className="dd-kademe-ikon">{alan.ikon === "depo" ? <Warehouse size={15} /> : <Star size={15} />}</span>
              <div>
                <b>
                  {k.ad} <em>{k.kisi} kişi</em>
                </b>
                <span>
                  ← {k.degerlendiren}
                  {k.degerlendirenSayi > 0 ? `: ${k.degerlendirenler.join(", ")}${k.degerlendirenSayi > k.degerlendirenler.length ? " …" : ""}` : ""}
                </span>
                {k.eksik > 0 && <span className="dd-kademe-uyari">{k.eksik} kişinin değerlendireni bulunamadı (onay tablosunu kontrol edin)</span>}
                {alan.sicil && (
                  <span className="dd-kademe-sicil">
                    Değerlendiren sicil
                    <Input
                      size="small"
                      style={{ width: 110 }}
                      placeholder="onay tablosu"
                      defaultValue={(ayar[alan.sicil] as string) ?? ""}
                      disabled={!duzenler}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== ((ayar[alan.sicil!] as string) ?? "")) degis({ [alan.sicil!]: v } as Partial<Ayar>);
                      }}
                    />
                  </span>
                )}
              </div>
              <Switch checked={acik} disabled={!duzenler} loading={kaydediliyor} onChange={(v) => degis({ [alan.acik]: v } as Partial<Ayar>)} />
            </div>
          );
        })}
      </div>

      <SoruSetleri duzenler={duzenler} />
    </div>
  );
}

interface SetSatir {
  ad: string;
  kisaAd: string;
  depo: boolean;
  soru: number;
  kisi: number;
  pozisyonlar: string[];
}
interface PozSatir {
  pozisyon: string;
  depo: boolean;
  kisi: number;
  kapsam: string;
  set: string;
  elle: boolean;
}

function SoruSetleri({ duzenler }: { duzenler: boolean }) {
  const { message } = AntdApp.useApp();
  const [setler, setSetler] = useState<SetSatir[]>([]);
  const [pozlar, setPozlar] = useState<PozSatir[]>([]);
  const [alan, setAlan] = useState<"magaza" | "depo">("magaza");
  const [secili, setSecili] = useState("Ortak");
  const [sorular, setSorular] = useState<Soru[] | null>(null);
  const [ozel, setOzel] = useState(true);
  const [kirli, setKirli] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yeniAd, setYeniAd] = useState("");
  const [eslesmeAcik, setEslesmeAcik] = useState(false);

  const yukle = (d: any) => {
    setSetler(d.setler ?? []);
    setPozlar(d.pozisyonlar ?? []);
  };

  const pozGetir = useCallback(() => {
    api
      .al<any>("/api/DonemselDegerlendirme/Pozisyonlar")
      .then(yukle)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    pozGetir();
  }, [pozGetir]);

  const depo = alan === "depo";
  const onek = depo ? "Depo · " : "";
  const gorunen = setler.filter((x) => x.depo === depo);
  const gorunenPoz = pozlar.filter((x) => x.depo === depo);

  const eslestir = async (p: PozSatir, set: string | null) => {
    try {
      yukle(await api.gonder<any>("/api/DonemselDegerlendirme/SetEslesme", { pozisyon: p.pozisyon, depo: p.depo, set }));
      message.success(set ? `${p.pozisyon} → ${set}` : `${p.pozisyon} otomatik eşlemeye döndü`);
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    }
  };

  useEffect(() => {
    setSorular(null);
    setKirli(false);
    api
      .al<any>(`/api/DonemselDegerlendirme/Sorular?pozisyon=${encodeURIComponent(secili)}`)
      .then((d) => {
        setOzel(d.ozel);
        setSorular((d.sorular ?? []).map((s: any) => ({ id: s.id, tur: s.tur, metin: s.metin, zorunlu: s.zorunlu })));
      })
      .catch((e) => message.error(hataMetni(e, "Sorular alınamadı")));
  }, [secili, message]);

  const guncelle = (i: number, p: Partial<Soru>) => {
    setSorular((l) => l!.map((s, j) => (j === i ? { ...s, ...p } : s)));
    setKirli(true);
  };
  const tasi = (i: number, y: number) => {
    setSorular((l) => {
      const k = [...l!];
      const [x] = k.splice(i, 1);
      k.splice(i + y, 0, x);
      return k;
    });
    setKirli(true);
  };

  const kaydet = async (liste: Soru[]) => {
    setKaydediliyor(true);
    try {
      const d = await api.gonder<any>(`/api/DonemselDegerlendirme/Sorular?pozisyon=${encodeURIComponent(secili)}`, liste);
      setOzel(d.ozel);
      setSorular((d.sorular ?? []).map((s: any) => ({ id: s.id, tur: s.tur, metin: s.metin, zorunlu: s.zorunlu })));
      setKirli(false);
      pozGetir();
      message.success(liste.length ? "Sorular kaydedildi" : "Set kaldırıldı; bağlı pozisyonlara Genel set sorulacak");
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <div className="dd-soru-duzen">
      <div className="dd-poz-liste">
        <div className="dd-alan-sec">
          {(["magaza", "depo"] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={alan === a ? "secili" : ""}
              onClick={() => {
                setAlan(a);
                setSecili(a === "depo" ? "Depo · Ortak" : "Ortak");
              }}
            >
              {a === "depo" ? "Lojistik depo" : "Mağaza"}
            </button>
          ))}
        </div>
        {gorunen.map((p) => {
          const kisa = p.kisaAd;
          const alt =
            kisa === "Ortak"
              ? "her pozisyona, en başta sorulur"
              : kisa === "Genel"
              ? "kendi seti olmayan pozisyonlar"
              : p.pozisyonlar.length
              ? p.pozisyonlar.join(", ")
              : "bağlı pozisyon yok";
          return (
            <button key={p.ad} type="button" className={secili === p.ad ? "aktif" : ""} onClick={() => setSecili(p.ad)}>
              <span>
                {kisa === "Ortak" ? "Ortak sorular" : kisa}
                <small title={alt}>{alt}</small>
              </span>
              <em>
                {p.soru} soru{kisa !== "Ortak" && p.kisi ? ` · ${p.kisi} kişi` : ""}
              </em>
            </button>
          );
        })}
        {duzenler && (
          <div className="dd-yeni-set">
            <Input size="small" placeholder="Yeni set adı" value={yeniAd} maxLength={60} onChange={(e) => setYeniAd(e.target.value)} />
            <Button
              size="small"
              icon={<Plus size={13} />}
              disabled={yeniAd.trim().length < 3}
              onClick={() => {
                setSecili(onek + yeniAd.trim());
                setYeniAd("");
              }}
            />
          </div>
        )}
        <button type="button" className="dd-eslesme-dugme" onClick={() => setEslesmeAcik(true)}>
          <span>
            Pozisyon eşleşmeleri
            <small>Mikro'daki {gorunenPoz.length} pozisyonun hangi sete düştüğü</small>
          </span>
          <em>›</em>
        </button>
      </div>

      <Drawer
        open={eslesmeAcik}
        onClose={() => setEslesmeAcik(false)}
        title={`Pozisyon eşleşmeleri · ${depo ? "Lojistik depo" : "Mağaza"}`}
        width="min(560px, 100vw)"
      >
        <div className="dd-not" style={{ marginBottom: 10 }}>
          Mikro'daki pozisyon adı set adıyla aynıysa ya da tanınıyorsa (PART, ÇIRAK ekleri, TADOLYA → Pastane gibi) otomatik eşlenir.
          Yanlış düşeni buradan düzeltin.
        </div>
        <div className="dd-eslesme">
          {gorunenPoz.map((p) => (
            <div key={p.pozisyon} className="dd-eslesme-satir">
              <div>
                <b>{p.pozisyon}</b>
                <small>
                  {p.kisi} kişi · {p.kapsam}
                </small>
              </div>
              <Select
                size="small"
                value={p.set}
                disabled={!duzenler}
                style={{ width: 200 }}
                onChange={(v) => eslestir(p, v)}
                options={gorunen.filter((x) => x.kisaAd !== "Ortak").map((x) => ({ value: x.ad, label: x.kisaAd }))}
              />
              {p.elle ? (
                <Tooltip title="Otomatiğe döndür">
                  <Button size="small" type="text" onClick={() => eslestir(p, null)} disabled={!duzenler}>
                    elle
                  </Button>
                </Tooltip>
              ) : (
                <span className="dd-soluk" style={{ fontSize: 11.5, width: 40, textAlign: "center" }}>
                  oto
                </span>
              )}
            </div>
          ))}
          {gorunenPoz.length === 0 && <Empty description="Bu alanda değerlendirilecek pozisyon yok" />}
        </div>
      </Drawer>

      <div className="dd-soru-tablo">
        <div className="dd-soru-bas">
          <b>{secili.replace("Depo · ", "Depo › ")} soruları</b>
          {!ozel && <span className="dd-genel-etiket">Yeni set · kaydedince oluşur, sonra pozisyon eşleşmelerinden bağlayın</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {ozel && !/(^|· )(Genel|Ortak)$/.test(secili) && duzenler && (
              <Popconfirm title="Bu set kaldırılsın mı? Bağlı pozisyonlara Genel set sorulur." okText="Kaldır" cancelText="Vazgeç" onConfirm={() => kaydet([])}>
                <Button size="small">Seti kaldır</Button>
              </Popconfirm>
            )}
            {duzenler && (
              <Button type="primary" size="small" disabled={!kirli} loading={kaydediliyor} onClick={() => sorular && kaydet(sorular)}>
                Kaydet
              </Button>
            )}
          </span>
        </div>

        {!sorular ? (
          <Spin />
        ) : (
          <>
            {sorular.map((s, i) => (
              <div key={i} className="dd-soru-satir">
                <span className="dd-tutamak">
                  <GripVertical size={14} />
                </span>
                <Select
                  size="small"
                  value={s.tur}
                  disabled={!duzenler}
                  onChange={(v) => guncelle(i, { tur: v, zorunlu: true })}
                  options={[
                    { value: "olcek", label: "1–5 puan" },
                    { value: "acik", label: "Açık uçlu" },
                  ]}
                  style={{ width: 108 }}
                  className={s.tur === "olcek" ? "dd-tur-olcek" : "dd-tur-acik"}
                />
                <Input
                  size="small"
                  value={s.metin}
                  maxLength={300}
                  disabled={!duzenler}
                  onChange={(e) => guncelle(i, { metin: e.target.value })}
                  placeholder="Soru metni"
                />
                <span className="dd-soru-islem">
                  <Tooltip title="Tüm sorular zorunludur">
                    <Switch size="small" checked disabled />
                  </Tooltip>
                  <Button size="small" type="text" icon={<ArrowUp size={13} />} disabled={!duzenler || i === 0} onClick={() => tasi(i, -1)} />
                  <Button size="small" type="text" icon={<ArrowDown size={13} />} disabled={!duzenler || i === sorular.length - 1} onClick={() => tasi(i, 1)} />
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<Trash2 size={13} />}
                    disabled={!duzenler}
                    onClick={() => {
                      setSorular((l) => l!.filter((_, j) => j !== i));
                      setKirli(true);
                    }}
                  />
                </span>
              </div>
            ))}
            <div className="dd-soru-satir dd-soru-genel">
              <span className="dd-tutamak">
                <Lock size={13} />
              </span>
              <span className="dd-tur-etiket">1–10 genel</span>
              <span>
                <b>Genel değerlendirme puanı + açıklaması</b> <small className="dd-soluk">· her pozisyonda sonda, kaldırılamaz</small>
              </span>
              <span className="dd-soru-islem dd-soluk">zorunlu</span>
            </div>
            {duzenler && (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="dd-ekle"
                  onClick={() => {
                    setSorular((l) => [...(l ?? []), { tur: "olcek", metin: "", zorunlu: true }]);
                    setKirli(true);
                  }}
                >
                  <Plus size={14} /> 1–5 puanlı soru
                </button>
                <button
                  type="button"
                  className="dd-ekle"
                  onClick={() => {
                    setSorular((l) => [...(l ?? []), { tur: "acik", metin: "", zorunlu: true }]);
                    setKirli(true);
                  }}
                >
                  <Plus size={14} /> Açık uçlu soru
                </button>
              </div>
            )}
            <div className="dd-not">
              Soru metnini düzeltmek karşılaştırmayı bozmaz (aynı soru). Silinen soru eski raporlarda kalır; yeni eklenen sorunun önceki
              dönemi "yeni" görünür.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
