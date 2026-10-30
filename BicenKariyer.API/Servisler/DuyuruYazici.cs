using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Mobil duyuru kaydı (KRY_MOBIL_DUYURU + alıcılar).
///
/// <para>
/// Panelden (MobilController.DuyuruGonder) ve Biçen360 patron görünümünden
/// (PatronMobilController.Duyuru) gönderilen duyurular aynı satırı
/// yazıyor (03.10.2026). İki ayrı INSERT zamanla ayrışırdı: yeni bir sütun
/// birine eklenip ötekinde unutulunca uygulamada yarım görünen duyurular
/// çıkardı. Bildirim gönderimi çağıranda kalıyor; hedefe göre hangi
/// BildirimServisi yolunun kullanılacağını çağıran biliyor.
/// </para>
/// </summary>
public static class DuyuruYazici
{
    public sealed class Kayit
    {
        public string Baslik { get; set; }
        public string Metin { get; set; }

        /// <summary>herkes · sube · merkez · depo · kisi · secili</summary>
        public string Hedef { get; set; }
        public string HedefOzet { get; set; }
        public string SubeAdi { get; set; }
        public string PersonelKodu { get; set; }
        public bool Onemli { get; set; }
        public string Baglanti { get; set; }
        public string BaglantiYazi { get; set; }
        public byte[] Gorsel { get; set; }
        public string Gonderen { get; set; }
        public string YazanAd { get; set; }
        public string YazanUnvan { get; set; }
        public string Imza { get; set; }

        /// <summary>Planlı duyuru (27.10.2026): yayın zamanı; null = hemen</summary>
        public DateTime? YayinZamani { get; set; }
    }

    /// <summary>
    /// Duyuruyu yazar; "secili" hedefte alıcıları da. Yeni kaydın kimliği döner.
    /// </summary>
    public static int Ekle(IDbConnection db, Kayit k, IEnumerable<string> alicilar = null)
    {
        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_MOBIL_DUYURU
    (baslik, metin, hedef_tur, hedef_ozet, sube_adi, personel_kodu,
     onemli, baglanti, baglanti_yazi, gorsel, gonderen,
     yazan_ad, yazan_unvan, imza, olusturma, planli, planli_bildirim)
OUTPUT INSERTED.id
VALUES (@baslik, @metin, @hedef, @hedefOzet, @subeAdi, @personelKodu,
        @onemli, @baglanti, @baglantiYazi, @gorsel, @gonderen,
        @yazanAd, @yazanUnvan, @imza, ISNULL(@yayin, SYSDATETIME()), @planli, @planli)",
            new
            {
                baslik = k.Baslik,
                metin = k.Metin,
                hedef = k.Hedef,
                hedefOzet = k.HedefOzet,
                subeAdi = k.SubeAdi,
                personelKodu = k.PersonelKodu,
                onemli = k.Onemli,
                baglanti = k.Baglanti,
                baglantiYazi = k.BaglantiYazi,
                gorsel = k.Gorsel,
                gonderen = k.Gonderen,
                yazanAd = k.YazanAd,
                yazanUnvan = k.YazanUnvan,
                imza = k.Imza,
                yayin = k.YayinZamani,
                planli = k.YayinZamani is not null,
            });

        if (k.Hedef == "secili" && alicilar is not null)
            db.Execute(@"
INSERT INTO KRY_MOBIL_DUYURU_ALICI (duyuru_id, personel_kodu) VALUES (@id, @kod)",
                alicilar
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Select(x => x.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Select(kod => new { id, kod }));

        return id;
    }
}
