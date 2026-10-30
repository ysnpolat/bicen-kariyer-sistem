/**
 * Mesajlaşma (22.10.2026)
 * ---------------------------------------------------------------------------
 * Panel kullanıcıları arasında grup ve özel mesajlaşma; görsel, video ve
 * dosya. Teams benzeri üç sütun: sohbet listesi, mesajlar, sohbet bilgisi.
 *
 * Anlık güncelleme kısa aralıklı sorguyla: açık sohbet 3 saniyede, liste 6
 * saniyede bir yenilenir. Yeni mesaj bildirimi ve sesi MesajBildirim.tsx'te
 * (her sayfada çalışır). Uçlar: /api/Mesajlasma (MesajlasmaController).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Checkbox, Dropdown, Input, Modal, Segmented, Spin, Tooltip } from "antd";
import {
  ArrowLeft, Info, BellOff, Bell, Download, Pencil, FileText, ImagePlus, LogOut, MessageSquarePlus, Paperclip, Reply,
  Search, Send, Trash2, UserMinus, UserPlus, Users, X,
} from "lucide-react";
import dayjs from "dayjs";
import { API_TABAN, api, oturumOku } from "./api";
import "./Mesajlasma.css";

interface Son { gonderenAd: string | null; ben: boolean; tur: string; metin: string | null; dosya: string | null }
interface Sohbet {
  id: number; tur: "grup" | "kisi"; ad: string; karsi: string | null; duyuru: boolean; yoneticiEkler: boolean;
  benYonetici: boolean; sessiz: boolean; uyeSayisi: number; okunmamis: number; sonZaman: string; son: Son | null;
}
interface Mesaj {
  id: number; gonderen: string | null; gonderenAd: string | null; ben: boolean; tur: string; metin: string | null;
  silindi: boolean; duzenlendi?: boolean; dosyaAd: string | null; dosyaTur: string | null; dosyaBoyut: number | null; tarih: string;
  yanit: { id: number; gonderenAd: string | null; metin: string | null } | null;
}
interface Uye { kod: string; ad: string; rol: string | null; yonetici: boolean }
interface Kullanici { kod: string; ad: string; rol: string; tur?: string; sube?: string | null }

const RENK = ["#7cb518", "#1a4d80", "#e8481c", "#722ed1", "#0f766e", "#c98a0b", "#5f8c10", "#be185d"];
const renk = (a = "") => RENK[[...a].reduce((t, c) => t + c.charCodeAt(0), 0) % RENK.length];
const bas = (a = "") =>
  a.split(" ").filter((x) => /\p{L}/u.test(x[0] ?? "")).map((x) => x[0]).slice(0, 2).join("").toLocaleUpperCase("tr");
const ROL: Record<string, string> = {
  Admin: "Yönetici", GenelMudurYardimcisi: "Genel Müdür Yardımcısı", IKYoneticisi: "İK Yöneticisi", IK: "İK Uzmanı",
  BolgeMuduru: "Bölge Müdürü", BolgeKoordinatoru: "Bölge Koordinatörü", FotografGorevlisi: "Fotoğraf Görevlisi",
};
const boyutYaz = (b?: number | null) =>
  !b ? "" : b > 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB` : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const zamanKisa = (t: string) => {
  const d = dayjs(t);
  if (d.isSame(dayjs(), "day")) return d.format("HH:mm");
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Dün";
  if (d.isAfter(dayjs().subtract(6, "day"))) return ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"][d.day()];
  return d.format("DD.MM");
};
const gunEtiketi = (t: string) => {
  const d = dayjs(t);
  if (d.isSame(dayjs(), "day")) return "Bugün";
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Dün";
  return d.format("DD.MM.YYYY");
};
const dosyaAdresi = (id: number, indir = false) =>
  `${API_TABAN}/api/Mesajlasma/Dosya/${id}?t=${encodeURIComponent(oturumOku()?.token ?? "")}${indir ? "&indir=true" : ""}`;

function Avatar({ ad, kare, boyut = 42 }: { ad: string; kare?: boolean; boyut?: number }) {
  return (
    <div className={"msj-av" + (kare ? " kare" : "")} style={{ background: renk(ad), width: boyut, height: boyut, flexBasis: boyut, fontSize: boyut * 0.34 }}>
      {bas(ad) || "?"}
    </div>
  );
}

/** Yeni gelenleri ekler, düzenlenen/silinenleri yerinde günceller */
const birlestir = (eski: Mesaj[], gelen: Mesaj[]) => {
  const harita = new Map(gelen.map((x) => [x.id, x]));
  const guncel = eski.map((x) => harita.get(x.id) ?? x);
  const yeni = gelen.filter((x) => !eski.some((y) => y.id === x.id) && x.id > (eski[eski.length - 1]?.id ?? 0));
  return [...guncel, ...yeni];
};
const enBuyukId = (l: Mesaj[], v: number) => l.reduce((t, x) => Math.max(t, x.id), v);

/** Görseli göndermeden önce küçültür (uzun kenar 1920 px, JPEG %82); yer kazandırır */
/* 23.10.2026: her dosya türü, 5 GB'a kadar. 8 MB'tan büyükler parça parça
   gider (IIS tek istekte büyük dosya kabul etmiyor); kopan parça yeniden denenir. */
const DOSYA_SINIRI = 5 * 1024 * 1024 * 1024;
const PARCA = 8 * 1024 * 1024;

