/**
 * ---------------------------------------------------------------------------
 * Personel Belgeleri
 * ---------------------------------------------------------------------------
 * Tutanak, ihtar, savunma, sözleşme gibi özlük evrakları personel kartından
 * yüklenir ve indirilir.
 *
 * Evraklar bugüne kadar İK'nın kendi klasörlerinde duruyordu; bir personelin
 * geçmişinde ne olduğunu görmek için dosya sunucusunda arama yapmak
 * gerekiyordu. Kayıtla birlikte durduğunda kartı açan herkes aynı geçmişi
 * görüyor.
 *
 * Belgeler kimlik numarasıyla da eşleşir: personel ayrılıp geri döndüğünde
 * Mikro yeni bir personel kodu veriyor ve eski tutanakları yeni kartında
 * görünmez oluyordu.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Checkbox,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderClosed,
  FolderOpen,
  Gavel,
  HeartPulse,
  Contact,
  ListChecks,
  Trash2,
  Upload,
} from "lucide-react";

import { api } from "./api";
import BasvuruDetayModal from "./BasvuruDetayModal";
import IseGirisEvraklari from "./IseGirisEvraklari";
import type { EvrakDurumu } from "./IseGirisEvraklari";
import TaramaDugmesi from "./TaramaDugmesi";

const { Text } = Typography;

interface Belge {
  id: number;
  personelKodu: string;
  tur: string;
  baslik: string;
  aciklama: string | null;
  ozgunAd: string | null;
  boyut: number;
  yukleyen: string | null;
  olusturma: string;

  /** Personelin kendi uygulamasında görünüyor mu */
  personeleAcik: boolean;

  /** ".pdf", ".jpg" … küçük harfle */
  uzanti: string;

  /** Tarayıcıda gösterilebilir mi; Word ve Excel için false */
  onizlenebilir: boolean;

  /** Klasör: Özlük, İzin, Raporlar, Disiplin, Diğer (sunucu belirliyor) */
  kategori: string;

  /** İşe giriş evrakıysa evrak kodu (ikametgah, sabika…) */
  evrakKodu: string | null;
}

/**
 * Evrak türleri, klasöre göre.
 *
 * Serbest metin yerine sabit liste: aynı şey "tutanak", "Tutanak" ve
 * "tutanak tuttuk" diye üç ayrı biçimde giriliyordu ve süzmek imkânsız
 * hâle geliyordu. Listede olmayan bir şey için "Diğer" var.
 */
const KLASOR_TURLERI: Record<string, string[]> = {
  Özlük: ["Sözleşme", "Özlük Evrakı", "İbraname", "Eğitim Belgesi", "Diğer"],
  İzin: ["İzin Formu", "Mazeret Belgesi", "Diğer"],
  Raporlar: ["Sağlık Raporu", "Diğer"],
  Disiplin: ["Tutanak", "İhtar", "Savunma", "Uyarı"],
  Diğer: ["Diğer"],
};

const TUR_RENKLERI: Record<string, string> = {
  Tutanak: "orange",
  İhtar: "red",
  Savunma: "gold",
  Uyarı: "volcano",
  Sözleşme: "blue",
  /* Personel kartının Raporlar sekmesindeki rapor belgeleri de bu türle
     yükleniyor; "Raporlu" etiketiyle aynı erik rengi */
  "Sağlık Raporu": "magenta",
  "Eğitim Belgesi": "green",
  İbraname: "purple",
  "Özlük Evrakı": "geekblue",
  "İzin Formu": "cyan",
  "Mazeret Belgesi": "cyan",
};

/**
 * Belge klasörleri (03.10.2026). Sunucu kategorisi yazılmamış eski
 * belgeleri türünden yerleştiriyor.
 */
