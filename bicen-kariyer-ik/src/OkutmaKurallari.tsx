/**
 * Okutma Kuralları
 * ---------------------------------------------------------------------------
 * Vardiya Karekodları sayfasının sekmesi (03.10.2026).
 *
 *  - Kapsam haritası: bütün karekod konumları ve okutma yarıçapları
 *    (kapsam alanı). Genel mesafe ve şube/konum başına mesafe buradan
 *    ayarlanır; daire kenarı sürüklenerek de değiştirilebilir.
 *  - Özel konumlar (Hal gibi): haritadan eklenir, kendi karekodu üretilir.
 *  - Personel kuralları: saha personeli her şubede, konum personeli yalnızca
 *    atandığı konumda okutur; muaf personelden okutma beklenmez.
 *
 * Bütün kurallar sunucuda, mobil okutma ucunda uygulanır; Biçen360
 * uygulamasında değişiklik gerekmez.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  Ban,
  Download,
  FileText,
  History,
  Info,
  Layers,
  LocateFixed,
  Map as HaritaIkon,
  MapPin,
  MapPinned,
  Navigation,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Ruler,
  Satellite,
  Search,
  ShieldOff,
  Globe,
  Trash2,
  Truck,
  Users,
  X,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import dayjs, { Dayjs } from "dayjs";

import Tablo from "./Tablo";
import { api } from "./api";
import "./OkutmaKurallari.css";
import { PersonelAdi } from "./personelKarti";

const { Text } = Typography;

/* -------------------------------------------------------------------------- */
/* Tipler ve sabitler                                                          */
/* -------------------------------------------------------------------------- */

interface Yer {
  tur: "sube" | "ozel";
  anahtar: string;
  ad: string;
  enlem: number | null;
  boylam: number | null;
  /** Yere özel yarıçap; boşsa genel ayar geçerli */
  yaricap: number | null;
  etkinYaricap: number;
  okutma7: number;
  red7: number;
  personel: number | null;

  /* şube */
  subeKodu?: string;
  karekod?: boolean;
  icard?: number;

  /* özel konum */
  id?: number;
  aciklama?: string | null;
  qrKod?: string;
  aktif?: boolean;
  olusturan?: string;
  olusturma?: string;
}

interface Ozet {
  ayar: { varsayilanYaricap: number; kendiSube: boolean; enAz: number; enFazla: number };
  sayilar: {
    saha: number;
    konum: number;
    muaf: number;
    serbest?: number;
    ozelKonum: number;
    konumsuzSube: number;
    ozelYaricapli: number;
    eslesmeyen: number | null;
    eslesmeyenOrnek: string[];
  };
  subeler: Yer[];
  ozelKonumlar: Yer[];
}

/** Haritada düzenlenen yerin taslağı */
interface Taslak {
  anahtar: string; // "yeni" ya da yer anahtarı
  tur: "sube" | "ozel";
  ad: string;
  aciklama: string;
  enlem: number;
  boylam: number;
  ozelYaricap: boolean;
  yaricap: number;
  aktif: boolean;
}

const RENK = {
  sube: "#5f8c10",
  subeOzel: "#2e6aa8",
  ozel: "#e8481c",
  pasif: "#9aa3af",
};

export const TURLER = {
  saha: {
    ad: "Saha personeli",
    kisa: "Saha",
    renk: "#2e6aa8",
    aciklama: "Her şubenin karekodunu okutabilir. Mesafe denetimi okuttuğu yere göre yapılır.",
    ikon: <Truck size={15} strokeWidth={2.2} />,
  },
  konum: {
    ad: "Hal / konum personeli",
    kisa: "Konum",
    renk: "#e8481c",
    aciklama: "Yalnızca atandığı özel konum(lar)da okutabilir; isterseniz kendi şubesinde de.",
    ikon: <MapPinned size={15} strokeWidth={2.2} />,
  },
  muaf: {
    ad: "Okutmadan muaf",
    kisa: "Muaf",
    renk: "#6d4bc2",
    aciklama: "Okutma beklenmez; raporlarda “okutmadı” yerine “Muaf” görünür. Okutursa kayıt normal düşer.",
    ikon: <ShieldOff size={15} strokeWidth={2.2} />,
  },
  serbest: {
    ad: "Her yerden okutabilir",
    kisa: "Her yerden",
    renk: "#0f766e",
    aciklama: "Kendi şubesinde normal okutur; şubede değilken “Her yerden karekodu”nu konum sınırı olmadan okutabilir.",
    ikon: <Globe size={15} strokeWidth={2.2} />,
  },
} as const;

type KuralTuru = keyof typeof TURLER;

const SEBEP: Record<string, { ad: string; renk: string }> = {
  mesafe: { ad: "Mesafe", renk: "red" },
  yetki: { ad: "Yetki", renk: "volcano" },
  sube: { ad: "Başka şube", renk: "orange" },
  konum_yok: { ad: "Konum izni yok", renk: "gold" },
};

/** Bursa merkez; veri yokken başlangıç görünümü */
const BASLANGIC: [number, number] = [40.1885, 29.061];

const yaricapEtiketi = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} km` : `${m} m`);

const yerRengi = (y: { tur: string; yaricap?: number | null; aktif?: boolean }) =>
  y.tur === "ozel" ? (y.aktif === false ? RENK.pasif : RENK.ozel) : y.yaricap ? RENK.subeOzel : RENK.sube;

/** "40.1885, 29.0610", Google Haritalar adresi (…/@40.18,29.06,17z) ya da "40,18 ; 29,06" */
export const koordinatCoz = (metin: string): [number, number] | null => {
  const t = (metin ?? "").trim();
  const nokta = t.match(/(-?\d{1,3}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
  const virgul = t.match(/(-?\d{1,3},\d+)\s*[; ]\s*(-?\d{1,3},\d+)/);
  const m = nokta ?? virgul;
  if (!m) return null;
  const e = Number(m[1].replace(",", "."));
  const b = Number(m[2].replace(",", "."));
  if (!Number.isFinite(e) || !Number.isFinite(b) || Math.abs(e) > 90 || Math.abs(b) > 180) return null;
  return [e, b];
};

/** Merkezden doğuya r metre uzaklıktaki nokta (kenar tutamacı için) */
const doguNoktasi = (e: number, b: number, r: number): [number, number] => [
  e,
  b + r / (111320 * Math.cos((e * Math.PI) / 180)),
];

const sinirla = (v: number, a: number, z: number) => Math.min(z, Math.max(a, v));

const YARICAP_ISARET = { 150: "150", 300: "300", 500: "500", 750: "750", 1000: "1 km" };

/* -------------------------------------------------------------------------- */
/* Karekod afişi: PNG / PDF / yazdırma aynı tuvalden                            */
/* -------------------------------------------------------------------------- */

const afisCiz = async (ad: string, kod: string, yaricap: number): Promise<HTMLCanvasElement> => {
  const G = 1240;
  const Y = 1754;
  const c = document.createElement("canvas");
  c.width = G;
  c.height = Y;
  const x = c.getContext("2d")!;

  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, G, Y);

  x.fillStyle = "#7cb518";
  x.fillRect(0, 0, G, 26);

  const yazi = (metin: string, y: number, boyut: number, renk: string, kalin = false) => {
    x.fillStyle = renk;
    x.font = `${kalin ? "700" : "400"} ${boyut}px "Segoe UI", Arial, sans-serif`;
    x.textAlign = "center";
    x.fillText(metin, G / 2, y);
  };

  yazi("Vardiya Giriş / Çıkış", 190, 78, "#1f2933", true);
  yazi(ad, 280, 50, "#5f8c10", true);

  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, kod, { width: 760, margin: 1, color: { dark: "#1d2126", light: "#ffffff" } });

  const kutu = 840;
  const kx = (G - kutu) / 2;
  const ky = 350;
  x.strokeStyle = "#7cb518";
  x.lineWidth = 8;
  const r = 36;
  x.beginPath();
  x.moveTo(kx + r, ky);
  x.arcTo(kx + kutu, ky, kx + kutu, ky + kutu, r);
  x.arcTo(kx + kutu, ky + kutu, kx, ky + kutu, r);
  x.arcTo(kx, ky + kutu, kx, ky, r);
  x.arcTo(kx, ky, kx + kutu, ky, r);
  x.closePath();
  x.stroke();
  x.drawImage(qr, kx + 40, ky + 40, 760, 760);

  yazi("Biçen360 uygulamasından okutunuz", 1320, 46, "#1f2933", true);
  yazi("Uygulamayı açın · Vardiya sekmesine girin · Karekodu çerçeveye alın", 1385, 32, "#4a5560");
  yazi(`Bu kod ${ad} için tanımlıdır ve yalnızca ${yaricapEtiketi(yaricap)} yakınında geçerlidir.`, 1520, 28, "#6b7280");
  yazi("Kodun fotoğrafını çekip paylaşmayınız; konum doğrulaması yapılmaktadır.", 1565, 28, "#6b7280");

  x.font = '20px ui-monospace, Menlo, Consolas, monospace';
  x.fillStyle = "#b0b6bd";
  x.textAlign = "center";
  x.fillText(kod, G / 2, 1690);

  return c;
};

const dosyaAdi = (ad: string) =>
  (ad || "konum")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const pngIndir = async (ad: string, kod: string, r: number) => {
  const c = await afisCiz(ad, kod, r);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = `vardiya-karekodu-${dosyaAdi(ad)}.png`;
  a.click();
};

const pdfIndir = async (ad: string, kod: string, r: number) => {
  const c = await afisCiz(ad, kod, r);
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.addImage(c.toDataURL("image/png"), "PNG", 0, 0, 210, 297);
  pdf.save(`vardiya-karekodu-${dosyaAdi(ad)}.pdf`);
};

const yazdir = async (ad: string, kod: string, r: number): Promise<boolean> => {
  const pencere = window.open("", "_blank", "width=820,height=1000");
  if (!pencere) return false;
  const c = await afisCiz(ad, kod, r);
  pencere.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${ad} · Vardiya Karekodu</title>
<style>@page{size:A4;margin:0}html,body{margin:0}img{width:100%;display:block}</style></head>
<body><img src="${c.toDataURL("image/png")}" alt=""><script>window.onload=()=>window.print();<\/script></body></html>`);
  pencere.document.close();
  return true;
};

