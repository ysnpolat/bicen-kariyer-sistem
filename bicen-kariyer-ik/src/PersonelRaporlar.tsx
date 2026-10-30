/**
 * ---------------------------------------------------------------------------
 * Personel Raporları
 * ---------------------------------------------------------------------------
 * Personel kartındaki "Raporlar" sekmesi (03.10.2026): sağlık raporları
 * tarih aralığı, tür ve açıklamayla girilir; rapor belgesi isteğe bağlı
 * yüklenir.
 *
 * Belge, personel belgeleriyle aynı yerde ("Sağlık Raporu" türüyle)
 * saklanıyor; bu yüzden Belgeler sekmesinde de kendiliğinden görünür.
 *
 * Onaylanan "Hastalık İzni (Rapor)" gibi izinler de burada listelenir ama
 * salt okunurdur: onları izin akışı yönetiyor.
 *
 * Raporlu personel norm kadroda "mevcut"tan düşülmez; Şube Raporu, Kadro
 * Düzenleme ve Bölge Raporu'nda ayrı bir sütunda bilgi olarak görünür.
 * Okutma ekranlarında "okutmadı" sayılmaz.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import {
  CloudUpload,
  Download,
  HeartPulse,
  Lock,
  Paperclip,
  Plus,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";

import { api } from "./api";
import { BelgeGoruntu, boyutYaz, turRozeti } from "./PersonelBelgeler";

const { RangePicker } = DatePicker;

/* -------------------------------------------------------------------------- */

interface RaporBelgesi {
  id: number;
  baslik: string | null;
  ozgunAd: string | null;
  boyut: number;
  uzanti: string;
  onizlenebilir: boolean;
}

export interface Rapor {
  id: number;
  personelKodu: string;
  baslangic: string;
  bitis: string;
  gun: number;
  raporTuru: string;
  aciklama: string | null;
  olusturan: string | null;
  olusturma: string;
  guncelleyen: string | null;
  guncelleme: string | null;

  /** rapor: kart kaydı · izin: İK'nın girdiği izin · talep: onaylanan izin talebi */
  kaynak: "rapor" | "izin" | "talep";
  saltOkunur: boolean;
  belge: RaporBelgesi | null;
}

/** Bugünkü durum (art arda raporlar birleşik) */
export interface RaporDurumu {
  baslangic: string;
  bitis: string;
  tur?: string;
  kaynak?: string;
}

interface Yanit {
  raporlar: Rapor[];
  turler: string[];
  bugun: RaporDurumu | null;
  belgeSilebilir: boolean;
}

const VARSAYILAN_TURLER = [
  "İstirahat raporu",
  "İş kazası",
  "Meslek hastalığı",
  "Analık/Doğum",
  "Refakat",
  "Diğer",
];

const TUR_RENGI: Record<string, string> = {
  "İstirahat raporu": "magenta",
  "İş kazası": "volcano",
  "Meslek hastalığı": "orange",
  "Analık/Doğum": "purple",
  Refakat: "geekblue",
};

const KAYNAK_ADI: Record<string, string> = {
  izin: "İzin kaydından",
  talep: "İzin talebinden",
};

const tarih = (v?: string | null) => (v ? dayjs(v).format("DD.MM.YYYY") : "—");

/** "1–5 Eki 2026" ya da "28 Eyl – 2 Eki 2026" */
const aralik = (bas: string, bit: string) => {
  const a = dayjs(bas);
  const b = dayjs(bit);

  if (a.isSame(b, "day")) return a.format("D MMM YYYY");
  if (a.isSame(b, "month")) return `${a.date()}–${b.format("D MMM YYYY")}`;
  if (a.isSame(b, "year")) return `${a.format("D MMM")} – ${b.format("D MMM YYYY")}`;
  return `${a.format("D MMM YYYY")} – ${b.format("D MMM YYYY")}`;
};

const gunSayisi = (bas: Dayjs, bit: Dayjs) => bit.startOf("day").diff(bas.startOf("day"), "day") + 1;

/* ========================================================================== */

