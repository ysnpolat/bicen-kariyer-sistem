/**
 * Manuel giriş-çıkış talepleri ve raporu (09.10.2026)
 * ---------------------------------------------------------------------------
 * Okutamayan ya da okutmayı unutan personelin talepleri. Önceden tek liste
 * vardı ve sonuçlananlar bekleyenlerin altında kayboluyordu. Şimdi:
 *  - durum süzgeci (bekleyen / onaylanan / reddedilen / tümü) ve sayıları,
 *  - tarih aralığı (varsayılan bu ay), şube ve arama,
 *  - şube, personel ve sebep kırılımı, onay oranı, ortalama karar süresi,
 *  - Excel (talepler + şube + personel sayfaları).
 * Karar penceresi (saat düzeltme, ret sebebi) üst bileşenden geliyor.
 */

import { useMemo, useState } from "react";
import { DatePicker, Input, Segmented, Select, Space, Tag, Tooltip, Typography } from "antd";
import { Button } from "antd";
import { CheckCircle2, Clock3, Download, RefreshCw, Search, XCircle } from "lucide-react";
import dayjs, { Dayjs } from "dayjs";
import ExcelJS from "exceljs";

import Tablo from "./Tablo";
import ManuelGirisPersonel from "./ManuelGirisPersonel";
import { EksikDugmesi } from "./TalepEksik";
import { dosyaIndir } from "./formIndir";

const { Text } = Typography;
const { RangePicker } = DatePicker;

type Durum = "Bekliyor" | "Onaylandı" | "Reddedildi";
type Gorunum = Durum | "tumu";

interface Talep {
  id: number;
  personelKodu: string;
  adSoyad: string;
  subeAdi: string | null;
  tarih: string;
  tur: "Giriş" | "Çıkış";
  saat: string;
  sebep: string;
  durum: Durum;
  kararVeren: string | null;
  kararNotu: string | null;
  kararTarihi: string | null;
  olusturma: string;
}

/** Açıklamadan sebep türü (rapor kırılımı için; kelimeye göre) */
const SEBEPLER: { ad: string; renk: string; anahtar: RegExp }[] = [
  { ad: "Şarj / telefon", renk: "orange", anahtar: /şarj|sarj|telefon|kapand|bozul|ekran|kırıl/i },
  { ad: "İnternet", renk: "blue", anahtar: /internet|bağlant|baglant|wifi|wi-fi|çekmi|cekmi|veri/i },
  { ad: "Karekod / uygulama", renk: "purple", anahtar: /karekod|kare kod|qr|uygulama|okunma|okutam|açılma|acilma|hata|giriş yapam/i },
  { ad: "Unutma", renk: "gold", anahtar: /unut/i },
  { ad: "Konum", renk: "cyan", anahtar: /konum|gps/i },
];

const sebepTuru = (s: string) => SEBEPLER.find((x) => x.anahtar.test(s ?? "")) ?? { ad: "Diğer", renk: "default", anahtar: /x/ };

/** Karar süresi (saat) */
const kararSaati = (k: Talep) =>
  k.kararTarihi ? Math.max(0, dayjs(k.kararTarihi).diff(dayjs(k.olusturma), "minute")) / 60 : null;

const sureYaz = (sa: number | null) =>
  sa === null ? "—" : sa < 1 ? `${Math.round(sa * 60)} dk` : sa < 48 ? `${Math.round(sa)} sa` : `${Math.round(sa / 24)} gün`;

const DURUM_RENK: Record<Durum, string> = { Bekliyor: "orange", Onaylandı: "green", Reddedildi: "red" };

