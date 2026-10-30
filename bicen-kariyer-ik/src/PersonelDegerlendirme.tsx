/* ===========================================================================
   Personel kartı › Performans ve değerlendirme.

   Genel puan = bir önceki ayın performans notu + oryantasyondaki yönetici
   değerlendirmesi (ortalama). Mağaza / bölge müdüründe ikinci parça,
   ekibinin oryantasyon formunda "yöneticim" sorularına verdiği puan.
   Genel merkez ve Akçaburgaz Depo'da performans notu yok.

   Veri: GET /api/Degerlendirme/Personel/{kod}
   =========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { Spin } from "antd";
import dayjs from "dayjs";

import { api } from "./api";
import "./PersonelDegerlendirme.css";

const ASAMALAR: { k: string; ad: string }[] = [
  { k: "7g", ad: "7. gün" },
  { k: "2a", ad: "2. ay" },
  { k: "6a", ad: "6. ay" },
  { k: "1y", ad: "1. yıl" },
];

const sayi = (n: any, basamak = 1) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("tr-TR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: basamak,
      });

const bes = (n: any) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

const tarih = (t: any) => (t ? dayjs(t).format("DD MMM YYYY") : "");

const ayAdi = (yil: number, ay: number) =>
  dayjs(`${yil}-${String(ay).padStart(2, "0")}-01`).format("MMMM YYYY");

const puanRenk = (p: number | null | undefined) =>
  p === null || p === undefined ? "" : p >= 4 ? "pd-iyi" : p >= 3 ? "pd-orta" : "pd-zayif";

const harf = (ad: string) =>
  (ad || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toLocaleUpperCase("tr-TR");

/* ------------------------------------------------------------------ */

function GenelKart({ genel, mudur }: { genel: any; mudur: boolean }) {
  const puan = genel?.puan ?? null;

  return (
    <div className="pd-genel">
      <span className="pd-genel-baslik">GENEL PUAN{mudur ? " · YÖNETİCİ" : ""}</span>
      <div className="pd-genel-ic">
        <div
          className="pd-halka"
          style={{
            background: `conic-gradient(#7cb518 ${(puan ?? 0) * 3.6}deg, rgba(255,255,255,.12) 0)`,
          }}
        >
          <div>
            <span>{puan === null ? "—" : sayi(puan, 0)}</span>
          </div>
        </div>
        <div className="pd-genel-yazi">
          <b>{genel?.etiket ?? "Henüz puan yok"}</b>
          <span>
            {genel?.formul ??
              "Performans notu ve oryantasyon yönetici değerlendirmesi geldikçe hesaplanır."}
          </span>
        </div>
      </div>
    </div>
  );
}

