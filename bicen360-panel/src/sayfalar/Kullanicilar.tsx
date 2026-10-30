/**
 * Kullanıcılar
 * ---------------------------------------------------------------------------
 * Portal kullanıcıları. Hesaplar Kariyer sistemiyle ortak; buradan açılan
 * kullanıcı için iki ek karar var:
 *
 *  - İK paneline de girebilsin mi. Kapalıysa yalnızca portala giriyor;
 *    İK panelinde parolası doğru olsa bile reddediliyor.
 *  - Şube kullanıcısı mı. Depo kodu girilince hesap o şubeye kilitleniyor
 *    ve portalda yalnızca o şubenin arıza, envanter, fiyat ve rakip fiyat
 *    verisini görüyor. Kilit sunucuda; ekrandaki seçiciyi gizlemek yetmez.
 *
 * Sicil girilince kişinin adı, görevi, şubesi, pozisyon grubu ve temsilci
 * olduğu departmanlar kendiliğinden geliyor. Mağaza personeliyse şubesinin
 * depo kodu da öneriliyor.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Input,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { KeyRound, Search, Store, UserPlus, Building2, ShieldCheck } from "lucide-react";

import { api } from "../api";
import { RENK } from "../sabitler";

/* -------------------------------------------------------------------------- */

interface Kullanici {
  id: number;
  kullaniciAdi: string;
  adSoyad: string;
  eposta: string | null;
  rol: string;
  aktif: boolean;
  sicil: string | null;
  ikErisim: boolean;
  depoNo: number | null;
  subeKodu: string | null;
  subeAdi: string | null;
  temsilcilikler: string[];
}

interface Secenekler {
  roller: string[];
  departmanlar: { id: number; ad: string }[];
  subeler: { subeKodu: string; subeAdi: string; depoNo: number }[];
}

/* ========================================================================== */

