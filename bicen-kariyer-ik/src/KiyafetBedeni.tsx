/**
 * ---------------------------------------------------------------------------
 * Kıyafet bedenleri (18.10.2026)
 * ---------------------------------------------------------------------------
 * - BedenSecici: personel kartında kişinin bedeni; İK seçip değiştirir.
 * - KiyafetBedenleri (Yönetim → Personel ve izin → Kıyafet bedenleri):
 *   beden listesini düzenler (varsayılan S, M, L, XL, XXL, XXXL), beden
 *   başına çalışan sayısını ve personel listesini gösterir, Excel'e aktarır.
 * Kayıt KRY_PERSONEL_BEDEN'de; Mikro'ya yazılmaz.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { ArrowDown, ArrowUp, Download, Plus, Shirt, X } from "lucide-react";

import { api, oturumOku } from "./api";
import { tabloIndir } from "./raporExcel";

const { Text } = Typography;

const YAZABILEN = ["Admin", "GenelMudurYardimcisi", "IKYoneticisi", "IK"];

export const bedenDuzenleyebilir = () => {
  const o = oturumOku();
  return !!o && YAZABILEN.includes(o.rol) && o.yetki?.saltOkunur !== true;
};

const hataMetni = (e: any, yedek: string) => e?.hata || e?.message || yedek;

/* ======================================================================== */
/* Personel kartı: beden seçici                                             */
/* ======================================================================== */

interface KisiBedeni {
  beden: string | null;
  guncelleyen: string | null;
  guncelleme: string | null;
  bedenler: string[];
  duzenlenebilir: boolean;
}

export function BedenSecici({ sicil }: { sicil: string | null | undefined }) {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<KisiBedeni | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    setVeri(null);
    if (!sicil) return;
    let iptal = false;
    api
      .al<KisiBedeni>(`/api/KiyafetBeden/Kisi/${encodeURIComponent(sicil)}`)
      .then((v) => !iptal && setVeri(v))
      .catch(() => !iptal && setVeri({ beden: null, guncelleyen: null, guncelleme: null, bedenler: [], duzenlenebilir: false }));
    return () => {
      iptal = true;
    };
  }, [sicil]);

  if (!sicil) return null;
  if (!veri) return <Spin size="small" />;

  const yazabilir = veri.duzenlenebilir && bedenDuzenleyebilir();

  if (!yazabilir) return <>{veri.beden ?? "—"}</>;

  /* Tanımdan çıkarılmış eski beden de seçili görünsün */
  const secenekler = [...veri.bedenler];
  if (veri.beden && !secenekler.includes(veri.beden)) secenekler.unshift(veri.beden);

  const kaydet = async (yeni: string | undefined) => {
    setKaydediliyor(true);
    try {
      const s = await api.gonder<{ beden: string | null }>(
        `/api/KiyafetBeden/Kisi/${encodeURIComponent(sicil)}`,
        { beden: yeni ?? "" }
      );
      setVeri({ ...veri, beden: s.beden, guncelleme: new Date().toISOString(), guncelleyen: oturumOku()?.kullaniciAdi ?? null });
      message.success(s.beden ? `Beden ${s.beden} olarak kaydedildi` : "Beden kaldırıldı");
    } catch (e: any) {
      message.error(hataMetni(e, "Beden kaydedilemedi"));
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Select
      size="small"
      allowClear
      placeholder="Seçin"
      value={veri.beden ?? undefined}
      loading={kaydediliyor}
      disabled={kaydediliyor}
      onChange={kaydet}
      style={{ minWidth: 110 }}
      options={secenekler.map((b) => ({ value: b, label: b }))}
      title={
        veri.guncelleyen && veri.guncelleme
          ? `${veri.guncelleyen} · ${dayjs(veri.guncelleme).format("DD.MM.YYYY HH:mm")}`
          : undefined
      }
    />
  );
}

/* ======================================================================== */
/* Yönetim sayfası                                                          */
/* ======================================================================== */

