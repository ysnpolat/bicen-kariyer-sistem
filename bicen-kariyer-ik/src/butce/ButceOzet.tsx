/**
 * Personel Bütçesi › Özet (30.10.2026): KPI bandı, aylık yığılmış maliyet
 * (bordro ayı / ödeme ayı), maliyet bileşimi halkası, şube ve meslek
 * dağılımı. Şube satırına tıklanınca Kişiler sekmesi o şubeyle açılır.
 */
import { useMemo, useState } from "react";
import { Download, Info } from "lucide-react";
import type { AyOzeti, Donem, DonemYaniti, Ozet } from "./butceOrtak";
import { BILESENLER, farkYuzde, para, paraKisa, sayi } from "./butceOrtak";
import { AylikYigilmis, Halka, YatayCubuk } from "./ButceGrafik";
import { aylikExcel, subeExcel } from "./butceCikti";

interface Props {
  veri: DonemYaniti;
  subeyeGit: (sube: string) => void;
  meslegeGit: (meslek: string) => void;
}

const Kpi = ({ etiket, deger, alt, vurgu, fark }: { etiket: string; deger: string; alt?: string; vurgu?: boolean; fark?: number | null }) => (
  <div className={vurgu ? "vurgu" : ""}>
    <small>{etiket}</small>
    <b>{deger}</b>
    {fark !== undefined && fark !== null ? (
      <span className={"fark " + (fark > 0 ? (vurgu ? "" : "eksi") : "arti")} style={vurgu ? { color: fark > 0 ? "#ffb4ad" : "#b9e27c" } : undefined}>{alt}</span>
    ) : alt ? <span>{alt}</span> : null}
  </div>
);

