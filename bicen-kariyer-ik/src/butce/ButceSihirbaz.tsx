/**
 * Senaryo oluştur sihirbazı (30.10.2026): baz senaryo → genel zam →
 * şube / meslek kuralları → kişi istisnaları → varsayımlar (asgari ücret,
 * vergi dilimleri, oranlar) → önizleme (canlı, sunucuda hesaplanır) → kaydet.
 *
 * Her adımda alt banttaki canlı özet yeniden hesaplanır (POST /Onizle;
 * ücret adres satırına çıkmaz).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Input, InputNumber, Modal, Select, Slider, Spin } from "antd";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import type { Donem, Kisi, Kural, Ozet, Parametre } from "./butceOrtak";
import { butceApi, farkYuzde, para, paraKisa, sayi } from "./butceOrtak";
import ButceParametreler, { KuralDuzenleyici } from "./ButceParametreler";
import { AylikYigilmis } from "./ButceGrafik";

interface Props {
  donemler: Donem[];
  bazId: number;
  bazParametre: Parametre;
  subeler: string[];
  meslekler: string[];
  kapat: () => void;
  olusturuldu: (id: number) => void;
}

const ADIMLAR = ["Baz", "Genel zam", "Şube ve meslek", "Kişi istisnaları", "Varsayımlar", "Önizleme"];

export default function ButceSihirbaz({ donemler, bazId, bazParametre, subeler, meslekler, kapat, olusturuldu }: Props) {
  const { message } = AntdApp.useApp();
  const [adim, setAdim] = useState(0);
  const [baz, setBaz] = useState(bazId);
  const bazDonem = donemler.find((d) => d.id === baz);
  const [yil, setYil] = useState((bazDonem?.yil ?? new Date().getFullYear()) + 1);
  const [ad, setAd] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [genel, setGenel] = useState(27);
  const [grmAyni, setGrmAyni] = useState(true);
  const [grmGenel, setGrmGenel] = useState(27);
  const [kurallar, setKurallar] = useState<Kural[]>([]);
  const [istisnalar, setIstisnalar] = useState<Kural[]>([]);
  const [pasif, setPasif] = useState<number[]>([]);
  const [kisiler, setKisiler] = useState<Kisi[] | null>(null);
  const [p, setP] = useState<Parametre>(() => ({ ...JSON.parse(JSON.stringify(bazParametre)), yil: (bazDonem?.yil ?? 2026) + 1 }));
  const [onizleme, setOnizleme] = useState<{ baz: Ozet; yeni: Ozet; asgariNet: number } | null>(null);
  const [hesaplaniyor, setHesaplaniyor] = useState(false);
  const [gidiyor, setGidiyor] = useState(false);

  useEffect(() => { if (!ad && bazDonem) setAd(`${yil} bütçesi`); }, [bazDonem, yil, ad]);
  useEffect(() => {
    setKisiler(null);
    butceApi.kisiler(baz).then((r) => setKisiler(r.kisiler.filter((k) => k.aktif))).catch(() => setKisiler([]));
  }, [baz]);

  const tumKurallar = useMemo<Kural[]>(() => [
    { tur: "genel", bordroOran: genel / 100, grmOran: grmAyni ? null : grmGenel / 100 },
    ...kurallar, ...istisnalar,
  ], [genel, grmAyni, grmGenel, kurallar, istisnalar]);

  const govde = useMemo(() => ({ bazDonemId: baz, ad: ad || `${yil} bütçesi`, yil, aciklama, parametre: { ...p, yil }, kurallar: tumKurallar, pasifKisiler: pasif }), [baz, ad, yil, aciklama, p, tumKurallar, pasif]);

  /* Canlı önizleme: değişiklikten 500 ms sonra */
  const zamanlayici = useRef<number | null>(null);
  const hesapla = useCallback(() => {
    setHesaplaniyor(true);
    butceApi.onizle(govde).then(setOnizleme).catch((h: any) => message.error(h?.message ?? "Önizleme hesaplanamadı")).finally(() => setHesaplaniyor(false));
  }, [govde, message]);
  useEffect(() => {
    if (zamanlayici.current) window.clearTimeout(zamanlayici.current);
    zamanlayici.current = window.setTimeout(hesapla, 500);
    return () => { if (zamanlayici.current) window.clearTimeout(zamanlayici.current); };
  }, [hesapla]);

  const kaydet = async () => {
    if (!ad.trim()) return message.warning("Senaryo adı gerekli");
    setGidiyor(true);
    try {
      const r = await butceApi.senaryo({ ...govde, ad: ad.trim() });
      message.success("Senaryo oluşturuldu");
      olusturuldu(r.id);
    } catch (h: any) { message.error(h?.message ?? "Oluşturulamadı"); }
    finally { setGidiyor(false); }
  };

  const fark = onizleme ? onizleme.yeni.yillikToplam - onizleme.baz.yillikToplam : 0;

  return (
    <Modal open onCancel={kapat} footer={null} width={1040} destroyOnClose title={<span><Sparkles size={16} style={{ verticalAlign: -3, marginRight: 8 }} />Yeni senaryo</span>}>
      <div className="pb" style={{ minHeight: 0, padding: 0, background: "none", borderRadius: 0, gap: 0 }}>
        <div className="pb-adimlar">
          {ADIMLAR.map((a, i) => <button key={a} className={i === adim ? "on" : i < adim ? "tamam" : ""} onClick={() => setAdim(i)}><i>{i < adim ? <Check size={11} /> : i + 1}</i>{a}</button>)}
        </div>

        <div className="pb-sihirbaz-govde pb-form">
          {adim === 0 && (
            <>
              <h4>Hangi senaryodan türetilsin?</h4>
              <p>Kişi listesi, ücretler ve varsayımlar baz senaryodan kopyalanır; sonra zam kuralları ve yeni yılın parametreleri uygulanır.</p>
              <div className="grup">
                <div><label>Baz senaryo</label><Select value={baz} onChange={(v) => { setBaz(v); const d = donemler.find((x) => x.id === v); if (d) { setYil(d.yil + 1); setAd(`${d.yil + 1} bütçesi`); } }} options={donemler.map((d) => ({ value: d.id, label: `${d.ad} (${d.yil}, ${d.kisiSayisi} kişi)` }))} /></div>
                <div><label>Yeni yıl</label><InputNumber value={yil} onChange={(v) => { setYil(v ?? yil); setP((x) => ({ ...x, yil: v ?? yil })); }} min={2020} max={2100} /></div>
                <div><label>Senaryo adı</label><Input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="ör. 2027 · %27 zam" /></div>
                <div style={{ gridColumn: "1 / -1" }}><label>Açıklama</label><Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Varsayımların kısa özeti" /></div>
              </div>
              {bazDonem && <div className="pb-bilgi">{bazDonem.ad}: {bazDonem.kisiSayisi} kişi · {bazDonem.yil} · {bazDonem.durum === "onayli" ? "onaylı" : "taslak"}. Baz senaryoda sonradan yapılan değişiklikler yeni senaryoya yansımaz.</div>}
            </>
          )}

          {adim === 1 && (
            <>
              <h4>Genel zam oranı</h4>
              <p>Başka kural yazılmayan herkesin bordro neti ve gerçek neti (GRM) bu oranda artar. Şube / meslek / kişi kuralları bu oranı ezer.</p>
              <div className="pb-zam-buyuk">
                <b>%{genel.toLocaleString("tr-TR")}</b>
                <Slider min={0} max={100} step={0.5} value={genel} onChange={setGenel} tooltip={{ formatter: (v) => `%${v}` }} />
                <InputNumber value={genel} onChange={(v) => setGenel(v ?? 0)} min={0} max={200} step={0.5} decimalSeparator="," addonAfter="%" />
              </div>
              <div className="grup" style={{ marginTop: 12 }}>
                <div><label>GRM (gerçek net) zammı</label><Select value={grmAyni ? 1 : 0} onChange={(v) => setGrmAyni(v === 1)} options={[{ value: 1, label: "Bordro ile aynı oran" }, { value: 0, label: "Farklı oran" }]} /></div>
                {!grmAyni && <div><label>GRM zam oranı</label><InputNumber value={grmGenel} onChange={(v) => setGrmGenel(v ?? 0)} min={0} max={200} step={0.5} decimalSeparator="," addonAfter="%" /></div>}
              </div>
              <p className="kucuk" style={{ margin: 0 }}>Bordro neti: brütün çözüldüğü resmi net (SGK ve vergi bunun üzerinden). GRM: kişiye fiilen ödenen net; aradaki fark "GR farkı" olarak maliyete girer. İkisine farklı oran vermek, örneğin elden ödenen kısmı sabit tutmak için kullanılır.</p>
            </>
          )}

          {adim === 2 && (
            <>
              <h4>Şube ve meslek kuralları</h4>
              <p>Belirli şube ya da mesleğe farklı oran. Örneğin kasa şeflerine %35, Silivri şubesine %30. Boş bırakılırsa herkes genel oranı alır.</p>
              <KuralDuzenleyici kurallar={kurallar} degistir={setKurallar} subeler={subeler} meslekler={meslekler} />
            </>
          )}

          {adim === 3 && (
            <>
              <h4>Kişi istisnaları</h4>
              <p>Belirli kişiye özel oran (terfi, özel anlaşma) ya da yeni yılda olmayacak kişiler (pasif: hesaba girmez, listede kalır).</p>
              {kisiler === null ? <Spin /> : (
                <>
                  <KuralDuzenleyici kurallar={istisnalar} degistir={setIstisnalar} subeler={subeler} meslekler={meslekler}
                    kisiler={kisiler.map((k) => ({ id: k.id, ad: `${k.ad} · ${k.sube} · ${k.meslek ?? ""}` }))} />
                  <div style={{ marginTop: 14 }}>
                    <label style={{ fontWeight: 700, display: "block", marginBottom: 4 }}>Yeni yılda olmayacak kişiler</label>
                    <Select mode="multiple" allowClear showSearch optionFilterProp="label" value={pasif} onChange={setPasif} placeholder="Kişi seçin" style={{ width: "100%" }}
                      options={kisiler.map((k) => ({ value: k.id, label: `${k.ad} · ${k.sube} · ${k.meslek ?? ""}` }))} />
                  </div>
                </>
              )}
            </>
          )}

          {adim === 4 && (
            <>
              <h4>{yil} varsayımları</h4>
              <p>Asgari ücret, vergi dilimleri, SGK oranları, yan giderler ve tek seferlik kalemler baz senaryodan kopyalandı; yeni yıl için düzeltin. Yan giderleri de zamlamak için tutarları elle güncelleyin ya da aşağıdaki hızlı artışı kullanın.{p.kisiKalemArtis ? ` Kişiye özel kalemler %${(p.kisiKalemArtis * 100).toLocaleString("tr-TR")} artırılacak.` : ""}</p>
              <HizliArtis p={p} degistir={setP} />
              <ButceParametreler p={p} degistir={setP} subeler={subeler} />
            </>
          )}

          {adim === 5 && (
            <>
              <h4>Önizleme</h4>
              <p>Kaydetmeden önce sonuç. Kaydedince senaryo taslak olarak açılır; kişiler, kurallar ve parametreler sonradan da değiştirilebilir.</p>
              {!onizleme ? <Spin /> : (
                <>
                  <div className="pb-delta">
                    <div><small>{yil} yıllık toplam</small><b>{paraKisa(onizleme.yeni.yillikToplam)}</b><span className={fark > 0 ? "eksi" : "arti"}>{fark >= 0 ? "+" : "−"}{paraKisa(Math.abs(fark))} · {farkYuzde(onizleme.yeni.yillikToplam, onizleme.baz.yillikToplam)}</span></div>
                    <div><small>Aylık ortalama</small><b>{paraKisa(onizleme.yeni.aylikOrtalama)}</b><span className="kucuk">{bazDonem?.yil}: {paraKisa(onizleme.baz.aylikOrtalama)}</span></div>
                    <div><small>Kişi başı aylık</small><b>{para(onizleme.yeni.kisiBasiAylik)}</b><span className="kucuk">{farkYuzde(onizleme.yeni.kisiBasiAylik, onizleme.baz.kisiBasiAylik)}</span></div>
                    <div><small>Kişi · FTE · asgari net</small><b>{sayi(onizleme.yeni.kisi)} · {sayi(onizleme.yeni.fte, 1)}</b><span className="kucuk">asgari net {para(onizleme.asgariNet)}</span></div>
                  </div>
                  <div style={{ marginTop: 12 }}><AylikYigilmis aylar={onizleme.yeni.bordroAylari} bazAylar={onizleme.baz.bordroAylari} bazAd={bazDonem?.ad} yukseklik={260} /></div>
                </>
              )}
            </>
          )}
        </div>

        <div className="pb-canli">
          <div><small>Baz · {bazDonem?.yil}</small><b>{onizleme ? paraKisa(onizleme.baz.yillikToplam) : "—"}</b><span className="kucuk">{onizleme ? `${onizleme.baz.kisi} kişi` : ""}</span></div>
          <div><small>Yeni · {yil} {hesaplaniyor && <Spin size="small" />}</small><b>{onizleme ? paraKisa(onizleme.yeni.yillikToplam) : "—"}</b><span className="kucuk">{onizleme ? `${onizleme.yeni.kisi} kişi · kişi başı ${para(onizleme.yeni.kisiBasiAylik)}/ay` : ""}</span></div>
          <div><small>Fark</small><b className={fark > 0 ? "eksi" : "arti"} style={{ color: fark > 0 ? "#b4433a" : "#5f8c10" }}>{onizleme ? `${fark >= 0 ? "+" : "−"}${paraKisa(Math.abs(fark))}` : "—"}</b><span className={fark > 0 ? "eksi" : "arti"}>{onizleme ? farkYuzde(onizleme.yeni.yillikToplam, onizleme.baz.yillikToplam) : ""}</span></div>
        </div>

        <div className="pb-yapiskan">
          <span className="not">Adım {adim + 1} / {ADIMLAR.length}</span>
          <button className="pb-btn" onClick={kapat}>Vazgeç</button>
          <button className="pb-btn" disabled={adim === 0} onClick={() => setAdim((a) => a - 1)}><ArrowLeft /> Geri</button>
          {adim < ADIMLAR.length - 1
            ? <button className="pb-btn koyu" onClick={() => setAdim((a) => a + 1)}>İleri <ArrowRight /></button>
            : <button className="pb-btn yesil" onClick={kaydet} disabled={gidiyor || !onizleme}>{gidiyor ? <Spin size="small" /> : <Check />} Senaryoyu kaydet</button>}
        </div>
      </div>
    </Modal>
  );
}

