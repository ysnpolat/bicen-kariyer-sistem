/**
 * Hukuk masası · resmi yazışma (24.10.2026)
 * Sohbet değil, kayıt numaralı kurumsal yazı: konu, muhatap, bilgi, dosya,
 * cevap süresi ve ekler. Okundu bilgisi alıcı bazında tutulur.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntdApp, DatePicker, Input, Modal, Select, Spin } from "antd";
import { Archive, ArchiveRestore, CornerUpLeft, FileText, Inbox, Mail, Paperclip, PenLine, Search, Send, Timer, X, ArrowLeft } from "lucide-react";
import dayjs from "dayjs";
import { api } from "./api";
import {
  Avatar, Belge, Ben, EkSatiri, YaziOzet, boyutYaz, kalan, tarihYaz, yerelTarih, zamanKisa,
} from "./hukukOrtak";

interface Kisi { anahtar: string; ad: string; kurum: string | null; tur: "ekip" | "ic" | "danisman"; erisim: boolean }
interface YaziDetay {
  id: number; kayitNo: string; konu: string; metin: string; gonderen: string; gonderenAd: string; gonderenKurum: string | null;
  gonderenIc: boolean; benGonderdim: boolean; tarih: string; cevapSuresi: string | null; yanitlandi: boolean; yanitId: number | null;
  dosya: { id: number; dosyaNo: string; davaciAd: string; turAdi: string; esasNo: string | null; mahkeme: string | null } | null;
  alicilar: { anahtar: string; rol: "kime" | "bilgi"; ad: string; kurum: string | null; okundu: string | null; okuyanAd: string | null }[];
  ekler: Belge[];
  zincir: { id: number; kayitNo: string; konu: string; gonderenAd: string; tarih: string; bu: boolean }[];
}
export interface YaziTaslak { dosyaId?: number | null; yanit?: YaziDetay | null }

/* ------------------------------------------------------------------ */
/* Yeni yazı / yanıt                                                    */
/* ------------------------------------------------------------------ */

