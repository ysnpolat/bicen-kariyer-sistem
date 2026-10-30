/**
 * Okutmanın nereden yapıldığını gösteren etiket: Biçen360 uygulaması,
 * iCard kart sistemi ya da onaylı manuel düzeltme.
 */

import { Tag, Tooltip } from "antd";
import { CreditCard, PencilLine, Smartphone } from "lucide-react";
import dayjs from "dayjs";

const TANIM: Record<string, { renk: string; ikon: any; aciklama: string }> = {
  "Biçen360": { renk: "green", ikon: Smartphone, aciklama: "Biçen360 uygulamasından karekod okutması" },
  iCard: { renk: "blue", ikon: CreditCard, aciklama: "iCard uygulamasından okutma" },
  Manuel: { renk: "orange", ikon: PencilLine, aciklama: "Onaylanan manuel giriş-çıkış düzeltmesi" },
};

export function KaynakEtiketi({ kaynak, kucuk }: { kaynak: string; kucuk?: boolean }) {
  const t = TANIM[kaynak] ?? { renk: "default", ikon: Smartphone, aciklama: kaynak };
  const Ikon = t.ikon;

  return (
    <Tooltip title={t.aciklama}>
      <Tag
        color={t.renk}
        style={{
          marginInlineEnd: 4,
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          fontSize: kucuk ? 10.5 : undefined,
          lineHeight: kucuk ? "16px" : undefined,
          padding: kucuk ? "0 5px" : undefined,
        }}
      >
        <Ikon size={kucuk ? 10 : 11} />
        {kaynak}
      </Tag>
    </Tooltip>
  );
}

export function KaynakEtiketleri({ kaynaklar, kucuk }: { kaynaklar?: string[]; kucuk?: boolean }) {
  if (!kaynaklar?.length) return null;

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", rowGap: 2 }}>
      {kaynaklar.map((k) => (
        <KaynakEtiketi key={k} kaynak={k} kucuk={kucuk} />
      ))}
    </span>
  );
}

/** Günün okutmaları: saat, yön ve kaynak; tooltip içinde gösterilir. */
export function HareketListesi({ hareketler }: { hareketler?: any[] }) {
  if (!hareketler?.length) return null;

  return (
    <div style={{ minWidth: 190 }}>
      {hareketler.map((h: any, i: number) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: "20px" }}>
          <b style={{ width: 38 }}>{dayjs(h.zaman ?? h.gecisZamani).format("HH:mm")}</b>
          <span style={{ width: 42 }}>{h.giris ? "Giriş" : "Çıkış"}</span>
          <span style={{ opacity: 0.85 }}>{h.kaynak}</span>
        </div>
      ))}
    </div>
  );
}
