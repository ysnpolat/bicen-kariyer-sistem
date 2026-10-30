/**
 * ---------------------------------------------------------------------------
 * İşe Giriş Evrakları (03.10.2026)
 * ---------------------------------------------------------------------------
 * İşe alımda adaydan istenen evrakların kontrol listesi: ikametgâh, sabıka
 * kaydı, sağlık raporu… Her evrakın satırına dosya yüklenir (sürükle-bırak
 * da olur). Herkese gerekmeyen evrak (askerlik gibi) "Gerekmiyor"
 * işaretlenir.
 *
 * Aynı bileşen üç yerde: başvurunun detayında, "İşe al" penceresinde ve
 * personel kartının Belgeler → Özlük klasöründe. Aday henüz Mikro'da
 * yokken yüklenen evrak kimlik numarasıyla personel kartına düşer.
 *
 * Eksik evrak işe alımı durdurmaz; personel kartında "eksik" görünür.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Input, Modal, Popover, Space, Spin, Tooltip } from "antd";
import dayjs from "dayjs";
import {
  Ban,
  Check,
  CircleAlert,
  Download,
  FileCheck2,
  Landmark,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";

import { api } from "./api";
import { BelgeGoruntu, boyutYaz, turRozeti } from "./PersonelBelgeler";
import "./IseGirisEvraklari.css";
import TaramaDugmesi from "./TaramaDugmesi";
import TopluTarama from "./TopluTarama";

export interface EvrakDosyasi {
  id: number;
  baslik: string;
  ozgunAd: string | null;
  boyut: number;
  yukleyen: string | null;
  olusturma: string;
  uzanti: string;
  onizlenebilir: boolean;
}

export interface EvrakSatiri {
  kod: string;
  ad: string;
  kaynak: string | null;
  kategori: string;
  adet: number;
  not: string | null;
  durum: "tamam" | "eksik" | "gerekmiyor";
  /** Kalıcı ayraç numarası (toplu tarama) */
  ayracNo?: number;
  durumAciklama: string | null;
  durumYazan: string | null;
  belgeler: EvrakDosyasi[];
}

export interface EvrakOzeti {
  toplam: number;
  tamam: number;
  gerekmiyor: number;
  eksik: number;
  eksikler: string[];
}

export interface EvrakDurumu {
  takipVar: boolean;
  takip: { id: number; basvuruId: number | null; baslatan: string | null; baslama: string } | null;
  evraklar: EvrakSatiri[];
  ozet: EvrakOzeti;
}

const UZANTILAR = ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt";

/** e-Devlet gibi kaynaklar kısa çipe sığsın */
const kaynakKisa = (k: string | null) => {
  if (!k) return null;
  if (/e-?devlet/i.test(k)) return "e-Devlet";
  return k;
};

