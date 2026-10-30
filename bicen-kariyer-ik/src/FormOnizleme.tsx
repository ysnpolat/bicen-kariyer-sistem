/**
 * ---------------------------------------------------------------------------
 * Doldurulmuş Başvuru Önizlemesi
 * ---------------------------------------------------------------------------
 * Gönderilen başvuruyu, basılı BİK-001 formunun yerleşimiyle gösterir.
 * Aday bu ekrandan formunu görüntüleyebilir, yazdırabilir veya PDF kaydedebilir.
 * ---------------------------------------------------------------------------
 */

import { LOGO_ADRESI } from "./api";
import { KUNYE, TAAHHUT_METNI } from "./sabitler";

/** Görseli <img src> içinde kullanılabilir hâle getirir */
const gorselAdresi = (g?: { tur: string; base64: string } | null): string =>
  g ? `data:${g.tur};base64,${g.base64}` : "";

const bos = "—";
const d = (deger?: string | number | null): string => {
  if (deger === 0) return "0";
  const metin = String(deger ?? "").trim();
  return metin === "" ? bos : metin;
};

/** İşaretli / işaretsiz kutucuk */
function Kutu({ isaretli, metin }: { isaretli: boolean; metin: string }) {
  return (
    <span className={`on-kutu ${isaretli ? "on-kutu-dolu" : ""}`}>
      <span className="on-kutu-isaret">{isaretli ? "✓" : ""}</span>
      {metin}
    </span>
  );
}

function BolumBandi({ metin, aciklama }: { metin: string; aciklama?: string }) {
  return (
    <div className="on-bant">
      {metin}
      {aciklama && <span className="on-bant-aciklama">{aciklama}</span>}
    </div>
  );
}

