/**
 * Sırası İK'da olan personel talepleri için ekran bildirimi (30.10.2026).
 *
 * İzin, avans, fazla mesai, rotasyon ya da vardiya düzeltme talebi onay
 * zincirinde İK adımına geldiğinde İK uzmanının ekranında sağ altta sesli
 * bir kart açılır: kim, hangi şube, ne talebi. Karttan doğrudan Personel
 * Talepleri'nin ilgili sekmesine gidilir.
 *
 * Sunucu (/api/Panel/IkSiradakiTalepler) yalnızca İK Uzmanı / İK
 * Yöneticisi için ve uzmanın kendi şubeleriyle dolu döner. Liste dakikada
 * bir (ve sekmeye dönülünce) okunur. Görülen talepler tarayıcıda tutulur;
 * aynı talep için ikinci kez kart açılmaz. İlk açılışta mevcut bekleyenler
 * için tek bir özet kart gösterilir (oturum başına bir kez), tek tek
 * değil.
 *
 * Sekme arka plandaysa sekme başlığına "(N) " eklenir ve izin verilmişse
 * tarayıcı bildirimi de gönderilir.
 */
import { useCallback, useEffect, useRef } from "react";
import { App as AntdApp, Button } from "antd";
import { BellRing } from "lucide-react";

import { api, oturumOku } from "./api";
import { sayfayaGit } from "./gecis";

interface SiradakiTalep {
  anahtar: string;
  tur: string;
  sekme: string;
  adSoyad: string;
  sube?: string | null;
  ozet?: string | null;
  zaman?: string | null;
}

const gorulenAnahtari = (kullanici: string) => `bicen_ik_sira_gorulen_${(kullanici || "").toLocaleLowerCase("tr-TR")}`;
const OZET_ANAHTARI = "bicen_ik_sira_ozet_gosterildi";

const oku = (k: string): string[] | null => {
  try {
    const h = localStorage.getItem(k);
    return h ? (JSON.parse(h) as string[]) : null;
  } catch {
    return null;
  }
};

const yaz = (k: string, l: string[]) => {
  try {
    /* Liste büyümesin: yalnızca son 500 anahtar */
    localStorage.setItem(k, JSON.stringify(l.slice(-500)));
  } catch {
    /* tarayıcı depolaması kapalı olabilir */
  }
};

