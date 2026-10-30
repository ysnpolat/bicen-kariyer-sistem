/**
 * Talep ve Öneriler — yönetim sayfası (30.10.2026).
 *
 * Panel kullanıcılarının her ekrandan yazdığı sorun bildirimleri ve
 * öneriler tek listede. Durum çipleri sayılarıyla süzer; satır açılınca tam
 * metin, görseller, kişi/ekran/sürüm bilgisi görünür; durum seçilip cevap
 * yazılır. Cevap kullanıcıya zil bildirimiyle gider.
 *
 * "Kopyala" seçilenleri ya da tüm listeyi düz metin olarak panoya alır;
 * "Claude'a sor" aynı metnin sonuna soru ekler — yönetici yapay zekâya
 * yapıştırıp çözüm önerisi alır.
 *
 * Erişim: Yönetici her zaman; diğer roller Rol Yetkileri'nde "Talep ve
 * Öneriler" işaretliyse. Yönetici ayrıca bildirim e-posta adreslerini
 * buradan düzenler.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Key } from "react";
import {
  App as AntdApp,
  Button,
  Image,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Bot, Copy, Mail, RefreshCw, Save } from "lucide-react";
import dayjs from "dayjs";

import { api, oturumOku, tamYonetim } from "./api";
import { TALEP_DURUMLARI, talepGorselAdresi } from "./Talep";

interface TalepSatiri {
  id: number;
  kullanici: string;
  adSoyad: string;
  rol?: string | null;
  tur: number;
  ekran?: string | null;
  yol?: string | null;
  metin: string;
  surum?: string | null;
  durum: number;
  cevap?: string | null;
  cevaplayan?: string | null;
  cevapZamani?: string | null;
  olusturma: string;
  gorselSayisi: number;
}

type Cip = "acik" | "hepsi" | 0 | 1 | 2 | 3 | 4;

const duzMetin = (t: TalepSatiri) =>
  `#${t.id} · ${t.tur === 1 ? "Destek" : "Öneri"} · ${t.ekran ?? "-"}${t.yol ? ` (${t.yol})` : ""} · ` +
  `${t.adSoyad}${t.rol ? ` (${t.rol})` : ""} · ${dayjs(t.olusturma).format("DD.MM.YYYY HH:mm")} · ` +
  `v${t.surum ?? "-"} · ${t.gorselSayisi} görsel · ${TALEP_DURUMLARI[t.durum]?.ad ?? ""}\n${t.metin}` +
  (t.cevap ? `\nCevap: ${t.cevap}` : "");

export default function Talepler() {
  const { message } = AntdApp.useApp();
  const oturum = oturumOku();
  const yonetici = tamYonetim(oturum);

  const [liste, setListe] = useState<TalepSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [cip, setCip] = useState<Cip>("acik");
  const [tur, setTur] = useState<0 | 1 | 2>(0);
  const [ara, setAra] = useState("");
  const [secili, setSecili] = useState<Key[]>([]);
  const [acik, setAcik] = useState<number[]>([]);
  const [taslak, setTaslak] = useState<Record<number, { durum: number; cevap: string }>>({});
  const [kaydediliyor, setKaydediliyor] = useState<number | null>(null);

  const [adresler, setAdresler] = useState<string[]>([]);
  const [adresMetni, setAdresMetni] = useState("");
  const [ayarAcik, setAyarAcik] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setListe(await api.al<TalepSatiri[]>("/api/Talep"));
    } catch (h: any) {
      message.error(h?.message ?? "Talepler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    void getir();
    if (yonetici)
      api
        .al<{ bildirimAdresleri: string[] }>("/api/Talep/Ayar")
        .then((a) => {
          setAdresler(a.bildirimAdresleri ?? []);
          setAdresMetni((a.bildirimAdresleri ?? []).join(", "));
        })
        .catch(() => undefined);
  }, [getir, yonetici]);

  const sayilar = useMemo(() => {
    const s: Record<string, number> = { acik: 0, hepsi: liste.length, 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const t of liste) {
      s[t.durum] = (s[t.durum] ?? 0) + 1;
      if (t.durum <= 2) s.acik++;
    }
    return s;
  }, [liste]);

  const gorunen = useMemo(() => {
    const a = ara.trim().toLocaleLowerCase("tr-TR");
    return liste.filter((t) => {
      if (cip === "acik" && t.durum > 2) return false;
      if (typeof cip === "number" && t.durum !== cip) return false;
      if (tur !== 0 && t.tur !== tur) return false;
      if (a) {
        const h = `${t.id} ${t.adSoyad} ${t.ekran ?? ""} ${t.metin} ${t.cevap ?? ""}`.toLocaleLowerCase("tr-TR");
        if (!h.includes(a)) return false;
      }
      return true;
    });
  }, [liste, cip, tur, ara]);

  const kaydet = async (t: TalepSatiri) => {
    const d = taslak[t.id] ?? { durum: t.durum, cevap: t.cevap ?? "" };
    setKaydediliyor(t.id);
    try {
      await api.guncelle(`/api/Talep/${t.id}`, { durum: d.durum, cevap: d.cevap });
      message.success(`#${t.id} güncellendi; kullanıcıya bildirim gitti.`);
      setTaslak((x) => {
        const { [t.id]: _, ...kalan } = x;
        return kalan;
      });
      await getir();
    } catch (h: any) {
      message.error(h?.message ?? "Kaydedilemedi.");
    } finally {
      setKaydediliyor(null);
    }
  };

  const kopyala = async (claude: boolean) => {
    const kaynak = secili.length > 0 ? gorunen.filter((t) => secili.includes(t.id)) : gorunen;
    if (kaynak.length === 0) {
      message.info("Kopyalanacak talep yok.");
      return;
    }
    let metin = kaynak.map(duzMetin).join("\n\n");
    if (claude) metin += "\n\nBu talep için ne önerirsin?";
    try {
      await navigator.clipboard.writeText(metin);
      message.success(`${kaynak.length} talep panoya kopyalandı${claude ? " (Claude'a sor)" : ""}.`);
    } catch {
      message.error("Panoya yazılamadı.");
    }
  };

  const ayarKaydet = async () => {
    const liste = adresMetni
      .split(/[,;\n ]+/)
      .map((x) => x.trim())
      .filter((x) => x.includes("@"));
    try {
      await api.guncelle("/api/Talep/Ayar", { bildirimAdresleri: liste });
      setAdresler(liste);
      setAyarAcik(false);
      message.success("Bildirim adresleri kaydedildi.");
    } catch (h: any) {
      message.error(h?.message ?? "Kaydedilemedi.");
    }
  };

  const sutunlar: ColumnsType<TalepSatiri> = [
    { title: "#", dataIndex: "id", width: 64, sorter: (a, b) => a.id - b.id },
    {
      title: "Tür",
      dataIndex: "tur",
      width: 84,
      render: (v: number) => <Tag style={{ margin: 0 }}>{v === 1 ? "Sorun" : "Öneri"}</Tag>,
      filters: [
        { text: "Sorun", value: 1 },
        { text: "Öneri", value: 2 },
      ],
      onFilter: (v, r) => r.tur === v,
    },
    {
      title: "Durum",
      dataIndex: "durum",
      width: 120,
      render: (v: number) => {
        const d = TALEP_DURUMLARI[v] ?? TALEP_DURUMLARI[0];
        return <Tag color={d.renk} style={{ margin: 0 }}>{d.ad}</Tag>;
      },
      sorter: (a, b) => a.durum - b.durum,
    },
    { title: "Kim", dataIndex: "adSoyad", width: 170, ellipsis: true, sorter: (a, b) => a.adSoyad.localeCompare(b.adSoyad, "tr") },
    { title: "Ekran", dataIndex: "ekran", width: 190, ellipsis: true },
    {
      title: "Talep",
      dataIndex: "metin",
      ellipsis: true,
      render: (v: string, r) => (
        <span>
          {v}
          {r.gorselSayisi > 0 && <Tag style={{ marginLeft: 6 }}>{r.gorselSayisi} görsel</Tag>}
        </span>
      ),
    },
    {
      title: "Tarih",
      dataIndex: "olusturma",
      width: 130,
      render: (v: string) => dayjs(v).format("DD.MM.YY HH:mm"),
      sorter: (a, b) => dayjs(a.olusturma).valueOf() - dayjs(b.olusturma).valueOf(),
    },
  ];

  const cipler: { k: Cip; ad: string }[] = [
    { k: "acik", ad: "Açık" },
    { k: "hepsi", ad: "Tümü" },
    { k: 0, ad: "Yeni" },
    { k: 1, ad: "İnceleniyor" },
    { k: 2, ad: "Planlandı" },
    { k: 3, ad: "Tamamlandı" },
    { k: 4, ad: "Yapılmayacak" },
  ];

  return (
    <div className="ik-icerik">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Talep ve Öneriler</h2>
          <div style={{ fontSize: 12.5, color: "var(--pasif, #8a929b)" }}>
            Kullanıcıların panelden yazdığı sorun bildirimleri ve öneriler · son 365 gün
          </div>
        </div>
        <Space wrap>
          <Button icon={<RefreshCw size={14} />} onClick={getir} loading={yukleniyor}>
            Yenile
          </Button>
          <Tooltip title={secili.length > 0 ? `${secili.length} seçili talebi kopyala` : "Listedeki tüm talepleri kopyala"}>
            <Button icon={<Copy size={14} />} onClick={() => kopyala(false)}>
              Kopyala
            </Button>
          </Tooltip>
          <Tooltip title="Aynı metnin sonuna “Bu talep için ne önerirsin?” ekler; yapay zekâya yapıştırın">
            <Button icon={<Bot size={14} />} onClick={() => kopyala(true)}>
              Claude'a sor
            </Button>
          </Tooltip>
          {yonetici && (
            <Button icon={<Mail size={14} />} onClick={() => setAyarAcik((a) => !a)}>
              Bildirim e-postası{adresler.length > 0 ? ` (${adresler.length})` : ""}
            </Button>
          )}
        </Space>
      </div>

      {ayarAcik && (
        <div style={{ border: "1px solid var(--cizgi, #e3e6e1)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            Yeni talep geldiğinde e-posta gidecek adresler (virgülle ayırın). Boş bırakılırsa aktif Yönetici
            kullanıcılarının e-postalarına gider.
          </div>
          <Space.Compact style={{ width: "100%" }}>
            <Input value={adresMetni} onChange={(e) => setAdresMetni(e.target.value)} placeholder="ad@bicen.com.tr, ..." />
            <Button type="primary" icon={<Save size={14} />} onClick={ayarKaydet}>
              Kaydet
            </Button>
          </Space.Compact>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <Space size={4} wrap>
          {cipler.map((c) => (
            <Tag.CheckableTag key={String(c.k)} checked={cip === c.k} onChange={() => setCip(c.k)} style={{ fontSize: 13, padding: "3px 10px" }}>
              {c.ad} <b>{sayilar[c.k as any] ?? 0}</b>
            </Tag.CheckableTag>
          ))}
        </Space>
        <Segmented
          size="small"
          value={tur}
          onChange={(v) => setTur(v as 0 | 1 | 2)}
          options={[
            { value: 0, label: "Hepsi" },
            { value: 1, label: "Sorun" },
            { value: 2, label: "Öneri" },
          ]}
        />
        <Input.Search allowClear placeholder="Ara: no, kişi, ekran, metin" value={ara} onChange={(e) => setAra(e.target.value)} style={{ width: 280 }} />
      </div>

      <Table<TalepSatiri>
        rowKey="id"
        size="small"
        loading={yukleniyor}
        columns={sutunlar}
        dataSource={gorunen}
        pagination={{ pageSize: 25, showSizeChanger: true }}
        rowSelection={{ selectedRowKeys: secili, onChange: setSecili }}
        expandable={{
          expandedRowKeys: acik,
          onExpandedRowsChange: (k) => setAcik([...k] as number[]),
          expandRowByClick: true,
          expandedRowRender: (t) => {
            const d = taslak[t.id] ?? { durum: t.durum, cevap: t.cevap ?? "" };
            return (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 1fr)", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--pasif, #8a929b)", marginBottom: 6 }}>
                    {t.adSoyad} ({t.kullanici}{t.rol ? ` · ${t.rol}` : ""}) · {t.ekran ?? "-"}
                    {t.yol ? ` (${t.yol})` : ""} · sürüm {t.surum ?? "-"} ·{" "}
                    {dayjs(t.olusturma).format("DD.MM.YYYY HH:mm")}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.6 }}>{t.metin}</div>
                  {t.gorselSayisi > 0 && (
                    <Image.PreviewGroup>
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        {Array.from({ length: t.gorselSayisi }, (_, i) => (
                          <Image key={i} src={talepGorselAdresi(t.id, i + 1)} width={160} height={100} style={{ objectFit: "cover", borderRadius: 6 }} />
                        ))}
                      </div>
                    </Image.PreviewGroup>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Durum ve cevap</div>
                  <Select
                    value={d.durum}
                    onChange={(v) => setTaslak((x) => ({ ...x, [t.id]: { ...d, durum: v } }))}
                    options={TALEP_DURUMLARI.map((x, i) => ({ value: i, label: x.ad }))}
                    style={{ width: "100%", marginBottom: 8 }}
                  />
                  <Input.TextArea
                    value={d.cevap}
                    onChange={(e) => setTaslak((x) => ({ ...x, [t.id]: { ...d, cevap: e.target.value } }))}
                    placeholder="Kullanıcı diliyle kısa cevap: ne yapıldı, nerede, nasıl kullanılır"
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    maxLength={2000}
                    showCount
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--pasif, #8a929b)" }}>
                      {t.cevaplayan ? `Son: ${t.cevaplayan} · ${dayjs(t.cevapZamani).format("DD.MM.YYYY HH:mm")}` : "Henüz cevaplanmadı"}
                    </span>
                    <Button type="primary" size="small" icon={<Save size={14} />} loading={kaydediliyor === t.id} onClick={() => kaydet(t)}>
                      Kaydet
                    </Button>
                  </div>
                </div>
              </div>
            );
          },
        }}
      />
    </div>
  );
}
