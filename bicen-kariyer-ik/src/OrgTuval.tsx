/**
 * ---------------------------------------------------------------------------
 * Organizasyon Şeması — serbest tuval
 * ---------------------------------------------------------------------------
 * Kutular elle yerleştiriliyor: sürükle, bırak, konum kaydedilir. Bağlantı
 * çizgileri üst kutudan alt kutuya kendiliğinden çiziliyor; kutu nereye
 * taşınırsa taşınsın hiyerarşi (ve dolayısıyla izin onay zinciri) "bağlı
 * olduğu kutu" alanından geliyor, konumdan değil.
 *
 * Otomatik düzen hiçbir zaman elle kurulmuş Excel şemasını birebir
 * tutturamıyordu; yerleşim kararı artık kullanıcının.
 *
 * Düzenleme kapalıyken aynı tuval salt okunur çiziliyor.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";

export const KUTU_YUKSEKLIK = 50;
export const VARSAYILAN_GENISLIK = 124;
const IZGARA = 10;
const BASLIK_PAYI = 110;

export type Konum = { x: number; y: number; g: number };

/** Kutu renkleri; Organizasyon.tsx'teki paletle aynı */
const RENK: Record<string, { zemin: string; kenar: string; yazi: string }> = {
  yesil: { zemin: "#e8f4d5", kenar: "#7CB518", yazi: "#3a5709" },
  mavi: { zemin: "#dfeefb", kenar: "#3d8ecc", yazi: "#134160" },
  turuncu: { zemin: "#fde8d9", kenar: "#E8481C", yazi: "#7a2409" },
  kirmizi: { zemin: "#fadfdf", kenar: "#cf1322", yazi: "#660d15" },
  mor: { zemin: "#eae4f6", kenar: "#7c5bc4", yazi: "#392663" },
  bej: { zemin: "#f7f2ea", kenar: "#cbb99d", yazi: "#584631" },
  gri: { zemin: "#f0f2ed", kenar: "#c4cbbd", yazi: "#46525d" },
};

/**
 * Konumu olmayan kutular için başlangıç yerleşimi: seviye seviye, soldan
 * sağa. Yalnızca başlangıç; kullanıcı sonra sürükleyerek düzenliyor.
 */
export function otomatikKonumlar(kutular: any[]): Record<number, Konum> {
  const cocuk = new Map<number | null, any[]>();

  for (const k of kutular) {
    const u = k.ustId ?? null;
    if (!cocuk.has(u)) cocuk.set(u, []);
    cocuk.get(u)!.push(k);
  }

  const sonuc: Record<number, Konum> = {};
  let seviye = cocuk.get(null) ?? [];
  let y = BASLIK_PAYI;

  while (seviye.length) {
    let x = 40;

    for (const k of seviye) {
      sonuc[k.id] = { x, y, g: k.genislik ?? VARSAYILAN_GENISLIK };
      x += (k.genislik ?? VARSAYILAN_GENISLIK) + 12;
    }

    seviye = seviye.flatMap((k) => cocuk.get(k.id) ?? []);
    y += KUTU_YUKSEKLIK + 24;
  }

  return sonuc;
}

