using System.Diagnostics;

namespace BicenKariyer.Panel;

public class AnaForm : Form
{
    private static readonly Color Yesil = Color.FromArgb(124, 181, 24);
    private static readonly Color YesilKoyu = Color.FromArgb(95, 140, 16);
    private static readonly Color Turuncu = Color.FromArgb(232, 72, 28);
    private static readonly Color Siyah = Color.FromArgb(29, 33, 38);

    private readonly PanelAyarlari _ayarlar;
    private readonly ServisYonetici _yonetici;

    private ListView _liste;
    private TextBox _logKutusu;
    private ComboBox _logSecici;
    private Label _durumEtiketi;
    private NotifyIcon _tepsi;
    private System.Windows.Forms.Timer _zamanlayici;
    private CheckBox _otomatikYenidenBaslat;
    private CheckBox _elleDurdurmadaMail;

    // Mail alanları
    private TextBox _sunucu, _port, _kullanici, _parola, _gonderenAd, _gonderenAdres, _alicilar;
    private ComboBox _sifreleme;

    public AnaForm()
    {
        _ayarlar = PanelAyarlari.Yukle();
        _yonetici = new ServisYonetici(_ayarlar);

        _yonetici.LogGeldi += LogGeldi;
        _yonetici.DurumDegisti += () => Calistir(ListeyiYenile);
        _yonetici.BeklenmedikKapanma += KapanmaBildir;

        ArayuzKur();

        Load += (_, _) =>
        {
            ListeyiYenile();
            LogSeciciyiDoldur();
        };

        FormClosing += (e, a) =>
        {
            if (a.CloseReason == CloseReason.UserClosing && _tepsi.Visible)
            {
                // Kapatma yerine tepsiye küçült
                a.Cancel = true;
                Hide();
                _tepsi.ShowBalloonTip(
                    2000, "Biçen Kariyer Paneli",
                    "Panel arka planda çalışmaya devam ediyor.", ToolTipIcon.Info);
                return;
            }

            var cevap = MessageBox.Show(
                "Panel kapatılıyor. Çalışan servisler de durdurulsun mu?",
                "Biçen Kariyer Paneli",
                MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);

            if (cevap == DialogResult.Cancel)
            {
                a.Cancel = true;
                return;
            }

            if (cevap == DialogResult.Yes) _yonetici.TumunuDurdur();
        };
    }

    /* ====================================================================== */
    /* Arayüz                                                                 */
    /* ====================================================================== */

