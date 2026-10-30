/**
 * Hukuk masası (24.10.2026)
 * ---------------------------------------------------------------------------
 * İK ile ilgili dava ve hukuki süreçlerin takibi: masa (özet ve haftalık
 * ajanda), dosyalar, dosya sayfası, ajanda, resmi yazışma ve yetkiler.
 *
 * İK panelinde menüdeki "Hukuk masası" olarak açılır. Dış hukuk danışmanı
 * (rol HukukDanisman) panele girdiğinde yalnız bu ekran, kendi kenar
 * menüsüyle gösterilir; sunucu da bu rolü /api/Hukuk dışına kapatır.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DatePicker, Input, Select, Spin } from "antd";
import {
  CalendarDays, FileStack, FolderPlus, Inbox, Landmark, LayoutDashboard, LogOut, PenLine, Scale, Search, ShieldCheck,
} from "lucide-react";
import dayjs from "dayjs";
import "dayjs/locale/tr";
import { api, LOGO_ADRESI } from "./api";
import {
  Avatar, Ben, Dosya, OLAY_RENK, Risk, TUR_RENK, YaziOzet, kalan, tarihYaz,
} from "./hukukOrtak";
import PostaKutusu from "./HukukYazisma";
import DosyaSayfasi, { DosyaFormu } from "./HukukDosya";
import HukukYetkiler from "./HukukYetkiler";
import { IcraBen, IcraDosyaFormu, IcraDosyaSayfasi, IcraOzetKarti, IcraSayfasi } from "./HukukIcra";
import "./HukukMasasi.css";

dayjs.locale("tr");

interface AjandaKaydi {
  kaynak: "olay" | "yazi"; id: number; dosyaId: number | null; tur: string; turAdi: string; tarih: string; baslik: string;
  aciklama: string | null; tamam: boolean; dosyaNo: string | null; davaciAd: string | null; esasNo: string | null;
  mahkeme: string | null; dosyaTurAdi: string | null;
}
interface MasaOzet {
  acik: number; turler: { tur: string; ad: string; adet: number }[]; hafta: number; bugun: number; kesinBugun: number;
  arabuluculuk: number; yanitBekleyen: number; okunmamis: number; buYilSonuclanan: number; buYilLehe: number;
}
interface DosyaSatir { dosya: Dosya; vekiller: string[] }

type Gorunum = { ad: "masa" | "dosyalar" | "ajanda" | "yazisma" | "yetkiler" | "icra" } | { ad: "dosya"; id: number } | { ad: "icraDosya"; id: number };

/* ------------------------------------------------------------------ */

function DosyaTablosu({ l, ac }: { l: DosyaSatir[]; ac: (id: number) => void }) {
  return (
    <div className="hk-tablo"><table>
      <thead><tr><th>Dosya</th><th>Taraf</th><th>Mahkeme · esas</th><th>Sıradaki iş</th><th>Risk</th><th>Vekil</th></tr></thead>
      <tbody>{l.map(({ dosya: d, vekiller }) => (
        <tr key={d.id} onClick={() => ac(d.id)}>
          <td><span className={"hk-etiket " + (TUR_RENK[d.tur] ?? "e-gri")}>{d.turAdi}</span><br /><small className="mono">{d.dosyaNo}</small></td>
          <td><span className="ad">{d.davaciAd}</span><small>{[d.gorev, d.sube].filter(Boolean).join(" · ")}</small></td>
          <td>{d.mahkeme ?? "—"}<br /><small className="mono">{d.esasNo ?? ""}</small></td>
          <td>{d.durum === "kapandi" ? <span className="hk-etiket e-gri">Kapandı</span> : d.sonraki ? (
            <><span className={"hk-etiket " + (OLAY_RENK[d.sonraki.tur] ?? "e-gri")}>{d.sonraki.turAdi}</span>{" "}
              <span className="hk-sayac" style={{ color: kalan(d.sonraki.tarih).renk }}>{kalan(d.sonraki.tarih).metin}</span>
              <br /><small>{tarihYaz(d.sonraki.tarih, true)}</small></>
          ) : <small>—</small>}</td>
          <td><Risk d={d.risk} /></td>
          <td><small>{vekiller.join(", ") || "—"}</small></td>
        </tr>))}
      </tbody>
    </table></div>
  );
}

/* ------------------------------------------------------------------ */