export default function ManuelGirisTalepleri({
  kayitlar,
  yukleniyor,
  yenile,
  kararVer,
  eksik,
  aralik,
  aralikDegisti,
}: {
  kayitlar: Talep[];
  yukleniyor: boolean;
  yenile: () => void;
  kararVer: (k: Talep, onay: boolean) => void;
  eksik: { harita: Record<number, any>; yenile: () => void; yetkili: boolean };
  aralik: [Dayjs, Dayjs];
  aralikDegisti: (a: [Dayjs, Dayjs]) => void;
}) {
  const [gorunum, setGorunum] = useState<Gorunum>("Bekliyor");
  const [sube, setSube] = useState<string | null>(null);
  const [ara, setAra] = useState("");
  /* 15.10.2026: personele tıklayınca yan pencere (bu ay kaç talep, açıklamalar) */
  const [secili, setSecili] = useState<Talep | null>(null);

  /* Aralıktaki kayıtlar (bekleyenler her zaman) */
  const aralikta = useMemo(
    () =>
      kayitlar.filter(
        (k) =>
          k.durum === "Bekliyor" ||
          (!dayjs(k.tarih).isBefore(aralik[0], "day") && !dayjs(k.tarih).isAfter(aralik[1], "day"))
      ),
    [kayitlar, aralik]
  );

  const subeler = useMemo(
    () => Array.from(new Set(aralikta.map((k) => (k.subeAdi ?? "—").trim()))).sort((a, b) => a.localeCompare(b, "tr")),
    [aralikta]
  );

  const subede = useMemo(() => aralikta.filter((k) => !sube || (k.subeAdi ?? "—").trim() === sube), [aralikta, sube]);

  const sayilar = useMemo(() => {
    const sonuc = subede.filter((k) => k.durum !== "Bekliyor");
    const onay = subede.filter((k) => k.durum === "Onaylandı").length;
    const red = subede.filter((k) => k.durum === "Reddedildi").length;
    const sureler = sonuc.map(kararSaati).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return {
      Bekliyor: subede.filter((k) => k.durum === "Bekliyor").length,
      Onaylandı: onay,
      Reddedildi: red,
      tumu: subede.length,
      oran: onay + red > 0 ? Math.round((100 * onay) / (onay + red)) : null,
      medyan: sureler.length ? sureler[Math.floor(sureler.length / 2)] : null,
    };
  }, [subede]);

  const liste = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return subede.filter(
      (k) =>
        (gorunum === "tumu" || k.durum === gorunum) &&
        (!q || `${k.adSoyad} ${k.personelKodu} ${k.subeAdi ?? ""} ${k.sebep} ${k.kararVeren ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [subede, gorunum, ara]);

  /* Kırılımlar: sonuçlanan + bekleyen, seçili süzgeçlere göre */
  const subeKirilimi = useMemo(() => {
    const m = new Map<string, { sube: string; adet: number; onay: number; red: number }>();
    for (const k of aralikta) {
      const s = (k.subeAdi ?? "—").trim();
      const x = m.get(s) ?? { sube: s, adet: 0, onay: 0, red: 0 };
      x.adet++;
      if (k.durum === "Onaylandı") x.onay++;
      if (k.durum === "Reddedildi") x.red++;
      m.set(s, x);
    }
    return [...m.values()].sort((a, b) => b.adet - a.adet);
  }, [aralikta]);

  const kisiKirilimi = useMemo(() => {
    const m = new Map<string, { kod: string; ad: string; sube: string; adet: number; red: number }>();
    for (const k of subede) {
      const x = m.get(k.personelKodu) ?? { kod: k.personelKodu, ad: k.adSoyad, sube: (k.subeAdi ?? "—").trim(), adet: 0, red: 0 };
      x.adet++;
      if (k.durum === "Reddedildi") x.red++;
      m.set(k.personelKodu, x);
    }
    return [...m.values()].sort((a, b) => b.adet - a.adet).slice(0, 8);
  }, [subede]);

  const sebepKirilimi = useMemo(() => {
    const m = new Map<string, { ad: string; renk: string; adet: number }>();
    for (const k of subede) {
      const t = sebepTuru(k.sebep);
      const x = m.get(t.ad) ?? { ad: t.ad, renk: t.renk, adet: 0 };
      x.adet++;
      m.set(t.ad, x);
    }
    return [...m.values()].sort((a, b) => b.adet - a.adet);
  }, [subede]);

  const enCokSube = Math.max(1, ...subeKirilimi.map((x) => x.adet));

  const excel = async () => {
    const wb = new ExcelJS.Workbook();
    const bas = (ws: ExcelJS.Worksheet, son: string) => {
      const r = ws.getRow(1);
      r.font = { bold: true, color: { argb: "FFFFFFFF" } };
      r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5F8C10" } };
      ws.autoFilter = { from: "A1", to: `${son}1` };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    };

    const t = wb.addWorksheet("Talepler");
    t.columns = [
      { header: "Tarih", key: "tarih", width: 12 },
      { header: "Tür", key: "tur", width: 8 },
      { header: "Saat", key: "saat", width: 8 },
      { header: "Sicil", key: "sicil", width: 10 },
      { header: "Ad soyad", key: "ad", width: 24 },
      { header: "Şube", key: "sube", width: 22 },
      { header: "Açıklama", key: "sebep", width: 42 },
      { header: "Sebep türü", key: "tursebep", width: 18 },
      { header: "Durum", key: "durum", width: 12 },
      { header: "Karar veren", key: "kim", width: 24 },
      { header: "Karar notu", key: "not", width: 30 },
      { header: "Talep zamanı", key: "talep", width: 17 },
      { header: "Karar zamanı", key: "karar", width: 17 },
    ];
    liste.forEach((k) =>
      t.addRow({
        tarih: dayjs(k.tarih).format("DD.MM.YYYY"),
        tur: k.tur,
        saat: k.saat,
        sicil: k.personelKodu,
        ad: k.adSoyad,
        sube: k.subeAdi ?? "",
        sebep: k.sebep,
        tursebep: sebepTuru(k.sebep).ad,
        durum: k.durum,
        kim: k.kararVeren ?? "",
        not: k.kararNotu ?? "",
        talep: dayjs(k.olusturma).format("DD.MM.YYYY HH:mm"),
        karar: k.kararTarihi ? dayjs(k.kararTarihi).format("DD.MM.YYYY HH:mm") : "",
      })
    );
    bas(t, "M");
    t.eachRow((r, i) => {
      if (i === 1) return;
      const d = r.getCell(9).value;
      r.getCell(9).font = { bold: true, color: { argb: d === "Onaylandı" ? "FF3F6108" : d === "Reddedildi" ? "FFB42318" : "FFAD4E00" } };
    });

    const s = wb.addWorksheet("Şubeler");
    s.columns = [
      { header: "Şube", key: "sube", width: 26 },
      { header: "Talep", key: "adet", width: 9 },
      { header: "Onaylanan", key: "onay", width: 11 },
      { header: "Reddedilen", key: "red", width: 11 },
    ];
    subeKirilimi.forEach((x) => s.addRow(x));
    bas(s, "D");

    const k = wb.addWorksheet("Personel");
    k.columns = [
      { header: "Sicil", key: "kod", width: 10 },
      { header: "Ad soyad", key: "ad", width: 26 },
      { header: "Şube", key: "sube", width: 24 },
      { header: "Talep", key: "adet", width: 9 },
      { header: "Reddedilen", key: "red", width: 11 },
    ];
    const tum = new Map<string, any>();
    subede.forEach((x) => {
      const o = tum.get(x.personelKodu) ?? { kod: x.personelKodu, ad: x.adSoyad, sube: x.subeAdi ?? "", adet: 0, red: 0 };
      o.adet++;
      if (x.durum === "Reddedildi") o.red++;
      tum.set(x.personelKodu, o);
    });
    [...tum.values()].sort((a, b) => b.adet - a.adet).forEach((x) => k.addRow(x));
    bas(k, "E");

    const buf = await wb.xlsx.writeBuffer();
    dosyaIndir(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `manuel-giris-cikis-${aralik[0].format("YYYY-MM-DD")}_${aralik[1].format("YYYY-MM-DD")}.xlsx`
    );
  };

  return (
    <div className="mg">
      <style>{CSS}</style>

      {/* -------------------------------------------------- özet */}
      <div className="it-kpiler">
        {[
          { k: "Bekliyor" as Gorunum, et: "Bekleyen", d: sayilar.Bekliyor, alt: "yönetici ya da İK kararı", renk: "sari" },
          { k: "Onaylandı" as Gorunum, et: "Onaylanan", d: sayilar.Onaylandı, alt: sayilar.oran === null ? "seçili aralıkta" : `onay oranı %${sayilar.oran}`, renk: "yesil" },
          { k: "Reddedildi" as Gorunum, et: "Reddedilen", d: sayilar.Reddedildi, alt: "ret sebebiyle", renk: "kirmizi" },
          { k: "tumu" as Gorunum, et: "Tümü", d: sayilar.tumu, alt: `karar süresi ~${sureYaz(sayilar.medyan)}`, renk: "turuncu" },
        ].map((x) => (
          <button
            key={x.k}
            type="button"
            className={`it-kpi it-kpi-${x.renk}${gorunum === x.k ? " secili" : ""}`}
            onClick={() => setGorunum(x.k)}
          >
            <span className="et">{x.et}</span>
            <span className="d">{x.d.toLocaleString("tr-TR")}</span>
            <span className="alt">{x.alt}</span>
          </button>
        ))}
      </div>

      <div className="mg-duzen">
        {/* -------------------------------------------------- liste */}
        <div className="it-kart" style={{ minWidth: 0 }}>
          <div className="it-kart-bas">
            <h3>Manuel giriş-çıkış talepleri</h3>
            <span>okutamayan ya da okutmayı unutan personel · önce yöneticisine düşer, buradan da sonuçlandırılır</span>
          </div>
          <div className="mg-arac">
            <RangePicker
              size="small"
              value={aralik}
              allowClear={false}
              format="DD.MM.YYYY"
              onChange={(v) => v?.[0] && v?.[1] && aralikDegisti([v[0], v[1]])}
              presets={[
                { label: "Bu ay", value: [dayjs().startOf("month"), dayjs()] },
                { label: "Geçen ay", value: [dayjs().subtract(1, "month").startOf("month"), dayjs().subtract(1, "month").endOf("month")] },
                { label: "Son 7 gün", value: [dayjs().subtract(6, "day"), dayjs()] },
                { label: "Son 3 ay", value: [dayjs().subtract(3, "month").startOf("month"), dayjs()] },
              ]}
            />
            <Select
              size="small"
              allowClear
              showSearch
              placeholder="Bütün şubeler"
              value={sube}
              onChange={(v) => setSube(v ?? null)}
              options={subeler.map((s) => ({ value: s, label: s }))}
              style={{ width: 180 }}
            />
            <Input
              size="small"
              allowClear
              prefix={<Search size={13} />}
              placeholder="Ad, sicil, açıklama"
              value={ara}
              onChange={(e) => setAra(e.target.value)}
              style={{ width: 190 }}
            />
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<Download size={13} />} onClick={excel} disabled={liste.length === 0}>
              Excel
            </Button>
            <Button size="small" icon={<RefreshCw size={13} />} onClick={yenile} loading={yukleniyor}>
              Yenile
            </Button>
          </div>

          <div className="it-kart-ic">
            <Tablo
              rowKey="id"
              size="small"
              loading={yukleniyor}
              dataSource={liste}
              pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
              locale={{ emptyText: gorunum === "Bekliyor" ? "Bekleyen talep yok." : "Bu süzgeçte talep yok." }}
              columns={[
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  width: 190,
                  render: (v: any, k: Talep) => (
                    <div>
                      <button type="button" className="mg-kisi" title="Talep geçmişini aç" onClick={() => setSecili(k)}>
                        {v}
                      </button>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11.5 }}>
                          {k.personelKodu} · {k.subeAdi}
                        </Text>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Kayıt",
                  key: "kayit",
                  width: 130,
                  sorter: (a: Talep, b: Talep) => dayjs(a.tarih).valueOf() - dayjs(b.tarih).valueOf(),
                  render: (_v: any, k: Talep) => (
                    <span>
                      <b>{dayjs(k.tarih).format("DD.MM.YYYY")}</b>
                      <div>
                        <Tag color={k.tur === "Giriş" ? "green" : "blue"} bordered={false} style={{ marginInlineEnd: 4 }}>
                          {k.tur}
                        </Tag>
                        <b className="mg-saat">{k.saat}</b>
                      </div>
                    </span>
                  ),
                },
                {
                  title: "Açıklama",
                  dataIndex: "sebep",
                  render: (v: string) => {
                    const t = sebepTuru(v);
                    return (
                      <div className="mg-sebep">
                        <Tooltip title={v}>
                          <span>{v}</span>
                        </Tooltip>
                        <Tag color={t.renk} bordered={false}>
                          {t.ad}
                        </Tag>
                      </div>
                    );
                  },
                },
                {
                  title: "Karar",
                  key: "karar",
                  width: 210,
                  render: (_v: any, k: Talep) => (
                    <div className="mg-karar">
                      <Tag color={DURUM_RENK[k.durum]} style={{ marginInlineEnd: 0, alignSelf: "flex-start" }}>
                        {k.durum === "Onaylandı" ? <CheckCircle2 size={11} /> : k.durum === "Reddedildi" ? <XCircle size={11} /> : <Clock3 size={11} />}{" "}
                        {k.durum}
                      </Tag>
                      {k.durum === "Bekliyor" ? (
                        <small>{dayjs(k.olusturma).format("DD.MM HH:mm")} · {dayjs().diff(dayjs(k.olusturma), "minute") < 1 ? "az önce" : `${sureYaz(dayjs().diff(dayjs(k.olusturma), "minute") / 60)} önce`}</small>
                      ) : (
                        <>
                          <small>
                            {k.kararVeren ?? "—"} · {k.kararTarihi ? dayjs(k.kararTarihi).format("DD.MM HH:mm") : ""}
                          </small>
                          {k.kararNotu ? <small className="mg-not">“{k.kararNotu}”</small> : null}
                        </>
                      )}
                    </div>
                  ),
                },
                {
                  title: "",
                  key: "islem",
                  width: 250,
                  align: "right" as const,
                  render: (_v: any, k: Talep) => (
                    <Space size={6} wrap style={{ justifyContent: "flex-end" }}>
                      <EksikDugmesi tur="itiraz" talepId={k.id} e={eksik.harita[k.id]} yenile={eksik.yenile} yetkili={eksik.yetkili} />
                      {k.durum === "Bekliyor" && (
                        <>
                          <Button size="small" danger onClick={() => kararVer(k, false)}>
                            Reddet
                          </Button>
                          <Button size="small" type="primary" onClick={() => kararVer(k, true)}>
                            Onayla
                          </Button>
                        </>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </div>

        {/* -------------------------------------------------- kırılım */}
        <aside className="mg-yan">
          <section className="it-kart mg-kutu">
            <h4>Şubeler</h4>
            {subeKirilimi.length === 0 ? (
              <small className="mg-bos">Bu aralıkta talep yok.</small>
            ) : (
              subeKirilimi.slice(0, 12).map((x) => (
                <button
                  key={x.sube}
                  type="button"
                  className={`mg-sube${sube === x.sube ? " secili" : ""}`}
                  onClick={() => setSube(sube === x.sube ? null : x.sube)}
                  title={`${x.sube} · ${x.adet} talep · ${x.onay} onay · ${x.red} red`}
                >
                  <span className="ad">{x.sube}</span>
                  <span className="cubuk">
                    <i className="o" style={{ width: `${(x.onay / enCokSube) * 100}%` }} />
                    <i className="r" style={{ width: `${(x.red / enCokSube) * 100}%` }} />
                    <i className="b" style={{ width: `${((x.adet - x.onay - x.red) / enCokSube) * 100}%` }} />
                  </span>
                  <b>{x.adet}</b>
                </button>
              ))
            )}
            <div className="mg-lejant">
              <span><i className="o" /> onay</span>
              <span><i className="r" /> red</span>
              <span><i className="b" /> bekleyen</span>
            </div>
          </section>

          <section className="it-kart mg-kutu">
            <h4>En çok talep eden</h4>
            {kisiKirilimi.length === 0 ? (
              <small className="mg-bos">—</small>
            ) : (
              kisiKirilimi.map((x) => (
                <div key={x.kod} className="mg-kisi">
                  <span>
                    <b>{x.ad}</b>
                    <small>{x.sube}</small>
                  </span>
                  <b className="mg-sayi">
                    {x.adet}
                    {x.red > 0 ? <small> · {x.red} red</small> : null}
                  </b>
                </div>
              ))
            )}
          </section>

          <section className="it-kart mg-kutu">
            <h4>Sebepler</h4>
            <div className="mg-sebepler">
              {sebepKirilimi.map((x) => (
                <Tag key={x.ad} color={x.renk} bordered={false}>
                  {x.ad} · {x.adet}
                </Tag>
              ))}
            </div>
            <small className="mg-bos">Açıklamadaki kelimelere göre gruplanır.</small>
          </section>
        </aside>
      </div>
      <ManuelGirisPersonel sicil={secili?.personelKodu ?? null} adSoyad={secili?.adSoyad} seciliId={secili?.id} kapat={() => setSecili(null)} />
    </div>
  );
}

const CSS = `
.mg-kisi{border:0;background:none;padding:0;font:inherit;font-weight:700;color:#1f2933;cursor:pointer;text-align:left}
.mg-kisi:hover{color:#3f6108;text-decoration:underline}
.mg{display:flex;flex-direction:column;gap:14px}
.mg-duzen{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
@media (max-width:1100px){.mg-duzen{grid-template-columns:minmax(0,1fr)}}
.mg-arac{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:0 16px 10px}
.mg-saat{font-variant-numeric:tabular-nums}
.mg-sebep{display:flex;flex-direction:column;gap:4px;align-items:flex-start;min-width:0}
.mg-sebep>span{font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mg-karar{display:flex;flex-direction:column;gap:2px;min-width:0}
.mg-karar small{font-size:11.5px;color:#6b7280}
.mg-karar .mg-not{font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-karar .ant-tag{display:inline-flex;align-items:center;gap:3px}
.mg-yan{display:flex;flex-direction:column;gap:14px;min-width:0}
.mg-kutu{padding:12px 14px;display:flex;flex-direction:column;gap:6px;background:#fff;border:1px solid #e6e9e3;border-radius:14px}
.mg-kutu h4{margin:0 0 4px;font-size:13.5px}
.mg-bos{color:#8a929b;font-size:11.5px}
.mg-sube{display:grid;grid-template-columns:minmax(0,108px) minmax(0,1fr) 28px;gap:8px;align-items:center;border:0;background:transparent;padding:4px 4px;border-radius:7px;cursor:pointer;text-align:left}
.mg-sube:hover{background:#f6f8f3}
.mg-sube.secili{background:#f2f9e8}
.mg-sube .ad{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-sube .cubuk{display:flex;height:9px;background:#f1f3ee;border-radius:4px;overflow:hidden;gap:1px}
.mg-sube b{text-align:right;font-variant-numeric:tabular-nums;font-size:12.5px}
.mg-sube i,.mg-lejant i{display:block;height:100%}
.mg-sube i.o,.mg-lejant i.o{background:#7cb518}
.mg-sube i.r,.mg-lejant i.r{background:#e5534b}
.mg-sube i.b,.mg-lejant i.b{background:#f0b54a}
.mg-lejant{display:flex;gap:12px;font-size:11px;color:#6b7280;margin-top:4px}
.mg-lejant span{display:inline-flex;align-items:center;gap:4px}
.mg-lejant i{width:9px;height:9px;border-radius:2px}
.mg-kisi{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:3px 0;border-bottom:1px solid #f0f2ee}
.mg-kisi:last-child{border-bottom:0}
.mg-kisi span{display:flex;flex-direction:column;min-width:0}
.mg-kisi span b{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-kisi small{font-size:11px;color:#8a929b}
.mg-sayi{font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}
.mg-sayi small{font-weight:400;color:#b42318}
.mg-sebepler{display:flex;flex-wrap:wrap;gap:6px}
`;
