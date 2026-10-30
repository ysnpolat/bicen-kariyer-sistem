/**
 * İş Planlaması (08.10.2026).
 *
 * İK paneli ve Biçen360 güncellemelerinin planı: aşama sütunlu pano,
 * liste ve sürüm planı; işin ayrıntısında yapılacaklar, yorum, not,
 * görsel ve değişiklik geçmişi.
 *
 * Yalnızca sicil 14264 ve 10664'e açık. Kapı sunucuda (IsPlaniController):
 * panel hesabının sicili bu ikisinden biri değilse uçlar 404 döner ve menü
 * öğesi hiç çizilmez. Rol Yetkileri'nden açılamaz.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Drawer, Modal, Popconfirm, Spin } from "antd";

import { API_TABAN, api, oturumOku } from "./api";
import "./IsPlanlamasi.css";
import { PersonelAdi } from "./personelKarti";

/* ------------------------------------------------------------- tanımlar */

const ASAMA: [string, string, string][] = [
  ["fikir", "Fikir", "var(--ip-fikir)"],
  ["plan", "Planlandı", "var(--ip-plan)"],
  ["gelis", "Geliştiriliyor", "var(--ip-gelis)"],
  ["test", "Testte", "var(--ip-test)"],
  ["yayin", "Yayında", "var(--ip-yayin)"],
  ["aski", "Askıda", "var(--ip-aski)"],
];
const ASAMA_AD = Object.fromEntries(ASAMA.map(([k, a]) => [k, a]));
const ASAMA_RENK = Object.fromEntries(ASAMA.map(([k, , r]) => [k, r]));

const ONCELIK: [string, string, string][] = [
  ["acil", "Acil", "var(--ip-acil)"],
  ["yuksek", "Yüksek", "var(--ip-yuksek)"],
  ["normal", "Normal", "var(--ip-normal)"],
  ["dusuk", "Düşük", "var(--ip-dusuk)"],
];
const ONC_AD = Object.fromEntries(ONCELIK.map(([k, a]) => [k, a]));
const ONC_RENK = Object.fromEntries(ONCELIK.map(([k, , r]) => [k, r]));
const ONC_SIRA = (k: string) => ONCELIK.findIndex((o) => o[0] === k);

const PLATFORM: Record<string, string> = { panel: "İK Paneli", mobil: "Biçen360", sunucu: "Sunucu" };

type Madde = { m: string; b: boolean };

type Is = {
  id: number;
  baslik: string;
  aciklama: string;
  platform: string[];
  asama: string;
  oncelik: string;
  surum: string;
  sorumlu: string;
  hedef: string;
  maddeler: Madde[];
  olusturan: string;
  olusturma: string;
  guncelleme: string;
};

type ListeOgesi = { is: Is; yorumSay: number; notSay: number; gorselSay: number; gorseller: number[] };
type Kisi = { sicil: string; ad: string };

type Yorum = { id: number; kim: string; metin: string; tarih: string; gorseller: number[] };
type Not = { id: number; kim: string; metin: string; sabit: boolean; tarih: string };
type GecmisSatiri = { id: number; kim: string; metin: string; tarih: string };
type GorselBilgi = { id: number; ad: string; kim: string; tarih: string; kayitId: number | null };

type Ayrinti = { is: Is; yorumlar: Yorum[]; notlar: Not[]; gecmis: GecmisSatiri[]; gorseller: GorselBilgi[] };

type IsYama = Partial<Omit<Is, "id" | "olusturan" | "olusturma" | "guncelleme">>;

const KOK = "/api/IsPlani";

/* ------------------------------------------------------------ yardımcı */

const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

const bugun = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const tarihYaz = (t: string) => {
  if (!t) return "";
  const d = new Date(`${t}T00:00:00`);
  return `${d.getDate()} ${AY[d.getMonth()]}`;
};

const zaman = (t: string) => {
  const ms = new Date(t).getTime();
  const dk = Math.floor((Date.now() - ms) / 60000);
  if (dk < 1) return "şimdi";
  if (dk < 60) return `${dk} dk önce`;
  if (dk < 1440) return `${Math.floor(dk / 60)} sa önce`;
  const x = new Date(ms);
  return `${x.getDate()} ${AY[x.getMonth()]}${x.getFullYear() !== new Date().getFullYear() ? ` ${x.getFullYear()}` : ""}`;
};

const gecikti = (i: Is) => !!i.hedef && i.asama !== "yayin" && i.asama !== "aski" && i.hedef < bugun();

const depoOku = (a: string) => {
  try {
    return window.localStorage.getItem(a) ?? "";
  } catch {
    return "";
  }
};

const depoYaz = (a: string, d: string) => {
  try {
    window.localStorage.setItem(a, d);
  } catch {
    /* depolama kapalıysa seçim yalnızca bu oturumda */
  }
};

/* Görseller başlıkla (Authorization) isteniyor: adres satırında jeton
   taşımamak için. Gelen içerik bellek adresine çevrilip saklanıyor. */
const gorselBellek = new Map<number, Promise<string>>();

const gorselAdresi = (id: number) => {
  let p = gorselBellek.get(id);

  if (!p) {
    const oturum = oturumOku();

    p = fetch(`${API_TABAN}${KOK}/Gorsel/${id}`, {
      headers: oturum ? { Authorization: `Bearer ${oturum.token}` } : {},
    }).then(async (c) => {
      if (!c.ok) throw new Error("görsel");
      return URL.createObjectURL(await c.blob());
    });

    p.catch(() => gorselBellek.delete(id));
    gorselBellek.set(id, p);
  }

  return p;
};

