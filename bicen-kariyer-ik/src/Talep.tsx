/**
 * Talep / Öneri penceresi (30.10.2026).
 *
 * Menünün altındaki düğmeden her ekranda açılır. Üstte bulunulan ekranın
 * adı yazar; "Sorun bildir" ya da "Öneri yaz" seçilip metin girilir. Görsel
 * üç yoldan eklenir: bu ekranın görüntüsü (getDisplayMedia, tek kare),
 * dosyadan resim, Ctrl+V ile panodan. Üç yolda da resim en çok 1920 px
 * genişliğe küçültülüp JPEG'e çevrilir.
 *
 * Alttaki "Taleplerim" listesinde kullanıcının önceki talepleri, durumu,
 * cevabı ve görselleri görünür. Başka bir kullanıcı adına açılmış oturumda
 * (taklit) gönderim kapalıdır.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import {
  App as AntdApp,
  Button,
  Empty,
  Image,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
} from "antd";
import { Bug, Camera, ImagePlus, Lightbulb, MessageSquarePlus, Send, X } from "lucide-react";
import dayjs from "dayjs";

import { api, API_TABAN, oturumOku } from "./api";
import type { Oturum } from "./api";
import { SURUM } from "./surum";

export const TALEP_DURUMLARI: { ad: string; renk: string }[] = [
  { ad: "Yeni", renk: "blue" },
  { ad: "İnceleniyor", renk: "gold" },
  { ad: "Planlandı", renk: "purple" },
  { ad: "Tamamlandı", renk: "green" },
  { ad: "Yapılmayacak", renk: "default" },
];

export interface BenimTalep {
  id: number;
  tur: number;
  ekran?: string | null;
  yol?: string | null;
  metin: string;
  surum?: string | null;
  durum: number;
  cevap?: string | null;
  cevaplayan?: string | null;
  cevapZamani?: string | null;
  olusturma: string;
  gorselSayisi: number;
}

/** Görsel adresi: img etiketi başlık gönderemediği için jeton sorguda */
export const talepGorselAdresi = (id: number, sira: number): string => {
  const o = oturumOku();
  return `${API_TABAN}/api/Talep/${id}/Gorsel/${sira}?t=${encodeURIComponent(o?.token ?? "")}`;
};

/* -------------------------------------------------------------------------- */
/* Görsel küçültme                                                             */
/* -------------------------------------------------------------------------- */

const EN_COK_GORSEL = 3;
const SINIR_BAYT = 2.5 * 1024 * 1024;

/** Blob/File → en çok 1920 px, JPEG; kalite düşürülerek 2,5 MB altına iner */
const kucult = (kaynak: Blob): Promise<string> =>
  new Promise((coz, reddet) => {
    const url = URL.createObjectURL(kaynak);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const oran = Math.min(1, 1920 / img.width);
      const tuval = document.createElement("canvas");
      tuval.width = Math.round(img.width * oran);
      tuval.height = Math.round(img.height * oran);
      const c = tuval.getContext("2d");
      if (!c) return reddet(new Error("Tuval açılamadı"));
      c.drawImage(img, 0, 0, tuval.width, tuval.height);

      for (const kalite of [0.85, 0.7, 0.55]) {
        const veri = tuval.toDataURL("image/jpeg", kalite);
        /* base64: 4 karakter ≈ 3 bayt */
        if ((veri.length - veri.indexOf(",") - 1) * 0.75 <= SINIR_BAYT) return coz(veri);
      }
      reddet(new Error("Görsel küçültülemedi; daha küçük bir resim seçiniz."));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reddet(new Error("Resim okunamadı"));
    };
    img.src = url;
  });

/** Bu sekmenin tek karelik görüntüsü */
const ekranGoruntusu = async (): Promise<Blob> => {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Tarayıcı ekran görüntüsünü desteklemiyor.");

  /* preferCurrentTab / selfBrowserSurface Chrome'a özgü; tip tanımında yok */
  const secenek: any = {
    video: true,
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  };
  const akis: MediaStream = await navigator.mediaDevices.getDisplayMedia(secenek);

  try {
    const iz = akis.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = akis;
    video.muted = true;
    await video.play();
    /* İlk kare bazen siyah geliyor; kısa bekleme */
    await new Promise((r) => setTimeout(r, 250));

    const tuval = document.createElement("canvas");
    const ayar = iz.getSettings();
    tuval.width = ayar.width || video.videoWidth;
    tuval.height = ayar.height || video.videoHeight;
    tuval.getContext("2d")!.drawImage(video, 0, 0, tuval.width, tuval.height);

    return await new Promise<Blob>((coz, reddet) =>
      tuval.toBlob((b) => (b ? coz(b) : reddet(new Error("Kare alınamadı"))), "image/png")
    );
  } finally {
    akis.getTracks().forEach((t) => t.stop());
  }
};

