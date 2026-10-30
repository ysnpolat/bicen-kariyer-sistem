/**
 * Rakip logosu (12.10.2026)
 * ---------------------------------------------------------------------------
 * Yönetim › Rakip Firmalar'dan eklenen logo. Logo yoksa ya da açılamazsa
 * firmanın baş harfi renkli bir rozette (mobildeki rozetle aynı renkler).
 * Sunucu adresi "/api/RakipFiyat/Logo/3?v=2" biçiminde gönderiyor.
 */

import { useEffect, useState, type CSSProperties } from "react";
import { API_TABAN } from "./api";

const RENKLER = ["#e8481c", "#e07b00", "#1a4d80", "#cf1322", "#ad4e00", "#3f6212", "#722ed1", "#1d2126", "#5f8c10"];

export const rakipLogoAdresi = (logo?: string | null) => (logo ? `${API_TABAN}${logo}` : "");

export default function RakipLogosu({
  id,
  ad,
  logo,
  boyut = 22,
}: {
  id?: number;
  ad?: string | null;
  logo?: string | null;
  boyut?: number;
}) {
  const [hata, setHata] = useState(false);

  useEffect(() => setHata(false), [logo]);

  const ortak: CSSProperties = {
    width: boyut,
    height: boyut,
    borderRadius: Math.round(boyut / 3.2),
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    overflow: "hidden",
  };

  if (logo && !hata)
    return (
      <span style={{ ...ortak, background: "#fff", border: "1px solid #e6e9e3" }}>
        <img
          src={rakipLogoAdresi(logo)}
          alt=""
          onError={() => setHata(true)}
          style={{ width: boyut - 4, height: boyut - 4, objectFit: "contain" }}
        />
      </span>
    );

  const harf = (ad ?? "?").trim().charAt(0).toLocaleUpperCase("tr-TR");
  const renk = RENKLER[Math.abs(Number(id) || 0) % RENKLER.length];

  return (
    <span
      aria-hidden="true"
      style={{ ...ortak, background: renk, color: "#fff", fontWeight: 800, fontSize: Math.round(boyut * 0.46) }}
    >
      {harf}
    </span>
  );
}

/** Logo + ad yan yana (tablo hücreleri için) */
export function RakipAdi({
  id,
  ad,
  logo,
  kalin = false,
}: {
  id?: number;
  ad?: string | null;
  logo?: string | null;
  kalin?: boolean;
}) {
  if (!ad) return <>—</>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
      <RakipLogosu id={id} ad={ad} logo={logo} boyut={20} />
      {kalin ? <b>{ad}</b> : <span>{ad}</span>}
    </span>
  );
}
