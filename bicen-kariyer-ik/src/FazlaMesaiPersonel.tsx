/**
 * Personel Talepleri › Fazla mesai › satıra tıklayınca açılan yan pencere
 * (15.10.2026). Üstte seçilen kaydın ayrıntısı (eskiden satırın "+" ile
 * açılan kısmı), altında personelin fazla mesai geçmişi: bu ay, geçen ay,
 * bu yıl, toplam, son 12 ay ve bütün kayıtlar.
 */

import { ReactNode, useEffect, useState } from "react";
import { Drawer, Empty, Spin, Table, Tooltip } from "antd";
import { UserRound } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";
import { KarsilikEtiketi, type Karsilik } from "./FazlaMesaiKarsilik";
import { personelKartiAc, personelKartiAcilabilir } from "./personelKarti";

interface Ozet {
  sicil: string;
  ad: string | null;
  sube: string | null;
  gorev: string | null;
  ozet: {
    buAyOnayliDk: number;
    buAySurecteDk: number;
    buAyKayit: number;
    gecenAyOnayliDk: number;
    buYilOnayliDk: number;
    toplamOnayliDk: number;
    toplamKayit: number;
    reddedilen: number;
    ilkTarih: string | null;
  };
  maasGorunur: boolean;
  saatUcreti: number | null;
  buAyUcret: number | null;
  buAySurecteUcret: number | null;
  buAyIzinDk: number;
  buYilIzinDk: number;
  aylar: { ay: string; onayliDk: number; surecteDk: number }[];
  kayitlar: {
    id: number;
    tarih: string;
    baslangic: string;
    bitis: string;
    dk: number;
    durum: string;
    durumAdi: string;
    aciklama: string | null;
    giren: string | null;
    karsilik: Karsilik | null;
  }[];
}

const saat = (dk: number) => {
  if (!dk) return "0 sa";
  const s = Math.floor(dk / 60);
  const d = dk % 60;
  return d === 0 ? `${s} sa` : s === 0 ? `${d} dk` : `${s} sa ${d} dk`;
};

/** Dar sütunda kısa durum adı; tam adı ipucunda */
const DURUM_KISA: Record<string, string> = {
  onaylandi: "Onaylandı",
  bekliyor: "İK onayında",
  ust: "Üst onayda",
  form: "Birim yöneticisinde",
  reddedildi: "Reddedildi",
  iptal: "İptal edildi",
};

const DURUM_RENK: Record<string, string> = {
  onaylandi: "fm-r-yesil",
  bekliyor: "fm-r-sari",
  ust: "fm-r-mavi",
  form: "fm-r-gri",
  reddedildi: "fm-r-kirmizi",
  iptal: "fm-r-gri",
};

