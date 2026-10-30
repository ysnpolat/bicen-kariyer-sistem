/**
 * Performans ölçüt satırı açıklaması (24.10.2026)
 * Eski performans sayfasındaki gibi: "Şirket Ortalaması: 0,444 - Sizin: 0,4681"
 * ya da "Sınır: 19 - Sizin: 18,85"; puan alınamadıysa nedeni.
 * Sunucu /api/Performans/Personel → ayrinti["yil-ay"].satirlar[ölçüt].
 */
export interface OlcutSatiri {
  deger: number | null; esik: number | null; esikAd: string | null; yon: number; neden: string | null; sirketOrt: number | null;
}

const sy = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("tr-TR", { maximumFractionDigits: Math.abs(Number(n)) < 1 ? 4 : 2 });

/** Dönemin pozisyona göre ölçüt listesi; sunucu ayrıntı vermediyse eski liste */
export const donemAyrinti = (perf: any, d: any) => perf?.ayrinti?.[`${d?.yil}-${d?.ay}`] ?? null;

export function OlcutBilgi({ s, puan }: { s?: OlcutSatiri | null; puan: any }) {
  if (!s) return null;
  const aldi = Number(puan) > 0;
  const parcalar: string[] = [];
  if (s.deger != null && (s.sirketOrt != null || s.esik != null)) {
    const ort = s.sirketOrt ?? s.esik;
    const ad = s.sirketOrt != null ? "Şirket Ortalaması" : (s.esikAd ?? "Sınır");
    parcalar.push(`${ad}: ${sy(ort)} - Sizin: ${sy(s.deger)}`);
    if (s.esik != null && s.sirketOrt != null && Number(s.esik) !== Number(s.sirketOrt))
      parcalar.push(`${s.esikAd ?? "Puan sınırı"}: ${sy(s.esik)}`);
  }
  return (
    <div style={{ fontSize: 11.5, marginTop: 1 }}>
      {parcalar.length > 0 && <div style={{ color: "#6b7280" }}>{parcalar.join(" · ")}</div>}
      {!aldi && s.neden && <div style={{ color: "#cf1322" }}>{s.neden}</div>}
    </div>
  );
}