const yuklemeKimligi = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

const parcaliGonder = async (
  sohbet: number,
  dosya: File,
  metin: string | null,
  yanitId: number | null,
  ilerle: (oran: number) => void
) => {
  const yukleme = yuklemeKimligi();
  for (let bas = 0; bas < dosya.size; bas += PARCA) {
    const f = new FormData();
    f.append("yukleme", yukleme);
    f.append("baslangic", String(bas));
    f.append("toplam", String(dosya.size));
    f.append("parca", dosya.slice(bas, bas + PARCA), "parca");
    for (let deneme = 1; ; deneme++) {
      try {
        await api.dosyaGonder(`/api/Mesajlasma/${sohbet}/Parca`, f);
        break;
      } catch (h) {
        if (deneme >= 4) throw h;
        await new Promise((r) => setTimeout(r, 1500 * deneme));
      }
    }
    ilerle(Math.min(1, (bas + PARCA) / dosya.size));
  }
  await api.gonder(`/api/Mesajlasma/${sohbet}/ParcaBitir`, {
    yukleme,
    ad: dosya.name,
    tur: dosya.type || "application/octet-stream",
    boyut: dosya.size,
    metin,
    yanitId,
  });
};

const gorselKucult = (f: File): Promise<File> =>
  new Promise((coz) => {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 400 * 1024) return coz(f);
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const o = Math.min(1, 1920 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * o);
      c.height = Math.round(img.height * o);
      const x = c.getContext("2d");
      if (!x) return coz(f);
      x.fillStyle = "#fff";
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(
        (b) => coz(b && b.size < f.size ? new File([b], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : f),
        "image/jpeg",
        0.82
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); coz(f); };
    img.src = url;
  });

/** Bildirimden açılmak istenen sohbet (sayfa henüz açık değilken gelen istek) */
let bekleyenAc: number | null = null;
export const mesajlasmaAc = (id: number) => {
  bekleyenAc = id;
  window.dispatchEvent(new CustomEvent("mesajlasma-ac", { detail: id }));
};

/** Şu an ekranda açık sohbet; bildirim bu sohbet için ses/kart göstermez */
export const acikSohbet = { id: null as number | null };

