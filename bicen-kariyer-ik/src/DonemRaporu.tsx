/**
 * ---------------------------------------------------------------------------
 * Dönem raporları — İzin ve Avans (08.10.2026)
 * ---------------------------------------------------------------------------
 * Ay ya da tarih aralığı seçilir, şube ve tür süzgeci uygulanır, özet ekranda
 * görülür ve biçimli Excel indirilir (donemRaporExcel.ts).
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { App as AntdApp, Button, DatePicker, Empty, Modal, Segmented, Select, Space, Spin, Table, Tag } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { FileSpreadsheet } from "lucide-react";

import { api } from "./api";
import { avansOzeti, avansRaporuIndir, izinOzeti, izinRaporuIndir } from "./donemRaporExcel";
import type { AvansRaporVerisi, IzinDonemVerisi } from "./donemRaporExcel";

type Kip = "ay" | "aralik" | "tum";

const g = (n: number) => (Math.round((n ?? 0) * 10) / 10).toLocaleString("tr-TR");
const tl = (n: number) => "₺" + Math.round(n ?? 0).toLocaleString("tr-TR");
const gun = (d: Dayjs) => d.format("YYYY-MM-DD");

function Kutu({ ad, deger, alt }: { ad: string; deger: ReactNode; alt?: string }) {
  return (
    <div style={{ flex: "1 1 130px", background: "#f6f9f1", border: "1px solid #e4ead9", borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".02em" }}>{ad}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: "#1f4d2b", lineHeight: 1.3 }}>{deger}</div>
      {alt && <div style={{ fontSize: 11.5, color: "#8a929b" }}>{alt}</div>}
    </div>
  );
}

function DonemSecici({
  kip,
  setKip,
  ay,
  setAy,
  aralik,
  setAralik,
  tum,
}: {
  kip: Kip;
  setKip: (k: Kip) => void;
  ay: Dayjs;
  setAy: (d: Dayjs) => void;
  aralik: [Dayjs, Dayjs];
  setAralik: (d: [Dayjs, Dayjs]) => void;
  tum?: boolean;
}) {
  const bugun = dayjs();
  return (
    <Space wrap>
      <Segmented
        value={kip}
        onChange={(v) => setKip(v as Kip)}
        options={[{ value: "ay", label: "Ay" }, { value: "aralik", label: "Tarih aralığı" }, ...(tum ? [{ value: "tum", label: "Tüm zamanlar" }] : [])]}
      />
      {kip === "ay" && <DatePicker picker="month" format="MMMM YYYY" allowClear={false} value={ay} onChange={(d) => d && setAy(d)} />}
      {kip === "aralik" && (
        <DatePicker.RangePicker format="DD.MM.YYYY" allowClear={false} value={aralik} onChange={(d) => d?.[0] && d?.[1] && setAralik([d[0], d[1]])} />
      )}
      {kip !== "tum" && (
        <Space size={4}>
          <Button size="small" onClick={() => { setKip("ay"); setAy(bugun.startOf("month")); }}>Bu ay</Button>
          <Button size="small" onClick={() => { setKip("ay"); setAy(bugun.subtract(1, "month").startOf("month")); }}>Geçen ay</Button>
          <Button size="small" onClick={() => { setKip("aralik"); setAralik([bugun.startOf("year"), bugun.endOf("year")]); }}>Bu yıl</Button>
        </Space>
      )}
    </Space>
  );
}

const sinirlar = (kip: Kip, ay: Dayjs, aralik: [Dayjs, Dayjs]): [string | null, string | null] =>
  kip === "tum" ? [null, null] : kip === "ay" ? [gun(ay.startOf("month")), gun(ay.endOf("month"))] : [gun(aralik[0]), gun(aralik[1])];

/* ======================================================================== */
/* İzin                                                                     */
/* ======================================================================== */