export function YaziYaz({ ben, taslak, kapat, gonderildi, dosyalar }: {
  ben: Ben; taslak: YaziTaslak | null; kapat: () => void; gonderildi: (id: number) => void;
  dosyalar: { id: number; ad: string }[];
}) {
  const { message } = AntdApp.useApp();
  const [kisiler, setKisiler] = useState<Kisi[]>([]);
  const [kime, setKime] = useState<string[]>([]);
  const [bilgi, setBilgi] = useState<string[]>([]);
  const [dosyaId, setDosyaId] = useState<number | null>(null);
  const [konu, setKonu] = useState("");
  const [metin, setMetin] = useState("");
  const [sure, setSure] = useState<dayjs.Dayjs | null>(null);
  const [ekler, setEkler] = useState<File[]>([]);
  const [gidiyor, setGidiyor] = useState(false);
  const dosyaGir = useRef<HTMLInputElement>(null);

  /* Taslak her açılışta baştan kurulur */
  useEffect(() => {
    if (!taslak) return;
    const y = taslak.yanit;
    setDosyaId(y?.dosya?.id ?? taslak.dosyaId ?? null);
    setKonu(y ? (y.konu.startsWith("Ynt:") ? y.konu : "Ynt: " + y.konu) : "");
    setMetin("");
    setSure(null);
    setEkler([]);
    setBilgi([]);
    if (y) {
      /* Yanıt: gönderene gider. Danışman iç ekibe hukuk birimi kutusundan yazar. */
      const hedef = y.benGonderdim
        ? y.alicilar.filter((a) => a.rol === "kime").map((a) => a.anahtar)
        : [y.gonderenIc ? (ben.danisman ? "ekip" : y.gonderen) : y.gonderen];
      setKime(hedef.filter((a) => a !== ben.anahtar));
    } else setKime(ben.danisman ? ["ekip"] : []);
  }, [taslak, ben]);

  useEffect(() => {
    if (!taslak) return;
    api.al<{ kisiler: Kisi[] }>(`/api/Hukuk/Kisiler${dosyaId ? `?dosyaId=${dosyaId}` : ""}`)
      .then((d) => setKisiler(d.kisiler)).catch(() => setKisiler([]));
  }, [taslak, dosyaId]);

  const secenek = kisiler.map((k) => ({
    value: k.anahtar,
    disabled: !k.erisim,
    label: (
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <b style={{ fontWeight: 600 }}>{k.ad}</b>
        <small style={{ color: "#6f7484" }}>{k.tur === "danisman" ? k.kurum ?? "Dış danışman" : k.tur === "ekip" ? "Kurum kutusu" : "İK"}</small>
        {!k.erisim && <small style={{ color: "#b4442a" }}>· dosyaya erişimi yok</small>}
      </span>
    ),
  }));

  const gonder = async () => {
    if (kime.length === 0) return message.warning("Muhatap seçiniz.");
    if (!konu.trim()) return message.warning("Konuyu yazınız.");
    if (metin.trim().length < 3) return message.warning("Yazının metnini yazınız.");
    const f = new FormData();
    f.append("konu", konu.trim());
    f.append("metin", metin.trim());
    f.append("kime", kime.join(","));
    if (bilgi.length) f.append("bilgi", bilgi.join(","));
    if (dosyaId) f.append("dosyaId", String(dosyaId));
    if (taslak?.yanit) f.append("yanitId", String(taslak.yanit.id));
    if (sure) f.append("cevapSuresi", yerelTarih(sure)!);
    ekler.forEach((e) => f.append("ekler", e, e.name));
    setGidiyor(true);
    try {
      const r = await api.dosyaGonder<{ id: number; kayitNo: string }>("/api/Hukuk/Yazi", f);
      message.success(`Yazı gönderildi · ${r.kayitNo}`);
      gonderildi(r.id);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setGidiyor(false);
    }
  };

  const toplam = ekler.reduce((t, e) => t + e.size, 0);

  return (
    <Modal open={!!taslak} onCancel={kapat} footer={null} width={760} className="hk-yaz" destroyOnClose closeIcon={<X color="#fff" size={18} />}>
      <div className="hk">
        <div className="hk-yaz-bas">
          <PenLine size={18} /> {taslak?.yanit ? "Yanıt yazısı" : "Yeni resmi yazı"}
          <small>{ben.ad}{ben.kurum ? ` · ${ben.kurum}` : ""}</small>
        </div>
        <div className="hk-yaz-ic">
          <div>
            <label>Muhatap (kime)</label>
            <Select mode="multiple" value={kime} onChange={setKime} options={secenek} style={{ width: "100%" }}
              placeholder="Kime gidecek" optionFilterProp="value" showSearch
              filterOption={(g, o) => (kisiler.find((k) => k.anahtar === o?.value)?.ad ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))} />
          </div>
          <div className="iki">
            <div>
              <label>Bilgi (isteğe bağlı)</label>
              <Select mode="multiple" value={bilgi} onChange={setBilgi} options={secenek.filter((s) => !kime.includes(s.value))}
                style={{ width: "100%" }} placeholder="Bilgi için" allowClear
                filterOption={(g, o) => (kisiler.find((k) => k.anahtar === o?.value)?.ad ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))} />
            </div>
            <div>
              <label>İlgili dosya</label>
              <Select value={dosyaId ?? undefined} onChange={(v) => setDosyaId(v ?? null)} allowClear showSearch optionFilterProp="label"
                style={{ width: "100%" }} placeholder="Dosyasız (genel yazı)" disabled={!!taslak?.yanit?.dosya}
                options={dosyalar.map((d) => ({ value: d.id, label: d.ad }))} />
            </div>
          </div>
          <div className="iki">
            <div>
              <label>Konu</label>
              <Input value={konu} onChange={(e) => setKonu(e.target.value)} maxLength={200} placeholder="Ör. Duruşma öncesi tanık listesi hk." />
            </div>
            <div>
              <label>Cevap süresi (isteğe bağlı)</label>
              <DatePicker value={sure} onChange={setSure} format="DD.MM.YYYY" style={{ width: "100%" }}
                disabledDate={(d) => d.isBefore(dayjs().startOf("day"))} placeholder="Yanıt beklenen tarih" />
            </div>
          </div>
          <div>
            <label>Metin</label>
            <Input.TextArea value={metin} onChange={(e) => setMetin(e.target.value)} autoSize={{ minRows: 9, maxRows: 18 }}
              maxLength={20000} placeholder={"Sayın …,\n\n"} />
          </div>
          <div>
            <label>Ekler</label>
            <div className="hk-ekli">
              {ekler.map((e, i) => (
                <span key={i}><Paperclip size={13} /> {e.name} <small style={{ color: "#9a9eab" }}>{boyutYaz(e.size)}</small>
                  <button onClick={() => setEkler(ekler.filter((_, j) => j !== i))} title="Çıkar"><X size={13} /></button></span>
              ))}
              <button className="hk-btn kucuk" onClick={() => dosyaGir.current?.click()}><Paperclip /> Ek ekle</button>
              <input ref={dosyaGir} type="file" multiple hidden onChange={(e) => {
                const l = Array.from(e.target.files ?? []);
                if (l.some((x) => x.size > 300 * 1024 * 1024)) message.warning("Her ek en fazla 300 MB olabilir.");
                setEkler([...ekler, ...l.filter((x) => x.size <= 300 * 1024 * 1024)].slice(0, 20));
                e.target.value = "";
              }} />
            </div>
          </div>
        </div>
        <div className="hk-yaz-alt">
          <span className="not">Kayıt numarası gönderimde verilir{toplam ? ` · ekler ${boyutYaz(toplam)}` : ""}</span>
          <button className="hk-btn" onClick={kapat}>Vazgeç</button>
          <button className="hk-btn koyu" onClick={gonder} disabled={gidiyor}>
            {gidiyor ? <Spin size="small" /> : <Send />} Gönder
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Yazı okuma                                                           */
/* ------------------------------------------------------------------ */

