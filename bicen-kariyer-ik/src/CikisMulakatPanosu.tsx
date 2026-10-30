/**
 * Çıkış Mülakatı › Mülakatlar görünümü (29.09.2026 yeni tasarım)
 * ---------------------------------------------------------------------------
 * Araç çubuğu (tarih, hazır aralıklar, kaynak süzgeci, arama), her zaman
 * görünen özet kutuları, ayrılma nedenleri / memnuniyet puanları / şubeler
 * panoları, yapay zekâ dönem değerlendirmesi ve kayıt listesi.
 *
 * Her alan tıklanabilir: bir nedene tıklayınca liste o gruba süzülür, bir
 * şubeye tıklayınca şubenin kayıtları ve özeti açılır, satıra tıklayınca
 * kaydın ayrıntısı açılır. Sayılar veriden hesaplanır; yapay zekâ yalnızca
 * yorum yazar.
 *
 * Durum ve sunucu çağrıları üst bileşende (CikisMulakati.tsx) kalıyor; bu
 * dosya yalnızca görünüm.
 */

import { useMemo, useState } from "react";
import { Button, DatePicker, Drawer, Input, Space, Spin, Tag, Tooltip, message } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { BrainCircuit, Download, MessageSquareText, RefreshCw, Search, Trash2, X } from "lucide-react";

import Tablo from "./Tablo";
import { tabloIndir } from "./raporExcel";
import "./CikisMulakat.css";

const { RangePicker } = DatePicker;

/* -------------------------------------------------------------------------- */

type Kaynak = "tumu" | "yuz" | "anket" | "cizelge";

export const kaynakAdi = (m: any): "Anket" | "Çizelge" | "Yüz yüze" =>
  m?.kullanici === "anket" || m?.uzmanAdi === "Çıkış anketi"
    ? "Anket"
    : m?.kaynak === "Çizelge"
    ? "Çizelge"
    : "Yüz yüze";

const kaynakKodu = (m: any): Kaynak => {
  const a = kaynakAdi(m);
  return a === "Anket" ? "anket" : a === "Çizelge" ? "cizelge" : "yuz";
};

const kucuk = (s: any) => String(s ?? "").toLocaleLowerCase("tr-TR");

/** Rapor sayıları: yalnızca veriden */
const hesapla = (liste: any[], grupBul: (m: any) => string) => {
  const al = (n: any, ...adlar: string[]) => {
    for (const a of adlar) if (n?.[a] != null) return n[a];
    return undefined;
  };

  const nedenler = new Map<string, { sayi: number; ifadeler: Map<string, number> }>();
  const puanlar = new Map<string, { toplam: number; adet: number }>();
  const subeler = new Map<string, number>();

  let tavsiyeToplam = 0,
    tavsiyeAdet = 0,
    tekrarEvet = 0,
    tekrarAdet = 0;

  liste.forEach((m) => {
    const g = grupBul(m);
    const n = nedenler.get(g) ?? { sayi: 0, ifadeler: new Map() };
    n.sayi++;
    const ham = (m.cikisNedeni || "").trim();
    if (ham) n.ifadeler.set(ham, (n.ifadeler.get(ham) ?? 0) + 1);
    nedenler.set(g, n);

    const s = m.subeAdi || "Belirtilmemiş";
    subeler.set(s, (subeler.get(s) ?? 0) + 1);

    try {
      const j = JSON.parse(m.sorularJson || "{}");
      const k = Array.isArray(j) ? {} : j;

      (al(k, "puanlar", "Puanlar") ?? []).forEach((p: any) => {
        const b = al(p, "baslik", "Baslik");
        const v = Number(al(p, "puan", "Puan") ?? 0);
        if (!b || v <= 0) return;
        const o = puanlar.get(b) ?? { toplam: 0, adet: 0 };
        puanlar.set(b, { toplam: o.toplam + v, adet: o.adet + 1 });
      });

      const t = al(k, "tavsiyePuani", "TavsiyePuani");
      if (typeof t === "number") {
        tavsiyeToplam += t;
        tavsiyeAdet++;
      }

      const e = al(k, "tekrarCalisir", "TekrarCalisir");
      if (typeof e === "boolean") {
        tekrarAdet++;
        if (e) tekrarEvet++;
      }
    } catch {
      /* bozuk kayıt atlanır */
    }
  });

  return {
    adet: liste.length,
    nedenler: [...nedenler.entries()]
      .map(([ad, v]) => ({
        ad,
        sayi: v.sayi,
        ifadeler: [...v.ifadeler.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (n > 1 ? `${t} (${n})` : t)),
      }))
      .sort((a, b) => b.sayi - a.sayi),
    subeler: [...subeler.entries()].map(([ad, sayi]) => ({ ad, sayi })).sort((a, b) => b.sayi - a.sayi),
    puanlar: [...puanlar.entries()]
      .map(([ad, o]) => ({ ad, ort: o.toplam / o.adet, adet: o.adet }))
      .sort((a, b) => a.ort - b.ort),
    tavsiyeOrt: tavsiyeAdet > 0 ? tavsiyeToplam / tavsiyeAdet : null,
    tekrarEvet,
    tekrarAdet,
  };
};

