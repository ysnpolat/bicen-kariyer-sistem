/**
 * ---------------------------------------------------------------------------
 * Yapay Zekâ İncelemesi
 * ---------------------------------------------------------------------------
 * Görsel modelin gerçek bir insan fotoğrafı bulamadığı başvurular burada
 * bekler. Kayıtlar silinmez: model yanılmış olabilir.
 *
 * İK fotoğrafa bakar, gerçek bir aday ise başvurulara aktarır; sahte ise
 * işaretler ve izleri kalıcı kara listeye geçer.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Popconfirm,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  Ban,
  BrainCircuit,
  Check,
  FileText,
  MapPin,
  Phone,
  RefreshCw,
} from "lucide-react";

import FormOnizleme from "./FormOnizleme";
import { API_TABAN, api, islemYetkisi, oturumOku } from "./api";

const { Text, Paragraph } = Typography;

export default function YapayZekaIncelemesi() {
  const { message } = AntdApp.useApp();

  const yetkim = islemYetkisi(oturumOku());

  const [yukleniyor, setYukleniyor] = useState(false);
  const [veri, setVeri] = useState<any>(null);
  const [kapsam, setKapsam] = useState<"bekleyen" | "tumu">("bekleyen");
  const [islemde, setIslemde] = useState<number | null>(null);

  /* Başvuru formu önizlemesi */
  const [formVeri, setFormVeri] = useState<any>(null);
  const [formYukleniyor, setFormYukleniyor] = useState(false);

  /* Toplu gönderim koruması durumu */
  const [koruma, setKoruma] = useState<any>(null);

  const korumaGetir = useCallback(async () => {
    try {
      setKoruma(await api.al<any>("/api/Basvuru/KorumaDurumu"));
    } catch {
      setKoruma(null);
    }
  }, []);

  useEffect(() => {
    korumaGetir();
  }, [korumaGetir]);

  const korumayiKapat = async () => {
    try {
      await api.gonder("/api/Basvuru/KorumayiKapat", {});
      message.success("Koruma kapatıldı.");
      korumaGetir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setVeri(
        await api.al<any>(
          `/api/Basvuru/Engellenenler?tumu=${kapsam === "tumu"}`
        )
      );
    } catch (hata: any) {
      message.error(hata.message);
      setVeri(null);
    } finally {
      setYukleniyor(false);
    }
  }, [kapsam, message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const fotografAdresi = (id: number) => {
    const oturum = oturumOku();
    if (!oturum) return "";

    return `${API_TABAN}/api/Basvuru/Engellenen/${id}/Fotograf?t=${encodeURIComponent(
      oturum.token
    )}`;
  };

  /** Başvurunun tamamını gösterir */
  const formuAc = async (kayit: any) => {
    setFormYukleniyor(true);
    setFormVeri({ kayit, veri: null });

    try {
      const d = await api.al<any>(`/api/Basvuru/Engellenen/${kayit.id}/Form`);

      setFormVeri({
        kayit,
        ayrinti: d,
        veri: JSON.parse(d.veriJson || "{}"),
      });
    } catch (hata: any) {
      message.error(hata.message);
      setFormVeri(null);
    } finally {
      setFormYukleniyor(false);
    }
  };

  const aktar = async (kayit: any) => {
    setIslemde(kayit.id);

    try {
      await api.gonder(`/api/Basvuru/Engellenen/${kayit.id}/Aktar`, {});
      message.success(`${kayit.adSoyad} başvurulara aktarıldı.`);
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIslemde(null);
    }
  };

  const sahteIsaretle = async (kayit: any) => {
    setIslemde(kayit.id);

    try {
      await api.gonder(`/api/Basvuru/Engellenen/${kayit.id}/Sahte`, {});
      message.success("Sahte olarak işaretlendi, izler kara listeye alındı.");
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setIslemde(null);
    }
  };

  const kayitlar = veri?.kayitlar ?? [];

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Bu sayfa ne gösterir?"
        description="Görsel modelin gerçek bir insan fotoğrafı bulamadığı başvurular burada bekler. Kayıtlar silinmez; model yanılmış olabilir. Fotoğrafa bakıp gerçek bir aday ise başvurulara aktarabilir, sahte ise işaretleyebilirsiniz. Sahte işaretlenen kayıtların fotoğraf ve form izleri kalıcı kara listeye geçer."
      />

      {koruma?.korumaliKip && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Korumalı kip açık"
          description={
            <div style={{ fontSize: 13 }}>
              Kısa sürede çok sayıda başvuru geldiği için yeni başvurular
              doğrudan kayda geçmiyor, bu sayfaya alınıyor.
              {koruma.sebep && <> Sebep: {koruma.sebep}.</>}
              {koruma.korumaBitis && (
                <>
                  {" "}
                  Kendiliğinden{" "}
                  {dayjs(koruma.korumaBitis).format("HH:mm")} sularında
                  kapanacak.
                </>
              )}
            </div>
          }
          action={
            yetkim && (
              <Button size="small" onClick={korumayiKapat}>
                Şimdi kapat
              </Button>
            )
          }
        />
      )}

      <Card size="small" className="rp-filtre">
        <Space
          style={{ width: "100%", justifyContent: "space-between" }}
          wrap
        >
          <Segmented
            value={kapsam}
            onChange={(v) => setKapsam(v as "bekleyen" | "tumu")}
            options={[
              {
                label: (
                  <Space size={6}>
                    Bekleyenler
                    {veri?.bekleyen > 0 && (
                      <Badge
                        count={veri.bekleyen}
                        style={{ backgroundColor: "#E8481C" }}
                      />
                    )}
                  </Space>
                ),
                value: "bekleyen",
              },
              { label: "Tümü", value: "tumu" },
            ]}
          />

          <Button
            icon={<RefreshCw size={15} strokeWidth={2} />}
            onClick={getir}
          >
            Yenile
          </Button>
        </Space>
      </Card>

      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : kayitlar.length === 0 ? (
        <Card size="small">
          <Empty
            description={
              kapsam === "bekleyen"
                ? "Bekleyen inceleme yok."
                : "Henüz engellenen başvuru yok."
            }
          />
        </Card>
      ) : (
        <Row gutter={[12, 12]}>
          {kayitlar.map((k: any) => (
            <Col xs={24} md={12} xl={8} key={k.id}>
              <Card
                size="small"
                className={`yz-kart${k.incelendi ? " yz-kart-incelendi" : ""}`}
              >
                <div className="yz-ust">
                  <img
                    className="yz-resim"
                    src={fotografAdresi(k.id)}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />

                  <div className="yz-kimlik">
                    <Text strong style={{ fontSize: 14 }}>
                      {k.adSoyad || "—"}
                    </Text>

                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {k.basvuruNo}
                    </Text>

                    <Space size={4} style={{ marginTop: 4 }}>
                      <Phone size={12} strokeWidth={2} color="#8a8f98" />
                      <Text style={{ fontSize: 12.5 }}>{k.telefon || "—"}</Text>
                    </Space>
                  </div>
                </div>

                <div className="yz-gerekce">
                  <Space size={6} align="start">
                    <BrainCircuit
                      size={14}
                      strokeWidth={2}
                      color="#722ed1"
                      style={{ flex: "0 0 auto", marginTop: 2 }}
                    />
                    <span>{k.aiGerekce || "Gerekçe belirtilmemiş"}</span>
                  </Space>

                  {k.aiGuven > 0 && (
                    <Tooltip title="Modelin kararından ne kadar emin olduğu">
                      <Tag
                        color={k.aiGuven >= 90 ? "red" : "orange"}
                        style={{ marginInlineEnd: 0 }}
                      >
                        %{k.aiGuven}
                      </Tag>
                    </Tooltip>
                  )}
                </div>

                <div className="yz-bilgi">
                  {k.subeAdi && (
                    <span>
                      <MapPin size={11} strokeWidth={2} /> {k.subeAdi}
                    </span>
                  )}
                  {k.bolumler && <span>{k.bolumler}</span>}
                  <span>{dayjs(k.olusturma).format("DD.MM.YYYY HH:mm")}</span>
                </div>

                <Button
                  size="small"
                  type="link"
                  style={{ padding: 0, height: "auto", marginTop: 8 }}
                  icon={<FileText size={13} strokeWidth={2} />}
                  onClick={() => formuAc(k)}
                >
                  Başvuru formunu gör
                </Button>

                
                {k.incelendi ? (
                  <div className="yz-sonuc">
                    {k.aktarildi ? (
                      <Tag color="green">Başvurulara aktarıldı</Tag>
                    ) : (
                      <Tag>Sahte olarak işaretlendi</Tag>
                    )}
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      {k.inceleyen}
                    </Text>
                  </div>
                ) : (
                  yetkim && (
                    <Space size={6} style={{ marginTop: 10 }}>
                      <Popconfirm
                        title="Başvurulara aktarılsın mı?"
                        description="Gerçek bir aday olduğunu onaylıyorsunuz."
                        okText="Aktar"
                        cancelText="Vazgeç"
                        onConfirm={() => aktar(k)}
                      >
                        <Button
                          size="small"
                          type="primary"
                          loading={islemde === k.id}
                          icon={<Check size={14} strokeWidth={2} />}
                        >
                          Gerçek, aktar
                        </Button>
                      </Popconfirm>

                      <Popconfirm
                        title="Sahte olarak işaretlensin mi?"
                        description="Fotoğraf ve form izleri kalıcı kara listeye alınacak."
                        okText="İşaretle"
                        cancelText="Vazgeç"
                        onConfirm={() => sahteIsaretle(k)}
                      >
                        <Button
                          size="small"
                          danger
                          loading={islemde === k.id}
                          icon={<Ban size={14} strokeWidth={2} />}
                        >
                          Sahte
                        </Button>
                      </Popconfirm>
                    </Space>
                  )
                )}
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* ----------------------------------------------- form önizlemesi */}
      <Drawer
        open={!!formVeri}
        onClose={() => setFormVeri(null)}
        width="min(900px, 96vw)"
        className="rp-cekmece"
        title={
          formVeri && (
            <Space size={8}>
              <FileText size={16} strokeWidth={2} />
              <Text strong>{formVeri.kayit.adSoyad || "Başvuru Formu"}</Text>
              <Tag>{formVeri.kayit.basvuruNo}</Tag>
            </Space>
          )
        }
        footer={
          formVeri && !formVeri.kayit.incelendi && yetkim ? (
            <Space style={{ float: "right" }}>
              <Popconfirm
                title="Sahte olarak işaretlensin mi?"
                okText="İşaretle"
                cancelText="Vazgeç"
                onConfirm={() => {
                  sahteIsaretle(formVeri.kayit);
                  setFormVeri(null);
                }}
              >
                <Button danger icon={<Ban size={14} strokeWidth={2} />}>
                  Sahte
                </Button>
              </Popconfirm>

              <Popconfirm
                title="Başvurulara aktarılsın mı?"
                okText="Aktar"
                cancelText="Vazgeç"
                onConfirm={() => {
                  aktar(formVeri.kayit);
                  setFormVeri(null);
                }}
              >
                <Button type="primary" icon={<Check size={14} strokeWidth={2} />}>
                  Gerçek, aktar
                </Button>
              </Popconfirm>
            </Space>
          ) : null
        }
      >
        {formYukleniyor ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : formVeri?.veri ? (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14 }}
              message={`Yapay zekâ kararı: ${formVeri.ayrinti?.aiGerekce ?? "—"}`}
              description={
                <span style={{ fontSize: 12.5 }}>
                  Güven: %{formVeri.ayrinti?.aiGuven ?? 0} · Adres:{" "}
                  {formVeri.ayrinti?.gonderenIp ?? "—"}
                  <br />
                  Tarayıcı: {formVeri.ayrinti?.tarayici ?? "—"}
                </span>
              }
            />

            <Card size="small" className="ik-onizleme">
              <FormOnizleme basvuru={formVeri.veri} />
            </Card>
          </>
        ) : null}
      </Drawer>

      {kayitlar.length > 0 && (
        <Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
        >
          Model erişilemediğinde denetim yapılmaz ve başvurular normal akışına
          devam eder; gerçek adayların engellenmemesi önceliklidir.
        </Paragraph>
      )}
    </>
  );
}