function Masa({ ben, git, yaziAc, yeniDosya, icraVar }: { ben: Ben; git: (g: Gorunum) => void; yaziAc: (id: number) => void; yeniDosya: () => void; icraVar: boolean }) {
  const [o, setO] = useState<MasaOzet | null>(null);
  const [ajanda, setAjanda] = useState<AjandaKaydi[]>([]);
  const [yazilar, setYazilar] = useState<YaziOzet[]>([]);
  const [dosyalar, setDosyalar] = useState<DosyaSatir[]>([]);

  useEffect(() => {
    const b = dayjs().format("YYYY-MM-DD"), e = dayjs().add(6, "day").format("YYYY-MM-DD");
    api.al<MasaOzet>("/api/Hukuk/Masa").then(setO).catch(() => {});
    api.al<{ olaylar: AjandaKaydi[] }>(`/api/Hukuk/Ajanda?bas=${b}&bit=${e}`).then((d) => setAjanda(d.olaylar)).catch(() => {});
    api.al<{ yazilar: YaziOzet[] }>("/api/Hukuk/Yazilar?klasor=gelen").then((d) => setYazilar(d.yazilar.slice(0, 6))).catch(() => {});
    api.al<{ dosyalar: DosyaSatir[] }>("/api/Hukuk/Dosyalar?durum=acik").then((d) => setDosyalar(d.dosyalar.slice(0, 8))).catch(() => {});
  }, []);

  const gunler = Array.from({ length: 7 }, (_, i) => dayjs().add(i, "day"));
  const saat = dayjs().hour();
  const selam = saat < 12 ? "Günaydın" : saat < 18 ? "İyi günler" : "İyi akşamlar";

  return (
    <>
      <div className="hk-ph">
        <div>
          <h1>{selam}, {ben.ad.split(" ").filter((x) => !/\.$/.test(x))[0]}</h1>
          <p>{dayjs().format("D MMMM YYYY, dddd")} · {o ? (o.bugun > 0 ? `bugün ${o.bugun} iş var${o.kesinBugun ? `, ${o.kesinBugun} kesin süre doluyor` : ""}` : "bugün bekleyen iş yok") : "…"}</p>
        </div>
        <div className="sag">
          {ben.yetki === "tam" && <button className="hk-btn" onClick={yeniDosya}><FolderPlus /> Yeni dosya</button>}
          {ben.yetki !== "okuma" && <button className="hk-btn koyu" onClick={() => git({ ad: "yazisma" })}><PenLine /> Resmi yazı</button>}
        </div>
      </div>

      <div className="hk-kpi">
        <div className="vurgu"><small>Açık dosya</small><b>{o?.acik ?? "–"}</b>
          <span>{o?.turler.map((t) => `${t.adet} ${t.ad.toLocaleLowerCase("tr")}`).slice(0, 2).join(" · ") || "—"}</span></div>
        <div><small>Bu hafta</small><b>{o?.hafta ?? "–"}</b><span>duruşma ve süre</span></div>
        <div><small>Bugün kesin süre</small><b style={{ color: o?.kesinBugun ? "var(--kir)" : undefined }}>{o?.kesinBugun ?? "–"}</b><span>kaçırılmaması gereken</span></div>
        <div><small>Yanıt bekleyen yazı</small><b>{o?.yanitBekleyen ?? "–"}</b><span>{o?.okunmamis ? `${o.okunmamis} okunmamış` : "okunmamış yok"}</span></div>
        <div><small>Bu yıl sonuçlanan</small><b>{o?.buYilSonuclanan ?? "–"}</b><span>{o?.buYilLehe ?? 0} lehe / sulh</span></div>
      </div>

      <div className="hk-izg">
        <div className="hk-pk">
          <h3>Bu hafta <a onClick={() => git({ ad: "ajanda" })}>Ajanda</a></h3>
          <div className="hk-hafta">
            {gunler.map((g, i) => {
              const l = ajanda.filter((x) => dayjs(x.tarih).isSame(g, "day") && !x.tamam);
              return (
                <div key={i} className={"hk-hgun" + (i === 0 ? " bugun" : "")}>
                  <div className="gb">{g.format("ddd")}<b>{g.format("D")}</b></div>
                  {l.map((x) => (
                    <div key={x.kaynak + x.id} className={"o " + (OLAY_RENK[x.tur] ?? "e-gri")}
                      onClick={() => x.kaynak === "yazi" ? yaziAc(x.id) : x.dosyaId && git({ ad: "dosya", id: x.dosyaId })}>
                      {x.tur === "durusma" || x.tur === "arabuluculuk" ? dayjs(x.tarih).format("HH:mm") + " " : ""}{x.turAdi}
                      <br /><span style={{ fontWeight: 500 }}>{x.davaciAd ?? x.baslik}</span>
                    </div>
                  ))}
                  {l.length === 0 && <span className="bos">—</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="hk-pk" style={{ paddingBottom: 6 }}>
          <h3>Gelen yazılar <a onClick={() => git({ ad: "yazisma" })}>Tümü</a></h3>
          {yazilar.length === 0 && <small style={{ color: "var(--s)" }}>Gelen yazı yok.</small>}
          {yazilar.map((y) => (
            <div key={y.id} className="hk-yo" onClick={() => yaziAc(y.id)}>
              <Avatar ad={y.gonderenAd} />
              <div style={{ minWidth: 0 }}>
                <b>{y.okunmadi && <span className="hk-nokta" />}{y.gonderenAd}</b>
                <div className="konu">{y.konu}</div>
                <small>{y.dosyaNo ? `${y.dosyaNo} · ` : ""}{y.ozet}</small>
              </div>
              <time>{dayjs(y.tarih).format("DD.MM")}</time>
            </div>
          ))}
        </div>
      </div>

      {/* İcra / maaş haczi özeti (30.10.2026): yalnız icra yetkisi olana; danışman görmez */}
      <div className={icraVar ? "hk-izg" : undefined}>
        <div className="hk-pk">
          <h3>Açık dosyalar <a onClick={() => git({ ad: "dosyalar" })}>Tüm dosyalar</a></h3>
          {dosyalar.length === 0 ? <div className="hk-bos"><Scale /><b>Açık dosya yok</b></div>
            : <DosyaTablosu l={dosyalar} ac={(id) => git({ ad: "dosya", id })} />}
        </div>
        {icraVar && <IcraOzetKarti git={() => git({ ad: "icra" })} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Dosyalar({ ben, ac, yeniDosya, surum }: { ben: Ben; ac: (id: number) => void; yeniDosya: () => void; surum: number }) {
  const [durum, setDurum] = useState("acik");
  const [tur, setTur] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [v, setV] = useState<{ dosyalar: DosyaSatir[]; sayilar: { acik: number; kapandi: number } } | null>(null);
  /* Ek süzgeçler (30.10.2026): avukat, şube, dava tarihi aralığı; sunucudan gelen liste üzerinde */
  const [vekil, setVekil] = useState<string | undefined>();
  const [sube, setSube] = useState<string | undefined>();
  const [aralik, setAralik] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [risk, setRisk] = useState<number | undefined>();
  const vekiller = useMemo(() => [...new Set((v?.dosyalar ?? []).flatMap((x) => [...x.vekiller, x.dosya.karsiVekil ?? ""]).filter(Boolean))].sort(), [v]);
  const subeler = useMemo(() => [...new Set((v?.dosyalar ?? []).map((x) => x.dosya.sube ?? "").filter(Boolean))].sort(), [v]);
  const suzulmus = useMemo(() => (v?.dosyalar ?? []).filter((x) =>
    (!vekil || x.vekiller.includes(vekil) || x.dosya.karsiVekil === vekil)
    && (!sube || x.dosya.sube === sube)
    && (risk === undefined || x.dosya.risk === risk)
    && (!aralik?.[0] || (x.dosya.davaTarihi && !dayjs(x.dosya.davaTarihi).isBefore(aralik[0], "day")))
    && (!aralik?.[1] || (x.dosya.davaTarihi && !dayjs(x.dosya.davaTarihi).isAfter(aralik[1], "day")))), [v, vekil, sube, risk, aralik]);

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ durum });
      if (tur) p.set("tur", tur);
      if (q.trim()) p.set("q", q.trim());
      api.al<any>(`/api/Hukuk/Dosyalar?${p}`).then(setV).catch(() => setV({ dosyalar: [], sayilar: { acik: 0, kapandi: 0 } }));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [durum, tur, q, surum]);

  return (
    <>
      <div className="hk-ph">
        <div><h1>Dosyalar</h1><p>Davalar, arabuluculuk başvuruları, ihtarnameler ve diğer süreçler</p></div>
        {ben.yetki === "tam" && <div className="sag"><button className="hk-btn koyu" onClick={yeniDosya}><FolderPlus /> Yeni dosya</button></div>}
      </div>
      <div className="hk-filtre">
        <div className="hk-seg">
          <button className={durum === "acik" ? "on" : ""} onClick={() => setDurum("acik")}>Açık<em>{v?.sayilar.acik ?? ""}</em></button>
          <button className={durum === "kapandi" ? "on" : ""} onClick={() => setDurum("kapandi")}>Kapanan<em>{v?.sayilar.kapandi ?? ""}</em></button>
          <button className={durum === "hepsi" ? "on" : ""} onClick={() => setDurum("hepsi")}>Tümü</button>
        </div>
        <Select allowClear placeholder="Tüm türler" value={tur} onChange={setTur} style={{ width: 190 }}
          options={ben.turler.map((t) => ({ value: t.kod, label: t.ad }))} />
        <Input prefix={<Search size={15} color="#9a9eab" />} placeholder="Taraf, esas no, mahkeme, şube" value={q}
          onChange={(e) => setQ(e.target.value)} allowClear style={{ maxWidth: 320 }} />
        <Select allowClear showSearch placeholder="Avukat / vekil" value={vekil} onChange={setVekil} style={{ width: 190 }} options={vekiller.map((x) => ({ value: x, label: x }))} />
        <Select allowClear showSearch placeholder="Şube" value={sube} onChange={setSube} style={{ width: 170 }} options={subeler.map((x) => ({ value: x, label: x }))} />
        <Select allowClear placeholder="Risk" value={risk} onChange={setRisk} style={{ width: 110 }} options={[{ value: 1, label: "Düşük" }, { value: 2, label: "Orta" }, { value: 3, label: "Yüksek" }]} />
        <DatePicker.RangePicker value={aralik as any} onChange={(r) => setAralik(r as any)} format="DD.MM.YYYY" placeholder={["Dava başlangıç", "bitiş"]} allowEmpty={[true, true]} />
        {v && suzulmus.length !== v.dosyalar.length && <small style={{ color: "var(--s)" }}>{suzulmus.length} / {v.dosyalar.length} dosya</small>}
      </div>
      <div className="hk-pk">
        {v === null ? <div className="hk-bos"><Spin /></div> : suzulmus.length === 0
          ? <div className="hk-bos"><Scale /><b>Dosya bulunamadı</b>{ben.danisman ? "Size erişim verilen dosya yok." : "Filtreyi değiştirin ya da yeni dosya açın."}</div>
          : <DosyaTablosu l={suzulmus} ac={ac} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Ajanda({ git, yaziAc }: { git: (g: Gorunum) => void; yaziAc: (id: number) => void }) {
  const [l, setL] = useState<AjandaKaydi[] | null>(null);
  const [gun, setGun] = useState(45);
  useEffect(() => {
    const b = dayjs().subtract(1, "day").format("YYYY-MM-DD"), e = dayjs().add(gun, "day").format("YYYY-MM-DD");
    api.al<{ olaylar: AjandaKaydi[] }>(`/api/Hukuk/Ajanda?bas=${b}&bit=${e}`).then((d) => setL(d.olaylar)).catch(() => setL([]));
  }, [gun]);
  const gruplar = useMemo(() => {
    const m = new Map<string, AjandaKaydi[]>();
    (l ?? []).forEach((x) => { const k = dayjs(x.tarih).format("YYYY-MM-DD"); m.set(k, [...(m.get(k) ?? []), x]); });
    return [...m.entries()];
  }, [l]);

  return (
    <>
      <div className="hk-ph">
        <div><h1>Ajanda</h1><p>Duruşmalar, kesin süreler, arabuluculuk toplantıları ve yazı cevap süreleri</p></div>
        <div className="sag">
          <div className="hk-seg">
            {[14, 45, 90].map((g) => <button key={g} className={gun === g ? "on" : ""} onClick={() => setGun(g)}>{g} gün</button>)}
          </div>
        </div>
      </div>
      <div className="hk-pk">
        {l === null ? <div className="hk-bos"><Spin /></div> : gruplar.length === 0 ? <div className="hk-bos"><CalendarDays /><b>Bu aralıkta kayıt yok</b></div> : (
          gruplar.map(([k, isler]) => {
            const g = dayjs(k);
            return (
              <div key={k} className={"hk-ajgun" + (g.isSame(dayjs(), "day") ? " bugun" : "")}>
                <div className="tar"><b>{g.format("D")}</b><span>{g.format("MMM ddd")}</span></div>
                <div className="isler">
                  {isler.map((x) => (
                    <div key={x.kaynak + x.id} className="hk-olay" style={{ opacity: x.tamam ? .55 : 1 }}
                      onClick={() => x.kaynak === "yazi" ? yaziAc(x.id) : x.dosyaId && git({ ad: "dosya", id: x.dosyaId })}>
                      <span className="saat">{x.tur === "durusma" || x.tur === "arabuluculuk" ? dayjs(x.tarih).format("HH:mm") : "—"}</span>
                      <span className={"hk-etiket " + (OLAY_RENK[x.tur] ?? "e-gri")}>{x.turAdi}</span>
                      <div><b>{x.baslik}</b><small>{[x.dosyaNo, x.davaciAd, x.mahkeme, x.esasNo].filter(Boolean).join(" · ")}</small></div>
                      {x.tamam ? <span className="hk-etiket e-yes">Tamamlandı</span>
                        : <span className="hk-sayac" style={{ color: kalan(x.tarih).renk }}>{kalan(x.tarih).metin}</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

export default function HukukMasasi({ bagimsiz = false, cikis }: { bagimsiz?: boolean; cikis?: () => void }) {
  const [ben, setBen] = useState<Ben | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [g, setG] = useState<Gorunum>({ ad: "masa" });
  const [onceki, setOnceki] = useState<Gorunum>({ ad: "dosyalar" });
  const [yazi, setYazi] = useState<number | null>(null);
  const [yeniDosya, setYeniDosya] = useState(false);
  const [surum, setSurum] = useState(0);
  const [okunmamis, setOkunmamis] = useState(0);
  const [dosyaSecenek, setDosyaSecenek] = useState<{ id: number; ad: string }[]>([]);
  /* İcra / maaş haczi (30.10.2026): yetkisi sunucudan; danışmana hiç sorulmaz */
  const [icraBen, setIcraBen] = useState<IcraBen | null>(null);
  const [yeniIcra, setYeniIcra] = useState(false);

  useEffect(() => {
    api.al<Ben>("/api/Hukuk/Ben").then((b) => b.yetkili ? setBen(b) : setHata("Hukuk masasına erişiminiz yok.")).catch((e) => setHata(e.message));
  }, []);
  useEffect(() => {
    if (!ben || ben.danisman) return;
    api.al<IcraBen>("/api/Hukuk/Icra/Ben").then((b) => setIcraBen(b.yetkili ? b : null)).catch(() => setIcraBen(null));
  }, [ben]);
  const sayac = useCallback(() => {
    api.al<{ okunmamis: number }>("/api/Hukuk/Masa").then((d) => setOkunmamis(d.okunmamis ?? 0)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!ben) return;
    sayac();
    api.al<{ dosyalar: DosyaSatir[] }>("/api/Hukuk/Dosyalar?durum=hepsi")
      .then((d) => setDosyaSecenek(d.dosyalar.map((x) => ({ id: x.dosya.id, ad: `${x.dosya.dosyaNo} · ${x.dosya.davaciAd}` })))).catch(() => {});
    const t = setInterval(sayac, 60000);
    return () => clearInterval(t);
  }, [ben, surum, sayac]);

  const git = (y: Gorunum) => {
    if ((y.ad === "dosya" || y.ad === "icraDosya") && g.ad !== "dosya" && g.ad !== "icraDosya") setOnceki(g);
    if (y.ad !== "yazisma") setYazi(null);
    setG(y);
    window.scrollTo?.({ top: 0 });
  };
  const yaziAc = (id: number) => { setYazi(id); setG({ ad: "yazisma" }); };

  if (hata) return <div className="hk" style={{ padding: 40 }}><div className="hk-bos"><Scale /><b>Hukuk masası</b>{hata}
    {bagimsiz && cikis && <button className="hk-btn" onClick={cikis}><LogOut /> Çıkış</button>}</div></div>;
  if (!ben) return <div className="hk" style={{ padding: 40 }}><div className="hk-bos"><Spin /></div></div>;

  const menu: { ad: Gorunum["ad"]; etiket: string; ikon: any; em?: number }[] = [
    { ad: "masa", etiket: "Masa", ikon: LayoutDashboard },
    { ad: "dosyalar", etiket: "Dosyalar", ikon: FileStack },
    { ad: "ajanda", etiket: "Ajanda", ikon: CalendarDays },
    { ad: "yazisma", etiket: "Resmi yazışma", ikon: Inbox, em: okunmamis },
    ...(icraBen ? [{ ad: "icra" as const, etiket: "İcra / haciz", ikon: Landmark }] : []),
    ...(!ben.danisman ? [{ ad: "yetkiler" as const, etiket: "Yetkiler", ikon: ShieldCheck }] : []),
  ];
  const aktif = g.ad === "dosya" ? "dosyalar" : g.ad === "icraDosya" ? "icra" : g.ad;

  const icerik = (
    <div className="hk-ana">
      {g.ad === "masa" && <Masa ben={ben} git={git} yaziAc={yaziAc} yeniDosya={() => setYeniDosya(true)} icraVar={!!icraBen} />}
      {g.ad === "icra" && icraBen && <IcraSayfasi icraBen={icraBen} ac={(id) => git({ ad: "icraDosya", id })} surum={surum} yeniDosya={() => setYeniIcra(true)} />}
      {g.ad === "icraDosya" && icraBen && <IcraDosyaSayfasi key={g.id} id={g.id} icraBen={icraBen} geri={() => git({ ad: "icra" })} degisti={() => setSurum((s) => s + 1)} />}
      {g.ad === "dosyalar" && <Dosyalar ben={ben} ac={(id) => git({ ad: "dosya", id })} yeniDosya={() => setYeniDosya(true)} surum={surum} />}
      {g.ad === "dosya" && <DosyaSayfasi key={g.id} id={g.id} ben={ben} geri={() => git(onceki.ad === "dosya" ? { ad: "dosyalar" } : onceki)}
        yaziAc={yaziAc} dosyalar={dosyaSecenek} degisti={() => setSurum((s) => s + 1)} />}
      {g.ad === "ajanda" && <Ajanda git={git} yaziAc={yaziAc} />}
      {g.ad === "yazisma" && <PostaKutusu ben={ben} acilacak={yazi} dosyaAc={(id) => git({ ad: "dosya", id })} dosyalar={dosyaSecenek} sayacYenile={sayac} />}
      {g.ad === "yetkiler" && <HukukYetkiler ben={ben} dosyaAc={(id) => git({ ad: "dosya", id })} />}
      <DosyaFormu ben={ben} acik={yeniDosya} kapat={() => setYeniDosya(false)}
        kaydedildi={(id) => { setYeniDosya(false); setSurum((s) => s + 1); git({ ad: "dosya", id }); }} />
      {icraBen && <IcraDosyaFormu icraBen={icraBen} acik={yeniIcra} kapat={() => setYeniIcra(false)}
        kaydedildi={(id) => { setYeniIcra(false); setSurum((s) => s + 1); git({ ad: "icraDosya", id }); }} />}
    </div>
  );

  if (bagimsiz) {
    return (
      <div className="hk hk-tam">
        <aside className="hk-yan">
          <div className="logo"><img src={LOGO_ADRESI} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} /> Hukuk Masası</div>
          <div className="bolum">Çalışma alanı</div>
          {menu.map((m) => {
            const I = m.ikon;
            return <button key={m.ad} className={aktif === m.ad ? "on" : ""} onClick={() => git({ ad: m.ad } as Gorunum)}><I size={17} /> {m.etiket}{m.em ? <em>{m.em}</em> : null}</button>;
          })}
          <div className="ben">
            <Avatar ad={ben.ad} boyut={34} />
            <div style={{ minWidth: 0 }}><b>{ben.ad}</b><small>{ben.kurum ?? ""}</small></div>
            {cikis && <button onClick={cikis} title="Çıkış"><LogOut size={17} /></button>}
          </div>
        </aside>
        <div style={{ minWidth: 0 }}>
          <div className="hk-mobilust">
            {menu.map((m) => <button key={m.ad} className={aktif === m.ad ? "on" : ""} onClick={() => git({ ad: m.ad } as Gorunum)}>{m.etiket}{m.em ? ` (${m.em})` : ""}</button>)}
            {cikis && <button onClick={cikis}>Çıkış</button>}
          </div>
          {icerik}
        </div>
      </div>
    );
  }

  return (
    <div className="hk">
      <nav className="hk-nav">
        <span className="marka"><i>§</i> Hukuk masası</span>
        {menu.map((m) => {
          const I = m.ikon;
          return <button key={m.ad} className={aktif === m.ad ? "on" : ""} onClick={() => git({ ad: m.ad } as Gorunum)}><I size={15} /> {m.etiket}{m.em ? <em>{m.em}</em> : null}</button>;
        })}
      </nav>
      {icerik}
    </div>
  );
}

