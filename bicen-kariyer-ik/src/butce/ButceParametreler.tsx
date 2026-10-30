/**
 * Personel Bütçesi › Parametreler (30.10.2026): senaryonun bütün
 * varsayımları, her birinin yanında sade Türkçe açıklama. Aynı form
 * Senaryo sihirbazının "Varsayımlar" adımında da kullanılır (kaydetmeden).
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Checkbox, Input, InputNumber, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";
import type { Kural, Parametre, TekSeferlik, YanGider } from "./butceOrtak";
import { AYLAR, para } from "./butceOrtak";

interface Props {
  p: Parametre;
  degistir: (p: Parametre) => void;
  subeler?: string[];
}

const Satir = ({ etiket, aciklama, children }: { etiket: string; aciklama: string; children: ReactNode }) => (
  <div className="satir"><div><label>{etiket}</label><p>{aciklama}</p></div><div>{children}</div></div>
);

/** % girişi: 0.14 ↔ 14 */
const Yuzde = ({ v, d, adim = 0.5 }: { v: number; d: (v: number) => void; adim?: number }) => (
  <InputNumber value={Math.round(v * 10000) / 100} onChange={(x) => d((x ?? 0) / 100)} min={0} max={100} step={adim} decimalSeparator="," addonAfter="%" />
);

