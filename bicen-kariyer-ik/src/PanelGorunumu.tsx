/**
 * ---------------------------------------------------------------------------
 * Yönetim → Panel Görünümü
 * ---------------------------------------------------------------------------
 * Kenar menünün üstündeki marka bloğu: başlık, alt başlık ve logo rozeti
 * (harf rozeti, yüklenen görsel ya da kurum logosu).
 *
 * Değişiklikler önce sağdaki önizlemede görünür (koyu, açık ve dar menü);
 * Kaydet'e basılınca herkesin menüsüne geçer. Yüklenen görsel de
 * kaydedilene kadar menüde görünmez.
 *
 * Kurum logosu (e-postalar ve aday sayfası) buradan değiştirilmiyor;
 * yüklenen menü logosu ayrı yerde tutuluyor.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  ColorPicker,
  Input,
  Popconfirm,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from "antd";
import { Check, ImageUp, Palette, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";

import { api, oturumOku, type Oturum } from "./api";
import "./PanelGorunumu.css";
import { MarkaBlogu } from "./KenarMenu";
import {
  EN_UZUN,
  HAZIR_RENKLER,
  VARSAYILAN_GORUNUM,
  gorunumDuzelt,
  menuLogoAdresi,
  panelGorunumAyarla,
  rozetRenkleri,
  type GorselZemin,
  type LogoTuru,
  type PanelGorunum,
} from "./panelGorunum";

const { Text } = Typography;

/** Sunucudaki [Authorize(Roles = …)] ile aynı liste */
export const gorunumDuzenleyebilir = (o: Oturum | null) =>
  ["Admin", "GenelMudurYardimcisi", "IKYoneticisi"].includes(o?.rol ?? "");

const LOGO_SINIRI = 1024 * 1024;
const LOGO_TURLERI = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_UZANTILARI = /\.(png|jpe?g|webp|svg)$/i;

/* ========================================================================== */
/* Önizleme                                                                    */
/* ========================================================================== */

function Onizleme({
  gorunum,
  tema,
  dar = false,
  etiket,
}: {
  gorunum: PanelGorunum;
  tema: "koyu" | "acik";
  dar?: boolean;
  etiket: string;
}) {
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <aside
        className={`km km-onizleme ${tema === "acik" ? "km-acik" : "km-koyu"}${dar ? " km-dar" : ""}`}
        style={{ width: dar ? 76 : "100%", maxWidth: dar ? 76 : 272 }}
        aria-label={`Önizleme: ${etiket}`}
      >
        <MarkaBlogu gorunum={gorunum} />
        {/* Altındaki menüyü andıran çizgiler: oran ve boşluk görünsün */}
        <div className="km-onizleme-cizgi" style={{ width: dar ? 40 : undefined }} />
        <div className="km-onizleme-cizgi" style={{ width: dar ? 40 : "62%" }} />
        <div className="km-onizleme-cizgi" style={{ width: dar ? 40 : "74%", marginBottom: 16 }} />
      </aside>
      <figcaption style={{ fontSize: 12, color: "#7b8577", textAlign: dar ? "center" : "left" }}>
        {etiket}
      </figcaption>
    </figure>
  );
}

/* ========================================================================== */
/* Ekran                                                                       */
/* ========================================================================== */

