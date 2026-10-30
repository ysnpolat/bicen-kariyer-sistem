/**
 * Hata Sınırı
 * ---------------------------------------------------------------------------
 * React, çizim sırasında yakalanmamış bir hata olduğunda tüm ağacı söker ve
 * geriye bomboş bir sayfa kalır. Kullanıcı ne olduğunu anlamaz, yalnızca
 * sayfayı yenileyerek kurtulur.
 *
 * Bu bileşen hatayı yakalayıp okunur bir ekran gösterir ve hatanın kendisini
 * yazar; böylece sorun "beyaz ekran" olmaktan çıkıp teşhis edilebilir hâle
 * gelir.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Ozellikler {
  children: ReactNode;
}

interface Durum {
  hata: Error | null;
  ayrinti: string;
}

export default class HataSiniri extends Component<Ozellikler, Durum> {
  state: Durum = { hata: null, ayrinti: "" };

  static getDerivedStateFromError(hata: Error): Partial<Durum> {
    return { hata };
  }

  componentDidCatch(hata: Error, bilgi: ErrorInfo) {
    /* Geliştirici konsolunda tam yığın izi kalır */
    console.error("Panelde hata:", hata, bilgi.componentStack);

    this.setState({ ayrinti: bilgi.componentStack ?? "" });
  }

  private yenile = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hata) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f6f2",
          padding: 24,
          fontFamily: "'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 620,
            width: "100%",
            background: "#fff",
            border: "1px solid #e3e6e1",
            borderLeft: "3px solid #e8481c",
            borderRadius: "0 10px 10px 0",
            padding: "22px 24px",
          }}
        >
          <h2
            style={{
              margin: "0 0 6px",
              fontSize: 17,
              color: "#1f2933",
            }}
          >
            Beklenmeyen bir hata oluştu
          </h2>

          <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "#6b7280" }}>
            Ekran çizilemedi. Sayfayı yenilemek genelde sorunu giderir. Sorun
            tekrarlıyorsa aşağıdaki metni iletiniz.
          </p>

          <pre
            style={{
              background: "#fbfcfa",
              border: "1px solid #e3e6e1",
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              lineHeight: 1.5,
              maxHeight: 220,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              margin: "0 0 16px",
              color: "#cf1322",
            }}
          >
            {this.state.hata.message}
            {this.state.ayrinti
              ? `\n${this.state.ayrinti.split("\n").slice(0, 6).join("\n")}`
              : ""}
          </pre>

          <button
            type="button"
            onClick={this.yenile}
            style={{
              padding: "9px 18px",
              border: 0,
              borderRadius: 7,
              background: "#7cb518",
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sayfayı yenile
          </button>
        </div>
      </div>
    );
  }
}
