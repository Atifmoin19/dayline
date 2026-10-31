import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";

import "./index.css";
import { ChakraProvider } from "@chakra-ui/react";
import { BrowserRouter as Router } from "react-router-dom";

import { persistStore } from "redux-persist";
import { PersistGate } from "redux-persist/integration/react";

import App from "App";
import { store } from "app/store";
import { theme } from "Styles";
import { MyEmotionProvider } from "Components/MyEmotionProvider";

const persistor = persistStore(store);

// Generate a fresh nonce per page load instead of a hardcoded constant.
const cssNonce =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2);

createRoot(document.getElementById("root")!).render(
  <MyEmotionProvider nonce={cssNonce}>
    <ChakraProvider resetCSS theme={theme}>
      <Provider store={store}>
        <Router basename="/">
          <PersistGate loading={null} persistor={persistor}>
            <App />
          </PersistGate>
        </Router>
      </Provider>
    </ChakraProvider>
  </MyEmotionProvider>
);
