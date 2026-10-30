/* ===========================================================================
   İzin Yönetimi › Kontenjan (07.10.2026)

   Yıllık izin kontenjanı şube × ay: yıllık hedef (şubenin toplam hak
   edişi × hedef %) mevsim ağırlığıyla aylara, aylar şubelere bölünür.
   Personel randevu alır gibi kendi şubesinin boş gününü görür; ay doluysa
   en yakın boş aya yönlendirilir. Kişi başı aylık gün sınırı buradan.
   İK bir şube-ayı elle değiştirebilir ya da kapatabilir.
   =========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  InputNumber,
  Select,
  Spin,
  Switch,
} from "antd";
import { ChevronLeft, Save } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";
import { AY, AYU, g1, KisiListesi } from "./IzinRapor";
import type { RaporKisi } from "./IzinRapor";
import "./IzinRapor.css";

interface Hucre {
  ay: number;
  kontenjan: number;
  otomatik: number;
  elle: number | null;
  kapali: boolean;
  kullanilan: number;
  planli: number;
  dolu: number;
  bos: number;
}

interface Sube {
  sube: string;
  bolge: string | null;
  kisi: number;
  yillik: number;
  muaf: boolean;
  aylar: Hucre[];
}

interface Ayar {
  acik: boolean;
  baslangic: string | null;
  hedef: number;
  dagitim: "hakedis" | "kisi";
  agirlik: number[];
  tut: boolean;
  kisiBasiGun: number;
  oncelik: boolean;
  oncelikPay: number;
  oncelikGun: number;
  dolu: "oner" | "ik" | "engel";
  bayramKapali: boolean;
  muafSubeler: string[];
  turler: string[];
}

const oran = (h: Hucre) => (h.kontenjan > 0 ? Math.round((h.dolu * 100) / h.kontenjan) : h.dolu > 0 ? 999 : 0);
const hucreSinif = (h: Hucre) => (h.kapali ? "x" : oran(h) > 100 ? "k" : oran(h) >= 90 ? "t" : oran(h) >= 60 ? "y" : "b");

type Cek =
  | { tur: "ay"; ay: number }
  | { tur: "hucre"; sube: string; ay: number }
  | { tur: "kisi"; k: RaporKisi };

export default function IzinKontenjan({ onKisiAc }: { onKisiAc?: (sicil: string) => void }) {
  const { message } = AntdApp.useApp();

  const [yil, setYil] = useState(new Date().getFullYear());
  const [veri, setVeri] = useState<{ yil: number; bugunAy: number; ayar: Ayar; subeler: Sube[]; duzenleyebilir: boolean } | null>(null);
  const [kisiler, setKisiler] = useState<RaporKisi[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [ayar, setAyar] = useState<Ayar | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [bolge, setBolge] = useState<string | undefined>();
  const [yigin, setYigin] = useState<Cek[]>([]);
  const [elle, setElle] = useState<number | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const [k, r] = await Promise.all([
        api.al<any>(`/api/IzinRapor/Kontenjan?yil=${yil}`),
        api.al<any>(`/api/IzinRapor?yil=${yil}`),
      ]);
      setVeri(k);
      setAyar(k?.ayar ?? null);
      setKisiler(r?.kisiler ?? []);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [yil, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const subeler = useMemo(
    () => (veri?.subeler ?? []).filter((s) => !bolge || s.bolge === bolge),
    [veri, bolge]
  );
  const bolgeler = useMemo(
    () => [...new Set((veri?.subeler ?? []).map((s) => s.bolge).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "tr")),
    [veri]
  );

  const aktif = subeler.filter((s) => !s.muaf);
  const bugunAy = veri?.bugunAy ?? new Date().getMonth();
  const ayToplam = AY.map((_, i) => ({
    kont: aktif.reduce((t, s) => t + s.aylar[i].kontenjan, 0),
    dolu: aktif.reduce((t, s) => t + s.aylar[i].dolu, 0),
  }));
  const yilKont = ayToplam.reduce((t, x) => t + x.kont, 0);
  const yilDolu = ayToplam.reduce((t, x) => t + x.dolu, 0);
  const bosGecen = aktif.reduce((t, s) => t + s.aylar.slice(0, Math.max(0, bugunAy)).reduce((u, h) => u + Math.max(0, h.bos), 0), 0);
  const asan = aktif.reduce((t, s) => t + s.aylar.filter((h) => !h.kapali && h.dolu > h.kontenjan).length, 0);
  const kalanBos = aktif.reduce((t, s) => t + s.aylar.slice(Math.max(0, bugunAy)).reduce((u, h) => u + (h.kapali ? 0 : Math.max(0, h.bos)), 0), 0);

  const cek = yigin[yigin.length - 1];
  const ac = (c: Cek) => {
    setYigin((y) => [...y, c]);
    if (c.tur === "hucre") {
      const h = veri?.subeler.find((s) => s.sube === c.sube)?.aylar[c.ay];
      setElle(h?.elle ?? null);
    }
  };

  const duzelt = async (sube: string, ay: number, gun: number | null, kapali: boolean) => {
    try {
      await api.gonder("/api/IzinRapor/Kontenjan/Duzelt", { sube, yil: veri?.yil ?? yil, ay: ay + 1, gun, kapali });
      message.success(kapali ? `${sube} · ${AYU[ay]} yıllık izne kapatıldı.` : gun == null ? "Otomatik kontenjana dönüldü." : `${sube} · ${AYU[ay]} kontenjanı ${gun} gün.`);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const kaydet = async () => {
    if (!ayar) return;
    const toplam = ayar.agirlik.reduce((a, b) => a + (b || 0), 0);
    if (toplam <= 0) return message.error("Aylara dağıtım en az bir ayda 0'dan büyük olmalı.");
    setKaydediliyor(true);
    try {
      await api.gonder("/api/IzinRapor/Kontenjan/Ayar", ayar);
      message.success("Kontenjan ayarları kaydedildi.");
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const degis = (p: Partial<Ayar>) => setAyar((a) => (a ? { ...a, ...p } : a));

  if (!veri || !ayar)
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Spin spinning={yukleniyor} />
      </div>
    );

  const agirlikToplam = ayar.agirlik.reduce((a, b) => a + (b || 0), 0);
  const duz = veri.duzenleyebilir;
  const tumSubeler = (veri.subeler ?? []).map((s) => s.sube);

  /* ------------------------------------------------------------ çekmece içerikleri */
  const ayIcerik = (i: number) => {
    const l = aktif.slice().sort((a, b) => oran(b.aylar[i]) - oran(a.aylar[i]));
    return (
      <div className="ir-liste">
        {l.map((s) => {
          const h = s.aylar[i];
          return (
            <button type="button" key={s.sube} onClick={() => ac({ tur: "hucre", sube: s.sube, ay: i })}>
              <span className="sira">%{Math.min(999, oran(h))}</span>
              <span>
                <b>{s.sube}</b>
                <small>{g1(h.dolu)} / {h.kontenjan} gün{h.kapali ? " · kapalı" : h.elle != null ? " · elle" : ""}</small>
              </span>
              <span className={`ir-cip ${h.kapali ? "g" : h.bos < 0 ? "k" : oran(h) >= 90 ? "t" : "y"}`}>
                {h.kapali ? "kapalı" : h.bos >= 0 ? `${g1(h.bos)} boş` : `${g1(-h.bos)} aşım`}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const hucreIcerik = (subeAd: string, i: number) => {
    const s = veri.subeler.find((x) => x.sube === subeAd);
    if (!s) return null;
    const h = s.aylar[i];
    const l = kisiler
      .filter((k) => k.sube === subeAd && (k.aylar[i] || k.plan[i]))
      .sort((a, b) => b.aylar[i] + b.plan[i] - (a.aylar[i] + a.plan[i]));
    return (
      <div className="ir-ck">
        <div className="ir-mini">
          <div><span>Kontenjan</span><b>{h.kontenjan}</b></div>
          <div><span>Kullanılan</span><b>{g1(h.kullanilan)}</b></div>
          <div><span>Planlı</span><b>{g1(h.planli)}</b></div>
          <div><span>Boş</span><b style={{ color: h.bos < 0 ? "var(--ir-kirmizi)" : "var(--ir-yesil-k)" }}>{g1(h.bos)}</b></div>
        </div>
        <div className="ir-not bilgi">
          Otomatik hesap: <b>{h.otomatik} gün</b> (şubenin yıllık kontenjanı {g1(s.yillik)} gün × {AYU[i]} payı).
          {h.elle != null ? <> Elle <b>{h.elle} gün</b> yazıldı.</> : null}
          {h.kapali ? <> Bu ay <b>kapalı</b>.</> : null}
        </div>
        {duz && (
          <div className="ik-satir" style={{ alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Bu şube-ay için kontenjan</div>
              <InputNumber min={0} max={5000} value={elle ?? undefined} placeholder={String(h.otomatik)} onChange={(v) => setElle(v == null ? null : Number(v))} addonAfter="gün" style={{ width: 160 }} />
            </div>
            <div className="ir-dugmeler">
              <Button type="primary" disabled={elle == null} onClick={() => duzelt(subeAd, i, elle, false)}>Kaydet</Button>
              {(h.elle != null || h.kapali) && <Button onClick={() => duzelt(subeAd, i, null, false)}>Otomatiğe dön</Button>}
              {!h.kapali && <Button danger onClick={() => duzelt(subeAd, i, null, true)}>Bu ayı kapat</Button>}
            </div>
          </div>
        )}
        <h4 style={{ margin: "4px 0 0" }}>{AYU[i]} ayında izinli olanlar</h4>
        <KisiListesi
          kisiler={l}
          deger={(k) => [k.aylar[i] ? `${g1(k.aylar[i])} kullandı` : "", k.plan[i] ? `${g1(k.plan[i])} planlı` : ""].filter(Boolean).join(" · ")}
          onKisi={(k) => (onKisiAc ? onKisiAc(k.kod) : ac({ tur: "kisi", k }))}
        />
      </div>
    );
  };

  const baslik =
    cek?.tur === "ay"
      ? { b: `${AYU[cek.ay]} ${veri.yil} kontenjanı`, a: `${g1(ayToplam[cek.ay].dolu)} / ${ayToplam[cek.ay].kont} gün dolu` }
      : cek?.tur === "hucre"
      ? { b: `${cek.sube} · ${AYU[cek.ay]} ${veri.yil}`, a: "Şube-ay ayrıntısı" }
      : cek?.tur === "kisi"
      ? { b: cek.k.ad, a: cek.k.sube }
      : { b: "", a: "" };

  return (
    <div className="ir">
      <section className="ir-kart" style={{ borderColor: ayar.acik ? "var(--ir-yesil)" : "var(--ir-cizgi)" }}>
        <div className="ir-ust">
          <div>
            <h3>Yıllık izin kontenjanı · şube × ay</h3>
            <span>
              {ayar.acik
                ? `Açık · ${ayar.baslangic ? `${dayjs(ayar.baslangic).format("DD.MM.YYYY")} ve sonrası denetleniyor` : "hemen denetleniyor"}`
                : "Kapalı · rapor görünür, talepler denetlenmez"}
            </span>
          </div>
          <div className="ir-arac">
            <Select value={yil} onChange={setYil} style={{ width: 100 }} options={[-1, 0, 1].map((d) => ({ value: new Date().getFullYear() + d, label: String(new Date().getFullYear() + d) }))} />
            <Select allowClear placeholder="Bölge" value={bolge} onChange={setBolge} style={{ width: 160 }} options={bolgeler.map((x) => ({ value: x, label: x }))} />
          </div>
        </div>
        <div className="ir-not">
          Her şubenin her ay kendi kontenjanı var; bir şubenin boşu başka şubeye geçmez. Personel yıllık izin isterken kendi şubesinin boş gününü görür; ay doluysa en yakın boş aylar önerilir. Yalnızca yıllık izin düşer; rapor, mazeret, doğum ve ölüm izinleri sayılmaz.
        </div>
      </section>

      <div className="ir-kpiler">
        <div className="ir-kpi" style={{ cursor: "default" }}><span className="et">{veri.yil} kontenjanı</span><span className="d">{yilKont.toLocaleString("tr-TR")} gün</span><span className="alt">{aktif.length} şube · 12 ay</span></div>
        <div className="ir-kpi" style={{ cursor: "default" }}><span className="et">Dolan</span><span className="d">{g1(yilDolu)} gün</span><span className="alt">%{yilKont ? Math.round((yilDolu * 100) / yilKont) : 0} · kullanılan + planlı</span></div>
        <div className="ir-kpi uyari" style={{ cursor: "default" }}><span className="et">Boş geçen</span><span className="d">{g1(bosGecen)} gün</span><span className="alt">geçmiş aylar · devre dönüşür</span></div>
        <div className="ir-kpi kotu" style={{ cursor: "default" }}><span className="et">Kontenjanı aşan</span><span className="d">{asan} şube-ay</span><span className="alt">{ayar.baslangic ? "yürürlük öncesi dahil" : ""}</span></div>
        <div className="ir-kpi" style={{ cursor: "default" }}><span className="et">Seçilebilir boş</span><span className="d">{g1(kalanBos)} gün</span><span className="alt">bu aydan yıl sonuna</span></div>
      </div>

      <section className="ir-kart">
        <div className="ir-ust">
          <div>
            <h3>Aylar</h3>
            <span>Şirket toplamı · aya tıklayın: şube kırılımı</span>
          </div>
        </div>
        <div className="ik-ay-kartlar">
          {ayToplam.map((x, i) => {
            const o = x.kont ? Math.round((x.dolu * 100) / x.kont) : 0;
            return (
              <button type="button" key={i} className="ir-kpi" style={i === bugunAy ? { borderColor: "var(--ir-yesil)" } : undefined} onClick={() => ac({ tur: "ay", ay: i })}>
                <span className="et">{AYU[i]}{i < bugunAy ? " · geçti" : i === bugunAy ? " · bu ay" : ""}</span>
                <span className="d">{g1(x.dolu)} / {x.kont}</span>
                <span className="ik-cubuk"><b style={{ width: `${Math.min(100, o)}%`, background: o > 100 ? "var(--ir-kirmizi)" : "var(--ir-yesil)" }} /></span>
                <span className="alt">{x.kont - x.dolu >= 0 ? `${g1(x.kont - x.dolu)} gün boş` : `${g1(x.dolu - x.kont)} gün aşım`}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="ir-kart">
        <div className="ir-ust">
          <div>
            <h3>Şube × ay doluluğu</h3>
            <span>dolu / kontenjan · hücreye tıklayın: kimler izinli, kontenjanı değiştir ya da kapat</span>
          </div>
          <div className="ir-lejant">
            <span><i style={{ background: "#eef1eb" }} />%60 altı</span>
            <span><i style={{ background: "var(--ir-yesil-a)", boxShadow: "inset 0 0 0 1.5px var(--ir-yesil)" }} />%60–89</span>
            <span><i style={{ background: "var(--ir-turuncu-a)" }} />%90–100</span>
            <span><i style={{ background: "var(--ir-kirmizi-a)" }} />aşım</span>
            <span><i style={{ outline: "1.5px dashed var(--ir-mavi)" }} />elle</span>
          </div>
        </div>
        <div className="ik-tablo">
          <table>
            <thead>
              <tr>
                <th>ŞUBE</th>
                {AY.map((a, i) => <th key={a} style={i === bugunAy ? { color: "var(--ir-yesil-k)" } : undefined}>{a.toLocaleUpperCase("tr")}</th>)}
              </tr>
            </thead>
            <tbody>
              {subeler.map((s) => (
                <tr key={s.sube}>
                  <td>
                    <b>{s.sube}</b>
                    {s.muaf && <span className="ir-cip g" style={{ marginLeft: 6 }}>muaf</span>}
                  </td>
                  {s.aylar.map((h, i) => (
                    <td key={i}>
                      <button
                        type="button"
                        className={`ik-hucre ${s.muaf ? "b" : hucreSinif(h)}${h.elle != null ? " e" : ""}`}
                        aria-label={`${s.sube} ${AYU[i]}: ${g1(h.dolu)} / ${h.kontenjan}`}
                        onClick={() => ac({ tur: "hucre", sube: s.sube, ay: i })}
                      >
                        {h.kapali ? "kapalı" : `${g1(h.dolu)}/${h.kontenjan}`}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="ir-izgara">
        <section className="ir-kart">
          <div className="ir-ust">
            <div>
              <h3>Kontenjan ayarları</h3>
              <span>{duz ? "Kaydedince rapor yeniden hesaplanır" : "Yalnızca görüntüleme"}</span>
            </div>
            {duz && <Button type="primary" icon={<Save size={14} />} loading={kaydediliyor} onClick={kaydet}>Kaydet</Button>}
          </div>
          <div className="ik-satir">
            <span><b>Kontenjan denetimi</b><small>Açıkken personel dolu aya yıllık izin isteyemez</small></span>
            <Switch disabled={!duz} checked={ayar.acik} onChange={(v) => degis({ acik: v })} />
          </div>
          <div className="ik-satir">
            <span><b>Yürürlük</b><small>Bu tarihten önceki günler denetlenmez</small></span>
            <DatePicker disabled={!duz} format="DD.MM.YYYY" value={ayar.baslangic ? dayjs(ayar.baslangic) : null} onChange={(d) => degis({ baslangic: d ? d.format("YYYY-MM-DD") : null })} />
          </div>
          <div className="ik-satir">
            <span><b>Kişi başı bir ayda en çok</b><small>Bir kişi ayın bütün kontenjanını alamasın · 0 = sınırsız</small></span>
            <InputNumber disabled={!duz} min={0} max={31} value={ayar.kisiBasiGun} onChange={(v) => degis({ kisiBasiGun: Number(v ?? 0) })} addonAfter="gün" style={{ width: 130 }} />
          </div>
          <div className="ik-satir">
            <span><b>Yıllık hedef</b><small>Şubenin toplam hak edişinin (devir dahil) yüzde kaçı</small></span>
            <InputNumber disabled={!duz} min={10} max={200} value={ayar.hedef} onChange={(v) => degis({ hedef: Number(v ?? 100) })} addonAfter="%" style={{ width: 120 }} />
          </div>
          <div className="ik-satir">
            <span><b>Şubelere bölme</b></span>
            <Select disabled={!duz} value={ayar.dagitim} onChange={(v) => degis({ dagitim: v })} style={{ width: 250 }} options={[{ value: "hakedis", label: "Şubenin toplam hak edişine göre" }, { value: "kisi", label: "Personel sayısına göre" }]} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Aylara dağıtım (%) <span style={{ fontWeight: 400, color: agirlikToplam === 100 ? "#6b7280" : "var(--ir-turuncu)" }}>· toplam %{agirlikToplam}{agirlikToplam === 100 ? "" : " (oranlar yine de toplama göre bölünür)"}</span>
            </div>
            <div className="ik-agirlik">
              {AY.map((a, i) => (
                <label key={a}>
                  {a}
                  <InputNumber disabled={!duz} min={0} max={100} size="small" value={ayar.agirlik[i]} onChange={(v) => degis({ agirlik: ayar.agirlik.map((x, j) => (j === i ? Number(v ?? 0) : x)) })} style={{ width: "100%" }} />
                </label>
              ))}
            </div>
            {duz && (
              <div className="ir-dugmeler" style={{ marginTop: 8 }}>
                <Button size="small" onClick={() => degis({ agirlik: [8, 8, 8, 8, 9, 9, 8, 8, 9, 8, 8, 9] })}>Eşit dağıt</Button>
                <Button size="small" onClick={() => degis({ agirlik: [7, 7, 8, 8, 8, 10, 12, 12, 8, 7, 7, 6] })}>Mevsime göre (önerilen)</Button>
              </div>
            )}
          </div>
        </section>

        <section className="ir-kart">
          <div className="ir-ust">
            <div>
              <h3>Kurallar</h3>
              <span>Talep anında uygulanır; uyarı 1.5'te de görünür</span>
            </div>
          </div>
          <div className="ik-satir">
            <span><b>Ay doluysa</b><small>Yönlendir: talep açılmaz, en yakın boş aylar yazılır</small></span>
            <Select disabled={!duz} value={ayar.dolu} onChange={(v) => degis({ dolu: v })} style={{ width: 210 }} options={[{ value: "oner", label: "Boş aya yönlendir" }, { value: "ik", label: "Açılsın, İK onayına düşsün" }, { value: "engel", label: "Engelle" }]} />
          </div>
          <div className="ik-satir">
            <span><b>Onay bekleyen talep yer tutsun</b><small>Red ya da iptalde gün kontenjana döner</small></span>
            <Switch disabled={!duz} checked={ayar.tut} onChange={(v) => degis({ tut: v })} />
          </div>
          <div className="ik-satir">
            <span><b>Devri olanlara öncelik</b><small>Kontenjanın %{ayar.oncelikPay}'i ayın başlamasına {ayar.oncelikGun} gün kalana kadar yalnızca devri olanlara açık</small></span>
            <Switch disabled={!duz} checked={ayar.oncelik} onChange={(v) => degis({ oncelik: v })} />
          </div>
          {ayar.oncelik && (
            <div className="ik-satir">
              <span><small>Öncelik payı ve süresi</small></span>
              <span style={{ display: "flex", gap: 6 }}>
                <InputNumber disabled={!duz} min={0} max={100} size="small" value={ayar.oncelikPay} onChange={(v) => degis({ oncelikPay: Number(v ?? 0) })} addonAfter="%" style={{ width: 100 }} />
                <InputNumber disabled={!duz} min={0} max={90} size="small" value={ayar.oncelikGun} onChange={(v) => degis({ oncelikGun: Number(v ?? 0) })} addonAfter="gün" style={{ width: 110 }} />
              </span>
            </div>
          )}
          <div className="ik-satir">
            <span><b>Bayram ve yılbaşı haftaları kapalı</b><small>Bu haftalara yıllık izin seçilemez</small></span>
            <Switch disabled={!duz} checked={ayar.bayramKapali} onChange={(v) => degis({ bayramKapali: v })} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Muaf birimler</div>
            <Select disabled={!duz} mode="multiple" style={{ width: "100%" }} value={ayar.muafSubeler} onChange={(v) => degis({ muafSubeler: v })} placeholder="Genel merkez gibi kontenjan uygulanmayanlar" options={tumSubeler.map((x) => ({ value: x, label: x }))} />
          </div>
        </section>
      </div>

      <Drawer
        open={!!cek}
        onClose={() => setYigin([])}
        width="min(560px, 100vw)"
        title={
          cek ? (
            <div className="ir-ck-bas">
              {yigin.length > 1 && <Button size="small" type="text" icon={<ChevronLeft size={16} />} onClick={() => setYigin((y) => y.slice(0, -1))} aria-label="Geri" />}
              <div>
                <b>{baslik.b}</b>
                <small>{baslik.a}</small>
              </div>
            </div>
          ) : null
        }
      >
        {cek?.tur === "ay" && ayIcerik(cek.ay)}
        {cek?.tur === "hucre" && hucreIcerik(cek.sube, cek.ay)}
      </Drawer>
    </div>
  );
}
