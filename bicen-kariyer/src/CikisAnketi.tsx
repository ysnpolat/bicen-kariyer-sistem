/**
 * Çıkış Anketi — aday ekranı
 * ---------------------------------------------------------------------------
 * İşten ayrılan personelin SMS ile aldığı bağlantıdan açtığı anket.
 *
 * Adres: #/anket/KOD
 *
 * Anket bölüm bölüm ilerler. Telefonda tek sayfada uzun form doldurmak
 * yorucudur ve yarıda bırakılma oranını artırır; her bölüm tek ekrana
 * sığdığında tamamlanma oranı yükseliyor.
 */

import { useEffect, useState } from "react";
import { AYARLAR } from "./sabitler";

interface Soru {
  soru: string;
  cevap: string;
}

interface Puan {
  baslik: string;
  puan: number;
}

/** Anket açıldığında sunucudan gelen tanım */
interface Anket {
  gecerli: boolean;
  sebep?: string;
  adSoyad?: string;
  kimlikGerekli?: boolean;
  kimlikSorulsun?: boolean;
  subeSorulsun?: boolean;
  subeler?: string[];
  sorular?: string[];
  puanlamalar?: string[];
  nedenler?: string[];
}

export default function CikisAnketi({ kod }: { kod: string }) {
  const [anket, setAnket] = useState<Anket | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [bolum, setBolum] = useState(0);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [bitti, setBitti] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const [logoHata, setLogoHata] = useState(false);
  const [sorular, setSorular] = useState<Soru[]>([]);
  const [puanlar, setPuanlar] = useState<Puan[]>([]);
  const [neden, setNeden] = useState("");
  const [tekrar, setTekrar] = useState<boolean | null>(null);
  const [tavsiye, setTavsiye] = useState<number | null>(null);
  const [ekNot, setEkNot] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const yanit = await fetch(`${AYARLAR.apiTaban}/api/CikisAnket/Ac/${kod}`);
        const d: Anket = await yanit.json();

        setAnket(d);

        if (d.gecerli) {
          setSorular((d.sorular ?? []).map((s) => ({ soru: s, cevap: "" })));
          setPuanlar((d.puanlamalar ?? []).map((b) => ({ baslik: b, puan: 0 })));
        }
      } catch {
        setAnket({ gecerli: false, sebep: "Bağlantı kurulamadı." });
      } finally {
        setYukleniyor(false);
      }
    })();
  }, [kod]);

  const gonder = async () => {
    setHata(null);

    if (neden.trim().length < 3) {
      setHata("Lütfen ayrılma sebebinizi yazınız.");
      return;
    }

    setGonderiliyor(true);

    try {
      const yanit = await fetch(`${AYARLAR.apiTaban}/api/CikisAnket/Gonderi/${kod}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sorular,
          puanlar: puanlar.filter((p) => p.puan > 0),
          cikisNedeni: neden || null,
          tekrarCalisir: tekrar,
          tavsiyePuani: tavsiye,
          ...(ekNot.trim()
            ? { sorular: [...sorular, { soru: "Eklemek istedikleri", cevap: ekNot }] }
            : {}),
        }),
      });

      const d = await yanit.json();

      if (!yanit.ok) {
        setHata(d?.ayrinti ?? d?.hata ?? "Anket gönderilemedi.");
        return;
      }

      setBitti(true);
    } catch {
      setHata("Bağlantı kurulamadı. Lütfen tekrar deneyiniz.");
    } finally {
      setGonderiliyor(false);
    }
  };

  /* Logo yüklenemezse yazı ile devam edilir; karşılama ekranı da
     aynı yedeği kullanıyor. */
  const Marka = () => (
    <div className="ank-marka">
      {logoHata ? (
        <b>
          bi<span style={{ color: "#e8481c" }}>ç</span>en
        </b>
      ) : (
        <img
          src={AYARLAR.logoYolu}
          alt="Biçen Market"
          className="ank-logo"
          onError={() => setLogoHata(true)}
        />
      )}
      <span>Çıkış Anketi</span>
    </div>
  );

  if (yukleniyor)
    return (
      <div className="ank-sarmal">
        <div className="ank-kart ank-orta">Yükleniyor…</div>
      </div>
    );

  if (!anket?.gecerli)
    return (
      <div className="ank-sarmal">
        <div className="ank-kart ank-orta">
          <Marka />
          <p className="ank-uyari">{anket?.sebep ?? "Bağlantı geçersiz."}</p>
        </div>
      </div>
    );

  if (bitti)
    return (
      <div className="ank-sarmal">
        <div className="ank-kart ank-orta">
          <div className="ank-halka">✓</div>
          <h2>Teşekkür ederiz</h2>
          <p>
            Yanıtlarınız kaydedildi. Paylaştıklarınız çalışma koşullarını
            iyileştirmek için değerlendirilecek.
          </p>
          <p className="ank-kapanis">Yolunuz tekrar Biçen'e düşerse kapımız açık.</p>

          <p className="ank-gizlilik" style={{ textAlign: "left" }}>
            Yanıtlarınız yalnızca Yönetim tarafından görüntülenir,
            üçüncü kişilerle paylaşılmaz.
          </p>
        </div>
      </div>
    );

  /* Bölümler: 0 kimlik, 1 açık uçlu sorular, 2 puanlama, 3 ayrılma sebebi */
  const bolumler = [
    "giris",
    sorular.length > 0 ? "sorular" : null,
    puanlar.length > 0 ? "puanlar" : null,
    "kapanis",
  ].filter(Boolean) as string[];

  const suAn = bolumler[bolum];
  const sonBolum = bolum === bolumler.length - 1;

  return (
    <div className="ank-sarmal">
      <div className="ank-kart">
        <Marka />

        <div className="ank-adim">
          {bolumler.map((_b, i) => (
            <i key={i} className={i <= bolum ? "aktif" : undefined} />
          ))}
        </div>

        <p className="ank-selam">
          {anket.adSoyad && <b>{anket.adSoyad}</b>} · {bolum + 1}. bölüm /{" "}
          {bolumler.length}
        </p>

        {hata && <p className="ank-uyari">{hata}</p>}

        {/* --------------------------------------------------- karşılama */}
        {suAn === "giris" && (
          <>
            <p className="ank-giris">
              Biçen'de geçirdiğiniz süreyi değerlendirmenizi rica ediyoruz.
              Anket birkaç dakika sürer.
            </p>

            <p className="ank-gizlilik">
              Yanıtlarınız <b>yalnızca Yönetim tarafından</b> görüntülenir,
              üçüncü kişilerle paylaşılmaz. Bireysel olarak yöneticinize
              iletilmez.
            </p>
          </>
        )}

        {/* ----------------------------------------------------- sorular */}
        {suAn === "sorular" &&
          sorular.map((s, i) => (
            <div className="ank-soru" key={i}>
              <p>
                {i + 1}. {s.soru}
              </p>
              <textarea
                value={s.cevap}
                onChange={(e) => {
                  const yeni = [...sorular];
                  yeni[i] = { ...yeni[i], cevap: e.target.value };
                  setSorular(yeni);
                }}
                placeholder="Cevabınız"
                maxLength={2000}
              />
            </div>
          ))}

        {/* ----------------------------------------------------- puanlar */}
        {suAn === "puanlar" && (
          <>
            <p className="ank-kucuk" style={{ marginTop: 0 }}>
              1 = çok kötü, 5 = çok iyi
            </p>

            {puanlar.map((p, i) => (
              <div className="ank-soru" key={i}>
                <p>{p.baslik}</p>
                <div className="ank-olcek">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={n <= 2 ? "dusuk" : undefined}
                      aria-pressed={p.puan === n}
                      onClick={() => {
                        const yeni = [...puanlar];
                        yeni[i] = { ...yeni[i], puan: p.puan === n ? 0 : n };
                        setPuanlar(yeni);
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {/* ----------------------------------------------------- kapanış */}
        {suAn === "kapanis" && (
          <>
            {/* Çıkış sebebi serbest metin: hazır listeden seçtirmek kişiyi
                en yakın seçeneğe zorluyor ve asıl sebep kayboluyor. Kendi
                cümlesiyle yazdığında gerçek sebep görünür. */}
            <div className="ank-soru">
              <p>
                Ayrılmanızın en önemli sebebi neydi?{" "}
                <span style={{ color: "#e8481c" }}>*</span>
              </p>
              <textarea
                value={neden}
                onChange={(e) => setNeden(e.target.value)}
                placeholder="Kendi cümlelerinizle yazabilirsiniz"
                maxLength={500}
              />
              <p className="ank-kucuk">Bu alanın doldurulması gerekiyor.</p>
            </div>

            <div className="ank-soru">
              <p>Aynı şartlarda tekrar çalışmak ister miydiniz?</p>
              <div className="ank-olcek">
                <button
                  type="button"
                  aria-pressed={tekrar === true}
                  onClick={() => setTekrar(tekrar === true ? null : true)}
                >
                  Evet
                </button>
                <button
                  type="button"
                  className="dusuk"
                  aria-pressed={tekrar === false}
                  onClick={() => setTekrar(tekrar === false ? null : false)}
                >
                  Hayır
                </button>
              </div>
            </div>

            <div className="ank-soru">
              <p>Bir tanıdığınıza burada çalışmayı önerir miydiniz?</p>
              <div className="ank-olcek ank-nps">
                {Array.from({ length: 11 }, (_v, n) => (
                  <button
                    key={n}
                    type="button"
                    className={n <= 6 ? "dusuk" : undefined}
                    aria-pressed={tavsiye === n}
                    onClick={() => setTavsiye(tavsiye === n ? null : n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="ank-uc">
                <span>Hiç önermem</span>
                <span>Kesinlikle</span>
              </div>
            </div>

            <div className="ank-soru">
              <p>Eklemek istediğiniz bir şey var mı?</p>
              <textarea
                value={ekNot}
                onChange={(e) => setEkNot(e.target.value)}
                placeholder="İsteğe bağlı"
                maxLength={2000}
              />
            </div>
          </>
        )}

        {sonBolum ? (
          <button
            className="ank-dugme"
            disabled={gonderiliyor}
            onClick={gonder}
          >
            {gonderiliyor ? "Gönderiliyor…" : "Anketi gönder"}
          </button>
        ) : (
          <button className="ank-dugme" onClick={() => setBolum(bolum + 1)}>
            Devam et
          </button>
        )}

        {bolum > 0 && (
          <button
            className="ank-dugme sessiz"
            onClick={() => setBolum(bolum - 1)}
          >
            Geri
          </button>
        )}

        {sonBolum && (
          <p className="ank-kucuk ank-orta">
            Gönderdikten sonra yanıtlarınızı değiştiremezsiniz.
          </p>
        )}
      </div>
    </div>
  );
}
