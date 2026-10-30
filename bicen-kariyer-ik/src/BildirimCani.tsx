/**
 * Bildirimler (Bildirim merkezinin ikinci sekmesi)
 * ---------------------------------------------------------------------------
 * İki iş yapar:
 *
 *  1. Yeni bir bildirim geldiğinde ekranın sağ üstünde açılır kutu olarak
 *     gösterir (telefondaki bildirim gibi). Bir kez gösterilen bildirim
 *     sunucuda işaretlenir, tekrar açılmaz.
 *
 *  2. Bildirim merkezinde listeyi gösterir (07.10.2026): okunmamış / tümü,
 *     konuya göre süzme, güne göre gruplar; bildirime tıklayınca okundu
 *     olur ve ilgili sayfa açılır.
 *
 * Merkez kapalıyken de bağlı kalır (yoklama ve açılır kutular sürsün).
 * Sunucuya düzenli aralıkla sorar; anlık iletim kullanılmıyor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Button, Empty, Segmented, Tooltip } from "antd";
import dayjs from "dayjs";
import { ArrowRight, CheckCheck } from "lucide-react";

import { api, oturumOku } from "./api";
import { sayfayaGit } from "./gecis";

/** Sunucuya kaç saniyede bir sorulacağı */
const ARALIK_SANIYE = 45;

interface Bildirim {
  id: number;
  tur: string;
  baslik: string;
  metin: string | null;
  basvuruId: number | null;
  okundu: boolean;
  gosterildi: boolean;
  olusturma: string;
}

/** Bildirim türü → konu ve açılacak sayfa */
const KONU: { k: string; ad: string; renk: string; turler: string[]; sayfa?: string }[] = [
  { k: "onay", ad: "Onaylar", renk: "#2f54eb", turler: ["OnayOnaylandi", "OnayReddedildi", "OnayYaniti", "MikroBilgi"], sayfa: "basvurular" },
  { k: "gorusme", ad: "Görüşmeler", renk: "#e8481c", turler: ["GorusmeYonlendirme", "takvim_hatirlatma"], sayfa: "takvim" },
  { k: "isemri", ad: "İş emirleri", renk: "#722ed1", turler: ["is_emri", "is_emri_bitti"], sayfa: "isemri" },
  { k: "kart", ad: "Biçen Kart", renk: "#5f8c10", turler: ["puan", "puan_onay", "kart_ayrilan"], sayfa: "bicenkart" },
  { k: "personel", ad: "Personel", renk: "#d9a21b", turler: ["ayrilik_uyarisi", "pusula_itiraz", "etik"] },
  { k: "talep", ad: "Taleplerim", renk: "#13c2c2", turler: ["talep_cevap"] },
];

const konuBul = (tur: string) => KONU.find((x) => x.turler.includes(tur)) ?? { k: "diger", ad: "Diğer", renk: "#8a929b", turler: [] };

const sayfaBul = (b: Bildirim): { sayfa: string; id?: number } | null => {
  if (b.basvuruId) return { sayfa: "basvurular", id: b.basvuruId };
  if (b.tur === "ayrilik_uyarisi" || b.tur === "MikroBilgi") return { sayfa: "personeller" };
  if (b.tur === "pusula_itiraz") return { sayfa: "pusula" };
  if (b.tur === "etik") return { sayfa: "etik" };
  const k = KONU.find((x) => x.turler.includes(b.tur));
  return k?.sayfa ? { sayfa: k.sayfa } : null;
};

const gunGrubu = (t: string) => {
  const d = dayjs(t);
  if (d.isSame(dayjs(), "day")) return "Bugün";
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Dün";
  if (d.isAfter(dayjs().subtract(7, "day"))) return "Bu hafta";
  return "Daha önce";
};