export default function FormOnizleme({ basvuru }: { basvuru: any }) {
  const b = basvuru ?? {};

  /**
   * Önizlemede gösterilecek pozisyon listesi.
   *
   * Başvuru anında sunulan liste kaydedildiyse o kullanılır; böylece form
   * daha sonra değiştirilse bile aday ne gördüyse o basılır. Eski kayıtlarda
   * bu bilgi yoksa yalnızca adayın seçtiği pozisyonlar gösterilir.
   */
  const secilenBolumler = Array.isArray(b.bolumler)
    ? (b.bolumler as string[])
    : String(b.bolumler ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

  const bolumListesi =
    Array.isArray(b.bolumSecenekleri) && b.bolumSecenekleri.length > 0
      ? (b.bolumSecenekleri as string[])
      : secilenBolumler;

  const tcMi = b.uyruk !== "Yabancı Uyruklu";

  return (
    <div className="on-belge">
      {/* ------------------------------------------------------------ başlık */}
      <div className="on-ust">
        <img
          src={LOGO_ADRESI}
          alt="Biçen Market"
          className="on-logo"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="on-ust-orta">
          <div className="on-ust-baslik">İŞ BAŞVURU FORMU</div>
          <div className="on-ust-alt">
            Başvuru No: <strong>{d(b.basvuruNo)}</strong> · Tarih: {d(b.gonderimZamani)}
          </div>
        </div>
        <div className="on-ust-sag">Doküman No: {KUNYE.dokumanNo}</div>
        {b.fotograf?.base64 && (
          <a
            href={gorselAdresi(b.fotograf)}
            target="_blank"
            rel="noreferrer"
            title="Büyütmek için tıklayınız"
          >
            <img
              src={gorselAdresi(b.fotograf)}
              alt="Aday fotoğrafı"
              className="on-vesikalik"
            />
          </a>
        )}
      </div>

      {/* -------------------------------------------------- kişisel bilgiler */}
      <BolumBandi metin="KİŞİSEL BİLGİLER" />

      <table className="on-tablo">
        <tbody>
          <tr>
            <th>Adınız / Soyadınız</th>
            <td>{d(`${b.ad} ${b.soyad}`)}</td>
            <th>Medeni Durum</th>
            <td>
              {d(b.medeniDurum)}
              {b.medeniDurum === "Evli" ? ` · Çocuk sayısı: ${d(b.cocukSayisi)}` : ""}
            </td>
          </tr>
          <tr>
            <th>Doğum Tarihi</th>
            <td>{d(b.dogumTarihi)}</td>
            <th>Doğum Yeri</th>
            <td>{d(b.dogumYeri)}</td>
          </tr>
          <tr>
            <th>Uyruk</th>
            <td>
              {d(b.uyruk)}
              {!tcMi && b.uyrukUlke ? ` · ${b.uyrukUlke}` : ""}
            </td>
            <th>{tcMi ? "T.C. Kimlik No" : "Kimlik / Pasaport No"}</th>
            <td>{d(b.tcKimlikNo)}</td>
          </tr>
          <tr>
            <th>Kan Grubu</th>
            <td>{d(b.kanGrubu)}</td>
            <th>Cep Telefonu - 1</th>
            <td>{d(b.cepTel1)}</td>
          </tr>
          <tr>
            <th>Cep Telefonu - 2</th>
            <td>{d(b.cepTel2)}</td>
            <th>E-mail Adresiniz</th>
            <td>{d(b.email)}</td>
          </tr>
          <tr>
            <th>İkamet Adresi</th>
            <td colSpan={3}>
              {[
                b.mahalle,
                b.caddeSokak,
                b.binaNo ? `No: ${b.binaNo}` : "",
                b.daireNo ? `Daire: ${b.daireNo}` : "",
                b.ilce,
                b.il,
              ]
                .filter(Boolean)
                .join(" · ") || bos}
              {b.evAdresi ? ` (${b.evAdresi})` : ""}
            </td>
          </tr>
          <tr>
            <th>Engel Durumu</th>
            <td colSpan={3}>
              {b.engelDurumuVarMi === "Evet"
                ? [
                    (b.engelTurleri ?? []).join(", "),
                    b.engelOrani ? `Oran: %${b.engelOrani}` : "",
                    b.engelRaporuVarMi === "Evet"
                      ? "Sağlık kurulu raporu var"
                      : "Sağlık kurulu raporu yok",
                    b.engelAciklama,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Yok"}
            </td>
          </tr>
          <tr>
            <th>Askerlik Durumunuz</th>
            <td>{d(b.askerlikDurumu)}</td>
            <th>Eğitim Seviyeniz</th>
            <td>
              {d(b.egitimSeviyesi)}
              {b.mezunOkul ? ` · ${b.mezunOkul}` : ""}
            </td>
          </tr>
          <tr>
            <th>Ehliyetiniz var mı?</th>
            <td>
              {d(b.ehliyetVarMi)}
              {b.ehliyetVarMi === "Evet" && b.ehliyetSinifi
                ? ` · Sınıfı: ${b.ehliyetSinifi}`
                : ""}
            </td>
            <th>Ticari taşıt kullanma belgeniz</th>
            <td>
              {d(b.ticariTasitBelgesiVarMi)}
              {b.srcBelgeleri?.length ? ` · ${b.srcBelgeleri.join(", ")}` : ""}
            </td>
          </tr>
          <tr>
            <th>Bilgisayar Program Bilginiz</th>
            <td colSpan={3}>
              {b.bilgisayarBilgisi?.length
                ? b.bilgisayarBilgisi.join(", ") +
                  (b.bilgisayarDiger ? ` (${b.bilgisayarDiger})` : "")
                : bos}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ------------------------------------------------------ iş tecrübesi */}
      <BolumBandi
        metin="İŞ TECRÜBENİZ"
        aciklama="En son çalıştığınız yerden başlayarak sıralanmıştır"
      />

      <div className="on-kaydir">
        <table className="on-tablo on-tablo-liste">
          <thead>
            <tr>
              <th>İşyerinin Adı</th>
              <th>Göreviniz</th>
              <th>Net Ücretiniz</th>
              <th>İşe Giriş / Çıkış</th>
              <th>Ayrılma Sebebiniz</th>
            </tr>
          </thead>
          <tbody>
            {b.isTecrubesi?.length ? (
              b.isTecrubesi.map((t: any, i: number) => (
                <tr key={i}>
                  <td>{d(t.isyeriAdi)}</td>
                  <td>{d(t.gorev)}</td>
                  <td>{d(t.netUcret)}</td>
                  <td>
                    {d(t.iseGirisTarihi)} / {d(t.istenCikisTarihi)}
                  </td>
                  <td>{d(t.ayrilmaSebebi)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="on-bos-satir">
                  İş tecrübesi belirtilmemiştir.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------- sertifikalar */}
      {b.sertifikalar?.length ? (
        <>
          <BolumBandi metin="SERTİFİKA VE BELGELER" />
          <table className="on-tablo on-tablo-sertifika">
            <tbody>
              {b.sertifikalar.map((c: any, i: number) => (
                <tr key={i}>
                  <th>{i + 1}</th>
                  <td>
                    <div className="on-srt-ad">{d(c.ad)}</div>
                    <div className="on-srt-alt">
                      {[c.kurum, c.tarih].filter(Boolean).join(" · ") || bos}
                    </div>
                    {c.link && (
                      <a
                        className="on-srt-link"
                        href={c.link}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.link}
                      </a>
                    )}
                  </td>
                  <td className="on-srt-gorsel-hucre">
                    {c.gorsel ? (
                      <a
                        href={gorselAdresi(c.gorsel)}
                        target="_blank"
                        rel="noreferrer"
                        title="Büyütmek için tıklayınız"
                      >
                        <img
                          className="on-srt-gorsel"
                          src={gorselAdresi(c.gorsel)}
                          alt={c.ad}
                        />
                      </a>
                    ) : (
                      <span className="on-srt-gorsel-yok">Görsel yok</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {/* ---------------------------------------------- firma başvuru içeriği */}
      <BolumBandi metin="FİRMA BAŞVURU İÇERİĞİ" />

      <table className="on-tablo">
        <tbody>
          <tr>
            <th>Daha önce firmamıza başvurdunuz mu?</th>
            <td>
              {d(b.oncedenBasvurduMu)}
              {b.oncekiBasvuruAciklama ? ` · ${b.oncekiBasvuruAciklama}` : ""}
            </td>
          </tr>
          <tr>
            <th>Daha önce firmamızda çalıştınız mı?</th>
            <td>
              {d(b.oncedenCalistiMi)}
              {b.oncekiCalismaAciklama ? ` · ${b.oncekiCalismaAciklama}` : ""}
            </td>
          </tr>
          <tr>
            <th>Şu an herhangi bir işyerinde çalışıyor musunuz?</th>
            <td>
              {d(b.halenCalisiyorMu)}
              {b.halenCalistigiYer ? ` · ${b.halenCalistigiYer}` : ""}
            </td>
          </tr>
          <tr>
            <th>Talep ettiğiniz net ücret</th>
            <td>{d(b.talepEdilenNetUcret)}</td>
          </tr>
          <tr>
            <th>İşe başlayabileceğiniz tarih</th>
            <td>{d(b.iseBaslamaTarihi)}</td>
          </tr>
          <tr>
            <th>Çalışmak istediğiniz birim</th>
            <td>
              {d(b.subeAdi)}
              {b.birimTuru ? ` (${b.birimTuru})` : ""}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ----------------------------------------------------------- bölümler */}
      <BolumBandi metin="ÇALIŞMAK İSTEDİĞİNİZ BÖLÜMLER" />

      <div className="on-kutu-alani">
        {bolumListesi.map((bolum) => (
          <Kutu key={bolum} metin={bolum} isaretli={secilenBolumler.includes(bolum)} />
        ))}
      </div>

      {/* -------------------------------------------------------- referanslar */}
      <BolumBandi
        metin="REFERANSLARINIZ"
        aciklama="Daha önce beraber veya bağlı çalışılan kişiler"
      />

      <div className="on-kaydir">
        <table className="on-tablo on-tablo-liste">
          <thead>
            <tr>
              <th>Adı, Soyadı</th>
              <th>Çalıştığı Yer</th>
              <th>Görevi</th>
              <th>Telefon Numarası</th>
            </tr>
          </thead>
          <tbody>
            {b.referanslar?.length ? (
              b.referanslar.map((r: any, i: number) => (
                <tr key={i}>
                  <td>{d(r.adSoyad)}</td>
                  <td>{d(r.calistigiYer)}</td>
                  <td>{d(r.gorev)}</td>
                  <td>{d(r.telefon)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="on-bos-satir">
                  Referans belirtilmemiştir.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------------ taahhüt */}
      <div className="on-taahhut">{TAAHHUT_METNI}</div>

      <div className="on-imza">
        <div className="on-imza-kutu">
          <span className="on-imza-etiket">Adayın Adı - Soyadı</span>
          <span className="on-imza-deger">{d(b.adayAdSoyad)}</span>
        </div>
        <div className="on-imza-kutu">
          <span className="on-imza-etiket">Onay</span>
          <span className="on-imza-deger">
            {b.taahhutOnay ? "Elektronik ortamda onaylanmıştır" : bos}
          </span>
        </div>
        <div className="on-imza-kutu">
          <span className="on-imza-etiket">Tarih</span>
          <span className="on-imza-deger">{d(b.beyanTarihi)}</span>
        </div>
      </div>

      {(b.rizaIsleme || b.rizaReferans || b.rizaYetkiliMerci || b.rizaBeyanPaylasim) && (
        <table className="on-tablo on-tablo-riza">
          <tbody>
            <tr>
              <th>Aydınlatma Metni</th>
              <td>{b.aydinlatmaOnay ? "Onay veriyorum" : bos}</td>
            </tr>
            <tr>
              <th>Verilerin işlenmesi ve İK havuzunda saklanması</th>
              <td>{d(b.rizaIsleme)}</td>
            </tr>
            <tr>
              <th>Referanslardan bilgi alınması</th>
              <td>{d(b.rizaReferans)}</td>
            </tr>
            <tr>
              <th>Yetkili mercilerle paylaşım</th>
              <td>{d(b.rizaYetkiliMerci)}</td>
            </tr>
            <tr>
              <th>Beyan formunun referanslara aktarılması</th>
              <td>{d(b.rizaBeyanPaylasim)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="on-kunye">
        Dok. Kodu: {KUNYE.dokKodu} · Rev. No: {KUNYE.revNo} · Rev. Tar:{" "}
        {KUNYE.revTarih}
        {b.kvkkOnay ? " · KVKK aydınlatma metni onaylanmıştır" : ""}
      </div>
    </div>
  );
}