export default function ButceOzet({ veri, subeyeGit, meslegeGit }: Props) {
  const { ozet, donem, baz } = veri;
  const [ayTuru, setAyTuru] = useState<"bordro" | "odeme">("bordro");
  const aylar: AyOzeti[] = ayTuru === "bordro" ? ozet.bordroAylari : ozet.odemeAylari;
  const bazAylar = baz ? (ayTuru === "bordro" ? baz.ozet.bordroAylari : baz.ozet.odemeAylari) : null;

  const bilesim = useMemo(() => BILESENLER.map((b) => ({
    ad: b.ad, renk: b.renk,
    deger: b.k === "brut" ? ozet.yillikBrut : b.k === "isverenSgk" ? ozet.yillikIsverenSgk : b.k === "grFarki" ? ozet.yillikGrFarki : b.k === "yanGider" ? ozet.yillikYanGider : ozet.yillikTekSeferlik,
  })), [ozet]);

  const bazFark = baz ? ozet.yillikToplam - baz.ozet.yillikToplam : null;

  return (
    <>
      <div className="pb-kpi">
        <Kpi vurgu etiket={`${donem.yil} yıllık toplam maliyet`} deger={paraKisa(ozet.yillikToplam)}
          alt={baz ? `${bazFark! >= 0 ? "+" : "−"}${paraKisa(Math.abs(bazFark!))} · ${farkYuzde(ozet.yillikToplam, baz.ozet.yillikToplam)} (${baz.donem.ad})` : `${sayi(ozet.kisi)} kişi · ${sayi(ozet.fte, 1)} FTE`}
          fark={baz ? bazFark : undefined} />
        <Kpi etiket="Aylık ortalama" deger={paraKisa(ozet.aylikOrtalama)} alt={baz ? `${baz.donem.yil}: ${paraKisa(baz.ozet.aylikOrtalama)}` : "12 bordro ayı"} />
        <Kpi etiket="Kişi başı aylık maliyet" deger={para(ozet.kisiBasiAylik)} alt={baz ? `${farkYuzde(ozet.kisiBasiAylik, baz.ozet.kisiBasiAylik)} (${baz.donem.yil}: ${para(baz.ozet.kisiBasiAylik)})` : "FTE başına"} />
        <Kpi etiket="Kişi · FTE" deger={`${sayi(ozet.kisi)} · ${sayi(ozet.fte, 1)}`} alt={baz ? `${baz.donem.yil}: ${sayi(baz.ozet.kisi)} · ${sayi(baz.ozet.fte, 1)}` : "aktif kişiler"} />
        <Kpi etiket="Net → maliyet çarpanı" deger={`×${ozet.netMaliyetCarpani.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`} alt="Toplam maliyet / kişiye ödenen gerçek net" />
        <Kpi etiket="Yıllık gerçek net (GRM)" deger={paraKisa(ozet.yillikGrm)} alt={`Bankaya ${paraKisa(ozet.yillikNetBanka)} + GR farkı ${paraKisa(ozet.yillikGrFarki)}`} />
      </div>

      <div className="pb-pk">
        <h3>
          Aylık maliyet
          <div className="pb-seg">
            <button className={ayTuru === "bordro" ? "on" : ""} onClick={() => setAyTuru("bordro")}>Bordro ayı</button>
            <button className={ayTuru === "odeme" ? "on" : ""} onClick={() => setAyTuru("odeme")}>Ödeme ayı</button>
          </div>
          <button className="pb-btn kucuk" style={{ marginLeft: 8 }} onClick={() => aylikExcel(donem, ozet, ayTuru)}><Download /> Excel</button>
        </h3>
        <p className="aciklama">
          {ayTuru === "bordro"
            ? "Her sütun o ayın bordrosu: ücret + işveren SGK + GR farkı + yan giderler + o ay çalışılan resmi tatil / gece ve o ay ödenen çekler."
            : "Her sütun o ay ödenen para: bir önceki ayın bordrosu + o ay ödenen çek / kıyafet. Ocak bordrosu Şubat'ta, Aralık bordrosu ertesi yılın Ocak'ında ödenir."}
          {baz && ` Kesik kırmızı çizgi ${baz.donem.ad} toplamı.`}
        </p>
        <AylikYigilmis aylar={aylar} bazAylar={bazAylar} bazAd={baz?.donem.ad} />
      </div>

      <div className="pb-izg">
        <div className="pb-pk">
          <h3>Şubeler <small>{ozet.subeler.length} şube · satıra tıklayınca kişiler açılır</small>
            <button className="pb-btn kucuk" style={{ marginLeft: 8 }} onClick={() => subeExcel(donem, ozet)}><Download /> Excel</button></h3>
          <SubeTablosu ozet={ozet} baz={baz?.ozet ?? null} bazDonem={baz?.donem ?? null} tikla={subeyeGit} />
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="pb-pk">
            <h3>Maliyet bileşimi <small>yıllık</small></h3>
            <Halka dilimler={bilesim} baslik="Yıllık" />
            <div className="kucuk" style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "flex-start" }}><Info size={13} style={{ flex: "none", marginTop: 3 }} />
              <span>Brüt ücret bordro brütüdür; işveren SGK, SSK işveren payından 5 puan indirim düşülüp işsizlik işveren eklenmiş hâli; GR farkı, gerçek netin bankaya yatan bordro netini aşan kısmı.</span></div>
          </div>
          <div className="pb-pk">
            <h3>Meslekler <small>yıllık toplam · tıklayınca kişiler</small></h3>
            <YatayCubuk satirlar={ozet.meslekler.map((m) => ({ ad: m.ad, deger: m.toplam, ek: `${m.kisi} kişi · kişi başı ${para(m.kisiBasiAylik)}/ay` }))} enFazla={14} onTikla={meslegeGit} />
          </div>
          <div className="pb-pk">
            <h3>Yan giderler <small>yıllık, kişi başı × kişi</small></h3>
            <YatayCubuk satirlar={ozet.yanGiderDagilimi.map((y) => ({ ad: y.ad, deger: y.tutar }))} enFazla={20} />
          </div>
          {ozet.tekSeferlikDagilimi.length > 0 && (
            <div className="pb-pk">
              <h3>Tek seferlik kalemler <small>yıllık</small></h3>
              <YatayCubuk satirlar={ozet.tekSeferlikDagilimi.map((y) => ({ ad: y.ad, deger: y.tutar }))} enFazla={20} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SubeTablosu({ ozet, baz, bazDonem, tikla }: { ozet: Ozet; baz: Ozet | null; bazDonem: Donem | null; tikla: (s: string) => void }) {
  const [sira, setSira] = useState<"toplam" | "kisi" | "ad" | "kisiBasi">("toplam");
  const bazMap = useMemo(() => new Map((baz?.subeler ?? []).map((s) => [s.ad, s])), [baz]);
  const l = useMemo(() => [...ozet.subeler].sort((a, b) =>
    sira === "ad" ? a.ad.localeCompare(b.ad, "tr") : sira === "kisi" ? b.fte - a.fte : sira === "kisiBasi" ? b.kisiBasiAylik - a.kisiBasiAylik : b.toplam - a.toplam), [ozet, sira]);
  const en = Math.max(1, ...l.map((s) => s.toplam));
  const Bas = ({ k, ad, sag }: { k: typeof sira; ad: string; sag?: boolean }) => (
    <th className={sag ? "sag" : ""}><button onClick={() => setSira(k)} style={{ fontWeight: sira === k ? 800 : 700, color: sira === k ? "#17321f" : undefined }}>{ad}{sira === k ? " ↓" : ""}</button></th>
  );
  return (
    <div className="pb-tablo yuksek">
      <table>
        <thead>
          <tr>
            <Bas k="ad" ad="Şube" />
            <Bas k="kisi" ad="Kişi · FTE" sag />
            <Bas k="toplam" ad="Yıllık toplam" sag />
            <th className="sag">Aylık</th>
            <Bas k="kisiBasi" ad="Kişi başı / ay" sag />
            {baz && <th className="sag">{bazDonem?.yil} farkı</th>}
          </tr>
        </thead>
        <tbody>
          {l.map((s) => {
            const b = bazMap.get(s.ad);
            return (
              <tr key={s.ad} className="tik" onClick={() => tikla(s.ad)}>
                <td><span className="pay" style={{ width: `${(s.toplam / en) * 80}px` }} />{s.ad}</td>
                <td className="sag mono">{s.kisi} · {sayi(s.fte, 1)}</td>
                <td className="sag mono" style={{ fontWeight: 700 }}>{para(s.toplam)}</td>
                <td className="sag mono">{para(s.toplam / 12)}</td>
                <td className="sag mono">{para(s.kisiBasiAylik)}</td>
                {baz && <td className={"sag mono " + (b && s.toplam > b.toplam ? "eksi" : "arti")}>{b ? `${s.toplam >= b.toplam ? "+" : "−"}${paraKisa(Math.abs(s.toplam - b.toplam))} · ${farkYuzde(s.toplam, b.toplam)}` : "yeni"}</td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Toplam</td>
            <td className="sag mono">{ozet.kisi} · {sayi(ozet.fte, 1)}</td>
            <td className="sag mono">{para(ozet.yillikToplam)}</td>
            <td className="sag mono">{para(ozet.aylikOrtalama)}</td>
            <td className="sag mono">{para(ozet.kisiBasiAylik)}</td>
            {baz && <td className={"sag mono " + (ozet.yillikToplam > baz.yillikToplam ? "eksi" : "arti")}>{farkYuzde(ozet.yillikToplam, baz.yillikToplam)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
