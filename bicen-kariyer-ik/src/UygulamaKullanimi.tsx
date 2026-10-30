/**
 * Biçen360 Uygulama Kullanımı
 * ---------------------------------------------------------------------------
 * Aktif personelden kimin uygulamaya SMS ile giriş yaptığı (yani uygulamayı
 * kurup kullanıcı girişi yaptığı), kimin hiç giriş yapmadığı. Giriş
 * yapmayan personel uygulamayı kurmamış sayılır.
 *
 * Şube kırılımı satırına tıklanınca liste o şubeye süzülür.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Card, Col, Input, Progress, Row, Segmented, Space, Tag, Tooltip, Typography } from "antd";
import { Bell, Download, RefreshCw, Search, Smartphone, UserCheck, UserX, Users } from "lucide-react";
import dayjs from "dayjs";

import Tablo from "./Tablo";
import { api } from "./api";
import { tabloIndir } from "./raporExcel";
import { PersonelAdi } from "./personelKarti";
import ModulKullanimiGorunumu from "./ModulKullanimiGorunumu";

const { Text, Paragraph } = Typography;

type Kisi = {
  personelKodu: string;
  adSoyad: string;
  gorev: string;
  subeAdi: string;
  telefon: string;
  girisTarihi: string | null;
  girisYapti: boolean;
  cihazAdi: string;
  isletim: string;
  ilkGiris: string | null;
  sonGiris: string | null;
  oturumAcik: boolean;
  bildirimAcik: boolean;
  sonOkutma: string | null;
  cihazDegisimSayisi: number;
  /** Giriş, aynı kimlik numaralı eski sicille yapılmış (ikinci kez işe giriş) */
  eskiSicil?: string | null;
  /** Eşleşme panelden kaldırılmış, yeniden giriş yapılmamış */
  kaldirildi?: boolean;
  sonGorulme?: string | null;
  surum?: string | null;
};

/** Girişin durumu: oturum açık, uygulamadan çıkış yapmış, hiç giriş yok… */
const girisDurumu = (k: Kisi): { ad: string; renk: string; aciklama: string } =>
  k.kaldirildi
    ? { ad: "Eşleşme kaldırıldı", renk: "volcano", aciklama: "Cihaz eşleştirmesi panelden kaldırıldı; yeniden SMS ile giriş yapması gerekiyor." }
    : !k.girisYapti
    ? { ad: "Giriş yapmadı", renk: "red", aciklama: k.telefon ? `Tel: ${k.telefon}` : "Telefon kayıtlı değil" }
    : k.eskiSicil
    ? {
        ad: "Eski sicille giriş",
        renk: "gold",
        aciklama: `Uygulamaya önceki sicilinden (${k.eskiSicil}) giriş yapmış. Yeni sicille kullanabilmesi için uygulamadan çıkıp yeniden SMS ile girmesi gerekiyor.`,
      }
    : !k.oturumAcik
    ? {
        ad: "Oturumu kapattı",
        renk: "orange",
        aciklama: "Uygulamayı kurmuş ve giriş yapmış, sonra uygulamadan çıkış yapmış. Yeniden SMS ile girmesi gerekiyor.",
      }
    : { ad: "Giriş yaptı", renk: "green", aciklama: k.surum ? `Sürüm ${k.surum}` : "" };

const oturumKapali = (k: Kisi) => k.girisYapti && (!k.oturumAcik || !!k.eskiSicil);

const tarihSaat = (v?: string | null) => (v ? dayjs(v).format("DD.MM.YYYY HH:mm") : "—");

const oranRengi = (o: number) => (o >= 80 ? "#4d750b" : o >= 50 ? "#d48806" : "#cf1322");

