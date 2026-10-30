/**
 * Personel Bütçesi › Kişiler (30.10.2026): aranabilir / süzülebilir
 * düzenlenebilir liste, toplu düzenleme (zam, gün, emekli, pasif), kişi
 * ekleme ve kişi çekmecesi (12 aylık bordro, Excel'deki sütunlarla).
 *
 * Süzme tarayıcıda yapılır: ücret verisi sorgu dizesine çıkmaz.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Checkbox, Drawer, Input, InputNumber, Modal, Select, Spin } from "antd";
import { AlertTriangle, Download, Pencil, Plus, Search, Trash2, UserCheck, Users, X } from "lucide-react";
import type { Donem, Kisi, KisiDetay, KisiGirdi, YanGider } from "./butceOrtak";
import { butceApi, kucult, para, paraKurus, sayi, yuzde } from "./butceOrtak";
import { bordroExcel, kisilerExcel } from "./butceCikti";

interface Props {
  donem: Donem;
  subeler: string[];
  meslekler: string[];
  /** Parametredeki yan gider kalemleri (kişiye özel tutar için) */
  yanGiderKalemleri: YanGider[];
  /** Özet'ten gelen ön süzgeç */
  onSuzgec?: { sube?: string; meslek?: string } | null;
  degisti: () => void;
}

type Sira = "ad" | "sube" | "grm" | "bordroNet" | "toplam" | "zam";

