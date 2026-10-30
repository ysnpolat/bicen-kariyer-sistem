/**
 * Uygulama sürümleri (08.10.2026)
 * ---------------------------------------------------------------------------
 * Personelin kullandığı Biçen360 sürümü. Uygulama mağazadan güncellendiği
 * için sunucu kimseyi zorla güncelleyemiyor; güncel sürümden eski
 * kullananlara belirli aralıklarla bildirim ve "Uygulamayı güncelle"
 * bağlantılı duyuru gidiyor (Ayarlar Merkezi › Süreler ve sınırlar ›
 * Biçen360). Bu ekrandan kimin güncellemediği görülüyor ve elle de
 * hatırlatılabiliyor.
 *
 * 1.6 ve sonrası sürümünü her istekte bildiriyor; bildirmeyen oturum
 * "1.5 ya da öncesi". "Kullanmıyor": uygulamaya hiç giriş yapmamış.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App as AntdApp, Button, Input, Popconfirm, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { BellRing, RefreshCw, Search } from "lucide-react";

import { api } from "./api";
import { PersonelAdi } from "./personelKarti";

const { Text } = Typography;

interface Kisi {
  sicil: string;
  adSoyad: string;
  sube: string | null;
  pozisyon: string | null;
  surum: string | null;
  surumAdi: string;
  platform: string | null;
  sonGorulme: string | null;
  aktif: boolean;
  eski: boolean;
  hatirlatma: number;
  sonHatirlatma: string | null;
}

interface Veri {
  guncel: string;
  hatirlatmaAcik: boolean;
  toplam: number;
  kullanan: number;
  guncelde: number;
  eski: number;
  kullanmiyor: number;
  surumler: { surum: string; sayi: number; eski: boolean }[];
  kisiler: Kisi[];
}

type Suzgec = "eski" | "guncel" | "kullanmiyor" | "tumu";

const Kutu = ({ ad, deger, renk, alt }: { ad: string; deger: number | string; renk: string; alt?: string }) => (
  <div style={{ flex: "1 1 150px", background: "#fff", border: "1px solid #eceee8", borderRadius: 12, padding: "12px 14px" }}>
    <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{ad}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color: renk, lineHeight: 1.3 }}>{deger}</div>
    {alt && <div style={{ fontSize: 11.5, color: "#8a929b" }}>{alt}</div>}
  </div>
);

export default function UygulamaSurumleri() {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [suzgec, setSuzgec] = useState<Suzgec>("eski");
  const [sube, setSube] = useState<string | null>(null);
  const [ara, setAra] = useState("");
  const [secili, setSecili] = useState<string[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<Veri>("/api/UygulamaSurum"));
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Liste alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const subeler = useMemo(
    () => [...new Set((veri?.kisiler ?? []).map((k) => k.sube).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "tr")),
    [veri]
  );

  const liste = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return (veri?.kisiler ?? []).filter(
      (k) =>
        (suzgec === "tumu" ||
          (suzgec === "eski" && k.eski) ||
          (suzgec === "guncel" && k.surum !== null && !k.eski) ||
          (suzgec === "kullanmiyor" && k.surum === null)) &&
        (!sube || k.sube === sube) &&
        (!q || `${k.adSoyad} ${k.sicil} ${k.pozisyon ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [veri, suzgec, sube, ara]);

  const hatirlat = async (siciller: string[]) => {
    setGonderiliyor(true);
    try {
      const c = await api.gonder<{ gonderilen: number }>("/api/UygulamaSurum/Hatirlat", { siciller });
      message.success(c.gonderilen > 0 ? `${c.gonderilen} kişiye güncelleme hatırlatması gönderildi.` : "Hatırlatılacak eski sürümlü personel yok.");
      setSecili([]);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Gönderilemedi.");
    } finally {
      setGonderiliyor(false);
    }
  };

  const oran = veri && veri.kullanan > 0 ? Math.round((100 * veri.guncelde) / veri.kullanan) : 0;
  const eskiSecili = secili.filter((s) => liste.find((k) => k.sicil === s)?.eski);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Alert
        type="info"
        showIcon
        message={`Mağazadaki güncel sürüm: ${veri?.guncel ?? "—"}`}
        description={
          <>
            Uygulama mağazadan güncellendiği için kimse zorla güncellenemiyor. Güncel sürümden eski kullanan personele{" "}
            {veri?.hatirlatmaAcik ? "belirli aralıklarla bildirim ve \"Uygulamayı güncelle\" bağlantılı duyuru otomatik gidiyor" : "otomatik hatırlatma şu an kapalı"}
            . Güncel sürüm, aralık ve saat: Ayarlar Merkezi › Süreler ve sınırlar › Biçen360. Yeni sürüm iki mağazada da yayına
            girdiğinde güncel sürümü oradan değiştirin.
          </>
        }
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Kutu ad="Güncel sürümde" deger={veri?.guncelde ?? "—"} renk="#3f6108" alt={veri ? `kullananların %${oran}` : undefined} />
        <Kutu ad="Eski sürümde" deger={veri?.eski ?? "—"} renk="#c2410c" alt="güncellemesi gerekiyor" />
        <Kutu ad="Uygulamayı kullanmıyor" deger={veri?.kullanmiyor ?? "—"} renk="#6b7280" alt="hiç giriş yapmamış" />
        <Kutu ad="Aktif personel" deger={veri?.toplam ?? "—"} renk="#1f2937" />
      </div>

      {veri && veri.surumler.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Sürümler:
          </Text>
          {veri.surumler.map((s) => (
            <Tag key={s.surum} color={s.eski ? "orange" : "green"} style={{ marginInlineEnd: 0 }}>
              {s.surum} · {s.sayi}
            </Tag>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Segmented
          value={suzgec}
          onChange={(v) => {
            setSuzgec(v as Suzgec);
            setSecili([]);
          }}
          options={[
            { value: "eski", label: `Eski sürümde${veri ? ` · ${veri.eski}` : ""}` },
            { value: "guncel", label: "Güncel" },
            { value: "kullanmiyor", label: "Kullanmıyor" },
            { value: "tumu", label: "Tümü" },
          ]}
        />
        <Select
          allowClear
          showSearch
          placeholder="Şube"
          style={{ width: 200 }}
          value={sube ?? undefined}
          onChange={(v) => setSube(v ?? null)}
          options={subeler.map((s) => ({ value: s, label: s }))}
        />
        <Input
          allowClear
          prefix={<Search size={14} />}
          placeholder="Ad, sicil, pozisyon"
          style={{ width: 220 }}
          value={ara}
          onChange={(e) => setAra(e.target.value)}
        />
        <span style={{ flex: 1 }} />
        <Tooltip title="Yenile">
          <Button icon={<RefreshCw size={14} />} onClick={getir} loading={yukleniyor} />
        </Tooltip>
        {eskiSecili.length > 0 ? (
          <Button type="primary" icon={<BellRing size={14} />} loading={gonderiliyor} onClick={() => hatirlat(eskiSecili)}>
            Seçilenlere hatırlat ({eskiSecili.length})
          </Button>
        ) : (
          <Popconfirm
            title="Eski sürümdeki herkese hatırlatma gönderilsin mi?"
            description={`${veri?.eski ?? 0} kişiye bildirim gider; duyuru her sürüm için bir kez yazılır.`}
            okText="Gönder"
            cancelText="Vazgeç"
            onConfirm={() => hatirlat([])}
            disabled={!veri?.eski}
          >
            <Button icon={<BellRing size={14} />} loading={gonderiliyor} disabled={!veri?.eski}>
              Eski sürümdekilere hatırlat
            </Button>
          </Popconfirm>
        )}
      </div>

      <Table<Kisi>
        size="small"
        rowKey="sicil"
        loading={yukleniyor}
        dataSource={liste}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        rowSelection={{
          selectedRowKeys: secili,
          onChange: (k) => setSecili(k as string[]),
          getCheckboxProps: (k) => ({ disabled: !k.eski }),
        }}
        locale={{ emptyText: suzgec === "eski" ? "Eski sürümü kullanan personel yok." : "Kayıt yok." }}
        columns={[
          {
            title: "Personel",
            render: (_: unknown, k) => (
              <div>
                <b><PersonelAdi kod={k.sicil}>{k.adSoyad}</PersonelAdi></b>
                <div style={{ fontSize: 12, color: "#8a929b" }}>
                  {[k.sube, k.pozisyon, k.sicil].filter(Boolean).join(" · ")}
                </div>
              </div>
            ),
          },
          {
            title: "Sürüm",
            width: 170,
            render: (_: unknown, k) =>
              k.surum === null ? (
                <Tag>Kullanmıyor</Tag>
              ) : (
                <Tag color={k.eski ? "orange" : "green"}>{k.surumAdi}</Tag>
              ),
          },
          {
            title: "Telefon",
            width: 90,
            render: (_: unknown, k) => (k.platform === "ios" ? "iPhone" : k.platform === "android" ? "Android" : "—"),
          },
          {
            title: "Son açılış",
            width: 130,
            render: (_: unknown, k) =>
              k.sonGorulme ? (
                <span style={{ color: k.aktif ? undefined : "#b0b4ba" }}>{dayjs(k.sonGorulme).format("DD.MM.YYYY HH:mm")}</span>
              ) : (
                "—"
              ),
          },
          {
            title: "Hatırlatma",
            width: 150,
            render: (_: unknown, k) =>
              k.hatirlatma > 0 ? (
                <span>
                  {k.hatirlatma} kez
                  <div style={{ fontSize: 11.5, color: "#8a929b" }}>son {dayjs(k.sonHatirlatma).format("DD.MM HH:mm")}</div>
                </span>
              ) : (
                <span style={{ color: "#b0b4ba" }}>—</span>
              ),
          },
        ]}
      />
      <Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Son 30 günde uygulamayı açmayanların tarihi soluk görünür; otomatik hatırlatma yalnızca son 30 günde açanlara gider.
        </Text>
      </Space>
    </div>
  );
}
