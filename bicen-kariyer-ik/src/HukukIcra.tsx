/**
 * Hukuk masası · İcra / maaş haczi takibi (30.10.2026)
 * ---------------------------------------------------------------------------
 * Personele gelen haciz ihbarnameleri ve nafaka dosyaları: sıra (tebliğ
 * sırasına göre 1, 2, 3…; İK gerekçeyle elle değiştirebilir), aylık kesinti
 * hesabı (nafakanın tamamı + net maaşın ¼'ü sıradaki dosyaya; oran
 * Yönetim › Süreler ve sınırlar › İcra'dan), dönem listesi ve Excel'i, ödeme
 * ve dekont, tebligat cevap yazısı, işten ayrılış yazısı, zaman çizelgesi,
 * belgeler. Uçlar: /api/Hukuk/Icra/… (HukukIcra.cs); danışman göremez.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntdApp, DatePicker, Drawer, Input, InputNumber, Modal, Select, Spin } from "antd";
import {
  ArrowLeft, Banknote, Calculator, Check, ClipboardCopy, Download, FileText, FolderPlus, Landmark, Pencil, Printer, Receipt,
  RotateCcw, Search, Trash2, Upload, UserX,
} from "lucide-react";
import dayjs from "dayjs";
import { api, API_TABAN, oturumOku } from "./api";
import { tabloIndir } from "./raporExcel";
import { boyutYaz, kalan, tarihYaz, uzantiSinif, yerelTarih } from "./hukukOrtak";

/* ------------------------------------------------------------------ tipler */

export interface IcraBen {
  yetkili: boolean; hak: "tam" | "okuma"; ad: string; oran: number; cevapGun: number;
  turler: { kod: string; ad: string }[]; durumlar: { kod: string; ad: string }[]; olayTurleri: { kod: string; ad: string }[];
}
export interface IcraOzet {
  icra: number; nafaka: number; personel: number; cevapYakin: number; cevapGecti: number; ayrilan: number;
  buAyKesinti: number; buAyOdenmemis: number; toplamBorc: number; donem: string;
}
export interface IcraDosya {
  id: number; dosyaNo: string; sicil: string; personelAd: string | null; tur: "icra" | "nafaka"; turAdi: string;
  icraDairesi: string | null; esasNo: string | null; alacakli: string | null; odemeHesabi: string | null;
  tebligTarihi: string | null; gelisTarihi: string | null; baslangic: string | null;
  toplamBorc: number; kesilen: number; odenen: number; kalan: number; aylikTutar: number | null;
  durum: string; durumAdi: string; sira: number; siraElle: number | null;
  alacakliVekili: string | null; cevapSuresi: string | null; cevapTarihi: string | null;
  asilAlacak: number | null; faiz: number | null; masraf: number | null; siraNotu: string | null; notlar: string | null;
  kapanisTarihi: string | null; ayrilisBildirildi: string | null; olusturma: string;
}
interface IcraOlay { id: number; tur: string; turAdi: string; tarih: string; baslik: string; aciklama: string | null; tutar: number | null; ekleyenAd: string | null }
interface IcraBelge { id: number; ad: string; boyut: number; uzanti: string; yukleyenAd: string | null; tarih: string; kesintiId: number | null }
interface Kesinti {
  id: number; dosyaId: number; donem: string; donemAdi: string; tur: string; tutar: number; netMaas: number | null; maasKaynak: string | null;
  sira: number | null; odendi: boolean; odemeTarihi: string | null; dekontId: number | null; dekontAd: string | null; aciklama: string | null;
}
interface HesapSatiri {
  dosyaId: number; dosyaNo: string; tur: string; sira: number; tutar: number; alacakli: string | null; icraDairesi: string | null;
  esasNo: string | null; odemeHesabi: string | null; toplamBorc: number; kalanSonra: number; kapanir: boolean;
}
interface Hesap {
  sicil: string; personelAd: string | null; donem: string; donemAdi: string; netMaas: number | null; maasKaynak: string | null;
  oran: number; oranPayi: number; nafaka: number; icra: number; toplam: number; kaydedildi: boolean; satirlar: HesapSatiri[]; uyarilar: string[];
}
interface DonemKisi {
  sicil: string; personelAd: string; donem: string; kaydedildi: boolean; netMaas: number | null; maasKaynak: string | null;
  nafaka: number; icra: number; toplam: number; uyarilar: string[];
  satirlar: (HesapSatiri & { kesintiId: number | null; odendi: boolean; odemeTarihi: string | null; dekontId: number | null; dekontAd: string | null })[];
}
interface Detay {
  hak: "tam" | "okuma"; dosya: IcraDosya;
  personel: { ad: string; pozisyon: string | null; sube: string | null; giris: string | null; cikis: string | null; aktif: boolean } | null;
  digerDosyalar: IcraDosya[]; olaylar: IcraOlay[]; belgeler: IcraBelge[]; kesintiler: Kesinti[]; buAy: Hesap | null;
}

