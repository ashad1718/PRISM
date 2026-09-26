import './polyfills';
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WalletContext } from "./wallet";
import { Auth0Provider } from "@auth0/auth0-react";
import './styles.css';

const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN || "dev-qgurz2ru6vqh8o57.us.auth0.com";
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID || "1ICvTuIiBF4zwrAScJe4wzPq41nYV342";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Auth0Provider
      domain={auth0Domain}
      clientId={auth0ClientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
      }}
    >
      <WalletContext>
        <App />
      </WalletContext>
    </Auth0Provider>
  </React.StrictMode>
);

