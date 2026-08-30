import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

const style = document.createElement("style");
style.textContent = `
  html, body, #root { margin: 0; height: 100%; box-sizing: border-box; }
  *, *:before, *:after { box-sizing: inherit; }
  input:focus, textarea:focus, button:focus-visible {
    border-color: #0071e3 !important;
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.2) !important;
    outline: none !important;
  }
  button:active {
    transform: scale(0.97);
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
