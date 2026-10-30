/**
 * Duyurular
 * ---------------------------------------------------------------------------
 * Biçen360 uygulamasına duyuru gönderme, gönderilenlerin okunma durumu ve
 * panel kullanıcısına gelen duyurular.
 *
 * Hedef: tüm personel, genel müdürlük, lojistik depo ya da seçim —
 * şube(ler), pozisyon(lar) veya tek tek kişiler. Seçimde alıcılar gönderim
 * anında sunucuda belirlenip yazılır; listede "Pozisyon: Kasiyer" gibi
 * okunur bir özet görünür.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  Briefcase,
  Building2,
  Copy,
  Eye,
  Image as ImageIkon,
  Link2,
  Megaphone,
  RefreshCw,
  Search,
  Send,
  Store,
  Trash2,
  User,
  Users,
  Video,
  Warehouse,
} from "lucide-react";
import dayjs from "dayjs";

import Tablo from "./Tablo";
import { API_TABAN, api, oturumOku } from "./api";
import "./IkPerformans.css";
import "./Duyurular.css";

const { Text } = Typography;
const { TextArea } = Input;

type HedefTur = "herkes" | "sube" | "pozisyon" | "kisi" | "merkez" | "depo";

const HEDEFLER: { deger: HedefTur; ad: string; ikon: any }[] = [
  { deger: "herkes", ad: "Tüm personel", ikon: Users },
  { deger: "sube", ad: "Şube", ikon: Store },
  { deger: "pozisyon", ad: "Pozisyon", ikon: Briefcase },
  { deger: "kisi", ad: "Kişi", ikon: User },
  { deger: "merkez", ad: "Genel müdürlük", ikon: Building2 },
  { deger: "depo", ad: "Lojistik depo", ikon: Warehouse },
];

const ESKI_HEDEF: Record<string, string> = {
  herkes: "Tüm personel",
  merkez: "Genel müdürlük",
  depo: "Lojistik depo",
};

const gorselAdresi = (id: number) => `${API_TABAN}/api/Mobil/DuyuruGorsel/${id}`;

const tarihYaz = (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm");

/* Duyuru videosu: uygulama (1.7+) bağlantıyı düğme değil, görselin yerinde
   oynatıcı olarak gösteriyor. Önizleme de aynısını yapsın. */
const VIDEO_DESENI = /\/api\/DuyuruVideo\/Izle\/([0-9a-f]{32})/i;
const videoDosyasi = (baglanti?: string | null) => {
  const m = String(baglanti ?? "").match(VIDEO_DESENI);
  return m ? `${API_TABAN}/api/DuyuruVideo/Dosya/${m[1].toLowerCase()}` : null;
};

