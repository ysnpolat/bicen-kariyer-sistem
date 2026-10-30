/**
 * Personel kartı › Avans
 * ---------------------------------------------------------------------------
 * Personelin avans talepleri, devam eden avansın taksit planı, toplam
 * alınan ve bu yılki talep hakkı. Talep kararları Personel Talepleri ›
 * Avans sekmesinden veriliyor; burası okuma ekranı.
 */

import { useEffect, useState } from "react";
import { Spin } from "antd";

import Tablo from "./Tablo";
import { api } from "./api";
import { TaksitSeridi, ayKisa, durumEtiketi, tarih, tl } from "./AvansTalepleri";
import "./IzinTalepleri.css";
import "./AvansTalepleri.css";

export default function PersonelAvans({ personelKodu }: { personelKodu: string }) {
  const [veri, setVeri] = useState<any>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    setVeri(null);
    setHata("");

    api
      .al<any>(`/api/Avans/Personel/${encodeURIComponent(personelKodu)}`)
      .then(setVeri)
      .catch((h: any) => setHata(h.message));
  }, [personelKodu]);

  if (hata) return <div className="pl-bos-ic">{hata}</div>;
  if (!veri) return <Spin />;

  const d = veri.devamEden;

  return (
    <div className="it pa">
      <div className="pa-kartlar">
        <div className="pa-kart pa-koyu">
          <span>Devam eden avans</span>
          <b>{d ? `${tl(d.ozet.kalan)} kalan` : "Yok"}</b>
          <small>{d ? `${tl(d.tutar)} · ${d.taksit} taksit · ${d.ozet.kalanTaksit} taksit kaldı` : "ödemesi süren avans yok"}</small>
        </div>
        <div className="pa-kart">
          <span>Sonraki kesinti</span>
          <b>{d?.ozet?.siradaki ? ayKisa(d.ozet.siradaki.tarih) : "—"}</b>
          <small>
            {d?.ozet?.siradaki
              ? `${tl(d.ozet.siradaki.tutar)} · son taksit ${d.ozet.sonKesinti ? ayKisa(d.ozet.sonKesinti) : "—"}`
              : `kesintiler her ayın ${veri.kesintiGunu}'i`}
          </small>
        </div>
        <div className="pa-kart">
          <span>Toplam alınan</span>
          <b>{tl(veri.toplamAlinan)}</b>
          <small>
            {veri.toplamAdet} avans{veri.sonAvans ? ` · son ${tarih(veri.sonAvans)}` : ""}
          </small>
        </div>
        <div className="pa-kart">
          <span>Bu yıl talep</span>
          <b>
            {veri.buYil} / {veri.yillikHak}
          </b>
          <small className={veri.buYil >= veri.yillikHak ? "it-uyari-yazi" : undefined}>
            {veri.buYil >= veri.yillikHak ? "Yıllık hak doldu" : `${veri.yillikHak - veri.buYil} talep hakkı kaldı`}
          </small>
        </div>
      </div>

      {veri.maasGorunur && (
        <div className="av-limit" style={{ marginTop: 0, marginBottom: 12 }}>
          {veri.maas ? (
            <>
              Maaş <b>{tl(veri.maas)}</b> · üst limit <b>{tl(veri.limit)}</b>
              {veri.ustLimit !== veri.limit ? (
                <>
                  {" "}
                  · maaşın üzerinde en fazla <b>{tl(veri.ustLimit)}</b>
                </>
              ) : null}
            </>
          ) : (
            "Maaş bulunamadı; limit hesaplanamıyor."
          )}
        </div>
      )}

      {d && (
        <div className="it-kart" style={{ marginBottom: 12 }}>
          <div className="it-kart-bas">
            <h3>Taksit planı · devam eden avans</h3>
          </div>
          <div className="it-kart-ic">
            <TaksitSeridi ozet={d.ozet} />
          </div>
        </div>
      )}

      <div className="it-kart">
        <div className="it-kart-bas">
          <h3>Avans talepleri</h3>
          <span>karar ve düzenleme: Personel Talepleri › Avans</span>
        </div>
        <div className="it-kart-ic">
          <Tablo
            rowKey="id"
            size="small"
            dataSource={veri.avanslar}
            pagination={false}
            locale={{ emptyText: "Avans talebi yok." }}
            columns={[
              { title: "Talep", key: "t", render: (_: any, a: any) => tarih(a.olusturma) },
              {
                title: "Tutar",
                key: "tutar",
                align: "right" as const,
                render: (_: any, a: any) => (
                  <>
                    {tl(a.tutar)}
                    {a.talepTutar !== a.tutar && <div className="av-soluk" style={{ fontSize: 11.5 }}>istenen {tl(a.talepTutar)}</div>}
                  </>
                ),
              },
              {
                title: "Taksit",
                key: "taksit",
                render: (_: any, a: any) =>
                  `${a.taksit === 1 ? "Tek" : a.taksit}${a.ozet?.devamEdiyor ? ` · ${a.taksit - a.ozet.kalanTaksit} kesildi` : ""}`,
              },
              {
                title: "Kesinti",
                key: "kesinti",
                render: (_: any, a: any) =>
                  a.ozet?.taksitler?.length
                    ? a.ozet.taksitler.length === 1
                      ? ayKisa(a.ozet.taksitler[0].tarih)
                      : `${ayKisa(a.ozet.taksitler[0].tarih)} – ${ayKisa(a.ozet.taksitler[a.ozet.taksitler.length - 1].tarih)}`
                    : "—",
              },
              {
                title: "Durum",
                key: "durum",
                render: (_: any, a: any) => (
                  <>
                    {durumEtiketi(a.durum, a.durumAdi, a.ozet?.devamEdiyor)}
                    {a.kaynak === "ik" && <span className="av-soluk" style={{ fontSize: 11.5, marginLeft: 6 }}>İK girdi</span>}
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
