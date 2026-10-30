/**
 * ---------------------------------------------------------------------------
 * Biçen'den Haberler — panel yönetimi (08.10.2026)
 * ---------------------------------------------------------------------------
 * Biçen360'taki (1.7) şirket içi akışın yönetimi. Panelden üç tür paylaşım:
 *   • Gönderi: fotoğraf(lar), açıklama, kategori.
 *   • Kasada bu hafta: dönem, ürünler (eski fiyat üstü çizili, kampanya
 *     fiyatı), kasiyerin müşteriye söyleyeceği cümle. Fotoğraf isteğe bağlı.
 *   • Anket: soru, 2–6 seçenek, bitiş tarihi. Personel oy verince yüzdeleri
 *     görür; kim ne verdi kimseye gösterilmez, panel şube kırılımını görür.
 * Her paylaşım hedef şubelerle sınırlanabilir (boşsa herkese). Önce taslak
 * açılıyor, fotoğraflar yükleniyor, sonra yayınlanıyor: yükleme yarıda
 * kalırsa akışa yarım gönderi düşmüyor.
 *
 * Gönderiler sekmesinde sabitle, gizle, yorum aç/kapat, düzenle, sil ve
 * yorum denetimi; Paylaşım yetkisi sekmesinde Biçen360'tan gönderi
 * paylaşabilecek kişiler; Ayarlar'da kategoriler ve yasaklı kelimeler.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import {
  BarChart3,
  Eye,
  EyeOff,
  Heart,
  ImagePlus,
  MessageCircle,
  MessageCircleOff,
  Pencil,
  Pin,
  Plus,
  Send,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import dayjs, { Dayjs } from "dayjs";

import { api, API_TABAN } from "./api";

/* ------------------------------------------------------------------ türler */

type Tur = "gonderi" | "kampanya" | "anket";

interface Urun {
  ad: string;
  birim?: string | null;
  eski?: number | null;
  yeni: number;
  eskiYazi?: string | null;
  yeniYazi?: string;
}

interface Kampanya {
  baslik: string;
  donem?: string | null;
  soyle?: string | null;
  urunler: Urun[];
}

interface Anket {
  soru: string;
  bitis?: string | null;
  bitti: boolean;
  toplam: number;
  secenekler: { ad: string; oy: number | null; yuzde: number | null }[];
}

interface Gonderi {
  id: number;
  tur: Tur;
  yazar: { ad: string; unvan?: string | null; kurum?: boolean };
  kategori: string | null;
  metin: string | null;
  gorseller: string[];
  /** Biçen360'tan paylaşılan video (12.10.2026); göreli adres */
  video?: string | null;
  begeni: number;
  yorumSayisi: number;
  gizliYorum: number;
  yorumAcik: boolean;
  sabit: boolean;
  gizli: boolean;
  durum: "taslak" | "yayin";
  hedef: string[];
  tarih: string;
  kampanya?: Kampanya | null;
  anket?: Anket | null;
}

interface Yorum {
  id: number;
  ad: string;
  unvan?: string | null;
  metin: string;
  tarih: string;
  gizli: boolean;
}

interface Yetkili {
  sicil: string;
  ad: string;
  unvan: string | null;
  sube: string | null;
  kurumAdina: boolean;
  gonderi: number;
  sonGonderi: string | null;
}

interface Ayar {
  kategoriler: string[];
  yasakliKelimeler: string[];
  bildirim: boolean;
  kurumAdi: string;
  /** Kurum profilinde adın altındaki tanıtım (09.10.2026) */
  kurumAciklama?: string | null;
  /** Logo yüklüyse sürüm; adres /api/Haber/Logo?v=… */
  logoSurum?: string | null;
}

const logoAdresi = (a?: Ayar | null) => (a?.logoSurum ? `${API_TABAN}/api/Haber/Logo?v=${a.logoSurum}` : null);

interface Veri {
  gonderiler: Gonderi[];
  yetkililer: Yetkili[];
  ayar: Ayar;
  subeler: { ad: string; kisi: number }[];
}

interface AnketSonucu {
  soru: string;
  secenekler: string[];
  subeler: { sube: string; toplam: number; oylar: number[] }[];
}

/* ------------------------------------------------------------- yardımcılar */

const TUR_ADI: Record<Tur, string> = { gonderi: "Gönderi", kampanya: "Kasada bu hafta", anket: "Anket" };
const TUR_RENGI: Record<Tur, string> = { gonderi: "green", kampanya: "blue", anket: "purple" };

const tamAdres = (g: string) => (g.startsWith("/") ? `${API_TABAN}${g}` : g);

/** Görsel adresindeki kimlik: /api/Haber/Gorsel/{id}?k=… */
const gorselKimligi = (g: string) => Number(/\/Gorsel\/(\d+)/.exec(g)?.[1] ?? 0);

const goreceZaman = (v: string) => {
  const dk = dayjs().diff(dayjs(v), "minute");
  if (dk < 60) return `${Math.max(1, dk)} dk önce`;
  if (dk < 1440) return `${Math.floor(dk / 60)} sa önce`;
  if (dk < 10080) return `${Math.floor(dk / 1440)} gün önce`;
  return dayjs(v).format("DD.MM.YYYY");
};

