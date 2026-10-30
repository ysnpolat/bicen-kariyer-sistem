namespace BicenKariyer.API.Servisler;

/// <summary>
/// Başvuru sayımlarının ortak tanımları (03.10.2026).
///
/// <para>
/// Başvurular sayfasının kartları (Basvuru/Ozet), dağılım penceresi
/// (Basvuru/Dagilim), Raporlar sayfası ve Yönetim Raporu aynı başvuruyu
/// farklı kurallarla sayıyordu: Raporlar arşivlenenleri ve aynı adayın eski
/// başvurularını da sayıyor, "Onay Bekliyor" ve "İncelendi" durumlarını hiç
/// saymıyordu. Aynı dönem için iki sayfa farklı toplam gösteriyordu.
/// Kurallar burada tek yerde tutulur; her sorgu bunları kullanır.
/// </para>
/// </summary>
public static class BasvuruTabani
{
    /// <summary>
    /// Listeyle aynı taban: arşivlenenler sayılmaz, aynı kimlik numarasıyla
    /// yapılmış eski başvurular düşer, yalnızca en yenisi sayılır.
    /// <paramref name="takma"/> tablonun sorgudaki takma adıdır.
    /// </summary>
    public static string Kosul(string takma = "b") => $@"ISNULL({takma}.arsiv, 0) = 0
  AND ({takma}.kimlik_no IS NULL OR {takma}.id = {TemsilciId(takma)})";

    /// <summary>
    /// Aynı kimlikle birden çok başvuru varken listede görünecek olanı
    /// (08.10.2026). Önceden her zaman en yenisiydi: işe alınan aday ertesi
    /// gün yeniden başvurunca işe alım kaydı listeden düşüyor, kişi "Yeni"
    /// görünüyordu. Şimdi süren bir işe alım (Onay Bekliyor, Evrak
    /// Hazırlanıyor; son 60 günde güncellenmiş) ya da son 60 günde işe giriş
    /// yapılmış "İşe Alındı" kaydı varsa o gösteriliyor; yoksa en yenisi.
    /// Yeni başvuru kaybolmuyor: başvuru ayrıntısında "Diğer başvuruları"nda
    /// duruyor.
    /// </summary>
    public static string TemsilciId(string takma) => $@"ISNULL(
        (SELECT MAX(z.id) FROM KRY_BASVURULAR z
         WHERE z.kimlik_no = {takma}.kimlik_no AND ISNULL(z.arsiv, 0) = 0
           AND ((z.durum IN (N'{Durumlar.OnayBekliyor}', N'{Durumlar.EvrakHazirlaniyor}')
                 AND ISNULL(z.guncelleme, z.olusturma) >= DATEADD(day, -60, SYSDATETIME()))
             OR (z.durum = N'{Durumlar.IseAlindi}'
                 AND z.ise_giris_tarihi >= DATEADD(day, -60, CAST(SYSDATETIME() AS DATE))))),
        (SELECT MAX(y.id) FROM KRY_BASVURULAR y WHERE y.kimlik_no = {takma}.kimlik_no))";

    /// <summary>
    /// Raporlar ve Yönetim Raporu tabanı (03.10.2026, kullanıcı kararı):
    /// arşivlenenler sayılmaz ama her başvuru kendi ayında sayılır. Liste
    /// kuralıyla (yalnızca en yeni başvuru) aynı kişi sonradan tekrar
    /// başvurunca eski başvurusu geçmiş aydan düşüyor, geçmiş ayların
    /// rakamları değişiyordu.
    /// </summary>
    public static string RaporKosul(string takma = "b") => $"ISNULL({takma}.arsiv, 0) = 0";

    /// <summary>
    /// Görüşme aşamasına gelmiş sayılan durumlar. "Onay Bekliyor" işe alım
    /// bilgisi girilmiş, onay bekleyen kayıttır; görüşmeyi geçmiştir.
    /// </summary>
    public static readonly string[] GorusmeDurumlari =
    {
        Durumlar.GorusmeTalebi, Durumlar.Olumlu, Durumlar.EvrakHazirlaniyor,
        Durumlar.OnayBekliyor, Durumlar.IseAlindi
    };

    /// <summary>Olumlu sonuçlanmış sayılan durumlar (havuz, evrak, onay, işe alındı)</summary>
    public static readonly string[] OlumluDurumlari =
    {
        Durumlar.Olumlu, Durumlar.EvrakHazirlaniyor, Durumlar.OnayBekliyor, Durumlar.IseAlindi
    };

    /// <summary>SQL için: <c>N'a', N'b'</c> biçiminde liste</summary>
    public static string SqlListe(IEnumerable<string> durumlar) =>
        string.Join(", ", durumlar.Select(x => $"N'{x.Replace("'", "''")}'"));

    /// <summary>GorusmeDurumlari'nın SQL karşılığı</summary>
    public static string GorusmeSql => SqlListe(GorusmeDurumlari);

    /// <summary>OlumluDurumlari'nın SQL karşılığı</summary>
    public static string OlumluSql => SqlListe(OlumluDurumlari);
}