/* -------------------------------------------------------------------------- */
/* Kapsam haritası                                                             */
/* -------------------------------------------------------------------------- */

interface HaritaOzellik {
  yerler: Yer[];
  taslak: Taslak | null;
  ekleme: boolean;
  katman: "sokak" | "uydu";
  /** r verilirse daire, sağdaki panelin altında kalmayacak biçimde sığdırılır */
  odak: { e: number; b: number; z?: number; r?: number; n: number } | null;
  onSec: (y: Yer) => void;
  onYeniNokta: (e: number, b: number) => void;
  onTaslak: (d: Partial<Taslak>) => void;
}

function KapsamHaritasi({ yerler, taslak, ekleme, katman, odak, onSec, onYeniNokta, onTaslak }: HaritaOzellik) {
  const kutu = useRef<HTMLDivElement>(null);
  const harita = useRef<L.Map | null>(null);
  const katmanlar = useRef<{ sokak: L.TileLayer; uydu: L.LayerGroup } | null>(null);
  const grup = useRef<L.LayerGroup | null>(null);
  const duzen = useRef<{ daire: L.Circle; merkez: L.Marker; kenar: L.Marker; anahtar: string } | null>(null);
  const surukleniyor = useRef(false);
  const ilkSigdirma = useRef(false);

  /* Olay işleyicileri ref'te: harita bir kez kuruluyor */
  const cagrilar = useRef({ onSec, onYeniNokta, onTaslak, ekleme });
  cagrilar.current = { onSec, onYeniNokta, onTaslak, ekleme };

  /* ------------------------------------------------------------ kurulum */
  useEffect(() => {
    if (!kutu.current || harita.current) return;

    const h = L.map(kutu.current, { zoomControl: true, attributionControl: true }).setView(BASLANGIC, 12);

    const sokak = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });

    const uydu = L.layerGroup([
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Görüntü &copy; Esri, Maxar, Earthstar Geographics",
      }),
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19 }
      ),
    ]);

    sokak.addTo(h);
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(h);

    grup.current = L.layerGroup().addTo(h);
    katmanlar.current = { sokak, uydu };

    h.on("click", (o: L.LeafletMouseEvent) => {
      if (cagrilar.current.ekleme) cagrilar.current.onYeniNokta(o.latlng.lat, o.latlng.lng);
    });

    harita.current = h;

    /* Kapsayıcı boyutu sekme açılırken değişebiliyor */
    const gozcu = new ResizeObserver(() => h.invalidateSize());
    gozcu.observe(kutu.current);

    return () => {
      gozcu.disconnect();
      h.remove();
      harita.current = null;
      duzen.current = null;
    };
  }, []);

  /* ------------------------------------------------------------ katman */
  useEffect(() => {
    const h = harita.current;
    const k = katmanlar.current;
    if (!h || !k) return;
    if (katman === "uydu") {
      h.removeLayer(k.sokak);
      k.uydu.addTo(h);
    } else {
      h.removeLayer(k.uydu);
      k.sokak.addTo(h);
    }
  }, [katman]);

  /* ------------------------------------------------------------ odak */
  useEffect(() => {
    const h = harita.current;
    if (!odak || !h) return;

    if (odak.r) {
      /* Seçili yer paneli geniş ekranda sağda, dar ekranda altta duruyor;
         daire ve kenar tutamacı panelin altında kalmasın. */
      const dar = window.innerWidth <= 980;
      const yukseklik = kutu.current?.clientHeight ?? 600;
      h.flyToBounds(L.latLng(odak.e, odak.b).toBounds(odak.r * 2 * 1.7), {
        paddingTopLeft: [24, 70],
        paddingBottomRight: dar ? [24, Math.round(yukseklik * 0.58)] : [360, 24],
        maxZoom: 18,
        duration: 0.6,
      });
      return;
    }

    h.flyTo([odak.e, odak.b], odak.z ?? Math.max(h.getZoom(), 16), { duration: 0.6 });
  }, [odak]);

  /* ------------------------------------------------------------ bütün yerler */
  useEffect(() => {
    const h = harita.current;
    const g = grup.current;
    if (!h || !g) return;

    g.clearLayers();

    const konumlu = yerler.filter((y) => y.enlem != null && y.boylam != null);

    for (const y of konumlu) {
      if (taslak && taslak.anahtar === y.anahtar) continue;

      const renk = yerRengi(y);
      const merkez: [number, number] = [y.enlem!, y.boylam!];

      L.circle(merkez, {
        radius: y.etkinYaricap,
        color: renk,
        weight: 2,
        opacity: 0.9,
        fillColor: renk,
        fillOpacity: y.tur === "ozel" && y.aktif === false ? 0.06 : 0.2,
        dashArray: y.tur === "ozel" && y.aktif === false ? "4 4" : undefined,
        interactive: true,
      })
        .on("click", (o) => {
          if (cagrilar.current.ekleme) return;
          L.DomEvent.stopPropagation(o);
          cagrilar.current.onSec(y);
        })
        .addTo(g);

      L.marker(merkez, {
        icon: L.divIcon({
          className: "",
          html: `<div class="okr-pin" style="--c:${renk}"></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 30],
        }),
        keyboard: false,
      })
        .bindTooltip(`${y.ad} · ${yaricapEtiketi(y.etkinYaricap)}`, {
          direction: "top",
          offset: [0, -30],
          className: "okr-ad-etiket",
        })
        .on("click", (o) => {
          L.DomEvent.stopPropagation(o);
          if (!cagrilar.current.ekleme) cagrilar.current.onSec(y);
        })
        .addTo(g);
    }

    /* İlk açılışta bütün konumlar görünsün */
    if (!ilkSigdirma.current && konumlu.length > 0) {
      ilkSigdirma.current = true;
      const sinir = L.latLngBounds(konumlu.map((y) => [y.enlem!, y.boylam!] as [number, number]));
      h.fitBounds(sinir.pad(0.15), { maxZoom: 15 });
    }
  }, [yerler, taslak?.anahtar]);

  /* ------------------------------------------------------------ düzenlenen yer */
  useEffect(() => {
    const h = harita.current;
    if (!h) return;

    if (!taslak) {
      if (duzen.current) {
        h.removeLayer(duzen.current.daire);
        h.removeLayer(duzen.current.merkez);
        h.removeLayer(duzen.current.kenar);
        duzen.current = null;
      }
      return;
    }

    const renk = taslak.tur === "ozel" ? (taslak.aktif ? RENK.ozel : RENK.pasif) : taslak.ozelYaricap ? RENK.subeOzel : RENK.sube;

    /* Başka bir yere geçildiyse katmanlar yeniden kuruluyor */
    if (!duzen.current || duzen.current.anahtar !== taslak.anahtar) {
      if (duzen.current) {
        h.removeLayer(duzen.current.daire);
        h.removeLayer(duzen.current.merkez);
        h.removeLayer(duzen.current.kenar);
      }

      const daire = L.circle([taslak.enlem, taslak.boylam], {
        radius: taslak.yaricap,
        color: renk,
        weight: 2.5,
        fillColor: renk,
        fillOpacity: 0.22,
        interactive: false,
      }).addTo(h);

      const merkez = L.marker([taslak.enlem, taslak.boylam], {
        draggable: taslak.tur === "ozel",
        icon: L.divIcon({
          className: "",
          html: `<div class="okr-pin secili" style="--c:${renk}"></div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 36],
        }),
        zIndexOffset: 1000,
      }).addTo(h);

      const kenar = L.marker(doguNoktasi(taslak.enlem, taslak.boylam, taslak.yaricap), {
        draggable: true,
        icon: L.divIcon({
          className: "",
          html: `<div class="okr-kenar" style="--c:${renk}"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        zIndexOffset: 1100,
      })
        .bindTooltip(yaricapEtiketi(taslak.yaricap), {
          permanent: true,
          direction: "right",
          offset: [10, 0],
          className: "okr-ipucu-etiket",
        })
        .addTo(h);

      merkez.on("drag", () => {
        const p = merkez.getLatLng();
        daire.setLatLng(p);
        kenar.setLatLng(doguNoktasi(p.lat, p.lng, daire.getRadius()));
      });
      merkez.on("dragend", () => {
        const p = merkez.getLatLng();
        cagrilar.current.onTaslak({ enlem: Number(p.lat.toFixed(6)), boylam: Number(p.lng.toFixed(6)) });
      });

      kenar.on("dragstart", () => {
        surukleniyor.current = true;
      });
      kenar.on("drag", () => {
        const r = sinirla(Math.round(h.distance(daire.getLatLng(), kenar.getLatLng()) / 5) * 5, 20, 5000);
        daire.setRadius(r);
        kenar.setTooltipContent(yaricapEtiketi(r));
        cagrilar.current.onTaslak({ yaricap: r, ozelYaricap: true });
      });
      kenar.on("dragend", () => {
        surukleniyor.current = false;
        const c = daire.getLatLng();
        kenar.setLatLng(doguNoktasi(c.lat, c.lng, daire.getRadius()));
      });

      duzen.current = { daire, merkez, kenar, anahtar: taslak.anahtar };
      return;
    }

    /* Aynı yer: yalnızca değerler güncelleniyor (sürükleme bozulmasın) */
    const d = duzen.current;
    d.daire.setStyle({ color: renk, fillColor: renk });
    d.daire.setRadius(taslak.yaricap);

    const merkezSimdi = d.merkez.getLatLng();
    if (Math.abs(merkezSimdi.lat - taslak.enlem) > 1e-7 || Math.abs(merkezSimdi.lng - taslak.boylam) > 1e-7) {
      d.merkez.setLatLng([taslak.enlem, taslak.boylam]);
      d.daire.setLatLng([taslak.enlem, taslak.boylam]);
    }

    d.merkez.setIcon(
      L.divIcon({
        className: "",
        html: `<div class="okr-pin secili" style="--c:${renk}"></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 36],
      })
    );

    if (!surukleniyor.current) {
      d.kenar.setLatLng(doguNoktasi(taslak.enlem, taslak.boylam, taslak.yaricap));
      d.kenar.setTooltipContent(yaricapEtiketi(taslak.yaricap));
    }
  }, [taslak]);

  return <div ref={kutu} className={`okr-harita${ekleme ? " ekleme" : ""}`} />;
}

