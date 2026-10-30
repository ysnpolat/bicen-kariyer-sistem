/*
 * Biçen Tarayıcı Köprüsü
 * ===========================================================================
 * İK panelindeki "Tara" düğmesinin bilgisayara bağlı tarayıcıyı (ya da
 * taramalı yazıcıyı) kullanabilmesi için küçük, görünmez bir yardımcı.
 *
 * Neden gerekli: tarayıcıdaki bir web sayfası güvenlik gereği bilgisayara
 * bağlı cihazlara doğrudan erişemez. Bu program yalnızca bu bilgisayarın
 * içinden (127.0.0.1:47115) ulaşılabilen bir adres açar; panel taramayı bu
 * adrese yaptırır, sonucu PDF olarak alır ve yükleme alanına ekler.
 *
 * Güvenlik:
 *  - Yalnızca 127.0.0.1 / ::1 dinlenir; ağdaki başka bir bilgisayar
 *    bağlanamaz.
 *  - Tarama isteği yalnızca izinli-adresler.txt dosyasındaki sitelerden
 *    (varsayılan: https://kariyer.bicen.com.tr) kabul edilir. Başka bir web
 *    sitesi taramayı başlatamaz ve sonucu okuyamaz.
 *  - Taranan belge diske yazılmaz, günlüğe içerik yazılmaz.
 *
 * Kurulum: kur.bat (yönetici yetkisi gerekmez). Windows'un kendi .NET
 * Framework 4 derleyicisiyle bu dosyadan BicenTarayici.exe üretilir, oturum
 * açılışında kendiliğinden çalışacak şekilde kaydedilir.
 *
 * Tarama iki yoldan yapılır:
 *  - Windows Görüntü Alma (WIA): tarayıcının Windows sürücüsü kurulu
 *    olmalıdır (Windows Faks ve Tarama'da görünen her cihaz).
 *  - Ağ tarayıcısı (eSCL / AirScan, 1.1): sürücü gerekmez; çok fonksiyonlu
 *    yazıcının IP adresi ag-tarayicilar.txt dosyasına yazılır (kur.bat
 *    sorar ya da paneldeki tarama ayarlarından eklenir). 2016 sonrası
 *    Canon, HP, Epson, Brother, Kyocera, Ricoh, Xerox cihazlarının çoğu
 *    bunu destekler.
 *
 * Bu dosya C# 5 ile yazıldı: Windows'ta hazır gelen derleyici (csc 4.x)
 * daha yeni dil özelliklerini tanımıyor.
 */

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Xml;

namespace BicenTarayici
{
    /// <summary>Kullanıcıya gösterilecek açıklamayla birlikte hata</summary>
    class KopruHatasi : Exception
    {
        public int Durum;

        public KopruHatasi(int durum, string mesaj) : base(mesaj)
        {
            Durum = durum;
        }
    }

    class Istek
    {
        public string Yontem = "";
        public string Yol = "";
        public Dictionary<string, string> Sorgu = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, string> Basliklar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public string Baslik(string ad)
        {
            string d;
            return Basliklar.TryGetValue(ad, out d) ? d : null;
        }

        public string Deger(string ad, string varsayilan)
        {
            string d;
            return Sorgu.TryGetValue(ad, out d) && d.Length > 0 ? d : varsayilan;
        }
    }

    static class Program
    {
        public const string Surum = "1.2.0";
        public const int Port = 47115;

