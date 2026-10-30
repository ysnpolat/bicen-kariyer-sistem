/**
 * Fazla mesai raporu (09.10.2026)
 * ---------------------------------------------------------------------------
 * Seçilen ayda kimler fazla mesai yapmış, toplam kaç saat, hangi şubeler,
 * hangi personel. Varsayılan yalnızca onaylananlar; "onay sürecinde" ve
 * "hepsi" (iptal ve red hariç) seçilebilir. Excel'e çıkar.
 */

import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, DatePicker, Drawer, Empty, Input, Segmented, Spin, Table, Tooltip } from "antd";
import { Download, Search } from "lucide-react";
import dayjs, { Dayjs } from "dayjs";
import ExcelJS from "exceljs";

import { api } from "./api";
import { dosyaIndir } from "./formIndir";
import { useUzman, uzmanSorgu } from "./uzmanFiltresi";
import { PersonelAdi } from "./personelKarti";

interface SubeSatiri {
  sube: string;
  dk: number;
  kayit: number;
  kisi: number;
}

interface KisiSatiri {
  sicil: string;
  ad: string;
  sube: string;
  gorev: string | null;
  dk: number;
  kayit: number;
  son: string;
}

interface KayitSatiri {
  id: number;
  sicil: string;
  ad: string;
  sube: string;
  gorev: string | null;
  tarih: string;
  baslangic: string;
  bitis: string;
  dk: number;
  durum: string;
  durumAdi: string;
  aciklama: string | null;
  giren: string | null;
  tc?: string | null;
  ucret?: number | null;
  izinDk?: number;
  gunTuru?: string | null;
}

/** Excel biçimi (15.10.2026): kişi başına bir satır */
interface TabloSatiri {
  sicil: string;
  tc: string | null;
  ad: string;
  sube: string;
  gorev: string | null;
  neden: string;
  dk: number;
  saat: number;
  ucret: number | null;
  /** Serbest zaman (izin) karşılığı, dk (ücret kuralları) */
  izinDk: number;
  ucretliDk: number;
}

interface Rapor {
  ay: string;
  sonGun: string;
  maasGorunur: boolean;
  tablo: TabloSatiri[];
  toplamUcret: number | null;
  toplamDk: number;
  kayit: number;
  kisi: number;
  sube: number;
  subeler: SubeSatiri[];
  kisiler: KisiSatiri[];
  gunler: { gun: string; dk: number }[];
  kayitlar: KayitSatiri[];
}

type Durum = "onaylandi" | "surecte" | "hepsi";

const DURUM_AD: Record<Durum, string> = {
  onaylandi: "Onaylanan",
  surecte: "Onay sürecinde",
  hepsi: "Hepsi",
};

/** "12 sa 30 dk" */
const saat = (dk: number) => {
  const s = Math.floor(dk / 60);
  const d = dk % 60;
  return d === 0 ? `${s} sa` : s === 0 ? `${d} dk` : `${s} sa ${d} dk`;
};

/** Ondalık saat: tabloda sıralama ve Excel için */
const ondalik = (dk: number) => Math.round((dk / 60) * 10) / 10;

const tl = (v: number) => `${v.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺`;

