/**
 * Patron görünümü simgeleri
 * ---------------------------------------------------------------------------
 * Onaylanan tasarımdaki çizgi simgeler, birebir aynı yollarla. Genel
 * `Simge` bileşenine eklenmedi: oradaki simgeler alt menünün dolgulu /
 * çizgili ikili düzenine göre çizilmiş; buradakiler yalnızca çizgi ve
 * yalnızca patron ekranlarında kullanılıyor. Alt menüdeki beş sekme
 * simgesi ise `Simge` içinde (dolgulu hâlleri gerektiği için).
 */

import Svg, { Path, Rect, Circle } from "react-native-svg";

/** Bu dosyadaki simge adları. Sunucunun gönderdiği ad (sunucu tanımlı
    sayfalar) burada yoksa "belge" çiziliyor; boş daire anlamsız kalıyordu. */
export const IKON_ADLARI = [
  "ev", "magaza", "onay", "ekip", "kart", "ok", "geri", "qr", "kisiEkle", "kadro", "takvim", "grafik", "ara",
  "kalkan", "belge", "uyari", "saat", "tik", "carpi", "telefon", "mesaj", "para", "cikis", "giris", "rotasyon",
  "yenile", "kisi",
  /* Sunucu tanımlı sayfalar için (03.10.2026): ileride eklenecek sayfalar
     uygulama güncellenmeden bu simgelerden birini seçebilsin. */
  "megafon", "zil", "ayar", "yildiz", "indir",
];

export const ikonAdi = (ad) => (IKON_ADLARI.includes(ad) ? ad : "belge");

