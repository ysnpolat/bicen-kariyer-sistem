using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Ekibim görünürlüğü (09.10.2026).
///
/// <para>
/// İK panelinden kişi kişi: Biçen360 Ekibim ekranında kimleri görsün
/// (otomatik listeye eklenen kişi ve şubeler, gizlenen kişiler ya da
/// yalnızca seçilenler), ekibinin ayrıntısını açabilsin mi, puantaj
/// çizelgesini ve vardiya planını görsün mü.
/// </para>
///
/// <para>
/// İzin, avans onay akışları ve onay tabloları değişmiyor. "İşlem" açıksa
/// eklenen kişilere fazla mesai girer ve rotasyon talebi açar
/// (EkipServisi.IslemYapabilir). Eklenen kişinin vardiya planı da bu kişiye
/// geçmiyor; planı kendi yöneticisi yapıyor.
/// </para>
/// </summary>
public sealed class EkibimKurallari
{
    public const string Anahtar = "EKIBIM_KURAL";

    public sealed class Kural
    {
        public string Sicil { get; set; }
        public List<string> EkKisiler { get; set; } = new();
        public List<string> EkSubeler { get; set; } = new();
        public List<string> Gizlenenler { get; set; } = new();

        /// <summary>Otomatik liste yok sayılır; yalnızca eklenen kişi ve şubeler</summary>
        public bool YalnizSecilenler { get; set; }

        /// <summary>Eklenen kişilerin ayrıntısını (izin, puantaj takvimi) açabilir</summary>
        public bool Ayrinti { get; set; } = true;

        /// <summary>Puantaj çizelgesinde ekibini görür (kapalıysa yalnızca kendi)</summary>
        public bool Puantaj { get; set; } = true;

        /// <summary>Vardiya planında ekibini görür (kapalıysa yalnızca kendi planı)</summary>
        public bool VardiyaPlani { get; set; } = true;

        /// <summary>
        /// Eklenen kişiler için işlem (09.10.2026): fazla mesai girer,
        /// rotasyon talebi açar, hatırlatma gönderir. Giren yönetici fazla
        /// mesaide 1. onay sayılır; üst yönetici ve İK aşaması kişinin kendi
        /// organizasyonundan gelir. İzin onayı bundan etkilenmez.
        /// </summary>
        public bool Islem { get; set; } = true;

        public string Guncelleyen { get; set; }
        public DateTime? Guncelleme { get; set; }
    }

    private static readonly JsonSerializerOptions Js = new(JsonSerializerDefaults.Web);

    private readonly VeritabaniServisi _vt;
    private List<Kural> _onbellek;
    private DateTime _okunma = DateTime.MinValue;
    private readonly object _kilit = new();

    public EkibimKurallari(VeritabaniServisi vt) => _vt = vt;

    public static string K(string s) => (s ?? "").Trim().TrimStart('0');

    public List<Kural> Tumu()
    {
        if (_onbellek is not null && DateTime.Now - _okunma < TimeSpan.FromSeconds(30)) return _onbellek;

        lock (_kilit)
        {
            try
            {
                using var db = _vt.Baglanti();
                var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = Anahtar });
                _onbellek = string.IsNullOrWhiteSpace(ham) ? new() : JsonSerializer.Deserialize<List<Kural>>(ham, Js) ?? new();
            }
            catch
            {
                _onbellek ??= new();
            }

            _okunma = DateTime.Now;
            return _onbellek;
        }
    }

    public Kural Bul(string sicil) =>
        string.IsNullOrWhiteSpace(sicil) ? null : Tumu().FirstOrDefault(x => K(x.Sicil) == K(sicil));

    public void Yaz(List<Kural> kurallar)
    {
        using var db = _vt.Baglanti();
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = Anahtar, d = JsonSerializer.Serialize(kurallar, Js) });

        _okunma = DateTime.MinValue;
    }

    /// <summary>Kurala göre eklenen kişiler (kişi ve şube eklemeleri, kendisi hariç)</summary>
    public List<PersonelKaydi> Eklenenler(Kural k, PersonelKaydi ben, IEnumerable<PersonelKaydi> aktifler)
    {
        if (k is null) return new();

        var kisiler = k.EkKisiler.Select(K).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var subeler = k.EkSubeler.Select(x => x.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var benK = K(ben?.PersonelKodu);

        return aktifler
            .Where(x => K(x.PersonelKodu) != benK
                        && (kisiler.Contains(K(x.PersonelKodu)) || subeler.Contains((x.IsGrubu ?? "").Trim())))
            .ToList();
    }

    /// <summary>
    /// Ekibim listesine kuralı uygular: otomatik liste (yalnız seçilenlerde
    /// boş) + eklenenler − gizlenenler. Kural yoksa liste aynen döner.
    /// </summary>
    public List<PersonelKaydi> Uygula(Kural k, PersonelKaydi ben, List<PersonelKaydi> varsayilan, IEnumerable<PersonelKaydi> aktifler)
    {
        if (k is null) return varsayilan;

        var gizli = k.Gizlenenler.Select(K).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var sonuc = (k.YalnizSecilenler ? new List<PersonelKaydi>() : varsayilan.ToList());
        var var_ = sonuc.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var p in Eklenenler(k, ben, aktifler))
            if (var_.Add(K(p.PersonelKodu))) sonuc.Add(p);

        return sonuc.Where(x => !gizli.Contains(K(x.PersonelKodu))).ToList();
    }

    /// <summary>Bu kişi kuraldan dolayı Ekibim'de gizli mi</summary>
    public bool Gizli(Kural k, PersonelKaydi hedef) =>
        k is not null && hedef is not null && k.Gizlenenler.Any(x => K(x) == K(hedef.PersonelKodu));

    /// <summary>Kuraldan eklenmiş ve işlem yapabilir mi (fazla mesai, rotasyon, hatırlatma)</summary>
    public bool EkIslem(PersonelKaydi ben, PersonelKaydi hedef, IEnumerable<PersonelKaydi> aktifler)
    {
        if (ben is null || hedef is null || K(ben.PersonelKodu) == K(hedef.PersonelKodu)) return false;
        var k = Bul(ben.PersonelKodu);
        return k is not null && k.Islem && !Gizli(k, hedef)
               && Eklenenler(k, ben, aktifler).Any(x => K(x.PersonelKodu) == K(hedef.PersonelKodu));
    }

    /// <summary>Kuraldan eklenmiş ve ayrıntısı açık mı (yalnızca görüntüleme uçları)</summary>
    public bool EkAyrinti(Kural k, PersonelKaydi ben, PersonelKaydi hedef, IEnumerable<PersonelKaydi> aktifler) =>
        k is not null && k.Ayrinti && hedef is not null && !Gizli(k, hedef)
        && Eklenenler(k, ben, aktifler).Any(x => K(x.PersonelKodu) == K(hedef.PersonelKodu));
}
