using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// POS (PosbackPromosyon) sorgularında kart numarası parametresi.
///
/// <para>
/// MusteriKart ve PuanHareket'te <c>KartNo</c> VARCHAR. Dapper .NET string'ini
/// NVARCHAR gönderiyor; SQL Server bu durumda SÜTUNU NVARCHAR'a çeviriyor
/// (CONVERT_IMPLICIT) ve dizini kullanamıyor: her sorguda PuanHareket'in
/// tamamı taranıyordu. Biçen Kart ekranı bu yüzden 30–40 saniyede açılıyordu
/// (06.10.2026). Liste (IN) parametreleri ANSI gönderiliyor; tekli
/// karşılaştırmalarda parametre sorguda VARCHAR'a çevriliyor (sütun değil).
/// </para>
/// </summary>
public static class PosParametre
{
    /// <summary>IN listesi için ANSI (VARCHAR) parametreler</summary>
    public static DbString[] Ansi(IEnumerable<string> kartlar) =>
        (kartlar ?? Enumerable.Empty<string>())
        .Select(x => new DbString { Value = (x ?? "").Trim(), IsAnsi = true, Length = 50 })
        .ToArray();
}
