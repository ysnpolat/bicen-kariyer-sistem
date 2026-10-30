/**
 * ---------------------------------------------------------------------------
 * Çalışan aydınlatma metni (09.10.2026, KVKK md. 10)
 * ---------------------------------------------------------------------------
 * Biçen360 1.7 açılışta metni tam ekran gösteriyor; personel sonuna kadar
 * okuyup "Okudum, onaylıyorum" diyene kadar uygulama kullanılmıyor. Bu
 * sayfa: kim onayladı / kim bekliyor (şube, arama, Excel), metni düzenleyip
 * yeni sürüm yayınlama ve sürüm geçmişi.
 *
 * Kayıt bir aydınlatma kaydıdır, açık rıza değildir. Her onayda metnin
 * özeti (SHA-256), cihaz, uygulama sürümü ve IP tutuluyor.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App as AntdApp, Button, Checkbox, Empty, Input, Modal, Popconfirm, Segmented, Select, Spin, Table, Tag } from "antd";
import { FileSpreadsheet, Search, ShieldCheck } from "lucide-react";
import dayjs from "dayjs";
import ExcelJS from "exceljs";

import { api } from "./api";
import { dosyaIndir } from "./formIndir";

interface Kisi {
  sicil: string;
  ad: string;
  sube: string | null;
  gorev: string | null;
  iseGiris: string | null;
  onayli: boolean;
  tarih: string | null;
  surum: number | null;
  cihaz: string | null;
  ip: string | null;
  uygulama: string | null;
  sonGorulme: string | null;
}

interface Metin {
  surum: number;
  baslik: string;
  metin: string;
  onayMetni: string;
  yenidenOnay: boolean;
  yayinlayan: string | null;
  yayin: string;
  ozet: string;
}

interface Surum {
  surum: number;
  baslik: string;
  yenidenOnay: boolean;
  aktif: boolean;
  yayinlayan: string | null;
  yayin: string;
  ozet: string;
  onay: number;
}

interface Veri {
  aktif: Metin;
  surumler: Surum[];
  kisiler: Kisi[];
}

/** "1.6" < "1.7" */
const surumKucuk = (a: string | null, b: string) => {
  const x = (a ?? "0").split(".").map((n) => parseInt(n, 10) || 0);
  const y = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

/** Bekleyenin neden göremediği */
const bekleyisNedeni = (k: Kisi) =>
  !k.uygulama ? "Biçen360'ı kullanmıyor" : surumKucuk(k.uygulama, "1.7") ? `Uygulama ${k.uygulama}: güncelleyince görecek` : "Uygulamayı açınca görecek";

const Kutu = ({ ad, deger, alt, renk }: { ad: string; deger: string | number; alt?: string; renk?: string }) => (
  <div className="ay-kutu">
    <div className="ay-kutu-ad">{ad}</div>
    <div className="ay-kutu-deger" style={renk ? { color: renk } : undefined}>
      {deger}
    </div>
    {alt && <div className="ay-kutu-alt">{alt}</div>}
  </div>
);

async function excelIndir(kisiler: Kisi[], m: Metin) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Aydınlatma onayları");
  ws.columns = [
    { header: "Sicil", key: "sicil", width: 10 },
    { header: "Ad soyad", key: "ad", width: 26 },
    { header: "Şube", key: "sube", width: 22 },
    { header: "Görev", key: "gorev", width: 24 },
    { header: "Durum", key: "durum", width: 14 },
    { header: "Onay tarihi", key: "tarih", width: 18 },
    { header: "Metin sürümü", key: "surum", width: 12 },
    { header: "Cihaz", key: "cihaz", width: 22 },
    { header: "Uygulama", key: "uygulama", width: 11 },
    { header: "IP", key: "ip", width: 16 },
    { header: "Not", key: "not", width: 34 },
  ];
  kisiler.forEach((k) =>
    ws.addRow({
      sicil: k.sicil,
      ad: k.ad,
      sube: k.sube ?? "",
      gorev: k.gorev ?? "",
      durum: k.onayli ? "Onayladı" : "Bekliyor",
      tarih: k.tarih ? dayjs(k.tarih).format("DD.MM.YYYY HH:mm") : "",
      surum: k.surum ?? "",
      cihaz: k.cihaz ?? "",
      uygulama: k.uygulama ?? "",
      ip: k.ip ?? "",
      not: k.onayli ? "" : bekleyisNedeni(k),
    })
  );
  const bas = ws.getRow(1);
  bas.font = { bold: true, color: { argb: "FFFFFFFF" } };
  bas.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5F8C10" } };
  ws.autoFilter = { from: "A1", to: "K1" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.eachRow((r, i) => {
    if (i > 1 && r.getCell(5).value === "Bekliyor") r.getCell(5).font = { bold: true, color: { argb: "FFAD4E00" } };
  });

  const bilgi = wb.addWorksheet("Metin");
  bilgi.getColumn(1).width = 120;
  bilgi.addRow([`${m.baslik} · sürüm ${m.surum} · ${dayjs(m.yayin).format("DD.MM.YYYY")} · özet ${m.ozet}`]).font = { bold: true };
  m.metin.split("\n").forEach((s) => (bilgi.addRow([s]).alignment = { wrapText: true }));
  bilgi.addRow([]);
  bilgi.addRow([`Onay cümlesi: ${m.onayMetni}`]).font = { italic: true };

  const buf = await wb.xlsx.writeBuffer();
  dosyaIndir(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `aydinlatma-onaylari-${dayjs().format("YYYY-MM-DD")}.xlsx`);
}

export default function Aydinlatma() {
  const { message } = AntdApp.useApp();
  const [v, setV] = useState<Veri | null>(null);
  const [sekme, setSekme] = useState<"durum" | "metin" | "surumler">("durum");
  const [durum, setDurum] = useState<"tumu" | "onayli" | "bekliyor">("tumu");
  const [sube, setSube] = useState<string | null>(null);
  const [ara, setAra] = useState("");
  const [taslak, setTaslak] = useState<{ baslik: string; metin: string; onayMetni: string; yenidenOnay: boolean } | null>(null);
  const [yayinlaniyor, setYayinlaniyor] = useState(false);
  const [eski, setEski] = useState<Metin | null>(null);

  const getir = useCallback(async () => {
    try {
      const d = await api.al<Veri>("/api/Aydinlatma/Panel");
      setV(d);
      setTaslak({ baslik: d.aktif.baslik, metin: d.aktif.metin, onayMetni: d.aktif.onayMetni, yenidenOnay: false });
    } catch (h: any) {
      message.error(h.message);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const subeler = useMemo(() => [...new Set((v?.kisiler ?? []).map((k) => k.sube).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "tr")), [v]);

  const liste = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return (v?.kisiler ?? []).filter(
      (k) =>
        (durum === "tumu" || (durum === "onayli" ? k.onayli : !k.onayli)) &&
        (!sube || k.sube === sube) &&
        (!q || `${k.ad} ${k.sicil} ${k.gorev ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [v, durum, sube, ara]);

  if (!v || !taslak) return <Spin style={{ display: "block", margin: "60px auto" }} />;

  const onayli = v.kisiler.filter((k) => k.onayli).length;
  const toplam = v.kisiler.length;
  const goremeyen = v.kisiler.filter((k) => !k.onayli && (!k.uygulama || surumKucuk(k.uygulama, "1.7"))).length;
  const degisti = taslak.baslik !== v.aktif.baslik || taslak.metin !== v.aktif.metin || taslak.onayMetni !== v.aktif.onayMetni;

  const yayinla = async () => {
    setYayinlaniyor(true);
    try {
      const c = await api.gonder<{ surum: number }>("/api/Aydinlatma/Panel/Yayinla", taslak);
      message.success(`Sürüm ${c.surum} yayınlandı.`);
      await getir();
      setSekme("surumler");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYayinlaniyor(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{CSS}</style>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Kutu ad="Onaylayan" deger={onayli.toLocaleString("tr-TR")} alt={`${toplam ? Math.round((100 * onayli) / toplam) : 0}% · ${toplam} aktif personel`} renk="#3f6108" />
        <Kutu ad="Bekleyen" deger={(toplam - onayli).toLocaleString("tr-TR")} alt={goremeyen ? `${goremeyen} kişi 1.7'ye güncelleyince görecek` : "uygulamayı açınca görecek"} renk="#ad4e00" />
        <Kutu ad="Yayındaki metin" deger={`Sürüm ${v.aktif.surum}`} alt={`${dayjs(v.aktif.yayin).format("DD.MM.YYYY")} · ${v.aktif.yayinlayan ?? ""}`} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Segmented
          value={sekme}
          onChange={(x) => setSekme(x as any)}
          options={[
            { value: "durum", label: "Onay durumu" },
            { value: "metin", label: "Metni düzenle" },
            { value: "surumler", label: `Sürümler · ${v.surumler.length}` },
          ]}
        />
      </div>

      {sekme === "durum" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Segmented
              size="small"
              value={durum}
              onChange={(x) => setDurum(x as any)}
              options={[
                { value: "tumu", label: `Tümü · ${toplam}` },
                { value: "onayli", label: `Onayladı · ${onayli}` },
                { value: "bekliyor", label: `Bekliyor · ${toplam - onayli}` },
              ]}
            />
            <Select allowClear showSearch placeholder="Şube" style={{ width: 200 }} value={sube} onChange={(x) => setSube(x ?? null)} options={subeler.map((s) => ({ value: s, label: s }))} />
            <Input allowClear prefix={<Search size={14} />} placeholder="Ad, sicil, görev" value={ara} onChange={(e) => setAra(e.target.value)} style={{ width: 220 }} />
            <span style={{ flex: 1 }} />
            <Button icon={<FileSpreadsheet size={14} />} onClick={() => excelIndir(liste, v.aktif).catch((h) => message.error(h.message))}>
              Excel
            </Button>
          </div>
          <Table<Kisi>
            size="small"
            rowKey="sicil"
            dataSource={liste}
            pagination={{ pageSize: 50, showSizeChanger: false, size: "small" }}
            scroll={{ x: 780 }}
            columns={[
              {
                title: "Personel",
                render: (_, k) => (
                  <>
                    <b>{k.ad}</b>
                    <div style={{ fontSize: 12, color: "#8a929b" }}>{[k.sicil, k.gorev].filter(Boolean).join(" · ")}</div>
                  </>
                ),
              },
              { title: "Şube", dataIndex: "sube", width: 180 },
              {
                title: "Durum",
                width: 260,
                render: (_, k) =>
                  k.onayli ? (
                    <>
                      <Tag color="green">Onayladı</Tag>
                      <span style={{ fontSize: 12.5 }}>
                        {dayjs(k.tarih).format("DD.MM.YYYY HH:mm")} · sürüm {k.surum}
                      </span>
                    </>
                  ) : (
                    <>
                      <Tag color="orange">Bekliyor</Tag>
                      <span style={{ fontSize: 12, color: "#8a929b" }}>{bekleyisNedeni(k)}</span>
                    </>
                  ),
              },
              {
                title: "Kayıt",
                width: 210,
                render: (_, k) =>
                  k.onayli ? (
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{[k.cihaz, k.uygulama ? `v${k.uygulama}` : null, k.ip].filter(Boolean).join(" · ")}</span>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        </>
      )}

      {sekme === "metin" && (
        <div className="ay-metin">
          <Alert
            type="warning"
            showIcon
            message="Yayından önce İK ve hukuk birlikte okusun"
            description="Veri sorumlusu unvanı ve başvuru adresi aday aydınlatma metninden alındı; doğruluğunu kontrol edin. Değişiklik yeni bir sürüm olarak yayınlanır, eski sürümleri okuyanların kaydı silinmez."
          />
          <label>
            <span>Başlık</span>
            <Input value={taslak.baslik} maxLength={200} onChange={(e) => setTaslak({ ...taslak, baslik: e.target.value })} />
          </label>
          <label>
            <span>Metin</span>
            <small>"•" ile başlayan satır madde, "1. …" ile başlayan kısa satır bölüm başlığı olarak gösterilir.</small>
            <Input.TextArea value={taslak.metin} autoSize={{ minRows: 14, maxRows: 32 }} onChange={(e) => setTaslak({ ...taslak, metin: e.target.value })} />
          </label>
          <label>
            <span>Onay cümlesi (kutunun yanında)</span>
            <Input.TextArea value={taslak.onayMetni} autoSize={{ minRows: 2, maxRows: 4 }} maxLength={400} onChange={(e) => setTaslak({ ...taslak, onayMetni: e.target.value })} />
          </label>
          <Checkbox checked={taslak.yenidenOnay} onChange={(e) => setTaslak({ ...taslak, yenidenOnay: e.target.checked })}>
            Daha önce onaylayanlar da yeni metni okuyup yeniden onaylasın
          </Checkbox>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Popconfirm
              title={`Sürüm ${v.aktif.surum + 1} yayınlansın mı?`}
              description={taslak.yenidenOnay ? "Bütün personel uygulamayı açınca metni yeniden onaylayacak." : "Yalnızca hiç onaylamamış olanlar yeni metni görecek."}
              okText="Yayınla"
              cancelText="Vazgeç"
              onConfirm={yayinla}
              disabled={!degisti && taslak.yenidenOnay === v.aktif.yenidenOnay}
            >
              <Button type="primary" icon={<ShieldCheck size={14} />} loading={yayinlaniyor} disabled={!degisti && taslak.yenidenOnay === v.aktif.yenidenOnay}>
                Yeni sürüm olarak yayınla
              </Button>
            </Popconfirm>
            <Button disabled={!degisti} onClick={() => setTaslak({ baslik: v.aktif.baslik, metin: v.aktif.metin, onayMetni: v.aktif.onayMetni, yenidenOnay: false })}>
              Değişiklikleri geri al
            </Button>
          </div>
        </div>
      )}

      {sekme === "surumler" &&
        (v.surumler.length === 0 ? (
          <Empty />
        ) : (
          <Table<Surum>
            size="small"
            rowKey="surum"
            dataSource={v.surumler}
            pagination={false}
            scroll={{ x: 640 }}
            columns={[
              { title: "Sürüm", width: 80, render: (_, s) => <b>{s.surum}{s.aktif ? <Tag color="green" style={{ marginLeft: 6 }}>Yayında</Tag> : null}</b> },
              { title: "Yayın", width: 150, render: (_, s) => dayjs(s.yayin).format("DD.MM.YYYY HH:mm") },
              { title: "Yayınlayan", dataIndex: "yayinlayan" },
              { title: "Onay", dataIndex: "onay", width: 80, align: "right" },
              { title: "", width: 150, render: (_, s) => (s.yenidenOnay ? <Tag>Herkes yeniden onayladı</Tag> : null) },
              {
                title: "",
                width: 100,
                render: (_, s) => (
                  <Button size="small" onClick={() => api.al<Metin>(`/api/Aydinlatma/Panel/Surum/${s.surum}`).then(setEski).catch((h: any) => message.error(h.message))}>
                    Metni gör
                  </Button>
                ),
              },
            ]}
          />
        ))}

      <Modal open={!!eski} title={eski ? `Sürüm ${eski.surum} · ${eski.baslik}` : ""} onCancel={() => setEski(null)} footer={null} width={760}>
        {eski && (
          <>
            <div style={{ fontSize: 12, color: "#8a929b", marginBottom: 8 }}>
              {dayjs(eski.yayin).format("DD.MM.YYYY HH:mm")} · {eski.yayinlayan} · özet <code>{eski.ozet.slice(0, 16)}…</code>
            </div>
            <div className="ay-onizleme">{eski.metin}</div>
            <p style={{ marginTop: 10, fontStyle: "italic" }}>{eski.onayMetni}</p>
          </>
        )}
      </Modal>
    </div>
  );
}

const CSS = `
.ay-kutu{flex:1 1 200px;background:#fff;border:1px solid #eceee8;border-radius:12px;padding:12px 14px}
.ay-kutu-ad{font-size:12px;color:#6b7280;font-weight:600}
.ay-kutu-deger{font-size:24px;font-weight:800;color:#1f4d2b;line-height:1.3}
.ay-kutu-alt{font-size:11.5px;color:#8a929b}
.ay-metin{display:flex;flex-direction:column;gap:14px;max-width:880px;background:#fff;border:1px solid #eceee8;border-radius:14px;padding:18px}
.ay-metin>label{display:flex;flex-direction:column;gap:4px}
.ay-metin>label>span{font-weight:700;font-size:13px}
.ay-metin small{color:#8a929b;font-size:12px}
.ay-onizleme{white-space:pre-wrap;font-size:13px;line-height:1.55;max-height:60vh;overflow:auto;background:#fafbf8;border-radius:10px;padding:12px}
`;