/** "05.10.2026-SEVKİYAT-06.10.2026-…" → tarihler kalın */
const NedenMetni = ({ m }: { m: string }) => (
  <>
    {m.split(/(\d{2}\.\d{2}\.\d{4})/).map((p, i) => (/^\d{2}\.\d{2}\.\d{4}$/.test(p) ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}
  </>
);

export default function FazlaMesaiRaporu({ acik, kapat }: { acik: boolean; kapat: () => void }) {
  const { message } = AntdApp.useApp();
  const uzman = useUzman();

  const [ay, setAy] = useState<Dayjs>(dayjs().startOf("month"));
  const [durum, setDurum] = useState<Durum>("onaylandi");
  const [v, setV] = useState<Rapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [sube, setSube] = useState<string | null>(null);
  const [ara, setAra] = useState("");
  /* 15.10.2026: Liste (Excel biçimi) ve "bu tarihe kadar" */
  const [gorunum, setGorunum] = useState<"ozet" | "liste">("ozet");
  const [gun, setGun] = useState<Dayjs | null>(null);

  useEffect(() => {
    if (!acik) return;
    setYukleniyor(true);
    const g = gun && gun.isSame(ay, "month") ? `&gun=${gun.date()}` : "";
    api
      .al<Rapor>(`/api/FazlaMesai/Rapor?ay=${ay.format("YYYY-MM")}&durum=${durum}${g}${uzmanSorgu(uzman, "ek")}`)
      .then((r) => {
        setV(r);
        setSube(null);
      })
      .catch((h: any) => message.error(h.message))
      .finally(() => setYukleniyor(false));
  }, [acik, ay, durum, uzman, message, gun]);

  const tablo = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return (v?.tablo ?? []).filter(
      (k) => (!sube || k.sube === sube) && (!q || `${k.ad} ${k.sicil} ${k.sube} ${k.gorev ?? ""} ${k.neden}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [v, sube, ara]);

  const kisiler = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return (v?.kisiler ?? []).filter(
      (k) =>
        (!sube || k.sube === sube) &&
        (!q || `${k.ad} ${k.sicil} ${k.sube} ${k.gorev ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [v, sube, ara]);

  const enCokSube = Math.max(1, ...(v?.subeler ?? []).map((x) => x.dk));
  const enCokGun = Math.max(1, ...(v?.gunler ?? []).map((x) => x.dk));
  const ortalama = v && v.kisi > 0 ? Math.round(v.toplamDk / v.kisi) : 0;

  /* Excel (23.10.2026): 1) Şube özeti ve ödenecekler, 2) personel toplamı,
     3) saat saat kayıtlar; 4) İK'nın aylık liste biçimi. Kişi sayfalarında
     TC, ad soyad, şube ve görev. Ücret sütunları yalnızca ücret yetkisinde. */
  const excel = async () => {
    if (!v) return;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Biçen İnsan Kaynakları";
    const ucretli = v.maasGorunur;
    const izinli = v.tablo.some((x) => x.izinDk > 0);
    const ayAdi = dayjs(v.ay + "-01").format("MMMM YYYY").toLocaleUpperCase("tr");
    const altBaslik = `${DURUM_AD[durum]} kayıtlar · ${dayjs(v.sonGun).format("DD.MM.YYYY")} tarihine kadar`;
    const TL = '#,##0.00 "₺"';
    const SA = "0.00";
    const YESIL = "FF5F8C10";
    const tr = (a: string, b: string) => a.localeCompare(b, "tr");
    const kenar = { style: "thin" as const, color: { argb: "FFD9D9D9" } };

    type Sutun = { ad: string; gen: number; fmt?: string; sar?: boolean; toplam?: boolean };
    const sayfa = (adi: string, baslik: string, sutunlar: Sutun[], satirlar: (string | number | null)[][]) => {
      const ws = wb.addWorksheet(adi, { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      ws.columns = sutunlar.map((c) => ({ width: c.gen }));
      const son = ws.getColumn(sutunlar.length).letter;
      const t = ws.addRow([baslik]);
      ws.mergeCells(`A1:${son}1`);
      t.font = { bold: true, size: 14, color: { argb: YESIL } };
      t.height = 22;
      const a = ws.addRow([altBaslik]);
      ws.mergeCells(`A2:${son}2`);
      a.font = { italic: true, size: 10, color: { argb: "FF7F7F7F" } };
      const h = ws.addRow(sutunlar.map((c) => c.ad));
      h.height = 30;
      h.eachCell((c) => {
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YESIL } };
        c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        c.border = { top: kenar, bottom: kenar, left: kenar, right: kenar };
      });
      satirlar.forEach((d, n) => {
        const r = ws.addRow(d);
        sutunlar.forEach((c, k) => {
          const h2 = r.getCell(k + 1);
          if (c.fmt) h2.numFmt = c.fmt;
          h2.alignment = { vertical: "middle", wrapText: !!c.sar };
          h2.border = { top: kenar, bottom: kenar, left: kenar, right: kenar };
          if (n % 2 === 1) h2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F8EC" } };
        });
      });
      /* Toplam satırı: formülle, filtrelenince de doğru kalsın diye SUBTOTAL */
      if (satirlar.length && sutunlar.some((c) => c.toplam)) {
        const ilk = 4;
        const sonSatir = 3 + satirlar.length;
        const r = ws.addRow(sutunlar.map((c, k) => (k === 0 ? "TOPLAM" : null)));
        sutunlar.forEach((c, k) => {
          const h2 = r.getCell(k + 1);
          if (c.toplam) {
            const L = ws.getColumn(k + 1).letter;
            h2.value = { formula: `SUBTOTAL(9,${L}${ilk}:${L}${sonSatir})` };
            h2.numFmt = c.fmt ?? "0";
          }
          h2.font = { bold: true };
          h2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
          h2.border = { top: { style: "medium", color: { argb: YESIL } } };
        });
      }
      ws.autoFilter = { from: "A3", to: `${son}3` };
      ws.views = [{ state: "frozen", ySplit: 3 }];
      return ws;
    };

    /* 1) Şube özeti */
    const subeMap = new Map<string, { kisi: Set<string>; kayit: number; dk: number; izinDk: number; ucret: number }>();
    v.kayitlar.forEach((x: any) => {
      const s = subeMap.get(x.sube) ?? { kisi: new Set(), kayit: 0, dk: 0, izinDk: 0, ucret: 0 };
      s.kisi.add(x.sicil);
      s.kayit++;
      s.dk += x.dk;
      s.izinDk += x.izinDk ?? 0;
      s.ucret += x.ucret ?? 0;
      subeMap.set(x.sube, s);
    });
    const subeSatir = [...subeMap.entries()].sort((a, b) => tr(a[0], b[0]));
    sayfa(
      "Şube Özeti",
      `${ayAdi} · ŞUBELERE GÖRE FAZLA MESAİ`,
      [
        { ad: "ŞUBE", gen: 30 },
        { ad: "PERSONEL", gen: 11, fmt: "0", toplam: true },
        { ad: "KAYIT", gen: 9, fmt: "0", toplam: true },
        { ad: "FAZLA MESAİ (SA)", gen: 14, fmt: SA, toplam: true },
        ...(izinli ? [{ ad: "SERBEST ZAMAN (SA)", gen: 14, fmt: SA, toplam: true }] : []),
        ...(ucretli ? [{ ad: "ÖDENECEK FM ÜCRETİ", gen: 18, fmt: TL, toplam: true }] : []),
      ],
      subeSatir.map(([ad, s]) => [
        ad, s.kisi.size, s.kayit, s.dk / 60,
        ...(izinli ? [s.izinDk / 60] : []),
        ...(ucretli ? [Math.round(s.ucret * 100) / 100] : []),
      ])
    );

    /* 2) Personel toplamı */
    const kayitSayisi = new Map(v.kisiler.map((k) => [k.sicil, k.kayit]));
    const kisiSatir = [...v.tablo].sort((a, b) => tr(a.sube, b.sube) || tr(a.ad, b.ad));
    sayfa(
      "Personel Toplam",
      `${ayAdi} · PERSONEL TOPLAM FAZLA MESAİ`,
      [
        { ad: "T.C. KİMLİK NO", gen: 15 },
        { ad: "AD SOYAD", gen: 26 },
        { ad: "ŞUBE", gen: 24 },
        { ad: "GÖREVİ", gen: 24 },
        { ad: "KAYIT", gen: 8, fmt: "0", toplam: true },
        { ad: "TOPLAM FM (SA)", gen: 13, fmt: SA, toplam: true },
        ...(izinli ? [{ ad: "ÜCRETLİ (SA)", gen: 12, fmt: SA, toplam: true }, { ad: "SERBEST ZAMAN (SA)", gen: 13, fmt: SA, toplam: true }] : []),
        ...(ucretli ? [{ ad: "ÖDENECEK FM ÜCRETİ", gen: 18, fmt: TL, toplam: true }] : []),
      ],
      kisiSatir.map((x) => [
        x.tc ?? "", x.ad, x.sube, x.gorev ?? "", kayitSayisi.get(x.sicil) ?? null, x.dk / 60,
        ...(izinli ? [x.ucretliDk / 60, x.izinDk / 60] : []),
        ...(ucretli ? [x.ucret ?? null] : []),
      ])
    );

    /* 3) Saat saat */
    const kayitSatir = [...v.kayitlar].sort(
      (a, b) => tr(a.sube, b.sube) || tr(a.ad, b.ad) || a.tarih.localeCompare(b.tarih) || a.baslangic.localeCompare(b.baslangic)
    );
    sayfa(
      "Saat Saat",
      `${ayAdi} · SAAT SAAT FAZLA MESAİLER`,
      [
        { ad: "T.C. KİMLİK NO", gen: 15 },
        { ad: "AD SOYAD", gen: 26 },
        { ad: "ŞUBE", gen: 24 },
        { ad: "GÖREVİ", gen: 22 },
        { ad: "TARİH", gen: 12 },
        { ad: "GÜN", gen: 11 },
        { ad: "GÜN TÜRÜ", gen: 14 },
        { ad: "BAŞLANGIÇ", gen: 11 },
        { ad: "BİTİŞ", gen: 9 },
        { ad: "SÜRE (SA)", gen: 10, fmt: SA, toplam: true },
        { ad: "NEDEN", gen: 40, sar: true },
        { ad: "DURUM", gen: 24, sar: true },
        ...(ucretli ? [{ ad: "FM ÜCRETİ", gen: 14, fmt: TL, toplam: true }] : []),
      ],
      kayitSatir.map((x: any) => [
        x.tc ?? "", x.ad, x.sube, x.gorev ?? "", dayjs(x.tarih).format("DD.MM.YYYY"), dayjs(x.tarih).format("dddd"),
        x.gunTuru ?? "", x.baslangic, x.bitis, x.dk / 60, x.aciklama ?? "", x.durumAdi,
        ...(ucretli ? [x.ucret ?? null] : []),
      ])
    );

    /* 4) İK'nın aylık liste biçimi (15.10.2026) */
    sayfa(
      "İK Listesi",
      `${ayAdi} AYI TOPLAM`,
      [
        { ad: "T.C KİMLİK", gen: 15 },
        { ad: "AD SOYAD", gen: 26 },
        { ad: "ŞUBE", gen: 22 },
        { ad: "GÖREV", gen: 22 },
        { ad: "NEDEN MESAİYE KALDI", gen: 70, sar: true },
        { ad: "FM SAAT", gen: 10, fmt: SA, toplam: true },
        ...(izinli ? [{ ad: "SERBEST ZAMAN (SA)", gen: 13, fmt: SA, toplam: true }] : []),
        ...(ucretli ? [{ ad: "FM ÜCRET", gen: 14, fmt: TL, toplam: true }] : []),
      ],
      v.tablo.map((x) => [
        x.tc ?? "", x.ad, x.sube, x.gorev ?? "", x.neden, x.dk / 60,
        ...(izinli ? [x.izinDk / 60] : []),
        ...(ucretli ? [x.ucret ?? null] : []),
      ])
    );

    const buf = await wb.xlsx.writeBuffer();
    dosyaIndir(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `fazla-mesai-${v.ay}-${durum}.xlsx`
    );
  };

  return (
    <Drawer
      open={acik}
      onClose={kapat}
      width="min(1080px, 100vw)"
      title="Fazla mesai raporu"
      destroyOnHidden
      extra={
        <button type="button" className="it-dg kucuk" onClick={excel} disabled={!v || v.kayit === 0}>
          <Download size={14} /> Excel
        </button>
      }
    >
      <style>{CSS}</style>

      <div className="fmr-ust">
        <DatePicker
          picker="month"
          value={ay}
          allowClear={false}
          format="MMMM YYYY"
          onChange={(d) => d && setAy(d.startOf("month"))}
          disabledDate={(d) => d.isAfter(dayjs().endOf("month"))}
        />
        <Segmented<Durum>
          value={durum}
          onChange={setDurum}
          options={(Object.keys(DURUM_AD) as Durum[]).map((k) => ({ value: k, label: DURUM_AD[k] }))}
        />
        <Segmented
          value={gorunum}
          onChange={(x) => setGorunum(x as "ozet" | "liste")}
          options={[
            { value: "ozet", label: "Özet" },
            { value: "liste", label: "Liste" },
          ]}
        />
        <DatePicker
          value={gun && gun.isSame(ay, "month") ? gun : null}
          placeholder="Bu tarihe kadar"
          format="DD.MM.YYYY"
          allowClear
          onChange={(d) => setGun(d)}
          disabledDate={(d) => !d.isSame(ay, "month")}
          style={{ width: 150 }}
        />
        {sube && (
          <button type="button" className="fmr-cip" onClick={() => setSube(null)}>
            {sube} ✕
          </button>
        )}
      </div>

      {yukleniyor && !v ? (
        <Spin style={{ display: "block", margin: "60px auto" }} />
      ) : !v || v.kayit === 0 ? (
        <Empty style={{ marginTop: 50 }} description={`${ay.format("MMMM YYYY")} için ${DURUM_AD[durum].toLocaleLowerCase("tr")} fazla mesai yok.`} />
      ) : gorunum === "liste" ? (
        <div className={`fmr${yukleniyor ? " fmr-soluk" : ""}`}>
          <div className="fmr-liste-bas">
            <b>{dayjs(v.ay + "-01").format("MMMM").toLocaleUpperCase("tr")} AYI TOPLAM</b>
            <span className="fmr-liste-toplam">{v.maasGorunur && v.toplamUcret != null ? tl(v.toplamUcret) : saat(v.toplamDk)}</span>
            {v.maasGorunur && <span className="fmr-soluk-yazi">{saat(v.toplamDk)}</span>}
            <span style={{ marginLeft: "auto" }} className="fmr-soluk-yazi">
              {dayjs(v.sonGun).format("D.MM.YYYY")} itibarıyla · {DURUM_AD[durum].toLocaleLowerCase("tr")}
            </span>
            <Input
              allowClear
              size="small"
              prefix={<Search size={13} />}
              placeholder="Ad, sicil, şube, neden"
              value={ara}
              onChange={(e) => setAra(e.target.value)}
              style={{ width: 200 }}
            />
          </div>
          <Table<TabloSatiri>
            rowKey="sicil"
            size="small"
            bordered
            dataSource={tablo}
            pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
            scroll={{ x: 1000 }}
            summary={(sayfa) =>
              v.maasGorunur ? (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={5} align="right">
                    <b>Toplam</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    <b>{ondalik(sayfa.reduce((t, x) => t + x.dk, 0)).toLocaleString("tr-TR")}</b>
                  </Table.Summary.Cell>
                  {v.tablo.some((x) => x.izinDk > 0) && <Table.Summary.Cell index={6} />}
                  <Table.Summary.Cell index={7} align="right">
                    <b style={{ color: "#c00000" }}>{tl(sayfa.reduce((t, x) => t + (x.ucret ?? 0), 0))}</b>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              ) : null
            }
            columns={[
              { title: "T.C. Kimlik", dataIndex: "tc", width: 120, render: (x: string | null) => <span className="fmr-sayi">{x || "—"}</span> },
              {
                title: "Ad soyad",
                dataIndex: "ad",
                width: 180,
                sorter: (a, b) => a.ad.localeCompare(b.ad, "tr"),
                render: (_: unknown, k) => <PersonelAdi kod={k.sicil}>{k.ad}</PersonelAdi>,
              },
              { title: "Şube", dataIndex: "sube", width: 140, sorter: (a, b) => a.sube.localeCompare(b.sube, "tr") },
              { title: "Görev", dataIndex: "gorev", width: 150 },
              {
                title: "Neden mesaiye kaldı",
                dataIndex: "neden",
                render: (m: string) => (
                  <span className="fmr-neden">
                    <NedenMetni m={m} />
                  </span>
                ),
              },
              {
                title: "FM saat",
                key: "saat",
                width: 80,
                align: "right",
                sorter: (a, b) => a.dk - b.dk,
                render: (_: unknown, k) => <span className="fmr-sayi">{k.saat.toLocaleString("tr-TR")}</span>,
              },
              ...(v.tablo.some((x) => x.izinDk > 0)
                ? [
                    {
                      title: "Serbest zaman",
                      key: "izin",
                      width: 100,
                      align: "right" as const,
                      render: (_: unknown, k: TabloSatiri) =>
                        k.izinDk > 0 ? <span className="fmr-sayi">{(Math.round((k.izinDk / 60) * 100) / 100).toLocaleString("tr-TR")} sa</span> : null,
                    },
                  ]
                : []),
              ...(v.maasGorunur
                ? [
                    {
                      title: "FM ücret",
                      key: "ucret",
                      width: 100,
                      align: "right" as const,
                      sorter: (a: TabloSatiri, b: TabloSatiri) => (a.ucret ?? 0) - (b.ucret ?? 0),
                      render: (_: unknown, k: TabloSatiri) =>
                        k.ucret == null ? <span className="fmr-soluk-yazi">ücret yok</span> : <span className="fmr-sayi">{tl(k.ucret)}</span>,
                    },
                  ]
                : []),
            ]}
          />
          {!v.maasGorunur && (
            <small className="fmr-soluk-yazi">FM ücret sütunu yalnızca ücretleri görme yetkisi olan rollerde görünür.</small>
          )}
        </div>
      ) : (
        <div className={`fmr${yukleniyor ? " fmr-soluk" : ""}`}>
          {/* -------------------------------------------------- özet */}
          <div className="fmr-kpi">
            <div className="fmr-buyuk">
              <span>Toplam fazla mesai</span>
              <b>{saat(v.toplamDk)}</b>
              <small>{ay.format("MMMM YYYY")} · {DURUM_AD[durum].toLocaleLowerCase("tr")}</small>
            </div>
            <div>
              <span>Personel</span>
              <b>{v.kisi}</b>
              <small>kişi başı {saat(ortalama)}</small>
            </div>
            <div>
              <span>Şube</span>
              <b>{v.sube}</b>
              <small>en çok: {v.subeler[0]?.sube}</small>
            </div>
            <div>
              <span>Kayıt</span>
              <b>{v.kayit}</b>
              <small>kayıt başı {saat(Math.round(v.toplamDk / v.kayit))}</small>
            </div>
          </div>

          {/* -------------------------------------------------- günler */}
          <section className="fmr-kutu">
            <h4>Günlere göre</h4>
            <div className="fmr-gunler" role="img" aria-label="Günlük fazla mesai saatleri">
              {v.gunler.map((g) => {
                const d = dayjs(g.gun);
                const hs = d.day() === 0 || d.day() === 6;
                return (
                  <Tooltip key={g.gun} title={`${d.format("DD MMMM dddd")} · ${g.dk ? saat(g.dk) : "yok"}`}>
                    <div className="fmr-gun">
                      <div className="fmr-gun-cubuk">
                        {g.dk > 0 && <i style={{ height: `${Math.max(4, (g.dk / enCokGun) * 100)}%` }} />}
                      </div>
                      <span className={[hs ? "hs" : "", d.date() === 1 || d.date() % 5 === 0 ? "" : "ara"].join(" ").trim() || undefined}>
                        {d.date()}
                      </span>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </section>

          <div className="fmr-iki">
            {/* -------------------------------------------------- şubeler */}
            <section className="fmr-kutu">
              <h4>
                Şubeler <small>tıklayınca personel listesi süzülür</small>
              </h4>
              <div className="fmr-subeler">
                {v.subeler.map((x) => (
                  <button
                    key={x.sube}
                    type="button"
                    className={`fmr-sube${sube === x.sube ? " secili" : ""}${sube && sube !== x.sube ? " soluk" : ""}`}
                    onClick={() => setSube(sube === x.sube ? null : x.sube)}
                    title={`${x.sube} · ${saat(x.dk)} · ${x.kisi} kişi · ${x.kayit} kayıt`}
                  >
                    <span className="ad">{x.sube}</span>
                    <span className="cubuk">
                      <i style={{ width: `${Math.max(2, (x.dk / enCokSube) * 100)}%` }} />
                    </span>
                    <span className="deger">{saat(x.dk)}</span>
                    <span className="alt">{x.kisi} kişi</span>
                  </button>
                ))}
              </div>
            </section>

            {/* -------------------------------------------------- personel */}
            <section className="fmr-kutu">
              <h4>
                Personel {sube ? <small>· {sube}</small> : null}
                <Input
                  allowClear
                  size="small"
                  prefix={<Search size={13} />}
                  placeholder="Ad, sicil, görev"
                  value={ara}
                  onChange={(e) => setAra(e.target.value)}
                  style={{ width: 180, marginLeft: "auto" }}
                />
              </h4>
              <Table<KisiSatiri>
                rowKey="sicil"
                size="small"
                dataSource={kisiler}
                pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
                columns={[
                  {
                    title: "Personel",
                    key: "ad",
                    render: (_, k) => (
                      <div className="fmr-kisi">
                        <b><PersonelAdi kod={k.sicil}>{k.ad}</PersonelAdi></b>
                        <small>
                          {k.sicil} · {k.gorev ?? "—"} · {k.sube}
                        </small>
                      </div>
                    ),
                  },
                  {
                    title: "Toplam",
                    key: "dk",
                    width: 110,
                    align: "right",
                    defaultSortOrder: "descend",
                    sorter: (a, b) => a.dk - b.dk,
                    render: (_, k) => <b className="fmr-sayi">{saat(k.dk)}</b>,
                  },
                  {
                    title: "Kayıt",
                    dataIndex: "kayit",
                    width: 70,
                    align: "right",
                    sorter: (a, b) => a.kayit - b.kayit,
                  },
                  {
                    title: "Son",
                    key: "son",
                    width: 80,
                    sorter: (a, b) => dayjs(a.son).valueOf() - dayjs(b.son).valueOf(),
                    render: (_, k) => dayjs(k.son).format("DD.MM"),
                  },
                ]}
              />
            </section>
          </div>
        </div>
      )}
    </Drawer>
  );
}

const CSS = `
.fmr-ust{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.fmr-cip{border:1px solid #cfe3a8;background:#f2f9e8;color:#3f6108;border-radius:99px;padding:3px 10px;font-weight:600;cursor:pointer}
.fmr{display:flex;flex-direction:column;gap:14px;transition:opacity .2s}
.fmr-soluk{opacity:.55}
.fmr-kpi{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:10px}
@media (max-width:760px){.fmr-kpi{grid-template-columns:1fr 1fr}}
.fmr-kpi>div{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1px solid #e6e9e3;border-radius:14px;background:#fff;min-width:0}
.fmr-kpi span{font-size:12px;color:#6b7280;font-weight:600}
.fmr-kpi b{font-size:22px;color:#1f2933;font-variant-numeric:tabular-nums;line-height:1.2}
.fmr-kpi small{font-size:12px;color:#8a929b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fmr-kpi .fmr-buyuk{background:#f2f9e8;border-color:#d7ebb5}
.fmr-kpi .fmr-buyuk b{font-size:30px;color:#3f6108}
.fmr-kutu{border:1px solid #e6e9e3;border-radius:14px;background:#fff;padding:12px 14px;min-width:0}
.fmr-kutu h4{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:14px}
.fmr-kutu h4 small{font-weight:400;color:#8a929b;font-size:12px}
.fmr-gunler{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;height:120px}
.fmr-gun{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;cursor:default}
.fmr-gun-cubuk{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid #e6e9e3}
.fmr-gun-cubuk i{display:block;width:72%;max-width:16px;background:#7cb518;border-radius:4px 4px 0 0}
.fmr-gun:hover .fmr-gun-cubuk i{background:#5f8c10}
.fmr-gun span{font-size:10px;color:#8a929b;font-variant-numeric:tabular-nums}
.fmr-gun span.hs{color:#ad4e00;font-weight:700}
.fmr-iki{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:14px;align-items:start}
@media (max-width:860px){.fmr-iki{grid-template-columns:minmax(0,1fr)}}
.fmr-subeler{display:flex;flex-direction:column;gap:2px;max-height:520px;overflow:auto}
.fmr-sube{display:grid;grid-template-columns:minmax(0,140px) minmax(0,1fr) 92px;grid-template-rows:auto auto;column-gap:10px;align-items:center;text-align:left;border:0;background:transparent;padding:6px 6px;border-radius:8px;cursor:pointer}
.fmr-sube:hover{background:#f6f8f3}
.fmr-sube.secili{background:#f2f9e8}
.fmr-sube.soluk{opacity:.5}
.fmr-sube .ad{font-size:13px;font-weight:600;color:#1f2933;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fmr-sube .cubuk{height:10px;background:#f1f3ee;border-radius:4px;overflow:hidden}
.fmr-sube .cubuk i{display:block;height:100%;background:#7cb518;border-radius:0 4px 4px 0}
.fmr-sube .deger{font-size:13px;font-weight:700;color:#1f2933;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
@media (max-width:600px){.fmr-gun span.ara{visibility:hidden}.fmr-sube{grid-template-columns:minmax(0,110px) minmax(0,1fr) 84px}}
.fmr-sube .alt{grid-column:1;font-size:11px;color:#8a929b}
.fmr-kisi{display:flex;flex-direction:column;min-width:0}
.fmr-kisi small{color:#8a929b;font-size:12px}
.fmr-sayi{font-variant-numeric:tabular-nums}
.fmr-liste-bas{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 14px;border:1px solid #e6e9e3;border-radius:12px;background:#fff}
.fmr-liste-bas>b{font-size:16px;letter-spacing:.02em}
.fmr-liste-toplam{font-size:20px;font-weight:800;color:#c00000;font-variant-numeric:tabular-nums}
.fmr-soluk-yazi{color:#8a929b;font-size:12px}
.fmr-neden{font-size:12px;line-height:1.45;display:block;text-align:center}
.fmr-neden b{font-weight:700;color:#1f2933}
`;