export function IzinDonemRaporu({ dugme }: { dugme?: ReactNode }) {
  const { message } = AntdApp.useApp();
  const [acik, setAcik] = useState(false);
  const [kip, setKip] = useState<Kip>("ay");
  const [ay, setAy] = useState(dayjs().startOf("month"));
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([dayjs().startOf("year"), dayjs()]);
  const [veri, setVeri] = useState<IzinDonemVerisi | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [indiriliyor, setIndiriliyor] = useState(false);
  const [subeler, setSubeler] = useState<string[]>([]);
  const [bolgeler, setBolgeler] = useState<string[]>([]);
  const [turler, setTurler] = useState<string[]>([]);

  const [bas, bit] = sinirlar(kip, ay, aralik);

  useEffect(() => {
    if (!acik || !bas || !bit) return;
    setYukleniyor(true);
    api
      .al<IzinDonemVerisi>(`/api/IzinRapor/Donem?bas=${bas}&bit=${bit}`)
      .then(setVeri)
      .catch((h: any) => message.error(h.message))
      .finally(() => setYukleniyor(false));
  }, [acik, bas, bit, message]);

  const suzulmus = useMemo<IzinDonemVerisi | null>(() => {
    if (!veri) return null;
    return {
      ...veri,
      satirlar: veri.satirlar.filter(
        (x) =>
          (subeler.length === 0 || subeler.includes(x.sube ?? "")) &&
          (bolgeler.length === 0 || bolgeler.includes(x.bolge ?? "")) &&
          (turler.length === 0 || turler.includes(x.tur))
      ),
    };
  }, [veri, subeler, bolgeler, turler]);

  const o = useMemo(() => (suzulmus ? izinOzeti(suzulmus) : null), [suzulmus]);
  const secenek = (f: (x: IzinDonemVerisi["satirlar"][number]) => string | null) =>
    [...new Set((veri?.satirlar ?? []).map(f).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "tr")).map((x) => ({ value: x, label: x }));

  const indir = async () => {
    if (!suzulmus) return;
    setIndiriliyor(true);
    try {
      const s = [bolgeler.length ? `Bölge: ${bolgeler.join(", ")}` : "", subeler.length ? `Şube: ${subeler.join(", ")}` : "", turler.length ? `Tür: ${turler.join(", ")}` : ""].filter(Boolean).join(" · ");
      await izinRaporuIndir(suzulmus, s || undefined);
    } catch (h: any) {
      message.error(h?.message ?? "Excel oluşturulamadı.");
    } finally {
      setIndiriliyor(false);
    }
  };

  return (
    <>
      <span onClick={() => setAcik(true)}>{dugme ?? <Button icon={<FileSpreadsheet size={14} />}>Dönem raporu</Button>}</span>
      <Modal
        open={acik}
        width={880}
        title="İzin raporu · kimler hangi izne kaç gün çıktı"
        onCancel={() => setAcik(false)}
        footer={[
          <Button key="k" onClick={() => setAcik(false)}>Kapat</Button>,
          <Button key="i" type="primary" icon={<FileSpreadsheet size={14} />} loading={indiriliyor} disabled={!o || o.kayitSayisi === 0} onClick={indir}>
            Excel'e indir
          </Button>,
        ]}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <DonemSecici kip={kip} setKip={setKip} ay={ay} setAy={setAy} aralik={aralik} setAralik={setAralik} />
          <Space wrap>
            <Select mode="multiple" allowClear placeholder="Bölge" style={{ minWidth: 160 }} value={bolgeler} onChange={setBolgeler} options={secenek((x) => x.bolge)} maxTagCount={2} />
            <Select mode="multiple" allowClear placeholder="Şube" style={{ minWidth: 220 }} value={subeler} onChange={setSubeler} options={secenek((x) => x.sube)} maxTagCount={2} />
            <Select mode="multiple" allowClear placeholder="İzin türü" style={{ minWidth: 220 }} value={turler} onChange={setTurler} options={secenek((x) => x.tur)} maxTagCount={2} />
          </Space>

          {yukleniyor ? (
            <Spin />
          ) : !o || o.kayitSayisi === 0 ? (
            <Empty description="Bu dönemde izin kaydı yok." />
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Kutu ad="Toplam izin günü" deger={g(o.toplamGun)} alt="dönem içindeki gün" />
                <Kutu ad="İzin kullanan" deger={o.kisiSayisi} alt="kişi" />
                <Kutu ad="İzin kaydı" deger={o.kayitSayisi} />
                <Kutu ad="Şube" deger={o.subeler.length} />
              </div>
              <Table
                size="small"
                rowKey="tur"
                pagination={false}
                dataSource={o.turOzet}
                columns={[
                  { title: "İzin türü", dataIndex: "tur", render: (t: string) => <Tag color="green">{t}</Tag> },
                  { title: "Kişi", align: "right", render: (_: unknown, t: any) => t.kisi.size },
                  { title: "Kayıt", dataIndex: "kayit", align: "right" },
                  { title: "Gün", align: "right", render: (_: unknown, t: any) => <b>{g(t.gun)}</b> },
                  { title: "Pay", align: "right", render: (_: unknown, t: any) => `%${o.toplamGun ? Math.round((100 * t.gun) / o.toplamGun) : 0}` },
                ]}
              />
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Excel'de: Özet (türe göre, şube × tür{o.aylar.length > 1 ? ", aylık dağılım" : ""}), Kişi bazında (kişi × izin türü)
                {o.aylar.length > 1 ? ", Aylık (kişi × ay)" : ""} ve Ayrıntı (her izin kaydı). Döneme taşan iznin yalnızca dönem içindeki günü sayılır.
              </div>
            </>
          )}
        </Space>
      </Modal>
    </>
  );
}

/* ======================================================================== */
/* Avans                                                                    */
/* ======================================================================== */

