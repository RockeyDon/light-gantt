import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'LightGantt',
    appBundleId: 'local.lightgantt.desktop',
    appCategoryType: 'public.app-category.productivity',
    // Vite bundles JS, but better-sqlite3 must remain a packaged runtime dependency.
    ignore: (file) => Boolean(file) && !file.startsWith('/.vite') && !file.startsWith('/node_modules') && file !== '/package.json',
  },
  rebuildConfig: {},
  makers: [new MakerDMG({ format: 'UDZO' }), new MakerZIP({}, ['darwin'])],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};

export default config;
