/**
 * Devamsızlık takibi (23.10.2026) · Personel Talepleri › Devamsızlık
 * ---------------------------------------------------------------------------
 * Birim yöneticileri Biçen360'tan vardiya girişi olmayan güne devamsızlık
 * giriyor. Burada dönemde eşikten (Ayarlar Merkezi, varsayılan 3) fazla gün
 * devamsızlığı olanlar öne çıkıyor. İK seçtiği personele uygulama bildirimi
 * ve/veya SMS gönderir, not düşer ("görüşüldü") ya da yanlış girilen günü
 * kaldırır. Uçlar: /api/Devamsizlik.
 *
 * 26.10.2026: her girişte tutanak (açıklama + iki şahit) üretiliyor. Kişi
 * ayrıntısında tutanaklar, imzalı belge ve şahit onay durumları; tutanak
 * yazdırma, imzalı belgeyi açma ve maili yeniden gönderme.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, App as AntdApp, Button, Checkbox, DatePicker, Drawer, Empty, Input, Modal, Space, Switch, Table, Tag, Timeline, Tooltip,
} from "antd";
import { BellRing, FileSignature, MessageSquareText, NotebookPen, Printer, RefreshCw, Send, Trash2 } from "lucide-react";
import dayjs, { Dayjs } from "dayjs";
import { api } from "./api";
import { sekmedeAc } from "./sekmedeAc";

interface TutanakOzet { toplam: number; belgeBekleyen: number; sahitBekleyen: number; itiraz: number }
interface Sahit { sira: number; kod: string; adSoyad: string; pozisyon: string; durum: string; tarih: string | null; not: string | null }
interface Tutanak {
  id: number; no: string; adSoyad: string; tarihler: string; aciklama: string; girenAd: string; girenPozisyon: string;
  sahitler: Sahit[]; formEposta: string | null; formGonderim: string | null; formHata: string | null;
  belgeVar: boolean; belgeTarihi: string | null; belgeYukleyen: string | null; durum: string; durumAdi: string; olusturma: string;
}
const TUTANAK_RENK: Record<string, string> = { belge: "orange", sahit: "blue", itiraz: "red", tamam: "green" };
const SAHIT_DURUM: Record<string, [string, string]> = { bekliyor: ["Bekliyor", "orange"], onayladi: ["Onayladı", "green"], reddetti: ["Onaylamadı", "red"] };

interface Satir {
  tutanak?: TutanakOzet;
  kod: string; adSoyad: string; sube: string; pozisyon: string; telefonVar: boolean; ayrildi: boolean;
  gun: number; esikUstu: boolean; ardisik: number; tarihler: string[]; girenler: string[];
  sonGiris: string; sonBildirim: string | null; sonBildirimYapan: string | null; sonNot: string | null; sonNotTur: string | null;
}
interface Veri { bas: string; bit: string; esik: number; smsEtkin: boolean; metin: string; toplamKisi: number; esikUstu: number; kayitlar: Satir[] }

const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const kisaGun = (s: string) => {
  const d = dayjs(s);
  return `${d.date()} ${AY[d.month()]}`;
};

export default function DevamsizlikTakibi({ sayacDegisti }: { sayacDegisti?: (n: number) => void }) {
  const { message } = AntdApp.useApp();
  const [aralik, setAralik] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(29, "day"), dayjs()]);
  const [tumu, setTumu] = useState(false);
  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState<string[]>([]);
  const [bildirAcik, setBildirAcik] = useState(false);
  const [detay, setDetay] = useState<Satir | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const d = await api.al<Veri>(
        `/api/Devamsizlik/Liste?bas=${aralik[0].format("YYYY-MM-DD")}&bit=${aralik[1].format("YYYY-MM-DD")}&tumu=${tumu}`
      );
      setVeri(d);
      sayacDegisti?.(d.esikUstu);
      setSecili((s) => s.filter((k) => d.kayitlar.some((x) => x.kod === k)));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [aralik, tumu, message, sayacDegisti]);

  useEffect(() => {
    getir();
  }, [getir]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Alert
        type="info"
        showIcon
        message={`Birim yöneticileri Biçen360'tan vardiya girişi olmayan güne devamsızlık giriyor. Dönemde ${veri?.esik ?? 3} günden fazla devamsızlığı olanlar listede; "Tümünü göster" ile herkes görünür.`}
      />

      <Space wrap>
        <DatePicker.RangePicker
          value={aralik}
          format="DD.MM.YYYY"
          allowClear={false}
          onChange={(v) => v?.[0] && v?.[1] && setAralik([v[0], v[1]])}
          presets={[
            { label: "Son 30 gün", value: [dayjs().subtract(29, "day"), dayjs()] },
            { label: "Bu ay", value: [dayjs().startOf("month"), dayjs()] },
            { label: "Geçen ay", value: [dayjs().subtract(1, "month").startOf("month"), dayjs().subtract(1, "month").endOf("month")] },
          ]}
        />
        <span>
          <Switch size="small" checked={tumu} onChange={setTumu} /> Tümünü göster
        </span>
        <Button icon={<RefreshCw size={14} />} onClick={getir} loading={yukleniyor}>Yenile</Button>
        <Button type="primary" icon={<BellRing size={15} />} disabled={secili.length === 0} onClick={() => setBildirAcik(true)}>
          Seçilenlere bildirim / SMS ({secili.length})
        </Button>
        {veri && (
          <Tag color={veri.esikUstu > 0 ? "red" : "green"} style={{ fontSize: 13, padding: "3px 10px" }}>
            {veri.esikUstu} kişi {veri.esik} günden fazla · dönemde toplam {veri.toplamKisi} kişi
          </Tag>
        )}
      </Space>

      <Table<Satir>
        rowKey="kod"
        size="middle"
        loading={yukleniyor}
        dataSource={veri?.kayitlar ?? []}
        rowSelection={{ selectedRowKeys: secili, onChange: (k) => setSecili(k as string[]) }}
        pagination={{ pageSize: 25, showSizeChanger: false }}
        scroll={{ x: 1000 }}
        locale={{ emptyText: <Empty description={tumu ? "Dönemde devamsızlık girilmemiş" : `Dönemde ${veri?.esik ?? 3} günden fazla devamsızlığı olan yok`} /> }}
        onRow={(r) => ({ onClick: (e) => { if ((e.target as HTMLElement).closest(".ant-checkbox-wrapper,button")) return; setDetay(r); }, style: { cursor: "pointer" } })}
        columns={[
          {
            title: "Personel",
            render: (_, r) => (
              <div>
                <b>{r.adSoyad}</b> {r.ayrildi && <Tag color="default">Ayrıldı</Tag>}
                <div style={{ color: "#6b7280", fontSize: 12.5 }}>{[r.pozisyon, r.sube].filter(Boolean).join(" · ")}</div>
              </div>
            ),
          },
          {
            title: "Gün",
            dataIndex: "gun",
            width: 90,
            align: "center",
            sorter: (a, b) => a.gun - b.gun,
            render: (v, r) => <Tag color={r.esikUstu ? "red" : "orange"} style={{ fontWeight: 800, fontSize: 13 }}>{v} gün</Tag>,
          },
          {
            title: "Devamsız günler",
            render: (_, r) => (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {r.tarihler.map((t) => <Tag key={t} style={{ margin: 0 }}>{kisaGun(t)}</Tag>)}
                {r.ardisik >= 2 && <Tag color="volcano" style={{ margin: 0 }}>{r.ardisik} gün art arda</Tag>}
              </div>
            ),
          },
          { title: "Giren", width: 160, render: (_, r) => <small>{r.girenler.join(", ") || "—"}</small> },
          {
            title: "Tutanak",
            width: 150,
            render: (_, r) => {
              const t = r.tutanak;
              if (!t || !t.toplam) return <span style={{ color: "#9aa3af" }}>—</span>;
              return (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {t.itiraz > 0 && <Tag color="red" style={{ margin: 0 }}>{t.itiraz} itiraz</Tag>}
                  {t.belgeBekleyen > 0 && <Tag color="orange" style={{ margin: 0 }}>{t.belgeBekleyen} imza bekliyor</Tag>}
                  {t.sahitBekleyen > 0 && <Tag color="blue" style={{ margin: 0 }}>{t.sahitBekleyen} şahit bekliyor</Tag>}
                  {t.itiraz + t.belgeBekleyen + t.sahitBekleyen === 0 && <Tag color="green" style={{ margin: 0 }}>{t.toplam} tamam</Tag>}
                </div>
              );
            },
          },
          {
            title: "İK işlemi",
            width: 190,
            render: (_, r) => (
              <div style={{ fontSize: 12.5 }}>
                {r.sonBildirim ? (
                  <div style={{ color: "#3f6f0c" }}>✓ Bildirildi {dayjs(r.sonBildirim).format("DD.MM HH:mm")}</div>
                ) : (
                  <div style={{ color: "#b42318" }}>Bildirim gönderilmedi</div>
                )}
                {r.sonNot && <div style={{ color: "#6b7280" }}>{r.sonNotTur === "gorusuldu" ? "Görüşüldü" : "Not"} {dayjs(r.sonNot).format("DD.MM")}</div>}
              </div>
            ),
          },
          {
            title: "",
            width: 110,
            render: (_, r) => (
              <Button size="small" icon={<BellRing size={13} />} onClick={() => { setSecili([r.kod]); setBildirAcik(true); }}>
                Bildir
              </Button>
            ),
          },
        ]}
      />

      <BildirPenceresi
        acik={bildirAcik}
        kisiler={(veri?.kayitlar ?? []).filter((x) => secili.includes(x.kod))}
        veri={veri}
        aralik={aralik}
        kapat={() => setBildirAcik(false)}
        bitti={() => { setBildirAcik(false); getir(); }}
      />

      <KisiDetay satir={detay} aralik={aralik} kapat={() => setDetay(null)} degisti={getir} bildir={(k) => { setSecili([k]); setBildirAcik(true); }} />
    </div>
  );
}

function BildirPenceresi({ acik, kisiler, veri, aralik, kapat, bitti }: {
  acik: boolean; kisiler: Satir[]; veri: Veri | null; aralik: [Dayjs, Dayjs]; kapat: () => void; bitti: () => void;
}) {
  const { message, modal } = AntdApp.useApp();
  const [uygulama, setUygulama] = useState(true);
  const [sms, setSms] = useState(false);
  const [metin, setMetin] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    if (acik) {
      setMetin(veri?.metin ?? "");
      setUygulama(true);
      setSms(false);
    }
  }, [acik, veri]);

  const ornek = useMemo(() => {
    const k = kisiler[0];
    if (!k) return "";
    const tarihler = k.tarihler.map((t) => dayjs(t).format("D MMMM")).join(", ");
    return metin.replace("{ad}", k.adSoyad).replace("{tarihler}", tarihler);
  }, [metin, kisiler]);

  const gonder = async () => {
    setIsleniyor(true);
    try {
      const d = await api.gonder<any>("/api/Devamsizlik/Bildir", {
        kodlar: kisiler.map((k) => k.kod),
        bas: aralik[0].format("YYYY-MM-DD"),
        bit: aralik[1].format("YYYY-MM-DD"),
        uygulama,
        sms,
        metin,
      });
      const hatali = (d.sonuclar ?? []).filter((x: any) => x.hata);
      if (hatali.length)
        modal.warning({
          title: `${d.uygulama} uygulama bildirimi, ${d.sms} SMS gönderildi`,
          content: (
            <ul style={{ paddingLeft: 18 }}>
              {hatali.map((x: any) => <li key={x.kod}>{x.adSoyad}: {x.hata}</li>)}
            </ul>
          ),
        });
      else message.success(`${d.uygulama} uygulama bildirimi${sms ? `, ${d.sms} SMS` : ""} gönderildi`);
      bitti();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  return (
    <Modal
      open={acik}
      title={`Devamsızlık bildirimi · ${kisiler.length} kişi`}
      onCancel={kapat}
      onOk={gonder}
      okText="Gönder"
      cancelText="Vazgeç"
      confirmLoading={isleniyor}
      okButtonProps={{ disabled: !uygulama && !sms }}
      width={600}
    >
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        <Space wrap>
          <Checkbox checked={uygulama} onChange={(e) => setUygulama(e.target.checked)}>Biçen360 bildirimi (duyurularda da durur)</Checkbox>
          <Tooltip title={veri?.smsEtkin ? undefined : "SMS servisi kapalı"}>
            <Checkbox checked={sms} disabled={!veri?.smsEtkin} onChange={(e) => setSms(e.target.checked)}>SMS</Checkbox>
          </Tooltip>
        </Space>
        <div>
          <b style={{ fontSize: 12.5, color: "#6b7280" }}>METİN · {"{ad}"} ve {"{tarihler}"} kişiye göre doldurulur</b>
          <Input.TextArea value={metin} onChange={(e) => setMetin(e.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} maxLength={600} showCount />
        </div>
        {ornek && (
          <div style={{ background: "#f4f6f2", borderRadius: 12, padding: 12, fontSize: 13.5 }}>
            <b style={{ fontSize: 12, color: "#6b7280" }}>ÖRNEK · {kisiler[0]?.adSoyad}</b>
            <div style={{ marginTop: 4 }}>{ornek}</div>
          </div>
        )}
        {sms && kisiler.some((k) => !k.telefonVar) && (
          <Alert type="warning" showIcon message={`${kisiler.filter((k) => !k.telefonVar).length} kişinin telefonu kayıtlı değil; onlara yalnızca uygulama bildirimi gider.`} />
        )}
      </div>
    </Modal>
  );
}

function KisiDetay({ satir, aralik, kapat, degisti, bildir }: {
  satir: Satir | null; aralik: [Dayjs, Dayjs]; kapat: () => void; degisti: () => void; bildir: (kod: string) => void;
}) {
  const { message, modal } = AntdApp.useApp();
  const [veri, setVeri] = useState<{ kayitlar: any[]; islemler: any[]; tutanaklar?: Tutanak[] } | null>(null);
  const [not, setNot] = useState("");

  const getir = useCallback(() => {
    if (!satir) return;
    api
      .al<any>(`/api/Devamsizlik/Kisi/${encodeURIComponent(satir.kod)}?bas=${aralik[0].subtract(60, "day").format("YYYY-MM-DD")}&bit=${aralik[1].format("YYYY-MM-DD")}`)
      .then(setVeri)
      .catch((h) => message.error(h.message));
  }, [satir, aralik, message]);

  useEffect(() => {
    setVeri(null);
    setNot("");
    getir();
  }, [getir]);

  const notYaz = async (tur: "not" | "gorusuldu") => {
    if (!satir) return;
    const m = tur === "gorusuldu" && !not.trim() ? "Personelle görüşüldü." : not.trim();
    if (m.length < 2) return message.warning("Not yazınız.");
    await api.gonder("/api/Devamsizlik/Not", { kod: satir.kod, tur, metin: m });
    setNot("");
    getir();
    degisti();
  };

  const kaldir = (k: any) => {
    let neden = "";
    modal.confirm({
      title: `${dayjs(k.tarih).format("DD.MM.YYYY")} devamsızlığı kaldırılsın mı?`,
      content: <Input.TextArea placeholder="Sebep (ör. izinliydi, yanlış girilmiş)" onChange={(e) => (neden = e.target.value)} />,
      okText: "Kaldır",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        await api.gonder(`/api/Devamsizlik/${k.id}/Iptal`, { not: neden });
        getir();
        degisti();
      },
    });
  };

  const TUR: Record<string, [string, string]> = {
    bildirim: ["Biçen360 bildirimi", "green"], sms: ["SMS", "blue"], not: ["Not", "gray"],
    gorusuldu: ["Görüşüldü", "purple"], kaldirildi: ["Gün kaldırıldı", "red"], hata: ["Gönderilemedi", "red"],
    sahitonay: ["Şahit onayladı", "green"], sahitred: ["Şahit onaylamadı", "red"], tutanakbelge: ["İmzalı tutanak yüklendi", "green"],
  };

  /* Tutanak (26.10.2026) */
  const tutanakAc = (t: Tutanak) => sekmedeAc(`/api/Devamsizlik/Tutanak/${t.id}/Form?html=true`).catch((h: any) => message.error(h.message));
  const imzaliAc = (t: Tutanak) => sekmedeAc(`/api/Devamsizlik/Tutanak/${t.id}/ImzaliForm`).catch((h: any) => message.error(h.message));
  const yenidenGonder = async (t: Tutanak) => {
    try {
      const d = await api.gonder<any>(`/api/Devamsizlik/Tutanak/${t.id}/YenidenGonder`, {});
      message.success(`Tutanak gönderildi: ${d.adres}`);
      if (d.uyari) message.warning(d.uyari);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  return (
    <Drawer open={!!satir} onClose={kapat} width={520} title={satir ? `${satir.adSoyad} · devamsızlık` : ""}
      extra={satir && <Button type="primary" icon={<BellRing size={14} />} onClick={() => bildir(satir.kod)}>Bildir</Button>}>
      {satir && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ color: "#6b7280" }}>{[satir.pozisyon, satir.sube].filter(Boolean).join(" · ")}</div>
          <div>
            <b>Devamsız günler (son 90 gün)</b>
            <Table
              size="small"
              rowKey="id"
              style={{ marginTop: 8 }}
              pagination={false}
              dataSource={veri?.kayitlar ?? []}
              loading={!veri}
              columns={[
                { title: "Tarih", dataIndex: "tarih", render: (v) => dayjs(v).format("DD.MM.YYYY ddd") },
                { title: "Giren", dataIndex: "giren" },
                { title: "Not", dataIndex: "aciklama", render: (v) => v || "—" },
                {
                  title: "Tutanak", width: 110, dataIndex: "tutanakId",
                  render: (v) => {
                    const t = (veri?.tutanaklar ?? []).find((x) => x.id === v);
                    return t ? <Tag color={TUTANAK_RENK[t.durum] ?? "default"} style={{ margin: 0 }}>{t.durumAdi}</Tag> : <span style={{ color: "#9aa3af" }}>Tutanaksız</span>;
                  },
                },
                { title: "", width: 40, render: (_, k) => <Tooltip title="Kaldır"><Button size="small" type="text" danger icon={<Trash2 size={14} />} onClick={() => kaldir(k)} /></Tooltip> },
              ]}
            />
          </div>
          <div>
            <b>Tutanaklar</b>
            {veri?.tutanaklar?.length ? (
              <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                {veri.tutanaklar.map((t) => (
                  <div key={t.id} style={{ border: "1px solid #e3e6e1", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <b>{t.tarihler}</b> <Tag color={TUTANAK_RENK[t.durum] ?? "default"} style={{ marginLeft: 6 }}>{t.durumAdi}</Tag>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>{t.no} · {dayjs(t.olusturma).format("DD.MM.YYYY HH:mm")} · giren: {t.girenAd}</div>
                      </div>
                      <Space size={4}>
                        <Tooltip title="Tutanağı yazdır"><Button size="small" icon={<Printer size={13} />} onClick={() => tutanakAc(t)} /></Tooltip>
                        <Tooltip title={t.belgeVar ? `İmzalı tutanak · ${t.belgeYukleyen ?? ""} ${t.belgeTarihi ? dayjs(t.belgeTarihi).format("DD.MM HH:mm") : ""}` : "İmzalı tutanak henüz yüklenmedi"}>
                          <Button size="small" icon={<FileSignature size={13} />} disabled={!t.belgeVar} onClick={() => imzaliAc(t)} />
                        </Tooltip>
                        <Tooltip title={t.formGonderim ? `Mail gitti: ${t.formEposta} · ${dayjs(t.formGonderim).format("DD.MM HH:mm")}` : `Mail gönderilemedi${t.formHata ? `: ${t.formHata}` : ""}`}>
                          <Button size="small" icon={<Send size={13} />} danger={!t.formGonderim} onClick={() => yenidenGonder(t)} />
                        </Tooltip>
                      </Space>
                    </div>
                    <div style={{ marginTop: 6 }}>{t.aciklama}</div>
                    <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {t.sahitler.map((sh) => (
                        <span key={sh.sira} style={{ fontSize: 12.5 }}>
                          {sh.sira}. şahit <b>{sh.adSoyad}</b> <Tag color={SAHIT_DURUM[sh.durum]?.[1] ?? "default"} style={{ marginLeft: 4 }}>{SAHIT_DURUM[sh.durum]?.[0] ?? sh.durum}</Tag>
                          {sh.not && <span style={{ color: "#b42318" }}>"{sh.not}"</span>}
                        </span>
                      ))}
                    </div>
                    {!t.formGonderim && t.formHata && <div style={{ color: "#b42318", fontSize: 12, marginTop: 4 }}>{t.formHata}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#9aa3af", marginTop: 6 }}>Tutanak yok (26.10.2026 öncesi girişler tutanaksız)</div>
            )}
          </div>
          <div>
            <b>İK notu</b>
            <Input.TextArea value={not} onChange={(e) => setNot(e.target.value)} placeholder="Ör. personel aradı, ailevi sebep; belge getirecek" autoSize={{ minRows: 2 }} style={{ marginTop: 6 }} />
            <Space style={{ marginTop: 8 }}>
              <Button icon={<MessageSquareText size={14} />} onClick={() => notYaz("gorusuldu")}>Görüşüldü</Button>
              <Button icon={<NotebookPen size={14} />} onClick={() => notYaz("not")}>Not ekle</Button>
            </Space>
          </div>
          <div>
            <b>Geçmiş</b>
            {veri?.islemler?.length ? (
              <Timeline
                style={{ marginTop: 12 }}
                items={veri.islemler.map((x: any) => ({
                  color: TUR[x.tur]?.[1] ?? "gray",
                  children: (
                    <div>
                      <b>{TUR[x.tur]?.[0] ?? x.tur}</b> · {dayjs(x.olusturma).format("DD.MM.YYYY HH:mm")} · {x.yapan}
                      {x.tarihler && <div style={{ color: "#6b7280", fontSize: 12.5 }}>{x.tarihler}</div>}
                      {x.metin && <div style={{ fontSize: 13 }}>{x.metin}</div>}
                      {x.sonuc && <div style={{ color: "#b42318", fontSize: 12.5 }}>{x.sonuc}</div>}
                    </div>
                  ),
                }))}
              />
            ) : (
              <div style={{ color: "#9aa3af", marginTop: 6 }}>Henüz işlem yok</div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