const tl = (n?: number | null) =>
  n == null ? "" : `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "6–12 Ekim" biçiminde bu haftanın (pazartesi–pazar) yazısı */
const AY = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const haftaYazisi = (kac = 0) => {
  const bugun = dayjs().add(kac, "week");
  const pzt = bugun.subtract((bugun.day() + 6) % 7, "day");
  const paz = pzt.add(6, "day");
  return pzt.month() === paz.month()
    ? `${pzt.date()}–${paz.date()} ${AY[paz.month()]}`
    : `${pzt.date()} ${AY[pzt.month()]} – ${paz.date()} ${AY[paz.month()]}`;
};

const Kutu = ({ ad, deger, alt }: { ad: string; deger: number | string; alt?: string }) => (
  <div className="hy-kutu">
    <div className="hy-kutu-ad">{ad}</div>
    <div className="hy-kutu-deger">{deger}</div>
    {alt && <div className="hy-kutu-alt">{alt}</div>}
  </div>
);

/* ------------------------------------------- akıştaki kartın küçük hâli */

function KampanyaOnizleme({ k }: { k: Kampanya }) {
  return (
    <div className="hy-kampanya">
      <div className="hy-kampanya-bas">
        <b>🏷️ {k.baslik || "Kasada bu hafta"}</b>
        {k.donem && <span>{k.donem}</span>}
      </div>
      {k.urunler.map((u, i) => {
        const indirim = u.eski && u.yeni ? Math.round((100 * (u.eski - u.yeni)) / u.eski) : 0;
        return (
          <div key={i} className="hy-urun">
            <div className="hy-urun-ad">
              {u.ad || <i className="hy-soluk">Ürün adı</i>}
              {u.birim && <small>{u.birim}</small>}
            </div>
            <div className="hy-fiyat">
              {u.eski ? <s>{tl(u.eski)}</s> : null}
              <b>{u.yeni ? tl(u.yeni) : "₺—"}</b>
            </div>
            {indirim > 0 ? <span className="hy-indirim">%{indirim}</span> : <span style={{ width: 40 }} />}
          </div>
        );
      })}
      {k.soyle && (
        <div className="hy-soyle">
          <small>💬 MÜŞTERİYE SÖYLE</small>
          {k.soyle}
        </div>
      )}
    </div>
  );
}

function AnketOnizleme({ a, sonuc = true }: { a: Pick<Anket, "soru" | "secenekler"> & Partial<Anket>; sonuc?: boolean }) {
  return (
    <div className="hy-anket">
      <b className="hy-anket-soru">📊 {a.soru || <i className="hy-soluk">Soru</i>}</b>
      {a.secenekler.map((x, i) => (
        <div key={i} className="hy-secenek">
          {sonuc && <i style={{ width: `${x.yuzde ?? 0}%` }} />}
          <span>{x.ad || <i className="hy-soluk">Seçenek {i + 1}</i>}</span>
          {sonuc && <span>%{x.yuzde ?? 0}</span>}
        </div>
      ))}
      {sonuc && (
        <small className="hy-soluk">
          {(a.toplam ?? 0).toLocaleString("tr-TR")} oy
          {a.bitti ? " · sona erdi" : a.bitis ? ` · ${dayjs(a.bitis).format("DD.MM.YYYY")} tarihinde kapanır` : ""}
        </small>
      )}
    </div>
  );
}

/* -------------------------------------------------------- yönetim kartı */

function GonderiKarti({
  g,
  islem,
  yorumlar,
  duzenle,
  anketSonucu,
}: {
  g: Gonderi;
  islem: (g: Gonderi, i: "Sabitle" | "Gizle" | "YorumAc" | "Sil" | "Yayinla") => void;
  yorumlar: (g: Gonderi) => void;
  duzenle: (g: Gonderi) => void;
  anketSonucu: (g: Gonderi) => void;
}) {
  const kapak = g.gorseller[0];

  return (
    <div className={`hy-kart${g.gizli ? " hy-gizli" : ""}${g.durum === "taslak" ? " hy-taslak" : ""}`}>
      {kapak ? (
        <div className="hy-gorsel">
          <img src={tamAdres(kapak)} alt="" loading="lazy" />
          {g.gorseller.length > 1 && <span className="hy-adet">1/{g.gorseller.length}</span>}
        </div>
      ) : g.tur === "kampanya" && g.kampanya ? (
        <div className="hy-ozel">
          <KampanyaOnizleme k={{ ...g.kampanya, urunler: g.kampanya.urunler.slice(0, 3) }} />
          {g.kampanya.urunler.length > 3 && <div className="hy-soluk hy-fazla">+{g.kampanya.urunler.length - 3} ürün</div>}
        </div>
      ) : g.tur === "anket" && g.anket ? (
        <div className="hy-ozel">
          <AnketOnizleme a={g.anket} />
        </div>
      ) : g.video ? (
        <div className="hy-gorsel" style={{ background: "#111" }}>
          <video src={tamAdres(g.video)} muted controls preload="metadata" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
        </div>
      ) : (
        <div className="hy-gorsel hy-bos">Fotoğraf yok</div>
      )}

      <div className="hy-rozetler">
        {g.sabit && (
          <span className="hy-rozet hy-r-sabit">
            <Pin size={11} /> Sabit
          </span>
        )}
        {g.durum === "taslak" && <span className="hy-rozet hy-r-taslak">Taslak</span>}
        {g.gizli && <span className="hy-rozet hy-r-gizli">Gizli</span>}
      </div>

      <div className="hy-ic">
        <div className="hy-yazar">
          <b>{g.yazar.ad}</b>
          {g.yazar.kurum && <span className="hy-onay">✓</span>}
          <span className="hy-soluk"> · {goreceZaman(g.tarih)}</span>
        </div>
        <div className="hy-etiketler">
          <Tag color={TUR_RENGI[g.tur]} bordered={false}>
            {g.tur === "gonderi" ? g.kategori ?? "Gönderi" : TUR_ADI[g.tur]}
          </Tag>
          <Tooltip title={g.hedef.length ? g.hedef.join(", ") : undefined}>
            <Tag bordered={false}>{g.hedef.length ? `${g.hedef.length} şube` : "Tüm şubeler"}</Tag>
          </Tooltip>
        </div>
        {g.metin && <div className="hy-metin">{g.metin}</div>}
        <div className="hy-say">
          <span>
            <Heart size={14} fill="#ed4956" color="#ed4956" /> {g.begeni.toLocaleString("tr-TR")}
          </span>
          <span style={{ cursor: "pointer" }} onClick={() => yorumlar(g)}>
            <MessageCircle size={14} /> {g.yorumAcik ? g.yorumSayisi : "kapalı"}
            {g.gizliYorum > 0 && (
              <Tag color="orange" style={{ marginLeft: 6 }}>
                {g.gizliYorum} gizli
              </Tag>
            )}
          </span>
          {g.tur === "anket" && g.anket && (
            <span style={{ cursor: "pointer" }} onClick={() => anketSonucu(g)}>
              <BarChart3 size={14} /> {g.anket.toplam.toLocaleString("tr-TR")} oy
            </span>
          )}
        </div>
        <div className="hy-dugmeler">
          {g.durum === "taslak" ? (
            <Button size="small" type="primary" icon={<Send size={13} />} onClick={() => islem(g, "Yayinla")}>
              Yayınla
            </Button>
          ) : (
            <Tooltip title={g.sabit ? "Sabitlemeyi kaldır" : "Akışın başına sabitle"}>
              <Button size="small" type={g.sabit ? "primary" : "default"} icon={<Pin size={13} />} onClick={() => islem(g, "Sabitle")} />
            </Tooltip>
          )}
          <Tooltip title="Düzenle">
            <Button size="small" icon={<Pencil size={13} />} onClick={() => duzenle(g)} />
          </Tooltip>
          <Tooltip title={g.gizli ? "Akışta yeniden göster" : "Akıştan gizle"}>
            <Button size="small" icon={g.gizli ? <Eye size={13} /> : <EyeOff size={13} />} onClick={() => islem(g, "Gizle")} />
          </Tooltip>
          <Tooltip title={g.yorumAcik ? "Yorumları kapat" : "Yorumları aç"}>
            <Button size="small" icon={g.yorumAcik ? <MessageCircleOff size={13} /> : <MessageCircle size={13} />} onClick={() => islem(g, "YorumAc")} />
          </Tooltip>
          {g.tur === "anket" && (
            <Tooltip title="Şube kırılımı">
              <Button size="small" icon={<BarChart3 size={13} />} onClick={() => anketSonucu(g)} />
            </Tooltip>
          )}
          <span style={{ flex: 1 }} />
          <Popconfirm
            title="Paylaşım silinsin mi?"
            description="Akıştan kalkar; beğeni, yorum ve oylar görünmez."
            okText="Sil"
            cancelText="Vazgeç"
            onConfirm={() => islem(g, "Sil")}
          >
            <Button size="small" danger type="text" icon={<Trash2 size={13} />} />
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- paylaşım penceresi */

interface Taslak {
  id?: number;
  durum?: "taslak" | "yayin";
  tur: Tur;
  yazarAd: string;
  metin: string;
  kategori: string | null;
  hedef: string[];
  yorumAcik: boolean;
  sabit: boolean;
  bildirim: boolean;
  /** Sunucudaki görseller (düzenlemede) */
  mevcut: string[];
  /** Biçen360'tan paylaşılan video varsa fotoğraf zorunlu değil */
  video?: string | null;
  /** Panelden eklenen video (28.10.2026); kaydedince parçalarla yüklenir */
  yeniVideo?: { dosya: File; adres: string } | null;
  videoSil?: boolean;
  silinen: string[];
  yeni: { dosya: File; adres: string }[];
  kampanya: { baslik: string; donem: string; soyle: string; urunler: { ad: string; birim: string | null; eski: number | null; yeni: number | null }[] };
  anket: { soru: string; secenekler: string[]; bitis: Dayjs | null };
}

const bosTaslak = (tur: Tur, ayar: Ayar): Taslak => ({
  tur,
  yazarAd: ayar.kurumAdi,
  metin: "",
  kategori: ayar.kategoriler[0] ?? null,
  hedef: [],
  /* Kampanya kartı bilgi amaçlı: yorum kalabalığı istenmiyor */
  yorumAcik: tur !== "kampanya",
  sabit: false,
  bildirim: ayar.bildirim,
  mevcut: [],
  silinen: [],
  yeni: [],
  kampanya: { baslik: "Kasada bu hafta", donem: haftaYazisi(), soyle: "", urunler: [{ ad: "", birim: null, eski: null, yeni: null }] },
  anket: { soru: "", secenekler: ["", ""], bitis: dayjs().add(7, "day") },
});

const taslakDuzenle = (g: Gonderi, ayar: Ayar): Taslak => ({
  ...bosTaslak(g.tur, ayar),
  id: g.id,
  durum: g.durum,
  yazarAd: g.yazar.ad,
  metin: g.metin ?? "",
  kategori: g.kategori,
  hedef: g.hedef,
  yorumAcik: g.yorumAcik,
  sabit: g.sabit,
  bildirim: false,
  mevcut: g.gorseller,
  video: g.video ?? null,
  kampanya: g.kampanya
    ? {
        baslik: g.kampanya.baslik,
        donem: g.kampanya.donem ?? "",
        soyle: g.kampanya.soyle ?? "",
        urunler: g.kampanya.urunler.map((u) => ({ ad: u.ad, birim: u.birim ?? null, eski: u.eski ?? null, yeni: u.yeni })),
      }
    : bosTaslak("kampanya", ayar).kampanya,
  anket: g.anket
    ? { soru: g.anket.soru, secenekler: g.anket.secenekler.map((s) => s.ad), bitis: g.anket.bitis ? dayjs(g.anket.bitis) : null }
    : bosTaslak("anket", ayar).anket,
});

const BIRIMLER = ["kg", "adet", "lt", "paket", "koli", "100 g"];

function PaylasimPenceresi({
  taslak,
  setTaslak,
  veri,
  kaydedildi,
}: {
  taslak: Taslak | null;
  setTaslak: (t: Taslak | null) => void;
  veri: Veri;
  kaydedildi: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [mesgul, setMesgul] = useState<"" | "taslak" | "yayin">("");
  const [videoYuzde, setVideoYuzde] = useState<number | null>(null);

  if (!taslak) return <Drawer open={false} />;

  const t = taslak;
  const yeniKayit = !t.id;
  const degistir = (y: Partial<Taslak>) => setTaslak({ ...t, ...y });
  const kampanya = (y: Partial<Taslak["kampanya"]>) => degistir({ kampanya: { ...t.kampanya, ...y } });
  const anket = (y: Partial<Taslak["anket"]>) => degistir({ anket: { ...t.anket, ...y } });
  const urun = (i: number, y: Partial<Taslak["kampanya"]["urunler"][number]>) =>
    kampanya({ urunler: t.kampanya.urunler.map((u, j) => (j === i ? { ...u, ...y } : u)) });

  const gorselSayisi = t.mevcut.length - t.silinen.length + t.yeni.length;
  const videoVar = !!t.yeniVideo || (!!t.video && !t.videoSil);
  const videoAdresi = t.yeniVideo ? t.yeniVideo.adres : t.video && !t.videoSil ? tamAdres(t.video) : null;

  /* İstemci denetimi: sunucu da aynısını yapıyor, burada boşuna gidip gelmesin */
  const eksik = (): string | null => {
    if (t.tur === "gonderi" && gorselSayisi === 0 && !videoVar) return "Gönderide en az bir fotoğraf ya da video olmalı.";
    if (t.tur === "kampanya") {
      const l = t.kampanya.urunler.filter((u) => u.ad.trim());
      if (l.length === 0) return "En az bir ürün ekleyiniz.";
      if (l.some((u) => !u.yeni || u.yeni <= 0)) return "Her ürünün kampanya fiyatını yazınız.";
      if (l.some((u) => u.eski && u.yeni && u.eski <= u.yeni)) return "Eski fiyat kampanya fiyatından büyük olmalı (ya da boş bırakılmalı).";
    }
    if (t.tur === "anket") {
      if (!t.anket.soru.trim()) return "Anket sorusunu yazınız.";
      const l = t.anket.secenekler.map((x) => x.trim()).filter(Boolean);
      if (l.length < 2) return "En az iki seçenek yazınız.";
      if (new Set(l.map((x) => x.toLocaleLowerCase("tr"))).size !== l.length) return "Seçenekler birbirinden farklı olmalı.";
    }
    return null;
  };

  const kaydet = async (yayinla: boolean) => {
    const h = eksik();
    if (h) {
      message.warning(h);
      return;
    }

    setMesgul(yayinla ? "yayin" : "taslak");
    try {
      const govde = {
        tur: t.tur,
        metin: t.metin.trim(),
        kategori: t.kategori,
        hedef: t.hedef,
        yorumAcik: t.yorumAcik,
        sabit: t.sabit,
        yazarAd: t.yazarAd.trim(),
        kampanya:
          t.tur === "kampanya"
            ? { ...t.kampanya, urunler: t.kampanya.urunler.filter((u) => u.ad.trim()).map((u) => ({ ...u, yeni: u.yeni ?? 0 })) }
            : null,
        anket:
          t.tur === "anket"
            ? { soru: t.anket.soru, secenekler: t.anket.secenekler.filter((x) => x.trim()), bitis: t.anket.bitis?.format("YYYY-MM-DD") ?? null }
            : null,
      };

      let id = t.id;
      if (!id) {
        id = (await api.gonder<{ id: number }>("/api/Haber/Panel/Gonderi", govde)).id;
        /* Fotoğraf yüklemesi yarıda kalırsa ikinci denemede yeni kayıt açılmasın */
        setTaslak({ ...t, id, durum: "taslak" });
      } else {
        await api.gonder(`/api/Haber/Panel/${id}/Duzenle`, govde);
        const eski = veri.gonderiler.find((x) => x.id === id);
        if (eski && eski.sabit !== t.sabit) await api.gonder(`/api/Haber/Panel/${id}/Sabitle`, {});
      }

      for (const g of t.silinen) {
        const gid = gorselKimligi(g);
        if (gid) await api.gonder(`/api/Haber/Panel/Gorsel/${gid}/Sil`, {});
      }

      for (const y of t.yeni) {
        const f = new FormData();
        f.append("dosya", y.dosya, y.dosya.name || "gorsel.jpg");
        await api.dosyaGonder(`/api/Haber/Panel/${id}/Gorsel`, f);
      }

      /* Video (28.10.2026): 8 MB'lık parçalarla; geçici hatada parça iki kez daha denenir */
      if (t.videoSil && t.video && !t.yeniVideo) await api.gonder(`/api/Haber/Panel/${id}/VideoSil`, {});
      if (t.yeniVideo) {
        const dosya = t.yeniVideo.dosya;
        const PARCA = 8 * 1024 * 1024;
        const toplam = Math.ceil(dosya.size / PARCA);
        let anahtar = "";
        setVideoYuzde(0);
        for (let sira = 0; sira < toplam; sira++) {
          const form = new FormData();
          form.append("anahtar", anahtar);
          form.append("sira", String(sira));
          form.append("toplam", String(toplam));
          form.append("dosyaAdi", dosya.name);
          form.append("boyut", String(dosya.size));
          form.append("parcaBoyut", String(PARCA));
          form.append("parca", dosya.slice(sira * PARCA, Math.min(dosya.size, (sira + 1) * PARCA)), dosya.name);
          let c: { anahtar: string } | null = null;
          for (let deneme = 0; ; deneme++) {
            try {
              c = await api.dosyaGonder<{ anahtar: string }>(`/api/Haber/Panel/${id}/VideoParca`, form);
              break;
            } catch (h) {
              if (deneme >= 2) throw h;
              await new Promise((x) => setTimeout(x, 1500));
            }
          }
          anahtar = c!.anahtar;
          setVideoYuzde(Math.round(((sira + 1) / toplam) * 100));
        }
        setTaslak({ ...t, id, durum: t.durum ?? "taslak", yeniVideo: null, videoSil: false, video: `/api/DuyuruVideo/Dosya/${anahtar}` });
      }

      if (yayinla && t.durum !== "yayin") await api.gonder(`/api/Haber/Panel/${id}/Yayinla`, { bildirim: t.bildirim });

      message.success(yayinla && t.durum !== "yayin" ? "Yayınlandı." : "Kaydedildi.");
      setTaslak(null);
      kaydedildi();
    } catch (e: any) {
      message.error(e?.message ?? "Kaydedilemedi.");
      kaydedildi();
    } finally {
      setMesgul("");
      setVideoYuzde(null);
    }
  };

  const oyVar = t.tur === "anket" && (veri.gonderiler.find((x) => x.id === t.id)?.anket?.toplam ?? 0) > 0;

  /* Ön izleme kartı: telefonda nasıl görüneceği */
  const onizlemeGorsel = [...t.mevcut.filter((g) => !t.silinen.includes(g)).map(tamAdres), ...t.yeni.map((y) => y.adres)][0];

  return (
    <Drawer
      open
      width="min(1040px, 100vw)"
      title={yeniKayit ? "Yeni paylaşım" : `Düzenle · ${TUR_ADI[t.tur]}`}
      onClose={() => setTaslak(null)}
      destroyOnHidden
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button onClick={() => setTaslak(null)}>Vazgeç</Button>
          {t.durum !== "yayin" && (
            <Button loading={mesgul === "taslak"} disabled={!!mesgul} onClick={() => kaydet(false)}>
              Taslak olarak kaydet
            </Button>
          )}
          <Button type="primary" icon={<Send size={14} />} loading={mesgul === "yayin"} disabled={!!mesgul} onClick={() => kaydet(true)}>
            {t.durum === "yayin" ? "Kaydet" : "Yayınla"}
          </Button>
        </div>
      }
    >
      <div className="hy-duzen">
        <div className="hy-form">
          {yeniKayit && (
            <Segmented
              block
              value={t.tur}
              onChange={(v) => degistir({ tur: v as Tur, yorumAcik: v !== "kampanya" })}
              options={[
                { value: "gonderi", label: "📷 Gönderi" },
                { value: "kampanya", label: "🏷️ Kasada bu hafta" },
                { value: "anket", label: "📊 Anket" },
              ]}
            />
          )}

          {t.tur === "kampanya" && (
            <>
              <div className="hy-alan-iki">
                <label>
                  <span>Başlık</span>
                  <Input value={t.kampanya.baslik} maxLength={80} onChange={(e) => kampanya({ baslik: e.target.value })} />
                </label>
                <label>
                  <span>Dönem</span>
                  <Input
                    value={t.kampanya.donem}
                    maxLength={60}
                    placeholder="ör. 6–12 Ekim"
                    onChange={(e) => kampanya({ donem: e.target.value })}
                    suffix={
                      <Space size={4}>
                        <a onClick={() => kampanya({ donem: haftaYazisi() })}>bu hafta</a>
                        <span className="hy-soluk">·</span>
                        <a onClick={() => kampanya({ donem: haftaYazisi(1) })}>gelecek</a>
                      </Space>
                    }
                  />
                </label>
              </div>

              <div>
                <div className="hy-baslik-satir">
                  <span>Ürünler</span>
                  <small className="hy-soluk">Eski fiyat boş kalabilir; yazılırsa üstü çizili ve indirim yüzdesiyle görünür.</small>
                </div>
                <div className="hy-urunler">
                  <div className="hy-urun-satir hy-urun-baslik">
                    <span>Ürün</span>
                    <span>Birim</span>
                    <span>Eski fiyat</span>
                    <span>Kampanya fiyatı</span>
                    <span />
                  </div>
                  {t.kampanya.urunler.map((u, i) => (
                    <div key={i} className="hy-urun-satir">
                      <Input placeholder="ör. Yerli mandalina" value={u.ad} maxLength={80} onChange={(e) => urun(i, { ad: e.target.value })} />
                      <Select
                        allowClear
                        placeholder="—"
                        value={u.birim ?? undefined}
                        onChange={(v) => urun(i, { birim: v ?? null })}
                        options={BIRIMLER.map((b) => ({ value: b, label: b }))}
                      />
                      <InputNumber
                        min={0}
                        step={0.5}
                        precision={2}
                        decimalSeparator=","
                        prefix="₺"
                        style={{ width: "100%" }}
                        value={u.eski}
                        onChange={(v) => urun(i, { eski: v ?? null })}
                      />
                      <InputNumber
                        min={0}
                        step={0.5}
                        precision={2}
                        decimalSeparator=","
                        prefix="₺"
                        style={{ width: "100%" }}
                        status={u.ad.trim() && !u.yeni ? "warning" : undefined}
                        value={u.yeni}
                        onChange={(v) => urun(i, { yeni: v ?? null })}
                      />
                      <Button
                        type="text"
                        icon={<X size={14} />}
                        disabled={t.kampanya.urunler.length === 1}
                        onClick={() => kampanya({ urunler: t.kampanya.urunler.filter((_, j) => j !== i) })}
                      />
                    </div>
                  ))}
                </div>
                <Button
                  type="dashed"
                  block
                  icon={<Plus size={14} />}
                  disabled={t.kampanya.urunler.length >= 20}
                  onClick={() => kampanya({ urunler: [...t.kampanya.urunler, { ad: "", birim: null, eski: null, yeni: null }] })}
                  style={{ marginTop: 8 }}
                >
                  Ürün ekle
                </Button>
              </div>

              <label>
                <span>Müşteriye söyle</span>
                <Input.TextArea
                  rows={2}
                  maxLength={300}
                  showCount
                  placeholder="Kasiyerin müşteriye söyleyeceği tek cümle. ör. Biçen Kart'la mandalinada kilo başı 5 TL daha az ödüyorsunuz."
                  value={t.kampanya.soyle}
                  onChange={(e) => kampanya({ soyle: e.target.value })}
                />
              </label>
            </>
          )}

          {t.tur === "anket" && (
            <>
              <label>
                <span>Soru</span>
                <Input
                  value={t.anket.soru}
                  maxLength={200}
                  placeholder="ör. Yılbaşı etkinliği nerede olsun?"
                  onChange={(e) => anket({ soru: e.target.value })}
                />
              </label>
              <div>
                <div className="hy-baslik-satir">
                  <span>Seçenekler</span>
                  <small className="hy-soluk">
                    {oyVar ? "Oy kullanıldığı için seçenekler değiştirilemez." : "En az 2, en fazla 6. Personel tek seçim yapar."}
                  </small>
                </div>
                <Space direction="vertical" style={{ width: "100%" }}>
                  {t.anket.secenekler.map((x, i) => (
                    <Input
                      key={i}
                      value={x}
                      maxLength={100}
                      disabled={oyVar}
                      placeholder={`Seçenek ${i + 1}`}
                      onChange={(e) => anket({ secenekler: t.anket.secenekler.map((y, j) => (j === i ? e.target.value : y)) })}
                      suffix={
                        t.anket.secenekler.length > 2 && !oyVar ? (
                          <X size={14} style={{ cursor: "pointer" }} onClick={() => anket({ secenekler: t.anket.secenekler.filter((_, j) => j !== i) })} />
                        ) : (
                          <span />
                        )
                      }
                    />
                  ))}
                </Space>
                {!oyVar && t.anket.secenekler.length < 6 && (
                  <Button type="dashed" block icon={<Plus size={14} />} onClick={() => anket({ secenekler: [...t.anket.secenekler, ""] })} style={{ marginTop: 8 }}>
                    Seçenek ekle
                  </Button>
                )}
              </div>
              <label>
                <span>Bitiş tarihi</span>
                <DatePicker
                  format="DD.MM.YYYY"
                  value={t.anket.bitis}
                  allowClear
                  placeholder="Süresiz"
                  disabledDate={(d) => d.isBefore(dayjs(), "day")}
                  onChange={(v) => anket({ bitis: v })}
                  style={{ width: 200 }}
                />
                <small className="hy-soluk">Bu günün sonunda oylama kapanır ve sonuç herkese açılır.</small>
              </label>
            </>
          )}

          <div>
            <div className="hy-baslik-satir">
              <span>Fotoğraflar{t.tur !== "gonderi" ? " (isteğe bağlı)" : ""}</span>
              <small className="hy-soluk">{gorselSayisi}/10 · JPG, PNG, WebP · en fazla 10 MB</small>
            </div>
            <div className="hy-gorseller">
              {t.mevcut
                .filter((g) => !t.silinen.includes(g))
                .map((g) => (
                  <div key={g} className="hy-kucuk">
                    <img src={tamAdres(g)} alt="" />
                    <button type="button" onClick={() => degistir({ silinen: [...t.silinen, g] })} aria-label="Kaldır">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              {t.yeni.map((y, i) => (
                <div key={y.adres} className="hy-kucuk">
                  <img src={y.adres} alt="" />
                  <button type="button" onClick={() => degistir({ yeni: t.yeni.filter((_, j) => j !== i) })} aria-label="Kaldır">
                    <X size={12} />
                  </button>
                </div>
              ))}
              {gorselSayisi < 10 && (
                <Upload
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  showUploadList={false}
                  beforeUpload={(dosya, liste) => {
                    /* Toplu seçimde bir kez ekle */
                    if (dosya === liste[0]) {
                      const l = liste.slice(0, 10 - gorselSayisi).map((d) => ({ dosya: d as File, adres: URL.createObjectURL(d) }));
                      setTaslak({ ...t, yeni: [...t.yeni, ...l] });
                    }
                    return false;
                  }}
                >
                  <div className="hy-kucuk hy-ekle">
                    <ImagePlus size={20} />
                    <span>Ekle</span>
                  </div>
                </Upload>
              )}
            </div>
          </div>

          {t.tur === "gonderi" && (
            <div>
              <div className="hy-baslik-satir">
                <span>Video (isteğe bağlı)</span>
                <small className="hy-soluk">
                  {videoYuzde !== null ? `Yükleniyor %${videoYuzde}` : "MP4 önerilir · en fazla 300 MB · fotoğraf yerine de kullanılabilir"}
                </small>
              </div>
              {videoAdresi ? (
                <div style={{ position: "relative", maxWidth: 320 }}>
                  <video src={videoAdresi} controls preload="metadata" style={{ width: "100%", borderRadius: 10, background: "#000", display: "block" }} />
                  <Button
                    size="small"
                    danger
                    icon={<X size={12} />}
                    style={{ marginTop: 6 }}
                    disabled={!!mesgul}
                    onClick={() => degistir({ yeniVideo: null, videoSil: !!t.video })}
                  >
                    Videoyu kaldır
                  </Button>
                </div>
              ) : (
                <Upload
                  accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm"
                  showUploadList={false}
                  beforeUpload={(dosya) => {
                    const uz = (dosya.name.split(".").pop() ?? "").toLowerCase();
                    if (!["mp4", "m4v", "mov", "webm"].includes(uz)) {
                      message.error("Yalnızca MP4, M4V, MOV ya da WEBM video eklenebilir.");
                    } else if (dosya.size > 300 * 1024 * 1024) {
                      message.error("Video en fazla 300 MB olabilir.");
                    } else {
                      degistir({ yeniVideo: { dosya: dosya as File, adres: URL.createObjectURL(dosya) }, videoSil: false });
                    }
                    return false;
                  }}
                >
                  <div className="hy-kucuk hy-ekle">
                    <ImagePlus size={20} />
                    <span>Video ekle</span>
                  </div>
                </Upload>
              )}
            </div>
          )}

          <label>
            <span>{t.tur === "gonderi" ? "Açıklama" : "Kısa not (isteğe bağlı)"}</span>
            <Input.TextArea
              rows={t.tur === "gonderi" ? 4 : 2}
              maxLength={2200}
              showCount
              value={t.metin}
              placeholder={t.tur === "gonderi" ? "Açıklama yazın…" : "Kartın altında görünür"}
              onChange={(e) => degistir({ metin: e.target.value })}
            />
          </label>

          <div className="hy-alan-iki">
            {t.tur === "gonderi" && (
              <label>
                <span>Kategori</span>
                <Select value={t.kategori} onChange={(v) => degistir({ kategori: v })} options={veri.ayar.kategoriler.map((k) => ({ value: k, label: k }))} />
              </label>
            )}
            <label>
              <span>Paylaşan adı</span>
              <Input
                value={t.yazarAd}
                disabled={!yeniKayit}
                maxLength={150}
                placeholder={veri.ayar.kurumAdi}
                onChange={(e) => degistir({ yazarAd: e.target.value })}
              />
              <small className="hy-soluk">Onaylı rozetle görünür. ör. İnsan Kaynakları, Satış ve Pazarlama</small>
            </label>
          </div>

          <label>
            <span>Hedef şubeler</span>
            <Select
              mode="multiple"
              allowClear
              placeholder="Boş bırakılırsa bütün şubeler"
              value={t.hedef}
              onChange={(v) => degistir({ hedef: v })}
              options={veri.subeler.map((s) => ({ value: s.ad, label: `${s.ad} · ${s.kisi} kişi` }))}
              optionFilterProp="label"
              maxTagCount="responsive"
            />
          </label>

          <div className="hy-anahtarlar">
            <label className="hy-anahtar">
              <Switch size="small" checked={t.yorumAcik} onChange={(v) => degistir({ yorumAcik: v })} />
              <span>
                Yorumlara izin ver<small>Kapalıysa yalnızca beğenilebilir</small>
              </span>
            </label>
            <label className="hy-anahtar">
              <Switch size="small" checked={t.sabit} onChange={(v) => degistir({ sabit: v })} />
              <span>
                Akışın başına sabitle<small>Kaldırılana kadar en üstte</small>
              </span>
            </label>
            {t.durum !== "yayin" && (
              <label className="hy-anahtar">
                <Switch size="small" checked={t.bildirim} onChange={(v) => degistir({ bildirim: v })} />
                <span>
                  Bildirim gönder<small>{t.hedef.length ? "Seçili şubelerdeki" : "Bütün"} personelin telefonuna (1.7 ve üstü)</small>
                </span>
              </label>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ ön izleme */}
        <div className="hy-telefon-kap">
          <div className="hy-soluk" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            TELEFONDA
          </div>
          <div className="hy-telefon">
            <div className="hy-t-ust">
              {logoAdresi(veri.ayar) ? (
                <img className="hy-t-avatar" src={logoAdresi(veri.ayar)!} alt="" style={{ objectFit: "cover", background: "#fff" }} />
              ) : (
                <span className="hy-t-avatar">b</span>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>
                  {t.yazarAd || veri.ayar.kurumAdi} <span className="hy-onay">✓</span>
                </b>
                <small>{t.hedef.length ? `${t.hedef.length} şube` : "Bütün şubeler"}</small>
              </div>
              <Tag color={TUR_RENGI[t.tur]} bordered={false} style={{ marginInlineEnd: 0 }}>
                {t.tur === "gonderi" ? t.kategori : TUR_ADI[t.tur]}
              </Tag>
            </div>
            {videoAdresi && t.tur === "gonderi" ? (
              <video className="hy-t-gorsel" src={videoAdresi} muted controls preload="metadata" style={{ background: "#000" }} />
            ) : (
              onizlemeGorsel && <img className="hy-t-gorsel" src={onizlemeGorsel} alt="" />
            )}
            {t.tur === "kampanya" && (
              <div style={{ padding: "8px 10px 0" }}>
                <KampanyaOnizleme
                  k={{ ...t.kampanya, urunler: t.kampanya.urunler.map((u) => ({ ...u, yeni: u.yeni ?? 0 })) }}
                />
              </div>
            )}
            {t.tur === "anket" && (
              <div style={{ padding: "8px 10px 0" }}>
                <AnketOnizleme a={{ soru: t.anket.soru, secenekler: t.anket.secenekler.map((ad) => ({ ad, oy: null, yuzde: null })) }} sonuc={false} />
                <small className="hy-soluk" style={{ display: "block", marginTop: 4 }}>
                  Sonuçlar oy verince görünür{t.anket.bitis ? ` · ${t.anket.bitis.format("DD.MM")} kapanır` : ""} · kim ne verdi gizli
                </small>
              </div>
            )}
            {!onizlemeGorsel && !videoAdresi && t.tur === "gonderi" && <div className="hy-t-bos">Fotoğraf ya da video ekleyin</div>}
            <div className="hy-t-alt">
              <span>♡ {t.yorumAcik ? " 💬" : ""}</span>
              {t.metin && (
                <p>
                  <b>{t.yazarAd || veri.ayar.kurumAdi}</b> {t.metin}
                </p>
              )}
              {!t.yorumAcik && <i className="hy-soluk">Bu gönderide yorumlar kapalı.</i>}
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ sayfa */

export default function HaberYonetimi() {
  const { message } = AntdApp.useApp();
  const [veri, setVeri] = useState<Veri | null>(null);
  const [hata, setHata] = useState("");
  const [sekme, setSekme] = useState<"gonderiler" | "yetki" | "ayar">("gonderiler");
  const [suzgec, setSuzgec] = useState<string>("tumu");
  const [yorumGonderi, setYorumGonderi] = useState<Gonderi | null>(null);
  const [yorumlar, setYorumlar] = useState<Yorum[] | null>(null);
  const [anketGonderi, setAnketGonderi] = useState<Gonderi | null>(null);
  const [anketSonuc, setAnketSonuc] = useState<AnketSonucu | null>(null);
  const [taslak, setTaslak] = useState<Taslak | null>(null);
  const [kisiEkle, setKisiEkle] = useState<string | null>(null);
  const [kisiSecenek, setKisiSecenek] = useState<{ value: string; label: string }[]>([]);
  const [ayar, setAyar] = useState<Ayar | null>(null);

  const getir = useCallback(async () => {
    try {
      const v = await api.al<Veri>("/api/Haber/Panel");
      setVeri(v);
      setAyar(v.ayar);
      setHata("");
    } catch (h: any) {
      setHata(h?.message ?? "Gönderiler alınamadı.");
    }
  }, []);

  useEffect(() => {
    getir();
  }, [getir]);

  useEffect(() => {
    if (!yorumGonderi) return;
    setYorumlar(null);
    api
      .al<{ yorumlar: Yorum[] }>(`/api/Haber/Panel/${yorumGonderi.id}/Yorumlar`)
      .then((v) => setYorumlar(v.yorumlar))
      .catch((h: any) => message.error(h.message));
  }, [yorumGonderi, message]);

  useEffect(() => {
    if (!anketGonderi) return;
    setAnketSonuc(null);
    api
      .al<AnketSonucu>(`/api/Haber/Panel/${anketGonderi.id}/Anket`)
      .then(setAnketSonuc)
      .catch((h: any) => message.error(h.message));
  }, [anketGonderi, message]);

  const islem = async (g: Gonderi, i: "Sabitle" | "Gizle" | "YorumAc" | "Sil" | "Yayinla") => {
    try {
      await api.gonder(`/api/Haber/Panel/${g.id}/${i}`, i === "Yayinla" ? { bildirim: veri?.ayar.bildirim ?? true } : {});
      if (i === "Yayinla") message.success("Yayınlandı.");
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const gonderiler = useMemo(
    () =>
      (veri?.gonderiler ?? []).filter((g) =>
        suzgec === "tumu"
          ? true
          : suzgec === "taslak"
          ? g.durum === "taslak"
          : suzgec === "gizli"
          ? g.gizli
          : suzgec === "sabit"
          ? g.sabit
          : suzgec === "kampanya" || suzgec === "anket"
          ? g.tur === suzgec
          : g.tur === "gonderi" && g.kategori === suzgec
      ),
    [veri, suzgec]
  );

  const ozet = useMemo(() => {
    const l = (veri?.gonderiler ?? []).filter((g) => g.durum === "yayin");
    const ay = l.filter((g) => dayjs(g.tarih).isSame(dayjs(), "month"));
    return {
      buAy: ay.length,
      begeni: ay.reduce((a, g) => a + g.begeni, 0),
      yorum: ay.reduce((a, g) => a + g.yorumSayisi, 0),
      anket: l.filter((g) => g.tur === "anket" && g.anket && !g.anket.bitti && !g.gizli).length,
      taslak: (veri?.gonderiler ?? []).filter((g) => g.durum === "taslak").length,
    };
  }, [veri]);

  if (hata && !veri) return <Alert type="error" showIcon message={hata} action={<Button onClick={getir}>Yeniden dene</Button>} />;
  if (!veri) return <Spin style={{ display: "block", margin: "60px auto" }} />;

  const yeni = (tur: Tur) => setTaslak(bosTaslak(tur, veri.ayar));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{CSS}</style>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Kutu ad="Bu ay paylaşım" deger={ozet.buAy} alt={ozet.taslak ? `${ozet.taslak} taslak bekliyor` : undefined} />
        <Kutu ad="Bu ayki paylaşımlara beğeni" deger={ozet.begeni.toLocaleString("tr-TR")} />
        <Kutu ad="Bu ayki paylaşımlara yorum" deger={ozet.yorum.toLocaleString("tr-TR")} />
        <Kutu ad="Süren anket" deger={ozet.anket} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Segmented
          value={sekme}
          onChange={(v) => setSekme(v as any)}
          options={[
            { value: "gonderiler", label: `Paylaşımlar · ${veri.gonderiler.length}` },
            { value: "yetki", label: `Paylaşım yetkisi · ${veri.yetkililer.length}` },
            { value: "ayar", label: "Ayarlar" },
          ]}
        />
        <span style={{ flex: 1 }} />
        {sekme === "gonderiler" && (
          <Space wrap>
            <Button type="primary" icon={<Plus size={14} />} onClick={() => yeni("gonderi")}>
              Gönderi
            </Button>
            <Button onClick={() => yeni("kampanya")}>🏷️ Kasada bu hafta</Button>
            <Button onClick={() => yeni("anket")}>📊 Anket</Button>
          </Space>
        )}
      </div>

      {sekme === "gonderiler" && (
        <>
          <Space wrap size={[6, 6]}>
            {[
              ["tumu", "Tümü"],
              ["kampanya", "🏷️ Kasada bu hafta"],
              ["anket", "📊 Anket"],
              ...veri.ayar.kategoriler.map((k) => [k, k]),
              ["sabit", "Sabit"],
              ["taslak", "Taslak"],
              ["gizli", "Gizli"],
            ].map(([k, ad]) => (
              <Tag.CheckableTag key={k} checked={suzgec === k} onChange={() => setSuzgec(k)} style={{ padding: "3px 10px", borderRadius: 99 }}>
                {ad}
              </Tag.CheckableTag>
            ))}
          </Space>
          {gonderiler.length === 0 ? (
            <Empty description={veri.gonderiler.length ? "Bu süzgeçte paylaşım yok" : "Henüz paylaşım yok. Sağ üstten ilk paylaşımı yapın."} />
          ) : (
            <div className="hy-izgara">
              {gonderiler.map((g) => (
                <GonderiKarti
                  key={g.id}
                  g={g}
                  islem={islem}
                  yorumlar={setYorumGonderi}
                  duzenle={(x) => setTaslak(taslakDuzenle(x, veri.ayar))}
                  anketSonucu={setAnketGonderi}
                />
              ))}
            </div>
          )}
        </>
      )}

      {sekme === "yetki" && (
        <>
          <Alert
            type="info"
            showIcon
            message="Biçen360'tan gönderi paylaşabilecek kişiler"
            description="Bu listedeki kişilerin Biçen'den Haberler ekranında + düğmesi görünür ve fotoğraflı gönderi paylaşabilir. Kurum adına paylaşım açıksa gönderi kendi adıyla değil Biçen Market adıyla (onaylı rozetle) yayınlanır. Kasada bu hafta ve anket yalnızca panelden gönderilir. Bütün personel paylaşımları görür, beğenir ve yorum yazar."
          />
          <Space wrap>
            <Select
              showSearch
              style={{ width: 340, maxWidth: "100%" }}
              placeholder="Personel ara (ad, sicil, şube)"
              value={kisiEkle}
              onChange={setKisiEkle}
              filterOption={false}
              onSearch={async (q) => {
                if (q.trim().length < 2) return;
                try {
                  const l = await api.al<{ sicil: string; ad: string; sube: string; unvan: string }[]>(
                    `/api/Haber/Panel/KisiAra?q=${encodeURIComponent(q)}`
                  );
                  setKisiSecenek(l.map((k) => ({ value: k.sicil, label: [k.ad, k.unvan, k.sube].filter(Boolean).join(" · ") })));
                } catch {
                  /* arama sessizce boş */
                }
              }}
              options={kisiSecenek}
            />
            <Button
              type="primary"
              icon={<UserPlus size={14} />}
              disabled={!kisiEkle}
              onClick={async () => {
                try {
                  await api.gonder("/api/Haber/Panel/Yetki", { sicil: kisiEkle, ekle: true });
                  setKisiEkle(null);
                  getir();
                } catch (h: any) {
                  message.error(h.message);
                }
              }}
            >
              Yetki ver
            </Button>
          </Space>
          <Table<Yetkili>
            size="small"
            rowKey="sicil"
            dataSource={veri.yetkililer}
            pagination={false}
            scroll={{ x: 640 }}
            locale={{ emptyText: "Henüz kimseye yetki verilmedi; panelden paylaşım yapılabilir." }}
            columns={[
              {
                title: "Personel",
                render: (_, k) => (
                  <>
                    <b>{k.ad}</b>
                    <div style={{ fontSize: 12, color: "#8a929b" }}>{[k.sicil, k.unvan, k.sube].filter(Boolean).join(" · ")}</div>
                  </>
                ),
              },
              {
                title: `Kurum adına (${veri.ayar.kurumAdi})`,
                width: 200,
                render: (_, k) => (
                  <Switch
                    checked={k.kurumAdina}
                    onChange={async (v) => {
                      await api.gonder("/api/Haber/Panel/Yetki", { sicil: k.sicil, ekle: true, kurumAdina: v });
                      getir();
                    }}
                  />
                ),
              },
              { title: "Gönderi", dataIndex: "gonderi", width: 90, align: "right" },
              { title: "Son gönderi", width: 140, render: (_, k) => (k.sonGonderi ? goreceZaman(k.sonGonderi) : "—") },
              {
                title: "",
                width: 100,
                render: (_, k) => (
                  <Popconfirm
                    title="Paylaşım yetkisi kaldırılsın mı?"
                    description="Önceki gönderileri akışta kalır."
                    okText="Kaldır"
                    cancelText="Vazgeç"
                    onConfirm={async () => {
                      await api.gonder("/api/Haber/Panel/Yetki", { sicil: k.sicil, ekle: false });
                      getir();
                    }}
                  >
                    <Button size="small" danger>
                      Kaldır
                    </Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </>
      )}

      {sekme === "ayar" && ayar && (
        <div className="hy-ayar">
          <div>
            <b>Kategoriler</b>
            <small>Gönderi paylaşılırken seçilir; akışın üstünde süzgeç olarak görünür. "Kasada bu hafta" ve "Anket" kendiliğinden eklenir.</small>
            <Select mode="tags" style={{ width: "100%" }} value={ayar.kategoriler} onChange={(v) => setAyar({ ...ayar, kategoriler: v })} />
          </div>
          <div>
            <b>Yasaklı kelimeler</b>
            <small>Bu kelimeleri içeren yorum yayınlanmaz; yazan kişiye uyarı gösterilir.</small>
            <Select
              mode="tags"
              style={{ width: "100%" }}
              value={ayar.yasakliKelimeler}
              onChange={(v) => setAyar({ ...ayar, yasakliKelimeler: v })}
              placeholder="kelime yazıp Enter"
            />
          </div>
          <div>
            <b>Kurum hesabı</b>
            <small>Kurum adına paylaşımlarda görünen ad, logo ve profil sayfasındaki tanıtım. Biçen360'ta ada dokununca profil açılır.</small>
            <div className="hy-hesap">
              <div className="hy-logo">
                {logoAdresi(veri?.ayar) ? <img src={logoAdresi(veri?.ayar)!} alt="" /> : <span>b</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
                <Input
                  value={ayar.kurumAdi}
                  maxLength={150}
                  onChange={(e) => setAyar({ ...ayar, kurumAdi: e.target.value })}
                  style={{ maxWidth: 320 }}
                  addonBefore="Ad"
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Upload
                    accept="image/png,image/jpeg,image/webp"
                    showUploadList={false}
                    beforeUpload={async (dosya) => {
                      if (dosya.size > 1024 * 1024) {
                        message.error("Logo en fazla 1 MB olabilir.");
                        return false;
                      }
                      try {
                        const f = new FormData();
                        f.append("dosya", dosya);
                        await api.dosyaGonder("/api/Haber/Panel/Logo", f);
                        message.success("Logo yüklendi. Telefonlarda bir sonraki yenilemede görünür.");
                        getir();
                      } catch (h: any) {
                        message.error(h.message);
                      }
                      return false;
                    }}
                  >
                    <Button size="small">{logoAdresi(veri?.ayar) ? "Logoyu değiştir" : "Logo yükle"}</Button>
                  </Upload>
                  {logoAdresi(veri?.ayar) && (
                    <Popconfirm
                      title="Logo kaldırılsın mı?"
                      description='Yerine yeşil "b" rozeti görünür.'
                      okText="Kaldır"
                      cancelText="Vazgeç"
                      onConfirm={async () => {
                        try {
                          await api.gonder("/api/Haber/Panel/Logo/Sil", {});
                          getir();
                        } catch (h: any) {
                          message.error(h.message);
                        }
                      }}
                    >
                      <Button size="small" danger type="text">
                        Kaldır
                      </Button>
                    </Popconfirm>
                  )}
                  <small className="hy-soluk" style={{ alignSelf: "center" }}>
                    Kare PNG / JPEG / WebP, en fazla 1 MB · yuvarlak kırpılır
                  </small>
                </div>
              </div>
            </div>
            <Input.TextArea
              value={ayar.kurumAciklama ?? ""}
              maxLength={300}
              showCount
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="Profil tanıtımı (ör. Biçen Market resmî hesabı · 34 mağaza, tek aile)"
              onChange={(e) => setAyar({ ...ayar, kurumAciklama: e.target.value })}
              style={{ marginTop: 10 }}
            />
          </div>
          <div className="hy-satir">
            <span>
              <b>Yeni paylaşımda bildirim</b>
              <small>Paylaşırken her seferinde açılıp kapatılabilir; bu varsayılan değer.</small>
            </span>
            <Switch checked={ayar.bildirim} onChange={(v) => setAyar({ ...ayar, bildirim: v })} />
          </div>
          <Button
            type="primary"
            style={{ alignSelf: "flex-start" }}
            onClick={async () => {
              try {
                await api.gonder("/api/Haber/Panel/Ayar", ayar);
                message.success("Kaydedildi.");
                getir();
              } catch (h: any) {
                message.error(h.message);
              }
            }}
          >
            Kaydet
          </Button>
        </div>
      )}

      <Drawer
        open={!!yorumGonderi}
        width="min(460px, 100vw)"
        title={yorumGonderi ? `Yorumlar · ${yorumGonderi.yazar.ad}` : ""}
        onClose={() => setYorumGonderi(null)}
      >
        {!yorumlar ? (
          <Spin />
        ) : yorumlar.length === 0 ? (
          <Empty description="Yorum yok" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {yorumlar.map((y) => (
              <div key={y.id} className={`hy-yorum${y.gizli ? " hy-gizli" : ""}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{y.ad}</b> <span className="hy-soluk">{y.unvan}</span>
                  <div style={{ overflowWrap: "anywhere" }}>{y.metin}</div>
                  <div className="hy-soluk" style={{ fontSize: 11.5 }}>
                    {goreceZaman(y.tarih)}
                    {y.gizli ? " · gizlendi" : ""}
                  </div>
                </div>
                <Button
                  size="small"
                  icon={y.gizli ? <Eye size={13} /> : <EyeOff size={13} />}
                  onClick={async () => {
                    await api.gonder(`/api/Haber/Panel/Yorum/${y.id}/Gizle`, {});
                    setYorumlar((l) => l!.map((x) => (x.id === y.id ? { ...x, gizli: !x.gizli } : x)));
                    getir();
                  }}
                >
                  {y.gizli ? "Göster" : "Gizle"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!anketGonderi}
        width="min(620px, 100vw)"
        title="Anket sonucu"
        onClose={() => setAnketGonderi(null)}
      >
        {anketGonderi?.anket && <AnketOnizleme a={anketGonderi.anket} />}
        {!anketSonuc ? (
          <Spin style={{ display: "block", marginTop: 20 }} />
        ) : anketSonuc.subeler.length === 0 ? (
          <Empty style={{ marginTop: 20 }} description="Henüz oy yok" />
        ) : (
          <>
            <h4 style={{ margin: "20px 0 8px" }}>Şubelere göre</h4>
            <Table
              size="small"
              rowKey="sube"
              pagination={false}
              scroll={{ x: 120 + anketSonuc.secenekler.length * 110 }}
              dataSource={anketSonuc.subeler}
              columns={[
                { title: "Şube", dataIndex: "sube", fixed: "left", width: 150 },
                { title: "Oy", dataIndex: "toplam", width: 60, align: "right" },
                ...anketSonuc.secenekler.map((s, i) => ({
                  title: s,
                  key: String(i),
                  width: 110,
                  align: "right" as const,
                  render: (_: unknown, r: AnketSonucu["subeler"][number]) => {
                    const n = r.oylar[i] ?? 0;
                    const y = r.toplam ? Math.round((100 * n) / r.toplam) : 0;
                    const enCok = n > 0 && n === Math.max(...r.oylar);
                    return (
                      <span style={{ fontWeight: enCok ? 800 : 400 }}>
                        {n} <span className="hy-soluk">· %{y}</span>
                      </span>
                    );
                  },
                })),
              ]}
            />
            <small className="hy-soluk" style={{ display: "block", marginTop: 8 }}>
              Kim hangi seçeneği işaretledi gösterilmez; şube, oy verildiği andaki şubedir.
            </small>
          </>
        )}
      </Drawer>

      <PaylasimPenceresi taslak={taslak} setTaslak={setTaslak} veri={veri} kaydedildi={getir} />
    </div>
  );
}

