/**
 * Biçen360 modül kullanımı (16.10.2026)
 * ---------------------------------------------------------------------------
 * Personel uygulamada hangi ekranı ne sıklıkla açıyor. Sunucu her ekranın
 * kendine özgü isteğini modüle eşleyip sayıyor; aynı kişinin aynı modülü
 * 15 dakika içinde tekrar açması tek kullanım. Uygulama güncellemesi
 * gerekmedi; kayıt bu sürümle başladı.
 *
 * Modül satırına tıklanınca o modülü en çok kullanan şubeler açılır.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Card, Col, Empty, Row, Segmented, Select, Space, Spin, Tooltip, Typography } from "antd";
import { Activity, BarChart3, ChevronDown, ChevronRight, RefreshCw, Users } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";

const { Text, Paragraph } = Typography;

type Modul = {
  kod: string;
  ad: string;
  kisi: number;
  acilis: number;
  kisiGun: number;
  son: string;
  subeler: { sube: string; kisi: number; acilis: number }[];
};

type Veri = {
  gun: number;
  baslangic: string;
  kayitBaslangici: string | null;
  aktifKisi: number;
  moduller: Modul[];
  gunler: { tarih: string; kisi: number }[];
  subeler: string[];
};

const YESIL = "#5f8c10";
const ACIK = "#e3efcf";

export default function ModulKullanimiGorunumu({ aktifPersonel }: { aktifPersonel?: number }) {
  const { message } = AntdApp.useApp();
  const [gun, setGun] = useState(30);
  const [sube, setSube] = useState<string | undefined>();
  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [acik, setAcik] = useState<string | null>(null);
  const [olcu, setOlcu] = useState<"kisi" | "acilis">("kisi");

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const q = new URLSearchParams({ gun: String(gun) });
      if (sube) q.set("sube", sube);
      setVeri(await api.al<Veri>(`/api/Mobil/ModulKullanimi?${q}`));
    } catch (h: any) {
      message.error(h?.message ?? "Modül kullanımı alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [gun, sube, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  /* Ana sayfa her açılışta sayılıyor; sıralamada ayrı tutulur */
  const moduller = useMemo(() => {
    const l = (veri?.moduller ?? []).filter((m) => m.kod !== "anasayfa");
    return [...l].sort((a, b) => (olcu === "kisi" ? b.kisi - a.kisi || b.acilis - a.acilis : b.acilis - a.acilis || b.kisi - a.kisi));
  }, [veri, olcu]);
  const anaSayfa = veri?.moduller.find((m) => m.kod === "anasayfa");
  const enBuyuk = Math.max(1, ...moduller.map((m) => (olcu === "kisi" ? m.kisi : m.acilis)));
  const gunEnBuyuk = Math.max(1, ...(veri?.gunler ?? []).map((g) => g.kisi));
  const ortalama = veri?.gunler.length ? Math.round(veri.gunler.reduce((t, g) => t + g.kisi, 0) / veri.gunler.length) : 0;

  return (
    <div>
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Personelin Biçen360'ta hangi modülü kullandığı. <b>Kişi</b>: dönemde modülü en az bir kez açan farklı personel;
        <b> açılış</b>: aynı kişinin 15 dakika içindeki tekrarları tek sayılarak toplam kullanım.
        {veri?.kayitBaslangici ? (
          <> Kayıt {dayjs(veri.kayitBaslangici).format("DD.MM.YYYY")} tarihinde başladı; öncesi yok.</>
        ) : (
          <> Kayıt bu güncellemeyle başlıyor; veriler personel uygulamayı kullandıkça birikir.</>
        )}
      </Paragraph>

      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={gun}
          onChange={(v) => setGun(Number(v))}
          options={[
            { label: "Bugün", value: 1 },
            { label: "7 gün", value: 7 },
            { label: "30 gün", value: 30 },
            { label: "90 gün", value: 90 },
          ]}
        />
        <Select
          allowClear
          showSearch
          placeholder="Tüm şubeler"
          style={{ width: 220 }}
          value={sube}
          onChange={setSube}
          options={(veri?.subeler ?? []).map((x) => ({ value: x, label: x }))}
        />
        <Segmented
          value={olcu}
          onChange={(v) => setOlcu(v as any)}
          options={[
            { label: "Kişiye göre", value: "kisi" },
            { label: "Açılışa göre", value: "acilis" },
          ]}
        />
        <Button icon={<RefreshCw size={14} />} onClick={getir} loading={yukleniyor}>
          Yenile
        </Button>
      </Space>

      <Spin spinning={yukleniyor && !veri}>
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card size="small" style={{ height: "100%" }}>
              <Space align="start">
                <Users size={20} color={YESIL} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9086" }}>DÖNEMDE KULLANAN</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: YESIL, fontVariantNumeric: "tabular-nums" }}>
                    {veri?.aktifKisi ?? 0}
                  </div>
                  {aktifPersonel && !sube ? (
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      aktif personelin %{Math.round(((veri?.aktifKisi ?? 0) * 100) / aktifPersonel)}'i
                    </Text>
                  ) : null}
                </div>
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={16}>
            <Card size="small" style={{ height: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "#8a9086" }}>
                <span>GÜNLÜK KULLANAN KİŞİ</span>
                <span>ortalama {ortalama}</span>
              </div>
              {veri?.gunler.length ? (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 64, marginTop: 6 }}>
                  {veri.gunler.map((g) => (
                    <Tooltip key={g.tarih} title={`${dayjs(g.tarih).format("DD.MM ddd")} · ${g.kisi} kişi`}>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 3,
                          height: `${Math.max(4, (g.kisi * 100) / gunEnBuyuk)}%`,
                          background: YESIL,
                          borderRadius: "3px 3px 0 0",
                          opacity: 0.85,
                        }}
                      />
                    </Tooltip>
                  ))}
                </div>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Henüz veri yok.
                </Text>
              )}
            </Card>
          </Col>
        </Row>

        <Card
          size="small"
          title={
            <span>
              <BarChart3 size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
              En çok kullanılan modüller
            </span>
          }
          extra={
            anaSayfa && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                <Activity size={12} style={{ verticalAlign: -1 }} /> Ana sayfa: {anaSayfa.kisi} kişi · {anaSayfa.acilis} açılış
              </Text>
            )
          }
        >
          {moduller.length === 0 ? (
            <Empty description="Bu dönemde kayıt yok" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            moduller.map((m, i) => {
              const deger = olcu === "kisi" ? m.kisi : m.acilis;
              const ac = acik === m.kod;
              return (
                <div key={m.kod} style={{ borderTop: i ? "1px solid #eef1ea" : undefined }}>
                  <div
                    onClick={() => setAcik(ac ? null : m.kod)}
                    style={{ display: "grid", gridTemplateColumns: "22px 190px 1fr 150px", gap: 10, alignItems: "center", padding: "8px 4px", cursor: "pointer" }}
                  >
                    <span style={{ color: "#8a9086" }}>{ac ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#8a9086", fontWeight: 600, marginRight: 6, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                      {m.ad}
                    </span>
                    <div style={{ background: ACIK, borderRadius: 6, height: 14, overflow: "hidden" }}>
                      <div style={{ width: `${(deger * 100) / enBuyuk}%`, background: YESIL, height: "100%", borderRadius: 6 }} />
                    </div>
                    <span style={{ fontSize: 12.5, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <b>{m.kisi}</b> kişi · {m.acilis} açılış
                    </span>
                  </div>
                  {ac && (
                    <div style={{ padding: "0 4px 10px 36px" }}>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        Son kullanım {dayjs(m.son).format("DD.MM.YYYY HH:mm")} · kişi başı ortalama{" "}
                        {(m.acilis / Math.max(1, m.kisi)).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} açılış
                      </Text>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {m.subeler.map((x) => (
                          <span
                            key={x.sube}
                            onClick={() => setSube(x.sube)}
                            style={{ fontSize: 12, background: "#f4f6f2", border: "1px solid #e4e8df", borderRadius: 999, padding: "2px 10px", cursor: "pointer" }}
                          >
                            {x.sube} · <b>{x.kisi}</b> kişi
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </Card>
      </Spin>
    </div>
  );
}