export default function ButceParametreler({ p, degistir, subeler }: Props) {
  const [bolum, setBolum] = useState<"oranlar" | "yan" | "tek" | "gece">("oranlar");
  const d = <K extends keyof Parametre,>(k: K, v: Parametre[K]) => degistir({ ...p, [k]: v });

  return (
    <div className="pb-form">
      <div className="pb-seg" style={{ justifySelf: "start" }}>
        {([["oranlar", "Asgari ücret, vergi ve SGK"], ["yan", "Yan giderler"], ["tek", "Tek seferlik kalemler"], ["gece", "Gece çalışması"]] as const).map(([k, ad]) => (
          <button key={k} className={bolum === k ? "on" : ""} onClick={() => setBolum(k)}>{ad}</button>
        ))}
      </div>

      {bolum === "oranlar" && (
        <>
          <Satir etiket="Asgari ücret (brüt, aylık)" aciklama={`Yılın brüt asgari ücreti. Hem SGK tavanını hem de gelir / damga vergisi istisnasını belirler. Bu değerle asgari net ${para(p.asgariUcretBrut * (1 - p.sgkIsci - p.issizlikIsci))} civarıdır.`}>
            <InputNumber value={p.asgariUcretBrut} onChange={(v) => d("asgariUcretBrut", v ?? 0)} min={0} step={500} decimalSeparator="," />
          </Satir>
          <Satir etiket="SGK tavan katsayısı" aciklama={`Prime esas kazanç tavanı = asgari ücret × katsayı (${para(p.asgariUcretBrut * p.tavanKatsayisi)}). Brütün bu tutarı aşan kısmından SGK ve işsizlik primi kesilmez.`}>
            <InputNumber value={p.tavanKatsayisi} onChange={(v) => d("tavanKatsayisi", v ?? 0)} min={1} step={0.5} decimalSeparator="," />
          </Satir>
          <Satir etiket="Asgari ücret istisnası" aciklama="Her çalışanın asgari ücrete denk gelen gelir ve damga vergisi alınmaz. Kapatılırsa bütün brüt vergilenir (yalnız karşılaştırma için).">
            <Checkbox checked={p.asgariIstisna} onChange={(e) => d("asgariIstisna", e.target.checked)}>Uygula</Checkbox>
          </Satir>

          <h4>Gelir vergisi dilimleri</h4>
          <p>Yıl başından itibaren biriken vergi matrahı (brüt − SGK − işsizlik) bu dilimlere göre vergilenir. Üst sınır yıllık kümülatif tutardır; son dilimin üst sınırı boş kalır. Kişi dilim atladığında aynı net için gereken brüt artar: Özet'teki yaz aylarındaki yükselişin sebebi budur.</p>
          <div className="pb-tablo dar">
            <table>
              <thead><tr><th>Dilim</th><th className="sag">Kümülatif üst sınır</th><th className="sag">Oran</th><th /></tr></thead>
              <tbody>
                {p.vergiDilimleri.map((v, i) => (
                  <tr key={i}>
                    <td>{i + 1}. dilim{i === p.vergiDilimleri.length - 1 ? " (üstü)" : ""}</td>
                    <td className="sag">{i === p.vergiDilimleri.length - 1 ? <span className="kucuk">sınırsız</span> : <InputNumber value={v.ustSinir ?? 0} min={0} step={10000} decimalSeparator="," onChange={(x) => { const l = p.vergiDilimleri.map((y, j) => j === i ? { ...y, ustSinir: x ?? 0 } : y); d("vergiDilimleri", l); }} />}</td>
                    <td className="sag"><Yuzde v={v.oran} d={(x) => { const l = p.vergiDilimleri.map((y, j) => j === i ? { ...y, oran: x } : y); d("vergiDilimleri", l); }} adim={1} /></td>
                    <td>{p.vergiDilimleri.length > 2 && i < p.vergiDilimleri.length - 1 && <button className="pb-btn kucuk tehlike" onClick={() => d("vergiDilimleri", p.vergiDilimleri.filter((_, j) => j !== i))}><Trash2 /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="pb-btn kucuk" style={{ justifySelf: "start" }} onClick={() => {
            const l = [...p.vergiDilimleri]; const son = l.pop()!; const onceki = l[l.length - 1];
            l.push({ ustSinir: (onceki?.ustSinir ?? 0) * 2 || 100000, oran: son.oran }, son); d("vergiDilimleri", l);
          }}><Plus /> Dilim ekle</button>

          <h4>Çalışan kesintileri</h4>
          <div className="grup">
            <div><label>SGK işçi payı</label><Yuzde v={p.sgkIsci} d={(v) => d("sgkIsci", v)} /></div>
            <div><label>İşsizlik işçi payı</label><Yuzde v={p.issizlikIsci} d={(v) => d("issizlikIsci", v)} /></div>
            <div><label>Damga vergisi</label><InputNumber value={Math.round(p.damgaVergisi * 1000000) / 10000} onChange={(x) => d("damgaVergisi", (x ?? 0) / 100)} step={0.001} decimalSeparator="," addonAfter="%" /></div>
          </div>
          <h4>İşveren payları</h4>
          <p>SSK işveren primi brütün (tavana kadar) yüzdesi; 5510/81 teşviki ile 2 puan (daha önce 5 puan) düşülür; işsizlik işveren ayrıca eklenir. Emekli çalışanda bunların yerine SGDP oranları geçer, indirim ve işsizlik uygulanmaz.</p>
          <div className="grup">
            <div><label>SSK işveren</label><Yuzde v={p.sgkIsveren} d={(v) => d("sgkIsveren", v)} /></div>
            <div><label>İşveren indirimi (puan)</label><Yuzde v={p.isverenIndirim} d={(v) => d("isverenIndirim", v)} /></div>
            <div><label>İşsizlik işveren</label><Yuzde v={p.issizlikIsveren} d={(v) => d("issizlikIsveren", v)} /></div>
            <div><label>SGDP işçi (emekli)</label><Yuzde v={p.sgdpIsci} d={(v) => d("sgdpIsci", v)} /></div>
            <div><label>SGDP işveren (emekli)</label><Yuzde v={p.sgdpIsveren} d={(v) => d("sgdpIsveren", v)} /></div>
          </div>
          <h4>Diğer</h4>
          <div className="grup">
            <div><label>Maliyet katsayısı (FM / tatil)</label><InputNumber value={p.maliyetKatsayisi} onChange={(v) => d("maliyetKatsayisi", v ?? 1)} min={1} step={0.05} decimalSeparator="," /></div>
            <div><label>Resmi tatil günlük tutar (kişi başı)</label><InputNumber value={p.gtGunluk} onChange={(v) => d("gtGunluk", v ?? 0)} min={0} step={50} decimalSeparator="," /></div>
            <div><label>Gece mesai katsayısı</label><InputNumber value={p.geceSaatKatsayisi} onChange={(v) => d("geceSaatKatsayisi", v ?? 1)} min={1} step={0.125} decimalSeparator="," /></div>
            <div><label>Zamda asgari net tabanı</label><Checkbox checked={p.bordroNetEnAzAsgari} onChange={(e) => d("bordroNetEnAzAsgari", e.target.checked)}>Bordro neti asgari netin altına inmesin</Checkbox></div>
            <div><label>Yol SGK + vergi payı</label><Yuzde v={p.yolSgkOrani ?? 0.35} d={(v) => d("yolSgkOrani", v)} /></div>
          </div>
          <p className="kucuk" style={{ margin: 0 }}>Maliyet katsayısı: fazla mesai ve resmi tatil ödemelerinin SGK + vergi yüküyle birlikte işverene maliyeti (Excel'de 1,35). Resmi tatil günlük tutarı: 2025'te ödenen 1 günlük tatil ücretinin ortalama maaşa oranı, bu yılın ortalama maaşına uygulanıp katsayıyla çarpılmış, kişi sayısına bölünmüş hâli.</p>
        </>
      )}

      {bolum === "yan" && (
        <>
          <h4>Kişi başı aylık yan giderler</h4>
          <p>Her aktif kişiye her ay eklenen sabit tutarlar (Excel'deki "2026 YEMEK", "2026 PRİM ÇEK"… sütunları). "Gün oranlı" işaretliyse part-time kişide 15/30 ile çarpılır. Her kalem kişi kartından kişiye özel tutarla ezilebilir (yol, kasa tazminatı, İSG kişiye göre değişir); buradaki tutar özel tutarı olmayanlar için varsayılandır. "Yol SGK payı" kişinin yolu × yol SGK oranı olarak kendiliğinden hesaplanır, buradaki tutarı kullanılmaz. Kazan-Kazan Excel'de toplamdan çıkarılıyordu; burada maliyet olarak eklenir — istemiyorsanız 0 yazın.</p>
          <div className="pb-tablo dar">
            <table>
              <thead><tr><th>Kalem</th><th className="sag">Aylık, kişi başı</th><th>Gün oranlı</th><th>Açıklama</th><th /></tr></thead>
              <tbody>
                {p.yanGiderler.map((y, i) => (
                  <tr key={y.kod + i}>
                    <td><Input value={y.ad} onChange={(e) => yanDegis(i, { ad: e.target.value })} style={{ width: 220 }} /></td>
                    <td className="sag"><InputNumber value={y.tutar} min={0} step={50} decimalSeparator="," onChange={(v) => yanDegis(i, { tutar: v ?? 0 })} /></td>
                    <td><Checkbox checked={!!y.gunOranli} onChange={(e) => yanDegis(i, { gunOranli: e.target.checked })} /></td>
                    <td><Input value={y.aciklama ?? ""} onChange={(e) => yanDegis(i, { aciklama: e.target.value })} placeholder="nereden geldi" /></td>
                    <td><button className="pb-btn kucuk tehlike" onClick={() => d("yanGiderler", p.yanGiderler.filter((_, j) => j !== i))}><Trash2 /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Toplam (30 gün)</td><td className="sag mono">{para(p.yanGiderler.reduce((t, y) => t + y.tutar, 0))}</td><td colSpan={3} /></tr></tfoot>
            </table>
          </div>
          <button className="pb-btn kucuk" style={{ justifySelf: "start" }} onClick={() => d("yanGiderler", [...p.yanGiderler, { kod: "yeni" + Date.now(), ad: "Yeni kalem", tutar: 0 }])}><Plus /> Kalem ekle</button>
        </>
      )}

      {bolum === "tek" && (
        <>
          <h4>Tek seferlik kalemler</h4>
          <p>Yılın belli aylarına düşen ödemeler. <b>Çalışma ayı</b>: resmi tatil ya da gece çalışması o ay yapılır, bir sonraki ayın bordrosuyla ödenir. <b>Ödeme ayı</b>: çek, kıyafet gibi doğrudan o ay ödenenler. Resmi tatilde tutar = gün × günlük tutar (Oranlar sekmesi); gece çalışmasında şube tablosundan kişi başı tutar × çarpan (Eylül için 0,5).</p>
          <div className="pb-tablo dar">
            <table>
              <thead><tr><th>Kalem</th><th>Ay</th><th>Tür</th><th className="sag">Gün</th><th className="sag">Tutar / çarpan</th><th className="sag">Kişi başı</th><th /></tr></thead>
              <tbody>
                {p.tekSeferlikler.map((t, i) => (
                  <tr key={t.kod + i}>
                    <td><Input value={t.ad} onChange={(e) => tekDegis(i, { ad: e.target.value })} style={{ width: 260 }} /></td>
                    <td><Select value={t.ay} onChange={(v) => tekDegis(i, { ay: v })} options={AYLAR.map((a, j) => ({ value: j + 1, label: a }))} style={{ width: 110 }} /></td>
                    <td><Select value={t.ayTuru} onChange={(v) => tekDegis(i, { ayTuru: v })} options={[{ value: "bordro", label: "Çalışma ayı" }, { value: "odeme", label: "Ödeme ayı" }]} style={{ width: 120 }} /></td>
                    <td className="sag">{t.gece ? <span className="kucuk">gece</span> : <InputNumber value={t.gun ?? null} min={0} step={0.5} decimalSeparator="," placeholder="—" onChange={(v) => tekDegis(i, { gun: v ?? null })} style={{ width: 80 }} />}</td>
                    <td className="sag"><InputNumber value={t.tutar} min={0} step={t.gece ? 0.5 : 100} decimalSeparator="," disabled={t.gun !== null && t.gun !== undefined && !t.gece} onChange={(v) => tekDegis(i, { tutar: v ?? 0 })} /></td>
                    <td className="sag mono">{t.gece ? "şubeye göre" : para(t.gun ? t.gun * p.gtGunluk : t.tutar)}</td>
                    <td><button className="pb-btn kucuk tehlike" onClick={() => d("tekSeferlikler", p.tekSeferlikler.filter((_, j) => j !== i))}><Trash2 /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pb-btn kucuk" onClick={() => d("tekSeferlikler", [...p.tekSeferlikler, { kod: "gt" + Date.now(), ad: "Resmi tatil çalışması", ay: 1, ayTuru: "bordro", tutar: 0, gun: 1 }])}><Plus /> Resmi tatil</button>
            <button className="pb-btn kucuk" onClick={() => d("tekSeferlikler", [...p.tekSeferlikler, { kod: "cek" + Date.now(), ad: "Çek / ödeme", ay: 1, ayTuru: "odeme", tutar: 0, gun: null }])}><Plus /> Çek / ödeme</button>
            <button className="pb-btn kucuk" onClick={() => d("tekSeferlikler", [...p.tekSeferlikler, { kod: "gece" + Date.now(), ad: "Gece çalışması", ay: 6, ayTuru: "bordro", tutar: 1, gece: true }])}><Plus /> Gece çalışması</button>
          </div>
        </>
      )}

      {bolum === "gece" && (
        <>
          <h4>Gece çalışması kadrosu</h4>
          <p>Yaz aylarında şubede gece çalışan 4 ya da 5 kişinin fazla mesaisi: her rol için maaş / 225 × katsayı × 30 saat, toplamı maliyet katsayısıyla çarpılır ve şubenin norm kadrosuna bölünerek kişi başı aylık tutar bulunur. Listede olmayan şubeye gece çalışması yazılmaz.</p>
          <div className="pb-izg esit">
            <div className="pb-tablo dar">
              <table>
                <thead><tr><th>Rol</th><th className="sag">Maaş</th><th>4 kişilik kadroda</th><th className="sag">Aylık mesai</th><th /></tr></thead>
                <tbody>
                  {p.geceRoller.map((r, i) => (
                    <tr key={i}>
                      <td><Input value={r.ad} onChange={(e) => roldegis(i, { ad: e.target.value })} style={{ width: 140 }} /></td>
                      <td className="sag"><InputNumber value={r.maas} min={0} step={500} decimalSeparator="," onChange={(v) => roldegis(i, { maas: v ?? 0 })} /></td>
                      <td><Checkbox checked={r.dortKisideVar} onChange={(e) => roldegis(i, { dortKisideVar: e.target.checked })} /></td>
                      <td className="sag mono">{para((r.maas / 225) * p.geceSaatKatsayisi * 30)}</td>
                      <td><button className="pb-btn kucuk tehlike" onClick={() => d("geceRoller", p.geceRoller.filter((_, j) => j !== i))}><Trash2 /></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>5 kişi × {p.maliyetKatsayisi}</td><td colSpan={2} /><td className="sag mono">{para(p.geceRoller.reduce((t, r) => t + (r.maas / 225) * p.geceSaatKatsayisi * 30, 0) * p.maliyetKatsayisi)}</td><td /></tr>
                  <tr><td>4 kişi × {p.maliyetKatsayisi}</td><td colSpan={2} /><td className="sag mono">{para(p.geceRoller.filter((r) => r.dortKisideVar).reduce((t, r) => t + (r.maas / 225) * p.geceSaatKatsayisi * 30, 0) * p.maliyetKatsayisi)}</td><td /></tr>
                </tfoot>
              </table>
              <button className="pb-btn kucuk" style={{ marginTop: 8 }} onClick={() => d("geceRoller", [...p.geceRoller, { ad: "Rol", maas: 0, dortKisideVar: true }])}><Plus /> Rol ekle</button>
            </div>
            <div className="pb-tablo dar yuksek">
              <table>
                <thead><tr><th>Şube</th><th className="sag">Kişi</th><th className="sag">Norm</th><th className="sag">Kişi başı / ay</th><th /></tr></thead>
                <tbody>
                  {p.geceSubeler.map((s, i) => {
                    const mesai = p.geceRoller.filter((r) => s.kisi >= 5 || r.dortKisideVar).reduce((t, r) => t + (r.maas / 225) * p.geceSaatKatsayisi * 30, 0) * p.maliyetKatsayisi;
                    return (
                      <tr key={i}>
                        <td>{subeler?.length ? <Select showSearch value={s.sube} onChange={(v) => subeDegis(i, { sube: v })} options={subeler.map((x) => ({ value: x, label: x }))} style={{ width: 200 }} /> : <Input value={s.sube} onChange={(e) => subeDegis(i, { sube: e.target.value })} style={{ width: 200 }} />}</td>
                        <td className="sag"><Select value={s.kisi} onChange={(v) => subeDegis(i, { kisi: v })} options={[{ value: 4, label: "4" }, { value: 5, label: "5" }]} style={{ width: 70 }} /></td>
                        <td className="sag"><InputNumber value={s.norm} min={1} onChange={(v) => subeDegis(i, { norm: v ?? 1 })} style={{ width: 80 }} /></td>
                        <td className="sag mono">{para(s.norm ? mesai / s.norm : 0)}</td>
                        <td><button className="pb-btn kucuk tehlike" onClick={() => d("geceSubeler", p.geceSubeler.filter((_, j) => j !== i))}><Trash2 /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="pb-btn kucuk" style={{ marginTop: 8 }} onClick={() => d("geceSubeler", [...p.geceSubeler, { sube: subeler?.[0] ?? "", kisi: 5, norm: 20 }])}><Plus /> Şube ekle</button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  function yanDegis(i: number, v: Partial<YanGider>) { d("yanGiderler", p.yanGiderler.map((y, j) => (j === i ? { ...y, ...v } : y))); }
  function tekDegis(i: number, v: Partial<TekSeferlik>) { d("tekSeferlikler", p.tekSeferlikler.map((y, j) => (j === i ? { ...y, ...v } : y))); }
  function roldegis(i: number, v: Partial<Parametre["geceRoller"][number]>) { d("geceRoller", p.geceRoller.map((y, j) => (j === i ? { ...y, ...v } : y))); }
  function subeDegis(i: number, v: Partial<Parametre["geceSubeler"][number]>) { d("geceSubeler", p.geceSubeler.map((y, j) => (j === i ? { ...y, ...v } : y))); }
}

/* ============================================================ zam kuralları */

export function KuralDuzenleyici({ kurallar, degistir, subeler, meslekler, kisiler }: { kurallar: Kural[]; degistir: (k: Kural[]) => void; subeler: string[]; meslekler: string[]; kisiler?: { id: number; ad: string }[] }) {
  const d = (i: number, v: Partial<Kural>) => degistir(kurallar.map((k, j) => (j === i ? { ...k, ...v } : k)));
  const genel = kurallar.find((k) => k.tur === "genel");
  return (
    <div>
      <div className="pb-kural pb-kural-baslik"><span>Kapsam</span><span>Şube</span><span>Meslek / kişi</span><span>Bordro zam</span><span>GRM zam</span><span /></div>
      {kurallar.map((k, i) => (
        <div className="pb-kural" key={i}>
          <Select value={k.tur} onChange={(v) => d(i, { tur: v, sube: null, meslek: null, kisiId: null })}
            options={[{ value: "genel", label: "Genel" }, { value: "sube", label: "Şube" }, { value: "meslek", label: "Meslek" }, { value: "subeMeslek", label: "Şube + meslek" }, ...(kisiler ? [{ value: "kisi", label: "Kişi" }] : [])]} />
          {k.tur === "sube" || k.tur === "subeMeslek" ? <Select showSearch value={k.sube ?? undefined} onChange={(v) => d(i, { sube: v })} placeholder="Şube" options={subeler.map((s) => ({ value: s, label: s }))} /> : <span className="kucuk" style={{ textAlign: "center" }}>{k.tur === "genel" ? "herkes" : "—"}</span>}
          {k.tur === "meslek" || k.tur === "subeMeslek" ? <Select showSearch value={k.meslek ?? undefined} onChange={(v) => d(i, { meslek: v })} placeholder="Meslek" options={meslekler.map((s) => ({ value: s, label: s }))} />
            : k.tur === "kisi" && kisiler ? <Select showSearch value={k.kisiId ?? undefined} onChange={(v) => d(i, { kisiId: v })} placeholder="Kişi" optionFilterProp="label" options={kisiler.map((s) => ({ value: s.id, label: s.ad }))} />
            : <span className="kucuk" style={{ textAlign: "center" }}>—</span>}
          <InputNumber value={Math.round(k.bordroOran * 10000) / 100} onChange={(v) => d(i, { bordroOran: (v ?? 0) / 100 })} step={1} decimalSeparator="," addonAfter="%" />
          <InputNumber value={k.grmOran === null || k.grmOran === undefined ? null : Math.round(k.grmOran * 10000) / 100} onChange={(v) => d(i, { grmOran: v === null || v === undefined ? null : v / 100 })} step={1} decimalSeparator="," addonAfter="%" placeholder="aynı" />
          <button className="pb-btn kucuk tehlike" onClick={() => degistir(kurallar.filter((_, j) => j !== i))}><Trash2 /></button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {!genel && <button className="pb-btn kucuk" onClick={() => degistir([{ tur: "genel", bordroOran: 0.25, grmOran: null }, ...kurallar])}><Plus /> Genel zam</button>}
        <button className="pb-btn kucuk" onClick={() => degistir([...kurallar, { tur: "sube", sube: subeler[0] ?? null, bordroOran: 0.25, grmOran: null }])}><Plus /> Şube kuralı</button>
        <button className="pb-btn kucuk" onClick={() => degistir([...kurallar, { tur: "meslek", meslek: meslekler[0] ?? null, bordroOran: 0.25, grmOran: null }])}><Plus /> Meslek kuralı</button>
        <button className="pb-btn kucuk" onClick={() => degistir([...kurallar, { tur: "subeMeslek", sube: subeler[0] ?? null, meslek: meslekler[0] ?? null, bordroOran: 0.25, grmOran: null }])}><Plus /> Şube + meslek</button>
        {kisiler && <button className="pb-btn kucuk" onClick={() => degistir([...kurallar, { tur: "kisi", kisiId: kisiler[0]?.id ?? null, bordroOran: 0.25, grmOran: null }])}><Plus /> Kişi istisnası</button>}
      </div>
      <p className="kucuk" style={{ margin: "10px 0 0" }}>Öncelik: kişi &gt; şube + meslek &gt; meslek &gt; şube &gt; genel. Bir kişiye yalnız en özel kural uygulanır. GRM zam boşsa bordro oranı kullanılır. "Asgari net tabanı" açıksa zam sonrası bordro neti asgari ücret netinin altında kalmaz.</p>
    </div>
  );
}
