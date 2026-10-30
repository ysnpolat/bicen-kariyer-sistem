/**
 * ---------------------------------------------------------------------------
 * Gösterge Paneli
 * ---------------------------------------------------------------------------
 * Arıza kayıtlarının ve envanterin tek ekranda özeti.
 *
 * Grafikler el yazımı SVG. Bir grafik kütüphanesi eklemek, yayın akışına
 * her seferinde bağımlılık kurulumu sokuyordu ve ihtiyacımız iki basit
 * çizimden ibaret: halka ve çubuk.
 *
 * Veri tek uçtan geliyor; kutu başına ayrı istek, sayıların birbirine göre
 * tutarsız anlar yaşamasına yol açıyordu.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import dayjs from "dayjs";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Wrench,
} from "lucide-react";

import { api } from "../api";
import { RENK } from "../sabitler";
import { Cubuk, Halka, Satirlar } from "../Grafik";

const { Text } = Typography;

/* -------------------------------------------------------------------------- */

const DURUM_RENKLERI: Record<string, string> = {
  acik: "#e8481c",
  islemde: "#1a4d80",
  beklemede: "#d48806",
  cozuldu: "#7cb518",
  kapandi: "#9aa3af",
};

const DURUM_ADLARI: Record<string, string> = {
  acik: "Açık",
  islemde: "İşlemde",
  beklemede: "Beklemede",
  cozuldu: "Çözüldü",
  kapandi: "Kapandı",
};

/* ========================================================================== */

