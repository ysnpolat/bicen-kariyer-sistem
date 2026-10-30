/**
 * ---------------------------------------------------------------------------
 * Envanter (08.10.2026)
 * ---------------------------------------------------------------------------
 * Odoo'daki ekipman modülü düzeni: üstte arama ve süzgeç / gruplama, solda
 * şube ve kategori paneli; kart, liste, bakım planı ve maliyet görünümleri.
 * Cihaz açılınca tam sayfa form (CihazFormu) ve sağda not / aktivite akışı.
 *
 * Süzme ve gruplama tarayıcıda: liste kapsamdaki bütün cihazları bir kez
 * getiriyor, her tuşta sunucuya gitmek gerekmiyor.
 *
 * Kapsam sunucuda: şube kullanıcısı kendi şubesini görür ve tutar görmez;
 * diğerleri temsilcisi olduğu departmanların cihazlarını; Admin ve "Tüm
 * departmanlar" yetkisi olanlar hepsini.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Drawer, Spin, message } from "antd";
import { BarChart3, CalendarDays, LayoutGrid, List as ListeSimge } from "lucide-react";

import { api } from "../../api";
import CihazFormu from "./CihazFormu";
import EnvanterKategorileri from "./Kategoriler";
import {
  ASAMA_AD,
  ASAMA_IKON,
  AY_KISA,
  AY_TAM,
  BUGUN,
  DURUM,
  DURUM_AD,
  DURUM_RENK,
  bakimDurumu,
  cihazAdi,
  defterDegeri,
  ayGecen,
  etiketler,
  garanti,
  gorselAdresi,
  gunFark,
  gunMetni,
  renkSec,
  tl,
  type Cihaz,
  type Erisim,
  type Secenekler,
} from "./ortak";
import "./envanter.css";

/* -------------------------------------------------------------------------- */

type Yuz = { tur: "f" | "g" | "a"; k: string };

const FILTRELER: [string, string, ((c: Cihaz) => boolean) | null][] = [
  ["calisan", "Çalışıyor", (c) => c.durum === "aktif"],
  ["arizali", "Arızalı / bakımda", (c) => c.durum === "arizali" || c.durum === "bakimda"],
  ["kullanimda", "Kullanım dışı hariç", (c) => c.durum !== "pasif"],
  ["-", "", null],
  ["garantili", "Garantisi süren", (c) => !!c.garantiBitis && gunFark(c.garantiBitis) >= 0],
  ["garantibitiyor", "Garantisi 60 gün içinde bitecek", (c) => !!c.garantiBitis && gunFark(c.garantiBitis) >= 0 && gunFark(c.garantiBitis) <= 60],
  ["-", "", null],
  ["bakimgec", "Bakımı gecikmiş", (c) => (bakimDurumu(c)?.f ?? 0) < 0],
  ["bakim30", "30 gün içinde bakım", (c) => { const b = bakimDurumu(c); return !!b && b.f >= 0 && b.f <= 30; }],
  ["acikariza", "Açık arıza kaydı olan", (c) => (c.acikAriza ?? 0) > 0],
  ["tamirde", "Tamirde (merkezde / firmada)", (c) => !!c.tamirAsama],
  ["firmada", "Firmaya gönderilmiş", (c) => c.tamirAsama === "firmada"],
  ["pahali", "Tamir gideri alışın %30'unu geçen", (c) => !!c.alisBedeli && (c.tamirToplam ?? 0) / c.alisBedeli > 0.3],
];
const FILTRE = Object.fromEntries(
  FILTRELER.filter((f) => f[2]).map(([k, a, fn]) => [k, { a, fn: fn! }])
) as Record<string, { a: string; fn: (c: Cihaz) => boolean }>;

const GRUPLA: [string, string][] = [
  ["subeKodu", "Şube"], ["tur", "Kategori"], ["durum", "Durum"], ["departman", "Sorumlu birim"], ["bakimFirmasi", "Bakım firması"],
];
const GR_AD = Object.fromEntries(GRUPLA);

const grupDegeri = (c: Cihaz, g: string) =>
  g === "durum" ? DURUM_AD[c.durum] ?? c.durum : ((c as any)[g] as string) || "—";

const depoOku = (a: string) => {
  try {
    return localStorage.getItem(a) ?? "";
  } catch {
    return "";
  }
};

const depoYaz = (a: string, d: string) => {
  try {
    localStorage.setItem(a, d);
  } catch {
    /* depolama kapalı */
  }
};

/* ========================================================================== */

