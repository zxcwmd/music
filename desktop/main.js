/* Aurora · главный процесс Electron.
   Страница отдаётся по своей схеме app://, а не через file:// — так у приложения
   нормальное происхождение (origin) и запросы к Audius / archive.org идут как
   обычный CORS, без quirks file://.
*/
'use strict';

const { app, BrowserWindow, Menu, shell, protocol, net, globalShortcut } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEME = 'app';
const HOST = 'aurora';

// регистрируем схему до готовности приложения
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true, secure: true, supportFetchAPI: true,
    stream: true, corsEnabled: true, codeCache: true
  }
}]);

// музыка должна стартовать сразу, без обязательного жеста
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWin = null;

/** app://aurora/<путь> -> файл внутри ROOT, с защитой от выхода за корень */
function resolveLocal(url) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
  } catch (e) {
    rel = '';
  }
  if (!rel) rel = 'index.html';
  const abs = path.normalize(path.join(ROOT, rel));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;   // ../ наружу
  return abs;
}

function registerProtocol() {
  protocol.handle(SCHEME, (request) => {
    const abs = resolveLocal(request.url);
    if (!abs) return new Response('Not found', { status: 404 });
    return net.fetch('file://' + abs, { bypassCustomProtocolHandlers: true });
  });
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 580,
    title: 'Aurora',
    backgroundColor: '#07070c',          // без белой вспышки при старте
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWin.loadURL(`${SCHEME}://${HOST}/index.html`);
  mainWin.once('ready-to-show', () => mainWin.show());

  // любые внешние ссылки — в системном браузере, не внутри плеера
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWin.on('closed', () => { mainWin = null; });
  return mainWin;
}

/* ---- один экземпляр ---- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  app.whenReady().then(() => {
    registerProtocol();
    createWindow();

    // своё меню: только то, что в плеере реально нужно
    const template = [
      {
        label: 'Воспроизведение',
        submenu: [
          { label: 'Играть / пауза', click: () => media('toggle') },
          { label: 'Следующий трек', click: () => media('next') },
          { label: 'Предыдущий трек', click: () => media('prev') },
          { type: 'separator' },
          { role: 'quit', label: 'Выход' }
        ]
      },
      {
        label: 'Вид',
        submenu: [
          { role: 'reload', label: 'Обновить' },
          { role: 'togglefullscreen', label: 'Полный экран' },
          { role: 'toggleDevTools', label: 'Инструменты разработчика' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Сбросить масштаб' },
          { role: 'zoomIn', label: 'Увеличить' },
          { role: 'zoomOut', label: 'Уменьшить' }
        ]
      },
      {
        label: 'Справка',
        submenu: [
          {
            label: 'Об источниках музыки',
            click: () => shell.openExternal('https://archive.org/about/')
          },
          {
            label: 'Audius',
            click: () => shell.openExternal('https://audius.co')
          }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/** Пробрасываем мультимедийные клавиши в страницу, где живёт Media Session */
function media(action) {
  if (!mainWin) return;
  mainWin.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('aurora:media',{detail:'${action}'}))`
  ).catch(() => {});
}
