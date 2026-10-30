/**
 * Personel kartındaki Biçen Kart kutusu
 * ---------------------------------------------------------------------------
 * Personeller sayfasında kişiye tıklayınca: tanımlı kart numarası, kart
 * türü, şifre durumu ve güncel bakiye. "Puan işlemleri" açılınca panelden
 * yapılan yükleme, transfer ve silmeler görünüyor. Kart ekranına yetkisi
 * olmayan kullanıcıda (403) kutu hiç çizilmiyor.
 */

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";

import { api } from "./api";
import { KartPuanIslemleri } from "./BicenKartPuan";
import "./BicenKart.css";

const no4 = (d?: string | null) => (d ?? "").replace(/(.{4})/g, "$1 ").trim();

const puanYaz = (d?: number | null) =>
  d === null || d === undefined
    ? "—"
    : Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BicenKartKutusu({
  sicil,
  adSoyad,
}: {
  sicil: string;
  /** Kart görselinde yazılır */
  adSoyad?: string;
}) {
  const [veri, setVeri] = useState<any>(null);
  const [gizli, setGizli] = useState(false);
  const [islemAcik, setIslemAcik] = useState(false);

  useEffect(() => {
    let iptal = false;
    setVeri(null);
    setGizli(false);
    setIslemAcik(false);
    if (!sicil) return;

    api
      .al<any>(`/api/BicenKartPuan/Personel/${encodeURIComponent(sicil)}`)
      .then((c) => !iptal && setVeri(c ?? {}))
      .catch(() => !iptal && setGizli(true));

    return () => {
      iptal = true;
    };
  }, [sicil]);

  if (gizli || !sicil) return null;

  /* Görünüm Personeller.css "pl-" sınıflarından (personel kartı,
     02.10.2026). Puan işlemleri BicenKart.css'teki "bk" değişkenlerini
     kullandığı için dış kutu "bk" sınıfını da taşıyor. */
  return (
    <div className="pl-kart bk">
      <div className="pl-kart-bas">
        <h3>
          <CreditCard size={16} strokeWidth={2} />
          Biçen Kart
        </h3>
        {veri?.kartNo && (
          <div className="pl-sag">
            <button type="button" className="pl-baglanti" onClick={() => setIslemAcik(!islemAcik)}>
              {islemAcik ? "▾ Puan işlemlerini gizle" : "▸ Puan işlemleri"}
            </button>
          </div>
        )}
      </div>

      <div className="pl-kart-ic">
        {!veri ? (
          <div style={{ color: "var(--bk-pasif)", fontSize: 13 }}>Yükleniyor…</div>
        ) : veri.kartNo ? (
          <div className="pl-bicenkart">
            <small>
              {veri.kartBulunamadi
                ? "Biçen Kart"
                : `Biçen Kart · ${veri.mobil ? "mobil" : "fiziki"} · ${veri.sifreVar ? "şifre tanımlı" : "şifre yok"}`}
            </small>
            <span className="pl-bicenkart-no">{no4(veri.kartNo)}</span>
            <div className="pl-bicenkart-alt">
              <span>{(adSoyad ?? "").toLocaleUpperCase("tr")}</span>
              <span style={{ textAlign: "right" }}>
                <small style={{ display: "block" }}>Bakiye</small>
                <b>{puanYaz(veri.bakiye)}</b>
              </span>
            </div>
          </div>
        ) : (
          <div className="pl-bicenkart pl-bos">
            <small>Biçen Kart</small>
            <span className="pl-bicenkart-no">•••• •••• ••••</span>
            <div className="pl-bicenkart-alt">
              <span>Kart tanımlı değil. Biçen Kart sayfasından eşleştirilebilir.</span>
            </div>
          </div>
        )}

        {veri?.kartNo && (veri.kartBulunamadi || veri.hata) && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {veri.kartBulunamadi && <span className="bk-rozet bk-r-kirmizi">kart kaydı bulunamadı</span>}
            {veri.hata && <span className="bk-rozet bk-r-sari">{veri.hata}</span>}
          </div>
        )}

        {islemAcik && veri?.kartNo && (
          <div style={{ marginTop: 12 }}>
            <KartPuanIslemleri kartNo={veri.kartNo} />
          </div>
        )}
      </div>
    </div>
  );
}
