/**
 * Senaryo karşılaştırma (30.10.2026): iki senaryo yan yana, fark kartları,
 * aylık toplam, şube ve meslek farkı.
 */
import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Select, Spin } from "antd";
import { ArrowRight } from "lucide-react";
import type { Donem, GrupOzeti, Ozet } from "./butceOrtak";
import { BILESENLER, butceApi, farkYuzde, para, paraKisa, sayi } from "./butceOrtak";
import { AylikYigilmis } from "./ButceGrafik";

interface Props { donemler: Donem[]; ilkA: number; ilkB?: number | null }

export default function ButceKarsilastir({ donemler, ilkA, ilkB }: Props) {
  const { message } = AntdApp.useApp();
  const [a, setA] = useState(ilkB ?? donemler.find((d) => d.id !== ilkA)?.id ?? ilkA);
  const [b, setB] = useState(ilkA);
  const [veri, setVeri] = useState<{ a: { donem: Donem; ozet: Ozet }; b: { donem: Donem; ozet: Ozet } } | null>(null);
  const [grup, setGrup] = useState<"subeler" | "meslekler">("subeler");

  useEffect(() => {
    setVeri(null);
    if (!a || !b) return;
    butceApi.karsilastir(a, b).then(setVeri).catch((h: any) => message.error(h?.message ?? "Karşılaştırılamadı"));
  }, [a, b, message]);

  const secenekler = donemler.map((d) => ({ value: d.id, label: `${d.ad} (${d.yil})` }));

  const satirlar = useMemo(() => {
    if (!veri) return [];
    const ma = new Map(veri.a.ozet[grup].map((g) => [g.ad, g]));
    const mb = new Map(veri.b.ozet[grup].map((g) => [g.ad, g]));
    const adlar = [...new Set([...ma.keys(), ...mb.keys()])];
    return adlar.map((ad) => ({ ad, a: ma.get(ad) ?? null, b: mb.get(ad) ?? null, fark: (mb.get(ad)?.toplam ?? 0) - (ma.get(ad)?.toplam ?? 0) }))
      .sort((x, y) => Math.abs(y.fark) - Math.abs(x.fark));
  }, [veri, grup]);

  const Kart = ({ etiket, va, vb, bicim = paraKisa, tersi }: { etiket: string; va: number; vb: number; bicim?: (v: number) => string; tersi?: boolean }) => {
    const f = vb - va;
    const kotu = tersi ? f < 0 : f > 0;
    return (
      <div><small>{etiket}</small><b>{bicim(vb)}</b><span className={kotu ? "eksi" : "arti"}>{f >= 0 ? "+" : "−"}{bicim(Math.abs(f))} · {farkYuzde(vb, va)}</span><div className="kucuk">{veri?.a.donem.yil}: {bicim(va)}</div></div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="pb-pk">
        <div className="pb-filtre" style={{ marginBottom: 0 }}>
          <Select value={a} onChange={setA} options={secenekler} style={{ minWidth: 280 }} />
          <ArrowRight size={16} color="#98a19b" />
          <Select value={b} onChange={setB} options={secenekler} style={{ minWidth: 280 }} />
          <span className="kucuk">Soldaki baz, sağdaki karşılaştırılan; farklar sağdakinin soldakine göre.</span>
        </div>
      </div>

      {!veri ? <div className="pb-bos"><Spin /></div> : (
        <>
          <div className="pb-delta">
            <Kart etiket="Yıllık toplam maliyet" va={veri.a.ozet.yillikToplam} vb={veri.b.ozet.yillikToplam} />
            <Kart etiket="Aylık ortalama" va={veri.a.ozet.aylikOrtalama} vb={veri.b.ozet.aylikOrtalama} />
            <Kart etiket="Kişi başı aylık" va={veri.a.ozet.kisiBasiAylik} vb={veri.b.ozet.kisiBasiAylik} bicim={para} />
            <Kart etiket="Yıllık gerçek net (GRM)" va={veri.a.ozet.yillikGrm} vb={veri.b.ozet.yillikGrm} />
          </div>

          <div className="pb-kars">
            <div className="pb-pk">
              <h3>{veri.a.donem.ad} <small>{veri.a.ozet.kisi} kişi · {sayi(veri.a.ozet.fte, 1)} FTE · asgari net {para(veri.a.ozet.asgariNet)}</small></h3>
              <AylikYigilmis aylar={veri.a.ozet.bordroAylari} yukseklik={240} />
            </div>
            <div className="ok"><ArrowRight /></div>
            <div className="pb-pk">
              <h3>{veri.b.donem.ad} <small>{veri.b.ozet.kisi} kişi · {sayi(veri.b.ozet.fte, 1)} FTE · asgari net {para(veri.b.ozet.asgariNet)}</small></h3>
              <AylikYigilmis aylar={veri.b.ozet.bordroAylari} bazAylar={veri.a.ozet.bordroAylari} bazAd={veri.a.donem.ad} yukseklik={240} />
            </div>
          </div>

          <div className="pb-izg">
            <div className="pb-pk">
              <h3>{grup === "subeler" ? "Şube" : "Meslek"} farkları
                <div className="pb-seg"><button className={grup === "subeler" ? "on" : ""} onClick={() => setGrup("subeler")}>Şubeler</button><button className={grup === "meslekler" ? "on" : ""} onClick={() => setGrup("meslekler")}>Meslekler</button></div>
              </h3>
              <div className="pb-tablo yuksek">
                <table>
                  <thead><tr><th>{grup === "subeler" ? "Şube" : "Meslek"}</th><th className="sag">{veri.a.donem.yil} kişi</th><th className="sag">{veri.a.donem.yil} toplam</th><th className="sag">{veri.b.donem.yil} kişi</th><th className="sag">{veri.b.donem.yil} toplam</th><th className="sag">Fark</th></tr></thead>
                  <tbody>
                    {satirlar.map((s) => <Satir key={s.ad} s={s} />)}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="pb-pk">
              <h3>Bileşen farkları <small>yıllık</small></h3>
              <div className="pb-tablo dar">
                <table>
                  <thead><tr><th>Bileşen</th><th className="sag">{veri.a.donem.yil}</th><th className="sag">{veri.b.donem.yil}</th><th className="sag">Fark</th></tr></thead>
                  <tbody>
                    {BILESENLER.map((bl) => {
                      const k = bl.k === "brut" ? "yillikBrut" : bl.k === "isverenSgk" ? "yillikIsverenSgk" : bl.k === "grFarki" ? "yillikGrFarki" : bl.k === "yanGider" ? "yillikYanGider" : "yillikTekSeferlik";
                      const va = veri.a.ozet[k], vb = veri.b.ozet[k];
                      return <tr key={bl.k}><td><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: bl.renk, marginRight: 8 }} />{bl.ad}</td><td className="sag mono">{paraKisa(va)}</td><td className="sag mono">{paraKisa(vb)}</td><td className={"sag mono " + (vb > va ? "eksi" : "arti")}>{vb - va >= 0 ? "+" : "−"}{paraKisa(Math.abs(vb - va))} · {farkYuzde(vb, va)}</td></tr>;
                    })}
                    <tr><td style={{ fontWeight: 800 }}>Toplam</td><td className="sag mono" style={{ fontWeight: 800 }}>{paraKisa(veri.a.ozet.yillikToplam)}</td><td className="sag mono" style={{ fontWeight: 800 }}>{paraKisa(veri.b.ozet.yillikToplam)}</td><td className={"sag mono " + (veri.b.ozet.yillikToplam > veri.a.ozet.yillikToplam ? "eksi" : "arti")} style={{ fontWeight: 800 }}>{farkYuzde(veri.b.ozet.yillikToplam, veri.a.ozet.yillikToplam)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Satir({ s }: { s: { ad: string; a: GrupOzeti | null; b: GrupOzeti | null; fark: number } }) {
  return (
    <tr>
      <td>{s.ad}</td>
      <td className="sag mono">{s.a ? s.a.kisi : "—"}</td>
      <td className="sag mono">{s.a ? para(s.a.toplam) : "—"}</td>
      <td className="sag mono">{s.b ? s.b.kisi : "—"}</td>
      <td className="sag mono">{s.b ? para(s.b.toplam) : "—"}</td>
      <td className={"sag mono " + (s.fark > 0 ? "eksi" : "arti")}>{s.fark >= 0 ? "+" : "−"}{paraKisa(Math.abs(s.fark))}{s.a && s.b ? ` · ${farkYuzde(s.b.toplam, s.a.toplam)}` : s.a ? " · kaldırıldı" : " · yeni"}</td>
    </tr>
  );
}
