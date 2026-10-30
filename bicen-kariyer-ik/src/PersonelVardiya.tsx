/**
 * Personel kartı › Vardiya planı
 * ---------------------------------------------------------------------------
 * Personelin seçilen haftadaki planı (varsayılan bu hafta) ve QR okutma
 * saatleri. Plan mağaza müdürünün mobilden ya da İK'nın Vardiya Planları
 * ekranından kurduğu plan; saatler karekod okutmalarından geliyor (ilk ve
 * son okutma). Gün durumu sunucuda hesaplanıyor:
 *   okuttu · içeride (bugün girmiş, çıkmamış) · okutmadı (geçmiş çalışma
 *   günü, okutma yok) · izinli · plan (bugün ve sonrası).
 * Okuma ekranı; düzenleme Personeller › Vardiya Planları'ndan.
 */

import { useEffect, useState } from "react";
import { Button, Spin } from "antd";
import { CalendarClock } from "lucide-react";
import dayjs, { Dayjs } from "dayjs";

import { api } from "./api";
import { RENKLER, TIP_ADI, haftaBasi } from "./VardiyaPlanlari";
import "./PersonelVardiya.css";

const GUNLER = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const DURUM: Record<string, { ad: string; sinif: string }> = {
  taslak: { ad: "Taslak · gönderilmedi", sinif: "pv-hap-taslak" },
  gonderildi: { ad: "Gönderildi", sinif: "pv-hap-gonderildi" },
  degisti: { ad: "Değişti · yeniden gönderilmedi", sinif: "pv-hap-degisti" },
};

const GUN_DURUM: Record<string, { ad: string; sinif: string } | undefined> = {
  okuttu: { ad: "Okuttu", sinif: "pv-cip-okuttu" },
  iceride: { ad: "İçeride", sinif: "pv-cip-iceride" },
  okutmadi: { ad: "Okutmadı", sinif: "pv-cip-okutmadi" },
  izinli: { ad: "İzinli", sinif: "pv-cip-izinli" },
  plan: { ad: "Planlı", sinif: "pv-cip-plan" },
};

const saat = (d?: string | null) => (d ? dayjs(d).format("HH:mm") : null);