export function YaziOku({ id, ben, yanitla, dosyaAc, ac, geri, yenile }: {
  id: number; ben: Ben; yanitla: (y: YaziDetay) => void; dosyaAc?: (id: number) => void; ac: (id: number) => void;
  geri?: () => void; yenile?: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [y, setY] = useState<YaziDetay | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    setY(null); setHata(null);
    api.al<YaziDetay>(`/api/Hukuk/Yazi/${id}`).then((d) => { setY(d); yenile?.(); }).catch((e) => setHata(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (hata) return <div className="hk-bos"><b>Yazı açılamadı</b>{hata}</div>;
  if (!y) return <div className="hk-bos"><Spin /></div>;

  const kime = y.alicilar.filter((a) => a.rol === "kime");
  const bilgi = y.alicilar.filter((a) => a.rol === "bilgi");
  const arsivle = async (geriAl: boolean) => {
    try {
      await api.gonder(`/api/Hukuk/Yazi/${y.id}/Arsiv${geriAl ? "?geri=true" : ""}`);
      message.success(geriAl ? "Gelen kutusuna alındı." : "Arşive kaldırıldı.");
      yenile?.();
    } catch (e: any) { message.error(e.message); }
  };
  const yazabilir = ben.yetki !== "okuma";

  return (
    <>
      <div className="hk-oku-bas">
        {geri && <button className="hk-btn kucuk" onClick={geri}><ArrowLeft /> </button>}
        <h2>{y.konu}</h2>
        <div className="sag">
          {yazabilir && <button className="hk-btn koyu" onClick={() => yanitla(y)}><CornerUpLeft /> Yanıtla</button>}
          <button className="hk-btn" onClick={() => arsivle(false)} title="Arşive kaldır"><Archive /></button>
          <button className="hk-btn" onClick={() => arsivle(true)} title="Gelen kutusuna geri al"><ArchiveRestore /></button>
        </div>
      </div>

      <div className="hk-kunye">
        <div><span>Kayıt no</span><b className="mono">{y.kayitNo}</b></div>
        <div><span>Tarih</span><b>{dayjs(y.tarih).format("DD.MM.YYYY HH:mm")}</b></div>
        <div><span>İlgili dosya</span>{y.dosya
          ? <b style={{ cursor: dosyaAc ? "pointer" : undefined, color: "var(--a2)" }} onClick={() => dosyaAc?.(y.dosya!.id)}>{y.dosya.dosyaNo} · {y.dosya.davaciAd}</b>
          : <b>Genel yazı</b>}</div>
        <div><span>Cevap süresi</span>{y.cevapSuresi
          ? <b style={{ color: y.yanitlandi ? "var(--yes)" : kalan(y.cevapSuresi).renk }}>
              {tarihYaz(y.cevapSuresi)} · {y.yanitlandi ? "yanıtlandı" : kalan(y.cevapSuresi).metin}</b>
          : <b>—</b>}</div>
      </div>

      <div className="hk-kagit">
        <div className="hk-antet">
          <b>BİÇEN</b>
          <small>{y.gonderenIc ? "İnsan Kaynakları · Hukuk Birimi" : (y.gonderenKurum ?? "Dış hukuk danışmanı")}<br />Resmi yazışma</small>
        </div>
        <div className="sayi">
          <span>Sayı: {y.kayitNo}</span>
          <span>{dayjs(y.tarih).format("DD.MM.YYYY")}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--s)", marginBottom: 16, display: "grid", gap: 2 }}>
          <div><b style={{ color: "var(--t)" }}>Kime:</b> {kime.map((a) => a.ad).join(", ")}</div>
          {bilgi.length > 0 && <div><b style={{ color: "var(--t)" }}>Bilgi:</b> {bilgi.map((a) => a.ad).join(", ")}</div>}
          {y.dosya && <div><b style={{ color: "var(--t)" }}>İlgi:</b> {y.dosya.dosyaNo}{y.dosya.esasNo ? ` · Esas ${y.dosya.esasNo}` : ""}{y.dosya.mahkeme ? ` · ${y.dosya.mahkeme}` : ""}</div>}
          <div><b style={{ color: "var(--t)" }}>Konu:</b> {y.konu}</div>
        </div>
        <div className="metin">{y.metin}</div>
        <div className="imza">
          {y.gonderenAd}
          <small>{y.gonderenIc ? "Biçen · İnsan Kaynakları" : y.gonderenKurum}</small>
        </div>
      </div>

      {y.ekler.length > 0 && (
        <div className="hk-ekler">{y.ekler.map((b) => <EkSatiri key={b.id} b={b} />)}</div>
      )}

      <div className="hk-okundu">
        {y.alicilar.map((a) => (
          <span key={a.anahtar + a.rol} className={"hk-etiket " + (a.okundu ? "e-yes" : "e-gri")}>
            {a.okundu ? "✓ " : ""}{a.ad}{a.okundu ? ` · ${dayjs(a.okundu).format("DD.MM HH:mm")}${a.okuyanAd && a.okuyanAd !== a.ad ? ` (${a.okuyanAd})` : ""}` : " · okunmadı"}
          </span>
        ))}
      </div>

      {y.zincir.length > 1 && (
        <div className="hk-zincir">
          <b className="serif" style={{ color: "var(--m)", fontSize: 16 }}>Yazı zinciri</b>
          {y.zincir.map((z) => (
            <div key={z.id} className={"z" + (z.bu ? " bu" : "")} onClick={() => !z.bu && ac(z.id)}>
              <Avatar ad={z.gonderenAd} boyut={28} />
              <span><b>{z.gonderenAd}</b> · {z.konu}</span>
              <small>{z.kayitNo} · {dayjs(z.tarih).format("DD.MM.YYYY")}</small>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Yazı listesi satırı                                                  */
/* ------------------------------------------------------------------ */

export function YaziSatiri({ y, on, tikla }: { y: YaziOzet; on?: boolean; tikla: () => void }) {
  const kim = y.benGonderdim ? "Kime: " + (y.kime.join(", ") || "—") : y.gonderenAd;
  return (
    <div className={"hk-li" + (on ? " on" : "") + (y.okunmadi ? " okunmadi" : "")} onClick={tikla}>
      <div className="u"><b>{y.okunmadi && <span className="hk-nokta" />}{kim}</b><time>{zamanKisa(y.tarih)}</time></div>
      <div className="konu">{y.konu}</div>
      <div className="on2">{y.ozet}</div>
      <div className="alt">
        <span className="hk-etiket e-gri mono">{y.kayitNo}</span>
        {y.dosyaNo && <span className="hk-etiket e-alt">{y.dosyaNo}</span>}
        {y.cevapSuresi && !y.yanitlandi && <span className="hk-etiket e-kir"><Timer size={11} /> {kalan(y.cevapSuresi).metin}</span>}
        {y.yanitlandi && <span className="hk-etiket e-yes">Yanıtlandı</span>}
        {y.benGonderdim && y.okunduAlici && <span className="hk-etiket e-yes">Okundu</span>}
        {y.ek > 0 && <span className="hk-etiket e-gri"><Paperclip size={11} /> {y.ek}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Posta kutusu: klasör · liste · okuma                                 */
/* ------------------------------------------------------------------ */

const KLASORLER: { kod: string; ad: string; ikon: any }[] = [
  { kod: "gelen", ad: "Gelen yazılar", ikon: Inbox },
  { kod: "bekleyen", ad: "Yanıt bekleyen", ikon: Timer },
  { kod: "gonderilen", ad: "Gönderilen", ikon: Send },
  { kod: "arsiv", ad: "Arşiv", ikon: Archive },
];

export default function PostaKutusu({ ben, acilacak, dosyaAc, dosyalar, sayacYenile }: {
  ben: Ben; acilacak?: number | null; dosyaAc: (id: number) => void; dosyalar: { id: number; ad: string }[];
  sayacYenile?: () => void;
}) {
  const [klasor, setKlasor] = useState("gelen");
  const [q, setQ] = useState("");
  const [liste, setListe] = useState<YaziOzet[] | null>(null);
  const [sayilar, setSayilar] = useState<{ gelen: number; bekleyen: number }>({ gelen: 0, bekleyen: 0 });
  const [secili, setSecili] = useState<number | null>(acilacak ?? null);
  const [taslak, setTaslak] = useState<YaziTaslak | null>(null);

  const yukle = useCallback(() => {
    api.al<{ yazilar: YaziOzet[]; sayilar: any }>(`/api/Hukuk/Yazilar?klasor=${klasor}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`)
      .then((d) => { setListe(d.yazilar); setSayilar(d.sayilar ?? { gelen: 0, bekleyen: 0 }); })
      .catch(() => setListe([]));
  }, [klasor, q]);

  useEffect(() => {
    const t = setTimeout(yukle, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [yukle, q]);
  useEffect(() => { if (acilacak) setSecili(acilacak); }, [acilacak]);

  const okundu = () => { yukle(); sayacYenile?.(); };

  return (
    <>
      <div className="hk-ph">
        <div>
          <h1>Resmi yazışma</h1>
          <p>Kayıt numaralı yazılar · muhatap, bilgi, cevap süresi ve ekler</p>
        </div>
      </div>
      <div className={"hk-posta" + (secili ? " okuyor" : "")}>
        <div className="hk-klasor">
          {ben.yetki !== "okuma" && (
            <button className="hk-btn koyu" onClick={() => setTaslak({})}><PenLine /> Yeni yazı</button>
          )}
          <div className="bolum">Klasörler</div>
          {KLASORLER.map((k) => {
            const I = k.ikon;
            const n = k.kod === "gelen" ? sayilar.gelen : k.kod === "bekleyen" ? sayilar.bekleyen : 0;
            return (
              <button key={k.kod} className={"k" + (klasor === k.kod ? " on" : "")} onClick={() => { setKlasor(k.kod); setSecili(null); }}>
                <I size={16} /> {k.ad} {n > 0 && <em>{n}</em>}
              </button>
            );
          })}
        </div>
        <div className="hk-liste">
          <div className="ara">
            <Input prefix={<Search size={15} color="#9a9eab" />} placeholder="Konu, kayıt no, gönderen, taraf" value={q}
              onChange={(e) => setQ(e.target.value)} allowClear />
          </div>
          <div className="ic">
            {liste === null ? <div className="hk-bos"><Spin /></div>
              : liste.length === 0 ? <div className="hk-bos"><Mail /><b>Yazı yok</b>Bu klasörde yazı bulunmuyor.</div>
              : liste.map((y) => <YaziSatiri key={y.id} y={y} on={secili === y.id} tikla={() => setSecili(y.id)} />)}
          </div>
        </div>
        <div className="hk-oku">
          {secili
            ? <YaziOku id={secili} ben={ben} ac={setSecili} dosyaAc={dosyaAc} yenile={okundu}
                yanitla={(y) => setTaslak({ yanit: y })} geri={() => setSecili(null)} />
            : <div className="hk-bos"><FileText /><b>Bir yazı seçiniz</b>Soldaki listeden okumak istediğiniz yazıyı açınız.</div>}
        </div>
      </div>
      <YaziYaz ben={ben} taslak={taslak} kapat={() => setTaslak(null)} dosyalar={dosyalar}
        gonderildi={(id) => { setTaslak(null); setKlasor("gonderilen"); setSecili(id); yukle(); }} />
    </>
  );
}