export default function Kullanicilar() {
  const [liste, setListe] = useState<Kullanici[]>([]);
  const [secenek, setSecenek] = useState<Secenekler | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [ara, setAra] = useState("");
  const [suzgec, setSuzgec] = useState("hepsi");
  const [duzenlenen, setDuzenlenen] = useState<Partial<Kullanici> | null>(null);

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const [l, s] = await Promise.all([
        api.getir<{ kullanicilar: Kullanici[] }>("Kullanici"),
        api.getir<Secenekler>("Kullanici/Secenekler"),
      ]);

      setListe(l.kullanicilar ?? []);
      setSecenek(s);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kullanıcılar alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  const q = ara.trim().toLocaleLowerCase("tr");

  const gorunen = liste.filter((k) => {
    if (suzgec === "portal" && k.ikErisim) return false;
    if (suzgec === "sube" && !k.subeKodu) return false;
    if (suzgec === "pasif" && k.aktif) return false;
    if (suzgec !== "pasif" && suzgec !== "hepsi" && !k.aktif) return false;

    if (!q) return true;

    return `${k.adSoyad} ${k.kullaniciAdi} ${k.sicil ?? ""} ${k.subeAdi ?? ""} ${k.rol}`
      .toLocaleLowerCase("tr")
      .includes(q);
  });

  const sayi = {
    hepsi: liste.length,
    portal: liste.filter((k) => k.aktif && !k.ikErisim).length,
    sube: liste.filter((k) => k.aktif && k.subeKodu).length,
    pasif: liste.filter((k) => !k.aktif).length,
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card size="small">
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Space wrap>
            <Input
              allowClear
              prefix={<Search size={15} />}
              placeholder="Ad, kullanıcı adı, sicil ya da şube"
              style={{ width: 300 }}
              value={ara}
              onChange={(e) => setAra(e.target.value)}
            />

            <Segmented
              value={suzgec}
              onChange={(d) => setSuzgec(String(d))}
              options={[
                { value: "hepsi", label: `Tümü (${sayi.hepsi})` },
                { value: "portal", label: `Yalnızca portal (${sayi.portal})` },
                { value: "sube", label: `Şube kullanıcısı (${sayi.sube})` },
                { value: "pasif", label: `Pasif (${sayi.pasif})` },
              ]}
            />
          </Space>

          <Button
            type="primary"
            icon={<UserPlus size={16} />}
            style={{ background: RENK.yesil }}
            onClick={() => setDuzenlenen({ aktif: true, ikErisim: false })}
          >
            Yeni kullanıcı
          </Button>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={yukleniyor}
        dataSource={gorunen}
        size="middle"
        pagination={{ pageSize: 25, showSizeChanger: false }}
        onRow={(k) => ({ onClick: () => setDuzenlenen(k), style: { cursor: "pointer" } })}
        columns={[
          {
            title: "Kullanıcı",
            render: (_: unknown, k: Kullanici) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong style={{ opacity: k.aktif ? 1 : 0.5 }}>
                  {k.adSoyad}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {k.kullaniciAdi}
                  {k.sicil ? ` · sicil ${k.sicil}` : ""}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: "Rol",
            dataIndex: "rol",
            width: 170,
            render: (d: string) => <Tag>{d}</Tag>,
          },
          {
            title: "Erişim",
            width: 200,
            render: (_: unknown, k: Kullanici) => (
              <Space size={4} wrap>
                <Tag color="green">Portal</Tag>
                {k.ikErisim ? (
                  <Tag color="blue">İK paneli</Tag>
                ) : (
                  <Tooltip title="İK paneline giriş reddedilir">
                    <Tag>İK kapalı</Tag>
                  </Tooltip>
                )}
              </Space>
            ),
          },
          {
            title: "Kapsam",
            width: 220,
            render: (_: unknown, k: Kullanici) =>
              k.subeKodu ? (
                <Tag color="orange" icon={<Store size={11} style={{ marginRight: 4 }} />}>
                  {k.subeAdi ?? k.subeKodu}
                  {k.depoNo ? ` · ${k.depoNo}` : ""}
                </Tag>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Bütün şubeler
                </Typography.Text>
              ),
          },
          {
            title: "Temsilcilik",
            render: (_: unknown, k: Kullanici) =>
              k.temsilcilikler.length ? (
                <Space size={4} wrap>
                  {k.temsilcilikler.map((d) => (
                    <Tag key={d} color="purple">
                      {d}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  —
                </Typography.Text>
              ),
          },
          {
            title: "Durum",
            dataIndex: "aktif",
            width: 90,
            render: (d: boolean) => (d ? <Tag color="green">Aktif</Tag> : <Tag>Pasif</Tag>),
          },
        ]}
      />

      {duzenlenen && secenek && (
        <KullaniciCekmecesi
          kullanici={duzenlenen}
          secenek={secenek}
          kapat={() => setDuzenlenen(null)}
          kaydedildi={() => {
            setDuzenlenen(null);
            getir();
          }}
        />
      )}
    </Space>
  );
}

/* ========================================================================== */

/**
 * Kullanıcı açma / düzenleme.
 *
 * Sicil girilince kişi bilgileri personel kaydından doluyor: ad soyad,
 * görev, şube, grup ve temsilcilikler. Aynı sicille hesap varsa uyarıyor.
 * Şube kullanıcısı seçilince depo kodu isteniyor ve şube adı anında
 * gösteriliyor; yanlış depo koduyla hesap açılmasın.
 */
function KullaniciCekmecesi({
  kullanici,
  secenek,
  kapat,
  kaydedildi,
}: {
  kullanici: Partial<Kullanici>;
  secenek: Secenekler;
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const yeni = !kullanici.id;

  const [f, setF] = useState({
    kullaniciAdi: kullanici.kullaniciAdi ?? "",
    adSoyad: kullanici.adSoyad ?? "",
    eposta: kullanici.eposta ?? "",
    rol: kullanici.rol ?? "",
    aktif: kullanici.aktif ?? true,
    sicil: kullanici.sicil ?? "",
    ikErisim: kullanici.ikErisim ?? false,
    subeModu: !!kullanici.subeKodu,
    depoNo: kullanici.depoNo ?? (null as number | null),
    parola: "",
  });

  const [kisi, setKisi] = useState<any>(null);
  const [kisiHata, setKisiHata] = useState<string | null>(null);
  const [sorgulaniyor, setSorgulaniyor] = useState(false);

  const [depoSube, setDepoSube] = useState<string | null>(
    kullanici.subeAdi ?? kullanici.subeKodu ?? null
  );
  const [depoHata, setDepoHata] = useState<string | null>(null);

  /* Temsilcilikler: sicil sorgulanınca doluyor; dokunulmazsa sunucuya
     gönderilmiyor ki başka ekrandan verilenler silinmesin. */
  const [temsilcilik, setTemsilcilik] = useState<number[] | null>(null);

  const [kaydediliyor, setKaydediliyor] = useState(false);

  const alan = (k: string, d: any) => setF((x) => ({ ...x, [k]: d }));

  /* ----------------------------------------------------- sicil sorgusu */

  const sicilSorgula = async (sicil: string, otomatikDoldur: boolean) => {
    const s = sicil.trim();

    if (!s) return;

    setSorgulaniyor(true);
    setKisiHata(null);

    try {
      const c = await api.getir<any>(`Kullanici/Sicil/${encodeURIComponent(s)}`);

      setKisi(c);
      setTemsilcilik(c.temsilcilikler ?? []);

      if (otomatikDoldur) {
        setF((x) => ({
          ...x,
          adSoyad: x.adSoyad || c.adSoyad,
          kullaniciAdi: x.kullaniciAdi || s,
        }));
      }
    } catch (h) {
      setKisi(null);
      setKisiHata(h instanceof Error ? h.message : "Personel bulunamadı.");
    } finally {
      setSorgulaniyor(false);
    }
  };

  /* Düzenlemede kayıtlı sicil kendiliğinden sorgulanıyor */
  useEffect(() => {
    if (kullanici.sicil) sicilSorgula(kullanici.sicil, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------- depo kodu */

  useEffect(() => {
    if (!f.subeModu || !f.depoNo) {
      setDepoHata(null);
      return;
    }

    const zamanlayici = setTimeout(async () => {
      try {
        const c = await api.getir<any>(`Kullanici/Depo/${f.depoNo}`);
        setDepoSube(c.subeAdi ?? c.subeKodu);
        setDepoHata(null);
      } catch (h) {
        setDepoSube(null);
        setDepoHata(h instanceof Error ? h.message : "Depo bulunamadı.");
      }
    }, 300);

    return () => clearTimeout(zamanlayici);
  }, [f.subeModu, f.depoNo]);

  const onerilen = kisi?.onerilenSube;

  const cakisan =
    kisi?.mevcutKullanici && kisi.mevcutKullanici.id !== kullanici.id
      ? kisi.mevcutKullanici
      : null;

  /* --------------------------------------------------------- kaydet */

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("Kullanici", {
        id: kullanici.id ?? 0,
        kullaniciAdi: f.kullaniciAdi,
        adSoyad: f.adSoyad,
        eposta: f.eposta,
        rol: f.rol,
        aktif: f.aktif,
        sicil: f.sicil || null,
        ikErisim: f.ikErisim,
        subeModu: f.subeModu,
        depoNo: f.subeModu ? f.depoNo : null,
        parola: f.parola || null,
        temsilcilikler: temsilcilik,
      });

      message.success(yeni ? "Kullanıcı açıldı." : "Kullanıcı güncellendi.");
      kaydedildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const eksik =
    !f.kullaniciAdi.trim() ||
    !f.adSoyad.trim() ||
    !f.rol ||
    (yeni && !f.parola) ||
    (f.subeModu && (!f.depoNo || !!depoHata)) ||
    !!cakisan;

  /* Özet: kaydetmeden önce hesabın ne olacağını düz cümleyle söylüyor */
  const ozet = useMemo(
    () => [
      f.ikErisim ? "Portala ve İK paneline girer." : "Yalnızca portala girer; İK paneli reddeder.",
      f.subeModu
        ? `Portalda yalnızca ${depoSube ?? "seçilen şube"} verisini görür.`
        : "Portalda şube kısıtı yok; sayfa yetkisi neyi açıyorsa onu görür.",
      temsilcilik && temsilcilik.length
        ? `${temsilcilik.length} departmanın temsilcisi: o departmanlara açılan kayıtlar ona düşer.`
        : null,
    ].filter(Boolean) as string[],
    [f.ikErisim, f.subeModu, depoSube, temsilcilik]
  );

  return (
    <Drawer
      open
      width={640}
      onClose={kapat}
      title={yeni ? "Yeni kullanıcı" : `${kullanici.adSoyad} · düzenle`}
      extra={
        <Button
          type="primary"
          loading={kaydediliyor}
          disabled={eksik}
          onClick={kaydet}
          style={{ background: eksik ? undefined : RENK.yesil }}
        >
          Kaydet
        </Button>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {/* ------------------------------------------------- personel */}
        <Card size="small" title="Personel">
          <Typography.Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 8 }}>
            Sicil numarasını girin; ad, görev, şube, grup ve temsilcilikler
            personel kaydından gelir.
          </Typography.Text>

          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="Sicil numarası"
              value={f.sicil}
              onChange={(e) => alan("sicil", e.target.value)}
              onPressEnter={() => sicilSorgula(f.sicil, true)}
            />
            <Button loading={sorgulaniyor} onClick={() => sicilSorgula(f.sicil, true)}>
              Getir
            </Button>
          </Space.Compact>

          {kisiHata && <Alert style={{ marginTop: 10 }} type="error" showIcon message={kisiHata} />}

          {cakisan && (
            <Alert
              style={{ marginTop: 10 }}
              type="warning"
              showIcon
              message={`Bu sicille zaten bir hesap var: ${cakisan.kullaniciAdi}`}
              description="Aynı kişiye ikinci hesap açılmıyor. Mevcut hesabı listeden açıp düzenleyin."
            />
          )}

          {kisi && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                background: "#f7faf2",
                border: "1px solid #e3ecd6",
              }}
            >
              <Typography.Text strong style={{ fontSize: 15 }}>
                {kisi.adSoyad}
              </Typography.Text>
              <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 2 }}>
                {kisi.pozisyon} · {kisi.sube}
              </div>

              <Space size={4} wrap style={{ marginTop: 8 }}>
                {kisi.grup ? (
                  <Tag color="cyan">Grup: {kisi.grup}</Tag>
                ) : (
                  <Tag color="orange">Gruba bağlı değil</Tag>
                )}
                {(kisi.temsilcilikler ?? []).length > 0 ? (
                  secenek.departmanlar
                    .filter((d) => kisi.temsilcilikler.includes(d.id))
                    .map((d) => (
                      <Tag key={d.id} color="purple">
                        {d.ad} temsilcisi
                      </Tag>
                    ))
                ) : (
                  <Tag>Temsilcilik yok</Tag>
                )}
              </Space>
            </div>
          )}
        </Card>

        {/* -------------------------------------------------- hesap */}
        <Card size="small" title="Hesap">
          <Row gutter={10}>
            <Col span={12}>
              <Typography.Text style={{ fontSize: 12.5 }}>Ad soyad</Typography.Text>
              <Input value={f.adSoyad} onChange={(e) => alan("adSoyad", e.target.value)} />
            </Col>
            <Col span={12}>
              <Typography.Text style={{ fontSize: 12.5 }}>Kullanıcı adı</Typography.Text>
              <Input
                value={f.kullaniciAdi}
                onChange={(e) => alan("kullaniciAdi", e.target.value)}
                placeholder="Genelde sicil numarası"
              />
            </Col>
          </Row>

          <Row gutter={10} style={{ marginTop: 10 }}>
            <Col span={12}>
              <Typography.Text style={{ fontSize: 12.5 }}>Rol</Typography.Text>
              <Select
                style={{ width: "100%" }}
                value={f.rol || undefined}
                placeholder="Rol seçiniz"
                onChange={(d) => alan("rol", d)}
                options={secenek.roller.map((r) => ({ value: r, label: r }))}
                showSearch
              />
            </Col>
            <Col span={12}>
              <Typography.Text style={{ fontSize: 12.5 }}>E-posta</Typography.Text>
              <Input value={f.eposta} onChange={(e) => alan("eposta", e.target.value)} />
            </Col>
          </Row>

          <div style={{ marginTop: 10 }}>
            <Typography.Text style={{ fontSize: 12.5 }}>
              {yeni ? "Parola" : "Yeni parola (değiştirmeyecekseniz boş bırakın)"}
            </Typography.Text>
            <Input.Password
              prefix={<KeyRound size={14} />}
              value={f.parola}
              onChange={(e) => alan("parola", e.target.value)}
              placeholder="En az 8 karakter, harf ve rakam"
            />
          </div>

          <Space style={{ marginTop: 12 }}>
            <Switch checked={f.aktif} onChange={(d) => alan("aktif", d)} />
            <Typography.Text>{f.aktif ? "Aktif" : "Pasif — giriş yapamaz"}</Typography.Text>
          </Space>
        </Card>

        {/* ------------------------------------------------ erişim */}
        <Card size="small" title="Erişim">
          <div
            onClick={() => alan("ikErisim", !f.ikErisim)}
            style={{
              cursor: "pointer",
              border: `1.5px solid ${f.ikErisim ? "#1a4d80" : "#e3e6e1"}`,
              background: f.ikErisim ? "#eef4fb" : "#fff",
              borderRadius: 10,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <ShieldCheck size={22} color={f.ikErisim ? "#1a4d80" : "#9aa3af"} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>İK paneline de erişsin</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Kapalıysa yalnızca portala girer. İK panelinde parolası doğru
                olsa bile "bu hesabın İK paneline erişimi yok" mesajıyla
                reddedilir.
              </div>
            </div>
            <Switch checked={f.ikErisim} />
          </div>

          <Divider style={{ margin: "14px 0" }} />

          <Segmented
            block
            value={f.subeModu ? "sube" : "merkez"}
            onChange={(d) => alan("subeModu", d === "sube")}
            options={[
              {
                value: "merkez",
                label: (
                  <Space>
                    <Building2 size={14} /> Genel merkez / bütün şubeler
                  </Space>
                ),
              },
              {
                value: "sube",
                label: (
                  <Space>
                    <Store size={14} /> Şube kullanıcısı
                  </Space>
                ),
              },
            ]}
          />

          {f.subeModu && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text style={{ fontSize: 12.5 }}>Depo kodu</Typography.Text>

              <Space.Compact style={{ width: "100%" }}>
                <InputNumber
                  style={{ width: 160 }}
                  min={1}
                  value={f.depoNo ?? undefined}
                  onChange={(d) => alan("depoNo", d ?? null)}
                  placeholder="Örn. 12"
                  status={depoHata ? "error" : undefined}
                />
                <Input
                  readOnly
                  value={depoHata ? "" : depoSube ?? ""}
                  placeholder="Şube adı depo kodundan gelir"
                  style={{ fontWeight: 600, color: depoHata ? undefined : "#5f8c10" }}
                />
              </Space.Compact>

              {depoHata && (
                <Alert style={{ marginTop: 8 }} type="error" showIcon message={depoHata} />
              )}

              {onerilen && onerilen.depoNo && f.depoNo !== onerilen.depoNo && (
                <Button
                  size="small"
                  type="link"
                  style={{ paddingLeft: 0, marginTop: 4 }}
                  onClick={() => alan("depoNo", onerilen.depoNo)}
                >
                  Personelin şubesini kullan: {onerilen.subeAdi ?? onerilen.subeKodu} · {onerilen.depoNo}
                </Button>
              )}

              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
                Portalda arıza kayıtları, envanter, fiyat kontrol, rakip fiyat
                ve raporlar yalnızca bu şube için açılır; başka şube
                seçilemez.
              </Typography.Text>
            </div>
          )}
        </Card>

        {/* ------------------------------------------- temsilcilikler */}
        <Card size="small" title="Departman temsilciliği">
          {!f.sicil.trim() ? (
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              Temsilcilik sicile bağlı. Önce sicil girin.
            </Typography.Text>
          ) : temsilcilik === null ? (
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              Sicili sorguladığınızda mevcut temsilcilikler burada görünür.
            </Typography.Text>
          ) : (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 8 }}>
                Temsilci, departmanına açılan kayıtları görür ve durumlarını
                değiştirir. Arıza kategorilerinde otomatik atanacak kişi de
                temsilciler arasından seçiliyor.
              </Typography.Text>

              <Select
                mode="multiple"
                allowClear
                style={{ width: "100%" }}
                placeholder="Temsilcisi olduğu departmanlar"
                value={temsilcilik}
                onChange={setTemsilcilik}
                options={secenek.departmanlar.map((d) => ({ value: d.id, label: d.ad }))}
                optionFilterProp="label"
              />
            </>
          )}
        </Card>

        {/* ----------------------------------------------------- özet */}
        <Alert
          type="info"
          showIcon
          message="Bu hesap kaydedilince"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ozet.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          }
        />

        {sorgulaniyor && <Spin />}
      </Space>
    </Drawer>
  );
}
