namespace BicenKariyer.API.Servisler;

/// <summary>
/// Rol bazlı yetkilerin uygulanması.
///
/// <para>
/// <b>Neden sunucuda:</b> panelde bir alanı gizlemek güvenlik sağlamaz.
/// Tarayıcının ağ sekmesine bakan biri gizlenen maaşı da kimlik numarasını
/// da olduğu gibi görür. Bu yüzden maskeleme veriyi göndermeden önce
/// burada yapılır; panel yalnızca sunucudan geleni gösterebilir.
/// </para>
///
/// <para>
/// Ayarda bir rol için kayıt yoksa koddaki varsayılan kurallar geçerlidir.
/// Yanlış bir ayar sistemi kilitlememeli.
/// </para>
/// </summary>
public class YetkiServisi
{
    private readonly AyarServisi _ayar;

    public YetkiServisi(AyarServisi ayar) => _ayar = ayar;

    /* Alan adları; panel ve sunucu aynı anahtarları kullanır */
    public const string Kimlik = "kimlik";
    public const string Ucret = "ucret";
    public const string Adres = "adres";
    public const string Telefon = "telefon";
    public const string DogumTarihi = "dogumTarihi";

    /// <summary>Rolün ayarı; tanımlı değilse null.</summary>
    public RolYetkisi Oku(string rol)
    {
        if (string.IsNullOrWhiteSpace(rol)) return null;

        var ayar = _ayar.FormOku();

        return (ayar.RolYetkileri ?? new Dictionary<string, RolYetkisi>())
            .TryGetValue(rol, out var yetki) ? yetki : null;
    }

    /// <summary>
    /// Bu alan bu rolden gizli mi.
    ///
    /// Ayar yoksa koddaki varsayılana düşülür: bölge müdürü ve
    /// koordinatör özel veri göremez.
    /// </summary>
    public bool Gizli(string rol, string alan)
    {
        var yetki = Oku(rol);

        if (yetki is not null)
            return yetki.GizliAlanlar?.Contains(alan) == true;

        /* Varsayılan: özel veri görmeyen roller için kimlik, ücret ve
           adres gizli. Telefon açık — İK dışı roller de arayabilmeli. */
        if (!Roller.OzelVeriGorme(rol))
            return alan is Kimlik or Ucret or Adres;

        return false;
    }

    /// <summary>Rol yalnızca görüntüleyebiliyor mu.</summary>
    public bool SaltOkunur(string rol) => Oku(rol)?.SaltOkunur == true;

    /// <summary>
    /// Menü bu role açık mı. Liste boşsa hepsi açıktır.
    ///
    /// <para>
    /// Özet her koşulda açık: panelin giriş sayfası orası ve kısıtlama
    /// yapılan bir rol, listede Özet işaretlenmediği için hiçbir sayfası
    /// olmayan bir panele düşüyordu.
    /// </para>
    /// </summary>
    public bool MenuAcik(string rol, string menu)
    {
        if (string.Equals(menu, "ozet", StringComparison.OrdinalIgnoreCase))
            return true;

        var yetki = Oku(rol);

        if (yetki?.Menuler is null || yetki.Menuler.Count == 0) return true;

        return yetki.Menuler.Contains(menu);
    }

    /// <summary>Sekme bu role açık mı.</summary>
    public bool SekmeAcik(string rol, string sekme) =>
        Oku(rol)?.GizliSekmeler?.Contains(sekme) != true;

    /* ==================================================================== */
    /* Maskeleme                                                            */
    /* ==================================================================== */

    /// <summary>
    /// Kimlik numarası: son dört hane bırakılır. Tamamen silmek yerine
    /// kırpmak, kayıt eşleştirmesi gerektiğinde işe yarıyor.
    /// </summary>
    public string KimlikMaskele(string rol, string deger)
    {
        if (!Gizli(rol, Kimlik) || string.IsNullOrWhiteSpace(deger))
            return deger;

        var t = deger.Trim();

        return t.Length <= 4 ? "•••" : new string('•', t.Length - 4) + t[^4..];
    }

    /// <summary>Ücret tamamen gizlenir; kısmi gösterim anlamsız.</summary>
    public string UcretMaskele(string rol, string deger) =>
        Gizli(rol, Ucret) ? null : deger;

    /// <summary>
    /// Adres: semt görünür, sokak ve numara gizlenir.
    ///
    /// Bölge müdürünün adayın hangi semtte oturduğunu bilmesi işe yarar
    /// (servis, ulaşım, şubeye yakınlık); tam adresi bilmesi gerekmez.
    /// Türkçe adres yazımında ilk bölümler mahalle ve semt olduğu için
    /// baştan iki parça bırakılır.
    /// </summary>
    public string AdresMaskele(string rol, string deger)
    {
        if (!Gizli(rol, Adres) || string.IsNullOrWhiteSpace(deger))
            return deger;

        var parcalar = deger
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

        if (parcalar.Count <= 2) return deger;

        /* Sondan iki parça genelde ilçe ve il; onlar kalsın.
           Ortadaki sokak ve numara gizlenir. */
        var bas = parcalar.First();
        var son = string.Join(", ", parcalar.TakeLast(2));

        return $"{bas} · … · {son}";
    }

    /// <summary>Telefon: son dört hane.</summary>
    public string TelefonMaskele(string rol, string deger)
    {
        if (!Gizli(rol, Telefon) || string.IsNullOrWhiteSpace(deger))
            return deger;

        var t = deger.Trim();

        return t.Length <= 4 ? "•••" : new string('•', t.Length - 4) + t[^4..];
    }
}