function Kutu({ ikon, baslik, deger, alt, renk }: { ikon: any; baslik: string; deger: any; alt?: string; renk: string }) {
  return (
    <Card size="small" style={{ height: "100%" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: renk + "1a",
            color: renk,
            flex: "none",
          }}
        >
          {ikon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9086", letterSpacing: 0.3 }}>{baslik}</div>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15, color: renk }}>{deger}</div>
          {alt && <div style={{ fontSize: 11.5, color: "#8a9086" }}>{alt}</div>}
        </div>
      </div>
    </Card>
  );
}

export default function UygulamaKullanimi() {
  const [gorunum, setGorunum] = useState<"giris" | "modul">("giris");
  const [aktif, setAktif] = useState<number | undefined>();
  return (
    <div>
      <Segmented
        style={{ marginBottom: 12 }}
        value={gorunum}
        onChange={(v) => setGorunum(v as any)}
        options={[
          { label: "Kurulum ve giriş", value: "giris" },
          { label: "Modül kullanımı", value: "modul" },
        ]}
      />
      {gorunum === "giris" ? <KurulumVeGiris toplamBildir={setAktif} /> : <ModulKullanimiGorunumu aktifPersonel={aktif} />}
    </div>
  );
}

function KurulumVeGiris({ toplamBildir }: { toplamBildir: (n: number) => void }) {
  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<{ olusturma: string; kaldirabilir?: boolean; kisiler: Kisi[] } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [durum, setDurum] = useState<"tum" | "giren" | "kapali" | "girmeyen">("tum");
  const [arama, setArama] = useState("");
  const [sube, setSube] = useState<string | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setVeri(await api.al<any>("/api/Mobil/UygulamaKullanimi"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const kisiler = veri?.kisiler ?? [];
  const toplam = kisiler.length;
  useEffect(() => {
    if (toplam) toplamBildir(toplam);
  }, [toplam, toplamBildir]);
  const giren = kisiler.filter((k) => k.girisYapti).length;
  const bildirim = kisiler.filter((k) => k.bildirimAcik).length;
  const kapali = kisiler.filter(oturumKapali).length;
  const oran = toplam ? Math.round((giren * 1000) / toplam) / 10 : 0;

  const subeler = useMemo(() => {
    const m = new Map<string, { sube: string; toplam: number; giren: number }>();
    for (const k of kisiler) {
      const ad = k.subeAdi || "Şubesiz";
      const s = m.get(ad) ?? { sube: ad, toplam: 0, giren: 0 };
      s.toplam++;
      if (k.girisYapti) s.giren++;
      m.set(ad, s);
    }
    return [...m.values()]
      .map((s) => ({ ...s, girmeyen: s.toplam - s.giren, oran: s.toplam ? (s.giren * 100) / s.toplam : 0 }))
      .sort((a, b) => a.oran - b.oran || b.toplam - a.toplam);
  }, [kisiler]);

  const liste = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    return kisiler
      .filter((k) =>
        durum === "giren" ? k.girisYapti : durum === "kapali" ? oturumKapali(k) : durum === "girmeyen" ? !k.girisYapti : true
      )
      .filter((k) => !sube || (k.subeAdi || "Şubesiz") === sube)
      .filter(
        (k) =>
          !q ||
          `${k.adSoyad} ${k.personelKodu} ${k.gorev} ${k.subeAdi} ${k.telefon} ${k.cihazAdi}`
            .toLocaleLowerCase("tr-TR")
            .includes(q)
      )
      .sort(
        (a, b) =>
          Number(a.girisYapti) - Number(b.girisYapti) ||
          (a.subeAdi || "").localeCompare(b.subeAdi || "", "tr") ||
          a.adSoyad.localeCompare(b.adSoyad, "tr")
      );
  }, [kisiler, durum, sube, arama]);

  const kaldir = (k: Kisi) => {
    modal.confirm({
      title: "Cihaz eşleştirmesi kaldırılsın mı?",
      content: `${k.adSoyad} (${k.personelKodu}) mevcut cihazdan çıkarılır; yeni telefonundan hemen giriş yapabilir.`,
      okText: "Kaldır",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Mobil/Cihaz/${encodeURIComponent(k.personelKodu)}`);
          message.success("Eşleştirme kaldırıldı.");
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });
  };

  const excel = async () => {
    try {
      await tabloIndir({
        baslik: "Biçen360 Uygulama Kullanımı",
        altBaslik: `${dayjs().format("DD.MM.YYYY HH:mm")} · ${
          durum === "giren" ? "Giriş yapanlar" : durum === "girmeyen" ? "Giriş yapmayanlar" : "Tüm aktif personel"
        }${sube ? ` · ${sube}` : ""}`,
        sayfaAdi: "Uygulama Kullanımı",
        dosyaAdi: `biçen360-uygulama-kullanimi-${dayjs().format("YYYYMMDD")}`,
        sutunlar: [
          { ad: "Sicil", genislik: 11 },
          { ad: "Ad Soyad", genislik: 24 },
          { ad: "Görev", genislik: 22 },
          { ad: "Şube", genislik: 20 },
          { ad: "Telefon", genislik: 15 },
          { ad: "Durum", genislik: 16 },
          { ad: "Cihaz", genislik: 22 },
          { ad: "İşletim", genislik: 10 },
          { ad: "İlk Giriş", tip: "tarihSaat" },
          { ad: "Son Giriş", tip: "tarihSaat" },
          { ad: "Son Okutma", tip: "tarihSaat" },
          { ad: "Bildirim", genislik: 10 },
        ],
        satirlar: liste.map((k) => [
          k.personelKodu,
          k.adSoyad,
          k.gorev,
          k.subeAdi,
          k.telefon,
          girisDurumu(k).ad,
          k.cihazAdi,
          k.isletim,
          k.ilkGiris,
          k.sonGiris,
          k.sonOkutma,
          k.bildirimAcik ? "Açık" : "Kapalı",
        ]),
        grupSutunu: 3,
      });
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  return (
    <div>
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Aktif personelden Biçen360 uygulamasına <b>SMS ile kullanıcı girişi yapanlar</b> ve hiç giriş
        yapmayanlar. Uygulamadan çıkış yapan personel "giriş yapan" içinde, <b>Oturumu kapattı</b> etiketiyle
        görünür; ikinci kez işe girip eski siciliyle giriş yapmış olan da öyle. Şube satırına tıklayarak
        listeyi o şubeye süzebilirsiniz.
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={6}>
          <Kutu ikon={<Users size={19} />} baslik="AKTİF PERSONEL" deger={toplam} renk="#3d4a36" />
        </Col>
        <Col xs={12} md={6}>
          <Kutu
            ikon={<UserCheck size={19} />}
            baslik="GİRİŞ YAPAN"
            deger={giren}
            alt={`%${oran.toLocaleString("tr-TR")} kullanım${kapali ? ` · ${kapali} kişi oturumu kapatmış` : ""}`}
            renk="#4d750b"
          />
        </Col>
        <Col xs={12} md={6}>
          <Kutu
            ikon={<UserX size={19} />}
            baslik="GİRİŞ YAPMAYAN"
            deger={toplam - giren}
            alt="hiç giriş yapmamış"
            renk="#cf1322"
          />
        </Col>
        <Col xs={12} md={6}>
          <Kutu
            ikon={<Bell size={19} />}
            baslik="BİLDİRİM AÇIK"
            deger={bildirim}
            alt={giren ? `giriş yapanların %${Math.round((bildirim * 100) / giren)}'i` : undefined}
            renk="#1677ff"
          />
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <Card
            size="small"
            title="Şube Kırılımı"
            extra={
              sube && (
                <Button size="small" type="link" onClick={() => setSube(null)}>
                  Tüm şubeler
                </Button>
              )
            }
          >
            <div style={{ maxHeight: 620, overflowY: "auto" }}>
              {subeler.map((s) => (
                <div
                  key={s.sube}
                  onClick={() => setSube(sube === s.sube ? null : s.sube)}
                  style={{
                    padding: "7px 8px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: sube === s.sube ? "#f1f7e6" : undefined,
                    border: sube === s.sube ? "1px solid #b7d98a" : "1px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sube}</b>
                    <span style={{ flex: "none", marginLeft: 8 }}>
                      {s.giren}/{s.toplam}
                      {s.girmeyen > 0 && <Text type="danger"> · {s.girmeyen} eksik</Text>}
                    </span>
                  </div>
                  <Progress
                    percent={Math.round(s.oran)}
                    size="small"
                    strokeColor={oranRengi(s.oran)}
                    style={{ margin: 0 }}
                  />
                </div>
              ))}
              {!subeler.length && <Text type="secondary">Kayıt yok.</Text>}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card size="small">
            <Space wrap style={{ marginBottom: 10, width: "100%", justifyContent: "space-between" }}>
              <Segmented
                value={durum}
                onChange={(v) => setDurum(v as any)}
                options={[
                  { label: `Tümü (${toplam})`, value: "tum" },
                  { label: `Giriş yapan (${giren})`, value: "giren" },
                  { label: `Oturumu kapatan (${kapali})`, value: "kapali" },
                  { label: `Giriş yapmayan (${toplam - giren})`, value: "girmeyen" },
                ]}
              />
              <Space wrap>
                <Input
                  allowClear
                  prefix={<Search size={14} />}
                  placeholder="Ad, sicil, şube, telefon…"
                  value={arama}
                  onChange={(e) => setArama(e.target.value)}
                  style={{ width: 220 }}
                />
                <Tooltip title="Yenile">
                  <Button icon={<RefreshCw size={14} />} onClick={getir} loading={yukleniyor} />
                </Tooltip>
                <Button icon={<Download size={14} />} onClick={excel} disabled={!liste.length}>
                  Excel
                </Button>
              </Space>
            </Space>

            {sube && (
              <Tag closable onClose={() => setSube(null)} color="green" style={{ marginBottom: 8 }}>
                Şube: {sube}
              </Tag>
            )}

            <Tablo
              rowKey="personelKodu"
              size="small"
              loading={yukleniyor}
              dataSource={liste}
              pagination={{ pageSize: 25, showSizeChanger: false }}
              locale={{ emptyText: "Kayıt yok." }}
              columns={[
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  render: (v: string, k: Kisi) => (
                    <div>
                      <b><PersonelAdi kod={k.personelKodu}>{v}</PersonelAdi></b>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11.5 }}>
                          {k.personelKodu}
                          {k.gorev ? ` · ${k.gorev}` : ""}
                          {!sube && k.subeAdi ? ` · ${k.subeAdi}` : ""}
                        </Text>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "Durum",
                  key: "durum",
                  width: 140,
                  render: (_v: any, k: Kisi) => {
                    const d = girisDurumu(k);
                    return (
                      <Tooltip title={d.aciklama || undefined}>
                        <Tag color={d.renk}>{d.ad}</Tag>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: "Cihaz",
                  dataIndex: "cihazAdi",
                  width: 170,
                  render: (v: string, k: Kisi) =>
                    k.girisYapti ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Smartphone size={13} color="#8a9086" />
                        <span style={{ fontSize: 12.5 }}>{v || "—"}</span>
                        {k.isletim && <Tag color={k.isletim === "iOS" ? "blue" : "green"}>{k.isletim}</Tag>}
                      </span>
                    ) : (
                      <Text type="secondary">—</Text>
                    ),
                },
                {
                  title: "İlk / Son Giriş",
                  key: "giris",
                  width: 140,
                  render: (_v: any, k: Kisi) =>
                    k.girisYapti ? (
                      <div style={{ fontSize: 12 }}>
                        <div>{tarihSaat(k.ilkGiris)}</div>
                        <Text type="secondary" style={{ fontSize: 11.5 }}>
                          son: {tarihSaat(k.sonGiris)}
                        </Text>
                      </div>
                    ) : (
                      <Text type="secondary">—</Text>
                    ),
                },
                {
                  title: "Son Okutma",
                  dataIndex: "sonOkutma",
                  width: 120,
                  render: (v: string | null) => <span style={{ fontSize: 12 }}>{tarihSaat(v)}</span>,
                },
                {
                  title: "Bildirim",
                  dataIndex: "bildirimAcik",
                  width: 82,
                  render: (v: boolean, k: Kisi) =>
                    !k.girisYapti ? <Text type="secondary">—</Text> : v ? <Tag color="blue">açık</Tag> : <Tag>kapalı</Tag>,
                },
                {
                  title: "",
                  key: "islem",
                  width: 80,
                  align: "right" as const,
                  render: (_v: any, k: Kisi) =>
                    k.girisYapti &&
                    veri?.kaldirabilir && (
                      <Tooltip title="Cihaz eşleştirmesini kaldır">
                        <Button size="small" danger onClick={() => kaldir(k)}>
                          Kaldır
                        </Button>
                      </Tooltip>
                    ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {veri?.olusturma && (
        <Text type="secondary" style={{ fontSize: 11.5, display: "block", marginTop: 8 }}>
          Veri zamanı: {tarihSaat(veri.olusturma)}
        </Text>
      )}
    </div>
  );
}
