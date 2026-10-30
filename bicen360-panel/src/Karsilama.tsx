/**
 * ---------------------------------------------------------------------------
 * Karşılama Sayfası
 * ---------------------------------------------------------------------------
 * Oturum açmadan görünen tanıtım sayfası: kapak, duyurular, sistem
 * özellikleri ve iletişim.
 *
 * İçeriğin tamamı Yönetim → Portal Görünümü ekranından yönetiliyor. Metin
 * ve görselleri koda gömmek, her duyuru değişikliğinde yeni sürüm
 * yayınlamak demekti.
 *
 * Sayfa tek istekte doluyor; bölüm başına ayrı istek atmak yavaş
 * bağlantıda içeriğin sırayla belirmesine yol açıyordu.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import { Button, Spin, Typography } from "antd";
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  Clock,
  Headphones,
  Mail,
  MapPin,
  Phone,
  Wrench,
} from "lucide-react";

import { API_TABAN, api } from "./api";

const { Text } = Typography;

/* -------------------------------------------------------------------------- */

interface Icerik {
  baslik: string;
  altBaslik: string;
  kapakYazisi: string;
  logo: { adres: string } | null;
  kapak: { adres: string } | null;
  slaytlar: { id: number; baslik: string; aciklama: string; adres: string }[];
  duyurular: { baslik: string; metin: string; tarih?: string }[];
  ozellikler: { baslik: string; metin: string; simge?: string }[];
  iletisim: {
    adres: string;
    telefon: string;
    eposta: string;
    web: string;
    calismaSaati: string;
  };
  girisYazisi: string;
  dipnot: string;
}

/** Ayarlarda seçilen simge adını bileşene çevirir */
const SIMGELER: Record<string, any> = {
  ariza: Wrench,
  envanter: Boxes,
  destek: Headphones,
  kontrol: ClipboardCheck,
};

const tamAdres = (yol?: string | null) =>
  !yol ? "" : yol.startsWith("http") ? yol : `${API_TABAN}${yol}`;

/* ========================================================================== */

