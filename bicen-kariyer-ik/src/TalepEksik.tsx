/* ===========================================================================
   Talep eksik bildirimi (07.10.2026)

   Personel Talepleri'nde (Yıllık izin · Avans · Fazla mesai · Vardiya
   düzeltme) İK talepteki eksiği personele bildirir: anlık bildirim +
   uygulama içi duyuru, 1.6'da ana sayfada turuncu kart. Fazla mesaide
   eksik formu giren yöneticiye gider.

   Kullanım:
     const eksik = useTalepEksikleri("izin");
     <EksikRozet e={eksik.harita[k.id]} />
     <EksikDugmesi tur="izin" talepId={k.id} e={eksik.harita[k.id]} yenile={eksik.yenile} />
   =========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Checkbox, DatePicker, Input, Modal, Spin, Tooltip } from "antd";
import { AlertTriangle, BellRing, CheckCircle2, Eye, EyeOff, MessageSquare, Send, Smartphone } from "lucide-react";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";

import { api } from "./api";
import "./TalepEksik.css";

export type EksikTur = "izin" | "avans" | "fazlamesai" | "itiraz";

export interface EksikKayit {
  id: number;
  tur: EksikTur;
  talepId: number;
  adSoyad: string;
  hedefAd: string | null;
  baslik: string;
  ozet: string | null;
  maddeler: string[];
  aciklama: string | null;
  sonTarih: string | null;
  gecikti: boolean;
  durum: "acik" | "tamamlandi" | "kapandi";
  gonderen: string | null;
  tarih: string;
  jetonVar: boolean;
  smsDurum: string | null;
  goruldu: string | null;
  hatirlatma: string | null;
  hatirlatmaSayi: number;
  tamamlandi: string | null;
  personelNotu: string | null;
  kapandi: string | null;
  kapatan: string | null;
  kapanisNotu: string | null;
}

/** Türe göre hazır maddeler; "Diğer" açıklamaya yönlendirir */
const MADDELER: Record<EksikTur, string[]> = {
  izin: [
    "İmzalı izin formu yüklenmedi",
    "Mazeret belgesi (rapor vb.) yüklenmedi",
    "Islak imzalı formun aslı İK'ya ulaşmadı",
    "Yüklenen evrak okunmuyor / eksik sayfa",
    "Tarih veya izin türü hatalı",
  ],
  avans: [
    "Açıklama yetersiz",
    "Tutar veya taksit sayısı hatalı",
    "İmzalı avans formu ulaşmadı",
  ],
  fazlamesai: [
    "Islak imzalı form İK'ya ulaşmadı",
    "Bölge müdürü imzası eksik",
    "Çalışan imzası eksik",
    "Saat veya tarih hatalı",
  ],
  itiraz: [
    "Sebep yetersiz",
    "Saat hatalı",
    "Yöneticinin onayı / açıklaması gerekli",
  ],
};

const TUR_ADI: Record<EksikTur, string> = {
  izin: "izin talebi",
  avans: "avans talebi",
  fazlamesai: "fazla mesai kaydı",
  itiraz: "vardiya düzeltme talebi",
};

const saat = (t?: string | null) => (t ? dayjs(t).format("D MMM HH:mm") : "");

/* ========================================================================== */
/* Liste durumu                                                               */
/* ========================================================================== */

export function useTalepEksikleri(tur: EksikTur) {
  const [kayitlar, setKayitlar] = useState<EksikKayit[]>([]);
  const [yetkili, setYetkili] = useState(false);

  const yenile = useCallback(async () => {
    try {
      const d = await api.al<{ kayitlar: EksikKayit[]; yetkili: boolean }>(`/api/TalepEksik/Durumlar?tur=${tur}`);
      setKayitlar(d?.kayitlar ?? []);
      setYetkili(!!d?.yetkili);
    } catch {
      /* Uç henüz yayında değilse sessizce boş */
      setKayitlar([]);
    }
  }, [tur]);

  useEffect(() => {
    yenile();
  }, [yenile]);

  const harita = useMemo(() => {
    const h: Record<number, EksikKayit> = {};
    for (const k of kayitlar) h[k.talepId] = k;
    return h;
  }, [kayitlar]);

  const acikSayisi = kayitlar.filter((k) => k.durum !== "kapandi").length;

  return { harita, yenile, yetkili, acikSayisi };
}

