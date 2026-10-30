/**
 * ---------------------------------------------------------------------------
 * Yetkiler
 * ---------------------------------------------------------------------------
 * Kimin hangi sayfayı ve hangi mobil modülü göreceği.
 *
 * Ekran eskiden tek tek çalışıyordu: bir rol seç, tabloyu doldur, kaydet,
 * sonraki role geç. "Hangi görevde hangi modül açık" sorusunun cevabı hiçbir
 * yerde bir arada görünmüyordu ve otuz küsur pozisyon için otuz küsur tur
 * atmak gerekiyordu. Artık tek matris: satırlar roller/pozisyonlar/kişiler,
 * sütunlar sayfalar/modüller. Hücreye tıklandıkça durum dönüyor, sonda tek
 * kaydetme.
 *
 * Üç durum şart: **tanımsız** ile **kapalı** farklı şeyler. Tanımsız olan alt
 * katmana düşer, kapalı olan düşmez. İki durumlu bir anahtarla kişiye özel
 * kapatma diye bir şey olmazdı.
 *
 * Varsayılanlar da ters: panelde tanımsız sayfa kapalıdır (yeni bir sayfa
 * eklendiğinde herkese açılmasın), mobilde tanımsız modül açıktır (yeni bir
 * modül kimsenin göremediği hâlde kalmasın).
 * ---------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { Check, Minus, RotateCcw, Search, X } from "lucide-react";
import Bolgeler from "./Bolgeler";

import { api } from "../api";

import { RENK } from "../sabitler";

/* -------------------------------------------------------------------------- */

interface KatalogGirdisi {
  kod: string;
  ad: string;
  aciklama: string;

  /** portal · yetki · ik — satırın nasıl davranacağını belirler */
  kaynak?: string;

  /** Tanımsızken açık mı (23.10.2026: yeni modüller kapalı) */
  varsayilan?: boolean;
}

interface KullaniciSatiri {
  kullaniciAdi: string;
  adSoyad: string;
  rol: string;
}

interface KatalogCevabi {
  sayfalar: KatalogGirdisi[];
  moduller: KatalogGirdisi[];
  kullanicilar: KullaniciSatiri[];
  roller: string[];
  pozisyonlar: string[];

  /** Pozisyon grupları; ünvanların ortak yetki kümesi */
  gruplar: string[];
}

/** Üç durumlu değer: tanımsız (alt katmana düşer), açık, kapalı. */
type Durum = "tanimsiz" | "acik" | "kapali";

/** anahtar → kod → durum */
type Matris = Record<string, Record<string, Durum>>;

interface Anahtar {
  deger: string;
  ad: string;
  alt?: string;
}

const SIRA: Durum[] = ["tanimsiz", "acik", "kapali"];

const tr = (d: string) => (d ?? "").toLocaleLowerCase("tr");