        /* WIA biçim kimlikleri */
        const string JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}";
        const string BMP = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}";

        /* WIA özellik numaraları */
        const int DIP_AD = 7;
        const int DPS_BELGE_YETENEK = 3086;   // 1 besleyici, 2 cam, 4 çift yüz
        const int DPS_BELGE_DURUM = 3087;     // 1 besleyicide kağıt var
        const int DPS_BELGE_SECIM = 3088;     // 1 besleyici, 2 cam
        const int DPS_SAYFA = 3096;
        const int DPS_SAYFA_BOYUTU = 3097;    // 0 = A4
        const int IPA_VERI_TURU = 4103;       // 0 siyah-beyaz, 2 gri, 3 renkli
        const int IPA_DERINLIK = 4104;
        const int IPS_NIYET = 6146;           // 1 renkli, 2 gri, 4 metin
        const int IPS_YATAY_COZ = 6147;
        const int IPS_DIKEY_COZ = 6148;
        const int IPS_X_KONUM = 6149;
        const int IPS_Y_KONUM = 6150;
        const int IPS_X_UZUNLUK = 6151;
        const int IPS_Y_UZUNLUK = 6152;

        const uint KAGIT_YOK = 0x80210003;

        static string klasor;
        static string denemeKlasoru;
        static List<string> izinliAdresler = new List<string>();
        static readonly object taramaKilidi = new object();
        static readonly object gunlukKilidi = new object();

        [STAThread]
        static void Main(string[] args)
        {
            klasor = AppDomain.CurrentDomain.BaseDirectory;

            for (int i = 0; i < args.Length; i++)
                if (args[i] == "--deneme" && i + 1 < args.Length)
                    denemeKlasoru = args[i + 1];

            bool yeni;
            Mutex tekKopya = new Mutex(true, "Local\\BicenTarayiciKoprusu", out yeni);
            if (!yeni)
                return;

            AdresleriOku();
            AgOku();
            AgGuvenlik();

            TcpListener dort = new TcpListener(IPAddress.Loopback, Port);
            try
            {
                dort.Start();
            }
            catch (SocketException e)
            {
                Gunluk("Port " + Port + " açılamadı: " + e.Message);
                return;
            }

            try
            {
                TcpListener alti = new TcpListener(IPAddress.IPv6Loopback, Port);
                alti.Start();
                Thread t = new Thread(() => Dinle(alti));
                t.IsBackground = true;
                t.Start();
            }
            catch (Exception)
            {
                /* IPv6 kapalı olabilir; panel 127.0.0.1 kullanıyor */
            }

            Gunluk("Başladı · sürüm " + Surum + (denemeKlasoru != null ? " · deneme kipi" : ""));
            Dinle(dort);
            GC.KeepAlive(tekKopya);
        }

        static void Dinle(TcpListener dinleyici)
        {
            while (true)
            {
                TcpClient istemci;
                try
                {
                    istemci = dinleyici.AcceptTcpClient();
                }
                catch (Exception)
                {
                    Thread.Sleep(200);
                    continue;
                }

                ThreadPool.QueueUserWorkItem(Isle, istemci);
            }
        }

        /* ================================================================ */
        /* Ayarlar ve günlük                                                */
        /* ================================================================ */

        static void AdresleriOku()
        {
            string dosya = Path.Combine(klasor, "izinli-adresler.txt");
            List<string> l = new List<string>();

            try
            {
                if (File.Exists(dosya))
                    foreach (string satir in File.ReadAllLines(dosya, Encoding.UTF8))
                    {
                        string s = satir.Trim().TrimEnd('/');
                        if (s.Length > 0 && !s.StartsWith("#"))
                            l.Add(s.ToLowerInvariant());
                    }
            }
            catch (Exception e)
            {
                Gunluk("izinli-adresler.txt okunamadı: " + e.Message);
            }

            if (l.Count == 0)
            {
                l.Add("https://kariyer.bicen.com.tr");
                l.Add("http://localhost:5173");
                l.Add("http://127.0.0.1:5173");
            }

            izinliAdresler = l;
        }

        static bool AdresIzinli(string kaynak)
        {
            string k = kaynak.Trim().TrimEnd('/').ToLowerInvariant();

            foreach (string a in izinliAdresler)
            {
                if (a == k)
                    return true;

                /* https://*.ornek.com.tr biçimi: alt alan adları */
                int y = a.IndexOf("://*.", StringComparison.Ordinal);
                if (y > 0)
                {
                    string sema = a.Substring(0, y + 3);
                    string kok = a.Substring(y + 4);
                    if (k.StartsWith(sema, StringComparison.Ordinal) && k.EndsWith(kok, StringComparison.Ordinal))
                        return true;
                }
            }

            return false;
        }

        static string Kisalt(string s, int n)
        {
            s = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            return s.Length > n ? s.Substring(0, n) + "…" : s;
        }

        static void Gunluk(string metin)
        {
            try
            {
                lock (gunlukKilidi)
                {
                    string dosya = Path.Combine(klasor, "gunluk.txt");
                    FileInfo f = new FileInfo(dosya);
                    if (f.Exists && f.Length > 512 * 1024)
                        File.Delete(dosya);

                    File.AppendAllText(dosya, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + metin + "\r\n", Encoding.UTF8);
                }
            }
            catch (Exception)
            {
                /* günlük yazılamazsa çalışmayı engellemez */
            }
        }

        /* ================================================================ */
        /* HTTP                                                             */
        /* ================================================================ */

        static void Isle(object o)
        {
            TcpClient istemci = (TcpClient)o;

            try
            {
                istemci.ReceiveTimeout = 15000;
                istemci.SendTimeout = 60000;
                NetworkStream akis = istemci.GetStream();

                Istek istek = IstekOku(akis);
                if (istek != null)
                    Yonlendir(akis, istek);
            }
            catch (Exception e)
            {
                Gunluk("Bağlantı hatası: " + e.Message);
            }
            finally
            {
                try
                {
                    istemci.Close();
                }
                catch (Exception)
                {
                }
            }
        }

        static Istek IstekOku(NetworkStream akis)
        {
            byte[] tampon = new byte[32 * 1024];
            int dolu = 0;
            int son = -1;

            while (son < 0)
            {
                if (dolu >= tampon.Length)
                    return null;

                int n = akis.Read(tampon, dolu, tampon.Length - dolu);
                if (n <= 0)
                    return null;

                dolu += n;

                for (int i = 3; i < dolu; i++)
                    if (tampon[i - 3] == 13 && tampon[i - 2] == 10 && tampon[i - 1] == 13 && tampon[i] == 10)
                    {
                        son = i + 1;
                        break;
                    }
            }

            string ust = Encoding.ASCII.GetString(tampon, 0, son);
            string[] satirlar = ust.Split(new string[] { "\r\n" }, StringSplitOptions.None);
            string[] ilk = satirlar[0].Split(' ');
            if (ilk.Length < 2)
                return null;

            Istek istek = new Istek();
            istek.Yontem = ilk[0].ToUpperInvariant();

            string adres = ilk[1];
            int soru = adres.IndexOf('?');
            istek.Yol = (soru >= 0 ? adres.Substring(0, soru) : adres).ToLowerInvariant();

            if (soru >= 0)
                foreach (string parca in adres.Substring(soru + 1).Split('&'))
                {
                    if (parca.Length == 0)
                        continue;
                    int esit = parca.IndexOf('=');
                    string ad = Uri.UnescapeDataString((esit >= 0 ? parca.Substring(0, esit) : parca).Replace('+', ' '));
                    string deger = esit >= 0 ? Uri.UnescapeDataString(parca.Substring(esit + 1).Replace('+', ' ')) : "";
                    istek.Sorgu[ad] = deger;
                }

            for (int i = 1; i < satirlar.Length; i++)
            {
                int ik = satirlar[i].IndexOf(':');
                if (ik > 0)
                    istek.Basliklar[satirlar[i].Substring(0, ik).Trim()] = satirlar[i].Substring(ik + 1).Trim();
            }

            /* Gövde kullanılmıyor; bağlantı kapanmadan önce okunup atılır */
            int uzunluk;
            string u = istek.Baslik("Content-Length");
            if (u != null && int.TryParse(u, out uzunluk) && uzunluk > 0)
            {
                int kalan = Math.Min(uzunluk, 1024 * 1024) - (dolu - son);
                byte[] at = new byte[8192];
                while (kalan > 0)
                {
                    int n = akis.Read(at, 0, Math.Min(at.Length, kalan));
                    if (n <= 0)
                        break;
                    kalan -= n;
                }
            }

            return istek;
        }

        static void Yonlendir(NetworkStream akis, Istek istek)
        {
            /* Adres yeniden bağlama (DNS rebinding) saldırısına karşı:
               yalnızca yerel adla gelen istekler */
            string host = (istek.Baslik("Host") ?? "").ToLowerInvariant();
            string p = ":" + Port;
            if (host != "127.0.0.1" + p && host != "localhost" + p && host != "[::1]" + p)
            {
                Yaz(akis, 403, null, "application/json", Utf8("{\"hata\":\"Geçersiz adres.\"}"), null);
                return;
            }

            string kaynak = istek.Baslik("Origin");
            if (kaynak != null && kaynak != "null" && !AdresIzinli(kaynak))
            {
                Gunluk("Reddedildi: " + kaynak + " " + istek.Yol);
                Yaz(akis, 403, null, "application/json",
                    Utf8("{\"hata\":" + J("Bu site tarayıcı köprüsünü kullanamaz: " + kaynak + ". izinli-adresler.txt dosyasına ekleyiniz.") + "}"), null);
                return;
            }

            if (kaynak == "null")
                kaynak = null;

            if (istek.Yontem == "OPTIONS")
            {
                Yaz(akis, 204, kaynak, null, new byte[0], null);
                return;
            }

            try
            {
                if (istek.Yol == "/durum" && istek.Yontem == "GET")
                {
                    string j = "{\"ad\":\"Biçen Tarayıcı Köprüsü\",\"surum\":" + J(Surum) + ",\"hazir\":true"
                        + (denemeKlasoru != null ? ",\"deneme\":true" : "") + "}";
                    Yaz(akis, 200, kaynak, "application/json", Utf8(j), null);
                    return;
                }

                if (istek.Yol == "/cihazlar" && istek.Yontem == "GET")
                {
                    Yaz(akis, 200, kaynak, "application/json", Utf8(CihazlarJson()), null);
                    return;
                }

                if (istek.Yol == "/ag-tarayici" && istek.Yontem == "POST")
                {
                    if (istek.Baslik("X-Bicen-Tarayici") == null)
                        throw new KopruHatasi(400, "Eksik başlık.");
                    Yaz(akis, 200, kaynak, "application/json", Utf8(AgEkle(istek.Deger("ip", ""))), null);
                    return;
                }

                if (istek.Yol == "/ag-tarayici-sil" && istek.Yontem == "POST")
                {
                    if (istek.Baslik("X-Bicen-Tarayici") == null)
                        throw new KopruHatasi(400, "Eksik başlık.");
                    AgSil(istek.Deger("ip", ""));
                    Yaz(akis, 200, kaynak, "application/json", Utf8("{\"tamam\":true}"), null);
                    return;
                }

                if (istek.Yol == "/tara" && istek.Yontem == "POST")
                {
                    /* Özel başlık zorunlu: tarayıcı bunu ön kontrol (CORS)
                       olmadan gönderemez; başka bir sitedeki form ya da bağlantı
                       taramayı başlatamaz. */
                    if (istek.Baslik("X-Bicen-Tarayici") == null)
                        throw new KopruHatasi(400, "Eksik başlık.");

                    Tara(akis, istek, kaynak);
                    return;
                }

                Yaz(akis, 404, kaynak, "application/json", Utf8("{\"hata\":\"Bulunamadı.\"}"), null);
            }
            catch (KopruHatasi h)
            {
                Gunluk("Hata: " + h.Message);
                Yaz(akis, h.Durum, kaynak, "application/json", Utf8("{\"hata\":" + J(h.Message) + "}"), null);
            }
            catch (Exception h)
            {
                Gunluk("Beklenmeyen hata: " + h);
                Yaz(akis, 500, kaynak, "application/json", Utf8("{\"hata\":" + J("Tarama yapılamadı: " + h.Message) + "}"), null);
            }
        }

        static void Yaz(NetworkStream akis, int durum, string kaynak, string tur, byte[] govde, Dictionary<string, string> ek)
        {
            StringBuilder b = new StringBuilder();
            b.Append("HTTP/1.1 ").Append(durum).Append(' ').Append(DurumAdi(durum)).Append("\r\n");
            b.Append("Connection: close\r\n");
            b.Append("Cache-Control: no-store\r\n");
            b.Append("X-Content-Type-Options: nosniff\r\n");

            if (kaynak != null)
            {
                b.Append("Access-Control-Allow-Origin: ").Append(kaynak).Append("\r\n");
                b.Append("Vary: Origin\r\n");
                b.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
                b.Append("Access-Control-Allow-Headers: X-Bicen-Tarayici, Content-Type\r\n");
                b.Append("Access-Control-Expose-Headers: X-Sayfa-Sayisi\r\n");
                /* Chrome'un yerel ağ erişimi ön kontrolü */
                b.Append("Access-Control-Allow-Private-Network: true\r\n");
                b.Append("Access-Control-Max-Age: 600\r\n");
            }

            if (tur != null)
                b.Append("Content-Type: ").Append(tur).Append(tur.StartsWith("application/json") ? "; charset=utf-8" : "").Append("\r\n");

            if (ek != null)
                foreach (KeyValuePair<string, string> x in ek)
                    b.Append(x.Key).Append(": ").Append(x.Value).Append("\r\n");

            b.Append("Content-Length: ").Append(govde.Length).Append("\r\n\r\n");

            byte[] ust = Encoding.ASCII.GetBytes(b.ToString());
            akis.Write(ust, 0, ust.Length);
            if (govde.Length > 0)
                akis.Write(govde, 0, govde.Length);
            akis.Flush();
        }

        static string DurumAdi(int d)
        {
            switch (d)
            {
                case 200: return "OK";
                case 204: return "No Content";
                case 400: return "Bad Request";
                case 403: return "Forbidden";
                case 404: return "Not Found";
                case 409: return "Conflict";
                case 503: return "Service Unavailable";
                default: return "Error";
            }
        }

        static byte[] Utf8(string s)
        {
            return new UTF8Encoding(false).GetBytes(s);
        }

        static string J(string s)
        {
            if (s == null)
                return "null";

            StringBuilder b = new StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': b.Append("\\\""); break;
                    case '\\': b.Append("\\\\"); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': b.Append("\\r"); break;
                    case '\t': b.Append("\\t"); break;
                    default:
                        if (c < ' ')
                            b.Append("\\u").Append(((int)c).ToString("x4"));
                        else
                            b.Append(c);
                        break;
                }
            }
            return b.Append('"').ToString();
        }

        /* ================================================================ */
        /* Tarama                                                           */
        /* ================================================================ */

        static void Tara(NetworkStream akis, Istek istek, string kaynak)
        {
            string cihaz = istek.Deger("cihaz", "");
            string renk = istek.Deger("renk", "gri");
            string kaynakSecimi = istek.Deger("kaynak", "otomatik");
            int dpi;
            if (!int.TryParse(istek.Deger("dpi", "200"), out dpi) || dpi < 75 || dpi > 600)
                dpi = 200;

            if (renk != "renkli" && renk != "gri" && renk != "sb")
                renk = "gri";
            if (kaynakSecimi != "otomatik" && kaynakSecimi != "besleyici" && kaynakSecimi != "cam")
                kaynakSecimi = "otomatik";

            if (!Monitor.TryEnter(taramaKilidi))
                throw new KopruHatasi(409, "Tarayıcı şu anda başka bir tarama yapıyor; bitince tekrar deneyiniz.");

            List<byte[]> sayfalar;
            bool hazirPdf = false;
            int gercekDpi = dpi;
            try
            {
                string c = cihaz, r = renk, k = kaynakSecimi;
                int d = dpi;

                /* Cihaz seçilmemişse: Windows'ta tarayıcı yoksa ilk ağ tarayıcısı */
                if (c.Length == 0 && denemeKlasoru == null && AgListesi().Count > 0 && WiaSayisi() == 0)
                    c = "escl:" + AgListesi()[0];

                if (c.StartsWith("escl:", StringComparison.Ordinal))
                    sayfalar = EsclTara(c.Substring(5), r, d, k, out hazirPdf, out gercekDpi);
                else
                    sayfalar = denemeKlasoru != null
                        ? DenemeTara(k)
                        : Sta(() => WiaTara(c, r, d, k), 280000);
            }
            finally
            {
                Monitor.Exit(taramaKilidi);
            }

            if (sayfalar.Count == 0)
                throw new KopruHatasi(409, "Tarayıcıdan sayfa gelmedi. Evrakı yerleştirip tekrar deneyiniz.");

            byte[] pdf = hazirPdf ? sayfalar[0] : PdfYap(sayfalar, gercekDpi);
            Gunluk("Tarandı: " + sayfalar.Count + " sayfa · " + renk + " · " + dpi + " dpi · " + (pdf.Length / 1024) + " KB");

            Dictionary<string, string> ek = new Dictionary<string, string>();
            ek["X-Sayfa-Sayisi"] = sayfalar.Count.ToString(CultureInfo.InvariantCulture);
            Yaz(akis, 200, kaynak, "application/pdf", pdf, ek);
        }

        /// <summary>WIA nesneleri tek iş parçacıklı (STA) ortam ister</summary>
        static T Sta<T>(Func<T> is_, int sureMs)
        {
            T sonuc = default(T);
            Exception hata = null;

            Thread t = new Thread(() =>
            {
                try
                {
                    sonuc = is_();
                }
                catch (Exception e)
                {
                    hata = e;
                }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();

            if (!t.Join(sureMs))
                throw new KopruHatasi(503, "Tarayıcı zamanında yanıt vermedi. Cihazı kontrol edip tekrar deneyiniz.");

            if (hata != null)
            {
                if (hata is KopruHatasi)
                    throw hata;
                COMException com = hata as COMException;
                if (com != null)
                    throw WiaHatasi(com);
                throw new KopruHatasi(500, "Tarama yapılamadı: " + hata.Message);
            }

            return sonuc;
        }

        static dynamic WiaYoneticisi()
        {
            Type t = Type.GetTypeFromProgID("WIA.DeviceManager");
            if (t == null)
                throw new KopruHatasi(503, "Windows Görüntü Alma (WIA) bileşeni bulunamadı.");
            return Activator.CreateInstance(t);
        }

        static string CihazlarJson()
        {
            List<string> ogeler = new List<string>();

            if (denemeKlasoru != null)
                ogeler.Add("{\"id\":\"deneme\",\"ad\":\"Deneme tarayıcısı\",\"besleyici\":true,\"cam\":true,\"tur\":\"wia\"}");
            else
            {
                try
                {
                    ogeler.AddRange(Sta(() => WiaCihazlari(), 30000));
                }
                catch (Exception e)
                {
                    Gunluk("WIA listesi alınamadı: " + e.Message);
                }
            }

            foreach (string ip in AgListesi())
                ogeler.Add(EsclCihazJson(ip));

            return "{\"cihazlar\":[" + string.Join(",", ogeler.ToArray()) + "],\"surum\":" + J(Surum) + "}";
        }

        static int WiaSayisi()
        {
            try
            {
                return Sta(() => WiaCihazlari(), 30000).Count;
            }
            catch (Exception)
            {
                return 0;
            }
        }

        static List<string> WiaCihazlari()
        {
            dynamic yonetici = WiaYoneticisi();
            List<string> l = new List<string>();

            foreach (dynamic bilgi in yonetici.DeviceInfos)
            {
                if (Convert.ToInt32((object)bilgi.Type) != 1)
                    continue;

                string id = (string)bilgi.DeviceID;
                string ad = OzellikMetin(bilgi.Properties, DIP_AD, "Tarayıcı");

                int yetenek = 0;
                try
                {
                    dynamic c = bilgi.Connect();
                    yetenek = OzellikSayi(c.Properties, DPS_BELGE_YETENEK, 0);
                }
                catch (Exception)
                {
                    /* bağlanamayan cihaz yine listelenir */
                }

                bool besleyici = (yetenek & 1) != 0;
                bool cam = (yetenek & 2) != 0 || !besleyici;

                l.Add("{\"id\":" + J(id) + ",\"ad\":" + J(ad) + ",\"besleyici\":" + (besleyici ? "true" : "false")
                      + ",\"cam\":" + (cam ? "true" : "false") + ",\"tur\":\"wia\"}");
            }

            return l;
        }

        static List<byte[]> WiaTara(string cihazId, string renk, int dpi, string kaynak)
        {
            dynamic yonetici = WiaYoneticisi();
            dynamic bilgi = null;
            int sayi = 0;

            foreach (dynamic b in yonetici.DeviceInfos)
            {
                if (Convert.ToInt32((object)b.Type) != 1)
                    continue;
                sayi++;
                if (string.IsNullOrEmpty(cihazId) || (string)b.DeviceID == cihazId)
                {
                    bilgi = b;
                    break;
                }
            }

            if (bilgi == null)
                throw new KopruHatasi(404, sayi == 0
                    ? "Bu bilgisayarda kurulu tarayıcı bulunamadı. Tarayıcının sürücüsü kurulu ve cihaz açık olmalı."
                    : "Seçilen tarayıcı bulunamadı; tarama ayarlarından yeniden seçiniz.");

            dynamic cihaz = bilgi.Connect();

            int yetenek = OzellikSayi(cihaz.Properties, DPS_BELGE_YETENEK, 0);
            bool besleyiciVar = (yetenek & 1) != 0;
            bool camVar = (yetenek & 2) != 0 || !besleyiciVar;
            int ilkDurum = OzellikSayi(cihaz.Properties, DPS_BELGE_DURUM, 0);

            bool besleyici;
            if (kaynak == "besleyici")
            {
                if (!besleyiciVar)
                    throw new KopruHatasi(400, "Bu tarayıcıda belge besleyici yok; kaynağı \"Cam\" seçiniz.");
                besleyici = true;
            }
            else if (kaynak == "cam")
                besleyici = !camVar;
            else
                /* Otomatik: besleyicide kağıt varsa besleyiciden, yoksa camdan */
                besleyici = besleyiciVar && ((ilkDurum & 1) != 0 || !camVar);

            /* Sürücü kağıt durumunu bildiriyorsa sayfa bitince durur; bildirmiyorsa
               "kağıt yok" hatasına kadar devam edilir. */
            bool durumGuvenilir = (ilkDurum & 1) != 0;

            List<byte[]> sayfalar = new List<byte[]>();
            bool camaGecildi = false;

            KaynakSec(cihaz, besleyiciVar, besleyici);

            while (true)
            {
                dynamic oge = IlkOge(cihaz);
                if (oge == null)
                    throw new KopruHatasi(500, "Tarayıcı tarama birimini bildirmedi.");

                Ayarla(oge, renk, dpi);

                dynamic resim;
                try
                {
                    resim = oge.Transfer(BicimSec(oge));
                }
                catch (COMException e)
                {
                    uint kod = unchecked((uint)e.ErrorCode);

                    if (kod == KAGIT_YOK)
                    {
                        if (sayfalar.Count > 0)
                            break;

                        if (besleyici && kaynak == "otomatik" && camVar && !camaGecildi)
                        {
                            besleyici = false;
                            camaGecildi = true;
                            KaynakSec(cihaz, besleyiciVar, false);
                            continue;
                        }
                    }

                    throw WiaHatasi(e);
                }

                sayfalar.Add(JpegAl(resim));

                if (!besleyici || sayfalar.Count >= 200)
                    break;

                if (durumGuvenilir && (OzellikSayi(cihaz.Properties, DPS_BELGE_DURUM, 1) & 1) == 0)
                    break;
            }

            return sayfalar;
        }

        static void KaynakSec(dynamic cihaz, bool besleyiciVar, bool besleyici)
        {
            if (!besleyiciVar)
                return;

            OzellikYaz(cihaz.Properties, DPS_BELGE_SECIM, besleyici ? 1 : 2);

            if (besleyici)
            {
                OzellikYaz(cihaz.Properties, DPS_SAYFA, 1);
                OzellikYaz(cihaz.Properties, DPS_SAYFA_BOYUTU, 0);
            }
        }

        static dynamic IlkOge(dynamic cihaz)
        {
            foreach (dynamic o in cihaz.Items)
                return o;
            return null;
        }

        static void Ayarla(dynamic oge, string renk, int dpi)
        {
            /* Niyet önce yazılır: sürücüler diğer değerleri buna göre sıfırlıyor */
            int niyet = renk == "renkli" ? 1 : renk == "sb" ? 4 : 2;
            OzellikYaz(oge.Properties, IPS_NIYET, niyet);
            OzellikYaz(oge.Properties, IPA_VERI_TURU, renk == "renkli" ? 3 : renk == "sb" ? 0 : 2);
            OzellikYaz(oge.Properties, IPA_DERINLIK, renk == "renkli" ? 24 : renk == "sb" ? 1 : 8);

            int[] adaylar = new int[] { dpi, 300, 200, 150, 100 };
            int gecen = dpi;
            foreach (int a in adaylar)
            {
                if (OzellikYaz(oge.Properties, IPS_YATAY_COZ, a))
                {
                    OzellikYaz(oge.Properties, IPS_DIKEY_COZ, a);
                    gecen = a;
                    break;
                }
            }

            /* Tarama alanı A4 (cihazın en büyüğünü aşmadan). Çözünürlük
               değişince bazı sürücüler eski piksel ölçüsünü koruyup sayfayı
               kırpıyordu. */
            OzellikYaz(oge.Properties, IPS_X_KONUM, 0);
            OzellikYaz(oge.Properties, IPS_Y_KONUM, 0);
            UzunlukYaz(oge.Properties, IPS_X_UZUNLUK, (int)(gecen * 8.27));
            UzunlukYaz(oge.Properties, IPS_Y_UZUNLUK, (int)(gecen * 11.69));
        }

        static void UzunlukYaz(dynamic ozellikler, int id, int istenen)
        {
            dynamic p = Ozellik(ozellikler, id);
            if (p == null)
                return;

            int deger = istenen;
            try
            {
                int enFazla = Convert.ToInt32((object)p.SubTypeMax);
                if (enFazla > 0 && deger > enFazla)
                    deger = enFazla;
            }
            catch (Exception)
            {
            }

            try
            {
                p.Value = deger;
            }
            catch (Exception)
            {
            }
        }

        static string BicimSec(dynamic oge)
        {
            string ilk = null;
            try
            {
                foreach (object f in oge.Formats)
                {
                    string s = Convert.ToString(f).ToUpperInvariant();
                    if (s == JPEG)
                        return JPEG;
                    if (ilk == null)
                        ilk = s;
                }
            }
            catch (Exception)
            {
                return JPEG;
            }

            return ilk == BMP || ilk == null ? BMP : ilk;
        }

        static byte[] JpegAl(dynamic resim)
        {
            string bicim = Convert.ToString((object)resim.FormatID).ToUpperInvariant();

            if (bicim != JPEG)
            {
                Type t = Type.GetTypeFromProgID("WIA.ImageProcess");
                dynamic islem = Activator.CreateInstance(t);

                object filtre = null;
                foreach (dynamic f in islem.FilterInfos)
                    if ((string)f.Name == "Convert")
                        filtre = f.FilterID;

                islem.Filters.Add(filtre, 0);

                dynamic donustur = null;
                foreach (dynamic f in islem.Filters)
                    donustur = f;

                OzellikAdlaYaz(donustur.Properties, "FormatID", JPEG);
                OzellikAdlaYaz(donustur.Properties, "Quality", 85);
                resim = islem.Apply(resim);
            }

            object veri = resim.FileData.BinaryData;
            return (byte[])veri;
        }

        static List<byte[]> DenemeTara(string kaynak)
        {
            Thread.Sleep(1200);
            string[] dosyalar = Directory.GetFiles(denemeKlasoru, "*.jpg");
            Array.Sort(dosyalar, StringComparer.Ordinal);

            List<byte[]> l = new List<byte[]>();
            foreach (string d in dosyalar)
            {
                l.Add(File.ReadAllBytes(d));
                if (kaynak == "cam")
                    break;
            }
            return l;
        }

        /* ---------------------------------------------------- WIA özellikleri */

        static dynamic Ozellik(dynamic ozellikler, int id)
        {
            try
            {
                foreach (dynamic p in ozellikler)
                    if (Convert.ToInt32((object)p.PropertyID) == id)
                        return p;
            }
            catch (Exception)
            {
            }
            return null;
        }

        static int OzellikSayi(dynamic ozellikler, int id, int varsayilan)
        {
            try
            {
                dynamic p = Ozellik(ozellikler, id);
                return p == null ? varsayilan : Convert.ToInt32((object)p.Value);
            }
            catch (Exception)
            {
                return varsayilan;
            }
        }

        static string OzellikMetin(dynamic ozellikler, int id, string varsayilan)
        {
            try
            {
                dynamic p = Ozellik(ozellikler, id);
                string s = p == null ? null : Convert.ToString((object)p.Value);
                return string.IsNullOrEmpty(s) ? varsayilan : s;
            }
            catch (Exception)
            {
                return varsayilan;
            }
        }

        static bool OzellikYaz(dynamic ozellikler, int id, object deger)
        {
            try
            {
                dynamic p = Ozellik(ozellikler, id);
                if (p == null)
                    return false;
                p.Value = deger;
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        static void OzellikAdlaYaz(dynamic ozellikler, string ad, object deger)
        {
            foreach (dynamic p in ozellikler)
                if ((string)p.Name == ad)
                {
                    p.Value = deger;
                    return;
                }
        }

        static KopruHatasi WiaHatasi(COMException e)
        {
            uint kod = unchecked((uint)e.ErrorCode);
            string m;

            switch (kod)
            {
                case 0x80210001: m = "Tarayıcı bir hata bildirdi. Cihazı kapatıp açarak tekrar deneyiniz."; break;
                case 0x80210002: m = "Kağıt sıkıştı. Sıkışan kağıdı çıkarıp tekrar deneyiniz."; break;
                case 0x80210003: m = "Besleyicide kağıt yok. Evrakı besleyiciye ya da camın üzerine yerleştiriniz."; break;
                case 0x80210004: m = "Kağıtta bir sorun var (yanlış yerleştirilmiş olabilir)."; break;
                case 0x80210005: m = "Tarayıcı kapalı ya da bağlı değil."; break;
                case 0x80210006: m = "Tarayıcı meşgul. Birkaç saniye sonra tekrar deneyiniz."; break;
                case 0x80210007: m = "Tarayıcı ısınıyor. Birkaç saniye sonra tekrar deneyiniz."; break;
                case 0x80210008: m = "Tarayıcı kullanıcı müdahalesi bekliyor (cihazın ekranına bakınız)."; break;
                case 0x8021000A: m = "Tarayıcıyla iletişim kurulamadı. Kablo ya da ağ bağlantısını kontrol ediniz."; break;
                case 0x8021000C: m = "Tarayıcı ayarları desteklenmiyor. Renk ya da çözünürlüğü değiştirip deneyiniz."; break;
                case 0x8021000D: m = "Tarayıcı kilitli (cihazdaki tarama kilidini açınız)."; break;
                case 0x80210010: m = "Tarayıcının kapağı açık."; break;
                case 0x80210011: m = "Tarayıcının lambası kapalı."; break;
                case 0x80210015: m = "Tarayıcıya ulaşılamadı. Açık ve bu bilgisayara bağlı olmalı."; break;
                case 0x80210016: m = "Besleyici birden fazla sayfayı aynı anda çekti. Sayfaları düzeltip tekrar deneyiniz."; break;
                default: m = "Tarama yapılamadı (kod 0x" + kod.ToString("X8") + "): " + e.Message; break;
            }

            return new KopruHatasi(409, m);
        }

        /* ================================================================ */
        /* Ağ tarayıcısı (eSCL / AirScan)                                   */
        /* ================================================================ */

        const string ESCL_NS = "http://schemas.hp.com/imaging/escl/2011/05/03";
        const string PWG_NS = "http://www.pwg.org/schemas/2010/12/sm";

        static readonly object agKilidi = new object();
        static List<string> agTarayicilar = new List<string>();
        static readonly Dictionary<string, string> agTaban = new Dictionary<string, string>();

        static string AgDosyasi()
        {
            return Path.Combine(klasor, "ag-tarayicilar.txt");
        }

        static void AgOku()
        {
            List<string> l = new List<string>();
            try
            {
                if (File.Exists(AgDosyasi()))
                    foreach (string satir in File.ReadAllLines(AgDosyasi(), Encoding.UTF8))
                    {
                        string x = satir.Trim();
                        int bosluk = x.IndexOfAny(new char[] { ' ', '\t', '#' });
                        if (bosluk >= 0) x = x.Substring(0, bosluk);
                        if (AdresGecerli(x) && !l.Contains(x)) l.Add(x);
                    }
            }
            catch (Exception e)
            {
                Gunluk("ag-tarayicilar.txt okunamadı: " + e.Message);
            }
            lock (agKilidi) agTarayicilar = l;
        }

        static List<string> AgListesi()
        {
            lock (agKilidi) return new List<string>(agTarayicilar);
        }

        static void AgKaydet(List<string> l)
        {
            lock (agKilidi) agTarayicilar = l;
            File.WriteAllLines(AgDosyasi(), l.ToArray(), new UTF8Encoding(false));
        }

        /// <summary>IPv4 ya da makine adı (harf, rakam, nokta, tire)</summary>
        static bool AdresGecerli(string x)
        {
            if (string.IsNullOrEmpty(x) || x.Length > 100) return false;
            foreach (char c in x)
                if (!(char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == ':')) return false;
            return true;
        }

        static string AgEkle(string ip)
        {
            ip = (ip ?? "").Trim();
            if (!AdresGecerli(ip))
                throw new KopruHatasi(400, "Geçerli bir IP adresi yazınız (örn. 192.168.1.50).");

            XmlDocument yetenek;
            try
            {
                yetenek = EsclYetenek(ip);
            }
            catch (KopruHatasi)
            {
                throw;
            }
            catch (Exception e)
            {
                throw new KopruHatasi(404, ip + " adresinde ağ tarayıcısı (eSCL) bulunamadı. Cihaz açık ve bu ağda mı, IP doğru mu? (" + e.Message + ")");
            }

            List<string> l = AgListesi();
            if (!l.Contains(ip)) l.Add(ip);
            AgKaydet(l);
            Gunluk("Ağ tarayıcısı eklendi: " + ip + " · " + EsclAd(yetenek, ip));
            return "{\"tamam\":true,\"ad\":" + J(EsclAd(yetenek, ip)) + "}";
        }

        static void AgSil(string ip)
        {
            List<string> l = AgListesi();
            l.Remove((ip ?? "").Trim());
            AgKaydet(l);
        }

        /// <summary>Yazıcıların çoğu kendinden imzalı sertifika kullanıyor: yalnızca kayıtlı ağ tarayıcılarına güven</summary>
        static void AgGuvenlik()
        {
            try
            {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2
            }
            catch (Exception)
            {
            }

            ServicePointManager.ServerCertificateValidationCallback = (gonderen, sertifika, zincir, hata) =>
            {
                if (hata == System.Net.Security.SslPolicyErrors.None) return true;
                HttpWebRequest r = gonderen as HttpWebRequest;
                return r != null && AgListesi().Contains(r.RequestUri.Host);
            };
        }

        static HttpWebResponse EsclIstek(string adres, string yontem, string govde, int sureMs)
        {
            HttpWebRequest r = (HttpWebRequest)WebRequest.Create(adres);
            r.Method = yontem;
            r.Timeout = sureMs;
            r.ReadWriteTimeout = sureMs;
            r.Proxy = null;
            r.AllowAutoRedirect = false;
            r.KeepAlive = false;
            if (govde != null)
            {
                byte[] b = Encoding.UTF8.GetBytes(govde);
                r.ContentType = "text/xml";
                r.ContentLength = b.Length;
                using (Stream s = r.GetRequestStream()) s.Write(b, 0, b.Length);
            }

            try
            {
                return (HttpWebResponse)r.GetResponse();
            }
            catch (WebException e)
            {
                HttpWebResponse y = e.Response as HttpWebResponse;
                if (y != null) return y;
                throw;
            }
        }

        static byte[] Oku(HttpWebResponse y)
        {
            using (Stream s = y.GetResponseStream())
            using (MemoryStream m = new MemoryStream())
            {
                s.CopyTo(m);
                return m.ToArray();
            }
        }

        /// <summary>Tarayıcının yetenekleri; http, olmazsa https denenir. Çalışan taban adres saklanır.</summary>
        static XmlDocument EsclYetenek(string ip)
        {
            List<string> adaylar = new List<string>();
            string bilinen;
            lock (agKilidi)
                if (agTaban.TryGetValue(ip, out bilinen)) adaylar.Add(bilinen);
            adaylar.Add("http://" + ip + "/eSCL");
            adaylar.Add("https://" + ip + "/eSCL");
            adaylar.Add("http://" + ip + ":8080/eSCL");

            Exception son = null;
            foreach (string taban in adaylar)
            {
                try
                {
                    using (HttpWebResponse y = EsclIstek(taban + "/ScannerCapabilities", "GET", null, 6000))
                    {
                        if ((int)y.StatusCode != 200) { son = new Exception("HTTP " + (int)y.StatusCode); continue; }
                        XmlDocument d = new XmlDocument();
                        d.LoadXml(Encoding.UTF8.GetString(Oku(y)).TrimStart('﻿'));
                        lock (agKilidi) agTaban[ip] = taban;
                        return d;
                    }
                }
                catch (Exception e)
                {
                    son = e;
                }
            }
            throw son ?? new Exception("yanıt yok");
        }

        static XmlNodeList Dugumler(XmlNode d, string ad)
        {
            /* Ad alanı ön ekleri cihazdan cihaza değişiyor; yerel adla aranır */
            return d.SelectNodes("//*[local-name()='" + ad + "']");
        }

        static string Ilk(XmlNode d, string ad)
        {
            XmlNodeList l = Dugumler(d, ad);
            return l.Count > 0 ? l[0].InnerText.Trim() : null;
        }

        static string EsclAd(XmlDocument y, string ip)
        {
            string ad = Ilk(y, "MakeAndModel");
            return string.IsNullOrEmpty(ad) ? "Ağ tarayıcısı (" + ip + ")" : ad + " (" + ip + ")";
        }

        static string EsclCihazJson(string ip)
        {
            try
            {
                XmlDocument y = EsclYetenek(ip);
                bool cam = Dugumler(y, "Platen").Count > 0;
                bool besleyici = Dugumler(y, "Adf").Count > 0;
                if (!cam && !besleyici) cam = true;
                return "{\"id\":" + J("escl:" + ip) + ",\"ad\":" + J(EsclAd(y, ip)) + ",\"besleyici\":" + (besleyici ? "true" : "false")
                       + ",\"cam\":" + (cam ? "true" : "false") + ",\"tur\":\"ag\",\"ip\":" + J(ip) + "}";
            }
            catch (Exception)
            {
                return "{\"id\":" + J("escl:" + ip) + ",\"ad\":" + J("Ağ tarayıcısı (" + ip + ") · ulaşılamıyor") + ",\"besleyici\":true,\"cam\":true,\"tur\":\"ag\",\"ip\":" + J(ip) + ",\"ulasilamiyor\":true}";
            }
        }

        /// <summary>Yetenekte listelenen çözünürlüklerden istenene en yakını</summary>
        static int EsclCozunurluk(XmlNode kaynak, int istenen)
        {
            int en = 0, fark = int.MaxValue;
            foreach (XmlNode n in kaynak.SelectNodes(".//*[local-name()='XResolution']"))
            {
                int v;
                if (int.TryParse(n.InnerText.Trim(), out v) && v > 0 && Math.Abs(v - istenen) < fark)
                {
                    fark = Math.Abs(v - istenen);
                    en = v;
                }
            }
            return en > 0 ? en : istenen;
        }

        static List<byte[]> EsclTara(string ip, string renk, int dpi, string kaynak, out bool pdfDondu, out int kullanilanDpi)
        {
            pdfDondu = false;
            kullanilanDpi = dpi;

            XmlDocument y;
            try
            {
                y = EsclYetenek(ip);
            }
            catch (Exception e)
            {
                throw new KopruHatasi(503, "Ağ tarayıcısına (" + ip + ") ulaşılamadı. Cihaz açık ve ağa bağlı olmalı. (" + e.Message + ")");
            }

            string taban;
            lock (agKilidi) taban = agTaban[ip];

            XmlNode cam = Dugumler(y, "Platen").Count > 0 ? Dugumler(y, "Platen")[0] : null;
            XmlNode adf = Dugumler(y, "Adf").Count > 0 ? Dugumler(y, "Adf")[0] : null;

            /* Kaynak: otomatik ise besleyicide kağıt varsa besleyici */
            bool besleyici;
            if (kaynak == "besleyici")
            {
                if (adf == null) throw new KopruHatasi(400, "Bu tarayıcıda belge besleyici yok; kaynağı \"Cam\" seçiniz.");
                besleyici = true;
            }
            else if (kaynak == "cam")
                besleyici = cam == null;
            else
            {
                besleyici = cam == null;
                if (adf != null && cam != null)
                {
                    try
                    {
                        using (HttpWebResponse d = EsclIstek(taban + "/ScannerStatus", "GET", null, 5000))
                        {
                            string durum = Encoding.UTF8.GetString(Oku(d));
                            besleyici = durum.IndexOf("ScannerAdfLoaded", StringComparison.OrdinalIgnoreCase) >= 0;
                        }
                    }
                    catch (Exception)
                    {
                    }
                }
            }

            XmlNode secili = besleyici ? (adf ?? cam) : (cam ?? adf);
            string metin = secili.OuterXml;

            string renkModu = renk == "renkli" ? "RGB24" : renk == "sb" ? "BlackAndWhite1" : "Grayscale8";
            if (metin.IndexOf(renkModu, StringComparison.Ordinal) < 0)
                renkModu = metin.IndexOf("Grayscale8", StringComparison.Ordinal) >= 0 ? "Grayscale8" : "RGB24";

            bool jpeg = metin.IndexOf("image/jpeg", StringComparison.OrdinalIgnoreCase) >= 0 || metin.IndexOf("DocumentFormat", StringComparison.Ordinal) < 0;
            string bicim = jpeg ? "image/jpeg" : "application/pdf";
            int cozunurluk = EsclCozunurluk(secili, dpi);
            kullanilanDpi = cozunurluk;

            int enGen = 2550, enYuk = 3508;
            int x;
            XmlNode n = secili.SelectSingleNode(".//*[local-name()='MaxWidth']");
            if (n != null && int.TryParse(n.InnerText.Trim(), out x) && x > 0) enGen = x;
            n = secili.SelectSingleNode(".//*[local-name()='MaxHeight']");
            if (n != null && int.TryParse(n.InnerText.Trim(), out x) && x > 0) enYuk = x;

            /* A4 (1/300 inç) cihazın en büyüğünü aşmadan */
            int gen = Math.Min(2480, enGen), yuk = Math.Min(3508, enYuk);
            string surum = Ilk(y, "Version") ?? "2.0";

            /* 15.10.2026 (1.2): bazı cihazlar (HTTP 400/500) tam ayarı kabul
               etmiyor: DocumentFormatExt, bölge, renk ya da çözünürlük. Önce tam
               ayar, reddederse adım adım sadeleştirilmiş ayar denenir; cihaz
               kendi varsayılanını kullanır. */
            string kaynakEtiket = besleyici ? "Feeder" : "Platen";

            Func<int, string> ayarUret = seviye =>
            {
                var sb = new StringBuilder();
                sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
                sb.Append("<scan:ScanSettings xmlns:scan=\"" + ESCL_NS + "\" xmlns:pwg=\"" + PWG_NS + "\">");
                sb.Append("<pwg:Version>" + (seviye >= 3 ? "2.0" : surum) + "</pwg:Version>");
                if (seviye >= 2) sb.Append("<scan:Intent>Document</scan:Intent>");
                if (seviye <= 1)
                    sb.Append("<pwg:ScanRegions><pwg:ScanRegion>" +
                              "<pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>" +
                              "<pwg:XOffset>0</pwg:XOffset><pwg:YOffset>0</pwg:YOffset>" +
                              "<pwg:Width>" + gen + "</pwg:Width><pwg:Height>" + yuk + "</pwg:Height>" +
                              "</pwg:ScanRegion></pwg:ScanRegions>");
                sb.Append("<pwg:InputSource>" + kaynakEtiket + "</pwg:InputSource>");
                if (seviye <= 2) sb.Append("<scan:ColorMode>" + (seviye == 2 && renkModu == "BlackAndWhite1" ? "Grayscale8" : renkModu) + "</scan:ColorMode>");
                if (seviye <= 2)
                {
                    int c = seviye == 2 ? Math.Min(cozunurluk, 300) : cozunurluk;
                    sb.Append("<scan:XResolution>" + c + "</scan:XResolution><scan:YResolution>" + c + "</scan:YResolution>");
                }
                if (seviye <= 1) sb.Append("<pwg:DocumentFormat>" + bicim + "</pwg:DocumentFormat>");
                if (seviye == 0) sb.Append("<scan:DocumentFormatExt>" + bicim + "</scan:DocumentFormatExt>");
                if (seviye == 2) sb.Append("<scan:DocumentFormatExt>" + bicim + "</scan:DocumentFormatExt>");
                sb.Append("</scan:ScanSettings>");
                return sb.ToString();
            };

            string is_ = null;
            int sonKod = 0;
            string sonYanit = null;

            for (int seviye = 0; seviye <= 3 && is_ == null; seviye++)
            {
                using (HttpWebResponse r = EsclIstek(taban + "/ScanJobs", "POST", ayarUret(seviye), 30000))
                {
                    int kod = (int)r.StatusCode;
                    if (kod == 409 || kod == 503)
                        throw new KopruHatasi(409, besleyici && kaynak != "cam"
                            ? "Tarayıcı taramaya başlayamadı: besleyicide kağıt yok ya da cihaz meşgul."
                            : "Tarayıcı meşgul. Birkaç saniye sonra tekrar deneyiniz.");

                    if (kod == 201 || kod == 200)
                    {
                        is_ = r.Headers["Location"];
                        if (string.IsNullOrEmpty(is_)) throw new KopruHatasi(500, "Tarayıcı tarama işini başlatmadı.");
                        if (seviye > 0) Gunluk("eSCL " + ip + ": tarama sade ayarla (seviye " + seviye + ") kabul edildi.");
                        break;
                    }

                    sonKod = kod;
                    try
                    {
                        sonYanit = Encoding.UTF8.GetString(Oku(r));
                    }
                    catch (Exception)
                    {
                        sonYanit = null;
                    }
                    Gunluk("eSCL " + ip + ": ScanJobs seviye " + seviye + " reddedildi (HTTP " + kod + ")" +
                           (string.IsNullOrWhiteSpace(sonYanit) ? "" : ": " + Kisalt(sonYanit, 300)));

                    /* 400/500 dışındaki ret (ör. 401/403) sadeleştirmekle düzelmez */
                    if (kod != 400 && kod != 500 && kod != 501) break;
                }

                /* Cihaz bir önceki isteği bırakmaya zaman bulsun */
                Thread.Sleep(600);
            }

            if (is_ == null)
                throw new KopruHatasi(409, "Tarayıcı tarama isteğini kabul etmedi (HTTP " + sonKod + "). " +
                    "Cihazı kapatıp açmayı, kaynak olarak \"Cam\" ya da \"Besleyici\"yi seçmeyi deneyiniz; " +
                    "sürmezse ayrıntı köprü günlüğünde.");

            if (!is_.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                Uri u = new Uri(taban);
                is_ = u.Scheme + "://" + u.Authority + (is_.StartsWith("/") ? "" : "/") + is_;
            }
            is_ = is_.TrimEnd('/');

            List<byte[]> sayfalar = new List<byte[]>();
            DateTime sinir = DateTime.Now.AddMinutes(4);

            while (DateTime.Now < sinir && sayfalar.Count < 200)
            {
                using (HttpWebResponse r = EsclIstek(is_ + "/NextDocument", "GET", null, 120000))
                {
                    int kod = (int)r.StatusCode;

                    if (kod == 200)
                    {
                        byte[] b = Oku(r);
                        string tur = (r.ContentType ?? "").ToLowerInvariant();
                        if (tur.Contains("pdf") || (b.Length > 4 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F'))
                        {
                            pdfDondu = true;
                            sayfalar.Clear();
                            sayfalar.Add(b);
                            break;
                        }
                        sayfalar.Add(b);
                        if (!besleyici) break;
                        continue;
                    }

                    if (kod == 404 || kod == 410)
                    {
                        if (sayfalar.Count == 0 && besleyici)
                            throw new KopruHatasi(409, "Besleyicide kağıt yok. Evrakı besleyiciye ya da camın üzerine yerleştiriniz.");
                        break;
                    }

                    if (kod == 503 || kod == 409)
                    {
                        Thread.Sleep(1000);
                        continue;
                    }

                    throw new KopruHatasi(409, "Tarayıcıdan sayfa alınamadı (HTTP " + kod + ").");
                }
            }

            /* İşi kapat (cihaz kendisi de kapatıyor; hata önemsiz) */
            try
            {
                using (EsclIstek(is_, "DELETE", null, 5000)) { }
            }
            catch (Exception)
            {
            }

            return sayfalar;
        }

        /* ================================================================ */
        /* PDF                                                              */
        /* ================================================================ */

        /// <summary>
        /// JPEG sayfalarından PDF. Görüntüler yeniden sıkıştırılmadan
        /// (DCTDecode) gömülür; sayfa ölçüsü görüntünün çözünürlüğünden.
        /// </summary>
        static byte[] PdfYap(List<byte[]> sayfalar, int dpi)
        {
            MemoryStream m = new MemoryStream();
            List<long> konumlar = new List<long>();
            int nesneSayisi = 2 + sayfalar.Count * 3;

            PdfYaz(m, "%PDF-1.4\n%âãÏÓ\n");

            konumlar.Add(m.Position);
            PdfYaz(m, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

            StringBuilder kidler = new StringBuilder();
            for (int i = 0; i < sayfalar.Count; i++)
                kidler.Append(3 + i * 3).Append(" 0 R ");

            konumlar.Add(m.Position);
            PdfYaz(m, "2 0 obj\n<< /Type /Pages /Kids [" + kidler + "] /Count " + sayfalar.Count + " >>\nendobj\n");

            CultureInfo inv = CultureInfo.InvariantCulture;

            for (int i = 0; i < sayfalar.Count; i++)
            {
                byte[] jpg = sayfalar[i];
                int gen, yuk, bilesen, yatayDpi, dikeyDpi;
                bool adobe;
                JpegBilgi(jpg, out gen, out yuk, out bilesen, out yatayDpi, out dikeyDpi, out adobe);

                if (yatayDpi < 50 || yatayDpi > 1200) yatayDpi = dpi;
                if (dikeyDpi < 50 || dikeyDpi > 1200) dikeyDpi = yatayDpi;

                double gw = gen * 72.0 / yatayDpi;
                double gh = yuk * 72.0 / dikeyDpi;
                string w = gw.ToString("0.##", inv);
                string h = gh.ToString("0.##", inv);

                int sayfa = 3 + i * 3, icerik = sayfa + 1, resim = sayfa + 2;

                konumlar.Add(m.Position);
                PdfYaz(m, sayfa + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + w + " " + h + "] "
                    + "/Resources << /XObject << /Im0 " + resim + " 0 R >> >> /Contents " + icerik + " 0 R >>\nendobj\n");

                string akis = "q " + w + " 0 0 " + h + " 0 0 cm /Im0 Do Q";
                konumlar.Add(m.Position);
                PdfYaz(m, icerik + " 0 obj\n<< /Length " + akis.Length + " >>\nstream\n" + akis + "\nendstream\nendobj\n");

                string uzay = bilesen == 1 ? "/DeviceGray" : bilesen == 4 ? "/DeviceCMYK" : "/DeviceRGB";
                string ters = bilesen == 4 && adobe ? " /Decode [1 0 1 0 1 0 1 0]" : "";

                konumlar.Add(m.Position);
                PdfYaz(m, resim + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + gen + " /Height " + yuk
                    + " /ColorSpace " + uzay + " /BitsPerComponent 8 /Filter /DCTDecode" + ters
                    + " /Length " + jpg.Length + " >>\nstream\n");
                m.Write(jpg, 0, jpg.Length);
                PdfYaz(m, "\nendstream\nendobj\n");
            }

            long xref = m.Position;
            StringBuilder x = new StringBuilder();
            x.Append("xref\n0 ").Append(nesneSayisi + 1).Append("\n0000000000 65535 f \n");
            foreach (long k in konumlar)
                x.Append(k.ToString("0000000000", inv)).Append(" 00000 n \n");
            x.Append("trailer\n<< /Size ").Append(nesneSayisi + 1).Append(" /Root 1 0 R >>\nstartxref\n")
                .Append(xref).Append("\n%%EOF\n");
            PdfYaz(m, x.ToString());

            return m.ToArray();
        }

        static void PdfYaz(MemoryStream m, string s)
        {
            /* PDF yapısı Latin-1; Türkçe karakter yok */
            byte[] b = new byte[s.Length];
            for (int i = 0; i < s.Length; i++)
                b[i] = (byte)s[i];
            m.Write(b, 0, b.Length);
        }

        static void JpegBilgi(byte[] j, out int gen, out int yuk, out int bilesen, out int yatayDpi, out int dikeyDpi, out bool adobe)
        {
            gen = 0; yuk = 0; bilesen = 3; yatayDpi = 0; dikeyDpi = 0; adobe = false;

            if (j.Length < 4 || j[0] != 0xFF || j[1] != 0xD8)
                throw new KopruHatasi(500, "Tarayıcıdan gelen görüntü okunamadı.");

            int i = 2;
            while (i + 4 <= j.Length)
            {
                if (j[i] != 0xFF)
                {
                    i++;
                    continue;
                }

                int isaret = j[i + 1];
                if (isaret == 0xFF)
                {
                    i++;
                    continue;
                }

                if (isaret == 0xD8 || isaret == 0x01 || (isaret >= 0xD0 && isaret <= 0xD7))
                {
                    i += 2;
                    continue;
                }

                if (isaret == 0xD9 || isaret == 0xDA)
                    break;

                int uz = (j[i + 2] << 8) | j[i + 3];
                int v = i + 4;

                if (isaret == 0xE0 && uz >= 14 && v + 12 <= j.Length && j[v] == 'J' && j[v + 1] == 'F' && j[v + 2] == 'I' && j[v + 3] == 'F')
                {
                    int birim = j[v + 7];
                    int xd = (j[v + 8] << 8) | j[v + 9];
                    int yd = (j[v + 10] << 8) | j[v + 11];
                    if (birim == 1) { yatayDpi = xd; dikeyDpi = yd; }
                    else if (birim == 2) { yatayDpi = (int)Math.Round(xd * 2.54); dikeyDpi = (int)Math.Round(yd * 2.54); }
                }
                else if (isaret == 0xEE && uz >= 7 && v + 5 <= j.Length && j[v] == 'A' && j[v + 1] == 'd' && j[v + 2] == 'o' && j[v + 3] == 'b' && j[v + 4] == 'e')
                {
                    adobe = true;
                }
                else if ((isaret >= 0xC0 && isaret <= 0xCF) && isaret != 0xC4 && isaret != 0xC8 && isaret != 0xCC && v + 6 <= j.Length)
                {
                    yuk = (j[v + 1] << 8) | j[v + 2];
                    gen = (j[v + 3] << 8) | j[v + 4];
                    bilesen = j[v + 5];
                }

                i += 2 + uz;
            }

            if (gen <= 0 || yuk <= 0)
                throw new KopruHatasi(500, "Tarayıcıdan gelen görüntünün ölçüsü okunamadı.");
        }
    }
}