/** Uygulamadaki kartın aynısı: form önizlemesi, ayrıntı ve gelen duyurular */
function DuyuruKarti({ d, gorsel }: { d: any; gorsel?: string | null }) {
  const imzaVar = d.imza || d.yazanAd;
  const video = videoDosyasi(d.baglanti);
  return (
    <div className={`dy-kart${d.onemli ? " onemli" : ""}`}>
      <div className="dy-kart-ust">
        Duyuru · {d.olusturma ? dayjs(d.olusturma).format("DD MMMM YYYY HH:mm") : "bugün"}
        {d.onemli && <Tag color="volcano" style={{ marginInlineEnd: 0 }}>önemli</Tag>}
      </div>
      <h4>{d.baslik || "Başlık"}</h4>
      {video ? (
        <video className="dy-kart-video" src={video} poster={gorsel ?? undefined} controls playsInline preload="metadata" />
      ) : (
        gorsel && <img src={gorsel} alt="" />
      )}
      <div className="dy-kart-metin">{d.metin || "Duyuru metni burada görünecek."}</div>
      {d.baglanti && !video && <div className="dy-kart-dugme">{d.baglantiYazi || "Bağlantıyı aç"}</div>}
      {imzaVar && (
        <div className="dy-kart-imza">
          {d.imza ? d.imza : (
            <>
              <b>{d.yazanAd}</b>
              {d.yazanUnvan && <div>{d.yazanUnvan}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Duyurular() {
  const { message, modal } = AntdApp.useApp();

  const oturum = oturumOku();
  const gonderebilir = ["Admin", "IKYoneticisi", "GenelMudurYardimcisi"].includes(oturum?.rol ?? "");

  const [sekme, setSekme] = useState<"yeni" | "liste" | "gelen">(gonderebilir ? "yeni" : "liste");

  /* ------------------------------------------------------------ veriler */
  const [liste, setListe] = useState<any[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [kisiler, setKisiler] = useState<any[]>([]);
  const [gelen, setGelen] = useState<any>(null);
  const [gelenYukleniyor, setGelenYukleniyor] = useState(false);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const d = await api.al<any>("/api/Mobil/DuyuruListe");
      setListe(d.kayitlar ?? []);
    } catch (hata: any) {
      message.error(hata.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  const gelenGetir = useCallback(async () => {
    setGelenYukleniyor(true);
    try {
      setGelen(await api.al<any>("/api/Mobil/GelenDuyurular"));
    } catch {
      setGelen({ eslesti: false, kayitlar: [] });
    } finally {
      setGelenYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    getir();
    gelenGetir();
    api
      .al<any>("/api/Mobil/DuyuruAlicilari")
      .then((d) => setKisiler(d.kisiler ?? []))
      .catch(() => setKisiler([]));
  }, [getir, gelenGetir]);

  const subeler = useMemo(
    () => [...new Set(kisiler.map((k) => k.subeAdi).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")),
    [kisiler]
  );
  const pozisyonlar = useMemo(() => {
    const m = new Map<string, number>();
    kisiler.forEach((k) => k.gorev && m.set(k.gorev, (m.get(k.gorev) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr"));
  }, [kisiler]);

  /* ------------------------------------------------------------ form */
  const [hedef, setHedef] = useState<HedefTur>("herkes");
  const [seciliSubeler, setSeciliSubeler] = useState<string[]>([]);
  const [seciliPozisyonlar, setSeciliPozisyonlar] = useState<string[]>([]);
  const [seciliKisiler, setSeciliKisiler] = useState<string[]>([]);

  const [baslik, setBaslik] = useState("");
  const [metin, setMetin] = useState("");
  const [onemli, setOnemli] = useState(false);
  /* Planlı duyuru (27.10.2026): boşsa hemen gönderilir */
  const [planla, setPlanla] = useState(false);
  const [yayinZamani, setYayinZamani] = useState<dayjs.Dayjs | null>(null);
  const [baglanti, setBaglanti] = useState("");
  const [baglantiYazi, setBaglantiYazi] = useState("");
  const [gorsel, setGorsel] = useState<string | null>(null);

  const [imzaTuru, setImzaTuru] = useState("varsayilan");
  const [imza, setImza] = useState("");
  const [imzayiKaydet, setImzayiKaydet] = useState(true);
  const [ben, setBen] = useState<any>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [aliciListesiAcik, setAliciListesiAcik] = useState(false);

  const dosyaAlani = useRef<HTMLInputElement>(null);

  /* Duyuru videosu (12.10.2026): sunucuya 8 MB'lık parçalarla yüklenir
     (IIS istek sınırı 20 MB); bağlantı alanı izleme sayfasıyla dolar.
     Mobil uygulama bağlantıyı düğme olarak gösterdiği için 1.6'da da
     güncellemesiz oynar. */
  const videoAlani = useRef<HTMLInputElement>(null);
  const [videoYuzde, setVideoYuzde] = useState<number | null>(null);
  const videoYukle = async (dosya?: File | null) => {
    if (!dosya) return;
    const uzanti = (dosya.name.split(".").pop() ?? "").toLowerCase();
    if (!["mp4", "m4v", "mov", "webm"].includes(uzanti)) {
      message.error("Yalnızca MP4, M4V, MOV ya da WEBM video yüklenebilir. Her telefonda oynaması için MP4 önerilir.");
      return;
    }
    if (dosya.size > 1024 * 1024 * 1024) {
      message.error("Video en çok 1 GB olabilir.");
      return;
    }

    const PARCA = 8 * 1024 * 1024;
    const toplam = Math.ceil(dosya.size / PARCA);
    let anahtar = "";
    setVideoYuzde(0);

    try {
      for (let sira = 0; sira < toplam; sira++) {
        const form = new FormData();
        form.append("anahtar", anahtar);
        form.append("sira", String(sira));
        form.append("toplam", String(toplam));
        form.append("dosyaAdi", dosya.name);
        form.append("boyut", String(dosya.size));
        form.append("parca", dosya.slice(sira * PARCA, Math.min(dosya.size, (sira + 1) * PARCA)), dosya.name);

        /* Bağlantı kopması gibi geçici hatalarda parça iki kez daha denenir */
        let c: { anahtar: string; tamam: boolean; izleAdresi?: string } | null = null;
        for (let deneme = 0; ; deneme++) {
          try {
            c = await api.dosyaGonder<{ anahtar: string; tamam: boolean; izleAdresi?: string }>("/api/DuyuruVideo/Parca", form);
            break;
          } catch (h) {
            if (deneme >= 2) throw h;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }

        anahtar = c!.anahtar;
        setVideoYuzde(Math.round(((sira + 1) / toplam) * 100));

        if (c!.tamam && c!.izleAdresi) {
          setBaglanti(c!.izleAdresi);
          setBaglantiYazi("");
          message.success("Video yüklendi; duyurunun bağlantısına eklendi.");
        }
      }
    } catch (h) {
      message.error(h instanceof Error ? h.message : "Video yüklenemedi.");
    } finally {
      setVideoYuzde(null);
    }
  };
  const videoBaglantisi = /\/api\/DuyuruVideo\/Izle\//.test(baglanti);

  useEffect(() => {
    api
      .al<any>("/api/Auth/Ben")
      .then((k) => {
        setBen(k);
        if (k?.imza) {
          setImza(k.imza);
          setImzaTuru("kisisel");
        }
      })
      .catch(() => setBen(null));
  }, []);

  /** Seçime göre alıcılar; sunucudaki kuralın aynısı */
  const alicilar = useMemo(() => {
    const aynı = (a: string, b: string) => (a ?? "").trim().toLocaleLowerCase("tr") === (b ?? "").trim().toLocaleLowerCase("tr");
    switch (hedef) {
      case "herkes":
        return kisiler;
      case "merkez":
        return kisiler.filter((k) => (k.subeAdi ?? "").toLocaleUpperCase("tr").includes("MERKEZ"));
      case "depo":
        return kisiler.filter((k) => (k.subeAdi ?? "").toLocaleUpperCase("tr").includes("DEPO"));
      case "kisi":
        return kisiler.filter((k) => seciliKisiler.includes(k.personelKodu));
      case "sube":
      case "pozisyon": {
        if (hedef === "sube" && seciliSubeler.length === 0) return [];
        if (hedef === "pozisyon" && seciliPozisyonlar.length === 0) return [];
        return kisiler.filter(
          (k) =>
            (seciliSubeler.length === 0 || seciliSubeler.some((s) => aynı(s, k.subeAdi))) &&
            (seciliPozisyonlar.length === 0 || seciliPozisyonlar.some((s) => aynı(s, k.gorev)))
        );
      }
    }
  }, [hedef, kisiler, seciliSubeler, seciliPozisyonlar, seciliKisiler]);

  const uygulamada = alicilar.filter((k) => k.uygulama).length;

  const hedefAciklama = () => {
    const kisa = (l: string[]) => (l.length <= 3 ? l.join(", ") : `${l.slice(0, 3).join(", ")} +${l.length - 3}`);
    if (hedef === "sube") return `Şube: ${kisa(seciliSubeler)}${seciliPozisyonlar.length ? ` · Pozisyon: ${kisa(seciliPozisyonlar)}` : ""}`;
    if (hedef === "pozisyon") return `Pozisyon: ${kisa(seciliPozisyonlar)}${seciliSubeler.length ? ` · Şube: ${kisa(seciliSubeler)}` : ""}`;
    if (hedef === "kisi") return `${seciliKisiler.length} kişi`;
    return HEDEFLER.find((h) => h.deger === hedef)?.ad ?? "";
  };

  const gorselSec = (dosya?: File) => {
    if (!dosya) return;
    if (dosya.size > 3 * 1024 * 1024) {
      message.error("Görsel 3 MB'tan küçük olmalıdır.");
      return;
    }
    const okuyucu = new FileReader();
    okuyucu.onload = () => setGorsel(String(okuyucu.result));
    okuyucu.onerror = () => message.error("Görsel okunamadı.");
    okuyucu.readAsDataURL(dosya);
  };

  const temizle = () => {
    setBaslik("");
    setMetin("");
    setHedef("herkes");
    setSeciliSubeler([]);
    setSeciliPozisyonlar([]);
    setSeciliKisiler([]);
    setOnemli(false);
    setPlanla(false);
    setYayinZamani(null);
    setBaglanti("");
    setBaglantiYazi("");
    setGorsel(null);
  };

  /** Gönderilmiş bir duyuruyu forma kopyalar (tekrar göndermek için) */
  const kopyala = (d: any) => {
    setBaslik(d.baslik ?? "");
    setMetin(d.metin ?? "");
    setOnemli(!!d.onemli);
    setBaglanti(d.baglanti ?? "");
    setBaglantiYazi(d.baglantiYazi ?? "");
    setGorsel(null);
    setHedef(d.hedefTur === "merkez" || d.hedefTur === "depo" ? d.hedefTur : "herkes");
    setSekme("yeni");
    message.info("Duyuru forma kopyalandı. Hedefi ve görseli kontrol ediniz.");
  };

  const gonder = () => {
    if (!baslik.trim()) return message.warning("Başlık yazınız.");
    if (!metin.trim()) return message.warning("Duyuru metnini yazınız.");
    if (alicilar.length === 0) return message.warning("Alıcı seçiniz.");
    if (planla && !yayinZamani) return message.warning("Gönderim tarihini ve saatini seçiniz.");
    if (planla && yayinZamani && yayinZamani.isBefore(dayjs().add(3, "minute")))
      return message.warning("Planlı gönderim en az birkaç dakika ileri olmalı; hemen göndermek için planlamayı kapatın.");

    modal.confirm({
      title: planla && yayinZamani ? `Duyuru ${yayinZamani.format("DD MMMM YYYY HH:mm")} için planlansın mı?` : "Duyuru gönderilsin mi?",
      content: (
        <div style={{ fontSize: 13.5 }}>
          <b>{hedefAciklama()}</b> · {alicilar.length} kişi
          <div style={{ color: "#6b7280", marginTop: 6, fontSize: 12.5 }}>
            {planla && yayinZamani
              ? `Duyuru bu tarihte yayına girer ve ${uygulamada} kişiye o anda bildirim gider. O zamana kadar personel görmez; listeden kaldırarak iptal edebilirsiniz.`
              : `${uygulamada} kişi Biçen360'ı kullanıyor ve anında bildirim alacak. Gönderdikten sonra düzenlenemez, yalnızca kaldırılabilir.`}
          </div>
        </div>
      ),
      okText: planla ? "Planla" : "Gönder",
      cancelText: "Vazgeç",
      onOk: async () => {
        setGonderiliyor(true);
        try {
          const secili = hedef === "sube" || hedef === "pozisyon" || hedef === "kisi";
          const d = await api.gonder<any>("/api/Mobil/Duyuru", {
            baslik: baslik.trim(),
            metin: metin.trim(),
            hedefTur: secili ? "secili" : hedef,
            subeler: secili && hedef !== "kisi" ? seciliSubeler : [],
            pozisyonlar: secili && hedef !== "kisi" ? seciliPozisyonlar : [],
            personelKodlari: hedef === "kisi" ? seciliKisiler : [],
            onemli,
            baglanti: baglanti.trim() || null,
            baglantiYazi: baglantiYazi.trim() || null,
            gorsel,
            imzaTuru,
            imza: imzaTuru === "kisisel" ? imza.trim() : null,
            imzayiKaydet: imzaTuru === "kisisel" && imzayiKaydet,
            yayinZamani: planla && yayinZamani ? yayinZamani.format("YYYY-MM-DDTHH:mm:00") : null,
          });
          message.success(
            d?.planli
              ? `Duyuru ${dayjs(d.yayinZamani).format("DD MMMM HH:mm")} için planlandı.`
              : d?.aliciSayisi ? `Duyuru ${d.aliciSayisi} kişiye gönderildi.` : "Duyuru gönderildi."
          );
          temizle();
          setSekme("liste");
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        } finally {
          setGonderiliyor(false);
        }
      },
    });
  };

  const kaldir = (k: any) =>
    modal.confirm({
      title: "Duyuru kaldırılsın mı?",
      content: `"${k.baslik}" artık uygulamada görünmeyecek.`,
      okText: "Kaldır",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Mobil/Duyuru/${k.id}`);
          message.success("Duyuru kaldırıldı.");
          setAyrinti(null);
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });

  /* ------------------------------------------------------------ gönderilenler */
  const [arama, setArama] = useState("");
  const [durumSuz, setDurumSuz] = useState<"tum" | "yayinda" | "kaldirildi">("yayinda");
  const [ayrinti, setAyrinti] = useState<any>(null);
  const [okuma, setOkuma] = useState<any>(null);
  const [okumaSekme, setOkumaSekme] = useState<"okuyan" | "okumayan">("okuyan");
  const [okumaAra, setOkumaAra] = useState("");

  const hedefYaz = (k: any) =>
    k.hedefTur === "secili"
      ? k.hedefOzet || "Seçili personel"
      : k.hedefTur === "sube"
      ? `Şube: ${k.subeAdi}`
      : k.hedefTur === "kisi"
      ? `Kişi · ${k.personelKodu}`
      : ESKI_HEDEF[k.hedefTur] ?? "Tüm personel";

  const suzulmus = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    return liste.filter(
      (k) =>
        (durumSuz === "tum" || (durumSuz === "yayinda" ? !k.iptal : k.iptal)) &&
        (!q || `${k.baslik} ${k.metin} ${hedefYaz(k)} ${k.yazanAd ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liste, arama, durumSuz]);

  const ayrintiAc = async (k: any, s: "okuyan" | "okumayan" = "okuyan") => {
    setAyrinti(k);
    setOkuma(null);
    setOkumaSekme(s);
    setOkumaAra("");
    try {
      setOkuma(await api.al<any>(`/api/Mobil/DuyuruOkuma/${k.id}`));
    } catch (hata: any) {
      message.error(hata.message);
      setOkuma({ okuyanlar: [], okumayanlar: [] });
    }
  };

  /* ------------------------------------------------------------ gelen */
  const [gelenAcik, setGelenAcik] = useState<any>(null);
  const okunmamis = (gelen?.kayitlar ?? []).filter((k: any) => !k.okundu).length;

  const gelenAc = (k: any) => {
    setGelenAcik(k);
    if (!k.okundu && gelen?.personel?.personelKodu) {
      api
        .gonder(`/api/Mobil/GelenDuyuruOkundu/${k.id}?kod=${encodeURIComponent(gelen.personel.personelKodu)}`, {})
        .catch(() => undefined);
      setGelen({ ...gelen, kayitlar: gelen.kayitlar.map((x: any) => (x.id === k.id ? { ...x, okundu: 1 } : x)) });
    }
  };

  /* ================================================================ çizim */
  return (
    <div className="ik-icerik ip">
      <div className="ip-baslik">
        <div>
          <h2>
            <i><Megaphone size={17} strokeWidth={2.2} /></i>Duyurular
          </h2>
          <p>Biçen360 uygulamasına duyuru gönderin, okunma durumunu izleyin, size gelen duyuruları okuyun.</p>
        </div>
        <Button
          icon={<RefreshCw size={15} strokeWidth={2} />}
          loading={yukleniyor || gelenYukleniyor}
          onClick={() => {
            getir();
            gelenGetir();
          }}
        >
          Yenile
        </Button>
      </div>

      <div className="dy-sekmeler">
        {gonderebilir && (
          <button className={sekme === "yeni" ? "acik" : ""} onClick={() => setSekme("yeni")}>
            <Send size={14} /> Yeni Duyuru
          </button>
        )}
        <button className={sekme === "liste" ? "acik" : ""} onClick={() => setSekme("liste")}>
          Gönderilenler <em>{liste.filter((k) => !k.iptal).length}</em>
        </button>
        <button className={sekme === "gelen" ? "acik" : ""} onClick={() => setSekme("gelen")}>
          Gelen Duyurular {okunmamis > 0 ? <em className="kirmizi">{okunmamis}</em> : <em>{gelen?.kayitlar?.length ?? 0}</em>}
        </button>
      </div>

      {/* ============================================================ YENİ */}
      {sekme === "yeni" && gonderebilir && (
        <div className="dy-iki">
          <div className="ip-panel">
            {/* ---------------------------------------------------- kime */}
            <div className="dy-bolum">
              <div className="dy-bolum-bas"><i>1</i>Kime gönderilecek</div>
              <div className="dy-hedefler">
                {HEDEFLER.map((h) => {
                  const Ikon = h.ikon;
                  return (
                    <button key={h.deger} className={`dy-hedef${hedef === h.deger ? " acik" : ""}`}
                      onClick={() => {
                        setHedef(h.deger);
                        if (h.deger !== "sube" && h.deger !== "pozisyon") {
                          setSeciliSubeler([]);
                          setSeciliPozisyonlar([]);
                        }
                      }}>
                      <Ikon />
                      {h.ad}
                    </button>
                  );
                })}
              </div>

              {hedef === "sube" && (
                <>
                  <span className="dy-etiket">Şubeler</span>
                  <Select mode="multiple" allowClear showSearch style={{ width: "100%" }} placeholder="Bir ya da birden çok şube seçin"
                    value={seciliSubeler} onChange={setSeciliSubeler}
                    options={subeler.map((s) => ({ value: s, label: `${s} (${kisiler.filter((k) => k.subeAdi === s).length})` }))} />
                  <span className="dy-etiket">Yalnızca şu pozisyonlar (isteğe bağlı)</span>
                  <Select mode="multiple" allowClear showSearch style={{ width: "100%" }} placeholder="Boş bırakılırsa şubedeki herkes"
                    value={seciliPozisyonlar} onChange={setSeciliPozisyonlar}
                    options={pozisyonlar.map(([p, n]) => ({ value: p, label: `${p} (${n})` }))} />
                </>
              )}

              {hedef === "pozisyon" && (
                <>
                  <span className="dy-etiket">Pozisyonlar</span>
                  <Select mode="multiple" allowClear showSearch style={{ width: "100%" }} placeholder="Ör. Kasiyer, Kasap, Mağaza Müdürü"
                    value={seciliPozisyonlar} onChange={setSeciliPozisyonlar}
                    options={pozisyonlar.map(([p, n]) => ({ value: p, label: `${p} (${n})` }))} />
                  <span className="dy-etiket">Yalnızca şu şubeler (isteğe bağlı)</span>
                  <Select mode="multiple" allowClear showSearch style={{ width: "100%" }} placeholder="Boş bırakılırsa tüm şubeler"
                    value={seciliSubeler} onChange={setSeciliSubeler}
                    options={subeler.map((s) => ({ value: s, label: s }))} />
                </>
              )}

              {hedef === "kisi" && (
                <>
                  <span className="dy-etiket">Personel</span>
                  <Select mode="multiple" allowClear showSearch style={{ width: "100%" }} placeholder="Ad, sicil, şube ya da görev yazın"
                    value={seciliKisiler} onChange={setSeciliKisiler} optionFilterProp="label" maxTagCount="responsive"
                    options={kisiler.map((k) => ({
                      value: k.personelKodu,
                      label: `${k.adSoyad} · ${k.gorev || "—"} · ${k.subeAdi || "—"} · ${k.personelKodu}`,
                    }))} />
                </>
              )}

              <div className="dy-alici">
                <Users size={16} color="#5f8c10" />
                <span><b>{alicilar.length}</b> kişi alacak</span>
                <Tooltip title="Uygulamaya giriş yapmış olanlara anlık bildirim gider; diğerleri uygulamayı açınca görür.">
                  <Tag color="green" style={{ marginInlineEnd: 0 }}>{uygulamada} kişi Biçen360'ta</Tag>
                </Tooltip>
                <Button size="small" disabled={alicilar.length === 0} onClick={() => setAliciListesiAcik(true)}>
                  Listeyi gör
                </Button>
              </div>
            </div>

            {/* ---------------------------------------------------- içerik */}
            <div className="dy-bolum">
              <div className="dy-bolum-bas"><i>2</i>İçerik</div>
              <span className="dy-etiket">Başlık</span>
              <Input placeholder="Kısa ve anlaşılır bir başlık" maxLength={160} showCount value={baslik} onChange={(e) => setBaslik(e.target.value)} />
              <span className="dy-etiket">Duyuru metni</span>
              <TextArea rows={6} placeholder="Personelin okuyacağı metin" showCount maxLength={4000} value={metin} onChange={(e) => setMetin(e.target.value)} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <Switch checked={onemli} onChange={setOnemli} size="small" />
                <span style={{ fontSize: 13 }}>Önemli <span style={{ color: "#9aa3af", fontSize: 12 }}>· uygulamada turuncu şeritle öne çıkar</span></span>
              </div>
            </div>

            {/* ---------------------------------------------------- ekler */}
            <div className="dy-bolum">
              <div className="dy-bolum-bas"><i>3</i>Görsel ve bağlantı <span style={{ fontWeight: 400, color: "#9aa3af", fontSize: 12 }}>(isteğe bağlı)</span></div>
              {gorsel ? (
                <div>
                  <img src={gorsel} alt="" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 10, border: "1px solid #e3e6e1" }} />
                  <div style={{ marginTop: 8 }}>
                    <Button size="small" onClick={() => setGorsel(null)}>Görseli kaldır</Button>
                  </div>
                </div>
              ) : (
                <div className="dy-gorsel-alan" onClick={() => dosyaAlani.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); gorselSec(e.dataTransfer.files?.[0]); }}>
                  <ImageIkon size={22} color="#7cb518" />
                  <div><b style={{ color: "#1f2933" }}>Görsel seçin ya da buraya sürükleyin</b></div>
                  <div>JPG / PNG · en fazla 3 MB · 16:9 ya da 4:5 önerilir</div>
                </div>
              )}
              <input ref={dosyaAlani} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { gorselSec(e.target.files?.[0]); e.target.value = ""; }} />

              <Space.Compact style={{ width: "100%", marginTop: 10 }}>
                <Input prefix={<Link2 size={14} strokeWidth={2} />} placeholder="https://..." value={baglanti} onChange={(e) => setBaglanti(e.target.value)} style={{ width: "62%" }} />
                <Input placeholder={videoBaglantisi ? "Video görselin yerinde oynar" : "Düğme yazısı"} disabled={videoBaglantisi} maxLength={40} value={videoBaglantisi ? "" : baglantiYazi} onChange={(e) => setBaglantiYazi(e.target.value)} style={{ width: "38%" }} />
              </Space.Compact>

              <div className="dy-video">
                <Button
                  icon={<Video size={14} strokeWidth={2} />}
                  loading={videoYuzde !== null}
                  onClick={() => videoAlani.current?.click()}
                >
                  {videoYuzde !== null ? `Video yükleniyor %${videoYuzde}` : videoBaglantisi ? "Videoyu değiştir" : "Video yükle"}
                </Button>
                {videoBaglantisi && videoYuzde === null && (
                  <a href={baglanti} target="_blank" rel="noreferrer">
                    Videoyu önizle
                  </a>
                )}
                <span className="dy-video-not">
                  MP4 önerilir · en çok 1 GB · telefonda bağlantı düğmesiyle açılır, uygulama güncellemesi gerekmez
                </span>
                <input
                  ref={videoAlani}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    videoYukle(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            {/* ---------------------------------------------------- imza */}
            <div className="dy-bolum">
              <div className="dy-bolum-bas"><i>4</i>İmza</div>
              <Segmented value={imzaTuru} onChange={(v) => setImzaTuru(String(v))}
                options={[{ value: "varsayilan", label: "Varsayılan" }, { value: "kisisel", label: "Kendi imzam" }]} />
              {imzaTuru === "varsayilan" ? (
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#f4f6f1", borderRadius: 10, fontSize: 13, lineHeight: 1.5 }}>
                  <b>{ben?.adSoyad ?? "Adınız Soyadınız"}</b>
                  <div style={{ color: "#6b7280" }}>{ben?.unvan ?? "Ünvanınız hesabınızda tanımlı değil"}</div>
                </div>
              ) : (
                <>
                  <TextArea rows={3} style={{ marginTop: 8 }} value={imza} onChange={(e) => setImza(e.target.value)} maxLength={400}
                    placeholder={"Saygılarımla,\n" + (ben?.adSoyad ?? "Ad Soyad") + "\nİnsan Kaynakları"} />
                  <Checkbox checked={imzayiKaydet} onChange={(e) => setImzayiKaydet(e.target.checked)} style={{ marginTop: 6 }}>
                    <span style={{ fontSize: 12.5 }}>Bu imzayı kaydet; sonraki duyurularda hazır gelsin</span>
                  </Checkbox>
                </>
              )}
            </div>

            {/* -------------------------------------------- gönderim zamanı */}
            <div className="dy-bolum">
              <div className="dy-bolum-bas"><i>⏱</i>Gönderim zamanı</div>
              <Segmented
                value={planla ? "plan" : "hemen"}
                onChange={(v) => setPlanla(v === "plan")}
                options={[{ value: "hemen", label: "Hemen gönder" }, { value: "plan", label: "İleri tarihe planla" }]}
              />
              {planla && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <DatePicker
                    showTime={{ format: "HH:mm", minuteStep: 5 }}
                    format="DD.MM.YYYY HH:mm"
                    value={yayinZamani}
                    onChange={setYayinZamani}
                    disabledDate={(d) => d.isBefore(dayjs().startOf("day")) || d.isAfter(dayjs().add(1, "year"))}
                    placeholder="Tarih ve saat"
                    style={{ width: 220 }}
                  />
                  <span style={{ fontSize: 12.5, color: "#6b7280" }}>
                    Duyuru bu zamanda yayına girer, bildirim o anda gider. O zamana kadar personel görmez.
                  </span>
                </div>
              )}
            </div>

            <Space>
              <Button type="primary" size="large" icon={<Send size={15} strokeWidth={2} />} loading={gonderiliyor} onClick={gonder} disabled={alicilar.length === 0}>
                {planla && yayinZamani
                  ? `${yayinZamani.format("DD.MM HH:mm")} için planla`
                  : alicilar.length ? `${alicilar.length} kişiye gönder` : "Gönder"}
              </Button>
              <Button size="large" onClick={temizle}>Temizle</Button>
            </Space>
          </div>

          {/* ---------------------------------------------------- önizleme */}
          <div className="dy-onizleme-kap">
            <div className="ip-panel">
              <div className="ip-pbas">
                <div>
                  <b>Uygulamada görünümü</b>
                  <small>{hedefAciklama() || "Hedef seçilmedi"} · {alicilar.length} kişi</small>
                </div>
              </div>
              <div className="dy-tel">
                <div className="dy-ekran">
                  <div className="dy-ekran-ust"><small>Biçen360</small>Duyurular</div>
                  <DuyuruKarti
                    gorsel={gorsel}
                    d={{
                      baslik, metin, onemli, baglanti, baglantiYazi,
                      imza: imzaTuru === "kisisel" ? imza : null,
                      yazanAd: imzaTuru === "kisisel" ? null : ben?.adSoyad,
                      yazanUnvan: ben?.unvan,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ GÖNDERİLENLER */}
      {sekme === "liste" && (
        <div className="ip-panel">
          <div className="dy-liste-arac">
            <Input allowClear prefix={<Search size={14} />} placeholder="Başlık, metin, hedef ya da gönderen" value={arama}
              onChange={(e) => setArama(e.target.value)} style={{ width: 300 }} />
            <div className="ip-cipler">
              {([["yayinda", "Yayında"], ["kaldirildi", "Kaldırılan"], ["tum", "Tümü"]] as const).map(([k, t]) => (
                <button key={k} className={durumSuz === k ? "acik" : ""} onClick={() => setDurumSuz(k)}>
                  {t} ({liste.filter((x) => k === "tum" || (k === "yayinda" ? !x.iptal : x.iptal)).length})
                </button>
              ))}
            </div>
          </div>

          <Tablo
            rowKey="id"
            size="middle"
            loading={yukleniyor}
            dataSource={suzulmus}
            pagination={{ pageSize: 15, showSizeChanger: false }}
            locale={{ emptyText: "Duyuru bulunamadı." }}
            rowClassName="rp-tiklanabilir"
            onRow={(k: any) => ({ onClick: () => ayrintiAc(k) })}
            scroll={{ x: 1000 }}
            columns={[
              {
                title: "Duyuru",
                dataIndex: "baslik",
                render: (v: string, k: any) => (
                  <div className="dy-baslik-hucre" style={{ opacity: k.iptal ? 0.5 : 1 }}>
                    {k.gorselVar === 1 ? <img className="dy-kucuk-gorsel" src={gorselAdresi(k.id)} alt="" /> : <span className="dy-kucuk-bos"><Megaphone size={16} /></span>}
                    <div style={{ minWidth: 0 }}>
                      <b>{v}</b> {k.onemli && <Tag color="volcano">önemli</Tag>}
                      {k.planliBekliyor && !k.iptal && <Tag color="blue">planlı · {dayjs(k.olusturma).format("DD.MM HH:mm")}</Tag>}
                      <div style={{ fontSize: 12, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 }}>
                        {String(k.metin ?? "")}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: "Kime",
                key: "hedef",
                width: 230,
                render: (_v: any, k: any) => (
                  <Tooltip title={hedefYaz(k)}>
                    <Tag color={k.hedefTur === "secili" ? "purple" : k.hedefTur === "herkes" ? "green" : "blue"}
                      style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {hedefYaz(k)}
                    </Tag>
                  </Tooltip>
                ),
              },
              {
                title: "Okunma",
                key: "okuma",
                width: 180,
                render: (_v: any, k: any) => {
                  const oran = k.hedefSayisi ? Math.min(100, Math.round((k.okuyan * 100) / k.hedefSayisi)) : 0;
                  return (
                    <div className="dy-okuma" onClick={(e) => { e.stopPropagation(); ayrintiAc(k, "okuyan"); }}>
                      <div className="c"><i style={{ width: `${oran}%` }} /></div>
                      <span>{k.okuyan} / {k.hedefSayisi} kişi · %{oran}</span>
                    </div>
                  );
                },
              },
              {
                title: "Gönderen",
                key: "yazan",
                width: 160,
                render: (_v: any, k: any) => (
                  <div style={{ fontSize: 12.5 }}>
                    {k.yazanAd || k.gonderen || "—"}
                    {k.yazanUnvan && <div style={{ color: "#9aa3af", fontSize: 11.5 }}>{k.yazanUnvan}</div>}
                  </div>
                ),
              },
              {
                title: "Tarih",
                dataIndex: "olusturma",
                width: 140,
                sorter: (a: any, b: any) => dayjs(a.olusturma).valueOf() - dayjs(b.olusturma).valueOf(),
                render: (v: string) => tarihYaz(v),
              },
              {
                title: "",
                key: "islem",
                width: 140,
                align: "right" as const,
                render: (_v: any, k: any) => (
                  <Space size={4} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Görüntüle ve okuyanlar"><Button size="small" icon={<Eye size={13} />} onClick={() => ayrintiAc(k)} /></Tooltip>
                    {gonderebilir && <Tooltip title="Forma kopyala"><Button size="small" icon={<Copy size={13} />} onClick={() => kopyala(k)} /></Tooltip>}
                    {gonderebilir && (k.iptal ? <Tag>kaldırıldı</Tag> : (
                      <Tooltip title="Yayından kaldır"><Button size="small" danger icon={<Trash2 size={13} />} onClick={() => kaldir(k)} /></Tooltip>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* ============================================================ GELEN */}
      {sekme === "gelen" && (
        <div>
          {gelen && !gelen.eslesti && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message="Hesabınız bir personel kaydıyla eşleşmedi"
              description="Yalnızca tüm personele gönderilen duyurular görünür. Şubenize, pozisyonunuza ya da size özel duyuruları görmek için Yönetim → Kullanıcılar ekranından hesabınıza sicil numaranızı ya da telefonunuzu ekleyin." />
          )}
          {gelen?.personel && (
            <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 10 }}>
              {gelen.personel.adSoyad} · {gelen.personel.gorev} · {gelen.personel.subeAdi} olarak size gönderilen duyurular
            </div>
          )}
          {gelenYukleniyor && !gelen ? (
            <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
          ) : (gelen?.kayitlar ?? []).length === 0 ? (
            <div className="ip-panel"><Empty description="Size gelen duyuru yok." /></div>
          ) : (
            <div className="dy-gelen">
              {gelen.kayitlar.map((k: any) => (
                <button key={k.id} className={`dy-gelen-kart${k.onemli ? " onemli" : ""}${k.okundu ? "" : " yeni"}`} onClick={() => gelenAc(k)}>
                  {k.gorselVar === 1 && <img src={gorselAdresi(k.id)} alt="" />}
                  <h4>{k.baslik}</h4>
                  <p>{k.metin}</p>
                  <div className="dy-gelen-alt">
                    <span>{k.yazanAd || k.gonderen || "İnsan Kaynakları"}</span>
                    <span>{tarihYaz(k.olusturma)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ alıcı listesi */}
      <Modal open={aliciListesiAcik} onCancel={() => setAliciListesiAcik(false)} footer={null} width={640}
        title={<Space><b>Alıcılar</b><Tag>{alicilar.length} kişi</Tag><Tag color="green">{uygulamada} Biçen360'ta</Tag></Space>}>
        <Tablo rowKey="personelKodu" size="small" dataSource={alicilar} pagination={{ pageSize: 12, showSizeChanger: false }}
          columns={[
            { title: "Personel", dataIndex: "adSoyad", render: (v: string, k: any) => <span><b>{v}</b> <span style={{ color: "#9aa3af", fontSize: 11.5 }}>{k.personelKodu}</span></span> },
            { title: "Görev", dataIndex: "gorev", width: 150 },
            { title: "Şube", dataIndex: "subeAdi", width: 150 },
            { title: "Uygulama", dataIndex: "uygulama", width: 95, render: (v: boolean) => (v ? <Tag color="green">var</Tag> : <Tag>yok</Tag>) },
          ]} />
      </Modal>

      {/* ------------------------------------------------ gönderilen ayrıntısı */}
      <Drawer open={!!ayrinti} onClose={() => setAyrinti(null)} width="min(980px, 96vw)"
        title={ayrinti && (
          <Space wrap>
            <b>{ayrinti.baslik}</b>
            <Tag color={ayrinti.iptal ? "default" : ayrinti.planliBekliyor ? "blue" : "green"}>
              {ayrinti.iptal ? "kaldırıldı" : ayrinti.planliBekliyor ? `planlı · ${dayjs(ayrinti.olusturma).format("DD.MM.YYYY HH:mm")}` : "yayında"}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12.5 }}>{hedefYaz(ayrinti)} · {tarihYaz(ayrinti.olusturma)}</Text>
          </Space>
        )}
        extra={ayrinti && gonderebilir && (
          <Space>
            <Button icon={<Copy size={14} />} onClick={() => { kopyala(ayrinti); setAyrinti(null); }}>Forma kopyala</Button>
            {!ayrinti.iptal && <Button danger icon={<Trash2 size={14} />} onClick={() => kaldir(ayrinti)}>Kaldır</Button>}
          </Space>
        )}>
        {ayrinti && (
          <div className="dy-iki" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)" }}>
            <div>
              <DuyuruKarti d={ayrinti} gorsel={ayrinti.gorselVar === 1 ? gorselAdresi(ayrinti.id) : null} />
              {ayrinti.baglanti && (
                <div style={{ fontSize: 12, color: "#6b7280", margin: "0 12px" }}>
                  Bağlantı: <a href={ayrinti.baglanti} target="_blank" rel="noreferrer">{ayrinti.baglanti}</a>
                </div>
              )}
            </div>
            <div>
              {!okuma ? (
                <div style={{ textAlign: "center", padding: 30 }}><Spin /></div>
              ) : (
                <>
                  <div className="ip-cipler" style={{ display: "inline-flex", marginBottom: 10 }}>
                    <button className={okumaSekme === "okuyan" ? "acik" : ""} onClick={() => setOkumaSekme("okuyan")}>Okuyanlar ({okuma.okuyanlar.length})</button>
                    <button className={okumaSekme === "okumayan" ? "acik" : ""} onClick={() => setOkumaSekme("okumayan")}>Henüz okumayanlar ({okuma.okumayanlar.length})</button>
                  </div>
                  <Input allowClear size="small" prefix={<Search size={13} />} placeholder="Ad, şube, görev" value={okumaAra}
                    onChange={(e) => setOkumaAra(e.target.value)} style={{ marginBottom: 8 }} />
                  <Tablo rowKey="personelKodu" size="small" pagination={{ pageSize: 12, showSizeChanger: false }}
                    dataSource={(okumaSekme === "okuyan" ? okuma.okuyanlar : okuma.okumayanlar).filter((k: any) =>
                      !okumaAra || `${k.adSoyad} ${k.subeAdi} ${k.gorev}`.toLocaleLowerCase("tr").includes(okumaAra.toLocaleLowerCase("tr")))}
                    columns={[
                      { title: "Personel", dataIndex: "adSoyad", render: (v: string, k: any) => <span><b>{v}</b><div style={{ color: "#9aa3af", fontSize: 11.5 }}>{k.gorev} · {k.subeAdi}</div></span> },
                      okumaSekme === "okuyan"
                        ? { title: "Okuma", dataIndex: "okuma", width: 130, render: (v: string) => (v ? tarihYaz(v) : "—") }
                        : { title: "Uygulama", dataIndex: "uygulama", width: 130, render: (v: boolean) => (v ? <Tag color="green">kullanıyor</Tag> : <Tag color="orange">kurmamış</Tag>) },
                    ]} />
                </>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* ------------------------------------------------ gelen ayrıntısı */}
      <Drawer open={!!gelenAcik} onClose={() => setGelenAcik(null)} width="min(560px, 96vw)" title={gelenAcik?.baslik}>
        {gelenAcik && (
          <>
            <DuyuruKarti d={gelenAcik} gorsel={gelenAcik.gorselVar === 1 ? gorselAdresi(gelenAcik.id) : null} />
            {gelenAcik.baglanti && !videoDosyasi(gelenAcik.baglanti) && (
              <div style={{ margin: "0 12px" }}>
                <Button type="primary" block href={gelenAcik.baglanti} target="_blank">{gelenAcik.baglantiYazi || "Bağlantıyı aç"}</Button>
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