export default function Mesajlasma() {
  const { message, modal } = AntdApp.useApp();
  const [liste, setListe] = useState<Sohbet[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [aktif, setAktifHam] = useState<number | null>(null);
  /* Dar ekranda (telefon) tek bölme görünür: liste ya da sohbet */
  const [ekran, setEkran] = useState<"liste" | "sohbet">("liste");
  const [bilgiAcik, setBilgiAcik] = useState(false);
  const setAktif = useCallback((id: number | null) => {
    setAktifHam(id);
    setBilgiAcik(false);
    setEkran(id ? "sohbet" : "liste");
  }, []);
  const [mesajlar, setMesajlar] = useState<Mesaj[]>([]);
  const [okudu, setOkudu] = useState(0);
  const [dahaVar, setDahaVar] = useState(false);
  const [uyeler, setUyeler] = useState<Uye[]>([]);
  const [suz, setSuz] = useState<"hepsi" | "grup" | "kisi" | "okunmamis">("hepsi");
  const [ara, setAra] = useState("");
  const [metin, setMetin] = useState("");
  const [ekler, setEkler] = useState<File[]>([]);
  const [yanit, setYanit] = useState<Mesaj | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [yuklemeDurum, setYuklemeDurum] = useState<string | null>(null);
  const [yeniAcik, setYeniAcik] = useState<null | "yeni" | "ekle">(null);
  const [duzenle, setDuzenle] = useState<Mesaj | null>(null);

  const kutu = useRef<HTMLDivElement>(null);
  const dosyaGir = useRef<HTMLInputElement>(null);
  const sonIdRef = useRef(0);
  const altta = useRef(true);

  const sohbet = liste.find((x) => x.id === aktif) ?? null;

  /* ------------------------------------------------------------ liste */
  const listeGetir = useCallback(async () => {
    try {
      const d = await api.al<{ sohbetler: Sohbet[] }>("/api/Mesajlasma");
      setListe(d.sohbetler ?? []);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  useEffect(() => {
    listeGetir();
    const z = window.setInterval(() => document.visibilityState === "visible" && listeGetir(), 6000);
    return () => window.clearInterval(z);
  }, [listeGetir]);

  /* Bildirimden ya da başka sayfadan açılan sohbet */
  useEffect(() => {
    if (bekleyenAc) {
      setAktif(bekleyenAc);
      bekleyenAc = null;
    }
    const f = (e: Event) => {
      setAktif((e as CustomEvent).detail);
      bekleyenAc = null;
    };
    window.addEventListener("mesajlasma-ac", f);
    return () => window.removeEventListener("mesajlasma-ac", f);
  }, [setAktif]);

  /* İlk açılışta en son sohbet seçilir */
  useEffect(() => {
    /* Geniş ekranda en son sohbet açılır; telefonda önce liste görünür */
    if (aktif === null && liste.length > 0 && !bekleyenAc && window.innerWidth > 900) setAktif(liste[0].id);
  }, [liste, aktif, setAktif]);

  useEffect(() => {
    acikSohbet.id = aktif;
    return () => {
      acikSohbet.id = null;
    };
  }, [aktif]);

  /* ------------------------------------------------------------ mesajlar */
  const okunduYaz = useCallback(
    (id: number, son: number) => {
      if (son > 0 && document.visibilityState === "visible")
        api.gonder(`/api/Mesajlasma/${id}/Okundu`, { sonId: son }).catch(() => undefined);
      setListe((l) => l.map((x) => (x.id === id ? { ...x, okunmamis: 0 } : x)));
    },
    []
  );

  useEffect(() => {
    if (!aktif) return;
    let iptal = false;
    setMesajlar([]);
    setUyeler([]);
    setYanit(null);
    setDuzenle(null);
    sonIdRef.current = 0;
    altta.current = true;

    api
      .al<any>(`/api/Mesajlasma/${aktif}/Mesajlar`)
      .then((d) => {
        if (iptal) return;
        setMesajlar(d.mesajlar ?? []);
        setOkudu(d.digerleriOkudu ?? 0);
        setDahaVar(!!d.dahaVar);
        const son = d.mesajlar?.length ? d.mesajlar[d.mesajlar.length - 1].id : 0;
        sonIdRef.current = son;
        okunduYaz(aktif, son);
      })
      .catch((h) => message.error(h.message));

    api.al<Uye[]>(`/api/Mesajlasma/${aktif}/Uyeler`).then((u) => !iptal && setUyeler(u ?? [])).catch(() => undefined);

    const z = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const d = await api.al<any>(`/api/Mesajlasma/${aktif}/Mesajlar?sonra=${sonIdRef.current}`);
        setOkudu(d.digerleriOkudu ?? 0);
        if (d.mesajlar?.length) {
          setMesajlar((m) => birlestir(m, d.mesajlar));
          const son = enBuyukId(d.mesajlar, sonIdRef.current);
          if (son > sonIdRef.current) okunduYaz(aktif, son);
          sonIdRef.current = son;
          if (d.mesajlar.some((x: Mesaj) => x.tur === "sistem"))
            api.al<Uye[]>(`/api/Mesajlasma/${aktif}/Uyeler`).then((u) => setUyeler(u ?? [])).catch(() => undefined);
        }
      } catch {
        /* sessiz */
      }
    }, 3000);

    return () => {
      iptal = true;
      window.clearInterval(z);
    };
  }, [aktif, message, okunduYaz]);

  /* Yeni mesajda en alta (kullanıcı yukarıda okumuyorsa) */
  useEffect(() => {
    const el = kutu.current;
    if (el && altta.current) el.scrollTop = el.scrollHeight;
  }, [mesajlar]);

  const eskileriGetir = async () => {
    if (!aktif || !mesajlar.length) return;
    const el = kutu.current;
    const once = el?.scrollHeight ?? 0;
    const d = await api.al<any>(`/api/Mesajlasma/${aktif}/Mesajlar?once=${mesajlar[0].id}`);
    setDahaVar(!!d.dahaVar);
    altta.current = false;
    setMesajlar((m) => [...(d.mesajlar ?? []), ...m]);
    requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - once));
  };

  /* ------------------------------------------------------------ gönderme */
  const gonder = async () => {
    if (!aktif || gonderiliyor) return;
    const t = metin.trim();
    if (duzenle) {
      if (!t && duzenle.tur === "metin") return;
      setGonderiliyor(true);
      try {
        await api.guncelle(`/api/Mesajlasma/Mesaj/${duzenle.id}`, { metin: t });
        setMesajlar((l) => l.map((x) => (x.id === duzenle.id ? { ...x, metin: t || null, duzenlendi: true } : x)));
        setDuzenle(null);
        setMetin("");
      } catch (h: any) {
        message.error(h.message);
      } finally {
        setGonderiliyor(false);
      }
      return;
    }
    if (!t && ekler.length === 0) return;
    setGonderiliyor(true);
    try {
      for (let i = 0; i < ekler.length; i++) {
        const ek = ekler[i];
        const sonMetin = i === ekler.length - 1 && t ? t : null;
        if (ek.size > PARCA) {
          setYuklemeDurum(`${ek.name} · %0`);
          await parcaliGonder(aktif, ek, sonMetin, yanit?.id ?? null, (o) =>
            setYuklemeDurum(`${ek.name} · %${Math.round(o * 100)} (${boyutYaz(ek.size)})`)
          );
          continue;
        }
        const f = new FormData();
        f.append("dosya", await gorselKucult(ek));
        if (sonMetin) f.append("metin", sonMetin);
        if (yanit) f.append("yanitId", String(yanit.id));
        await api.dosyaGonder(`/api/Mesajlasma/${aktif}/Dosya`, f);
      }
      if (t && ekler.length === 0)
        await api.gonder(`/api/Mesajlasma/${aktif}/Mesaj`, { metin: t, yanitId: yanit?.id ?? null });
      setMetin("");
      setEkler([]);
      setYanit(null);
      altta.current = true;
      const d = await api.al<any>(`/api/Mesajlasma/${aktif}/Mesajlar?sonra=${sonIdRef.current}`);
      if (d.mesajlar?.length) {
        setMesajlar((m) => birlestir(m, d.mesajlar));
        sonIdRef.current = enBuyukId(d.mesajlar, sonIdRef.current);
      }
      listeGetir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setGonderiliyor(false);
      setYuklemeDurum(null);
    }
  };

  const ekEkle = (dosyalar: FileList | File[] | null) => {
    if (!dosyalar) return;
    const l = Array.from(dosyalar).filter((f) => {
      if (f.size > DOSYA_SINIRI) {
        message.warning(`${f.name}: en fazla 5 GB`);
        return false;
      }
      return true;
    });
    setEkler((e) => [...e, ...l].slice(0, 10));
  };

  const sil = (m: Mesaj) =>
    modal.confirm({
      title: "Mesaj silinsin mi?",
      content: "Herkes için “Bu mesaj silindi” olarak görünür.",
      okText: "Sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        await api.sil(`/api/Mesajlasma/Mesaj/${m.id}`);
        setMesajlar((l) => l.map((x) => (x.id === m.id ? { ...x, silindi: true, metin: null, dosyaAd: null, tur: "metin" } : x)));
        if (duzenle?.id === m.id) { setDuzenle(null); setMetin(""); }
      },
    });

  /* ------------------------------------------------------------ üyeler */
  const uyeCikar = (u: Uye) =>
    modal.confirm({
      title: u.kod === oturumOku()?.kullaniciAdi ? "Gruptan ayrılmak istiyor musunuz?" : `${u.ad} gruptan çıkarılsın mı?`,
      okText: u.kod === oturumOku()?.kullaniciAdi ? "Ayrıl" : "Çıkar",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        await api.sil(`/api/Mesajlasma/${aktif}/Uye/${encodeURIComponent(u.kod)}`);
        if (u.kod === oturumOku()?.kullaniciAdi) {
          setAktif(null);
        } else {
          setUyeler((l) => l.filter((x) => x.kod !== u.kod));
        }
        listeGetir();
      },
    });

  const sessiz = async () => {
    if (!sohbet) return;
    await api.gonder(`/api/Mesajlasma/${sohbet.id}/Sessiz`, { sessiz: !sohbet.sessiz });
    setListe((l) => l.map((x) => (x.id === sohbet.id ? { ...x, sessiz: !x.sessiz } : x)));
    message.success(sohbet.sessiz ? "Bildirimler açıldı" : "Sohbet sessize alındı");
  };

  /* ------------------------------------------------------------ çizim */
  const gorunen = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return liste.filter(
      (s) =>
        (suz === "hepsi" || (suz === "okunmamis" ? s.okunmamis > 0 : s.tur === suz)) &&
        (!q || s.ad.toLocaleLowerCase("tr").includes(q) || (s.son?.metin ?? "").toLocaleLowerCase("tr").includes(q))
    );
  }, [liste, suz, ara]);

  const sonOzet = (s: Sohbet) => {
    if (!s.son) return s.tur === "grup" ? "Grup oluşturuldu" : "Sohbet başladı";
    const k = s.son.ben ? "Siz: " : s.tur === "grup" && s.son.gonderenAd ? s.son.gonderenAd.split(" ")[0] + ": " : "";
    const i = s.son.metin ?? (s.son.tur === "gorsel" ? "📷 Görsel" : s.son.tur === "video" ? "🎬 Video" : s.son.dosya ? "📎 " + s.son.dosya : "");
    return s.son.tur === "sistem" ? i : k + i;
  };

  const satir = (s: Sohbet) => (
    <div key={s.id} className={"msj-s" + (s.id === aktif ? " acik" : "")} onClick={() => setAktif(s.id)}>
      <Avatar ad={s.ad} kare={s.tur === "grup"} />
      <div className="msj-s-orta">
        <div className="msj-s-ust">
          <b>{s.ad}</b>
          <small>{zamanKisa(s.sonZaman)}</small>
        </div>
        <div className="msj-s-son">
          <span>{sonOzet(s)}</span>
          {s.sessiz && <BellOff size={13} color="#9aa3af" />}
          {s.okunmamis > 0 && <span className="msj-rozet">{s.okunmamis}</span>}
        </div>
      </div>
    </div>
  );

  const benYazabilir = !sohbet?.duyuru || sohbet?.benYonetici;

  return (
    <div className={`msj ekran-${ekran}`}>
      {/* ---------------------------------------------------- liste */}
      <section className="msj-liste">
        <div className="msj-liste-bas">
          <h2>Mesajlar</h2>
          <button className="msj-yeni" onClick={() => setYeniAcik("yeni")}>
            <MessageSquarePlus size={16} /> Yeni
          </button>
        </div>
        <div className="msj-ara">
          <Search size={15} />
          <input placeholder="Kişi, grup ya da mesaj ara" value={ara} onChange={(e) => setAra(e.target.value)} />
        </div>
        <Segmented
          size="small"
          block
          style={{ margin: "0 14px 8px" }}
          value={suz}
          onChange={(v) => setSuz(v as any)}
          options={[
            { label: "Hepsi", value: "hepsi" },
            { label: "Gruplar", value: "grup" },
            { label: "Kişiler", value: "kisi" },
            { label: "Okunmamış", value: "okunmamis" },
          ]}
        />
        <div className="msj-sohbetler">
          {yukleniyor ? (
            <div style={{ padding: 30, textAlign: "center" }}><Spin /></div>
          ) : gorunen.length === 0 ? (
            <div className="msj-bos-liste">
              {liste.length === 0 ? "Henüz sohbet yok. “Yeni” ile grup kurun ya da birine yazın." : "Sonuç yok"}
            </div>
          ) : (
            <>
              {gorunen.some((s) => s.tur === "grup") && <div className="msj-grup-bas">GRUPLAR</div>}
              {gorunen.filter((s) => s.tur === "grup").map(satir)}
              {gorunen.some((s) => s.tur === "kisi") && <div className="msj-grup-bas">ÖZEL MESAJLAR</div>}
              {gorunen.filter((s) => s.tur === "kisi").map(satir)}
            </>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------- sohbet */}
      <section
        className="msj-sohbet"
        onDragOver={(e) => {
          if (sohbet && benYazabilir) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!sohbet || !benYazabilir) return;
          e.preventDefault();
          ekEkle(e.dataTransfer.files);
        }}
      >
        {!sohbet ? (
          <div className="msj-bos">
            <MessageSquarePlus size={42} color="#9aa3af" />
            <div>Bir sohbet seçin ya da yeni bir sohbet başlatın</div>
          </div>
        ) : (
          <>
            <div className="msj-bas">
              <button className="msj-ikon msj-geri" onClick={() => setEkran("liste")} aria-label="Sohbetlere dön">
                <ArrowLeft size={18} />
              </button>
              <Avatar ad={sohbet.ad} kare={sohbet.tur === "grup"} />
              <div className="msj-bas-bilgi" onClick={() => setBilgiAcik(true)}>
                <b>{sohbet.ad}</b>
                <small>
                  {sohbet.tur === "grup"
                    ? `${uyeler.length || sohbet.uyeSayisi} üye${sohbet.duyuru ? " · duyuru grubu" : ""} · ${uyeler.slice(0, 3).map((u) => u.ad.split(" ")[0]).join(", ")}`
                    : ROL[uyeler.find((u) => u.kod === sohbet.karsi)?.rol ?? ""] ?? "Özel sohbet"}
                </small>
              </div>
              {sohbet.tur === "grup" && (!sohbet.yoneticiEkler || sohbet.benYonetici) && (
                <Tooltip title="Üye ekle">
                  <button className="msj-ikon" onClick={() => setYeniAcik("ekle")}><UserPlus size={17} /></button>
                </Tooltip>
              )}
              <Tooltip title={sohbet.sessiz ? "Bildirimleri aç" : "Sessize al"}>
                <button className="msj-ikon" onClick={sessiz}>{sohbet.sessiz ? <Bell size={17} /> : <BellOff size={17} />}</button>
              </Tooltip>
              <button className="msj-ikon msj-bilgi-dugme" onClick={() => setBilgiAcik(true)} aria-label="Sohbet bilgisi">
                <Info size={17} />
              </button>
            </div>

            <div
              className="msj-mesajlar"
              ref={kutu}
              onScroll={(e) => {
                const el = e.currentTarget;
                altta.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {dahaVar && (
                <button className="msj-eski" onClick={eskileriGetir}>Önceki mesajları yükle</button>
              )}
              {mesajlar.map((m, i) => {
                const onceki = mesajlar[i - 1];
                const gunDegisti = !onceki || !dayjs(onceki.tarih).isSame(m.tarih, "day");
                const ayniKisi = onceki && !gunDegisti && onceki.gonderen === m.gonderen && onceki.tur !== "sistem"
                  && dayjs(m.tarih).diff(onceki.tarih, "minute") < 5;
                return (
                  <div key={m.id} style={{ display: "contents" }}>
                    {gunDegisti && <div className="msj-gun">{gunEtiketi(m.tarih)}</div>}
                    {m.tur === "sistem" ? (
                      <div className="msj-sistem">{m.metin}</div>
                    ) : (
                      <div className={"msj-m" + (m.ben ? " ben" : "") + (ayniKisi ? " ardisik" : "")}>
                        {!m.ben && (ayniKisi ? <div style={{ width: 32, flex: "0 0 32px" }} /> : <Avatar ad={m.gonderenAd ?? "?"} boyut={32} />)}
                        <div className="msj-balon">
                          {sohbet.tur === "grup" && !m.ben && !ayniKisi && (
                            <div className="msj-kim" style={{ color: renk(m.gonderenAd ?? "") }}>{m.gonderenAd}</div>
                          )}
                          {m.yanit && (
                            <div className="msj-alinti"><b>{m.yanit.gonderenAd}</b> {m.yanit.metin}</div>
                          )}
                          {m.silindi ? (
                            <i className="msj-silindi">Bu mesaj silindi</i>
                          ) : (
                            <>
                              {m.tur === "gorsel" && (
                                <a href={dosyaAdresi(m.id)} target="_blank" rel="noreferrer">
                                  <img className="msj-gorsel" src={dosyaAdresi(m.id)} alt={m.dosyaAd ?? ""} loading="lazy" />
                                </a>
                              )}
                              {m.tur === "video" && (
                                <video className="msj-video" src={dosyaAdresi(m.id)} controls preload="metadata" />
                              )}
                              {m.tur === "dosya" && (
                                <a className="msj-dosya" href={dosyaAdresi(m.id, true)}>
                                  <span className={"tur" + ((m.dosyaAd ?? "").toLowerCase().endsWith(".pdf") ? " pdf" : "")}>
                                    {(m.dosyaAd ?? "").split(".").pop()?.toUpperCase().slice(0, 4)}
                                  </span>
                                  <span><b>{m.dosyaAd}</b><small>{boyutYaz(m.dosyaBoyut)} · İndir</small></span>
                                  <Download size={16} />
                                </a>
                              )}
                              {m.tur === "kaldirildi" && (
                                <i className="msj-silindi">📎 {m.dosyaAd ?? "Ek"} · yer açmak için kaldırıldı</i>
                              )}
                              {m.metin && <div className="msj-metin">{m.metin}</div>}
                            </>
                          )}
                          <div className="msj-zaman">
                            {m.duzenlendi && <span>düzenlendi ·</span>}
                            {dayjs(m.tarih).format("HH:mm")}
                            {m.ben && sohbet.tur === "kisi" && (
                              <span className={"msj-tik" + (okudu >= m.id ? " okundu" : "")}>✓✓</span>
                            )}
                          </div>
                          {!m.silindi && (
                            <div className="msj-islem">
                              <button title="Yanıtla" onClick={() => setYanit(m)}><Reply size={14} /></button>
                              {m.ben && m.tur !== "sistem" && (
                                <button title="Düzenle" onClick={() => { setDuzenle(m); setYanit(null); setMetin(m.metin ?? ""); }}><Pencil size={14} /></button>
                              )}
                              {m.ben && <button title="Sil" onClick={() => sil(m)}><Trash2 size={14} /></button>}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {benYazabilir ? (
              <div className="msj-yaz">
                {duzenle && (
                  <div className="msj-yanit-on duzen">
                    <Pencil size={14} />
                    <span><b>Mesajı düzenliyorsunuz</b> {duzenle.dosyaAd ? "· " + duzenle.dosyaAd : ""}</span>
                    <button onClick={() => { setDuzenle(null); setMetin(""); }}><X size={14} /></button>
                  </div>
                )}
                {yanit && (
                  <div className="msj-yanit-on">
                    <Reply size={14} />
                    <span><b>{yanit.gonderenAd ?? "Siz"}</b> {yanit.metin ?? yanit.dosyaAd}</span>
                    <button onClick={() => setYanit(null)}><X size={14} /></button>
                  </div>
                )}
                {ekler.length > 0 && (
                  <div className="msj-ekler">
                    {ekler.map((f, i) => (
                      <span key={i} className="msj-ek">
                        {f.type.startsWith("image/") ? "📷" : f.type.startsWith("video/") ? "🎬" : "📎"} {f.name}
                        <small>{boyutYaz(f.size)}</small>
                        <button onClick={() => setEkler((e) => e.filter((_, j) => j !== i))}><X size={13} /></button>
                      </span>
                    ))}
                  </div>
                )}
                {yuklemeDurum && (
                  <div className="msj-ekler" style={{ fontSize: 12.5, color: "#4a6e0c", fontWeight: 600 }}>
                    <Spin size="small" /> Yükleniyor: {yuklemeDurum} · sayfayı kapatmayın
                  </div>
                )}
                <div className="msj-yaz-satir">
                  <input ref={dosyaGir} type="file" multiple hidden onChange={(e) => { ekEkle(e.target.files); e.target.value = ""; }} />
                  <Dropdown
                    disabled={!!duzenle}
                    trigger={["click"]}
                    menu={{
                      items: [
                        { key: "g", icon: <ImagePlus size={15} />, label: "Görsel / video", onClick: () => { if (dosyaGir.current) { dosyaGir.current.accept = "image/*,video/*"; dosyaGir.current.click(); } } },
                        { key: "d", icon: <FileText size={15} />, label: "Dosya", onClick: () => { if (dosyaGir.current) { dosyaGir.current.accept = ""; dosyaGir.current.click(); } } },
                      ],
                    }}
                  >
                    <button className="msj-ikon" title="Ekle"><Paperclip size={17} /></button>
                  </Dropdown>
                  <Input.TextArea
                    value={metin}
                    autoSize={{ minRows: 1, maxRows: 6 }}
                    placeholder={window.innerWidth > 900 ? "Mesaj yazın… (Enter gönderir, Shift+Enter alt satır)" : "Mesaj yazın…"}
                    onChange={(e) => setMetin(e.target.value)}
                    onPaste={(e) => {
                      const d = Array.from(e.clipboardData.files ?? []);
                      if (d.length) { e.preventDefault(); ekEkle(d); }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); gonder(); }
                      if (e.key === "Escape" && duzenle) { setDuzenle(null); setMetin(""); }
                      if (e.key === "ArrowUp" && !metin && !duzenle) {
                        const son = [...mesajlar].reverse().find((x) => x.ben && !x.silindi && x.tur !== "sistem");
                        if (son) { e.preventDefault(); setDuzenle(son); setMetin(son.metin ?? ""); }
                      }
                    }}
                  />
                  <button className="msj-gonder" onClick={gonder} disabled={gonderiliyor} title="Gönder">
                    {gonderiliyor ? <Spin size="small" /> : <Send size={18} />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="msj-salt">Bu duyuru grubunda yalnızca grup yöneticileri mesaj yazabilir.</div>
            )}
          </>
        )}
      </section>

      {/* ---------------------------------------------------- bilgi */}
      {sohbet && (
        <aside className={"msj-sag" + (bilgiAcik ? " acik" : "")}>
          <div className="msj-sag-ust">
            <button className="msj-ikon" onClick={() => setBilgiAcik(false)} aria-label="Kapat"><ArrowLeft size={18} /></button>
            <b>Sohbet bilgisi</b>
          </div>
          <div className="msj-kart msj-buyuk">
            <Avatar ad={sohbet.ad} kare={sohbet.tur === "grup"} boyut={68} />
            <b>{sohbet.ad}</b>
            <small>
              {sohbet.tur === "grup"
                ? sohbet.duyuru ? "Duyuru grubu · yalnızca yöneticiler yazar" : "Grup · herkes yazabilir"
                : "Özel sohbet"}
            </small>
          </div>
          <div className="msj-kart">
            <h4><Users size={13} /> {sohbet.tur === "grup" ? `ÜYELER (${uyeler.length})` : "KATILIMCILAR"}</h4>
            {uyeler.map((u) => (
              <div key={u.kod} className="msj-uye">
                <Avatar ad={u.ad} boyut={34} />
                <div>
                  <b>{u.ad}{u.kod === oturumOku()?.kullaniciAdi ? " (siz)" : ""}</b>
                  <small>{ROL[u.rol ?? ""] ?? u.rol ?? ""}</small>
                </div>
                {sohbet.tur === "grup" && u.yonetici && <span className="msj-etiket">Yönetici</span>}
                {sohbet.tur === "grup" && sohbet.benYonetici && u.kod !== oturumOku()?.kullaniciAdi && (
                  <Tooltip title="Gruptan çıkar">
                    <button className="msj-uye-cikar" onClick={() => uyeCikar(u)}><UserMinus size={14} /></button>
                  </Tooltip>
                )}
              </div>
            ))}
            {sohbet.tur === "grup" && (!sohbet.yoneticiEkler || sohbet.benYonetici) && (
              <button className="msj-link" onClick={() => setYeniAcik("ekle")}>+ Üye ekle</button>
            )}
          </div>
          <MedyaKarti mesajlar={mesajlar} />
          {sohbet.tur === "grup" && (
            <div className="msj-kart">
              <button
                className="msj-link kirmizi"
                onClick={() => {
                  const ben = uyeler.find((u) => u.kod === oturumOku()?.kullaniciAdi);
                  if (ben) uyeCikar(ben);
                }}
              >
                <LogOut size={14} /> Gruptan ayrıl
              </button>
            </div>
          )}
        </aside>
      )}

      <YeniSohbet
        acik={yeniAcik}
        sohbetId={aktif}
        mevcut={uyeler.map((u) => u.kod)}
        kapat={() => setYeniAcik(null)}
        bitti={async (id) => {
          setYeniAcik(null);
          await listeGetir();
          if (id) setAktif(id);
          else if (aktif) api.al<Uye[]>(`/api/Mesajlasma/${aktif}/Uyeler`).then((u) => setUyeler(u ?? []));
        }}
      />
    </div>
  );
}

function MedyaKarti({ mesajlar }: { mesajlar: Mesaj[] }) {
  const medya = mesajlar.filter((m) => !m.silindi && (m.tur === "gorsel" || m.tur === "video")).slice(-9).reverse();
  const dosyalar = mesajlar.filter((m) => !m.silindi && m.tur === "dosya").slice(-5).reverse();
  if (!medya.length && !dosyalar.length) return null;
  return (
    <div className="msj-kart">
      {medya.length > 0 && (
        <>
          <h4>PAYLAŞILAN MEDYA</h4>
          <div className="msj-medya">
            {medya.map((m) =>
              m.tur === "gorsel" ? (
                <a key={m.id} href={dosyaAdresi(m.id)} target="_blank" rel="noreferrer"><img src={dosyaAdresi(m.id)} alt="" loading="lazy" /></a>
              ) : (
                <a key={m.id} href={dosyaAdresi(m.id)} target="_blank" rel="noreferrer" className="video">▶</a>
              )
            )}
          </div>
        </>
      )}
      {dosyalar.length > 0 && (
        <>
          <h4 style={{ marginTop: medya.length ? 14 : 0 }}>PAYLAŞILAN DOSYALAR</h4>
          {dosyalar.map((m) => (
            <a key={m.id} className="msj-dosya kucuk" href={dosyaAdresi(m.id, true)}>
              <span className={"tur" + ((m.dosyaAd ?? "").toLowerCase().endsWith(".pdf") ? " pdf" : "")}>
                {(m.dosyaAd ?? "").split(".").pop()?.toUpperCase().slice(0, 4)}
              </span>
              <span><b>{m.dosyaAd}</b><small>{boyutYaz(m.dosyaBoyut)}</small></span>
            </a>
          ))}
        </>
      )}
    </div>
  );
}

/** Yeni grup / özel mesaj / üye ekleme penceresi */
function YeniSohbet({
  acik, sohbetId, mevcut, kapat, bitti,
}: {
  acik: null | "yeni" | "ekle"; sohbetId: number | null; mevcut: string[];
  kapat: () => void; bitti: (id?: number) => void;
}) {
  const { message } = AntdApp.useApp();
  const [tur, setTur] = useState<"grup" | "kisi">("grup");
  const [ad, setAd] = useState("");
  const [ara, setAra] = useState("");
  const [secili, setSecili] = useState<string[]>([]);
  const [duyuru, setDuyuru] = useState(false);
  const [yoneticiEkler, setYoneticiEkler] = useState(true);
  const [kullanicilar, setKullanicilar] = useState<Kullanici[]>([]);
  const [isleniyor, setIsleniyor] = useState(false);
  /* Biçen360 personeli (23.10.2026): aramayla; seçilenlerin adı kaybolmasın */
  const [personel, setPersonel] = useState<Kullanici[]>([]);
  const [bilinen, setBilinen] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = ara.trim();
    if (!acik || q.length < 2) {
      setPersonel([]);
      return;
    }
    const z = setTimeout(() => {
      api
        .al<Kullanici[]>(`/api/Mesajlasma/Kullanicilar?personel=true&q=${encodeURIComponent(q)}`)
        .then((k) => setPersonel((k ?? []).filter((x) => x.tur === "personel")))
        .catch(() => setPersonel([]));
    }, 300);
    return () => clearTimeout(z);
  }, [ara, acik]);

  useEffect(() => {
    if (!acik) return;
    setSecili([]);
    setAd("");
    setAra("");
    setTur("grup");
    setDuyuru(false);
    setYoneticiEkler(true);
    api.al<Kullanici[]>("/api/Mesajlasma/Kullanicilar").then((k) => setKullanicilar(k ?? [])).catch((h) => message.error(h.message));
  }, [acik, message]);

  const liste = [
    ...kullanicilar.filter(
      (k) =>
        (acik !== "ekle" || !mevcut.includes(k.kod)) &&
        (!ara.trim() || `${k.ad} ${ROL[k.rol] ?? k.rol} ${k.kod}`.toLocaleLowerCase("tr").includes(ara.trim().toLocaleLowerCase("tr")))
    ),
    ...personel.filter((k) => acik !== "ekle" || !mevcut.includes(k.kod)),
  ];

  const degis = (kod: string, acikMi: boolean) => {
    const k = liste.find((x) => x.kod === kod);
    if (k) setBilinen((b) => ({ ...b, [kod]: k.ad }));
    setSecili((s) => (tur === "kisi" && acik === "yeni" ? (acikMi ? [kod] : []) : acikMi ? [...s, kod] : s.filter((x) => x !== kod)));
  };

  const tamam = async () => {
    if (!secili.length) return message.warning("Kişi seçiniz.");
    setIsleniyor(true);
    try {
      if (acik === "ekle") {
        await api.gonder(`/api/Mesajlasma/${sohbetId}/Uye`, { kullanicilar: secili });
        message.success("Üyeler eklendi");
        bitti();
      } else {
        if (tur === "grup" && ad.trim().length < 2) return message.warning("Grup adını yazınız.");
        const c = await api.gonder<{ id: number }>("/api/Mesajlasma", { tur, ad, uyeler: secili, duyuru, yoneticiEkler });
        bitti(c.id);
      }
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setIsleniyor(false);
    }
  };

  return (
    <Modal
      open={!!acik}
      title={acik === "ekle" ? "Gruba üye ekle" : "Yeni sohbet"}
      onCancel={kapat}
      onOk={tamam}
      confirmLoading={isleniyor}
      okText={acik === "ekle" ? "Ekle" : tur === "grup" ? "Grubu oluştur" : "Mesaj başlat"}
      cancelText="Vazgeç"
      width={560}
      destroyOnClose
    >
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {acik === "yeni" && (
          <Segmented
            block
            value={tur}
            onChange={(v) => { setTur(v as any); setSecili((s) => (v === "kisi" ? s.slice(0, 1) : s)); }}
            options={[{ label: "Grup kur", value: "grup" }, { label: "Özel mesaj", value: "kisi" }]}
          />
        )}
        {acik === "yeni" && tur === "grup" && (
          <Input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Grup adı · ör. Bölge Müdürleri, İK Ekibi" maxLength={120} />
        )}
        <div className="msj-secili">
          {secili.length === 0 ? (
            <span style={{ color: "#9aa3af", fontSize: 12.5 }}>Aşağıdan kişi seçin</span>
          ) : (
            secili.map((s) => (
              <span key={s} className="msj-cip">
                {kullanicilar.find((k) => k.kod === s)?.ad ?? bilinen[s] ?? s}
                <button onClick={() => degis(s, false)}>×</button>
              </span>
            ))
          )}
        </div>
        <Input prefix={<Search size={14} />} placeholder="Ad, rol, kullanıcı adı · personel için ad, sicil ya da şube" value={ara} onChange={(e) => setAra(e.target.value)} allowClear />
        <div className="msj-adaylar">
          {liste.length === 0 && <div style={{ color: "#9aa3af", padding: 10 }}>Kişi bulunamadı</div>}
          {liste.map((k) => (
            <label key={k.kod} className="msj-aday">
              <Avatar ad={k.ad} boyut={32} />
              <div><b>{k.ad}</b><small>{k.tur === "personel" ? `Biçen360 · ${[k.rol, k.sube].filter(Boolean).join(" · ")}` : ROL[k.rol] ?? k.rol}</small></div>
              <Checkbox checked={secili.includes(k.kod)} onChange={(e) => degis(k.kod, e.target.checked)} />
            </label>
          ))}
        </div>
        {acik === "yeni" && tur === "grup" && (
          <div style={{ display: "grid", gap: 6 }}>
            <Checkbox checked={yoneticiEkler} onChange={(e) => setYoneticiEkler(e.target.checked)}>Yalnızca grup yöneticileri üye ekleyebilsin</Checkbox>
            <Checkbox checked={duyuru} onChange={(e) => setDuyuru(e.target.checked)}>Duyuru grubu: yalnızca yöneticiler mesaj yazabilsin</Checkbox>
          </div>
        )}
        <div style={{ fontSize: 12, color: "#9aa3af" }}>
          Biçen360 personeli için en az iki harf yazın (ad, sicil ya da şube). Personel mesajları uygulamada görür; Mesajlar modülü portaldan açık olmalıdır.
        </div>
      </div>
    </Modal>
  );
}
