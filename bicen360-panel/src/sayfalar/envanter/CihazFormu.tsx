/**
 * Cihaz formu (Odoo düzeni).
 *
 * Üstte durum çubuğu ve kısayol kutuları (tamir, maliyet, arıza, belge,
 * konum geçmişi); altında bilgiler ve sekmeler; sağda not, aktivite ve
 * otomatik değişiklik geçmişi. Alanlar yerinde düzenleniyor ve alandan
 * çıkınca kaydediliyor; yeni cihazda "Oluştur" ile.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Popconfirm, Spin, message } from "antd";
import { AlertTriangle, Banknote, FileText, MapPin, Wrench } from "lucide-react";

import { api } from "../../api";
import ArizaAc from "../ArizaAc";
import TamirPenceresi, { type TamirAcilis } from "./TamirPenceresi";
import {
  ARIZA_DURUM,
  ASAMA_AD,
  ASAMA_IKON,
  BELGE_TURLERI,
  BUGUN,
  DURUM,
  TT_AD,
  TT_RENK,
  ayGecen,
  bakimDurumu,
  belgeAc,
  boyutMetni,
  cihazAdi,
  defterDegeri,
  etiketler,
  garanti,
  gorselAdresi,
  gunEkle,
  kisa,
  resimMi,
  gunMetni,
  renkSec,
  tamirNet,
  tarih,
  tl,
  zaman,
  type Ayrinti,
  type Cihaz,
  type Erisim,
  type Secenekler,
  type Tamir,
} from "./ortak";

type Sekme = "genel" | "tamir" | "maliyet" | "bakim" | "zimmet" | "ariza" | "gorsel";

const bosCihaz = (v: { subeKodu?: string; tur?: string }, erisim: Erisim, subeler: string[]): Cihaz => ({
  id: 0,
  subeKodu: erisim.sube ?? v.subeKodu ?? subeler[0] ?? "",
  tur: v.tur ?? null,
  marka: null, model: null, seriNo: null, sicilNo: null, sahibi: null, konum: null,
  departmanId: !erisim.tumu && erisim.departmanlar.length >= 1 ? erisim.departmanlar[0] : null,
  departman: null, ustCihazId: null, ustCihaz: null, tedarikci: null, alisTarihi: null,
  garantiVar: false, garantiBaslangic: null, garantiAy: null, garantiBitis: null, garantiSaglayici: null, garantiNotu: null,
  sonBakim: null, sonrakiBakim: null, bakimAraligi: null, bakimFirmasi: null, bakimNotu: null,
  etiketler: null, notlar: null, durum: "aktif", alisBedeli: null, ekonomikOmur: 60, kapakKirp: false,
});

/** Sunucunun beklediği gövde */
const girdi = (c: Cihaz) => ({
  id: c.id,
  subeKodu: c.subeKodu,
  tur: c.tur, marka: c.marka, model: c.model, seriNo: c.seriNo, sicilNo: c.sicilNo,
  sahibi: c.sahibi, konum: c.konum,
  departmanId: c.departmanId ?? 0,
  ustCihazId: c.ustCihazId ?? 0,
  tedarikci: c.tedarikci,
  alisTarihi: gunMetni(c.alisTarihi) || null,
  alisBedeli: c.alisBedeli,
  ekonomikOmur: c.ekonomikOmur,
  kapakKirp: c.kapakKirp,
  garantiVar: c.garantiVar || !!c.garantiBitis,
  garantiBaslangic: gunMetni(c.garantiBaslangic) || null,
  garantiAy: c.garantiAy,
  garantiBitis: gunMetni(c.garantiBitis) || null,
  garantiSaglayici: c.garantiSaglayici, garantiNotu: c.garantiNotu,
  sonBakim: gunMetni(c.sonBakim) || null,
  sonrakiBakim: gunMetni(c.sonrakiBakim) || null,
  bakimAraligi: c.bakimAraligi,
  bakimFirmasi: c.bakimFirmasi, bakimNotu: c.bakimNotu,
  etiketler: etiketler(c),
  notlar: c.notlar,
  durum: c.durum,
});

const AKT: Record<string, [string, string, string]> = {
  bakim: ["🔧", "var(--bilgi)", "Bakım"],
  ara: ["📞", "var(--mor)", "Arama"],
  yap: ["☑", "var(--uyari)", "Yapılacak"],
};

/* ========================================================================== */