function Gorsel({ id, alt = "", onAc, className }: { id: number; alt?: string; onAc?: (src: string) => void; className?: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let canli = true;
    gorselAdresi(id).then((s) => canli && setSrc(s)).catch(() => undefined);
    return () => {
      canli = false;
    };
  }, [id]);

  if (!src) return <span className={className ? `${className} yer` : "yer"} aria-label={alt} />;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onClick={onAc ? () => onAc(src) : undefined}
    />
  );
}

const resimDosyalari = (l: FileList | File[] | null | undefined) =>
  [...(l ?? [])].filter((f) => f.type.startsWith("image/"));

/* ---------------------------------------------------------------- sayfa */

export default function IsPlanlamasi() {
  const { message } = AntdApp.useApp();

  const [yukleniyor, setYukleniyor] = useState(true);
  const [yetkisiz, setYetkisiz] = useState(false);
  const [isler, setIsler] = useState<ListeOgesi[]>([]);
  const [kisiler, setKisiler] = useState<Kisi[]>([]);
  const [ben, setBen] = useState("");

  const [gorunum, setGorunum] = useState(() => depoOku("ip-gorunum") || "pano");
  const [platform, setPlatform] = useState("");
  const [suz, setSuz] = useState("");
  const [ara, setAra] = useState("");
  const [acik, setAcik] = useState<number | null>(null);
  const [yeni, setYeni] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    try {
      const v = await api.al<{ ben: string; kisiler: Kisi[]; isler: ListeOgesi[] }>(KOK);
      setIsler(v.isler);
      setKisiler(v.kisiler);
      setBen(v.ben);
      setYetkisiz(false);
    } catch {
      setYetkisiz(true);
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    yukle();

    /* İki kişi aynı anda çalışabiliyor: pencereye dönünce tazelenir */
    const odak = () => document.visibilityState === "visible" && yukle();
    document.addEventListener("visibilitychange", odak);
    return () => document.removeEventListener("visibilitychange", odak);
  }, [yukle]);

  useEffect(() => depoYaz("ip-gorunum", gorunum), [gorunum]);

  const kisiSirasi = useMemo(() => new Map(kisiler.map((k, n) => [k.sicil, n])), [kisiler]);
  const kisiAd = useCallback((s: string) => kisiler.find((k) => k.sicil === s)?.ad ?? s, [kisiler]);

  const Av = useCallback(
    ({ s, n }: { s: string; n?: number }) => {
      const ad = kisiAd(s);
      const kisa = ad
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((x) => x[0]?.toLocaleUpperCase("tr"))
        .join("");
      return (
        <span
          className={`ip-av k${kisiSirasi.get(s) ?? 9}`}
          style={n ? { width: n, height: n } : undefined}
          title={ad}
        >
          {kisa || "?"}
        </span>
      );
    },
    [kisiAd, kisiSirasi]
  );

  const suzulmus = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return isler.filter(
      (x) =>
        (!platform || x.is.platform.includes(platform)) &&
        (!q || `${x.is.baslik} ${x.is.aciklama} ${x.is.surum}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [isler, platform, ara]);

  const asamaDegistir = async (id: number, asama: string) => {
    const o = isler.find((x) => x.is.id === id);
    if (!o || o.is.asama === asama) return;

    setIsler((l) => l.map((x) => (x.is.id === id ? { ...x, is: { ...x.is, asama } } : x)));

    try {
      await api.gonder(`${KOK}/${id}`, { asama });
      message.success(`"${o.is.baslik}" ${ASAMA_AD[asama]} aşamasına alındı`);
    } catch (e: any) {
      message.error(e?.message ?? "Kaydedilemedi");
      yukle();
    }
  };

  if (yukleniyor)
    return (
      <div className="ip" style={{ padding: 48, textAlign: "center" }}>
        <Spin />
      </div>
    );

  if (yetkisiz)
    return (
      <div className="ip">
        <div className="ip-sayfa" style={{ alignItems: "center", padding: "48px 16px", textAlign: "center" }}>
          <b style={{ fontSize: 18 }}>🔒 Bu sayfayı görme yetkiniz yok</b>
          <p className="ip-soluk">İş Planlaması yalnızca tanımlı iki sicile açıktır.</p>
        </div>
      </div>
    );

  return (
    <div className="ip">
      <div className="ip-sayfa">
        <div className="ip-ust">
          <div>
            <h2>İş Planlaması</h2>
            <p>İK paneli ve Biçen360 için yapılacak güncellemeler: hangi aşamada, hangi sürümde, kimde.</p>
          </div>
          <span className="ip-kilit">🔒 Yalnızca {kisiler.map((k) => k.ad).join(" ve ")}</span>
        </div>

        <section className="ip-ozet" aria-label="Aşamalara göre">
          {ASAMA.map(([k, a, r]) => (
            <button key={k} aria-pressed={suz === k} onClick={() => setSuz(suz === k ? "" : k)}>
              <small>
                <i style={{ background: r }} />
                {a}
              </small>
              <b>{suzulmus.filter((x) => x.is.asama === k).length}</b>
            </button>
          ))}
        </section>

        <div className="ip-arac">
          <div className="ip-sec" role="group" aria-label="Görünüm">
            {[
              ["pano", "Pano"],
              ["liste", "Liste"],
              ["surum", "Sürüm planı"],
            ].map(([k, a]) => (
              <button key={k} aria-pressed={gorunum === k} onClick={() => setGorunum(k)}>
                {a}
              </button>
            ))}
          </div>
          <div className="ip-sec" role="group" aria-label="Platform">
            <button aria-pressed={!platform} onClick={() => setPlatform("")}>
              Hepsi
            </button>
            {Object.entries(PLATFORM).map(([k, a]) => (
              <button key={k} aria-pressed={platform === k} onClick={() => setPlatform(k)}>
                {a}
              </button>
            ))}
          </div>
          <label className="ip-sr" htmlFor="ip-ara">
            Ara
          </label>
          <input
            id="ip-ara"
            placeholder="Ara: başlık, sürüm…"
            value={ara}
            onChange={(e) => setAra(e.target.value)}
            style={{ width: 220 }}
          />
          <span className="ip-bos" />
          <button className="ip-btn ana" onClick={() => setYeni(suz || "fikir")}>
            + Yeni iş
          </button>
        </div>

        {gorunum === "pano" && (
          <Pano l={suzulmus} suz={suz} Av={Av} onAc={setAcik} onYeni={setYeni} onTasi={asamaDegistir} />
        )}
        {gorunum === "liste" && <Liste l={suzulmus} suz={suz} Av={Av} kisiAd={kisiAd} onAc={setAcik} />}
        {gorunum === "surum" && <SurumPlani l={suzulmus} suz={suz} onAc={setAcik} />}
      </div>

      <YeniIs
        asama={yeni}
        ben={ben}
        onKapat={() => setYeni(null)}
        onOlustu={(id) => {
          setYeni(null);
          yukle();
          setAcik(id);
        }}
      />

      {acik !== null && (
        <IsAyrinti
          id={acik}
          ben={ben}
          kisiler={kisiler}
          Av={Av}
          kisiAd={kisiAd}
          onDegisti={yukle}
          onKapat={() => {
            setAcik(null);
            yukle();
          }}
        />
      )}
    </div>
  );
}

type AvTipi = (p: { s: string; n?: number }) => JSX.Element;

/* ----------------------------------------------------------------- pano */

function Kart({ x, Av, onAc }: { x: ListeOgesi; Av: AvTipi; onAc: (id: number) => void }) {
  const i = x.is;
  const bitti = i.maddeler.filter((m) => m.b).length;
  const [suruk, setSuruk] = useState(false);

  return (
    <div
      className={`ip-kart${suruk ? " surukleniyor" : ""}`}
      draggable
      style={{ ["--oncelik" as any]: ONC_RENK[i.oncelik] }}
      tabIndex={0}
      role="button"
      aria-label={i.baslik}
      onClick={() => onAc(i.id)}
      onKeyDown={(e) => e.key === "Enter" && onAc(i.id)}
      onDragStart={(e) => {
        setSuruk(true);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i.id));
      }}
      onDragEnd={() => setSuruk(false)}
    >
      <div className="ip-cipler">
        {i.platform.map((p) => (
          <span key={p} className={`ip-cip ${p}`}>
            {PLATFORM[p]}
          </span>
        ))}
        {i.surum && i.surum !== "—" && <span className="ip-cip srm">{i.surum}</span>}
      </div>
      <b>{i.baslik}</b>
      {i.maddeler.length > 0 && (
        <div className="ip-ilerleme" title={`${bitti}/${i.maddeler.length}`}>
          <i style={{ width: `${(100 * bitti) / i.maddeler.length}%` }} />
        </div>
      )}
      {x.gorseller.length > 0 && (
        <div className="ip-kucukres">
          {x.gorseller.map((g) => (
            <Gorsel key={g} id={g} />
          ))}
        </div>
      )}
      <div className="ip-kalt">
        {i.hedef && <span className={gecikti(i) ? "gec" : ""}>📅 {tarihYaz(i.hedef)}</span>}
        {i.maddeler.length > 0 && (
          <span>
            ☑ {bitti}/{i.maddeler.length}
          </span>
        )}
        {x.yorumSay > 0 && <span>💬 {x.yorumSay}</span>}
        {x.notSay > 0 && <span>📝 {x.notSay}</span>}
        {i.sorumlu && <Av s={i.sorumlu} />}
      </div>
    </div>
  );
}

function Pano({
  l, suz, Av, onAc, onYeni, onTasi,
}: {
  l: ListeOgesi[];
  suz: string;
  Av: AvTipi;
  onAc: (id: number) => void;
  onYeni: (asama: string) => void;
  onTasi: (id: number, asama: string) => void;
}) {
  const [uzerinde, setUzerinde] = useState("");
  const sutunlar = suz ? ASAMA.filter(([k]) => k === suz) : ASAMA;

  return (
    <div className="ip-pano" style={suz ? { gridTemplateColumns: "minmax(260px, 420px)" } : undefined}>
      {sutunlar.map(([k, a, r]) => {
        const ic = l
          .filter((x) => x.is.asama === k)
          .sort((x, y) => ONC_SIRA(x.is.oncelik) - ONC_SIRA(y.is.oncelik) || x.is.id - y.is.id);

        return (
          <section
            key={k}
            className={`ip-sut${uzerinde === k ? " uzerinde" : ""}`}
            aria-label={a}
            onDragOver={(e) => {
              e.preventDefault();
              setUzerinde(k);
            }}
            onDragLeave={() => setUzerinde("")}
            onDrop={(e) => {
              e.preventDefault();
              setUzerinde("");
              const id = Number(e.dataTransfer.getData("text/plain"));
              if (id) onTasi(id, k);
            }}
          >
            <div className="ip-sbas">
              <i style={{ background: r }} />
              {a}
              <span>{ic.length}</span>
            </div>
            <div className="ip-kartlar">
              {ic.map((x) => (
                <Kart key={x.is.id} x={x} Av={Av} onAc={onAc} />
              ))}
              <button className="ip-ekle" onClick={() => onYeni(k)}>
                + İş ekle
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- liste */

function Liste({
  l, suz, Av, kisiAd, onAc,
}: {
  l: ListeOgesi[];
  suz: string;
  Av: AvTipi;
  kisiAd: (s: string) => string;
  onAc: (id: number) => void;
}) {
  const sira = l
    .filter((x) => !suz || x.is.asama === suz)
    .sort(
      (a, b) =>
        ASAMA.findIndex((x) => x[0] === a.is.asama) - ASAMA.findIndex((x) => x[0] === b.is.asama) ||
        (a.is.hedef || "9").localeCompare(b.is.hedef || "9")
    );

  if (sira.length === 0) return <p className="ip-soluk">Kayıt yok.</p>;

  return (
    <div className="ip-tablo">
      <table>
        <thead>
          <tr>
            <th>İş</th>
            <th>Platform</th>
            <th>Aşama</th>
            <th>Öncelik</th>
            <th>Sürüm</th>
            <th>Hedef</th>
            <th>İlerleme</th>
            <th>Sorumlu</th>
          </tr>
        </thead>
        <tbody>
          {sira.map((x) => {
            const i = x.is;
            const b = i.maddeler.filter((m) => m.b).length;
            return (
              <tr key={i.id} onClick={() => onAc(i.id)}>
                <td>
                  <b>{i.baslik}</b>
                  {(x.yorumSay > 0 || x.notSay > 0 || x.gorselSay > 0) && (
                    <div className="ip-soluk" style={{ fontSize: 11.5 }}>
                      💬 {x.yorumSay} · 📝 {x.notSay} · 🖼 {x.gorselSay}
                    </div>
                  )}
                </td>
                <td>
                  {i.platform.map((p) => (
                    <span key={p} className={`ip-cip ${p}`} style={{ marginRight: 4 }}>
                      {PLATFORM[p]}
                    </span>
                  ))}
                </td>
                <td>
                  <span className="ip-asama" style={{ ["--r" as any]: ASAMA_RENK[i.asama] }}>
                    {ASAMA_AD[i.asama]}
                  </span>
                </td>
                <td>
                  <span className="ip-onc" style={{ ["--r" as any]: ONC_RENK[i.oncelik] }}>
                    {ONC_AD[i.oncelik]}
                  </span>
                </td>
                <td style={{ fontFamily: "var(--ip-mono)" }}>{i.surum || "—"}</td>
                <td style={gecikti(i) ? { color: "var(--ip-acil)", fontWeight: 700 } : undefined}>
                  {i.hedef ? tarihYaz(i.hedef) : "—"}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {i.maddeler.length ? `${b}/${i.maddeler.length}` : "—"}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {i.sorumlu ? (
                    <>
                      <Av s={i.sorumlu} /> <PersonelAdi kod={i.sorumlu}>{kisiAd(i.sorumlu)}</PersonelAdi>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------- sürüm planı */

function SurumPlani({ l, suz, onAc }: { l: ListeOgesi[]; suz: string; onAc: (id: number) => void }) {
  const gruplar: Record<string, Is[]> = {};

  l.filter((x) => !suz || x.is.asama === suz).forEach((x) => {
    const k = x.is.surum && x.is.surum !== "—" ? x.is.surum : "Sürümsüz";
    (gruplar[k] ??= []).push(x.is);
  });

  const anahtar = Object.keys(gruplar).sort(
    (a, b) =>
      Number(a === "Sürümsüz") - Number(b === "Sürümsüz") || b.localeCompare(a, "tr", { numeric: true })
  );

  if (anahtar.length === 0) return <p className="ip-soluk">Kayıt yok.</p>;

  return (
    <div className="ip-surumler">
      {anahtar.map((k) => {
        const g = gruplar[k];
        const y = g.filter((i) => i.asama === "yayin").length;
        return (
          <section key={k} className="ip-surum">
            <h3>
              {k}
              <small>
                {y}/{g.length} yayında
              </small>
            </h3>
            <div className="ip-ilerleme">
              <i style={{ width: `${(100 * y) / g.length}%` }} />
            </div>
            {g.map((i) => (
              <div key={i.id} className="ip-sat" role="button" tabIndex={0} onClick={() => onAc(i.id)}
                onKeyDown={(e) => e.key === "Enter" && onAc(i.id)}>
                <span className="ip-asama" style={{ ["--r" as any]: ASAMA_RENK[i.asama] }} />
                <span className="ad">{i.baslik}</span>
                <small className="ip-soluk">{ASAMA_AD[i.asama]}</small>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- yeni iş */

function YeniIs({
  asama, ben, onKapat, onOlustu,
}: {
  asama: string | null;
  ben: string;
  onKapat: () => void;
  onOlustu: (id: number) => void;
}) {
  const { message } = AntdApp.useApp();
  const [baslik, setBaslik] = useState("");
  const [platform, setPlatform] = useState<string[]>(["panel"]);
  const [oncelik, setOncelik] = useState("normal");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    if (asama !== null) {
      setBaslik("");
      setPlatform(["panel"]);
      setOncelik("normal");
    }
  }, [asama]);

  const olustur = async () => {
    if (!baslik.trim()) return;
    setGonderiliyor(true);

    try {
      const v = await api.gonder<Ayrinti>(KOK, {
        baslik: baslik.trim(), platform, oncelik, asama: asama ?? "fikir", sorumlu: ben,
      });
      onOlustu(v.is.id);
    } catch (e: any) {
      message.error(e?.message ?? "Oluşturulamadı");
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      open={asama !== null}
      title={`Yeni iş · ${ASAMA_AD[asama ?? "fikir"]}`}
      onCancel={onKapat}
      onOk={olustur}
      okText="Oluştur"
      cancelText="Vazgeç"
      okButtonProps={{ disabled: !baslik.trim(), loading: gonderiliyor }}
      destroyOnHidden
      rootClassName="ip"
    >
      <div className="ip-cek" style={{ gap: 12 }}>
        <label className="ip-alanlar" style={{ gridTemplateColumns: "1fr" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ip-soluk)" }}>İşin adı</span>
          <input
            autoFocus
            value={baslik}
            maxLength={150}
            placeholder="Örn. Biçen360 1.8 bildirim sesleri"
            onChange={(e) => setBaslik(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && olustur()}
          />
        </label>
        <div className="ip-arac">
          <div className="ip-sec" role="group" aria-label="Platform">
            {Object.entries(PLATFORM).map(([k, a]) => (
              <button
                key={k}
                type="button"
                aria-pressed={platform.includes(k)}
                onClick={() =>
                  setPlatform((p) => (p.includes(k) ? (p.length > 1 ? p.filter((x) => x !== k) : p) : [...p, k]))
                }
              >
                {a}
              </button>
            ))}
          </div>
          <label className="ip-sr" htmlFor="ip-yoncelik">
            Öncelik
          </label>
          <select id="ip-yoncelik" value={oncelik} onChange={(e) => setOncelik(e.target.value)}>
            {ONCELIK.map(([k, a]) => (
              <option key={k} value={k}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <span className="ip-soluk" style={{ fontSize: 12 }}>
          Açıklama, yapılacaklar, sürüm ve hedef tarih bir sonraki ekranda.
        </span>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- ayrıntı */

function IsAyrinti({
  id, ben, kisiler, Av, kisiAd, onDegisti, onKapat,
}: {
  id: number;
  ben: string;
  kisiler: Kisi[];
  Av: AvTipi;
  kisiAd: (s: string) => string;
  onDegisti: () => void;
  onKapat: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [v, setV] = useState<Ayrinti | null>(null);
  const [sekme, setSekme] = useState<"yorum" | "not" | "gorsel" | "gecmis">("yorum");
  const [isik, setIsik] = useState("");
  const [mesgul, setMesgul] = useState(false);

  /* yazma alanları (kayıt odaktan çıkınca) */
  const [baslik, setBaslik] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [surum, setSurum] = useState("");
  const [yeniMadde, setYeniMadde] = useState("");

  const [yorum, setYorum] = useState("");
  const [ekler, setEkler] = useState<{ dosya: File; adres: string }[]>([]);
  const [not, setNot] = useState("");
  const [notSabit, setNotSabit] = useState(false);
  const [uzerinde, setUzerinde] = useState(false);

  const dosyaRef = useRef<HTMLInputElement>(null);
  const ekHedef = useRef<"yorum" | "galeri">("yorum");

  const al = useCallback(
    (d: Ayrinti) => {
      setV(d);
      setBaslik(d.is.baslik);
      setAciklama(d.is.aciklama);
      setSurum(d.is.surum);
    },
    []
  );

  /* Üst bileşen her tazelemede yeni bir kapatma işlevi veriyor; bağımlılık
     olursa ayrıntı her liste yüklemesinde yeniden istenirdi. */
  const kapatRef = useRef(onKapat);
  kapatRef.current = onKapat;

  const yukle = useCallback(async () => {
    try {
      al(await api.al<Ayrinti>(`${KOK}/${id}`));
    } catch (e: any) {
      message.error(e?.message ?? "Açılamadı");
      kapatRef.current();
    }
  }, [id, al, message]);

  useEffect(() => {
    yukle();
  }, [yukle]);

  /* Eklerin bellek adresleri pencere kapanınca bırakılır */
  const eklerRef = useRef(ekler);
  eklerRef.current = ekler;
  useEffect(() => () => eklerRef.current.forEach((e) => URL.revokeObjectURL(e.adres)), []);

  const kaydet = async (yama: IsYama) => {
    /* Önce ekranda: onay kutusu ve aşama yanıt beklemeden değişsin */
    setV((d) => (d ? { ...d, is: { ...d.is, ...yama } } : d));

    try {
      al(await api.gonder<Ayrinti>(`${KOK}/${id}`, yama));
      onDegisti();
    } catch (e: any) {
      message.error(e?.message ?? "Kaydedilemedi");
      yukle();
    }
  };

  const gorselYukle = async (dosya: File, kayitId?: number) => {
    const f = new FormData();
    f.append("dosya", dosya, dosya.name || "gorsel.png");
    if (kayitId) f.append("kayitId", String(kayitId));
    await api.dosyaGonder(`${KOK}/${id}/Gorsel`, f);
  };

  const ekleriAl = (l: File[]) => {
    if (!l.length) return;
    setEkler((e) => [...e, ...l.map((dosya) => ({ dosya, adres: URL.createObjectURL(dosya) }))]);
  };

  const galeriyeEkle = async (l: File[]) => {
    if (!l.length) return;
    setMesgul(true);
    try {
      for (const d of l) await gorselYukle(d);
      message.success(`${l.length} görsel eklendi`);
      await yukle();
      onDegisti();
    } catch (e: any) {
      message.error(e?.message ?? "Yüklenemedi");
    } finally {
      setMesgul(false);
    }
  };

  /* Panodan yapıştırma (Ctrl+V): görsel sekmesinde galeriye, diğerlerinde yoruma ek */
  const sekmeRef = useRef(sekme);
  sekmeRef.current = sekme;
  useEffect(() => {
    const yapistir = (e: ClipboardEvent) => {
      const l = resimDosyalari(e.clipboardData?.files);
      if (!l.length) return;
      e.preventDefault();
      if (sekmeRef.current === "gorsel") galeriyeEkle(l);
      else {
        setSekme("yorum");
        ekleriAl(l);
      }
    };
    document.addEventListener("paste", yapistir);
    return () => document.removeEventListener("paste", yapistir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const yorumGonder = async () => {
    const metin = yorum.trim();
    if (!metin && !ekler.length) return;
    setMesgul(true);

    try {
      const k = await api.gonder<{ id: number }>(`${KOK}/${id}/Kayit`, { tur: "yorum", metin });
      for (const e of ekler) await gorselYukle(e.dosya, k.id);
      ekler.forEach((e) => URL.revokeObjectURL(e.adres));
      setEkler([]);
      setYorum("");
      await yukle();
      onDegisti();
    } catch (e: any) {
      message.error(e?.message ?? "Gönderilemedi");
      yukle();
    } finally {
      setMesgul(false);
    }
  };

  const notEkle = async () => {
    const metin = not.trim();
    if (!metin) return;
    setMesgul(true);
    try {
      await api.gonder(`${KOK}/${id}/Kayit`, { tur: "not", metin, sabit: notSabit });
      setNot("");
      setNotSabit(false);
      await yukle();
      onDegisti();
    } catch (e: any) {
      message.error(e?.message ?? "Eklenemedi");
    } finally {
      setMesgul(false);
    }
  };

  const islem = async (f: () => Promise<unknown>) => {
    try {
      await f();
      await yukle();
      onDegisti();
    } catch (e: any) {
      message.error(e?.message ?? "İşlem yapılamadı");
    }
  };

  const i = v?.is;
  const bitti = i ? i.maddeler.filter((m) => m.b).length : 0;
  const benAd = kisiAd(ben);

  return (
    <Drawer
      open
      onClose={onKapat}
      width="min(760px, 100vw)"
      rootClassName="ip"
      closable={false}
      keyboard={!isik}
      styles={{ body: { padding: 18 } }}
      destroyOnHidden
    >
      {!i || !v ? (
        <div style={{ padding: 48, textAlign: "center" }}>
          <Spin />
        </div>
      ) : (
        <div className="ip-cek">
          <div className="ip-cbas">
            <label className="ip-sr" htmlFor="ip-baslik">
              Başlık
            </label>
            <input
              id="ip-baslik"
              value={baslik}
              maxLength={150}
              onChange={(e) => setBaslik(e.target.value)}
              onBlur={() => {
                const t = baslik.trim();
                if (!t) setBaslik(i.baslik);
                else if (t !== i.baslik) kaydet({ baslik: t });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <button className="ip-btn kucuk" onClick={onKapat}>
              Kapat
            </button>
          </div>

          <div className="ip-asamalar" role="group" aria-label="Aşama">
            {ASAMA.map(([k, a, r]) => (
              <button
                key={k}
                style={{ ["--r" as any]: r }}
                aria-pressed={i.asama === k}
                onClick={() => i.asama !== k && kaydet({ asama: k })}
              >
                {a}
              </button>
            ))}
          </div>

          <div className="ip-alanlar">
            <label>
              Öncelik
              <select value={i.oncelik} onChange={(e) => kaydet({ oncelik: e.target.value })}>
                {ONCELIK.map(([k, a]) => (
                  <option key={k} value={k}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sorumlu
              <select value={i.sorumlu} onChange={(e) => kaydet({ sorumlu: e.target.value })}>
                {kisiler.map((k) => (
                  <option key={k.sicil} value={k.sicil}>
                    {k.ad} · {k.sicil}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hedef tarih
              <input type="date" value={i.hedef} onChange={(e) => kaydet({ hedef: e.target.value })} />
            </label>
            <label>
              Sürüm
              <input
                value={surum}
                placeholder="v996, 1.7…"
                maxLength={30}
                style={{ fontFamily: "var(--ip-mono)" }}
                onChange={(e) => setSurum(e.target.value)}
                onBlur={() => surum.trim() !== i.surum && kaydet({ surum: surum.trim() })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </label>
            <label style={{ gridColumn: "span 2" }}>
              Platform
              <span className="ip-sec" role="group" style={{ width: "fit-content" }}>
                {Object.entries(PLATFORM).map(([k, a]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={i.platform.includes(k)}
                    onClick={() => {
                      const p = i.platform.includes(k) ? i.platform.filter((x) => x !== k) : [...i.platform, k];
                      if (p.length) kaydet({ platform: p });
                    }}
                  >
                    {a}
                  </button>
                ))}
              </span>
            </label>
          </div>

          <div className="ip-bolum">
            <h4>Açıklama</h4>
            <label className="ip-sr" htmlFor="ip-aciklama">
              Açıklama
            </label>
            <textarea
              id="ip-aciklama"
              rows={3}
              style={{ width: "100%" }}
              placeholder="Ne yapılacak, neden?"
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              onBlur={() => aciklama !== i.aciklama && kaydet({ aciklama })}
            />
          </div>

          <div className="ip-bolum">
            <h4>
              Yapılacaklar{" "}
              <span>
                {bitti}/{i.maddeler.length}
              </span>
            </h4>
            {i.maddeler.length > 0 && (
              <div className="ip-ilerleme" style={{ marginBottom: 6 }}>
                <i style={{ width: `${(100 * bitti) / i.maddeler.length}%` }} />
              </div>
            )}
            <div className="ip-liste">
              {i.maddeler.map((m, n) => (
                <label key={`${n}-${m.m}`} className={`ip-madde${m.b ? " bitti" : ""}`}>
                  <input
                    type="checkbox"
                    checked={m.b}
                    onChange={(e) =>
                      kaydet({ maddeler: i.maddeler.map((x, j) => (j === n ? { ...x, b: e.target.checked } : x)) })
                    }
                  />
                  <span>{m.m}</span>
                  <button
                    type="button"
                    aria-label={`${m.m} maddesini sil`}
                    onClick={(e) => {
                      e.preventDefault();
                      kaydet({ maddeler: i.maddeler.filter((_, j) => j !== n) });
                    }}
                  >
                    ×
                  </button>
                </label>
              ))}
            </div>
            <form
              className="ip-satirekle"
              onSubmit={(e) => {
                e.preventDefault();
                const t = yeniMadde.trim();
                if (!t) return;
                if (i.maddeler.some((x) => x.m === t)) {
                  message.warning("Bu madde zaten var");
                  return;
                }
                setYeniMadde("");
                kaydet({ maddeler: [...i.maddeler, { m: t, b: false }] });
              }}
            >
              <label className="ip-sr" htmlFor="ip-madde">
                Yeni madde
              </label>
              <input
                id="ip-madde"
                placeholder="Madde ekle"
                maxLength={300}
                value={yeniMadde}
                onChange={(e) => setYeniMadde(e.target.value)}
              />
              <button className="ip-btn kucuk">Ekle</button>
            </form>
          </div>

          <div className="ip-sekme2" role="tablist">
            {(
              [
                ["yorum", `Yorumlar · ${v.yorumlar.length}`],
                ["not", `Notlar · ${v.notlar.length}`],
                ["gorsel", `Görseller · ${v.gorseller.length}`],
                ["gecmis", "Geçmiş"],
              ] as const
            ).map(([k, a]) => (
              <button key={k} role="tab" aria-selected={sekme === k} onClick={() => setSekme(k)}>
                {a}
              </button>
            ))}
          </div>

          {sekme === "yorum" && (
            <div className="ip-akis">
              {v.yorumlar.length === 0 && <div className="ip-soluk">Henüz yorum yok.</div>}
              {v.yorumlar.map((y) => (
                <div key={y.id} className="ip-yorum">
                  <Av s={y.kim} />
                  <div className="kut">
                    <small>
                      <b style={{ color: "var(--ip-metin)" }}>{kisiAd(y.kim)}</b> · {zaman(y.tarih)}
                      {y.kim === ben && (
                        <Popconfirm
                          title="Yorum silinsin mi?"
                          okText="Sil"
                          cancelText="Vazgeç"
                          onConfirm={() => islem(() => api.sil(`${KOK}/Kayit/${y.id}`))}
                        >
                          <button type="button">Sil</button>
                        </Popconfirm>
                      )}
                    </small>
                    {y.metin && <p>{y.metin}</p>}
                    {y.gorseller.length > 0 && (
                      <div className="resimler">
                        {y.gorseller.map((g) => (
                          <Gorsel key={g} id={g} alt="Yorum görseli" onAc={setIsik} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <form
                className="ip-yaz"
                onSubmit={(e) => {
                  e.preventDefault();
                  yorumGonder();
                }}
              >
                {ekler.length > 0 && (
                  <div className="ip-ekonizle">
                    {ekler.map((e, n) => (
                      <span key={e.adres}>
                        <img src={e.adres} alt="" />
                        <button
                          type="button"
                          aria-label="Eki kaldır"
                          onClick={() => {
                            URL.revokeObjectURL(e.adres);
                            setEkler((l) => l.filter((_, j) => j !== n));
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <label className="ip-sr" htmlFor="ip-yorum">
                  Yorum
                </label>
                <textarea
                  id="ip-yorum"
                  placeholder={`${benAd} olarak yorum yaz…`}
                  value={yorum}
                  onChange={(e) => setYorum(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      yorumGonder();
                    }
                  }}
                />
                <div className="alt">
                  <button
                    type="button"
                    className="ip-btn kucuk"
                    onClick={() => {
                      ekHedef.current = "yorum";
                      dosyaRef.current?.click();
                    }}
                  >
                    🖼 Görsel ekle
                  </button>
                  <span className="ip-soluk" style={{ fontSize: 11.5 }}>
                    Ctrl+V ile yapıştırabilirsiniz
                  </span>
                  <span className="ip-bos" />
                  <button className="ip-btn ana kucuk" disabled={mesgul || (!yorum.trim() && !ekler.length)}>
                    Gönder
                  </button>
                </div>
              </form>
            </div>
          )}

          {sekme === "not" && (
            <div className="ip-akis" style={{ gap: 8 }}>
              {v.notlar.map((n) => (
                <div key={n.id} className={`ip-not${n.sabit ? " sabit" : ""}`}>
                  <div className="bas">
                    {n.sabit ? "📌 " : ""}
                    <b>{kisiAd(n.kim)}</b> · {zaman(n.tarih)}
                    <span className="ip-bos" />
                    <button
                      className="ip-btn kucuk"
                      onClick={() => islem(() => api.gonder(`${KOK}/Kayit/${n.id}/Sabit`))}
                    >
                      {n.sabit ? "Sabitlemeyi kaldır" : "Sabitle"}
                    </button>
                    <Popconfirm
                      title="Not silinsin mi?"
                      okText="Sil"
                      cancelText="Vazgeç"
                      onConfirm={() => islem(() => api.sil(`${KOK}/Kayit/${n.id}`))}
                    >
                      <button className="ip-btn kucuk tehlike">Sil</button>
                    </Popconfirm>
                  </div>
                  <p>{n.metin}</p>
                </div>
              ))}
              <form
                className="ip-yaz"
                onSubmit={(e) => {
                  e.preventDefault();
                  notEkle();
                }}
              >
                <label className="ip-sr" htmlFor="ip-not">
                  Not
                </label>
                <textarea
                  id="ip-not"
                  placeholder="Teknik not, karar, bağlantı… (yorumdan farklı olarak işin üstünde kalır)"
                  value={not}
                  onChange={(e) => setNot(e.target.value)}
                />
                <div className="alt">
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                    <input type="checkbox" checked={notSabit} onChange={(e) => setNotSabit(e.target.checked)} />{" "}
                    Sabitle
                  </label>
                  <span className="ip-bos" />
                  <button className="ip-btn ana kucuk" disabled={mesgul || !not.trim()}>
                    Not ekle
                  </button>
                </div>
              </form>
            </div>
          )}

          {sekme === "gorsel" && (
            <div className="ip-akis">
              <button
                type="button"
                className={`ip-surukle${uzerinde ? " uzerinde" : ""}`}
                disabled={mesgul}
                onClick={() => {
                  ekHedef.current = "galeri";
                  dosyaRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setUzerinde(true);
                }}
                onDragLeave={() => setUzerinde(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setUzerinde(false);
                  galeriyeEkle(resimDosyalari(e.dataTransfer.files));
                }}
              >
                {mesgul ? "Yükleniyor…" : "Görsel sürükleyin ya da seçin"}
                <small>
                  ekran görüntüsü, tasarım, hata fotoğrafı · panoya kopyaladığınızı Ctrl+V ile de yapıştırabilirsiniz
                </small>
              </button>
              <div className="ip-galeri">
                {v.gorseller.map((g) => (
                  <figure key={g.id}>
                    <Gorsel id={g.id} alt={g.ad} onAc={setIsik} />
                    <figcaption>
                      <span title={g.ad}>{g.ad}</span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        {kisiAd(g.kim)} · {zaman(g.tarih)}{" "}
                        <Popconfirm
                          title="Görsel silinsin mi?"
                          okText="Sil"
                          cancelText="Vazgeç"
                          onConfirm={() => islem(() => api.sil(`${KOK}/Gorsel/${g.id}`))}
                        >
                          <button className="ip-btn kucuk tehlike" style={{ padding: "0 6px" }} aria-label="Görseli sil">
                            ×
                          </button>
                        </Popconfirm>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {sekme === "gecmis" && (
            <div className="ip-gecmis">
              {v.gecmis.length === 0 && "Kayıt yok."}
              {v.gecmis.map((g) => (
                <div key={g.id}>
                  <Av s={g.kim} n={18} />
                  <span>
                    <b>{kisiAd(g.kim)}</b> {g.metin} · {zaman(g.tarih)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="ip-arac">
            <span className="ip-soluk" style={{ fontSize: 12 }}>
              {kisiAd(i.olusturan)} oluşturdu · {zaman(i.olusturma)}
            </span>
            <span className="ip-bos" />
            <Popconfirm
              title="İş silinsin mi?"
              description="Yorum, not ve görselleriyle birlikte listeden kalkar."
              okText="Sil"
              okButtonProps={{ danger: true }}
              cancelText="Vazgeç"
              onConfirm={async () => {
                try {
                  await api.sil(`${KOK}/${id}`);
                  message.success("İş silindi");
                  onKapat();
                } catch (e: any) {
                  message.error(e?.message ?? "Silinemedi");
                }
              }}
            >
              <button className="ip-btn tehlike kucuk">İşi sil</button>
            </Popconfirm>
          </div>

          <input
            ref={dosyaRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              const l = resimDosyalari(e.target.files);
              e.target.value = "";
              if (ekHedef.current === "galeri") galeriyeEkle(l);
              else ekleriAl(l);
            }}
          />

          {isik && (
            <div className="ip-isik" role="dialog" aria-label="Görsel" onClick={() => setIsik("")}>
              <img src={isik} alt="" />
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