/* ========================================================================== */
/* Rozet                                                                      */
/* ========================================================================== */

export function EksikRozet({ e, onClick }: { e?: EksikKayit; onClick?: () => void }) {
  if (!e || e.durum === "kapandi") return null;

  const icerik =
    e.durum === "tamamlandi" ? (
      <span className="te-rozet te-mavi">
        <CheckCircle2 size={12} strokeWidth={2.4} /> Eksik tamamlandı · kontrol et
      </span>
    ) : (
      <span className={`te-rozet ${e.gecikti ? "te-kirmizi" : "te-turuncu"}`}>
        <AlertTriangle size={12} strokeWidth={2.4} /> Eksik bildirildi
        {e.goruldu ? (
          <Eye size={12} strokeWidth={2.4} aria-label="Personel gördü" />
        ) : (
          <EyeOff size={12} strokeWidth={2.4} aria-label="Henüz görmedi" />
        )}
      </span>
    );

  const ipucu =
    e.durum === "tamamlandi"
      ? `${e.hedefAd ?? e.adSoyad} ${saat(e.tamamlandi)} tamamladı${e.personelNotu ? `: ${e.personelNotu}` : ""}`
      : `${saat(e.tarih)} bildirildi · ${e.goruldu ? `${saat(e.goruldu)} gördü` : "henüz görmedi"}${
          e.sonTarih ? ` · son gün ${dayjs(e.sonTarih).format("D MMM")}` : ""
        }`;

  return (
    <Tooltip title={ipucu}>
      {onClick ? (
        <button type="button" className="te-rozet-dugme" onClick={onClick}>
          {icerik}
        </button>
      ) : (
        icerik
      )}
    </Tooltip>
  );
}

/* ========================================================================== */
/* Düğme + pencere                                                            */
/* ========================================================================== */

export function EksikDugmesi({
  tur,
  talepId,
  e,
  yenile,
  yetkili = true,
  buyuk,
}: {
  tur: EksikTur;
  talepId: number;
  e?: EksikKayit;
  yenile: () => void;
  yetkili?: boolean;
  buyuk?: boolean;
}) {
  const [acik, setAcik] = useState(false);
  const var_ = e && e.durum !== "kapandi";

  if (!yetkili && !var_) return null;

  /* Pencere portal ile açılsa da tıklamalar React ağacında satıra kadar
     kabarıyor: satır tıklanınca çekmece açılmasın diye burada kesiliyor. */
  return (
    <span className="te-sar" onClick={(ev) => ev.stopPropagation()}>
      {var_ ? (
        <EksikRozet e={e} onClick={() => setAcik(true)} />
      ) : (
        <Tooltip title="Personele eksik bildir (bildirim + uygulama içi)">
          <button
            type="button"
            className={`it-dg ${buyuk ? "" : "kucuk "}te-dugme`}
            onClick={() => setAcik(true)}
          >
            <AlertTriangle size={13} strokeWidth={2.2} /> Eksik bildir
          </button>
        </Tooltip>
      )}

      {acik && (
        <EksikPenceresi
          tur={tur}
          talepId={talepId}
          yetkili={yetkili}
          kapat={() => setAcik(false)}
          degisti={yenile}
        />
      )}
    </span>
  );
}

