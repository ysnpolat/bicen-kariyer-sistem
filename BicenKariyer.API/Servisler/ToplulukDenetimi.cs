using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Peş peşe gelen başvuruları yakalar.
///
/// <para>
/// Otomatik gönderimler farklı adreslerden geldiği için adres bazlı hız
/// sınırı işlemiyor. Ama bir ortak yanları var: kısa sürede çok sayıda
/// başvuru üretiyorlar. Gerçek adaylar bu yoğunlukta gelmez.
/// </para>
///
/// <para>
/// Eşik aşıldığında sistem <b>korumalı kipe</b> geçer: yeni başvurular
/// reddedilmez ama doğrudan kayda geçmez, incelemeye alınır. Böylece gerçek
/// bir aday da o sırada başvurmuşsa kaybolmaz.
/// </para>
/// </summary>
public class ToplulukDenetimi
{
    private readonly VeritabaniServisi _vt;
    private readonly IConfiguration _yapilandirma;
    private readonly GuvenlikGunlugu _gunluk;

    public ToplulukDenetimi(
        VeritabaniServisi vt,
        IConfiguration yapilandirma,
        GuvenlikGunlugu gunluk)
    {
        _vt = vt;
        _yapilandirma = yapilandirma;
        _gunluk = gunluk;
    }

    private bool Acik => _yapilandirma.GetValue("ToplulukDenetimi:Acik", true);

    /// <summary>Kaç dakikalık pencereye bakılır</summary>
    private int Pencere => _yapilandirma.GetValue("ToplulukDenetimi:Dakika", 10);

    /// <summary>Bu sayı aşılırsa korumalı kipe geçilir</summary>
    private int Esik => _yapilandirma.GetValue("ToplulukDenetimi:Esik", 6);

    /// <summary>Korumalı kip ne kadar sürer</summary>
    private int KorumaDakika =>
        _yapilandirma.GetValue("ToplulukDenetimi:KorumaDakika", 60);

    /// <summary>Denetim sonucu</summary>
    public record Sonuc(bool KorumaliKip, int SonBasvuru, string Gerekce);

    /// <summary>
    /// Şu an korumalı kipte miyiz?
    ///
    /// Hem son pencerede gelen başvuru sayısına hem de daha önce
    /// başlatılmış bir koruma süresine bakılır.
    /// </summary>
    public Sonuc Denetle(string adres)
    {
        if (!Acik) return new Sonuc(false, 0, null);

        try
        {
            using var db = _vt.Baglanti();

            /* Devam eden koruma var mı */
            var korumaBitis = db.ExecuteScalar<DateTime?>(@"
SELECT deger FROM KRY_SISTEM_DURUM WHERE anahtar = 'ToplulukKorumaBitis'");

            if (korumaBitis is not null && korumaBitis > DateTime.Now)
            {
                return new Sonuc(true, 0,
                    $"Korumalı kip sürüyor ({korumaBitis:HH:mm}'e kadar)");
            }

            /* Son pencerede kaç başvuru geldi; incelemeye alınanlar dahil */
            var sayi = db.ExecuteScalar<int>(@"
SELECT
    (SELECT COUNT(*) FROM KRY_BASVURULAR
     WHERE olusturma > DATEADD(minute, -@dakika, SYSDATETIME()))
  + (SELECT COUNT(*) FROM KRY_AI_ENGELLENEN
     WHERE olusturma > DATEADD(minute, -@dakika, SYSDATETIME()))",
                new { dakika = Pencere });

            if (sayi < Esik) return new Sonuc(false, sayi, null);

            /* Eşik aşıldı: korumalı kip başlatılır */
            db.Execute(@"
MERGE KRY_SISTEM_DURUM AS h
USING (SELECT 'ToplulukKorumaBitis' AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN
    UPDATE SET deger = DATEADD(minute, @sure, SYSDATETIME()),
               metin = @metin
WHEN NOT MATCHED THEN
    INSERT (anahtar, deger, metin)
    VALUES ('ToplulukKorumaBitis',
            DATEADD(minute, @sure, SYSDATETIME()), @metin);",
                new
                {
                    sure = KorumaDakika,
                    metin = $"{sayi} başvuru / {Pencere} dakika"
                });

            _gunluk.Yaz("TOPLU GÖNDERİM", adres,
                $"{Pencere} dakikada {sayi} başvuru · korumalı kip "
                + $"{KorumaDakika} dakika açıldı");

            return new Sonuc(true, sayi,
                $"{Pencere} dakikada {sayi} başvuru geldi");
        }
        catch
        {
            /* Denetim yapılamazsa başvuru normal akışına devam eder */
            return new Sonuc(false, 0, null);
        }
    }

    /// <summary>Korumalı kipi elle kapatır.</summary>
    public void KorumayiKapat()
    {
        using var db = _vt.Baglanti();

        db.Execute(@"
UPDATE KRY_SISTEM_DURUM SET deger = SYSDATETIME()
WHERE anahtar = 'ToplulukKorumaBitis'");
    }

    /// <summary>Korumalı kip durumu; panelde göstermek için.</summary>
    public object Durum()
    {
        try
        {
            using var db = _vt.Baglanti();

            var kayit = db.QueryFirstOrDefault(@"
SELECT deger AS bitis, metin AS sebep
FROM KRY_SISTEM_DURUM WHERE anahtar = 'ToplulukKorumaBitis'");

            var bitis = kayit?.bitis as DateTime?;

            var sayi = db.ExecuteScalar<int>(@"
SELECT
    (SELECT COUNT(*) FROM KRY_BASVURULAR
     WHERE olusturma > DATEADD(minute, -@dakika, SYSDATETIME()))
  + (SELECT COUNT(*) FROM KRY_AI_ENGELLENEN
     WHERE olusturma > DATEADD(minute, -@dakika, SYSDATETIME()))",
                new { dakika = Pencere });

            return new
            {
                acik = Acik,
                pencereDakika = Pencere,
                esik = Esik,
                sonPencereBasvuru = sayi,
                korumaliKip = bitis is not null && bitis > DateTime.Now,
                korumaBitis = bitis,
                sebep = kayit?.sebep as string
            };
        }
        catch
        {
            return new { acik = Acik, hata = true };
        }
    }
}
