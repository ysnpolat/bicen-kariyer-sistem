/**
 * ---------------------------------------------------------------------------
 * Tarih aralığında QR okutmaları (19.10.2026)
 * ---------------------------------------------------------------------------
 * Raporlar › Günlük QR okutma › "Tarih aralığı". Tarih aralığı + bölge /
 * şube / personel süzgeci; üç görünüm:
 *   - Takvim: kişi × gün ızgarası (giriş saati, renk durumuna göre)
 *   - Kişi özeti: beklenen / okutulan / okutmayan gün, eksik çıkış, oran;
 *     satır açılınca o kişinin gün gün okutmaları
 *   - Gün gün: her kişi-gün bir satır
 * Excel: kişi özeti ya da gün gün detay. Hesap günlük raporla aynı
 * (muaf, raporlu ve izinli günler beklenenlere girmez).
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  DatePicker,
  Dropdown,
  Empty,
  Input,
  Segmented,
  Select,
  Spin,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { Dayjs } from "dayjs";
import { CalendarRange, Download, Search, UserRound, X } from "lucide-react";

import { api } from "./api";
import { tabloIndir } from "./raporExcel";
import { PersonelAdi } from "./personelKarti";
import { HareketListesi, KaynakEtiketleri } from "./OkutmaKaynagi";

const { RangePicker } = DatePicker;

type Durum = "okuttu" | "okutmadi" | "izinli" | "raporlu" | "muaf";

interface GunSatiri {
  tarih: string;
  sicil: string;
  adSoyad: string;
  birim: string;
  pozisyon: string | null;
  durum: Durum;
  neden: string | null;
  ilkGiris: string | null;
  sonCikis: string | null;
  dakika: number | null;
  eksikCikis: boolean;
  hareketSayisi: number;
  kaynaklar: string[];
  hareketler: any[] | null;
}

interface KisiOzeti {
  sicil: string;
  adSoyad: string;
  birim: string;
  pozisyon: string | null;
  calisiyor: boolean;
  beklenen: number;
  okutulan: number;
  okutmayan: number;
  izinli: number;
  raporlu: number;
  muaf: number;
  eksikCikis: number;
  toplamDakika: number;
  oran: number | null;
}

interface Yanit {
  bas: string;
  bit: string;
  gunSayisi: number;
  kisiSayisi: number;
  hedefOran: number;
  icardUlasilamadi: boolean;
  detayli: boolean;
  kisiler: KisiOzeti[];
  satirlar: GunSatiri[];
}

interface KisiSecenek {
  sicil: string;
  adSoyad: string;
  birim: string | null;
  pozisyon: string | null;
  calisiyor: boolean;
}

const DURUM: Record<Durum, { ad: string; renk: string; zemin: string }> = {
  okuttu: { ad: "Okuttu", renk: "#3f6507", zemin: "#e7f3d6" },
  okutmadi: { ad: "Okutmadı", renk: "#b42318", zemin: "#fde4e1" },
  izinli: { ad: "İzinli", renk: "#475467", zemin: "#eef1f5" },
  raporlu: { ad: "Raporlu", renk: "#6941c6", zemin: "#efe9fb" },
  muaf: { ad: "Muaf", renk: "#7a5b00", zemin: "#fbf1d2" },
};

const saat = (v: string | null) => (v ? dayjs(v).format("HH:mm") : "");
const sureYaz = (dk: number | null | undefined) =>
  dk == null || dk <= 0 ? "" : `${Math.floor(dk / 60)} sa ${String(dk % 60).padStart(2, "0")} dk`;
const GUN_ADI = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

const oranRengi = (o: number | null, hedef: number) =>
  o == null ? "#98a2b3" : o >= hedef ? "#3f6507" : o >= hedef - 20 ? "#b54708" : "#b42318";

export default function OkutmaAraligi({
  tumBolgeler,
  subeler,
}: {
  tumBolgeler: string[];
  subeler: string[];
}) {
  const { message } = AntdApp.useApp();

  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, "day"), dayjs()]);
  const [bolgeler, setBolgeler] = useState<string[]>([]);
  const [sube, setSube] = useState<string | undefined>();
  const [kisi, setKisi] = useState<KisiSecenek | null>(null);

  const [veri, setVeri] = useState<Yanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [gorunum, setGorunum] = useState<"takvim" | "ozet" | "gun">("takvim");
  const [arama, setArama] = useState("");
  const [durumSuzgec, setDurumSuzgec] = useState<Durum | "eksik" | undefined>();

  /* Personel arama */
  const [kisiSecenek, setKisiSecenek] = useState<KisiSecenek[]>([]);
  const [kisiAraniyor, setKisiAraniyor] = useState(false);
  const aramaZamani = useRef<number>();

  const kisiAra = (q: string) => {
    window.clearTimeout(aramaZamani.current);
    if (q.trim().length < 2) {
      setKisiSecenek([]);
      return;
    }
    aramaZamani.current = window.setTimeout(async () => {
      setKisiAraniyor(true);
      try {
        setKisiSecenek(await api.al<KisiSecenek[]>(`/api/Personel/OkutmaKisiAra?q=${encodeURIComponent(q.trim())}`));
      } catch {
        setKisiSecenek([]);
      } finally {
        setKisiAraniyor(false);
      }
    }, 300);
  };

  const gunSayisi = aralik[1].startOf("day").diff(aralik[0].startOf("day"), "day") + 1;

  const getir = async () => {
    if (gunSayisi > 62) {
      message.warning("En fazla 62 günlük aralık seçilebilir.");
      return;
    }
    if (!kisi && !sube && bolgeler.length === 0 && gunSayisi > 31) {
      message.warning("Tüm şubeler için en fazla 31 gün seçilebilir; şube, bölge ya da personel seçin.");
      return;
    }

    setYukleniyor(true);
    try {
      const s = new URLSearchParams({
        bas: aralik[0].format("YYYY-MM-DD"),
        bit: aralik[1].format("YYYY-MM-DD"),
      });
      if (bolgeler.length > 0) s.set("bolgeler", bolgeler.join(","));
      if (sube) s.set("sube", sube);
      if (kisi) s.set("sicil", kisi.sicil);

      const v = await api.al<Yanit>(`/api/Personel/OkutmaAraligi?${s}`);
      setVeri(v);
      if (v.kisiSayisi === 1) setGorunum("gun");
    } catch (e: any) {
      message.error(e?.message || "Rapor alınamadı");
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  };

  /* İlk açılışta son 7 gün */
  useEffect(() => {
    getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------ süzme */

  const aranan = arama.trim().toLocaleLowerCase("tr");
  const eslesir = (x: { adSoyad: string; sicil: string; birim: string; pozisyon: string | null }) =>
    !aranan || [x.adSoyad, x.sicil, x.birim, x.pozisyon].some((y) => (y ?? "").toLocaleLowerCase("tr").includes(aranan));

  const satirlar = useMemo(
    () =>
      (veri?.satirlar ?? []).filter(
        (s) =>
          eslesir(s) &&
          (!durumSuzgec || (durumSuzgec === "eksik" ? s.eksikCikis : s.durum === durumSuzgec))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [veri, aranan, durumSuzgec]
  );

  const kisiler = useMemo(() => {
    const k = (veri?.kisiler ?? []).filter(eslesir);
    if (!durumSuzgec) return k;
    const kodlar = new Set(satirlar.map((s) => s.sicil));
    return k.filter((x) => kodlar.has(x.sicil));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veri, aranan, durumSuzgec, satirlar]);

  /** sicil → tarih → satır */
  const dizin = useMemo(() => {
    const d = new Map<string, Map<string, GunSatiri>>();
    for (const s of veri?.satirlar ?? []) {
      if (!d.has(s.sicil)) d.set(s.sicil, new Map());
      d.get(s.sicil)!.set(dayjs(s.tarih).format("YYYY-MM-DD"), s);
    }
    return d;
  }, [veri]);

  const gunler = useMemo(() => {
    if (!veri) return [] as Dayjs[];
    const g: Dayjs[] = [];
    for (let d = dayjs(veri.bas); !d.isAfter(dayjs(veri.bit), "day"); d = d.add(1, "day")) g.push(d);
    return g;
  }, [veri]);

  /* ------------------------------------------------------------ özet */

  const ozet = useMemo(() => {
    const k = veri?.kisiler ?? [];
    const beklenen = k.reduce((a, x) => a + x.beklenen, 0);
    const okutmayan = k.reduce((a, x) => a + x.okutmayan, 0);
    return {
      kisi: k.length,
      beklenen,
      okutulan: k.reduce((a, x) => a + x.okutulan, 0),
      okutmayan,
      izinli: k.reduce((a, x) => a + x.izinli + x.raporlu + x.muaf, 0),
      eksik: k.reduce((a, x) => a + x.eksikCikis, 0),
      oran: beklenen > 0 ? Math.round((Math.max(0, beklenen - okutmayan) * 100) / beklenen) : null,
    };
  }, [veri]);

  const hedef = veri?.hedefOran ?? 90;

  /* ------------------------------------------------------------ Excel */

  const donemMetni = veri
    ? `${dayjs(veri.bas).format("DD.MM.YYYY")} – ${dayjs(veri.bit).format("DD.MM.YYYY")} · ${veri.gunSayisi} gün`
    : "";
  const suzgecMetni = [kisi?.adSoyad, sube, bolgeler.length ? bolgeler.join(", ") : null].filter(Boolean).join(" · ");
  const dosyaEki = veri ? `${dayjs(veri.bas).format("YYYYMMDD")}-${dayjs(veri.bit).format("YYYYMMDD")}` : "";

  const excelGunluk = () =>
    tabloIndir({
      baslik: "QR Okutmaları · Gün gün",
      altBaslik: [donemMetni, suzgecMetni].filter(Boolean).join(" · "),
      sayfaAdi: "Gün gün",
      dosyaAdi: `okutma-gun-gun-${dosyaEki}`,
      grupSutunu: 1,
      sutunlar: [
        { ad: "Tarih", tip: "tarih" },
        { ad: "Birim", genislik: 24 },
        { ad: "Sicil", genislik: 9 },
        { ad: "Personel", genislik: 26 },
        { ad: "Pozisyon", genislik: 22 },
        { ad: "Durum", genislik: 11 },
        { ad: "Sebep", genislik: 16 },
        { ad: "İlk Giriş", genislik: 9 },
        { ad: "Son Çıkış", genislik: 9 },
        { ad: "Süre (saat)", tip: "ondalik", genislik: 10, toplam: false },
        { ad: "Eksik Çıkış", genislik: 10 },
        { ad: "Okutma Kaynağı", genislik: 16 },
      ],
      satirlar: satirlar.map((s) => [
        dayjs(s.tarih).toDate(),
        s.birim,
        s.sicil,
        s.adSoyad,
        s.pozisyon ?? "",
        DURUM[s.durum].ad,
        s.neden ?? "",
        saat(s.ilkGiris),
        saat(s.sonCikis),
        s.dakika ? Math.round((s.dakika / 60) * 10) / 10 : null,
        s.eksikCikis ? "Evet" : "",
        (s.kaynaklar ?? []).join(", "),
      ]),
    });

  const excelOzet = () =>
    tabloIndir({
      baslik: "QR Okutmaları · Kişi özeti",
      altBaslik: [donemMetni, suzgecMetni].filter(Boolean).join(" · "),
      sayfaAdi: "Kişi özeti",
      dosyaAdi: `okutma-kisi-ozeti-${dosyaEki}`,
      grupSutunu: 0,
      genelToplam: true,
      sutunlar: [
        { ad: "Birim", genislik: 24 },
        { ad: "Sicil", genislik: 9 },
        { ad: "Personel", genislik: 26 },
        { ad: "Pozisyon", genislik: 22 },
        { ad: "Beklenen Gün", tip: "sayi" },
        { ad: "Okuttuğu Gün", tip: "sayi" },
        { ad: "Okutmadığı Gün", tip: "sayi" },
        { ad: "İzinli Gün", tip: "sayi" },
        { ad: "Raporlu Gün", tip: "sayi" },
        { ad: "Muaf Gün", tip: "sayi" },
        { ad: "Eksik Çıkış", tip: "sayi" },
        { ad: "Toplam Süre (saat)", tip: "ondalik" },
        { ad: "Okutma Oranı", tip: "yuzde", renkOlcegi: true, toplam: false },
      ],
      satirlar: kisiler.map((k) => [
        k.birim,
        k.sicil,
        k.adSoyad,
        k.pozisyon ?? "",
        k.beklenen,
        k.okutulan,
        k.okutmayan,
        k.izinli,
        k.raporlu,
        k.muaf,
        k.eksikCikis,
        Math.round((k.toplamDakika / 60) * 10) / 10,
        k.oran == null ? null : k.oran / 100,
      ]),
    });

  /* ------------------------------------------------------------ tablolar */

  const durumEtiketi = (s: GunSatiri) => (
    <Tag
      bordered={false}
      style={{ color: DURUM[s.durum].renk, background: DURUM[s.durum].zemin, fontWeight: 600, marginInlineEnd: 0 }}
    >
      {s.durum === "okuttu" || !s.neden ? DURUM[s.durum].ad : s.neden}
    </Tag>
  );

  const gunSutunlari = (kisiGoster: boolean): ColumnsType<GunSatiri> => [
    {
      title: "Tarih",
      dataIndex: "tarih",
      width: 120,
      render: (t: string) => (
        <span style={{ whiteSpace: "nowrap" }}>
          {dayjs(t).format("DD.MM.YYYY")} <small style={{ color: "#98a2b3" }}>{GUN_ADI[dayjs(t).day()]}</small>
        </span>
      ),
    },
    ...(kisiGoster
      ? ([
          {
            title: "Personel",
            dataIndex: "adSoyad",
            render: (_: any, s: GunSatiri) => (
              <div>
                <PersonelAdi kod={s.sicil}>{s.adSoyad}</PersonelAdi>
                <div style={{ fontSize: 12, color: "#98a2b3" }}>
                  {s.sicil} · {s.birim}
                </div>
              </div>
            ),
          },
        ] as ColumnsType<GunSatiri>)
      : []),
    { title: "Durum", width: 140, render: (_: any, s) => durumEtiketi(s) },
    {
      title: "İlk giriş",
      width: 90,
      render: (_: any, s) => <b style={{ fontVariantNumeric: "tabular-nums" }}>{saat(s.ilkGiris) || "—"}</b>,
    },
    {
      title: "Son çıkış",
      width: 110,
      render: (_: any, s) =>
        s.eksikCikis ? (
          <Tag color="orange" bordered={false}>
            Çıkış yok
          </Tag>
        ) : (
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{saat(s.sonCikis) || "—"}</b>
        ),
    },
    { title: "Süre", width: 110, render: (_: any, s) => sureYaz(s.dakika) || "—" },
    {
      title: "Kaynak",
      width: 150,
      responsive: ["md"],
      render: (_: any, s) => <KaynakEtiketleri kaynaklar={s.kaynaklar} kucuk />,
    },
  ];

  const ozetSutunlari: ColumnsType<KisiOzeti> = [
    {
      title: "Personel",
      dataIndex: "adSoyad",
      sorter: (a, b) => a.adSoyad.localeCompare(b.adSoyad, "tr"),
      render: (_: any, k) => (
        <div>
          <PersonelAdi kod={k.sicil}>{k.adSoyad}</PersonelAdi>
          {!k.calisiyor && (
            <Tag bordered={false} color="red" style={{ marginInlineStart: 6 }}>
              Ayrıldı
            </Tag>
          )}
          <div style={{ fontSize: 12, color: "#98a2b3" }}>
            {k.sicil} · {k.pozisyon ?? ""}
          </div>
        </div>
      ),
    },
    { title: "Birim", dataIndex: "birim", responsive: ["md"], sorter: (a, b) => a.birim.localeCompare(b.birim, "tr") },
    { title: "Beklenen", dataIndex: "beklenen", align: "right", width: 90, sorter: (a, b) => a.beklenen - b.beklenen },
    {
      title: "Okuttu",
      dataIndex: "okutulan",
      align: "right",
      width: 80,
      sorter: (a, b) => a.okutulan - b.okutulan,
      render: (v: number) => <b style={{ color: DURUM.okuttu.renk }}>{v}</b>,
    },
    {
      title: "Okutmadı",
      dataIndex: "okutmayan",
      align: "right",
      width: 90,
      defaultSortOrder: "descend",
      sorter: (a, b) => a.okutmayan - b.okutmayan,
      render: (v: number) => <b style={{ color: v > 0 ? DURUM.okutmadi.renk : "#98a2b3" }}>{v}</b>,
    },
    {
      title: "İzin / rapor",
      align: "right",
      width: 100,
      responsive: ["lg"],
      render: (_: any, k) => k.izinli + k.raporlu + k.muaf,
    },
    {
      title: "Eksik çıkış",
      dataIndex: "eksikCikis",
      align: "right",
      width: 100,
      sorter: (a, b) => a.eksikCikis - b.eksikCikis,
      render: (v: number) => (v > 0 ? <b style={{ color: "#b54708" }}>{v}</b> : <span style={{ color: "#98a2b3" }}>0</span>),
    },
    {
      title: "Toplam süre",
      dataIndex: "toplamDakika",
      width: 120,
      responsive: ["lg"],
      sorter: (a, b) => a.toplamDakika - b.toplamDakika,
      render: (v: number) => sureYaz(v) || "—",
    },
    {
      title: "Oran",
      dataIndex: "oran",
      width: 80,
      align: "right",
      sorter: (a, b) => (a.oran ?? -1) - (b.oran ?? -1),
      render: (v: number | null) => <b style={{ color: oranRengi(v, hedef) }}>{v == null ? "—" : `%${v}`}</b>,
    },
  ];

  /* Takvim: kişi × gün ızgarası */
  const takvimSutunlari: ColumnsType<KisiOzeti> = [
    {
      title: "Personel",
      fixed: "left",
      width: 210,
      render: (_: any, k) => (
        <div style={{ lineHeight: 1.25 }}>
          <PersonelAdi kod={k.sicil}>{k.adSoyad}</PersonelAdi>
          <div style={{ fontSize: 11.5, color: "#98a2b3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {k.birim}
          </div>
        </div>
      ),
    },
    ...gunler.map((g) => ({
      key: g.format("YYYY-MM-DD"),
      title: (
        <div style={{ textAlign: "center", lineHeight: 1.15, color: g.day() === 0 ? "#b42318" : undefined }}>
          <div style={{ fontWeight: 700 }}>{g.format("DD")}</div>
          <div style={{ fontSize: 10.5, fontWeight: 500, color: "#98a2b3" }}>{GUN_ADI[g.day()]}</div>
        </div>
      ),
      width: 58,
      align: "center" as const,
      onCell: () => ({ style: { padding: 3 } }),
      render: (_: any, k: KisiOzeti) => {
        const s = dizin.get(k.sicil)?.get(g.format("YYYY-MM-DD"));
        if (!s) return <span style={{ color: "#d0d5dd" }}>·</span>;
        const d = DURUM[s.durum];
        const icerik =
          s.durum === "okuttu" ? (
            <>
              <div style={{ fontWeight: 700 }}>{saat(s.ilkGiris) || "—"}</div>
              <div style={{ fontSize: 10.5, opacity: 0.85 }}>{s.eksikCikis ? "çıkış yok" : saat(s.sonCikis) || "—"}</div>
            </>
          ) : (
            <div style={{ fontSize: 10.5, fontWeight: 700 }}>
              {s.durum === "okutmadi" ? "YOK" : (s.neden ?? d.ad).slice(0, 7)}
            </div>
          );
        return (
          <Tooltip
            title={
              <div>
                <b>
                  {g.format("DD.MM.YYYY dddd")} · {s.durum === "okuttu" || !s.neden ? d.ad : s.neden}
                </b>
                {s.durum === "okuttu" && (
                  <div>
                    Giriş {saat(s.ilkGiris) || "—"} · Çıkış {saat(s.sonCikis) || "yok"}
                    {s.dakika ? ` · ${sureYaz(s.dakika)}` : ""}
                  </div>
                )}
              </div>
            }
          >
            <div
              style={{
                background: d.zemin,
                color: d.renk,
                borderRadius: 6,
                padding: "3px 0",
                fontSize: 11.5,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.2,
                outline: s.eksikCikis ? "1.5px solid #f79009" : undefined,
                outlineOffset: -1.5,
              }}
            >
              {icerik}
            </div>
          </Tooltip>
        );
      },
    })),
    {
      title: "Oran",
      fixed: "right",
      width: 66,
      align: "right",
      render: (_: any, k) => <b style={{ color: oranRengi(k.oran, hedef) }}>{k.oran == null ? "—" : `%${k.oran}`}</b>,
    },
  ];

  /* ------------------------------------------------------------ görünüm */

  const kpi = (baslik: string, deger: ReactNode, alt: string, renk?: string) => (
    <div className="rr-kpi">
      <div className="rr-kpi-ust">
        <span>{baslik}</span>
      </div>
      <div className="rr-kpi-deger" style={renk ? { color: renk } : undefined}>
        {deger}
      </div>
      <div className="rr-kpi-alt">{alt}</div>
    </div>
  );

  const tekKisi = veri?.kisiSayisi === 1;

  return (
    <>
      <div className="rr-filtre">
        <RangePicker
          value={aralik}
          format="DD.MM.YYYY"
          allowClear={false}
          disabledDate={(g) => !!g && g > dayjs().endOf("day")}
          onChange={(v) => v?.[0] && v?.[1] && setAralik([v[0], v[1]])}
          presets={[
            { label: "Son 7 gün", value: [dayjs().subtract(6, "day"), dayjs()] },
            { label: "Bu hafta", value: [dayjs().startOf("week"), dayjs()] },
            { label: "Geçen hafta", value: [dayjs().subtract(1, "week").startOf("week"), dayjs().subtract(1, "week").endOf("week")] },
            { label: "Bu ay", value: [dayjs().startOf("month"), dayjs()] },
            { label: "Geçen ay", value: [dayjs().subtract(1, "month").startOf("month"), dayjs().subtract(1, "month").endOf("month")] },
          ]}
        />

        <Select
          mode="multiple"
          allowClear
          maxTagCount={1}
          placeholder="Tüm bölgeler"
          style={{ minWidth: 160 }}
          value={bolgeler}
          onChange={setBolgeler}
          options={tumBolgeler.map((b) => ({ value: b, label: b }))}
          maxTagPlaceholder={(k) => `+${k.length}`}
        />

        <Select
          allowClear
          showSearch
          placeholder="Tüm şubeler"
          style={{ minWidth: 170 }}
          value={sube}
          onChange={setSube}
          options={subeler.map((s) => ({ value: s, label: s }))}
        />

        {kisi ? (
          <Tag
            closable
            closeIcon={<X size={12} />}
            onClose={() => setKisi(null)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: 13, margin: 0 }}
          >
            <UserRound size={13} /> {kisi.adSoyad} · {kisi.sicil}
          </Tag>
        ) : (
          <Select
            showSearch
            allowClear
            filterOption={false}
            placeholder="Personel ara (ad, sicil)"
            style={{ minWidth: 210 }}
            onSearch={kisiAra}
            loading={kisiAraniyor}
            notFoundContent={kisiAraniyor ? <Spin size="small" /> : null}
            value={null as any}
            onChange={(v) => {
              const k = kisiSecenek.find((x) => x.sicil === v);
              if (k) setKisi(k);
            }}
            options={kisiSecenek.map((k) => ({
              value: k.sicil,
              label: `${k.adSoyad} · ${k.sicil}${k.birim ? ` · ${k.birim}` : ""}${k.calisiyor ? "" : " (ayrıldı)"}`,
            }))}
          />
        )}

        <Button type="primary" icon={<CalendarRange size={15} strokeWidth={2} />} loading={yukleniyor} onClick={getir}>
          Göster
        </Button>

        <div className="rr-filtre-sag">
          <Dropdown
            trigger={["click"]}
            disabled={!veri || veri.kisiSayisi === 0}
            menu={{
              items: [
                { key: "ozet", label: "Kişi özeti (Excel)", onClick: excelOzet },
                { key: "gun", label: "Gün gün detay (Excel)", onClick: excelGunluk },
              ],
            }}
          >
            <Button icon={<Download size={15} strokeWidth={2} />}>Excel</Button>
          </Dropdown>
        </div>
      </div>

      {yukleniyor && !veri ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : !veri ? (
        <Empty description="Tarih aralığı seçip Göster'e basın." />
      ) : (
        <Spin spinning={yukleniyor}>
          {veri.icardUlasilamadi && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="iCard veritabanına ulaşılamadı; rapor yalnızca Biçen360 okutmalarıyla hazırlandı."
            />
          )}

          <div className="rr-kpi-satir rr-bes">
            {kpi(tekKisi ? "Personel" : "Personel", tekKisi ? veri.kisiler[0]?.adSoyad ?? "" : ozet.kisi, donemMetni)}
            {kpi("Beklenen gün", ozet.beklenen, `${ozet.izinli} gün izinli / raporlu / muaf`, "#2f5fa7")}
            {kpi("Okutulan gün", ozet.okutulan, "en az bir okutma", DURUM.okuttu.renk)}
            {kpi("Okutulmayan gün", ozet.okutmayan, "beklenip okutulmayan", DURUM.okutmadi.renk)}
            {kpi("Eksik çıkış", ozet.eksik, "girişi var, çıkışı yok", "#b54708")}
          </div>

          <div className="rr-kart" style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <b>
                {donemMetni} · okutma oranı <small style={{ color: "#98a2b3", fontWeight: 500 }}>hedef %{hedef}</small>
              </b>
              <b style={{ fontSize: 26, color: oranRengi(ozet.oran, hedef) }}>{ozet.oran == null ? "—" : `%${ozet.oran}`}</b>
            </div>
            <div style={{ position: "relative", height: 10, background: "#eef1ea", borderRadius: 99, marginTop: 8 }}>
              <div
                style={{
                  width: `${ozet.oran ?? 0}%`,
                  height: "100%",
                  borderRadius: 99,
                  background: oranRengi(ozet.oran, hedef),
                }}
              />
              <div style={{ position: "absolute", left: `${hedef}%`, top: -4, bottom: -4, borderLeft: "1.5px dashed #98a2b3" }} />
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <Segmented
              value={gorunum}
              onChange={(v) => setGorunum(v as any)}
              options={[
                { value: "takvim", label: "Takvim" },
                { value: "ozet", label: "Kişi özeti" },
                { value: "gun", label: "Gün gün" },
              ]}
            />
            {!tekKisi && (
              <Input
                allowClear
                prefix={<Search size={14} color="#9AA3AF" />}
                placeholder="Ad, sicil, birim"
                style={{ width: 200 }}
                value={arama}
                onChange={(e) => setArama(e.target.value)}
              />
            )}
            <Select
              allowClear
              placeholder="Tüm durumlar"
              style={{ minWidth: 150 }}
              value={durumSuzgec}
              onChange={setDurumSuzgec}
              options={[
                { value: "okutmadi", label: "Okutmadı" },
                { value: "eksik", label: "Çıkış okutmadı" },
                { value: "okuttu", label: "Okuttu" },
                { value: "izinli", label: "İzinli" },
                { value: "raporlu", label: "Raporlu" },
                { value: "muaf", label: "Muaf" },
              ]}
            />
            {gorunum === "takvim" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "#667085", marginInlineStart: "auto" }}>
                {(Object.keys(DURUM) as Durum[]).map((d) => (
                  <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <i style={{ width: 10, height: 10, borderRadius: 3, background: DURUM[d].zemin, border: `1px solid ${DURUM[d].renk}` }} />
                    {DURUM[d].ad}
                  </span>
                ))}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i style={{ width: 10, height: 10, borderRadius: 3, outline: "1.5px solid #f79009" }} /> Çıkış yok
                </span>
              </div>
            )}
          </div>

          {gorunum === "takvim" && (
            <Table
              size="small"
              bordered
              rowKey="sicil"
              columns={takvimSutunlari}
              dataSource={kisiler}
              scroll={{ x: 210 + 66 + gunler.length * 58 }}
              pagination={{ pageSize: 30, showSizeChanger: false, hideOnSinglePage: true }}
            />
          )}

          {gorunum === "ozet" && (
            <Table
              size="small"
              rowKey="sicil"
              columns={ozetSutunlari}
              dataSource={kisiler}
              pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
              scroll={{ x: true }}
              expandable={{
                expandedRowRender: (k) => (
                  <Table
                    size="small"
                    rowKey="tarih"
                    pagination={false}
                    columns={gunSutunlari(false)}
                    dataSource={(veri.satirlar ?? []).filter((s) => s.sicil === k.sicil)}
                    expandable={
                      veri.detayli
                        ? {
                            rowExpandable: (s) => (s.hareketler?.length ?? 0) > 0,
                            expandedRowRender: (s) => <HareketListesi hareketler={s.hareketler ?? []} />,
                          }
                        : undefined
                    }
                  />
                ),
              }}
            />
          )}

          {gorunum === "gun" && (
            <Table
              size="small"
              rowKey={(s) => `${s.sicil}-${s.tarih}`}
              columns={gunSutunlari(!tekKisi)}
              dataSource={satirlar}
              pagination={{ pageSize: 100, showSizeChanger: false, hideOnSinglePage: true }}
              scroll={{ x: true }}
              expandable={
                veri.detayli
                  ? {
                      rowExpandable: (s) => (s.hareketler?.length ?? 0) > 0,
                      expandedRowRender: (s) => <HareketListesi hareketler={s.hareketler ?? []} />,
                    }
                  : undefined
              }
            />
          )}
        </Spin>
      )}
    </>
  );
}