/* -------------------------------------------------------------------------- */
/* Kural ekleme / düzenleme penceresi                                          */
/* -------------------------------------------------------------------------- */

interface KuralModalOzellik {
  acik: boolean;
  duzenlenen: any | null;
  baslangicTuru?: KuralTuru;
  baslangicKonum?: number | null;
  konumlar: Yer[];
  onKapat: () => void;
  onKaydedildi: () => void;
}

function KuralModal({ acik, duzenlenen, baslangicTuru, baslangicKonum, konumlar, onKapat, onKaydedildi }: KuralModalOzellik) {
  const { message } = AntdApp.useApp();

  const [tur, setTur] = useState<KuralTuru>("saha");
  const [secilenler, setSecilenler] = useState<string[]>([]);
  const [konumIdleri, setKonumIdleri] = useState<number[]>([]);
  const [kendiSubesi, setKendiSubesi] = useState(false);
  const [aralik, setAralik] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [aciklama, setAciklama] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const [personel, setPersonel] = useState<any[]>([]);
  const [subeler, setSubeler] = useState<string[]>([]);
  const [unvanlar, setUnvanlar] = useState<string[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [ara, setAra] = useState("");
  const [subeSuz, setSubeSuz] = useState<string[]>([]);
  const [unvanSuz, setUnvanSuz] = useState<string[]>([]);

  useEffect(() => {
    if (!acik) return;

    if (duzenlenen) {
      setTur(duzenlenen.tur);
      setSecilenler([duzenlenen.personelKodu]);
      setKonumIdleri(duzenlenen.konumIdleri ?? []);
      setKendiSubesi(!!duzenlenen.kendiSubesi);
      setAralik(
        duzenlenen.baslangic || duzenlenen.bitis
          ? [duzenlenen.baslangic ? dayjs(duzenlenen.baslangic) : null, duzenlenen.bitis ? dayjs(duzenlenen.bitis) : null]
          : null
      );
      setAciklama(duzenlenen.aciklama ?? "");
    } else {
      setTur(baslangicTuru ?? "saha");
      setSecilenler([]);
      setKonumIdleri(baslangicKonum ? [baslangicKonum] : []);
      setKendiSubesi(false);
      setAralik(null);
      setAciklama("");
    }

    setAra("");
    setSubeSuz([]);
    setUnvanSuz([]);

    if (personel.length === 0 && !duzenlenen) {
      setYukleniyor(true);
      api
        .al<any>("/api/OkutmaKural/Personeller")
        .then((d) => {
          setPersonel(d.personeller ?? []);
          setSubeler(d.subeler ?? []);
          setUnvanlar(d.pozisyonlar ?? []);
        })
        .catch((h: any) => message.error(h.message))
        .finally(() => setYukleniyor(false));
    }
  }, [acik]);

  const suzulen = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase("tr");
    return personel.filter(
      (p) =>
        (subeSuz.length === 0 || subeSuz.includes(p.sube)) &&
        (unvanSuz.length === 0 || unvanSuz.includes(p.pozisyon)) &&
        (!q || `${p.adSoyad} ${p.kod} ${p.sube ?? ""} ${p.pozisyon ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [personel, ara, subeSuz, unvanSuz]);

  const secimSeti = useMemo(() => new Set(secilenler), [secilenler]);
  const kisiBul = (kod: string) => personel.find((p) => p.kod === kod);
  const mevcutKuralli = secilenler.filter((k) => kisiBul(k)?.kural && !duzenlenen);

  const degistir = (kod: string) =>
    setSecilenler((s) => (s.includes(kod) ? s.filter((x) => x !== kod) : [...s, kod]));

  const gosterilen = suzulen.slice(0, 400);
  const tumuSecili = suzulen.length > 0 && suzulen.every((p) => secimSeti.has(p.kod));

  const kaydet = async () => {
    if (secilenler.length === 0) return message.warning("En az bir personel seçiniz.");
    if (tur === "konum" && konumIdleri.length === 0) return message.warning("En az bir okutma konumu seçiniz.");

    setKaydediliyor(true);
    try {
      const d = await api.gonder<any>("/api/OkutmaKural/Kural", {
        personelKodlari: secilenler,
        tur,
        konumIdleri: tur === "konum" ? konumIdleri : [],
        kendiSubesi: tur === "konum" && kendiSubesi,
        baslangic: aralik?.[0] ? aralik[0].format("YYYY-MM-DD") : null,
        bitis: aralik?.[1] ? aralik[1].format("YYYY-MM-DD") : null,
        aciklama,
      });
      message.success(
        duzenlenen
          ? "Kural güncellendi."
          : `${d.eklenen} kişiye kural tanımlandı${d.guncellenen ? `, ${d.guncellenen} kişinin kuralı değiştirildi` : ""}.`
      );
      setPersonel([]);
      onKaydedildi();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open={acik}
      width={760}
      title={duzenlenen ? `Okutma kuralı · ${duzenlenen.adSoyad ?? duzenlenen.personelKodu}` : "Okutma kuralı ekle"}
      okText={duzenlenen ? "Kaydet" : secilenler.length > 0 ? `${secilenler.length} kişiye uygula` : "Uygula"}
      cancelText="Vazgeç"
      confirmLoading={kaydediliyor}
      onOk={kaydet}
      onCancel={onKapat}
      destroyOnClose
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <div className="okr-etiket">Kural türü</div>
          <div className="okr-tur-secim">
            {(Object.keys(TURLER) as KuralTuru[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`okr-tur-kart${tur === k ? " acik" : ""}`}
                style={{ ["--c" as any]: TURLER[k].renk }}
                onClick={() => setTur(k)}
              >
                <i>{TURLER[k].ikon}</i>
                <b>{TURLER[k].ad}</b>
                <small>{TURLER[k].aciklama}</small>
              </button>
            ))}
          </div>
        </div>

        {tur === "konum" && (
          <div>
            <div className="okr-etiket">Okutabileceği konumlar</div>
            {konumlar.length === 0 ? (
              <Alert
                type="warning"
                showIcon
                message="Henüz özel konum yok"
                description="Önce Kapsam Haritası sekmesinden “Konum ekle” ile Hal gibi bir konum ekleyiniz."
              />
            ) : (
              <>
                <Select
                  mode="multiple"
                  style={{ width: "100%" }}
                  placeholder="Konum seçiniz"
                  value={konumIdleri}
                  onChange={setKonumIdleri}
                  optionFilterProp="label"
                  options={konumlar.map((k) => ({
                    value: k.id!,
                    label: `${k.ad}${k.aktif === false ? " (pasif)" : ""}`,
                  }))}
                />
                <Checkbox style={{ marginTop: 8 }} checked={kendiSubesi} onChange={(e) => setKendiSubesi(e.target.checked)}>
                  Kendi şubesinin karekodunu da okutabilsin
                </Checkbox>
              </>
            )}
          </div>
        )}

        {!duzenlenen && (
          <div>
            <div className="okr-etiket">
              <span>Personel</span>
              <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>{secilenler.length} seçili</span>
            </div>

            {secilenler.length > 0 && (
              <div className="okr-secili-cipler" style={{ marginBottom: 8 }}>
                {secilenler.map((k) => {
                  const p = kisiBul(k);
                  return (
                    <Tag key={k} closable onClose={() => degistir(k)} style={{ margin: 0 }}>
                      {p?.adSoyad ?? k}
                    </Tag>
                  );
                })}
              </div>
            )}

            <div className="okr-secici">
              <div className="okr-secici-ust">
                <Input
                  allowClear
                  size="small"
                  prefix={<Search size={13} />}
                  placeholder="Ad, sicil, şube ara"
                  value={ara}
                  onChange={(e) => setAra(e.target.value)}
                />
                <Select
                  size="small"
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="Şube"
                  value={subeSuz}
                  onChange={setSubeSuz}
                  options={subeler.map((s) => ({ value: s, label: s }))}
                />
                <Select
                  size="small"
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder="Ünvan"
                  value={unvanSuz}
                  onChange={setUnvanSuz}
                  options={unvanlar.map((s) => ({ value: s, label: s }))}
                />
              </div>

              <div className="okr-secici-liste">
                {yukleniyor ? (
                  <div style={{ padding: 30, textAlign: "center" }}>
                    <Spin />
                  </div>
                ) : gosterilen.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Personel bulunamadı" />
                ) : (
                  gosterilen.map((p) => (
                    <div key={p.kod} className={`okr-kisi${secimSeti.has(p.kod) ? " secili" : ""}`} onClick={() => degistir(p.kod)}>
                      <Checkbox checked={secimSeti.has(p.kod)} />
                      <div style={{ minWidth: 0 }}>
                        <b>{p.adSoyad}</b>
                        <small>
                          {p.kod} · {p.sube ?? "—"}
                          {p.pozisyon ? ` · ${p.pozisyon}` : ""}
                        </small>
                      </div>
                      {p.kural && TURLER[p.kural as KuralTuru] && (
                        <span className="okr-tur" style={{ ["--c" as any]: TURLER[p.kural as KuralTuru].renk }}>
                          {TURLER[p.kural as KuralTuru].kisa}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="okr-secici-alt">
                <span>
                  {suzulen.length} kişi listeleniyor{suzulen.length > gosterilen.length ? ` (ilk ${gosterilen.length} gösteriliyor)` : ""}
                </span>
                <Space size={4}>
                  <Button
                    size="small"
                    type="link"
                    disabled={suzulen.length === 0}
                    onClick={() =>
                      setSecilenler((s) =>
                        tumuSecili
                          ? s.filter((k) => !suzulen.some((p) => p.kod === k))
                          : Array.from(new Set([...s, ...suzulen.map((p) => p.kod)]))
                      )
                    }
                  >
                    {tumuSecili ? "Listedekileri bırak" : "Listedekilerin tümünü seç"}
                  </Button>
                  {secilenler.length > 0 && (
                    <Button size="small" type="link" danger onClick={() => setSecilenler([])}>
                      Seçimi temizle
                    </Button>
                  )}
                </Space>
              </div>
            </div>

            {mevcutKuralli.length > 0 && (
              <Alert
                style={{ marginTop: 8 }}
                type="info"
                showIcon
                message={`${mevcutKuralli.length} kişinin mevcut kuralı bu kuralla değiştirilecek.`}
              />
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div className="okr-etiket">Geçerlilik (isteğe bağlı)</div>
            <DatePicker.RangePicker
              style={{ width: "100%" }}
              format="DD.MM.YYYY"
              allowEmpty={[true, true]}
              placeholder={["Başlangıç", "Bitiş"]}
              value={aralik as any}
              onChange={(v) => setAralik(v as any)}
            />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              Boş bırakılırsa süresiz geçerlidir.
            </Text>
          </div>
          <div>
            <div className="okr-etiket">Not</div>
            <Input.TextArea
              rows={2}
              maxLength={300}
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              placeholder="Ör. Hal alımlarından sorumlu · İK onayıyla"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Ana bileşen                                                                 */
/* -------------------------------------------------------------------------- */

export default function OkutmaKurallari() {
  const { message, modal } = AntdApp.useApp();

  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [sekme, setSekme] = useState<"harita" | "kural" | "red" | "gecmis">("harita");

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      setOzet(await api.al<Ozet>("/api/OkutmaKural/Ozet"));
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setYukleniyor(false);
    }
  }, [message]);

  /* Kurallar, reddedilenler, geçmiş */
  const [kurallar, setKurallar] = useState<any[]>([]);
  const [kuralYukleniyor, setKuralYukleniyor] = useState(false);
  const [redler, setRedler] = useState<any[]>([]);
  const [redGun, setRedGun] = useState(7);
  const [gecmis, setGecmis] = useState<any[]>([]);

  const kurallariGetir = useCallback(async () => {
    setKuralYukleniyor(true);
    try {
      setKurallar((await api.al<any>("/api/OkutmaKural/Kurallar")).kayitlar ?? []);
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKuralYukleniyor(false);
    }
  }, [message]);

  const redleriGetir = useCallback(
    async (gun = redGun) => {
      try {
        setRedler((await api.al<any>(`/api/OkutmaKural/Redler?gun=${gun}`)).kayitlar ?? []);
      } catch {
        setRedler([]);
      }
    },
    [redGun]
  );

  const gecmisiGetir = useCallback(async () => {
    try {
      setGecmis((await api.al<any>("/api/OkutmaKural/Gunluk")).kayitlar ?? []);
    } catch (h: any) {
      message.error(h.message);
    }
  }, [message]);

  useEffect(() => {
    getir();
    kurallariGetir();
    redleriGetir(7);
  }, []);

  useEffect(() => {
    if (sekme === "gecmis") gecmisiGetir();
    if (sekme === "red") redleriGetir(redGun);
  }, [sekme]);

  const hepsiniYenile = () => {
    getir();
    kurallariGetir();
    redleriGetir();
    if (sekme === "gecmis") gecmisiGetir();
  };

  /* ------------------------------------------------------------ genel ayar */
  const [ayarAcik, setAyarAcik] = useState(false);
  const [ayarYaricap, setAyarYaricap] = useState(150);
  const [ayarKendiSube, setAyarKendiSube] = useState(false);
  const [ayarKaydediliyor, setAyarKaydediliyor] = useState(false);

  const ayarAc = () => {
    if (!ozet) return;
    setAyarYaricap(ozet.ayar.varsayilanYaricap);
    setAyarKendiSube(ozet.ayar.kendiSube);
    setAyarAcik(true);
  };

  const ayarKaydet = async () => {
    setAyarKaydediliyor(true);
    try {
      await api.gonder("/api/OkutmaKural/Ayar", { varsayilanYaricap: ayarYaricap, kendiSube: ayarKendiSube });
      message.success("Okutma ayarları kaydedildi. Değişiklik en geç iki dakika içinde uygulamaya yansır.");
      setAyarAcik(false);
      getir();
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setAyarKaydediliyor(false);
    }
  };

  /* ------------------------------------------------------------ harita durumu */
  const [katman, setKatman] = useState<"sokak" | "uydu">("sokak");
  const [ekleme, setEkleme] = useState(false);
  const [taslak, setTaslak] = useState<Taslak | null>(null);
  const [odak, setOdak] = useState<HaritaOzellik["odak"]>(null);
  const [listeAra, setListeAra] = useState("");
  const [listeSuz, setListeSuz] = useState<"hepsi" | "sube" | "ozel">("hepsi");
  const [koordinatMetni, setKoordinatMetni] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const qrTuval = useRef<HTMLCanvasElement>(null);

  const varsayilan = ozet?.ayar.varsayilanYaricap ?? 150;

  const yerler: Yer[] = useMemo(() => [...(ozet?.ozelKonumlar ?? []), ...(ozet?.subeler ?? [])], [ozet]);

  const seciliYer = taslak && taslak.anahtar !== "yeni" ? yerler.find((y) => y.anahtar === taslak.anahtar) ?? null : null;

  const sec = (y: Yer) => {
    if (y.enlem == null || y.boylam == null) {
      message.info(`${y.ad} şubesinin konumu girilmemiş. “Şube Karekodları” sekmesinden konumu giriniz; konumsuz şubede mesafe denetimi yapılamaz.`);
      return;
    }
    setEkleme(false);
    setTaslak({
      anahtar: y.anahtar,
      tur: y.tur,
      ad: y.ad,
      aciklama: y.aciklama ?? "",
      enlem: y.enlem,
      boylam: y.boylam,
      ozelYaricap: y.yaricap != null,
      yaricap: y.yaricap ?? varsayilan,
      aktif: y.aktif ?? true,
    });
    setOdak({ e: y.enlem, b: y.boylam, r: y.yaricap ?? varsayilan, n: Date.now() });
  };

  const yeniNokta = (e: number, b: number) => {
    setEkleme(false);
    setOdak({ e, b, r: varsayilan, n: Date.now() });
    setTaslak({
      anahtar: "yeni",
      tur: "ozel",
      ad: "",
      aciklama: "",
      enlem: Number(e.toFixed(6)),
      boylam: Number(b.toFixed(6)),
      ozelYaricap: true,
      yaricap: varsayilan,
      aktif: true,
    });
  };

  const taslakDegis = useCallback((d: Partial<Taslak>) => setTaslak((t) => (t ? { ...t, ...d } : t)), []);

  /* Yarıçap kaydırıcı ya da kutudan değişince daire ekrana sığdırılır */
  const sigdir = (r?: number) => taslak && setOdak({ e: taslak.enlem, b: taslak.boylam, r: r ?? taslak.yaricap, n: Date.now() });

  const koordinataGit = () => {
    const k = koordinatCoz(koordinatMetni);
    if (!k) {
      message.warning("Koordinat okunamadı. Örnek: 40.1885, 29.0610 ya da Google Haritalar bağlantısı.");
      return;
    }
    setOdak({ e: k[0], b: k[1], z: 17, n: Date.now() });
  };

  const koordinattaEkle = () => {
    const k = koordinatCoz(koordinatMetni);
    if (!k) {
      message.warning("Önce koordinatı yazınız. Örnek: 40.1885, 29.0610");
      return;
    }
    yeniNokta(k[0], k[1]);
  };

  /* Seçili özel konumun karekod önizlemesi */
  useEffect(() => {
    if (!seciliYer?.qrKod || !qrTuval.current) return;
    QRCode.toCanvas(qrTuval.current, seciliYer.qrKod, {
      width: 112,
      margin: 1,
      color: { dark: "#1d2126", light: "#ffffff" },
    }).catch(() => undefined);
  }, [seciliYer?.qrKod, taslak?.anahtar]);

  const degistiMi = (() => {
    if (!taslak) return false;
    if (taslak.anahtar === "yeni") return true;
    if (!seciliYer) return false;
    const eskiYaricap = seciliYer.yaricap;
    const yeniYaricap = taslak.ozelYaricap ? taslak.yaricap : null;
    if (eskiYaricap !== yeniYaricap) return true;
    if (taslak.tur === "ozel") {
      return (
        taslak.ad.trim() !== seciliYer.ad ||
        (taslak.aciklama ?? "") !== (seciliYer.aciklama ?? "") ||
        Math.abs(taslak.enlem - (seciliYer.enlem ?? 0)) > 1e-7 ||
        Math.abs(taslak.boylam - (seciliYer.boylam ?? 0)) > 1e-7 ||
        taslak.aktif !== seciliYer.aktif
      );
    }
    return false;
  })();

  const taslakKaydet = async () => {
    if (!taslak) return;
    setKaydediliyor(true);
    try {
      if (taslak.tur === "sube") {
        await api.gonder("/api/OkutmaKural/SubeYaricap", {
          subeKodu: seciliYer?.subeKodu,
          subeAdi: seciliYer?.ad,
          yaricap: taslak.ozelYaricap ? taslak.yaricap : null,
        });
        message.success(
          taslak.ozelYaricap
            ? `${taslak.ad} için okutma mesafesi ${yaricapEtiketi(taslak.yaricap)} olarak kaydedildi.`
            : `${taslak.ad} artık genel ayarı (${yaricapEtiketi(varsayilan)}) kullanıyor.`
        );
        const d = await api.al<Ozet>("/api/OkutmaKural/Ozet");
        setOzet(d);
      } else {
        if (!taslak.ad.trim()) {
          message.warning("Konum adını yazınız. Ör. Bursa Hal");
          return;
        }
        const d = await api.gonder<any>("/api/OkutmaKural/Konum", {
          id: taslak.anahtar === "yeni" ? null : seciliYer?.id,
          ad: taslak.ad.trim(),
          aciklama: taslak.aciklama,
          enlem: taslak.enlem,
          boylam: taslak.boylam,
          yaricap: taslak.ozelYaricap ? taslak.yaricap : null,
          aktif: taslak.aktif,
        });
        message.success(taslak.anahtar === "yeni" ? `${taslak.ad} eklendi; karekodu hazır.` : "Konum kaydedildi.");
        const o = await api.al<Ozet>("/api/OkutmaKural/Ozet");
        setOzet(o);
        const yeni = o.ozelKonumlar.find((x) => x.id === d.id);
        if (yeni) {
          setTaslak({
            anahtar: yeni.anahtar,
            tur: "ozel",
            ad: yeni.ad,
            aciklama: yeni.aciklama ?? "",
            enlem: yeni.enlem!,
            boylam: yeni.boylam!,
            ozelYaricap: yeni.yaricap != null,
            yaricap: yeni.yaricap ?? o.ayar.varsayilanYaricap,
            aktif: yeni.aktif ?? true,
          });
          setOdak({ e: yeni.enlem!, b: yeni.boylam!, r: yeni.etkinYaricap, n: Date.now() });
        }
      }
    } catch (h: any) {
      message.error(h.message);
    } finally {
      setKaydediliyor(false);
    }
  };

  const kodYenile = () => {
    if (!seciliYer?.id) return;
    modal.confirm({
      title: "Karekod yenilensin mi?",
      content: "Asılı olan çıktı geçersiz olur; yeni kodu yazdırıp asmanız gerekir. Kod sızdıysa yenileyin.",
      okText: "Yenile",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.gonder(`/api/OkutmaKural/Konum/${seciliYer.id}/KodYenile`);
          message.success("Yeni karekod üretildi.");
          getir();
        } catch (h: any) {
          message.error(h.message);
        }
      },
    });
  };

  const konumSil = () => {
    if (!seciliYer?.id) return;
    modal.confirm({
      title: `${seciliYer.ad} silinsin mi?`,
      content:
        "Konuma atanmış personelin kuralından bu konum çıkarılır. Geçmiş okutma kayıtları korunur. Geçici olarak kapatmak için silmek yerine pasif yapabilirsiniz.",
      okText: "Sil",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/OkutmaKural/Konum/${seciliYer.id}`);
          message.success("Konum silindi.");
          setTaslak(null);
          getir();
          kurallariGetir();
        } catch (h: any) {
          message.error(h.message);
        }
      },
    });
  };

  const listedekiler = useMemo(() => {
    const q = listeAra.trim().toLocaleLowerCase("tr");
    return yerler.filter(
      (y) =>
        (listeSuz === "hepsi" || y.tur === listeSuz) &&
        (!q || `${y.ad} ${y.subeKodu ?? ""}`.toLocaleLowerCase("tr").includes(q))
    );
  }, [yerler, listeAra, listeSuz]);

  /* ------------------------------------------------------------ kurallar */
  const [kuralModal, setKuralModal] = useState<{ acik: boolean; duzenlenen: any | null; tur?: KuralTuru; konum?: number | null }>({
    acik: false,
    duzenlenen: null,
  });
  const [kuralAra, setKuralAra] = useState("");
  const [kuralTurSuz, setKuralTurSuz] = useState<"hepsi" | KuralTuru>("hepsi");

  const kuralSil = async (k: any) => {
    try {
      await api.sil(`/api/OkutmaKural/Kural/${k.id}`);
      message.success(`${k.adSoyad ?? k.personelKodu} için kural kaldırıldı.`);
      kurallariGetir();
      getir();
    } catch (h: any) {
      message.error(h.message);
    }
  };

  const suzulenKurallar = useMemo(() => {
    const q = kuralAra.trim().toLocaleLowerCase("tr");
    return kurallar.filter(
      (k) =>
        (kuralTurSuz === "hepsi" || k.tur === kuralTurSuz) &&
        (!q ||
          `${k.adSoyad ?? ""} ${k.personelKodu} ${k.sube ?? ""} ${k.pozisyon ?? ""} ${(k.konumlar ?? []).map((x: any) => x.ad).join(" ")}`
            .toLocaleLowerCase("tr")
            .includes(q))
    );
  }, [kurallar, kuralAra, kuralTurSuz]);

  const ozelKonumlar = ozet?.ozelKonumlar ?? [];
  const s = ozet?.sayilar;

  /* ------------------------------------------------------------ çizim */
  return (
    <div>
      {/* KPI kartları */}
      <div className="okr-kpi">
        <button className="okr-k okr-buyuk" onClick={ayarAc}>
          <span className="okr-halka" />
          <div>
            <span>
              <Ruler size={13} /> Varsayılan okutma mesafesi
            </span>
            <b>
              {varsayilan}
              <em>metre</em>
            </b>
            <small>
              {s?.ozelYaricapli ? `${s.ozelYaricapli} şubede özel mesafe · ` : ""}
              <span className="okr-duzenle">Değiştir</span>
            </small>
          </div>
        </button>

        {(
          [
            ["saha", s?.saha, "her şubede okutabilir", () => { setKuralTurSuz("saha"); setSekme("kural"); }],
            ["konum", s?.konum, "atandığı konumda okutur", () => { setKuralTurSuz("konum"); setSekme("kural"); }],
            ["muaf", s?.muaf, "okutma beklenmez", () => { setKuralTurSuz("muaf"); setSekme("kural"); }],
            ["serbest", s?.serbest, "her yerden karekodu", () => { setKuralTurSuz("serbest"); setSekme("kural"); }],
          ] as [KuralTuru, number | undefined, string, () => void][]
        ).map(([t, v, alt, f]) => (
          <button key={t} className="okr-k" style={{ ["--c" as any]: TURLER[t].renk }} onClick={f}>
            <span>
              <i>{TURLER[t].ikon}</i> {TURLER[t].ad}
            </span>
            <b>{v ?? "—"}</b>
            <small>{alt}</small>
          </button>
        ))}

        <button
          className="okr-k"
          style={{ ["--c" as any]: RENK.ozel }}
          onClick={() => {
            setSekme("harita");
            setListeSuz("ozel");
          }}
        >
          <span>
            <i>
              <MapPin size={15} strokeWidth={2.2} />
            </i>{" "}
            Özel konum
          </span>
          <b>{s?.ozelKonum ?? "—"}</b>
          <small>Hal gibi, kendi karekoduyla</small>
        </button>
      </div>

      {ozet && !ozet.ayar.kendiSube && (
        <div className="okr-bilgi">
          <Info size={15} />
          <div>
            Şu anda kendi şube zorunluluğu <b>kapalı</b>: kuralı olmayan personel de her şubenin karekodunu okutabiliyor
            (yalnızca mesafe denetimi var). Personeli kendi şubesiyle sınırlamak için{" "}
            <a onClick={ayarAc}>genel ayarlardan</a> açabilirsiniz; saha personeli o zaman da her şubede okutabilir. Hal/konum
            kuralı bu ayardan bağımsız olarak her zaman uygulanır.
          </div>
        </div>
      )}

      {ozet && ozet.ayar.kendiSube && (s?.eslesmeyen ?? 0) > 0 && (
        <div className="okr-bilgi uyari">
          <Info size={15} />
          <div>
            <b>{s!.eslesmeyen} çalışan personelin şubesi</b> hiçbir karekod şubesiyle eşleşmedi; bu kişiler için kendi şube
            denetimi yapılamıyor ve her şubede okutabiliyorlar.
            {s!.eslesmeyenOrnek?.length ? ` Örnek: ${s!.eslesmeyenOrnek.join(", ")}.` : ""}
          </div>
        </div>
      )}

      <div className="okr-sekmeler">
        <button className={sekme === "harita" ? "acik" : ""} onClick={() => setSekme("harita")}>
          <HaritaIkon size={15} /> Kapsam Haritası <em>{yerler.filter((y) => y.enlem != null).length}</em>
        </button>
        <button className={sekme === "kural" ? "acik" : ""} onClick={() => setSekme("kural")}>
          <Users size={15} /> Personel Kuralları <em>{kurallar.length}</em>
        </button>
        <button className={sekme === "red" ? "acik" : ""} onClick={() => setSekme("red")}>
          <Ban size={15} /> Reddedilen Okutmalar{" "}
          <em className={redler.length ? "kirmizi" : ""}>{redler.length}</em>
        </button>
        <button className={sekme === "gecmis" ? "acik" : ""} onClick={() => setSekme("gecmis")}>
          <History size={15} /> Değişiklik Geçmişi
        </button>
        <span style={{ flex: 1 }} />
        <Button
          type="text"
          size="small"
          icon={<RefreshCw size={14} />}
          loading={yukleniyor || kuralYukleniyor}
          onClick={hepsiniYenile}
          style={{ alignSelf: "center" }}
        >
          Yenile
        </Button>
      </div>

      {/* ============================================================ HARİTA */}
      {sekme === "harita" && (
        <>
          <div className="okr-harita-alani">
            <div className="okr-liste">
              <div className="okr-liste-ust">
                <Input
                  allowClear
                  prefix={<Search size={14} />}
                  placeholder="Şube ya da konum ara"
                  value={listeAra}
                  onChange={(e) => setListeAra(e.target.value)}
                />
                <Segmented
                  block
                  size="small"
                  value={listeSuz}
                  onChange={(v) => setListeSuz(v as any)}
                  options={[
                    { label: "Tümü", value: "hepsi" },
                    { label: `Şubeler`, value: "sube" },
                    { label: `Özel`, value: "ozel" },
                  ]}
                />
              </div>

              <div className="okr-liste-ic">
                {!ozet && yukleniyor && (
                  <div style={{ padding: 30, textAlign: "center" }}>
                    <Spin />
                  </div>
                )}

                {(["ozel", "sube"] as const).map((grup) => {
                  const ogeler = listedekiler.filter((y) => y.tur === grup);
                  if (ogeler.length === 0 && !(grup === "ozel" && listeSuz !== "sube")) return null;
                  return (
                    <div key={grup}>
                      <div className="okr-grup">
                        <span>{grup === "ozel" ? "Özel konumlar" : "Şube karekodları"}</span>
                        <span>{ogeler.length}</span>
                      </div>
                      {grup === "ozel" && ogeler.length === 0 && (
                        <div style={{ padding: "4px 8px 8px", fontSize: 12, color: "#8a8f98" }}>
                          Henüz özel konum yok. Haritanın üstündeki <b>Konum ekle</b> ile Hal gibi bir yer ekleyin.
                        </div>
                      )}
                      {ogeler.map((y) => {
                        const renk = yerRengi(y);
                        const konumsuz = y.enlem == null;
                        return (
                          <div
                            key={y.anahtar}
                            className={`okr-oge${taslak?.anahtar === y.anahtar ? " secili" : ""}${konumsuz ? " konumsuz" : ""}${
                              y.aktif === false ? " pasif" : ""
                            }`}
                            onClick={() => sec(y)}
                          >
                            <span className="okr-nokta" style={{ ["--c" as any]: konumsuz ? "#c4c9cf" : renk }} />
                            <div style={{ minWidth: 0 }}>
                              <div className="okr-oge-ad">{y.ad}</div>
                              <div className="okr-oge-alt">
                                {konumsuz ? (
                                  "konum girilmemiş · mesafe denetimi yok"
                                ) : (
                                  <>
                                    7 gün: {y.okutma7} okutma
                                    {y.red7 > 0 && (
                                      <>
                                        {" · "}
                                        <b>{y.red7} ret</b>
                                      </>
                                    )}
                                    {y.tur === "ozel" && y.aktif === false ? " · pasif" : ""}
                                  </>
                                )}
                              </div>
                            </div>
                            {!konumsuz && (
                              <Tooltip title={y.yaricap ? "Bu yere özel mesafe" : "Genel ayar"}>
                                <span className={`okr-m${y.yaricap ? " ozel" : ""}`}>{yaricapEtiketi(y.etkinYaricap)}</span>
                              </Tooltip>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="okr-harita-kutu">
              <KapsamHaritasi
                yerler={yerler}
                taslak={taslak}
                ekleme={ekleme}
                katman={katman}
                odak={odak}
                onSec={sec}
                onYeniNokta={yeniNokta}
                onTaslak={taslakDegis}
              />

              <div className="okr-arac">
                <div className="okr-cam okr-katman">
                  <button className={katman === "sokak" ? "acik" : ""} onClick={() => setKatman("sokak")}>
                    <Layers size={13} /> Harita
                  </button>
                  <button className={katman === "uydu" ? "acik" : ""} onClick={() => setKatman("uydu")}>
                    <Satellite size={13} /> Uydu
                  </button>
                </div>

                <Space.Compact className="okr-cam" style={{ borderRadius: 10 }}>
                  <Input
                    style={{ width: 230 }}
                    prefix={<LocateFixed size={14} />}
                    placeholder="Koordinat: 40.1885, 29.0610"
                    value={koordinatMetni}
                    onChange={(e) => setKoordinatMetni(e.target.value)}
                    onPressEnter={koordinataGit}
                  />
                  <Tooltip title="Koordinata git">
                    <Button icon={<Navigation size={14} />} onClick={koordinataGit} />
                  </Tooltip>
                  <Tooltip title="Bu koordinata özel konum ekle">
                    <Button icon={<Plus size={14} />} onClick={koordinattaEkle} />
                  </Tooltip>
                </Space.Compact>

                <span className="okr-bosluk" />

                <Button
                  type={ekleme ? "default" : "primary"}
                  icon={ekleme ? <X size={14} /> : <MapPin size={14} />}
                  onClick={() => {
                    setEkleme((e) => !e);
                    if (!ekleme) setTaslak(null);
                  }}
                  style={{ boxShadow: "0 2px 10px rgba(31,41,51,.18)" }}
                >
                  {ekleme ? "Vazgeç" : "Konum ekle"}
                </Button>
              </div>

              {ekleme && (
                <div className="okr-ekle-serit">
                  <MapPin size={14} /> Yeni okutma konumunun yerine haritada tıklayın
                  <button onClick={() => setEkleme(false)}>Vazgeç</button>
                </div>
              )}

              {!taslak && (
                <div className="okr-cam okr-lejant">
                  <div>
                    <i style={{ ["--c" as any]: RENK.sube }} /> Şube · genel mesafe ({varsayilan} m)
                  </div>
                  <div>
                    <i style={{ ["--c" as any]: RENK.subeOzel }} /> Şube · özel mesafe
                  </div>
                  <div>
                    <i style={{ ["--c" as any]: RENK.ozel }} /> Özel konum (Hal vb.)
                  </div>
                </div>
              )}

              {/* ---------------------------------------- seçili yer paneli */}
              {taslak && (
                <div className="okr-cam okr-panel">
                  <div className="okr-panel-ust">
                    <span
                      className="okr-rozet"
                      style={{ ["--c" as any]: taslak.tur === "ozel" ? RENK.ozel : taslak.ozelYaricap ? RENK.subeOzel : RENK.sube }}
                    >
                      {taslak.tur === "ozel" ? <MapPinned size={17} /> : <QrCode size={17} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{taslak.anahtar === "yeni" ? "Yeni okutma konumu" : taslak.ad}</b>
                      <small>
                        {taslak.tur === "ozel"
                          ? "Özel konum · kendi karekoduyla"
                          : `Şube · ${seciliYer?.subeKodu ?? ""}${seciliYer?.icard ? ` · ${seciliYer.icard} iCard karekodu` : ""}`}
                      </small>
                    </div>
                    <Button type="text" size="small" icon={<X size={15} />} onClick={() => setTaslak(null)} />
                  </div>

                  <div className="okr-panel-ic">
                    {seciliYer && (
                      <div className="okr-istat">
                        <div>
                          <b>{seciliYer.okutma7}</b>
                          <span>okutma · 7 gün</span>
                        </div>
                        <div>
                          <b className={seciliYer.red7 ? "kirmizi" : ""}>{seciliYer.red7}</b>
                          <span>reddedilen</span>
                        </div>
                        <div>
                          <b>{seciliYer.personel ?? "—"}</b>
                          <span>{seciliYer.tur === "ozel" ? "atanmış kişi" : "personel"}</span>
                        </div>
                      </div>
                    )}

                    {taslak.tur === "ozel" && seciliYer?.qrKod && (
                      <div>
                        <div className="okr-etiket">Karekod</div>
                        <div className="okr-qr">
                          <canvas ref={qrTuval} />
                          <div className="okr-qr-dugmeler">
                            <Button
                              size="small"
                              icon={<Printer size={13} />}
                              onClick={async () => {
                                if (!(await yazdir(seciliYer.ad, seciliYer.qrKod!, seciliYer.etkinYaricap)))
                                  message.error("Açılır pencere engellendi. Tarayıcı ayarını kontrol ediniz.");
                              }}
                            >
                              Yazdır
                            </Button>
                            <Button size="small" icon={<Download size={13} />} onClick={() => pngIndir(seciliYer.ad, seciliYer.qrKod!, seciliYer.etkinYaricap)}>
                              PNG indir
                            </Button>
                            <Button size="small" icon={<FileText size={13} />} onClick={() => pdfIndir(seciliYer.ad, seciliYer.qrKod!, seciliYer.etkinYaricap)}>
                              PDF indir
                            </Button>
                          </div>
                        </div>
                        <div className="okr-kod" style={{ marginTop: 6 }}>
                          {seciliYer.qrKod}
                        </div>
                      </div>
                    )}

                    {taslak.tur === "ozel" && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div>
                          <div className="okr-etiket">Konum adı</div>
                          <Input
                            value={taslak.ad}
                            maxLength={120}
                            placeholder="Ör. Bursa Hal"
                            onChange={(e) => taslakDegis({ ad: e.target.value })}
                          />
                        </div>
                        <Input
                          size="small"
                          value={taslak.aciklama}
                          maxLength={300}
                          placeholder="Açıklama (isteğe bağlı)"
                          onChange={(e) => taslakDegis({ aciklama: e.target.value })}
                        />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          <InputNumber
                            size="small"
                            style={{ width: "100%" }}
                            step={0.0001}
                            value={taslak.enlem}
                            onChange={(v) => v != null && taslakDegis({ enlem: Number(v) })}
                            addonBefore="E"
                          />
                          <InputNumber
                            size="small"
                            style={{ width: "100%" }}
                            step={0.0001}
                            value={taslak.boylam}
                            onChange={(v) => v != null && taslakDegis({ boylam: Number(v) })}
                            addonBefore="B"
                          />
                        </div>
                        <div className="okr-ipucu">İğneyi sürükleyerek konumu taşıyabilirsiniz.</div>
                      </div>
                    )}

                    <div className="okr-yaricap">
                      <div className="okr-etiket">
                        <span>Kapsam yarıçapı</span>
                        {taslak.tur === "sube" && (
                          <Space size={6} style={{ textTransform: "none", letterSpacing: 0 }}>
                            <span style={{ fontWeight: 600 }}>Özel</span>
                            <Switch
                              size="small"
                              checked={taslak.ozelYaricap}
                              onChange={(v) => taslakDegis({ ozelYaricap: v, yaricap: v ? taslak.yaricap : varsayilan })}
                            />
                          </Space>
                        )}
                      </div>
                      <div className="okr-yaricap-ust">
                        <b>
                          {taslak.yaricap}
                          <em>m</em>
                        </b>
                        <InputNumber
                          size="small"
                          min={20}
                          max={5000}
                          step={10}
                          value={taslak.yaricap}
                          disabled={taslak.tur === "sube" && !taslak.ozelYaricap}
                          onChange={(v) => v != null && taslakDegis({ yaricap: sinirla(Number(v), 20, 5000), ozelYaricap: true })}
                          onBlur={() => sigdir()}
                          onPressEnter={() => sigdir()}
                          style={{ width: 100 }}
                          addonAfter="m"
                        />
                      </div>
                      <Slider
                        min={20}
                        max={1000}
                        step={5}
                        value={Math.min(taslak.yaricap, 1000)}
                        disabled={taslak.tur === "sube" && !taslak.ozelYaricap}
                        marks={YARICAP_ISARET}
                        tooltip={{ formatter: (v) => `${v} m` }}
                        onChange={(v) => taslakDegis({ yaricap: v as number, ozelYaricap: true })}
                        onChangeComplete={(v) => sigdir(v as number)}
                      />
                      <div className="okr-ipucu" style={{ marginTop: 6 }}>
                        {taslak.tur === "sube" && !taslak.ozelYaricap
                          ? `Genel ayar (${varsayilan} m) uygulanıyor. Bu şubeye ayrı mesafe vermek için “Özel”i açın.`
                          : "Dairenin kenarındaki beyaz tutamacı sürükleyerek de ayarlayabilirsiniz."}
                      </div>
                    </div>

                    {taslak.tur === "ozel" && (
                      <Space style={{ justifyContent: "space-between", width: "100%" }}>
                        <span style={{ fontSize: 12.5 }}>
                          <b>Aktif</b>{" "}
                          <Text type="secondary" style={{ fontSize: 11.5 }}>
                            pasif konumda okutma yapılamaz
                          </Text>
                        </span>
                        <Switch checked={taslak.aktif} onChange={(v) => taslakDegis({ aktif: v })} />
                      </Space>
                    )}

                    {taslak.tur === "ozel" && seciliYer && (
                      <Space wrap size={6}>
                        <Button
                          size="small"
                          icon={<Users size={13} />}
                          onClick={() => setKuralModal({ acik: true, duzenlenen: null, tur: "konum", konum: seciliYer.id })}
                        >
                          Personel ata
                        </Button>
                        <Button size="small" icon={<RefreshCw size={13} />} onClick={kodYenile}>
                          Kodu yenile
                        </Button>
                        <Button size="small" danger icon={<Trash2 size={13} />} onClick={konumSil}>
                          Sil
                        </Button>
                      </Space>
                    )}

                    {taslak.tur === "sube" && (
                      <div className="okr-ipucu">
                        Şubenin konumu ve karekodları “Şube Karekodları” sekmesinden yönetilir.
                      </div>
                    )}
                  </div>

                  <div className="okr-panel-alt">
                    <Button onClick={() => setTaslak(null)}>{degistiMi ? "Vazgeç" : "Kapat"}</Button>
                    <Button type="primary" loading={kaydediliyor} disabled={!degistiMi} onClick={taslakKaydet}>
                      {taslak.anahtar === "yeni" ? "Konumu ekle" : "Kaydet"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Son reddedilenler */}
          <div className="okr-red-kart">
            <div className="okr-red-ust">
              <b>Son reddedilen okutmalar</b>
              <Button size="small" type="link" onClick={() => setSekme("red")}>
                Tümünü gör
              </Button>
            </div>
            {redler.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Son 7 günde reddedilen okutma yok.
              </Text>
            ) : (
              redler.slice(0, 5).map((r) => (
                <div key={r.id} className="okr-red-satir">
                  <div>
                    {dayjs(r.zaman).format("DD.MM HH:mm")}
                    <small>{SEBEP[r.sebep]?.ad ?? r.sebep}</small>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <b><PersonelAdi kod={r.personelKodu}>{r.adSoyad || r.personelKodu}</PersonelAdi></b>
                    <small>{r.sube}</small>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {r.yerAdi}
                    <small>{r.ayrinti}</small>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {r.mesafe != null ? (
                      <>
                        <span className="okr-mesafe">{yaricapEtiketi(r.mesafe)}</span>
                        <small>sınır {r.sinir} m</small>
                      </>
                    ) : (
                      <Tag color={SEBEP[r.sebep]?.renk}>{SEBEP[r.sebep]?.ad ?? r.sebep}</Tag>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ============================================================ KURALLAR */}
      {sekme === "kural" && (
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <Input
              allowClear
              prefix={<Search size={14} />}
              placeholder="Personel, şube, konum ara"
              style={{ width: 260 }}
              value={kuralAra}
              onChange={(e) => setKuralAra(e.target.value)}
            />
            <Segmented
              value={kuralTurSuz}
              onChange={(v) => setKuralTurSuz(v as any)}
              options={[
                { label: `Tümü (${kurallar.length})`, value: "hepsi" },
                ...(Object.keys(TURLER) as KuralTuru[]).map((t) => ({
                  label: `${TURLER[t].kisa} (${kurallar.filter((k) => k.tur === t).length})`,
                  value: t,
                })),
              ]}
            />
            <span style={{ flex: 1 }} />
            <Button type="primary" icon={<Plus size={14} />} onClick={() => setKuralModal({ acik: true, duzenlenen: null })}>
              Kural ekle
            </Button>
          </div>

          <Tablo
            rowKey="id"
            size="small"
            loading={kuralYukleniyor}
            dataSource={suzulenKurallar}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Henüz kural yok. Saha, Hal ya da muaf personeli “Kural ekle” ile tanımlayın."
                />
              ),
            }}
            columns={[
              {
                title: "Personel",
                dataIndex: "adSoyad",
                render: (v: string, k: any) => (
                  <div>
                    <b><PersonelAdi kod={k.personelKodu}>{v ?? k.personelKodu}</PersonelAdi></b>
                    <div>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        {k.personelKodu}
                        {k.pozisyon ? ` · ${k.pozisyon}` : ""}
                      </Text>
                    </div>
                  </div>
                ),
              },
              { title: "Şube", dataIndex: "sube", width: 150, ellipsis: true },
              {
                title: "Kural",
                dataIndex: "tur",
                width: 170,
                render: (t: KuralTuru) =>
                  TURLER[t] ? (
                    <span className="okr-tur" style={{ ["--c" as any]: TURLER[t].renk }}>
                      {TURLER[t].ikon} {TURLER[t].ad}
                    </span>
                  ) : (
                    t
                  ),
              },
              {
                title: "Okutabileceği yer",
                key: "yer",
                render: (_: any, k: any) =>
                  k.tur === "saha" ? (
                    <Text type="secondary">Bütün şubeler</Text>
                  ) : k.tur === "muaf" ? (
                    <Text type="secondary">Okutma beklenmez</Text>
                  ) : k.tur === "serbest" ? (
                    <Text type="secondary">Kendi şubesi + her yerden karekodu</Text>
                  ) : (
                    <Space size={4} wrap>
                      {(k.konumlar ?? []).map((x: any) => (
                        <Tag key={x.id} color={x.aktif ? "volcano" : "default"} style={{ margin: 0 }}>
                          {x.ad}
                          {x.aktif ? "" : " (pasif)"}
                        </Tag>
                      ))}
                      {k.kendiSubesi && <Tag style={{ margin: 0 }}>+ kendi şubesi</Tag>}
                    </Space>
                  ),
              },
              {
                title: "Geçerlilik",
                key: "gecerlilik",
                width: 175,
                render: (_: any, k: any) => (
                  <div>
                    <div style={{ fontSize: 12.5 }}>
                      {!k.baslangic && !k.bitis
                        ? "Süresiz"
                        : `${k.baslangic ? dayjs(k.baslangic).format("DD.MM.YYYY") : "…"} – ${
                            k.bitis ? dayjs(k.bitis).format("DD.MM.YYYY") : "…"
                          }`}
                    </div>
                    {k.durum === "gecerli" ? (
                      <Tag color="green" style={{ marginTop: 2 }}>
                        geçerli
                      </Tag>
                    ) : k.durum === "baslamadi" ? (
                      <Tag color="blue" style={{ marginTop: 2 }}>
                        başlamadı
                      </Tag>
                    ) : (
                      <Tag style={{ marginTop: 2 }}>süresi doldu</Tag>
                    )}
                  </div>
                ),
              },
              {
                title: "Not / Tanımlayan",
                key: "not",
                width: 200,
                render: (_: any, k: any) => (
                  <div style={{ fontSize: 12 }}>
                    {k.aciklama && <div style={{ marginBottom: 2 }}>{k.aciklama}</div>}
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {k.guncelleyen ?? k.olusturan} · {dayjs(k.guncelleme ?? k.olusturma).format("DD.MM.YYYY HH:mm")}
                    </Text>
                  </div>
                ),
              },
              {
                title: "",
                key: "islem",
                width: 140,
                align: "right" as const,
                render: (_: any, k: any) => (
                  <Space size={4}>
                    <Button size="small" onClick={() => setKuralModal({ acik: true, duzenlenen: k })}>
                      Düzenle
                    </Button>
                    <Popconfirm
                      title="Kural kaldırılsın mı?"
                      description="Personel genel kurallara döner."
                      okText="Kaldır"
                      cancelText="Vazgeç"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => kuralSil(k)}
                    >
                      <Button size="small" danger>
                        Kaldır
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* ============================================================ REDDEDİLENLER */}
      {sekme === "red" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Segmented
              value={redGun}
              onChange={(v) => {
                setRedGun(v as number);
                redleriGetir(v as number);
              }}
              options={[
                { label: "Bugün", value: 1 },
                { label: "7 gün", value: 7 },
                { label: "30 gün", value: 30 },
              ]}
            />
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Mesafe, yetki ya da konum izni nedeniyle kabul edilmeyen okutmalar. Personel uygulamada hata mesajını görür.
            </Text>
          </div>
          <Tablo
            rowKey="id"
            size="small"
            dataSource={redler}
            pagination={{ pageSize: 25, showSizeChanger: false }}
            locale={{ emptyText: "Bu aralıkta reddedilen okutma yok." }}
            columns={[
              { title: "Zaman", dataIndex: "zaman", width: 125, render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm") },
              {
                title: "Personel",
                dataIndex: "adSoyad",
                render: (v: string, r: any) => (
                  <div>
                    <b><PersonelAdi kod={r.personelKodu}>{v || r.personelKodu}</PersonelAdi></b>
                    <div>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        {r.personelKodu} · {r.sube ?? "—"}
                      </Text>
                    </div>
                  </div>
                ),
              },
              { title: "Okutulan yer", dataIndex: "yerAdi", width: 170, ellipsis: true },
              {
                title: "Sebep",
                dataIndex: "sebep",
                width: 130,
                render: (v: string) => <Tag color={SEBEP[v]?.renk}>{SEBEP[v]?.ad ?? v}</Tag>,
              },
              {
                title: "Mesafe / sınır",
                key: "mesafe",
                width: 130,
                render: (_: any, r: any) =>
                  r.mesafe != null ? (
                    <span>
                      <span className="okr-mesafe">{yaricapEtiketi(r.mesafe)}</span>
                      <Text type="secondary"> / {r.sinir} m</Text>
                    </span>
                  ) : (
                    "—"
                  ),
              },
              { title: "Ayrıntı", dataIndex: "ayrinti", ellipsis: true },
              {
                title: "",
                key: "harita",
                width: 70,
                render: (_: any, r: any) =>
                  r.enlem != null ? (
                    <Tooltip title="Okutmanın denendiği yeri haritada göster">
                      <Button
                        size="small"
                        type="text"
                        icon={<MapPin size={14} />}
                        onClick={() => {
                          setSekme("harita");
                          setOdak({ e: r.enlem, b: r.boylam, z: 16, n: Date.now() });
                        }}
                      />
                    </Tooltip>
                  ) : null,
              },
            ]}
          />
        </div>
      )}

      {/* ============================================================ GEÇMİŞ */}
      {sekme === "gecmis" && (
        <Tablo
          rowKey="id"
          size="small"
          dataSource={gecmis}
          pagination={{ pageSize: 25, showSizeChanger: false }}
          locale={{ emptyText: "Henüz değişiklik kaydı yok." }}
          columns={[
            { title: "Zaman", dataIndex: "zaman", width: 140, render: (v: string) => dayjs(v).format("DD.MM.YYYY HH:mm") },
            {
              title: "İşlem",
              dataIndex: "islem",
              width: 110,
              render: (v: string) => {
                const ad: Record<string, [string, string]> = {
                  ekle: ["Kural eklendi", "green"],
                  guncelle: ["Kural değişti", "blue"],
                  kaldir: ["Kural kaldırıldı", "red"],
                  ayar: ["Genel ayar", "purple"],
                  yaricap: ["Şube mesafesi", "geekblue"],
                  konum: ["Özel konum", "volcano"],
                };
                return <Tag color={ad[v]?.[1]}>{ad[v]?.[0] ?? v}</Tag>;
              },
            },
            {
              title: "Personel",
              dataIndex: "adSoyad",
              width: 190,
              render: (v: string, r: any) => (r.personelKodu ? `${v ?? ""} (${r.personelKodu})` : "—"),
            },
            { title: "Ayrıntı", dataIndex: "ayrinti" },
            { title: "Yapan", dataIndex: "yapan", width: 140 },
          ]}
        />
      )}

      {/* ============================================================ PENCERELER */}
      <KuralModal
        acik={kuralModal.acik}
        duzenlenen={kuralModal.duzenlenen}
        baslangicTuru={kuralModal.tur}
        baslangicKonum={kuralModal.konum}
        konumlar={ozelKonumlar}
        onKapat={() => setKuralModal({ acik: false, duzenlenen: null })}
        onKaydedildi={() => {
          setKuralModal({ acik: false, duzenlenen: null });
          kurallariGetir();
          getir();
        }}
      />

      <Modal
        open={ayarAcik}
        width={560}
        title="Genel okutma ayarları"
        okText="Kaydet"
        cancelText="Vazgeç"
        confirmLoading={ayarKaydediliyor}
        onOk={ayarKaydet}
        onCancel={() => setAyarAcik(false)}
      >
        <div style={{ display: "grid", gap: 18 }}>
          <div>
            <div className="okr-etiket">Varsayılan okutma mesafesi</div>
            <div className="okr-yaricap">
              <div className="okr-yaricap-ust">
                <b>
                  {ayarYaricap}
                  <em>m</em>
                </b>
                <InputNumber
                  min={ozet?.ayar.enAz ?? 20}
                  max={ozet?.ayar.enFazla ?? 5000}
                  step={10}
                  value={ayarYaricap}
                  onChange={(v) => v != null && setAyarYaricap(Number(v))}
                  addonAfter="m"
                  style={{ width: 120 }}
                />
              </div>
              <Slider
                min={20}
                max={1000}
                step={5}
                value={Math.min(ayarYaricap, 1000)}
                marks={YARICAP_ISARET}
                tooltip={{ formatter: (v) => `${v} m` }}
                onChange={(v) => setAyarYaricap(v as number)}
              />
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Özel mesafe verilmemiş bütün şubelerde geçerlidir. Telefon konumu kapalı alanlarda 30–80 metre sapabilir;
              çok küçük değer personelin mağaza içinden okutamamasına yol açar.
            </Text>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <Switch checked={ayarKendiSube} onChange={setAyarKendiSube} style={{ marginTop: 2 }} />
            <div>
              <b>Personel yalnızca kendi şubesinde okutabilsin</b>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.55 }}>
                Açıkken kuralı olmayan personel yalnızca Mikro'daki şubesinin karekodunu okutabilir. Saha personeli her
                şubede okutmaya devam eder. Şubesi hiçbir karekod şubesiyle eşleşmeyen personel (genel müdürlük gibi)
                denetlenemediği için engellenmez.
                {s?.eslesmeyen != null && (
                  <>
                    {" "}
                    Şu an <b>{s.eslesmeyen}</b> kişinin şubesi eşleşmiyor.
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
