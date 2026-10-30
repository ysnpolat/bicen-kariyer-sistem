using System.Buffers.Binary;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// MP4/MOV "hızlı başlat" (28.10.2026).
///
/// <para>
/// Videonun dizini (moov kutusu) dosyanın sonundaysa telefon oynatmaya
/// başlamadan önce bütün dosyayı indirmek zorunda kalıyor: duyurudaki video
/// "yükleniyor"da bekliyordu. Bu sınıf moov kutusunu verinin (mdat) önüne
/// taşır ve parça adreslerini (stco/co64) kaydırır; video yeniden
/// kodlanmaz, görüntü ve ses aynen kalır. ffmpeg gerekmez.
/// </para>
///
/// <para>
/// Zaten hızlı başlayan ya da tanınmayan dosyalara dokunulmaz. Hata olursa
/// asıl dosya olduğu gibi kalır.
/// </para>
/// </summary>
public static class Mp4HizliBaslat
{
    private sealed record Kutu(string Tur, long Konum, long Boyut);

    /// <summary>
    /// Dosyayı gerekiyorsa düzenler. Dönüş: true = düzenlendi,
    /// false = gerek yoktu ya da yapılamadı.
    /// </summary>
    public static bool Duzenle(string yol, ILogger kayit = null)
    {
        var uzanti = Path.GetExtension(yol).ToLowerInvariant();
        if (uzanti is not (".mp4" or ".m4v" or ".mov")) return false;

        List<Kutu> kutular;
        try
        {
            kutular = UstKutular(yol);
        }
        catch (Exception h)
        {
            kayit?.LogWarning(h, "Video kutuları okunamadı: {Yol}", yol);
            return false;
        }
        if (kutular is null) return false;

        var moovSira = kutular.FindIndex(k => k.Tur == "moov");
        var ilkMdat = kutular.FindIndex(k => k.Tur == "mdat");
        if (moovSira < 0 || ilkMdat < 0) return false;

        /* moov zaten önde: iş yok */
        if (moovSira < ilkMdat) return false;

        /* moov iki mdat arasındaysa kaydırma hesabı farklılaşır; dokunma */
        if (kutular.Skip(moovSira + 1).Any(k => k.Tur == "mdat")) return false;

        var moovKutu = kutular[moovSira];
        if (moovKutu.Boyut > 200L * 1024 * 1024) return false;

        var gecici = yol + ".hizli";
        try
        {
            var orijinalZaman = File.GetLastWriteTimeUtc(yol);

            byte[] moov;
            using (var oku = new FileStream(yol, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                moov = new byte[moovKutu.Boyut];
                oku.Position = moovKutu.Konum;
                oku.ReadExactly(moov);

                if (!AdresleriKaydir(moov, 0, moov.Length, moovKutu.Boyut, ustKutu: true))
                    return false;

                using var yaz = new FileStream(gecici, FileMode.Create, FileAccess.Write);
                for (var i = 0; i < kutular.Count; i++)
                {
                    if (i == moovSira) continue;
                    if (i == ilkMdat) yaz.Write(moov);
                    Kopyala(oku, yaz, kutular[i].Konum, kutular[i].Boyut);
                }
            }

            if (new FileInfo(gecici).Length != new FileInfo(yol).Length)
            {
                File.Delete(gecici);
                return false;
            }

            File.Move(gecici, yol, overwrite: true);
            File.SetLastWriteTimeUtc(yol, orijinalZaman);
            kayit?.LogInformation("Video hızlı başlatmaya çevrildi: {Yol}", yol);
            return true;
        }
        catch (Exception h)
        {
            kayit?.LogWarning(h, "Video hızlı başlatmaya çevrilemedi: {Yol}", yol);
            try { if (File.Exists(gecici)) File.Delete(gecici); } catch { /* yok sayılır */ }
            return false;
        }
    }

    /// <summary>Dosyanın en üst düzey kutuları; yapı bozuksa null</summary>
    private static List<Kutu> UstKutular(string yol)
    {
        var liste = new List<Kutu>();
        using var f = new FileStream(yol, FileMode.Open, FileAccess.Read, FileShare.Read);
        var uzunluk = f.Length;
        var bas = new byte[16];
        long konum = 0;

        while (konum < uzunluk)
        {
            if (uzunluk - konum < 8) return null;
            f.Position = konum;
            f.ReadExactly(bas, 0, 8);

            long boyut = BinaryPrimitives.ReadUInt32BigEndian(bas.AsSpan(0, 4));
            var tur = System.Text.Encoding.ASCII.GetString(bas, 4, 4);

            if (boyut == 1)
            {
                if (uzunluk - konum < 16) return null;
                f.ReadExactly(bas, 8, 8);
                boyut = (long)BinaryPrimitives.ReadUInt64BigEndian(bas.AsSpan(8, 8));
            }
            else if (boyut == 0)
            {
                boyut = uzunluk - konum;
            }

            if (boyut < 8 || konum + boyut > uzunluk) return null;

            liste.Add(new Kutu(tur, konum, boyut));
            konum += boyut;
        }

        return liste;
    }

    private static readonly HashSet<string> Kaplar = new() { "moov", "trak", "mdia", "minf", "stbl", "edts", "dinf" };

    /// <summary>
    /// moov içindeki bütün stco/co64 adreslerine <paramref name="fark"/>
    /// ekler. 32 bitlik adres taşarsa false (dosyaya dokunulmaz).
    /// </summary>
    private static bool AdresleriKaydir(byte[] v, int bas, int son, long fark, bool ustKutu)
    {
        var i = bas;
        if (ustKutu) i += 8; // moov başlığı

        while (i + 8 <= son)
        {
            long boyut = BinaryPrimitives.ReadUInt32BigEndian(v.AsSpan(i, 4));
            var tur = System.Text.Encoding.ASCII.GetString(v, i + 4, 4);
            var baslik = 8;

            if (boyut == 1)
            {
                if (i + 16 > son) return false;
                boyut = (long)BinaryPrimitives.ReadUInt64BigEndian(v.AsSpan(i + 8, 8));
                baslik = 16;
            }
            else if (boyut == 0)
            {
                boyut = son - i;
            }

            if (boyut < baslik || i + boyut > son) return false;
            var kutuSon = (int)(i + boyut);

            if (Kaplar.Contains(tur))
            {
                if (!AdresleriKaydir(v, i + baslik, kutuSon, fark, ustKutu: false)) return false;
            }
            else if (tur == "stco")
            {
                var j = i + baslik + 4;
                var adet = BinaryPrimitives.ReadUInt32BigEndian(v.AsSpan(j, 4));
                j += 4;
                if (j + (long)adet * 4 > kutuSon) return false;
                for (var n = 0; n < adet; n++, j += 4)
                {
                    var yeni = BinaryPrimitives.ReadUInt32BigEndian(v.AsSpan(j, 4)) + fark;
                    if (yeni > uint.MaxValue) return false;
                    BinaryPrimitives.WriteUInt32BigEndian(v.AsSpan(j, 4), (uint)yeni);
                }
            }
            else if (tur == "co64")
            {
                var j = i + baslik + 4;
                var adet = BinaryPrimitives.ReadUInt32BigEndian(v.AsSpan(j, 4));
                j += 4;
                if (j + (long)adet * 8 > kutuSon) return false;
                for (var n = 0; n < adet; n++, j += 8)
                {
                    var yeni = BinaryPrimitives.ReadUInt64BigEndian(v.AsSpan(j, 8)) + (ulong)fark;
                    BinaryPrimitives.WriteUInt64BigEndian(v.AsSpan(j, 8), yeni);
                }
            }

            i = kutuSon;
        }

        return true;
    }

    private static void Kopyala(Stream oku, Stream yaz, long konum, long boyut)
    {
        oku.Position = konum;
        var tampon = new byte[1024 * 1024];
        var kalan = boyut;
        while (kalan > 0)
        {
            var n = oku.Read(tampon, 0, (int)Math.Min(tampon.Length, kalan));
            if (n <= 0) throw new EndOfStreamException();
            yaz.Write(tampon, 0, n);
            kalan -= n;
        }
    }
}
