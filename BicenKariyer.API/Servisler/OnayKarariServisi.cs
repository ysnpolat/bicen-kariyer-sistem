using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Onay isteğini (işe alım, norm kadro, rotasyon) sonuçlandırır.
///
/// <para>
/// Kod 03.10.2026'ya kadar <c>BasvuruController.OnayKarari</c> içindeydi ve
/// oradan birebir taşındı. Taşınmasının sebebi Biçen360 patron görünümü:
/// patronun mobilden verdiği kararın panelde genel müdür yardımcısının
/// verdiği kararla <b>aynı</b> sonucu doğurması gerekiyor (başvuru durumu,
/// hareket kaydı, kadro güncellemesi, isteyene bildirim). Aynı kodu iki
/// yerde tutmak, birinde yapılan düzeltmenin diğerinde unutulması demekti;
/// controller'ı sahte bir kullanıcıyla dışarıdan çağırmak ise yetki
/// denetimini ve kimliği kurgulamak anlamına geliyordu.
/// </para>
///
/// <para>
/// Yetki denetimi burada YOK: çağıran yapar (panelde onay yetkisi, mobilde
/// patron listesi). Kararı verenin kim olduğu <c>kullanici</c> ve
/// <c>kullaniciAdSoyad</c> ile gelir; panel kullanıcı adını ve ad soyadı,
/// patron görünümü "Ad Soyad (Biçen360)" imzasını verir.
/// </para>
/// </summary>
public static class OnayKarariServisi
{
    /// <summary>
    /// Sonuç: <see cref="Kod"/> 200 başarılı, 400 geçersiz istek, 404 kayıt
    /// yok. <see cref="Hata"/> yalnızca başarısızlıkta dolu.
    /// </summary>
    public sealed record Sonuc(int Kod, string Hata, bool Onaylandi);