function PerfKart({ veri }: { veri: any }) {
  const p = veri.performans;

  if (veri.performansYok) {
    return (
      <div className="pd-kart">
        <span className="pd-ust">PERFORMANS NOTU</span>
        <div className="pd-buyuk pd-soluk">—</div>
        <span className="pd-alt">
          Genel merkez ve Akçaburgaz Depo personelinde aylık performans notu yok; genel puan
          yalnızca oryantasyondaki yönetici değerlendirmesinden.
        </span>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="pd-kart">
        <span className="pd-ust">PERFORMANS NOTU</span>
        <div className="pd-buyuk pd-soluk">—</div>
        <span className="pd-alt">Son üç ayda performans kaydı bulunamadı.</span>
      </div>
    );
  }

  return (
    <div className="pd-kart">
      <span className="pd-ust">PERFORMANS NOTU · {ayAdi(p.yil, p.ay).toLocaleUpperCase("tr-TR")}</span>
      <div className="pd-buyuk">
        {sayi(p.puan)}
        <small>/ 100</small>
      </div>
      <span className="pd-alt">
        {p.birOncekiAy ? "Bir önceki ayın notu" : "Bir önceki ay henüz hesaplanmadı; en son dönem"}
        {" · "}mağaza {sayi(p.magaza)} + yetkinlik {sayi(p.yetkinlik)}
        {p.sirketSirasi > 0 && ` · şirket sırası ${p.sirketSirasi}`}
      </span>
      <div className="pd-cubuk">
        <i style={{ width: `${Math.min(100, Math.max(0, p.puan))}%`, background: "#1a4d80" }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Oryantasyon({ veri }: { veri: any }) {
  const o = veri.oryantasyon;
  const liste: any[] = o?.asamalar ?? [];
  /* Açılışta yönetici formu olan en son aşama */
  const varsayilan =
    [...liste].reverse().find((x) => x.yonetici)?.asama ?? [...liste].reverse()[0]?.asama ?? null;
  const [secili, setSecili] = useState<string | null>(varsayilan);

  useEffect(() => setSecili(varsayilan), [varsayilan]);

  const s = liste.find((x) => x.asama === secili);

  return (
    <div className="pd-kart pd-bolum">
      <div className="pd-bolum-baslik">
        <b>Oryantasyon anketleri</b>
        <span>
          çalışanın kendi formu ve yöneticisinin değerlendirmesi
          {liste.length > 0 && " · aşamaya dokunun"}
          {!o?.genelPuandaMi && " · yöneticilerde genel puana katılmaz"}
        </span>
      </div>

      <div className="pd-asamalar">
        {ASAMALAR.map((a) => {
          const v = liste.find((x) => x.asama === a.k);
          const yonetici = v?.yonetici?.puan ?? null;
          const secim = v?.yonetici?.secimler?.[0]?.yanit;

          return (
            <button
              key={a.k}
              type="button"
              disabled={!v}
              className={`pd-asama${secili === a.k ? " pd-secili" : ""}${!v ? " pd-bos" : ""}`}
              onClick={() => setSecili(a.k)}
            >
              <span className="pd-asama-ad">
                {a.ad.toLocaleUpperCase("tr-TR")}
                {v && ` · ${tarih(v.yonetici?.tarih ?? v.calisan?.tarih)}`}
              </span>
              {v ? (
                <>
                  <div className="pd-asama-puan">
                    <div>
                      <small>Yönetici</small>
                      <b className="pd-yesil">{bes(yonetici)}</b>
                    </div>
                    <div>
                      <small>Çalışan</small>
                      <b className="pd-mavi">{bes(v.calisan?.puan)}</b>
                    </div>
                  </div>
                  <small className="pd-asama-sonuc">
                    {secim ?? (v.yonetici ? "" : "Yönetici formu dolmadı")}
                  </small>
                </>
              ) : (
                <small className="pd-asama-sonuc">Form dolmadı</small>
              )}
            </button>
          );
        })}
      </div>

      {liste.length === 0 ? (
        <div className="pd-bos-ic">Bu personel için doldurulmuş oryantasyon formu yok.</div>
      ) : (
        s && (
          <div className="pd-detay">
            <div className="pd-ic">
              <div className="pd-ic-baslik">
                <b>Yönetici değerlendirmesi · {ASAMALAR.find((a) => a.k === s.asama)?.ad}</b>
                {s.yonetici && (
                  <span>
                    {s.yonetici.degerlendiren ? `${s.yonetici.degerlendiren} · ` : ""}
                    {tarih(s.yonetici.tarih)}
                  </span>
                )}
                {s.yonetici && <em className="pd-yesil">{bes(s.yonetici.puan)} / 5</em>}
              </div>

              {!s.yonetici ? (
                <div className="pd-bos-ic">Bu aşamada yönetici formu henüz doldurulmadı.</div>
              ) : (
                <>
                  {(s.yonetici.maddeler ?? []).map((m: any, i: number) => {
                    const p = Math.max(0, Math.min(5, Math.round(Number(m.puan) || 0)));
                    return (
                      <div className="pd-madde" key={i}>
                        <span>{m.soru}</span>
                        <div className="pd-noktalar" aria-label={`${m.puan} / 5`}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <i key={n} className={n <= p ? "pd-dolu" : undefined} />
                          ))}
                        </div>
                        <b>{sayi(m.puan)}</b>
                      </div>
                    );
                  })}

                  {((s.yonetici.secimler ?? []).length > 0 || (s.yonetici.acik ?? []).length > 0) && (
                    <div className="pd-not">
                      {(s.yonetici.secimler ?? []).map((x: any, i: number) => (
                        <div key={`s${i}`}>
                          <b>{x.soru}:</b> {x.yanit}
                          {x.aciklama && ` — ${x.aciklama}`}
                        </div>
                      ))}
                      {(s.yonetici.acik ?? []).map((x: any, i: number) => (
                        <div key={`a${i}`}>
                          <b>{x.soru}:</b> “{x.yanit}”
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="pd-sag">
              <div className="pd-ic">
                <div className="pd-ic-baslik">
                  <b>Çalışanın formu · {ASAMALAR.find((a) => a.k === s.asama)?.ad}</b>
                  {s.calisan && <em className="pd-mavi">{bes(s.calisan.puan)} / 5</em>}
                </div>

                {!s.calisan ? (
                  <div className="pd-bos-ic">Çalışan bu aşamanın formunu doldurmadı.</div>
                ) : (
                  <>
                    {s.calisan.yoneticiSorusu && (
                      <>
                        <div className="pd-yonsoru">
                          <span>“{s.calisan.yoneticiSorusu}”</span>
                          <b>{bes(s.calisan.yoneticiyePuan)}</b>
                        </div>
                        <small className="pd-alt">
                          Bu soru yöneticinin kendi değerlendirmesine gider (müdür kartındaki
                          “ekibinin gözünden”).
                        </small>
                      </>
                    )}
                    {(s.calisan.acik ?? []).map((x: any, i: number) => (
                      <div className="pd-calisan-not" key={i}>
                        <small>{x.soru}</small>“{x.yanit}”
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="pd-bilgi">
                <b>Puan nasıl hesaplanıyor?</b>
                <span>
                  Oryantasyonda yönetici formunun ölçekli soruları (1–5) her aşamada 0–5 puana
                  çevriliyor; doldurulan aşamaların ortalaması ×20 ile 100'lük ölçeğe geliyor.
                  Genel puan = bir önceki ayın performans notu ile bu ortalamanın ortalaması.
                  Henüz yönetici formu dolmamışsa genel puan yalnızca performans notundan.
                </span>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Ekip({ veri }: { veri: any }) {
  const e = veri.ekip;
  const bolge = veri.rol === "bolgeMuduru";

  return (
    <div className="pd-kart pd-bolum">
      <div className="pd-bolum-baslik">
        <b>Ekibinin gözünden · oryantasyon</b>
        <span>
          {bolge
            ? "bölgesindeki mağaza müdürlerinin oryantasyon formunda bölge müdürüne verdiği puan"
            : "şubesindeki personelin oryantasyon formunda “yöneticim” sorularına verdiği puan"}
        </span>
      </div>

      {!e ? (
        <div className="pd-bos-ic">Son iki yılda bu yöneticiye bağlanan çalışan formu yok.</div>
      ) : (
        <>
          <div className="pd-asamalar">
            {(e.asamalar ?? []).map((a: any) => (
              <div className="pd-ekip-asama" key={a.asama}>
                <b>{String(a.ad).toLocaleUpperCase("tr-TR")}</b>
                <span>{a.soru ? `“${a.soru}”` : "—"}</span>
                <em>
                  {a.ort === null ? "—" : bes(a.ort)} <small>· {a.adet} form</small>
                </em>
              </div>
            ))}
          </div>

          <div className="pd-tablo">
            <div className="pd-satir pd-tbas">
              <span>{bolge ? "MAĞAZA MÜDÜRÜ" : "PERSONEL"}</span>
              <span>ŞUBE</span>
              <span>AŞAMA</span>
              <span>PUAN</span>
              <span>NOT</span>
            </div>
            {(e.formlar ?? []).map((f: any, i: number) => (
              <div className="pd-satir" key={i}>
                <b>{f.adSoyad || f.sicil}</b>
                <span>{f.sube || "—"}</span>
                <span>{f.asama}</span>
                <b className={puanRenk(f.puan)}>{bes(f.puan)} / 5</b>
                <span className="pd-kucuk">{f.not || "—"}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Cikislar({ veri }: { veri: any }) {
  const c = veri.cikislar;
  const [acik, setAcik] = useState<number | null>(null);

  return (
    <div className="pd-kart pd-bolum">
      <div className="pd-bolum-baslik">
        <b>Yönetici kaynaklı çıkışlar</b>
        <span>
          Çıkış mülakatında neden grubu “Yönetici ve iletişim” olanlar; ayrıldığı tarihte o şubenin
          mağaza müdürüne bağlanır
        </span>
      </div>

      {!c ? (
        <div className="pd-bos-ic">Çıkış mülakatları okunamadı.</div>
      ) : c.liste.length === 0 ? (
        <div className="pd-bos-ic">Son 12 ayda bu yöneticiye bağlanan yönetici kaynaklı çıkış yok.</div>
      ) : (
        c.liste.map((x: any) => (
          <div className="pd-cikis" key={x.id}>
            <div className="pd-cikis-harf">{harf(x.adSoyad)}</div>
            <div className="pd-cikis-orta">
              <b>
                {x.adSoyad}
                <span>
                  {x.gorev && ` · ${x.gorev}`}
                  {x.sube && ` · ${x.sube}`}
                </span>
              </b>
              <small>
                Çıkış {dayjs(x.cikisTarihi).format("DD.MM.YYYY")}
                {x.sure && ` · ${x.sure} çalıştı`} · neden: <em>Yönetici ve iletişim</em>
              </small>
              {x.alinti && <p>“{x.alinti}”</p>}
              {acik === x.id && (
                <div className="pd-mulakat">
                  {x.neden && (
                    <div>
                      <b>Çıkış nedeni:</b> {x.neden}
                    </div>
                  )}
                  {x.aciklama && (
                    <div>
                      <b>Açıklama:</b> {x.aciklama}
                    </div>
                  )}
                  {x.ozet && (
                    <div>
                      <b>Mülakat özeti:</b> {x.ozet}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="pd-baglanti">
              <b>Bağlantı</b>
              <span>{x.baglanti}</span>
              <button type="button" onClick={() => setAcik(acik === x.id ? null : x.id)}>
                {acik === x.id ? "Mülakatı gizle ‹" : "Çıkış mülakatını aç ›"}
              </button>
            </div>
          </div>
        ))
      )}

      <small className="pd-alt">
        Şubenin o tarihteki mağaza müdürü aylık performans kayıtlarından (şube + görev, ay ay)
        bulunuyor. Eşleşme bulunamazsa çıkış “müdür belirlenemedi” olarak görünür. Çıkışlar şimdilik
        genel puana katılmıyor, bilgi olarak duruyor.
      </small>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function PersonelDegerlendirme({ personelKodu }: { personelKodu: string }) {
  const [veri, setVeri] = useState<any>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    let iptal = false;

    setVeri(null);
    setHata("");

    api
      .al<any>(`/api/Degerlendirme/Personel/${encodeURIComponent(personelKodu)}`)
      .then((c) => !iptal && setVeri(c))
      .catch((h: any) => !iptal && setHata(h.message || "Değerlendirme alınamadı."));

    return () => {
      iptal = true;
    };
  }, [personelKodu]);

  const mudur = veri?.rol === "magazaMuduru" || veri?.rol === "bolgeMuduru";

  const ekipAlt = useMemo(() => {
    const e = veri?.ekip;
    if (!e) return "Henüz bağlanan çalışan formu yok";
    return veri.rol === "bolgeMuduru"
      ? `${e.kisiAdet} mağaza müdürünün ${e.formAdet} formundan`
      : `Şubesindeki ${e.kisiAdet} personelin ${e.formAdet} formundan`;
  }, [veri]);

  if (hata) return <div className="pl-kart pd-hata">{hata}</div>;

  if (!veri)
    return (
      <div className="pd-yukleniyor">
        <Spin />
      </div>
    );

  const o = veri.oryantasyon;
  const yonAsama = (o?.asamalar ?? []).filter((x: any) => x.yonetici);
  const degerlendiren = [...yonAsama].reverse()[0]?.yonetici?.degerlendiren;
  const c = veri.cikislar;

  return (
    <div className="pd">
      <div className="pd-ust-izgara">
        <GenelKart genel={veri.genel} mudur={mudur} />

        <div className={`pd-kartlar${mudur ? " pd-uc" : ""}`}>
          <PerfKart veri={veri} />

          {mudur ? (
            <>
              <div className="pd-kart">
                <span className="pd-ust">EKİBİNİN GÖZÜNDEN</span>
                <div className="pd-buyuk">
                  {veri.ekip ? sayi(veri.ekip.puan) : <span className="pd-soluk">—</span>}
                  {veri.ekip && <small>/ 100</small>}
                  {veri.ekip && <em className="pd-mavi">{bes(veri.ekip.puan5)} / 5</em>}
                </div>
                <span className="pd-alt">{ekipAlt}</span>
              </div>

              <div className="pd-kart pd-turuncu">
                <span className="pd-ust">YÖNETİCİ KAYNAKLI ÇIKIŞ</span>
                <div className="pd-buyuk">
                  {c ? c.adet : "—"}
                  <small>kişi · son 12 ay</small>
                </div>
                <span className="pd-alt">
                  {c
                    ? `${veri.rol === "bolgeMuduru" ? "Bölgede" : "Şubede"} ${c.toplamCikis} çıkışın ${c.adet}’i${
                        c.oran !== null && c.oran !== undefined ? ` (%${sayi(c.oran)})` : ""
                      }`
                    : "Çıkış mülakatları okunamadı"}
                </span>
              </div>
            </>
          ) : (
            <div className="pd-kart">
              <span className="pd-ust">ORYANTASYON · YÖNETİCİ DEĞERLENDİRMESİ</span>
              <div className="pd-buyuk">
                {o?.yoneticiPuan !== null && o?.yoneticiPuan !== undefined ? (
                  <>
                    {sayi(o.yoneticiPuan)}
                    <small>/ 100</small>
                    <em className="pd-yesil">{bes(o.yoneticiOrt5)} / 5</em>
                  </>
                ) : (
                  <span className="pd-soluk">—</span>
                )}
              </div>
              <span className="pd-alt">
                {yonAsama.length > 0
                  ? `${yonAsama.length} aşamanın ortalaması${degerlendiren ? ` · değerlendiren ${degerlendiren}` : ""}`
                  : "Henüz yönetici formu doldurulmadı"}
              </span>
              {o?.yoneticiPuan != null && (
                <div className="pd-cubuk">
                  <i style={{ width: `${Math.min(100, o.yoneticiPuan)}%` }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {mudur && <Ekip veri={veri} />}
      {mudur && <Cikislar veri={veri} />}
      {(!mudur || (o?.asamalar ?? []).length > 0) && <Oryantasyon veri={veri} />}
    </div>
  );
}