export default function IseGirisEvraklari({
  basvuruId,
  personelKodu,
  kompakt,
  degisti,
  baslikGizle,
  disDurum,
  kisiAdi,
}: {
  basvuruId?: number;
  personelKodu?: string;
  /** İşe al penceresi için sıkışık görünüm */
  kompakt?: boolean;
  /** Yükleme / işaretleme sonrası güncel durum */
  degisti?: (d: EvrakDurumu) => void;
  baslikGizle?: boolean;
  /** Durum dışarıda okunduysa (personel kartı) tekrar okunmasın */
  disDurum?: EvrakDurumu | null;
  /** Toplu taramadaki ayraç sayfalarına basılan ad */
  kisiAdi?: string;
}) {
  const { message } = AntdApp.useApp();

  const [durum, setDurum] = useState<EvrakDurumu | null>(disDurum ?? null);
  const [yukleniyor, setYukleniyor] = useState(!disDurum);
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useState<"hepsi" | "eksik">("hepsi");
  const [onizleme, setOnizleme] = useState<EvrakDosyasi | null>(null);
  const [surukle, setSurukle] = useState<string | null>(null);
  const [gerekmiyorAcik, setGerekmiyorAcik] = useState<EvrakSatiri | null>(null);
  const [gerekmiyorNot, setGerekmiyorNot] = useState("");
  /* 15.10.2026: bütün evrakları tek taramada ayraçlarla */
  const [topluAcik, setTopluAcik] = useState(false);

  const girdi = useRef<HTMLInputElement>(null);
  const hedef = useRef<string | null>(null);

  const hedefGovde = basvuruId ? { basvuruId } : { kod: personelKodu };

  const yaz = (d: EvrakDurumu) => {
    setDurum(d);
    degisti?.(d);
  };

  const getir = useCallback(async () => {
    if (!basvuruId && !personelKodu) return;

    setYukleniyor(true);

    try {
      if (basvuruId) {
        yaz(await api.al<EvrakDurumu>(`/api/IseGirisEvrak/Basvuru/${basvuruId}`));
      } else {
        const c = await api.al<{ durum: EvrakDurumu }>(
          `/api/IseGirisEvrak/Personel?kod=${encodeURIComponent(personelKodu!)}`
        );
        yaz(c.durum);
      }
    } catch {
      setDurum(null);
    } finally {
      setYukleniyor(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basvuruId, personelKodu]);

  useEffect(() => {
    if (disDurum) {
      setDurum(disDurum);
      setYukleniyor(false);
    } else getir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getir, disDurum]);

  const yukle = async (evrakKodu: string, dosyalar: File[]) => {
    if (dosyalar.length === 0) return;

    const form = new FormData();
    if (basvuruId) form.append("basvuruId", String(basvuruId));
    if (personelKodu) form.append("kod", personelKodu);
    form.append("evrakKodu", evrakKodu);
    dosyalar.forEach((d) => form.append("dosyalar", d));

    setMesgul(evrakKodu);

    try {
      const c = await api.dosyaGonder<{ durum: EvrakDurumu }>("/api/IseGirisEvrak/Yukle", form);
      yaz(c.durum);
      message.success(dosyalar.length > 1 ? `${dosyalar.length} dosya yüklendi.` : "Evrak yüklendi.");
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Yüklenemedi.");
    } finally {
      setMesgul(null);
    }
  };

  /* Toplu tarama: her evrak sırayla, sessiz (sonuç toplu taramada gösterilir) */
  const topluYukle = async (evrakKodu: string, dosya: File) => {
    const form = new FormData();
    if (basvuruId) form.append("basvuruId", String(basvuruId));
    if (personelKodu) form.append("kod", personelKodu);
    form.append("evrakKodu", evrakKodu);
    form.append("dosyalar", dosya);
    const c = await api.dosyaGonder<{ durum: EvrakDurumu }>("/api/IseGirisEvrak/Yukle", form);
    yaz(c.durum);
  };

  const dosyaSec = (kod: string) => {
    hedef.current = kod;
    if (girdi.current) {
      girdi.current.value = "";
      girdi.current.click();
    }
  };

  const isaretle = async (e: EvrakSatiri, gerekmiyor: boolean, aciklama = "") => {
    setMesgul(e.kod);

    try {
      const c = await api.gonder<{ durum: EvrakDurumu }>("/api/IseGirisEvrak/Durum", {
        ...hedefGovde,
        evrakKodu: e.kod,
        gerekmiyor,
        aciklama,
      });
      yaz(c.durum);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setMesgul(null);
    }
  };

  const kaldir = (b: EvrakDosyasi, e: EvrakSatiri) => {
    Modal.confirm({
      title: "Dosya kaldırılsın mı?",
      content: `${e.ad} · ${b.ozgunAd ?? b.baslik}`,
      okText: "Kaldır",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          const c = await api.sil<{ durum: EvrakDurumu }>(`/api/IseGirisEvrak/Belge/${b.id}`);
          yaz(c.durum);
          message.success("Dosya kaldırıldı.");
        } catch (h) {
          message.error(h instanceof Error ? h.message : "Kaldırılamadı.");
        }
      },
    });
  };

  const indir = async (b: EvrakDosyasi) => {
    try {
      await api.indir(`/api/PersonelBelge/Indir/${b.id}`, b.ozgunAd || b.baslik);
    } catch (h) {
      message.error(h instanceof Error ? h.message : "İndirilemedi.");
    }
  };

  if (yukleniyor)
    return (
      <div className="ge ge-bos">
        <Spin size="small" />
      </div>
    );

  if (!durum) return null;

  const { ozet } = durum;
  const yuzde = ozet.toplam ? Math.round(((ozet.tamam + ozet.gerekmiyor) / ozet.toplam) * 100) : 0;
  const satirlar = durum.evraklar.filter((e) => suzgec === "hepsi" || e.durum === "eksik");

  return (
    <div className={`ge${kompakt ? " ge-kompakt" : ""}`}>
      {!baslikGizle && (
        <div className="ge-bas">
          <div className="ge-bas-sol">
            <span className={`ge-halka${ozet.eksik === 0 ? " ge-halka-tamam" : ""}`}>
              {ozet.eksik === 0 ? <Check size={16} strokeWidth={3} /> : <FileCheck2 size={16} strokeWidth={2.2} />}
            </span>
            <div>
              <b>İşe giriş evrakları</b>
              <small>
                {ozet.eksik === 0
                  ? "Tüm evraklar tamam"
                  : `${ozet.tamam + ozet.gerekmiyor} / ${ozet.toplam} tamam · ${ozet.eksik} eksik`}
              </small>
            </div>
          </div>

          <div className="ge-suzgec" role="tablist">
            <button
              type="button"
              className={suzgec === "hepsi" ? "ge-aktif" : undefined}
              onClick={() => setSuzgec("hepsi")}
            >
              Tümü <span>{ozet.toplam}</span>
            </button>
            <button
              type="button"
              className={suzgec === "eksik" ? "ge-aktif" : undefined}
              onClick={() => setSuzgec("eksik")}
              disabled={ozet.eksik === 0}
            >
              Eksik <span className={ozet.eksik ? "ge-say-uyari" : undefined}>{ozet.eksik}</span>
            </button>
          </div>
        </div>
      )}

      <div className="ge-cubuk" title={`%${yuzde}`}>
        <i style={{ width: `${yuzde}%` }} className={ozet.eksik === 0 ? "ge-cubuk-tamam" : undefined} />
      </div>

      <div className="ge-toplu">
        <Tooltip title="Bütün evrakları ayraç sayfalarıyla tek seferde tarayın; sistem evraklara ayırır, siz onaylarsınız.">
          <Button size="small" onClick={() => setTopluAcik(true)}>
            Toplu tara
          </Button>
        </Tooltip>
      </div>
      <TopluTarama
        acik={topluAcik}
        kapat={() => setTopluAcik(false)}
        evraklar={durum.evraklar.map((e) => ({ kod: e.kod, ad: e.ad, durum: e.durum, ayracNo: e.ayracNo }))}
        kisiAdi={kisiAdi || (personelKodu ? `Sicil ${personelKodu}` : "Aday")}
        yukle={topluYukle}
      />

      <input
        ref={girdi}
        type="file"
        multiple
        accept={UZANTILAR}
        style={{ display: "none" }}
        onChange={(ev) => {
          const kod = hedef.current;
          const dosyalar = Array.from(ev.target.files ?? []);
          if (kod) yukle(kod, dosyalar);
        }}
      />

      <ol className="ge-liste">
        {satirlar.map((e) => {
          const no = durum.evraklar.indexOf(e) + 1;
          const kaynak = kaynakKisa(e.kaynak);

          return (
            <li
              key={e.kod}
              className={`ge-satir ge-${e.durum}${surukle === e.kod ? " ge-surukle" : ""}`}
              onDragOver={(ev) => {
                ev.preventDefault();
                if (surukle !== e.kod) setSurukle(e.kod);
              }}
              onDragLeave={() => setSurukle((s) => (s === e.kod ? null : s))}
              onDrop={(ev) => {
                ev.preventDefault();
                setSurukle(null);
                yukle(e.kod, Array.from(ev.dataTransfer.files ?? []));
              }}
            >
              <span className="ge-durum" aria-label={e.durum}>
                {e.durum === "tamam" ? (
                  <Check size={14} strokeWidth={3} />
                ) : e.durum === "gerekmiyor" ? (
                  <Ban size={13} strokeWidth={2.4} />
                ) : (
                  <span className="ge-no">{no}</span>
                )}
              </span>

              <div className="ge-orta">
                <div className="ge-ad">
                  <b>{e.ad}</b>
                  {e.adet > 1 && <span className="ge-cip ge-cip-adet">{e.adet} adet</span>}
                  {kaynak && (
                    <Tooltip title={e.kaynak}>
                      <span className={`ge-cip${kaynak === "e-Devlet" ? " ge-cip-edevlet" : ""}`}>
                        {kaynak === "e-Devlet" && <Landmark size={11} strokeWidth={2.2} />}
                        {kaynak}
                      </span>
                    </Tooltip>
                  )}
                  {e.kategori !== "Özlük" && (
                    <Tooltip title={`Personel kartında ${e.kategori} klasörüne düşer`}>
                      <span className="ge-cip ge-cip-klasor">{e.kategori}</span>
                    </Tooltip>
                  )}
                </div>

                {e.durum === "gerekmiyor" ? (
                  <small className="ge-alt">
                    Gerekmiyor{e.durumAciklama ? ` · ${e.durumAciklama}` : ""}
                    {e.durumYazan ? ` · ${e.durumYazan}` : ""}
                  </small>
                ) : e.belgeler.length === 0 ? (
                  e.not && <small className="ge-alt">{e.not}</small>
                ) : (
                  <div className="ge-dosyalar">
                    {e.belgeler.map((b) => {
                      const [rozet, sinif] = turRozeti(b.uzanti);

                      return (
                        <span className="ge-dosya" key={b.id}>
                          <span className={`ge-dosya-tur ${sinif}`}>{rozet}</span>
                          <Tooltip
                            title={`${b.ozgunAd ?? b.baslik} · ${boyutYaz(b.boyut)} · ${b.yukleyen ?? ""} · ${dayjs(
                              b.olusturma
                            ).format("DD.MM.YYYY HH:mm")}`}
                          >
                            <button
                              type="button"
                              className="ge-dosya-ad"
                              onClick={() => (b.onizlenebilir ? setOnizleme(b) : indir(b))}
                            >
                              {b.ozgunAd ?? b.baslik}
                            </button>
                          </Tooltip>
                          <button
                            type="button"
                            className="ge-dosya-x"
                            aria-label="Kaldır"
                            onClick={() => kaldir(b, e)}
                          >
                            <X size={12} strokeWidth={2.4} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="ge-sag">
                {mesgul === e.kod ? (
                  <Spin size="small" />
                ) : e.durum === "gerekmiyor" ? (
                  <Button size="small" icon={<RotateCcw size={13} strokeWidth={2} />} onClick={() => isaretle(e, false)}>
                    Geri al
                  </Button>
                ) : (
                  <>
                    <Button
                      size="small"
                      type={e.durum === "eksik" ? "primary" : "default"}
                      icon={e.durum === "eksik" ? <Upload size={13} strokeWidth={2.2} /> : <Paperclip size={13} strokeWidth={2.2} />}
                      onClick={() => dosyaSec(e.kod)}
                    >
                      {e.durum === "eksik" ? "Yükle" : kompakt ? "" : "Ekle"}
                    </Button>

                    <TaramaDugmesi kucuk boyut="small" ad={e.kod.toLowerCase()} onDosya={(d) => yukle(e.kod, [d])} />

                    {e.durum === "eksik" && (
                      <Popover
                        trigger="click"
                        placement="bottomRight"
                        arrow={false}
                        content={
                          <button
                            type="button"
                            className="ge-menu-dugme"
                            onClick={() => {
                              setGerekmiyorNot("");
                              setGerekmiyorAcik(e);
                            }}
                          >
                            <Ban size={14} strokeWidth={2} />
                            Bu aday için gerekmiyor
                          </button>
                        }
                      >
                        <Button size="small" type="text" aria-label="Diğer" icon={<MoreHorizontal size={15} />} />
                      </Popover>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}

        {satirlar.length === 0 && <li className="ge-hepsi-tamam">Eksik evrak kalmadı.</li>}
      </ol>

      {ozet.eksik > 0 && (
        <div className="ge-ipucu">
          <CircleAlert size={14} strokeWidth={2.2} />
          Eksik evrakla da işe alım yapılabilir; eksikler personel kartında görünür ve sonradan
          tamamlanabilir. Dosyayı satırın üzerine sürükleyip bırakabilirsiniz.
        </div>
      )}

      {gerekmiyorAcik && (
        <Modal
          open
          width={420}
          title={`${gerekmiyorAcik.ad} · gerekmiyor`}
          okText="İşaretle"
          cancelText="Vazgeç"
          onCancel={() => setGerekmiyorAcik(null)}
          onOk={async () => {
            const e = gerekmiyorAcik;
            setGerekmiyorAcik(null);
            await isaretle(e, true, gerekmiyorNot.trim());
          }}
        >
          <p style={{ marginTop: 4, color: "#4b5563" }}>
            Bu evrak eksik sayılmaz. Örneğin kadın adaylarda ya da muaflarda askerlik belgesi.
          </p>
          <Input
            placeholder="Kısa not (isteğe bağlı) · örn. Kadın aday"
            maxLength={300}
            value={gerekmiyorNot}
            onChange={(ev) => setGerekmiyorNot(ev.target.value)}
          />
        </Modal>
      )}

      {onizleme && (
        <Modal
          open
          width="min(1000px, 94vw)"
          title={onizleme.ozgunAd ?? onizleme.baslik}
          onCancel={() => setOnizleme(null)}
          footer={
            <Space>
              <Button onClick={() => setOnizleme(null)}>Kapat</Button>
              <Button type="primary" icon={<Download size={14} strokeWidth={2} />} onClick={() => indir(onizleme)}>
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
              key={onizleme.id}
              adres={api.belgeOnizleme(onizleme.id)}
              resim={[".jpg", ".jpeg", ".png"].includes(onizleme.uzanti)}
              baslik={onizleme.baslik}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