export default function CihazFormu({
  id,
  liste,
  tumListe,
  secenekler,
  erisim,
  acilis,
  varsayilan,
  git,
  kapat,
  degisti,
}: {
  id: number | null;
  liste: Cihaz[];
  tumListe: Cihaz[];
  secenekler: Secenekler;
  erisim: Erisim;
  acilis: "bakim" | null;
  varsayilan: { subeKodu?: string; tur?: string };
  git: (id: number) => void;
  kapat: () => void;
  degisti: () => void;
}) {
  const [v, setV] = useState<Ayrinti | null>(null);
  const [f, setF] = useState<Cihaz>(() => bosCihaz(varsayilan, erisim, secenekler.subeler));
  const [hata, setHata] = useState<string | null>(null);
  const [kayit, setKayit] = useState<"" | "kaydediliyor" | "kaydedildi">("");
  const [sekme, setSekme] = useState<Sekme>("genel");
  const [akisSekme, setAkisSekme] = useState<"not" | "akt">("not");
  const [tamir, setTamir] = useState<TamirAcilis | null>(null);
  const [tasiAcik, setTasiAcik] = useState(false);
  const [arizaAcik, setArizaAcik] = useState(false);
  const [arizaTurleri, setArizaTurleri] = useState<{ id: number; ad: string; departmanId?: number | null }[]>([]);
  const [isik, setIsik] = useState("");
  const [uzerinde, setUzerinde] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);

  const maliyet = erisim.maliyet;
  const yeni = !id;

  const al = useCallback((a: Ayrinti) => {
    setV(a);
    setF(a.cihaz);
  }, []);

  const oku = useCallback(async () => {
    if (!id) return;

    try {
      al(await api.getir<Ayrinti>(`Envanter/${id}`));
      setHata(null);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Cihaz açılamadı.");
    }
  }, [id, al]);

  useEffect(() => {
    setV(null);
    setSekme("genel");
    if (id) oku();
    else setF(bosCihaz(varsayilan, erisim, secenekler.subeler));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* Bakım planından "Yapıldı": form açılınca bakım kaydı penceresi */
  const acildi = useRef(false);
  useEffect(() => {
    if (acilis === "bakim" && v && !acildi.current && maliyet) {
      acildi.current = true;
      setSekme("tamir");
      setTamir({ tur: v.cihaz.tur?.toLocaleLowerCase("tr").includes("terazi") ? "kalibrasyon" : "bakim" });
    }
  }, [acilis, v, maliyet]);

  /* Kayıtlar sırayla gitsin: alandan alana hızlı geçişte iki istek
     birbirini ezmesin. */
  const sira = useRef<Promise<unknown>>(Promise.resolve());

  const kaydet = (yama: Partial<Cihaz> = {}) => {
    const yeniF = { ...f, ...yama };
    setF(yeniF);

    if (yeni) return;

    setKayit("kaydediliyor");

    sira.current = sira.current.then(async () => {
      try {
        const c = await api.gonder<{ ayrinti: Ayrinti }>("Envanter", girdi(yeniF));
        al(c.ayrinti);
        setKayit("kaydedildi");
        degisti();
      } catch (h) {
        setKayit("");
        message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
        oku();
      }
    });
  };

  /** Metin alanı: yazarken yalnızca ekranda, çıkınca kaydedilir */
  const metin = (k: keyof Cihaz) => ({
    value: ((f[k] as string | number | null) ?? "") as string | number,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value })),
    onBlur: () => {
      if (!v) return;
      const a = (v.cihaz[k] ?? "") as unknown;
      const b = (f[k] ?? "") as unknown;
      if (String(a) !== String(b)) kaydet({ [k]: typeof b === "string" && b.trim() === "" ? null : b } as Partial<Cihaz>);
    },
  });

  const sayi = (k: keyof Cihaz) => ({
    value: (f[k] as number | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setF((x) => ({ ...x, [k]: e.target.value === "" ? null : Number(e.target.value) })),
    onBlur: () => {
      if (v && (v.cihaz[k] ?? null) !== (f[k] ?? null)) kaydet();
    },
  });

  const tarihAlan = (k: keyof Cihaz) => ({
    value: gunMetni(f[k] as string | null),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => kaydet({ [k]: e.target.value || null } as Partial<Cihaz>),
  });

  const olustur = async () => {
    if (!f.tur && !f.marka && !f.model && !f.seriNo)
      return message.warning("Kategori, marka, model ya da seri numarasından en az birini yazınız.");

    setYukleniyor(true);

    try {
      const c = await api.gonder<{ id: number }>("Envanter", girdi(f));
      message.success("Cihaz oluşturuldu.");
      degisti();
      git(c.id);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Oluşturulamadı.");
    } finally {
      setYukleniyor(false);
    }
  };

  const islem = async (fn: () => Promise<unknown>, basari?: string) => {
    try {
      await fn();
      if (basari) message.success(basari);
      await oku();
      degisti();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "İşlem yapılamadı.");
    }
  };

  /* ---------------------------------------------------------- görseller */
  const gorselRef = useRef<HTMLInputElement>(null);
  const belgeRef = useRef<HTMLInputElement>(null);
  const [belgeTur, setBelgeTur] = useState(BELGE_TURLERI[maliyet ? 0 : 1]);

  const gorselYukle = async (dosyalar: File[]) => {
    const l = dosyalar.filter((d) => d.type.startsWith("image/"));
    if (!id || !l.length) return;

    setYukleniyor(true);

    try {
      for (const d of l) {
        const form = new FormData();
        form.append("dosya", d, d.name || "yapistirilan.png");
        await api.dosyaGonder(`Envanter/${id}/Gorsel`, form);
      }
      message.success(`${l.length} görsel eklendi.`);
      await oku();
      degisti();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Görsel yüklenemedi.");
    } finally {
      setYukleniyor(false);
    }
  };

  /* Panodan yapıştırma (Ctrl+V); pencere açıkken değil */
  const yapistirRef = useRef(gorselYukle);
  yapistirRef.current = gorselYukle;
  const pencereAcik = !!tamir || tasiAcik || arizaAcik;
  useEffect(() => {
    const yapistir = (e: ClipboardEvent) => {
      if (pencereAcik) return;
      const l = [...(e.clipboardData?.files ?? [])].filter((d) => d.type.startsWith("image/"));
      if (!l.length) return;
      e.preventDefault();
      setSekme("gorsel");
      yapistirRef.current(l);
    };
    document.addEventListener("paste", yapistir);
    return () => document.removeEventListener("paste", yapistir);
  }, [pencereAcik]);

  const belgeYukle = async (dosyalar: File[]) => {
    if (!id || !dosyalar.length) return;
    setYukleniyor(true);

    try {
      for (const d of dosyalar) {
        const form = new FormData();
        form.append("dosya", d, d.name);
        form.append("tur", belgeTur);
        await api.dosyaGonder(`Envanter/${id}/Belge`, form);
      }
      message.success("Belge eklendi.");
      await oku();
      degisti();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Belge yüklenemedi.");
    } finally {
      setYukleniyor(false);
    }
  };

  /* --------------------------------------------------------- türetilen */
  const kapak = v?.gorseller.find((g) => g.kapak) ?? v?.gorseller[0];
  const b = bakimDurumu(f);
  const g = garanti(f);
  const acikAriza = (v?.arizalar ?? []).filter((a) => a.durum !== "cozuldu" && a.durum !== "kapandi");

  const tamirToplam = useMemo(
    () => (v ? v.tamirler.reduce((a, t) => a + tamirNet(t), 0) + v.servisFormlari.reduce((a, s) => a + (s.toplam ?? 0), 0) : 0),
    [v]
  );

  const departmanSecenek = erisim.tumu || erisim.sube
    ? secenekler.departmanlar
    : secenekler.departmanlar.filter((d) => erisim.departmanlar.includes(d.id));

  const sira2 = liste.findIndex((x) => x.id === id);
  const komsu = (yon: 1 | -1) => {
    if (liste.length < 2 || sira2 < 0) return;
    git(liste[(sira2 + yon + liste.length) % liste.length].id);
  };

  if (hata)
    return (
      <div className="ev-kap">
        <div className="ev-kirinti"><a className="ev-kirinti-geri" style={{ color: "var(--bilgi)", fontWeight: 700, cursor: "pointer", fontSize: 20 }} onClick={kapat}>Envanter</a></div>
        <Alert type="error" showIcon message={hata} />
      </div>
    );

  if (!yeni && !v)
    return (
      <div className="ev-yukleniyor">
        <Spin />
      </div>
    );

  const kisayollar: [Sekme, JSX.Element, string | number, string, string?][] = [
    ["tamir", <Wrench key="w" />, (v?.tamirler.length ?? 0) + (v?.servisFormlari.length ?? 0), "Tamir ve bakım"],
    ...(maliyet ? [["maliyet", <Banknote key="b" />, tl(tamirToplam), "Toplam maliyet"] as [Sekme, JSX.Element, string, string]] : []),
    ["ariza", <AlertTriangle key="a" />, acikAriza.length ? `${acikAriza.length} açık` : v?.arizalar.length ?? 0, "Arıza kaydı", acikAriza.length ? "ev-uyari" : ""],
    ["gorsel", <FileText key="f" />, v?.belgeler.length ?? 0, "Belge"],
    ["zimmet", <MapPin key="m" />, Math.max(1, v?.konumlar.length ?? 0), "Konum geçmişi"],
  ];

  return (
    <div className="ev-kap">
      {/* ------------------------------------------------ kırıntı */}
      <div className="ev-kontrol" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
        <div className="ev-kirinti">
          <a style={{ color: "var(--bilgi)", fontWeight: 700, cursor: "pointer", fontSize: 20 }} onClick={kapat}>Envanter</a>
          <span style={{ color: "var(--soluk)" }}>›</span>
          <span className="ev-baslik2">{yeni ? "Yeni cihaz" : cihazAdi(f)}</span>
        </div>
        <div className="ev-sagkontrol">
          {!yeni && <span className="ev-kucuk-not">{kayit === "kaydediliyor" ? "Kaydediliyor…" : kayit === "kaydedildi" ? "✓ Kaydedildi" : ""}</span>}
          {!yeni && liste.length > 1 && (
            <>
              <span className="ev-kucuk-not ev-sayi">{sira2 + 1} / {liste.length}</span>
              <button className="ev-btn" aria-label="Önceki" onClick={() => komsu(-1)}>‹</button>
              <button className="ev-btn" aria-label="Sonraki" onClick={() => komsu(1)}>›</button>
            </>
          )}
        </div>
      </div>

      <div className="ev-form">
        <div className="ev-sayfa">
          {/* -------------------------------------------- durum çubuğu */}
          <div className="ev-durumcubuk">
            {yeni ? (
              <>
                <button className="ev-btn ana kucuk" disabled={yukleniyor} onClick={olustur}>Oluştur</button>
                <button className="ev-btn kucuk" onClick={kapat}>Vazgeç</button>
              </>
            ) : (
              <>
                {maliyet && erisim.duzenler !== false && <button className="ev-btn ana kucuk" onClick={() => setTamir({})}>+ Tamir / bakım kaydı</button>}
                <button className="ev-btn kucuk" onClick={() => {
                  setArizaAcik(true);
                  if (!arizaTurleri.length) api.getir<any[]>("Ariza/Turler").then(setArizaTurleri).catch(() => undefined);
                }}>Arıza kaydı aç</button>
                {!erisim.sube && erisim.duzenler !== false && <button className="ev-btn kucuk" onClick={() => setTasiAcik(true)}>Şubeye taşı</button>}
              </>
            )}
            <div className="ev-asamalar" role="group" aria-label="Durum">
              {DURUM.map(([k, a, r]) => (
                <button
                  key={k}
                  style={{ ["--d" as any]: r }}
                  aria-pressed={f.durum === k}
                  onClick={() => {
                    if (f.durum === k) return;
                    if (yeni) return setF((x) => ({ ...x, durum: k }));
                    setF((x) => ({ ...x, durum: k }));
                    islem(() => api.gonder(`Envanter/${id}/Durum`, { durum: k }), `Durum: ${a}`);
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* -------------------------------------------- kısayollar */}
          {!yeni && (
            <div className="ev-akilli">
              {kisayollar.map(([k, ik, deger, ad, s]) => (
                <button key={ad} className={s || ""} onClick={() => setSekme(k)}>
                  {ik}
                  <span><b>{deger}</b><small>{ad}</small></span>
                </button>
              ))}
            </div>
          )}

          <div className="ev-fgovde">
            {/* -------------------------------------------- başlık */}
            <div className="ev-fbas">
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--soluk)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                  {f.tur || "Cihaz"}
                </span>
                <h2 className="ev-ad">{yeni && !f.marka && !f.model ? "Yeni cihaz" : cihazAdi(f)}</h2>
                <div className="ev-etiketler">
                  {etiketler(f).map((e, n) => (
                    <span key={e} className="ev-etiket" style={{ ["--e" as any]: renkSec(e) }}>
                      {e}
                      <button aria-label={`${e} etiketini kaldır`} onClick={() => kaydet({ etiketler: etiketler(f).filter((_, i) => i !== n).join(",") || null })}>×</button>
                    </span>
                  ))}
                  <label className="ev-sr" htmlFor="evEtiket">Etiket ekle</label>
                  <input
                    id="evEtiket"
                    placeholder="+ etiket"
                    style={{ width: 110, padding: "2px 8px", fontSize: 12 }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const d = (e.target as HTMLInputElement).value.trim().replace(/,/g, " ");
                      if (d && !etiketler(f).includes(d)) kaydet({ etiketler: [...etiketler(f), d].join(",") });
                      (e.target as HTMLInputElement).value = "";
                    }}
                  />
                </div>
                {b?.s && !yeni && (
                  <div className={`ev-uyarikutu ${b.s}`} style={{ marginTop: 10 }}>
                    <span>🔧</span>
                    <span>
                      <b>{b.m}.</b> {f.bakimFirmasi ?? ""}
                      {maliyet && <button className="ev-btn kucuk" style={{ marginLeft: 6 }} onClick={() => { setSekme("tamir"); setTamir({ tur: "bakim" }); }}>Bakım kaydı gir</button>}
                    </span>
                  </div>
                )}
                {acikAriza.length > 0 && (
                  <div className="ev-uyarikutu kotu" style={{ marginTop: 8 }}>
                    <span>⚠️</span>
                    <span>
                      <b>{acikAriza.length} açık arıza kaydı: </b>
                      {acikAriza.map((a) => `#${a.id} · ${a.baslik} (${ARIZA_DURUM[a.durum] ?? a.durum})`).join(", ")}
                    </span>
                  </div>
                )}
              </div>
              {!yeni && (
                <div className={`ev-avatar${f.kapakKirp ? " kirp" : ""}`}>
                  {kapak ? (
                    <>
                      <div className="ev-bulanik" style={{ backgroundImage: `url('${gorselAdresi(kapak.id)}')` }} />
                      <img src={gorselAdresi(kapak.id)} alt="Kapak görseli" style={{ cursor: "zoom-in" }} onClick={() => setIsik(gorselAdresi(kapak.id))} />
                    </>
                  ) : (
                    <span className="ev-kucuk-not">Görsel yok</span>
                  )}
                  <div className="ev-islem">
                    {kapak && <button title="Sığdır ya da kırp" onClick={() => kaydet({ kapakKirp: !f.kapakKirp })}>{f.kapakKirp ? "Sığdır" : "Doldur"}</button>}
                    <button title="Görsel yükle" onClick={() => gorselRef.current?.click()}>Yükle</button>
                  </div>
                </div>
              )}
            </div>

            {/* -------------------------------------------- alanlar */}
            <div className="ev-alanlar">
              <label className="ev-alan" htmlFor="evTur">
                <span>Kategori</span>
                <input id="evTur" list="evTurler" {...metin("tur")} />
              </label>
              <label className="ev-alan" htmlFor="evSube">
                <span>Şube</span>
                <select id="evSube" value={f.subeKodu} disabled={!!erisim.sube} onChange={(e) => {
                  if (yeni) setF((x) => ({ ...x, subeKodu: e.target.value }));
                  else kaydet({ subeKodu: e.target.value });
                }}>
                  {!secenekler.subeler.includes(f.subeKodu) && <option>{f.subeKodu}</option>}
                  {secenekler.subeler.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="ev-alan" htmlFor="evMarka"><span>Marka</span><input id="evMarka" {...metin("marka")} /></label>
              <label className="ev-alan" htmlFor="evKonum"><span>Konum<small>Mağaza içinde nerede</small></span><input id="evKonum" {...metin("konum")} /></label>
              <label className="ev-alan" htmlFor="evModel"><span>Model</span><input id="evModel" {...metin("model")} /></label>
              <label className="ev-alan" htmlFor="evSahibi"><span>Zimmetli<small>Kişi ya da birim</small></span><input id="evSahibi" {...metin("sahibi")} /></label>
              <label className="ev-alan" htmlFor="evSeri"><span>Seri no</span><input id="evSeri" className="ev-mono" {...metin("seriNo")} /></label>
              <label className="ev-alan" htmlFor="evDep">
                <span>Sorumlu birim<small>Cihazı bu departman görür</small></span>
                <select id="evDep" value={f.departmanId ?? ""} disabled={!!erisim.sube} onChange={(e) => {
                  const d = e.target.value ? Number(e.target.value) : null;
                  if (yeni) setF((x) => ({ ...x, departmanId: d }));
                  else kaydet({ departmanId: d });
                }}>
                  {(erisim.tumu || erisim.sube) && <option value="">— seçilmedi —</option>}
                  {f.departmanId && !departmanSecenek.some((d) => d.id === f.departmanId) && <option value={f.departmanId}>{f.departman ?? "Başka departman"}</option>}
                  {departmanSecenek.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}
                </select>
              </label>
              <label className="ev-alan" htmlFor="evSicil"><span>Demirbaş no</span><input id="evSicil" className="ev-mono" {...metin("sicilNo")} /></label>
              <label className="ev-alan" htmlFor="evUst">
                <span>Bağlı olduğu cihaz<small>Örn. NVR, kasa</small></span>
                <select id="evUst" value={f.ustCihazId ?? ""} onChange={(e) => {
                  const u = e.target.value ? Number(e.target.value) : null;
                  if (yeni) setF((x) => ({ ...x, ustCihazId: u }));
                  else kaydet({ ustCihazId: u });
                }}>
                  <option value="">— yok —</option>
                  {f.ustCihazId && !tumListe.some((x) => x.id === f.ustCihazId) && <option value={f.ustCihazId}>{f.ustCihaz}</option>}
                  {tumListe.filter((x) => x.id !== f.id && x.subeKodu === f.subeKodu).map((x) => (
                    <option key={x.id} value={x.id}>{cihazAdi(x)}{x.sicilNo ? ` · ${x.sicilNo}` : ""}</option>
                  ))}
                </select>
              </label>
            </div>
            <datalist id="evTurler">
              {[...new Set([...secenekler.turler, ...secenekler.kategoriTurleri])].map((t) => <option key={t} value={t} />)}
            </datalist>
            <datalist id="evFirmaListesi">
              {secenekler.firmalar.map((x) => <option key={x} value={x} />)}
            </datalist>

            {yeni ? (
              <div className="ev-bilgi-not">
                Oluşturduktan sonra fotoğraf, garanti, bakım planı, tamir geçmişi ve belgeleri ekleyebilirsiniz.
              </div>
            ) : (
              <>
                {/* -------------------------------------------- sekmeler */}
                <div className="ev-sekmeler" role="tablist">
                  {([
                    ["genel", "Satın alma ve garanti"],
                    ["tamir", "Tamir geçmişi", (v?.tamirler.length ?? 0) + (v?.servisFormlari.length ?? 0)],
                    ...(maliyet ? [["maliyet", "Maliyet"]] : []),
                    ["bakim", "Bakım planı"],
                    ["zimmet", "Konum geçmişi"],
                    ["ariza", "Arıza kayıtları", v?.arizalar.length ?? 0],
                    ["gorsel", "Görsel ve belgeler", (v?.gorseller.length ?? 0) + (v?.belgeler.length ?? 0)],
                  ] as [Sekme, string, number?][]).map(([k, a, n]) => (
                    <button key={k} role="tab" aria-selected={sekme === k} onClick={() => setSekme(k)}>
                      {a}
                      {n != null && <span>{n}</span>}
                    </button>
                  ))}
                </div>

                <div>
                  {sekme === "genel" && (
                    <>
                      <div className="ev-alanlar">
                        <label className="ev-alan" htmlFor="evTed"><span>Tedarikçi</span><input id="evTed" list="evFirmaListesi" {...metin("tedarikci")} /></label>
                        <label className="ev-alan" htmlFor="evGb"><span>Garanti bitişi</span><input id="evGb" type="date" {...tarihAlan("garantiBitis")} /></label>
                        <label className="ev-alan" htmlFor="evAt"><span>Alış tarihi</span><input id="evAt" type="date" {...tarihAlan("alisTarihi")} /></label>
                        <label className="ev-alan" htmlFor="evGv"><span>Garanti veren</span><input id="evGv" list="evFirmaListesi" {...metin("garantiSaglayici")} /></label>
                        {maliyet && <label className="ev-alan" htmlFor="evAb"><span>Alış bedeli (₺)<small>KDV dahil</small></span><input id="evAb" type="number" min={0} step="0.01" {...sayi("alisBedeli")} /></label>}
                        <div className="ev-alan"><span>Garanti durumu</span><span className="ev-deger"><span className={`ev-rozet ${g.s}`}>{g.m}</span></span></div>
                        {maliyet && <label className="ev-alan" htmlFor="evEo"><span>Ekonomik ömür (ay)<small>Amortisman için</small></span><input id="evEo" type="number" min={0} max={600} {...sayi("ekonomikOmur")} /></label>}
                        {maliyet && (
                          <div className="ev-alan">
                            <span>Defter değeri</span>
                            <span className="ev-deger ev-sayi">{f.alisBedeli ? <><b>{tl(defterDegeri(f))}</b> <span className="ev-kucuk-not">· {ayGecen(f)} ay kullanıldı</span></> : <span className="ev-kucuk-not">Alış bedeli girilmemiş</span>}</span>
                          </div>
                        )}
                      </div>
                      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                        <label className="ev-tek" htmlFor="evGn" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--soluk)" }}>
                          Garanti notu
                          <textarea id="evGn" rows={2} {...metin("garantiNotu")} />
                        </label>
                        <label className="ev-tek" htmlFor="evNot" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--soluk)" }}>
                          Notlar
                          <textarea id="evNot" rows={3} placeholder="Kurulum bilgisi, bağlantı, şifre yeri değil" {...metin("notlar")} />
                        </label>
                      </div>
                    </>
                  )}

                  {sekme === "tamir" && v && <TamirSekmesi v={v} maliyet={maliyet} ac={(t) => setTamir(t)} />}
                  {sekme === "maliyet" && v && maliyet && <MaliyetSekmesi v={v} c={f} />}

                  {sekme === "bakim" && (
                    <>
                      <div className="ev-alanlar">
                        <label className="ev-alan" htmlFor="evBa"><span>Bakım aralığı (gün)<small>30 aylık · 90 üç aylık · 180 · 365 yıllık; boş = yok</small></span><input id="evBa" type="number" min={0} {...sayi("bakimAraligi")} /></label>
                        <label className="ev-alan" htmlFor="evBf"><span>Bakım firması</span><input id="evBf" list="evFirmaListesi" {...metin("bakimFirmasi")} /></label>
                        <label className="ev-alan" htmlFor="evSb"><span>Son bakım</span><input id="evSb" type="date" value={gunMetni(f.sonBakim)} onChange={(e) => {
                          const sb = e.target.value || null;
                          kaydet({ sonBakim: sb, ...(sb && f.bakimAraligi ? { sonrakiBakim: gunEkle(sb, f.bakimAraligi) } : {}) });
                        }} /></label>
                        <label className="ev-alan" htmlFor="evSrb"><span>Sonraki bakım{b?.s ? <small style={{ color: b.s === "kotu" ? "var(--kotu)" : "var(--uyari)" }}>{b.m}</small> : null}</span><input id="evSrb" type="date" {...tarihAlan("sonrakiBakim")} /></label>
                      </div>
                      <label className="ev-tek" htmlFor="evBn" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--soluk)", marginTop: 10 }}>
                        Bakım notu
                        <textarea id="evBn" rows={2} {...metin("bakimNotu")} />
                      </label>
                      <p className="ev-kucuk-not">Bakım kaydı girildiğinde son bakım tarihi yazılır, sonraki bakım aralığa göre hesaplanır.</p>
                      {maliyet && <div className="ev-satirac"><button className="ev-btn ana" onClick={() => setTamir({ tur: "bakim" })}>Bakım yapıldı</button></div>}
                    </>
                  )}

                  {sekme === "zimmet" && v && (
                    <>
                      <div className="ev-zaman">
                        {(v.konumlar.length ? v.konumlar : [{ id: 0, subeKodu: f.subeKodu, konum: f.konum, notu: "Kayıtlı geçmiş yok", yapanAdi: null, tarih: f.olusturma ?? "" }]).map((x, n) => (
                          <div key={x.id || n}>
                            <i style={{ ["--d" as any]: n === 0 ? "var(--yesil)" : "var(--cizgi2)" }} />
                            <span>
                              <b>{x.subeKodu}</b>{x.konum ? ` · ${x.konum}` : ""}
                              <small>{x.tarih ? tarih(x.tarih) : ""}{x.notu ? ` · ${x.notu}` : ""}{x.yapanAdi ? ` · ${x.yapanAdi}` : ""}{n === 0 ? " · şu an burada" : ""}</small>
                            </span>
                          </div>
                        ))}
                      </div>
                      {!erisim.sube && <div className="ev-satirac"><button className="ev-btn" onClick={() => setTasiAcik(true)}>Başka şubeye taşı</button></div>}
                    </>
                  )}

                  {sekme === "ariza" && v && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {v.arizalar.length ? (
                        <div className="ev-tablo">
                          <table>
                            <thead><tr><th>No</th><th>Arıza</th><th>Tarih</th><th>Durum</th><th>Servis formu</th>{maliyet && <th className="sag">Tutar</th>}</tr></thead>
                            <tbody>
                              {v.arizalar.map((a) => (
                                <tr key={a.id}>
                                  <td className="ev-mono">#{a.id}</td>
                                  <td>{a.baslik}{a.tur ? <div className="ev-kucuk-not">{a.tur}</div> : null}</td>
                                  <td>{tarih(a.olusturma)}</td>
                                  <td><span className={`ev-rozet ${a.durum === "cozuldu" || a.durum === "kapandi" ? "iyi" : "uyari"}`}>{ARIZA_DURUM[a.durum] ?? a.durum}</span></td>
                                  <td className="ev-mono">{a.formNo ?? "—"}</td>
                                  {maliyet && <td className="sag">{a.servisToplam != null ? tl(a.servisToplam) : "—"}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="ev-kucuk-not">Bu cihaz için arıza kaydı açılmamış.</p>
                      )}
                      <p className="ev-kucuk-not">Arıza kayıtları Arıza Kayıtları sayfasında yönetilir; kayıt kapatılırken doldurulan servis formu bu cihazın tamir geçmişine ve maliyetine eklenir.</p>
                    </div>
                  )}

                  {sekme === "gorsel" && v && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <button
                        type="button"
                        className={`ev-surukle${uzerinde ? " uzerinde" : ""}`}
                        disabled={yukleniyor}
                        onClick={() => gorselRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setUzerinde(true); }}
                        onDragLeave={() => setUzerinde(false)}
                        onDrop={(e) => { e.preventDefault(); setUzerinde(false); gorselYukle([...e.dataTransfer.files]); }}
                      >
                        {yukleniyor ? "Yükleniyor…" : "Fotoğraf sürükleyin ya da seçin"}
                        <small>Her oranda sığar; istediğinizi kapak yapın. Ctrl+V ile yapıştırabilirsiniz.</small>
                      </button>
                      {v.gorseller.length > 0 && (
                        <div className="ev-galeri">
                          {v.gorseller.map((x) => (
                            <figure key={x.id}>
                              <div className={`ev-kapak${f.kapakKirp && x.kapak ? " kirp" : ""}`}>
                                <div className="ev-bulanik" style={{ backgroundImage: `url('${gorselAdresi(x.id)}')` }} />
                                <img src={gorselAdresi(x.id)} alt={x.ozgunAd ?? ""} style={{ cursor: "zoom-in" }} onClick={() => setIsik(gorselAdresi(x.id))} />
                              </div>
                              <figcaption>
                                {x.kapak ? <span className="ev-rozet iyi">Kapak</span> : <button className="ev-btn kucuk" onClick={() => islem(() => api.gonder(`Envanter/Gorsel/${x.id}/Kapak`, {}), "Kapak değişti.")}>Kapak yap</button>}
                                <span className="ev-bos" />
                                <Popconfirm title="Görsel silinsin mi?" okText="Sil" cancelText="Vazgeç" onConfirm={() => islem(() => api.sil(`Envanter/Gorsel/${x.id}`))}>
                                  <button className="ev-btn kucuk tehlike" aria-label="Görseli sil">Sil</button>
                                </Popconfirm>
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      )}

                      <h4 style={{ margin: "6px 0 0" }}>Belgeler</h4>
                      <div className="ev-tablo">
                        <table>
                          <thead><tr><th>Belge</th><th>Tür</th><th>Ekleyen</th><th /></tr></thead>
                          <tbody>
                            {v.belgeler.length ? v.belgeler.map((x) => (
                              <tr key={x.id}>
                                <td>
                                  <a href="#" onClick={(e) => { e.preventDefault(); belgeAc(x.id).catch((h) => message.error(h.message)); }}>📄 {x.ozgunAd ?? "belge"}</a>
                                  <div className="ev-kucuk-not">{boyutMetni(x.boyut)}{x.tamirId ? " · tamir kaydına bağlı" : ""}</div>
                                </td>
                                <td>{x.tur}</td>
                                <td>{x.yukleyen}<div className="ev-kucuk-not">{tarih(x.olusturma)}</div></td>
                                <td className="sag">
                                  <Popconfirm title="Belge silinsin mi?" okText="Sil" cancelText="Vazgeç" onConfirm={() => islem(() => api.sil(`Envanter/Belge/${x.id}`))}>
                                    <button className="ev-btn kucuk tehlike">Sil</button>
                                  </Popconfirm>
                                </td>
                              </tr>
                            )) : (
                              <tr><td colSpan={4} className="ev-kucuk-not">Fatura, garanti belgesi, servis formu ekleyin.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="ev-satirac">
                        <label className="ev-sr" htmlFor="evBelgeTur">Belge türü</label>
                        <select id="evBelgeTur" value={belgeTur} onChange={(e) => setBelgeTur(e.target.value)}>
                          {BELGE_TURLERI.filter((x) => maliyet || x !== "Fatura").map((x) => <option key={x}>{x}</option>)}
                        </select>
                        <button className="ev-btn" disabled={yukleniyor} onClick={() => belgeRef.current?.click()}>+ Belge ekle</button>
                        <span className="ev-kucuk-not">PDF, resim, Word ya da Excel · en fazla 20 MB</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="ev-satirac" style={{ borderTop: "1px solid var(--cizgi)", paddingTop: 12 }}>
                  <span className="ev-kucuk-not">Demirbaş kaydı {f.olusturma ? tarih(f.olusturma) : ""} tarihinde açıldı.</span>
                  <span className="ev-bos" />
                  <Popconfirm
                    title="Cihaz silinsin mi?"
                    description="Arıza ya da tamir geçmişi varsa silinmez, kullanım dışı yapılır."
                    okText="Sil"
                    okButtonProps={{ danger: true }}
                    cancelText="Vazgeç"
                    onConfirm={async () => {
                      try {
                        const c = await api.sil<{ bilgi?: string }>(`Envanter/${id}`);
                        message.success(c?.bilgi ?? "Cihaz silindi.");
                        kapat();
                      } catch (h) {
                        message.error(h instanceof Error ? h.message : "Silinemedi.");
                      }
                    }}
                  >
                    <button className="ev-btn kucuk tehlike">Cihazı sil</button>
                  </Popconfirm>
                </div>
              </>
            )}
          </div>
        </div>

        {!yeni && v && <Akis v={v} sekme={akisSekme} setSekme={setAkisSekme} id={id!} islem={islem} />}
      </div>

      <input ref={gorselRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ""; gorselYukle(l); }} />
      <input ref={belgeRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" multiple hidden onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ""; belgeYukle(l); }} />

      {tamir && v && (
        <TamirPenceresi
          cihaz={v.cihaz}
          arizalar={v.arizalar}
          firmalar={secenekler.firmalar}
          belgeler={v.belgeler}
          acilis={tamir}
          kapat={() => setTamir(null)}
          kaydedildi={(a) => { al(a); setTamir(null); setSekme("tamir"); degisti(); }}
        />
      )}

      {tasiAcik && v && <TasiPenceresi c={f} subeler={secenekler.subeler} kapat={() => setTasiAcik(false)} tasi={(govde) => islem(() => api.gonder(`Envanter/${id}/Tasi`, govde), `${govde.subeKodu} şubesine taşındı.`).then(() => { setTasiAcik(false); setSekme("zimmet"); })} />}

      {arizaAcik && v && (
        <ArizaAc
          departmanlar={secenekler.departmanlar}
          turler={arizaTurleri}
          baslangic={{ subeKodu: f.subeKodu, envanterId: f.id, departmanId: f.departmanId }}
          kapat={() => setArizaAcik(false)}
          acildi={() => { setArizaAcik(false); setSekme("ariza"); oku(); degisti(); }}
        />
      )}

      {isik && (
        <div className="ev-isik" role="dialog" aria-label="Görsel" onClick={() => setIsik("")}>
          <img src={isik} alt="" />
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Tamir geçmişi: elle girilen kayıtlar ve servis formları bir arada          */

function TamirSekmesi({ v, maliyet, ac }: { v: Ayrinti; maliyet: boolean; ac: (t: TamirAcilis) => void }) {
  type Satir = { tarih: string; t?: Tamir; s?: Ayrinti["servisFormlari"][number] };
  const satirlar: Satir[] = [
    ...v.tamirler.map((t) => ({ tarih: gunMetni(t.tarih), t })),
    ...v.servisFormlari.map((s) => ({ tarih: gunMetni(s.olusturma), s })),
  ].sort((a, b) => b.tarih.localeCompare(a.tarih));

  const toplam = v.tamirler.reduce((a, t) => a + tamirNet(t), 0) + v.servisFormlari.reduce((a, s) => a + (s.toplam ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="ev-satirac">
        {maliyet && <button className="ev-btn ana" onClick={() => ac({})}>+ Tamir / bakım kaydı</button>}
        <span className="ev-bos" />
        <span className="ev-kucuk-not ev-sayi">{satirlar.length} kayıt{maliyet ? ` · ${tl(toplam)}` : ""}</span>
      </div>
      {satirlar.length ? (
        <div className="ev-tablo">
          <table className="ev-tamir">
            <thead>
              <tr>
                <th>Tarih</th>
                <th>İş</th>
                <th>Firma / yapan</th>
                <th>Kalemler</th>
                <th className="sag">Hizmet dışı</th>
                {maliyet && <th className="sag">Tutar</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {satirlar.map(({ t, s }) =>
                t ? (
                  <tr key={`t${t.id}`}>
                    <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{tarih(t.tarih)}</td>
                    <td style={{ verticalAlign: "top" }}>
                      <span className="ev-rozet" style={{ color: TT_RENK[t.tur], borderColor: "currentColor" }}>{TT_AD[t.tur] ?? t.tur}</span>
                      {t.asama && t.asama !== "tamamlandi" && (
                        <div style={{ marginTop: 4 }}>
                          <span className={`ev-asama-rozet ${t.asama}`}>
                            {ASAMA_IKON[t.asama]} {ASAMA_AD[t.asama]}
                            {t.asamaTarih ? ` · ${kisa(t.asamaTarih)}` : ""}
                          </span>
                        </div>
                      )}
                      {t.arizaId && <div className="ev-kucuk-not ev-mono" style={{ marginTop: 3 }}>#{t.arizaId} · {t.arizaBaslik}</div>}
                      {t.aciklama && <div style={{ marginTop: 3, fontSize: 12.5 }}>{t.aciklama}</div>}
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      {t.firma}
                      <div className="ev-kucuk-not">
                        {t.yapan === "ic" ? "İç ekip" : "Dış servis"}
                        {t.faturaNo ? <> · <span className="ev-mono">{t.faturaNo}</span></> : null}
                        {(() => {
                          const foto = v.belgeler.filter((b) => b.tamirId === t.id && (b.tur === "Fotoğraf" || resimMi(b.ozgunAd))).length;
                          const diger = t.belgeSayisi - foto;
                          return `${foto ? ` · 📷 ${foto}` : ""}${diger > 0 ? ` · 📎 ${diger}` : ""}`;
                        })()}
                      </div>
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      <div className="ev-kalemler">
                        {t.kalemler.map((k, n) => <span key={n}>{k.ad} · {k.adet}{maliyet ? ` × ${tl(k.birim)}` : ""}</span>)}
                      </div>
                    </td>
                    <td className="sag" style={{ verticalAlign: "top" }}>{t.gunDisi ? `${t.gunDisi} gün` : "—"}</td>
                    {maliyet && (
                      <td className="sag" style={{ verticalAlign: "top" }}>
                        {t.garantide ? (
                          <><span className="ev-ust-cizgi">{tl(t.toplam)}</span><br /><span className="ev-rozet iyi">Garantide</span></>
                        ) : (
                          <><b>{tl(t.toplam)}</b><div className="ev-kucuk-not">KDV %{t.kdv} dahil</div></>
                        )}
                      </td>
                    )}
                    <td className="sag" style={{ verticalAlign: "top" }}>
                      {maliyet && <button className="ev-btn kucuk" onClick={() => ac({ mevcut: t })}>Düzenle</button>}
                    </td>
                  </tr>
                ) : s ? (
                  <tr key={`s${s.id}`}>
                    <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{tarih(s.olusturma)}</td>
                    <td style={{ verticalAlign: "top" }}>
                      <span className="ev-rozet ev-servis">Servis formu</span>
                      {s.arizaId && <div className="ev-kucuk-not ev-mono" style={{ marginTop: 3 }}>#{s.arizaId} · {s.arizaBaslik}</div>}
                      {s.yapilanIslem && <div style={{ marginTop: 3, fontSize: 12.5 }}>{s.yapilanIslem}</div>}
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      {s.servisFirma || s.teknisyen || s.olusturanAdi}
                      <div className="ev-kucuk-not"><span className="ev-mono">{s.formNo}</span> · {s.mudahale === "uzaktan" ? "Uzaktan" : s.mudahale === "merkezde" ? "Merkezde" : "Yerinde"}</div>
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      {maliyet && <div className="ev-kalemler"><span>Parça · {tl(s.parcaTutari)}</span><span>İşçilik · {tl(s.iscilik)}</span></div>}
                    </td>
                    <td className="sag" style={{ verticalAlign: "top" }}>—</td>
                    {maliyet && <td className="sag" style={{ verticalAlign: "top" }}><b>{tl(s.toplam)}</b><div className="ev-kucuk-not">servis formundan</div></td>}
                    <td />
                  </tr>
                ) : null
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ev-bilgi-not">
          Henüz tamir ya da bakım kaydı yok. Servis geldiğinde parça, işçilik ve fatura bilgisini buraya girin; arıza kaydı kapatılırken
          doldurulan servis formları da burada görünür.
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Maliyet                                                                     */

function MaliyetSekmesi({ v, c }: { v: Ayrinti; c: Cihaz }) {
  const toplam = v.tamirler.reduce((a, t) => a + tamirNet(t), 0) + v.servisFormlari.reduce((a, s) => a + (s.toplam ?? 0), 0);
  const oran = c.alisBedeli ? toplam / c.alisBedeli : 0;
  const dd = defterDegeri(c);
  const yilSayisi = Math.max(1, ayGecen(c) / 12);

  /* Yıllara göre parça / işçilik / diğer */
  const yillar: Record<string, { p: number; i: number; d: number }> = {};
  const ekle = (y: string, k: "p" | "i" | "d", n: number) => {
    (yillar[y] ??= { p: 0, i: 0, d: 0 })[k] += n;
  };

  v.tamirler.forEach((t) => {
    if (t.garantide) return;
    const y = gunMetni(t.tarih).slice(0, 4);
    const kat = 1 + t.kdv / 100;
    t.kalemler.forEach((k) => ekle(y, k.tip === "parca" ? "p" : k.tip === "iscilik" ? "i" : "d", k.adet * (k.birim ?? 0) * kat));
  });
  v.servisFormlari.forEach((s) => {
    const y = gunMetni(s.olusturma).slice(0, 4);
    ekle(y, "p", s.parcaTutari ?? 0);
    ekle(y, "i", s.iscilik ?? 0);
  });

  const simdi = new Date().getFullYear();
  const ilk = Math.min(
    simdi,
    Number(gunMetni(c.alisTarihi).slice(0, 4)) || simdi,
    ...Object.keys(yillar).map(Number)
  );
  const ys: string[] = [];
  for (let y = Math.max(ilk, simdi - 9); y <= simdi; y++) ys.push(String(y));

  const enb = Math.max(1, ...ys.map((y) => { const x = yillar[y]; return x ? x.p + x.i + x.d : 0; }));
  const W = 640, H = 200, sol = 70, alt = 26, gen = (W - sol - 10) / ys.length;
  const olcek = (n: number) => (H - alt - 12) * (n / enb);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ev-kpi">
        <div><small>Alış bedeli</small><b>{c.alisBedeli ? tl(c.alisBedeli) : "—"}</b><em>{c.alisTarihi ? tarih(c.alisTarihi) : "tarih yok"}</em></div>
        <div><small>Tamir + bakım</small><b>{tl(toplam)}</b><em>{v.tamirler.length + v.servisFormlari.length} kayıt{c.alisBedeli ? ` · alışın %${Math.round(oran * 100)}'i` : ""}</em></div>
        <div><small>Toplam sahip olma</small><b>{tl((c.alisBedeli ?? 0) + toplam)}</b><em>yıllık ort. {tl(((c.alisBedeli ?? 0) + toplam) / yilSayisi)}</em></div>
        <div><small>Defter değeri</small><b>{c.alisBedeli ? tl(dd) : "—"}</b><em>{c.ekonomikOmur ?? 60} ay ömür, doğrusal</em></div>
      </div>
      {oran > 0.3 && (
        <div className="ev-uyarikutu">
          <span>♻️</span>
          <span>Tamir gideri alış bedelinin <b>%{Math.round(oran * 100)}</b>'ine ulaştı{dd < toplam ? " ve defter değerini geçti" : ""}. Yenileme düşünülebilir.</span>
        </div>
      )}
      {!c.alisBedeli && <div className="ev-bilgi-not">Alış bedeli girilmemiş: Satın alma ve garanti sekmesinden girerseniz defter değeri ve oranlar hesaplanır.</div>}
      <div className="ev-panel" style={{ padding: 12 }}>
        <h3 style={{ fontSize: 13.5 }}>
          Yıllara göre tamir ve bakım gideri
          <span className="ev-bos" />
          <span className="ev-lejant">
            <span><i style={{ background: "var(--yesil)" }} />Parça</span>
            <span><i style={{ background: "var(--bilgi)" }} />İşçilik</span>
            <span><i style={{ background: "var(--uyari)" }} />Diğer</span>
          </span>
        </h3>
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 420, maxWidth: 720, display: "block" }} role="img" aria-label="Yıllara göre gider">
            {[0, 0.5, 1].map((r) => {
              const y = H - alt - (H - alt - 12) * r;
              return (
                <g key={r}>
                  <line x1={sol} x2={W - 6} y1={y} y2={y} stroke="var(--cizgi)" />
                  <text x={sol - 8} y={y + 4} fontSize="11" textAnchor="end" fill="var(--soluk)">{tl(enb * r)}</text>
                </g>
              );
            })}
            {ys.map((y, n) => {
              const x = sol + n * gen + gen * 0.22;
              const w = gen * 0.56;
              const d = yillar[y] ?? { p: 0, i: 0, d: 0 };
              let yy = H - alt;
              const parcalar = ([["p", "var(--yesil)", "Parça"], ["i", "var(--bilgi)", "İşçilik"], ["d", "var(--uyari)", "Diğer"]] as const).map(([k, r, ad]) => {
                const h = olcek(d[k]);
                yy -= h;
                return h > 0 ? <rect key={k} x={x} y={yy} width={w} height={h} fill={r} rx={2}><title>{`${y} ${ad}: ${tl(d[k])}`}</title></rect> : null;
              });
              return (
                <g key={y}>
                  {parcalar}
                  <text x={x + w / 2} y={H - 8} fontSize="11" textAnchor="middle" fill="var(--soluk)">{y}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Not, aktivite ve geçmiş                                                     */

function Akis({
  v, sekme, setSekme, id, islem,
}: {
  v: Ayrinti;
  sekme: "not" | "akt";
  setSekme: (s: "not" | "akt") => void;
  id: number;
  islem: (fn: () => Promise<unknown>, basari?: string) => Promise<void>;
}) {
  const [not, setNot] = useState("");
  const [aktTur, setAktTur] = useState<"bakim" | "ara" | "yap">("yap");
  const [aktTarih, setAktTarih] = useState(gunEkle(BUGUN(), 7));
  const [aktOzet, setAktOzet] = useState("");
  const [aktKim, setAktKim] = useState("");

  return (
    <aside className="ev-akis" aria-label="Notlar ve aktiviteler">
      <div className="ev-bas">
        <button className="ev-btn kucuk" aria-pressed={sekme === "not"} onClick={() => setSekme("not")}>Not yaz</button>
        <button className="ev-btn kucuk" aria-pressed={sekme === "akt"} onClick={() => setSekme("akt")}>Aktivite planla</button>
        <span className="ev-bos" />
        <span className="ev-kucuk-not">📎 {v.belgeler.length}</span>
      </div>

      {sekme === "not" ? (
        <form
          className="ev-yazkutu"
          onSubmit={(e) => {
            e.preventDefault();
            if (!not.trim()) return;
            islem(() => api.gonder(`Envanter/${id}/Not`, { metin: not.trim() }), "Not eklendi.").then(() => setNot(""));
          }}
        >
          <label className="ev-sr" htmlFor="evNotMetin">Not</label>
          <textarea id="evNotMetin" value={not} placeholder="Servisle konuşulan, şubeden gelen bilgi, karar…" onChange={(e) => setNot(e.target.value)} />
          <div className="ev-satirac">
            <button className="ev-btn ana kucuk" disabled={!not.trim()}>Kaydet</button>
            <span className="ev-kucuk-not">Notlar yalnızca portalda görünür.</span>
          </div>
        </form>
      ) : (
        <form
          className="ev-yazkutu"
          onSubmit={(e) => {
            e.preventDefault();
            if (!aktOzet.trim()) return message.warning("Aktivitenin özetini yazınız.");
            islem(() => api.gonder(`Envanter/${id}/Aktivite`, { tur: aktTur, tarih: aktTarih, ozet: aktOzet.trim(), atanan: aktKim.trim() || null }), "Aktivite planlandı.")
              .then(() => { setAktOzet(""); setSekme("not"); });
          }}
        >
          <div className="ev-ikili">
            <label>
              Tür
              <select value={aktTur} onChange={(e) => setAktTur(e.target.value as any)}>
                <option value="yap">Yapılacak</option>
                <option value="bakim">Bakım</option>
                <option value="ara">Arama</option>
              </select>
            </label>
            <label>
              Tarih
              <input type="date" value={aktTarih} onChange={(e) => setAktTarih(e.target.value)} />
            </label>
          </div>
          <div className="ev-tek">
            <label>
              Özet
              <input value={aktOzet} placeholder="Örn. Servisten teklif al" maxLength={300} onChange={(e) => setAktOzet(e.target.value)} />
            </label>
          </div>
          <div className="ev-ikili">
            <label>
              Kime
              <input value={aktKim} placeholder="İsteğe bağlı" maxLength={150} onChange={(e) => setAktKim(e.target.value)} />
            </label>
            <span style={{ alignSelf: "end" }}><button className="ev-btn ana kucuk">Planla</button></span>
          </div>
        </form>
      )}

      {v.aktiviteler.length > 0 && (
        <div className="ev-aktivite">
          <h5>Planlanan aktiviteler</h5>
          {v.aktiviteler.map((a) => {
            const fark = Math.round((new Date(`${gunMetni(a.tarih)}T00:00:00`).getTime() - new Date(`${BUGUN()}T00:00:00`).getTime()) / 864e5);
            const [s, r] = AKT[a.tur] ?? AKT.yap;
            return (
              <div key={a.id} className="ev-akt">
                <span className="ev-simge" style={{ ["--d" as any]: r }}>{s}</span>
                <span>
                  <b style={{ fontSize: 13 }}>{a.ozet}</b>
                  <small>
                    <span className={fark < 0 ? "ev-gec" : ""}>{fark < 0 ? `${-fark} gün gecikti` : fark === 0 ? "Bugün" : `${fark} gün sonra`}</span>
                    {a.atanan ? ` · ${a.atanan}` : ""}
                  </small>
                </span>
                <button className="ev-btn kucuk" onClick={() => islem(() => api.gonder(`Envanter/Aktivite/${a.id}/Bitti`, {}), "Aktivite tamamlandı.")}>Bitti</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="ev-gecmis">
        <h5>Geçmiş</h5>
        {v.hareketler.length === 0 && <span className="ev-kucuk-not">Henüz kayıt yok.</span>}
        {v.hareketler.map((m) => {
          const ad = m.yapanAdi ?? "Sistem";
          const bas = ad.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toLocaleUpperCase("tr")).join("");
          return (
            <div key={m.id} className={`ev-mesaj ${m.tur === "not" ? "notm" : "log"}`}>
              <span className="ev-av" style={{ ["--a" as any]: renkSec(ad) }} title={ad}>{bas || "?"}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ev-ust"><b>{ad}</b> · {zaman(m.tarih)}{m.tur === "not" ? " · not" : ""}</div>
                <p>{m.metin}</p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* ========================================================================== */
/* Şubeye taşı                                                                 */

function TasiPenceresi({
  c, subeler, kapat, tasi,
}: {
  c: Cihaz;
  subeler: string[];
  kapat: () => void;
  tasi: (g: { subeKodu: string; konum: string | null; notu: string | null }) => void;
}) {
  const [sube, setSube] = useState(subeler.find((s) => s !== c.subeKodu) ?? "");
  const [konum, setKonum] = useState("");
  const [notu, setNotu] = useState("");

  return (
    <Modal
      open
      width={460}
      rootClassName="ev"
      title="Şubeye taşı"
      onCancel={kapat}
      okText="Taşı"
      cancelText="Vazgeç"
      okButtonProps={{ disabled: !sube }}
      onOk={() => tasi({ subeKodu: sube, konum: konum.trim() || null, notu: notu.trim() || null })}
    >
      <div className="ev-modal-ic">
        <span className="ev-kucuk-not">{cihazAdi(c)} · şu an <b>{c.subeKodu}</b>{c.konum ? ` / ${c.konum}` : ""}</span>
        <div className="ev-tek">
          <label>
            Yeni şube
            <select value={sube} onChange={(e) => setSube(e.target.value)}>
              {subeler.filter((s) => s !== c.subeKodu).map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div className="ev-tek"><label>Konum<input value={konum} placeholder="Örn. Kasa 2, depo" onChange={(e) => setKonum(e.target.value)} /></label></div>
        <div className="ev-tek"><label>Not<input value={notu} placeholder="Neden taşındı" onChange={(e) => setNotu(e.target.value)} /></label></div>
      </div>
    </Modal>
  );
}
