/**
 * ---------------------------------------------------------------------------
 * Hata Kalkanı
 * ---------------------------------------------------------------------------
 * Bir sayfa çizim sırasında hata verdiğinde React bütün ağacı söküyor ve
 * geriye bomboş bir ekran kalıyor: kullanıcı ne olduğunu anlamıyor, biz de
 * sebebi göremiyoruz.
 *
 * Kalkan sayfanın etrafında duruyor; hata çıktığında menü ve başlık
 * yerinde kalıyor, yalnızca içerik yerine hata metni görünüyor. Kullanıcı
 * başka bir sayfaya geçip çalışmaya devam edebiliyor.
 *
 * Kalkan çözüm değil teşhis aracı: hatayı yutup sayfayı çalışır
 * göstermiyor, yalnızca hasarı sınırlıyor ve sebebi okunur kılıyor.
 * ---------------------------------------------------------------------------
 */

import { Component, type ReactNode } from "react";
import { Button, Result, Typography } from "antd";

const { Paragraph, Text } = Typography;

interface Ozellikler {
  children: ReactNode;

  /* Sayfa değiştiğinde kalkan sıfırlanmalı: bir sayfadaki hata yüzünden
     diğerlerinin de kırık görünmesi yanlış olurdu. */
  anahtar?: string;
}

interface Durum {
  hata: Error | null;
  yigin: string;
}

export default class HataKalkani extends Component<Ozellikler, Durum> {
  constructor(ozellikler: Ozellikler) {
    super(ozellikler);

    this.state = { hata: null, yigin: "" };
  }

  static getDerivedStateFromError(hata: Error): Partial<Durum> {
    return { hata };
  }

  componentDidCatch(_hata: Error, bilgi: { componentStack?: string }) {
    /* Yığın ayrı tutuluyor: hangi bileşende koptuğunu asıl bu söylüyor */
    this.setState({ yigin: bilgi?.componentStack ?? "" });
  }

  componentDidUpdate(oncekiOzellikler: Ozellikler) {
    if (oncekiOzellikler.anahtar !== this.props.anahtar && this.state.hata)
      this.setState({ hata: null, yigin: "" });
  }

  render() {
    const { hata, yigin } = this.state;

    if (!hata) return this.props.children;

    const metin = `${hata.message}\n\n${yigin}`.trim();

    return (
      <Result
        status="error"
        title="Bu sayfa açılamadı"
        subTitle="Beklenmedik bir hata oluştu. Diğer sayfalar çalışmaya devam ediyor."
        extra={[
          <Button key="yenile" type="primary" onClick={() => window.location.reload()}>
            Sayfayı yenile
          </Button>,
        ]}
      >
        <Paragraph>
          <Text strong>Hata metni</Text>
        </Paragraph>

        <Paragraph>
          <Text
            code
            copyable={{ text: metin }}
            style={{
              display: "block",
              whiteSpace: "pre-wrap",
              fontSize: 12,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {metin}
          </Text>
        </Paragraph>

        <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          Bu metni bilgi işleme iletirseniz sorun hızlıca giderilir.
        </Paragraph>
      </Result>
    );
  }
}
