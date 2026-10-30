/**
 * Simgeler
 * ---------------------------------------------------------------------------
 * Kendi çizimlerimiz. Dış paket uygulama boyutunu büyütüyor ve sürüm
 * farklarında simge adları değişebiliyor.
 */

import Svg, { Path, Rect, Circle, Line } from "react-native-svg";

/**
 * @param dolgu  Dolgulu çizim. İnce çizgili simgeler küçük boyutta soluk
 *               kalıyor ve liste içinde birbirine benziyordu; dolgulu
 *               sürüm hem daha canlı hem daha okunur.
 */
export default function Simge({ ad, renkli, boyut = 22, dolgu = false }) {
  const ortak = dolgu
    ? {
        width: boyut,
        height: boyut,
        viewBox: "0 0 24 24",
        fill: renkli,
        stroke: "none",
      }
    : {
        width: boyut,
        height: boyut,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: renkli,
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      };

  /* Dolgulu çizimler ayrı: aynı yolu hem çizgi hem dolgu olarak
     kullanmak, dolgu kipinde şekli tanınmaz hale getiriyordu. */
  if (dolgu) {
    switch (ad) {
      case "diger":
        /* Üç nokta: dolgu kipinde daireler biraz büyüyor, seçili sekme
           çizgili hâlinden ayırt edilsin. */
        return (
          <Svg {...ortak}>
            <Circle cx={5} cy={12} r={2.2} />
            <Circle cx={12} cy={12} r={2.2} />
            <Circle cx={19} cy={12} r={2.2} />
          </Svg>
        );

      case "mesaj":
        return (
          <Svg {...ortak}>
            <Path d="M12 3.5c-4.7 0-8.5 3.3-8.5 7.5 0 1.8.7 3.4 1.8 4.7L4 20.5l5.2-1.6c.9.3 1.8.4 2.8.4 4.7 0 8.5-3.3 8.5-7.5S16.7 3.5 12 3.5Z" />
          </Svg>
        );

      case "kutu":
        /* Kapağı açık koli: üç yüzey ayrı tonla değil ayrı yolla
           çiziliyor, dolgu kipinde derinlik böyle kalıyor. */
        return (
          <Svg {...ortak}>
            <Path d="M12 2 3 6.5l9 4.5 9-4.5L12 2Z" opacity={0.55} />
            <Path d="M3 7.6v9.9L11 22v-9.9L3 7.6Z" />
            <Path d="M21 7.6v9.9L13 22v-9.9l8-4.5Z" opacity={0.8} />
          </Svg>
        );

      case "etiket":
        return (
          <Svg {...ortak}>
            <Path d="M11.6 2.6 21 12a2 2 0 0 1 0 2.8l-6.2 6.2a2 2 0 0 1-2.8 0L2.6 11.6A2 2 0 0 1 2 10.2V4a2 2 0 0 1 2-2h6.2c.5 0 1 .2 1.4.6Z" />
            <Circle cx={7} cy={7} r={1.6} fill="#fff" />
          </Svg>
        );

      case "ev":
        return (
          <Svg {...ortak}>
            <Path d="M11.3 2.4a1 1 0 0 1 1.4 0l8 7a1 1 0 0 1 .3.8V20a2 2 0 0 1-2 2h-4v-6h-4v6H5a2 2 0 0 1-2-2v-9.8a1 1 0 0 1 .3-.8z" />
          </Svg>
        );

      case "takvim":
        return (
          <Svg {...ortak}>
            <Rect x="3" y="5" width="18" height="17" rx="3" />
            <Rect x="6.5" y="2" width="2.4" height="4.5" rx="1.2" />
            <Rect x="15.1" y="2" width="2.4" height="4.5" rx="1.2" />
            <Rect x="6" y="11" width="12" height="2" rx="1" fill="#fff" opacity="0.45" />
            <Rect x="6" y="15.5" width="8" height="2" rx="1" fill="#fff" opacity="0.45" />
          </Svg>
        );

      /* Biçen'den Haberler (08.10.2026) */
      case "kalp":
        return (
          <Svg {...ortak}>
            <Path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 15.9 12 20.5 12 20.5z" />
          </Svg>
        );

      case "zil":
        return (
          <Svg {...ortak}>
            <Path d="M12 2a6 6 0 0 0-6 6c0 4-1.5 5.5-2.2 6.3A1 1 0 0 0 4.5 16h15a1 1 0 0 0 .7-1.7C19.5 13.5 18 12 18 8a6 6 0 0 0-6-6z" />
            <Path d="M9.7 18a2.4 2.4 0 0 0 4.6 0z" />
          </Svg>
        );

      case "grafik":
        return (
          <Svg {...ortak}>
            <Rect x="3" y="13" width="4.6" height="8" rx="1.4" opacity="0.55" />
            <Rect x="9.7" y="8" width="4.6" height="13" rx="1.4" opacity="0.78" />
            <Rect x="16.4" y="3.5" width="4.6" height="17.5" rx="1.4" />
          </Svg>
        );

      case "para":
        return (
          <Svg {...ortak}>
            <Circle cx="12" cy="12" r="9.5" />
            <Path d="M12 6v12M9 9.2c0-1.3 1.3-2.2 3-2.2s3 .9 3 2.2-1.2 1.9-3 2.5-3 1.2-3 2.6 1.3 2.3 3 2.3 3-1 3-2.3" stroke="#fff" strokeWidth="1.8" fill="none" opacity="0.75" strokeLinecap="round" />
          </Svg>
        );

      case "belge":
      case "kitap":
        return (
          <Svg {...ortak}>
            <Path d="M6 2h7l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
            <Rect x="8" y="11" width="8" height="1.8" rx=".9" fill="#fff" opacity="0.5" />
            <Rect x="8" y="15" width="6" height="1.8" rx=".9" fill="#fff" opacity="0.5" />
          </Svg>
        );

      case "liste":
        return (
          <Svg {...ortak}>
            <Rect x="3" y="3" width="18" height="18" rx="4" />
            <Rect x="7" y="7.6" width="10" height="1.9" rx=".95" fill="#fff" opacity="0.55" />
            <Rect x="7" y="11.6" width="10" height="1.9" rx=".95" fill="#fff" opacity="0.55" />
            <Rect x="7" y="15.6" width="6.5" height="1.9" rx=".95" fill="#fff" opacity="0.55" />
          </Svg>
        );

      case "kisi":
        return (
          <Svg {...ortak}>
            <Circle cx="12" cy="8" r="4.2" />
            <Path d="M3.5 21a8.5 8.5 0 0 1 17 0 1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
          </Svg>
        );

      case "uyari":
        return (
          <Svg {...ortak}>
            <Path d="M10.9 3.2a1.3 1.3 0 0 1 2.2 0l8.4 15.4a1.2 1.2 0 0 1-1.1 1.8H3.6a1.2 1.2 0 0 1-1.1-1.8z" />
            <Rect x="11" y="8.5" width="2" height="5.6" rx="1" fill="#fff" opacity="0.8" />
            <Circle cx="12" cy="16.6" r="1.2" fill="#fff" opacity="0.8" />
          </Svg>
        );

      case "onay":
        return (
          <Svg {...ortak}>
            <Circle cx="12" cy="12" r="9.5" />
            <Path d="M7.6 12.3l3 3 5.8-6.2" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        );

      case "kutu":
        return (
          <Svg {...ortak}>
            <Path d="M12 2l9 4.6v10.8L12 22l-9-4.6V6.6z" opacity="0.9" />
            <Path d="M3 6.6L12 11l9-4.4" stroke="#fff" strokeWidth="1.6" fill="none" opacity="0.55" />
            <Path d="M12 11v11" stroke="#fff" strokeWidth="1.6" opacity="0.55" />
          </Svg>
        );

      case "kare":
        return (
          <Svg {...ortak}>
            <Rect x="3" y="3" width="8" height="8" rx="2" />
            <Rect x="13" y="3" width="8" height="8" rx="2" opacity="0.5" />
            <Rect x="3" y="13" width="8" height="8" rx="2" opacity="0.5" />
            <Rect x="13" y="13" width="8" height="8" rx="2" />
          </Svg>
        );

      case "etiket":
        return (
          <Svg {...ortak}>
            <Path d="M11 2.6a2 2 0 0 1 1.4.6l8.4 8.4a2 2 0 0 1 0 2.8l-6 6a2 2 0 0 1-2.8 0L3.6 12A2 2 0 0 1 3 10.6V4a2 2 0 0 1 2-2z" />
            <Circle cx="7.8" cy="7.8" r="1.8" fill="#fff" opacity="0.8" />
          </Svg>
        );

      /* Patron görünümünün sekmeleri: mağaza, onay kalkanı, ekip, kart */
      case "magaza":
        return (
          <Svg {...ortak}>
            <Path d="M4.4 3h15.2l2.1 6.4a2.9 2.9 0 0 1-5.3 1.6 3 3 0 0 1-4.4.4 3 3 0 0 1-4.4-.4 2.9 2.9 0 0 1-5.3-1.6z" />
            <Path d="M4 13a4.4 4.4 0 0 0 3.7-.8 4.6 4.6 0 0 0 4.3.6 4.6 4.6 0 0 0 4.3-.6A4.4 4.4 0 0 0 20 13v7a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z" />
          </Svg>
        );

      case "kalkan":
        return (
          <Svg {...ortak}>
            <Path d="M12 2.2 20 5.5v6.3c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V5.5z" />
            <Path d="M8.4 12.2l2.5 2.5 4.8-5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        );

      case "ekip":
        return (
          <Svg {...ortak}>
            <Circle cx="9" cy="7.6" r="4" />
            <Path d="M1.8 20.2c.8-4.2 3.6-6.4 7.2-6.4s6.4 2.2 7.2 6.4a1 1 0 0 1-1 1.2H2.8a1 1 0 0 1-1-1.2z" />
            <Path d="M15.6 3.6a4 4 0 0 1 0 8 5.6 5.6 0 0 0 0-8z" opacity="0.6" />
            <Path d="M17.4 14.2c2.6.6 4.2 2.8 4.7 6a1 1 0 0 1-1 1.2h-3a7.8 7.8 0 0 0-2.4-6.8z" opacity="0.6" />
          </Svg>
        );

      case "kart":
        return (
          <Svg {...ortak}>
            <Path d="M2 8a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v1H2z" />
            <Path d="M2 11h20v5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" />
            <Rect x="5.5" y="14" width="5" height="2" rx="1" fill="#fff" opacity="0.8" />
          </Svg>
        );

      /* Saat (12.10.2026): fazla mesai */
      case "saat":
        return (
          <Svg {...ortak}>
            <Circle cx="12" cy="12" r="10" />
            <Path d="M12 6.8v5.6l3.6 2.2" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        );

      /* Kalem (12.10.2026): düzelt */
      case "kalem":
        return (
          <Svg {...ortak}>
            <Path d="M15.2 4.3a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L9 19.5l-5 1 1-5z" />
          </Svg>
        );

      /* Yönetici çantası (12.10.2026): Yönetici İşlemleri */
      case "canta":
        return (
          <Svg {...ortak}>
            <Path d="M9 3h6a2 2 0 0 1 2 2v1h-2V5H9v1H7V5a2 2 0 0 1 2-2z" />
            <Rect x="2" y="7" width="20" height="13" rx="3" />
            <Rect x="10" y="11.5" width="4" height="3" rx="1" fill="#fff" opacity="0.85" />
          </Svg>
        );

      case "kupa":
        return (
          <Svg {...ortak}>
            <Path d="M7 3h10v6a5 5 0 0 1-10 0V3Z" />
            <Path d="M17 4.5h3.2v2.2a3.6 3.6 0 0 1-3.4 3.6l.2-1.8a1.8 1.8 0 0 0 1.4-1.8v-.4H17ZM7 4.5H3.8v2.2a3.6 3.6 0 0 0 3.4 3.6L7 8.5a1.8 1.8 0 0 1-1.4-1.8v-.4H7Z" opacity={0.75} />
            <Path d="M10.8 15h2.4v3.5h-2.4z" opacity={0.85} />
            <Rect x="7.5" y="18.5" width="9" height="2.6" rx="1.2" />
          </Svg>
        );

      default:
        break;
    }
  }

  switch (ad) {
    case "ev":
      return (
        <Svg {...ortak}>
          <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </Svg>
      );

    case "kare":
      return (
        <Svg {...ortak}>
          <Rect x="3" y="3" width="7" height="7" rx="1" />
          <Rect x="14" y="3" width="7" height="7" rx="1" />
          <Rect x="3" y="14" width="7" height="7" rx="1" />
          <Path d="M14 14h3v3h-3zM19 19h2v2h-2z" />
        </Svg>
      );

    case "takvim":
      return (
        <Svg {...ortak}>
          <Rect x="3" y="4" width="18" height="18" rx="3" />
          <Path d="M16 2v4M8 2v4M3 10h18" />
        </Svg>
      );

    case "grafik":
      return (
        <Svg {...ortak}>
          <Path d="M3 17l6-6 4 4 8-8" />
          <Path d="M21 7v6h-6" />
        </Svg>
      );

    case "para":
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M15 9h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9M12 7v10" />
        </Svg>
      );

    case "zil":
      return (
        <Svg {...ortak}>
          <Path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <Path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </Svg>
      );

    case "belge":
      return (
        <Svg {...ortak}>
          <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <Path d="M14 2v6h6M9 13h6M9 17h6" />
        </Svg>
      );

    case "kitap":
      return (
        <Svg {...ortak}>
          <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </Svg>
      );

    case "liste":
      return (
        <Svg {...ortak}>
          <Line x1="9" y1="6" x2="20" y2="6" />
          <Line x1="9" y1="12" x2="20" y2="12" />
          <Line x1="9" y1="18" x2="20" y2="18" />
          <Circle cx="4.5" cy="6" r="1" fill={renkli} />
          <Circle cx="4.5" cy="12" r="1" fill={renkli} />
          <Circle cx="4.5" cy="18" r="1" fill={renkli} />
        </Svg>
      );

    case "kisi":
      return (
        <Svg {...ortak}>
          <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <Circle cx="12" cy="7" r="4" />
        </Svg>
      );

    /* Üç nokta: "Diğer" sekmesi */
    case "uyari":
      return (
        <Svg {...ortak}>
          <Path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <Line x1="12" y1="9" x2="12" y2="13" />
          <Line x1="12" y1="17" x2="12.01" y2="17" />
        </Svg>
      );

    /* Onay işareti; başarı penceresinde kullanılıyor */
    case "onay":
      return (
        <Svg {...ortak}>
          <Path d="M20 6L9 17l-5-5" />
        </Svg>
      );

    /* Bilgi: içinde ünlem olan daire */
    case "bilgi":
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="12" r="9.2" />
          <Line x1="12" y1="11" x2="12" y2="16.5" />
          <Line x1="12" y1="7.6" x2="12.01" y2="7.6" />
        </Svg>
      );

    case "diger":
      return (
        <Svg {...ortak}>
          <Circle cx="5" cy="12" r="1.6" fill={renkli} />
          <Circle cx="12" cy="12" r="1.6" fill={renkli} />
          <Circle cx="19" cy="12" r="1.6" fill={renkli} />
        </Svg>
      );

    case "ok":
      return (
        <Svg {...ortak}>
          <Path d="M9 18l6-6-6-6" />
        </Svg>
      );

    case "cikis":
      return (
        <Svg {...ortak}>
          <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <Path d="M16 17l5-5-5-5M21 12H9" />
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

    case "kalkan":
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

    /* Biçen'den Haberler (08.10.2026) */
    case "kalp":
      return (
        <Svg {...ortak}>
          <Path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 15.9 12 20.5 12 20.5z" />
        </Svg>
      );

    case "yorum":
      return (
        <Svg {...ortak}>
          <Path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5z" />
        </Svg>
      );

    case "gonder":
      return (
        <Svg {...ortak}>
          <Path d="M21.5 2.5 10.5 13.5" />
          <Path d="M21.5 2.5 14.5 21.5l-4-8-8-4z" />
        </Svg>
      );

    case "arti":
      return (
        <Svg {...ortak}>
          <Rect x="3" y="3" width="18" height="18" rx="5" />
          <Path d="M12 8v8M8 12h8" />
        </Svg>
      );

    case "foto":
      return (
        <Svg {...ortak}>
          <Rect x="3" y="4" width="18" height="16" rx="3" />
          <Circle cx="9" cy="10" r="2" />
          <Path d="m21 16-5-5-9 9" />
        </Svg>
      );

    case "sabit":
      return (
        <Svg {...ortak}>
          <Path d="M9 3h6l-1 6 4 4H6l4-4z" />
          <Path d="M12 13v8" />
        </Svg>
      );

    case "saat":
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M12 7v5l3.2 2" />
        </Svg>
      );

    case "kalem":
      return (
        <Svg {...ortak}>
          <Path d="M15.2 4.3a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L9 19.5l-5 1 1-5z" />
          <Path d="M13.5 6l4.5 4.5" />
        </Svg>
      );

    case "canta":
      return (
        <Svg {...ortak}>
          <Rect x="3" y="7" width="18" height="13" rx="2.5" />
          <Path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          <Path d="M3 12.5h18" />
        </Svg>
      );

    /* Profil ızgarası (09.10.2026) */
    case "izgara":
      return (
        <Svg {...ortak}>
          <Rect x="3.5" y="3.5" width="17" height="17" rx="2" />
          <Line x1="9.2" y1="3.5" x2="9.2" y2="20.5" />
          <Line x1="14.8" y1="3.5" x2="14.8" y2="20.5" />
          <Line x1="3.5" y1="9.2" x2="20.5" y2="9.2" />
          <Line x1="3.5" y1="14.8" x2="20.5" y2="14.8" />
        </Svg>
      );

    /* Kazan-Kazan (20.10.2026): kupa, barkod, ampul */
    case "kupa":
      return (
        <Svg {...ortak}>
          <Path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
          <Path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
        </Svg>
      );

    case "barkod":
      return (
        <Svg {...ortak}>
          <Path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          <Line x1="7" y1="8" x2="7" y2="16" />
          <Line x1="10.5" y1="8" x2="10.5" y2="16" />
          <Line x1="13.5" y1="8" x2="13.5" y2="16" />
          <Line x1="17" y1="8" x2="17" y2="16" />
        </Svg>
      );

    /* Mesajlar (1.9): iki konuşma balonu */
    case "mesaj":
      return (
        <Svg {...ortak}>
          <Path d="M20 11.5c0 3.9-3.6 7-8 7-1.1 0-2.1-.2-3-.5L4 19.5l1.4-3.6C4.5 14.7 4 13.2 4 11.5c0-3.9 3.6-7 8-7s8 3.1 8 7z" />
          <Path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
        </Svg>
      );

    case "ampul":
      return (
        <Svg {...ortak}>
          <Path d="M9 18h6M10 21h4" />
          <Path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z" />
        </Svg>
      );

    default:
      return (
        <Svg {...ortak}>
          <Circle cx="12" cy="12" r="9" />
        </Svg>
      );
  }
}