export default function PanelGorunumu() {
  const { message } = AntdApp.useApp();
  const duzenleyebilir = gorunumDuzenleyebilir(oturumOku());

  const [kayitli, setKayitli] = useState<PanelGorunum | null>(null);
  const [form, setForm] = useState<PanelGorunum>(VARSAYILAN_GORUNUM);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [siliniyor, setSiliniyor] = useState(false);

  useEffect(() => {
    api
      .al<unknown>("/api/PanelGorunum")
      .then((d) => {
        const g = gorunumDuzelt(d);
        setKayitli(g);
        setForm(g);
      })
      .catch((h: any) => {
        message.error(h.message);
        setKayitli(VARSAYILAN_GORUNUM);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const degisti = useMemo(
    () => !!kayitli && JSON.stringify(form) !== JSON.stringify(kayitli),
    [form, kayitli]
  );

  if (!kayitli) return <Spin />;

  const degis = (d: Partial<PanelGorunum>) => setForm((f) => ({ ...f, ...d }));

  /* Önizleme için: başlık boşsa sunucu varsayılanı yazacak */
  const onizlenen: PanelGorunum = {
    ...form,
    baslik: form.baslik.trim() || VARSAYILAN_GORUNUM.baslik,
    altBaslik: form.altBaslik.trim(),
    harf: form.harf.trim() || VARSAYILAN_GORUNUM.harf,
  };

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      const c = await api.gonder<{ ayar: unknown }>("/api/PanelGorunum", {
        ...form,
        baslik: form.baslik.trim(),
        altBaslik: form.altBaslik.trim(),
        harf: form.harf.trim(),
      });
      const g = gorunumDuzelt(c.ayar);

      setKayitli(g);
      setForm(g);
      panelGorunumAyarla(g);
      message.success("Panel görünümü kaydedildi.");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const gorselYukle = async (dosya: File) => {
    const turUygun = LOGO_TURLERI.includes(dosya.type) || LOGO_UZANTILARI.test(dosya.name);

    if (!turUygun) {
      message.error("PNG, JPG, WebP ya da SVG yükleyiniz.");
      return;
    }

    if (dosya.size > LOGO_SINIRI) {
      message.error("Logo en fazla 1 MB olabilir.");
      return;
    }

    setYukleniyor(true);

    try {
      const veri = new FormData();
      veri.append("dosya", dosya);

      const c = await api.dosyaGonder<{ logoSurum: number }>("/api/PanelGorunum/Logo", veri);

      degis({ logoSurum: c.logoSurum, logoTuru: "gorsel" });
      message.success("Görsel yüklendi. Menüde görünmesi için kaydediniz.");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  };

  const gorselSil = async () => {
    setSiliniyor(true);

    try {
      const c = await api.sil<{ ayar: unknown }>("/api/PanelGorunum/Logo");
      const g = gorunumDuzelt(c.ayar);

      setKayitli(g);
      panelGorunumAyarla(g);
      setForm((f) => ({
        ...f,
        logoSurum: 0,
        logoTuru: f.logoTuru === "gorsel" ? "harf" : f.logoTuru,
      }));
      message.success("Menü logosu silindi.");
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setSiliniyor(false);
    }
  };

  /* Yüklenmiş görsel varsayılana dönüşte silinmiyor; istenirse yine seçilebilir */
  const sifirla = () => {
    setForm({ ...VARSAYILAN_GORUNUM, logoSurum: form.logoSurum });
    message.info("Varsayılan görünüm yüklendi. Geçerli olması için kaydediniz.");
  };

  const [r1, r2] = rozetRenkleri(form);

  return (
    <Row gutter={[16, 16]} className="pg">
      {/* ----------------------------------------------------------- form */}
      <Col xs={24} xl={13}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {!duzenleyebilir && (
            <Alert type="info" showIcon message="Bu ayarları yalnızca yönetici ve İK yöneticisi değiştirebilir." />
          )}

          <Card size="small" title="Başlık">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <div>
                <Text strong>Başlık</Text>
                <Input
                  value={form.baslik}
                  maxLength={EN_UZUN}
                  showCount
                  placeholder={VARSAYILAN_GORUNUM.baslik}
                  onChange={(e) => degis({ baslik: e.target.value })}
                  disabled={!duzenleyebilir}
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Text strong>Alt başlık</Text>
                <Input
                  value={form.altBaslik}
                  maxLength={EN_UZUN}
                  showCount
                  allowClear
                  placeholder="Boş bırakılırsa alt satır gösterilmez"
                  onChange={(e) => degis({ altBaslik: e.target.value })}
                  disabled={!duzenleyebilir}
                  style={{ marginTop: 4 }}
                />
              </div>
            </Space>
          </Card>

          <Card size="small" title="Logo">
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Segmented<LogoTuru>
                block
                value={form.logoTuru}
                onChange={(v) => degis({ logoTuru: v })}
                disabled={!duzenleyebilir}
                options={[
                  { value: "harf", label: "Harf rozeti" },
                  { value: "gorsel", label: "Yüklenen görsel" },
                  { value: "kurum", label: "Kurum logosu" },
                ]}
              />

              {form.logoTuru === "harf" && (
                <>
                  <div>
                    <Text strong>Rozetteki harf</Text>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                      <Input
                        value={form.harf}
                        maxLength={2}
                        placeholder={VARSAYILAN_GORUNUM.harf}
                        onChange={(e) => degis({ harf: e.target.value })}
                        disabled={!duzenleyebilir}
                        style={{ width: 72, textAlign: "center", fontWeight: 800 }}
                        aria-label="Rozetteki harf"
                      />
                      <Text type="secondary">1–2 karakter</Text>
                    </div>
                  </div>

                  <div>
                    <Text strong>Renk</Text>
                    <div className="pg-renkler" role="radiogroup" aria-label="Rozet rengi">
                      {HAZIR_RENKLER.map((r) => {
                        const secili = form.renk === r.ad;

                        return (
                          <button
                            key={r.ad}
                            type="button"
                            role="radio"
                            aria-checked={secili}
                            className={`pg-renk${secili ? " pg-secili" : ""}`}
                            title={r.etiket}
                            disabled={!duzenleyebilir}
                            onClick={() => degis({ renk: r.ad, renk1: null, renk2: null })}
                          >
                            <span
                              className="pg-renk-ornek"
                              style={{ background: `linear-gradient(135deg, ${r.renk[0]}, ${r.renk[1]})` }}
                            >
                              {secili && <Check size={16} strokeWidth={3} aria-hidden />}
                            </span>
                            <span className="pg-renk-ad">{r.etiket}</span>
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        role="radio"
                        aria-checked={form.renk === "ozel"}
                        className={`pg-renk${form.renk === "ozel" ? " pg-secili" : ""}`}
                        title="Özel renk"
                        disabled={!duzenleyebilir}
                        onClick={() => degis({ renk: "ozel", renk1: r1, renk2: r2 })}
                      >
                        <span className="pg-renk-ornek pg-renk-ozel">
                          {form.renk === "ozel" ? (
                            <Check size={16} strokeWidth={3} aria-hidden />
                          ) : (
                            <Palette size={16} strokeWidth={2} aria-hidden />
                          )}
                        </span>
                        <span className="pg-renk-ad">Özel</span>
                      </button>
                    </div>

                    {form.renk === "ozel" && (
                      <Space wrap style={{ marginTop: 10 }}>
                        <ColorPicker
                          value={form.renk1 ?? r1}
                          disabledAlpha
                          showText
                          disabled={!duzenleyebilir}
                          onChange={(c) => degis({ renk1: c.toHexString().slice(0, 7) })}
                        />
                        <Text type="secondary">→</Text>
                        <ColorPicker
                          value={form.renk2 ?? r2}
                          disabledAlpha
                          showText
                          disabled={!duzenleyebilir}
                          onChange={(c) => degis({ renk2: c.toHexString().slice(0, 7) })}
                        />
                      </Space>
                    )}
                  </div>
                </>
              )}

              {form.logoTuru === "gorsel" && (
                <div className="pg-gorsel">
                  <div className="pg-gorsel-kutu">
                    {form.logoSurum > 0 ? (
                      <img src={menuLogoAdresi(form.logoSurum)} alt="Yüklenen menü logosu" />
                    ) : (
                      <ImageUp size={22} strokeWidth={1.8} color="#9aa48f" aria-hidden />
                    )}
                  </div>

                  <Space direction="vertical" size={6}>
                    <Space wrap>
                      <Upload
                        accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                        showUploadList={false}
                        disabled={!duzenleyebilir}
                        beforeUpload={(f) => {
                          gorselYukle(f);
                          return false;
                        }}
                      >
                        <Button icon={<ImageUp size={15} strokeWidth={2} />} loading={yukleniyor} disabled={!duzenleyebilir}>
                          {form.logoSurum > 0 ? "Başka görsel seç" : "Görsel seç"}
                        </Button>
                      </Upload>

                      {form.logoSurum > 0 && (
                        <Popconfirm
                          title="Menü logosu silinsin mi?"
                          description="Menü görselle gösteriliyorsa harf rozetine döner."
                          okText="Sil"
                          cancelText="Vazgeç"
                          okButtonProps={{ danger: true }}
                          onConfirm={gorselSil}
                          disabled={!duzenleyebilir}
                        >
                          <Button danger icon={<Trash2 size={15} strokeWidth={2} />} loading={siliniyor} disabled={!duzenleyebilir}>
                            Sil
                          </Button>
                        </Popconfirm>
                      )}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12.5 }}>
                      PNG, JPG, WebP ya da SVG · en fazla 1 MB · kare görsel en iyi sonucu verir.
                      <br />
                      Kurum logosundan ayrıdır; e-postalardaki logo değişmez.
                    </Text>
                  </Space>
                </div>
              )}

              {form.logoTuru === "kurum" && (
                <Alert
                  type="info"
                  showIcon
                  message="E-postalarda ve aday sayfasında kullanılan kurum logosu gösterilir."
                  description="Bu logo buradan değiştirilmez. Farklı bir menü logosu için “Yüklenen görsel”i seçiniz."
                />
              )}

              {form.logoTuru !== "harf" && (
                <div>
                  <Text strong>Zemin</Text>
                  <div style={{ marginTop: 4 }}>
                    <Segmented<GorselZemin>
                      value={form.gorselZemin}
                      onChange={(v) => degis({ gorselZemin: v })}
                      disabled={!duzenleyebilir}
                      options={[
                        { value: "beyaz", label: "Beyaz kutu" },
                        { value: "seffaf", label: "Şeffaf" },
                      ]}
                    />
                  </div>
                  <Text type="secondary" style={{ fontSize: 12.5 }}>
                    Koyu menüde koyu renkli logolar için beyaz kutu önerilir.
                  </Text>
                </div>
              )}
            </Space>
          </Card>

          {duzenleyebilir && (
            <Space wrap>
              <Button
                type="primary"
                icon={<Save size={15} strokeWidth={2} />}
                loading={kaydediliyor}
                disabled={!degisti}
                onClick={kaydet}
              >
                Kaydet
              </Button>
              <Button icon={<Undo2 size={15} strokeWidth={2} />} disabled={!degisti} onClick={() => setForm(kayitli)}>
                Değişiklikleri geri al
              </Button>
              <Popconfirm
                title="Varsayılan görünüme dönülsün mü?"
                description="“Biçen İK”, yeşil “b” rozeti. Kaydedince geçerli olur."
                okText="Sıfırla"
                cancelText="Vazgeç"
                onConfirm={sifirla}
              >
                <Button icon={<RotateCcw size={15} strokeWidth={2} />}>Sıfırla</Button>
              </Popconfirm>
            </Space>
          )}
        </Space>
      </Col>

      {/* ------------------------------------------------------- önizleme */}
      <Col xs={24} xl={11}>
        <Card
          size="small"
          title="Önizleme"
          extra={degisti ? <Tag color="orange">Kaydedilmedi</Tag> : <Tag color="green">Kayıtlı</Tag>}
          style={{ position: "sticky", top: 80 }}
        >
          <div className="pg-onizleme">
            <Onizleme gorunum={onizlenen} tema="koyu" etiket="Koyu menü" />
            <Onizleme gorunum={onizlenen} tema="acik" etiket="Açık menü" />
          </div>
          <div className="pg-onizleme pg-onizleme-dar">
            <Onizleme gorunum={onizlenen} tema="koyu" dar etiket="Dar · koyu" />
            <Onizleme gorunum={onizlenen} tema="acik" dar etiket="Dar · açık" />
            <Text type="secondary" style={{ fontSize: 12.5, alignSelf: "center" }}>
              Dar menüde yalnızca rozet görünür.
            </Text>
          </div>
        </Card>
      </Col>
    </Row>
  );
}
