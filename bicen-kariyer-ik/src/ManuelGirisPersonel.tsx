/**
 * Manuel giriş-çıkış talepleri › personele tıklayınca açılan yan pencere
 * (15.10.2026): bu ay kaç talep (giriş / çıkış / reddedilen), geçen ay,
 * bu yıl, son 12 ay ve bütün talepler açıklamalarıyla.
 */

import { useEffect, useState } from "react";
import { Drawer, Empty, Spin, Table, Tag, Tooltip } from "antd";
import { UserRound } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";
import { personelKartiAc, personelKartiAcilabilir } from "./personelKarti";

interface Kayit {
  id: number;
  tarih: string;
  tur: string;
  saat: string;
  sebep: string;
  durum: "Bekliyor" | "Onaylandı" | "Reddedildi";
  kararVeren: string | null;
  kararNotu: string | null;
  kararTarihi: string | null;
  olusturma: string;
}

interface Veri {
  sicil: string;
  ad: string | null;
  sube: string | null;
  ozet: {
    buAy: number;
    buAyGiris: number;
    buAyCikis: number;
    buAyRed: number;
    gecenAy: number;
    buYil: number;
    toplam: number;
    onaylanan: number;
    reddedilen: number;
  };
  aylar: { ay: string; adet: number }[];
  kayitlar: Kayit[];
}

const DURUM_RENK: Record<string, string> = { Bekliyor: "orange", Onaylandı: "green", Reddedildi: "red" };

