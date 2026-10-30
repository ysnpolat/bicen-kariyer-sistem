/**
 * ---------------------------------------------------------------------------
 * Organizasyon Şeması
 * ---------------------------------------------------------------------------
 * Şirketin ünvan hiyerarşisini klasik organizasyon şeması biçiminde çizer:
 * kutular yukarıdan aşağıya, aralarında bağlantı çizgileriyle.
 *
 * Her kutuda o ünvanda çalışan personel sayısı yazar; tıklanınca kişi
 * listesi açılır.
 *
 * Mikro'daki ünvan adı şemadakiyle birebir aynı olmayabilir. Eşleşmeyen
 * ünvanlar "Ünvan Eşleştirme" penceresinden elle bağlanabilir.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { Link2, Maximize2, Minimize2, Search, Users } from "lucide-react";

import PersonelResmi from "./PersonelResmi";
import OrgTuval, { otomatikKonumlar, KUTU_YUKSEKLIK, VARSAYILAN_GENISLIK } from "./OrgTuval";
import Tablo from "./Tablo";
import {
  LOGO_ADRESI,
  api,
  islemYetkisi,
  oturumOku,
  yalnizcaFotograf,
} from "./api";

const { Text, Paragraph } = Typography;

/** Kutu renkleri; şemadaki gruplara karşılık gelir */
const RENKLER: Record<string, { zemin: string; kenar: string; yazi: string }> = {
  yesil: { zemin: "#e8f4d5", kenar: "#7CB518", yazi: "#3a5709" },
  mavi: { zemin: "#dfeefb", kenar: "#3d8ecc", yazi: "#134160" },
  turuncu: { zemin: "#fde8d9", kenar: "#E8481C", yazi: "#7a2409" },
  kirmizi: { zemin: "#fadfdf", kenar: "#cf1322", yazi: "#660d15" },
  mor: { zemin: "#eae4f6", kenar: "#7c5bc4", yazi: "#392663" },
  bej: { zemin: "#f7f2ea", kenar: "#cbb99d", yazi: "#584631" },
  gri: { zemin: "#f0f2ed", kenar: "#c4cbbd", yazi: "#46525d" },
};