export function EksikPenceresi({
  tur,
  talepId,
  yetkili,
  kapat,
  degisti,
}: {
  tur: EksikTur;
  talepId: number;
  yetkili: boolean;
  kapat: () => void;
  degisti: () => void;
}) {
  const { message } = AntdApp.useApp();

  const [veri, setVeri] = useState<{
    kayitlar: EksikKayit[];
    talep: { ozet: string; adSoyad: string; hedefAd: string; hedefFarkli: boolean } | null;
    smsEtkin: boolean;
  } | null>(null);
  const [yeni, setYeni] = useState(false);
  const [secili, setSecili] = useState<string[]>([]);
  const [diger, setDiger] = useState(false);
  const [aciklama, setAciklama] = useState("");
  const [son, setSon] = useState<Dayjs | null>(null);
  const [sms, setSms] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  /* Maddeler Ayarlar Merkezi › Seçenek listeleri'nden; gelmezse koddaki liste */
  const [hazirMaddeler, setHazirMaddeler] = useState<string[]>(MADDELER[tur]);
  useEffect(() => {
    api
      .al<Record<string, string[]>>("/api/TalepEksik/Maddeler")
      .then((m) => m?.[tur]?.length && setHazirMaddeler(m[tur]))
      .catch(() => undefined);
  }, [tur]);

  const getir = useCallback(async () => {
    try {
      const d = await api.al<any>(`/api/TalepEksik/Talep?tur=${tur}&id=${talepId}`);
      setVeri(d);
      if (!(d?.kayitlar ?? []).some((x: EksikKayit) => x.durum !== "kapandi")) setYeni(true);
    } catch (h: any) {
      message.error(h.message);
      kapat();
    }
  }, [tur, talepId, message, kapat]);

  useEffect(() => {
    getir();
  }, [getir]);

  const acikKayit = veri?.kayitlar.find((x) => x.durum !== "kapandi");
  const eskiler = (veri?.kayitlar ?? []).filter((x) => x !== acikKayit);
  const t = veri?.talep;
  const kime = t?.hedefAd ?? t?.adSoyad ?? "Personel";

  const maddeler = diger ? [...secili, "Diğer (açıklamada)"] : secili;
  const onizleme =
    `${t?.ozet ?? ""}: ` +
    (maddeler.length ? maddeler.map((m) => m.toLocaleLowerCase("tr")).join(", ") : "eksik var") +
    "." +
    (son ? ` Son gün ${son.format("D MMMM")}.` : "");

  const gonder = async () => {
    if (secili.length === 0 && !aciklama.trim()) {
      message.warning("Eksik olanı seçin ya da açıklama yazın.");
      return;
    }

    setGonderiliyor(true);
    try {
      const c = await api.gonder<any>("/api/TalepEksik", {
        tur,
        talepId,
        maddeler,
        aciklama: aciklama.trim() || null,
        sonTarih: son ? son.format("YYYY-MM-DD") : null,
        sms,
      });
      message.success(c?.mesaj ?? "Gönderildi.");
      if (c?.smsDurum) message.info(c.smsDurum);
      degisti();
      kapat();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setGonderiliyor(false);
    }
  };

  const hatirlat = async (k: EksikKayit) => {
    try {
      const c = await api.gonder<any>(`/api/TalepEksik/${k.id}/Hatirlat`, {});
      c?.tamam ? message.success(c.mesaj) : message.info(c?.mesaj ?? "");
      getir();
      degisti();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const kapatKayit = (k: EksikKayit) => {
    let not = "";
    Modal.confirm({
      title: "Eksik giderildi olarak kapatılsın mı?",
      content: (
        <div>
          <p style={{ fontSize: 13 }}>Kart personelin ana sayfasından kalkar ve “Eksik tamamlandı” bildirimi gider.</p>
          <Input.TextArea rows={2} placeholder="Not (isteğe bağlı)" onChange={(e) => (not = e.target.value)} />
        </div>
      ),
      okText: "Kapat",
      cancelText: "Vazgeç",
      onOk: async () => {
        try {
          await api.gonder(`/api/TalepEksik/${k.id}/Kapat`, { not, bildir: true });
          message.success("Kapatıldı.");
          degisti();
          kapat();
        } catch (h: any) {
          message.error(h.message);
          return Promise.reject();
        }
      },
    });
  };

  return (
    <Modal
      open
      onCancel={kapat}
      width={780}
      footer={null}
      title={
        <div className="te-bas">
          <b>{yeni ? `${TUR_ADI[tur].replace(/^./, (c) => c.toLocaleUpperCase("tr"))} · eksik bildir` : "Eksik bildirimi"}</b>
          <small>{t ? `${t.adSoyad} · ${t.ozet}` : ""}</small>
        </div>
      }
      className="te-pencere"
      destroyOnClose
    >
      {!veri ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <Spin />
        </div>
      ) : yeni ? (
        <div className="te-govde">
          <div className="te-sol">
            {t?.hedefFarkli && (
              <div className="te-bilgi">
                Fazla mesai formunu <b>{t.hedefAd}</b> girdi; bildirim ona gider.
              </div>
            )}

            <div className="te-et">Eksik olan</div>
            <div className="te-maddeler">
              {hazirMaddeler.map((m) => (
                <label key={m} className={secili.includes(m) ? "secili" : ""}>
                  <Checkbox
                    checked={secili.includes(m)}
                    onChange={(e) => setSecili((s) => (e.target.checked ? [...s, m] : s.filter((x) => x !== m)))}
                  />
                  {m}
                </label>
              ))}
              <label className={diger ? "secili" : ""}>
                <Checkbox checked={diger} onChange={(e) => setDiger(e.target.checked)} />
                Diğer
              </label>
            </div>

            <label className="te-et" htmlFor="te-not">
              İK notu {diger ? "(zorunlu)" : "(isteğe bağlı)"}
            </label>
            <Input.TextArea
              id="te-not"
              rows={3}
              maxLength={600}
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              placeholder="Örn. Formu birim yöneticinize imzalatıp fotoğrafını uygulamadan yükleyin, aslını şube zarfıyla İK'ya gönderin."
            />

            <div className="te-satir">
              <div>
                <div className="te-et">Son tarih (isteğe bağlı)</div>
                <DatePicker
                  value={son}
                  onChange={setSon}
                  format="DD.MM.YYYY"
                  disabledDate={(d) => d.isBefore(dayjs(), "day")}
                  placeholder="Seçin"
                />
              </div>
            </div>
          </div>

          <div className="te-sag">
            <div className="te-et">{kime} şunu görecek</div>
            <div className="te-telefon">
              <div className="te-bildirim">
                <div className="te-bildirim-ust">
                  <span>BİÇEN360</span>
                  <span>şimdi</span>
                </div>
                <b>{TUR_BASLIK[tur]}</b>
                <p>{onizleme}</p>
              </div>
            </div>
            <p className="te-aciklama">
              Uygulama açılınca ana sayfada turuncu kart olarak kalır (1.6); 1.5'te Duyurular'da ve ana sayfadaki son
              duyuruda görünür. Personel tamamlayınca burada “tamamlandı” olarak görürsünüz.
            </p>

            <div className="te-et">Gönderim</div>
            <label className="te-kanal">
              <Checkbox checked disabled /> <Smartphone size={13} /> Bildirim + uygulama içi
            </label>
            <label className="te-kanal">
              <Checkbox checked={sms} disabled={!veri.smsEtkin} onChange={(e) => setSms(e.target.checked)} />{" "}
              <MessageSquare size={13} /> Uygulaması yoksa SMS gönder
              {!veri.smsEtkin && <small> (SMS kapalı)</small>}
            </label>
          </div>

          <div className="te-alt">
            {acikKayit ? (
              <button type="button" className="it-dg" onClick={() => setYeni(false)}>
                Vazgeç
              </button>
            ) : (
              <button type="button" className="it-dg" onClick={kapat}>
                Vazgeç
              </button>
            )}
            <button
              type="button"
              className="it-dg te-gonder"
              disabled={gonderiliyor || (diger && !aciklama.trim()) || (secili.length === 0 && !aciklama.trim())}
              onClick={gonder}
            >
              <Send size={14} /> {gonderiliyor ? "Gönderiliyor…" : `${tur === "fazlamesai" ? "Yöneticiye" : "Personele"} gönder`}
            </button>
          </div>
        </div>
      ) : (
        <div className="te-durum">
          {acikKayit && <KayitKarti k={acikKayit} />}

          <div className="te-alt">
            {yetkili && (
              <button type="button" className="it-dg" onClick={() => setYeni(true)}>
                Yeni eksik bildir
              </button>
            )}
            <span style={{ flex: 1 }} />
            {yetkili && acikKayit?.durum === "acik" && (
              <button type="button" className="it-dg" onClick={() => hatirlat(acikKayit)}>
                <BellRing size={14} /> Tekrar hatırlat
              </button>
            )}
            {yetkili && acikKayit && (
              <button type="button" className="it-dg te-gonder" onClick={() => kapatKayit(acikKayit)}>
                <CheckCircle2 size={14} /> Eksik giderildi, kapat
              </button>
            )}
          </div>

          {eskiler.length > 0 && (
            <div className="te-eskiler">
              <div className="te-et">Önceki bildirimler</div>
              {eskiler.map((k) => (
                <KayitKarti key={k.id} k={k} kucuk />
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const TUR_BASLIK: Record<EksikTur, string> = {
  izin: "İzin talebinizde eksik var",
  avans: "Avans talebinizde eksik var",
  fazlamesai: "Fazla mesai formunda eksik var",
  itiraz: "Vardiya düzeltme talebinizde eksik var",
};

function KayitKarti({ k, kucuk }: { k: EksikKayit; kucuk?: boolean }) {
  const adimlar = [
    { ad: "Eksik bildirildi", alt: `${saat(k.tarih)} · ${k.gonderen ?? "İK"}${k.jetonVar ? " · bildirim gitti" : " · bildirim jetonu yok, duyuruda"}${k.smsDurum ? ` · ${k.smsDurum}` : ""}`, renk: "turuncu", tamam: true },
    ...(k.hatirlatma ? [{ ad: `Tekrar hatırlatıldı (${k.hatirlatmaSayi})`, alt: saat(k.hatirlatma), renk: "turuncu", tamam: true }] : []),
    { ad: k.goruldu ? "Gördü" : "Henüz görmedi", alt: k.goruldu ? saat(k.goruldu) : "uygulamayı açınca işaretlenir", renk: "yesil", tamam: !!k.goruldu },
    {
      ad: k.tamamlandi ? "Tamamladı" : "Tamamlaması bekleniyor",
      alt: k.tamamlandi ? `${saat(k.tamamlandi)}${k.personelNotu ? ` · ${k.personelNotu}` : ""}` : k.sonTarih ? `son gün ${dayjs(k.sonTarih).format("D MMM")}` : "",
      renk: "mavi",
      tamam: !!k.tamamlandi,
    },
    ...(k.kapandi ? [{ ad: "Kapatıldı", alt: `${saat(k.kapandi)} · ${k.kapatan ?? ""}${k.kapanisNotu ? ` · ${k.kapanisNotu}` : ""}`, renk: "gri", tamam: true }] : []),
  ];

  return (
    <div className={`te-kart${kucuk ? " kucuk" : ""}${k.durum === "kapandi" ? " kapali" : ""}`}>
      <div className="te-kart-ust">
        <b>{k.durum === "tamamlandi" ? "Personel tamamladı · kontrol edin" : k.durum === "kapandi" ? "Kapandı" : "Açık eksik bildirimi"}</b>
        {k.gecikti && <span className="te-rozet te-kirmizi">son gün geçti</span>}
      </div>
      {k.maddeler.length > 0 && (
        <ul>
          {k.maddeler.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {k.aciklama && <p className="te-alinti">“{k.aciklama}”</p>}
      {!kucuk && (
        <ol className="te-akis">
          {adimlar.map((a, i) => (
            <li key={i} className={`${a.tamam ? "tamam" : ""} te-n-${a.renk}`}>
              <b>{a.ad}</b>
              {a.alt && <small>{a.alt}</small>}
            </li>
          ))}
        </ol>
      )}
      {kucuk && (
        <small className="te-kucuk-alt">
          {saat(k.tarih)} · {k.gonderen}
          {k.kapandi ? ` · kapandı ${saat(k.kapandi)}` : ""}
        </small>
      )}
    </div>
  );
}