const CSS = `
.hy-kutu{flex:1 1 170px;background:#fff;border:1px solid #eceee8;border-radius:12px;padding:12px 14px}
.hy-kutu-ad{font-size:12px;color:#6b7280;font-weight:600}
.hy-kutu-deger{font-size:24px;font-weight:800;color:#1f4d2b;line-height:1.3}
.hy-kutu-alt{font-size:11.5px;color:#b45309}
.hy-izgara{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.hy-kart{position:relative;background:#fff;border:1px solid #eceee8;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.hy-kart.hy-gizli{opacity:.6}
.hy-kart.hy-taslak{border-style:dashed;border-color:#d4a72c}
.hy-gorsel{position:relative;aspect-ratio:1/1;background:#f4f6f2;overflow:hidden}
.hy-gorsel img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hy-bos{display:grid;place-items:center;color:#9aa1a9;font-size:12.5px}
.hy-ozel{aspect-ratio:1/1;overflow:hidden;padding:36px 10px 10px;background:#fafbf8;display:flex;flex-direction:column;justify-content:center}
.hy-fazla{font-size:12px;text-align:center;margin-top:4px}
.hy-adet{position:absolute;top:8px;right:8px;background:#000a;color:#fff;font-size:11px;font-weight:700;border-radius:99px;padding:2px 8px}
.hy-rozetler{position:absolute;top:8px;left:8px;display:flex;gap:4px;z-index:1}
.hy-rozet{font-size:11px;font-weight:800;border-radius:99px;padding:3px 8px;display:inline-flex;gap:4px;align-items:center}
.hy-r-sabit{background:#f2f9e8;color:#3f6108}
.hy-r-taslak{background:#fff7e0;color:#8a5a00}
.hy-r-gizli{background:#b42318;color:#fff}
.hy-ic{padding:10px 12px 12px;display:flex;flex-direction:column;gap:5px;flex:1}
.hy-yazar{font-size:13.5px}
.hy-etiketler{display:flex;gap:4px;flex-wrap:wrap}
.hy-etiketler .ant-tag{margin:0}
.hy-onay{display:inline-grid;place-items:center;width:14px;height:14px;border-radius:50%;background:#3897f0;color:#fff;font-size:9px;font-weight:900;margin-left:4px;vertical-align:1px}
.hy-soluk{color:#8a929b}
.hy-metin{font-size:13px;color:#374151;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hy-say{display:flex;gap:14px;font-size:12.5px;color:#4b5563;margin-top:auto;padding-top:4px;flex-wrap:wrap}
.hy-say span{display:inline-flex;align-items:center;gap:4px}
.hy-dugmeler{display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap}

.hy-kampanya{border:1px solid #dde7f2;border-radius:12px;background:#f5f8fc;overflow:hidden}
.hy-kampanya-bas{display:flex;align-items:center;gap:8px;padding:9px 10px 7px}
.hy-kampanya-bas b{flex:1;min-width:0;color:#1a4d80;font-size:14px}
.hy-kampanya-bas span{background:#fff;border:1px solid #dde7f2;border-radius:99px;padding:1px 8px;font-size:11px;font-weight:800;color:#1a4d80;white-space:nowrap}
.hy-urun{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fff;border-top:1px solid #e3eaf3}
.hy-urun-ad{flex:1;min-width:0;font-weight:700;font-size:13px;overflow-wrap:anywhere}
.hy-urun-ad small{display:block;font-weight:400;color:#8a929b;font-size:11px}
.hy-fiyat{text-align:right;line-height:1.15}
.hy-fiyat s{display:block;color:#8a929b;font-size:11px}
.hy-fiyat b{color:#e8481c;font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap}
.hy-indirim{width:40px;text-align:center;background:#fff2e8;color:#ad4e00;font-weight:900;font-size:11.5px;border-radius:7px;padding:3px 0}
.hy-soyle{margin:8px;background:#eef4fb;color:#1a4d80;border-radius:10px;padding:8px 10px;font-size:12.5px;font-weight:600}
.hy-soyle small{display:block;font-size:10px;font-weight:900;letter-spacing:.05em;margin-bottom:2px}

.hy-anket{display:flex;flex-direction:column;gap:6px}
.hy-anket-soru{font-size:14px}
.hy-secenek{position:relative;display:flex;justify-content:space-between;gap:8px;border:1.5px solid #e6e9e3;border-radius:10px;padding:8px 10px;background:#fff;overflow:hidden;font-weight:700;font-size:13px}
.hy-secenek i{position:absolute;inset:0 auto 0 0;background:#f6efff}
.hy-secenek span{position:relative}

.hy-duzen{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;align-items:start}
@media (max-width:860px){.hy-duzen{grid-template-columns:minmax(0,1fr)}.hy-telefon-kap{order:-1}}
.hy-form{display:flex;flex-direction:column;gap:16px;min-width:0}
.hy-form label{display:flex;flex-direction:column;gap:4px}
.hy-form label>span,.hy-baslik-satir>span{font-weight:700;font-size:13px}
.hy-form small{font-size:11.5px}
.hy-baslik-satir{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.hy-alan-iki{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.hy-urunler{display:flex;flex-direction:column;gap:6px}
.hy-urun-satir{display:grid;grid-template-columns:minmax(140px,1fr) 92px 120px 130px 32px;gap:6px;align-items:center}
.hy-urun-baslik span{font-size:11.5px;color:#8a929b;font-weight:700}
@media (max-width:640px){
  .hy-urun-satir{grid-template-columns:76px minmax(0,1fr) minmax(0,1fr) 32px;padding:8px;border:1px solid #eceee8;border-radius:10px}
  .hy-urun-satir>:first-child{grid-column:1/-1}
  .hy-urun-baslik{display:none}
}
.hy-gorseller{display:flex;gap:8px;flex-wrap:wrap}
.hy-kucuk{position:relative;width:76px;height:76px;border-radius:10px;overflow:hidden;background:#f4f6f2}
.hy-kucuk img{width:100%;height:100%;object-fit:cover}
.hy-kucuk button{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;border:0;background:#000b;color:#fff;display:grid;place-items:center;cursor:pointer;padding:0}
.hy-ekle{border:1.5px dashed #7cb518;color:#5f8c10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:12px;font-weight:700;cursor:pointer;background:#f2f9e8}
.hy-anahtarlar{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid #eceee8;border-radius:12px;background:#fafbf8}
.hy-form label.hy-anahtar{flex-direction:row;align-items:flex-start;gap:10px;cursor:pointer}
.hy-anahtar>span{font-weight:700;font-size:13px}
.hy-anahtar small{display:block;font-weight:400;color:#8a929b}

.hy-telefon-kap{position:sticky;top:0}
.hy-telefon{border:8px solid #1d2126;border-radius:28px;background:#fff;overflow:hidden;padding-bottom:12px;max-width:320px;margin:0 auto}
.hy-t-ust{display:flex;align-items:center;gap:8px;padding:10px}
.hy-t-ust b{font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hy-t-ust small{color:#8a929b;font-size:11px}
.hy-t-avatar{flex:none;width:32px;height:32px;border-radius:50%;background:#7cb518;color:#fff;font-weight:900;display:grid;place-items:center}
.hy-t-gorsel{display:block;width:100%;height:auto;max-height:420px;object-fit:contain;background:#f4f5f2}
.hy-hesap{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.hy-logo{flex:none;width:64px;height:64px;border-radius:50%;padding:2px;border:2px solid #7cb518;background:#fff}
.hy-logo img,.hy-logo span{width:100%;height:100%;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:#7cb518;color:#fff;font-weight:900;font-size:24px}
.hy-logo img{background:#fff}
.hy-t-bos{aspect-ratio:1/1;background:#f2f9e8;display:grid;place-items:center;color:#5f8c10;font-weight:700;font-size:13px}
.hy-t-alt{padding:8px 12px 0;font-size:12.5px}
.hy-t-alt>span{font-size:18px;letter-spacing:4px}
.hy-t-alt p{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}

.hy-ayar{display:flex;flex-direction:column;gap:18px;max-width:640px;background:#fff;border:1px solid #eceee8;border-radius:14px;padding:18px}
.hy-ayar small{display:block;color:#8a929b;font-size:12px;margin:2px 0 6px}
.hy-satir{display:flex;align-items:center;justify-content:space-between;gap:16px}
.hy-yorum{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid #eef0eb;border-radius:10px}
.hy-yorum.hy-gizli{background:#fff4f2;opacity:.75}
`;