export default function Organizasyon() {
  const { message, modal } = AntdApp.useApp();

  const sinirli = yalnizcaFotograf(oturumOku());
  const yetkim = islemYetkisi(oturumOku());

  const [yukleniyor, setYukleniyor] = useState(false);
  const [kutular, setKutular] = useState<any[]>([]);
  const [arama, setArama] = useState("");
  const [olcek, setOlcek] = useState(100);

  /* Seçilen kutunun personeli */
  const [secili, setSecili] = useState<any>(null);
  const [kisiler, setKisiler] = useState<any>(null);
  const [kisiYukleniyor, setKisiYukleniyor] = useState(false);

  /* Eşleştirmede şemada olmayan ünvan için yeni kutu */
  const [yeniKutu, setYeniKutu] = useState<any>(null);

  /* Serbest tuvalde düzenleme */
  const [duzenle, setDuzenle] = useState(false);
  const [sifirla, setSifirla] = useState<string | null>(null);

  /* Ekrana sığdırma: şema Excel'deki gibi tek bakışta görünsün */
  const [sigdir, setSigdir] = useState(true);
  const sarmaRef = useRef<HTMLDivElement>(null);
  const semaRef = useRef<HTMLDivElement>(null);
  const [dogal, setDogal] = useState({ en: 0, boy: 0 });

  /* Eşleştirme penceresi */
  const [eslesmeAcik, setEslesmeAcik] = useState(false);
  const [eslesme, setEslesme] = useState<any>(null);
  const [eslesmeYukleniyor, setEslesmeYukleniyor] = useState(false);
  const [eslesmeSuzgec, setEslesmeSuzgec] = useState<"eksik" | "tumu">("eksik");

  const getir = useCallback(async () => {
    setYukleniyor(true);

    try {
      setKutular(await api.al<any[]>("/api/Personel/Organizasyon"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    getir();
  }, [getir]);

  const eslesmeGetir = useCallback(async () => {
    setEslesmeYukleniyor(true);

    try {
      setEslesme(await api.al<any>("/api/Personel/OrganizasyonEslesme"));
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setEslesmeYukleniyor(false);
    }
  }, [message]);

  /* Eşleşmeyen ünvan sayısı rozette görünsün */
  useEffect(() => {
    if (!yetkim) return;
    eslesmeGetir();
  }, [yetkim, eslesmeGetir]);

  const kutuAc = async (kutu: any) => {
    setSecili(kutu);
    setKisiler(null);
    setKisiYukleniyor(true);

    try {
      setKisiler(
        await api.al<any>(`/api/Personel/Organizasyon/${kutu.id}/Personel`)
      );
    } catch (hata: any) {
      message.error(hata.message);
      setSecili(null);
    } finally {
      setKisiYukleniyor(false);
    }
  };

  const eslestir = async (unvan: string, kutuId: number | null) => {
    try {
      await api.gonder("/api/Personel/OrganizasyonEslesme", { unvan, kutuId });

      message.success(
        kutuId ? "Eşleştirme kaydedildi." : "Eşleştirme kaldırıldı."
      );

      eslesmeGetir();
      getir();
    } catch (hata: any) {
      message.error(hata.message);
    }
  };

  /* Personel kartlarındaki ünvanlar açılışta da okunuyor: kutu adı bu
     listeden seçilince eşleşme kendiliğinden kuruluyor. Eskiden yalnızca
     eşleştirme penceresi açılınca geliyordu. */
  useEffect(() => {
    if (yetkim) eslesmeGetir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Bütün kutuların konumu kayıtlıysa şema tuval düzeninde çiziliyor;
     değilse eski otomatik düzen. Düzenleme açıkken her zaman tuval. */
  const konumlu = kutular.length > 0 && kutular.every((k) => k.konumX != null && k.konumY != null);
  const tuval = duzenle || konumlu;

  const konumKaydet = useCallback(
    async (liste: { id: number; x: number; y: number; genislik?: number }[]) => {
      try {
        await api.gonder("/api/Personel/Organizasyon/Konum", liste);

        setKutular((ks) =>
          ks.map((k) => {
            const d = liste.find((x) => x.id === k.id);
            return d ? { ...k, konumX: d.x, konumY: d.y, genislik: d.genislik ?? k.genislik } : k;
          })
        );
      } catch (h: any) {
        message.error(h.message);
      }
    },
    [message]
  );

  /* Konumsuz kutuların hepsini seviye seviye dizip kaydeder: sıfırdan
     başlarken ya da eski şemayı tuvale geçirirken başlangıç düzeni. */
  const otomatikDiz = async (hepsi: boolean) => {
    const oto = otomatikKonumlar(kutular);

    const liste = kutular
      .filter((k) => hepsi || k.konumX == null || k.konumY == null)
      .map((k) => ({ id: k.id, x: oto[k.id].x, y: oto[k.id].y, genislik: oto[k.id].g }));

    if (liste.length) await konumKaydet(liste);
  };

  const unvanSecenekleri: { unvan: string; kisiSayisi: number; eslesti: boolean }[] =
    eslesme?.unvanlar ?? [];

  /* Şemanın doğal boyutu ve sığdırma.

     Transform yerleşimi değiştirmediği için offsetWidth ölçeksiz
     boyutu veriyor; kapsayıcı genişliğine oranlanıp ölçek hesaplanıyor.
     Pencere ya da yan menü genişliği değişince yeniden sığdırılıyor. */
  useLayoutEffect(() => {
    const sema = semaRef.current;
    const sarma = sarmaRef.current;

    if (!sema || !sarma) return;

    let kare = 0;

    const hesapla = () => {
      const en = sema.offsetWidth;
      const boy = sema.offsetHeight;

      setDogal((d) => (d.en === en && d.boy === boy ? d : { en, boy }));

      if (!sigdir || en <= 0) return;

      const alan = sarma.clientWidth - 8;
      const oran = Math.floor(Math.min(1.6, Math.max(0.3, alan / en)) * 100);

      /* Eşik: küçük farklar yok sayılıyor. Ölçek büyüyünce sayfaya dikey
         kaydırma çubuğu geliyor, genişlik ~17 px daralıyor, ölçek
         küçülüyor, çubuk kayboluyor… Bu salınım sonsuz güncelleme
         döngüsüne girip ekranı çökertiyordu (React #185). */
      setOlcek((o) => (Math.abs(o - oran) < 4 ? o : oran));
    };

    hesapla();

    /* Gözlemci bir sonraki karede çalışıyor: yerleşim sırasında eş
       zamanlı güncelleme zinciri kurulmasın. */
    const gozcu = new ResizeObserver(() => {
      cancelAnimationFrame(kare);
      kare = requestAnimationFrame(hesapla);
    });

    gozcu.observe(sarma);
    gozcu.observe(sema);

    return () => {
      cancelAnimationFrame(kare);
      gozcu.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigdir, kutular, duzenle, yukleniyor, arama]);

  /* Ağaç yapısı */
  const cocuklar = useMemo(() => {
    const harita = new Map<number | null, any[]>();

    kutular.forEach((k) => {
      const ust = k.ustId ?? null;
      if (!harita.has(ust)) harita.set(ust, []);
      harita.get(ust)!.push(k);
    });

    return harita;
  }, [kutular]);

  /* Arama: eşleşen kutular ve üst zincirleri görünür kalır */
  const eslesenler = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    if (!q) return null;

    const bulunan = new Set<number>();

    kutular.forEach((k) => {
      if (!k.unvan?.toLocaleLowerCase("tr").includes(q)) return;

      bulunan.add(k.id);
      let ust = k.ustId;

      while (ust) {
        bulunan.add(ust);
        ust = kutular.find((x) => x.id === ust)?.ustId;
      }
    });

    return bulunan;
  }, [arama, kutular]);

  /**
   * Tek bir kutu.
   *
   * Excel şemasındaki gibi düz dikdörtgen, büyük harf, ortalı yazı.
   * <paramref name="genis"/> müdürlük başlıklarında kullanılır.
   */
  const Kutu = ({
    kutu,
    genis,
  }: {
    kutu: any;
    genis?: boolean;
  }) => {
    if (eslesenler && !eslesenler.has(kutu.id)) return null;

    const renk = RENKLER[kutu.renk] ?? RENKLER.gri;

    return (
      <button
        className={`oz-kutu${genis ? " oz-kutu-genis" : ""}`}
        style={{
          background: renk.zemin,
          borderColor: renk.kenar,
          color: renk.yazi,
          borderTopWidth: 4,
        }}
        onClick={() => kutuAc(kutu)}
        title={kutu.unvan}
      >
        {/* Rozetler: bu kutu izin onaylıyor mu, mağazada tekrar eden
            pozisyon mu. Onay zinciri şemaya bakınca okunabilsin. */}
        <span className="oz-rozetler">
          {kutu.izinOnay && (
            <span className="oz-rozet oz-rozet-onay" title="İzin onaylar: altındaki personelin yıllık izin talebi bu kutuya düşer">
              ✓ Onaylar
            </span>
          )}
          {kutu.magazaMi && (
            <span className="oz-rozet" title="Her mağazada tekrar eden pozisyon">
              Mağaza
            </span>
          )}
        </span>

        <span className="oz-unvan">{kutu.unvan}</span>

        <span
          className={`oz-sayi${kutu.personelSayisi > 0 ? "" : " oz-sayi-bos"}`}
          style={
            kutu.personelSayisi > 0 ? { background: renk.kenar } : undefined
          }
        >
          {kutu.personelSayisi > 0 ? kutu.personelSayisi : "—"}
        </span>
      </button>
    );
  };

  /**
   * Bir müdürlüğün altındaki kutuları sütunlar hâlinde dizer.
   *
   * Excel şemasında her alt birim kendi sütununda yukarıdan aşağıya
   * sıralanır; alt birimin de altı varsa aynı sütunda devam eder.
   */
  const Sutun = ({ kutu }: { kutu: any }) => {
    if (eslesenler && !eslesenler.has(kutu.id)) return null;

    const altlar = (cocuklar.get(kutu.id) ?? []).filter(
      (a) => !eslesenler || eslesenler.has(a.id)
    );

    return (
      <div className="oz-sutun">
        <Kutu kutu={kutu} />

        {altlar.map((a) => (
          <Sutun key={a.id} kutu={a} />
        ))}
      </div>
    );
  };

  /**
   * Şema iki bölüme ayrılır:
   *
   *  1. Tepe zinciri — Yönetim Kurulu'ndan İcra Kurulu Başkanı'na kadar
   *     ortada, seviye seviye dizilir.
   *  2. Müdürlükler — İcra Kurulu Başkanı'nın altındaki geniş başlık
   *     kutuları; her birinin altında kendi sütunları bulunur.
   *
   * Bu ayrım Excel'deki düzeni birebir karşılar.
   */
  const { tepeZinciri, mudurlukler } = useMemo(() => {
    const kokler = cocuklar.get(null) ?? [];

    if (kokler.length === 0) {
      return { tepeZinciri: [] as any[][], mudurlukler: [] as any[] };
    }

    const seviyeler: any[][] = [];
    let mevcut = kokler;

    /* Tek dallı zincir devam ettiği sürece tepe sayılır; birden fazla
       geniş dal çıktığında müdürlük seviyesine geçilmiş demektir. */
    while (mevcut.length > 0) {
      seviyeler.push(mevcut);

      const altlar = mevcut.flatMap((k) => cocuklar.get(k.id) ?? []);

      if (altlar.length > 3) {
        /* Altı olmayan kutular (İç Denetim Müdürü, Yönetim Asistanı gibi)
           müdürlük sırasında değil, bağlı oldukları kutunun yanında durur;
           Excel şemasındaki gibi. Müdürlük sırasına girince şema gereksiz
           yere genişliyordu. */
        const yaprak = altlar.filter((a) => (cocuklar.get(a.id) ?? []).length === 0);
        const dal = altlar.filter((a) => (cocuklar.get(a.id) ?? []).length > 0);

        if (yaprak.length && dal.length) {
          const son = seviyeler[seviyeler.length - 1];
          const orta = Math.ceil(yaprak.length / 2);

          seviyeler[seviyeler.length - 1] = [
            ...yaprak.slice(0, orta),
            ...son,
            ...yaprak.slice(orta),
          ];

          return { tepeZinciri: seviyeler, mudurlukler: dal };
        }

        return { tepeZinciri: seviyeler, mudurlukler: altlar };
      }

      mevcut = altlar;
    }

    return { tepeZinciri: seviyeler, mudurlukler: [] };
  }, [cocuklar]);

  const kokler = cocuklar.get(null) ?? [];

  const listelenenUnvanlar = (eslesme?.unvanlar ?? []).filter((u: any) =>
    eslesmeSuzgec === "eksik" ? !u.eslesti : true
  );

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Organizasyon şeması"
        description="Kutulardaki sayı o ünvanda çalışan personel sayısıdır; tıklayınca kişi listesi açılır. Mikro'daki ünvan adı şemadakinden farklıysa personel görünmez — Ünvan Eşleştirme penceresinden bağlayabilirsiniz."
      />

      <Card size="small" className="rp-filtre">
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Space size={8} wrap>
            <Input
              allowClear
              placeholder="Ünvan ara"
              style={{ width: 230 }}
              prefix={<Search size={15} strokeWidth={2} color="#9AA3AF" />}
              value={arama}
              onChange={(e) => setArama(e.target.value)}
            />

            <Space.Compact>
              <Tooltip title="Küçült">
                <Button
                  icon={<Minimize2 size={15} strokeWidth={2} />}
                  disabled={olcek <= 30}
                  onClick={() => {
                    setSigdir(false);
                    setOlcek((o) => Math.max(30, o - 10));
                  }}
                />
              </Tooltip>
              <Tooltip title="Ekrana sığdır">
                <Button
                  type={sigdir ? "primary" : "default"}
                  style={{ width: 84 }}
                  onClick={() => setSigdir(true)}
                >
                  {sigdir ? "Sığdır" : `%${olcek}`}
                </Button>
              </Tooltip>
              <Tooltip title="Büyüt">
                <Button
                  icon={<Maximize2 size={15} strokeWidth={2} />}
                  disabled={olcek >= 150}
                  onClick={() => {
                    setSigdir(false);
                    setOlcek((o) => Math.min(150, o + 10));
                  }}
                />
              </Tooltip>
            </Space.Compact>
          </Space>

          {yetkim && !sinirli && (
            <Space wrap>
              <Button
                type={duzenle ? "primary" : "default"}
                onClick={async () => {
                  /* Düzenlemeye girerken konumsuz kutular başlangıç
                     yerine oturtuluyor; sonra sürükleyerek düzenleniyor. */
                  if (!duzenle && kutular.some((k) => k.konumX == null)) await otomatikDiz(false);
                  setDuzenle(!duzenle);
                }}
              >
                {duzenle ? "Düzenlemeyi bitir" : "Şemayı düzenle"}
              </Button>

              {duzenle && (
                <>
                  <Button
                    type="dashed"
                    onClick={() =>
                      setYeniKutu({
                        unvan: "",
                        ustId: secili?.id ?? null,
                        magazaMi: !!secili?.magazaMi,
                        genel: true,
                      })
                    }
                  >
                    ＋ Kutu ekle
                  </Button>

                  <Button
                    onClick={() =>
                      modal.confirm({
                        title: "Bütün kutular yeniden dizilsin mi?",
                        content: "Elle verdiğiniz konumlar kaybolur; kutular seviye seviye soldan sağa dizilir.",
                        okText: "Diz",
                        cancelText: "Vazgeç",
                        onOk: () => otomatikDiz(true),
                      })
                    }
                  >
                    Otomatik diz
                  </Button>

                  <Button danger onClick={() => setSifirla("")}>
                    Şemayı sıfırla
                  </Button>
                </>
              )}
            </Space>
          )}

          {yetkim && (
            <Badge count={eslesme?.eslesmeyenSayisi ?? 0} offset={[-4, 4]}>
              <Button
                icon={<Link2 size={15} strokeWidth={2} />}
                onClick={() => {
                  setEslesmeAcik(true);
                  eslesmeGetir();
                }}
              >
                Ünvan Eşleştirme
              </Button>
            </Badge>
          )}
        </Space>
      </Card>

      {yukleniyor ? (
        <div style={{ textAlign: "center", padding: "50px 0" }}>
          <Spin />
        </div>
      ) : kokler.length === 0 && !duzenle ? (
        <Card size="small">
          <Empty description="Organizasyon şeması tanımlanmamış.">
            {yetkim && !sinirli && (
              <Button type="primary" onClick={() => setDuzenle(true)}>
                Şemayı oluşturmaya başla
              </Button>
            )}
          </Empty>
        </Card>
      ) : (
        <Card size="small" className="oz-kart">
          <div
            className="oz-sarma"
            ref={sarmaRef}
            style={{
              /* Ölçeklenen şemanın kapladığı gerçek yükseklik: transform
                 yerleşimi etkilemediği için boşluk elle veriliyor. */
              height: dogal.boy ? dogal.boy * (olcek / 100) + 24 : undefined,
              overflow: sigdir ? "hidden" : "auto",
            }}
          >
            <div
              className="oz-sema"
              ref={semaRef}
              style={{
                transform: `scale(${olcek / 100})`,
                transformOrigin: "top left",
                width: "max-content",
              }}
            >
              {tuval ? (
                <OrgTuval
                  kutular={kutular}
                  duzenle={duzenle}
                  olcek={olcek}
                  seciliId={secili?.id ?? null}
                  logo={LOGO_ADRESI}
                  kutuSec={kutuAc}
                  konumKaydet={konumKaydet}
                />
              ) : (
              <>
              {/* ------------------------------------------------ başlık */}
              <div className="oz-baslik-satir">
                <div className="oz-baslik">
                  <h2>BİÇEN ORGANİZASYON ŞEMASI</h2>
                  <span>{new Date().toLocaleDateString("tr-TR")}</span>
                </div>

                <img className="oz-logo" src={LOGO_ADRESI} alt="Biçen" />
              </div>

              {/* --------------------------------------- yönetim zinciri */}
              <div className="oz-tepe">
                {tepeZinciri.map((seviye, i) => (
                  <div className="oz-tepe-satir" key={i}>
                    {seviye.map((k: any) => (
                      <Kutu key={k.id} kutu={k} />
                    ))}
                  </div>
                ))}
              </div>

              {/* ------------------------------------- müdürlük başlıkları */}
              {mudurlukler.length > 0 && (
                <div className="oz-mudurlukler">
                  {mudurlukler.map((m: any) => (
                    <div className="oz-mudurluk" key={m.id}>
                      <Kutu kutu={m} genis />

                      {(() => {
                        const altlar = (cocuklar.get(m.id) ?? []).filter(
                          (a) => !eslesenler || eslesenler.has(a.id)
                        );

                        /* Alt birimler en fazla üç sütunda, yukarıdan aşağıya:
                           hepsi yan yana dizilince şema ekrana sığmıyordu. */
                        const sutun =
                          altlar.length <= 1 ? 1
                          : altlar.length <= 6 ? 2
                          : 3;

                        return (
                          <div
                            className="oz-mudurluk-alt"
                            style={{ gridTemplateColumns: `repeat(${sutun}, auto)` }}
                          >
                            {altlar.map((a) => (
                              <Sutun key={a.id} kutu={a} />
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
              </>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------- kişi listesi */}
      <Drawer
        open={!!secili}
        onClose={() => setSecili(null)}
        width="min(780px, 96vw)"
        className="rp-cekmece"
        title={
          secili && (
            <Space size={8}>
              <Users size={16} strokeWidth={2} />
              <Text strong>{secili.unvan}</Text>
              {kisiler && <Tag>{kisiler.adet} kişi</Tag>}
            </Space>
          )
        }
      >
        {secili && (
          <KutuAyari
            kutu={secili}
            kutular={kutular}
            unvanlar={unvanSecenekleri}
            duzenleyebilir={yetkim && !sinirli}
            kaydedildi={(k) => {
              getir();
              if (k) setSecili(k);
            }}
            silindi={() => {
              setSecili(null);
              getir();
            }}
          />
        )}

        <div style={{ fontWeight: 700, fontSize: 13, margin: "18px 0 8px" }}>
          Bu kutudaki personel
        </div>

        {kisiYukleniyor ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : !kisiler || kisiler.adet === 0 ? (
          <>
            <Empty description="Bu ünvanda çalışan personel bulunmuyor." />

            {yetkim && (
              <Paragraph
                type="secondary"
                style={{ fontSize: 12.5, textAlign: "center", marginTop: 14 }}
              >
                Mikro'daki ünvan adı farklı olabilir. Ünvan Eşleştirme
                penceresinden bağlayabilirsiniz.
              </Paragraph>
            )}
          </>
        ) : (
          <Tablo
            rowKey="personelKodu"
            size="small"
            pagination={false}
            dataSource={kisiler.kisiler}
            scroll={{ x: 520 }}
            columns={[
              {
                title: "Personel",
                key: "ad",
                width: 220,
                render: (_v: unknown, p: any) => (
                  <Space size={8}>
                    <PersonelResmi
                      kod={p.personelKodu}
                      ad={p.ad}
                      boyut={30}
                      surum={p.resimSurumu}
                    />
                    <div>
                      <Text strong style={{ fontSize: 13 }}>
                        {p.ad} {p.soyad}
                      </Text>
                      <div style={{ fontSize: 11, color: "#8a8f98" }}>
                        {p.personelKodu}
                      </div>
                    </div>
                  </Space>
                ),
              },
              { title: "Birim", dataIndex: "isGrubu", ellipsis: true },
              ...(sinirli
                ? []
                : [
                    {
                      title: "İşe Giriş",
                      dataIndex: "girisTarihi",
                      width: 105,
                      render: (v: string) =>
                        v ? new Date(v).toLocaleDateString("tr-TR") : "—",
                    },
                  ]),
              {
                title: "Telefon",
                dataIndex: "telefon",
                width: 125,
                render: (v: string) => v || "—",
              },
            ]}
          />
        )}
      </Drawer>

      {/* -------------------------------------------------- eşleştirme */}
      <Drawer
        open={eslesmeAcik}
        onClose={() => setEslesmeAcik(false)}
        width="min(720px, 96vw)"
        className="rp-cekmece"
        title={
          <Space size={8}>
            <Link2 size={16} strokeWidth={2} />
            <Text strong>Ünvan Eşleştirme</Text>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Mikro ünvanlarını şemadaki kutulara bağlayın"
          description="Ünvan adları birebir aynıysa otomatik eşleşir. Farklı yazılmışsa buradan bağlayabilirsiniz; bağladığınız ünvandaki personel o kutuda görünür."
        />

        <Segmented
          block
          style={{ marginBottom: 12 }}
          value={eslesmeSuzgec}
          onChange={(v) => setEslesmeSuzgec(v as "eksik" | "tumu")}
          options={[
            {
              label: `Eşleşmeyenler (${eslesme?.eslesmeyenSayisi ?? 0})`,
              value: "eksik",
            },
            {
              label: `Tümü (${eslesme?.unvanlar?.length ?? 0})`,
              value: "tumu",
            },
          ]}
        />

        {eslesmeYukleniyor ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : listelenenUnvanlar.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              eslesmeSuzgec === "eksik"
                ? "Tüm ünvanlar eşleşmiş."
                : "Ünvan bulunamadı."
            }
          />
        ) : (
          <div className="oz-eslesme">
            {listelenenUnvanlar.map((u: any) => (
              <div className="oz-eslesme-satir" key={u.unvan}>
                <div className="oz-eslesme-ad">
                  <Text strong style={{ fontSize: 13 }}>
                    {u.unvan}
                  </Text>
                  <span>{u.kisiSayisi} kişi</span>
                </div>

                {!u.otomatikKutu && !u.elleKutuId && (
                  <Button
                    size="small"
                    onClick={() => setYeniKutu({ unvan: u.unvan, ustId: null, magazaMi: false })}
                  >
                    Kutu olarak ekle
                  </Button>
                )}

                {u.otomatikKutu ? (
                  <Tag color="green" style={{ marginInlineEnd: 0 }}>
                    otomatik: {u.otomatikKutu}
                  </Tag>
                ) : (
                  <Select
                    showSearch
                    allowClear
                    size="small"
                    style={{ width: 260 }}
                    placeholder="Kutuya bağla"
                    value={u.elleKutuId ?? undefined}
                    optionFilterProp="label"
                    onChange={(v) => eslestir(u.unvan, v ?? null)}
                    options={(eslesme?.kutular ?? []).map((k: any) => ({
                      value: k.id,
                      label: k.unvan,
                    }))}
                    /* Şemada karşılığı olmayan ünvan (Ürün Kabul Görevlisi
                       gibi) listede çıkmıyordu ve bağlanamıyordu. Aşağıdaki
                       düğme bu ünvan için yeni kutu açıp hemen bağlıyor. */
                    dropdownRender={(menu) => (
                      <>
                        {menu}
                        <div style={{ borderTop: "1px solid #eef0ea", padding: 6 }}>
                          <Button
                            type="link"
                            size="small"
                            style={{ paddingLeft: 4 }}
                            onClick={() => setYeniKutu({ unvan: u.unvan, ustId: null, magazaMi: false })}
                          >
                            ＋ Şemada yok — "{u.unvan}" için yeni kutu aç
                          </Button>
                        </div>
                      </>
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {/* -------------------------------------------- şemayı sıfırla */}
      <Modal
        open={sifirla !== null}
        title="Şema sıfırlansın mı?"
        okText="Sıfırla"
        okButtonProps={{ danger: true, disabled: sifirla !== "SIFIRLA" }}
        cancelText="Vazgeç"
        onCancel={() => setSifirla(null)}
        onOk={async () => {
          try {
            await api.gonder("/api/Personel/Organizasyon/Sifirla", { onay: sifirla });
            message.success("Şema sıfırlandı. İlk kutuyu ekleyerek başlayabilirsiniz.");
            setSifirla(null);
            setSecili(null);
            setDuzenle(true);
            getir();
            eslesmeGetir();
          } catch (h: any) {
            message.error(h.message);
          }
        }}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Yıllık izin onay zinciri şemadan geliyor"
          description="Şema yeniden kurulana kadar yeni yıllık izin talepleri birim ve üst yönetici aşamalarını atlayıp doğrudan İnsan Kaynakları'na düşer. Kutular silinmez, pasife alınır; gerekirse veritabanından geri getirilebilir. Elle yapılmış ünvan eşleştirmeleri silinir."
        />
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          Onaylamak için <b>SIFIRLA</b> yazın:
        </div>
        <Input value={sifirla ?? ""} onChange={(e) => setSifirla(e.target.value)} />
      </Modal>

      {/* ------------------------------------ eşleşmeyen ünvana yeni kutu */}
      <Modal
        open={!!yeniKutu}
        title={yeniKutu?.genel ? "Yeni kutu" : yeniKutu ? `"${yeniKutu.unvan}" için yeni kutu` : ""}
        okText={yeniKutu?.genel ? "Kutuyu ekle" : "Kutuyu aç ve bağla"}
        cancelText="Vazgeç"
        okButtonProps={{
          /* Genel eklemede en üst kutu (bağlısız) olabilir: sıfırdan
             başlarken ilk kutu Yönetim Kurulu gibi bir tepe kutusu. */
          disabled: yeniKutu?.genel ? !yeniKutu?.unvan?.trim() : !yeniKutu?.ustId,
        }}
        onCancel={() => setYeniKutu(null)}
        onOk={async () => {
          try {
            const ust = kutular.find((k) => k.id === yeniKutu.ustId);

            const c = await api.gonder<any>("/api/Personel/Organizasyon", {
              id: 0,
              ustId: yeniKutu.ustId,
              unvan: yeniKutu.unvan.trim(),
              renk: ust?.renk ?? "gri",
              sira: 99,
              magazaMi: !!yeniKutu.magazaMi,
              izinOnay: false,
              aciklama: null,
            });

            /* Eşleştirme penceresinden açılınca ünvan elle de bağlanıyor;
               genel eklemede ad birebir aynıysa zaten kendiliğinden eşleşir. */
            if (!yeniKutu.genel)
              await api.gonder("/api/Personel/OrganizasyonEslesme", {
                unvan: yeniKutu.unvan,
                kutuId: c.id,
              });

            /* Tuvaldeyse yeni kutu bağlı olduğu kutunun altına oturtuluyor;
               bağlısızsa sol üste. Sonra sürüklenerek yerine konuyor. */
            if (tuval && c?.id) {
              const x = ust?.konumX ?? 40;
              const y = ust?.konumY != null ? ust.konumY + KUTU_YUKSEKLIK + 30 : 120;
              const kardes = kutular.filter((k) => (k.ustId ?? null) === (yeniKutu.ustId ?? null)).length;

              await api.gonder("/api/Personel/Organizasyon/Konum", [
                { id: c.id, x: x + kardes * 20, y: y + kardes * 10, genislik: VARSAYILAN_GENISLIK },
              ]);
            }

            message.success(yeniKutu.genel ? "Kutu eklendi." : "Kutu açıldı ve ünvan bağlandı.");
            setYeniKutu(null);
            eslesmeGetir();
            getir();
          } catch (h: any) {
            message.error(h.message);
          }
        }}
      >
        {yeniKutu?.genel && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Ünvan</div>
            <AutoComplete
              style={{ width: "100%" }}
              autoFocus
              value={yeniKutu.unvan}
              onChange={(v) => setYeniKutu({ ...yeniKutu, unvan: v })}
              placeholder="Personel kartındaki ünvan ya da birim adı"
              options={unvanSecenekleri.map((u) => ({
                value: u.unvan,
                label: `${u.unvan} · ${u.kisiSayisi} kişi${u.eslesti ? "" : " · eşleşmemiş"}`,
              }))}
              filterOption={(g, o) =>
                String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))
              }
            />
          </div>
        )}

        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
          Kutu hangi birimin altında dursun? İzin talepleri bu kutudan yukarı
          çıkılarak ilk "onaylar" kutusuna gider.
          {yeniKutu?.genel ? " En üst kutu için boş bırakın." : ""}
        </div>
        <Select
          style={{ width: "100%" }}
          showSearch
          optionFilterProp="label"
          placeholder="Bağlı olduğu kutu — örn. Mağaza Müdürü"
          allowClear
          value={yeniKutu?.ustId ?? undefined}
          onChange={(v) => {
            const ust = kutular.find((k) => k.id === v);
            setYeniKutu({ ...yeniKutu, ustId: v, magazaMi: !!ust?.magazaMi });
          }}
          options={kutular.map((k) => ({ value: k.id, label: k.unvan }))}
        />
        <div style={{ marginTop: 10 }}>
          <Button
            size="small"
            type={yeniKutu?.magazaMi ? "primary" : "default"}
            onClick={() => setYeniKutu({ ...yeniKutu, magazaMi: !yeniKutu?.magazaMi })}
          >
            {yeniKutu?.magazaMi ? "✓ Mağaza pozisyonu" : "Merkez pozisyonu"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/* ========================================================================== */
/* Kutu ayarı                                                                 */
/* ========================================================================== */

/**
 * Seçilen kutunun ayarları ve izin onay zinciri.
 *
 * <p>
 * Yıllık izin talebi talep edenin kutusundan yukarı çıkılarak onaya
 * gidiyor: "izin onaylar" işaretli ilk kutu birim yöneticisi, bir
 * sonraki üst yönetici, sonra İnsan Kaynakları. Kimin kimden sorumlu
 * olduğu bu yüzden şemanın kendisi; ayrı bir liste tutulmuyor.
 * </p>
 *
 * <p>
 * Zincir önizlemesi, ayarı değiştirmeden önce sonucunu gösteriyor: bir
 * kutunun "onaylar" işaretini kaldırmak altındaki bütün personelin
 * talebini bir üst kutuya yollar ve bunu şemaya bakarak kestirmek zordu.
 * </p>
 */
function KutuAyari({
  kutu,
  kutular,
  unvanlar,
  duzenleyebilir,
  kaydedildi,
  silindi,
}: {
  kutu: any;
  kutular: any[];
  unvanlar: { unvan: string; kisiSayisi: number; eslesti: boolean }[];
  duzenleyebilir: boolean;
  kaydedildi: (k?: any) => void;
  silindi: () => void;
}) {
  const { message, modal } = AntdApp.useApp();

  const [f, setF] = useState<any>(kutu);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yeniAlt, setYeniAlt] = useState("");

  useEffect(() => setF(kutu), [kutu]);

  const bul = (id: number | null | undefined) => kutular.find((x) => x.id === id);

  /* Yukarı doğru "onaylar" işaretli ilk iki kutu */
  const zincir = useMemo(() => {
    const sonuc: any[] = [];
    let ust = bul(f.ustId);
    let koruma = 0;

    while (ust && sonuc.length < 2 && koruma++ < 50) {
      if (ust.izinOnay) sonuc.push(ust);
      ust = bul(ust.ustId);
    }

    return sonuc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.ustId, kutular]);

  /* Bu kutunun birim yöneticisi olduğu kutular: onay zincirinde ilk
     onaylayan kutu bu kutu olanlar */
  const sorumluOlduklari = useMemo(() => {
    if (!f.izinOnay) return [];

    return kutular.filter((k) => {
      if (k.id === f.id) return false;

      let ust = bul(k.ustId);
      let koruma = 0;

      while (ust && koruma++ < 50) {
        if (ust.izinOnay) return ust.id === f.id;
        ust = bul(ust.ustId);
      }

      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.id, f.izinOnay, kutular]);

  /* Döngü olmasın: kutu kendi altındaki bir kutuya bağlanamaz */
  const altKimlikler = useMemo(() => {
    const set = new Set<number>([f.id]);
    let degisti = true;

    while (degisti) {
      degisti = false;
      for (const k of kutular)
        if (k.ustId && set.has(k.ustId) && !set.has(k.id)) {
          set.add(k.id);
          degisti = true;
        }
    }

    return set;
  }, [f.id, kutular]);

  const kaydet = async (govde = f) => {
    setKaydediliyor(true);

    try {
      await api.gonder("/api/Personel/Organizasyon", {
        id: govde.id ?? 0,
        ustId: govde.ustId ?? null,
        unvan: (govde.unvan ?? "").trim(),
        renk: govde.renk ?? "gri",
        sira: govde.sira ?? 0,
        magazaMi: !!govde.magazaMi,
        izinOnay: !!govde.izinOnay,
        aciklama: govde.aciklama ?? null,
      });

      message.success("Kaydedildi.");
      kaydedildi(govde.id ? govde : undefined);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const altEkle = async () => {
    if (!yeniAlt.trim()) return;

    await kaydet({
      id: 0,
      ustId: f.id,
      unvan: yeniAlt.trim(),
      renk: f.renk,
      sira: 99,
      magazaMi: f.magazaMi,
      izinOnay: false,
    });

    setYeniAlt("");
  };

  const sil = () =>
    modal.confirm({
      title: `"${f.unvan}" kutusu silinsin mi?`,
      content:
        "Bu ünvana eşleşmiş personel şemada görünmez olur ve izin talepleri bir üst onaylayana gider.",
      okText: "Sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.sil(`/api/Personel/Organizasyon/${f.id}`);
          message.success("Kutu silindi.");
          silindi();
        } catch (h: any) {
          message.error(h.message);
        }
      },
    });

  const degisti =
    ["unvan", "ustId", "renk", "magazaMi", "izinOnay", "aciklama", "sira"].some(
      (a) => (f[a] ?? null) !== (kutu[a] ?? null)
    );

  const altSayisi = kutular.filter((k) => k.ustId === f.id).length;

  return (
    <div>
      {/* ----------------------------------------------- onay zinciri */}
      <div
        style={{
          background: "#f7faf2",
          border: "1px solid #e3ecd6",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280", letterSpacing: 0.4 }}>
          BU KUTUDAKİLERİN YILLIK İZİN ONAYI
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <Tag style={{ margin: 0 }}>{f.unvan}</Tag>
          <span style={{ color: "#9aa3af" }}>→</span>
          {zincir[0] ? (
            <Tag color="green" style={{ margin: 0 }}>
              {zincir[0].unvan} · birim yöneticisi
            </Tag>
          ) : (
            <Tag style={{ margin: 0 }}>birim yöneticisi yok · atlanır</Tag>
          )}
          <span style={{ color: "#9aa3af" }}>→</span>
          {zincir[1] ? (
            <Tag color="blue" style={{ margin: 0 }}>
              {zincir[1].unvan} · üst yönetici
            </Tag>
          ) : (
            <Tag style={{ margin: 0 }}>üst yönetici yok · atlanır</Tag>
          )}
          <span style={{ color: "#9aa3af" }}>→</span>
          <Tag color="purple" style={{ margin: 0 }}>
            İnsan Kaynakları
          </Tag>
        </div>

        {f.izinOnay && (
          <div style={{ fontSize: 12.5, color: "#46525d", marginTop: 10, lineHeight: 1.5 }}>
            <b>Bu kutu birim yöneticisi olarak onaylıyor:</b>{" "}
            {sorumluOlduklari.length
              ? sorumluOlduklari.map((k) => k.unvan).join(", ")
              : "altında onaysız kutu yok"}
            {f.magazaMi ? " — aynı şubedeki personel için." : "."}
          </div>
        )}

        {!f.magazaMi && f.izinOnay && (
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8, lineHeight: 1.5 }}>
            Bu kutuda birden fazla kişi varsa (bölge müdürleri gibi), talep şubesini
            kapsayan kişiye gider. Kişilerin sorumlu bölgeleri Biçen360 portalında
            Yetkiler → Kişiye özel → Sorumlu bölgeleri'nden atanır.
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- ayarlar */}
      {duzenleyebilir && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Ünvan</div>
              {/* Personel kartlarındaki ünvanlardan seçiliyor: ad birebir
                  aynıysa o ünvandaki personel kendiliğinden bu kutuya
                  düşüyor. Serbest yazı da kabul. */}
              <AutoComplete
                style={{ width: "100%" }}
                value={f.unvan}
                onChange={(v) => setF({ ...f, unvan: v })}
                options={unvanlar.map((u) => ({
                  value: u.unvan,
                  label: `${u.unvan} · ${u.kisiSayisi} kişi${u.eslesti ? "" : " · eşleşmemiş"}`,
                }))}
                filterOption={(g, o) =>
                  String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))
                }
                placeholder="Personel kartındaki ünvan"
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Bağlı olduğu kutu</div>
              <Select
                style={{ width: "100%" }}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="En üst seviye"
                value={f.ustId ?? undefined}
                onChange={(v) => setF({ ...f, ustId: v ?? null })}
                options={kutular
                  .filter((k) => !altKimlikler.has(k.id))
                  .map((k) => ({ value: k.id, label: k.unvan }))}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <Button
              type={f.izinOnay ? "primary" : "default"}
              onClick={() => setF({ ...f, izinOnay: !f.izinOnay })}
              style={f.izinOnay ? { background: "#5f8c10" } : undefined}
            >
              {f.izinOnay ? "✓ İzin onaylar" : "İzin onaylamaz"}
            </Button>
            <Button
              type={f.magazaMi ? "primary" : "default"}
              onClick={() => setF({ ...f, magazaMi: !f.magazaMi })}
            >
              {f.magazaMi ? "✓ Mağaza pozisyonu" : "Merkez pozisyonu"}
            </Button>

            <Segmented
              value={f.renk ?? "gri"}
              onChange={(v) => setF({ ...f, renk: String(v) })}
              options={Object.keys(RENKLER).map((r) => ({
                value: r,
                label: (
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      borderRadius: 7,
                      background: RENKLER[r].kenar,
                      verticalAlign: "middle",
                    }}
                  />
                ),
              }))}
            />
          </div>

          {/* Genişlik tuvalde geçerli: müdürlük başlıkları Excel'deki
              gibi geniş, alt kutular dar. Anında kaydediliyor. */}
          {f.konumX != null && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Genişlik</div>
              <Segmented
                value={f.genislik ?? 124}
                onChange={async (v) => {
                  try {
                    await api.gonder("/api/Personel/Organizasyon/Konum", [
                      { id: f.id, x: f.konumX, y: f.konumY, genislik: Number(v) },
                    ]);
                    setF({ ...f, genislik: Number(v) });
                    kaydedildi({ ...f, genislik: Number(v) });
                  } catch (h: any) {
                    message.error(h.message);
                  }
                }}
                options={[
                  { value: 100, label: "Dar" },
                  { value: 124, label: "Normal" },
                  { value: 250, label: "Geniş" },
                  { value: 380, label: "Çok geniş" },
                ]}
              />
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Açıklama</div>
            <Input.TextArea
              rows={2}
              value={f.aciklama ?? ""}
              onChange={(e) => setF({ ...f, aciklama: e.target.value })}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Button type="primary" disabled={!degisti || !f.unvan?.trim()} loading={kaydediliyor} onClick={() => kaydet()}>
              Değişiklikleri kaydet
            </Button>
            {degisti && <Button onClick={() => setF(kutu)}>Geri al</Button>}
            <div style={{ flex: 1 }} />
            <Tooltip title={altSayisi ? "Önce altındaki kutuları taşıyın ya da silin" : undefined}>
              <Button danger disabled={altSayisi > 0} onClick={sil}>
                Kutuyu sil
              </Button>
            </Tooltip>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <AutoComplete
              style={{ flex: 1 }}
              placeholder="Altına ünvan ekle — personel kartındaki ünvanlardan"
              value={yeniAlt}
              onChange={setYeniAlt}
              options={unvanlar
                .filter((u) => !u.eslesti)
                .map((u) => ({ value: u.unvan, label: `${u.unvan} · ${u.kisiSayisi} kişi` }))}
              filterOption={(g, o) =>
                String(o?.value ?? "").toLocaleLowerCase("tr").includes(g.toLocaleLowerCase("tr"))
              }
            />
            <Button onClick={altEkle} disabled={!yeniAlt.trim()} loading={kaydediliyor}>
              Ekle
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