const puanSinifi = (v: number) => (v < 3 ? "dusuk" : v < 4 ? "orta" : "iyi");

const HAZIR: { ad: string; bas: () => Dayjs }[] = [
  { ad: "Bu ay", bas: () => dayjs().startOf("month") },
  { ad: "Son 3 ay", bas: () => dayjs().subtract(3, "month") },
  { ad: "Son 6 ay", bas: () => dayjs().subtract(6, "month") },
  { ad: "Bu yıl", bas: () => dayjs().startOf("year") },
];

/* ========================================================================== */

export interface PanoOzellikleri {
  liste: any[];
  yukleniyor: boolean;
  aralik: [Dayjs, Dayjs];
  setAralik: (a: [Dayjs, Dayjs]) => void;
  yenile: () => void;
  grupBul: (m: any) => string;

  eksik: number;
  eksikIsleniyor: boolean;
  eksikTamamla: () => void;

  ozet: string | null;
  ozetAliniyor: boolean;
  ozetAl: () => void;
  ozetKapat: () => void;

  seciliIdler: number[];
  setSeciliIdler: (k: number[]) => void;

  detayAc: (m: any) => void;
  sil: (id: number, ad: string) => void;

  subeDetay: any;
  subeYukleniyor: boolean;
  subeOzetleniyor: boolean;
  subeAc: (sube: string, ozetIste?: boolean) => void;
  subeKapat: () => void;
}