export default function PersonelVardiya({ personelKodu }: { personelKodu: string }) {
  const [hafta, setHafta] = useState<Dayjs>(haftaBasi(dayjs()));
  const [veri, setVeri] = useState<any>(null);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);

  useEffect(() => {
    let iptal = false;

    setYukleniyor(true);
    setHata("");

    api
      .al<any>(
        `/api/VardiyaPlan/Kisi?sicil=${encodeURIComponent(personelKodu)}&hafta=${hafta.format("YYYY-MM-DD")}`
      )
      .then((c) => !iptal && setVeri(c))
      .catch((h: any) => !iptal && setHata(h.message))
      .finally(() => !iptal && setYukleniyor(false));

    return () => {
      iptal = true;
    };
  }, [personelKodu, hafta]);

  const buHafta = hafta.isSame(haftaBasi(dayjs()), "day");
  const durum = veri ? DURUM[veri.durum] ?? DURUM.taslak : null;
  const planli = (veri?.gunler ?? []).some((d: any) => d.tur === "vardiya" || d.tur === "izin");
  const o = veri?.ozet;

  const gezinti = (
    <div className="pv-gezinti">
      <Button size="small" onClick={() => setHafta(hafta.add(-7, "day"))} aria-label="Önceki hafta">
        ‹
      </Button>
      <span className="pv-hafta">
        {hafta.format("DD MMM")} – {hafta.add(6, "day").format("DD MMM YYYY")}
      </span>
      <Button size="small" onClick={() => setHafta(hafta.add(7, "day"))} aria-label="Sonraki hafta">
        ›
      </Button>
      {!buHafta && (
        <Button size="small" type="link" onClick={() => setHafta(haftaBasi(dayjs()))}>
          Bu hafta
        </Button>
      )}
    </div>
  );

  return (
    <div className="pl-kart pv">
      <div className="pl-kart-bas">
        <h3>
          <CalendarClock size={16} strokeWidth={2} />
          Vardiya planı
        </h3>
        <div className="pl-sag">{gezinti}</div>
      </div>

      <div className="pl-kart-ic">
        {hata ? (
          <div className="pl-bos-ic">{hata}</div>
        ) : !veri ? (
          <Spin />
        ) : (
          <div className={yukleniyor ? "pv-yukleniyor" : undefined}>
            <div className="pv-ust">
              {planli || veri.durum !== "taslak" ? (
                <span className={`pv-hap ${durum?.sinif}`}>{durum?.ad}</span>
              ) : (
                <span className="pv-hap pv-hap-plansiz">Bu hafta plan yapılmadı</span>
              )}
              {veri.gonderen && (
                <span className="pv-gonderen">
                  {veri.gonderen}
                  {veri.gonderme ? ` · ${dayjs(veri.gonderme).format("DD MMM HH:mm")}` : ""}
                  {veri.surum > 1 ? ` · ${veri.surum}. sürüm` : ""}
                </span>
              )}
            </div>

            <div className="pv-gunler">
              {(veri.gunler ?? []).map((d: any, i: number) => {
                const yillik = d.tur === "yillik";
                const r = d.tur === "vardiya" ? RENKLER[d.renk] ?? RENKLER.mavi : null;
                const rapor = yillik && String(d.izinKisa ?? "").toLocaleLowerCase("tr").startsWith("rapor");

                const rozet = yillik
                  ? { ad: d.izinKisa ?? "İzinli", zemin: rapor ? "#fdecec" : "#eef7df", yazi: rapor ? "#b42318" : "#3a5709" }
                  : d.tur === "izin"
                  ? { ad: "Haftalık izin", zemin: "#f1f3ef", yazi: "#4b5563" }
                  : r
                  ? { ad: d.ad, zemin: r.zemin, yazi: r.yazi }
                  : null;

                const ilk = saat(d.ilkOkutma);
                const son = saat(d.sonOkutma);
                const gd = GUN_DURUM[d.gunDurum];

                return (
                  <div key={i} className={`pv-gun${d.bugun ? " pv-bugun" : ""}`}>
                    <div className="pv-gun-bas">
                      <b>{GUNLER[i]}</b>
                      <span>{dayjs(d.tarih).format("DD MMM")}</span>
                    </div>

                    {rozet ? (
                      <span
                        className="pv-rozet"
                        style={{ background: rozet.zemin, color: rozet.yazi }}
                        title={d.tur === "vardiya" && d.tip && TIP_ADI[d.tip] ? TIP_ADI[d.tip] : undefined}
                      >
                        {rozet.ad}
                      </span>
                    ) : (
                      <span className="pv-rozet pv-rozet-bos">Plan yok</span>
                    )}

                    {/* Kısmi ya da onay bekleyen izin */}
                    {!yillik && d.izinTuru && (
                      <small className="pv-izin" title={d.izinAyrinti ?? undefined}>
                        {d.izinBekliyor ? "izin talebi" : d.izinKisa}
                        {d.izinAyrinti && !d.izinBekliyor ? ` ${d.izinAyrinti}` : ""}
                      </small>
                    )}

                    <div className="pv-saat">
                      {ilk ? (
                        <>
                          {ilk} – {son ?? (d.gunDurum === "iceride" ? "…" : "?")}
                        </>
                      ) : (
                        <span className="pv-saat-yok">— : —</span>
                      )}
                    </div>

                    {gd && <span className={`pv-cip ${gd.sinif}`}>{gd.ad}</span>}

                    {d.celiski && (
                      <span className="pv-nokta" title="İzinli/boş görünen günde okutma var" />
                    )}
                  </div>
                );
              })}
            </div>

            {o && (
              <div className="pv-ozet">
                <span>
                  <b>{o.calisma}</b> çalışma günü
                </span>
                <span>
                  <b>{o.haftalikIzin}</b> haftalık izin
                </span>
                {o.izinli > 0 && (
                  <span>
                    <b>{o.izinli}</b> gün izinli
                  </span>
                )}
                <span className="pv-yesil">
                  <b>{o.okuttu}</b> okuttu
                </span>
                <span className={o.okutmadi > 0 ? "pv-kirmizi" : undefined}>
                  <b>{o.okutmadi}</b> okutmadı
                </span>
              </div>
            )}

            {(veri.uyarilar?.length ?? 0) > 0 && (
              <div className="pv-uyari">
                {(veri.uyarilar as string[]).map((u, i) => (
                  <div key={i}>{u}</div>
                ))}
              </div>
            )}

            <div className="pl-kart-dip">
              Saatler QR okutmalarından gelir (günün ilk ve son okutması). Planı Personeller › Vardiya
              Planları ekranından düzenleyebilirsiniz.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