/** Yan gider / tek seferlik / gece maaşlarını tek oranla artırma */
function HizliArtis({ p, degistir }: { p: Parametre; degistir: (p: Parametre) => void }) {
  const [oran, setOran] = useState(25);
  const [asgari, setAsgari] = useState<number | null>(null);
  const uygula = () => {
    const c = 1 + oran / 100;
    const r2 = (v: number) => Math.round(v * c * 100) / 100;
    degistir({
      ...p,
      yanGiderler: p.yanGiderler.map((y) => ({ ...y, tutar: r2(y.tutar) })),
      tekSeferlikler: p.tekSeferlikler.map((t) => (t.gece || t.gun ? t : { ...t, tutar: r2(t.tutar) })),
      geceRoller: p.geceRoller.map((g) => ({ ...g, maas: r2(g.maas) })),
      gtGunluk: r2(p.gtGunluk),
      kisiKalemArtis: oran / 100,
    });
  };
  return (
    <div className="pb-bilgi" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span>Hızlı artış: yan giderleri, çekleri, tatil günlük tutarını, gece maaşlarını ve kişiye özel kalemleri (yol, kasa tazminatı, İSG)</span>
      <InputNumber value={oran} onChange={(v) => setOran(v ?? 0)} step={1} decimalSeparator="," addonAfter="%" style={{ width: 110 }} />
      <button className="pb-btn kucuk koyu" onClick={uygula}>artır</button>
      <span style={{ marginLeft: 12 }}>Asgari ücret (brüt):</span>
      <InputNumber value={asgari ?? p.asgariUcretBrut} onChange={setAsgari} step={500} decimalSeparator="," style={{ width: 140 }} />
      <button className="pb-btn kucuk" onClick={() => asgari && degistir({ ...p, asgariUcretBrut: asgari })}>uygula</button>
    </div>
  );
}
