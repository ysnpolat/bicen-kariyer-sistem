import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import HataSiniri from "./HataSiniri";
import "antd/dist/reset.css";
import "./styles.css";

/* Hata sınırı en dışta: React çizim sırasında bir hata yakalarsa tüm
   ağacı söküyor ve geriye boş bir sayfa kalıyordu. Kullanıcı ne olduğunu
   göremiyor, yalnızca yenileyerek kurtuluyordu. Sınır, hatayı okunur bir
   ekrana çevirir. */
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HataSiniri>
      <App />
    </HataSiniri>
  </React.StrictMode>
);
