/**
 * Yönetim › Fazla mesai ücret kuralları (15.10.2026)
 * ---------------------------------------------------------------------------
 * Fazla mesainin karşılığı gün türüne göre: normal gün, hafta tatili,
 * resmi tatil, arife. Her kural: kapsam (tüm personel / iş yeri / pozisyon /
 * belirli kişi) → ücret ya da serbest zaman (izin) ve çarpan (1, 1,5, 2…).
 * En özel kural uygulanır: kişi > pozisyon > iş yeri > genel.
 *
 * Ücret = aylık ücret ÷ aylık saat (225) × çarpan × saat
 * Serbest zaman = saat × çarpan
 * Resmi tatiller İzin Yönetimi'ndeki resmi tatil takviminden; haftalık
 * izin günü vardiya planından (yoksa sabit izin günü / pozisyon grubu).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import dayjs, { Dayjs } from "dayjs";

import { api } from "./api";

interface Kural {
  id: number;
  sira: number;
  ad: string | null;
  isYeri: string;
  pozisyon: string;
  sicil: string | null;
  gunTuru: string;
  karsilik: "ucret" | "izin";
  carpan: number;
  aktif: boolean;
}

interface Veri {
  yazabilir: boolean;
  kurallar: Kural[];
  gunTurleri: { kod: string; ad: string }[];
  pozisyonlar: string[];
  isYerleri: string[];
  kisiAdlari: Record<string, string | null>;
  aylikSaat: number;
  varsayilanYuzde: number;
}

interface Kisi {
  sicil: string;
  ad: string;
  pozisyon?: string | null;
  sube?: string | null;
}

const HEPSI = "*";
const hepsiMi = (s?: string | null) => !s || s.trim() === HEPSI;
const CARPANLAR = [1, 1.25, 1.5, 2, 2.5, 3];
const carpanYaz = (c: number) => `×${c.toLocaleString("tr-TR")}`;

function KisiSec({ deger, sec, yer }: { deger?: string | null; sec: (k: Kisi | null) => void; yer: string }) {
  const [secenek, setSecenek] = useState<Kisi[]>([]);
  return (
    <Select
      showSearch
      allowClear
      value={deger || null}
      style={{ width: "100%" }}
      placeholder={yer}
      filterOption={false}
      suffixIcon={<Search size={14} />}
      onSearch={async (q) => {
        if (q.trim().length < 2) return;
        try {
          setSecenek(await api.al<Kisi[]>(`/api/EkibimKural/KisiAra?q=${encodeURIComponent(q)}`));
        } catch {
          setSecenek([]);
        }
      }}
      onChange={(s) => sec(secenek.find((k) => k.sicil === s) ?? null)}
      options={[
        ...(deger && !secenek.some((k) => k.sicil === deger) ? [{ value: deger, label: `sicil ${deger}` }] : []),
        ...secenek.map((k) => ({ value: k.sicil, label: [k.ad, k.pozisyon, k.sube].filter(Boolean).join(" · ") })),
      ]}
    />
  );
}

export default function FazlaMesaiUcretKurallari() {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [d, setD] = useState<Partial<Kural> | null>(null);
  const [kapsam, setKapsam] = useState<"genel" | "isyeri" | "pozisyon" | "kisi">("genel");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const [denePersonel, setDenePersonel] = useState<Kisi | null>(null);
  const [deneTarih, setDeneTarih] = useState<Dayjs | null>(dayjs());
  const [deneSaat, setDeneSaat] = useState<number>(2);
  const [deneSonuc, setDeneSonuc] = useState<any>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<Veri>("/api/FazlaMesaiUcretKural"));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const ac = (k?: Kural) => {
    setD(k ?? { gunTuru: "normal", karsilik: "ucret", carpan: 1.5, aktif: true, isYeri: HEPSI, pozisyon: HEPSI, sicil: null });
    setKapsam(!k ? "genel" : k.sicil ? "kisi" : !hepsiMi(k.pozisyon) ? "pozisyon" : !hepsiMi(k.isYeri) ? "isyeri" : "genel");
  };

  const degis = (p: Partial<Kural>) => setD((o) => ({ ...(o ?? {}), ...p }));

  const kaydet = async () => {
    if (!d) return;
    if (kapsam === "kisi" && !d.sicil) return message.warning("Kişiyi seçiniz.");
    if (kapsam === "pozisyon" && hepsiMi(d.pozisyon)) return message.warning("Pozisyonu yazınız.");
    if (kapsam === "isyeri" && hepsiMi(d.isYeri)) return message.warning("İş yerini yazınız.");
    setKaydediliyor(true);
    try {
      await api.gonder("/api/FazlaMesaiUcretKural", {
        id: d.id ?? 0,
        ad: d.ad ?? "",
        isYeri: kapsam === "isyeri" || kapsam === "pozisyon" ? d.isYeri ?? HEPSI : HEPSI,
        pozisyon: kapsam === "pozisyon" ? d.pozisyon ?? HEPSI : HEPSI,
        sicil: kapsam === "kisi" ? d.sicil : null,
        gunTuru: d.gunTuru ?? HEPSI,
        karsilik: d.karsilik ?? "ucret",
        carpan: d.carpan ?? 1.5,
        aktif: d.aktif ?? true,
      });
      message.success("Kural kaydedildi; hesaplar hemen bu kurala göre yapılır.");
      setD(null);
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const sil = async (k: Kural) => {
    try {
      await api.sil(`/api/FazlaMesaiUcretKural/${k.id}`);
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const dene = async () => {
    if (!denePersonel || !deneTarih) return;
    try {
      setDeneSonuc(
        await api.al<any>(
          `/api/FazlaMesaiUcretKural/Dene?personel=${encodeURIComponent(denePersonel.sicil)}&tarih=${deneTarih.format("YYYY-MM-DD")}&saat=${deneSaat}`
        )
      );
    } catch (h: any) {
      setDeneSonuc(null);
      message.error(h.message);
    }
  };

  if (!veri) return yukleniyor ? <Typography.Text type="secondary">Yükleniyor…</Typography.Text> : null;

  const gunAdi = (k: string) => (hepsiMi(k) ? "Her gün türü" : veri.gunTurleri.find((x) => x.kod === k)?.ad ?? k);
  const kapsamYaz = (k: Kural) =>
    k.sicil
      ? `${veri.kisiAdlari[k.sicil] ?? "Kişi"} · ${k.sicil}`
      : [hepsiMi(k.isYeri) ? null : k.isYeri, hepsiMi(k.pozisyon) ? null : k.pozisyon].filter(Boolean).join(" · ") || "Tüm personel";
  const filtre = (g: string, o?: { value?: unknown }) => String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Alert
        type="info"
        showIcon
        message="Her fazla mesainin karşılığı gününe göre bu kurallardan hesaplanır."
        description={
          <>
            Ücret = aylık ücret ÷ {veri.aylikSaat} saat × çarpan × fazla mesai saati. Serbest zaman = saat × çarpan. Bir kayda en
            özel kural uygulanır: <b>kişiye özel</b> → <b>pozisyon</b> → <b>iş yeri</b> → <b>tüm personel</b>. Hiçbir kural
            tutmazsa ücret ×{(veri.varsayilanYuzde / 100).toLocaleString("tr-TR")}. Resmi tatiller İzin Yönetimi'ndeki takvimden,
            haftalık izin günü vardiya planından (yoksa sabit izin günü / pozisyon grubu) bulunur.
          </>
        }
      />

      <Space wrap>
        <Button type="primary" icon={<Plus size={15} />} disabled={!veri.yazabilir} onClick={() => ac()}>
          Yeni kural
        </Button>
        {!veri.yazabilir && <Typography.Text type="secondary">Değiştirme yetkisi Admin, GMY ve İK yöneticisinde.</Typography.Text>}
      </Space>

      <Table<Kural>
        rowKey="id"
        size="small"
        loading={yukleniyor}
        dataSource={veri.kurallar}
        pagination={false}
        scroll={{ x: 760 }}
        columns={[
          {
            title: "Kapsam",
            render: (_: unknown, k) => (
              <div>
                {k.ad && <b style={{ display: "block", fontWeight: 600 }}>{k.ad}</b>}
                <span style={{ fontSize: 12.5 }}>{kapsamYaz(k)}</span>
                {k.sicil && <Tag color="purple" style={{ marginLeft: 6 }}>Kişiye özel</Tag>}
                {!k.aktif && <Tag style={{ marginLeft: 6 }}>Pasif</Tag>}
              </div>
            ),
          },
          { title: "Gün", key: "gun", width: 170, render: (_: unknown, k) => gunAdi(k.gunTuru) },
          {
            title: "Karşılık",
            key: "karsilik",
            width: 190,
            render: (_: unknown, k) =>
              k.karsilik === "izin" ? (
                <Tag color="blue">Serbest zaman {carpanYaz(k.carpan)}</Tag>
              ) : (
                <Tag color="green">Ücret {carpanYaz(k.carpan)}</Tag>
              ),
          },
          {
            title: "",
            width: 80,
            render: (_: unknown, k) =>
              veri.yazabilir && (
                <Space size={2}>
                  <Button type="text" size="small" icon={<Pencil size={14} />} onClick={() => ac(k)} />
                  <Popconfirm title="Kural silinsin mi?" okText="Sil" cancelText="Vazgeç" onConfirm={() => sil(k)}>
                    <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
                  </Popconfirm>
                </Space>
              ),
          },
        ]}
      />

      {/* ---------------------------------------------------------- dene */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <b>Dene: bu personel bu gün fazla mesai yaparsa</b>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
          <KisiSec deger={denePersonel?.sicil} sec={setDenePersonel} yer="Personel" />
          <DatePicker value={deneTarih} onChange={setDeneTarih} format="DD.MM.YYYY" allowClear={false} />
          <InputNumber value={deneSaat} min={0.25} max={24} step={0.5} addonAfter="saat" onChange={(v) => setDeneSaat(Number(v ?? 1))} />
          <Button onClick={dene} disabled={!denePersonel}>
            Dene
          </Button>
        </div>
        {deneSonuc && (
          <Alert
            type="success"
            showIcon
            message={
              <>
                {dayjs(deneSonuc.tarih).format("DD.MM.YYYY dddd")} · <b>{deneSonuc.gunTuru}</b>
                {deneSonuc.tatil ? ` (${deneSonuc.tatil})` : ""} →{" "}
                {deneSonuc.karsilik === "izin" ? (
                  <b>
                    serbest zaman {carpanYaz(deneSonuc.carpan)}: {Math.round((deneSonuc.izinDk / 60) * 100) / 100} saat izin
                  </b>
                ) : (
                  <b>ücret {carpanYaz(deneSonuc.carpan)}</b>
                )}
              </>
            }
            description={`${deneSonuc.personel.ad} · ${deneSonuc.personel.pozisyon ?? ""} · ${deneSonuc.personel.birim ?? ""} — uygulanan kural: ${deneSonuc.kural}`}
          />
        )}
      </div>

      {/* --------------------------------------------------------- düzenle */}
      <Modal
        open={!!d}
        onCancel={() => setD(null)}
        onOk={kaydet}
        okText="Kaydet"
        cancelText="Vazgeç"
        confirmLoading={kaydediliyor}
        title={d?.id ? "Kuralı düzenle" : "Yeni ücret kuralı"}
        width="min(620px, 100vw)"
        destroyOnHidden
      >
        {d && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label>
              <b>Kural adı</b> <small style={{ color: "#8a929b" }}>(isteğe bağlı)</small>
              <Input value={d.ad ?? ""} maxLength={150} placeholder="Örn. Depo · resmi tatil" onChange={(e) => degis({ ad: e.target.value })} />
            </label>

            <div>
              <b>Kimlere uygulanır</b>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                <Segmented
                  value={kapsam}
                  onChange={(x) => setKapsam(x as typeof kapsam)}
                  options={[
                    { value: "genel", label: "Tüm personel" },
                    { value: "isyeri", label: "İş yeri" },
                    { value: "pozisyon", label: "Pozisyon" },
                    { value: "kisi", label: "Kişiye özel" },
                  ]}
                />
                {(kapsam === "isyeri" || kapsam === "pozisyon") && (
                  <AutoComplete
                    value={hepsiMi(d.isYeri) ? "" : d.isYeri}
                    options={veri.isYerleri.map((y) => ({ value: y }))}
                    filterOption={filtre}
                    placeholder={kapsam === "pozisyon" ? "İş yeri (boş: tüm iş yerleri)" : "Örn. ŞUBE, Z.MERKEZ BURO, AKÇABURGAZ DEPO"}
                    onChange={(x) => degis({ isYeri: x || HEPSI })}
                  />
                )}
                {kapsam === "pozisyon" && (
                  <AutoComplete
                    value={hepsiMi(d.pozisyon) ? "" : d.pozisyon}
                    options={veri.pozisyonlar.map((p) => ({ value: p }))}
                    filterOption={filtre}
                    placeholder="Pozisyon, örn. DEPO GÖREVLİSİ"
                    onChange={(x) => degis({ pozisyon: x || HEPSI })}
                  />
                )}
                {kapsam === "kisi" && <KisiSec deger={d.sicil} sec={(k) => degis({ sicil: k?.sicil ?? null })} yer="Personeli ara (ad, sicil)" />}
              </div>
            </div>

            <label>
              <b>Gün türü</b>
              <Select
                style={{ width: "100%" }}
                value={d.gunTuru ?? HEPSI}
                onChange={(x) => degis({ gunTuru: x })}
                options={[...veri.gunTurleri.map((g) => ({ value: g.kod, label: g.ad })), { value: HEPSI, label: "Her gün türü" }]}
              />
            </label>

            <div>
              <b>Karşılığı</b>
              <Radio.Group
                style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}
                value={d.karsilik ?? "ucret"}
                onChange={(e) => degis({ karsilik: e.target.value })}
              >
                <Radio value="ucret">Ücret olarak ödensin</Radio>
                <Radio value="izin">Serbest zaman (izin) olarak verilsin</Radio>
              </Radio.Group>
            </div>

            <div>
              <b>Çarpan</b>
              <small style={{ display: "block", color: "#8a929b" }}>
                {d.karsilik === "izin"
                  ? "1 saat fazla mesai için kaç saat serbest zaman (ör. ×1,5: 1 saate 1,5 saat izin)."
                  : "1 saat fazla mesai için saat ücretinin kaç katı (ör. ×1,5: %50 zamlı, ×2: iki katı)."}
              </small>
              <Space wrap style={{ marginTop: 6 }}>
                <Segmented
                  value={CARPANLAR.includes(Number(d.carpan)) ? Number(d.carpan) : "diger"}
                  onChange={(x) => x !== "diger" && degis({ carpan: Number(x) })}
                  options={[...CARPANLAR.map((c) => ({ value: c, label: carpanYaz(c) })), { value: "diger", label: "Diğer" }]}
                />
                <InputNumber value={d.carpan} min={0.5} max={5} step={0.05} onChange={(v) => degis({ carpan: Number(v ?? 1.5) })} style={{ width: 90 }} />
              </Space>
            </div>

            <Space>
              <Switch checked={d.aktif ?? true} onChange={(x) => degis({ aktif: x })} />
              {d.aktif ?? true ? "Aktif" : "Pasif (uygulanmaz)"}
            </Space>
          </div>
        )}
      </Modal>
    </div>
  );
}
