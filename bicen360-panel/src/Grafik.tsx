/**
 * ---------------------------------------------------------------------------
 * Grafik bileşenleri
 * ---------------------------------------------------------------------------
 * Anasayfa ve Raporlar aynı çizimleri kullanıyor. El yazımı SVG: bir grafik
 * kütüphanesi eklemek yayın akışına her seferinde bağımlılık kurulumu
 * sokuyordu ve ihtiyaç halka, çubuk ve oranlı satırdan ibaret.
 * ---------------------------------------------------------------------------
 */

import { Empty, Tooltip } from "antd";

/**
 * Halka grafik.
 *
 * Dilimler SVG yayı olarak çiziliyor. Ortadaki boşlukta toplam duruyor:
 * dilim yüzdelerine bakan kullanıcı toplamı da merak ediyor ve ayrıca
 * aramak zorunda kalıyordu.
 */
export function Halka({
  dilimler,
  etiket = "kayıt",
}: {
  dilimler: { ad: string; deger: number; renk: string }[];
  etiket?: string;
}) {
  const toplam = dilimler.reduce((t, d) => t + d.deger, 0);

  if (toplam === 0)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Veri yok." />;

  const R = 68;
  const kalinlik = 24;
  const cevre = 2 * Math.PI * R;

  let birikim = 0;

  return (
    <div className="pn-halka">
      <svg viewBox="0 0 180 180" width={180} height={180}>
        <g transform="translate(90,90) rotate(-90)">
          {dilimler.map((d) => {
            const uzunluk = (d.deger / toplam) * cevre;

            const yay = (
              <circle
                key={d.ad}
                r={R}
                fill="none"
                stroke={d.renk}
                strokeWidth={kalinlik}
                strokeDasharray={`${uzunluk} ${cevre - uzunluk}`}
                strokeDashoffset={-birikim}
              />
            );

            birikim += uzunluk;

            return yay;
          })}
        </g>

        <text x="90" y="86" textAnchor="middle" className="pn-halka-sayi">
          {toplam}
        </text>
        <text x="90" y="104" textAnchor="middle" className="pn-halka-yazi">
          {etiket}
        </text>
      </svg>

      <div className="pn-halka-liste">
        {dilimler.map((d) => (
          <div key={d.ad}>
            <i style={{ background: d.renk }} />
            <span>{d.ad}</span>
            <b>{d.deger}</b>
            <em>{Math.round((d.deger / toplam) * 100)}%</em>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Çubuk grafik.
 *
 * Etiketler seyreltiliyor: doksan günlük bir dönemde her günün tarihini
 * yazmak okunmaz bir şerit bırakıyordu.
 */
export function Cubuk({
  kayitlar,
  renk = "#7cb518",
  biciml,
}: {
  kayitlar: { etiket: string; deger: number }[];
  renk?: string;
  biciml?: (d: number) => string;
}) {
  if (kayitlar.length === 0)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Veri yok." />;

  const enYuksek = Math.max(...kayitlar.map((k) => k.deger), 1);
  const atlama = Math.ceil(kayitlar.length / 12);

  return (
    <div className="pn-cubuk">
      <div className="pn-cubuk-alan">
        {kayitlar.map((k, i) => (
          <Tooltip
            key={i}
            title={`${k.etiket} · ${biciml ? biciml(k.deger) : k.deger}`}
          >
            <div className="pn-cubuk-sutun">
              <div
                className="pn-cubuk-dolu"
                style={{
                  height: `${Math.max((k.deger / enYuksek) * 100, k.deger > 0 ? 4 : 0)}%`,
                  background: renk,
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>

      <div className="pn-cubuk-etiket">
        {kayitlar.map((k, i) => (
          <span key={i}>{i % atlama === 0 ? k.etiket : ""}</span>
        ))}
      </div>
    </div>
  );
}

/** Yatay oranlı satır listesi: departman, şube ve cihaz türü için ortak */
export function Satirlar({
  kayitlar,
  renk,
  biciml,
}: {
  kayitlar: { ad: string; deger: number; yan?: string; bas?: () => void }[];
  renk: string;
  biciml?: (d: number) => string;
}) {
  if (kayitlar.length === 0)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Veri yok." />;

  const enYuksek = Math.max(...kayitlar.map((k) => k.deger), 1);

  return (
    <div className="pn-oranlar">
      {kayitlar.map((k) => (
        <div
          className={`pn-oran${k.bas ? " pn-tiklanir" : ""}`}
          key={k.ad}
          onClick={k.bas}
        >
          <div className="pn-oran-ust">
            <span title={k.ad}>{k.ad}</span>
            <b>
              {biciml ? biciml(k.deger) : k.deger}
              {k.yan && <em> · {k.yan}</em>}
            </b>
          </div>

          <div className="pn-oran-alt">
            <div
              className="pn-oran-dolu"
              style={{ width: `${(k.deger / enYuksek) * 100}%`, background: renk }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