export default function CikisMulakatPanosu(o: PanoOzellikleri) {
  const [kaynak, setKaynak] = useState<Kaynak>("tumu");
  const [ara, setAra] = useState("");
  const [grup, setGrup] = useState<string | null>(null);
  const [tumSubeler, setTumSubeler] = useState(false);

  /* Kaynak süzgeci panoları da etkiliyor; neden ve arama yalnızca listeyi */
  const kaynakli = useMemo(
    () => (kaynak === "tumu" ? o.liste : o.liste.filter((m) => kaynakKodu(m) === kaynak)),
    [o.liste, kaynak]
  );

  const r = useMemo(() => hesapla(kaynakli, o.grupBul), [kaynakli, o.grupBul]);

  const gorunen = useMemo(() => {
    const a = kucuk(ara.trim());
    return kaynakli.filter(
      (m) =>
        (!grup || o.grupBul(m) === grup) &&
        (!a ||
          [m.adSoyad, m.subeAdi, m.cikisNedeni, m.ozet, m.gorev, o.grupBul(m)].some((x) => kucuk(x).includes(a)))
    );
  }, [kaynakli, grup, ara, o.grupBul]);

  const say = (k: Kaynak) => o.liste.filter((m) => kaynakKodu(m) === k).length;

  const enSik = r.nedenler.find((n) => n.ad !== "Belirtilmemiş") ?? r.nedenler[0];
  const hazir = kaynakli.filter((m) => m.ozet && m.nedenGrubu).length;
  const enCokNeden = Math.max(1, ...r.nedenler.map((n) => n.sayi));
  const enCokSube = Math.max(1, ...r.subeler.map((s) => s.sayi));
  const subeListe = tumSubeler ? r.subeler : r.subeler.slice(0, 10);

  const excel = () =>
    tabloIndir({
      baslik: "Çıkış mülakatları",
      altBaslik: `${o.aralik[0].format("DD.MM.YYYY")} – ${o.aralik[1].format("DD.MM.YYYY")}${grup ? ` · ${grup}` : ""}`,
      sayfaAdi: "Çıkış mülakatları",
      dosyaAdi: `cikis-mulakatlari-${dayjs().format("YYYY-MM-DD")}.xlsx`,
      sutunlar: [
        { ad: "Tarih", tip: "tarihSaat", genislik: 16 },
        { ad: "Personel", genislik: 24 },
        { ad: "Görev", genislik: 18 },
        { ad: "Şube", genislik: 18 },
        { ad: "Ayrılma nedeni (grup)", genislik: 26 },
        { ad: "Personelin ifadesi", genislik: 40 },
        { ad: "Özet", genislik: 60 },
        { ad: "Kaynak", genislik: 12 },
        { ad: "Görüşen", genislik: 18 },
      ],
      satirlar: gorunen.map((m) => [
        m.olusturma,
        m.adSoyad ?? "",
        m.gorev ?? "",
        m.subeAdi ?? "",
        o.grupBul(m),
        [m.cikisNedeni, m.cikisNedeniAciklama].filter(Boolean).join(" — "),
        m.ozet ?? "",
        kaynakAdi(m),
        m.uzmanAdi ?? "",
      ]),
    }).catch((h) => message.error(h?.message ?? "Excel oluşturulamadı."));

  /* ---------------------------------------------------------------- çizim */

  return (
    <div className="cmp">
      {/* ---------------------------------------------------- araç çubuğu */}
      <div className="cmp-arac">
        <RangePicker
          format="DD.MM.YYYY"
          value={o.aralik}
          allowClear={false}
          onChange={(d) => d && d[0] && d[1] && o.setAralik([d[0], d[1]])}
        />
        <div className="cmp-cipler">
          {HAZIR.map((h) => {
            const bas = h.bas();
            const acik = o.aralik[0].isSame(bas, "day") && o.aralik[1].isSame(dayjs(), "day");
            return (
              <button key={h.ad} className={`cmp-cip ${acik ? "acik" : ""}`} onClick={() => o.setAralik([bas, dayjs()])}>
                {h.ad}
              </button>
            );
          })}
        </div>
        <div className="cmp-cipler">
          {(
            [
              ["tumu", "Tümü", o.liste.length],
              ["yuz", "Yüz yüze", say("yuz")],
              ["anket", "Anket", say("anket")],
              ["cizelge", "Çizelge", say("cizelge")],
            ] as [Kaynak, string, number][]
          )
            .filter(([k, , n]) => k === "tumu" || n > 0)
            .map(([k, ad, n]) => (
              <button key={k} className={`cmp-cip ${kaynak === k ? "acik" : ""}`} onClick={() => setKaynak(k)}>
                {ad} <em>{n}</em>
              </button>
            ))}
        </div>
        <Input
          className="cmp-ara"
          allowClear
          prefix={<Search size={14} />}
          placeholder="Ad, şube, neden ya da özet ara"
          value={ara}
          onChange={(e) => setAra(e.target.value)}
        />
        <div className="cmp-aracSag">
          <Tooltip title="Yenile">
            <Button icon={<RefreshCw size={14} />} loading={o.yukleniyor} onClick={o.yenile} />
          </Tooltip>
          {o.eksik > 0 && (
            <Button className="cmp-uyari" loading={o.eksikIsleniyor} onClick={o.eksikTamamla}>
              {o.eksik} kayıt özetlenmeyi bekliyor · Tamamla
            </Button>
          )}
          <Button type="primary" icon={<BrainCircuit size={15} />} loading={o.ozetAliniyor} onClick={o.ozetAl}>
            {o.seciliIdler.length > 0 ? `Seçili ${o.seciliIdler.length} kaydı değerlendir` : "Dönem değerlendirmesi"}
          </Button>
        </div>
      </div>

      {/* --------------------------------------------------- özet kutuları */}
      <div className="cmp-kpi">
        <div className="cmp-kutu">
          <small>Ayrılan · kayıt</small>
          <div className="sayi">{r.adet}</div>
          <div className="alt">
            {say("anket")} anket · {say("yuz")} yüz yüze{say("cizelge") ? ` · ${say("cizelge")} çizelge` : ""}
          </div>
        </div>
        <div className="cmp-kutu">
          <small>Tavsiye ortalaması</small>
          <div className="sayi">
            {r.tavsiyeOrt != null ? r.tavsiyeOrt.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "—"} <span>/ 10</span>
          </div>
          <div className="cmp-serit">
            <i
              className={r.tavsiyeOrt != null && r.tavsiyeOrt >= 7 ? "iyi" : "dusuk"}
              style={{ width: `${((r.tavsiyeOrt ?? 0) / 10) * 100}%` }}
            />
          </div>
        </div>
        <div className="cmp-kutu">
          <small>Tekrar çalışır</small>
          <div className="sayi">{r.tekrarAdet ? `%${Math.round((r.tekrarEvet / r.tekrarAdet) * 100)}` : "—"}</div>
          <div className="alt">
            {r.tekrarAdet ? `${r.tekrarEvet} kişi evet, ${r.tekrarAdet - r.tekrarEvet} kişi hayır` : "yanıt yok"}
          </div>
        </div>
        <button className="cmp-kutu tik" onClick={() => enSik && setGrup(enSik.ad)} disabled={!enSik}>
          <small>En sık neden</small>
          <div className="sayi kucukSayi">{enSik?.ad ?? "—"}</div>
          <div className="alt">{enSik ? `${enSik.sayi} kişi · %${Math.round((enSik.sayi / Math.max(1, r.adet)) * 100)}` : ""}</div>
        </button>
        <button className="cmp-kutu tik" onClick={o.eksikTamamla} disabled={o.eksik === 0 || o.eksikIsleniyor}>
          <small>Özet ve sınıflandırma</small>
          <div className="sayi">
            {hazir} <span>/ {kaynakli.length} hazır</span>
          </div>
          <div className="cmp-serit">
            <i className="iyi" style={{ width: `${kaynakli.length ? (hazir / kaynakli.length) * 100 : 0}%` }} />
          </div>
        </button>
      </div>

      {/* ------------------------------------------------------- panolar */}
      <div className="cmp-pano">
        <div className="cmp-panel">
          <div className="cmp-pbas">
            <b>Ayrılma nedenleri</b>
            <small>tıklayınca liste süzülür</small>
          </div>
          {r.nedenler.length === 0 ? (
            <div className="cmp-bos">Bu dönemde kayıt yok.</div>
          ) : (
            r.nedenler.map((n) => (
              <button
                key={n.ad}
                className={`cmp-neden ${grup === n.ad ? "secili" : ""}`}
                onClick={() => setGrup(grup === n.ad ? null : n.ad)}
              >
                <b>{n.ad}</b>
                <span className="n">
                  {n.sayi}
                  <em>%{Math.round((n.sayi / Math.max(1, r.adet)) * 100)}</em>
                </span>
                <span className="ser">
                  <i style={{ width: `${(n.sayi / enCokNeden) * 100}%` }} />
                </span>
                {n.ifadeler.length > 0 && (
                  <small>
                    {n.ifadeler.slice(0, 3).join(" · ")}
                    {n.ifadeler.length > 3 ? ` · +${n.ifadeler.length - 3}` : ""}
                  </small>
                )}
              </button>
            ))
          )}
        </div>

        <div className="cmp-panel">
          <div className="cmp-pbas">
            <b>Memnuniyet puanları</b>
            <small>1–5 ortalama · düşükten yükseğe</small>
          </div>
          {r.puanlar.length === 0 ? (
            <div className="cmp-bos">Puan girilmemiş.</div>
          ) : (
            <>
              {r.puanlar.map((p) => (
                <Tooltip key={p.ad} title={`${p.adet} kişi puanladı`}>
                  <div className="cmp-puan">
                    <span>{p.ad}</span>
                    <span className="ser">
                      <i className={puanSinifi(p.ort)} style={{ width: `${(p.ort / 5) * 100}%` }} />
                    </span>
                    <b>{p.ort.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b>
                  </div>
                </Tooltip>
              ))}
              <div className="cmp-lejant">
                <span>
                  <i className="dusuk" />
                  3'ün altı
                </span>
                <span>
                  <i className="orta" />
                  3–4
                </span>
                <span>
                  <i className="iyi" />4 ve üstü
                </span>
              </div>
            </>
          )}
        </div>

        <div className="cmp-panel">
          <div className="cmp-pbas">
            <b>Şubelere göre</b>
            <small>ayrılan · tıklayınca şube açılır</small>
          </div>
          {subeListe.map((s, i) => (
            <button key={s.ad} className="cmp-sube" onClick={() => o.subeAc(s.ad)}>
              <span className="s">{i + 1}</span>
              <span className="ad">{s.ad}</span>
              <span className="ser">
                <i style={{ width: `${(s.sayi / enCokSube) * 100}%` }} />
              </span>
              <b>{s.sayi}</b>
            </button>
          ))}
          {r.subeler.length > 10 && (
            <div style={{ textAlign: "center", marginTop: 6 }}>
              <Button size="small" onClick={() => setTumSubeler(!tumSubeler)}>
                {tumSubeler ? "İlk 10 şube" : `Tüm şubeler (${r.subeler.length})`}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------ yapay zekâ değerlendirmesi */}
      {(o.ozetAliniyor || o.ozet) && (
        <div className="cmp-yz">
          <div className="cmp-pbas">
            <b>
              <BrainCircuit size={15} /> Dönem değerlendirmesi
            </b>
            <Space size={8}>
              <small>
                {o.aralik[0].format("DD.MM.YYYY")} – {o.aralik[1].format("DD.MM.YYYY")} · yapay zekâ yorumu
              </small>
              {o.ozet && !o.ozetAliniyor && (
                <Button size="small" type="text" icon={<X size={14} />} onClick={o.ozetKapat} />
              )}
            </Space>
          </div>
          {o.ozetAliniyor ? (
            <div style={{ textAlign: "center", padding: 18 }}>
              <Spin />
              <div className="cmp-soluk" style={{ marginTop: 8 }}>
                Eksik kayıtlar sınıflandırılıyor, ardından dönem yorumlanıyor…
              </div>
            </div>
          ) : (
            <>
              <div className="cmp-yzMetin">{o.ozet}</div>
              <div className="cmp-yzNot">
                Sayılar yukarıdaki panolardan gelir, bu bölüm yalnızca yorumdur. Karar öncesi kayıtların kendisine bakınız.
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- liste */}
      <div className="cmp-liste">
        <div className="cmp-lbas">
          <b>
            Kayıtlar <span className="cmp-soluk">· {gorunen.length}</span>
          </b>
          {grup && (
            <span className="cmp-etiket">
              Ayrılma nedeni: {grup}
              <button onClick={() => setGrup(null)} aria-label="Süzgeci kaldır">
                <X size={13} />
              </button>
            </span>
          )}
          <Space size={6} style={{ marginLeft: "auto" }}>
            {o.seciliIdler.length > 0 && (
              <Button size="small" onClick={() => o.setSeciliIdler([])}>
                Seçimi temizle ({o.seciliIdler.length})
              </Button>
            )}
            <Button size="small" icon={<Download size={14} />} onClick={excel}>
              Excel'e aktar
            </Button>
          </Space>
        </div>

        <Tablo
          rowKey="id"
          size="small"
          className="cmp-tablo"
          loading={o.yukleniyor}
          dataSource={gorunen}
          locale={{ emptyText: grup || ara ? "Süzgece uyan kayıt yok." : "Bu aralıkta kayıt bulunmuyor." }}
          scroll={{ x: 1150 }}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          rowSelection={{
            selectedRowKeys: o.seciliIdler,
            onChange: (k: any) => o.setSeciliIdler(k as number[]),
          }}
          onRow={(m: any) => ({ onClick: () => o.detayAc(m), style: { cursor: "pointer" } })}
          columns={[
            {
              title: "Tarih",
              dataIndex: "olusturma",
              width: 100,
              render: (v: string) => (
                <span className="cmp-tarih">
                  {dayjs(v).format("DD.MM.YYYY")}
                  <small>{dayjs(v).format("HH:mm")}</small>
                </span>
              ),
            },
            {
              title: "Personel",
              dataIndex: "adSoyad",
              width: 190,
              render: (v: string, m: any) => (
                <span className="cmp-kisi">
                  <b>{v}</b>
                  {m.gorev && <small>{m.gorev}</small>}
                </span>
              ),
            },
            { title: "Şube", dataIndex: "subeAdi", width: 140, ellipsis: true },
            {
              title: "Ayrılma nedeni",
              key: "neden",
              width: 250,
              render: (_: any, m: any) => (
                <Tooltip
                  title={[m.cikisNedeni, m.cikisNedeniAciklama].filter(Boolean).join(" — ") || undefined}
                >
                  <span className="cmp-grup">{o.grupBul(m)}</span>
                  {m.cikisNedeni && <span className="cmp-ham">"{m.cikisNedeni}"</span>}
                </Tooltip>
              ),
            },
            {
              title: "Özet",
              dataIndex: "ozet",
              render: (v: string) =>
                v ? (
                  <Tooltip title={v.length > 110 ? v : undefined}>
                    <span className="cmp-ozet">{v}</span>
                  </Tooltip>
                ) : (
                  <span className="cmp-bekliyor">özet bekleniyor</span>
                ),
            },
            {
              title: "Kaynak",
              key: "kaynak",
              width: 140,
              render: (_: any, m: any) => {
                const a = kaynakAdi(m);
                return (
                  <span className="cmp-kaynak">
                    <i className={a === "Yüz yüze" ? "yuz" : a === "Anket" ? "anket" : "cizelge"} />
                    {a}
                    {a === "Yüz yüze" && m.uzmanAdi ? <small>{m.uzmanAdi}</small> : null}
                  </span>
                );
              },
            },
            {
              title: "",
              key: "islem",
              width: 96,
              render: (_: any, m: any) => (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" icon={<MessageSquareText size={14} />} onClick={() => o.detayAc(m)}>
                    Gör
                  </Button>
                  <Tooltip title="Sil">
                    <Button size="small" danger type="text" icon={<Trash2 size={14} />} onClick={() => o.sil(m.id, m.adSoyad)} />
                  </Tooltip>
                </Space>
              ),
            },
          ]}
        />
      </div>

      {/* ---------------------------------------------------- şube çekmecesi */}
      <Drawer
        open={!!o.subeDetay}
        onClose={o.subeKapat}
        width="min(900px, 96vw)"
        title={
          o.subeDetay && (
            <Space size={8} wrap>
              <b>{o.subeDetay.subeAdi}</b>
              {o.subeDetay.mulakatlar && <Tag color="green">{o.subeDetay.mulakatlar.length} kayıt</Tag>}
            </Space>
          )
        }
        extra={
          o.subeDetay &&
          !o.subeDetay.ozet &&
          !o.subeDetay.yetersizVeri &&
          !o.subeYukleniyor && (
            <Button
              type="primary"
              size="small"
              icon={<BrainCircuit size={14} />}
              loading={o.subeOzetleniyor}
              onClick={() => o.subeAc(o.subeDetay.subeAdi, true)}
            >
              Bu şubeyi değerlendir
            </Button>
          )
        }
      >
        {o.subeYukleniyor || !o.subeDetay ? (
          <div style={{ textAlign: "center", padding: 30 }}>
            <Spin />
          </div>
        ) : (
          <div className="cmp">
            {o.subeDetay.ozet && <div className="cmp-yzMetin cmp-subeOzet">{o.subeDetay.ozet}</div>}
            {o.subeDetay.yetersizVeri && (
              <div className="cmp-bilgi">Tek görüşmeden desen çıkarmak yanıltıcı olur; değerlendirme için en az iki kayıt gerekiyor.</div>
            )}
            {(o.subeDetay.mulakatlar ?? []).length > 0 && (
              <div className="cmp-subeNedenler">
                {Object.entries(
                  (o.subeDetay.mulakatlar as any[]).reduce((t: Record<string, number>, m) => {
                    const g = o.grupBul(m);
                    t[g] = (t[g] ?? 0) + 1;
                    return t;
                  }, {})
                )
                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                  .map(([g, n]) => (
                    <span key={g} className="cmp-grup">
                      {g} · {n as number}
                    </span>
                  ))}
              </div>
            )}
            <Tablo
              rowKey="id"
              size="small"
              dataSource={o.subeDetay.mulakatlar ?? []}
              pagination={false}
              scroll={{ x: 700 }}
              locale={{ emptyText: "Bu dönemde kayıt yok." }}
              onRow={(m: any) => ({ onClick: () => o.detayAc(m), style: { cursor: "pointer" } })}
              columns={[
                {
                  title: "Personel",
                  dataIndex: "adSoyad",
                  width: 170,
                  render: (v: string, m: any) => (
                    <span className="cmp-kisi">
                      <b>{v}</b>
                      {m.gorev && <small>{m.gorev}</small>}
                    </span>
                  ),
                },
                {
                  title: "Çıkış",
                  dataIndex: "cikisTarihi",
                  width: 100,
                  render: (v: string) => (v ? dayjs(v).format("DD.MM.YYYY") : "—"),
                },
                {
                  title: "Ayrılma nedeni",
                  key: "neden",
                  width: 210,
                  render: (_: any, m: any) => (
                    <>
                      <span className="cmp-grup">{o.grupBul(m)}</span>
                      {m.cikisNedeni && <span className="cmp-ham">"{m.cikisNedeni}"</span>}
                    </>
                  ),
                },
                {
                  title: "Özet",
                  key: "ozet",
                  render: (_: any, m: any) => (
                    <span className="cmp-ozet">{m.ozet || m.uzmanYorumu || m.yoneticiYorumu || "—"}</span>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
