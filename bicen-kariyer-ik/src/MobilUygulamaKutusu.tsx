/**
 * Personel kartındaki Biçen360 kutusu
 * ---------------------------------------------------------------------------
 * Kişi uygulamaya giriş yapmış mı, hangi cihazdan, en son ne zaman; bildirim
 * izni ve son vardiya okutması. Yetkili kullanıcı cihaz eşleştirmesini buradan
 * kaldırabilir. Mobil ekranlarına yetkisi olmayan kullanıcıda (403) kutu
 * hiç çizilmiyor.
 *
 * Yalnızca personel kartında kullanılıyor; görünüm Personeller.css içinde.
 */

import { useCallback, useEffect, useState } from "react";
import { App as AntdApp, Button } from "antd";
import { Smartphone } from "lucide-react";
import dayjs from "dayjs";

import { api } from "./api";

const ts = (v?: string | null) => (v ? dayjs(v).format("DD.MM.YYYY HH:mm") : "—");

export default function MobilUygulamaKutusu({ sicil }: { sicil: string }) {
  const { message, modal } = AntdApp.useApp();

  const [veri, setVeri] = useState<any>(null);
  const [gizli, setGizli] = useState(false);
  const [gecmisAcik, setGecmisAcik] = useState(false);

  const getir = useCallback(() => {
    let iptal = false;
    setVeri(null);
    setGizli(false);
    if (!sicil) return () => {};

    api
      .al<any>(`/api/Mobil/UygulamaDurumu/${encodeURIComponent(sicil)}`)
      .then((c) => !iptal && setVeri(c ?? {}))
      .catch(() => !iptal && setGizli(true));

    return () => {
      iptal = true;
    };
  }, [sicil]);

  useEffect(() => {
    setGecmisAcik(false);
    return getir();
  }, [getir]);

  if (gizli || !sicil) return null;

  const kaldir = () =>
    modal.confirm({
      title: "Cihaz eşleştirmesi kaldırılsın mı?",
      content: "Personel mevcut cihazdan çıkarılır ve yeni telefonundan hemen giriş yapabilir. Aylık bekleme süresi uygulanmaz.",
      okText: "Kaldır",
      cancelText: "Vazgeç",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.sil(`/api/Mobil/Cihaz/${encodeURIComponent(sicil)}`);
          message.success("Cihaz eşleştirmesi kaldırıldı.");
          getir();
        } catch (hata: any) {
          message.error(hata.message);
        }
      },
    });

  const giris = !!veri?.girisYapti;
  const gecmis: any[] = veri?.gecmis ?? [];

  /* Görünüm Personeller.css "pl-" sınıflarından (personel kartı, 02.10.2026) */
  return (
    <div className="pl-kart">
      <div className="pl-kart-bas">
        <h3>
          <Smartphone size={16} strokeWidth={2} />
          Biçen360 uygulaması
        </h3>
        {giris && veri?.kaldirabilir && (
          <div className="pl-sag">
            <Button size="small" danger onClick={kaldir}>
              Cihaz eşleştirmesini kaldır
            </Button>
          </div>
        )}
      </div>

      <div className="pl-kart-ic">
        {!veri ? (
          <div style={{ color: "#8a9086", fontSize: 13 }}>Yükleniyor…</div>
        ) : giris ? (
          <div className="pl-uyg">
            <span className="pl-uyg-tel">
              <Smartphone size={22} strokeWidth={2} />
            </span>
            <div style={{ minWidth: 0 }}>
              <b>{veri.cihazAdi || "Cihaz"}</b>
              <div className="pl-uyg-etiketler">
                {veri.isletim && (
                  <span className={`pl-etiket ${veri.isletim === "iOS" ? "pl-e-mavi" : "pl-e-yesil"}`}>
                    {veri.isletim}
                  </span>
                )}
                <span className="pl-etiket pl-e-yesil">Giriş yaptı</span>
                {veri.oturumAcik ? (
                  <span className="pl-etiket pl-e-mavi">oturum açık</span>
                ) : (
                  <span className="pl-etiket pl-e-gri">oturum kapalı</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="pl-uyg">
            <span className="pl-uyg-tel pl-yok">
              <Smartphone size={22} strokeWidth={2} />
            </span>
            <div>
              <span className="pl-etiket pl-e-kirmizi">Uygulamaya giriş yapmamış</span>
              <div style={{ fontSize: 12.5, color: "#7b8577", marginTop: 4 }}>
                Uygulamayı kurmamış görünüyor. Vardiya okutması ve izin talebi için
                Biçen360'a giriş yapmalı.
              </div>
            </div>
          </div>
        )}

        {veri && (giris || veri.sonOkutma) && (
          <div className="pl-mini">
            {giris && (
              <div>
                <span>İlk giriş</span>
                <b>{ts(veri.ilkGiris)}</b>
              </div>
            )}
            {giris && (
              <div>
                <span>Son giriş</span>
                <b>{ts(veri.sonGiris)}</b>
              </div>
            )}
            <div>
              <span>Son vardiya okutma</span>
              <b>{ts(veri.sonOkutma)}</b>
            </div>
            {giris && (
              <div>
                <span>Bildirim izni</span>
                <b>{veri.bildirimAcik ? "açık" : "kapalı"}</b>
              </div>
            )}
            {giris && (
              <div>
                <span>Cihaz değişimi</span>
                <b>{veri.cihazDegisimSayisi ?? 0} kez</b>
              </div>
            )}
            {giris && (
              <div>
                <span>Oturum</span>
                <b>{veri.oturumAcik ? "açık" : "kapalı"}</b>
              </div>
            )}
          </div>
        )}

        {gecmis.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button type="button" className="pl-baglanti" onClick={() => setGecmisAcik(!gecmisAcik)}>
              {gecmisAcik ? "▾ Cihaz geçmişini gizle" : `▸ Cihaz geçmişi (${gecmis.length})`}
            </button>
            {gecmisAcik && (
              <div className="pl-cihaz-gecmis">
                {gecmis.map((g, i) => (
                  <div key={i}>
                    <span style={{ width: 108, color: "#8a9086" }}>{ts(g.tarih)}</span>
                    <b style={{ minWidth: 110 }}>{g.cihazAdi || "—"}</b>
                    <span>{g.sebep}</span>
                    {g.yapan && <span style={{ color: "#8a9086" }}>· {g.yapan}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