export default function FazlaMesaiPersonel({
  sicil,
  adSoyad,
  seciliId,
  kapat,
  children,
}: {
  sicil: string | null;
  adSoyad?: string;
  seciliId?: number;
  kapat: () => void;
  /** Seçilen kaydın ayrıntısı */
  children?: ReactNode;
}) {
  const [v, setV] = useState<Ozet | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    if (!sicil) return;
    setV(null);
    setHata(null);
    api
      .al<Ozet>(`/api/FazlaMesai/PersonelOzet/${encodeURIComponent(sicil)}`)
      .then(setV)
      .catch((h: any) => setHata(h.message));
  }, [sicil, seciliId]);

  const enCok = Math.max(1, ...(v?.aylar ?? []).map((a) => a.onayliDk + a.surecteDk));

  return (
    <Drawer
      open={!!sicil}
      onClose={kapat}
      width="min(720px, 100vw)"
      destroyOnHidden
      title={
        <div className="fmp-bas">
          <b>{v?.ad ?? adSoyad ?? "Personel"}</b>
          <small>{[sicil, v?.gorev, v?.sube].filter(Boolean).join(" · ")}</small>
        </div>
      }
      extra={
        sicil && personelKartiAcilabilir() ? (
          <button type="button" className="it-dg kucuk" onClick={() => personelKartiAc(sicil)}>
            <UserRound size={14} /> Personel kartı
          </button>
        ) : null
      }
    >
      <style>{CSS}</style>

      {children && <section className="fmp-kayit">{children}</section>}

      {hata && <Empty description={hata} />}
      {!v && !hata && <Spin style={{ display: "block", margin: "40px auto" }} />}

      {v && (
        <div className="fmp">
          <div className="fmp-kpi">
            <div className="fmp-buyuk">
              <span>Bu ay girilen</span>
              <b>{saat(v.ozet.buAyOnayliDk + v.ozet.buAySurecteDk)}</b>
              <small>
                {saat(v.ozet.buAyOnayliDk)} onaylı · {saat(v.ozet.buAySurecteDk)} onayda · {v.ozet.buAyKayit} kayıt
              </small>
            </div>
            <div>
              <span>Geçen ay</span>
              <b>{saat(v.ozet.gecenAyOnayliDk)}</b>
              <small>onaylı</small>
            </div>
            <div>
              <span>Bu yıl</span>
              <b>{saat(v.ozet.buYilOnayliDk)}</b>
              <small>onaylı</small>
            </div>
            <div>
              <span>Geriye dönük toplam</span>
              <b>{saat(v.ozet.toplamOnayliDk)}</b>
              <small>
                {v.ozet.toplamKayit} kayıt{v.ozet.ilkTarih ? ` · ${dayjs(v.ozet.ilkTarih).format("DD.MM.YYYY")}'den beri` : ""}
              </small>
            </div>
            {v.maasGorunur && v.buAyUcret != null && (
              <div>
                <span>Bu ay FM ücreti</span>
                <b>{(v.buAyUcret + (v.buAySurecteUcret ?? 0)).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺</b>
                <small>
                  {v.buAyUcret.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺ onaylı
                  {v.buAySurecteUcret ? ` · ${v.buAySurecteUcret.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺ onayda` : ""}
                </small>
              </div>
            )}
            {v.buAyIzinDk > 0 && (
              <div>
                <span>Bu ay serbest zaman</span>
                <b>{Math.round((v.buAyIzinDk / 60) * 100) / 100} sa</b>
                <small>izin karşılığı · bu yıl {Math.round((v.buYilIzinDk / 60) * 10) / 10} sa</small>
              </div>
            )}
          </div>

          <section className="fmp-kutu">
            <h4>Son 12 ay</h4>
            <div className="fmp-aylar">
              {[...v.aylar].reverse().map((a) => {
                const t = a.onayliDk + a.surecteDk;
                return (
                  <Tooltip key={a.ay} title={`${dayjs(a.ay + "-01").format("MMMM YYYY")} · ${saat(a.onayliDk)} onaylı${a.surecteDk ? ` · ${saat(a.surecteDk)} onayda` : ""}`}>
                    <div className="fmp-ay">
                      <div className="fmp-cubuk">
                        {t > 0 && (
                          <div style={{ height: `${Math.max(4, (t / enCok) * 100)}%` }}>
                            {a.surecteDk > 0 && <i className="surec" style={{ height: `${(a.surecteDk / t) * 100}%` }} />}
                            <i style={{ height: `${(a.onayliDk / t) * 100}%` }} />
                          </div>
                        )}
                      </div>
                      <span>{dayjs(a.ay + "-01").format("MMM")}</span>
                      <small>{t ? Math.round((t / 60) * 10) / 10 : ""}</small>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
            <div className="fmp-lejant">
              <span><i /> onaylı</span>
              <span><i className="surec" /> onay sürecinde</span>
              <span style={{ marginLeft: "auto" }}>saat</span>
            </div>
          </section>

          <section className="fmp-kutu">
            <h4>
              Bütün fazla mesaileri <small>{v.kayitlar.length} kayıt{v.ozet.reddedilen ? ` · ${v.ozet.reddedilen} reddedildi` : ""}</small>
            </h4>
            <Table
              rowKey="id"
              size="small"
              dataSource={v.kayitlar}
              pagination={{ pageSize: 12, hideOnSinglePage: true, showSizeChanger: false }}
              rowClassName={(k) => (k.id === seciliId ? "fmp-secili" : "")}
              tableLayout="fixed"
              columns={[
                {
                  title: "Tarih",
                  key: "tarih",
                  width: 128,
                  render: (_, k) => (
                    <div className="fmp-tarih">
                      <b>{dayjs(k.tarih).format("DD.MM.YYYY ddd")}</b>
                      <small>
                        {k.baslangic}–{k.bitis}
                      </small>
                    </div>
                  ),
                },
                {
                  title: "Süre",
                  key: "dk",
                  width: 92,
                  align: "right",
                  render: (_, k) => <span className="fmp-sayi fmp-tek">{saat(k.dk)}</span>,
                },
                {
                  title: "Neden",
                  dataIndex: "aciklama",
                  ellipsis: { showTitle: false },
                  render: (x: string) => (
                    <Tooltip title={x} placement="topLeft">
                      <span>{x}</span>
                    </Tooltip>
                  ),
                },
                {
                  title: "Karşılık",
                  key: "karsilik",
                  width: 150,
                  render: (_: unknown, k: Ozet["kayitlar"][number]) =>
                    k.karsilik ? (
                      <span className="fmp-karsilik">
                        <KarsilikEtiketi k={k.karsilik} onayli={k.durum === "onaylandi"} />
                      </span>
                    ) : (
                      <span style={{ color: "#c4c8ce" }}>—</span>
                    ),
                },
                {
                  title: "Durum",
                  key: "durum",
                  width: 138,
                  render: (_, k) => (
                    <Tooltip title={k.durumAdi}>
                      <span className={`fm-rozet fmp-rozet ${DURUM_RENK[k.durum] ?? "fm-r-gri"}`}>{DURUM_KISA[k.durum] ?? k.durumAdi}</span>
                    </Tooltip>
                  ),
                },
              ]}
            />
          </section>
        </div>
      )}
    </Drawer>
  );
}

const CSS = `
.fmp-bas{display:flex;flex-direction:column;line-height:1.25}
.fmp-bas small{font-weight:400;color:#8a929b;font-size:12px}
.fmp-kayit{border:1px solid #e6e9e3;border-radius:14px;background:#fafbf8;padding:12px 14px;margin-bottom:14px}
.fmp-kayit .fm-ayrinti{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 18px;padding:0}
@media (max-width:600px){.fmp-kayit .fm-ayrinti{grid-template-columns:minmax(0,1fr)}}
.fmp{display:flex;flex-direction:column;gap:14px}
.fmp-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.fmp-kpi>div{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid #e6e9e3;border-radius:12px;background:#fff;min-width:0}
.fmp-kpi span{font-size:12px;color:#6b7280;font-weight:600}
.fmp-kpi b{font-size:20px;color:#1f2933;font-variant-numeric:tabular-nums;line-height:1.2}
.fmp-kpi small{font-size:11.5px;color:#8a929b}
.fmp-kpi .fmp-buyuk{background:#f2f9e8;border-color:#d7ebb5;grid-column:span 2}
@media (max-width:600px){.fmp-kpi .fmp-buyuk{grid-column:auto}}
.fmp-kpi .fmp-buyuk b{color:#3f6108;font-size:24px}
.fmp-kutu{border:1px solid #e6e9e3;border-radius:14px;background:#fff;padding:12px 14px;min-width:0}
.fmp-kutu h4{margin:0 0 10px;font-size:14px;display:flex;gap:8px;align-items:baseline}
.fmp-kutu h4 small{font-weight:400;color:#8a929b;font-size:12px}
.fmp-aylar{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:4px;height:130px}
.fmp-ay{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0}
.fmp-cubuk{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid #e6e9e3}
.fmp-cubuk>div{width:70%;max-width:22px;display:flex;flex-direction:column;border-radius:4px 4px 0 0;overflow:hidden}
.fmp-cubuk i{display:block;width:100%;background:#7cb518}
.fmp-cubuk i.surec{background:#f0c24b}
.fmp-ay span{font-size:10.5px;color:#6b7280}
.fmp-ay small{font-size:10px;color:#8a929b;font-variant-numeric:tabular-nums;min-height:12px}
.fmp-lejant{display:flex;gap:14px;font-size:11.5px;color:#8a929b;margin-top:6px}
.fmp-lejant i{display:inline-block;width:9px;height:9px;border-radius:2px;background:#7cb518;margin-right:4px}
.fmp-lejant i.surec{background:#f0c24b}
.fmp-tarih{display:flex;flex-direction:column;line-height:1.25}
.fmp-tarih small{color:#8a929b;font-size:11.5px}
.fmp-sayi{font-variant-numeric:tabular-nums}
.fmp-tek{white-space:nowrap}
.fmp-karsilik{display:block;font-size:12px;line-height:1.35}
.fmp-karsilik>span>span:first-child{margin-left:-0.6em}
.fmp-rozet{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
.fmp-secili td{background:#f2f9e8 !important}
`;