export default function Karsilama({ girise }: { girise: () => void }) {
  const [veri, setVeri] = useState<Icerik | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [slayt, setSlayt] = useState(0);

  useEffect(() => {
    api
      .getir<Icerik>("Portal/Icerik")
      .then(setVeri)
      /* İçerik alınamazsa sayfa yine açılıyor: giriş düğmesine ulaşmak
         tanıtım metninden önemli. */
      .catch(() => setVeri(null))
      .finally(() => setYukleniyor(false));
  }, []);

  /* Slayt otomatik dönüyor; tek slayt varsa dönmesinin anlamı yok */
  useEffect(() => {
    const adet = veri?.slaytlar?.length ?? 0;

    if (adet < 2) return;

    const zaman = setInterval(() => setSlayt((o) => (o + 1) % adet), 6000);

    return () => clearInterval(zaman);
  }, [veri?.slaytlar?.length]);

  if (yukleniyor)
    return (
      <div className="ks-yukleniyor">
        <Spin size="large" />
      </div>
    );

  const i = veri;

  return (
    <div className="ks-sayfa">
      {/* ------------------------------------------------------- üst çubuk */}
      <header className="ks-bar">
        <div className="ks-kap ks-bar-ic">
          <div className="ks-marka">
            {i?.logo ? (
              <img src={tamAdres(i.logo.adres)} alt={i?.baslik ?? "Biçen360"} />
            ) : (
              <span className="ks-marka-yazi">
                Biçen<b>360</b>
              </span>
            )}
          </div>

          <nav className="ks-menu">
            <a href="#duyurular">Duyurular</a>
            <a href="#ozellikler">Sistem</a>
            <a href="#iletisim">İletişim</a>

            <Button type="primary" onClick={girise} icon={<ArrowRight size={15} />}>
              Giriş yap
            </Button>
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------ kapak */}
      <section className="ks-kapak">
        {i?.kapak && (
          <div
            className="ks-kapak-zemin"
            style={{ backgroundImage: `url(${tamAdres(i.kapak.adres)})` }}
          />
        )}

        <div className="ks-kap ks-kapak-ic">
          <h1>{i?.baslik ?? "Biçen360"}</h1>
          <p className="ks-kapak-alt">{i?.altBaslik ?? ""}</p>

          {i?.kapakYazisi && <p className="ks-kapak-yazi">{i.kapakYazisi}</p>}

          <Button size="large" className="ks-kapak-dugme" onClick={girise}>
            Sisteme giriş yap
          </Button>
        </div>
      </section>

      {/* ----------------------------------------------------------- slayt */}
      {(i?.slaytlar?.length ?? 0) > 0 && (
        <section className="ks-slayt">
          <div className="ks-kap">
            <div className="ks-slayt-kutu">
              {i!.slaytlar.map((s, sira) => (
                <div
                  key={s.id}
                  className={`ks-slayt-kare${sira === slayt ? " ks-etkin" : ""}`}
                  style={{ backgroundImage: `url(${tamAdres(s.adres)})` }}
                >
                  {(s.baslik || s.aciklama) && (
                    <div className="ks-slayt-yazi">
                      {s.baslik && <h3>{s.baslik}</h3>}
                      {s.aciklama && <p>{s.aciklama}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {i!.slaytlar.length > 1 && (
              <div className="ks-slayt-nokta">
                {i!.slaytlar.map((s, sira) => (
                  <button
                    key={s.id}
                    className={sira === slayt ? "ks-nokta-etkin" : ""}
                    onClick={() => setSlayt(sira)}
                    aria-label={`${sira + 1}. görsel`}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- duyurular */}
      {(i?.duyurular?.length ?? 0) > 0 && (
        <section className="ks-bolum" id="duyurular">
          <div className="ks-kap">
            <h2 className="ks-bolum-baslik">Duyurular</h2>

            <div className="ks-izgara">
              {i!.duyurular.map((d, sira) => (
                <article className="ks-duyuru" key={sira}>
                  {d.tarih && <span className="ks-tarih">{d.tarih}</span>}
                  <h3>{d.baslik}</h3>
                  <p>{d.metin}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- özellikler */}
      {(i?.ozellikler?.length ?? 0) > 0 && (
        <section className="ks-bolum ks-koyu" id="ozellikler">
          <div className="ks-kap">
            <h2 className="ks-bolum-baslik">Sistem Özellikleri</h2>

            <div className="ks-izgara">
              {i!.ozellikler.map((o, sira) => {
                const Simge = SIMGELER[o.simge ?? ""] ?? ClipboardCheck;

                return (
                  <article className="ks-ozellik" key={sira}>
                    <div className="ks-ozellik-simge">
                      <Simge size={22} strokeWidth={2} />
                    </div>

                    <h3>{o.baslik}</h3>
                    <p>{o.metin}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- iletişim */}
      <section className="ks-bolum" id="iletisim">
        <div className="ks-kap">
          <h2 className="ks-bolum-baslik">İletişim</h2>

          <div className="ks-iletisim">
            {i?.iletisim?.adres && (
              <div className="ks-iletisim-kart">
                <MapPin size={20} strokeWidth={2} />
                <div>
                  <span>Adres</span>
                  <p>{i.iletisim.adres}</p>
                </div>
              </div>
            )}

            {i?.iletisim?.telefon && (
              <div className="ks-iletisim-kart">
                <Phone size={20} strokeWidth={2} />
                <div>
                  <span>Telefon</span>
                  <p>
                    <a href={`tel:${i.iletisim.telefon}`}>{i.iletisim.telefon}</a>
                  </p>
                </div>
              </div>
            )}

            {i?.iletisim?.eposta && (
              <div className="ks-iletisim-kart">
                <Mail size={20} strokeWidth={2} />
                <div>
                  <span>E-posta</span>
                  <p>
                    <a href={`mailto:${i.iletisim.eposta}`}>{i.iletisim.eposta}</a>
                  </p>
                </div>
              </div>
            )}

            {i?.iletisim?.calismaSaati && (
              <div className="ks-iletisim-kart">
                <Clock size={20} strokeWidth={2} />
                <div>
                  <span>Çalışma saatleri</span>
                  <p>{i.iletisim.calismaSaati}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="ks-dip">
        <div className="ks-kap ks-dip-ic">
          <Text type="secondary">
            {i?.dipnot || `© ${new Date().getFullYear()} Biçen Market`}
          </Text>

          <Button type="link" onClick={girise}>
            Giriş yap
          </Button>
        </div>
      </footer>
    </div>
  );
}