export default function BildirimCani({
  acikMi,
  kapat,
  sayiDegisti,
  ac,
}: {
  acikMi: boolean;
  kapat: () => void;
  sayiDegisti?: (n: number) => void;
  /** Açılır kutuya tıklanınca merkezi bu sekmede aç */
  ac: () => void;
}) {
  const { notification } = AntdApp.useApp();

  const [liste, setListe] = useState<Bildirim[]>([]);
  const [okunmamis, setOkunmamis] = useState(0);
  const [gorunum, setGorunum] = useState<"okunmamis" | "tumu">("okunmamis");
  const [konu, setKonu] = useState<string | null>(null);

  /* Aynı bildirimin iki kez ekrana düşmemesi için yerel kayıt: sunucu
     işaretlemesi gecikirse de tekrar açılmasın. */
  const gosterilenler = useRef<Set<number>>(new Set());

  const getir = useCallback(async () => {
    /* Oturum kapanmışsa istek atılmaz. Zamanlayıcı çıkıştan hemen sonra
       tetiklenirse yetkisiz istek gider ve bildirim penceresi açılmaya
       çalışır; bu, çıkış anında ekranın boş kalmasına yol açabiliyordu. */
    if (!oturumOku()) return;

    try {
      const d = await api.al<{ liste: Bildirim[]; okunmamis: number }>("/api/Basvuru/Bildirimler");

      setListe(d.liste ?? []);
      setOkunmamis(d.okunmamis ?? 0);

      /* Henüz gösterilmemiş olanlar ekranda açılır */
      const yeniler = (d.liste ?? []).filter((b) => !b.gosterildi && !gosterilenler.current.has(b.id));

      if (yeniler.length > 0) {
        yeniler.forEach((b) => {
          gosterilenler.current.add(b.id);

          notification.open({
            message: b.baslik,
            description: b.metin,
            placement: "topRight",
            duration: 8,
            type: b.tur === "OnayReddedildi" ? "warning" : "success",
            onClick: ac,
          });
        });

        /* Sunucuya bildirilir; bir sonraki sorguda tekrar açılmaz */
        api
          .gonder(
            "/api/Basvuru/Bildirimler/Gosterildi",
            yeniler.map((b) => b.id)
          )
          .catch(() => undefined);
      }
    } catch {
      /* Bildirim alınamazsa sessiz geçilir: panelin çalışmasını
         engellememeli. */
    }
  }, [notification, ac]);

  useEffect(() => {
    getir();

    const zaman = window.setInterval(getir, ARALIK_SANIYE * 1000);
    return () => window.clearInterval(zaman);
  }, [getir]);

  useEffect(() => {
    if (acikMi) getir();
  }, [acikMi, getir]);

  useEffect(() => {
    sayiDegisti?.(okunmamis);
  }, [okunmamis, sayiDegisti]);

  /* Okunmamış yoksa açılışta tümü */
  useEffect(() => {
    if (acikMi && okunmamis === 0) setGorunum("tumu");
  }, [acikMi, okunmamis]);

  const hepsiniOkundu = async () => {
    try {
      await api.gonder("/api/Basvuru/Bildirimler/Okundu", []);
      getir();
    } catch {
      /* yoksayılır */
    }
  };

  const okunduYap = async (id: number) => {
    try {
      await api.gonder("/api/Basvuru/Bildirimler/Okundu", [id]);
      getir();
    } catch {
      /* yoksayılır */
    }
  };

  const ac_ = (b: Bildirim) => {
    if (!b.okundu) okunduYap(b.id);
    const hedef = sayfaBul(b);
    if (hedef) {
      kapat();
      sayfayaGit(hedef.sayfa, hedef.id);
    }
  };

  const konuSayilari = useMemo(() => {
    const m: Record<string, number> = {};
    liste
      .filter((b) => gorunum === "tumu" || !b.okundu)
      .forEach((b) => {
        const k = konuBul(b.tur).k;
        m[k] = (m[k] ?? 0) + 1;
      });
    return m;
  }, [liste, gorunum]);

  const gorunen = liste.filter((b) => (gorunum === "tumu" || !b.okundu) && (!konu || konuBul(b.tur).k === konu));

  const gruplar: { ad: string; l: Bildirim[] }[] = [];
  gorunen.forEach((b) => {
    const g = gunGrubu(b.olusturma);
    const son = gruplar[gruplar.length - 1];
    if (son && son.ad === g) son.l.push(b);
    else gruplar.push({ ad: g, l: [b] });
  });

  const tumKonular = [...KONU, { k: "diger", ad: "Diğer", renk: "#8a929b", turler: [] }];

  return (
    <div className="bm-bildirim">
      <div className="bm-arac">
        <Segmented
          size="small"
          value={gorunum}
          onChange={(v) => setGorunum(v as any)}
          options={[
            { value: "okunmamis", label: `Okunmamış${okunmamis ? ` · ${okunmamis}` : ""}` },
            { value: "tumu", label: "Tümü" },
          ]}
        />
        <span className="bm-bosluk" />
        {okunmamis > 0 && (
          <Button size="small" icon={<CheckCheck size={14} strokeWidth={2} />} onClick={hepsiniOkundu}>
            Tümünü okundu yap
          </Button>
        )}
      </div>

      <div className="bm-konular">
        <button type="button" className={!konu ? "aktif" : ""} onClick={() => setKonu(null)}>
          Hepsi
        </button>
        {tumKonular
          .filter((x) => konuSayilari[x.k])
          .map((x) => (
            <button key={x.k} type="button" className={konu === x.k ? "aktif" : ""} onClick={() => setKonu(konu === x.k ? null : x.k)}>
              <i style={{ background: x.renk }} />
              {x.ad} <b>{konuSayilari[x.k]}</b>
            </button>
          ))}
      </div>

      {gorunen.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={gorunum === "okunmamis" ? "Okunmamış bildiriminiz yok." : "Bildiriminiz bulunmuyor."}
          style={{ marginTop: 30 }}
        />
      ) : (
        gruplar.map((g) => (
          <div key={g.ad} className="bm-grup">
            <div className="bm-grup-ad">{g.ad}</div>
            {g.l.map((b) => {
              const k = konuBul(b.tur);
              const hedef = sayfaBul(b);
              return (
                <div
                  key={b.id}
                  className={`bm-oge${b.okundu ? "" : " yeni"}`}
                  onClick={() => (hedef ? ac_(b) : !b.okundu && okunduYap(b.id))}
                  role="button"
                  tabIndex={0}
                >
                  <i className="bm-serit" style={{ background: k.renk }} />
                  <div className="bm-oge-govde">
                    <div className="bm-oge-ust">
                      <b>{b.baslik}</b>
                      <time>{dayjs(b.olusturma).format(gunGrubu(b.olusturma) === "Bugün" ? "HH:mm" : "DD.MM HH:mm")}</time>
                    </div>
                    {b.metin && <p>{b.metin}</p>}
                    <div className="bm-oge-alt">
                      <span>{k.ad}</span>
                      {hedef && (
                        <span className="bm-git">
                          Aç <ArrowRight size={12} />
                        </span>
                      )}
                      {!b.okundu && (
                        <Tooltip title="Okundu yap">
                          <button
                            type="button"
                            className="bm-okundu"
                            onClick={(e) => {
                              e.stopPropagation();
                              okunduYap(b.id);
                            }}
                          >
                            <CheckCheck size={13} />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