export default function Ikon({ ad, boyut = 20, renkli = "#1c2419", kalinlik = 2 }) {
  const ortak = {
    width: boyut,
    height: boyut,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: renkli,
    strokeWidth: kalinlik,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  switch (ad) {
    case "ev":
      return (
        <Svg {...ortak}>
          <Path d="M3 10.5 12 3l9 7.5" />
          <Path d="M5 9.5V20h14V9.5" />
          <Path d="M10 20v-6h4v6" />
        </Svg>
      );
    case "magaza":
      return (
        <Svg {...ortak}>
          <Path d="M3 9l1.5-5h15L21 9" />
          <Path d="M4 9v11h16V9" />
          <Path d="M3 9h18" />
          <Path d="M9 20v-6h6v6" />
        </Svg>
      );
    case "onay":
      return (
        <Svg {...ortak}>
          <Path d="M9 12l2 2 4-4" />
          <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        </Svg>
      );
    case "ekip":
      return (
        <Svg {...ortak}>
          <Circle cx="9" cy="8" r="3.5" />
          <Path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
          <Path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
          <Path d="M18 14.6c2 .7 3.2 2.5 3.6 5.4" />
        </Svg>
      );
    case "kart":
      return (
        <Svg {...ortak}>
          <Rect x="2.5" y="5" width="19" height="14" rx="3" />
          <Path d="M2.5 10h19" />
          <Path d="M6.5 15h4" />
        </Svg>
      );
    case "ok":
      return (
        <Svg {...ortak}>
          <Path d="M9 6l6 6-6 6" />
        </Svg>
      );
    case "geri":
      return (
        <Svg {...ortak}>
          <Path d="M15 6l-6 6 6 6" />
        </Svg>
      );
    case "qr":
      return (
        <Svg {...ortak}>
          <Rect x="3" y="3" width="7" height="7" rx="1.5" />
          <Rect x="14" y="3" width="7" height="7" rx="1.5" />
          <Rect x="3" y="14" width="7" height="7" rx="1.5" />
          <Path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
        </Svg>
      );
    case "kisiEkle":
      return (
        <Svg {...ortak}>
          <Circle cx="9" cy="8" r="3.5" />
          <Path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.6 0 3 .5 4.2 1.4" />
          <Path d="M18 14v6M15 17h6" />
        </Svg>
      );
    case "kadro":
      return (
        <Svg {...ortak}>
          <Path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
        </Svg>
      );
    case "takvim":
      return (
        <Svg {...ortak}>
          <Rect x="3" y="4.5" width="18" height="16" rx="3" />
          <Path d="M3 9.5h18M8 3v3M16 3v3" />
        </Svg>
      );
    case "grafik":
      return (
        <Svg {...ortak}>
          <Path d="M3 17l5-5 4 3 8-8" />
          <Path d="M15 7h5v5" />
        </Svg>
      );
    case "ara":
      return (
        <Svg {...ortak}>
          <Circle cx="11" cy="11" r="6.5" />
          <Path d="M20 20l-4-4" />
        </Svg>
      );
    case "kalkan":
      return (
        <Svg {...ortak}>
          <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
          <Path d="M12 8v4M12 15.5v.01" />
        </Svg>
      );
    case "belge":
      return (
        <Svg {...ortak}>
          <Path d="M7 3h7l5 5v13H7z" />
          <Path d="M14 3v5h5M10 13h6M10 17h6" />
        </Svg>
      );
    case "uyari":
      return (
        <Svg {...ortak}>
          <Path d="M12 4 2.5 20h19z" />
          <Path d="M12 10v4M12 17v.01" />
        </Svg>
      );
    case "saat":
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="12" r="8.5" />
          <Path d="M12 7.5V12l3 2" />
        </Svg>
      );
    case "tik":
      return (
        <Svg {...ortak}>
          <Path d="M5 12.5l4.5 4.5L19 7.5" />
        </Svg>
      );
    case "carpi":
      return (
        <Svg {...ortak}>
          <Path d="M6 6l12 12M18 6 6 18" />
        </Svg>
      );
    case "telefon":
      return (
        <Svg {...ortak}>
          <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
        </Svg>
      );
    case "mesaj":
      return (
        <Svg {...ortak}>
          <Path d="M4 5h16v11H8l-4 4z" />
        </Svg>
      );
    case "para":
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="12" r="8.5" />
          <Path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2 2.8.9 2.8 2.1-1.2 2.1-2.8 2.1c-1.3 0-2.4-.6-2.9-1.5M12 6.5v11" />
        </Svg>
      );
    case "cikis":
      return (
        <Svg {...ortak}>
          <Path d="M15 4h4v16h-4" />
          <Path d="M10 8l-4 4 4 4M6 12h10" />
        </Svg>
      );
    case "giris":
      return (
        <Svg {...ortak}>
          <Path d="M9 4H5v16h4" />
          <Path d="M14 8l4 4-4 4M18 12H8" />
        </Svg>
      );
    case "megafon":
      return (
        <Svg {...ortak}>
          <Path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z" />
          <Path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />
        </Svg>
      );
    case "zil":
      return (
        <Svg {...ortak}>
          <Path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" />
          <Path d="M10 20a2 2 0 0 0 4 0" />
        </Svg>
      );
    case "ayar":
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="12" r="3" />
          <Path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
        </Svg>
      );
    case "yildiz":
      return (
        <Svg {...ortak}>
          <Path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </Svg>
      );
    case "indir":
      return (
        <Svg {...ortak}>
          <Path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </Svg>
      );
    case "rotasyon":
      return (
        <Svg {...ortak}>
          <Path d="M4 8h13l-3-3M20 16H7l3 3" />
        </Svg>
      );
    case "yenile":
      return (
        <Svg {...ortak}>
          <Path d="M20 11a8 8 0 1 0-2.3 5.7" />
          <Path d="M20 4v7h-7" />
        </Svg>
      );
    case "kisi":
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="8" r="4" />
          <Path d="M4 21c1-4.2 4-6.5 8-6.5s7 2.3 8 6.5" />
        </Svg>
      );
    default:
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="12" r="8.5" />
        </Svg>
      );
  }
}