export function AvansRaporu({ dugme }: { dugme?: ReactNode }) {
  const { message } = AntdApp.useApp();
  const [acik, setAcik] = useState(false);
  const [kip, setKip] = useState<Kip>("tum");
  const [ay, setAy] = useState(dayjs().startOf("month"));
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>([dayjs().startOf("year"), dayjs()]);
  const [veri, setVeri] = useState<AvansRaporVerisi | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [indiriliyor, setIndiriliyor] = useState(false);
  const [subeler, setSubeler] = useState<string[]>([]);

  const [bas, bit] = sinirlar(kip, ay, aralik);

  useEffect(() => {
    if (!acik) return;
    setYukleniyor(true);
    const q = [bas ? `bas=${bas}` : "", bit ? `bit=${bit}` : ""].filter(Boolean).join("&");
    api
      .al<AvansRaporVerisi>(`/api/Avans/Rapor${q ? `?${q}` : ""}`)
      .then(setVeri)
      .catch((h: any) => message.error(h.message))
      .finally(() => setYukleniyor(false));
  }, [acik, bas, bit, message]);

  const suzulmus = useMemo<AvansRaporVerisi | null>(
    () => (veri ? { ...veri, kayitlar: veri.kayitlar.filter((x) => subeler.length === 0 || subeler.includes(x.sube ?? "")) } : null),
    [veri, subeler]
  );
  const o = useMemo(() => (suzulmus ? avansOzeti(suzulmus) : null), [suzulmus]);

  const indir = async () => {
    if (!suzulmus) return;
    setIndiriliyor(true);
    try {
      await avansRaporuIndir(suzulmus, subeler.length ? `Şube: ${subeler.join(", ")}` : undefined);
    } catch (h: any) {
      message.error(h?.message ?? "Excel oluşturulamadı.");
    } finally {
      setIndiriliyor(false);
    }
  };

  return (
    <>
      <span onClick={() => setAcik(true)}>{dugme ?? <Button icon={<FileSpreadsheet size={14} />}>Avans raporu</Button>}</span>
      <Modal
        open={acik}
        width={880}
        title="Avans raporu · kim ne kadar aldı, ne kadar ödedi"
        onCancel={() => setAcik(false)}
        footer={[
          <Button key="k" onClick={() => setAcik(false)}>Kapat</Button>,
          <Button key="i" type="primary" icon={<FileSpreadsheet size={14} />} loading={indiriliyor} disabled={!suzulmus || suzulmus.kayitlar.length === 0} onClick={indir}>
            Excel'e indir
          </Button>,
        ]}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <DonemSecici kip={kip} setKip={setKip} ay={ay} setAy={setAy} aralik={aralik} setAralik={setAralik} tum />
          <Select
            mode="multiple"
            allowClear
            placeholder="Şube (tümü)"
            style={{ minWidth: 260 }}
            value={subeler}
            onChange={setSubeler}
            maxTagCount={3}
            options={[...new Set((veri?.kayitlar ?? []).map((x) => x.sube).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "tr")).map((x) => ({ value: x, label: x }))}
          />
          {yukleniyor ? (
            <Spin />
          ) : !o || !suzulmus || suzulmus.kayitlar.length === 0 ? (
            <Empty description="Bu dönemde avans talebi yok." />
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Kutu ad="Verilen avans" deger={tl(o.toplam)} alt={`${o.onayli.length} avans · ${o.kisiler.length} kişi`} />
                <Kutu ad="Ödenen (kesilen)" deger={tl(o.odenen)} />
                <Kutu ad="Kalan alacak" deger={tl(o.kalan)} />
                <Kutu ad="Devam eden" deger={o.devam.length} alt={`${o.devam.reduce((s, x) => s + x.kalanTaksit, 0)} taksit kaldı`} />
                <Kutu ad="Kapanan" deger={o.kapanan.length} alt="bütün taksitler ödendi" />
              </div>
              <Table
                size="small"
                rowKey="kod"
                pagination={{ pageSize: 6, hideOnSinglePage: true, showSizeChanger: false }}
                dataSource={o.kisiler}
                columns={[
                  { title: "Personel", render: (_: unknown, k: any) => <><b>{k.ad}</b><div style={{ fontSize: 11.5, color: "#8a929b" }}>{k.kod} · {k.sube}</div></> },
                  { title: "Avans", dataIndex: "adet", align: "right" },
                  { title: "Alınan", align: "right", render: (_: unknown, k: any) => tl(k.toplam) },
                  { title: "Ödenen", align: "right", render: (_: unknown, k: any) => tl(k.odenen) },
                  { title: "Kalan", align: "right", render: (_: unknown, k: any) => <b style={{ color: k.kalan > 0 ? "#b45309" : "#3f6108" }}>{tl(k.kalan)}</b> },
                  { title: "", width: 110, render: (_: unknown, k: any) => (k.devam > 0 ? <Tag color="gold">devam ediyor</Tag> : <Tag color="green">kapandı</Tag>) },
                ]}
              />
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Excel'de: Özet (durum, şube, ay), Avanslar (her talep: verilen, ödenen/kalan taksit ve tutar, ilerleme), Devam edenler, Kapananlar, Kişi bazında ve
                Taksit planı. Dönem talep tarihine göre; maaş bilgisi rapora alınmaz.
              </div>
            </>
          )}
        </Space>
      </Modal>
    </>
  );
}