    /// <param name="not">Karar notu; reddederken zorunlu.</param>
    public static Sonuc Uygula(
        VeritabaniServisi vt, int onayId, bool onaylandi, string not,
        string kullanici, string kullaniciAdSoyad)
    {
        using var db = vt.Baglanti();

        var onay = db.QuerySingleOrDefault(@"
SELECT id, tur, baslik, veri_json, basvuru_id, durum
FROM KRY_ONAY WHERE id = @onayId", new { onayId });

        if (onay is null) return new Sonuc(404, "Onay kaydı bulunamadı.", onaylandi);

        /* Yanıt bekleyen istekte de karar verilebilir (21.10.2026): yanıtlanan
           istek yeniden gönderilmeyince başvuru haftalarca "Onay Bekliyor"da
           kalıyor, onay listesinde de görünmüyordu. */
        if ((string)onay.durum != OnayDurumu.Bekliyor && (string)onay.durum != OnayDurumu.YanitBekliyor)
            return new Sonuc(400, "Bu istek zaten sonuçlandırılmış.", onaylandi);

        if (!onaylandi && string.IsNullOrWhiteSpace(not))
            return new Sonuc(400, "Reddetme sebebini yazınız.", onaylandi);

        var tur = (string)onay.tur;
        int? basvuruId = onay.basvuru_id as int?;

        /* İsteği açan İK uzmanına bildirim gönderilir: kararı beklemek
           yerine sonucu öğrenmesi gerekir. İsteyen bilgisi onay kaydında
           tutulur. */
        var isteyen = db.ExecuteScalar<string>(
            "SELECT isteyen FROM KRY_ONAY WHERE id = @onayId", new { onayId });

        /* Durum yazılırken yeniden denetleniyor (03.10.2026): patron
           Biçen360'tan, GMY panelden aynı anda karar verirse ikinci karar
           da uygulanıp başvuruyu iki kez işliyordu. Yalnızca hâlâ
           bekleyen kayıt güncellenir; güncellenemediyse karar başkasının. */
        var yazilan = db.Execute(@"
UPDATE KRY_ONAY
SET durum = @durum, onaylayan = @kullanici,
    onay_tarihi = SYSDATETIME(), onay_notu = @not
WHERE id = @onayId AND durum IN (@bekliyor, @yanit)",
            new
            {
                onayId,
                durum = onaylandi ? OnayDurumu.Onaylandi : OnayDurumu.Reddedildi,
                kullanici,
                not = not?.Trim(),
                bekliyor = OnayDurumu.Bekliyor,
                yanit = OnayDurumu.YanitBekliyor
            });

        if (yazilan == 0)
            return new Sonuc(409, "Bu istek az önce başka biri tarafından sonuçlandırıldı.", onaylandi);

        /* ------------------------------------------------ işe alım onayı */
        if (tur == OnayTuru.IseAlim && basvuruId is not null)
        {
            var yeniDurum = onaylandi ? Durumlar.IseAlindi : Durumlar.EvrakHazirlaniyor;

            db.Execute(@"
UPDATE KRY_BASVURULAR
SET durum = @durum, onay_durumu = @onayDurumu, onaylayan = @kullanici,
    onay_tarihi = SYSDATETIME(), onay_notu = @not, guncelleme = SYSDATETIME()
WHERE id = @id",
                new
                {
                    id = basvuruId,
                    durum = yeniDurum,
                    onayDurumu = onaylandi ? "Onaylandı" : "Reddedildi",
                    kullanici,
                    not = not?.Trim()
                });

            var aciklama = onaylandi
                ? $"İşe alım onaylandı · {kullaniciAdSoyad}"
                  + (string.IsNullOrWhiteSpace(not) ? "" : $" · {not.Trim()}")
                : $"İşe alım reddedildi · {kullaniciAdSoyad} · {not.Trim()}";

            db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
                new { id = basvuruId, durum = yeniDurum, aciklama, kullanici });

            /* Mikro sicil kartı (09.10.2026): İşe Al'da istendiyse onayla
               açılır; reddedilirse istek kapanır. Hata onayı durdurmaz. */
            if (onaylandi)
                MikroSicilServisi.OnaydaAc(vt, basvuruId.Value, kullaniciAdSoyad ?? kullanici);
            else
                new MikroSicilServisi(vt).Kapat(db, basvuruId.Value, "İşe alım reddedildi.");
        }

        /* ------------------------------------------------- rotasyon onayı */
        else if (tur == OnayTuru.Rotasyon && basvuruId is not null && !onaylandi)
        {
            /* Reddedilirse aday eski birimine döndürülür */
            var veri = JsonDocument.Parse((string)onay.veri_json).RootElement;

            var eskiKod = veri.TryGetProperty("eskiSubeKodu", out var k) ? k.GetString() : null;
            var eskiAd = veri.TryGetProperty("eskiSubeAdi", out var a) ? a.GetString() : null;

            if (!string.IsNullOrWhiteSpace(eskiKod))
            {
                db.Execute(@"
UPDATE KRY_BASVURULAR
SET sube_kodu = @kod, sube_adi = @ad, guncelleme = SYSDATETIME()
WHERE id = @id", new { id = basvuruId, kod = eskiKod, ad = eskiAd });

                db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
SELECT @id, durum, @aciklama, @kullanici FROM KRY_BASVURULAR WHERE id = @id",
                    new
                    {
                        id = basvuruId,
                        aciklama = $"Rotasyon reddedildi, birim geri alındı · {kullaniciAdSoyad} · {not.Trim()}",
                        kullanici
                    });
            }
        }

        /* ----------------------------------------------- norm kadro onayı */
        else if (tur == OnayTuru.NormKadro)
        {
            var veri = JsonDocument.Parse((string)onay.veri_json).RootElement;

            /* Yeni akış: değişiklikler onay beklerken UYGULANMAMIŞ olur,
               onay verilince yazılır. Reddedilirse hiçbir şey yapılmaz,
               norm zaten değişmemiştir. */
            if (onaylandi &&
                veri.TryGetProperty("degisiklikler", out var dizi) &&
                dizi.ValueKind == JsonValueKind.Array)
            {
                foreach (var d in dizi.EnumerateArray())
                {
                    var bolum = d.TryGetProperty("bolum", out var b) ? b.GetString() : null;

                    if (string.IsNullOrWhiteSpace(bolum)) continue;

                    var subeKodu = d.TryGetProperty("subeKodu", out var sk)
                                   && sk.ValueKind == JsonValueKind.String
                        ? sk.GetString() : null;

                    var yeniNorm = d.TryGetProperty("yeniNorm", out var yn)
                        ? yn.GetDecimal() : 0;

                    var subeAdi = d.TryGetProperty("subeAdi", out var sa)
                                  && sa.ValueKind == JsonValueKind.String
                        ? sa.GetString() : null;

                    var etkilenen = db.Execute(@"
UPDATE KRY_KADRO
SET norm = @norm,
    hedef = CASE WHEN @norm > ISNULL(mevcut, 0)
                 THEN @norm - ISNULL(mevcut, 0) ELSE 0 END
WHERE bolum = @bolum AND ISNULL(sube_kodu, '') = ISNULL(@subeKodu, '')",
                        new { bolum = bolum.Trim(), subeKodu, norm = yeniNorm });

                    /* Kadro satırı yoksa açılır: onaylanan norm bir yere
                       yazılmalı, sessizce kaybolmamalı. */
                    if (etkilenen == 0)
                        db.Execute(@"
INSERT INTO KRY_KADRO (bolum, sube_kodu, sube_adi, norm, mevcut, hedef, engelli, aktif)
VALUES (@bolum, @subeKodu, @subeAdi, @norm, 0, @norm, 0, 1)",
                            new { bolum = bolum.Trim(), subeKodu, subeAdi, norm = yeniNorm });
                }
            }
        }

        /* Bildirim: isteği açan uzman sonucu ekranında görür. Kendi
           kararını kendine bildirmeyiz. */
        if (!string.IsNullOrWhiteSpace(isteyen) &&
            !string.Equals(isteyen, kullanici, StringComparison.OrdinalIgnoreCase))
        {
            var baslik = onaylandi
                ? $"{(string)onay.baslik} · ONAYLANDI"
                : $"{(string)onay.baslik} · REDDEDİLDİ";

            /* Onay türüne göre sonucun ne anlama geldiği yazılır: uzman
               "onaylandı" bilgisinden sonra ne olduğunu da bilmeli. */
            var sonuc = tur switch
            {
                OnayTuru.NormKadro when onaylandi => "Norm kadro güncellendi.",
                OnayTuru.NormKadro => "Norm kadro değişmedi.",
                OnayTuru.IseAlim when onaylandi => "İşe alım tamamlandı.",
                OnayTuru.IseAlim => "Aday evrak aşamasına geri alındı.",
                OnayTuru.Rotasyon when onaylandi => "Rotasyon uygulandı.",
                OnayTuru.Rotasyon => "Rotasyon yapılmadı.",
                _ => null
            };

            var metin = (onaylandi
                ? $"{kullaniciAdSoyad} onayladı."
                  + (string.IsNullOrWhiteSpace(not) ? "" : $" Not: {not.Trim()}")
                : $"{kullaniciAdSoyad} reddetti. Sebep: {not?.Trim()}")
                + (sonuc is null ? "" : $" {sonuc}");

            db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin, basvuru_id)
VALUES (@kullanici, @tur, @baslik, @metin, @basvuruId)",
                new
                {
                    kullanici = isteyen,
                    tur = onaylandi ? "OnayOnaylandi" : "OnayReddedildi",
                    baslik,
                    metin,
                    basvuruId
                });
        }

        return new Sonuc(200, null, onaylandi);
    }
}