export default function Envanter() {
  const [liste, setListe] = useState<Cihaz[]>([]);
  const [erisim, setErisim] = useState<Erisim | null>(null);
  const [secenekler, setSecenekler] = useState<Secenekler | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);

  const [gorunum, setGorunum] = useState(() => depoOku("envanterGorunum2") || "kanban");
  const [ara, setAra] = useState("");
  const [yuzler, setYuzler] = useState<Yuz[]>([]);
  const [grupla, setGrupla] = useState("");
  const [sube, setSube] = useState("");
  const [kategori, setKategori] = useState("");
  const [menu, setMenu] = useState(false);
  const [secili, setSecili] = useState<Set<number>>(new Set());
  const [raporKir, setRaporKir] = useState<"subeKodu" | "tur" | "departman">("subeKodu");

  /* Açık cihaz: kimlik, "yeni" ya da kapalı. Bakım planından "Yapıldı"
     doğrudan bakım kaydı penceresini açıyor. */
  /* Arıza ayrıntısından "Envanterde aç" (?cihaz=12) doğrudan cihazı açar */
  const [acik, setAcik] = useState<number | "yeni" | null>(() => {
    const c = Number(new URLSearchParams(window.location.search).get("cihaz"));
    return c > 0 ? c : null;
  });
  const [acilis, setAcilis] = useState<"bakim" | null>(null);

  /* Departmanın kendi cihaz kategorileri (13.10.2026) */
  const [kategorilerAcik, setKategorilerAcik] = useState(false);

  useEffect(() => depoYaz("envanterGorunum2", gorunum), [gorunum]);

  const getir = useCallback(async () => {
    setHata(null);

    try {
      const c = await api.getir<{ cihazlar: Cihaz[]; erisim: Erisim }>("Envanter");
      setListe(c.cihazlar ?? []);
      setErisim(c.erisim ?? null);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
    api.getir<Secenekler>("Envanter/Secenekler").then(setSecenekler).catch(() => undefined);
  }, [getir]);

  /* Maliyet görmeyen kullanıcıda maliyet görünümü yok */
  useEffect(() => {
    if (erisim && !erisim.maliyet && gorunum === "rapor") setGorunum("kanban");
  }, [erisim, gorunum]);

  const suzulmus = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    const metin = (c: Cihaz) =>
      `${c.marka ?? ""} ${c.model ?? ""} ${c.seriNo ?? ""} ${c.sicilNo ?? ""} ${c.konum ?? ""} ${c.sahibi ?? ""} ${c.tur ?? ""} ${c.etiketler ?? ""}`.toLocaleLowerCase("tr");

    return liste.filter((c) => {
      if (sube && c.subeKodu !== sube) return false;
      if (kategori && c.tur !== kategori) return false;

      for (const y of yuzler) {
        if (y.tur === "f" && !FILTRE[y.k]?.fn(c)) return false;
        if (y.tur === "a" && !metin(c).includes(y.k.toLocaleLowerCase("tr"))) return false;
      }

      return !q || metin(c).includes(q);
    });
  }, [liste, sube, kategori, yuzler, ara]);

  const filtreVar = (k: string) => yuzler.some((y) => y.tur === "f" && y.k === k);

  const filtreDegistir = (k: string) =>
    setYuzler((l) => (l.some((y) => y.tur === "f" && y.k === k) ? l.filter((y) => !(y.tur === "f" && y.k === k)) : [...l, { tur: "f", k }]));

  const gruplaSec = (k: string) => {
    const yeni = grupla === k ? "" : k;
    setGrupla(yeni);
    setYuzler((l) => [...l.filter((y) => y.tur !== "g"), ...(yeni ? [{ tur: "g" as const, k: yeni }] : [])]);
    if (gorunum !== "liste" && gorunum !== "kanban") setGorunum("kanban");
  };

  const hazir = (h: string) => {
    setMenu(false);
    setSube("");
    setKategori("");
    setGrupla("");

    if (h === "bakim") { setYuzler([{ tur: "f", k: "bakim30" }]); setGorunum("takvim"); }
    else if (h === "ariza") { setYuzler([{ tur: "f", k: "arizali" }, { tur: "g", k: "subeKodu" }]); setGrupla("subeKodu"); setGorunum("kanban"); }
    else if (h === "pahali") { setYuzler([{ tur: "f", k: "pahali" }]); setGorunum("liste"); }
    else setYuzler([]);
  };

  const durumDegistir = async (c: Cihaz, durum: string) => {
    if (c.durum === durum) return;
    setListe((l) => l.map((x) => (x.id === c.id ? { ...x, durum } : x)));

    try {
      await api.gonder(`Envanter/${c.id}/Durum`, { durum });
      message.success(`${cihazAdi(c)}: ${DURUM_AD[durum]}`);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Durum değiştirilemedi.");
      getir();
    }
  };

  const ac = (id: number, ilk: "bakim" | null = null) => {
    setAcilis(ilk);
    setAcik(id);
    setMenu(false);
    window.scrollTo({ top: 0 });
  };

  /* ------------------------------------------------------------- form */
  if (acik !== null && secenekler && erisim)
    return (
      <div className="ev">
        <CihazFormu
          id={acik === "yeni" ? null : acik}
          liste={suzulmus}
          tumListe={liste}
          secenekler={secenekler}
          erisim={erisim}
          acilis={acilis}
          varsayilan={{ subeKodu: sube || undefined, tur: kategori || undefined }}
          git={(id) => { setAcilis(null); setAcik(id); }}
          kapat={() => { setAcik(null); setAcilis(null); getir(); }}
          degisti={getir}
        />
      </div>
    );

  if (yukleniyor)
    return (
      <div className="ev ev-yukleniyor">
        <Spin />
      </div>
    );

  const subeler = secenekler?.subeler?.length
    ? secenekler.subeler
    : [...new Set(liste.map((c) => c.subeKodu))].sort((a, b) => a.localeCompare(b, "tr"));
  const kategoriler = [...new Set(liste.map((c) => c.tur).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "tr"));
  const maliyet = !!erisim?.maliyet;

  return (
    <div className="ev">
      <div className="ev-kap" onClick={(e) => { if (menu && !(e.target as HTMLElement).closest(".ev-arama")) setMenu(false); }}>
        {hata && <Alert type="error" showIcon message={hata} />}

        {erisim && !erisim.tumu && !erisim.sube && erisim.departmanlar.length === 0 && (
          <Alert
            type="info"
            showIcon
            message="Departman temsilcisi değilsiniz"
            description="Envanterde yalnızca temsilcisi olduğunuz departmanın cihazları görünür. Yönetim › Roller'den departmanı olan bir role eklenmeniz, Departmanlar'dan temsilci yapılmanız ya da 'Tüm departmanlar' yetkisi verilmesi gerekiyor."
          />
        )}

        <div className="ev-kontrol">
          <div className="ev-kirinti">
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Envanter</h1>
            {erisim?.duzenler !== false && <button className="ev-btn ana" onClick={() => { setAcilis(null); setAcik("yeni"); }}>+ Yeni cihaz</button>}
            {erisim && (
              <span className="ev-kucuk-not">
                {erisim.sube ? `${erisim.sube} şubesi` : erisim.tumu ? "Tüm departmanlar" : erisim.departmanAdlari.join(", ")}
                {erisim.duzenler === false ? " · yalnızca görüntüleme" : ""}
              </span>
            )}
            {erisim?.kategoriYonetir && (
              <button className="ev-btn kucuk" onClick={() => setKategorilerAcik(true)}>Kategoriler</button>
            )}
          </div>

          <div className="ev-arama" role="search">
            {yuzler.map((y, n) => (
              <span key={`${y.tur}${y.k}`} className="ev-yuz">
                <small>{y.tur === "f" ? "Süzgeç" : y.tur === "g" ? "Grupla" : "Ara"}</small>
                {y.tur === "f" ? FILTRE[y.k]?.a : y.tur === "g" ? GR_AD[y.k] : y.k}
                <button
                  aria-label="Kaldır"
                  onClick={() => {
                    if (y.tur === "g") setGrupla("");
                    setYuzler((l) => l.filter((_, i) => i !== n));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <label className="ev-sr" htmlFor="evAra">Ara</label>
            <input
              id="evAra"
              placeholder="Ara: marka, seri no, demirbaş, konum…"
              value={ara}
              autoComplete="off"
              onChange={(e) => setAra(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ara.trim()) {
                  setYuzler((l) => [...l, { tur: "a", k: ara.trim() }]);
                  setAra("");
                }
                if (e.key === "Backspace" && !ara && yuzler.length) {
                  const son = yuzler[yuzler.length - 1];
                  if (son.tur === "g") setGrupla("");
                  setYuzler((l) => l.slice(0, -1));
                }
                if (e.key === "Escape") setMenu(false);
              }}
            />
            <button className="ev-acilir-dugme" aria-expanded={menu} aria-label="Süzgeç ve gruplama" onClick={() => setMenu(!menu)}>
              ▾
            </button>

            {menu && (
              <div className="ev-acilir" role="dialog" aria-label="Süzgeçler">
                <div>
                  <h5>Süzgeçler</h5>
                  {FILTRELER.map(([k, a], n) =>
                    k === "-" ? (
                      <hr key={n} style={{ border: 0, borderTop: "1px solid var(--cizgi)", margin: "4px 6px" }} />
                    ) : (k === "pahali" && !maliyet) ? null : (
                      <button key={k} aria-pressed={filtreVar(k)} onClick={() => filtreDegistir(k)}>{a}</button>
                    )
                  )}
                </div>
                <div>
                  <h5>Grupla</h5>
                  {GRUPLA.map(([k, a]) => (
                    <button key={k} aria-pressed={grupla === k} onClick={() => gruplaSec(k)}>{a}</button>
                  ))}
                </div>
                <div>
                  <h5>Kayıtlı aramalar</h5>
                  <button aria-pressed="false" onClick={() => hazir("bakim")}>Bu ay bakımı olanlar</button>
                  <button aria-pressed="false" onClick={() => hazir("ariza")}>Arızalı cihazlar · şubeye göre</button>
                  {maliyet && <button aria-pressed="false" onClick={() => hazir("pahali")}>Yenilenmesi düşünülecekler</button>}
                  <button aria-pressed="false" onClick={() => hazir("temizle")}>Tümünü temizle</button>
                </div>
              </div>
            )}
          </div>

          <div className="ev-sagkontrol">
            <span className="ev-kucuk-not ev-sayi">{suzulmus.length} / {liste.length}</span>
            <div className="ev-sec gorunum" role="group" aria-label="Görünüm">
              {([
                ["kanban", "Kart", <LayoutGrid key="k" />],
                ["liste", "Liste", <ListeSimge key="l" />],
                ["takvim", "Bakım planı", <CalendarDays key="t" />],
                ...(maliyet ? [["rapor", "Maliyet", <BarChart3 key="r" />]] : []),
              ] as [string, string, JSX.Element][]).map(([k, a, s]) => (
                <button key={k} aria-pressed={gorunum === k} title={a} onClick={() => setGorunum(k)}>
                  {s}
                  <span>{a}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ev-dar-sube">
          <label className="ev-sr" htmlFor="evDarSube">Şube</label>
          <select id="evDarSube" value={sube} onChange={(e) => setSube(e.target.value)}>
            <option value="">Tüm şubeler</option>
            {subeler.map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="ev-sr" htmlFor="evDarKat">Kategori</label>
          <select id="evDarKat" value={kategori} onChange={(e) => setKategori(e.target.value)}>
            <option value="">Tüm kategoriler</option>
            {kategoriler.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="ev-govde">
          <aside className="ev-solpanel" aria-label="Şube ve kategori">
            {!erisim?.sube && (
              <div>
                <h4>Şube</h4>
                <button aria-pressed={!sube} onClick={() => setSube("")}>Tümü <small>{liste.length}</small></button>
                {[...new Set(liste.map((c) => c.subeKodu))].sort((a, b) => a.localeCompare(b, "tr")).map((s) => (
                  <button key={s} aria-pressed={sube === s} onClick={() => setSube(s)}>
                    {s} <small>{liste.filter((c) => c.subeKodu === s).length}</small>
                  </button>
                ))}
              </div>
            )}
            <div>
              <h4>Kategori</h4>
              <button aria-pressed={!kategori} onClick={() => setKategori("")}>Tümü <small>{liste.length}</small></button>
              {kategoriler.map((k) => (
                <button key={k} aria-pressed={kategori === k} onClick={() => setKategori(k)}>
                  <span style={{ display: "flex", gap: 7, alignItems: "center" }}>
                    <i className="ev-nokta" style={{ ["--d" as any]: renkSec(k) }} />
                    {k}
                  </span>
                  <small>{liste.filter((c) => c.tur === k).length}</small>
                </button>
              ))}
            </div>
          </aside>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <Serit liste={liste} maliyet={maliyet} filtreVar={filtreVar} filtreDegistir={filtreDegistir} raporAc={() => setGorunum("rapor")} />

            {suzulmus.length === 0 ? (
              <div className="ev-bos-durum">
                <b>{liste.length === 0 ? "Henüz cihaz yok" : "Bu süzgeçlerle cihaz yok"}</b>
                <span className="ev-kucuk-not">
                  {liste.length === 0 ? "İlk cihazı ekleyin; fotoğraf, garanti ve bakım bilgisini sonra da girebilirsiniz." : "Süzgeçleri kaldırın ya da yeni cihaz ekleyin."}
                </span>
                <div className="ev-satirac">
                  {liste.length > 0 && <button className="ev-btn" onClick={() => { hazir("temizle"); setAra(""); }}>Süzgeçleri temizle</button>}
                  {erisim?.duzenler !== false && <button className="ev-btn ana" onClick={() => setAcik("yeni")}>+ Yeni cihaz</button>}
                </div>
              </div>
            ) : gorunum === "liste" ? (
              <Liste
                l={suzulmus}
                grupla={grupla}
                maliyet={maliyet}
                secili={secili}
                setSecili={setSecili}
                subeler={subeler}
                subeKilitli={!!erisim?.sube}
                ac={ac}
                yenile={getir}
              />
            ) : gorunum === "takvim" ? (
              <Plan l={suzulmus} ac={ac} />
            ) : gorunum === "rapor" && maliyet ? (
              <Rapor l={suzulmus} kir={raporKir} setKir={setRaporKir} ac={ac}
                sec={(k) => { if (raporKir === "subeKodu") setSube(k); else if (raporKir === "tur") setKategori(k); else setYuzler((l) => [...l, { tur: "a", k }]); setGorunum("liste"); }} />
            ) : (
              <Kanban l={suzulmus} grupla={grupla} maliyet={maliyet} ac={ac} durumDegistir={durumDegistir} />
            )}
          </div>
        </div>
      </div>

      <Drawer
        open={kategorilerAcik}
        onClose={() => setKategorilerAcik(false)}
        width="min(860px, 100vw)"
        title="Envanter kategorileri"
        destroyOnHidden
      >
        <EnvanterKategorileri
          degisti={() => {
            getir();
            api.getir<Secenekler>("Envanter/Secenekler").then(setSecenekler).catch(() => undefined);
          }}
        />
      </Drawer>
    </div>
  );
}

/* ========================================================================== */
/* Özet şeridi                                                                 */

function Serit({
  liste, maliyet, filtreVar, filtreDegistir, raporAc,
}: {
  liste: Cihaz[];
  maliyet: boolean;
  filtreVar: (k: string) => boolean;
  filtreDegistir: (k: string) => void;
  raporAc: () => void;
}) {
  const q: [string, string, number, string][] = [
    ["arizali", "Arızalı / bakımda", liste.filter(FILTRE.arizali.fn).length, "ev-kotu"],
    ["bakimgec", "Bakımı gecikmiş", liste.filter(FILTRE.bakimgec.fn).length, "ev-kotu"],
    ["bakim30", "30 gün içinde bakım", liste.filter(FILTRE.bakim30.fn).length, "ev-uyari"],
    ["garantibitiyor", "Garantisi bitiyor", liste.filter(FILTRE.garantibitiyor.fn).length, "ev-uyari"],
  ];
  const yil = liste.reduce((a, c) => a + (c.buYilTamir ?? 0), 0);

  return (
    <div className="ev-serit">
      {q.map(([k, a, n, s]) => (
        <button key={k} className={n ? s : ""} aria-pressed={filtreVar(k)} onClick={() => filtreDegistir(k)}>
          <b>{n}</b>
          {a}
        </button>
      ))}
      {maliyet && (
        <button onClick={raporAc}>
          <b>{tl(yil)}</b>
          {new Date().getFullYear()} tamir ve bakım gideri
        </button>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Kart (kanban)                                                               */

function Kart({ c, maliyet, ac, surukle }: { c: Cihaz; maliyet: boolean; ac: (id: number) => void; surukle: boolean }) {
  const g = garanti(c);
  const b = bakimDurumu(c);
  const aa = c.acikAriza ?? 0;
  const [suruk, setSuruk] = useState(false);
  const kapak = gorselAdresi(c.kapakId);

  return (
    <article
      className={`ev-kart${suruk ? " surukleniyor" : ""}`}
      tabIndex={0}
      role="button"
      aria-label={cihazAdi(c)}
      draggable={surukle}
      onDragStart={(e) => { setSuruk(true); e.dataTransfer.setData("text/plain", String(c.id)); }}
      onDragEnd={() => setSuruk(false)}
      onClick={() => ac(c.id)}
      onKeyDown={(e) => e.key === "Enter" && ac(c.id)}
    >
      <span className="ev-serit-durum" style={{ ["--d" as any]: DURUM_RENK[c.durum] }} />
      <div className={`ev-kapak${c.kapakKirp ? " kirp" : ""}`}>
        {kapak ? (
          <>
            <div className="ev-bulanik" style={{ backgroundImage: `url('${kapak}')` }} />
            <img src={kapak} alt="" loading="lazy" />
          </>
        ) : (
          <div className="ev-yok">Görsel yok</div>
        )}
        <div className="ev-ust-rozet">
          {c.durum !== "aktif" && (
            <span className={`ev-rozet ${c.durum === "arizali" ? "kotu" : c.durum === "bakimda" ? "bilgi" : ""}`}>
              <i className="ev-nokta" style={{ ["--d" as any]: DURUM_RENK[c.durum] }} />
              {DURUM_AD[c.durum]}
            </span>
          )}
          {aa > 0 && <span className="ev-rozet kotu">{aa} açık arıza</span>}
        </div>
        {(c.gorselSayisi ?? 0) > 1 && <span className="ev-say">{c.gorselSayisi} görsel</span>}
      </div>
      <div className="ev-kgovde">
        <b>{cihazAdi(c)}</b>
        <div className="ev-alt">
          <i className="ev-nokta" style={{ ["--d" as any]: renkSec(c.tur) }} />
          {c.tur || "Kategori yok"} · {c.subeKodu}
        </div>
        {c.tamirAsama && (
          <div>
            <span className={`ev-asama-rozet ${c.tamirAsama}`} title={c.tamirFirma ?? undefined}>
              {ASAMA_IKON[c.tamirAsama]} {c.tamirAsama === "firmada" && c.tamirFirma ? `Firmada · ${c.tamirFirma}` : ASAMA_AD[c.tamirAsama]}
            </span>
          </div>
        )}
        <div className="ev-alt">
          {c.sicilNo && <span className="ev-mono">{c.sicilNo}</span>}
          {c.konum && <span>{c.sicilNo ? "· " : ""}{c.konum}</span>}
        </div>
        <div className="ev-alt" style={{ marginTop: 2 }}>
          {g.s && <span className={`ev-rozet ${g.s}`}>{g.m}</span>}
          {b?.s && <span className={`ev-rozet ${b.s}`}>{b.m}</span>}
          {etiketler(c).slice(0, 2).map((e) => <span key={e} className="ev-rozet">{e}</span>)}
        </div>
        <div className="ev-kalt">
          <span title="Tamir ve bakım kaydı">🔧 {c.tamirSayisi ?? 0}</span>
          {(c.belgeSayisi ?? 0) > 0 && <span title="Belge">📄 {c.belgeSayisi}</span>}
          {maliyet && <span className="ev-tutar" title="Toplam tamir ve bakım maliyeti">{c.tamirToplam ? tl(c.tamirToplam) : "—"}</span>}
        </div>
      </div>
    </article>
  );
}

function Kanban({
  l, grupla, maliyet, ac, durumDegistir,
}: {
  l: Cihaz[];
  grupla: string;
  maliyet: boolean;
  ac: (id: number) => void;
  durumDegistir: (c: Cihaz, d: string) => void;
}) {
  const [uzerinde, setUzerinde] = useState("");

  if (!grupla)
    return <div className="ev-kanban">{l.map((c) => <Kart key={c.id} c={c} maliyet={maliyet} ac={ac} surukle={false} />)}</div>;

  const anahtarlar =
    grupla === "durum"
      ? DURUM.map((d) => d[1])
      : [...new Set(l.map((c) => grupDegeri(c, grupla)))].sort((a, b) => a.localeCompare(b, "tr"));

  return (
    <>
      <div className="ev-gruplar">
        {anahtarlar.map((k) => {
          const ic = l.filter((c) => grupDegeri(c, grupla) === k);
          const dk = grupla === "durum" ? DURUM.find((d) => d[1] === k)?.[0] : undefined;

          return (
            <section
              key={k}
              className={`ev-grup${uzerinde === k ? " uzerinde" : ""}`}
              aria-label={k}
              onDragOver={(e) => { if (dk) { e.preventDefault(); setUzerinde(k); } }}
              onDragLeave={() => setUzerinde("")}
              onDrop={(e) => {
                if (!dk) return;
                e.preventDefault();
                setUzerinde("");
                const c = l.find((x) => x.id === Number(e.dataTransfer.getData("text/plain")));
                if (c) durumDegistir(c, dk);
              }}
            >
              <h3>
                {dk && <i style={{ background: DURUM_RENK[dk] }} />}
                {k}
                <span>{ic.length}{maliyet ? ` · ${tl(ic.reduce((a, c) => a + (c.tamirToplam ?? 0), 0))}` : ""}</span>
              </h3>
              {ic.map((c) => <Kart key={c.id} c={c} maliyet={maliyet} ac={ac} surukle={!!dk} />)}
            </section>
          );
        })}
      </div>
      {grupla === "durum" && <p className="ev-kucuk-not">Kartı sürükleyip başka sütuna bırakarak durumunu değiştirebilirsiniz.</p>}
    </>
  );
}

/* ========================================================================== */
/* Liste                                                                       */

function Liste({
  l, grupla, maliyet, secili, setSecili, subeler, subeKilitli, ac, yenile,
}: {
  l: Cihaz[];
  grupla: string;
  maliyet: boolean;
  secili: Set<number>;
  setSecili: (s: Set<number>) => void;
  subeler: string[];
  subeKilitli: boolean;
  ac: (id: number) => void;
  yenile: () => void;
}) {
  const [isleniyor, setIsleniyor] = useState(false);

  const toplu = async (govde: object, basari: string) => {
    setIsleniyor(true);
    try {
      const c = await api.gonder<{ adet: number }>("Envanter/Toplu", { idler: [...secili], ...govde });
      message.success(`${c.adet} cihaz: ${basari}`);
      setSecili(new Set());
      yenile();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "İşlem yapılamadı.");
    } finally {
      setIsleniyor(false);
    }
  };

  const sec = (id: number) => {
    const s = new Set(secili);
    s.has(id) ? s.delete(id) : s.add(id);
    setSecili(s);
  };

  const satir = (c: Cihaz) => {
    const b = bakimDurumu(c);
    const g = garanti(c);

    return (
      <tr key={c.id} className="tik" onClick={() => ac(c.id)}>
        <td onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={secili.has(c.id)} onChange={() => sec(c.id)} aria-label="Seç" />
        </td>
        <td>
          <div className="ev-minires">{c.kapakId ? <img src={gorselAdresi(c.kapakId)} alt="" loading="lazy" /> : null}</div>
        </td>
        <td>
          <b>{cihazAdi(c)}</b>
          <div className="ev-kucuk-not">{c.tur}</div>
        </td>
        <td className="ev-mono">{c.sicilNo}</td>
        <td className="ev-mono">{c.seriNo}</td>
        <td>
          {c.subeKodu}
          <div className="ev-kucuk-not">{c.konum}</div>
        </td>
        <td>
          <span className="ev-rozet"><i className="ev-nokta" style={{ ["--d" as any]: DURUM_RENK[c.durum] }} />{DURUM_AD[c.durum]}</span>
          {c.tamirAsama && (
            <div style={{ marginTop: 3 }}>
              <span className={`ev-asama-rozet ${c.tamirAsama}`}>
                {ASAMA_IKON[c.tamirAsama]} {c.tamirAsama === "firmada" && c.tamirFirma ? `Firmada · ${c.tamirFirma}` : ASAMA_AD[c.tamirAsama]}
              </span>
            </div>
          )}
        </td>
        <td>{g.s ? <span className={`ev-rozet ${g.s}`}>{g.m}</span> : <span className="ev-kucuk-not">{g.m}</span>}</td>
        <td>{b ? <span className={`ev-rozet ${b.s}`}>{b.m}</span> : <span className="ev-kucuk-not">—</span>}</td>
        {maliyet && <td className="sag">{c.alisBedeli ? tl(c.alisBedeli) : "—"}</td>}
        {maliyet && <td className="sag">{tl(c.tamirToplam)}</td>}
      </tr>
    );
  };

  const sutun = maliyet ? 11 : 9;
  let govde: JSX.Element[] = [];

  if (grupla) {
    const gr: Record<string, Cihaz[]> = {};
    l.forEach((c) => (gr[grupDegeri(c, grupla)] ??= []).push(c));

    Object.keys(gr).sort((a, b) => a.localeCompare(b, "tr")).forEach((k) => {
      govde.push(
        <tr key={`g-${k}`} className="ev-grupsatir">
          <td colSpan={maliyet ? sutun - 2 : sutun}>{k} <span className="ev-kucuk-not">({gr[k].length})</span></td>
          {maliyet && <td className="sag">{tl(gr[k].reduce((a, c) => a + (c.alisBedeli ?? 0), 0))}</td>}
          {maliyet && <td className="sag">{tl(gr[k].reduce((a, c) => a + (c.tamirToplam ?? 0), 0))}</td>}
        </tr>
      );
      govde = govde.concat(gr[k].map(satir));
    });
  } else govde = l.map(satir);

  return (
    <>
      {secili.size > 0 && (
        <div className="ev-toplu">
          <b>{secili.size} cihaz seçili</b>
          <span className="ev-bos" />
          {!subeKilitli && (
            <>
              <label className="ev-sr" htmlFor="evTopluSube">Şubeye taşı</label>
              <select id="evTopluSube" disabled={isleniyor} value="" onChange={(e) => e.target.value && toplu({ subeKodu: e.target.value }, `${e.target.value} şubesine taşındı`)}>
                <option value="">Şubeye taşı…</option>
                {subeler.map((s) => <option key={s}>{s}</option>)}
              </select>
            </>
          )}
          <label className="ev-sr" htmlFor="evTopluDurum">Durum</label>
          <select id="evTopluDurum" disabled={isleniyor} value="" onChange={(e) => e.target.value && toplu({ durum: e.target.value }, DURUM_AD[e.target.value])}>
            <option value="">Durumu değiştir…</option>
            {DURUM.map(([k, a]) => <option key={k} value={k}>{a}</option>)}
          </select>
          {maliyet && <button className="ev-btn kucuk" disabled={isleniyor} onClick={() => toplu({ bakim: true }, "bakım kaydı girildi")}>Toplu bakım kaydı</button>}
          <button className="ev-btn kucuk" onClick={() => setSecili(new Set())}>Seçimi bırak</button>
        </div>
      )}
      <div className="ev-tablo">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Tümünü seç"
                  checked={l.length > 0 && l.every((c) => secili.has(c.id))}
                  onChange={(e) => setSecili(e.target.checked ? new Set(l.map((c) => c.id)) : new Set())}
                />
              </th>
              <th />
              <th>Cihaz</th>
              <th>Demirbaş</th>
              <th>Seri no</th>
              <th>Şube / konum</th>
              <th>Durum</th>
              <th>Garanti</th>
              <th>Bakım</th>
              {maliyet && <th className="sag">Alış</th>}
              {maliyet && <th className="sag">Tamir + bakım</th>}
            </tr>
          </thead>
          <tbody>{govde}</tbody>
          {maliyet && (
            <tfoot>
              <tr>
                <td colSpan={sutun - 2}>Toplam · {l.length} cihaz</td>
                <td className="sag">{tl(l.reduce((a, c) => a + (c.alisBedeli ?? 0), 0))}</td>
                <td className="sag">{tl(l.reduce((a, c) => a + (c.tamirToplam ?? 0), 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

/* ========================================================================== */
/* Bakım planı                                                                 */

function Plan({ l, ac }: { l: Cihaz[]; ac: (id: number, ilk?: "bakim" | null) => void }) {
  type Is = { c: Cihaz; t: string; ad: string; firma: string | null; tur: "bakim" | "garanti" | "akt" };
  const isler: Is[] = [];

  l.forEach((c) => {
    if (c.sonrakiBakim && c.durum !== "pasif")
      isler.push({ c, t: gunMetni(c.sonrakiBakim), ad: "Periyodik bakım", firma: c.bakimFirmasi, tur: "bakim" });
    if (c.garantiBitis && gunFark(c.garantiBitis) >= 0 && gunFark(c.garantiBitis) <= 365)
      isler.push({ c, t: gunMetni(c.garantiBitis), ad: "Garanti bitişi", firma: c.garantiSaglayici || c.tedarikci, tur: "garanti" });
    if (c.siradakiAktivite)
      isler.push({ c, t: gunMetni(c.siradakiAktivite), ad: "Planlı aktivite", firma: null, tur: "akt" });
  });

  isler.sort((a, b) => a.t.localeCompare(b.t));

  const bugun = BUGUN();
  const gec = isler.filter((i) => i.t < bugun);
  const aylar: Record<string, Is[]> = {};
  isler.filter((i) => i.t >= bugun).forEach((i) => (aylar[i.t.slice(0, 7)] ??= []).push(i));

  if (isler.length === 0)
    return (
      <div className="ev-bos-durum">
        <b>Planlı bakım yok</b>
        <span className="ev-kucuk-not">Cihazın Bakım planı sekmesinden bakım aralığını girin; sonraki bakım burada görünür.</span>
      </div>
    );

  const satir = (i: Is, n: number) => {
    const d = new Date(`${i.t}T00:00:00`);
    const g = i.t < bugun;

    return (
      <div key={`${i.c.id}-${i.tur}-${n}`} className="ev-is">
        <div className={`ev-gunkutu${g ? " gec" : ""}`}>
          <b>{d.getDate()}</b>
          <small>{AY_KISA[d.getMonth()]}</small>
        </div>
        <div className="ev-ad">
          <b role="button" tabIndex={0} onClick={() => ac(i.c.id)} onKeyDown={(e) => e.key === "Enter" && ac(i.c.id)}>{cihazAdi(i.c)}</b>
          <small>
            {i.tur === "garanti" ? "🛡 " : i.tur === "akt" ? "☑ " : "🔧 "}
            {i.ad} · {i.c.subeKodu}
            {i.firma ? ` · ${i.firma}` : ""}
            {g && <b style={{ color: "var(--kotu)", display: "inline" }}> · {-gunFark(i.t)} gün gecikti</b>}
          </small>
        </div>
        {i.tur === "bakim" ? <button className="ev-btn kucuk" onClick={() => ac(i.c.id, "bakim")}>Yapıldı</button> : <span />}
      </div>
    );
  };

  return (
    <>
      <div className="ev-plan">
        {gec.length > 0 && (
          <section className="ev-ay" style={{ borderColor: "color-mix(in srgb,var(--kotu) 45%,var(--cizgi))" }}>
            <h3 style={{ color: "var(--kotu)" }}>Gecikenler<small>{gec.length} iş</small></h3>
            {gec.map(satir)}
          </section>
        )}
        {Object.keys(aylar).slice(0, 9).map((k) => {
          const [y, m] = k.split("-");
          return (
            <section key={k} className="ev-ay">
              <h3>{AY_TAM[+m - 1]} {y}<small>{aylar[k].length} iş</small></h3>
              {aylar[k].map(satir)}
            </section>
          );
        })}
      </div>
      <p className="ev-kucuk-not">"Yapıldı" bakım kaydını açar; kaydedince son bakım tarihi ve bir sonraki bakım kendiliğinden güncellenir.</p>
    </>
  );
}

/* ========================================================================== */
/* Maliyet                                                                     */

function Rapor({
  l, kir, setKir, ac, sec,
}: {
  l: Cihaz[];
  kir: "subeKodu" | "tur" | "departman";
  setKir: (k: "subeKodu" | "tur" | "departman") => void;
  ac: (id: number) => void;
  sec: (k: string) => void;
}) {
  type G = { n: number; alis: number; defter: number; top: number; yil: number; gun: number; ariza: number };
  const gr: Record<string, G> = {};

  l.forEach((c) => {
    const k = ((c as any)[kir] as string) || "—";
    const g = (gr[k] ??= { n: 0, alis: 0, defter: 0, top: 0, yil: 0, gun: 0, ariza: 0 });
    g.n++;
    g.alis += c.alisBedeli ?? 0;
    g.defter += defterDegeri(c);
    g.top += c.tamirToplam ?? 0;
    g.yil += c.buYilTamir ?? 0;
    g.gun += c.gunDisi ?? 0;
    g.ariza += c.arizaSayisi ?? 0;
  });

  const satirlar = Object.entries(gr).sort((a, b) => b[1].top - a[1].top);
  const T = satirlar.reduce<G>((a, [, g]) => ({ n: a.n + g.n, alis: a.alis + g.alis, defter: a.defter + g.defter, top: a.top + g.top, yil: a.yil + g.yil, gun: a.gun + g.gun, ariza: a.ariza + g.ariza }),
    { n: 0, alis: 0, defter: 0, top: 0, yil: 0, gun: 0, ariza: 0 });

  const enCok = [...l].filter((c) => (c.tamirToplam ?? 0) > 0).sort((a, b) => (b.tamirToplam ?? 0) - (a.tamirToplam ?? 0)).slice(0, 8);
  const max = Math.max(1, ...enCok.map((c) => Math.max(c.tamirToplam ?? 0, c.alisBedeli ?? 0)));
  const yenile = l.filter((c) => (c.alisBedeli && (c.tamirToplam ?? 0) / c.alisBedeli > 0.3) || (c.alisTarihi && c.ekonomikOmur && ayGecen(c) >= c.ekonomikOmur));
  const kirAd = kir === "subeKodu" ? "Şube" : kir === "tur" ? "Kategori" : "Sorumlu birim";

  return (
    <div className="ev-rapor">
      <section className="ev-panel">
        <h3>
          Maliyet dağılımı
          <span className="ev-bos" />
          <span className="ev-sec" role="group" aria-label="Kırılım">
            {([["subeKodu", "Şube"], ["tur", "Kategori"], ["departman", "Sorumlu birim"]] as const).map(([k, a]) => (
              <button key={k} aria-pressed={kir === k} onClick={() => setKir(k)}>{a}</button>
            ))}
          </span>
        </h3>
        <div className="ev-tablo">
          <table>
            <thead>
              <tr>
                <th>{kirAd}</th>
                <th className="sag">Cihaz</th>
                <th className="sag">Alış bedeli</th>
                <th className="sag">Defter değeri</th>
                <th className="sag">{new Date().getFullYear()} gideri</th>
                <th className="sag">Toplam tamir + bakım</th>
                <th className="sag">Arıza</th>
                <th className="sag">Hizmet dışı</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map(([k, g]) => (
                <tr key={k} className="tik" onClick={() => sec(k)}>
                  <td><b>{k}</b></td>
                  <td className="sag">{g.n}</td>
                  <td className="sag">{tl(g.alis)}</td>
                  <td className="sag">{tl(g.defter)}</td>
                  <td className="sag">{tl(g.yil)}</td>
                  <td className="sag"><b>{tl(g.top)}</b></td>
                  <td className="sag">{g.ariza}</td>
                  <td className="sag">{g.gun} gün</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Toplam</td>
                <td className="sag">{T.n}</td>
                <td className="sag">{tl(T.alis)}</td>
                <td className="sag">{tl(T.defter)}</td>
                <td className="sag">{tl(T.yil)}</td>
                <td className="sag">{tl(T.top)}</td>
                <td className="sag">{T.ariza}</td>
                <td className="sag">{T.gun} gün</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="ev-kucuk-not">
          Tutarlar KDV dahil; servis formları ve elle girilen tamir kayıtları birlikte. Garanti kapsamındaki işler maliyete eklenmez.
          Defter değeri alış bedeli ve ekonomik ömürden doğrusal hesaplanır. Satıra tıklayınca o gruptaki cihazlar listelenir.
        </p>
      </section>

      <section className="ev-panel">
        <h3>En çok harcama yapılan cihazlar</h3>
        {enCok.length === 0 ? (
          <span className="ev-kucuk-not">Henüz tamir ya da bakım gideri girilmemiş.</span>
        ) : (
          <>
            <div className="ev-lejant">
              <span><i style={{ background: "var(--yesil)" }} />Tamir + bakım</span>
              <span><i style={{ background: "var(--bilgi)" }} />Alış bedeli</span>
            </div>
            <div className="ev-cubukgrafik">
              {enCok.map((c) => (
                <div key={c.id} className="ev-cg" role="button" tabIndex={0} title={cihazAdi(c)} onClick={() => ac(c.id)} onKeyDown={(e) => e.key === "Enter" && ac(c.id)}>
                  <span>{cihazAdi(c)}<br /><small className="ev-kucuk-not">{c.subeKodu}</small></span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div className="ev-yol"><i className="p" style={{ width: `${(100 * (c.tamirToplam ?? 0)) / max}%` }} /></div>
                    <div className="ev-yol"><i className="s" style={{ width: `${(100 * (c.alisBedeli ?? 0)) / max}%` }} /></div>
                  </div>
                  <b>{tl(c.tamirToplam)}<br /><small className="ev-kucuk-not">{c.alisBedeli ? `%${Math.round((100 * (c.tamirToplam ?? 0)) / c.alisBedeli)}` : "alış yok"}</small></b>
                </div>
              ))}
            </div>
          </>
        )}
        {yenile.length > 0 && (
          <div className="ev-uyarikutu">
            <span>♻️</span>
            <span>
              <b>Yenileme adayı {yenile.length} cihaz: </b>
              {yenile.slice(0, 12).map((c, n) => (
                <span key={c.id}>
                  {n > 0 && ", "}
                  <a href="#" style={{ color: "var(--bilgi)" }} onClick={(e) => { e.preventDefault(); ac(c.id); }}>{cihazAdi(c)}</a>
                </span>
              ))}
              {yenile.length > 12 && ` ve ${yenile.length - 12} cihaz daha`}. Tamir gideri alış bedelinin %30'unu geçmiş ya da ekonomik ömrünü doldurmuş.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