export default function PersonelRaporlar({
  personelKodu,
  personelAdi,
  sayiDegisti,
  durumDegisti,
}: {
  personelKodu: string;
  personelAdi?: string;
  /** Rapor sayısı okununca / değişince (sekme rozeti) */
  sayiDegisti?: (adet: number) => void;
  /** Bugünkü raporlu durumu değişince (kart başlığı ve listedeki çip) */
  durumDegisti?: (durum: RaporDurumu | null) => void;
}) {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<Yanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  /* null: kapalı · "yeni" · düzenlenen rapor */
  const [form, setForm] = useState<"yeni" | Rapor | null>(null);
  const [silinecek, setSilinecek] = useState<Rapor | null>(null);
  const [onizleme, setOnizleme] = useState<Rapor | null>(null);

  const getir = useCallback(async () => {
    if (!personelKodu) return;

    setYukleniyor(true);

    try {
      const d = await api.al<Yanit>(`/api/PersonelRapor?kod=${encodeURIComponent(personelKodu)}`);

      setVeri(d);
      sayiDegisti?.((d.raporlar ?? []).length);
      durumDegisti?.(d.bugun ?? null);
    } catch {
      /* Yetkisi olmayan rolde bölüm sessizce boş kalır */
      setVeri({ raporlar: [], turler: VARSAYILAN_TURLER, bugun: null, belgeSilebilir: false });
    } finally {
      setYukleniyor(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personelKodu]);

  useEffect(() => {
    getir();
  }, [getir]);

  const raporlar = veri?.raporlar ?? [];
  const bugun = dayjs().startOf("day");

  /* Son 12 ay: girilen raporlar ve rapor izinleri birlikte */
  const yilBasi = bugun.subtract(12, "month");
  const sonYil = raporlar.filter((r) => !dayjs(r.bitis).isBefore(yilBasi));
  const sonYilGun = sonYil.reduce((t, r) => {
    const bas = dayjs(r.baslangic).isBefore(yilBasi) ? yilBasi : dayjs(r.baslangic);
    return t + Math.max(0, gunSayisi(bas, dayjs(r.bitis)));
  }, 0);

  const simdi = veri?.bugun ?? null;
  const kalan = simdi ? dayjs(simdi.bitis).startOf("day").diff(bugun, "day") + 1 : 0;

  const indir = async (r: Rapor) => {
    if (!r.belge) return;

    try {
      await api.indir(`/api/PersonelBelge/Indir/${r.belge.id}`, r.belge.ozgunAd || r.belge.baslik || "rapor");
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Belge indirilemedi.");
    }
  };

  const belgeAc = (r: Rapor) => {
    if (!r.belge) return;
    if (r.belge.onizlenebilir) setOnizleme(r);
    else indir(r);
  };

  return (
    <>
      <div className="pl-kart">
        <div className="pl-kart-bas">
          <h3>
            <HeartPulse size={16} strokeWidth={2} />
            Raporlar
          </h3>
          <span className="pl-rozetli">sağlık raporları ve rapor izinleri</span>
          <div className="pl-sag">
            <Button
              size="small"
              type="primary"
              icon={<Plus size={14} strokeWidth={2.2} />}
              onClick={() => setForm("yeni")}
            >
              Rapor ekle
            </Button>
          </div>
        </div>

        <div className="pl-kart-ic">
          <p className="pl-aciklama">
            Raporlu personel norm kadroda mevcuda dahil sayılır, okutma
            ekranlarında "okutmadı" yerine "Raporlu" görünür. Yüklenen rapor
            belgesi Belgeler sekmesinde de listelenir.
          </p>

          {yukleniyor && !veri ? (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <Spin />
            </div>
          ) : (
            <>
              <div className="pl-rapor-ozet">
                <div className={simdi ? "pl-rapor-simdi" : undefined}>
                  <span>Bugün</span>
                  <b>{simdi ? "Raporlu" : "—"}</b>
                  <small>
                    {simdi
                      ? `${tarih(simdi.bitis)} tarihine kadar · ${kalan} gün kaldı`
                      : "raporlu değil"}
                  </small>
                </div>
                <div>
                  <span>Son 12 ay</span>
                  <b>{sonYil.length}</b>
                  <small>rapor kaydı</small>
                </div>
                <div>
                  <span>Son 12 ay toplam</span>
                  <b>{sonYilGun}</b>
                  <small>raporlu gün</small>
                </div>
              </div>

              {raporlar.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Bu personel için rapor kaydı yok."
                />
              ) : (
                <Spin spinning={yukleniyor}>
                  <div className="pl-raporlar">
                    {raporlar.map((r) => {
                      const aktif =
                        !dayjs(r.baslangic).isAfter(bugun, "day") &&
                        !dayjs(r.bitis).isBefore(bugun, "day");
                      const ileri = dayjs(r.baslangic).isAfter(bugun, "day");

                      return (
                        <div
                          key={`${r.kaynak}-${r.id}`}
                          className={`pl-rapor${aktif ? " pl-rapor-aktif" : ""}${r.saltOkunur ? " pl-rapor-izin" : ""}`}
                        >
                          <div className="pl-rapor-gun">
                            <b>{r.gun}</b>
                            <small>GÜN</small>
                          </div>

                          <div className="pl-rapor-metin">
                            <b>
                              {aralik(r.baslangic, r.bitis)}
                              {aktif && <span className="pl-etiket pl-e-rapor">Devam ediyor</span>}
                              {ileri && <span className="pl-etiket pl-e-mavi">İleri tarihli</span>}
                              <Tag color={TUR_RENGI[r.raporTuru] ?? (r.saltOkunur ? "default" : "magenta")}>
                                {r.raporTuru}
                              </Tag>
                              {r.saltOkunur && (
                                <Tooltip title="İzin akışından geliyor; değişiklik izin kaydından yapılır.">
                                  <span className="pl-etiket pl-e-gri">
                                    <Lock size={11} strokeWidth={2.4} />
                                    {KAYNAK_ADI[r.kaynak] ?? "İzinden"}
                                  </span>
                                </Tooltip>
                              )}
                            </b>

                            {r.aciklama && <p>{r.aciklama}</p>}

                            <small>
                              {tarih(r.baslangic)} – {tarih(r.bitis)}
                              {r.olusturan ? ` · ${r.olusturan}` : ""}
                              {` · ${dayjs(r.olusturma).format("DD.MM.YYYY HH:mm")}`}
                              {r.guncelleyen && r.guncelleme
                                ? ` · düzenleyen ${r.guncelleyen}, ${dayjs(r.guncelleme).format("DD.MM.YYYY")}`
                                : ""}
                            </small>

                            {r.belge ? (
                              (() => {
                                const [rozet, sinif] = turRozeti(r.belge.uzanti);

                                return (
                                  <button
                                    type="button"
                                    className="pl-rapor-belge"
                                    onClick={() => belgeAc(r)}
                                    title={r.belge.ozgunAd ?? r.belge.baslik ?? ""}
                                  >
                                    <span className={`pl-belge-tur ${sinif}`}>{rozet}</span>
                                    <span>{r.belge.ozgunAd || r.belge.baslik}</span>
                                    {r.belge.boyut > 0 && (
                                      <small style={{ color: "#9aa39a", fontWeight: 500 }}>
                                        {boyutYaz(r.belge.boyut)}
                                      </small>
                                    )}
                                  </button>
                                );
                              })()
                            ) : (
                              !r.saltOkunur && (
                                <span className="pl-rapor-belgesiz">
                                  <Paperclip size={12} strokeWidth={2} />
                                  Belge yüklenmemiş
                                </span>
                              )
                            )}
                          </div>

                          <div className="pl-rapor-islem">
                            {r.belge && (
                              <Tooltip title="Belgeyi indir">
                                <Button
                                  type="text"
                                  size="small"
                                  aria-label="Belgeyi indir"
                                  icon={<Download size={15} strokeWidth={2} />}
                                  onClick={() => indir(r)}
                                />
                              </Tooltip>
                            )}

                            {!r.saltOkunur && (
                              <>
                                <Tooltip title="Düzenle">
                                  <Button
                                    type="text"
                                    size="small"
                                    aria-label="Raporu düzenle"
                                    icon={<SquarePen size={15} strokeWidth={2} />}
                                    onClick={() => setForm(r)}
                                  />
                                </Tooltip>

                                <Tooltip title="Kaldır">
                                  <Button
                                    type="text"
                                    size="small"
                                    danger
                                    aria-label="Raporu kaldır"
                                    icon={<Trash2 size={15} strokeWidth={2} />}
                                    onClick={() => setSilinecek(r)}
                                  />
                                </Tooltip>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Spin>
              )}
            </>
          )}
        </div>
      </div>

      {form && (
        <RaporFormu
          personelKodu={personelKodu}
          personelAdi={personelAdi}
          rapor={form === "yeni" ? null : form}
          turler={veri?.turler?.length ? veri.turler : VARSAYILAN_TURLER}
          kapat={() => setForm(null)}
          kaydedildi={(uyarilar) => {
            setForm(null);
            if (uyarilar.length > 0)
              message.warning({ content: `Kaydedildi. ${uyarilar.join(" ")}`, duration: 6 });
            else message.success("Rapor kaydedildi.");
            getir();
          }}
        />
      )}

      {silinecek && (
        <RaporSil
          rapor={silinecek}
          belgeSilebilir={!!veri?.belgeSilebilir}
          kapat={() => setSilinecek(null)}
          silindi={() => {
            setSilinecek(null);
            getir();
          }}
        />
      )}

      {onizleme?.belge && (
        <Modal
          open
          width="min(1000px, 94vw)"
          title={
            <Space size={8} wrap>
              <Tag color="magenta">Sağlık Raporu</Tag>
              <span>{onizleme.belge.baslik || aralik(onizleme.baslangic, onizleme.bitis)}</span>
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
          <div
            style={{
              height: "70vh",
              background: "#f5f5f5",
              borderRadius: 8,
              overflow: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BelgeGoruntu
              key={onizleme.belge.id}
              adres={api.belgeOnizleme(onizleme.belge.id)}
              resim={[".jpg", ".jpeg", ".png"].includes(onizleme.belge.uzanti)}
              baslik={onizleme.belge.baslik ?? "Rapor"}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

/* ========================================================================== */
/* Ekle / düzenle                                                              */
/* ========================================================================== */

const IZINLI = [".pdf", ".jpg", ".jpeg", ".png"];
const EN_BUYUK = 50 * 1024 * 1024;

function RaporFormu({
  personelKodu,
  personelAdi,
  rapor,
  turler,
  kapat,
  kaydedildi,
}: {
  personelKodu: string;
  personelAdi?: string;
  rapor: Rapor | null;
  turler: string[];
  kapat: () => void;
  kaydedildi: (uyarilar: string[]) => void;
}) {
  const { message } = AntdApp.useApp();

  const [tarihler, setTarihler] = useState<[Dayjs | null, Dayjs | null] | null>(
    rapor ? [dayjs(rapor.baslangic), dayjs(rapor.bitis)] : null
  );
  const [tur, setTur] = useState(rapor?.raporTuru ?? turler[0] ?? "İstirahat raporu");
  const [aciklama, setAciklama] = useState(rapor?.aciklama ?? "");
  const [dosya, setDosya] = useState<File | null>(null);
  const [belgeKaldir, setBelgeKaldir] = useState(false);
  const [uzerinde, setUzerinde] = useState(false);
  const [uyarilar, setUyarilar] = useState<string[]>([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const girdi = useRef<HTMLInputElement>(null);

  const bas = tarihler?.[0] ?? null;
  const bit = tarihler?.[1] ?? null;
  const gun = bas && bit ? gunSayisi(bas, bit) : null;

  /* Çakışma uyarıları: başka bir rapor ya da onaylı izin. Engellemez. */
  useEffect(() => {
    if (!bas || !bit) {
      setUyarilar([]);
      return;
    }

    let iptal = false;
    const zaman = window.setTimeout(() => {
      const sorgu = new URLSearchParams({
        kod: personelKodu,
        baslangic: bas.format("YYYY-MM-DD"),
        bitis: bit.format("YYYY-MM-DD"),
      });
      if (rapor) sorgu.set("haricId", String(rapor.id));

      api
        .al<{ uyarilar: string[] }>(`/api/PersonelRapor/Cakisma?${sorgu}`)
        .then((d) => !iptal && setUyarilar(d.uyarilar ?? []))
        .catch(() => !iptal && setUyarilar([]));
    }, 250);

    return () => {
      iptal = true;
      window.clearTimeout(zaman);
    };
  }, [bas?.valueOf(), bit?.valueOf(), personelKodu, rapor]); // eslint-disable-line react-hooks/exhaustive-deps

  const dosyaSec = (f?: File | null) => {
    if (!f) return;

    const uzanti = `.${(f.name.split(".").pop() ?? "").toLowerCase()}`;

    if (!IZINLI.includes(uzanti)) {
      message.warning("Rapor belgesi PDF, JPG ya da PNG olmalı.");
      return;
    }

    if (f.size > EN_BUYUK) {
      message.warning("Rapor belgesi en fazla 50 MB olabilir.");
      return;
    }

    setDosya(f);
    setBelgeKaldir(false);
  };

  const birak = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setUzerinde(false);
    dosyaSec(e.dataTransfer.files?.[0]);
  };

  const kaydet = async () => {
    if (!bas || !bit) {
      message.warning("Rapor tarihlerini seçiniz.");
      return;
    }

    setKaydediliyor(true);

    const govde = new FormData();
    govde.append("kod", personelKodu);
    govde.append("baslangic", bas.format("YYYY-MM-DD"));
    govde.append("bitis", bit.format("YYYY-MM-DD"));
    govde.append("raporTuru", tur);
    govde.append("aciklama", aciklama.trim());
    govde.append("belgeKaldir", String(belgeKaldir));
    if (dosya) govde.append("dosya", dosya);

    try {
      const d = await api.dosyaGonder<{ uyarilar?: string[] }>(
        rapor ? `/api/PersonelRapor/${rapor.id}` : "/api/PersonelRapor",
        govde
      );
      kaydedildi(d?.uyarilar ?? []);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  const mevcutBelge = rapor?.belge && !belgeKaldir && !dosya ? rapor.belge : null;

  return (
    <Modal
      open
      wrapClassName="pl-rapor-pencere"
      title={
        <Space size={8}>
          <HeartPulse size={17} strokeWidth={2} color="#a0277d" />
          {rapor ? "Raporu düzenle" : "Rapor ekle"}
          {personelAdi && (
            <span style={{ fontWeight: 500, color: "#7b8577" }}>· {personelAdi}</span>
          )}
        </Space>
      }
      onCancel={kapat}
      onOk={kaydet}
      okText={rapor ? "Kaydet" : "Raporu ekle"}
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      okButtonProps={{ disabled: !bas || !bit }}
      width={540}
      destroyOnClose
    >
      <div className="pl-rapor-form">
        <div className="pl-rf-satir pl-rf-iki">
          <div>
            <label className="pl-rf-etiket">Rapor tarihleri</label>
            <RangePicker
              style={{ width: "100%" }}
              format="DD.MM.YYYY"
              value={tarihler as any}
              placeholder={["Başlangıç", "Bitiş"]}
              onChange={(v) => setTarihler(v as any)}
              allowClear={false}
            />
          </div>
          <div>
            <label className="pl-rf-etiket">Süre</label>
            <div className={`pl-rf-gun${gun ? "" : " pl-bos"}`}>{gun ? `${gun} gün` : "—"}</div>
          </div>
        </div>

        {uyarilar.length > 0 && (
          <Alert
            className="pl-rf-uyari"
            type="warning"
            showIcon
            message="Çakışma var — yine de kaydedebilirsiniz"
            description={
              <ul>
                {uyarilar.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            }
          />
        )}

        <div className="pl-rf-satir">
          <label className="pl-rf-etiket">Rapor türü</label>
          <Select
            style={{ width: "100%" }}
            value={tur}
            onChange={setTur}
            options={turler.map((t) => ({ value: t, label: t }))}
          />
        </div>

        <div className="pl-rf-satir">
          <label className="pl-rf-etiket">Açıklama (isteğe bağlı)</label>
          <Input.TextArea
            rows={2}
            maxLength={500}
            placeholder="Örn. hastane adı, rapor numarası"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
          />
        </div>

        <div className="pl-rf-satir" style={{ marginBottom: 0 }}>
          <label className="pl-rf-etiket">Rapor belgesi (isteğe bağlı)</label>

          {dosya || mevcutBelge ? (
            (() => {
              const ad = dosya ? dosya.name : mevcutBelge!.ozgunAd || mevcutBelge!.baslik || "Belge";
              const [rozet, sinif] = turRozeti(
                dosya ? `.${(dosya.name.split(".").pop() ?? "").toLowerCase()}` : mevcutBelge!.uzanti
              );

              return (
                <div className="pl-rf-dosya">
                  <span className={`pl-belge-tur ${sinif}`}>{rozet}</span>
                  <div>
                    <b title={ad}>{ad}</b>
                    <small>
                      {dosya
                        ? `${boyutYaz(dosya.size)} · ${rapor?.belge ? "eski belgenin yerine geçecek" : "yüklenecek"}`
                        : `${boyutYaz(mevcutBelge!.boyut)} · yüklü`}
                    </small>
                  </div>
                  <Button size="small" onClick={() => girdi.current?.click()}>
                    Değiştir
                  </Button>
                  <Tooltip title={dosya ? "Seçimi kaldır" : "Belgeyi rapordan kaldır"}>
                    <Button
                      size="small"
                      type="text"
                      aria-label="Belgeyi kaldır"
                      icon={<X size={15} strokeWidth={2} />}
                      onClick={() => {
                        if (dosya) setDosya(null);
                        else setBelgeKaldir(true);
                      }}
                    />
                  </Tooltip>
                </div>
              );
            })()
          ) : (
            <div
              className={`pl-rf-birak${uzerinde ? " pl-uzerinde" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => girdi.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && girdi.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setUzerinde(true);
              }}
              onDragLeave={() => setUzerinde(false)}
              onDrop={birak}
            >
              <CloudUpload size={26} strokeWidth={1.8} />
              <b>Dosyayı buraya bırakın ya da seçmek için tıklayın</b>
              <small>PDF, JPG ya da PNG · en fazla 50 MB</small>
            </div>
          )}

          {belgeKaldir && rapor?.belge && (
            <div style={{ fontSize: 12, color: "#a33410", marginTop: 6 }}>
              Kaydedince belge rapordan ve Belgeler sekmesinden kaldırılır.{" "}
              <a onClick={() => setBelgeKaldir(false)}>Geri al</a>
            </div>
          )}

          {/* Antd Upload yerine düz dosya girdisi: bileşenin kendi yükleme
              akışı isteği iki kez göndermeye çalışıyordu (bkz. Belgeler). */}
          <input
            ref={girdi}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            style={{ display: "none" }}
            onChange={(e) => {
              dosyaSec(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          <div style={{ fontSize: 11.5, color: "#9aa39a", marginTop: 6 }}>
            Belge "Sağlık Raporu" türüyle Belgeler sekmesine de eklenir; personele
            kapalı yüklenir.
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/* Kaldır                                                                      */
/* ========================================================================== */

function RaporSil({
  rapor,
  belgeSilebilir,
  kapat,
  silindi,
}: {
  rapor: Rapor;
  belgeSilebilir: boolean;
  kapat: () => void;
  silindi: () => void;
}) {
  const { message } = AntdApp.useApp();

  /* Varsayılan: belge kalsın. Rapor yanlış girilmiş olsa da belge özlük
     evrakı olarak saklanmaya değer olabilir. */
  const [belgeSil, setBelgeSil] = useState(false);
  const [siliniyor, setSiliniyor] = useState(false);

  const sil = async () => {
    setSiliniyor(true);

    try {
      await api.sil(`/api/PersonelRapor/${rapor.id}?belgeSil=${belgeSil}`);
      message.success(belgeSil ? "Rapor ve belgesi kaldırıldı." : "Rapor kaldırıldı.");
      silindi();
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
    } finally {
      setSiliniyor(false);
    }
  };

  return (
    <Modal
      open
      wrapClassName="pl-rapor-pencere"
      title="Rapor kaldırılsın mı?"
      onCancel={kapat}
      onOk={sil}
      okText="Kaldır"
      okButtonProps={{ danger: true }}
      cancelText="Vazgeç"
      confirmLoading={siliniyor}
      width={460}
    >
      <p style={{ marginTop: 0 }}>
        <b>{aralik(rapor.baslangic, rapor.bitis)}</b> · {rapor.raporTuru} · {rapor.gun} gün
      </p>
      <p style={{ color: "#6b7280", fontSize: 13 }}>
        Kayıt listeden ve norm kadro / okutma ekranlarından çıkar.
      </p>

      {rapor.belge && (
        <>
          <Checkbox
            checked={belgeSil}
            disabled={!belgeSilebilir}
            onChange={(e) => setBelgeSil(e.target.checked)}
          >
            Rapor belgesini de Belgeler'den kaldır
          </Checkbox>
          <div style={{ fontSize: 12, color: "#9aa39a", marginTop: 4, marginLeft: 24 }}>
            {belgeSilebilir
              ? "İşaretlemezseniz belge Belgeler sekmesinde kalır."
              : "Belge kaldırma yalnızca İK yöneticisinde; belge Belgeler sekmesinde kalır."}
          </div>
        </>
      )}
    </Modal>
  );
}