const KLASORLER: { k: string; ad: string; alt: string; ikon: JSX.Element; sinif: string }[] = [
  { k: "Özlük", ad: "Özlük", alt: "Başvuru formu, işe giriş evrakları, sözleşme", ikon: <Contact size={20} strokeWidth={1.9} />, sinif: "pb-k-ozluk" },
  { k: "İzin", ad: "İzin", alt: "Yıllık izin formları, mazeret belgeleri", ikon: <CalendarDays size={20} strokeWidth={1.9} />, sinif: "pb-k-izin" },
  { k: "Raporlar", ad: "Raporlar", alt: "Sağlık raporları", ikon: <HeartPulse size={20} strokeWidth={1.9} />, sinif: "pb-k-rapor" },
  { k: "Disiplin", ad: "Disiplin", alt: "Tutanak, ihtar, savunma", ikon: <Gavel size={20} strokeWidth={1.9} />, sinif: "pb-k-disiplin" },
  { k: "Diğer", ad: "Diğer", alt: "Sınıflanmamış belgeler", ikon: <FolderClosed size={20} strokeWidth={1.9} />, sinif: "pb-k-diger" },
];

/** Belge türü etiketi: sağlık raporu simgeli (Raporlar sekmesinden gelir) */
export const TurEtiketi = ({ tur }: { tur: string }) =>
  tur === "Sağlık Raporu" ? (
    <Tooltip title="Sağlık raporu · personel kartındaki Raporlar sekmesinde ya da işe giriş evraklarında">
      <Tag color={TUR_RENKLERI[tur]} className="pl-tag-rapor">
        <HeartPulse size={11} strokeWidth={2.4} />
        {tur}
      </Tag>
    </Tooltip>
  ) : (
    <Tag color={TUR_RENKLERI[tur] ?? "default"}>{tur}</Tag>
  );