export default function OrgTuval({
  kutular,
  duzenle,
  olcek,
  seciliId,
  logo,
  kutuSec,
  konumKaydet,
}: {
  kutular: any[];
  duzenle: boolean;
  olcek: number;
  seciliId?: number | null;
  logo?: string;
  kutuSec: (k: any) => void;
  konumKaydet: (liste: { id: number; x: number; y: number; genislik?: number }[]) => void;
}) {
  /* Konumlar yerel durumda: sürükleme sırasında her harekette sunucuya
     gitmemek için. Bırakınca yalnızca taşınan kutu kaydediliyor. */
  const [konum, setKonum] = useState<Record<number, Konum>>({});

  useEffect(() => {
    const oto = otomatikKonumlar(kutular);
    const k: Record<number, Konum> = {};

    for (const x of kutular)
      k[x.id] =
        x.konumX != null && x.konumY != null
          ? { x: x.konumX, y: x.konumY, g: x.genislik ?? VARSAYILAN_GENISLIK }
          : oto[x.id];

    setKonum(k);
  }, [kutular]);

  /* Bırakma anında son konumu okumak için: durum güncelleyicinin içinde
     kayıt isteği atmak, geliştirme kipinde iki kez çalışıyordu. */
  const konumRef = useRef(konum);
  konumRef.current = konum;

  const surukle = useRef<{
    id: number;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    tasindi: boolean;
  } | null>(null);

  useEffect(() => {
    const hareket = (e: PointerEvent) => {
      const d = surukle.current;
      if (!d) return;

      const dx = (e.clientX - d.sx) / (olcek / 100);
      const dy = (e.clientY - d.sy) / (olcek / 100);

      if (Math.abs(dx) + Math.abs(dy) > 4) d.tasindi = true;
      if (!d.tasindi) return;

      /* Izgaraya oturuyor: kutular elle hizalamaya gerek kalmadan aynı
         çizgiye geliyor. */
      const x = Math.max(0, Math.round((d.ox + dx) / IZGARA) * IZGARA);
      const y = Math.max(BASLIK_PAYI - 20, Math.round((d.oy + dy) / IZGARA) * IZGARA);

      setKonum((k) => ({ ...k, [d.id]: { ...k[d.id], x, y } }));
    };

    const birak = () => {
      const d = surukle.current;
      surukle.current = null;

      if (!d) return;

      if (!d.tasindi) {
        const k = kutular.find((x) => x.id === d.id);
        if (k) kutuSec(k);
        return;
      }

      const p = konumRef.current[d.id];
      if (p) konumKaydet([{ id: d.id, x: p.x, y: p.y, genislik: p.g }]);
    };

    window.addEventListener("pointermove", hareket);
    window.addEventListener("pointerup", birak);

    return () => {
      window.removeEventListener("pointermove", hareket);
      window.removeEventListener("pointerup", birak);
    };
  }, [olcek, kutular, kutuSec, konumKaydet]);

  /* Tuval boyutu: kutuların kapladığı alana göre.

     Görüntülemede en soldaki kutunun solundaki boş alan kırpılıyor:
     kutular sağa yerleştirildiğinde boşluk da ekrana sığdırmaya dahil
     oluyor ve şema küçük görünüyordu. Düzenlemede kırpılmıyor; sol
     kenardaki kutu sürüklenirken bütün tuval kaymasın. */
  const { en, boy, kay } = useMemo(() => {
    const liste = Object.values(konum).filter(Boolean) as Konum[];

    const enSol = liste.length ? Math.min(...liste.map((p) => p.x)) : 40;
    const k = duzenle ? 0 : Math.max(0, enSol - 40);

    let e = duzenle ? 1100 : 700;
    let b = 400;

    for (const p of liste) {
      e = Math.max(e, p.x - k + p.g + 40);
      b = Math.max(b, p.y + KUTU_YUKSEKLIK + 40);
    }

    return { en: e, boy: b, kay: k };
  }, [konum, duzenle]);

  /* Bağlantılar: üst kutunun alt ortasından alt kutunun üst ortasına,
     ortada kırılan çizgi (Excel şemalarındaki gibi). */
  const cizgiler = kutular
    .filter((k) => k.ustId && konum[k.id] && konum[k.ustId])
    .map((k) => {
      const u = konum[k.ustId];
      const c = konum[k.id];
      const x1 = u.x - kay + u.g / 2;
      const y1 = u.y + KUTU_YUKSEKLIK;
      const x2 = c.x - kay + c.g / 2;
      const y2 = c.y;
      const orta = y1 + (y2 - y1) / 2;

      return { id: k.id, d: `M ${x1} ${y1} L ${x1} ${orta} L ${x2} ${orta} L ${x2} ${y2}` };
    });

  return (
    <div
      style={{
        position: "relative",
        width: en,
        height: boy,
        background: duzenle
          ? "radial-gradient(circle, #dfe3da 1px, transparent 1px) 0 0 / 20px 20px, #fff"
          : "#fff",
        userSelect: "none",
      }}
    >
      {/* başlık */}
      <div style={{ position: "absolute", left: 40, top: 26 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.3, color: "#1f2933" }}>
          BİÇEN ORGANİZASYON ŞEMASI
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#46525d", fontStyle: "italic" }}>
          {new Date().toLocaleDateString("tr-TR")}
        </div>
      </div>

      {logo && (
        <img
          src={logo}
          alt="Biçen"
          style={{ position: "absolute", right: 40, top: 20, height: 56, pointerEvents: "none" }}
        />
      )}

      <svg
        width={en}
        height={boy}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {cizgiler.map((c) => (
          <path key={c.id} d={c.d} fill="none" stroke="#8a929b" strokeWidth={1.4} />
        ))}
      </svg>

      {kutular.map((k) => {
        const p = konum[k.id];
        if (!p) return null;

        const r = RENK[k.renk] ?? RENK.gri;
        const secili = seciliId === k.id;

        return (
          <div
            key={k.id}
            onPointerDown={(e) => {
              if (!duzenle) return;
              e.preventDefault();
              surukle.current = {
                id: k.id,
                sx: e.clientX,
                sy: e.clientY,
                ox: p.x,
                oy: p.y,
                tasindi: false,
              };
            }}
            onClick={() => {
              if (!duzenle) kutuSec(k);
            }}
            title={k.unvan}
            style={{
              position: "absolute",
              left: p.x - kay,
              top: p.y,
              width: p.g,
              height: KUTU_YUKSEKLIK,
              background: r.zemin,
              border: `1.5px solid ${r.kenar}`,
              borderTopWidth: 4,
              borderRadius: 8,
              color: r.yazi,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              padding: "4px 6px",
              fontSize: 10.5,
              fontWeight: 800,
              lineHeight: 1.2,
              textAlign: "center",
              textTransform: "uppercase",
              cursor: duzenle ? "grab" : "pointer",
              boxShadow: secili
                ? `0 0 0 3px rgba(232,72,28,.45), 0 4px 12px rgba(0,0,0,.15)`
                : "0 1px 3px rgba(0,0,0,.08)",
              zIndex: secili ? 3 : 1,
              touchAction: "none",
            }}
          >
            {k.izinOnay && (
              <span
                style={{
                  position: "absolute",
                  top: -9,
                  left: 6,
                  background: "#5f8c10",
                  color: "#fff",
                  borderRadius: 7,
                  padding: "0 5px",
                  fontSize: 8.5,
                  lineHeight: "14px",
                  textTransform: "none",
                }}
              >
                ✓ Onaylar
              </span>
            )}

            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
            >
              {k.unvan}
            </span>

            {k.personelSayisi > 0 && (
              <span
                style={{
                  flex: "none",
                  minWidth: 20,
                  padding: "1px 5px",
                  borderRadius: 10,
                  background: r.kenar,
                  color: "#fff",
                  fontSize: 10,
                }}
              >
                {k.personelSayisi}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
