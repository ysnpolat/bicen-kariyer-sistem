/**
 * ---------------------------------------------------------------------------
 * Güvenlik Doğrulaması (Cloudflare Turnstile)
 * ---------------------------------------------------------------------------
 * Ziyaretçinin gerçek bir tarayıcı kullandığını arka planda doğrular ve bir
 * jeton üretir. Jeton başvuruyla birlikte sunucuya gönderilir; sunucu da
 * Cloudflare'e sorarak geçerliliğini teyit eder.
 *
 * Kullanıcıya genelde hiçbir şey sorulmaz; yalnızca şüpheli durumlarda küçük
 * bir onay kutusu çıkar.
 *
 * Site anahtarı tanımlı değilse bileşen hiçbir şey göstermez ve başvuru akışı
 * eskisi gibi sürer.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useRef } from "react";

/** Cloudflare betiğinin adresi */
const BETIK_ADRESI =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

declare global {
  interface Window {
    turnstile?: {
      render: (hedef: HTMLElement, secenek: Record<string, unknown>) => string;
      remove: (kimlik: string) => void;
      reset: (kimlik?: string) => void;
    };
  }
}

/** Betiği yalnızca bir kez yükler */
let yukleniyor: Promise<void> | null = null;

const betigiYukle = (): Promise<void> => {
  if (window.turnstile) return Promise.resolve();

  if (!yukleniyor) {
    yukleniyor = new Promise<void>((coz, red) => {
      const betik = document.createElement("script");

      betik.src = BETIK_ADRESI;
      betik.async = true;
      betik.defer = true;
      betik.onload = () => coz();
      betik.onerror = () => red(new Error("Doğrulama betiği yüklenemedi"));

      document.head.appendChild(betik);
    });
  }

  return yukleniyor;
};

export default function GuvenlikDogrulamasi({
  siteAnahtari,
  jetonAlindi,
}: {
  siteAnahtari?: string;
  jetonAlindi: (jeton: string) => void;
}) {
  const kutu = useRef<HTMLDivElement>(null);
  const bilesenKimligi = useRef<string | null>(null);

  useEffect(() => {
    if (!siteAnahtari || !kutu.current) return;

    let iptal = false;

    betigiYukle()
      .then(() => {
        if (iptal || !kutu.current || !window.turnstile) return;

        bilesenKimligi.current = window.turnstile.render(kutu.current, {
          sitekey: siteAnahtari,
          language: "tr",
          theme: "light",
          callback: (jeton: string) => jetonAlindi(jeton),

          /* Jeton bir süre sonra geçersizleşir; yenisi istenir */
          "expired-callback": () => {
            jetonAlindi("");
            window.turnstile?.reset(bilesenKimligi.current ?? undefined);
          },

          /* Doğrulama başarısızsa jeton temizlenir */
          "error-callback": () => jetonAlindi(""),
        });
      })
      .catch(() => {
        /* Betik yüklenemezse doğrulama atlanır; sunucu tarafındaki diğer
           korumalar devrede kalır. Adayın başvurusu engellenmez. */
        jetonAlindi("");
      });

    return () => {
      iptal = true;

      if (bilesenKimligi.current && window.turnstile) {
        try {
          window.turnstile.remove(bilesenKimligi.current);
        } catch {
          // Bileşen zaten kaldırılmış olabilir
        }
      }
    };
  }, [siteAnahtari, jetonAlindi]);

  if (!siteAnahtari) return null;

  return (
    <div className="bsv-dogrulama">
      <div ref={kutu} />
    </div>
  );
}
