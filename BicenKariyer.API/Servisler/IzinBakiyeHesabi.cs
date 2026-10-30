using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Yıllık izin bakiyesi: hak edilen, devir, kullanılan, planlı ve kalan.
///
/// <para>
/// Hesap önceden yalnızca <c>Izin/Durum</c> içinde duruyordu. Yıllık İzin
/// Ücretleri ekranı (ayrılışta ödenecek izin parası) aynı rakamlara
/// dayanıyor; iki yerde ayrı ayrı yazılırsa bir gün biri değişir, diğeri
/// değişmez ve iki ekran farklı gün gösterir. Bu yüzden tek yerde.
/// </para>
///
/// <para>
/// Kaynak:
///   KRY_IZIN_BAKIYE → başlangıç (hak edilen) + devir − aktarılan kullanım
///   KRY_IZIN (iptal = 0, bakiyeden_duser = 1) → bugüne kadar başlamış
///   izinler "kullanılan", ileri tarihliler "planlı".
/// Kalan = hak edilen + devir − kullanılan − planlı. Bakiye satırı yoksa
/// hak edilen ve kalan boştur (null): sıfır ile "girilmemiş" ayrı şeyler.
/// </para>
/// </summary>
public static class IzinBakiyeHesabi
{
    /// <summary>KRY_IZIN_BAKIYE satırı.</summary>
    public sealed class BakiyeSatiri
    {
        public string Kod { get; set; }
        public decimal Baslangic { get; set; }
        public decimal Devir { get; set; }
        public decimal Aktarilan { get; set; }
        public DateTime Tarih { get; set; }
    }

    /// <summary>KRY_IZIN'den kişi başı toplam.</summary>
    public sealed class KullanimSatiri
    {
        public string Kod { get; set; }
        public decimal Kullanilan { get; set; }
        public decimal Planli { get; set; }
    }

    /// <summary>Bir personelin bakiyesi.</summary>
    public sealed class Durum
    {
        /// <summary>KRY_IZIN_BAKIYE'de satırı var mı</summary>
        public bool Girildi { get; init; }

        /// <summary>Bu dönem hak edilen (başlangıç); girilmemişse null</summary>
        public decimal? Hakedilen { get; init; }

        public decimal Devir { get; init; }

        /// <summary>Aktarılan kullanım + bugüne kadar başlamış izinler</summary>
        public decimal Kullanilan { get; init; }

        /// <summary>İleri tarihli (henüz başlamamış) izinler</summary>
        public decimal Planli { get; init; }

        /// <summary>Bakiyenin geçerli olduğu gün (açılış/aktarım)</summary>
        public DateTime? BakiyeTarihi { get; init; }

        /// <summary>Kalan = hak edilen + devir − kullanılan − planlı</summary>
        public decimal? Kalan => Hakedilen is null ? null : Hakedilen + Devir - Kullanilan - Planli;

        /// <summary>
        /// Bugün ayrılsa hak ettiği gün: planlı izin henüz kullanılmadığı
        /// için düşülmez. Eksi çıkabilir (avans izin); ödemede sıfıra
        /// çekmek çağıranın işidir, ham değer burada kalır.
        /// </summary>
        public decimal? KullanilmamisGun => Hakedilen is null ? null : Hakedilen + Devir - Kullanilan;
    }

    /// <summary>
    /// Tüm personelin bakiye ve kullanım toplamları. İki sorgu: kişi kişi
    /// sorgu, 1000 kişilik listede 2000 gidiş-dönüş demek.
    /// </summary>
    public sealed class Tablo
    {
        private readonly Dictionary<string, BakiyeSatiri> _bakiyeler;
        private readonly Dictionary<string, KullanimSatiri> _kullanimlar;

        internal Tablo(Dictionary<string, BakiyeSatiri> bakiyeler,
                       Dictionary<string, KullanimSatiri> kullanimlar)
        {
            _bakiyeler = bakiyeler;
            _kullanimlar = kullanimlar;
        }

        /// <summary>Personel koduna göre bakiye. Kod kırpılmış gelmeli.</summary>
        public Durum Hesapla(string kod)
        {
            var bakiye = _bakiyeler.GetValueOrDefault(kod ?? "");
            var kullanim = _kullanimlar.GetValueOrDefault(kod ?? "");

            /* Kullanılan = çizelgeden aktarılan + sistemde girilmiş geçmiş
               izinler. Aktarılan kısmın tarihi yoktur; çizelgede tek tek
               tarihler bulunmuyor. */
            var aktarilan = bakiye?.Aktarilan ?? 0m;

            return new Durum
            {
                Girildi = bakiye is not null,
                Hakedilen = bakiye?.Baslangic,
                Devir = bakiye?.Devir ?? 0m,
                Kullanilan = aktarilan + (kullanim?.Kullanilan ?? 0m),
                Planli = kullanim?.Planli ?? 0m,
                BakiyeTarihi = bakiye?.Tarih
            };
        }
    }

    /// <summary>Bakiye ve kullanım tablolarını okur.</summary>
    public static Tablo Oku(IDbConnection db)
    {
        var bakiyeler = db.Query<BakiyeSatiri>(@"
SELECT personel_kodu AS Kod, baslangic AS Baslangic, devir AS Devir,
       aktarilan_kullanim AS Aktarilan, baslangic_tarihi AS Tarih
FROM KRY_IZIN_BAKIYE")
            .ToDictionary(x => x.Kod, x => x, StringComparer.OrdinalIgnoreCase);

        /* Kullanılan ve planlı ayrı sayılır: gelecekteki bir izin bakiyeyi
           düşürür ama "kullanıldı" sayılmaz. Yalnızca bakiyeden düşen
           (yıllık) izinler; mazeret, rapor gibi türler bakiyeyi etkilemez. */
        var kullanimlar = db.Query<KullanimSatiri>(@"
SELECT personel_kodu AS Kod,
       SUM(CASE WHEN cikis_tarihi <= CAST(SYSDATETIME() AS DATE)
                THEN gun ELSE 0 END) AS Kullanilan,
       SUM(CASE WHEN cikis_tarihi > CAST(SYSDATETIME() AS DATE)
                THEN gun ELSE 0 END) AS Planli
FROM KRY_IZIN
WHERE iptal = 0 AND bakiyeden_duser = 1
GROUP BY personel_kodu")
            .ToDictionary(x => x.Kod, x => x, StringComparer.OrdinalIgnoreCase);

        return new Tablo(bakiyeler, kullanimlar);
    }
}
