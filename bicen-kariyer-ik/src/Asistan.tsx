/**
 * ---------------------------------------------------------------------------
 * İK Asistanı
 * ---------------------------------------------------------------------------
 * Sağ altta duran düğmeyle açılan sohbet penceresi. Personel, başvuru, ciro
 * ve QR okutma verileriyle ilgili sorular doğal dilde sorulabilir.
 *
 * Asistan görsel de üretebilir: çubuk grafik, tablo ya da özet kutuları.
 * Görselleri model doğrudan çizmez; tanımlı bir tarif gönderir, panel onu
 * rapor ekranlarındaki stille çizer.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  Eraser,
  FileSpreadsheet,
  ImageDown,
  MessageCircle,
  Send,
  Sparkles,
  UserCircle2,
} from "lucide-react";

import { api, islemYetkisi, oturumOku } from "./api";
import { gorselOlarakIndir } from "./disaAktar";

const { Text, Paragraph } = Typography;

/** Görsel renkleri */
const RENKLER: Record<string, string> = {
  yesil: "#7CB518",
  kirmizi: "#E8481C",
  turuncu: "#d48806",
  mavi: "#2f54eb",
  gri: "#8a8f98",
};

/** Sayıları Türkçe biçimde yazar */
const sayi = (d: number): string =>
  typeof d === "number"
    ? d.toLocaleString("tr-TR", { maximumFractionDigits: 2 })
    : String(d ?? "");

/* -------------------------------------------------------------------------- */
/* Görsel çizimi                                                              */
/* -------------------------------------------------------------------------- */