export default function ManuelGirisPersonel({
  sicil,
  adSoyad,
  seciliId,
  kapat,
}: {
  sicil: string | null;
  adSoyad?: string;
  seciliId?: number;
  kapat: () => void;
}) {
  const [v, setV] = useState<Veri | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    if (!sicil) return;
    setV(null);
    setHata(null);
    api
      .al<Veri>(`/api/Mobil/Itirazlar/Personel/${encodeURIComponent(sicil)}`)
      .then(setV)
      .catch((h: any) => setHata(h.message));
  }, [sicil]);

  const enCok = Math.max(1, ...(v?.aylar ?? []).map((a) => a.adet));

  return (
    <Drawer
      open={!!sicil}
      onClose={kapat}
      width="min(720px, 100vw)"
      destroyOnHidden
      title={
        <div className="mgp-bas">
          <b>{v?.ad ?? adSoyad ?? "Personel"}</b>
          <small>{[sicil, v?.sube].filter(Boolean).join(" · ")}</small>
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

      {hata && <Empty description={hata} />}
      {!v && !hata && <Spin style={{ display: "block", margin: "40px auto" }} />}

      {v && (
        <div className="mgp">
          <div className="mgp-kpi">
            <div className="mgp-buyuk">
              <span>Bu ay</span>
              <b>{v.ozet.buAy} talep</b>
              <small>
                {v.ozet.buAyGiris} giriş · {v.ozet.buAyCikis} çıkış{v.ozet.buAyRed ? ` · ${v.ozet.buAyRed} reddedildi` : ""}
              </small>
            </div>
            <div>
              <span>Geçen ay</span>
              <b>{v.ozet.gecenAy}</b>
              <small>talep</small>
            </div>
            <div>
              <span>Bu yıl</span>
              <b>{v.ozet.buYil}</b>
              <small>talep</small>
            </div>
            <div>
              <span>Toplam</span>
              <b>{v.ozet.toplam}</b>
              <small>
                {v.ozet.onaylanan} onay · {v.ozet.reddedilen} ret
              </small>
            </div>
          </div>

          <section className="mgp-kutu">
            <h4>Son 12 ay</h4>
            <div className="mgp-aylar">
              {[...v.aylar].reverse().map((a) => (
                <Tooltip key={a.ay} title={`${dayjs(a.ay + "-01").format("MMMM YYYY")} · ${a.adet} talep`}>
                  <div className="mgp-ay">
                    <div className="mgp-cubuk">{a.adet > 0 && <i style={{ height: `${Math.max(6, (a.adet / enCok) * 100)}%` }} />}</div>
                    <span>{dayjs(a.ay + "-01").format("MMM")}</span>
                    <small>{a.adet || ""}</small>
                  </div>
                </Tooltip>
              ))}
            </div>
          </section>

          <section className="mgp-kutu">
            <h4>
              Bütün talepleri <small>{v.kayitlar.length} talep</small>
            </h4>
            <Table<Kayit>
              rowKey="id"
              size="small"
              tableLayout="fixed"
              dataSource={v.kayitlar}
              pagination={{ pageSize: 12, hideOnSinglePage: true, showSizeChanger: false }}
              rowClassName={(k) => (k.id === seciliId ? "mgp-secili" : "")}
              columns={[
                {
                  title: "Tarih",
                  key: "tarih",
                  width: 124,
                  render: (_, k) => (
                    <div className="mgp-tarih">
                      <b>{dayjs(k.tarih).format("DD.MM.YYYY ddd")}</b>
                      <small>
                        <Tag color={k.tur === "Giriş" ? "green" : "blue"} bordered={false} style={{ marginInlineEnd: 4 }}>
                          {k.tur}
                        </Tag>
                        {k.saat}
                      </small>
                    </div>
                  ),
                },
                {
                  title: "Açıklama",
                  dataIndex: "sebep",
                  render: (x: string, k) => (
                    <div className="mgp-aciklama">
                      <span>{x}</span>
                      {k.kararNotu && <small>Karar notu: {k.kararNotu}</small>}
                    </div>
                  ),
                },
                {
                  title: "Durum",
                  key: "durum",
                  width: 120,
                  render: (_, k) => (
                    <Tooltip title={k.kararVeren ? `${k.kararVeren}${k.kararTarihi ? ` · ${dayjs(k.kararTarihi).format("DD.MM.YYYY HH:mm")}` : ""}` : undefined}>
                      <Tag color={DURUM_RENK[k.durum]} bordered={false}>
                        {k.durum}
                      </Tag>
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
.mgp-bas{display:flex;flex-direction:column;line-height:1.25}
.mgp-bas small{font-weight:400;color:#8a929b;font-size:12px}
.mgp{display:flex;flex-direction:column;gap:14px}
.mgp-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.mgp-kpi>div{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid #e6e9e3;border-radius:12px;background:#fff;min-width:0}
.mgp-kpi span{font-size:12px;color:#6b7280;font-weight:600}
.mgp-kpi b{font-size:20px;color:#1f2933;font-variant-numeric:tabular-nums;line-height:1.2}
.mgp-kpi small{font-size:11.5px;color:#8a929b}
.mgp-kpi .mgp-buyuk{background:#fff7e6;border-color:#ffd591}
.mgp-kpi .mgp-buyuk b{color:#ad4e00;font-size:24px}
.mgp-kutu{border:1px solid #e6e9e3;border-radius:14px;background:#fff;padding:12px 14px;min-width:0}
.mgp-kutu h4{margin:0 0 10px;font-size:14px;display:flex;gap:8px;align-items:baseline}
.mgp-kutu h4 small{font-weight:400;color:#8a929b;font-size:12px}
.mgp-aylar{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:4px;height:120px}
.mgp-ay{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0}
.mgp-cubuk{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid #e6e9e3}
.mgp-cubuk i{display:block;width:70%;max-width:22px;background:#fa8c16;border-radius:4px 4px 0 0}
.mgp-ay span{font-size:10.5px;color:#6b7280}
.mgp-ay small{font-size:10px;color:#8a929b;min-height:12px;font-variant-numeric:tabular-nums}
.mgp-tarih{display:flex;flex-direction:column;gap:2px;line-height:1.25}
.mgp-tarih small{color:#6b7280;font-size:11.5px;white-space:nowrap}
.mgp-aciklama{display:flex;flex-direction:column;gap:2px;min-width:0;overflow-wrap:anywhere}
.mgp-aciklama small{color:#8a929b;font-size:11.5px}
.mgp-secili td{background:#fff7e6 !important}
`;