export default function IkTalepUyarisi() {
  const { notification } = AntdApp.useApp();
  const ses = useRef<HTMLAudioElement | null>(null);
  const baslik = useRef(document.title);
  const bekleyenSayisi = useRef(0);

  useEffect(() => {
    ses.current = new Audio(`${import.meta.env.BASE_URL}sesler/bicen-onay-bekliyor.mp3`);
    ses.current.volume = 0.8;
  }, []);

  /* Sekme başlığındaki "(N) " eki, ekran açılınca kalkar */
  useEffect(() => {
    const gorunur = () => {
      if (document.visibilityState === "visible") document.title = baslik.current;
    };
    document.addEventListener("visibilitychange", gorunur);
    return () => document.removeEventListener("visibilitychange", gorunur);
  }, []);

  const ac = useCallback(
    (sekme: string, anahtar?: string) => {
      if (anahtar) notification.destroy(anahtar);
      sayfayaGit("izintalep", `sekme:${sekme}`);
    },
    [notification]
  );

  const kartAc = useCallback(
    (key: string, ust: string, satirlar: SiradakiTalep[], toplam: number, sekme: string) => {
      notification.open({
        key,
        placement: "bottomRight",
        duration: 0,
        message: null,
        className: "ik-sira-bildirim",
        description: (
          <div style={{ display: "flex", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                flex: "0 0 40px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #7cb518, #5f8c10)",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 4px 12px rgba(95,140,16,.35)",
              }}
            >
              <BellRing size={20} strokeWidth={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "#5f8c10" }}>
                {ust}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, margin: "2px 0 6px" }}>
                {toplam === 1 ? "Onayınızı bekleyen talep var" : `Onayınızı bekleyen ${toplam} talep var`}
              </div>
              {satirlar.slice(0, 4).map((t) => (
                <button
                  key={t.anahtar}
                  type="button"
                  onClick={() => ac(t.sekme, key)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: "1px solid #e3e6e1",
                    background: "#fbfcfa",
                    borderRadius: 8,
                    padding: "6px 8px",
                    marginBottom: 4,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                    <b style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.adSoyad}</b>
                    <span style={{ color: "#5f8c10", fontWeight: 700, whiteSpace: "nowrap" }}>{t.tur}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7480", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[t.sube, t.ozet].filter(Boolean).join(" · ")}
                  </div>
                </button>
              ))}
              {satirlar.length > 4 && (
                <div style={{ fontSize: 12, color: "#6b7480", marginBottom: 4 }}>ve {satirlar.length - 4} talep daha</div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <Button type="primary" size="small" onClick={() => ac(sekme, key)}>
                  Personel Talepleri'ni aç
                </Button>
                <Button size="small" onClick={() => notification.destroy(key)}>
                  Kapat
                </Button>
              </div>
            </div>
          </div>
        ),
      });
    },
    [ac, notification]
  );

  const kontrol = useCallback(async () => {
    const o = oturumOku();
    if (!o) return;

    let d: { aktif: boolean; talepler: SiradakiTalep[] };
    try {
      d = await api.al("/api/Panel/IkSiradakiTalepler");
    } catch {
      return;
    }
    if (!d?.aktif) return;

    const talepler = d.talepler ?? [];
    bekleyenSayisi.current = talepler.length;
    const anahtar = gorulenAnahtari(o.kullaniciAdi);
    const gorulen = oku(anahtar);

    /* İlk kez: mevcut bekleyenler tek tek değil, bir özet kartla */
    if (gorulen === null) {
      yaz(anahtar, talepler.map((t) => t.anahtar));
      let gosterildi = false;
      try {
        gosterildi = sessionStorage.getItem(OZET_ANAHTARI) === "1";
        sessionStorage.setItem(OZET_ANAHTARI, "1");
      } catch {
        /* yok say */
      }
      if (!gosterildi && talepler.length > 0)
        kartAc("ik-sira-ozet", "Personel talepleri · sıra sizde", talepler, talepler.length, talepler[0].sekme);
      return;
    }

    const kume = new Set(gorulen);
    const yeniler = talepler.filter((t) => !kume.has(t.anahtar));

    /* Oturum başında da bekleyen varsa bir kez hatırlat */
    let ozetGosterildi = true;
    try {
      ozetGosterildi = sessionStorage.getItem(OZET_ANAHTARI) === "1";
      sessionStorage.setItem(OZET_ANAHTARI, "1");
    } catch {
      /* yok say */
    }

    if (yeniler.length > 0) {
      yaz(anahtar, [...gorulen.filter((k) => talepler.some((t) => t.anahtar === k)), ...yeniler.map((t) => t.anahtar)]);
      ses.current?.play().catch(() => undefined);
      kartAc(
        "ik-sira-yeni",
        yeniler.length === 1 ? "Yeni talep · sıra sizde" : `${yeniler.length} yeni talep · sıra sizde`,
        yeniler,
        talepler.length,
        yeniler[0].sekme
      );

      if (document.visibilityState !== "visible") {
        document.title = `(${talepler.length}) ${baslik.current}`;
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            const y = yeniler[0];
            const n = new Notification("Onayınızı bekleyen talep", {
              body: `${y.adSoyad} · ${y.tur}${y.sube ? ` · ${y.sube}` : ""}`,
              tag: "ik-sira",
            });
            n.onclick = () => {
              window.focus();
              ac(y.sekme);
              n.close();
            };
          } catch {
            /* tarayıcı izin vermeyebilir */
          }
        }
      }
    } else if (!ozetGosterildi && talepler.length > 0) {
      kartAc("ik-sira-ozet", "Personel talepleri · sıra sizde", talepler, talepler.length, talepler[0].sekme);
    }
  }, [ac, kartAc]);

  useEffect(() => {
    void kontrol();
    const z = window.setInterval(kontrol, 60_000);
    const odak = () => void kontrol();
    window.addEventListener("focus", odak);
    return () => {
      window.clearInterval(z);
      window.removeEventListener("focus", odak);
    };
  }, [kontrol]);

  return null;
}
