import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Packaging config for the native Android build.
 *
 *   npm run build && npx cap add android && npx cap sync && npx cap open android
 *
 * The `android/` folder is generated, so it is gitignored — regenerate it with
 * `cap add` rather than committing it.
 */
const config: CapacitorConfig = {
  appId: "com.tijantrados.moonbeam",
  appName: "MoonBeam",
  webDir: "dist",
  backgroundColor: "#120e26",
  android: {
    backgroundColor: "#120e26",
  },
};

export default config;
