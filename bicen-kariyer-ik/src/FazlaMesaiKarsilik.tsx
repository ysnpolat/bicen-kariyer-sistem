/**
 * Fazla mesai kaydının karşılığı (ücret kuralları, 15.10.2026): liste ve
 * personel penceresinde kısa etiket, ayrıntı ipucunda.
 */

import { Tooltip } from "antd";

/** Fazla mesai karşılığı (ücret kuralları, 15.10.2026) */
export interface Karsilik {
  gunTuru: string;
  gunTuruAdi: string;
  tatil: string | null;
  karsilik: "ucret" | "izin";
  carpan: number;
  ucret: number | null;
  izinDk: number;
  kural: string;
}

const tlYaz = (v: number) => `${v.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ₺`;

/** "≈ 1.234 ₺" / "3 sa izin" kısa gösterim; tam ayrıntı ipucunda */
export function KarsilikEtiketi({ k, onayli }: { k?: Karsilik | null; onayli: boolean }) {
  if (!k || (k.karsilik === "ucret" && k.ucret == null && k.gunTuru === "normal")) return null;
  const saat = Math.round((k.izinDk / 60) * 100) / 100;
  const metin =
    k.karsilik === "izin" ? `${saat.toLocaleString("tr-TR")} sa izin` : k.ucret != null ? `${onayli ? "" : "≈ "}${tlYaz(k.ucret)}` : null;
  const gun = k.gunTuru !== "normal" ? k.gunTuruAdi + (k.tatil ? ` (${k.tatil})` : "") : null;
  return (
    <Tooltip
      title={
        <>
          {k.gunTuruAdi}
          {k.tatil ? ` · ${k.tatil}` : ""} · {k.karsilik === "izin" ? "serbest zaman" : "ücret"} ×{k.carpan.toLocaleString("tr-TR")}
          <br />
          Kural: {k.kural}
          {!onayli && k.karsilik === "ucret" ? " · onaylanırsa alacağı" : ""}
        </>
      }
    >
      <span className={k.karsilik === "izin" ? "fm-izin" : "fm-ucret"}>
        {gun ? ` · ${gun}` : ""}
        {metin ? ` · ${metin}` : ""}
      </span>
    </Tooltip>
  );
}