/** 1536000 → "1,5 MB" */
export const boyutYaz = (bayt: number) => {
  if (!bayt) return "—";
  if (bayt < 1024) return `${bayt} B`;
  if (bayt < 1024 * 1024) return `${Math.round(bayt / 1024)} KB`;

  return `${(bayt / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
};

/* ========================================================================== */

/** Dosya türü rozeti: uzantıya göre kısa ad ve renk sınıfı */
export const turRozeti = (uzanti: string): [string, string] => {
  const u = (uzanti || "").replace(".", "").toLowerCase();
  if (u === "pdf") return ["PDF", "pl-bt-pdf"];
  if (["jpg", "jpeg", "png"].includes(u)) return [u === "png" ? "PNG" : "JPG", "pl-bt-resim"];
  if (["doc", "docx"].includes(u)) return ["DOC", "pl-bt-doc"];
  if (["xls", "xlsx"].includes(u)) return ["XLS", "pl-bt-xls"];
  return [u ? u.toUpperCase().slice(0, 4) : "DOSYA", "pl-bt-diger"];
};

/* ========================================================================== */

/**
 * Personel kartındaki "Belgeler" sekmesi. Görünüm Personeller.css içindeki
 * "pl-" sınıflarından: belgeler dosya kartları olarak dizilir (02.10.2026).
 */
/* ========================================================================== */

interface BasvuruKaydi {
  id: number;
  basvuruNo: string;
  olusturma: string;
  durum: string;
  subeAdi: string | null;
  bolumler: string | null;
  iseGirisBolum: string | null;
  iseGirisTarihi: string | null;
}

/**
 * Personel kartındaki "Belgeler" sekmesi: klasörler (03.10.2026).
 *
 * Özlük klasöründe başvuru formu ve işe giriş evrak listesi, İzin'de izin
 * formları, Raporlar'da sağlık raporları, Disiplin'de tutanak ve ihtarlar.
 * Görünüm Personeller.css içindeki "pl-" ve "pb-" sınıflarından.
 */
export default function PersonelBelgeler({
  personelKodu,
  personelAdi,
  sayiDegisti,
  ilkKlasor,
}: {
  personelKodu: string;
  personelAdi?: string;
  /** Belge sayısı okununca / değişince (sekme rozetindeki sayı için) */
  sayiDegisti?: (adet: number) => void;
  /** Açılışta seçili klasör (karttaki "eksik evrak" uyarısından → Özlük) */
  ilkKlasor?: string;
}) {
  const { message } = AntdApp.useApp();

  const [belgeler, setBelgeler] = useState<Belge[]>([]);
  const [silebilir, setSilebilir] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [formAcik, setFormAcik] = useState(false);
  const [klasor, setKlasor] = useState<string>(ilkKlasor ?? "Özlük");

  /* İşe giriş evrakları ve kişinin başvuruları (Özlük klasörü) */
  const [evrak, setEvrak] = useState<EvrakDurumu | null>(null);
  const [basvurular, setBasvurular] = useState<BasvuruKaydi[]>([]);
  const [evrakYetki, setEvrakYetki] = useState(false);
  const [baslatiliyor, setBaslatiliyor] = useState(false);
  const [acikBasvuru, setAcikBasvuru] = useState<number | null>(null);

  /* Önizlenen belge. Tutanağa bakmak için dosyayı bilgisayara indirmek
     gereksiz bir adımdı; PDF ve resimler pencerede açılıyor. */
  const [onizleme, setOnizleme] = useState<Belge | null>(null);

  const belgeGetir = useCallback(async () => {
    if (!personelKodu) return;

    try {
      const c = await api.al<{ belgeler: Belge[]; silebilir: boolean }>(
        `/api/PersonelBelge?kod=${encodeURIComponent(personelKodu)}`
      );

      setBelgeler(c.belgeler ?? []);
      setSilebilir(!!c.silebilir);
      sayiDegisti?.((c.belgeler ?? []).length);
    } catch (h) {
      /* Yetkisi olmayan rolde bölüm sessizce boş kalır; hata kutusu
         göstermek kartı açan herkesi rahatsız ederdi. */
      setBelgeler([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personelKodu]);

  const evrakGetir = useCallback(async () => {
    if (!personelKodu) return;

    try {
      const c = await api.al<{ durum: EvrakDurumu; basvurular: BasvuruKaydi[] }>(
        `/api/IseGirisEvrak/Personel?kod=${encodeURIComponent(personelKodu)}`
      );
      setEvrak(c.durum);
      setBasvurular(c.basvurular ?? []);
      setEvrakYetki(true);
    } catch {
      setEvrak(null);
      setBasvurular([]);
      setEvrakYetki(false);
    }
  }, [personelKodu]);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    await Promise.all([belgeGetir(), evrakGetir()]);
    setYukleniyor(false);
  }, [belgeGetir, evrakGetir]);

  useEffect(() => {
    getir();
  }, [getir]);

  const takipBaslat = async () => {
    setBaslatiliyor(true);
    try {
      await api.gonder("/api/IseGirisEvrak/Baslat", { kod: personelKodu });
      message.success("İşe giriş evrak listesi açıldı.");
      await evrakGetir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Başlatılamadı.");
    } finally {
      setBaslatiliyor(false);
    }
  };

  const indir = async (belge: Belge) => {
    try {
      await api.indir(
        `/api/PersonelBelge/Indir/${belge.id}`,
        belge.ozgunAd || belge.baslik
      );
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Belge indirilemedi.");
    }
  };

  /* Görünürlük tek tıkla değişiyor: hangi evrakın personele açılacağı
     belge belge verilen bir karar ve pencere açtırmak akışı kesiyordu. */
  const gorunurluk = async (belge: Belge, acik: boolean) => {
    try {
      await api.gonder(`/api/PersonelBelge/Gorunurluk/${belge.id}`, { acik });

      message.success(
        acik
          ? "Belge personele açıldı, bildirim gönderildi."
          : "Belge personelden gizlendi."
      );

      belgeGetir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Değiştirilemedi.");
    }
  };

  const sil = async (id: number) => {
    try {
      await api.sil(`/api/PersonelBelge/${id}`);
      message.success("Belge kaldırıldı.");
      belgeGetir();
      evrakGetir();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
    }
  };

  /* ------------------------------------------------------------ sayılar */
  const klasorunde = (k: string) => belgeler.filter((b) => (b.kategori || "Diğer") === k);

  const sayilar: Record<string, number> = {};
  KLASORLER.forEach((x) => (sayilar[x.k] = klasorunde(x.k).length));
  sayilar["Özlük"] += basvurular.length;

  const eksikEvrak = evrak?.takipVar ? evrak.ozet.eksik : 0;

  /* ------------------------------------------------------------ belge kartı */
  const belgeKarti = (k: Belge) => {
    const [rozet, sinif] = turRozeti(k.uzanti);

    return (
      <div
        className={`pl-belge${k.tur === "Sağlık Raporu" ? " pl-belge-rapor" : ""}`}
        key={k.id}
      >
        <div className="pl-belge-ust">
          <div className={`pl-belge-tur ${sinif}`}>{rozet}</div>

          <div className="pl-belge-metin">
            <span className="pb-etiketler">
              <TurEtiketi tur={k.tur} />
              {k.evrakKodu && <Tag className="pb-tag-giris">İşe giriş</Tag>}
            </span>
            <b
              className={k.onizlenebilir ? "pl-tik" : undefined}
              title={k.ozgunAd ?? k.baslik}
              onClick={() => k.onizlenebilir && setOnizleme(k)}
            >
              {k.baslik}
            </b>
            {k.aciklama && <small className="pl-belge-aciklama">{k.aciklama}</small>}
            <small>
              {k.yukleyen || "—"} · {dayjs(k.olusturma).format("DD.MM.YYYY HH:mm")}
              {k.boyut ? ` · ${boyutYaz(k.boyut)}` : ""}
            </small>
          </div>
        </div>

        <div className="pl-belge-alt">
          <Tooltip
            title={
              k.personeleAcik
                ? "Personel bu belgeyi uygulamasında görüyor. Kapatmak için tıklayınız."
                : "Personel bu belgeyi göremiyor. Açmak için tıklayınız; bildirim gider."
            }
          >
            <Button
              size="small"
              type={k.personeleAcik ? "primary" : "default"}
              ghost={k.personeleAcik}
              icon={
                k.personeleAcik ? (
                  <Eye size={14} strokeWidth={2} />
                ) : (
                  <EyeOff size={14} strokeWidth={2} />
                )
              }
              onClick={() => gorunurluk(k, !k.personeleAcik)}
            >
              {k.personeleAcik ? "Personelde açık" : "Personelde kapalı"}
            </Button>
          </Tooltip>

          <div className="pl-sag">
            {k.onizlenebilir && (
              <Button size="small" onClick={() => setOnizleme(k)}>
                Aç
              </Button>
            )}

            <Tooltip title="İndir">
              <Button
                type="text"
                size="small"
                aria-label="İndir"
                icon={<Download size={15} strokeWidth={2} />}
                onClick={() => indir(k)}
              />
            </Tooltip>

            {silebilir && (
              <Popconfirm
                title="Belge kaldırılsın mı?"
                description="Kayıt listeden çıkar, dosya sunucuda saklanmaya devam eder."
                okText="Kaldır"
                cancelText="Vazgeç"
                onConfirm={() => sil(k.id)}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  aria-label="Kaldır"
                  icon={<Trash2 size={15} strokeWidth={2} />}
                />
              </Popconfirm>
            )}
          </div>
        </div>
      </div>
    );
  };

  const belgeIzgarasi = (liste: Belge[], bos: string) =>
    liste.length === 0 ? (
      <div className="pb-bos">{bos}</div>
    ) : (
      <div className="pl-belgeler">{liste.map(belgeKarti)}</div>
    );

  /* ------------------------------------------------------------ Özlük */
  const ozluk = () => {
    /* İşe giriş evrakları listede ayrıca görünüyor; klasörde tekrar
       kart olarak dizilmesin */
    const diger = klasorunde("Özlük").filter((b) => !b.evrakKodu);

    return (
      <>
        {evrakYetki && (
          <section className="pb-bolum">
            {evrak?.takipVar ? (
              <IseGirisEvraklari
                personelKodu={personelKodu}
                kisiAdi={personelAdi}
                disDurum={evrak}
                degisti={(d) => {
                  setEvrak(d);
                  belgeGetir();
                }}
              />
            ) : (
              <div className="pb-takip-yok">
                <ListChecks size={20} strokeWidth={2} />
                <div>
                  <b>İşe giriş evrak listesi açılmamış</b>
                  <small>
                    Başvurudan "İşe al" ile alınan personelde liste kendiliğinden açılır. Bu
                    personelin evraklarını takip etmek için listeyi başlatabilirsiniz.
                  </small>
                </div>
                <Button size="small" loading={baslatiliyor} onClick={takipBaslat}>
                  Listeyi başlat
                </Button>
              </div>
            )}
          </section>
        )}

        <section className="pb-bolum">
          <h4 className="pb-bolum-bas">
            <ClipboardList size={15} strokeWidth={2} />
            Başvuru formu
          </h4>

          {basvurular.length === 0 ? (
            <div className="pb-bos">
              Kariyer sitesinden yapılmış bir başvurusu bulunamadı.
            </div>
          ) : (
            <div className="pb-basvurular">
              {basvurular.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  className="pb-basvuru"
                  onClick={() => setAcikBasvuru(b.id)}
                >
                  <span className="pb-basvuru-simge">
                    <FileText size={18} strokeWidth={1.9} />
                  </span>
                  <span className="pb-basvuru-metin">
                    <b>Başvuru formu · {b.basvuruNo}</b>
                    <small>
                      {dayjs(b.olusturma).format("DD.MM.YYYY")}
                      {b.subeAdi ? ` · ${b.subeAdi}` : ""}
                      {(b.iseGirisBolum || b.bolumler) ? ` · ${b.iseGirisBolum || b.bolumler}` : ""}
                    </small>
                  </span>
                  <Tag className="pb-basvuru-durum">{b.durum}</Tag>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pb-bolum">
          <h4 className="pb-bolum-bas">
            <FileText size={15} strokeWidth={2} />
            Diğer özlük belgeleri
            {diger.length > 0 && <span className="pb-say">{diger.length}</span>}
          </h4>
          {belgeIzgarasi(diger, "Sözleşme, ibraname gibi belgeler burada görünür.")}
        </section>
      </>
    );
  };

  const secili = KLASORLER.find((x) => x.k === klasor) ?? KLASORLER[0];

  return (
    <>
      <div className="pl-kart">
        <div className="pl-kart-bas">
          <h3>
            <FolderOpen size={16} strokeWidth={2} />
            Belgeler
          </h3>
          <span className="pl-rozetli">{belgeler.length + basvurular.length} belge</span>
          <div className="pl-sag">
            <Button
              size="small"
              type="primary"
              icon={<Upload size={14} strokeWidth={2} />}
              onClick={() => setFormAcik(true)}
            >
              Belge ekle
            </Button>
          </div>
        </div>

        <div className="pl-kart-ic">
          {yukleniyor ? (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <Spin />
            </div>
          ) : (
            <>
              <div className="pb-klasorler" role="tablist">
                {KLASORLER.map((x) => (
                  <button
                    key={x.k}
                    type="button"
                    role="tab"
                    aria-selected={klasor === x.k}
                    className={`pb-klasor ${x.sinif}${klasor === x.k ? " pb-aktif" : ""}`}
                    onClick={() => setKlasor(x.k)}
                  >
                    <span className="pb-klasor-sekme" />
                    <span className="pb-klasor-ikon">{x.ikon}</span>
                    <span className="pb-klasor-metin">
                      <b>{x.ad}</b>
                      <small>
                        {sayilar[x.k] ? `${sayilar[x.k]} belge` : "Boş"}
                      </small>
                    </span>
                    {x.k === "Özlük" && eksikEvrak > 0 && (
                      <Tooltip title={`${eksikEvrak} işe giriş evrakı eksik`}>
                        <span className="pb-klasor-uyari">{eksikEvrak} eksik</span>
                      </Tooltip>
                    )}
                  </button>
                ))}
              </div>

              <div className="pb-yol">
                <FolderOpen size={14} strokeWidth={2} />
                <span>Belgeler</span>
                <ChevronRight size={13} strokeWidth={2} />
                <b>{secili.ad}</b>
                <small>{secili.alt}</small>
              </div>

              {klasor === "Özlük"
                ? ozluk()
                : belgeIzgarasi(
                    klasorunde(klasor),
                    klasor === "Raporlar"
                      ? "Sağlık raporu yok. Raporlar sekmesinden girilen raporların belgeleri de burada görünür."
                      : klasor === "İzin"
                        ? "İzin formu yok. Onaylanan izinlerin formları ve izin talebine eklenen belgeler burada görünür."
                        : "Bu klasörde belge yok."
                  )}
            </>
          )}
        </div>
      </div>

      {onizleme && (
        <Modal
          open
          width="min(1000px, 94vw)"
          title={
            <Space size={8} wrap>
              <TurEtiketi tur={onizleme.tur} />
              <span>{onizleme.baslik}</span>
            </Space>
          }
          onCancel={() => setOnizleme(null)}
          footer={
            <Space>
              <Button onClick={() => setOnizleme(null)}>Kapat</Button>
              <Button
                type="primary"
                icon={<Download size={14} strokeWidth={2} />}
                onClick={() => indir(onizleme)}
              >
                İndir
              </Button>
            </Space>
          }
        >
          {onizleme.aciklama && (
            <Text type="secondary" style={{ whiteSpace: "pre-wrap" }}>
              {onizleme.aciklama}
            </Text>
          )}

          <div
            style={{
              marginTop: 10,
              height: "70vh",
              background: "#f5f5f5",
              borderRadius: 8,
              overflow: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Resimler img, PDF ve metin iframe. İkisi de dosyayı
                önce indirip tarayıcının kendi adresinden (blob:)
                gösteriyor: API'nin güvenlik başlıkları (çerçeve yasağı)
                doğrudan adrese konan iframe'i gri, boş kutuya
                çeviriyordu. */}
            {[".jpg", ".jpeg", ".png", ".pdf", ".txt"].includes(onizleme.uzanti) ? (
              <BelgeGoruntu
                key={onizleme.id}
                adres={api.belgeOnizleme(onizleme.id)}
                resim={[".jpg", ".jpeg", ".png"].includes(onizleme.uzanti)}
                baslik={onizleme.baslik}
              />
            ) : (
              /* Word, Excel gibi dosyaları tarayıcı gösteremiyor; iframe
                 boş kalıyor ya da dosyayı sessizce indiriyordu. */
              <div style={{ textAlign: "center", color: "#6b7280", padding: 24 }}>
                <div style={{ fontWeight: 600, color: "#1f2933", marginBottom: 6 }}>
                  Bu dosya türü ({onizleme.uzanti}) tarayıcıda önizlenemiyor.
                </div>
                Dosyayı açmak için <b>İndir</b> düğmesini kullanın.
              </div>
            )}
          </div>
        </Modal>
      )}

      {formAcik && (
        <BelgeFormu
          personelKodu={personelKodu}
          personelAdi={personelAdi}
          klasor={klasor}
          kapat={() => setFormAcik(false)}
          yuklendi={(k) => {
            setFormAcik(false);
            if (k) setKlasor(k);
            belgeGetir();
          }}
        />
      )}

      {acikBasvuru !== null && (
        <BasvuruDetayModal
          basvuruId={acikBasvuru}
          ilkSekme="form"
          kapat={() => setAcikBasvuru(null)}
        />
      )}
    </>
  );
}

/* ========================================================================== */

function BelgeFormu({
  personelKodu,
  personelAdi,
  klasor: ilkKlasor,
  kapat,
  yuklendi,
}: {
  personelKodu: string;
  personelAdi?: string;
  /** Açık klasör; belge oraya yüklenir (değiştirilebilir) */
  klasor: string;
  kapat: () => void;
  yuklendi: (klasor?: string) => void;
}) {
  const { message } = AntdApp.useApp();

  const [klasor, setKlasor] = useState(ilkKlasor in KLASOR_TURLERI ? ilkKlasor : "Diğer");
  const [tur, setTur] = useState(KLASOR_TURLERI[ilkKlasor]?.[0] ?? "Diğer");
  const [baslik, setBaslik] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [dosya, setDosya] = useState<File | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  /* Varsayılan kapalı: yanlışlıkla açılan bir tutanağı geri almak, hiç
     açılmamış olmasından daha zor. */
  const [personeleAcik, setPersoneleAcik] = useState(false);

  const kaydet = async () => {
    if (!dosya) return message.warning("Dosya seçiniz.");

    setYukleniyor(true);

    const form = new FormData();

    form.append("kod", personelKodu);
    form.append("tur", tur);
    form.append("baslik", baslik.trim());
    form.append("aciklama", aciklama.trim());
    form.append("personeleAcik", String(personeleAcik));
    form.append("dosya", dosya);
    form.append("kategori", klasor);

    try {
      await api.dosyaGonder("/api/PersonelBelge", form);
      message.success(`Belge ${klasor} klasörüne yüklendi.`);
      yuklendi(klasor);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Yüklenemedi.");
    } finally {
      setYukleniyor(false);
    }
  };

  return (
    <Modal
      open
      title={personelAdi ? `Belge ekle — ${personelAdi}` : "Belge ekle"}
      onCancel={kapat}
      onOk={kaydet}
      okText="Yükle"
      cancelText="Vazgeç"
      confirmLoading={yukleniyor}
      okButtonProps={{ disabled: !dosya }}
      width={520}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Klasör
            </Text>
            <Select
              style={{ width: "100%" }}
              value={klasor}
              onChange={(k) => {
                setKlasor(k);
                setTur(KLASOR_TURLERI[k][0]);
              }}
              options={KLASORLER.map((x) => ({ value: x.k, label: x.ad }))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Belge türü
            </Text>
            <Select
              style={{ width: "100%" }}
              value={tur}
              onChange={setTur}
              options={(KLASOR_TURLERI[klasor] ?? ["Diğer"]).map((t) => ({ value: t, label: t }))}
            />
          </div>
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Başlık
          </Text>
          <Input
            placeholder="Örn. 12.09.2026 geç kalma tutanağı"
            value={baslik}
            onChange={(e) => setBaslik(e.target.value)}
            maxLength={200}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Açıklama (isteğe bağlı)
          </Text>
          <Input.TextArea
            rows={3}
            placeholder="Olayın kısa özeti"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Dosya
          </Text>

          {/* Antd Upload yerine düz dosya girdisi: bileşenin kendi yükleme
              akışı devreye girip isteği iki kez göndermeye çalışıyordu. */}
          <Input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt"
            onChange={(e) => setDosya(e.target.files?.[0] ?? null)}
          />

          <div className="tarama-satir" style={{ marginTop: 6, marginBottom: 2 }}>
            <TaramaDugmesi boyut="small" ad="belge" onDosya={setDosya} />
            <span>ya da tarayıcıdaki evrakı tarayın</span>
          </div>

          {dosya && (
            <div style={{ fontSize: 12, color: "#8a8f98", marginTop: 4 }}>
              <FileText size={12} strokeWidth={2} style={{ verticalAlign: -1 }} />{" "}
              {dosya.name} · {boyutYaz(dosya.size)}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: "#b0b4ba", marginTop: 4 }}>
            PDF, resim, Word, Excel ve metin dosyaları · en fazla 500 MB
          </div>
        </div>

        {/* Varsayılan kapalı: tutanak ve ihtar gibi evrakların personele
            açılması ayrı bir karar, yüklemenin varsayılanı değil. */}
        <Checkbox
          checked={personeleAcik}
          onChange={(e) => setPersoneleAcik(e.target.checked)}
        >
          Personel bu belgeyi uygulamasında görsün
        </Checkbox>

        <Text type="secondary" style={{ fontSize: 11.5 }}>
          İşaretlerseniz personele bildirim gider ve belge Bilgilerim
          ekranında listelenir. İşaretlemezseniz belge yalnızca İK'da kalır;
          sonradan listeden açabilirsiniz.
        </Text>
      </Space>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Belge önizlemesi.
 *
 * Dosya fetch ile alınıyor. PDF, tarayıcının PDF eklentisine hiç
 * bırakılmadan pdf.js ile sayfa sayfa tuvale çiziliyor: iframe ile
 * gösterim sunucu ve IIS çerçeve kuralları (X-Frame-Options) yüzünden gri,
 * boş bir kutu olarak kalıyordu (29.09.2026). Resim ve metin blob
 * adresinden gösteriliyor. Her durumda "Yeni sekmede aç" da var.
 */
export function BelgeGoruntu({ adres, resim, baslik }: { adres: string; resim: boolean; baslik: string }) {
  const [blob, setBlob] = useState<string | null>(null);
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    let iptal = false;
    let url: string | null = null;

    setBlob(null);
    setPdf(null);
    setHata(null);

    fetch(adres)
      .then(async (c) => {
        if (!c.ok) {
          let mesaj = `Belge açılamadı (${c.status}).`;
          try {
            const j = await c.json();
            if (j?.hata) mesaj = j.hata;
          } catch {
            /* gövde JSON değil */
          }
          throw new Error(mesaj);
        }
        return c.blob();
      })
      .then(async (b) => {
        if (iptal) return;
        url = URL.createObjectURL(b);
        setBlob(url);
        if (b.type.includes("pdf")) setPdf(await b.arrayBuffer());
      })
      .catch((h) => !iptal && setHata(h instanceof Error ? h.message : "Belge açılamadı."));

    return () => {
      iptal = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [adres]);

  if (hata)
    return (
      <div style={{ textAlign: "center", color: "#b42318", padding: 24 }}>
        {hata}
        <div style={{ color: "#6b7280", marginTop: 6 }}>
          Dosyayı <b>İndir</b> düğmesiyle açmayı deneyin.
        </div>
      </div>
    );

  if (!blob) return <Spin />;

  const yeniSekme = (
    <Button
      size="small"
      style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}
      onClick={() => window.open(blob, "_blank", "noopener")}
    >
      Yeni sekmede aç
    </Button>
  );

  if (pdf)
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        {yeniSekme}
        <PdfSayfalari veri={pdf} />
      </div>
    );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {yeniSekme}
      {resim ? (
        <img src={blob} alt={baslik} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      ) : (
        <iframe title={baslik} src={blob} style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} />
      )}
    </div>
  );
}

/** PDF sayfaları pdf.js ile tuvale; en fazla 40 sayfa */
function PdfSayfalari({ veri }: { veri: ArrayBuffer }) {
  const kutu = useRef<HTMLDivElement>(null);
  const [durum, setDurum] = useState<string | null>("PDF hazırlanıyor…");

  useEffect(() => {
    let iptal = false;
    let belge: any = null;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const isci = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = isci;

        belge = await pdfjs.getDocument({ data: new Uint8Array(veri.slice(0)) }).promise;
        if (iptal || !kutu.current) return;

        kutu.current.innerHTML = "";
        const genislik = Math.max(300, kutu.current.clientWidth - 24);
        const sayfaSayisi = Math.min(belge.numPages, 40);

        for (let i = 1; i <= sayfaSayisi; i++) {
          const sayfa = await belge.getPage(i);
          if (iptal || !kutu.current) return;

          const ilk = sayfa.getViewport({ scale: 1 });
          const olcek = genislik / ilk.width;
          const oran = window.devicePixelRatio || 1;
          const gorunum = sayfa.getViewport({ scale: olcek * oran });

          const tuval = document.createElement("canvas");
          tuval.width = Math.floor(gorunum.width);
          tuval.height = Math.floor(gorunum.height);
          tuval.style.width = `${Math.floor(gorunum.width / oran)}px`;
          tuval.style.display = "block";
          tuval.style.margin = "0 auto 12px";
          tuval.style.boxShadow = "0 1px 4px rgba(0,0,0,.15)";
          tuval.style.background = "#fff";
          kutu.current.appendChild(tuval);

          await sayfa.render({ canvasContext: tuval.getContext("2d")!, viewport: gorunum }).promise;
        }

        if (!iptal) setDurum(belge.numPages > 40 ? `İlk 40 sayfa gösteriliyor (toplam ${belge.numPages}).` : null);
      } catch (h) {
        if (!iptal) setDurum(`PDF gösterilemedi: ${h instanceof Error ? h.message : "bilinmeyen hata"}. İndir ya da Yeni sekmede aç ile açabilirsiniz.`);
      }
    })();

    return () => {
      iptal = true;
      belge?.destroy?.();
    };
  }, [veri]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: 12 }}>
      {durum && <div style={{ textAlign: "center", color: "#6b7280", margin: "8px 0" }}>{durum}</div>}
      <div ref={kutu} />
    </div>
  );
}
