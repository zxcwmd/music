/* Aurora · preload.
   Контекст изолирован, nodeIntegration выключен — наружу торчит ровно одна
   маленькая поверхность: сведения об окружении и версиях для окна «О программе».
*/
'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('aurora', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chromium: process.versions.chrome
  },
  packaged: !process.defaultApp
});