export default function ButceKisiler({ donem, subeler, meslekler, yanGiderKalemleri, onSuzgec, degisti }: Props) {
  const { message, modal } = AntdApp.useApp();
  const [kisiler, setKisiler] = useState<Kisi[] | null>(null);
  const [q, setQ] = useState("");
  const [sube, setSube] = useState<string | undefined>(onSuzgec?.sube);
  const [meslek, setMeslek] = useState<string | undefined>(onSuzgec?.meslek);
  const [durum, setDurum] = useState<"aktif" | "pasif" | "hepsi">("aktif");
  const [sira, setSira] = useState<Sira>("sube");
  const [secili, setSecili] = useState<Set<number>>(new Set());
  const [acikKisi, setAcikKisi] = useState<number | null>(null);
  const [duzenlenen, setDuzenlenen] = useState<Kisi | "yeni" | null>(null);
  const [topluAcik, setTopluAcik] = useState(false);

  useEffect(() => { setSube(onSuzgec?.sube); setMeslek(onSuzgec?.meslek); }, [onSuzgec]);

  const yukle = useCallback(async () => {
    try { const r = await butceApi.kisiler(donem.id); setKisiler(r.kisiler); }
    catch (h: any) { message.error(h?.message ?? "Kişiler okunamadı"); setKisiler([]); }
  }, [donem.id, message]);
  useEffect(() => { void yukle(); }, [yukle]);

  const liste = useMemo(() => {
    if (!kisiler) return [];
    const qq = kucult(q.trim());
    const l = kisiler.filter((k) =>
      (durum === "hepsi" || (durum === "aktif") === k.aktif) &&
      (!sube || k.sube === sube) && (!meslek || k.meslek === meslek) &&
      (!qq || kucult(k.ad).includes(qq) || (k.sicil ?? "").includes(qq) || kucult(k.sube).includes(qq) || kucult(k.meslek).includes(qq)));
    return l.sort((a, b) =>
      sira === "ad" ? (a.ad ?? "").localeCompare(b.ad ?? "", "tr")
      : sira === "sube" ? (a.sube ?? "").localeCompare(b.sube ?? "", "tr") || (a.ad ?? "").localeCompare(b.ad ?? "", "tr")
      : sira === "grm" ? b.grm - a.grm : sira === "bordroNet" ? b.bordroNet - a.bordroNet
      : sira === "zam" ? (b.zamOrani ?? 0) - (a.zamOrani ?? 0) : b.yillikToplam - a.yillikToplam);
  }, [kisiler, q, sube, meslek, durum, sira]);

  const toplam = useMemo(() => liste.reduce((t, k) => ({ toplam: t.toplam + (k.aktif ? k.yillikToplam : 0), fte: t.fte + (k.aktif ? (k.gun >= 30 ? 1 : 0.5) : 0), grm: t.grm + (k.aktif ? k.grm : 0) }), { toplam: 0, fte: 0, grm: 0 }), [liste]);

  const sil = (k: Kisi) => modal.confirm({
    title: `${k.ad} silinsin mi?`, content: "Kişi bu senaryodan tamamen çıkar. Ayrılacak kişiyi silmek yerine pasife almak genelde daha doğrudur.",
    okText: "Sil", okButtonProps: { danger: true }, cancelText: "Vazgeç",
    onOk: async () => { await butceApi.kisiSil(donem.id, k.id); message.success("Silindi"); void yukle(); degisti(); },
  });

  const tumunuSec = (e: boolean) => setSecili(e ? new Set(liste.map((k) => k.id)) : new Set());

  const Bas = ({ k, ad, sag }: { k: Sira; ad: string; sag?: boolean }) => (
    <th className={sag ? "sag" : ""}><button onClick={() => setSira(k)} style={{ fontWeight: 700, color: sira === k ? "#17321f" : undefined }}>{ad}{sira === k ? " ↓" : ""}</button></th>
  );

  return (
    <div className="pb-pk">
      <div className="pb-filtre">
        <Input allowClear prefix={<Search size={14} />} placeholder="Ad, sicil, şube, meslek ara" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear showSearch placeholder="Şube" value={sube} onChange={setSube} options={subeler.map((s) => ({ value: s, label: s }))} />
        <Select allowClear showSearch placeholder="Meslek" value={meslek} onChange={setMeslek} options={meslekler.map((s) => ({ value: s, label: s }))} />
        <div className="pb-seg">
          {(["aktif", "pasif", "hepsi"] as const).map((d) => <button key={d} className={durum === d ? "on" : ""} onClick={() => setDurum(d)}>{d === "aktif" ? "Aktif" : d === "pasif" ? "Pasif" : "Hepsi"}</button>)}
        </div>
        <div className="bosluk" />
        <button className="pb-btn" onClick={() => setDuzenlenen("yeni")}><Plus /> Kişi ekle</button>
        <button className="pb-btn" disabled={!kisiler?.length} onClick={() => kisiler && kisilerExcel(donem, liste)}><Download /> Excel</button>
      </div>

      {secili.size > 0 && (
        <div className="pb-secim">
          <b>{secili.size} kişi seçili</b>
          <button className="pb-btn kucuk koyu" onClick={() => setTopluAcik(true)}><Pencil /> Toplu düzenle</button>
          <button className="pb-btn kucuk" onClick={() => setSecili(new Set())}><X /> Seçimi kaldır</button>
        </div>
      )}

      {kisiler === null ? <div className="pb-bos"><Spin /></div> : liste.length === 0 ? (
        <div className="pb-bos"><Users /><b>Kişi yok</b><p>{kisiler.length === 0 ? "Bu senaryoda henüz kişi yok. Excel'den içe aktarın ya da 'Kişi ekle' ile başlayın." : "Süzgeçle eşleşen kişi yok."}</p></div>
      ) : (
        <div className="pb-tablo yuksek">
          <table>
            <thead>
              <tr>
                <th><Checkbox checked={secili.size > 0 && liste.every((k) => secili.has(k.id))} indeterminate={secili.size > 0 && !liste.every((k) => secili.has(k.id))} onChange={(e) => tumunuSec(e.target.checked)} /></th>
                <Bas k="ad" ad="Ad soyad" />
                <Bas k="sube" ad="Şube · meslek" />
                <th>Gün · SGK</th>
                <th className="sag">GRM önceki</th>
                <Bas k="grm" ad="GRM" sag />
                <Bas k="zam" ad="Zam" sag />
                <Bas k="bordroNet" ad="Bordro net" sag />
                <th className="sag">Ocak brüt</th>
                <Bas k="toplam" ad="Yıllık maliyet" sag />
                <th className="sag">Aylık</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liste.map((k) => (
                <tr key={k.id} className={"tik" + (secili.has(k.id) ? " secili" : "")} style={k.aktif ? undefined : { opacity: .55 }} onClick={() => setAcikKisi(k.id)}>
                  <td onClick={(e) => e.stopPropagation()}><Checkbox checked={secili.has(k.id)} onChange={(e) => setSecili((s) => { const n = new Set(s); if (e.target.checked) n.add(k.id); else n.delete(k.id); return n; })} /></td>
                  <td><span className="ad">{k.ad}</span><small>{k.sicil}{k.elle && <span className="pb-etiket kehribar" style={{ marginLeft: 6 }}>elle</span>}{!k.aktif && <span className="pb-etiket gri" style={{ marginLeft: 6 }}>pasif</span>}</small></td>
                  <td><span>{k.sube}</span><small>{k.meslek}{k.bolum && k.bolum !== "ŞUBE" ? ` · ${k.bolum}` : ""}</small></td>
                  <td>{k.gun}{k.emekli && <span className="pb-etiket ink" style={{ marginLeft: 6 }}>emekli</span>}</td>
                  <td className="sag mono">{para(k.grmOnceki)}</td>
                  <td className="sag mono" style={{ fontWeight: 700 }}>{para(k.grm)}</td>
                  <td className={"sag mono " + ((k.zamOrani ?? 0) < 0 ? "eksi" : "")}>{yuzde(k.zamOrani)}</td>
                  <td className="sag mono">{para(k.bordroNet)}</td>
                  <td className="sag mono">{para(k.ocakBrut)}</td>
                  <td className="sag mono" style={{ fontWeight: 700 }}>{k.aktif ? para(k.yillikToplam) : "—"}</td>
                  <td className="sag mono">{k.aktif ? para(k.aylikOrtalama) : "—"}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                    <button className="pb-btn kucuk" onClick={() => setDuzenlenen(k)} title="Düzenle"><Pencil /></button>{" "}
                    <button className="pb-btn kucuk tehlike" onClick={() => sil(k)} title="Sil"><Trash2 /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{liste.length} kişi · {sayi(toplam.fte, 1)} FTE</td>
                <td />
                <td className="sag mono">{para(toplam.grm)}</td>
                <td colSpan={3} />
                <td className="sag mono">{para(toplam.toplam)}</td>
                <td className="sag mono">{para(toplam.toplam / 12)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <KisiCekmecesi donem={donem} kisiId={acikKisi} kapat={() => setAcikKisi(null)} duzenle={(k) => { setAcikKisi(null); setDuzenlenen(k); }} />

      {duzenlenen && (
        <KisiFormu donem={donem} kisi={duzenlenen === "yeni" ? null : duzenlenen} subeler={subeler} meslekler={meslekler} kalemler={yanGiderKalemleri}
          kapat={() => setDuzenlenen(null)} kaydedildi={() => { setDuzenlenen(null); void yukle(); degisti(); }} />
      )}

      {topluAcik && (
        <TopluForm donem={donem} ids={[...secili]} subeler={subeler} meslekler={meslekler} kapat={() => setTopluAcik(false)}
          kaydedildi={() => { setTopluAcik(false); setSecili(new Set()); void yukle(); degisti(); }} />
      )}
    </div>
  );
}

/* ================================================================ kişi formu */

function KisiFormu({ donem, kisi, subeler, meslekler, kalemler, kapat, kaydedildi }: { donem: Donem; kisi: Kisi | null; subeler: string[]; meslekler: string[]; kalemler: YanGider[]; kapat: () => void; kaydedildi: () => void }) {
  const { message } = AntdApp.useApp();
  const [f, setF] = useState<KisiGirdi>({
    sube: kisi?.sube ?? subeler[0] ?? "", bolum: kisi?.bolum ?? "ŞUBE", sicil: kisi?.sicil ?? "", ad: kisi?.ad ?? "", gun: kisi?.gun ?? 30, emekli: kisi?.emekli ?? false,
    meslek: kisi?.meslek ?? "", grmOnceki: kisi?.grmOnceki ?? 0, grm: kisi?.grm ?? 0, bordroNet: kisi?.bordroNet ?? 0, yanGiderler: kisi?.yanGiderler ?? {}, aktif: kisi?.aktif ?? true, notu: kisi?.notu ?? "",
  });
  const [ozelAcik, setOzelAcik] = useState(Object.keys(kisi?.yanGiderler ?? {}).length > 0);
  const ozel = f.yanGiderler ?? {};
  const ozelYaz = (kod: string, v: number | null) => {
    const n = { ...ozel };
    if (v === null || v === undefined) delete n[kod]; else n[kod] = v;
    d("yanGiderler", n);
  };
  const [gidiyor, setGidiyor] = useState(false);
  const d = (k: keyof KisiGirdi, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const kaydet = async () => {
    if (!f.ad?.trim()) return message.warning("Ad soyad gerekli");
    if (!f.bordroNet) return message.warning("Bordro neti gerekli");
    setGidiyor(true);
    try {
      if (kisi) await butceApi.kisiGuncelle(donem.id, kisi.id, { ...f, yanGiderler: f.yanGiderler ?? {} }); else await butceApi.kisiEkle(donem.id, f);
      message.success(kisi ? "Kaydedildi" : "Kişi eklendi");
      kaydedildi();
    } catch (h: any) { message.error(h?.message ?? "Kaydedilemedi"); }
    finally { setGidiyor(false); }
  };
  return (
    <Modal open title={kisi ? `${kisi.ad} · düzenle` : "Yeni kişi"} onCancel={kapat} onOk={kaydet} okText="Kaydet" cancelText="Vazgeç" confirmLoading={gidiyor} width={640} destroyOnClose>
      <div className="pb pb-form" style={{ minHeight: 0, padding: 0, background: "none", borderRadius: 0 }}>
        <div className="grup">
          <div><label>Ad soyad</label><Input value={f.ad ?? ""} onChange={(e) => d("ad", e.target.value)} /></div>
          <div><label>Sicil / TC</label><Input value={f.sicil ?? ""} onChange={(e) => d("sicil", e.target.value)} /></div>
          <div><label>Şube</label><Select showSearch value={f.sube ?? undefined} onChange={(v) => d("sube", v)} options={subeler.map((s) => ({ value: s, label: s }))} /></div>
          <div><label>Meslek</label><Select showSearch allowClear value={f.meslek || undefined} onChange={(v) => d("meslek", v)} options={meslekler.map((s) => ({ value: s, label: s }))} /></div>
          <div><label>Bölüm</label><Select value={f.bolum ?? "ŞUBE"} onChange={(v) => d("bolum", v)} options={[{ value: "ŞUBE", label: "Şube" }, { value: "ENGELLİ", label: "Engelli kadrosu" }, { value: "MERKEZ", label: "Merkez" }]} /></div>
          <div><label>Çalışma</label><Select value={f.gun} onChange={(v) => d("gun", v)} options={[{ value: 30, label: "Tam zamanlı (30 gün)" }, { value: 15, label: "Part-time (15 gün)" }]} /></div>
          <div><label>SGK</label><Select value={f.emekli ? 1 : 0} onChange={(v) => d("emekli", v === 1)} options={[{ value: 0, label: "Normal" }, { value: 1, label: "Emekli (SGDP)" }]} /></div>
          <div><label>Durum</label><Select value={f.aktif ? 1 : 0} onChange={(v) => d("aktif", v === 1)} options={[{ value: 1, label: "Aktif (hesaba girer)" }, { value: 0, label: "Pasif (hesaba girmez)" }]} /></div>
          <div><label>GRM önceki yıl</label><InputNumber value={f.grmOnceki} onChange={(v) => d("grmOnceki", v ?? 0)} min={0} step={500} decimalSeparator="," /></div>
          <div><label>GRM (gerçek net)</label><InputNumber value={f.grm} onChange={(v) => d("grm", v ?? 0)} min={0} step={500} decimalSeparator="," /></div>
          <div><label>Bordro net (30 gün)</label><InputNumber value={f.bordroNet} onChange={(v) => d("bordroNet", v ?? 0)} min={0} step={500} decimalSeparator="," /></div>

          <div style={{ gridColumn: "1 / -1" }}><label>Not</label><Input value={f.notu ?? ""} onChange={(e) => d("notu", e.target.value)} placeholder="ör. Mart'ta ayrılacak, terfi bekliyor" /></div>
        </div>
        <p className="kucuk" style={{ margin: 0 }}>GRM kişiye fiilen ödenen aylık net (banka + elden). Bordro neti brütün çözüldüğü resmi net; part-time'da 30 gün üzerinden yazılır, maliyet 15/30 oranıyla alınır. Ücreti elle değiştirilen kişiye zam kuralları yeniden uygulanmaz.</p>
        <div>
          <button className="pb-btn kucuk" onClick={() => setOzelAcik((x) => !x)}>{ozelAcik ? "Kişiye özel yan giderleri gizle" : `Kişiye özel yan giderler${Object.keys(ozel).length ? ` (${Object.keys(ozel).length})` : ""}`}</button>
          {ozelAcik && (
            <div className="grup" style={{ marginTop: 10 }}>
              {kalemler.filter((k) => k.kod !== "yolSgk").map((k) => (
                <div key={k.kod}><label>{k.ad}</label><InputNumber value={ozel[k.kod] ?? null} onChange={(v) => ozelYaz(k.kod, v)} min={0} step={50} decimalSeparator="," placeholder={`varsayılan ${k.tutar.toLocaleString("tr-TR")}`} /></div>
              ))}
              <p className="kucuk" style={{ gridColumn: "1 / -1", margin: 0 }}>Boş bırakılan kalem Parametreler'deki varsayılanı alır (part-time'da gün oranıyla). Yazılan tutar kişinin fiili aylık tutarıdır: yol, kasa tazminatı, İSG gibi kişiye göre değişen kalemler için.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================ toplu form */

function TopluForm({ donem, ids, subeler, meslekler, kapat, kaydedildi }: { donem: Donem; ids: number[]; subeler: string[]; meslekler: string[]; kapat: () => void; kaydedildi: () => void }) {
  const { message } = AntdApp.useApp();
  const [zam, setZam] = useState<number | null>(null);
  const [grmZam, setGrmZam] = useState<number | null>(null);
  const [gun, setGun] = useState<number | undefined>();
  const [emekli, setEmekli] = useState<boolean | undefined>();
  const [aktif, setAktif] = useState<boolean | undefined>();
  const [sube, setSube] = useState<string | undefined>();
  const [meslek, setMeslek] = useState<string | undefined>();
  const [gidiyor, setGidiyor] = useState(false);
  const kaydet = async () => {
    setGidiyor(true);
    try {
      const r = await butceApi.kisilerToplu(donem.id, { ids, bordroOran: zam === null ? undefined : zam / 100, grmOran: grmZam === null ? undefined : grmZam / 100, gun, emekli, aktif, sube, meslek });
      message.success(`${r.adet} kişi güncellendi`);
      kaydedildi();
    } catch (h: any) { message.error(h?.message ?? "Güncellenemedi"); }
    finally { setGidiyor(false); }
  };
  return (
    <Modal open title={`${ids.length} kişiyi toplu düzenle`} onCancel={kapat} onOk={kaydet} okText="Uygula" cancelText="Vazgeç" confirmLoading={gidiyor} destroyOnClose>
      <div className="pb pb-form" style={{ minHeight: 0, padding: 0, background: "none", borderRadius: 0 }}>
        <div className="grup">
          <div><label>Bordro netine zam (%)</label><InputNumber value={zam} onChange={setZam} step={1} decimalSeparator="," placeholder="boş = değişmez" /></div>
          <div><label>GRM'ye zam (%)</label><InputNumber value={grmZam} onChange={setGrmZam} step={1} decimalSeparator="," placeholder="boş = bordroyla aynı" /></div>
          <div><label>Çalışma</label><Select allowClear value={gun} onChange={setGun} placeholder="değişmez" options={[{ value: 30, label: "Tam (30)" }, { value: 15, label: "Part-time (15)" }]} /></div>
          <div><label>SGK</label><Select allowClear value={emekli === undefined ? undefined : emekli ? 1 : 0} onChange={(v) => setEmekli(v === undefined ? undefined : v === 1)} placeholder="değişmez" options={[{ value: 0, label: "Normal" }, { value: 1, label: "Emekli" }]} /></div>
          <div><label>Durum</label><Select allowClear value={aktif === undefined ? undefined : aktif ? 1 : 0} onChange={(v) => setAktif(v === undefined ? undefined : v === 1)} placeholder="değişmez" options={[{ value: 1, label: "Aktif" }, { value: 0, label: "Pasif" }]} /></div>
          <div><label>Şube</label><Select allowClear showSearch value={sube} onChange={setSube} placeholder="değişmez" options={subeler.map((s) => ({ value: s, label: s }))} /></div>
          <div><label>Meslek</label><Select allowClear showSearch value={meslek} onChange={setMeslek} placeholder="değişmez" options={meslekler.map((s) => ({ value: s, label: s }))} /></div>
        </div>
        <p className="kucuk" style={{ margin: 0 }}>Zam, kişinin bugünkü ücretine uygulanır ve kişi "elle" işaretlenir; sonra Zam kuralları bu kişilere dokunmaz.</p>
      </div>
    </Modal>
  );
}

/* ============================================================== kişi çekmecesi */

export function KisiCekmecesi({ donem, kisiId, kapat, duzenle }: { donem: Donem; kisiId: number | null; kapat: () => void; duzenle?: (k: Kisi) => void }) {
  const { message } = AntdApp.useApp();
  const [det, setDet] = useState<KisiDetay | null>(null);
  const [odemeAyi, setOdemeAyi] = useState(false);
  useEffect(() => {
    setDet(null);
    if (kisiId === null) return;
    let iptal = false;
    butceApi.kisiDetay(donem.id, kisiId).then((r) => { if (!iptal) setDet(r); }).catch((h: any) => { if (!iptal) { message.error(h?.message ?? "Kişi okunamadı"); kapat(); } });
    return () => { iptal = true; };
    /* kapat / message her çizimde yeniden üretilir; yalnız kişi değişince yüklenir */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donem.id, kisiId]);

  const k = det?.kisi;
  const satirlar: { ad: string; k: keyof KisiDetay["aylar"][number]; vurgu?: boolean; ara?: boolean; kurus?: boolean }[] = [
    { ad: "Brüt ücret", k: "brut", kurus: true },
    { ad: "SGK işçi", k: "sgkIsci", kurus: true },
    { ad: "İşsizlik işçi", k: "issizlikIsci", kurus: true },
    { ad: "Kümülatif vergi matrahı", k: "kumulatifMatrah" },
    { ad: "Gelir vergisi", k: "gv", kurus: true },
    { ad: "Damga vergisi", k: "dv", kurus: true },
    { ad: "GV istisnası (asgari ücret)", k: "gvIstisna", kurus: true },
    { ad: "DV istisnası", k: "dvIstisna", kurus: true },
    { ad: "İstisna sonrası GV", k: "gvSon", kurus: true },
    { ad: "İstisna sonrası DV", k: "dvSon", kurus: true },
    { ad: "Net ücret (30 gün)", k: "net", vurgu: true, kurus: true },
    { ad: "SSK işveren", k: "sskIsveren", ara: true, kurus: true },
    { ad: "5 puan indirimi", k: "indirim", kurus: true },
    { ad: "İşsizlik işveren", k: "issizlikIsveren", kurus: true },
    { ad: "Toplam işveren maliyeti", k: "isverenMaliyeti", vurgu: true },
    { ad: "Net ücret (banka)", k: "netBanka", ara: true },
    { ad: "GR farkı", k: "grFarki" },
    { ad: "Yan giderler", k: "yanGider" },
    { ad: "Tek seferlik", k: "tekSeferlik" },
    { ad: "Toplam", k: "toplam", vurgu: true },
  ];

  return (
    <Drawer open={kisiId !== null} onClose={kapat} width={1100} destroyOnClose
      title={k ? <span>{k.ad} <span className="kucuk" style={{ fontWeight: 500 }}>· {k.sube} · {k.meslek} · {k.gun} gün · {k.emekli ? "emekli (SGDP)" : "normal"}</span></span> : "Kişi"}
      extra={det && k ? (
        <span style={{ display: "inline-flex", gap: 8 }}>
          {duzenle && <button className="pb-btn kucuk" onClick={() => duzenle(k)}><Pencil /> Düzenle</button>}
          <button className="pb-btn kucuk" onClick={() => bordroExcel(donem, det)}><Download /> Excel</button>
        </span>
      ) : null}>
      {!det || !k ? <div className="pb-bos"><Spin /></div> : (
        <div className="pb" style={{ minHeight: 0, padding: 0, background: "none", borderRadius: 0, gap: 14 }}>
          <div className="pb-kisi-ust">
            <div><small>GRM (gerçek net)</small><b>{para(k.grm)}</b><div className="kucuk">önceki yıl {para(k.grmOnceki)} · zam {yuzde(k.zamOrani)}</div></div>
            <div><small>Bordro neti · Ocak brüt</small><b>{para(k.bordroNet)}</b><div className="kucuk">brüt {paraKurus(det.aylar[0]?.brut)}</div></div>
            <div><small>Yıllık toplam maliyet</small><b>{para(k.yillikToplam)}</b><div className="kucuk">aylık ort. {para(k.aylikOrtalama)}</div></div>
            <div><small>Net → maliyet</small><b>×{(k.grm ? k.aylikOrtalama / k.grm : 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</b><div className="kucuk">aylık maliyet / GRM</div></div>
          </div>

          <div className="pb-pk" style={{ padding: 12 }}>
            <h3 style={{ fontSize: 14 }}>12 aylık bordro ve maliyet
              <div className="pb-seg"><button className={!odemeAyi ? "on" : ""} onClick={() => setOdemeAyi(false)}>Bordro ayı</button><button className={odemeAyi ? "on" : ""} onClick={() => setOdemeAyi(true)}>Ödeme ayı</button></div>
            </h3>
            <div className="pb-tablo pb-bordro">
              <table>
                <thead>
                  <tr><th>Kalem</th>{det.aylar.map((a) => <th key={a.ay} className="sag">{odemeAyi ? (a.ay === 12 ? `Oca ${donem.yil + 1}` : ["Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"][a.ay - 1]) : a.etiket.slice(0, 3)}</th>)}<th className="sag">Yıl</th></tr>
                </thead>
                <tbody>
                  {satirlar.map((s) => {
                    const yil = det.aylar.reduce((t, a) => t + (a[s.k] as number), 0);
                    return (
                      <tr key={s.k} className={(s.vurgu ? "vurgu" : "") + (s.ara ? " ara" : "")}>
                        <td>{s.ad}</td>
                        {det.aylar.map((a) => <td key={a.ay} className="sag mono">{s.kurus ? paraKurus(a[s.k] as number) : para(a[s.k] as number)}</td>)}
                        <td className="sag mono" style={{ fontWeight: 700 }}>{s.k === "kumulatifMatrah" ? "" : para(yil)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {det.aylar.some((a) => a.tekSeferlikKalemler.length > 0) && (
              <p className="kucuk" style={{ margin: "10px 0 0" }}>
                Tek seferlik: {det.aylar.flatMap((a) => a.tekSeferlikKalemler.map((t) => `${a.etiket} ${t.ad} ${para(t.tutar)}`)).join(" · ")}
              </p>
            )}
          </div>

          <div className="pb-izg">
            <div className="pb-nasil">
              <b>Nasıl hesaplandı</b>
              <ol>
                <li>Bordro neti {para(k.bordroNet)} için brüt, ikiye bölme yöntemiyle 1 kuruş hassasiyetle çözülür; her ay yeniden çözülür çünkü kümülatif vergi matrahı dilim değiştirdikçe aynı net için gereken brüt artar.</li>
                <li>SGK işçi payı ve işsizlik, brütün SGK tavanını ({para(det.tavan)}) aşmayan kısmı üzerinden alınır; emeklide SGDP oranı uygulanır, işsizlik kesilmez.</li>
                <li>Gelir vergisi, yıl başından o aya kadar biriken matraha dilimli olarak hesaplanıp önceki ayların vergisi düşülür. Asgari ücretin kendi vergisi (istisna) çıkarılır; damga vergisinde de asgari ücret istisnası uygulanır.</li>
                <li>İşveren maliyeti = brüt + SSK işveren − 5 puan indirimi + işsizlik işveren; part-time'da {k.gun}/30 oranıyla.</li>
                <li>GR farkı = gerçek net ({para(k.grm)}) − bankaya yatan bordro neti; elden ödenen fark da maliyettir.</li>
                <li>Yan giderler kişi başı aylık sabit tutarlardır (Parametreler sekmesi); tek seferlik kalemler ait oldukları aya yazılır.</li>
              </ol>
            </div>
            <div className="pb-pk" style={{ padding: 12 }}>
              <h3 style={{ fontSize: 14 }}>Aylık yan giderler <small>kişi başı</small></h3>
              <div className="pb-tablo dar"><table><tbody>
                {det.yanGiderler.map((y) => <tr key={y.kod}><td>{y.ad}</td><td className="sag mono">{para(y.tutar)}</td></tr>)}
                <tr><td style={{ fontWeight: 800 }}>Toplam</td><td className="sag mono" style={{ fontWeight: 800 }}>{para(det.yanGiderler.reduce((t, y) => t + y.tutar, 0))}</td></tr>
              </tbody></table></div>
            </div>
          </div>
          {!k.aktif && <div className="pb-uyari"><UserCheck size={16} /> Bu kişi pasif: senaryo toplamına girmiyor. Hesap yalnız bilgi amaçlı gösteriliyor.</div>}
          {k.grm < k.bordroNet * (k.gun / 30) && <div className="pb-uyari"><AlertTriangle size={16} /> GRM bordro netinden düşük: GR farkı eksi çıkıyor. Kişinin gerçek netini ya da bordro netini kontrol edin.</div>}
        </div>
      )}
    </Drawer>
  );
}