export const paraTam = (n?: number | null) => (n == null ? "—" : n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺");
const DURUM_RENK: Record<string, string> = { acik: "e-yes", askida: "e-tur", kapandi: "e-gri", feragat: "e-mor", iptal: "e-gri" };
const OLAY_SINIF: Record<string, string> = {
  tebligat: "e-kir", cevap: "e-mav", kesinti: "e-alt", odeme: "e-yes", borc: "e-tur", sira: "e-mor", askiya: "e-tur", kapandi: "e-gri", feragat: "e-mor", ayrilis: "e-kir", not: "e-gri",
};
const icraBelgeAdresi = (id: number, indir = false) =>
  `${API_TABAN}/api/Hukuk/Icra/Belge/${id}?t=${encodeURIComponent(oturumOku()?.token ?? "")}${indir ? "&indir=true" : ""}`;
const donemler = () => Array.from({ length: 14 }, (_, i) => dayjs().add(2, "month").subtract(i, "month")).map((d) => ({ value: d.format("YYYY-MM"), label: d.format("MMMM YYYY") }));

function Sira({ d }: { d: IcraDosya }) {
  if (d.durum !== "acik") return <span className={"hk-etiket " + (DURUM_RENK[d.durum] ?? "e-gri")}>{d.durumAdi}</span>;
  if (d.tur === "nafaka") return <span className="hk-etiket e-kir">Nafaka · öncelikli</span>;
  return (
    <span className={"hk-sira" + (d.sira === 1 ? " on" : "")} title={d.siraElle ? `Elle verilen sıra: ${d.siraNotu ?? ""}` : "Tebliğ sırasına göre"}>
      {d.sira || "—"}{d.siraElle ? <small>elle</small> : null}
    </span>
  );
}
function CevapDurumu({ d, kisa }: { d: IcraDosya; kisa?: boolean }) {
  if (d.tur !== "icra" || !d.cevapSuresi) return kisa ? null : <small>—</small>;
  if (d.cevapTarihi) return <span className="hk-etiket e-yes">Cevap verildi {kisa ? "" : tarihYaz(d.cevapTarihi)}</span>;
  const k = kalan(d.cevapSuresi);
  return <span className="hk-sayac" style={{ color: k.renk }}>Cevap: {k.metin}</span>;
}
const L = ({ c }: { c: string }) => <label style={{ fontSize: 11.5, color: "#6f7484", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, display: "block", marginBottom: 3 }}>{c}</label>;
const paraGiris = { min: 0, style: { width: "100%" }, formatter: (v: any) => (v != null && v !== "" ? Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : ""), parser: (v: any) => Number(String(v ?? "").replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")) as any, decimalSeparator: "," };

/* ------------------------------------------------------------------ */
/* Dosya formu                                                          */
/* ------------------------------------------------------------------ */

export function IcraDosyaFormu({ icraBen, acik, dosya, kapat, kaydedildi }: {
  icraBen: IcraBen; acik: boolean; dosya?: IcraDosya | null; kapat: () => void; kaydedildi: (id: number) => void;
}) {
  const { message } = AntdApp.useApp();
  const bos = { tur: "icra" } as any;
  const [d, setD] = useState<any>(bos);
  const [gidiyor, setGidiyor] = useState(false);
  const [adaylar, setAdaylar] = useState<{ sicil: string; ad: string; pozisyon: string; sube: string }[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!acik) return;
    setD(dosya ? {
      ...dosya,
      tebligTarihi: dosya.tebligTarihi ? dayjs(dosya.tebligTarihi) : null, gelisTarihi: dosya.gelisTarihi ? dayjs(dosya.gelisTarihi) : null,
      baslangic: dosya.baslangic ? dayjs(dosya.baslangic) : null,
    } : bos);
    setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik, dosya]);
  useEffect(() => {
    if (!acik || dosya || q.trim().length < 2) { setAdaylar([]); return; }
    const t = setTimeout(() => api.al<{ personeller: any[] }>(`/api/Hukuk/Icra/Personel?q=${encodeURIComponent(q.trim())}`).then((r) => setAdaylar(r.personeller)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, acik, dosya]);

  const a = (k: string) => (v: any) => setD((x: any) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const toplam = (Number(d.asilAlacak) || 0) + (Number(d.faiz) || 0) + (Number(d.masraf) || 0);
  const kaydet = async () => {
    setGidiyor(true);
    try {
      const g = {
        sicil: d.sicil, tur: d.tur, icraDairesi: d.icraDairesi, esasNo: d.esasNo, alacakli: d.alacakli, alacakliVekili: d.alacakliVekili,
        tebligTarihi: yerelTarih(d.tebligTarihi), gelisTarihi: yerelTarih(d.gelisTarihi), asilAlacak: d.asilAlacak ?? null, faiz: d.faiz ?? null, masraf: d.masraf ?? null,
        toplamBorc: d.toplamBorcElle ?? (toplam > 0 ? toplam : d.toplamBorc ?? null), aylikTutar: d.aylikTutar ?? null, baslangic: yerelTarih(d.baslangic),
        odemeHesabi: d.odemeHesabi, notlar: d.notlar, guncellemeNotu: d.guncellemeNotu,
      };
      const r = await api.gonder<{ id: number; dosyaNo?: string }>(dosya ? `/api/Hukuk/Icra/Dosya/${dosya.id}` : "/api/Hukuk/Icra/Dosya", g);
      message.success(dosya ? "Dosya güncellendi." : `İcra dosyası açıldı · ${r.dosyaNo}`);
      kaydedildi(r.id);
    } catch (e: any) { message.error(e.message); } finally { setGidiyor(false); }
  };

  return (
    <Drawer open={acik} onClose={kapat} width={600} title={dosya ? `${dosya.dosyaNo} · düzenle` : "Yeni icra / nafaka dosyası"} destroyOnClose
      extra={<button className="hk-btn koyu" onClick={kaydet} disabled={gidiyor}>{gidiyor ? <Spin size="small" /> : <Check size={16} />} Kaydet</button>}>
      <div style={{ display: "grid", gap: 12 }}>
        <div><L c="Dosya türü" /><Select value={d.tur} onChange={a("tur")} style={{ width: "100%" }} options={icraBen.turler.map((t) => ({ value: t.kod, label: t.ad }))} /></div>
        {dosya ? (
          <div><L c="Personel" /><Input value={`${dosya.personelAd ?? ""} · ${dosya.sicil}`} disabled /></div>
        ) : (
          <div>
            <L c="Personel (ad ya da sicil)" />
            <Select showSearch value={d.sicil} onSearch={setQ} onChange={(v, o: any) => { setD((x: any) => ({ ...x, sicil: v })); if (o?.label) setQ(""); }}
              filterOption={false} placeholder="En az 2 harf yazınız" style={{ width: "100%" }} notFoundContent={q.length < 2 ? "Aramak için yazın" : "Aktif personel bulunamadı"}
              options={adaylar.map((p) => ({ value: p.sicil, label: `${p.ad} · ${p.sicil} · ${[p.pozisyon, p.sube].filter(Boolean).join(" / ")}` }))} />
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><L c="İcra dairesi / mahkeme" /><Input value={d.icraDairesi} onChange={a("icraDairesi")} maxLength={200} placeholder="Ör. Bursa 5. İcra Dairesi" /></div>
          <div><L c="Dosya (esas) no" /><Input value={d.esasNo} onChange={a("esasNo")} maxLength={60} placeholder="2026/12345 E." /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><L c="Alacaklı" /><Input value={d.alacakli} onChange={a("alacakli")} maxLength={200} /></div>
          <div><L c="Alacaklı vekili" /><Input value={d.alacakliVekili} onChange={a("alacakliVekili")} maxLength={200} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><L c="Tebliğ tarihi" /><DatePicker value={d.tebligTarihi} onChange={a("tebligTarihi")} format="DD.MM.YYYY" style={{ width: "100%" }} />
            <small style={{ color: "#6f7484" }}>Cevap süresi: tebliğ + {icraBen.cevapGun} gün</small></div>
          <div><L c="Şirkete geliş tarihi" /><DatePicker value={d.gelisTarihi} onChange={a("gelisTarihi")} format="DD.MM.YYYY" style={{ width: "100%" }} /></div>
        </div>
        {d.tur === "nafaka" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><L c="Aylık nafaka (₺)" /><InputNumber value={d.aylikTutar} onChange={a("aylikTutar")} {...paraGiris} /></div>
            <div><L c="Başlangıç ayı" /><DatePicker value={d.baslangic} onChange={a("baslangic")} picker="month" format="MMMM YYYY" style={{ width: "100%" }} /></div>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div><L c="Asıl alacak (₺)" /><InputNumber value={d.asilAlacak} onChange={a("asilAlacak")} {...paraGiris} /></div>
              <div><L c="Faiz (₺)" /><InputNumber value={d.faiz} onChange={a("faiz")} {...paraGiris} /></div>
              <div><L c="Masraf (₺)" /><InputNumber value={d.masraf} onChange={a("masraf")} {...paraGiris} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
              <div><L c="Toplam borç (₺)" />
                <InputNumber value={d.toplamBorcElle ?? (toplam > 0 ? toplam : d.toplamBorc)} onChange={a("toplamBorcElle")} {...paraGiris} />
                <small style={{ color: "#6f7484" }}>Kalemler girildiyse toplam kendiliğinden; farklıysa düzeltin.</small></div>
              {dosya && <div><L c="Güncelleme gerekçesi" /><Input value={d.guncellemeNotu} onChange={a("guncellemeNotu")} maxLength={300} placeholder="Ek haciz, faiz güncellemesi…" /></div>}
            </div>
          </>
        )}
        <div><L c="Ödeme hesabı (IBAN / icra dairesi hesabı)" /><Input value={d.odemeHesabi} onChange={a("odemeHesabi")} maxLength={300} placeholder="TR.. ya da dairenin vakıfbank hesabı" /></div>
        <div><L c="Not" /><Input.TextArea value={d.notlar} onChange={a("notlar")} maxLength={2000} autoSize={{ minRows: 3, maxRows: 8 }} /></div>
        <small style={{ color: "#6f7484" }}>Kesinti oranları Yönetim › Süreler ve sınırlar › İcra'dan değiştirilebilir. Hesap kuralları hukuk danışmanına kontrol ettirilmelidir.</small>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Hesap kutusu (bir kişinin bir ayı)                                   */
/* ------------------------------------------------------------------ */

function HesapKutusu({ h, hak, yenile }: { h: Hesap; hak: string; yenile: () => void }) {
  const { message } = AntdApp.useApp();
  const [elle, setElle] = useState<number | null>(null);
  const [acik, setAcik] = useState(false);
  const maasYaz = async (net: number | null) => {
    try {
      await api.gonder("/api/Hukuk/Icra/Maas", { sicil: h.sicil, donem: h.donem, netMaas: net });
      message.success(net == null ? "Bordro değerine dönüldü." : "Net maaş elle kaydedildi.");
      setAcik(false); yenile();
    } catch (e: any) { message.error(e.message); }
  };
  return (
    <div className="hk-hesap">
      <div className="ust">
        <div><small>Dönem</small><b>{h.donemAdi}</b></div>
        <div><small>Net maaş</small><b>{paraTam(h.netMaas)}</b><span>{h.maasKaynak === "elle" ? "elle girildi" : h.maasKaynak === "bordro" ? "bordrodan" : "bulunamadı"}</span></div>
        <div><small>Oran payı (%{Math.round(h.oran * 100)})</small><b>{paraTam(h.oranPayi)}</b></div>
        <div><small>Nafaka</small><b>{paraTam(h.nafaka)}</b></div>
        <div className="vurgu"><small>Toplam kesinti</small><b>{paraTam(h.toplam)}</b><span>{h.kaydedildi ? "kaydedildi" : "hesaplandı, kaydedilmedi"}</span></div>
      </div>
      {h.uyarilar.map((u, i) => <div key={i} className="hk-uyari">{u}</div>)}
      {h.satirlar.length > 0 && (
        <table className="hk-mini">
          <thead><tr><th>Sıra</th><th>Dosya</th><th>Alacaklı</th><th style={{ textAlign: "right" }}>Kesinti</th><th style={{ textAlign: "right" }}>Kalan</th></tr></thead>
          <tbody>{h.satirlar.map((s) => (
            <tr key={s.dosyaId}>
              <td>{s.tur === "nafaka" ? <span className="hk-etiket e-kir">Nafaka</span> : <span className="hk-sira">{s.sira}</span>}</td>
              <td><span className="mono">{s.dosyaNo}</span><br /><small>{[s.icraDairesi, s.esasNo].filter(Boolean).join(" · ")}</small></td>
              <td>{s.alacakli ?? "—"}</td>
              <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>{paraTam(s.tutar)}</td>
              <td className="mono" style={{ textAlign: "right" }}>{s.tur === "nafaka" ? "aylık" : paraTam(s.kalanSonra)}{s.kapanir && <span className="hk-etiket e-yes" style={{ marginLeft: 6 }}>kapanır</span>}</td>
            </tr>))}
          </tbody>
        </table>
      )}
      {hak === "tam" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {acik ? (
            <>
              <InputNumber value={elle} onChange={(v) => setElle(v as number | null)} {...paraGiris} style={{ width: 180 }} placeholder="Net maaş ₺" autoFocus />
              <button className="hk-btn kucuk koyu" onClick={() => elle != null && maasYaz(elle)}>Kaydet</button>
              {h.maasKaynak === "elle" && <button className="hk-btn kucuk" onClick={() => maasYaz(null)}>Bordroya dön</button>}
              <button className="hk-btn kucuk" onClick={() => setAcik(false)}>Vazgeç</button>
            </>
          ) : <button className="hk-btn kucuk" onClick={() => { setElle(h.netMaas); setAcik(true); }}><Pencil /> Net maaşı elle düzelt</button>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dosya listesi                                                        */
/* ------------------------------------------------------------------ */

function IcraTablosu({ l, ac }: { l: IcraDosya[]; ac: (id: number) => void }) {
  return (
    <div className="hk-tablo"><table>
      <thead><tr><th>Sıra</th><th>Personel</th><th>Dosya</th><th>Alacaklı</th><th style={{ textAlign: "right" }}>Borç / kalan</th><th>Tebligat</th><th>Durum</th></tr></thead>
      <tbody>{l.map((d) => (
        <tr key={d.id} onClick={() => ac(d.id)}>
          <td><Sira d={d} /></td>
          <td><span className="ad">{d.personelAd ?? d.sicil}</span><small className="mono">{d.sicil}</small></td>
          <td><span className={"hk-etiket " + (d.tur === "nafaka" ? "e-kir" : "e-alt")}>{d.turAdi}</span><br /><small className="mono">{d.dosyaNo} · {[d.icraDairesi, d.esasNo].filter(Boolean).join(" ")}</small></td>
          <td>{d.alacakli ?? "—"}<br /><small>{d.alacakliVekili ?? ""}</small></td>
          <td className="mono" style={{ textAlign: "right" }}>
            {d.tur === "nafaka" ? <>{paraTam(d.aylikTutar)}<br /><small>aylık</small></> : <>{paraTam(d.toplamBorc)}<br /><small>kalan <b>{paraTam(d.kalan)}</b></small></>}
          </td>
          <td>{tarihYaz(d.tebligTarihi)}<br /><CevapDurumu d={d} kisa /></td>
          <td>
            <span className={"hk-etiket " + (DURUM_RENK[d.durum] ?? "e-gri")}>{d.durumAdi}</span>
            {d.ayrilisBildirildi && <><br /><span className="hk-etiket e-kir"><UserX size={11} /> Ayrıldı</span></>}
          </td>
        </tr>))}
      </tbody>
    </table></div>
  );
}

/* ------------------------------------------------------------------ */
/* Dönem listesi (bordro için) + Excel                                  */
/* ------------------------------------------------------------------ */

function DonemListesi({ icraBen, ac }: { icraBen: IcraBen; ac: (id: number) => void }) {
  const { message, modal } = AntdApp.useApp();
  const [donem, setDonem] = useState(dayjs().format("YYYY-MM"));
  const [v, setV] = useState<{ donem: string; donemAdi: string; oran: number; kisiler: DonemKisi[] } | null>(null);
  const [surum, setSurum] = useState(0);
  const dekontGir = useRef<HTMLInputElement>(null);
  const dekontKid = useRef<number | null>(null);

  useEffect(() => { setV(null); api.al<any>(`/api/Hukuk/Icra/Donem?donem=${donem}`).then(setV).catch((e) => { message.error(e.message); setV({ donem, donemAdi: donem, oran: 0.25, kisiler: [] }); }); }, [donem, surum, message]);

  const kaydet = (sicil?: string) => modal.confirm({
    title: sicil ? "Bu personelin kesintisi kaydedilsin mi?" : `${v?.donemAdi} kesintileri kaydedilsin mi?`,
    content: "Kaydedilen satırlar ödeme ve dekont takibine girer. Ödenmiş satırlara dokunulmaz; ödenmemişler yeniden hesaplanır.",
    okText: "Kaydet", cancelText: "Vazgeç",
    onOk: async () => {
      try {
        const r = await api.gonder<{ kaydedilen: number; uyari: string | null }>(`/api/Hukuk/Icra/Donem/Kaydet?donem=${donem}${sicil ? `&sicil=${sicil}` : ""}`, {});
        message.success(`${r.kaydedilen} personelin kesintisi kaydedildi.`);
        if (r.uyari) message.warning(r.uyari);
        setSurum((s) => s + 1);
      } catch (e: any) { message.error(e.message); }
    },
  });
  const odendi = async (kid: number, geri = false) => {
    try { await api.gonder(`/api/Hukuk/Icra/Kesinti/${kid}/Odendi`, { odendi: !geri }); setSurum((s) => s + 1); } catch (e: any) { message.error(e.message); }
  };
  const dekontYukle = async (f: File) => {
    const kid = dekontKid.current; if (!kid) return;
    const form = new FormData(); form.append("dosyalar", f, f.name);
    try { await api.dosyaGonder(`/api/Hukuk/Icra/Kesinti/${kid}/Dekont`, form); message.success("Dekont eklendi; kesinti ödendi işaretlendi."); setSurum((s) => s + 1); }
    catch (e: any) { message.error(e.message); }
  };
  const excel = async () => {
    if (!v) return;
    const satirlar: any[][] = [];
    v.kisiler.forEach((k) => k.satirlar.forEach((s) => satirlar.push([
      k.sicil, k.personelAd, s.tur === "nafaka" ? "Nafaka" : "İcra", s.tur === "nafaka" ? "" : s.sira, s.dosyaNo, s.icraDairesi ?? "", s.esasNo ?? "", s.alacakli ?? "",
      s.odemeHesabi ?? "", s.tur === "nafaka" ? s.tutar : 0, s.tur === "icra" ? s.tutar : 0, s.tutar, k.netMaas ?? "", s.tur === "nafaka" ? "" : s.kalanSonra, s.odendi ? "Ödendi" : k.kaydedildi ? "Bekliyor" : "Hesaplandı",
    ])));
    await tabloIndir({
      baslik: `İcra / nafaka kesinti listesi · ${v.donemAdi}`, altBaslik: `Oran %${Math.round(v.oran * 100)} · ${v.kisiler.length} personel · bordro için`, sayfaAdi: "Kesintiler",
      dosyaAdi: `icra-kesinti-${v.donem}`, genelToplam: true, grupSutunu: 1, toplamEki: "toplamı",
      sutunlar: [
        { ad: "Sicil", tip: "metin", genislik: 10, toplam: false }, { ad: "Personel", tip: "metin", genislik: 26 }, { ad: "Tür", tip: "metin", genislik: 9 }, { ad: "Sıra", tip: "sayi", genislik: 6, toplam: false },
        { ad: "Dosya no", tip: "metin", genislik: 13 }, { ad: "İcra dairesi", tip: "metin", genislik: 26 }, { ad: "Esas no", tip: "metin", genislik: 14 }, { ad: "Alacaklı", tip: "metin", genislik: 26 },
        { ad: "Ödeme hesabı (IBAN)", tip: "metin", genislik: 32 }, { ad: "Nafaka kesintisi", tip: "para", genislik: 16 }, { ad: "İcra kesintisi", tip: "para", genislik: 16 }, { ad: "Toplam kesinti", tip: "para", genislik: 16 },
        { ad: "Net maaş", tip: "para", genislik: 14, toplam: false }, { ad: "Kalan borç", tip: "para", genislik: 14, toplam: false }, { ad: "Durum", tip: "metin", genislik: 11 },
      ],
      satirlar,
    });
  };

  const toplam = v?.kisiler.reduce((t, k) => t + k.toplam, 0) ?? 0;
  const eksik = v?.kisiler.filter((k) => k.netMaas == null && k.satirlar.some((s) => s.tur === "icra") || k.uyarilar.length > 0) ?? [];
  return (
    <>
      <div className="hk-filtre">
        <Select value={donem} onChange={setDonem} options={donemler()} style={{ width: 190 }} />
        <span style={{ color: "var(--s)", fontSize: 13 }}>{v ? `${v.kisiler.length} personel · toplam ${paraTam(toplam)}` : "…"}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {icraBen.hak === "tam" && <button className="hk-btn koyu" onClick={() => kaydet()} disabled={!v || v.kisiler.length === 0}><Calculator /> Hesapla ve kaydet</button>}
          <button className="hk-btn" onClick={excel} disabled={!v || v.kisiler.length === 0}><Download /> Excel (bordro listesi)</button>
        </div>
      </div>
      {eksik.length > 0 && <div className="hk-uyari">{eksik.length} personelde uyarı var (net maaş bulunamadı ya da kesinti sınırı). Satırlardaki notu okuyup gerekirse net maaşı elle giriniz.</div>}
      <div className="hk-pk">
        {v === null ? <div className="hk-bos"><Spin /></div> : v.kisiler.length === 0 ? <div className="hk-bos"><Banknote /><b>Bu dönemde kesinti yok</b>Açık icra ya da nafaka dosyası bulunmuyor.</div> : (
          <div className="hk-tablo"><table>
            <thead><tr><th>Personel</th><th>Dosya</th><th>Sıra</th><th>Alacaklı · hesap</th><th style={{ textAlign: "right" }}>Net maaş</th><th style={{ textAlign: "right" }}>Kesinti</th><th>Ödeme</th></tr></thead>
            <tbody>
              {v.kisiler.map((k) => k.satirlar.length === 0 ? (
                <tr key={k.sicil} style={{ cursor: "default" }}>
                  <td><span className="ad">{k.personelAd}</span><small className="mono">{k.sicil}</small></td>
                  <td colSpan={6}><small style={{ color: "var(--kir)" }}>{k.uyarilar.join(" ") || "Bu dönem kesinti yok."}</small>
                    {icraBen.hak === "tam" && k.netMaas == null && <NetMaasElle sicil={k.sicil} donem={donem} degisti={() => setSurum((s) => s + 1)} />}</td>
                </tr>
              ) : k.satirlar.map((s, i) => (
                <tr key={`${k.sicil}-${s.dosyaId}`} onClick={() => ac(s.dosyaId)}>
                  {i === 0 && <td rowSpan={k.satirlar.length} style={{ verticalAlign: "top" }}>
                    <span className="ad">{k.personelAd}</span><small className="mono">{k.sicil}</small>
                    {k.uyarilar.map((u, j) => <div key={j}><small style={{ color: "var(--kir)" }}>{u}</small></div>)}
                    {!k.kaydedildi && <div><span className="hk-etiket e-tur">kaydedilmedi</span></div>}
                  </td>}
                  <td><span className={"hk-etiket " + (s.tur === "nafaka" ? "e-kir" : "e-alt")}>{s.tur === "nafaka" ? "Nafaka" : "İcra"}</span><br /><small className="mono">{s.dosyaNo} · {s.esasNo ?? ""}</small></td>
                  <td>{s.tur === "nafaka" ? "—" : <span className="hk-sira">{s.sira}</span>}</td>
                  <td>{s.alacakli ?? "—"}<br /><small className="mono">{s.odemeHesabi ?? "hesap girilmemiş"}</small></td>
                  {i === 0 && <td rowSpan={k.satirlar.length} className="mono" style={{ textAlign: "right", verticalAlign: "top" }} onClick={(e) => e.stopPropagation()}>
                    {paraTam(k.netMaas)}<br /><small>{k.maasKaynak === "elle" ? "elle" : k.maasKaynak === "bordro" ? "bordro" : "yok"}</small>
                    {icraBen.hak === "tam" && !k.kaydedildi && <NetMaasElle sicil={k.sicil} donem={donem} degisti={() => setSurum((x) => x + 1)} mevcut={k.netMaas} />}
                  </td>}
                  <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>{paraTam(s.tutar)}{s.tur === "icra" && <><br /><small style={{ fontWeight: 400 }}>kalan {paraTam(s.kalanSonra)}</small></>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {s.kesintiId == null ? <small>kaydedince</small> : s.odendi ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        <span className="hk-etiket e-yes">Ödendi {tarihYaz(s.odemeTarihi)}</span>
                        {s.dekontId ? <a className="hk-link" href={icraBelgeAdresi(s.dekontId)} target="_blank" rel="noopener"><Receipt size={12} /> {s.dekontAd}</a>
                          : icraBen.hak === "tam" && <a className="hk-link" onClick={() => { dekontKid.current = s.kesintiId; dekontGir.current?.click(); }}><Upload size={12} /> Dekont ekle</a>}
                        {icraBen.hak === "tam" && <a className="hk-link" style={{ color: "var(--s)" }} onClick={() => odendi(s.kesintiId!, true)}>Geri al</a>}
                      </div>
                    ) : icraBen.hak === "tam" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="hk-btn kucuk" onClick={() => odendi(s.kesintiId!)}><Check /> Ödendi</button>
                        <button className="hk-btn kucuk" onClick={() => { dekontKid.current = s.kesintiId; dekontGir.current?.click(); }}><Upload /> Dekont</button>
                      </div>
                    ) : <span className="hk-etiket e-tur">Bekliyor</span>}
                  </td>
                </tr>
              )))}
            </tbody>
          </table></div>
        )}
        <input ref={dekontGir} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) dekontYukle(f); e.target.value = ""; }} />
      </div>
      <small style={{ color: "var(--s)" }}>Kesinti = nafakaların tamamı + net maaşın %{Math.round((v?.oran ?? 0.25) * 100)}'i sıradaki icra dosyasına; artan kısım aynı ay sonraki dosyaya devreder, toplam net maaşı aşamaz. Oran Yönetim › Süreler ve sınırlar › İcra'dan değiştirilebilir.</small>
    </>
  );
}

function NetMaasElle({ sicil, donem, degisti, mevcut }: { sicil: string; donem: string; degisti: () => void; mevcut?: number | null }) {
  const { message } = AntdApp.useApp();
  const [acik, setAcik] = useState(false);
  const [v, setV] = useState<number | null>(mevcut ?? null);
  if (!acik) return <div><a className="hk-link" onClick={() => setAcik(true)}><Pencil size={12} /> Net maaş gir</a></div>;
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
      <InputNumber size="small" value={v} onChange={(x) => setV(x as number | null)} {...paraGiris} style={{ width: 120 }} autoFocus />
      <button className="hk-btn kucuk koyu" onClick={async () => { try { await api.gonder("/api/Hukuk/Icra/Maas", { sicil, donem, netMaas: v }); setAcik(false); degisti(); } catch (e: any) { message.error(e.message); } }}><Check /></button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* İcra sayfası (liste + dönem)                                         */
/* ------------------------------------------------------------------ */

export function IcraSayfasi({ icraBen, ac, surum, yeniDosya, baslangicSekme }: { icraBen: IcraBen; ac: (id: number) => void; surum: number; yeniDosya: () => void; baslangicSekme?: string }) {
  const [sekme, setSekme] = useState(baslangicSekme ?? "dosyalar");
  const [durum, setDurum] = useState("acik");
  const [tur, setTur] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [v, setV] = useState<{ dosyalar: IcraDosya[]; sayilar: { acik: number; askida: number; kapandi: number } } | null>(null);
  const [o, setO] = useState<IcraOzet | null>(null);

  useEffect(() => { api.al<IcraOzet>("/api/Hukuk/Icra/Ozet").then(setO).catch(() => {}); }, [surum]);
  useEffect(() => {
    if (sekme !== "dosyalar") return;
    const t = setTimeout(() => {
      const p = new URLSearchParams({ durum });
      if (tur) p.set("tur", tur);
      if (q.trim()) p.set("q", q.trim());
      api.al<any>(`/api/Hukuk/Icra/Dosyalar?${p}`).then(setV).catch(() => setV({ dosyalar: [], sayilar: { acik: 0, askida: 0, kapandi: 0 } }));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [durum, tur, q, surum, sekme]);

  return (
    <>
      <div className="hk-ph">
        <div><h1>İcra / maaş haczi</h1><p>Haciz ihbarnameleri, nafaka kesintileri, sıra ve aylık kesinti listesi</p></div>
        {icraBen.hak === "tam" && <div className="sag"><button className="hk-btn koyu" onClick={yeniDosya}><FolderPlus /> Yeni icra dosyası</button></div>}
      </div>
      <div className="hk-kpi">
        <div className="vurgu"><small>Açık icra dosyası</small><b>{o?.icra ?? "–"}</b><span>{o ? `${o.personel} personel · ${o.nafaka} nafaka` : "—"}</span></div>
        <div><small>Cevap süresi</small><b style={{ color: o?.cevapGecti ? "var(--kir)" : undefined }}>{o ? o.cevapGecti + o.cevapYakin : "–"}</b><span>{o ? `${o.cevapGecti} geçti · ${o.cevapYakin} 3 gün içinde` : "—"}</span></div>
        <div><small>Bu ay kesinti</small><b style={{ fontSize: 22 }}>{o ? paraTam(o.buAyKesinti) : "–"}</b><span>{o ? (o.buAyOdenmemis ? `${o.buAyOdenmemis} ödeme bekliyor` : "kaydedilen satırlar") : "—"}</span></div>
        <div><small>Toplam açık borç</small><b style={{ fontSize: 22 }}>{o ? paraTam(o.toplamBorc) : "–"}</b><span>icra dosyaları</span></div>
        <div><small>Ayrılan personel</small><b style={{ color: o?.ayrilan ? "var(--kir)" : undefined }}>{o?.ayrilan ?? "–"}</b><span>açık icrası olan</span></div>
      </div>
      <div className="hk-sekme">
        <button className={sekme === "dosyalar" ? "on" : ""} onClick={() => setSekme("dosyalar")}>Dosyalar</button>
        <button className={sekme === "donem" ? "on" : ""} onClick={() => setSekme("donem")}>Aylık kesinti listesi</button>
      </div>
      {sekme === "donem" ? <DonemListesi icraBen={icraBen} ac={ac} /> : (
        <>
          <div className="hk-filtre">
            <div className="hk-seg">
              <button className={durum === "acik" ? "on" : ""} onClick={() => setDurum("acik")}>Açık<em>{v?.sayilar.acik ?? ""}</em></button>
              <button className={durum === "askida" ? "on" : ""} onClick={() => setDurum("askida")}>Askıda<em>{v?.sayilar.askida ?? ""}</em></button>
              <button className={durum === "kapandi" ? "on" : ""} onClick={() => setDurum("kapandi")}>Kapanan<em>{v?.sayilar.kapandi ?? ""}</em></button>
              <button className={durum === "hepsi" ? "on" : ""} onClick={() => setDurum("hepsi")}>Tümü</button>
            </div>
            <Select allowClear placeholder="Tür" value={tur} onChange={setTur} style={{ width: 170 }} options={icraBen.turler.map((t) => ({ value: t.kod, label: t.ad }))} />
            <Input prefix={<Search size={15} color="#9a9eab" />} placeholder="Personel, sicil, alacaklı, esas no, daire" value={q} onChange={(e) => setQ(e.target.value)} allowClear style={{ maxWidth: 340 }} />
          </div>
          <div className="hk-pk">
            {v === null ? <div className="hk-bos"><Spin /></div> : v.dosyalar.length === 0
              ? <div className="hk-bos"><Landmark /><b>İcra dosyası yok</b>Filtreyi değiştirin ya da tebligat geldiğinde yeni dosya açın.</div>
              : <IcraTablosu l={v.dosyalar} ac={ac} />}
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Dosya sayfası                                                        */
/* ------------------------------------------------------------------ */

const SEKMELER = [
  { kod: "ozet", ad: "Özet" }, { kod: "cizelge", ad: "Zaman çizelgesi" }, { kod: "kesinti", ad: "Kesintiler" },
  { kod: "belge", ad: "Belgeler" }, { kod: "yazi", ad: "Hazır yazılar" }, { kod: "gunluk", ad: "Günlük" },
];

function YaziKutusu({ baslik, yol, not }: { baslik: string; yol: string; not?: string }) {
  const { message } = AntdApp.useApp();
  const [metin, setMetin] = useState<string | null>(null);
  useEffect(() => { api.al<{ metin: string }>(yol).then((r) => setMetin(r.metin)).catch((e) => setMetin(`Yazı üretilemedi: ${e.message}`)); }, [yol]);
  const kopyala = () => navigator.clipboard?.writeText(metin ?? "").then(() => message.success("Kopyalandı.")).catch(() => message.warning("Kopyalanamadı; metni seçip kopyalayın."));
  const yazdir = () => {
    const w = window.open("", "_blank", "noopener,width=800,height=900"); if (!w) return;
    w.document.write(`<pre style="font:14px/1.6 Georgia,serif;white-space:pre-wrap;padding:40px">${(metin ?? "").replace(/</g, "&lt;")}</pre>`);
    w.document.close(); w.focus(); w.print();
  };
  return (
    <div className="hk-pk" style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0 }}>{baslik}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="hk-btn kucuk" onClick={kopyala} disabled={!metin}><ClipboardCopy /> Kopyala</button>
          <button className="hk-btn kucuk" onClick={yazdir} disabled={!metin}><Printer /> Yazdır</button>
        </span>
      </h3>
      {not && <small style={{ color: "var(--s)" }}>{not}</small>}
      {metin === null ? <Spin /> : <Input.TextArea value={metin} onChange={(e) => setMetin(e.target.value)} autoSize={{ minRows: 12, maxRows: 40 }} className="hk-metin" />}
    </div>
  );
}

export function IcraDosyaSayfasi({ id, icraBen, geri, degisti }: { id: number; icraBen: IcraBen; geri: () => void; degisti: () => void }) {
  const { message, modal } = AntdApp.useApp();
  const [v, setV] = useState<Detay | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [sekme, setSekme] = useState("ozet");
  const [duzenle, setDuzenle] = useState(false);
  const [olayForm, setOlayForm] = useState(false);
  const [siraForm, setSiraForm] = useState<{ sira: number | null; not: string } | null>(null);
  const [durumForm, setDurumForm] = useState<{ durum: string; not: string } | null>(null);
  const [gunluk, setGunluk] = useState<any[] | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [surukle, setSurukle] = useState(false);
  const dosyaGir = useRef<HTMLInputElement>(null);
  const dekontGir = useRef<HTMLInputElement>(null);
  const dekontKid = useRef<number | null>(null);

  const yukle = useCallback(() => api.al<Detay>(`/api/Hukuk/Icra/Dosya/${id}`).then(setV).catch((e) => setHata(e.message)), [id]);
  useEffect(() => { setV(null); setSekme("ozet"); yukle(); }, [yukle]);
  useEffect(() => { if (sekme === "gunluk") api.al<{ gunluk: any[] }>(`/api/Hukuk/Icra/Dosya/${id}/Gunluk`).then((r) => setGunluk(r.gunluk)).catch(() => setGunluk([])); }, [sekme, id]);

  if (hata) return <div className="hk-bos"><b>Dosya açılamadı</b>{hata}<button className="hk-btn" onClick={geri}>Geri dön</button></div>;
  if (!v) return <div className="hk-bos"><Spin /></div>;
  const d = v.dosya;
  const tam = v.hak === "tam";
  const yuzde = d.toplamBorc > 0 ? Math.min(100, Math.round((d.odenen / d.toplamBorc) * 100)) : 0;

  const belgeYukle = async (l: File[]) => {
    if (!l.length) return;
    const f = new FormData(); l.forEach((x) => f.append("dosyalar", x, x.name));
    setYukleniyor(true);
    try { await api.dosyaGonder(`/api/Hukuk/Icra/Dosya/${id}/Belge`, f); message.success(`${l.length} belge eklendi.`); yukle(); }
    catch (e: any) { message.error(e.message); } finally { setYukleniyor(false); }
  };
  const belgeSil = (b: IcraBelge) => modal.confirm({
    title: "Belge kaldırılsın mı?", content: b.ad, okText: "Kaldır", cancelText: "Vazgeç", okButtonProps: { danger: true },
    onOk: async () => { try { await api.sil(`/api/Hukuk/Icra/Belge/${b.id}`); yukle(); } catch (e: any) { message.error(e.message); } },
  });
  const olaySil = (o: IcraOlay) => modal.confirm({
    title: "Kayıt silinsin mi?", content: o.baslik, okText: "Sil", cancelText: "Vazgeç", okButtonProps: { danger: true },
    onOk: async () => { try { await api.sil(`/api/Hukuk/Icra/Olay/${o.id}`); yukle(); } catch (e: any) { message.error(e.message); } },
  });
  const odendi = async (k: Kesinti, geri = false) => {
    try {
      const r = await api.gonder<{ kapandi: boolean }>(`/api/Hukuk/Icra/Kesinti/${k.id}/Odendi`, { odendi: !geri });
      if (r.kapandi) message.success("Borç tamamlandı; dosya kapandı, sıra bir sonraki dosyaya geçti.");
      yukle(); degisti();
    } catch (e: any) { message.error(e.message); }
  };
  const dekontYukle = async (f: File) => {
    const kid = dekontKid.current; if (!kid) return;
    const form = new FormData(); form.append("dosyalar", f, f.name);
    try {
      const r = await api.dosyaGonder<{ kapandi: boolean }>(`/api/Hukuk/Icra/Kesinti/${kid}/Dekont`, form);
      message.success(r.kapandi ? "Dekont eklendi; borç tamamlandı, dosya kapandı." : "Dekont eklendi; kesinti ödendi işaretlendi.");
      yukle(); degisti();
    } catch (e: any) { message.error(e.message); }
  };
  const siraYaz = async () => {
    if (!siraForm) return;
    try { await api.gonder(`/api/Hukuk/Icra/Dosya/${id}/Sira`, siraForm); message.success("Sıra kaydedildi."); setSiraForm(null); yukle(); degisti(); }
    catch (e: any) { message.error(e.message); }
  };
  const durumYaz = async () => {
    if (!durumForm) return;
    try { await api.gonder(`/api/Hukuk/Icra/Dosya/${id}/Durum`, durumForm); message.success("Durum güncellendi."); setDurumForm(null); yukle(); degisti(); }
    catch (e: any) { message.error(e.message); }
  };
  const hesaplaKaydet = () => modal.confirm({
    title: "Bu ayın kesintisi kaydedilsin mi?", content: "Personelin bu dönemdeki bütün dosyaları için kesinti satırları yazılır.", okText: "Kaydet", cancelText: "Vazgeç",
    onOk: async () => { try { await api.gonder(`/api/Hukuk/Icra/Donem/Kaydet?donem=${v.buAy?.donem}&sicil=${d.sicil}`, {}); message.success("Kaydedildi."); yukle(); } catch (e: any) { message.error(e.message); } },
  });
  const ISLEM: Record<string, string> = {
    dosya_ac: "Dosyayı açtı", dosya_ac_yeni: "Dosyayı oluşturdu", dosya_guncelle: "Dosyayı güncelledi", belge_ac: "Belgeyi açtı", belge_yukle: "Belge yükledi",
    belge_sil: "Belgeyi kaldırdı", olay_ekle: "Kayıt ekledi", olay_sil: "Kaydı sildi", sira: "Sırayı değiştirdi", odendi: "Ödendi işaretledi", odendi_geri: "Ödemeyi geri aldı",
    dekont_yukle: "Dekont yükledi", cevap_yazisi: "Cevap yazısını açtı", ayrilis_yazisi: "Ayrılış yazısını açtı",
  };

  return (
    <>
      <button className="hk-geri" onClick={geri}><ArrowLeft size={16} /> İcra dosyaları</button>
      <div className="hk-dust icra">
        <div>
          <div className="tur">{d.turAdi} · {d.dosyaNo}{d.durum !== "acik" ? ` · ${d.durumAdi.toLocaleUpperCase("tr")}` : ""}</div>
          <h1>{d.personelAd ?? d.sicil}</h1>
          <small>{[d.sicil, v.personel?.pozisyon, v.personel?.sube].filter(Boolean).join(" · ")}{v.personel && !v.personel.aktif ? " · AYRILDI" : ""}</small>
        </div>
        <div className="sag">
          {tam && <button className="hk-btn" onClick={() => setDuzenle(true)}><Pencil /> Düzenle</button>}
          {tam && d.tur === "icra" && d.durum === "acik" && <button className="hk-btn" onClick={() => setSiraForm({ sira: d.siraElle ?? d.sira, not: "" })}>Sıra</button>}
          {tam && (d.durum === "acik"
            ? <button className="hk-btn altin" onClick={() => setDurumForm({ durum: "kapandi", not: "" })}>Durum / kapat</button>
            : <button className="hk-btn" onClick={() => setDurumForm({ durum: "acik", not: "" })}><RotateCcw /> Yeniden aç</button>)}
        </div>
        <div className="s4">
          <div>Sıra<b>{d.durum !== "acik" ? d.durumAdi : d.tur === "nafaka" ? "Öncelikli" : d.sira ? `${d.sira}. sıra${d.siraElle ? " (elle)" : ""}` : "—"}</b></div>
          <div>{d.tur === "nafaka" ? "Aylık nafaka" : "Toplam borç"}<b className="mono">{paraTam(d.tur === "nafaka" ? d.aylikTutar : d.toplamBorc)}</b></div>
          <div>Ödenen<b className="mono">{paraTam(d.odenen)}{d.tur === "icra" ? ` (%${yuzde})` : ""}</b></div>
          <div>{d.tur === "nafaka" ? "Başlangıç" : "Kalan borç"}<b className="mono">{d.tur === "nafaka" ? tarihYaz(d.baslangic) : paraTam(d.kalan)}</b></div>
          <div>Tebligat<b>{tarihYaz(d.tebligTarihi)}<br /><CevapDurumu d={d} /></b></div>
        </div>
        {d.tur === "icra" && <div className="hk-bar"><i style={{ width: `${yuzde}%` }} /></div>}
      </div>

      {d.ayrilisBildirildi && (
        <div className="hk-uyari kir"><UserX size={16} /> Personel işten ayrıldı ({tarihYaz(v.personel?.cikis)}). Kesinti yapılamaz; icra dairesine ayrılış yazısı gönderip dosyayı kapatınız.
          <a className="hk-link" onClick={() => setSekme("yazi")}>Hazır yazı</a></div>
      )}
      {d.tur === "icra" && d.durum === "acik" && d.cevapSuresi && !d.cevapTarihi && kalan(d.cevapSuresi).renk === "var(--kir)" && (
        <div className="hk-uyari kir"><FileText size={16} /> Haciz ihbarnamesine cevap süresi: {kalan(d.cevapSuresi).metin} ({tarihYaz(d.cevapSuresi)}). <a className="hk-link" onClick={() => setSekme("yazi")}>Cevap yazısını aç</a></div>
      )}

      <div className="hk-sekme">
        {SEKMELER.filter((s) => s.kod !== "gunluk" || tam).map((s) => (
          <button key={s.kod} className={sekme === s.kod ? "on" : ""} onClick={() => setSekme(s.kod)}>
            {s.ad}
            {s.kod === "cizelge" && <em>{v.olaylar.length}</em>}{s.kod === "kesinti" && <em>{v.kesintiler.length}</em>}{s.kod === "belge" && <em>{v.belgeler.length}</em>}
          </button>
        ))}
      </div>

      {sekme === "ozet" && (
        <div className="hk-iki">
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <div className="hk-pk">
              <h3>Dosya bilgileri <small>Açılış {tarihYaz(d.olusturma)}</small></h3>
              <div className="hk-alanlar">
                <div><span>İcra dairesi</span>{d.icraDairesi || "—"}</div>
                <div><span>Esas no</span><span className="mono" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13.5, color: "inherit", fontWeight: 500 }}>{d.esasNo || "—"}</span></div>
                <div><span>Alacaklı</span>{d.alacakli || "—"}</div>
                <div><span>Alacaklı vekili</span>{d.alacakliVekili || "—"}</div>
                <div><span>Tebliğ</span>{tarihYaz(d.tebligTarihi)}</div>
                <div><span>Geliş</span>{tarihYaz(d.gelisTarihi)}</div>
                {d.tur === "icra" && <>
                  <div><span>Asıl alacak</span>{paraTam(d.asilAlacak)}</div>
                  <div><span>Faiz + masraf</span>{paraTam((d.faiz ?? 0) + (d.masraf ?? 0))}</div>
                </>}
                <div style={{ gridColumn: "1 / -1" }}><span>Ödeme hesabı</span><span className="mono" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13.5, color: "inherit", fontWeight: 500 }}>{d.odemeHesabi || "girilmemiş"}</span></div>
                {d.siraElle && <div style={{ gridColumn: "1 / -1" }}><span>Elle sıra gerekçesi</span>{d.siraNotu}</div>}
              </div>
              {d.notlar && <><h3 style={{ marginTop: 20 }}>Not</h3><p className="hk-ozet">{d.notlar}</p></>}
            </div>
            {v.buAy && (
              <div className="hk-pk">
                <h3>Bu ayın kesintisi
                  {tam && !v.buAy.kaydedildi && v.buAy.satirlar.length > 0 && <button className="hk-btn koyu kucuk" style={{ marginLeft: "auto" }} onClick={hesaplaKaydet}><Calculator /> Kaydet</button>}
                </h3>
                <HesapKutusu h={v.buAy} hak={v.hak} yenile={yukle} />
              </div>
            )}
          </div>
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <div className="hk-pk">
              <h3>Personel</h3>
              {v.personel ? (
                <div className="hk-alanlar">
                  <div><span>Ad</span>{v.personel.ad}</div><div><span>Durum</span>{v.personel.aktif ? <span className="hk-etiket e-yes">Çalışıyor</span> : <span className="hk-etiket e-kir">Ayrıldı · {tarihYaz(v.personel.cikis)}</span>}</div>
                  <div><span>Pozisyon</span>{v.personel.pozisyon ?? "—"}</div><div><span>Şube</span>{v.personel.sube ?? "—"}</div>
                  <div><span>Giriş</span>{tarihYaz(v.personel.giris)}</div>
                </div>
              ) : <small style={{ color: "var(--s)" }}>Bu sicil personel listesinde bulunamadı.</small>}
            </div>
            <div className="hk-pk">
              <h3>Personelin diğer dosyaları <small>{v.digerDosyalar.length}</small></h3>
              {v.digerDosyalar.length === 0 ? <small style={{ color: "var(--s)" }}>Başka icra / nafaka dosyası yok.</small> : v.digerDosyalar.map((x) => (
                <div key={x.id} className="hk-olay" style={{ marginBottom: 8, cursor: "default" }}>
                  <Sira d={x} />
                  <div><b>{x.alacakli ?? x.dosyaNo}</b><small>{x.dosyaNo} · {[x.icraDairesi, x.esasNo].filter(Boolean).join(" ")} · {x.tur === "nafaka" ? `${paraTam(x.aylikTutar)} / ay` : `kalan ${paraTam(x.kalan)}`}</small></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {sekme === "cizelge" && (
        <div className="hk-pk">
          <h3>Zaman çizelgesi
            {tam && <button className="hk-btn koyu kucuk" style={{ marginLeft: "auto" }} onClick={() => setOlayForm(true)}>+ Olay ekle</button>}
          </h3>
          <div className="hk-cz">
            {v.olaylar.map((o) => (
              <div key={o.id} className="hk-ce">
                <i className={o.tur === "odeme" || o.tur === "kapandi" ? "" : o.tur === "tebligat" || o.tur === "ayrilis" ? "k" : o.tur === "not" ? "b" : "a"} />
                <div>
                  <span className={"hk-etiket " + (OLAY_SINIF[o.tur] ?? "e-gri")}>{o.turAdi}</span>
                  {o.tutar != null && <span className="mono" style={{ marginLeft: 8, fontWeight: 700 }}>{paraTam(o.tutar)}</span>}
                  <b style={{ marginTop: 4 }}>{o.baslik}</b>
                  <small>{tarihYaz(o.tarih, true)}{o.ekleyenAd ? ` · ${o.ekleyenAd}` : ""}</small>
                  {o.aciklama && <p>{o.aciklama}</p>}
                </div>
                {tam && !["kesinti", "odeme", "kapandi"].includes(o.tur) && <div className="isl"><button className="hk-btn kucuk tehlike" title="Sil" onClick={() => olaySil(o)}><Trash2 /></button></div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {sekme === "kesinti" && (
        <div className="hk-pk">
          <h3>Kesintiler ve ödemeler <small>{paraTam(d.odenen)} ödendi · {paraTam(d.kesilen - d.odenen)} ödeme bekliyor</small></h3>
          {v.kesintiler.length === 0 ? <div className="hk-bos"><Banknote /><b>Henüz kesinti yok</b>Aylık kesinti listesinden "Hesapla ve kaydet" ile başlar.</div> : (
            <div className="hk-tablo"><table style={{ minWidth: 600 }}>
              <thead><tr><th>Dönem</th><th>Sıra</th><th style={{ textAlign: "right" }}>Net maaş</th><th style={{ textAlign: "right" }}>Kesinti</th><th>Ödeme</th><th>Dekont</th></tr></thead>
              <tbody>{v.kesintiler.map((k) => (
                <tr key={k.id} style={{ cursor: "default" }}>
                  <td><b>{k.donemAdi}</b></td>
                  <td>{k.tur === "nafaka" ? <span className="hk-etiket e-kir">Nafaka</span> : <span className="hk-sira">{k.sira ?? "—"}</span>}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{paraTam(k.netMaas)}<br /><small>{k.maasKaynak ?? ""}</small></td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>{paraTam(k.tutar)}</td>
                  <td>{k.odendi ? <span className="hk-etiket e-yes">Ödendi {tarihYaz(k.odemeTarihi)}</span> : <span className="hk-etiket e-tur">Bekliyor</span>}
                    {tam && <div style={{ marginTop: 4 }}>{k.odendi ? <a className="hk-link" style={{ color: "var(--s)" }} onClick={() => odendi(k, true)}>Geri al</a> : <button className="hk-btn kucuk" onClick={() => odendi(k)}><Check /> Ödendi</button>}</div>}</td>
                  <td>{k.dekontId ? <a className="hk-link" href={icraBelgeAdresi(k.dekontId)} target="_blank" rel="noopener"><Receipt size={12} /> {k.dekontAd}</a>
                    : tam ? <button className="hk-btn kucuk" onClick={() => { dekontKid.current = k.id; dekontGir.current?.click(); }}><Upload /> Dekont ekle</button> : <small>—</small>}</td>
                </tr>))}
              </tbody></table></div>
          )}
          <input ref={dekontGir} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) dekontYukle(f); e.target.value = ""; }} />
        </div>
      )}

      {sekme === "belge" && (
        <div className="hk-pk" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0 }}>Belgeler <small>Tebligat taraması, haciz ihbarnamesi, dekontlar</small></h3>
          {tam && (
            <div className={"hk-surukle" + (surukle ? " ust" : "")} onClick={() => dosyaGir.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setSurukle(true); }} onDragLeave={() => setSurukle(false)}
              onDrop={(e) => { e.preventDefault(); setSurukle(false); belgeYukle(Array.from(e.dataTransfer.files)); }}>
              {yukleniyor ? <Spin /> : <><Upload size={18} style={{ verticalAlign: -4 }} /> Belgeleri buraya sürükleyin ya da tıklayıp seçin <small>(PDF, görsel, UDF, Word, Excel · en fazla 25 MB)</small></>}
              <input ref={dosyaGir} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.tif,.tiff,.udf,.doc,.docx,.xls,.xlsx" onChange={(e) => { belgeYukle(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            </div>
          )}
          {v.belgeler.length === 0 ? <div className="hk-bos"><b>Belge yok</b></div> : (
            <div className="hk-galeri">
              {v.belgeler.map((b) => (
                <div key={b.id} className="hk-bel" onClick={() => window.open(icraBelgeAdresi(b.id), "_blank", "noopener")} title={b.ad}>
                  <div className={"on " + uzantiSinif(b.uzanti)}>{["JPG", "JPEG", "PNG", "WEBP"].includes(b.uzanti) ? <img src={icraBelgeAdresi(b.id)} alt="" loading="lazy" /> : b.uzanti || "DOSYA"}</div>
                  <div className="ad">{b.ad}</div>
                  <div className="alt">{boyutYaz(b.boyut)} · {tarihYaz(b.tarih)}{b.kesintiId ? " · dekont" : ""}</div>
                  {tam && <button className="sil" title="Kaldır" onClick={(e) => { e.stopPropagation(); belgeSil(b); }}>×</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sekme === "yazi" && (
        <div style={{ display: "grid", gap: 16 }}>
          {d.tur === "icra" && <YaziKutusu baslik="Haciz ihbarnamesine cevap (İİK 89/1)" yol={`/api/Hukuk/Icra/Dosya/${id}/Cevap`}
            not={`Taslak; mevcut sıra, net maaş ve diğer haciz dosyaları otomatik yazılır. Gönderince zaman çizelgesine "Cevap yazıldı" olayı ekleyin${d.cevapSuresi ? ` (cevap süresi ${tarihYaz(d.cevapSuresi)})` : ""}. Hukuki tavsiye değildir.`} />}
          <YaziKutusu baslik="İşten ayrılış bildirimi" yol={`/api/Hukuk/Icra/Dosya/${id}/AyrilisYazisi`} not="Personel ayrıldığında icra dairesine gönderilir; ödenen toplam ve kalan borç otomatik yazılır." />
          {tam && d.tur === "icra" && !d.cevapTarihi && (
            <button className="hk-btn koyu" style={{ justifySelf: "start" }} onClick={async () => {
              try { await api.gonder(`/api/Hukuk/Icra/Dosya/${id}/Olay`, { tur: "cevap", baslik: "Cevap yazısı icra dairesine gönderildi" }); message.success("Cevap verildi olarak işaretlendi."); yukle(); degisti(); }
              catch (e: any) { message.error(e.message); }
            }}><Check /> Cevap gönderildi olarak işaretle</button>
          )}
        </div>
      )}

      {sekme === "gunluk" && (
        <div className="hk-pk">
          <h3>Erişim günlüğü <small>Son 300 işlem</small></h3>
          {gunluk === null ? <Spin /> : gunluk.length === 0 ? <small>Kayıt yok.</small> : (
            <div className="hk-tablo"><table style={{ minWidth: 520 }}>
              <thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Ayrıntı</th></tr></thead>
              <tbody>{gunluk.map((g, i) => <tr key={i} style={{ cursor: "default" }}><td className="mono">{dayjs(g.zaman).format("DD.MM.YYYY HH:mm")}</td><td>{g.ad}</td><td>{ISLEM[g.islem] ?? g.islem}</td><td><small>{g.hedef}</small></td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      )}

      <IcraDosyaFormu icraBen={icraBen} acik={duzenle} dosya={d} kapat={() => setDuzenle(false)} kaydedildi={() => { setDuzenle(false); yukle(); degisti(); }} />
      <OlayFormu icraBen={icraBen} dosyaId={id} acik={olayForm} kapat={() => setOlayForm(false)} kaydedildi={() => { setOlayForm(false); yukle(); degisti(); }} />
      <Modal open={!!siraForm} title="Sırayı elle değiştir" okText="Kaydet" cancelText="Vazgeç" onCancel={() => setSiraForm(null)} onOk={siraYaz}>
        <p style={{ color: "#6f7484" }}>Sıra normalde tebliğ tarihine göre otomatiktir. Elle verilen sıra önce gelir; boş bırakılırsa otomatiğe döner. Gerekçe zorunludur ve zaman çizelgesine yazılır.</p>
        <div style={{ display: "grid", gap: 10 }}>
          <InputNumber min={1} max={99} value={siraForm?.sira} onChange={(x) => setSiraForm((f) => f && ({ ...f, sira: x as number | null }))} placeholder="Sıra (boş = otomatik)" style={{ width: "100%" }} />
          <Input.TextArea value={siraForm?.not} onChange={(e) => setSiraForm((f) => f && ({ ...f, not: e.target.value }))} maxLength={300} placeholder="Gerekçe (ör. icra dairesinin öncelik yazısı)" autoSize={{ minRows: 2 }} />
        </div>
      </Modal>
      <Modal open={!!durumForm} title="Dosya durumu" okText="Kaydet" cancelText="Vazgeç" onCancel={() => setDurumForm(null)} onOk={durumYaz}>
        <div style={{ display: "grid", gap: 10 }}>
          <Select value={durumForm?.durum} onChange={(x) => setDurumForm((f) => f && ({ ...f, durum: x }))} options={icraBen.durumlar.map((x) => ({ value: x.kod, label: x.ad }))} />
          <Input.TextArea value={durumForm?.not} onChange={(e) => setDurumForm((f) => f && ({ ...f, not: e.target.value }))} maxLength={1000} placeholder="Açıklama (feragat yazısı, iptal kararı…)" autoSize={{ minRows: 2 }} />
          <small style={{ color: "#6f7484" }}>Kapanan, feragat ve iptal dosyalar sıradan düşer; sıra kendiliğinden kayar.</small>
        </div>
      </Modal>
    </>
  );
}

function OlayFormu({ icraBen, dosyaId, acik, kapat, kaydedildi }: { icraBen: IcraBen; dosyaId: number; acik: boolean; kapat: () => void; kaydedildi: () => void }) {
  const { message } = AntdApp.useApp();
  const [g, setG] = useState<any>({ tur: "tebligat", tarih: dayjs() });
  useEffect(() => { if (acik) setG({ tur: "tebligat", tarih: dayjs() }); }, [acik]);
  const kaydet = async () => {
    try {
      await api.gonder(`/api/Hukuk/Icra/Dosya/${dosyaId}/Olay`, { tur: g.tur, tarih: yerelTarih(g.tarih, true), baslik: g.baslik, aciklama: g.aciklama, tutar: g.tutar ?? null });
      message.success("Olay eklendi."); kaydedildi();
    } catch (e: any) { message.error(e.message); }
  };
  const turler = icraBen.olayTurleri.filter((t) => !["kesinti", "odeme", "kapandi"].includes(t.kod));
  return (
    <Modal open={acik} onCancel={kapat} onOk={kaydet} okText="Ekle" cancelText="Vazgeç" title="Zaman çizelgesine olay ekle" destroyOnClose>
      <div style={{ display: "grid", gap: 10 }}>
        <Select value={g.tur} onChange={(t) => setG({ ...g, tur: t })} options={turler.map((t) => ({ value: t.kod, label: t.ad }))} />
        <DatePicker value={g.tarih} onChange={(t) => setG({ ...g, tarih: t })} format="DD.MM.YYYY" style={{ width: "100%" }} />
        <Input value={g.baslik} onChange={(e) => setG({ ...g, baslik: e.target.value })} maxLength={200} placeholder="Başlık (ör. Ek haciz ihbarnamesi, faiz güncellemesi, feragat yazısı)" />
        <InputNumber value={g.tutar} onChange={(x) => setG({ ...g, tutar: x })} {...paraGiris} placeholder="Tutar (varsa) ₺" />
        <Input.TextArea value={g.aciklama} onChange={(e) => setG({ ...g, aciklama: e.target.value })} maxLength={1000} autoSize={{ minRows: 3 }} placeholder="Açıklama" />
        <small style={{ color: "#6f7484" }}>"Cevap yazıldı" seçilirse dosyanın cevap tarihi de işlenir. Borç tutarı değişiyorsa dosyayı Düzenle'den güncelleyin; olay kendiliğinden yazılır.</small>
      </div>
    </Modal>
  );
}

/** Masa panosundaki icra özeti (HukukMasasi › Masa) */
export function IcraOzetKarti({ git }: { git: () => void }) {
  const [o, setO] = useState<IcraOzet | null>(null);
  const [l, setL] = useState<IcraDosya[]>([]);
  useEffect(() => {
    api.al<IcraOzet>("/api/Hukuk/Icra/Ozet").then(setO).catch(() => {});
    api.al<{ dosyalar: IcraDosya[] }>("/api/Hukuk/Icra/Dosyalar?durum=acik&tur=icra").then((r) => setL(r.dosyalar.filter((d) => d.cevapSuresi && !d.cevapTarihi).sort((a, b) => dayjs(a.cevapSuresi).valueOf() - dayjs(b.cevapSuresi).valueOf()).slice(0, 5))).catch(() => {});
  }, []);
  return (
    <div className="hk-pk">
      <h3><Landmark size={17} /> İcra / maaş haczi <a onClick={git}>Tümü</a></h3>
      <div className="hk-kpi kucuk">
        <div><small>Açık icra</small><b>{o?.icra ?? "–"}</b><span>{o ? `${o.personel} personel` : ""}</span></div>
        <div><small>Nafaka</small><b>{o?.nafaka ?? "–"}</b><span>dosya</span></div>
        <div><small>Cevap süresi</small><b style={{ color: o?.cevapGecti ? "var(--kir)" : undefined }}>{o ? o.cevapGecti + o.cevapYakin : "–"}</b><span>{o ? `${o.cevapGecti} geçti` : ""}</span></div>
        <div><small>Bu ay</small><b style={{ fontSize: 20 }}>{o ? paraTam(o.buAyKesinti) : "–"}</b><span>kesinti</span></div>
      </div>
      {l.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <small style={{ color: "var(--s)", fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>Cevap bekleyen tebligatlar</small>
          {l.map((d) => (
            <div key={d.id} className="hk-olay" style={{ marginTop: 6 }} onClick={git}>
              <span className="hk-etiket e-kir">Tebligat</span>
              <div><b>{d.personelAd ?? d.sicil}</b><small>{[d.icraDairesi, d.esasNo].filter(Boolean).join(" ")} · tebliğ {tarihYaz(d.tebligTarihi)}</small></div>
              <span className="hk-sayac" style={{ color: kalan(d.cevapSuresi!).renk }}>{kalan(d.cevapSuresi!).metin}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