function Gorsel({ tarif, indir }: { tarif: any; indir?: (t: any) => void }) {
  if (!tarif?.tur) return null;

  const satirlar = tarif.satirlar ?? [];

  /* Her görselin sağ üstünde indirme düğmeleri */
  const Araclar = () => (
    <span className="sh-gorsel-arac">
      <Tooltip title="Excel olarak indir">
        <button onClick={() => indir?.({ ...tarif, bicim: "excel" })}>
          <FileSpreadsheet size={13} strokeWidth={2} />
        </button>
      </Tooltip>
      <Tooltip title="Görsel olarak indir">
        <button onClick={() => indir?.({ ...tarif, bicim: "gorsel" })}>
          <ImageDown size={13} strokeWidth={2} />
        </button>
      </Tooltip>
    </span>
  );

  /* Çubuk grafiği: değerler en büyüğe göre ölçeklenir */
  if (tarif.tur === "cubuk" && satirlar.length > 0) {
    const enBuyuk = Math.max(...satirlar.map((s: any) => Number(s.deger) || 0), 1);

    return (
      <div className="sh-gorsel" data-gorsel="1">
        <div className="sh-gorsel-baslik">
          {tarif.baslik}
          <Araclar />
        </div>

        {satirlar.map((s: any, i: number) => (
          <div className="sh-cubuk-satir" key={i}>
            <span className="sh-cubuk-ad" title={s.etiket}>
              {s.etiket}
            </span>

            <span className="sh-cubuk-alan">
              <span
                className="sh-cubuk"
                style={{
                  width: `${((Number(s.deger) || 0) / enBuyuk) * 100}%`,
                  background: RENKLER[s.renk] ?? RENKLER.mavi,
                }}
              />
            </span>

            <span className="sh-cubuk-deger">
              {s.metin ?? sayi(Number(s.deger))}
            </span>
          </div>
        ))}

        {tarif.aciklama && <div className="sh-gorsel-not">{tarif.aciklama}</div>}
      </div>
    );
  }

  /* Özet kutuları */
  if (tarif.tur === "kutular" && satirlar.length > 0) {
    return (
      <div className="sh-gorsel" data-gorsel="1">
        <div className="sh-gorsel-baslik">
          {tarif.baslik}
          <Araclar />
        </div>

        <div className="sh-kutular">
          {satirlar.map((s: any, i: number) => (
            <div className="sh-kutu" key={i}>
              <span>{s.etiket}</span>
              <b style={{ color: RENKLER[s.renk] ?? undefined }}>
                {s.metin ?? sayi(Number(s.deger))}
              </b>
            </div>
          ))}
        </div>

        {tarif.aciklama && <div className="sh-gorsel-not">{tarif.aciklama}</div>}
      </div>
    );
  }

  /* Personel kartı: panelin personel detayıyla aynı görünüm */
  if (tarif.tur === "personel") {
    const resim = tarif.personelKodu
      ? api.resimAdresi(tarif.personelKodu)
      : "";

    return (
      <div className="sh-gorsel sh-personel" data-gorsel="1">
        <div className="sh-gorsel-baslik">
          <span>{tarif.baslik}</span>
          <Araclar />
        </div>

        <div className="sh-personel-ust">
          {resim ? (
            <img
              className="sh-personel-resim"
              src={resim}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.visibility = "hidden";
              }}
            />
          ) : (
            <div className="sh-personel-resim sh-personel-yok">
              <UserCircle2 size={34} strokeWidth={1.4} />
            </div>
          )}

          <div className="sh-kunye">
            {(tarif.kunye ?? []).map((k: any, i: number) => (
              <div key={i}>
                <span>{k.etiket}</span>
                <b>{k.deger}</b>
              </div>
            ))}
          </div>
        </div>

        {tarif.sutunlar?.length > 0 && (
          <>
            <div className="sh-alt-baslik">
              Çalışma Dönemleri ({(tarif.hucreler ?? []).length})
            </div>

            <div className="sh-tablo-sarma">
              <table className="sh-tablo">
                <thead>
                  <tr>
                    {tarif.sutunlar.map((b: string, i: number) => (
                      <th key={i}>{b}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tarif.hucreler ?? []).map((satir: string[], i: number) => (
                    <tr
                      key={i}
                      className={
                        tarif.hucreRenkleri?.[i] &&
                        tarif.hucreRenkleri[i] !== "yok"
                          ? `sh-satir-${tarif.hucreRenkleri[i]}`
                          : undefined
                      }
                    >
                      {satir.map((h, j) => (
                        <td key={j}>{h}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tarif.aciklama && <div className="sh-gorsel-not">{tarif.aciklama}</div>}
      </div>
    );
  }

  /* Rapor: panel raporlarının biçimi — üstte özet kutuları, altında tablo */
  if (tarif.tur === "rapor") {
    return (
      <div className="sh-gorsel sh-rapor" data-gorsel="1">
        <div className="sh-gorsel-baslik">
          <span>
            {tarif.baslik}
            {tarif.donem && <i className="sh-donem">{tarif.donem}</i>}
          </span>
          <Araclar />
        </div>

        {tarif.ozetler?.length > 0 && (
          <div className="sh-kutular">
            {tarif.ozetler.map((o: any, i: number) => (
              <div className="sh-kutu" key={i}>
                <span>{o.etiket}</span>
                <b style={{ color: RENKLER[o.renk] ?? undefined }}>{o.deger}</b>
                {o.alt && <i>{o.alt}</i>}
              </div>
            ))}
          </div>
        )}

        {tarif.sutunlar?.length > 0 && (
          <div className="sh-tablo-sarma">
            <table className="sh-tablo">
              <thead>
                <tr>
                  {tarif.sutunlar.map((b: string, i: number) => (
                    <th key={i}>{b}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(tarif.hucreler ?? []).map((satir: string[], i: number) => (
                  <tr
                    key={i}
                    className={
                      tarif.hucreRenkleri?.[i] &&
                      tarif.hucreRenkleri[i] !== "yok"
                        ? `sh-satir-${tarif.hucreRenkleri[i]}`
                        : undefined
                    }
                  >
                    {satir.map((h, j) => (
                      <td key={j}>{h}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tarif.aciklama && <div className="sh-gorsel-not">{tarif.aciklama}</div>}
      </div>
    );
  }

  /* Tablo */
  if (tarif.tur === "tablo" && tarif.sutunlar?.length > 0) {
    return (
      <div className="sh-gorsel" data-gorsel="1">
        <div className="sh-gorsel-baslik">
          {tarif.baslik}
          <Araclar />
        </div>

        <div className="sh-tablo-sarma">
          <table className="sh-tablo">
            <thead>
              <tr>
                {tarif.sutunlar.map((b: string, i: number) => (
                  <th key={i}>{b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(tarif.hucreler ?? []).map((satir: string[], i: number) => (
                <tr
                  key={i}
                  className={
                    tarif.hucreRenkleri?.[i] && tarif.hucreRenkleri[i] !== "yok"
                      ? `sh-satir-${tarif.hucreRenkleri[i]}`
                      : undefined
                  }
                >
                  {satir.map((h, j) => (
                    <td key={j}>{h}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tarif.aciklama && <div className="sh-gorsel-not">{tarif.aciklama}</div>}
      </div>
    );
  }

  return null;
}

/**
 * Metni parçalara ayırır: markdown tabloları ayrı çizilir.
 *
 * Modele tablo için gorsel_olustur kullanması söylendi ama yine de metin
 * içinde tablo yazabiliyor. Düz metin olarak bırakılırsa okunmuyor.
 */
function MetinGovdesi({ metin }: { metin: string }) {
  if (!metin) return null;

  const satirlar = metin.split("\n");
  const parcalar: any[] = [];

  let tabloSatirlari: string[] = [];

  const tabloyuBitir = () => {
    if (tabloSatirlari.length < 2) {
      tabloSatirlari.forEach((x) => parcalar.push({ tur: "metin", icerik: x }));
      tabloSatirlari = [];
      return;
    }

    const hucreler = (satir: string) =>
      satir
        .split("|")
        .map((x) => x.trim())
        .filter((x, i, d) => !(i === 0 && x === "") && !(i === d.length - 1 && x === ""));

    /* İkinci satır ayraçtır (---|---), atlanır */
    const basliklar = hucreler(tabloSatirlari[0]);
    const govde = tabloSatirlari
      .slice(1)
      .filter((x) => !/^[\s|:-]+$/.test(x))
      .map(hucreler);

    parcalar.push({ tur: "tablo", basliklar, govde });
    tabloSatirlari = [];
  };

  satirlar.forEach((satir) => {
    if (satir.trim().startsWith("|")) {
      tabloSatirlari.push(satir);
    } else {
      tabloyuBitir();
      parcalar.push({ tur: "metin", icerik: satir });
    }
  });

  tabloyuBitir();

  return (
    <>
      {parcalar.map((p, i) =>
        p.tur === "tablo" ? (
          <div className="sh-tablo-sarma" key={i} data-gorsel="1">
            <table className="sh-tablo">
              <thead>
                <tr>
                  {p.basliklar.map((b: string, j: number) => (
                    <th key={j}>{b.replace(/\*\*/g, "")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.govde.map((satir: string[], j: number) => (
                  <tr key={j}>
                    {satir.map((h, k) => (
                      <td key={k}>{h.replace(/\*\*/g, "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p key={i}>{p.icerik.replace(/\*\*/g, "")}</p>
        )
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** Başlangıçta gösterilen örnek sorular */
const ORNEKLER = [
  "Dün Silivri-2 şubesinde kimler QR okutmadı?",
  "Bu ay hangi mağazada personel başı ciro geriledi?",
  "Norm kadrosunda fazlalık olan şubeler hangileri?",
  "Son 30 günde kaç başvuru geldi, hangi şubelere?",
];

export default function Asistan() {
  const { message } = AntdApp.useApp();

  const [acik, setAcik] = useState(false);
  const [durum, setDurum] = useState<any>(null);
  const [soru, setSoru] = useState("");
  const [bekleniyor, setBekleniyor] = useState(false);
  const [mesajlar, setMesajlar] = useState<any[]>([]);

  const sonRef = useRef<HTMLDivElement>(null);

  /* Asistanın durumu; kapalıysa sebebi de gelir */
  useEffect(() => {
    if (!islemYetkisi(oturumOku())) return;

    api
      .al<any>("/api/Sohbet/Durum")
      .then(setDurum)
      .catch(() =>
        setDurum({
          acik: false,
          yetkiVar: true,
          sebep: "Asistan servisine ulaşılamadı.",
        })
      );
  }, []);

  /* Yeni mesajda aşağı kaydır */
  useEffect(() => {
    sonRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mesajlar, bekleniyor]);

  /**
   * Görseli Excel ya da resim olarak indirir.
   *
   * Excel için CSV üretilir; renkleri korumak gerekmediği için yeterli.
   * Görsel için ekrandaki öğe yakalanır, böylece renkler ve düzen aynen
   * çıktıya geçer.
   */
  const gorseliIndir = useCallback(
    async (tarif: any) => {
      const ad = (tarif.baslik ?? "asistan")
        .replace(/[^\wğüşöçıİĞÜŞÖÇ ]/gi, "")
        .trim()
        .replace(/\s+/g, "_")
        .toLowerCase();

      if (tarif.bicim === "excel") {
        let basliklar: string[] = [];
        let satirlar: string[][] = [];

        if (tarif.tur === "tablo") {
          basliklar = tarif.sutunlar ?? [];
          satirlar = tarif.hucreler ?? [];
        } else {
          basliklar = ["Ad", "Değer"];
          satirlar = (tarif.satirlar ?? []).map((x: any) => [
            x.etiket,
            String(x.metin ?? x.deger ?? ""),
          ]);
        }

        const icerik = [basliklar, ...satirlar]
          .map((satir) =>
            satir
              .map((h) => `"${String(h ?? "").replace(/"/g, '""')}"`)
              .join(";")
          )
          .join("\r\n");

        const bag = new Blob(["\uFEFF" + icerik], {
          type: "text/csv;charset=utf-8;",
        });

        const adres = URL.createObjectURL(bag);
        const koprü = document.createElement("a");

        koprü.href = adres;
        koprü.download = `${ad}.csv`;
        koprü.click();

        URL.revokeObjectURL(adres);
        return;
      }

      /* Görsel: ekrandaki öğe yakalanır */
      const ogeler = document.querySelectorAll<HTMLElement>("[data-gorsel]");
      let hedef: HTMLElement | null = null;

      ogeler.forEach((o) => {
        if (o.textContent?.includes(tarif.baslik ?? "")) hedef = o;
      });

      if (!hedef) {
        message.warning("Görsel bulunamadı.");
        return;
      }

      try {
        await gorselOlarakIndir(hedef, ad);
      } catch (hata: any) {
        message.error("Görsel oluşturulamadı: " + hata.message);
      }
    },
    [message]
  );

  const gonder = useCallback(
    async (metin?: string) => {
      const soruMetni = (metin ?? soru).trim();

      if (!soruMetni || bekleniyor) return;

      setSoru("");
      setBekleniyor(true);

      const yeniMesajlar = [
        ...mesajlar,
        { rol: "kullanici", icerik: soruMetni },
      ];

      setMesajlar(yeniMesajlar);

      try {
        const sonuc = await api.gonder<any>("/api/Sohbet", {
          soru: soruMetni,
          /* Geçmiş bağlam için gönderilir; görseller taşınmaz */
          gecmis: mesajlar.map((m) => ({
            rol: m.rol,
            icerik: m.icerik,
          })),
        });

        setMesajlar([
          ...yeniMesajlar,
          {
            rol: "asistan",
            icerik: sonuc.yanit,
            gorsel: sonuc.gorsel,
            araclar: sonuc.araclar,
          },
        ]);
      } catch (hata: any) {
        setMesajlar([
          ...yeniMesajlar,
          { rol: "asistan", icerik: hata.message, hataMi: true },
        ]);
      } finally {
        setBekleniyor(false);
      }
    },
    [soru, mesajlar, bekleniyor]
  );

  /* Düğme yetkisi olan herkese görünür; asistan kapalıysa sebebi
     pencerede açıklanır. Düğmeyi gizlemek "neden yok?" sorusunu
     yanıtsız bırakıyordu. */
  if (!durum?.yetkiVar) return null;

  const kullanilabilir = !!durum?.acik;

  return (
    <>
      <Tooltip title="İK Asistanı" placement="left">
        <button className="sh-dugme" onClick={() => setAcik(true)}>
          <MessageCircle size={22} strokeWidth={2} />
        </button>
      </Tooltip>

      <Drawer
        open={acik}
        onClose={() => setAcik(false)}
        width="min(1100px, 97vw)"
        className="sh-cekmece"
        title={
          <Space size={8}>
            <Sparkles size={17} strokeWidth={2} color="#7CB518" />
            <Text strong>İK Asistanı</Text>
          </Space>
        }
        extra={
          mesajlar.length > 0 && (
            <Tooltip title="Sohbeti temizle">
              <Button
                size="small"
                type="text"
                icon={<Eraser size={15} strokeWidth={2} />}
                onClick={() => setMesajlar([])}
              />
            </Tooltip>
          )
        }
        footer={
          <div className="sh-giris">
            <Input.TextArea
              value={soru}
              onChange={(e) => setSoru(e.target.value)}
              placeholder="Sorunuzu yazınız..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={bekleniyor || !kullanilabilir}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  gonder();
                }
              }}
            />

            <Button
              type="primary"
              loading={bekleniyor}
              disabled={!kullanilabilir}
              icon={<Send size={16} strokeWidth={2} />}
              onClick={() => gonder()}
            />
          </div>
        }
      >
        {!kullanilabilir ? (
          <div className="sh-baslangic">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div style={{ fontSize: 13 }}>
                  <b>Asistan şu anda kullanılamıyor</b>
                  <div style={{ marginTop: 6, color: "#8a8f98" }}>
                    {durum?.sebep ?? "Bilinmeyen sebep."}
                  </div>
                </div>
              }
            />

            <div className="sh-kurulum">
              <b>Kurulum</b>
              <p>
                Sunucudaki <code>appsettings.json</code> dosyasında
                <code>Sohbet</code> bölümüne OpenAI anahtarınızı giriniz:
              </p>
              <pre>{`"Sohbet": {
  "Acik": true,
  "Anahtar": "sk-...",
  "Model": "gpt-4o-mini"
}`}</pre>
              <p>
                Anahtar boş bırakılırsa <code>YapayZeka:Anahtar</code>
                kullanılır. Değişiklikten sonra uygulamayı yeniden başlatınız.
              </p>
            </div>
          </div>
        ) : mesajlar.length === 0 ? (
          <div className="sh-baslangic">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Personel, başvuru, ciro ve QR okutma verileriyle ilgili sorularınızı sorabilirsiniz."
            />

            <div className="sh-ornekler">
              {ORNEKLER.map((o) => (
                <button key={o} onClick={() => gonder(o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="sh-akis">
            {mesajlar.map((m, i) => (
              <div
                className={`sh-mesaj sh-${m.rol}${m.hataMi ? " sh-hata" : ""}`}
                key={i}
              >
                <div className="sh-balon">
                  <MetinGovdesi metin={m.icerik} />

                  {m.gorsel && (
                    <Gorsel tarif={m.gorsel} indir={gorseliIndir} />
                  )}
                </div>

                {m.araclar?.length > 0 && (
                  <div className="sh-araclar">
                    {[...new Set(m.araclar)].map((a: any) => (
                      <Tag key={a} bordered={false}>
                        {String(a).replace(/_/g, " ")}
                      </Tag>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {bekleniyor && (
              <div className="sh-mesaj sh-asistan">
                <div className="sh-balon sh-bekliyor">
                  <Spin size="small" />
                  <span>Verilere bakıyorum...</span>
                </div>
              </div>
            )}

            <div ref={sonRef} />
          </div>
        )}

        <Paragraph type="secondary" className="sh-uyari">
          Asistan yalnızca sistemdeki verilere bakar. Önemli kararlardan önce
          bilgiyi ilgili ekrandan doğrulayınız.
        </Paragraph>
      </Drawer>
    </>
  );
}