interface ListeSatiri {
  sicil: string;
  adSoyad: string;
  sube: string | null;
  pozisyon: string | null;
  beden: string | null;
  guncelleyen: string | null;
  guncelleme: string | null;
}

interface Liste {
  bedenler: string[];
  sayilar: { beden: string; sayi: number }[];
  girilmemis: number;
  tanimsiz: number;
  toplam: number;
  subeler: string[];
  kisiler: ListeSatiri[];
}

export default function KiyafetBedenleri() {
  const { message } = AntdApp.useApp();
  const yazabilir = bedenDuzenleyebilir();

  const [liste, setListe] = useState<Liste | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [sube, setSube] = useState<string | undefined>();
  const [suzgec, setSuzgec] = useState<string | undefined>();
  const [arama, setArama] = useState("");

  const [taslak, setTaslak] = useState<string[]>([]);
  const [yeni, setYeni] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = useCallback(() => {
    setYukleniyor(true);
    api
      .al<Liste>(`/api/KiyafetBeden/Liste${sube ? `?sube=${encodeURIComponent(sube)}` : ""}`)
      .then((l) => {
        setListe(l);
        setTaslak(l.bedenler);
      })
      .catch((e) => message.error(hataMetni(e, "Beden listesi alınamadı")))
      .finally(() => setYukleniyor(false));
  }, [sube, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kirli = !!liste && JSON.stringify(taslak) !== JSON.stringify(liste.bedenler);

  const ekle = () => {
    const b = yeni.trim().toLocaleUpperCase("tr");
    if (!b) return;
    if (b.length > 20) return message.warning("Beden adı en fazla 20 karakter olabilir");
    if (taslak.some((x) => x.toLocaleUpperCase("tr") === b)) return message.warning(`${b} zaten listede`);
    setTaslak([...taslak, b]);
    setYeni("");
  };

  const tasi = (i: number, yon: -1 | 1) => {
    const j = i + yon;
    if (j < 0 || j >= taslak.length) return;
    const t = [...taslak];
    [t[i], t[j]] = [t[j], t[i]];
    setTaslak(t);
  };

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      await api.gonder("/api/KiyafetBeden/Bedenler", { bedenler: taslak });
      message.success("Beden listesi kaydedildi");
      getir();
    } catch (e: any) {
      message.error(hataMetni(e, "Kaydedilemedi"));
    } finally {
      setKaydediliyor(false);
    }
  };

  const satirlar = useMemo(() => {
    const a = arama.trim().toLocaleLowerCase("tr");
    return (liste?.kisiler ?? []).filter((k) => {
      if (suzgec === "__yok" && k.beden) return false;
      if (suzgec && suzgec !== "__yok" && k.beden !== suzgec) return false;
      if (!a) return true;
      return [k.adSoyad, k.sicil, k.pozisyon, k.sube].some((x) => (x ?? "").toLocaleLowerCase("tr").includes(a));
    });
  }, [liste, arama, suzgec]);

  const excel = () =>
    tabloIndir({
      baslik: "Personel kıyafet bedenleri",
      altBaslik: `${sube ?? "Tüm şubeler"} · ${dayjs().format("DD.MM.YYYY")}`,
      sayfaAdi: "Bedenler",
      dosyaAdi: "Kiyafet_Bedenleri",
      sutunlar: [
        { ad: "Sicil", genislik: 10 },
        { ad: "Ad Soyad", genislik: 28 },
        { ad: "Şube", genislik: 26 },
        { ad: "Pozisyon", genislik: 26 },
        { ad: "Beden", genislik: 10 },
      ],
      satirlar: satirlar.map((k) => [k.sicil, k.adSoyad, k.sube ?? "", k.pozisyon ?? "", k.beden ?? ""]),
    });

  const sutunlar: ColumnsType<ListeSatiri> = [
    { title: "Sicil", dataIndex: "sicil", width: 90 },
    { title: "Ad Soyad", dataIndex: "adSoyad" },
    { title: "Şube", dataIndex: "sube", responsive: ["md"] },
    { title: "Pozisyon", dataIndex: "pozisyon", responsive: ["lg"] },
    {
      title: "Beden",
      dataIndex: "beden",
      width: 100,
      render: (b: string | null) => (b ? <Tag color="green">{b}</Tag> : <Text type="secondary">—</Text>),
    },
  ];

  if (!liste && yukleniyor) return <Spin />;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Beden tanımları */}
      <div>
        <Text strong style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <Shirt size={16} strokeWidth={2} /> Bedenler
        </Text>
        <Text type="secondary" style={{ display: "block", marginBottom: 10 }}>
          Personel kartındaki beden seçeneği bu listeden gelir. Sıra, listede ve Excel'de görünen sıradır.
        </Text>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {taslak.map((b, i) => (
            <span
              key={b}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 6px 4px 10px",
                borderRadius: 8,
                border: "1px solid #d9e3cf",
                background: "#f6faf1",
                fontWeight: 700,
              }}
            >
              {b}
              {liste && (
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>
                  · {liste.sayilar.find((s) => s.beden === b)?.sayi ?? 0}
                </Text>
              )}
              {yazabilir && (
                <>
                  <Button type="text" size="small" icon={<ArrowUp size={13} />} disabled={i === 0} onClick={() => tasi(i, -1)} />
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowDown size={13} />}
                    disabled={i === taslak.length - 1}
                    onClick={() => tasi(i, 1)}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<X size={13} />}
                    onClick={() => setTaslak(taslak.filter((x) => x !== b))}
                  />
                </>
              )}
            </span>
          ))}
        </div>

        {yazabilir && (
          <Space wrap>
            <Space.Compact>
              <Input
                placeholder="Yeni beden (ör. 4XL, 38)"
                value={yeni}
                maxLength={20}
                onChange={(e) => setYeni(e.target.value)}
                onPressEnter={ekle}
                style={{ width: 200 }}
              />
              <Button icon={<Plus size={14} />} onClick={ekle}>
                Ekle
              </Button>
            </Space.Compact>
            <Button type="primary" disabled={!kirli || taslak.length === 0} loading={kaydediliyor} onClick={kaydet}>
              Kaydet
            </Button>
            {kirli && <Button onClick={() => setTaslak(liste?.bedenler ?? [])}>Vazgeç</Button>}
          </Space>
        )}

        {liste && liste.tanimsiz > 0 && (
          <Alert
            style={{ marginTop: 10 }}
            type="warning"
            showIcon
            message={`${liste.tanimsiz} personelin bedeni artık listede olmayan bir beden. Kartlarından yeniden seçilebilir.`}
          />
        )}
      </div>

      {/* Personel listesi */}
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <Select
            allowClear
            showSearch
            placeholder="Tüm şubeler"
            value={sube}
            onChange={setSube}
            style={{ minWidth: 200 }}
            options={(liste?.subeler ?? []).map((s) => ({ value: s, label: s }))}
          />
          <Select
            allowClear
            placeholder="Tüm bedenler"
            value={suzgec}
            onChange={setSuzgec}
            style={{ minWidth: 150 }}
            options={[
              { value: "__yok", label: `Girilmemiş (${liste?.girilmemis ?? 0})` },
              ...(liste?.sayilar ?? []).map((s) => ({ value: s.beden, label: `${s.beden} (${s.sayi})` })),
            ]}
          />
          <Input.Search
            allowClear
            placeholder="Ad, sicil, pozisyon"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            style={{ width: 220 }}
          />
          <Button icon={<Download size={14} />} onClick={excel} disabled={satirlar.length === 0}>
            Excel
          </Button>
          {liste && (
            <Text type="secondary">
              {liste.toplam} çalışan · {liste.toplam - liste.girilmemis} beden girilmiş · {liste.girilmemis} girilmemiş
            </Text>
          )}
        </div>

        <Table
          size="small"
          rowKey="sicil"
          loading={yukleniyor}
          columns={sutunlar}
          dataSource={satirlar}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          scroll={{ x: true }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          Beden personel kartında, Görev bölümündeki "Kıyafet bedeni" alanından değiştirilir.
        </Text>
      </div>
    </div>
  );
}
