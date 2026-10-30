/**
 * ---------------------------------------------------------------------------
 * Personel Fotoğrafı
 * ---------------------------------------------------------------------------
 * Fotoğrafı doğrudan sunucudan ister; böylece liste beklemeden açılır,
 * görseller arka planda yüklenir ve tarayıcı tarafından önbelleğe alınır.
 *
 * Fotoğrafı olmayan veya yüklenemeyen kayıtlarda gri bir simge gösterilir.
 * ---------------------------------------------------------------------------
 */

import { useState } from "react";
import { UserCircle2 } from "lucide-react";

import { api } from "./api";

export default function PersonelResmi({
  kod,
  ad,
  boyut = 38,
  surum,
}: {
  kod?: string | null;
  ad?: string;
  boyut?: number;
  /** Fotoğrafın sürüm damgası; değişince önbellek atlanır */
  surum?: number | null;
}) {
  const [hata, setHata] = useState(false);
  const adres = api.resimAdresi(kod, surum);

  return (
    <div
      className="pr-avatar"
      style={{ width: boyut, height: boyut }}
      title={ad}
    >
      {adres && !hata ? (
        <img
          src={adres}
          alt={ad ?? ""}
          loading="lazy"
          decoding="async"
          onError={() => setHata(true)}
        />
      ) : (
        <UserCircle2 size={Math.round(boyut * 0.58)} strokeWidth={1.6} />
      )}
    </div>
  );
}