    private void ArayuzKur()
    {
        Text = "Biçen Kariyer - Servis Paneli";
        Size = new Size(1020, 660);
        MinimumSize = new Size(880, 560);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.FromArgb(244, 246, 242);

        /* --------------------------------------------------------- üst şerit */
        var ust = new Panel { Dock = DockStyle.Top, Height = 54, BackColor = Siyah };
        var baslik = new Label
        {
            Text = "BİÇEN KARİYER  ·  Servis Paneli",
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 12F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(16, 15)
        };
        _durumEtiketi = new Label
        {
            Text = "",
            ForeColor = Color.Gainsboro,
            AutoSize = true,
            Anchor = AnchorStyles.Right,
            Location = new Point(700, 19)
        };
        ust.Controls.Add(baslik);
        ust.Controls.Add(_durumEtiketi);
        ust.Resize += (_, _) => _durumEtiketi.Left = ust.Width - _durumEtiketi.Width - 18;

        /* ------------------------------------------------------------ sekmeler */
        var sekmeler = new TabControl { Dock = DockStyle.Fill, Padding = new Point(14, 6) };
        sekmeler.TabPages.Add(ServislerSekmesi());
        sekmeler.TabPages.Add(LoglarSekmesi());
        sekmeler.TabPages.Add(AyarlarSekmesi());

        Controls.Add(sekmeler);
        Controls.Add(ust);

        /* ------------------------------------------------------------- tepsi */
        _tepsi = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Biçen Kariyer Servis Paneli",
            Visible = true
        };
        _tepsi.DoubleClick += (_, _) =>
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        };

        var tepsiMenu = new ContextMenuStrip();
        tepsiMenu.Items.Add("Paneli aç", null, (_, _) => { Show(); Activate(); });
        tepsiMenu.Items.Add(new ToolStripSeparator());
        tepsiMenu.Items.Add("Tümünü başlat", null, (_, _) => Task.Run(_yonetici.TumunuBaslat));
        tepsiMenu.Items.Add("Tümünü durdur", null, (_, _) => Task.Run(_yonetici.TumunuDurdur));
        tepsiMenu.Items.Add(new ToolStripSeparator());
        tepsiMenu.Items.Add("Çıkış", null, (_, _) =>
        {
            _tepsi.Visible = false;
            Close();
        });
        _tepsi.ContextMenuStrip = tepsiMenu;

        /* ------------------------------------------------------- zamanlayıcı */
        _zamanlayici = new System.Windows.Forms.Timer { Interval = 3000 };
        _zamanlayici.Tick += (_, _) => ListeyiYenile();
        _zamanlayici.Start();
    }

    /* ---------------------------------------------------------- 1. SERVİSLER */

    private TabPage ServislerSekmesi()
    {
        var sayfa = new TabPage("Servisler") { BackColor = Color.White, Padding = new Padding(12) };

        _liste = new ListView
        {
            Dock = DockStyle.Fill,
            View = View.Details,
            FullRowSelect = true,
            GridLines = false,
            MultiSelect = false,
            HeaderStyle = ColumnHeaderStyle.Nonclickable,
            Font = new Font("Segoe UI", 9.5F)
        };
        _liste.Columns.Add("Servis", 170);
        _liste.Columns.Add("Durum", 120);
        _liste.Columns.Add("PID", 70);
        _liste.Columns.Add("Başlangıç", 140);
        _liste.Columns.Add("Adres", 200);
        _liste.Columns.Add("Klasör", 260);

        _liste.DoubleClick += (_, _) => SeciliAdresiAc();

        var butonSerit = new Panel { Dock = DockStyle.Bottom, Height = 96, BackColor = Color.White };

        Button Btn(string metin, int x, int y, int genislik, Color renk, EventHandler tik)
        {
            var b = new Button
            {
                Text = metin,
                Location = new Point(x, y),
                Size = new Size(genislik, 34),
                FlatStyle = FlatStyle.Flat,
                BackColor = renk,
                ForeColor = renk == Color.White ? Siyah : Color.White,
                Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderColor = renk == Color.White ? Color.Silver : renk;
            b.Click += tik;
            butonSerit.Controls.Add(b);
            return b;
        }

        Btn("Başlat", 0, 8, 110, Yesil, (_, _) => SeciliIcin(_yonetici.Baslat));
        Btn("Durdur", 118, 8, 110, Turuncu, (_, _) => SeciliIcin(_yonetici.Durdur));
        Btn("Yeniden Başlat", 236, 8, 130, Color.FromArgb(90, 96, 104),
            (_, _) => SeciliIcin(_yonetici.YenidenBaslat));
        Btn("Adresi Aç", 374, 8, 110, Color.White, (_, _) => SeciliAdresiAc());

        Btn("Tümünü Başlat", 0, 50, 130, YesilKoyu, (_, _) => Task.Run(_yonetici.TumunuBaslat));
        Btn("Tümünü Durdur", 138, 50, 130, Color.FromArgb(170, 50, 20),
            (_, _) => Task.Run(_yonetici.TumunuDurdur));
        Btn("Log Klasörü", 276, 50, 120, Color.White, (_, _) => KlasorAc(_yonetici.LogKlasoru));

        sayfa.Controls.Add(_liste);
        sayfa.Controls.Add(butonSerit);
        return sayfa;
    }

    /* ------------------------------------------------------------- 2. LOGLAR */

    private TabPage LoglarSekmesi()
    {
        var sayfa = new TabPage("Loglar") { BackColor = Color.White, Padding = new Padding(12) };

        var ust = new Panel { Dock = DockStyle.Top, Height = 44, BackColor = Color.White };

        ust.Controls.Add(new Label
        {
            Text = "Servis:",
            Location = new Point(0, 10),
            AutoSize = true
        });

        _logSecici = new ComboBox
        {
            Location = new Point(52, 6),
            Width = 200,
            DropDownStyle = ComboBoxStyle.DropDownList
        };
        _logSecici.SelectedIndexChanged += (_, _) => LoglariYukle();
        ust.Controls.Add(_logSecici);

        var temizle = new Button
        {
            Text = "Ekranı Temizle",
            Location = new Point(266, 5),
            Size = new Size(120, 28),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White
        };
        temizle.Click += (_, _) => _logKutusu.Clear();
        ust.Controls.Add(temizle);

        var yenile = new Button
        {
            Text = "Yenile",
            Location = new Point(394, 5),
            Size = new Size(90, 28),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White
        };
        yenile.Click += (_, _) => LoglariYukle();
        ust.Controls.Add(yenile);

        var klasor = new Button
        {
            Text = "Log Dosyaları",
            Location = new Point(492, 5),
            Size = new Size(120, 28),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White
        };
        klasor.Click += (_, _) => KlasorAc(_yonetici.LogKlasoru);
        ust.Controls.Add(klasor);

        _logKutusu = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Both,
            WordWrap = false,
            BackColor = Color.FromArgb(24, 26, 29),
            ForeColor = Color.FromArgb(214, 220, 210),
            Font = new Font("Consolas", 9F),
            BorderStyle = BorderStyle.None
        };

        sayfa.Controls.Add(_logKutusu);
        sayfa.Controls.Add(ust);
        return sayfa;
    }

    /* ------------------------------------------------------------ 3. AYARLAR */

    private TabPage AyarlarSekmesi()
    {
        var sayfa = new TabPage("Ayarlar")
        {
            BackColor = Color.White,
            Padding = new Padding(16),
            AutoScroll = true
        };

        var y = 6;

        Label Baslik(string metin)
        {
            var l = new Label
            {
                Text = metin,
                Font = new Font("Segoe UI", 10.5F, FontStyle.Bold),
                ForeColor = YesilKoyu,
                AutoSize = true,
                Location = new Point(0, y)
            };
            sayfa.Controls.Add(l);
            y += 30;
            return l;
        }

        TextBox Alan(string etiket, string deger, bool parolaMi = false, int genislik = 320)
        {
            sayfa.Controls.Add(new Label
            {
                Text = etiket,
                Location = new Point(0, y + 4),
                Size = new Size(190, 20)
            });

            var kutu = new TextBox
            {
                Text = deger ?? "",
                Location = new Point(196, y),
                Width = genislik,
                UseSystemPasswordChar = parolaMi
            };
            sayfa.Controls.Add(kutu);
            y += 32;
            return kutu;
        }

        Baslik("Bildirim Mail Ayarları");

        _sunucu = Alan("SMTP Sunucusu", _ayarlar.Mail.Sunucu);
        _port = Alan("Port", _ayarlar.Mail.Port.ToString(), false, 100);

        sayfa.Controls.Add(new Label
        {
            Text = "Şifreleme",
            Location = new Point(0, y + 4),
            Size = new Size(190, 20)
        });
        _sifreleme = new ComboBox
        {
            Location = new Point(196, y),
            Width = 160,
            DropDownStyle = ComboBoxStyle.DropDownList
        };
        _sifreleme.Items.AddRange(new object[] { "Otomatik", "SSL", "STARTTLS", "Yok" });
        _sifreleme.SelectedItem = string.IsNullOrWhiteSpace(_ayarlar.Mail.SifrelemeTuru)
            ? "Otomatik"
            : _ayarlar.Mail.SifrelemeTuru;
        sayfa.Controls.Add(_sifreleme);
        y += 32;

        _kullanici = Alan("Kullanıcı Adı", _ayarlar.Mail.KullaniciAdi);
        _parola = Alan("Parola", _ayarlar.Mail.Parola, true);
        _gonderenAd = Alan("Gönderen Adı", _ayarlar.Mail.GonderenAd);
        _gonderenAdres = Alan("Gönderen Adres", _ayarlar.Mail.GonderenAdres);
        _alicilar = Alan("Bildirim Adresleri", string.Join("; ", _ayarlar.Mail.AliciAdresler), false, 420);

        sayfa.Controls.Add(new Label
        {
            Text = "Birden fazla adresi noktalı virgül ile ayırınız.",
            ForeColor = Color.Gray,
            Location = new Point(196, y - 6),
            AutoSize = true
        });
        y += 24;

        Baslik("Davranış");

        _otomatikYenidenBaslat = new CheckBox
        {
            Text = "Servis beklenmedik şekilde durursa otomatik yeniden başlat",
            Checked = _ayarlar.OtomatikYenidenBaslat,
            Location = new Point(0, y),
            AutoSize = true
        };
        sayfa.Controls.Add(_otomatikYenidenBaslat);
        y += 28;

        _elleDurdurmadaMail = new CheckBox
        {
            Text = "Panelden elle durdurulduğunda da mail gönder",
            Checked = _ayarlar.ElleDurdurmadaMailGonder,
            Location = new Point(0, y),
            AutoSize = true
        };
        sayfa.Controls.Add(_elleDurdurmadaMail);
        y += 40;

        var kaydet = new Button
        {
            Text = "Kaydet",
            Location = new Point(0, y),
            Size = new Size(120, 34),
            FlatStyle = FlatStyle.Flat,
            BackColor = Yesil,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 9.5F, FontStyle.Bold)
        };
        kaydet.Click += (_, _) => AyarlariKaydet();
        sayfa.Controls.Add(kaydet);

        var test = new Button
        {
            Text = "Test Maili Gönder",
            Location = new Point(130, y),
            Size = new Size(150, 34),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White
        };
        test.Click += async (_, _) => await TestMaili();
        sayfa.Controls.Add(test);

        var ayarDosyasi = new Button
        {
            Text = "ayarlar.json",
            Location = new Point(290, y),
            Size = new Size(130, 34),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White
        };
        ayarDosyasi.Click += (_, _) => DosyaAc(PanelAyarlari.DosyaYolu);
        sayfa.Controls.Add(ayarDosyasi);
        y += 46;

        sayfa.Controls.Add(new Label
        {
            Text = "Servislerin komut ve klasör bilgileri ayarlar.json dosyasından düzenlenir.\r\n" +
                   $"Kök klasör: {_ayarlar.KokKlasoruBul()}",
            ForeColor = Color.Gray,
            Location = new Point(0, y),
            AutoSize = true
        });

        return sayfa;
    }

    /* ====================================================================== */
    /* İşlemler                                                               */
    /* ====================================================================== */

    private void Calistir(Action islem)
    {
        if (IsDisposed) return;
        if (InvokeRequired) BeginInvoke(islem);
        else islem();
    }

    private string SeciliServis() =>
        _liste.SelectedItems.Count > 0 ? _liste.SelectedItems[0].Text : null;

    private void SeciliIcin(Action<string> islem)
    {
        var ad = SeciliServis();
        if (ad is null)
        {
            MessageBox.Show("Lütfen listeden bir servis seçiniz.", "Biçen Kariyer Paneli",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        Task.Run(() => islem(ad));
    }

    private void ListeyiYenile()
    {
        var seciliAd = SeciliServis();
        _liste.BeginUpdate();
        _liste.Items.Clear();

        var calisan = 0;

        foreach (var servis in _yonetici.Servisler)
        {
            var satir = new ListViewItem(servis.Tanim.Ad);
            var aktif = servis.Calisiyor;
            if (aktif) calisan++;

            satir.SubItems.Add(aktif ? "● Çalışıyor" : "● Durdu");
            satir.SubItems.Add(aktif ? servis.Pid.ToString() : "-");
            satir.SubItems.Add(servis.BaslangicZamani?.ToString("dd.MM.yyyy HH:mm:ss") ?? "-");
            satir.SubItems.Add(servis.Tanim.Adres ?? "");
            satir.SubItems.Add(_ayarlar.ServisKlasoru(servis.Tanim));

            satir.UseItemStyleForSubItems = false;
            satir.SubItems[1].ForeColor = aktif ? YesilKoyu : Turuncu;
            satir.SubItems[1].Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);

            if (servis.Tanim.Ad == seciliAd) satir.Selected = true;

            _liste.Items.Add(satir);
        }

        _liste.EndUpdate();

        _durumEtiketi.Text = $"{calisan} / {_yonetici.Servisler.Count} servis çalışıyor";
        _tepsi.Text = $"Biçen Kariyer Paneli - {_durumEtiketi.Text}";
    }

    private void LogSeciciyiDoldur()
    {
        _logSecici.Items.Clear();
        foreach (var servis in _yonetici.Servisler)
            _logSecici.Items.Add(servis.Tanim.Ad);

        if (_logSecici.Items.Count > 0) _logSecici.SelectedIndex = 0;
    }

    private void LoglariYukle()
    {
        var ad = _logSecici.SelectedItem?.ToString();
        var servis = ad is null ? null : _yonetici.Getir(ad);
        _logKutusu.Text = servis is null
            ? ""
            : string.Join(Environment.NewLine, servis.Loglar);

        _logKutusu.SelectionStart = _logKutusu.TextLength;
        _logKutusu.ScrollToCaret();
    }

    private void LogGeldi(string servisAd, string satir)
    {
        Calistir(() =>
        {
            if (_logSecici.SelectedItem?.ToString() != servisAd) return;

            _logKutusu.AppendText($"[{DateTime.Now:HH:mm:ss}] {satir}{Environment.NewLine}");

            // Ekran şişmesin
            if (_logKutusu.Lines.Length > 3000)
                _logKutusu.Lines = _logKutusu.Lines.Skip(1000).ToArray();
        });
    }

    private void KapanmaBildir(string servisAd, int cikisKodu)
    {
        Calistir(() =>
        {
            _tepsi.ShowBalloonTip(
                6000, "Servis durdu",
                $"{servisAd} servisi durdu (çıkış kodu: {cikisKodu}).",
                ToolTipIcon.Warning);
        });

        Task.Run(async () =>
        {
            var servis = _yonetici.Getir(servisAd);
            var sonSatirlar = servis?.SonSatirlar(20) ?? Enumerable.Empty<string>();

            var (basarili, hata) = await MailGonderici.GonderAsync(
                _ayarlar.Mail,
                $"[Biçen Kariyer] {servisAd} servisi durdu",
                MailGonderici.DurmaGovdesi(servisAd, cikisKodu, sonSatirlar));

            if (!basarili)
                Calistir(() => LogGeldi(servisAd, $"BİLDİRİM MAİLİ GÖNDERİLEMEDİ: {hata}"));

            if (_ayarlar.OtomatikYenidenBaslat && servis is { ElleDurduruldu: false })
            {
                await Task.Delay(5000);
                Calistir(() => LogGeldi(servisAd, "Otomatik yeniden başlatılıyor..."));
                _yonetici.Baslat(servisAd);
            }
        });
    }

    private void AyarlariKaydet()
    {
        _ayarlar.Mail.Sunucu = _sunucu.Text.Trim();
        _ayarlar.Mail.Port = int.TryParse(_port.Text.Trim(), out var p) ? p : 465;
        _ayarlar.Mail.SifrelemeTuru = _sifreleme.SelectedItem?.ToString() ?? "Otomatik";
        _ayarlar.Mail.KullaniciAdi = _kullanici.Text.Trim();
        _ayarlar.Mail.Parola = _parola.Text;
        _ayarlar.Mail.GonderenAd = _gonderenAd.Text.Trim();
        _ayarlar.Mail.GonderenAdres = _gonderenAdres.Text.Trim();
        _ayarlar.Mail.AliciAdresler = _alicilar.Text
            .Split(new[] { ';', ',', ' ' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Contains('@'))
            .Distinct()
            .ToList();

        _ayarlar.OtomatikYenidenBaslat = _otomatikYenidenBaslat.Checked;
        _ayarlar.ElleDurdurmadaMailGonder = _elleDurdurmadaMail.Checked;

        try
        {
            _ayarlar.Kaydet();
            MessageBox.Show("Ayarlar kaydedildi.", "Biçen Kariyer Paneli",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception hata)
        {
            MessageBox.Show($"Ayarlar kaydedilemedi: {hata.Message}", "Biçen Kariyer Paneli",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task TestMaili()
    {
        AyarlariKaydet();

        var (basarili, hata) = await MailGonderici.GonderAsync(
            _ayarlar.Mail,
            "[Biçen Kariyer] Panel test maili",
            "<p>Bu bir test mailidir. Servis paneli bildirimleri çalışmaktadır.</p>");

        if (basarili)
        {
            MessageBox.Show("Test maili gönderildi.", "Biçen Kariyer Paneli",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        else
        {
            MessageBox.Show($"Mail gönderilemedi:\r\n\r\n{hata}", "Biçen Kariyer Paneli",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void SeciliAdresiAc()
    {
        var ad = SeciliServis();
        var servis = ad is null ? null : _yonetici.Getir(ad);
        if (string.IsNullOrWhiteSpace(servis?.Tanim.Adres)) return;

        try
        {
            Process.Start(new ProcessStartInfo(servis.Tanim.Adres) { UseShellExecute = true });
        }
        catch
        {
            /* tarayıcı açılamazsa sessiz geçilir */
        }
    }

    private static void KlasorAc(string yol)
    {
        try
        {
            Directory.CreateDirectory(yol);
            Process.Start(new ProcessStartInfo(yol) { UseShellExecute = true });
        }
        catch
        {
            /* yoksayılır */
        }
    }

    private static void DosyaAc(string yol)
    {
        try
        {
            Process.Start(new ProcessStartInfo(yol) { UseShellExecute = true });
        }
        catch
        {
            /* yoksayılır */
        }
    }
}