export default function Pano({
  birim = "bt",
  git,
}: {
  birim?: string;
  /* Sayfa geçişi dışarıdan veriliyor: pano adres yapısını bilmiyor,
     yalnızca nereye gidileceğini söylüyor. */
  git?: (kod: string, ek?: Record<string, string>) => void;
}) {
  const [veri, setVeri] = useState<any>(null);
  const [gun, setGun] = useState(30);
  const [yukleniyor, setYukleniyor] = useState(true);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      /* Bölüm sunucudan geliyor; ileride muhasebe ve satın alma kendi
         panolarını görecek. Şimdilik varsayılan bilgi teknolojileri. */
      setVeri(await api.getir<any>(`Pano?gun=${gun}&birim=${birim}`));
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Pano alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [gun, birim]);

  useEffect(() => {
    getir();
  }, [getir]);

  if (yukleniyor && !veri)
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );

  /* Hazırlanmamış bölüm panosu: boş kutular yerine açık bir not */
  if (veri && veri.hazir === false)
    return (
      <Empty
        style={{ padding: 60 }}
        description={veri.mesaj ?? "Bu bölümün gösterge paneli hazırlanıyor."}
      />
    );

  const a = veri?.ariza ?? {};
  const e = veri?.envanter ?? {};

  const dilimler = ["acik", "islemde", "beklemede", "cozuldu", "kapandi"]
    .map((k) => ({
      kod: k,
      ad: DURUM_ADLARI[k],
      deger: a[k] ?? 0,
      renk: DURUM_RENKLERI[k],
    }))
    .filter((x) => x.deger > 0);

  return (
    <div className="pn-sayfa">
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 14 }} wrap>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Arıza kayıtları ve envanterin özeti. Durum sayıları her zamanki
          toplamı, kırılımlar seçilen dönemi gösterir.
        </Text>

        <Segmented
          value={gun}
          onChange={(d) => setGun(Number(d))}
          options={[
            { value: 7, label: "7 gün" },
            { value: 30, label: "30 gün" },
            { value: 90, label: "90 gün" },
          ]}
        />
      </Space>

      {/* ----------------------------------------------------------- kutular */}
      <Row gutter={[14, 14]}>
        <Kutu
          ad="Açık kayıt"
          deger={(a.acik ?? 0) + (a.islemde ?? 0) + (a.beklemede ?? 0)}
          alt="çözülmemiş"
          renk="#e8481c"
          simge={<Wrench size={20} strokeWidth={2} />}
          bas={() => git?.("ariza", { durum: "acik" })}
        />

        <Kutu
          ad="Geciken"
          deger={a.geciken ?? 0}
          alt="süresi aşılmış"
          renk="#cf1322"
          simge={<AlertTriangle size={20} strokeWidth={2} />}
          uyari={(a.geciken ?? 0) > 0}
          bas={() => git?.("ariza", { sla: "gecikti" })}
        />

        <Kutu
          ad="Ortalama çözüm"
          deger={a.ortalamaSaat ?? "—"}
          alt={a.ortalamaSaat ? "saat" : "veri yok"}
          renk="#1a4d80"
          simge={<Clock size={20} strokeWidth={2} />}
        />

        <Kutu
          ad="Çözülen"
          deger={(a.cozuldu ?? 0) + (a.kapandi ?? 0)}
          alt="toplam"
          renk={RENK.yesilKoyu}
          simge={<CheckCircle2 size={20} strokeWidth={2} />}
          bas={() => git?.("ariza", { durum: "kapanmis" })}
        />
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        {/* ------------------------------------------------------- durum */}
        <Col xs={24} lg={9}>
          <Card size="small" title="Durum dağılımı" style={{ height: "100%" }}>
            {dilimler.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kayıt yok." />
            ) : (
              <Halka dilimler={dilimler} />
            )}
          </Card>
        </Col>

        {/* ------------------------------------------------------ eğilim */}
        <Col xs={24} lg={15}>
          <Card size="small" title={`Günlük kayıt (${gun} gün)`} style={{ height: "100%" }}>
            <Cubuk
              kayitlar={(veri?.egilim ?? []).map((x: any) => ({
                etiket: dayjs(x.gun).format("DD.MM"),
                deger: x.adet,
              }))}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        {/* -------------------------------------------------- departman */}
        <Col xs={24} lg={12}>
          <Card size="small" title="Departmanlara göre açık kayıt">
            {(veri?.departmanlar ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kayıt yok." />
            ) : (
              <Satirlar
                kayitlar={(veri.departmanlar ?? []).map((d: any) => ({
                  ad: d.departman ?? "Atanmamış",
                  deger: d.acik ?? 0,
                  yan: `${d.toplam ?? 0} toplam`,
                  bas: () =>
                    git?.("ariza", { departman: d.departman ?? "" }),
                }))}
                renk="#1a4d80"
              />
            )}
          </Card>
        </Col>

        {/* ------------------------------------------------------- şube */}
        <Col xs={24} lg={12}>
          <Card size="small" title="En çok kayıt açan şubeler">
            {(veri?.subeler ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kayıt yok." />
            ) : (
              <Satirlar
                kayitlar={(veri.subeler ?? []).map((s: any) => ({
                  ad: s.sube,
                  deger: s.adet,
                  bas: () => git?.("ariza", { sube: s.sube }),
                }))}
                renk={RENK.yesil}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        {/* --------------------------------------------------- envanter */}
        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={
              <Space size={8}>
                <Boxes size={16} strokeWidth={2} />
                Envanter
              </Space>
            }
          >
            <Row gutter={[10, 10]}>
              <Col xs={8}>
                <div
                  className="pn-mini pn-tiklanir"
                  onClick={() => git?.("envanter", { durum: "aktif" })}
                >
                  <span>Aktif cihaz</span>
                  <b>{e.toplam ?? 0}</b>
                </div>
              </Col>

              <Col xs={8}>
                <Tooltip title="Garantisi 30 gün içinde bitecek cihazlar">
                  <div
                    className="pn-mini pn-tiklanir"
                    onClick={() => git?.("envanter", { garanti: "bitiyor" })}
                  >
                    <span>Garanti bitiyor</span>
                    <b style={{ color: "#d48806" }}>{e.garantiBitiyor ?? 0}</b>
                  </div>
                </Tooltip>
              </Col>

              <Col xs={8}>
                <Tooltip title="Planlanan bakım tarihi geçmiş cihazlar">
                  <div
                    className="pn-mini pn-tiklanir"
                    onClick={() => git?.("envanter", { bakim: "gecikti" })}
                  >
                    <span>Bakım gecikti</span>
                    <b style={{ color: "#cf1322" }}>{e.bakimGecti ?? 0}</b>
                  </div>
                </Tooltip>
              </Col>
            </Row>

            <div style={{ marginTop: 12 }}>
              {(e.turler ?? []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Cihaz yok." />
              ) : (
                <Satirlar
                  kayitlar={(e.turler ?? []).slice(0, 6).map((t: any) => ({
                    ad: t.tur,
                    deger: t.adet,
                    bas: () => git?.("envanter", { tur: t.tur }),
                  }))}
                  renk="#722ed1"
                />
              )}
            </div>
          </Card>
        </Col>

        {/* ------------------------------------------------ son kayıtlar */}
        <Col xs={24} lg={14}>
          <Card size="small" title="Son arıza kayıtları">
            {(veri?.sonKayitlar ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kayıt yok." />
            ) : (
              <div className="pn-liste">
                {veri.sonKayitlar.map((k: any) => (
                  <div
                    className={`pn-satir${git ? " pn-tiklanir" : ""}`}
                    key={k.id}
                    onClick={() => git?.("ariza", { kayit: String(k.id) })}
                  >
                    <div
                      className="pn-nokta"
                      style={{ background: DURUM_RENKLERI[k.durum] ?? "#9aa3af" }}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pn-baslik">{k.baslik}</div>
                      <div className="pn-kunye">
                        {k.subeKodu ? `${k.subeKodu} · ` : ""}
                        {k.departman ?? "Atanmamış"}
                        {k.acanAdi ? ` · ${k.acanAdi}` : ""}
                      </div>
                    </div>

                    <Space direction="vertical" size={2} align="end">
                      <Tag color={k.oncelik === "yuksek" ? "red" : "default"}>
                        {DURUM_ADLARI[k.durum] ?? k.durum}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        {dayjs(k.olusturma).format("DD.MM HH:mm")}
                      </Text>
                    </Space>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

/* ========================================================================== */

function Kutu({
  ad,
  deger,
  alt,
  renk,
  simge,
  uyari,
  bas,
}: {
  ad: string;
  deger: number | string;
  alt: string;
  renk: string;
  simge: React.ReactNode;
  uyari?: boolean;
  bas?: () => void;
}) {
  return (
    <Col xs={12} md={6}>
      <Card
        size="small"
        className={`pn-kutu${uyari ? " pn-kutu-uyari" : ""}${
          bas ? " pn-tiklanir" : ""
        }`}
        onClick={bas}
      >
        <div className="pn-kutu-ic">
          <div className="pn-kutu-simge" style={{ background: `${renk}18`, color: renk }}>
            {simge}
          </div>

          <div>
            <div className="pn-kutu-ad">{ad}</div>
            <div className="pn-kutu-deger" style={{ color: renk }}>
              {deger}
            </div>
            <div className="pn-kutu-alt">{alt}</div>
          </div>
        </div>
      </Card>
    </Col>
  );
}