/** Dar ekran (telefon): matris yerine kart listesi */
function useDar(sinir = 760) {
  const [dar, setDar] = useState(() => typeof window !== "undefined" && window.innerWidth <= sinir);
  useEffect(() => {
    const f = () => setDar(window.innerWidth <= sinir);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [sinir]);
  return dar;
}

/** Segmented telefonda taşmasın: yatay kayar */
const Kaydir = ({ children }: { children: React.ReactNode }) => (
  <div className="b3-kaydir">{children}</div>
);

const ORTAK_CSS = `
  .b3-lejant .ant-space-item { white-space: nowrap; }
  .b3-kaydir { max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
  .b3-kaydir .ant-segmented { white-space: nowrap; }
  .b3-yetki .b3-kart-satir { border: 1px solid #e6e8e3; border-radius: 12px; background: #fff; overflow: hidden; }
  .b3-yetki .b3-sabit-kaydet { position: sticky; bottom: 0; z-index: 3; background: #fff; border-top: 1px solid #e6e8e3; padding: 10px; display: flex; gap: 8px; box-shadow: 0 -6px 16px #0000000d; width: 100%; }
  @media (max-width: 760px) {
    .b3-yetki .ant-tabs-tab { padding: 8px 0; font-size: 13px; }
    .b3-yetki .ant-card-body { padding: 10px; }
  }
`;

/* ========================================================================== */

export default function Yetkiler() {
  const [katalog, setKatalog] = useState<KatalogCevabi | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  /* İki ayrı dünya: panelde kim hangi sayfayı görür, mobilde kim hangi
     modülü görür. Aynı sekme şeridinde altı seçenek yan yana duruyordu ve
     hangisinin nereye etki ettiği karışıyordu. */
  const [bolum, setBolum] = useState<"mobil" | "panel">("mobil");

  /* mobil: grup · kisi · altmenu */
  const [mobilGorunum, setMobilGorunum] = useState("grup");

  /* panel: rol · kullanici */
  const [panelGorunum, setPanelGorunum] = useState("rol");

  /* portal · kariyer · yetki */
  const [kodKumesi, setKodKumesi] = useState("portal");

  /* Grubun kapsadığı ünvanlar da tutuluyor: "grup yetkisi uygulanmıyor"
     şikâyetinin sebebi çoğu zaman ünvanın gruba bağlı olmaması. */
  const [gruplar, setGruplar] = useState<GrupKaydi[]>([]);

  /* Grup penceresi: yeni grup için boş, düzenleme için grubun kendisi */
  const [grupFormu, setGrupFormu] = useState<GrupKaydi | "yeni" | null>(null);

  /* Grubun sorumluluk, kapsam ve onay ayarları: karta tıklayınca açılıyor */
  const [ayarGrubu, setAyarGrubu] = useState<GrupKaydi | null>(null);

  const gruplariGetir = () =>
    api
      .getir<{ gruplar: any[] }>("Yetki/Gruplar")
      .then((c) =>
        setGruplar(
          (c.gruplar ?? []).map((g) => ({
            id: g.id,
            ad: g.ad,
            pozisyonlar: g.pozisyonlar ?? "",
            aktif: g.aktif !== false,
          }))
        )
      )
      .catch(() => setGruplar([]));

  useEffect(() => {
    gruplariGetir();
  }, []);

  useEffect(() => {
    api
      .getir<KatalogCevabi>("Yetki/Katalog")
      .then(setKatalog)
      .catch((h) => setHata(h instanceof Error ? h.message : "Katalog alınamadı."));
  }, []);

  if (hata) return <Alert type="error" message={hata} showIcon />;
  if (!katalog) return <Spin />;

  /* Mobil modül sütunları kaynağa göre ayrılıyor: yirmi sütunu yan yana
     koymak tabloyu yatay kaydırma işkencesine çeviriyordu. */
  const mobilKodlar = katalog.moduller.filter(
    (k) => (k.kaynak ?? "portal") === kodKumesi
  );

  const aktifGruplar = gruplar.filter((g) => g.aktif);

  /* Ünvan → grup eşlemesi: ünvan gruba bağlı değilse ekranda söyleniyor */
  const bagliUnvanlar = new Set(
    aktifGruplar.flatMap((g) =>
      g.pozisyonlar.split(",").map((x) => x.trim().toLocaleLowerCase("tr")).filter(Boolean)
    )
  );

  const bagsizUnvanlar = (katalog.pozisyonlar ?? []).filter(
    (p) => !bagliUnvanlar.has(p.trim().toLocaleLowerCase("tr"))
  );

  const kumeSecici = (
    <Kaydir><Segmented
      value={kodKumesi}
      onChange={(d) => setKodKumesi(String(d))}
      options={[
        {
          value: "portal",
          label: `Mağaza modülleri (${katalog.moduller.filter((k) => (k.kaynak ?? "portal") === "portal").length})`,
        },
        {
          value: "kariyer",
          label: `Özlük modülleri (${katalog.moduller.filter((k) => k.kaynak === "kariyer").length})`,
        },
        {
          value: "yetki",
          label: `Kapsam yetkileri (${katalog.moduller.filter((k) => k.kaynak === "yetki").length})`,
        },
      ]}
    /></Kaydir>
  );

  /* -------------------------------------------------------------- mobil */

  const mobil = (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Kaydir><Segmented
        value={mobilGorunum}
        onChange={(d) => setMobilGorunum(String(d))}
        options={[
          { value: "grup", label: "Gruplar" },
          { value: "kisi", label: "Kişiye özel" },
          { value: "bolge", label: "Bölgeler" },
          { value: "altmenu", label: "Alt menü" },
          { value: "anasayfa", label: "Ana sayfa kartları" },
        ]}
      /></Kaydir>

      {mobilGorunum === "bolge" && <Bolgeler />}

      {mobilGorunum === "altmenu" && <AltMenu />}

      {mobilGorunum === "anasayfa" && <AnaSayfaKartlari />}

      {mobilGorunum === "kisi" && <KisiYetki />}

      {mobilGorunum === "grup" && (
        <>
          <Card size="small">
            <Space
              style={{ width: "100%", justifyContent: "space-between" }}
              wrap
              align="start"
            >
              <Typography.Text type="secondary" style={{ maxWidth: 760, display: "block" }}>
                Mobil uygulamada kimin hangi modülü göreceği gruplardan
                belirlenir. <b>Gruba tıklayınca</b> sorumlulukları, veri
                kapsamı ve onay yetkileri açılır. Bir ünvan yalnızca bir grupta olabilir. Tek bir
                kişi için farklı bir şey gerekiyorsa <b>Kişiye özel</b>{" "}
                sekmesini kullanın. Hiçbir grupta tanımı olmayan modül
                herkese açıktır; Haftalık İzin Onayı ise tanımsızken
                yalnızca müdür ünvanlılara açılır. <b>Yeni eklenen
                modüller</b> (sütunda "varsayılan kapalı" yazar) tanımsızken
                kimseye açılmaz; gruba açıkça verilmelidir.
              </Typography.Text>

              <Button type="primary" onClick={() => setGrupFormu("yeni")}>
                Grup ekle
              </Button>
            </Space>

            {/* Gruplar kart olarak: hangi ünvanları kapsadığı görünsün ve
                tek tıkla düzenlensin. Eskiden bu bilgi yalnızca satırın
                altındaki küçük yazıdaydı. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))",
                gap: 10,
                marginTop: 14,
              }}
            >
              {aktifGruplar.map((g) => {
                const unvanlar = g.pozisyonlar
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean);

                return (
                  <Card
                    key={g.id}
                    size="small"
                    hoverable
                    onClick={() => setAyarGrubu(g)}
                    style={{ borderColor: unvanlar.length === 0 ? "#f5bda8" : undefined }}
                  >
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <Space style={{ width: "100%", justifyContent: "space-between" }}>
                        <Typography.Text strong>{g.ad}</Typography.Text>
                        <Space size={4}>
                          <Tag>{unvanlar.length} ünvan</Tag>
                          <Button
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setGrupFormu(g);
                            }}
                          >
                            Düzenle
                          </Button>
                        </Space>
                      </Space>

                      <Typography.Text
                        type={unvanlar.length === 0 ? "danger" : "secondary"}
                        style={{ fontSize: 12 }}
                        ellipsis={{ tooltip: unvanlar.join(", ") }}
                      >
                        {unvanlar.length === 0
                          ? "Hiçbir ünvan bağlı değil — yetkiler kimseye uygulanmaz"
                          : unvanlar.join(", ")}
                      </Typography.Text>
                    </Space>
                  </Card>
                );
              })}
            </div>

            {bagsizUnvanlar.length > 0 && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message={`${bagsizUnvanlar.length} ünvan hiçbir gruba bağlı değil`}
                description={
                  <span style={{ fontSize: 12.5 }}>
                    Bu ünvanlardaki personel yalnızca varsayılanları ve
                    kişiye özel yetkileri alır:{" "}
                    {bagsizUnvanlar.slice(0, 12).join(", ")}
                    {bagsizUnvanlar.length > 12 ? ` ve ${bagsizUnvanlar.length - 12} tane daha` : ""}
                  </span>
                }
              />
            )}
          </Card>

          {kumeSecici}

          {kodKumesi === "yetki" && (
            <Alert
              type="info"
              showIcon
              message="Bunlar ekran değil, kapsam yetkisi"
              description="Verilen grup o modülde kendi şubesi ya da departmanı yerine bütün kurumu görür. Mobil menüde ayrı bir satır olarak çıkmazlar."
            />
          )}

          {aktifGruplar.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message="Tanımlı grup yok"
              description="Yetki verebilmek için önce grup açıp gruba ünvan bağlayınız."
            />
          ) : (
            <Izgara
              key={`grup-${kodKumesi}`}
              alan="mobil"
              kapsam="grup"
              anahtarlar={aktifGruplar.map((g) => ({
                deger: g.ad,
                ad: g.ad,
                alt: g.pozisyonlar.trim() || "⚠ Bu gruba hiçbir ünvan bağlı değil",
              }))}
              kodlar={mobilKodlar}
              sicilGirisi={false}
              varsayilanAcik
              altKatman={null}
            />
          )}
        </>
      )}
    </Space>
  );

  /* -------------------------------------------------------------- panel */

  const panel = (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Kaydir><Segmented
        value={panelGorunum}
        onChange={(d) => setPanelGorunum(String(d))}
        options={[
          { value: "rol", label: "Rollere göre" },
          { value: "kullanici", label: "Kişiye özel" },
        ]}
      /></Kaydir>

      <Typography.Text type="secondary">
        {panelGorunum === "rol"
          ? "Portalda hangi rolün hangi sayfayı göreceği. Role verilen yetki o roldeki herkes için geçerlidir."
          : "Kişiye verilen tanım rolünkini ezer. Tanımsız bırakılan sayfada rolün yetkisi geçerli olur."}
      </Typography.Text>

      <Izgara
        key={`panel-${panelGorunum}`}
        alan="panel"
        kapsam={panelGorunum}
        anahtarlar={
          panelGorunum === "rol"
            ? katalog.roller.map((r) => ({ deger: r, ad: r }))
            : katalog.kullanicilar.map((k) => ({
                deger: k.kullaniciAdi,
                ad: k.adSoyad,
                alt: `${k.kullaniciAdi} · ${k.rol}`,
              }))
        }
        kodlar={katalog.sayfalar}
        sicilGirisi={false}
        varsayilanAcik={false}
        altKatman={panelGorunum === "kullanici" ? "rolü" : null}
      />
    </Space>
  );

  return (
    <div className="b3-yetki">
      <style>{ORTAK_CSS}</style>
      <Tabs
        activeKey={bolum}
        onChange={(k) => setBolum(k as "mobil" | "panel")}
        items={[
          { key: "mobil", label: "Mobil uygulama yetkileri", children: mobil },
          { key: "panel", label: "Panel yetkileri", children: panel },
        ]}
      />

      {ayarGrubu && (
        <GrupAyarCekmecesi
          grup={ayarGrubu}
          gruplar={aktifGruplar}
          pozisyonlar={katalog.pozisyonlar ?? []}
          yenile={gruplariGetir}
          kapat={() => setAyarGrubu(null)}
        />
      )}

      {grupFormu && (
        <GrupFormu
          mevcut={grupFormu === "yeni" ? null : grupFormu}
          gruplar={aktifGruplar}
          pozisyonlar={katalog.pozisyonlar ?? []}
          kapat={() => setGrupFormu(null)}
          kaydedildi={() => {
            setGrupFormu(null);
            gruplariGetir();
          }}
        />
      )}
    </div>
  );
}

/** Pozisyon grubu kaydı */
interface GrupKaydi {
  id: number;
  ad: string;
  pozisyonlar: string;
  aktif: boolean;
}

/* ========================================================================== */
/* Alt menü                                                                   */
/* ========================================================================== */

/**
 * Mobil alt menüde görünecek modüller.
 *
 * Ayar Kariyer'in form ayarlarında tutuluyor ve mobil uygulama oradan
 * okuyor. Portala kopyalamak veriyi iki yerde tutmak olurdu; bu ekran
 * doğrudan o uca yazıyor, tek kaynak korunuyor.
 */
function AltMenu() {
  const [veri, setVeri] = useState<any>(null);
  const [secili, setSecili] = useState<string[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = () => {
    setYukleniyor(true);

    api
      .getir<any>("Yetki/AltMenu")
      .then((c) => {
        setVeri(c);
        setSecili(c?.secili ?? []);
      })
      .catch((h) => message.error(h instanceof Error ? h.message : "Alınamadı."))
      .finally(() => setYukleniyor(false));
  };

  useEffect(getir, []);

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("Yetki/AltMenu", { altMenu: secili });
      message.success("Alt menü kaydedildi.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  if (yukleniyor) return <Spin />;

  const enFazla = veri?.enFazla ?? 4;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Uygulamanın altındaki sekmeler"
        description={
          <>
            Ana Sayfa ve Diğer her zaman vardır; buradan en fazla{" "}
            <b>{enFazla} modül</b> seçebilirsiniz. Seçilmeyenler Diğer
            sekmesinde listelenir. Modülün görünmesi için kişide o modülün
            yetkisi de açık olmalıdır.
          </>
        }
      />

      <Card
        size="small"
        title={`Seçilen: ${secili.length} / ${enFazla}`}
        extra={
          <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
            Kaydet
          </Button>
        }
      >
        <Checkbox.Group
          value={secili}
          onChange={(d) => {
            /* Sınır aşılırsa en eski seçim düşüyor: kullanıcıya
               "önce birini kaldırın" demek fazladan bir adım. */
            const yeni = d as string[];

            setSecili(yeni.length > enFazla ? yeni.slice(-enFazla) : yeni);
          }}
          style={{ width: "100%" }}
        >
          <Row gutter={[8, 10]}>
            {(veri?.adaylar ?? []).map((m: any) => (
              <Col xs={12} md={8} key={m.kod}>
                <Checkbox value={m.kod}>{m.ad}</Checkbox>
              </Col>
            ))}
          </Row>
        </Checkbox.Group>
      </Card>

      <Card size="small" title="Sekme sırası">
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          Sekmeler seçtiğiniz sırayla diziliyor. Sırayı değiştirmek için
          kaldırıp yeniden işaretleyiniz.
        </Typography.Paragraph>

        <Space wrap>
          <Tag color="green">Ana Sayfa</Tag>

          {secili.map((kod) => (
            <Tag key={kod} color="blue">
              {(veri?.adaylar ?? []).find((m: any) => m.kod === kod)?.ad ?? kod}
            </Tag>
          ))}

          <Tag color="green">Diğer</Tag>
        </Space>
      </Card>
    </Space>
  );
}

/* ========================================================================== */
/* Ana sayfa kartları                                                         */
/* ========================================================================== */

/**
 * Ana sayfadaki Biçen Kartım şeridi ve Bu Ay Mesai kutusu: şimdilik
 * kullanılmıyorlar, tek anahtarla herkes için kapalı tutuluyor. Modüller
 * ileride sırayla açılacak.
 */
function AnaSayfaKartlari() {
  const [veri, setVeri] = useState<any>(null);
  const [kartlar, setKartlar] = useState<Record<string, boolean>>({});
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const getir = () => {
    setYukleniyor(true);

    api
      .getir<any>("Yetki/AnaSayfaKartlari")
      .then((c) => {
        setVeri(c);
        setKartlar(c?.kartlar ?? {});
      })
      .catch((h) => message.error(h instanceof Error ? h.message : "Alınamadı."))
      .finally(() => setYukleniyor(false));
  };

  useEffect(getir, []);

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("Yetki/AnaSayfaKartlari", { kartlar });
      message.success("Ana sayfa kartları kaydedildi. Uygulama bir sonraki açılışta uygular.");
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  if (yukleniyor) return <Spin />;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Şimdilik kullanılmayan kartlar"
        description="Biçen Kartım şeridi, Bu Ay Mesai ve Son Prim kutuları bütün personelde birden gizlenir ya da gösterilir. Kapalıyken yetki matrisindeki ayar dikkate alınmaz. Modüller ileride sırayla açılacak."
      />

      <Card
        size="small"
        title="Ana sayfada gösterilecek kartlar"
        extra={
          <Button type="primary" loading={kaydediliyor} onClick={kaydet}>
            Kaydet
          </Button>
        }
      >
        <Space direction="vertical" size="middle">
          {(veri?.secenekler ?? []).map((k: any) => (
            <Space key={k.kod} align="start">
              <Checkbox
                checked={!!kartlar[k.kod]}
                onChange={(e) => setKartlar({ ...kartlar, [k.kod]: e.target.checked })}
              />
              <div>
                <div style={{ fontWeight: 600 }}>
                  {k.ad}{" "}
                  {kartlar[k.kod] ? <Tag color="green">Açık</Tag> : <Tag>Gizli</Tag>}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {k.aciklama}
                </Typography.Text>
              </div>
            </Space>
          ))}
        </Space>
      </Card>
    </Space>
  );
}

/* ========================================================================== */
/* Matris                                                                     */
/* ========================================================================== */

function Izgara({
  alan,
  kapsam,
  anahtarlar,
  kodlar,
  sicilGirisi,
  varsayilanAcik,
  altKatman,
  kilitli,
}: {
  alan: string;
  kapsam: string;
  anahtarlar: Anahtar[];
  kodlar: KatalogGirdisi[];
  sicilGirisi: boolean;
  varsayilanAcik: boolean;
  altKatman: string | null;

  /** Salt görüntüleme: yetkisi başka panelden verilen modüller */
  kilitli?: boolean;
}) {
  const [ilk, setIlk] = useState<Matris>({});
  const [simdi, setSimdi] = useState<Matris>({});
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [ara, setAra] = useState("");

  /* Sicil sekmesinde satırlar tanımlı istisnalardan geliyor; elle eklenenler
     kaydedilene kadar yalnızca burada duruyor. */
  const [ekSatirlar, setEkSatirlar] = useState<string[]>([]);
  const [yeniSicil, setYeniSicil] = useState("");
  const dar = useDar();
  const [acikSatir, setAcikSatir] = useState<string | null>(null);

  /* Modülün tanımsızkenki değeri: yeni modüller kapalı (23.10.2026) */
  const kodVarsayilan = (k: KatalogGirdisi) => (alan === "mobil" ? k.varsayilan !== false && varsayilanAcik : varsayilanAcik);

  const hucre = (satir: Anahtar, k: KatalogGirdisi) => {
    const d = durum(satir.deger, k.kod);
    const kapaliV = d === "tanimsiz" && !altKatman && !kodVarsayilan(k);
    return (
      <span
        className={`b3-hucre ${d}${kapaliV ? " kapaliV" : ""}${kilitli ? " kilitli" : ""}`}
        title={
          kilitli
            ? "Bu modülün yetkisi İK panelinden verilir"
            : d === "tanimsiz"
            ? kapaliV
              ? "Tanımsız — bu modül varsayılanda kapalı"
              : altKatman
              ? `Tanımsız — ${altKatman} geçerli`
              : "Tanımsız — varsayılan açık"
            : undefined
        }
        onClick={() => {
          if (!kilitli) dondur(satir.deger, k.kod);
        }}
      >
        {d === "acik" ? (
          <Check size={15} strokeWidth={2.5} color={RENK.yesilKoyu} />
        ) : d === "kapali" ? (
          <X size={15} strokeWidth={2.5} color="#cf1322" />
        ) : kapaliV ? (
          <X size={13} strokeWidth={2} color="#e8a39b" />
        ) : (
          <Minus size={15} strokeWidth={2} color={RENK.metinPasif} />
        )}
      </span>
    );
  };

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      const c = await api.getir<{
        satirlar: { anahtar: string; kod: string; izin: boolean }[];
      }>(`Yetki/Matris?alan=${alan}&kapsam=${kapsam}`);

      const matris: Matris = {};

      for (const satir of c.satirlar ?? []) {
        matris[satir.anahtar] ??= {};
        matris[satir.anahtar][satir.kod] = satir.izin ? "acik" : "kapali";
      }

      setIlk(matris);
      setSimdi(JSON.parse(JSON.stringify(matris)));
      setEkSatirlar([]);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Yetkiler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [alan, kapsam]);

  useEffect(() => {
    getir();
  }, [getir]);

  const durum = (anahtar: string, kod: string): Durum =>
    simdi[anahtar]?.[kod] ?? "tanimsiz";

  const yaz = (anahtar: string, kod: string, yeni: Durum) =>
    setSimdi((o) => {
      const satir = { ...(o[anahtar] ?? {}) };

      if (yeni === "tanimsiz") delete satir[kod];
      else satir[kod] = yeni;

      return { ...o, [anahtar]: satir };
    });

  const dondur = (anahtar: string, kod: string) => {
    const suan = durum(anahtar, kod);
    yaz(anahtar, kod, SIRA[(SIRA.indexOf(suan) + 1) % SIRA.length]);
  };

  /** Bir satırın ya da sütunun tamamını aynı duruma çeker. */
  const topluYaz = (
    anahtarListesi: string[],
    kodListesi: string[],
    yeni: Durum,
  ) =>
    setSimdi((o) => {
      const kopya = { ...o };

      for (const a of anahtarListesi) {
        const satir = { ...(kopya[a] ?? {}) };

        for (const k of kodListesi) {
          if (yeni === "tanimsiz") delete satir[k];
          else satir[k] = yeni;
        }

        kopya[a] = satir;
      }

      return kopya;
    });

  /* Satırlar: sicil sekmesinde tanımlı olanlar, diğerlerinde katalog. */
  const tumSatirlar: Anahtar[] = useMemo(() => {
    if (!sicilGirisi) return anahtarlar;

    const kimlikler = Array.from(
      new Set([...Object.keys(ilk), ...Object.keys(simdi), ...ekSatirlar]),
    ).filter(Boolean);

    return kimlikler.map((s) => ({ deger: s, ad: s, alt: "Sicil numarası" }));
  }, [sicilGirisi, anahtarlar, ilk, simdi, ekSatirlar]);

  const satirlar = useMemo(() => {
    const k = tr(ara).trim();

    if (!k) return tumSatirlar;

    return tumSatirlar.filter(
      (s) => tr(s.ad).includes(k) || tr(s.alt ?? "").includes(k) || tr(s.deger).includes(k),
    );
  }, [tumSatirlar, ara]);

  /* Değişen anahtarlar: yalnızca bunlar gönderiliyor. */
  const degisenler = useMemo(() => {
    const kume = new Set<string>();

    for (const anahtar of new Set([...Object.keys(ilk), ...Object.keys(simdi)])) {
      const a = ilk[anahtar] ?? {};
      const b = simdi[anahtar] ?? {};

      const kodKumesi = new Set([...Object.keys(a), ...Object.keys(b)]);

      for (const kod of kodKumesi) {
        if (a[kod] !== b[kod]) {
          kume.add(anahtar);
          break;
        }
      }
    }

    return Array.from(kume);
  }, [ilk, simdi]);

  const kaydet = async () => {
    if (degisenler.length === 0) return;

    setKaydediliyor(true);

    try {
      await api.gonder("Yetki/Toplu", {
        alan,
        kapsam,
        satirlar: degisenler.map((anahtar) => ({
          alan,
          kapsam,
          anahtar,

          /* Tanımsız olanlar gönderilmiyor; sunucu listede olmayan kodun
             satırını siliyor ve kod tanımsız hâline dönüyor. */
          yetkiler: Object.fromEntries(
            Object.entries(simdi[anahtar] ?? {}).map(([kod, d]) => [kod, d === "acik"]),
          ),
        })),
      });

      message.success(`${degisenler.length} satır kaydedildi.`);
      getir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const sicilEkle = () => {
    const d = yeniSicil.trim();

    if (!d) return;

    if (tumSatirlar.some((s) => s.deger === d)) {
      message.info("Bu sicil zaten listede.");
    } else {
      setEkSatirlar((o) => [...o, d]);
    }

    setYeniSicil("");
  };

  const sutunMenusu = (kod: string) => ({
    items: [
      { key: "acik", label: "Tümünü aç" },
      { key: "kapali", label: "Tümünü kapat" },
      { key: "tanimsiz", label: "Tümünü tanımsız yap" },
    ],
    onClick: ({ key }: { key: string }) =>
      topluYaz(
        satirlar.map((s) => s.deger),
        [kod],
        key as Durum,
      ),
  });

  const satirMenusu = (anahtar: string) => ({
    items: [
      { key: "acik", label: "Hepsini aç" },
      { key: "kapali", label: "Hepsini kapat" },
      { key: "tanimsiz", label: "Hepsini tanımsız yap" },
    ],
    onClick: ({ key }: { key: string }) =>
      topluYaz([anahtar], kodlar.map((k) => k.kod), key as Durum),
  });

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <style>{`
        .b3-hucre {
          width: 34px; height: 30px; border-radius: 7px;
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer; border: 1px solid ${RENK.cizgi};
          background: #fff; transition: transform .08s;
        }
        .b3-hucre:hover { transform: scale(1.08); }
        .b3-hucre.acik { background: ${RENK.yesilAcik}; border-color: ${RENK.yesil}; }
        .b3-hucre.kapali { background: #fff1f0; border-color: #ffa39e; }
        .b3-hucre.tanimsiz { border-style: dashed; }
        .b3-hucre.tanimsiz.kapaliV { background: #fffafa; border-color: #f3c5c0; }
        .b3-kart-satir { border: 1px solid ${RENK.cizgi}; border-radius: 12px; background: #fff; overflow: hidden; }
        .b3-kart-bas { display: flex; align-items: center; gap: 10px; padding: 11px 12px; cursor: pointer; }
        .b3-kart-bas .ad { font-weight: 600; font-size: 14px; }
        .b3-kart-bas .alt { font-size: 12px; color: ${RENK.metinPasif}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .b3-kart-govde { border-top: 1px solid ${RENK.cizgi}; }
        .b3-kart-mod { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid #f2f3ef; }
        .b3-kart-mod:last-child { border-bottom: 0; }
        .b3-kart-mod .m { flex: 1; min-width: 0; }
        .b3-kart-mod .m b { font-size: 13.5px; font-weight: 500; display: block; }
        .b3-kart-mod .m small { font-size: 11.5px; color: ${RENK.metinPasif}; }
        .b3-sabit-kaydet { position: sticky; bottom: 0; z-index: 3; background: #fff; border-top: 1px solid ${RENK.cizgi}; padding: 10px; display: flex; gap: 8px; margin: 0 -2px; box-shadow: 0 -6px 16px #0000000d; }
        .b3-hucre.kilitli { cursor: not-allowed; opacity: .45; }
        .b3-hucre.kilitli:hover { transform: none; }
      `}</style>

      <Card size="small">
        <Space wrap align="center" style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap align="center">
            <Input
              allowClear
              prefix={<Search size={14} strokeWidth={2} />}
              placeholder="Satırlarda ara"
              style={{ width: dar ? "100%" : 220 }}
              value={ara}
              onChange={(e) => setAra(e.target.value)}
            />

            {sicilGirisi && (
              <Space.Compact>
                <Input
                  placeholder="Sicil numarası"
                  style={{ width: 170 }}
                  value={yeniSicil}
                  onChange={(e) => setYeniSicil(e.target.value)}
                  onPressEnter={sicilEkle}
                />
                <Button onClick={sicilEkle}>Satır ekle</Button>
              </Space.Compact>
            )}

            <Space size={6} wrap className="b3-lejant">
              <span className="b3-hucre acik">
                <Check size={15} strokeWidth={2.5} color={RENK.yesilKoyu} />
              </span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Açık
              </Typography.Text>

              <span className="b3-hucre kapali">
                <X size={15} strokeWidth={2.5} color="#cf1322" />
              </span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Kapalı
              </Typography.Text>

              <span className="b3-hucre tanimsiz">
                <Minus size={15} strokeWidth={2} color={RENK.metinPasif} />
              </span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Tanımsız —{" "}
                {altKatman
                  ? `${altKatman} geçerli`
                  : varsayilanAcik
                  ? "herkese açık"
                  : "kapalı"}
              </Typography.Text>
              {!altKatman && varsayilanAcik && kodlar.some((k) => k.varsayilan === false) && (
                <>
                  <span className="b3-hucre tanimsiz kapaliV">
                    <X size={13} strokeWidth={2} color="#e8a39b" />
                  </span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Tanımsız — yeni modül, kapalı
                  </Typography.Text>
                </>
              )}
            </Space>
          </Space>

          {!dar && <Space>
            {degisenler.length > 0 && (
              <Tooltip title="Kaydedilmemiş değişiklikleri geri al">
                <Button
                  icon={<RotateCcw size={15} strokeWidth={2} />}
                  onClick={() => setSimdi(JSON.parse(JSON.stringify(ilk)))}
                >
                  Geri al
                </Button>
              </Tooltip>
            )}

            <Button
              type="primary"
              disabled={kilitli || degisenler.length === 0}
              loading={kaydediliyor}
              style={{ background: degisenler.length ? RENK.yesil : undefined }}
              onClick={kaydet}
            >
              {degisenler.length > 0
                ? `Kaydet (${degisenler.length} satır)`
                : "Kaydet"}
            </Button>
          </Space>}
        </Space>
      </Card>

      {satirlar.length > 0 && dar ? (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {satirlar.map((satir) => {
            const acik = acikSatir === satir.deger || satirlar.length === 1;
            const acikSay = kodlar.filter((k) => {
              const d = durum(satir.deger, k.kod);
              return d === "acik" || (d === "tanimsiz" && !altKatman && kodVarsayilan(k));
            }).length;
            return (
              <div key={satir.deger} className="b3-kart-satir">
                <div className="b3-kart-bas" onClick={() => setAcikSatir(acik ? null : satir.deger)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ad">
                      {satir.ad}{" "}
                      {degisenler.includes(satir.deger) && <Tag color="orange">değişti</Tag>}
                    </div>
                    {satir.alt && <div className="alt">{satir.alt}</div>}
                  </div>
                  {!altKatman && <Tag>{acikSay}/{kodlar.length} açık</Tag>}
                  <span style={{ color: RENK.metinPasif, fontSize: 18 }}>{acik ? "▾" : "▸"}</span>
                </div>
                {acik && (
                  <div className="b3-kart-govde">
                    {!kilitli && (
                      <div style={{ display: "flex", gap: 6, padding: "8px 12px", flexWrap: "wrap" }}>
                        <Button size="small" onClick={() => topluYaz([satir.deger], kodlar.map((k) => k.kod), "acik")}>Hepsini aç</Button>
                        <Button size="small" onClick={() => topluYaz([satir.deger], kodlar.map((k) => k.kod), "kapali")}>Hepsini kapat</Button>
                        <Button size="small" onClick={() => topluYaz([satir.deger], kodlar.map((k) => k.kod), "tanimsiz")}>Tanımsız yap</Button>
                      </div>
                    )}
                    {kodlar.map((k) => (
                      <div key={k.kod} className="b3-kart-mod">
                        <div className="m">
                          <b>
                            {k.ad}
                            {alan === "mobil" && k.varsayilan === false && (
                              <Tag color="red" style={{ marginLeft: 6, fontSize: 10.5, lineHeight: "16px" }}>varsayılan kapalı</Tag>
                            )}
                          </b>
                          <small>{k.aciklama}</small>
                        </div>
                        {hucre(satir, k)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {degisenler.length > 0 && (
            <div className="b3-sabit-kaydet">
              <Button style={{ flex: 1 }} onClick={() => setSimdi(JSON.parse(JSON.stringify(ilk)))}>Geri al</Button>
              <Button type="primary" style={{ flex: 2, background: RENK.yesil }} loading={kaydediliyor} disabled={kilitli} onClick={kaydet}>
                Kaydet ({degisenler.length} satır)
              </Button>
            </div>
          )}
        </Space>
      ) : satirlar.length === 0 ? (
        <Card>
          <Empty
            description={
              sicilGirisi
                ? "Kişiye özel tanım yok. Sicil numarası yazıp satır ekleyiniz."
                : "Listelenecek satır yok."
            }
          />
        </Card>
      ) : (
        <Table
          rowKey="deger"
          size="small"
          loading={yukleniyor}
          dataSource={satirlar}
          pagination={false}
          scroll={{ x: 320 + kodlar.length * 120, y: 560 }}
          columns={[
            {
              title: kapsam === "rol" ? "Rol" : kapsam === "pozisyon" ? "Görev" : "Kişi",
              dataIndex: "ad",
              width: 300,
              fixed: "left",
              render: (ad: string, satir: Anahtar) => (
                <Dropdown
                  menu={satirMenusu(satir.deger)}
                  trigger={kilitli ? [] : ["contextMenu"]}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{ad}</div>
                    {satir.alt && (
                      <div style={{ fontSize: 12, color: RENK.metinPasif }}>{satir.alt}</div>
                    )}
                    {degisenler.includes(satir.deger) && (
                      <Tag color="orange" style={{ marginTop: 2 }}>
                        değişti
                      </Tag>
                    )}
                  </div>
                </Dropdown>
              ),
            },

            ...kodlar.map((k) => ({
              key: k.kod,
              width: 120,
              align: "center" as const,
              title: (
                <Dropdown menu={sutunMenusu(k.kod)} trigger={kilitli ? [] : ["click"]}>
                  <Tooltip title={`${k.aciklama}${alan === "mobil" && k.varsayilan === false ? " · yeni modül: tanımsızken kapalı" : ""} · sütunu topluca ayarlamak için tıklayınız`}>
                    <span style={{ cursor: "pointer" }}>
                      {k.ad}
                      {alan === "mobil" && k.varsayilan === false && (
                        <div style={{ fontSize: 10.5, color: "#cf1322", fontWeight: 500 }}>varsayılan kapalı</div>
                      )}
                    </span>
                  </Tooltip>
                </Dropdown>
              ),
              render: (_: unknown, satir: Anahtar) => hucre(satir, k),
            })),
          ]}
        />
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Hücreye tıkladıkça durum değişir: tanımsız → açık → kapalı. Sütun
        başlığına tıklayıp o sütunun tamamını, satır adına sağ tıklayıp o
        satırın tamamını ayarlayabilirsiniz. Değişiklikler siz kaydedene
        kadar sunucuya gitmez.
      </Typography.Text>
    </Space>
  );
}

/* ========================================================================== */

/* ========================================================================== */
/* Grup ayarları                                                              */
/* ========================================================================== */

const KAPSAM_SECENEKLERI: { deger: string | null; ad: string; aciklama: string }[] = [
  {
    deger: null,
    ad: "Varsayılan kural",
    aciklama: "Ayar yapılmamış gibi davranır: modülün kendi kuralı geçerli.",
  },
  { deger: "kendi", ad: "Yalnızca kendisi", aciklama: "Yalnızca kendi açtığı kayıtlar." },
  { deger: "sube", ad: "Kendi şubesi", aciklama: "Çalıştığı şubenin bütün kayıtları." },
  {
    deger: "bolge",
    ad: "Sorumlu bölgeleri",
    aciklama:
      "Kişiye atanmış bölgelerdeki bütün şubeler. Atama yoksa kendi şubesinin bölgesi.",
  },
  {
    deger: "departman",
    ad: "Departmanları",
    aciklama: "Seçilen departmanlara ait kayıtlar — genel merkez birimleri için.",
  },
  { deger: "tum", ad: "Bütün kurum", aciklama: "Şube ve departman sınırı olmadan." },
];

/**
 * Grubun sorumluluk, veri kapsamı ve onay ayarları.
 *
 * <p>
 * Modül yetkisi "bu ekranı görür mü" sorusunu cevaplıyor; bu çekmece
 * "görünce neyi görür, kimden sorumludur, hangi talebi onaylar" sorusunu.
 * Mağaza müdürü şubesinin arızalarını, bölge müdürü bölgesinin, Bilgi
 * Teknolojileri kendi departmanına açılanları görür — hepsi burada.
 * </p>
 *
 * <p>
 * Kaydedilmemiş grup "varsayılan kural" ile çalışıyor: ekranı açmak tek
 * başına bir şeyi değiştirmiyor.
 * </p>
 */
function GrupAyarCekmecesi({
  grup,
  gruplar: tumGruplar,
  pozisyonlar,
  yenile,
  kapat,
}: {
  grup: GrupKaydi;
  gruplar: GrupKaydi[];
  pozisyonlar: string[];
  yenile: () => void;
  kapat: () => void;
}) {
  const [veri, setVeri] = useState<any>(null);
  const [ayar, setAyar] = useState<any>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [degisti, setDegisti] = useState(false);

  useEffect(() => {
    api
      .getir<any>(`Yetki/GrupAyar/${grup.id}`)
      .then((c) => {
        setVeri(c);
        setAyar({
          sorumluGruplar: c.ayar?.sorumluGruplar ?? [],
          arizaKapsami: c.ayar?.arizaKapsami ?? null,
          envanterKapsami: c.ayar?.envanterKapsami ?? null,
          departmanlar: c.ayar?.departmanlar ?? [],
          haftalikIzinOnay: !!c.ayar?.haftalikIzinOnay,
          yillikIzinKademe: c.ayar?.yillikIzinKademe ?? null,
        });
      })
      .catch((h) => message.error(h instanceof Error ? h.message : "Ayar okunamadı."));
  }, [grup.id]);

  const guncelle = (alan: string, deger: any) => {
    setAyar((a: any) => ({ ...a, [alan]: deger }));
    setDegisti(true);
  };

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder(`Yetki/GrupAyar/${grup.id}`, { ...ayar, yillikIzinKademe: null });
      message.success(`${grup.ad} ayarları kaydedildi.`);
      setDegisti(false);
      kapat();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const gruplar: { id: number; ad: string }[] = veri?.secenekler?.gruplar ?? [];
  const departmanlar: { id: number; ad: string }[] = veri?.secenekler?.departmanlar ?? [];

  const grupAdi = (id: number) => gruplar.find((g) => g.id === id)?.ad ?? `#${id}`;
  const kapsamAdi = (d: string | null) =>
    KAPSAM_SECENEKLERI.find((x) => x.deger === d)?.ad ?? "Varsayılan kural";

  /* Özet cümle: ayarın ne anlama geldiğini düz Türkçeyle söylüyor.
     Seçimleri tek tek okuyup kafada birleştirmek hataya açıktı. */
  const ozet = ayar && (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
      <li>
        <b>Sorumlu olduğu:</b>{" "}
        {ayar.sorumluGruplar.length
          ? ayar.sorumluGruplar.map(grupAdi).join(", ")
          : "kimse (onay veremez)"}
      </li>
      <li>
        <b>Arıza kayıtları:</b> {kapsamAdi(ayar.arizaKapsami)}
      </li>
      <li>
        <b>Envanter:</b> {kapsamAdi(ayar.envanterKapsami)}
      </li>
      <li>
        <b>Haftalık izin:</b>{" "}
        {ayar.haftalikIzinOnay
          ? "şubesindeki sorumlu olduğu personelin gün seçimini onaylar"
          : "onaylamaz"}
      </li>
      <li>
        <b>Yıllık izin:</b> organizasyon şemasına göre
      </li>
    </ul>
  );

  const departmanGerekli =
    ayar?.arizaKapsami === "departman" || ayar?.envanterKapsami === "departman";

  const onayVar = !!ayar?.haftalikIzinOnay;

  const kapsamSecici = (alan: string, baslik: string, aciklama: string) => (
    <Card size="small" title={baslik} style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 10 }}>
        {aciklama}
      </Typography.Text>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
        {KAPSAM_SECENEKLERI.map((x) => {
          const secili = ayar?.[alan] === x.deger;

          return (
            <div
              key={String(x.deger)}
              onClick={() => guncelle(alan, x.deger)}
              style={{
                cursor: "pointer",
                border: `1.5px solid ${secili ? "#5f8c10" : "#e3e6e1"}`,
                background: secili ? "#f2f9e8" : "#fff",
                borderRadius: 10,
                padding: "9px 11px",
                transition: ".15s",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: secili ? "#5f8c10" : undefined }}>
                {secili ? "● " : "○ "}
                {x.ad}
              </div>
              <div style={{ fontSize: 11.5, color: "#7a8076", marginTop: 2 }}>{x.aciklama}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );

  return (
    <Drawer
      open
      width="min(760px, 100vw)"
      onClose={() => {
        if (!degisti) return kapat();

        Modal.confirm({
          title: "Kaydedilmemiş değişiklikler var",
          content: "Kapatırsanız yaptığınız değişiklikler kaybolur.",
          okText: "Kapat",
          cancelText: "Vazgeç",
          onOk: kapat,
        });
      }}
      title={
        <Space direction="vertical" size={0}>
          <span>{grup.ad}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {grup.pozisyonlar || "Bu gruba bağlı ünvan yok"}
          </Typography.Text>
        </Space>
      }
      extra={
        <Button type="primary" loading={kaydediliyor} disabled={!degisti} onClick={kaydet}>
          Kaydet
        </Button>
      }
    >
      <GrupIslemleri grup={grup} gruplar={tumGruplar} pozisyonlar={pozisyonlar} yenile={yenile} />

      {!ayar ? (
        <Spin />
      ) : (
        <>
          {!veri?.tanimli && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Bu grubun henüz ayarı yok"
              description="Şu an modüllerin varsayılan kuralları geçerli. Kaydettiğinizde izin onayları yalnızca buradaki seçime göre çalışır."
            />
          )}

          <Card size="small" title="Özet" style={{ marginBottom: 12, background: "#fafbf9" }}>
            {ozet}
          </Card>

          {/* ----------------------------------------------- sorumluluk */}
          <Card size="small" title="Kimlerden sorumlu" style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 10 }}>
              Bu gruptakiler hangi gruplardaki personelin yöneticisi? İzin
              onayları bu seçime göre düşer. Örnek: Mağaza Müdürleri →
              Mağaza Personeli; Bölge Müdürleri → Mağaza Müdürleri.
            </Typography.Text>

            <Select
              mode="multiple"
              allowClear
              style={{ width: "100%" }}
              placeholder="Sorumlu olduğu gruplar"
              value={ayar.sorumluGruplar}
              onChange={(v) => guncelle("sorumluGruplar", v)}
              options={gruplar.map((g) => ({ value: g.id, label: g.ad }))}
              optionFilterProp="label"
            />
          </Card>

          {/* --------------------------------------------------- kapsam */}
          {kapsamSecici(
            "arizaKapsami",
            "Arıza kayıtları",
            "Arıza modülünde hangi kayıtları görür. Kendi açtığı kayıtları her durumda görür; departman temsilcisiyse o departmanın kayıtları da eklenir."
          )}

          {kapsamSecici(
            "envanterKapsami",
            "Envanter",
            "Envanter modülünde hangi cihazları görür. 'Yalnızca kendisi' envanterde kendi şubesi demek: cihaz kişiye değil mağazaya bağlı."
          )}

          {departmanGerekli && (
            <Card size="small" title="Departmanlar" style={{ marginBottom: 12, borderColor: "#cfe0f2" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 10 }}>
                Departman kapsamı seçildi. Hangi departmanların kayıtlarını
                ve cihazlarını görsün? Genel merkez birimleri (Bilgi
                Teknolojileri, Teknik Servis…) için.
              </Typography.Text>

              <Select
                mode="multiple"
                allowClear
                style={{ width: "100%" }}
                placeholder="Departman seçiniz"
                status={ayar.departmanlar.length === 0 ? "error" : undefined}
                value={ayar.departmanlar}
                onChange={(v) => guncelle("departmanlar", v)}
                options={departmanlar.map((d) => ({ value: d.id, label: d.ad }))}
                optionFilterProp="label"
              />
            </Card>
          )}

          {/* ----------------------------------------------------- onay */}
          <Card size="small" title="İzin onayları" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <div>
                <Checkbox
                  checked={ayar.haftalikIzinOnay}
                  onChange={(e) => guncelle("haftalikIzinOnay", e.target.checked)}
                >
                  <b>Haftalık izin günlerini onaylar</b>
                </Checkbox>
                <div style={{ fontSize: 12, color: "#7a8076", marginLeft: 24 }}>
                  Aynı şubede, sorumlu olduğu gruplardaki personelin seçtiği
                  izin günü bu kişiye düşer.
                </div>
              </div>

              {/* Yıllık izin onayı artık organizasyon şemasından yürüyor:
                  kişinin kutusundan yukarı çıkılarak birim yöneticisi ve
                  üst yönetici bulunuyor. Aynı işi burada da tutmak iki
                  kaynaktan hangisinin geçtiğini belirsiz bırakırdı. */}
              <Alert
                type="info"
                showIcon
                message="Yıllık izin onayı organizasyon şemasından"
                description="Talep, kişinin kutusundan yukarı çıkılarak önce birim yöneticisine, sonra üst yöneticiye, en son İnsan Kaynakları'na gider. Kim kime bağlı İK paneli → Organizasyon ekranından düzenlenir."
              />

              {onayVar && ayar.sorumluGruplar.length === 0 && (
                <Alert
                  type="error"
                  showIcon
                  message="Onay yetkisi var ama sorumlu olduğu grup seçilmedi — kimin talebini onaylayacağı belirsiz."
                />
              )}
            </Space>
          </Card>

          {(ayar.arizaKapsami === "bolge" || ayar.envanterKapsami === "bolge") && (
            <Alert
              type="info"
              showIcon
              message="Bölge ataması kişi başına yapılır"
              description="Bölge müdürü genelde merkezde çalıştığı için bölgesi kendi şubesinden çıkarılamıyor. Kişiye özel sekmesinde personeli bulup 'Sorumlu bölgeleri' alanından atayın; atama yoksa kendi şubesinin bölgesi kullanılır."
            />
          )}
        </>
      )}
    </Drawer>
  );
}

/* ========================================================================== */
/* Kişiye özel                                                                */
/* ========================================================================== */

interface KisiModulu {
  kod: string;
  ad: string;
  aciklama: string;
  kaynak: string;
  grup: boolean | null;
  kisi: boolean | null;
  varsayilan: boolean;
  sonuc: boolean;
}

/**
 * Tek bir personelin mobil yetkileri.
 *
 * <p>
 * Personel sicil ya da adla aranıyor; seçilince grubundan gelen her
 * yetki soluk olarak görünüyor ve istenen satır kişiye özel olarak
 * değiştirilebiliyor. Eskiden sicil ezberlemek gerekiyordu ve kişinin
 * grubunda ne tanımlı olduğu bu ekranda hiç görünmüyordu.
 * </p>
 *
 * <p>
 * Gruptan gelenle aynı değer seçilemiyor: yalnızca "gruptan gelen" ya da
 * onun tersi var. Aynı yetkiyi kişiye ayrıca vermek, grup değiştiğinde
 * kişinin sessizce geride kalmasına yol açıyordu.
 * </p>
 */
function KisiYetki() {
  const [ara, setAra] = useState("");
  const [sonuclar, setSonuclar] = useState<any[]>([]);
  const [araniyor, setAraniyor] = useState(false);

  const [kisi, setKisi] = useState<any>(null);
  const [moduller, setModuller] = useState<KisiModulu[]>([]);
  const [degisen, setDegisen] = useState<Record<string, boolean | null>>({});
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [kume, setKume] = useState("portal");
  const dar = useDar();

  /* Arama gecikmeli: her harfte istek atmak yavaş bağlantıda listeyi
     sürekli titretiyordu. */
  useEffect(() => {
    const q = ara.trim();

    if (q.length < 2) {
      setSonuclar([]);
      return;
    }

    const zamanlayici = setTimeout(async () => {
      setAraniyor(true);

      try {
        const c = await api.getir<any>(`Yetki/PersonelAra?q=${encodeURIComponent(q)}`);
        setSonuclar(c?.kayitlar ?? []);
      } catch {
        setSonuclar([]);
      } finally {
        setAraniyor(false);
      }
    }, 300);

    return () => clearTimeout(zamanlayici);
  }, [ara]);

  const kisiGetir = async (sicil: string) => {
    setYukleniyor(true);
    setDegisen({});

    try {
      const c = await api.getir<any>(`Yetki/Kisi?sicil=${encodeURIComponent(sicil)}`);

      setKisi(c);
      setModuller(c?.moduller ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Personel okunamadı.");
    } finally {
      setYukleniyor(false);
    }
  };

  /* Kişiye özel değer: değişiklik varsa o, yoksa kayıtlı olan */
  const kisiDegeri = (m: KisiModulu) =>
    m.kod in degisen ? degisen[m.kod] : m.kisi;

  const gruptan = (m: KisiModulu) => m.grup ?? m.varsayilan;

  const sonuc = (m: KisiModulu) => kisiDegeri(m) ?? gruptan(m);

  const kaydet = async () => {
    if (!kisi) return;

    setKaydediliyor(true);

    try {
      const yetkiler: Record<string, boolean | null> = {};

      for (const m of moduller) yetkiler[m.kod] = kisiDegeri(m);

      const c = await api.gonder<any>("Yetki/Kisi", {
        sicil: kisi.personel.sicil,
        yetkiler,
      });

      message.success(
        c?.istisna
          ? `Kaydedildi — ${c.istisna} kişiye özel istisna var.`
          : "Kaydedildi — kişi yalnızca grubunun yetkilerini alıyor."
      );

      await kisiGetir(kisi.personel.sicil);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const degisiklikVar = Object.keys(degisen).length > 0;

  const gorunen = moduller.filter((m) => (m.kaynak ?? "portal") === kume);

  const istisnaSayisi = moduller.filter((m) => kisiDegeri(m) !== null && kisiDegeri(m) !== undefined).length;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card size="small">
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 10 }}>
          Personeli sicil numarası ya da adıyla arayın. Grubundan gelen
          yetkiler görünür; yalnızca farklı olması gereken satırı
          değiştirin.
        </Typography.Text>

        <Select
          showSearch
          allowClear
          style={{ width: "100%", maxWidth: 520 }}
          placeholder="Sicil numarası ya da ad soyad yazın"
          filterOption={false}
          onSearch={setAra}
          loading={araniyor}
          notFoundContent={
            ara.trim().length < 2 ? "En az iki karakter yazın" : araniyor ? <Spin size="small" /> : "Bulunamadı"
          }
          onChange={(v) => (v ? kisiGetir(String(v)) : (setKisi(null), setModuller([])))}
          options={sonuclar.map((k) => ({
            value: k.sicil,
            label: (
              <span>
                <b>{k.adSoyad}</b>{" "}
                <span style={{ color: "#8a8f87", fontSize: 12 }}>
                  {k.sicil} · {k.pozisyon} · {k.sube}
                </span>
              </span>
            ),
          }))}
        />
      </Card>

      {yukleniyor && <Spin />}

      {kisi && !yukleniyor && (
        <>
          <Card size="small">
            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
              <Space direction="vertical" size={2}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  {kisi.personel.adSoyad}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {kisi.personel.sicil} · {kisi.personel.pozisyon} · {kisi.personel.sube}
                </Typography.Text>
              </Space>

              <Space>
                {kisi.personel.grup ? (
                  <Tag color="cyan" style={{ fontSize: 12.5, padding: "3px 10px" }}>
                    Grup: {kisi.personel.grup}
                  </Tag>
                ) : (
                  <Tag color="orange" style={{ fontSize: 12.5, padding: "3px 10px" }}>
                    Gruba bağlı değil
                  </Tag>
                )}

                <Tag style={{ fontSize: 12.5, padding: "3px 10px" }}>
                  {istisnaSayisi} kişiye özel istisna
                </Tag>
              </Space>
            </Space>

            {kisi.grupUyarisi && (
              <Alert style={{ marginTop: 10 }} type="warning" showIcon message={kisi.grupUyarisi} />
            )}
          </Card>

          <KisiBolgeleri sicil={kisi.personel.sicil} />

          <Kaydir><Segmented
            value={kume}
            onChange={(d) => setKume(String(d))}
            options={[
              { value: "portal", label: "Mağaza modülleri" },
              { value: "kariyer", label: "Özlük modülleri" },
              { value: "yetki", label: "Kapsam yetkileri" },
            ]}
          /></Kaydir>

          {dar ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {gorunen.map((m) => {
                const g = gruptan(m);
                const k = kisiDegeri(m);
                const r = sonuc(m);
                const ozel = k !== null && k !== undefined;
                return (
                  <div key={m.kod} className="b3-kart-satir" style={{ padding: 12, background: ozel ? "#fbf6e9" : "#fff", display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{m.ad}</div>
                        <div style={{ fontSize: 12, color: "#8a8f87" }}>{m.aciklama}</div>
                      </div>
                      <Tag color={r ? "green" : "red"} style={{ fontWeight: ozel ? 700 : 400, marginRight: 0 }}>{r ? "Görür" : "Görmez"}</Tag>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#8a8f87" }}>
                        {kisi.personel.grup ? "Gruptan" : "Varsayılan"}: <b style={{ color: g ? "#389e0d" : "#cf1322" }}>{g ? "görür" : "görmez"}</b>
                        {m.grup === null && " (tanımsız)"}
                      </span>
                      <Segmented
                        size="small"
                        style={{ marginLeft: "auto" }}
                        value={ozel ? "ozel" : "grup"}
                        onChange={(v) => setDegisen((d) => ({ ...d, [m.kod]: v === "grup" ? null : !g }))}
                        options={[
                          { value: "grup", label: "Gruptan" },
                          { value: "ozel", label: g ? "Görmesin" : "Görsün" },
                        ]}
                      />
                    </div>
                  </div>
                );
              })}
            </Space>
          ) : (
          <Table
            rowKey="kod"
            size="middle"
            pagination={false}
            dataSource={gorunen}
            columns={[
              {
                title: "Modül",
                dataIndex: "ad",
                render: (d: string, m: KisiModulu) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{d}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {m.aciklama}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: kisi.personel.grup ? `Gruptan (${kisi.personel.grup})` : "Varsayılan",
                width: 170,
                render: (_: unknown, m: KisiModulu) => {
                  const g = gruptan(m);

                  return (
                    <Space size={6}>
                      <Tag color={g ? "green" : "red"} style={{ opacity: 0.75 }}>
                        {g ? "Görür" : "Görmez"}
                      </Tag>
                      {m.grup === null && (
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          tanımsız
                        </Typography.Text>
                      )}
                    </Space>
                  );
                },
              },
              {
                title: "Kişiye özel",
                width: 260,
                render: (_: unknown, m: KisiModulu) => {
                  const g = gruptan(m);
                  const k = kisiDegeri(m);

                  /* Yalnızca iki seçenek: gruptan geleni kullan ya da tersini
                     ver. Gruptakiyle aynı değeri ayrıca yazmak anlamsız. */
                  return (
                    <Segmented
                      size="small"
                      value={k === null || k === undefined ? "grup" : "ozel"}
                      onChange={(v) =>
                        setDegisen((d) => ({ ...d, [m.kod]: v === "grup" ? null : !g }))
                      }
                      options={[
                        { value: "grup", label: "Gruptan gelen" },
                        { value: "ozel", label: g ? "Görmesin" : "Görsün" },
                      ]}
                    />
                  );
                },
              },
              {
                title: "Sonuç",
                width: 110,
                align: "center" as const,
                render: (_: unknown, m: KisiModulu) => {
                  const r = sonuc(m);
                  const k = kisiDegeri(m);

                  return (
                    <Tag
                      color={r ? "green" : "red"}
                      style={{ fontWeight: k !== null && k !== undefined ? 700 : 400 }}
                    >
                      {r ? "Görür" : "Görmez"}
                    </Tag>
                  );
                },
              },
            ]}
            rowClassName={(m: KisiModulu) =>
              kisiDegeri(m) !== null && kisiDegeri(m) !== undefined ? "b3-istisna" : ""
            }
          />
          )}

          <style>{`.b3-istisna td { background: #fbf6e9 !important; }`}</style>

          <Space wrap className={dar && degisiklikVar ? "b3-sabit-kaydet" : undefined}>
            <Button type="primary" disabled={!degisiklikVar} loading={kaydediliyor} onClick={kaydet}>
              Kaydet
            </Button>

            <Button disabled={!degisiklikVar || kaydediliyor} onClick={() => setDegisen({})}>
              Değişiklikleri geri al
            </Button>

            {istisnaSayisi > 0 && (
              <Button
                danger
                disabled={kaydediliyor}
                onClick={() => {
                  const hepsi: Record<string, null> = {};
                  for (const m of moduller) hepsi[m.kod] = null;
                  setDegisen(hepsi);
                }}
              >
                Bütün istisnaları kaldır
              </Button>
            )}
          </Space>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Personelin değişikliği görmesi için uygulamayı kapatıp açması yeterli.
          </Typography.Text>
        </>
      )}
    </Space>
  );
}

/**
 * Kişinin sorumlu olduğu bölgeler.
 *
 * Grubun kapsamı "Sorumlu bölgeleri" ya da yıllık izin kademesi "Bölge"
 * ise bu atama kullanılıyor. Bölge müdürü genelde merkezde çalıştığı için
 * bölgesi kendi şubesinden çıkarılamıyor; atama yoksa kendi şubesinin
 * bölgesine düşülüyor.
 */
function KisiBolgeleri({ sicil }: { sicil: string }) {
  const [secili, setSecili] = useState<string[]>([]);
  const [bolgeler, setBolgeler] = useState<string[]>([]);
  const [degisti, setDegisti] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    api
      .getir<any>(`Yetki/KisiBolge?sicil=${encodeURIComponent(sicil)}`)
      .then((c) => {
        setSecili(c?.secili ?? []);
        setBolgeler(c?.bolgeler ?? []);
        setDegisti(false);
      })
      .catch(() => undefined);
  }, [sicil]);

  const kaydet = async () => {
    setKaydediliyor(true);

    try {
      await api.gonder("Yetki/KisiBolge", { sicil, bolgeler: secili });
      message.success("Sorumlu bölgeler kaydedildi.");
      setDegisti(false);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Card size="small" title="Sorumlu bölgeleri">
      <Typography.Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 10 }}>
        Grubunun kapsamı bölge olduğunda bu kişi hangi bölgelerin
        kayıtlarını, cihazlarını ve izin taleplerini görsün. Boş
        bırakılırsa kendi şubesinin bölgesi kullanılır.
      </Typography.Text>

      <Space.Compact style={{ width: "100%" }}>
        <Select
          mode="multiple"
          allowClear
          style={{ width: "100%" }}
          placeholder={bolgeler.length ? "Bölge seçiniz" : "İK ayarlarında tanımlı bölge yok"}
          value={secili}
          onChange={(v) => {
            setSecili(v);
            setDegisti(true);
          }}
          options={bolgeler.map((b) => ({ value: b, label: b }))}
        />
        <Button type="primary" disabled={!degisti} loading={kaydediliyor} onClick={kaydet}>
          Kaydet
        </Button>
      </Space.Compact>
    </Card>
  );
}

/**
 * Portaldan pozisyon grubu tanımı.
 *
 * Yalnızca ad ve ünvanlar soruluyor. İzin günleri ve mesai saati gibi
 * çalışma düzeni alanları İK panelinde; aynı alanı iki ekranda sormak,
 * hangisinin geçerli olduğu sorusunu doğuruyordu.
 */
function GrupFormu({
  mevcut,
  gruplar,
  pozisyonlar,
  kapat,
  kaydedildi,
}: {
  mevcut: GrupKaydi | null;
  gruplar: GrupKaydi[];
  pozisyonlar: string[];
  kapat: () => void;
  kaydedildi: () => void;
}) {
  const baslangic = (mevcut?.pozisyonlar ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const [ad, setAd] = useState(mevcut?.ad ?? "");
  const [secili, setSecili] = useState<string[]>(baslangic);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  /* Hangi ünvan başka grupta: seçim listesinde yanına yazılıyor.
     Bir ünvan iki gruptaysa yetkinin hangisinden geldiği belirsizleşiyor;
     sunucu da kaydı reddediyor, ama bunu seçmeden önce görmek daha iyi. */
  const baskaGrupta = new Map<string, string>();

  for (const g of gruplar) {
    if (mevcut && g.id === mevcut.id) continue;

    for (const u of g.pozisyonlar.split(",").map((x) => x.trim()).filter(Boolean))
      baskaGrupta.set(u.toLocaleLowerCase("tr"), g.ad);
  }

  const kaydet = async (aktif = true) => {
    if (!ad.trim()) return message.warning("Grup adını giriniz.");

    setKaydediliyor(true);

    try {
      await api.gonder("Yetki/Grup", {
        id: mevcut?.id ?? 0,
        ad: ad.trim(),
        pozisyonlar: secili,
        aktif,
      });

      message.success(
        !aktif ? "Grup kaldırıldı." : mevcut ? "Grup güncellendi." : "Grup eklendi."
      );

      kaydedildi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      title={mevcut ? `Grubu düzenle — ${mevcut.ad}` : "Pozisyon grubu ekle"}
      onCancel={kapat}
      width={560}
      footer={
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          {mevcut ? (
            <Button
              danger
              disabled={kaydediliyor}
              onClick={() =>
                Modal.confirm({
                  title: "Grup kaldırılsın mı?",
                  content:
                    "Gruptaki ünvanlar hiçbir gruba bağlı kalmaz ve grubun yetkileri artık uygulanmaz. Kişiye özel tanımlar yerinde kalır.",
                  okText: "Kaldır",
                  okButtonProps: { danger: true },
                  cancelText: "Vazgeç",
                  onOk: () => kaydet(false),
                })
              }
            >
              Grubu kaldır
            </Button>
          ) : (
            <span />
          )}

          <Space>
            <Button onClick={kapat}>Vazgeç</Button>
            <Button type="primary" loading={kaydediliyor} onClick={() => kaydet(true)}>
              Kaydet
            </Button>
          </Space>
        </Space>
      }
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Input
          placeholder="Grup adı — örn. Mağaza Müdürleri"
          value={ad}
          onChange={(e) => setAd(e.target.value)}
          autoFocus
        />

        <Select
          mode="multiple"
          allowClear
          style={{ width: "100%" }}
          placeholder="Bu gruba girecek ünvanlar"
          value={secili}
          onChange={setSecili}
          options={pozisyonlar.map((p) => {
            const diger = baskaGrupta.get(p.trim().toLocaleLowerCase("tr"));

            return {
              value: p,
              label: diger ? `${p}  ·  ${diger} grubunda` : p,
              disabled: !!diger,
            };
          })}
          filterOption={(g, o) =>
            ((o?.label as string) ?? "")
              .toLocaleLowerCase("tr")
              .includes(g.toLocaleLowerCase("tr"))
          }
        />

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Başka bir grupta olan ünvanlar seçilemiyor; önce o gruptan
          çıkarılmalı. İzin günleri ve mesai saatleri İK panelindeki
          Çalışma Düzeni ekranından tanımlanır.
        </Typography.Text>
      </Space>
    </Modal>
  );
}


/* ========================================================================== */
/* Grup işlemleri: ünvanlar ve yetki kopyalama                                */
/* ========================================================================== */

/**
 * Grup çekmecesinin üstünde iki iş:
 *
 *  - Ünvanlar: gruptaki ünvanı çıkar (×) ya da yeni ünvan ekle. Eskiden
 *    kartın köşesindeki silik bir düğmenin arkasındaydı ve bulunmuyordu.
 *    Başka gruptaki ünvan seçilirse yanında hangi grupta olduğu yazıyor;
 *    sunucu bir ünvanı iki grupta tutmuyor.
 *  - Yetkileri kopyala: bu grubun mobil modül yetkilerini (ve istenirse
 *    kapsam/onay ayarlarını) seçilen gruplara aynen aktarır. Hedef grubun
 *    eski modül yetkileri silinip bunlarla değiştiriliyor.
 */
function GrupIslemleri({
  grup,
  gruplar,
  pozisyonlar,
  yenile,
}: {
  grup: GrupKaydi;
  gruplar: GrupKaydi[];
  pozisyonlar: string[];
  yenile: () => void;
}) {
  const ayir = (x: string) =>
    (x ?? "")
      .split(",")
      .map((y) => y.trim())
      .filter(Boolean);

  const [unvanlar, setUnvanlar] = useState<string[]>(ayir(grup.pozisyonlar));
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const [hedefler, setHedefler] = useState<number[]>([]);
  const [moduller, setModuller] = useState(true);
  const [ayarlar, setAyarlar] = useState(false);
  const [kopyalaniyor, setKopyalaniyor] = useState(false);

  useEffect(() => setUnvanlar(ayir(grup.pozisyonlar)), [grup.pozisyonlar]);

  /* Başka gruptaki ünvanlar: seçim listesinde yanına grup adı */
  const baskaGrupta = new Map<string, string>();
  for (const g of gruplar)
    if (g.id !== grup.id)
      for (const u of ayir(g.pozisyonlar)) baskaGrupta.set(u.toLocaleLowerCase("tr"), g.ad);

  const unvanKaydet = async (yeni: string[]) => {
    setKaydediliyor(true);

    try {
      await api.gonder("Yetki/Grup", { id: grup.id, ad: grup.ad, pozisyonlar: yeni, aktif: true });
      setUnvanlar(yeni);
      message.success("Ünvanlar güncellendi.");
      yenile();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const kopyala = () =>
    Modal.confirm({
      title: "Yetkiler kopyalansın mı?",
      content: `"${grup.ad}" grubunun ${[moduller && "modül yetkileri", ayarlar && "kapsam ve onay ayarları"]
        .filter(Boolean)
        .join(" ve ")} seçilen ${hedefler.length} gruba aynen aktarılacak. Hedef grupların mevcut ${
        moduller ? "modül yetkileri" : "ayarları"
      } bunlarla değiştirilir.`,
      okText: "Kopyala",
      cancelText: "Vazgeç",
      onOk: async () => {
        setKopyalaniyor(true);

        try {
          await api.gonder("Yetki/GrupKopyala", {
            kaynakId: grup.id,
            hedefIdler: hedefler,
            moduller,
            ayarlar,
          });

          message.success(`${hedefler.length} gruba kopyalandı.`);
          setHedefler([]);
          yenile();
        } catch (h) {
          message.error(h instanceof Error ? h.message : "Kopyalanamadı.");
        } finally {
          setKopyalaniyor(false);
        }
      },
    });

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%", marginBottom: 18 }}>
      {/* ---------------------------------------------------- ünvanlar */}
      <Card size="small" title={`Gruptaki ünvanlar (${unvanlar.length})`}>
        {unvanlar.length === 0 ? (
          <Typography.Text type="danger" style={{ fontSize: 12.5 }}>
            Bu gruba bağlı ünvan yok; yetkiler kimseye uygulanmıyor.
          </Typography.Text>
        ) : (
          <Space size={[6, 6]} wrap>
            {unvanlar.map((u) => (
              <Tag
                key={u}
                closable={!kaydediliyor}
                onClose={(e) => {
                  e.preventDefault();
                  unvanKaydet(unvanlar.filter((x) => x !== u));
                }}
                style={{ fontSize: 12.5, padding: "2px 8px" }}
              >
                {u}
              </Tag>
            ))}
          </Space>
        )}

        <Select
          style={{ width: "100%", marginTop: 10 }}
          showSearch
          placeholder="＋ Ünvan ekle — personel kartındaki ünvanlar"
          value={null as any}
          disabled={kaydediliyor}
          optionFilterProp="label"
          onChange={(v: string) => {
            if (v && !unvanlar.includes(v)) unvanKaydet([...unvanlar, v]);
          }}
          options={pozisyonlar
            .filter((p) => !unvanlar.includes(p))
            .map((p) => {
              const baska = baskaGrupta.get(p.toLocaleLowerCase("tr"));
              return {
                value: p,
                label: baska ? `${p} · ${baska} grubunda` : p,
                disabled: !!baska,
              };
            })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
          Başka gruptaki ünvan seçilemiyor; önce o gruptan çıkarın. Bir ünvan yalnızca bir grupta olabilir.
        </Typography.Text>
      </Card>

      {/* ------------------------------------------------- yetki kopyala */}
      <Card size="small" title="Yetkileri başka gruplara kopyala">
        <Select
          mode="multiple"
          style={{ width: "100%" }}
          placeholder="Hedef grupları seçin"
          value={hedefler}
          onChange={setHedefler}
          optionFilterProp="label"
          options={gruplar.filter((g) => g.id !== grup.id).map((g) => ({ value: g.id, label: g.ad }))}
        />

        <Space style={{ marginTop: 10 }} wrap>
          <Checkbox checked={moduller} onChange={(e) => setModuller(e.target.checked)}>
            Mobil modül yetkileri (hangi modülü görür)
          </Checkbox>
          <Checkbox checked={ayarlar} onChange={(e) => setAyarlar(e.target.checked)}>
            Kapsam ve onay ayarları
          </Checkbox>
        </Space>

        <div style={{ marginTop: 10 }}>
          <Button
            type="primary"
            disabled={hedefler.length === 0 || (!moduller && !ayarlar)}
            loading={kopyalaniyor}
            onClick={kopyala}
          >
            {hedefler.length ? `${hedefler.length} gruba kopyala` : "Kopyala"}
          </Button>
        </div>
      </Card>
    </Space>
  );
}