/* -------------------------------------------------------------------------- */
/* Pencere                                                                     */
/* -------------------------------------------------------------------------- */

type Props = {
  acik: boolean;
  kapat: () => void;
  oturum: Oturum;
  /** Bulunulan ekranın adı ("Personel / Personeller") */
  ekran: string;
  /** Sayfa anahtarı; "#personeller" olarak yazılır */
  sekme: string;
};

export default function Talep({ acik, kapat, oturum, ekran, sekme }: Props) {
  const { message } = AntdApp.useApp();
  const [tur, setTur] = useState<1 | 2>(1);
  const [metin, setMetin] = useState("");
  const [gorseller, setGorseller] = useState<string[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [gizli, setGizli] = useState(false);
  const [liste, setListe] = useState<BenimTalep[]>([]);
  const [suzgec, setSuzgec] = useState<"acik" | "hepsi">("acik");
  const dosyaRef = useRef<HTMLInputElement>(null);
  const taklit = !!oturum.taklitEden;

  const listeGetir = useCallback(() => {
    api.al<BenimTalep[]>("/api/Talep/Benim").then(setListe).catch(() => setListe([]));
  }, []);

  useEffect(() => {
    if (acik) listeGetir();
  }, [acik, listeGetir]);

  const gorselEkle = async (kaynak: Blob) => {
    if (gorseller.length >= EN_COK_GORSEL) {
      message.warning(`En çok ${EN_COK_GORSEL} görsel eklenebilir.`);
      return;
    }
    try {
      const veri = await kucult(kaynak);
      setGorseller((g) => (g.length >= EN_COK_GORSEL ? g : [...g, veri]));
    } catch (h: any) {
      message.error(h?.message ?? "Görsel eklenemedi.");
    }
  };

  const ekranYakala = async () => {
    setGizli(true);
    try {
      /* Pencere gizlenince bir kare bekle ki görüntüde pencere olmasın */
      await new Promise((r) => setTimeout(r, 150));
      const kare = await ekranGoruntusu();
      await gorselEkle(kare);
    } catch (h: any) {
      if (h?.name !== "NotAllowedError") message.error(h?.message ?? "Ekran görüntüsü alınamadı.");
    } finally {
      setGizli(false);
    }
  };

  const yapistir = (e: ClipboardEvent) => {
    const oge = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
    if (!oge) return;
    e.preventDefault();
    const dosya = oge.getAsFile();
    if (dosya) void gorselEkle(dosya);
  };

  const gonder = async () => {
    const m = metin.trim();
    if (m.length < 5) {
      message.warning("En az 5 karakter yazınız.");
      return;
    }
    setGonderiliyor(true);
    try {
      const s = await api.gonder<{ id: number }>("/api/Talep", {
        tur,
        ekran: ekran.slice(0, 100),
        yol: `#${sekme}`.slice(0, 200),
        metin: m,
        surum: SURUM,
        gorseller,
      });
      message.success(`Talebiniz alındı, #${s.id}`);
      setMetin("");
      setGorseller([]);
      listeGetir();
    } catch (h: any) {
      message.error(h?.message ?? "Gönderilemedi.");
    } finally {
      setGonderiliyor(false);
    }
  };

  const gorunen = liste.filter((t) => suzgec === "hepsi" || t.durum <= 2);

  return (
    <Modal
      open={acik}
      onCancel={kapat}
      footer={null}
      width={680}
      centered
      destroyOnClose
      style={gizli ? { visibility: "hidden" } : undefined}
      styles={gizli ? { mask: { visibility: "hidden" } } : undefined}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <MessageSquarePlus size={18} strokeWidth={2} />
          Talep / Öneri
        </span>
      }
    >
      <div style={{ fontSize: 12.5, color: "var(--pasif, #8a929b)", marginBottom: 10 }}>
        Ekran: <b style={{ color: "inherit" }}>{ekran}</b> · sürüm {SURUM}
      </div>

      {taklit ? (
        <div style={{ padding: "10px 12px", background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 8 }}>
          Başka bir kullanıcı adına açılmış oturumda talep gönderilemez.
        </div>
      ) : (
        <>
          <Segmented
            block
            value={tur}
            onChange={(v) => setTur(v as 1 | 2)}
            options={[
              { value: 1, label: <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Bug size={14} /> Sorun bildir</span> },
              { value: 2, label: <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Lightbulb size={14} /> Öneri yaz</span> },
            ]}
          />

          <Input.TextArea
            value={metin}
            onChange={(e) => setMetin(e.target.value)}
            onPaste={yapistir}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void gonder();
            }}
            placeholder={tur === 1 ? "Ne oldu, nerede? Hangi adımda hata aldınız?" : "Ne istiyorsunuz, neden? Nasıl kolaylaştırır?"}
            autoSize={{ minRows: 4, maxRows: 10 }}
            maxLength={2000}
            showCount
            style={{ marginTop: 12 }}
          />
          {metin.trim().length > 0 && metin.trim().length < 5 && (
            <div style={{ color: "#cf1322", fontSize: 12, marginTop: 4 }}>En az 5 karakter yazınız.</div>
          )}

          {gorseller.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {gorseller.map((g, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <Image src={g} width={96} height={64} style={{ objectFit: "cover", borderRadius: 6 }} />
                  <Button
                    size="small"
                    type="text"
                    icon={<X size={12} />}
                    onClick={() => setGorseller((l) => l.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: -6, right: -6, background: "#fff", borderRadius: 999, boxShadow: "0 1px 4px rgba(0,0,0,.25)" }}
                  />
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
            <Space size={4} wrap>
              <Tooltip title="Bu ekranın görüntüsünü ekle">
                <Button size="small" icon={<Camera size={14} />} onClick={ekranYakala} disabled={gorseller.length >= EN_COK_GORSEL}>
                  Ekran görüntüsü
                </Button>
              </Tooltip>
              <Button size="small" icon={<ImagePlus size={14} />} onClick={() => dosyaRef.current?.click()} disabled={gorseller.length >= EN_COK_GORSEL}>
                Dosyadan
              </Button>
              <span style={{ fontSize: 12, color: "var(--pasif, #8a929b)" }}>ya da Ctrl+V ile yapıştırın · en çok {EN_COK_GORSEL}</span>
              <input
                ref={dosyaRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void gorselEkle(f);
                  e.target.value = "";
                }}
              />
            </Space>
            <Button type="primary" icon={<Send size={14} />} loading={gonderiliyor} onClick={gonder} disabled={metin.trim().length < 5}>
              Gönder
            </Button>
          </div>
        </>
      )}

      {/* ------------------------------------------------------- Taleplerim */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22, marginBottom: 8 }}>
        <b>Taleplerim</b>
        <Select
          size="small"
          value={suzgec}
          onChange={setSuzgec}
          options={[
            { value: "acik", label: "Açık olanlar" },
            { value: "hepsi", label: "Hepsi" },
          ]}
          style={{ width: 130 }}
        />
      </div>

      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {gorunen.length === 0 && <Empty description="Talep yok" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {gorunen.map((t) => {
          const d = TALEP_DURUMLARI[t.durum] ?? TALEP_DURUMLARI[0];
          return (
            <div key={t.id} style={{ border: "1px solid var(--cizgi, #e3e6e1)", borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
                <b>#{t.id}</b>
                <Tag style={{ margin: 0 }}>{t.tur === 1 ? "Sorun" : "Öneri"}</Tag>
                <Tag color={d.renk} style={{ margin: 0 }}>{d.ad}</Tag>
                <span style={{ color: "var(--pasif, #8a929b)" }}>
                  {t.ekran} · {dayjs(t.olusturma).format("DD.MM.YYYY HH:mm")}
                </span>
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 4 }}>{t.metin}</div>
              {t.gorselSayisi > 0 && (
                <Image.PreviewGroup>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    {Array.from({ length: t.gorselSayisi }, (_, i) => (
                      <Image key={i} src={talepGorselAdresi(t.id, i + 1)} width={72} height={48} style={{ objectFit: "cover", borderRadius: 4 }} />
                    ))}
                  </div>
                </Image.PreviewGroup>
              )}
              {t.cevap && (
                <div style={{ marginTop: 6, padding: "6px 8px", background: "var(--yesil-acik, #f2f9e8)", borderRadius: 6, fontSize: 13 }}>
                  <b>Cevap</b>
                  {t.cevaplayan && <span style={{ color: "var(--pasif, #8a929b)" }}> · {t.cevaplayan}</span>}
                  {t.cevapZamani && <span style={{ color: "var(--pasif, #8a929b)" }}> · {dayjs(t.cevapZamani).format("DD.MM.YYYY HH:mm")}</span>}
                  <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{t.cevap}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
