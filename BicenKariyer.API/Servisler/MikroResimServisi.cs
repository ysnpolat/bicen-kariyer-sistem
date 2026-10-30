using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Personel fotoğrafını Mikro'ya yazar.
///
/// <para>
/// Mikro üretim veritabanıdır ve kendi arayüzü de aynı tabloyu kullanır.
/// Bu yüzden her yazma işleminden önce mevcut hâl kendi veritabanımızdaki
/// <c>KRY_RESIM_YEDEK</c> tablosuna alınır. Bir sorun çıkarsa işlem geri
/// alınabilir; yedek Mikro'da değil bizde durduğu için Mikro tarafındaki
/// bir arıza yedeği etkilemez.
/// </para>
///
/// <para>
/// <c>mye_ImageData</c> tablosunun kolon adları Mikro sürümüne göre
/// değişebildiği için şema çalışma anında okunur; ikili veri kolonu
/// bulunup ona yazılır.
/// </para>
/// </summary>
public class MikroResimServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<MikroResimServisi> _kayit;

    public MikroResimServisi(VeritabaniServisi vt, ILogger<MikroResimServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    private const string Tablo = "[MikroDesktop_2004BICEN].dbo.mye_ImageData";

    /// <summary>
    /// Mikro'nun personel tablosu dosya numarası. mye_ImageData tablosundaki
    /// TableID kolonu bu değeri bekler ve NULL kabul etmez; kayıttaki
    /// per_fileid ile aynıdır. Veritabanındaki 9609 fotoğraf kaydının
    /// tamamı 71 ile yazılmış.
    /// </summary>
    private const int PersonelTabloNo = 71;

    /// <summary>İşlem sonucu</summary>
    public record Sonuc(bool Basarili, string Mesaj, int YedekId = 0);

    /* ==================================================================== */
    /* Şema keşfi                                                            */
    /* ==================================================================== */

    /// <summary>
    /// Görsel verisinin tutulduğu kolonun adını bulur.
    /// Birden fazla ikili kolon varsa ilki kullanılır.
    /// </summary>
    private string GorselKolonu(IDbConnection db)
    {
        var kolonlar = db.Query<string>(@"
SELECT COLUMN_NAME
FROM [MikroDesktop_2004BICEN].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'mye_ImageData'
  AND DATA_TYPE IN ('varbinary', 'image', 'binary')
ORDER BY ORDINAL_POSITION").ToList();

        return kolonlar.FirstOrDefault();
    }

    /// <summary>Tablodaki tüm kolon adları; ekleme sırasında gerekir.</summary>
    private List<string> TumKolonlar(IDbConnection db) =>
        db.Query<string>(@"
SELECT COLUMN_NAME
FROM [MikroDesktop_2004BICEN].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'mye_ImageData'
ORDER BY ORDINAL_POSITION").ToList();

    /* ==================================================================== */
    /* Yazma                                                                 */
    /* ==================================================================== */

    /// <summary>
    /// Personelin fotoğrafını Mikro'ya yazar. Önceki hâl yedeklenir.
    /// </summary>
    public Sonuc Yaz(Guid kayitGuid, string personelKodu, string personelAdi,
                     byte[] gorsel, string kullanici)
    {
        if (gorsel is null || gorsel.Length < 100)
            return new Sonuc(false, "Görsel verisi geçersiz.");

        /* Makul bir üst sınır; Mikro kartlarında büyük dosya tutmak
           veritabanını gereksiz şişirir. */
        if (gorsel.Length > 2_000_000)
            return new Sonuc(false, "Görsel 2 MB'tan büyük olamaz.");

        using var db = _vt.PersonelBaglantisi();
        db.Open();

        var kolon = GorselKolonu(db);

        if (string.IsNullOrWhiteSpace(kolon))
            return new Sonuc(false,
                "Mikro resim tablosunda ikili veri kolonu bulunamadı.");

        /* ---------------------------------------------------- mevcut hâl */
        byte[] eski = null;
        var kayitVar = false;

        try
        {
            var satir = db.QueryFirstOrDefault(
                $"SELECT TOP 1 * FROM {Tablo} WHERE Record_uid = @guid",
                new { guid = kayitGuid });

            if (satir is not null)
            {
                kayitVar = true;

                foreach (var alan in (IDictionary<string, object>)satir)
                {
                    if (alan.Value is byte[] veri && veri.Length > 0)
                    {
                        eski = veri;
                        break;
                    }
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Mikro resim kaydı okunamadı");
            return new Sonuc(false, "Mevcut kayıt okunamadı: " + hata.Message);
        }

        /* -------------------------------------------------------- yedekle
           Yedek yazma işleminden ÖNCE alınır; işlem yarıda kalsa bile
           eski hâl elimizde kalır. */
        int yedekId;

        try
        {
            using var yerel = _vt.Baglanti();

            yedekId = yerel.ExecuteScalar<int>(@"
INSERT INTO KRY_RESIM_YEDEK
    (personel_kodu, personel_adi, kayit_guid, islem,
     eski_veri, yeni_veri, kolon_adi, kullanici)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @guid, @islem, @eski, @yeni, @kolon, @kullanici)",
                new
                {
                    kod = personelKodu,
                    ad = personelAdi,
                    guid = kayitGuid,
                    islem = kayitVar ? "DEGISTIRME" : "EKLEME",
                    eski,
                    yeni = gorsel,
                    kolon,
                    kullanici
                });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Resim yedeği alınamadı");

            /* Yedek alınamadıysa Mikro'ya yazılmaz; geri dönüş imkânı
               olmadan üretim verisine dokunulmaz. */
            return new Sonuc(false,
                "Yedek alınamadığı için işlem durduruldu: " + hata.Message);
        }

        /* ----------------------------------------------------- Mikro'ya yaz */
        try
        {
            if (kayitVar)
            {
                db.Execute(
                    $"UPDATE {Tablo} SET [{kolon}] = @veri WHERE Record_uid = @guid",
                    new { veri = gorsel, guid = kayitGuid }, commandTimeout: 60);
            }
            else
            {
                /* Yeni kayıt.
                
                   Mikro'nun kendi yazdığı bir satır ŞABLON olarak alınır ve
                   tüm alanları kopyalanır; yalnızca kimlik, kayıt bağlantısı
                   ve görsel verisi değiştirilir.

                   Sebebi şu: elle üç alan (Record_uid, TableID, ImageID)
                   doldurup satır eklediğimizde Mikro fotoğrafı görmüyordu.
                   Tabloda Mikro'nun beklediği başka alanlar da var ve hangi
                   sürümde hangileri olduğu değişiyor. Şablonu kopyalamak
                   alan alan tahmin yürütmekten hem güvenli hem sürümden
                   bağımsız. Güncelleme yolunun sorunsuz çalışması da bunu
                   doğruluyor: sorun satırın içeriğinde, yazma işleminde
                   değil. */
                var kolonlar = TumKolonlar(db);

                if (!kolonlar.Contains("Record_uid", StringComparer.OrdinalIgnoreCase))
                    return new Sonuc(false, "Record_uid kolonu bulunamadı.", yedekId);

                /* Otomatik artan kolonlara değer yazılamaz; listeden çıkar */
                var kimlikKolonlari = db.Query<string>(@"
SELECT name FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.mye_ImageData')
  AND is_identity = 1").ToList();

                /* ImageID her zaman 0 yazılır. Mikro personel fotoğrafını
                   Record_uid + TableID ile bulur, ImageID sıra numarası
                   değil; MAX+1 ile üretilen rastgele sayılar Mikro'nun
                   kendi yazdığı kayıtlarla uyuşmuyordu. Kolon otomatik
                   artansa yazılmaz. */
                var imageIdYazilir = kolonlar.Contains("ImageID", StringComparer.OrdinalIgnoreCase)
                    && !kimlikKolonlari.Contains("ImageID", StringComparer.OrdinalIgnoreCase);

                /* Şablon: aynı tablo numarasına ait, görseli dolu bir kayıt
                   var mı. ImageID'ler artık ayırt edici olmadığı için şablon
                   kimlikle değil TOP 1 ile seçilir. */
                var sablonVar = db.ExecuteScalar<int>($@"
SELECT COUNT(*) FROM {Tablo}
WHERE TableID = @tableId AND [{kolon}] IS NOT NULL",
                    new { tableId = PersonelTabloNo }) > 0;

                if (!sablonVar)
                {
                    /* Hiç örnek yoksa eski yol denenir; ilk fotoğraf
                       yüklemesinde kopyalanacak bir satır olmayabilir. */
                    var tableIdVar = kolonlar.Contains("TableID",
                        StringComparer.OrdinalIgnoreCase);

                    db.Execute(
                        $"INSERT INTO {Tablo} (Record_uid, [{kolon}]" +
                        (tableIdVar ? ", TableID" : "") +
                        (imageIdYazilir ? ", ImageID" : "") + ") " +
                        $"VALUES (@guid, @veri" + (tableIdVar ? ", @tableId" : "") +
                        (imageIdYazilir ? ", 0" : "") + ")",
                        new { guid = kayitGuid, veri = gorsel, tableId = PersonelTabloNo },
                        commandTimeout: 60);
                }
                else
                {
                    var yazilacak = kolonlar
                        .Where(x => !kimlikKolonlari.Contains(x, StringComparer.OrdinalIgnoreCase))
                        .ToList();

                    /* Her kolon için: anahtar alanlar yeni değeri, kalanlar
                       şablondaki değeri alır. */
                    var ifadeler = yazilacak.Select(x =>
                        x.Equals("ImageID", StringComparison.OrdinalIgnoreCase)
                            ? "0"
                        : x.Equals("Record_uid", StringComparison.OrdinalIgnoreCase)
                            ? "@guid"
                        : x.Equals(kolon, StringComparison.OrdinalIgnoreCase)
                            ? "@veri"
                        : x.Equals("TableID", StringComparison.OrdinalIgnoreCase)
                            ? "@tableId"
                            : $"s.[{x}]");

                    var hedefKolonlar = string.Join(", ", yazilacak.Select(x => $"[{x}]"));

                    db.Execute(
                        $"INSERT INTO {Tablo} ({hedefKolonlar}) " +
                        $"SELECT TOP 1 {string.Join(", ", ifadeler)} " +
                        $"FROM {Tablo} s WITH (TABLOCKX) " +
                        $"WHERE s.TableID = @tableId AND s.[{kolon}] IS NOT NULL",
                        new
                        {
                            guid = kayitGuid,
                            veri = gorsel,
                            tableId = PersonelTabloNo
                        },
                        commandTimeout: 60);
                }
            }

            _kayit.LogInformation(
                "Mikro fotoğrafı yazıldı: {Kod} ({Islem}), yedek #{Yedek}",
                personelKodu, kayitVar ? "güncelleme" : "ekleme", yedekId);

            PersonelKaynagiServisi.OnbellegiTemizle();

            return new Sonuc(true,
                kayitVar ? "Fotoğraf güncellendi." : "Fotoğraf eklendi.", yedekId);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Mikro'ya fotoğraf yazılamadı");

            return new Sonuc(false,
                "Mikro'ya yazılamadı: " + hata.Message, yedekId);
        }
    }

    /* ==================================================================== */
    /* Geri alma                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Bir yazma işlemini geri alır: eski görsel varsa yerine konur,
    /// kayıt önceden yoksa eklenen satır silinir.
    /// </summary>
    public Sonuc GeriAl(int yedekId, string kullanici)
    {
        using var yerel = _vt.Baglanti();

        var yedek = yerel.QueryFirstOrDefault(@"
SELECT id, kayit_guid AS KayitGuid, islem, eski_veri AS EskiVeri,
       kolon_adi AS KolonAdi, geri_alindi AS GeriAlindi,
       personel_kodu AS PersonelKodu
FROM KRY_RESIM_YEDEK WHERE id = @yedekId", new { yedekId });

        if (yedek is null)
            return new Sonuc(false, "Yedek kaydı bulunamadı.");

        if ((bool)yedek.GeriAlindi)
            return new Sonuc(false, "Bu işlem zaten geri alınmış.");

        var guid = (Guid)yedek.KayitGuid;
        var kolon = (string)yedek.KolonAdi;
        var eski = yedek.EskiVeri as byte[];
        var islem = (string)yedek.islem;

        try
        {
            using var db = _vt.PersonelBaglantisi();

            if (islem == "EKLEME")
            {
                /* Kayıt bizim tarafımızdan oluşturulmuştu; silinir */
                db.Execute($"DELETE FROM {Tablo} WHERE Record_uid = @guid",
                    new { guid }, commandTimeout: 60);
            }
            else
            {
                /* Önceki görsel geri yazılır */
                db.Execute(
                    $"UPDATE {Tablo} SET [{kolon}] = @veri WHERE Record_uid = @guid",
                    new { veri = eski, guid }, commandTimeout: 60);
            }

            yerel.Execute(@"
UPDATE KRY_RESIM_YEDEK
SET geri_alindi = 1, geri_alma_tarihi = SYSDATETIME()
WHERE id = @yedekId", new { yedekId });

            _kayit.LogInformation(
                "Mikro fotoğrafı geri alındı: yedek #{Yedek}, {Kullanici}",
                yedekId, kullanici);

            PersonelKaynagiServisi.OnbellegiTemizle();

            return new Sonuc(true, "İşlem geri alındı.", yedekId);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Fotoğraf geri alınamadı");
            return new Sonuc(false, "Geri alınamadı: " + hata.Message);
        }
    }
}
