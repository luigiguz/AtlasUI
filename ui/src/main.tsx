import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapAtlasTheme } from "./atlasTheme";
import "./index.css";

bootstrapAtlasTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
